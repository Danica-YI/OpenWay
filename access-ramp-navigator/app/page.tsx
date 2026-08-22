"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polygon, Polyline } from "leaflet";

type RoutePoint = [number, number];
type Filter = "All" | "Ramp" | "Toilet" | "Lift" | "Parking";
type Tab = "details" | "route" | "community";

type Building = {
  id: string;
  name: string;
  code: string;
  lat: number;
  lng: number;
  polygon: RoutePoint[];
  summary: string;
  features: Filter[];
  distance: string;
  duration: string;
  verified: string;
  entrance: { side: string; level: string; door: string; hours: string };
  ramp: { side: string; rise: string; length: string; width: string; slope: string; surface: string; handrails: string };
  toilet: { level: string; location: string; features: string };
  lift: { location: string; serves: string; details: string };
  parking: { spaces: string; location: string; distance: string };
  extras: string[];
  steps: string[];
  route: RoutePoint[];
};

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

const DEMO_START: RoutePoint = [-27.47643, 153.02784];

const BUILDINGS: Building[] = [
  {
    id: "library", name: "Campus Library", code: "LIB", lat: -27.47718, lng: 153.02812,
    polygon: [[-27.47704,153.02795],[-27.47704,153.02831],[-27.47735,153.02831],[-27.47735,153.02795]],
    summary: "Step-free west entrance with ramp access to the ground-floor lobby.",
    features: ["Ramp","Toilet","Lift","Parking"], distance: "145 m", duration: "3 min", verified: "18 August 2026",
    entrance: { side: "West side, facing the garden", level: "Ground floor", door: "Automatic double door, 1.6 m clear width", hours: "6:00 am–10:00 pm" },
    ramp: { side: "West garden side", rise: "0.85 m vertical rise", length: "12 m", width: "1.5 m clear width", slope: "1:14", surface: "Non-slip concrete", handrails: "Both sides, with a midway landing" },
    toilet: { level: "Level 2", location: "Room L2-24, opposite the central lift", features: "Right-hand transfer, adult change table and emergency call button" },
    lift: { location: "Central atrium, 18 m from the west entrance", serves: "Ground–Level 6", details: "1.1 m door, tactile controls and audible announcements" },
    parking: { spaces: "2 accessible bays", location: "West service road", distance: "65 m from the ramp" },
    extras: ["Hearing loop at help desk", "Low-height service counter", "Assistance animals welcome"],
    steps: ["Follow the western walkway south", "Turn left at the garden crossing", "The ramp begins on your right"],
    route: [[-27.47643,153.02784],[-27.47662,153.02775],[-27.47688,153.02775],[-27.47702,153.02786],[-27.47711,153.02798],[-27.47718,153.02812]],
  },
  {
    id: "student-centre", name: "Student Centre", code: "STU", lat: -27.47772, lng: 153.02869,
    polygon: [[-27.47754,153.02843],[-27.47753,153.02888],[-27.47789,153.02889],[-27.47790,153.02844]],
    summary: "Level Main Drive entrance with automatic doors and direct lobby access.",
    features: ["Toilet","Lift","Parking"], distance: "285 m", duration: "5 min", verified: "20 August 2026",
    entrance: { side: "East side, Main Drive", level: "Ground floor", door: "Automatic sliding doors, 1.8 m opening", hours: "Open 24 hours" },
    ramp: { side: "No ramp required at Main Drive", rise: "Level threshold", length: "Not applicable", width: "2.1 m approach", slope: "1:50 drainage fall", surface: "Paved", handrails: "Not required" },
    toilet: { level: "Ground floor", location: "Beside reception, Room G-08", features: "Left-hand transfer, changing bench and emergency alarm" },
    lift: { location: "Behind reception", serves: "Ground–Level 4", details: "Wide car with rear mirror and braille controls" },
    parking: { spaces: "3 accessible bays", location: "Main Drive short-stay area", distance: "40 m from entrance" },
    extras: ["Quiet waiting room", "Hearing loop at reception", "Wheelchair-height water fountain"],
    steps: ["Follow the western walkway south", "Use the raised Main Walk crossing", "Continue east to the automatic entrance"],
    route: [[-27.47643,153.02784],[-27.47662,153.02775],[-27.47688,153.02775],[-27.47718,153.02778],[-27.47743,153.02791],[-27.47757,153.02814],[-27.47762,153.02843],[-27.47772,153.02869]],
  },
  {
    id: "innovation", name: "Innovation Centre", code: "INC", lat: -27.47834, lng: 153.02755,
    polygon: [[-27.47813,153.02737],[-27.47812,153.02775],[-27.47854,153.02776],[-27.47855,153.02736]],
    summary: "Covered riverside ramp with rest landing and weather-protected entrance.",
    features: ["Ramp","Toilet","Lift"], distance: "360 m", duration: "6 min", verified: "16 August 2026",
    entrance: { side: "West side, facing the river", level: "Ground floor", door: "Power-assisted door with low push button", hours: "7:00 am–8:00 pm" },
    ramp: { side: "Riverside western façade", rise: "1.1 m vertical rise", length: "17.6 m", width: "1.6 m clear width", slope: "1:16", surface: "Covered textured concrete", handrails: "Both sides with 1.5 m rest landing" },
    toilet: { level: "Level 1", location: "Room 1-12, near the southern lift", features: "Right-hand transfer and emergency call cord" },
    lift: { location: "South lobby", serves: "Ground–Level 3", details: "Tactile controls, audible announcements and fold-down seat" },
    parking: { spaces: "No dedicated bay at building", location: "Use Campus Library west bays", distance: "210 m via level path" },
    extras: ["Covered arrival area", "Height-adjustable desks in Lab 2", "Assistance phone at entrance"],
    steps: ["Take the western walkway toward the river", "Keep right around the courtyard", "Join the covered ramp beside the blue sign"],
    route: [[-27.47643,153.02784],[-27.47662,153.02775],[-27.47695,153.02773],[-27.47726,153.02771],[-27.47757,153.02770],[-27.47786,153.02769],[-27.47810,153.02762],[-27.47834,153.02755]],
  },
  {
    id: "science", name: "Science Building", code: "SCI", lat: -27.47672, lng: 153.02883,
    polygon: [[-27.47652,153.02860],[-27.47651,153.02902],[-27.47688,153.02904],[-27.47689,153.02862]],
    summary: "North courtyard entrance with level access to an all-floor accessible lift.",
    features: ["Toilet","Lift","Parking"], distance: "220 m", duration: "4 min", verified: "19 August 2026",
    entrance: { side: "North side, inside courtyard", level: "Ground floor", door: "Automatic door, 1.4 m clear opening", hours: "7:00 am–9:00 pm" },
    ramp: { side: "No ramp required at north courtyard", rise: "Level threshold", length: "Not applicable", width: "1.8 m approach", slope: "Level", surface: "Smooth paving", handrails: "Not required" },
    toilet: { level: "Levels 1 and 3", location: "Rooms 1-05 and 3-09, beside the lift core", features: "Alternating left/right transfer layouts" },
    lift: { location: "North lobby, 12 m inside entrance", serves: "Ground–Level 5", details: "1.2 m door, audible announcements and tactile buttons" },
    parking: { spaces: "1 accessible bay", location: "North service court", distance: "55 m from courtyard entrance" },
    extras: ["Lowered laboratory bench on Level 2", "Visual fire alarms", "Quiet room on Level 1"],
    steps: ["Take the northern level path east", "Turn right into the science courtyard", "Use the automatic door; the lift is on the right"],
    route: [[-27.47643,153.02784],[-27.47636,153.02805],[-27.47637,153.02832],[-27.47643,153.02857],[-27.47657,153.02874],[-27.47672,153.02883]],
  },
  {
    id: "theatre", name: "Campus Theatre", code: "THR", lat: -27.47872, lng: 153.02895,
    polygon: [[-27.47850,153.02869],[-27.47848,153.02916],[-27.47891,153.02918],[-27.47893,153.02872]],
    summary: "Garden-side ramp to the foyer, accessible ticket desk and wheelchair seating.",
    features: ["Ramp","Toilet","Parking"], distance: "520 m", duration: "8 min", verified: "15 August 2026",
    entrance: { side: "North-east garden side", level: "Foyer level", door: "Power-assisted single door, 1.05 m clear width", hours: "Open during events" },
    ramp: { side: "Garden side, right of the main steps", rise: "1.25 m vertical rise", length: "17.5 m", width: "1.5 m clear width", slope: "1:14", surface: "Broom-finished concrete", handrails: "Both sides with top and bottom landings" },
    toilet: { level: "Foyer level", location: "Behind the accessible ticket desk", features: "Left-hand transfer and emergency call button" },
    lift: { location: "No public lift required", serves: "All public areas on foyer level", details: "Backstage lift available with staff assistance" },
    parking: { spaces: "4 accessible bays", location: "Theatre eastern car park", distance: "75 m via garden path" },
    extras: ["Removable wheelchair seating", "Infrared hearing assistance", "Companion seating beside wheelchair spaces"],
    steps: ["Follow the western walkway to Main Walk", "Turn left around the building edge", "Continue beside the garden to the theatre ramp"],
    route: [[-27.47643,153.02784],[-27.47665,153.02775],[-27.47702,153.02775],[-27.47736,153.02784],[-27.47757,153.02812],[-27.47765,153.02845],[-27.47782,153.02872],[-27.47815,153.02877],[-27.47845,153.02882],[-27.47872,153.02895]],
  },
];

