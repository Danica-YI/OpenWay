"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap, Marker, Polygon, Polyline } from "leaflet";
import type { AccessLevel, BBox, LatLng, MapBuilding, OsmEntrance } from "../lib/osm";
import { CURATED, type SurveyedProfile } from "../lib/curated";

type Filter = "All" | "Surveyed" | "Step-free" | "Toilet" | "Needs info";
type Tab = "details" | "route" | "community";

/** How complete a building's accessibility picture is. Drives the map colours. */
type InfoStatus = "surveyed" | "mapped" | "reported" | "unknown";

type Contribution = {
  id: number;
  buildingId: string;
  category: string;
  location: string;
  details: string;
  contributor: string;
  status: string;
  createdAt: string;
};

const DEMO_START: LatLng = [-27.47643, 153.02784];
const MIN_ZOOM = 16;
const MAX_RENDERED = 600;

const STATUS_STYLE: Record<InfoStatus, { color: string; fill: string; fillOpacity: number; dashArray?: string }> = {
  surveyed: { color: "#087f73", fill: "#20a695", fillOpacity: 0.3 },
  mapped: { color: "#2563eb", fill: "#60a5fa", fillOpacity: 0.22 },
  reported: { color: "#a85f05", fill: "#f0b429", fillOpacity: 0.22 },
  unknown: { color: "#94a3b8", fill: "#cbd5e1", fillOpacity: 0.12, dashArray: "4 4" },
};

const STATUS_LABEL: Record<InfoStatus, string> = {
  surveyed: "Surveyed profile",
  mapped: "Mapped in OpenStreetMap",
  reported: "Community reports only",
  unknown: "No accessibility info yet",
};

