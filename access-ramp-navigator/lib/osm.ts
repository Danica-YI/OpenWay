/**
 * OpenStreetMap ingestion.
 *
 * Turns raw Overpass API output into the building profiles the app renders.
 * Everything here is pure so it can run on the worker and be unit tested.
 */

export type LatLng = [number, number];

export type BBox = { south: number; west: number; north: number; east: number };

/** OSM uses yes/limited/no for accessibility tags; absent means nobody has surveyed it. */
export type AccessLevel = "yes" | "limited" | "no" | "unknown";

export type OsmEntrance = {
  kind: string;
  wheelchair: AccessLevel;
  door: string | null;
  automatic: boolean;
  width: string | null;
  step: string | null;
  /** Compass side of the building, derived from the bearing to the centre. */
  side: string;
  point: LatLng;
};

export type OsmAmenity = {
  id: string;
  type: "toilets" | "elevator" | "parking";
  name: string | null;
  wheelchair: AccessLevel;
  level: string | null;
  detail: string | null;
  point: LatLng;
};

export type MapBuilding = {
  id: string;
  name: string | null;
  kind: string;
  center: LatLng;
  polygon: LatLng[];
  address: string | null;
  levels: string | null;
  openingHours: string | null;
  website: string | null;
  phone: string | null;
  wheelchair: AccessLevel;
  wheelchairNote: string | null;
  toiletsWheelchair: AccessLevel;
  entrances: OsmEntrance[];
  amenities: OsmAmenity[];
  /** How many accessibility facts OSM actually knows. 0 means an empty profile. */
  knownFacts: number;
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  // Third mirror, reached only when both of the above are down. Operated by
  // VK/Mail.ru; it sees the requested bounding box and nothing else.
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/**
 * Give up on the whole lookup rather than hold a pan open indefinitely.
 *
 * Generous, because it has to cover a legitimately slow answer as well as a
 * dead one: a wide city-centre viewport is several thousand footprints and
 * measured at 10.6 s against a healthy mirror. A tighter cap failed those
 * viewports while Overpass was working perfectly well. An outage does not
 * spend this budget — the mirrors are all in flight within 5 s and a refused
 * connection comes back immediately.
 */
const OVERALL_TIMEOUT_MS = 25_000;

/**
 * How long to wait for one mirror before also trying the next, rather than
 * only after it fails. A mirror that accepts the connection and then stalls
 * used to cost its full timeout before anything else was attempted, so a
 * single dead primary made every pan slow.
 */
const HEDGE_DELAY_MS = 2_500;

/**
 * Which mirror answered last. During an outage the first endpoint burns the
 * full timeout on every request otherwise, turning one slow load into a slow
 * load for every pan.
 */
let preferredEndpoint: string | null = null;

function endpointsToTry(): string[] {
  if (!preferredEndpoint) return OVERPASS_ENDPOINTS;
  return [preferredEndpoint, ...OVERPASS_ENDPOINTS.filter((url) => url !== preferredEndpoint)];
}

/** Overpass is a shared free service; keep requests small and bounded. */
export const MAX_BBOX_SPAN = 0.035;

type OverpassNode = { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> };
type OverpassWay = {
  type: "way";
  id: number;
  geometry?: { lat: number; lon: number }[];
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
type OverpassElement = OverpassNode | OverpassWay;

export function parseBBox(raw: string | null): BBox | null {
  if (!raw) return null;
  const parts = raw.split(",").map((value) => Number.parseFloat(value));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [south, west, north, east] = parts;
  if (south >= north || west >= east) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  return { south, west, north, east };
}

export function bboxSpan(bbox: BBox): number {
  return Math.max(bbox.north - bbox.south, bbox.east - bbox.west);
}

function buildQuery(bbox: BBox): string {
  const area = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:25];
way["building"](${area})->.b;
(
  node(w.b)["entrance"];
  node["amenity"="toilets"](${area});
  node["highway"="elevator"](${area});
  node["amenity"="parking"](${area});
)->.p;
.b out geom;
.p out;`;
}

async function askOverpass(endpoint: string, body: URLSearchParams, signal: AbortSignal): Promise<OverpassElement[]> {
  const response = await fetch(endpoint, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Overpass asks that clients identify themselves.
      "User-Agent": "OpenWay/0.1 (accessibility mapping prototype)",
    },
    signal,
  });
  if (!response.ok) throw new Error(`Overpass responded ${response.status}`);
  const payload = (await response.json()) as { elements?: OverpassElement[] };
  preferredEndpoint = endpoint;
  return payload.elements ?? [];
}

/**
 * Ask the mirrors, staggering rather than queueing.
 *
 * Overpass is a free shared service, so the usual request is still a single
 * one: a later mirror is only brought in once an earlier one has had its head
 * start and produced nothing. That keeps the healthy path unchanged while an
 * outage costs seconds instead of the sum of every timeout.
 */
export async function fetchOverpass(bbox: BBox): Promise<OverpassElement[]> {
  const body = new URLSearchParams({ data: buildQuery(bbox) });
  const endpoints = endpointsToTry();
  const controller = new AbortController();
  const overall = setTimeout(() => controller.abort(), OVERALL_TIMEOUT_MS);
  const staggers: ReturnType<typeof setTimeout>[] = [];

  const attempt = (endpoint: string, delay: number) =>
    new Promise<OverpassElement[]>((resolve, reject) => {
      if (delay === 0) {
        askOverpass(endpoint, body, controller.signal).then(resolve, reject);
        return;
      }
      const timer = setTimeout(() => {
        if (controller.signal.aborted) {
          reject(new Error("Overpass lookup cancelled"));
          return;
        }
        askOverpass(endpoint, body, controller.signal).then(resolve, reject);
      }, delay);
      staggers.push(timer);
      controller.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Overpass lookup cancelled"));
      }, { once: true });
    });

  try {
    // Resolves on the first mirror to answer; rejects only if all of them fail.
    return await Promise.any(endpoints.map((endpoint, index) => attempt(endpoint, index * HEDGE_DELAY_MS)));
  } catch (error) {
    // Every mirror failed, so stop preferring whichever one used to work.
    preferredEndpoint = null;
    if (error instanceof AggregateError) throw error.errors[0] ?? new Error("Overpass is unreachable");
    throw error;
  } finally {
    // Whoever answered first, nobody else needs to keep waiting.
    clearTimeout(overall);
    staggers.forEach(clearTimeout);
    controller.abort();
  }
}

function accessLevel(value: string | undefined): AccessLevel {
  if (value === "yes" || value === "designated") return "yes";
  if (value === "limited") return "limited";
  if (value === "no") return "no";
  return "unknown";
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Bearing in degrees (0 = north, clockwise) from one point to another. */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const toRad = Math.PI / 180;
  const [lat1, lon1] = [from[0] * toRad, from[1] * toRad];
  const [lat2, lon2] = [to[0] * toRad, to[1] * toRad];
  const deltaLon = lon2 - lon1;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/** Bearing from the building centre out to a point, expressed as a plain-language side. */
export function compassSide(center: LatLng, point: LatLng): string {
  return COMPASS[Math.round(bearingDegrees(center, point) / 45) % 8];
}

/** The compass word (e.g. "north-east") a free-text side description starts with, if any. */
export function parseCompassWord(text: string): string | null {
  const lower = text.toLowerCase();
  const bySpecificity = [...COMPASS].sort((a, b) => b.length - a.length);
  return bySpecificity.find((word) => lower.startsWith(word)) ?? null;
}

/**
 * The polygon vertex that best represents "the {sideWord} side" of a building —
 * whichever corner sits closest to that compass bearing from the centre. Used to
 * turn a curated profile's free-text entrance side ("West side, facing the...")
 * into an actual routable point, since curated data doesn't carry coordinates.
 */
export function pointOnSide(center: LatLng, polygon: LatLng[], sideWord: string): LatLng | null {
  const targetIndex = COMPASS.indexOf(sideWord);
  if (targetIndex === -1 || !polygon.length) return null;
  const targetAngle = targetIndex * 45;

  // Walk the outline rather than only its corners. Vertices alone put the
  // result on whichever corner happens to face that way, which for a building
  // with a long facade can be tens of metres from the middle of the wall.
  const STEPS = 6;
  let best: LatLng | null = null;
  let bestDelta = Infinity;

  for (let i = 0; i < polygon.length; i += 1) {
    const from = polygon[i];
    const to = polygon[(i + 1) % polygon.length];
    for (let step = 0; step < STEPS; step += 1) {
      const t = step / STEPS;
      const candidate: LatLng = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      const bearing = bearingDegrees(center, candidate);
      const raw = Math.abs(bearing - targetAngle);
      const delta = Math.min(raw, 360 - raw);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = candidate;
      }
    }
  }

  return best ?? polygon[0];
}

export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lonI] = polygon[i];
    const [latJ, lonJ] = polygon[j];
    const straddles = latI > point[0] !== latJ > point[0];
    if (straddles && point[1] < ((lonJ - lonI) * (point[0] - latI)) / (latJ - latI) + lonI) {
      inside = !inside;
    }
  }
  return inside;
}

function centroid(polygon: LatLng[]): LatLng {
  let lat = 0;
  let lon = 0;
  for (const [pointLat, pointLon] of polygon) {
    lat += pointLat;
    lon += pointLon;
  }
  return [lat / polygon.length, lon / polygon.length];
}

const BUILDING_KINDS: Record<string, string> = {
  university: "University building",
  school: "School",
  college: "College",
  hospital: "Hospital",
  retail: "Shop",
  commercial: "Commercial building",
  office: "Office building",
  apartments: "Apartments",
  residential: "Residential building",
  house: "House",
  civic: "Civic building",
  public: "Public building",
  government: "Government building",
  train_station: "Train station",
  transportation: "Transport building",
  hotel: "Hotel",
  church: "Church",
  parliament: "Parliament building",
  kiosk: "Kiosk",
  stage: "Stage",
  sports_centre: "Sports centre",
  supermarket: "Supermarket",
  yes: "Building",
};

function humanKind(tags: Record<string, string>): string {
  if (tags.amenity === "library") return "Library";
  const raw = tags.building ?? "yes";
  return BUILDING_KINDS[raw] ?? raw.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function addressOf(tags: Record<string, string>): string | null {
  const number = tags["addr:housenumber"];
  const street = tags["addr:street"];
  const suburb = tags["addr:suburb"] ?? tags["addr:city"];
  const line = [number && street ? `${number} ${street}` : street, suburb].filter(Boolean).join(", ");
  return line || null;
}

function amenityFor(node: OverpassNode): OsmAmenity | null {
  const tags = node.tags ?? {};
  const type =
    tags.amenity === "toilets" ? "toilets" : tags.highway === "elevator" ? "elevator" : tags.amenity === "parking" ? "parking" : null;
  if (!type) return null;

  const wheelchair = accessLevel(type === "toilets" ? tags["toilets:wheelchair"] ?? tags.wheelchair : tags.wheelchair);
  const detail =
    type === "parking"
      ? tags["capacity:disabled"]
        ? `${tags["capacity:disabled"]} accessible bay(s)`
        : null
      : tags.description ?? tags["wheelchair:description"] ?? null;

  return {
    id: `node/${node.id}`,
    type,
    name: tags.name ?? null,
    wheelchair,
    level: tags.level ?? null,
    detail,
    point: [node.lat, node.lon],
  };
}

const COORD_EPSILON = 1e-7;

/** Convert a raw Overpass response into building profiles. */
export function normalize(elements: OverpassElement[]): MapBuilding[] {
  const ways = elements.filter((element): element is OverpassWay => element.type === "way" && Boolean(element.geometry));
  const nodes = elements.filter((element): element is OverpassNode => element.type === "node");

  const entranceNodes = nodes.filter((node) => node.tags?.entrance);
  const amenityNodes = nodes.map(amenityFor).filter((amenity): amenity is OsmAmenity => amenity !== null);

  return ways
    .filter((way) => way.tags?.building)
    .map((way) => {
      const tags = way.tags ?? {};
      const polygon: LatLng[] = (way.geometry ?? []).map((point) => [point.lat, point.lon]);
      const center: LatLng = way.center ? [way.center.lat, way.center.lon] : centroid(polygon);

      // Entrance nodes are vertices of the building outline, so match on coordinates.
      const entrances: OsmEntrance[] = entranceNodes
        .filter((node) =>
          polygon.some(([lat, lon]) => Math.abs(lat - node.lat) < COORD_EPSILON && Math.abs(lon - node.lon) < COORD_EPSILON),
        )
        .map((node) => {
          const nodeTags = node.tags ?? {};
          const point: LatLng = [node.lat, node.lon];
          return {
            kind: nodeTags.entrance ?? "yes",
            wheelchair: accessLevel(nodeTags.wheelchair),
            door: nodeTags.door ?? null,
            automatic: nodeTags.door === "automatic" || nodeTags.automatic_door === "yes",
            width: nodeTags.width ?? nodeTags["door:width"] ?? null,
            step: nodeTags["step_count"] ?? nodeTags.kerb ?? null,
            side: compassSide(center, point),
            point,
          };
        });

      const amenities = amenityNodes.filter((amenity) => pointInPolygon(amenity.point, polygon));

      const wheelchair = accessLevel(tags.wheelchair);
      const toiletsWheelchair = accessLevel(tags["toilets:wheelchair"]);

      const knownFacts =
        (wheelchair !== "unknown" ? 1 : 0) +
        (toiletsWheelchair !== "unknown" ? 1 : 0) +
        (tags["wheelchair:description"] ? 1 : 0) +
        entrances.length +
        amenities.length;

      return {
        id: `way/${way.id}`,
        name: tags.name ?? null,
        kind: humanKind(tags),
        center,
        polygon,
        address: addressOf(tags),
        levels: tags["building:levels"] ?? null,
        openingHours: tags.opening_hours ?? null,
        website: tags.website ?? tags["contact:website"] ?? null,
        phone: tags.phone ?? tags["contact:phone"] ?? null,
        wheelchair,
        wheelchairNote: tags["wheelchair:description"] ?? null,
        toiletsWheelchair,
        entrances,
        amenities,
        knownFacts,
      };
    });
}
