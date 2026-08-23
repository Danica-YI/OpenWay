/**
 * Walking directions, from OSRM's public foot-routing instance.
 *
 * Turns two points into the geometry of an actual walkable path (footways,
 * paths, road crossings) instead of a straight line between them, plus
 * turn-by-turn steps generated from that same path. This is general
 * pedestrian routing, not wheelchair-specific: OSRM's foot profile doesn't
 * avoid stairs, so the result is a real route, not a confirmed step-free one.
 */

import type { LatLng } from "./osm";

const OSRM_FOOT_ENDPOINT = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";

export type RouteStep = {
  instruction: string;
  distanceMetres: number;
};

export type WalkingRoute = {
  points: LatLng[];
  distanceMetres: number;
  durationSeconds: number;
  steps: RouteStep[];
};

type OsrmManeuver = { type: string; modifier?: string };
type OsrmStep = { maneuver: OsrmManeuver; name: string; distance: number };
type OsrmResponse = {
  code: string;
  routes?: {
    geometry: { coordinates: [number, number][] };
    distance: number;
    duration: number;
    legs: { steps: OsrmStep[] }[];
  }[];
};

const TURN_WORD: Record<string, string> = {
  uturn: "Make a U-turn",
  "sharp right": "Turn sharp right",
  right: "Turn right",
  "slight right": "Bear right",
  straight: "Continue straight",
  "slight left": "Bear left",
  left: "Turn left",
  "sharp left": "Turn sharp left",
};

/** Turns one OSRM maneuver into a plain-language instruction. */
function instructionFor(step: OsrmStep): string {
  const { type, modifier } = step.maneuver;
  const onto = step.name ? ` onto ${step.name}` : "";

  if (type === "depart") return step.name ? `Head toward ${step.name}` : "Start walking";
  if (type === "arrive") return "Arrive at the destination";
  if (type === "roundabout" || type === "rotary" || type === "exit roundabout" || type === "exit rotary") {
    return `Go through the roundabout${onto}`;
  }
  if (type === "new name" || type === "continue") return step.name ? `Continue onto ${step.name}` : "Continue straight";
  if (modifier) return `${TURN_WORD[modifier] ?? "Continue"}${onto}`;
  return step.name ? `Continue onto ${step.name}` : "Continue";
}

export async function fetchWalkingRoute(from: LatLng, to: LatLng): Promise<WalkingRoute | null> {
  const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url = `${OSRM_FOOT_ENDPOINT}/${coords}?overview=full&geometries=geojson&steps=true`;

  const response = await fetch(url, { headers: { "User-Agent": "OpenWay/0.1 (accessibility mapping prototype)" } });
  if (!response.ok) return null;

  const payload = (await response.json()) as OsrmResponse;
  const route = payload.routes?.[0];
  if (payload.code !== "Ok" || !route) return null;

  const steps: RouteStep[] = route.legs
    .flatMap((leg) => leg.steps)
    .map((step) => ({ instruction: instructionFor(step), distanceMetres: step.distance }));

  return {
    points: route.geometry.coordinates.map(([lon, lat]) => [lat, lon] as LatLng),
    distanceMetres: route.distance,
    durationSeconds: route.duration,
    steps,
  };
}
