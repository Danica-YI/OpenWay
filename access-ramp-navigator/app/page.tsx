"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Circle, LeafletMouseEvent, LayerGroup, Map as LeafletMap, Marker, Polygon, Polyline } from "leaflet";
import { parseCompassWord, pointOnSide, type AccessLevel, type BBox, type LatLng, type MapBuilding, type OsmEntrance } from "../lib/osm";
import { CURATED, type SurveyedProfile } from "../lib/curated";
import { FACILITIES, facilityFor, facilityGlyphMarkup, type Facility } from "../lib/facilities";
import { REPORT_REASONS } from "../lib/moderation";
import type { WalkingRoute } from "../lib/routing";

/** The same glyph the map pins use, for lists and the contribution form. */
function FacilityIcon({ facility, size = 16 }: { facility: Facility; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {facility.paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

function draftPinHtml(facility: Facility): string {
  return `<div class="draft-access-pin" style="--pin:${facility.colour}"><span>${facilityGlyphMarkup(facility, 22)}</span></div>`;
}

function accessPointHtml(facility: Facility): string {
  return `<div class="access-point-pin" style="--pin:${facility.colour}"><span>${facilityGlyphMarkup(facility, 16)}</span></div>`;
}

type Filter = "All" | "Surveyed" | "Step-free" | "Toilet" | "Needs info";
type Tab = "details" | "route" | "community";

/** How complete a building's accessibility picture is. Drives the map colours. */
type InfoStatus = "surveyed" | "mapped" | "reported" | "unknown";

type Account = { id: number; email: string; displayName: string; publicName: string };

type MyContribution = {
  id: number;
  buildingId: string;
  buildingName: string | null;
  category: string;
  location: string;
  details: string;
  status: string;
  anonymous: boolean;
  photoUrl: string | null;
  createdAt: string;
  reportCount?: number;
};

type Contribution = {
  id: number;
  buildingId: string;
  category: string;
  location: string;
  details: string;
  contributor: string;
  latitude: number | null;
  longitude: number | null;
  photoUrl: string | null;
  photoLatitude: number | null;
  photoLongitude: number | null;
  photoAccuracy: number | null;
  photoCapturedAt: string | null;
  status: string;
  createdAt: string;
  mine?: boolean;
  reportCount?: number;
};

type CapturedPhoto = {
  blob: Blob;
  previewUrl: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

// --- Demo venue ----------------------------------------------------------
// Where the map opens, and the stand-in "you are here" pin used until the
// visitor grants location permission. Change these two to move the demo.
//   QUT Gardens Point: centre [-27.47700, 153.02810], start [-27.47643, 153.02784]
const DEFAULT_CENTER: LatLng = [-27.45270, 153.03800]; // TechnologyOne HQ, 540 Wickham St
const DEMO_START: LatLng = [-27.45380, 153.03900]; // Wickham St, ~180 m south-east of HQ
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

function formatWalkingDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
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
 * Say how good the fix is rather than just claiming "current location". A
 * browser's first fix often comes from wifi and can be hundreds of metres out,
 * which is exactly the case where a confident label misleads.
 */
function describeFix(accuracy: number): string {
  if (!Number.isFinite(accuracy)) return "Current location";
  const metres = Math.round(accuracy);
  return accuracy > 100 ? `Approximate location · ±${metres} m` : `Current location · ±${metres} m`;
}

function describeLocationError(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return "Permission not granted — using demo start";
  if (error.code === error.TIMEOUT) return "Still looking — using demo start";
  return "Location unavailable — using demo start";
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location is unavailable on this device."));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });
}

/** Canvas capture creates a fresh JPEG with no EXIF/device metadata. */
async function captureCameraFrame(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) throw new Error("The camera is not ready yet.");
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot capture the camera frame.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("This browser cannot capture the camera frame.");
  return blob;
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

/**
 * The same problem in the other axis: on narrow viewports the drawer is a
 * full-width sheet pinned to the bottom of the screen, so map framing that
 * ignores it drops the selected building behind the sheet. Returns the sheet's
 * height in px when it is laid out that way, else 0.
 */
function drawerBottomHeight(map: LeafletMap): number {
  const drawerEl = document.querySelector(".building-drawer");
  if (!drawerEl) return 0;
  const mapRect = map.getContainer().getBoundingClientRect();
  const drawerRect = drawerEl.getBoundingClientRect();
  const isBottomSheet = drawerRect.width >= mapRect.width * 0.7;
  return isBottomSheet ? Math.min(drawerRect.height, mapRect.height) : 0;
}

/**
 * Where the bottom sheet's top edge falls inside the map container, or null on
 * layouts where the drawer sits beside the map instead of over it.
 */
function sheetTopWithinMap(map: LeafletMap): number | null {
  const drawerEl = document.querySelector(".building-drawer");
  if (!drawerEl) return null;
  const mapRect = map.getContainer().getBoundingClientRect();
  const drawerRect = drawerEl.getBoundingClientRect();
  if (drawerRect.width < mapRect.width * 0.7) return null;
  return drawerRect.top - mapRect.top;
}

export default function Home() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<LeafletMap | null>(null);
  const shapeLayer = useRef<LayerGroup | null>(null);
  const accessPointLayer = useRef<LayerGroup | null>(null);
  const shapes = useRef<Map<string, Polygon>>(new Map());
  const routeLine = useRef<Polyline | null>(null);
  const routeHalo = useRef<Polyline | null>(null);
  const userMarker = useRef<Marker | null>(null);
  const userAccuracyCircle = useRef<Circle | null>(null);
  /** Centre on the visitor once, not on every fix the watch delivers. */
  const hasCentredOnUser = useRef(false);
  /** They took the map somewhere themselves; do not yank it back. */
  const userMovedMap = useRef(false);
  const draftPinMarker = useRef<Marker | null>(null);
  const categoryRef = useRef("Ramp");
  const entranceMarker = useRef<Marker | null>(null);
  const requestCache = useRef<Map<string, MapBuilding[]>>(new Map());
  const loadedBBox = useRef<BBox | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

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
  const [walkingRoute, setWalkingRoute] = useState<WalkingRoute | null>(null);
  const [location, setLocation] = useState<LatLng>(DEMO_START);
  const [locationMessage, setLocationMessage] = useState("Demo starting point");
  /** Null until a real fix arrives — the demo start is not a measurement. */
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "register">("signin");
  const [authForm, setAuthForm] = useState({ email: "", displayName: "", password: "" });
  const [authState, setAuthState] = useState<"idle" | "saving">("idle");
  const [authError, setAuthError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [myContributions, setMyContributions] = useState<MyContribution[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [toast, setToast] = useState("");
  const [contributionOpen, setContributionOpen] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loadingContributions, setLoadingContributions] = useState(false);
  // Everyone signed in can moderate for the demo; the server decides, not us.
  const [canModerate, setCanModerate] = useState(false);
  const [reportingId, setReportingId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportNote, setReportNote] = useState("");
  const [reportState, setReportState] = useState<"idle" | "saving">("idle");
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [moderationError, setModerationError] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [formError, setFormError] = useState("");
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [photoState, setPhotoState] = useState<"idle" | "processing">("idle");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [form, setForm] = useState({
    category: "Ramp",
    location: "",
    details: "",
    anonymous: false,
    latitude: null as number | null,
    longitude: null as number | null,
  });

  // Derived, not stored: the viewport already tells us whether we are too far out.
  const needsZoom = viewport !== null && viewport.zoom < MIN_ZOOM;
  // The map-creation effect calls syncViewport(), so a viewport means Leaflet
  // exists. Derived rather than a second piece of state that could disagree.
  const mapReady = viewport !== null;

  const selected = useMemo(
    () => buildings.find((building) => building.id === selectedId) ?? null,
    [buildings, selectedId],
  );
  const curated: SurveyedProfile | null = selected ? CURATED[selected.id] ?? null : null;

  // The entrance to route toward. Curated profiles describe a verified accessible
  // entrance ("West side, facing the...") but only as text — this turns that side
  // into an actual point on the building's outline. Falls back to OpenStreetMap's
  // own entrance tags (already preferring a wheelchair-tagged one) when a building
  // has no curated profile, since that text isn't available to parse.
  const routeEntrance = useMemo(() => {
    if (!selected) return null;
    if (curated) {
      const sideWord = parseCompassWord(curated.entrance.side);
      const point = sideWord ? pointOnSide(selected.center, selected.polygon, sideWord) : null;
      if (point) {
        return {
          point,
          side: sideWord!,
          // Derived from a written description, so the pin marks the right wall
          // rather than the exact doorway. Said so on the map.
          precision: "approximate" as const,
          label: "Accessible entrance",
          detail: curated.entrance.side,
        };
      }
    }
    const osmEntrance = bestEntrance(selected);
    if (!osmEntrance) return null;
    return {
      point: osmEntrance.point,
      side: osmEntrance.side,
      precision: "exact" as const,
      label: osmEntrance.wheelchair === "yes"
        ? "Step-free entrance"
        : osmEntrance.kind === "main"
          ? "Main entrance"
          : "Entrance",
      detail: [
        `${osmEntrance.side} side`,
        `step-free: ${accessWord(osmEntrance.wheelchair).toLowerCase()}`,
        osmEntrance.automatic ? "automatic door" : null,
      ].filter(Boolean).join(" · "),
    };
  }, [selected, curated]);

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

  const removeDraftPin = useCallback(() => {
    draftPinMarker.current?.remove();
    draftPinMarker.current = null;
  }, []);

  const placeDraftPin = useCallback(async (latitude: number, longitude: number) => {
    const map = mapInstance.current;
    if (!map) return;
    const L = await import("leaflet");
    // Read through a ref rather than a dependency: the map-drawing effect also
    // depends on this callback, and redrawing every polygon each time someone
    // changes the dropdown would be a heavy price for swapping one glyph.
    const icon = L.divIcon({
      className: "custom-marker",
      html: draftPinHtml(facilityFor(categoryRef.current)),
      iconSize: [46, 54],
      iconAnchor: [23, 52],
    });
    removeDraftPin();
    draftPinMarker.current = L.marker([latitude, longitude], {
      icon,
      draggable: true,
      keyboard: true,
      title: "Drag to adjust the exact accessibility point",
      zIndexOffset: 1200,
    })
      .addTo(map)
      .on("dragend", (event) => {
        const point = (event.target as Marker).getLatLng();
        setForm((current) => ({ ...current, latitude: point.lat, longitude: point.lng }));
      });
    setForm((current) => ({ ...current, latitude, longitude }));
  }, [removeDraftPin]);

  // Keep the draft pin showing the feature currently chosen in the form, so
  // what you are about to add is what you see before you save it.
  useEffect(() => {
    categoryRef.current = form.category;
    const marker = draftPinMarker.current;
    if (!marker) return;
    let ignore = false;
    void (async () => {
      const L = await import("leaflet");
      if (ignore) return;
      marker.setIcon(L.divIcon({
        className: "custom-marker",
        html: draftPinHtml(facilityFor(form.category)),
        iconSize: [46, 54],
        iconAnchor: [23, 52],
      }));
    })();
    return () => { ignore = true; };
  }, [form.category]);

  const openReport = useCallback((id: number) => {
    setReportingId(id);
    setReportReason(REPORT_REASONS[0]);
    setReportNote("");
    setRemovingId(null);
    setModerationError("");
  }, []);

  const submitReport = useCallback(async (id: number) => {
    setReportState("saving");
    setModerationError("");
    try {
      const response = await fetch("/api/contributions/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contributionId: id, reason: reportReason, details: reportNote }),
      });
      const payload = (await response.json()) as { error?: string; alreadyReported?: boolean };
      if (!response.ok) {
        setModerationError(payload.error ?? "Could not flag that detail just now");
        return;
      }
      setReportingId(null);
      // A second flag from the same person is accepted but not counted twice,
      // so only move the number when the server actually recorded one.
      if (!payload.alreadyReported) {
        setContributions((items) => items.map((item) => (
          item.id === id ? { ...item, reportCount: (item.reportCount ?? 0) + 1 } : item
        )));
      }
      setToast(payload.alreadyReported ? "You have already flagged this detail" : "Thanks — flagged for review");
    } catch {
      setModerationError("Could not flag that detail just now");
    } finally {
      setReportState("idle");
    }
  }, [reportReason, reportNote]);

  const removeContribution = useCallback(async (id: number) => {
    setModerationError("");
    try {
      const response = await fetch(`/api/contributions?id=${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setModerationError(payload.error ?? "Could not remove that detail just now");
        return;
      }
      setContributions((items) => items.filter((item) => item.id !== id));
      // Keep the building's report tally on the list in step with the removal.
      setCounts((current) => {
        if (!selectedId) return current;
        const remaining = Math.max((current[selectedId] ?? 1) - 1, 0);
        return { ...current, [selectedId]: remaining };
      });
      setRemovingId(null);
      setToast("Removed from the map");
    } catch {
      setModerationError("Could not remove that detail just now");
    }
  }, [selectedId]);

  const closeContribution = useCallback(() => {
    setContributionOpen(false);
    setPinMode(false);
    removeDraftPin();
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
    setCapturedPhoto((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }, [removeDraftPin]);

  const openContribution = useCallback(() => {
    removeDraftPin();
    setPinMode(false);
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
    setForm({ category: "Ramp", location: "", details: "", anonymous: false, latitude: null, longitude: null });
    setCapturedPhoto((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setSubmitState("idle");
    setFormError("");
    setContributionOpen(true);
  }, [removeDraftPin]);

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setFormError("A secure browser with camera access is required to take a photo.");
      return;
    }
    setFormError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
      }, 0);
    } catch {
      setFormError("Allow camera access to take a new accessibility photo.");
    }
  }

  function stopCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
  }

  async function takeCameraPhoto() {
    const video = cameraVideoRef.current;
    if (!video) return;
    setPhotoState("processing");
    setFormError("");
    try {
      const [blob, position] = await Promise.all([captureCameraFrame(video), currentPosition()]);
      const next: CapturedPhoto = {
        blob,
        previewUrl: URL.createObjectURL(blob),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date().toISOString(),
      };
      setCapturedPhoto((current) => {
        if (current) URL.revokeObjectURL(current.previewUrl);
        return next;
      });
      await placeDraftPin(position.coords.latitude, position.coords.longitude);
      stopCamera();
    } catch {
      setFormError("Allow precise location access so the camera photo can be geo-tagged, then try again.");
    } finally {
      setPhotoState("idle");
    }
  }

  const chooseBuilding = useCallback((id: string, tab: Tab = "details") => {
    setMenuOpen(false);
    setSelectedId(id);
    setActiveTab(tab);
    setDetailOpen(true);
    setRouteVisible(tab === "route");
  }, []);

  function startPinPlacement() {
    if (!selected || !mapInstance.current) return;
    setFormError("");
    setContributionOpen(false);
    setDetailOpen(false);
    setRouteVisible(false);
    setPinMode(true);
    mapInstance.current.flyTo(selected.center, 20, { duration: 0.65 });
  }

  function confirmPinPlacement() {
    if (form.latitude === null || form.longitude === null) return;
    setPinMode(false);
    setDetailOpen(true);
    setContributionOpen(true);
  }

  function cancelPinPlacement() {
    removeDraftPin();
    setForm((current) => ({ ...current, latitude: null, longitude: null }));
    setPinMode(false);
    setDetailOpen(true);
    setContributionOpen(true);
  }


  // --- map bootstrap -------------------------------------------------------
  useEffect(() => {
    let active = true;
    let releaseObserver: (() => void) | null = null;
    const shapeStore = shapes.current;
    async function createMap() {
      if (!mapElement.current || mapInstance.current) return;
      const L = await import("leaflet");
      if (!active || !mapElement.current) return;

      const map = L.map(mapElement.current, { zoomControl: false, zoomSnap: 0.5 }).setView(DEFAULT_CENTER, 17);
      // On a phone the bottom of the map belongs to the profile sheet, so the
      // zoom buttons join the locate button in a vertical stack on the right.
      L.control
        .zoom({ position: window.matchMedia("(max-width: 760px)").matches ? "topright" : "bottomright" })
        .addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
        subdomains: "abc",
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      shapeLayer.current = L.layerGroup().addTo(map);
      accessPointLayer.current = L.layerGroup().addTo(map);

      const userIcon = L.divIcon({
        className: "custom-marker",
        html: '<div class="user-pin"><span></span></div>',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      userMarker.current = L.marker(DEMO_START, { icon: userIcon, title: "Your starting point" }).addTo(map);

      // Rotation, the on-screen keyboard and layout changes all resize the map
      // container behind Leaflet's back.
      const resizeObserver = new ResizeObserver(() => map.invalidateSize({ animate: false }));
      resizeObserver.observe(map.getContainer());
      releaseObserver = () => resizeObserver.disconnect();

      const syncViewport = () => {
        const bounds = map.getBounds();
        setViewport({
          bbox: { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() },
          zoom: map.getZoom(),
        });
      };
      map.on("moveend", syncViewport);
      // flyTo does not fire dragstart, so this only catches a real drag.
      map.on("dragstart", () => { userMovedMap.current = true; });
      syncViewport();

      mapInstance.current = map;
    }
    createMap();
    return () => {
      active = false;
      releaseObserver?.();
      entranceMarker.current = null;
      mapInstance.current?.remove();
      mapInstance.current = null;
      accessPointLayer.current = null;
      draftPinMarker.current = null;
      shapeStore.clear();
    };
  }, []);

  // --- precise accessibility-point placement ------------------------------
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !pinMode) return;
    map.getContainer().classList.add("pin-cursor");
    const handleMapClick = (event: LeafletMouseEvent) => {
      void placeDraftPin(event.latlng.lat, event.latlng.lng);
    };
    map.on("click", handleMapClick);
    return () => {
      map.getContainer().classList.remove("pin-cursor");
      map.off("click", handleMapClick);
    };
  }, [pinMode, placeDraftPin]);

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
          bubblingMouseEvents: false,
        })
          .bindTooltip(`${displayName(building)} — ${STATUS_LABEL[status]}`, { sticky: true })
          .on("click", (event) => {
            if (pinMode) void placeDraftPin(event.latlng.lat, event.latlng.lng);
            else chooseBuilding(building.id);
          });
        layer.addLayer(polygon);
        shapes.current.set(building.id, polygon);
      }
    }
    draw();
  }, [chooseBuilding, pinMode, placeDraftPin, selectedId, withDistance]);

  // --- pan to the selected building ---------------------------------------
  useEffect(() => {
    if (!selected || !mapInstance.current) return;
    const map = mapInstance.current;
    // Opening a profile hides the mobile sidebar, which grows the map panel.
    // Leaflet caches its container size, so re-measure before framing.
    map.invalidateSize({ animate: false });
    const zoom = Math.max(map.getZoom(), 18);

    let target: LatLng = selected.center;
    const drawerWidth = drawerSideWidth(map);
    const sheetHeight = drawerBottomHeight(map);
    if (drawerWidth > 0 || sheetHeight > 0) {
      const shifted = map.project(selected.center, zoom).add([drawerWidth / 2, sheetHeight / 2]);
      const unprojected = map.unproject(shifted, zoom);
      target = [unprojected.lat, unprojected.lng];
    }

    map.flyTo(target, zoom, { duration: 0.6 });
  }, [selected]);

  // --- fetch the walking route in the background as soon as a building is
  // selected, not gated on the Route tab being open. The public routing
  // service takes ~1s to respond, so starting this early (while someone is
  // still reading the Accessibility tab) means it's often already loaded by
  // the time they actually click "Route" — instead of watching it happen.
  useEffect(() => {
    let ignore = false;

    (async () => {
      setWalkingRoute(null);
      if (!selected) return;
      const target = routeEntrance?.point ?? selected.center;
      try {
        const response = await fetch(`/api/route?from=${location[0]},${location[1]}&to=${target[0]},${target[1]}`);
        const payload = (await response.json()) as Partial<WalkingRoute>;
        if (ignore) return;
        if (response.ok && payload.points && payload.points.length > 1) {
          setWalkingRoute({
            points: payload.points,
            distanceMetres: payload.distanceMetres ?? 0,
            durationSeconds: payload.durationSeconds ?? 0,
            steps: payload.steps ?? [],
          });
        }
      } catch {
        // Network hiccup: the drawing effect below falls back to a direct line.
      }
    })();

    return () => { ignore = true; };
  }, [location, selected, routeEntrance]);

  // --- draw the route on the map whenever the Route tab is open: the real
  // walking path once it's loaded, else a direct dashed line as a placeholder ---
  useEffect(() => {
    let cancelled = false;
    async function draw() {
      const map = mapInstance.current;
      routeLine.current?.remove();
      routeLine.current = null;
      routeHalo.current?.remove();
      routeHalo.current = null;
      if (!map || !routeVisible || !selected) return;

      const target = routeEntrance?.point ?? selected.center;
      const points = walkingRoute?.points ?? [location, target];
      const dashed = !walkingRoute;

      const L = await import("leaflet");
      if (cancelled || mapInstance.current !== map) return;
      routeHalo.current = L.polyline(points, { color: "#fff", weight: 11, opacity: 0.94, lineCap: "round" }).addTo(map);
      routeLine.current = L.polyline(points, {
        color: "#087f73",
        weight: 6,
        opacity: 1,
        lineCap: "round",
        dashArray: dashed ? "10 8" : undefined,
      }).addTo(map);
      map.fitBounds(routeLine.current.getBounds(), {
        paddingTopLeft: [70, 70],
        paddingBottomRight: [70 + drawerSideWidth(map), 70 + drawerBottomHeight(map)],
        maxZoom: 18,
      });
    }
    draw();
    return () => { cancelled = true; };
  }, [routeVisible, walkingRoute, selected, location, routeEntrance]);

  // --- keep the building above the sheet ----------------------------------
  // Framing happens once, when a building is picked. The sheet can grow after
  // that — expanding it, or switching to a taller tab — and the building ends
  // up behind it. Watch the sheet and nudge the map only when the building
  // would actually be hidden, so it does not twitch on every content change.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !selected || !detailOpen) return;
    const drawerEl = document.querySelector(".building-drawer");
    if (!drawerEl) return;

    const centre = selected.center;
    const keepInView = () => {
      const current = mapInstance.current;
      if (!current) return;
      const sheetTop = sheetTopWithinMap(current);
      if (sheetTop === null) return;

      const MARGIN = 28;
      const limit = sheetTop - MARGIN;
      const topInset = 74; // clear of the locate button
      if (limit <= topInset) return; // sheet covers the map; nothing sensible to show

      const point = current.latLngToContainerPoint(centre);
      if (point.y <= limit && point.y >= topInset) return;

      const desired = (topInset + limit) / 2;
      current.panBy([0, Math.round(point.y - desired)], { animate: true, duration: 0.3 });
    };

    const observer = new ResizeObserver(keepInView);
    observer.observe(drawerEl);
    return () => observer.disconnect();
  }, [selected, detailOpen]);

  // --- mark the entrance on the map ---------------------------------------
  useEffect(() => {
    async function drawEntrance() {
      if (!mapInstance.current) return;
      const L = await import("leaflet");
      entranceMarker.current?.remove();
      entranceMarker.current = null;
      if (!routeEntrance || !detailOpen) return;

      const approximate = routeEntrance.precision === "approximate";
      const icon = L.divIcon({
        className: "custom-marker",
        html: `<div class="entrance-pin${approximate ? " approximate" : ""}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                 stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M7 17L17 7M9.5 7H17v7.5" />
            </svg>
          </div>`,
        iconSize: [46, 46],
        iconAnchor: [23, 23],
      });

      entranceMarker.current = L.marker(routeEntrance.point, {
        icon,
        keyboard: false,
        title: `${routeEntrance.label} — ${routeEntrance.detail}`,
        zIndexOffset: 800,
      })
        .addTo(mapInstance.current)
        .bindTooltip(approximate ? `${routeEntrance.label} · approximate` : routeEntrance.label, {
          permanent: true,
          direction: "top",
          offset: [0, -18],
          className: "entrance-tooltip",
        });
    }
    drawEntrance();
  }, [routeEntrance, detailOpen]);

  // --- follow the visitor's real position ---------------------------------
  // Until now the map planted a fixed demo pin and only asked the browser for a
  // position when the locate button was pressed, so every distance on screen
  // was measured from Wickham Street until someone tapped. Ask on load instead,
  // and keep watching: the first fix is often a coarse wifi one and the GPS
  // refinement arrives seconds later.
  useEffect(() => {
    let watch: number | null = null;
    let cancelled = false;
    // The guards report through state, so they run in an async body rather than
    // synchronously in the effect, matching how the other loaders here do it.
    void (async () => {
      if (cancelled) return;
      if (!navigator.geolocation) {
        setLocationMessage("Location unavailable — using demo start");
        return;
      }
      // Browsers refuse geolocation outside a secure context, which is what
      // happens when a phone opens the dev server over the LAN address.
      if (!window.isSecureContext) {
        setLocationMessage("Needs https on a phone — using demo start");
        return;
      }
      setLocationMessage("Finding your location…");
      const id = navigator.geolocation.watchPosition(
        ({ coords }) => {
          setLocation([coords.latitude, coords.longitude]);
          setLocationAccuracy(coords.accuracy);
          setLocationMessage(describeFix(coords.accuracy));
        },
        (error) => setLocationMessage(describeLocationError(error)),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
      );
      if (cancelled) navigator.geolocation.clearWatch(id);
      else watch = id;
    })();
    return () => {
      cancelled = true;
      if (watch !== null) navigator.geolocation.clearWatch(watch);
    };
  }, []);

  // Draw the fix once Leaflet exists, so a position that arrives before the map
  // is ready is not dropped. The halo is the browser's own accuracy radius —
  // when the dot looks wrong, this shows whether the fix was ever confident.
  useEffect(() => {
    if (!mapReady || locationAccuracy === null) return;
    let ignore = false;
    void (async () => {
      const map = mapInstance.current;
      if (!map) return;
      const L = await import("leaflet");
      if (ignore || !mapInstance.current) return;
      userMarker.current?.setLatLng(location);
      if (userAccuracyCircle.current) {
        userAccuracyCircle.current.setLatLng(location).setRadius(locationAccuracy);
      } else {
        userAccuracyCircle.current = L.circle(location, {
          radius: locationAccuracy,
          color: "#176dde",
          weight: 1,
          opacity: 0.5,
          fillColor: "#176dde",
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(map);
      }
      if (hasCentredOnUser.current) return;
      hasCentredOnUser.current = true;
      // Centre on the first real fix, unless they are already reading about a
      // building or have dragged the map somewhere themselves.
      if (!userMovedMap.current && !selectedId) {
        map.flyTo(location, Math.max(map.getZoom(), 18), { duration: 0.65 });
      }
    })();
    return () => { ignore = true; };
  }, [mapReady, location, locationAccuracy, selectedId]);

  // --- community reports for the selected building ------------------------
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!selectedId) {
        if (!ignore) setContributions([]);
        return;
      }
      setContributions([]);
      setLoadingContributions(true);
      try {
        const response = await fetch(`/api/contributions?buildingId=${encodeURIComponent(selectedId)}`);
        const payload = (await response.json()) as { contributions?: Contribution[]; canModerate?: boolean };
        if (!ignore) {
          setContributions(payload.contributions ?? []);
          setCanModerate(payload.canModerate === true);
        }
      } catch {
        if (!ignore) setContributions([]);
      } finally {
        if (!ignore) setLoadingContributions(false);
      }
    })();
    return () => { ignore = true; };
  }, [selectedId]);

  // --- show saved accessibility points for the selected building -----------
  useEffect(() => {
    let ignore = false;
    async function drawAccessPoints() {
      const layer = accessPointLayer.current;
      if (!layer) return;
      layer.clearLayers();
      const pinned = contributions.filter((item) => item.latitude !== null && item.longitude !== null);
      if (!pinned.length) return;
      const L = await import("leaflet");
      if (ignore) return;
      for (const item of pinned) {
        const facility = facilityFor(item.category);
        const icon = L.divIcon({
          className: "custom-marker",
          html: accessPointHtml(facility),
          iconSize: [34, 42],
          iconAnchor: [17, 40],
        });
        const marker = L.marker([item.latitude!, item.longitude!], {
          icon,
          title: `${item.category}: ${item.location}`,
          zIndexOffset: 800,
        })
          .bindTooltip(`${item.category} · ${item.location}`, { direction: "top", offset: [0, -28] })
          .on("click", () => {
            setActiveTab("community");
            setDetailOpen(true);
          });
        layer.addLayer(marker);
      }
    }
    void drawAccessPoints();
    return () => { ignore = true; };
  }, [contributions]);
  // --- who is signed in ---------------------------------------------------
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const response = await fetch("/api/auth/me");
        const payload = (await response.json()) as { user?: Account | null };
        if (!ignore) setAccount(payload.user ?? null);
      } catch {
        /* signed out is the safe assumption */
      }
    })();
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // --- browse panel keyboard handling -------------------------------------
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // --- modal keyboard handling --------------------------------------------
  useEffect(() => {
    if (!contributionOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContribution();
    };
    window.addEventListener("keydown", onKey);
    modalRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [closeContribution, contributionOpen]);

  function openAuth(mode: "signin" | "register") {
    setAuthMode(mode);
    setAuthForm({ email: "", displayName: "", password: "" });
    setAuthError("");
    setAuthState("idle");
    setMenuOpen(false);
    setAuthOpen(true);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthState("saving");
    setAuthError("");
    try {
      const endpoint = authMode === "signin" ? "/api/auth/login" : "/api/auth/register";
      const body = authMode === "signin"
        ? { email: authForm.email, password: authForm.password }
        : authForm;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { user?: Account; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error ?? "That did not work");
      setAccount(payload.user);
      setAuthOpen(false);
      setToast(authMode === "signin" ? `Signed in as ${payload.user.publicName}` : `Welcome, ${payload.user.publicName}`);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "That did not work");
    } finally {
      setAuthState("idle");
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* the cookie is cleared server-side; fall through either way */
    }
    setAccount(null);
    setProfileOpen(false);
    setMenuOpen(false);
    setToast("Signed out");
  }

  async function openProfile() {
    setMenuOpen(false);
    setProfileOpen(true);
    setLoadingMine(true);
    try {
      const response = await fetch("/api/me/contributions");
      const payload = (await response.json()) as { contributions?: MyContribution[] };
      setMyContributions(payload.contributions ?? []);
    } catch {
      setMyContributions([]);
    } finally {
      setLoadingMine(false);
    }
  }

  /** The contribute action needs a building, so say so rather than sitting disabled. */
  function startContribution() {
    setMenuOpen(false);
    if (!selectedId) {
      setToast("Tap a building on the map first");
      return;
    }
    openContribution();
  }

  async function submitContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    if (form.latitude === null || form.longitude === null) {
      setSubmitState("error");
      setFormError("Place the exact accessibility point on the map before submitting.");
      return;
    }
    setSubmitState("saving");
    setFormError("");
    try {
      const body = new FormData();
      body.set("buildingId", selectedId);
      body.set("buildingName", selected ? displayName(selected) : "");
      body.set("category", form.category);
      body.set("location", form.location);
      body.set("details", form.details);
      body.set("anonymous", String(form.anonymous));
      body.set("latitude", String(form.latitude));
      body.set("longitude", String(form.longitude));
      if (capturedPhoto) {
        body.set("photo", capturedPhoto.blob, "camera-capture.jpg");
        body.set("photoLatitude", String(capturedPhoto.latitude));
        body.set("photoLongitude", String(capturedPhoto.longitude));
        body.set("photoAccuracy", String(capturedPhoto.accuracy));
        body.set("photoCapturedAt", capturedPhoto.capturedAt);
      }
      const response = await fetch("/api/contributions", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as { contribution?: Contribution; error?: string };
      if (!response.ok || !payload.contribution) throw new Error(payload.error ?? "Submission failed");
      setSubmitState("success");
      setContributions((items) => [payload.contribution!, ...items]);
      setCounts((current) => ({ ...current, [selectedId]: (current[selectedId] ?? 0) + 1 }));
      setActiveTab("community");
      setDetailOpen(true);
      removeDraftPin();
      window.setTimeout(() => setContributionOpen(false), 900);
    } catch (error) {
      setSubmitState("error");
      setFormError(error instanceof Error ? error.message : "The contribution could not be saved.");
    }
  }

  /** Take me back to my dot. */
  function locateUser() {
    const map = mapInstance.current;
    // The watch is already delivering fresh positions, so the button's job is
    // to return to the newest one — immediately, rather than sitting on
    // "Finding your location…" while a redundant request runs.
    if (locationAccuracy !== null && map) {
      hasCentredOnUser.current = true;
      map.flyTo(location, Math.max(map.getZoom(), 18), { duration: 0.65 });
      return;
    }
    if (!navigator.geolocation) {
      setLocationMessage("Location unavailable — using demo start");
      return;
    }
    if (!window.isSecureContext) {
      setLocationMessage("Needs https on a phone — using demo start");
      return;
    }
    // No fix yet: ask once more. This is also the retry after someone declines
    // and then allows location in their browser settings.
    setLocationMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation([coords.latitude, coords.longitude]);
        setLocationAccuracy(coords.accuracy);
        setLocationMessage(describeFix(coords.accuracy));
      },
      (error) => setLocationMessage(describeLocationError(error)),
      // maximumAge was unset before, so the browser could hand back a position
      // it had cached earlier — a fix that is stale, not merely coarse.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }

  const selectedStatus = selected ? statusOf(selected) : "unknown";
  const selectedDistance = selected ? haversine(location, selected.center) : 0;
  const surveyedCount = visible.filter((item) => item.status === "surveyed").length;
  const gapCount = visible.filter((item) => item.status === "unknown").length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="OpenWay home">
          <img src="/openway.jpeg" alt="OpenWay" />
        </a>
        <div className="topbar-account">
          <AccountControls
            account={account}
            variant="bar"
            onSignIn={() => openAuth("signin")}
            onRegister={() => openAuth("register")}
            onProfile={openProfile}
            onSignOut={signOut}
          />
        </div>

        <button className="report-button" type="button" onClick={openContribution} disabled={!selectedId}>
          <span aria-hidden="true">＋</span> {selectedId ? "Contribute accessibility info" : "Select a building first"}
        </button>

        <button className="icon-action contribute-icon" type="button" onClick={startContribution} aria-label="Contribute accessibility info" title="Contribute accessibility info">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        <button
          className={menuOpen ? "menu-toggle open" : "menu-toggle"}
          type="button"
          aria-label={menuOpen ? "Close building list" : "Open building list"}
          aria-expanded={menuOpen}
          aria-controls="browse-panel"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      </header>

      <section className={`workspace${detailOpen && selected ? " detail-open" : ""}${menuOpen ? " menu-open" : ""}`} id="top">
        <aside className="sidebar" id="browse-panel" aria-label="Buildings in view">
          <div className="panel-account">
            <AccountControls
              account={account}
              variant="panel"
              onSignIn={() => openAuth("signin")}
              onRegister={() => openAuth("register")}
              onProfile={openProfile}
              onSignOut={signOut}
            />
          </div>

          <div className="sidebar-heading">
            <p className="eyebrow">KNOW BEFORE YOU ARRIVE</p>
            <h1>Every access detail, in one place.</h1>
            <p>Click any building on the map, even one nobody has surveyed yet, to see exactly what is known about getting inside.</p>
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
            <button className="locate-button" type="button" onClick={locateUser} aria-label={`Use my location. ${locationMessage}`} title="Use my location">
              <span aria-hidden="true">
                <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
                  <path d="M12 1.5v3.2M12 19.3v3.2M1.5 12h3.2M19.3 12h3.2" />
                </svg>
              </span>
              <span><b>Use my location</b><small>{locationMessage}</small></span>
            </button>
          </div>

          {loadingBuildings && <div className="fetch-status" role="status">Loading buildings…</div>}

          {pinMode && selected && (
            <section className="pin-placement-bar" aria-live="polite">
              <div className="pin-placement-copy">
                <span className="pin-placement-icon" aria-hidden="true">⌖</span>
                <div>
                  <b>{form.latitude === null ? "Click the exact accessibility point" : "Pin placed — drag it to refine"}</b>
                  <small>
                    {form.latitude === null
                      ? `Zoomed in on ${displayName(selected)}. Click beside the building at the entrance, ramp or other feature.`
                      : `${form.latitude.toFixed(7)}, ${form.longitude!.toFixed(7)}`}
                  </small>
                </div>
              </div>
              <div className="pin-placement-actions">
                <button type="button" className="secondary-button" onClick={cancelPinPlacement}>Cancel</button>
                <button type="button" className="primary-action" disabled={form.latitude === null} onClick={confirmPinPlacement}>Use this pin</button>
              </div>
            </section>
          )}

          {detailOpen && selected && (
            <article className={sheetExpanded ? "building-drawer expanded" : "building-drawer"} aria-live="polite">
              <button
                className="sheet-handle"
                type="button"
                aria-label={sheetExpanded ? "Collapse building details" : "Expand building details"}
                aria-expanded={sheetExpanded}
                onClick={() => setSheetExpanded((open) => !open)}
              >
                <span aria-hidden="true" />
              </button>
              <div className="drawer-header">
                <div>
                  <span className="detail-type">BUILDING ACCESS PROFILE</span>
                  <h2>{displayName(selected)}</h2>
                  <p>{selected.kind}{selected.address ? ` · ${selected.address}` : ""}{selected.levels ? ` · ${selected.levels} levels` : ""}</p>
                </div>
                <button className="close-detail" type="button" aria-label="Close building details" onClick={() => { setDetailOpen(false); setRouteVisible(false); setSheetExpanded(false); }}>×</button>
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
                        <b>
                          {walkingRoute ? formatDistance(walkingRoute.distanceMetres) : formatDistance(selectedDistance)} · About{" "}
                          {walkingRoute ? formatWalkingDuration(walkingRoute.durationSeconds) : formatDuration(selectedDistance)}
                        </b>
                        <small>
                          {routeEntrance
                            ? `Toward the ${routeEntrance.side} entrance`
                            : "Toward the building centre — no entrance mapped yet"}
                        </small>
                      </div>
                    </div>
                    {walkingRoute && walkingRoute.steps.length > 0 ? (
                      <ol>
                        {walkingRoute.steps.map((step, index) => (
                          <li key={index}>
                            <span>{index + 1}</span>
                            {step.instruction}
                            {step.distanceMetres >= 5 ? ` — ${formatDistance(step.distanceMetres)}` : ""}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="safety-note">
                        {walkingRoute ? "No turn-by-turn directions available for this route." : "Loading walking directions…"}
                      </p>
                    )}
                    <p className="safety-note">
                      {walkingRoute
                        ? "These directions follow OpenStreetMap's mapped footpaths for general walking — they are not confirmed wheelchair-accessible and may include stairs. Check temporary closures and verify conditions before travel."
                        : "Prototype routing. Check temporary closures and verify conditions before travel."}
                    </p>
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
                    {canModerate && (
                      <div className="moderator-note" role="note">
                        <b>Demo moderation</b> Every signed-in account can remove a report. A real deployment would limit this to reviewers.
                      </div>
                    )}
                    {loadingContributions ? (
                      <p className="loading">Loading community reports…</p>
                    ) : contributions.length ? (
                      <div className="contribution-list">
                        {contributions.map((item) => (
                          <article key={item.id}>
                            <div>
                              <b><i className="facility-tag" style={{ "--pin": facilityFor(item.category).colour } as CSSProperties}><FacilityIcon facility={facilityFor(item.category)} size={13} /></i>{item.category}</b>
                              <span>Unverified</span>
                            </div>
                            <strong>{item.location}</strong>
                            <p>{item.details}</p>
                            {item.photoUrl && (
                              <figure className="contribution-photo">
                                <Image src={item.photoUrl} alt={`${item.category} accessibility photo at ${item.location}`} width={900} height={600} unoptimized />
                                <figcaption>
                                  Camera photo · geo-tagged {item.photoLatitude?.toFixed(5)}, {item.photoLongitude?.toFixed(5)}
                                </figcaption>
                              </figure>
                            )}
                            {item.latitude !== null && item.longitude !== null && (
                              <p className="saved-coordinate">⌖ Pinned at {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}</p>
                            )}
                            <small>Shared by {item.contributor} · {new Date(item.createdAt.replace(" ", "T") + "Z").toLocaleDateString()}</small>

                            <div className="moderation-row">
                              {(item.reportCount ?? 0) > 0 && (
                                <span className="flag-count">Flagged by {item.reportCount} {item.reportCount === 1 ? "person" : "people"}</span>
                              )}
                              <button type="button" className="link-button" onClick={() => openReport(item.id)}>Report as inaccurate</button>
                              {canModerate && (
                                removingId === item.id ? (
                                  <span className="remove-confirm">
                                    Remove permanently?
                                    <button type="button" className="danger-button" onClick={() => void removeContribution(item.id)}>Yes, remove</button>
                                    <button type="button" className="link-button" onClick={() => setRemovingId(null)}>Keep</button>
                                  </span>
                                ) : (
                                  <button type="button" className="link-button danger" onClick={() => { setRemovingId(item.id); setReportingId(null); setModerationError(""); }}>Remove</button>
                                )
                              )}
                            </div>

                            {reportingId === item.id && (
                              <div className="report-form">
                                <b>What is wrong with this detail?</b>
                                <div className="reason-row" role="group" aria-label="Reason">
                                  {REPORT_REASONS.map((reason) => (
                                    <button
                                      key={reason}
                                      type="button"
                                      className={reportReason === reason ? "reason active" : "reason"}
                                      aria-pressed={reportReason === reason}
                                      onClick={() => setReportReason(reason)}
                                    >
                                      {reason}
                                    </button>
                                  ))}
                                </div>
                                <textarea
                                  rows={2}
                                  value={reportNote}
                                  maxLength={400}
                                  placeholder="Optional: what did you find instead?"
                                  onChange={(e) => setReportNote(e.target.value)}
                                />
                                <div className="report-actions">
                                  <button type="button" className="link-button" onClick={() => setReportingId(null)}>Cancel</button>
                                  <button type="button" className="primary-action" disabled={reportState === "saving"} onClick={() => void submitReport(item.id)}>
                                    {reportState === "saving" ? "Sending…" : "Send report"}
                                  </button>
                                </div>
                              </div>
                            )}

                            {moderationError && (reportingId === item.id || removingId === item.id) && (
                              <p className="form-error">{moderationError}</p>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="no-contributions">
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
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closeContribution(); }}>
          <section className="contribution-modal" role="dialog" aria-modal="true" aria-labelledby="contribution-title" ref={modalRef}>
            <div className="modal-header">
              <div>
                <span className="detail-type">COMMUNITY CONTRIBUTION</span>
                <h2 id="contribution-title">Add an accessibility detail</h2>
                <p>You are adding information about <b>{displayName(selected)}</b>.</p>
              </div>
              <button className="close-detail" onClick={closeContribution} aria-label="Close contribution form">×</button>
            </div>
            <form onSubmit={submitContribution}>
              <div className={form.latitude === null ? "pin-field" : "pin-field placed"}>
                <span className="pin-field-icon" aria-hidden="true">⌖</span>
                <div>
                  <b>{form.latitude === null ? "Exact map pin required" : "Exact accessibility point pinned"}</b>
                  <small>
                    {form.latitude === null
                      ? "Place the marker at the entrance, ramp, toilet or other feature—not at the building centre. A camera photo can place it automatically."
                      : `${form.latitude.toFixed(7)}, ${form.longitude!.toFixed(7)}`}
                  </small>
                </div>
                <button type="button" onClick={startPinPlacement}>{form.latitude === null ? "Place pin on map" : "Adjust pin"}</button>
              </div>
              <div className="facility-field">
                <span id="facility-label">Accessibility feature</span>
                <div className="facility-grid" role="group" aria-labelledby="facility-label">
                  {FACILITIES.map((facility) => (
                    <button
                      key={facility.id}
                      type="button"
                      className={form.category === facility.label ? "facility-chip active" : "facility-chip"}
                      style={{ "--pin": facility.colour } as CSSProperties}
                      aria-pressed={form.category === facility.label}
                      onClick={() => setForm({ ...form, category: facility.label })}
                    >
                      <i><FacilityIcon facility={facility} size={18} /></i>
                      <b>{facility.label}</b>
                    </button>
                  ))}
                </div>
              </div>

              {/* Attribution comes from the account, not a free-text name field
                  anyone could put someone else's name into. */}
              <div className="attribution-choice">
                {account ? (
                  <>
                    <p>
                      Posting as <b>{form.anonymous ? "Community member" : account.publicName}</b>
                      {!form.anonymous && <span className="attribution-note"> — only your first name and last initial are shown</span>}
                    </p>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={form.anonymous}
                        onChange={(e) => setForm({ ...form, anonymous: e.target.checked })}
                      />
                      <span>Post without my name</span>
                    </label>
                  </>
                ) : (
                  <p>
                    Posting as <b>Community member</b>.{" "}
                    <button type="button" className="link-button" onClick={() => { setContributionOpen(false); openAuth("signin"); }}>
                      Sign in
                    </button>{" "}
                    to have this credited to you.
                  </p>
                )}
              </div>
              <label>Exact location or level
                <input required maxLength={140} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. East side, Level 2 beside the lift" />
              </label>
              <label><span>Detailed accessibility information <small>(at least 10 characters)</small></span>
                <textarea
                  required
                  minLength={10}
                  maxLength={800}
                  value={form.details}
                  onChange={(e) => setForm({ ...form, details: e.target.value })}
                  placeholder="Include measurements, the side of the building, door type, condition or another practical detail."
                  rows={5}
                />
              </label>
              <div className="form-guidance">
                <span aria-hidden="true">✓</span>
                <p>Your report is stored as <b>unverified</b> until reviewed. Do not include private or sensitive information.</p>
              </div>
              {submitState === "error" && <p className="form-error">{formError || "The information could not be saved. Please check the fields and try again."}</p>}
              {submitState === "success" && <p className="form-success">Thank you — your information has been saved for review.</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeContribution}>Cancel</button>
                <button className="primary-action" disabled={submitState === "saving" || photoState === "processing"}>{submitState === "saving" ? "Saving…" : "Submit information"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {toast && <div className="app-toast" role="status">{toast}</div>}

      {authOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setAuthOpen(false); }}>
          <section className="contribution-modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <div className="modal-header">
              <div>
                <span className="detail-type">OPENWAY ACCOUNT</span>
                <h2 id="auth-title">{authMode === "signin" ? "Sign in" : "Create an account"}</h2>
                <p>
                  {authMode === "signin"
                    ? "Your reports keep your name on them, and you can see everything you have added."
                    : "Only your first name and last initial are ever shown to other people."}
                </p>
              </div>
              <button className="close-detail" onClick={() => setAuthOpen(false)} aria-label="Close">×</button>
            </div>

            <form onSubmit={submitAuth}>
              {authMode === "register" && (
                <label>Your name
                  <input
                    required
                    maxLength={60}
                    autoComplete="name"
                    value={authForm.displayName}
                    onChange={(e) => setAuthForm({ ...authForm, displayName: e.target.value })}
                    placeholder="e.g. Jason Zhang"
                  />
                </label>
              )}
              <label>Email
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={authForm.email}
                  onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                  placeholder="you@example.com"
                />
              </label>
              <label>Password
                <input
                  required
                  type="password"
                  minLength={8}
                  autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                  value={authForm.password}
                  onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                  placeholder={authMode === "signin" ? "Your password" : "At least 8 characters"}
                />
              </label>

              {authError && <p className="form-error">{authError}</p>}

              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => { setAuthMode(authMode === "signin" ? "register" : "signin"); setAuthError(""); }}>
                  {authMode === "signin" ? "Create an account" : "I already have one"}
                </button>
                <button className="primary-action" disabled={authState === "saving"}>
                  {authState === "saving" ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {profileOpen && account && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setProfileOpen(false); }}>
          <section className="contribution-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <div className="modal-header">
              <div>
                <span className="detail-type">YOUR PROFILE</span>
                <h2 id="profile-title">{account.displayName}</h2>
                <p>Shown publicly as <b>{account.publicName}</b> · {account.email}</p>
              </div>
              <button className="close-detail" onClick={() => setProfileOpen(false)} aria-label="Close">×</button>
            </div>

            <div className="profile-summary">
              <strong>{myContributions.length}</strong>
              <span>{myContributions.length === 1 ? "contribution" : "contributions"} so far</span>
            </div>

            {loadingMine ? (
              <p className="loading">Loading your contributions…</p>
            ) : myContributions.length ? (
              <div className="contribution-list">
                {myContributions.map((item) => (
                  <article key={item.id}>
                    <div>
                      <b><i className="facility-tag" style={{ "--pin": facilityFor(item.category).colour } as CSSProperties}><FacilityIcon facility={facilityFor(item.category)} size={13} /></i>{item.category}</b>
                      <span>{item.status === "pending_review" ? "Awaiting review" : item.status}</span>
                    </div>
                    {(item.reportCount ?? 0) > 0 && (
                      <p className="flag-notice">Flagged as inaccurate by {item.reportCount} {item.reportCount === 1 ? "person" : "people"} — worth checking.</p>
                    )}
                    <strong>{item.buildingName ?? item.buildingId}</strong>
                    <p>{item.location} — {item.details}</p>
                    {item.photoUrl && <Image className="profile-photo" src={item.photoUrl} alt={`${item.category} accessibility photo`} width={240} height={164} unoptimized />}
                    <small>
                      {new Date(item.createdAt.replace(" ", "T") + "Z").toLocaleDateString()}
                      {item.anonymous ? " · posted without your name" : ` · shown as ${account.publicName}`}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <div className="no-contributions">
                <span aria-hidden="true">＋</span>
                <b>Nothing yet</b>
                <p>Pick a building on the map and add the first detail you know.</p>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={signOut}>Sign out</button>
              <button type="button" className="primary-action" onClick={() => setProfileOpen(false)}>Done</button>
            </div>
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
          <p className="pin-note">Marked on the map. The pin shows the right side of the building; the exact doorway has not been surveyed to a coordinate.</p>
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
          This is exactly the gap OpenWay exists to close. {reportCount > 0 ? `${reportCount} community report${reportCount > 1 ? "s" : ""} already added.` : "Be the first to add a detail."}
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
        <p>Know something we&apos;re missing? A ramp measurement, which toilet has a grab rail, where the accessible parking is. It helps the next person get in!</p>
        <button type="button" className="primary-action full" onClick={onContribute}>＋ Add what you know</button>
      </section>
    </>
  );
}

/**
 * Account state lives in the header on wide screens and in the browse panel on
 * phones, where the header has no room. One component, mounted twice, so the
 * two never drift apart; CSS decides which one is on screen.
 */
function AccountControls({
  account,
  variant,
  onSignIn,
  onRegister,
  onProfile,
  onSignOut,
}: {
  account: Account | null;
  variant: "bar" | "panel";
  onSignIn: () => void;
  onRegister: () => void;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  if (!account) {
    return (
      <div className={`account-controls ${variant}`}>
        {variant === "panel" && (
          <div className="account-copy">
            <strong>Not signed in</strong>
            <small>Sign in to have your reports credited to you</small>
          </div>
        )}
        <div className="account-actions">
          <button type="button" onClick={onSignIn}>Sign in</button>
          <button type="button" onClick={onRegister}>Create account</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`account-controls ${variant}`}>
      <span className="account-avatar" aria-hidden="true">{account.displayName.trim().slice(0, 1).toUpperCase()}</span>
      <div className="account-copy">
        <strong>{variant === "bar" ? account.publicName : account.displayName}</strong>
        {variant === "panel" && <small>Shown publicly as {account.publicName}</small>}
      </div>
      <div className="account-actions">
        <button type="button" onClick={onProfile}>My contributions</button>
        <button type="button" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

function Data({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "data-item wide" : "data-item"}><small>{label}</small><b>{value}</b></div>;
}

function Amenity({ icon, title, primary, secondary }: { icon: string; title: string; primary: string; secondary: string }) {
  return <article><span aria-hidden="true">{icon}</span><div><small>{title}</small><b>{primary}</b><p>{secondary}</p></div></article>;
}