function haversine(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const radius = 6371000;
  const dLat = (b[0] - a[0]) * toRad;
  const dLon = (b[1] - a[1]) * toRad;
  const lat1 = a[0] * toRad;
  const lat2 = b[0] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function formatDistance(metres: number): string {
  return metres < 950 ? `${Math.round(metres / 5) * 5} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** Deliberately slower than a walking estimate: this is a step-free travel time. */
function formatDuration(metres: number): string {
  const minutes = Math.max(1, Math.round(metres / 66));
  return `${minutes} min`;
}

function accessWord(level: AccessLevel): string {
  if (level === "yes") return "Yes";
  if (level === "limited") return "Partial";
  if (level === "no") return "No";
  return "Not recorded";
}

function displayName(building: MapBuilding): string {
  return building.name ?? (building.address ? `${building.kind}, ${building.address}` : `Unnamed ${building.kind.toLowerCase()}`);
}

function bestEntrance(building: MapBuilding): OsmEntrance | null {
  if (!building.entrances.length) return null;
  return (
    building.entrances.find((entrance) => entrance.wheelchair === "yes") ??
    building.entrances.find((entrance) => entrance.kind === "main") ??
    building.entrances[0]
  );
}

function bboxContains(outer: BBox, inner: BBox): boolean {
  return outer.south <= inner.south && outer.west <= inner.west && outer.north >= inner.north && outer.east >= inner.east;
}

/**
 * The building drawer overlays the right side of the map (up to ~470px) on
 * wider viewports, but stacks below it as a bottom sheet on narrow ones. Any
 * map framing (flyTo, fitBounds) that ignores this ends up centering content
 * behind the panel instead of in the space that's actually visible. Returns
 * the panel's width in px when it's laid out as a side panel, else 0.
 */
function drawerSideWidth(map: LeafletMap): number {
  const drawerEl = document.querySelector(".building-drawer");
  if (!drawerEl) return 0;
  const mapRect = map.getContainer().getBoundingClientRect();
  const drawerRect = drawerEl.getBoundingClientRect();
  const isSidePanel = drawerRect.top - mapRect.top < mapRect.height * 0.3 && drawerRect.width < mapRect.width * 0.7;
  return isSidePanel ? drawerRect.width : 0;
}

export default function Home() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<LeafletMap | null>(null);
  const shapeLayer = useRef<LayerGroup | null>(null);
  const shapes = useRef<Map<string, Polygon>>(new Map());
  const routeLine = useRef<Polyline | null>(null);
  const routeHalo = useRef<Polyline | null>(null);
  const userMarker = useRef<Marker | null>(null);
  const requestCache = useRef<Map<string, MapBuilding[]>>(new Map());
  const loadedBBox = useRef<BBox | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState<{ bbox: BBox; zoom: number } | null>(null);
  const [buildings, setBuildings] = useState<MapBuilding[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [buildingError, setBuildingError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [detailOpen, setDetailOpen] = useState(false);
  const [routeVisible, setRouteVisible] = useState(false);
  const [location, setLocation] = useState<LatLng>(DEMO_START);
  const [locationMessage, setLocationMessage] = useState("Demo starting point");

  const [contributionOpen, setContributionOpen] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loadingContributions, setLoadingContributions] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [form, setForm] = useState({ category: "Ramp", location: "", details: "", contributor: "" });

  // Derived, not stored: the viewport already tells us whether we are too far out.
  const needsZoom = viewport !== null && viewport.zoom < MIN_ZOOM;

  const selected = useMemo(
    () => buildings.find((building) => building.id === selectedId) ?? null,
    [buildings, selectedId],
  );
  const curated: SurveyedProfile | null = selected ? CURATED[selected.id] ?? null : null;

  const statusOf = useCallback(
    (building: MapBuilding): InfoStatus => {
      if (CURATED[building.id]) return "surveyed";
      if (building.knownFacts > 0) return "mapped";
      if ((counts[building.id] ?? 0) > 0) return "reported";
      return "unknown";
    },
    [counts],
  );

  const withDistance = useMemo(
    () =>
      buildings.map((building) => ({
        building,
        status: statusOf(building),
        metres: haversine(location, building.center),
      })),
    [buildings, location, statusOf],
  );

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return withDistance
      .filter(({ building, status }) => {
        if (search && !`${displayName(building)} ${building.kind} ${building.address ?? ""}`.toLowerCase().includes(search)) {
          return false;
        }
        if (filter === "Surveyed") return status === "surveyed";
        if (filter === "Needs info") return status === "unknown";
        if (filter === "Step-free") {
          return Boolean(CURATED[building.id]) || building.wheelchair === "yes" || building.wheelchair === "limited";
        }
        if (filter === "Toilet") {
          return (
            Boolean(CURATED[building.id]) ||
            building.toiletsWheelchair === "yes" ||
            building.amenities.some((amenity) => amenity.type === "toilets")
          );
        }
        return true;
      })
      .sort((a, b) => a.metres - b.metres);
  }, [filter, query, withDistance]);

  const openContribution = useCallback(() => {
    setForm({ category: "Ramp", location: "", details: "", contributor: "" });
    setSubmitState("idle");
    setContributionOpen(true);
  }, []);

  const chooseBuilding = useCallback((id: string, tab: Tab = "details") => {
    setSelectedId(id);
    setActiveTab(tab);
    setDetailOpen(true);
    setRouteVisible(tab === "route");
  }, []);


  // --- map bootstrap -------------------------------------------------------
  useEffect(() => {
    let active = true;
    const shapeStore = shapes.current;
    async function createMap() {
      if (!mapElement.current || mapInstance.current) return;
      const L = await import("leaflet");
      if (!active || !mapElement.current) return;

      const map = L.map(mapElement.current, { zoomControl: false }).setView([-27.47700, 153.02810], 17);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      shapeLayer.current = L.layerGroup().addTo(map);

      const userIcon = L.divIcon({
        className: "custom-marker",
        html: '<div class="user-pin"><span></span></div>',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      userMarker.current = L.marker(DEMO_START, { icon: userIcon, title: "Your starting point" }).addTo(map);

      const syncViewport = () => {
        const bounds = map.getBounds();
        setViewport({
          bbox: { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() },
          zoom: map.getZoom(),
        });
      };
      map.on("moveend", syncViewport);
      syncViewport();

      mapInstance.current = map;
    }
    createMap();
    return () => {
      active = false;
      mapInstance.current?.remove();
      mapInstance.current = null;
      shapeStore.clear();
    };
  }, []);

  // --- load buildings for the viewport ------------------------------------
  useEffect(() => {
    if (!viewport || viewport.zoom < MIN_ZOOM) return;

    // Panning inside an area we already hold needs no new request.
    if (loadedBBox.current && bboxContains(loadedBBox.current, viewport.bbox)) return;

    const timer = window.setTimeout(async () => {
      const { south, west, north, east } = viewport.bbox;
      // Pad the request so small pans stay inside the cached area.
      const padLat = (north - south) * 0.35;
      const padLon = (east - west) * 0.35;
      const padded: BBox = {
        south: south - padLat,
        west: west - padLon,
        north: north + padLat,
        east: east + padLon,
      };
      const key = [padded.south, padded.west, padded.north, padded.east].map((v) => v.toFixed(4)).join(",");

      const cached = requestCache.current.get(key);
      if (cached) {
        setBuildings(cached);
        loadedBBox.current = padded;
        return;
      }

      setLoadingBuildings(true);
      setBuildingError(null);
      try {
        const response = await fetch(`/api/buildings?bbox=${key}`);
        const payload = (await response.json()) as { buildings?: MapBuilding[]; error?: string; zoomIn?: boolean };
        if (payload.zoomIn) {
          setBuildings([]);
          return;
        }
        if (!response.ok) throw new Error(payload.error ?? "Could not load buildings");
        const loaded = payload.buildings ?? [];
        requestCache.current.set(key, loaded);
        loadedBBox.current = padded;
        setBuildings(loaded);
      } catch (error) {
        setBuildingError(error instanceof Error ? error.message : "Could not load buildings");
      } finally {
        setLoadingBuildings(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [viewport]);

  // --- community report counts for the buildings on screen ----------------
  useEffect(() => {
    if (!buildings.length) return;
    let ignore = false;
    (async () => {
      try {
        const response = await fetch("/api/contributions/counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: buildings.map((building) => building.id) }),
        });
        const payload = (await response.json()) as { counts?: Record<string, number> };
        if (!ignore) setCounts(payload.counts ?? {});
      } catch {
        /* counts are cosmetic */
      }
    })();
    return () => { ignore = true; };
  }, [buildings]);

  // --- draw the footprints -------------------------------------------------
  useEffect(() => {
    async function draw() {
      const layer = shapeLayer.current;
      if (!layer || !mapInstance.current) return;
      const L = await import("leaflet");

      layer.clearLayers();
      shapes.current.clear();

      for (const { building, status } of withDistance.slice(0, MAX_RENDERED)) {
        const isSelected = building.id === selectedId;
        const style = STATUS_STYLE[status];
        const polygon = L.polygon(building.polygon, {
          color: isSelected ? "#0b3d38" : style.color,
          weight: isSelected ? 4 : 1.5,
          fillColor: style.fill,
          fillOpacity: isSelected ? 0.45 : style.fillOpacity,
          dashArray: isSelected ? undefined : style.dashArray,
        })
          .bindTooltip(`${displayName(building)} — ${STATUS_LABEL[status]}`, { sticky: true })
          .on("click", () => chooseBuilding(building.id));
        layer.addLayer(polygon);
        shapes.current.set(building.id, polygon);
      }
    }
    draw();
  }, [chooseBuilding, selectedId, withDistance]);

  // --- pan to the selected building ---------------------------------------
  useEffect(() => {
    if (!selected || !mapInstance.current) return;
    const map = mapInstance.current;
    const zoom = Math.max(map.getZoom(), 18);

    let target: LatLng = selected.center;
    const drawerWidth = drawerSideWidth(map);
    if (drawerWidth > 0) {
      const shifted = map.project(selected.center, zoom).add([drawerWidth / 2, 0]);
      const unprojected = map.unproject(shifted, zoom);
      target = [unprojected.lat, unprojected.lng];
    }

    map.flyTo(target, zoom, { duration: 0.6 });
  }, [selected]);

  // --- direct line to the entrance ----------------------------------------
  useEffect(() => {
    async function drawRoute() {
      if (!mapInstance.current) return;
      const L = await import("leaflet");
      routeLine.current?.remove();
      routeLine.current = null;
      routeHalo.current?.remove();
      routeHalo.current = null;
      if (!routeVisible || !selected) return;

      const target = bestEntrance(selected)?.point ?? selected.center;
      const points: LatLng[] = [location, target];
      routeHalo.current = L.polyline(points, { color: "#fff", weight: 11, opacity: 0.94, lineCap: "round" }).addTo(mapInstance.current);
      routeLine.current = L.polyline(points, {
        color: "#087f73",
        weight: 6,
        opacity: 1,
        lineCap: "round",
        dashArray: "10 8",
      }).addTo(mapInstance.current);
      mapInstance.current.fitBounds(routeLine.current.getBounds(), {
        paddingTopLeft: [70, 70],
        paddingBottomRight: [70 + drawerSideWidth(mapInstance.current), 70],
        maxZoom: 18,
      });
    }
    drawRoute();
  }, [location, routeVisible, selected]);

  // --- community reports for the selected building ------------------------
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!selectedId) {
        if (!ignore) setContributions([]);
        return;
      }
      setLoadingContributions(true);
      try {
        const response = await fetch(`/api/contributions?buildingId=${encodeURIComponent(selectedId)}`);
        const payload = (await response.json()) as { contributions?: Contribution[] };
        if (!ignore) setContributions(payload.contributions ?? []);
      } catch {
        if (!ignore) setContributions([]);
      } finally {
        if (!ignore) setLoadingContributions(false);
      }
    })();
    return () => { ignore = true; };
  }, [selectedId]);

  // --- modal keyboard handling --------------------------------------------
  useEffect(() => {
    if (!contributionOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContributionOpen(false);
    };
    window.addEventListener("keydown", onKey);
    modalRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [contributionOpen]);

  async function submitContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setSubmitState("saving");
    try {
      const response = await fetch("/api/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, buildingId: selectedId }),
      });
      const payload = (await response.json()) as { contribution?: Contribution; error?: string };
      if (!response.ok || !payload.contribution) throw new Error(payload.error ?? "Submission failed");
      setSubmitState("success");
      setContributions((items) => [payload.contribution!, ...items]);
      setCounts((current) => ({ ...current, [selectedId]: (current[selectedId] ?? 0) + 1 }));
      setActiveTab("community");
      setDetailOpen(true);
      window.setTimeout(() => setContributionOpen(false), 900);
    } catch {
      setSubmitState("error");
    }
  }

  function locateUser() {
    if (!navigator.geolocation) {
      setLocationMessage("Location unavailable — using demo start");
      return;
    }
    setLocationMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const next: LatLng = [coords.latitude, coords.longitude];
        setLocation(next);
        setLocationMessage("Current location");
        const L = await import("leaflet");
        userMarker.current?.setLatLng(next).setIcon(
          L.divIcon({ className: "custom-marker", html: '<div class="user-pin"><span></span></div>', iconSize: [34, 34], iconAnchor: [17, 17] }),
        );
        mapInstance.current?.flyTo(next, 18, { duration: 0.65 });
      },
      () => setLocationMessage("Permission not granted — using demo start"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const selectedStatus = selected ? statusOf(selected) : "unknown";
  const selectedDistance = selected ? haversine(location, selected.center) : 0;
  const surveyedCount = visible.filter((item) => item.status === "surveyed").length;
  const gapCount = visible.filter((item) => item.status === "unknown").length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AccessRamp home">
          <span className="brand-mark">♿</span>
          <span>Access<span>Ramp</span></span>
        </a>
        <div className="header-status">
          <span className="status-dot" /> Every building, not just the mapped ones
        </div>
        <button className="report-button" type="button" onClick={openContribution} disabled={!selectedId}>
          <span aria-hidden="true">＋</span> {selectedId ? "Contribute accessibility info" : "Select a building first"}
        </button>
      </header>

      <section className="workspace" id="top">
        <aside className="sidebar" aria-label="Buildings in view">
          <div className="sidebar-heading">
            <p className="eyebrow">KNOW BEFORE YOU ARRIVE</p>
            <h1>Every access detail, in one place.</h1>
            <p>Click any building on the map — even one nobody has surveyed yet — to see exactly what is known about getting inside.</p>
          </div>

          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search buildings in view" aria-label="Search buildings in view" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
          </label>

          <div className="filter-row">
            {(["All", "Surveyed", "Step-free", "Toilet", "Needs info"] as Filter[]).map((item) => (
              <button type="button" key={item} className={filter === item ? "filter active" : "filter"} onClick={() => setFilter(item)} aria-pressed={filter === item}>
                {item === "All" ? "All buildings" : item}
              </button>
            ))}
          </div>

          <div className="results-meta">
            <strong>{visible.length} buildings</strong>
            <span>{surveyedCount} surveyed · {gapCount} need info</span>
          </div>

          <div className="location-list">
            {loadingBuildings && !visible.length && <p className="loading">Loading buildings from OpenStreetMap…</p>}

            {needsZoom && (
              <div className="empty-state">
                <span aria-hidden="true">⌕</span>
                <strong>Zoom in to load buildings</strong>
                <p>Building footprints load at street level.</p>
              </div>
            )}

            {buildingError && (
              <div className="empty-state">
                <span aria-hidden="true">!</span>
                <strong>Map data unavailable</strong>
                <p>{buildingError}</p>
              </div>
            )}

            {visible.slice(0, 120).map(({ building, status, metres }) => (
              <button
                type="button"
                key={building.id}
                className={selectedId === building.id ? "location-card selected" : "location-card"}
                onClick={() => chooseBuilding(building.id)}
                aria-pressed={selectedId === building.id}
              >
                <span className={`location-icon status-${status}`} aria-hidden="true">
                  {status === "surveyed" ? "✓" : status === "mapped" ? "◑" : status === "reported" ? "◔" : "?"}
                </span>
                <span className="location-copy">
                  <strong>{displayName(building)}</strong>
                  <span>{STATUS_LABEL[status]}</span>
                  <span className="feature-chips">
                    <i>{building.kind}</i>
                    {building.entrances.length > 0 && <i>{building.entrances.length} entrance{building.entrances.length > 1 ? "s" : ""}</i>}
                    {(counts[building.id] ?? 0) > 0 && <i>{counts[building.id]} report{counts[building.id] > 1 ? "s" : ""}</i>}
                  </span>
                </span>
                <span className="distance">{formatDistance(metres)}<i aria-hidden="true">›</i></span>
              </button>
            ))}

            {!loadingBuildings && !needsZoom && !buildingError && !visible.length && (
              <div className="empty-state">
                <span aria-hidden="true">⌕</span>
                <strong>No matching buildings</strong>
                <p>Try another filter, or pan the map.</p>
              </div>
            )}
          </div>
        </aside>

        <section className="map-panel" aria-label="Interactive building accessibility map">
          <div ref={mapElement} className="map" />

          <div className="map-top-controls">
            <button className="locate-button" type="button" onClick={locateUser}>
              <span aria-hidden="true">◎</span>
              <span><b>Use my location</b><small>{locationMessage}</small></span>
            </button>
            <div className="map-legend" role="note" aria-label="Map colour key">
              <span><i className="swatch surveyed" /> Surveyed</span>
              <span><i className="swatch mapped" /> Mapped</span>
              <span><i className="swatch reported" /> Reported</span>
              <span><i className="swatch unknown" /> No info</span>
            </div>
          </div>

          {loadingBuildings && <div className="fetch-status" role="status">Loading buildings…</div>}

          {detailOpen && selected && (
            <article className="building-drawer" aria-live="polite">
              <div className="drawer-header">
                <div>
                  <span className="detail-type">BUILDING ACCESS PROFILE</span>
                  <h2>{displayName(selected)}</h2>
                  <p>{selected.kind}{selected.address ? ` · ${selected.address}` : ""}{selected.levels ? ` · ${selected.levels} levels` : ""}</p>
                </div>
                <button className="close-detail" type="button" aria-label="Close building details" onClick={() => { setDetailOpen(false); setRouteVisible(false); }}>×</button>
              </div>

              <div className="profile-meta">
                <span className={`source-badge ${selectedStatus}`}>{STATUS_LABEL[selectedStatus]}</span>
                <span>{formatDistance(selectedDistance)} away</span>
              </div>

              <div className="tabs" role="tablist">
                <button role="tab" id="tab-details" aria-selected={activeTab === "details"} aria-controls="panel-details" className={activeTab === "details" ? "active" : ""} onClick={() => { setActiveTab("details"); setRouteVisible(false); }}>Accessibility</button>
                <button role="tab" id="tab-route" aria-selected={activeTab === "route"} aria-controls="panel-route" className={activeTab === "route" ? "active" : ""} onClick={() => { setActiveTab("route"); setRouteVisible(true); }}>Route</button>
                <button role="tab" id="tab-community" aria-selected={activeTab === "community"} aria-controls="panel-community" className={activeTab === "community" ? "active" : ""} onClick={() => { setActiveTab("community"); setRouteVisible(false); }}>
                  Community{contributions.length ? ` (${contributions.length})` : ""}
                </button>
              </div>

              <div className="drawer-content">
                {activeTab === "details" && (
                  <div role="tabpanel" id="panel-details" aria-labelledby="tab-details">
                    {curated ? (
                      <SurveyedSections profile={curated} />
                    ) : (
                      <OsmSections building={selected} onContribute={openContribution} reportCount={counts[selected.id] ?? 0} />
                    )}
                  </div>
                )}

                {activeTab === "route" && (
                  <section className="route-panel" role="tabpanel" id="panel-route" aria-labelledby="tab-route">
                    <div className="route-summary">
                      <span aria-hidden="true">♿</span>
                      <div>
                        <b>{formatDistance(selectedDistance)} · About {formatDuration(selectedDistance)}</b>
                        <small>
                          {bestEntrance(selected)
                            ? `Toward the ${bestEntrance(selected)!.side} entrance`
                            : "Toward the building centre — no entrance mapped yet"}
                        </small>
                      </div>
                    </div>
                    {curated ? (
                      <ol>{curated.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
                    ) : (
                      <p className="safety-note">
                        No step-free directions for this building yet. The dashed line shows direct distance only, not a walkable route.
                      </p>
                    )}
                    <button type="button" className="primary-action full" onClick={() => setRouteVisible(true)}>Show on map <span aria-hidden="true">→</span></button>
                    <p className="safety-note">Prototype routing. Check temporary closures and verify conditions before travel.</p>
                  </section>
                )}

                {activeTab === "community" && (
                  <section className="community-panel" role="tabpanel" id="panel-community" aria-labelledby="tab-community">
                    <div className="community-intro">
                      <div>
                        <h3>Help complete this profile</h3>
                        <p>Share a missing measurement, exact location or recent access change.</p>
                      </div>
                      <button type="button" onClick={openContribution}>＋ Add information</button>
                    </div>
                    <div className="community-warning">Community reports are unverified and shown separately from surveyed and OpenStreetMap information.</div>
                    {loadingContributions ? (
                      <p className="loading">Loading community reports…</p>
                    ) : contributions.length ? (
                      <div className="contribution-list">
                        {contributions.map((item) => (
                          <article key={item.id}>
                            <div><b>{item.category}</b><span>Unverified</span></div>
                            <strong>{item.location}</strong>
                            <p>{item.details}</p>
                            <small>Shared by {item.contributor} · {new Date(item.createdAt.replace(" ", "T") + "Z").toLocaleDateString()}</small>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="no-contributions">
                        <span aria-hidden="true">＋</span>
                        <b>No community reports yet</b>
                        <p>Be the first to add a useful access detail.</p>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </article>
          )}

          {!detailOpen && (
            <div className="prototype-note">
              <b>Click any building</b> to see what is known about getting inside it.
            </div>
          )}
        </section>
      </section>

      {contributionOpen && selected && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setContributionOpen(false); }}>
          <section className="contribution-modal" role="dialog" aria-modal="true" aria-labelledby="contribution-title" ref={modalRef}>
            <div className="modal-header">
              <div>
                <span className="detail-type">COMMUNITY CONTRIBUTION</span>
                <h2 id="contribution-title">Add an accessibility detail</h2>
                <p>You are adding information about <b>{displayName(selected)}</b>.</p>
              </div>
              <button className="close-detail" onClick={() => setContributionOpen(false)} aria-label="Close contribution form">×</button>
            </div>
            <form onSubmit={submitContribution}>
              <div className="form-row">
                <label>Accessibility feature
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    <option>Ramp</option><option>Accessible entrance</option><option>Accessible toilet</option>
                    <option>Lift</option><option>Parking</option><option>Door</option><option>Other</option>
                  </select>
                </label>
                <label>Your name <small>(optional)</small>
                  <input value={form.contributor} maxLength={60} onChange={(e) => setForm({ ...form, contributor: e.target.value })} placeholder="Community member" />
                </label>
              </div>
              <label>Exact location or level
                <input required maxLength={140} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. East side, Level 2 beside the lift" />
              </label>
              <label>Detailed accessibility information
                <textarea required maxLength={800} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Include measurements, the side of the building, door type, condition or another practical detail." rows={5} />
              </label>
              <div className="form-guidance">
                <span aria-hidden="true">✓</span>
                <p>Your report is stored as <b>unverified</b> until reviewed. Do not include private or sensitive information.</p>
              </div>
              {submitState === "error" && <p className="form-error">The information could not be saved. Please check the fields and try again.</p>}
              {submitState === "success" && <p className="form-success">Thank you — your information has been saved for review.</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setContributionOpen(false)}>Cancel</button>
                <button className="primary-action" disabled={submitState === "saving"}>{submitState === "saving" ? "Saving…" : "Submit information"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function SurveyedSections({ profile }: { profile: SurveyedProfile }) {
  return (
    <>
      <section className="access-highlight">
        <span aria-hidden="true">↗</span>
        <div>
          <small>ACCESSIBLE ENTRANCE</small>
          <b>{profile.entrance.side}</b>
          <p>{profile.entrance.level} · {profile.entrance.door}</p>
        </div>
      </section>

      {profile.ramp && (
        <section className="profile-section">
          <h3><span aria-hidden="true">♿</span> Ramp details</h3>
          <div className="data-grid">
            <Data label="Ramp side" value={profile.ramp.side} wide />
            <Data label="Vertical rise" value={profile.ramp.rise} />
            <Data label="Ramp length" value={profile.ramp.length} />
            <Data label="Clear width" value={profile.ramp.width} />
            <Data label="Gradient" value={profile.ramp.slope} />
            <Data label="Surface" value={profile.ramp.surface} />
            <Data label="Handrails" value={profile.ramp.handrails} wide />
          </div>
        </section>
      )}

      <section className="amenity-list">
        <Amenity icon="WC" title="Accessible toilet" primary={profile.toilet.level} secondary={`${profile.toilet.location}. ${profile.toilet.features}`} />
        {profile.lift && <Amenity icon="↕" title="Accessible lift" primary={profile.lift.serves} secondary={`${profile.lift.location}. ${profile.lift.details}`} />}
        <Amenity icon="P" title="Accessible parking" primary={profile.parking.spaces} secondary={`${profile.parking.location} · ${profile.parking.distance}`} />
      </section>

      <section className="extras">
        <h3>Other accessibility information</h3>
        {profile.extras.map((item) => <span key={item}>✓ {item}</span>)}
      </section>

      <p className="safety-note">Surveyed {profile.surveyedOn}. Prototype sample data.</p>
    </>
  );
}

/** What OpenStreetMap knows — and, when it knows nothing, an honest empty state. */
function OsmSections({ building, onContribute, reportCount }: { building: MapBuilding; onContribute: () => void; reportCount: number }) {
  const hasAnything = building.knownFacts > 0;

  if (!hasAnything) {
    return (
      <section className="empty-profile">
        <span aria-hidden="true">?</span>
        <h3>No accessibility information yet</h3>
        <p>
          Nobody has recorded how to get into <b>{displayName(building)}</b>. OpenStreetMap has its footprint
          {building.address ? ` and address (${building.address})` : ""}, but nothing about entrances, ramps, toilets or lifts.
        </p>
        <p className="gap-note">
          This is exactly the gap AccessRamp exists to close. {reportCount > 0 ? `${reportCount} community report${reportCount > 1 ? "s" : ""} already added.` : "Be the first to add a detail."}
        </p>
        <button type="button" className="primary-action full" onClick={onContribute}>＋ Add the first detail</button>
      </section>
    );
  }

  const toilets = building.amenities.filter((amenity) => amenity.type === "toilets");
  const lifts = building.amenities.filter((amenity) => amenity.type === "elevator");
  const parking = building.amenities.filter((amenity) => amenity.type === "parking");

  return (
    <>
      <section className="access-highlight">
        <span aria-hidden="true">↗</span>
        <div>
          <small>WHEELCHAIR ACCESS</small>
          <b>{accessWord(building.wheelchair)}</b>
          <p>{building.wheelchairNote ?? "Recorded by OpenStreetMap contributors."}</p>
        </div>
      </section>

      {building.entrances.length > 0 && (
        <section className="profile-section">
          <h3><span aria-hidden="true">↗</span> Entrances ({building.entrances.length})</h3>
          <div className="data-grid">
            {building.entrances.map((entrance, index) => (
              <Data
                key={`${entrance.point[0]}-${entrance.point[1]}-${index}`}
                label={`${entrance.kind === "main" ? "Main entrance" : "Entrance"} — ${entrance.side} side`}
                value={[
                  `Step-free: ${accessWord(entrance.wheelchair)}`,
                  entrance.automatic ? "Automatic door" : entrance.door ? `${entrance.door} door` : null,
                  entrance.width ? `${entrance.width} m wide` : null,
                ].filter(Boolean).join(" · ")}
                wide
              />
            ))}
          </div>
          <p className="safety-note">Entrance sides are calculated from the mapped position on the building outline.</p>
        </section>
      )}

      <section className="amenity-list">
        {building.toiletsWheelchair !== "unknown" && (
          <Amenity icon="WC" title="Accessible toilet" primary={accessWord(building.toiletsWheelchair)} secondary="Tagged on the building in OpenStreetMap. Level and room are not recorded." />
        )}
        {toilets.map((toilet) => (
          <Amenity key={toilet.id} icon="WC" title="Toilets" primary={`Step-free: ${accessWord(toilet.wheelchair)}`} secondary={[toilet.level ? `Level ${toilet.level}` : null, toilet.detail].filter(Boolean).join(" · ") || "No further detail mapped."} />
        ))}
        {lifts.map((lift) => (
          <Amenity key={lift.id} icon="↕" title="Lift" primary={`Step-free: ${accessWord(lift.wheelchair)}`} secondary={lift.detail ?? "Mapped inside this building."} />
        ))}
        {parking.map((bay) => (
          <Amenity key={bay.id} icon="P" title="Parking" primary={bay.detail ?? "Accessible bays not recorded"} secondary={bay.name ?? "Mapped within the building footprint."} />
        ))}
      </section>

      {(building.openingHours || building.website || building.phone) && (
        <section className="extras">
          <h3>Contact and hours</h3>
          {building.openingHours && <span>✓ {building.openingHours}</span>}
          {building.phone && <span>✓ {building.phone}</span>}
          {building.website && <span>✓ {building.website}</span>}
        </section>
      )}

      <section className="gap-prompt">
        <p>Missing the detail you need — ramp gradient, toilet level, parking bay location?</p>
        <button type="button" className="primary-action full" onClick={onContribute}>＋ Add what you know</button>
      </section>
    </>
  );
}

function Data({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "data-item wide" : "data-item"}><small>{label}</small><b>{value}</b></div>;
}

function Amenity({ icon, title, primary, secondary }: { icon: string; title: string; primary: string; secondary: string }) {
  return <article><span aria-hidden="true">{icon}</span><div><small>{title}</small><b>{primary}</b><p>{secondary}</p></div></article>;
}
