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
];

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

export async function fetchOverpass(bbox: BBox): Promise<OverpassElement[]> {
  const body = new URLSearchParams({ data: buildQuery(bbox) });
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass asks that clients identify themselves.
          "User-Agent": "AccessRampNavigator/0.1 (accessibility mapping prototype)",
        },
      });
      if (!response.ok) {
        lastError = new Error(`Overpass responded ${response.status}`);
        continue;
      }
      const payload = (await response.json()) as { elements?: OverpassElement[] };
      return payload.elements ?? [];
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Overpass is unreachable");
}

function accessLevel(value: string | undefined): AccessLevel {
  if (value === "yes" || value === "designated") return "yes";
  if (value === "limited") return "limited";
  if (value === "no") return "no";
  return "unknown";
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Bearing from the building centre out to a point, expressed as a plain-language side. */
export function compassSide(center: LatLng, point: LatLng): string {
  const toRad = Math.PI / 180;
  const [lat1, lon1] = [center[0] * toRad, center[1] * toRad];
  const [lat2, lon2] = [point[0] * toRad, point[1] * toRad];
  const deltaLon = lon2 - lon1;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  const normalized = (bearing + 360) % 360;
  return COMPASS[Math.round(normalized / 45) % 8];
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