const buildingMarker = (building: Building, selected: boolean) =>
  `<div class="building-pin${selected ? " selected" : ""}"><span>${building.code}</span><b>♿</b></div>`;

export default function Home() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<LeafletMap | null>(null);
  const markers = useRef<Map<string, Marker>>(new Map());
  const polygons = useRef<Map<string, Polygon>>(new Map());
  const routeLine = useRef<Polyline | null>(null);
  const routeHalo = useRef<Polyline | null>(null);
  const userMarker = useRef<Marker | null>(null);
  const [selectedId, setSelectedId] = useState("library");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [detailOpen, setDetailOpen] = useState(true);
  const [routeVisible, setRouteVisible] = useState(false);
  const [location, setLocation] = useState<RoutePoint>(DEMO_START);
  const [locationMessage, setLocationMessage] = useState("Demo starting point");
  const [contributionOpen, setContributionOpen] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loadingContributions, setLoadingContributions] = useState(false);
  const [submitState, setSubmitState] = useState<"idle"|"saving"|"success"|"error">("idle");
  const [form, setForm] = useState({ buildingId: "library", category: "Ramp", location: "", details: "", contributor: "" });

  const selected = BUILDINGS.find((building) => building.id === selectedId) ?? BUILDINGS[0];
  const filteredBuildings = useMemo(() => {
    const search = query.trim().toLowerCase();
    return BUILDINGS.filter((building) =>
      (filter === "All" || building.features.includes(filter)) &&
      (!search || `${building.name} ${building.summary} ${building.features.join(" ")}`.toLowerCase().includes(search))
    );
  }, [filter, query]);

  function chooseBuilding(building: Building, tab: Tab = "details") {
    setSelectedId(building.id);
    setActiveTab(tab);
    setDetailOpen(true);
    setRouteVisible(tab === "route");
  }

  useEffect(() => {
    let active = true;
    async function createMap() {
      if (!mapElement.current || mapInstance.current) return;
      const L = await import("leaflet");
      if (!active || !mapElement.current) return;
      const map = L.map(mapElement.current, { zoomControl: false }).setView([-27.47755, 153.02825], 17);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);

      BUILDINGS.forEach((building) => {
        const polygon = L.polygon(building.polygon, { color: "#087f73", weight: 2, fillColor: "#20a695", fillOpacity: .12 })
          .addTo(map).bindTooltip(`${building.name} · click for accessibility details`, { sticky: true })
          .on("click", () => chooseBuilding(building));
        polygons.current.set(building.id, polygon);
        const marker = L.marker([building.lat, building.lng], {
          icon: L.divIcon({ className: "custom-marker", html: buildingMarker(building, building.id === selectedId), iconSize: [54, 58], iconAnchor: [27, 52] }),
          title: `${building.name} accessibility profile`,
        }).addTo(map).on("click", () => chooseBuilding(building));
        markers.current.set(building.id, marker);
      });

      const userIcon = L.divIcon({ className: "custom-marker", html: '<div class="user-pin"><span></span></div>', iconSize: [34,34], iconAnchor: [17,17] });
      userMarker.current = L.marker(DEMO_START, { icon: userIcon, title: "Your starting point" }).addTo(map);
      mapInstance.current = map;
    }
    createMap();
    return () => { active = false; mapInstance.current?.remove(); mapInstance.current = null; markers.current.clear(); polygons.current.clear(); };
  }, []);

  useEffect(() => {
    async function updateSelection() {
      const L = await import("leaflet");
      BUILDINGS.forEach((building) => {
        markers.current.get(building.id)?.setIcon(L.divIcon({
          className: "custom-marker", html: buildingMarker(building, building.id === selectedId), iconSize: [54,58], iconAnchor: [27,52],
        }));
        polygons.current.get(building.id)?.setStyle(building.id === selectedId
          ? { color: "#075f58", weight: 4, fillColor: "#20a695", fillOpacity: .24 }
          : { color: "#087f73", weight: 2, fillColor: "#20a695", fillOpacity: .12 });
      });
      mapInstance.current?.flyTo([selected.lat, selected.lng], 18, { duration: .65 });
    }
    if (mapInstance.current) updateSelection();
  }, [selected, selectedId]);

  useEffect(() => {
    async function updateRoute() {
      if (!mapInstance.current) return;
      const L = await import("leaflet");
      routeLine.current?.remove(); routeLine.current = null;
      routeHalo.current?.remove(); routeHalo.current = null;
      if (!routeVisible) return;
      const points = selected.route.map((point, index) => index === 0 ? location : point);
      routeHalo.current = L.polyline(points, { color:"#fff", weight:11, opacity:.94, lineCap:"round", lineJoin:"round" }).addTo(mapInstance.current);
      routeLine.current = L.polyline(points, { color:"#087f73", weight:6, opacity:1, lineCap:"round", lineJoin:"round" }).addTo(mapInstance.current);
      mapInstance.current.fitBounds(routeLine.current.getBounds(), { padding:[70,70], maxZoom:18 });
    }
    updateRoute();
  }, [location, routeVisible, selected]);

  useEffect(() => {
    let ignore = false;
    async function loadContributions() {
      setLoadingContributions(true);
      try {
        const response = await fetch(`/api/contributions?buildingId=${encodeURIComponent(selectedId)}`);
        const payload = await response.json() as { contributions?: Contribution[] };
        if (!ignore) setContributions(payload.contributions ?? []);
      } catch {
        if (!ignore) setContributions([]);
      } finally {
        if (!ignore) setLoadingContributions(false);
      }
    }
    loadContributions();
    return () => { ignore = true; };
  }, [selectedId]);

  function openContribution(buildingId = selectedId) {
    setForm({ buildingId, category:"Ramp", location:"", details:"", contributor:"" });
    setSubmitState("idle");
    setContributionOpen(true);
  }

  async function submitContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState("saving");
    try {
      const response = await fetch("/api/contributions", {
        method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(form),
      });
      const payload = await response.json() as { contribution?: Contribution; error?: string };
      if (!response.ok || !payload.contribution) throw new Error(payload.error ?? "Submission failed");
      setSubmitState("success");
      setSelectedId(form.buildingId);
      setContributions((items) => [payload.contribution!, ...items]);
      setActiveTab("community");
      setDetailOpen(true);
      window.setTimeout(() => setContributionOpen(false), 900);
    } catch {
      setSubmitState("error");
    }
  }

  function locateUser() {
    if (!navigator.geolocation) { setLocationMessage("Location unavailable — using demo start"); return; }
    setLocationMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const nearDemo = Math.abs(coords.latitude - DEMO_START[0]) < .003 && Math.abs(coords.longitude - DEMO_START[1]) < .003;
      const next: RoutePoint = nearDemo ? [coords.latitude, coords.longitude] : DEMO_START;
      setLocation(next);
      setLocationMessage(nearDemo ? "Current location" : "Outside demo area — using demo start");
      const L = await import("leaflet");
      userMarker.current?.setLatLng(next).setIcon(L.divIcon({ className:"custom-marker", html:'<div class="user-pin"><span></span></div>', iconSize:[34,34], iconAnchor:[17,17] }));
      mapInstance.current?.flyTo(next, 18, { duration:.65 });
    }, () => setLocationMessage("Permission not granted — using demo start"), { enableHighAccuracy:true, timeout:8000 });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AccessRamp home"><span className="brand-mark">♿</span><span>Access<span>Ramp</span></span></a>
        <div className="header-status"><span className="status-dot" /> Detailed accessibility directory</div>
        <button className="report-button" type="button" onClick={() => openContribution()}><span>＋</span> Contribute accessibility info</button>
      </header>

      <section className="workspace" id="top">
        <aside className="sidebar" aria-label="Buildings">
          <div className="sidebar-heading">
            <p className="eyebrow">KNOW BEFORE YOU ARRIVE</p>
            <h1>Every access detail, in one place.</h1>
            <p>Choose a building to find its exact accessible entrance, ramp measurements, toilets, lifts and parking.</p>
          </div>
          <label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search building or accessibility feature" aria-label="Search buildings" />{query && <button type="button" onClick={() => setQuery("")}>×</button>}</label>
          <div className="filter-row">{(["All","Ramp","Toilet","Lift","Parking"] as Filter[]).map((item) => <button type="button" key={item} className={filter === item ? "filter active" : "filter"} onClick={() => setFilter(item)}>{item === "All" ? "All buildings" : item}</button>)}</div>
          <div className="results-meta"><strong>{filteredBuildings.length} buildings</strong><span>Verified profiles</span></div>
          <div className="location-list">
            {filteredBuildings.map((building) => (
              <button type="button" key={building.id} className={selectedId === building.id ? "location-card selected" : "location-card"} onClick={() => chooseBuilding(building)} aria-pressed={selectedId === building.id}>
                <span className="location-icon">{building.code}</span>
                <span className="location-copy"><strong>{building.name}</strong><span>{building.summary}</span><span className="feature-chips">{building.features.map((feature) => <i key={feature}>{feature}</i>)}</span></span>
                <span className="distance">{building.distance}<i>›</i></span>
              </button>
            ))}
            {!filteredBuildings.length && <div className="empty-state"><span>⌕</span><strong>No matching buildings</strong><p>Try another feature or search term.</p></div>}
          </div>
        </aside>

        <section className="map-panel" aria-label="Interactive building accessibility map">
          <div ref={mapElement} className="map" />
          <div className="map-top-controls">
            <button className="locate-button" type="button" onClick={locateUser}><span>◎</span><span><b>Use my location</b><small>{locationMessage}</small></span></button>
            <div className="map-key"><span className="key-building">BLD</span> Click a building <span className="key-user" /> You</div>
          </div>

          {detailOpen && <article className="building-drawer" aria-live="polite">
            <div className="drawer-header">
              <div><span className="detail-type">BUILDING ACCESS PROFILE</span><h2>{selected.name}</h2><p>{selected.summary}</p></div>
              <button className="close-detail" type="button" aria-label="Close building details" onClick={() => { setDetailOpen(false); setRouteVisible(false); }}>×</button>
            </div>
            <div className="profile-meta"><span><i>✓</i> Verified {selected.verified}</span><span>{selected.distance} from start</span></div>
            <div className="tabs" role="tablist">
              <button className={activeTab === "details" ? "active" : ""} onClick={() => { setActiveTab("details"); setRouteVisible(false); }}>Accessibility</button>
              <button className={activeTab === "route" ? "active" : ""} onClick={() => { setActiveTab("route"); setRouteVisible(true); }}>Route</button>
              <button className={activeTab === "community" ? "active" : ""} onClick={() => { setActiveTab("community"); setRouteVisible(false); }}>Community</button>
            </div>

            <div className="drawer-content">
              {activeTab === "details" && <>
                <section className="access-highlight"><span>↗</span><div><small>ACCESSIBLE ENTRANCE</small><b>{selected.entrance.side}</b><p>{selected.entrance.level} · {selected.entrance.door}</p></div></section>
                <section className="profile-section"><h3><span>♿</span> Ramp details</h3><div className="data-grid">
                  <Data label="Ramp side" value={selected.ramp.side} wide />
                  <Data label="Vertical rise" value={selected.ramp.rise} />
                  <Data label="Ramp length" value={selected.ramp.length} />
                  <Data label="Clear width" value={selected.ramp.width} />
                  <Data label="Gradient" value={selected.ramp.slope} />
                  <Data label="Surface" value={selected.ramp.surface} />
                  <Data label="Handrails" value={selected.ramp.handrails} wide />
                </div></section>
                <section className="amenity-list">
                  <Amenity icon="WC" title="Accessible toilet" primary={selected.toilet.level} secondary={`${selected.toilet.location}. ${selected.toilet.features}`} />
                  <Amenity icon="↕" title="Accessible lift" primary={selected.lift.serves} secondary={`${selected.lift.location}. ${selected.lift.details}`} />
                  <Amenity icon="P" title="Accessible parking" primary={selected.parking.spaces} secondary={`${selected.parking.location} · ${selected.parking.distance}`} />
                </section>
                <section className="extras"><h3>Other accessibility information</h3>{selected.extras.map((item) => <span key={item}>✓ {item}</span>)}</section>
              </>}

              {activeTab === "route" && <section className="route-panel">
                <div className="route-summary"><span>♿</span><div><b>{selected.distance} · About {selected.duration}</b><small>Step-free path to {selected.entrance.side.toLowerCase()}</small></div></div>
                <ol>{selected.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
                <button type="button" className="primary-action full" onClick={() => setRouteVisible(true)}>Show route on map <span>→</span></button>
                <p className="safety-note">Demo route only. Check temporary closures and verify conditions before travel.</p>
              </section>}

              {activeTab === "community" && <section className="community-panel">
                <div className="community-intro"><div><h3>Help complete this profile</h3><p>Share a missing measurement, exact location or recent access change.</p></div><button type="button" onClick={() => openContribution(selected.id)}>＋ Add information</button></div>
                <div className="community-warning">Community reports are unverified and shown separately from verified building information.</div>
                {loadingContributions ? <p className="loading">Loading community reports…</p> : contributions.length ? <div className="contribution-list">{contributions.map((item) => <article key={item.id}><div><b>{item.category}</b><span>Unverified</span></div><strong>{item.location}</strong><p>{item.details}</p><small>Shared by {item.contributor} · {new Date(item.createdAt).toLocaleDateString()}</small></article>)}</div> : <div className="no-contributions"><span>＋</span><b>No community reports yet</b><p>Be the first to add a useful access detail.</p></div>}
              </section>}
            </div>
          </article>}
          <div className="prototype-note"><b>Prototype:</b> verified details are sample data. Community reports are unverified.</div>
        </section>
      </section>

      {contributionOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setContributionOpen(false); }}>
        <section className="contribution-modal" role="dialog" aria-modal="true" aria-labelledby="contribution-title">
          <div className="modal-header"><div><span className="detail-type">COMMUNITY CONTRIBUTION</span><h2 id="contribution-title">Add an accessibility detail</h2><p>Precise, practical information can save someone an unnecessary trip around a building.</p></div><button className="close-detail" onClick={() => setContributionOpen(false)} aria-label="Close contribution form">×</button></div>
          <form onSubmit={submitContribution}>
            <label>Building<select value={form.buildingId} onChange={(e) => setForm({...form,buildingId:e.target.value})}>{BUILDINGS.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>
            <div className="form-row">
              <label>Accessibility feature<select value={form.category} onChange={(e) => setForm({...form,category:e.target.value})}><option>Ramp</option><option>Accessible entrance</option><option>Accessible toilet</option><option>Lift</option><option>Parking</option><option>Door</option><option>Other</option></select></label>
              <label>Your name <small>(optional)</small><input value={form.contributor} maxLength={60} onChange={(e) => setForm({...form,contributor:e.target.value})} placeholder="Community member" /></label>
            </div>
            <label>Exact location or level<input required maxLength={140} value={form.location} onChange={(e) => setForm({...form,location:e.target.value})} placeholder="e.g. East side, Level 2 beside lift" /></label>
            <label>Detailed accessibility information<textarea required maxLength={800} value={form.details} onChange={(e) => setForm({...form,details:e.target.value})} placeholder="Include measurements, direction faced, door type, condition or another practical detail." rows={5} /></label>
            <div className="form-guidance"><span>✓</span><p>Your report will be stored as <b>unverified</b> until it is reviewed. Do not include private or sensitive information.</p></div>
            {submitState === "error" && <p className="form-error">The information could not be saved. Please check the fields and try again.</p>}
            {submitState === "success" && <p className="form-success">Thank you — your information has been saved for review.</p>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setContributionOpen(false)}>Cancel</button><button className="primary-action" disabled={submitState === "saving"}>{submitState === "saving" ? "Saving…" : "Submit information"}</button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}

function Data({ label, value, wide = false }: { label:string; value:string; wide?:boolean }) {
  return <div className={wide ? "data-item wide" : "data-item"}><small>{label}</small><b>{value}</b></div>;
}

function Amenity({ icon, title, primary, secondary }: { icon:string; title:string; primary:string; secondary:string }) {
  return <article><span>{icon}</span><div><small>{title}</small><b>{primary}</b><p>{secondary}</p></div></article>;
}
