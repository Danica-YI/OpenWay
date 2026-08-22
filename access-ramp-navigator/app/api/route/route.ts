import type { LatLng } from "../../../lib/osm";
import { fetchWalkingRoute } from "../../../lib/routing";

/**
 * Walking directions between two points, from OpenStreetMap.
 *
 * Proxied through the worker for the same reasons as /api/buildings: keeps
 * the routing service key-free, avoids CORS, and lets identical from/to
 * pairs share one cached response.
 */

const CACHE_SECONDS = 3600;

function parseLatLng(raw: string | null): LatLng | null {
  if (!raw) return null;
  const parts = raw.split(",").map((value) => Number.parseFloat(value));
  if (parts.length !== 2 || parts.some((value) => !Number.isFinite(value))) return null;
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

function cacheKeyFor(request: Request, from: LatLng, to: LatLng): string {
  const round = (value: number) => value.toFixed(5);
  const url = new URL(request.url);
  url.search = `?from=${round(from[0])},${round(from[1])}&to=${round(to[0])},${round(to[1])}`;
  return url.toString();
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = parseLatLng(params.get("from"));
  const to = parseLatLng(params.get("to"));
  if (!from || !to) {
    return Response.json({ error: "Valid from and to lat,lng points are required" }, { status: 400 });
  }

  const cacheKey = new Request(cacheKeyFor(request, from, to), { method: "GET" });
  // Versioned so a response-shape change (e.g. adding a field) can never be served
  // stale from a cache entry written by older code — bump the suffix when it does.
  const cache = typeof caches !== "undefined" ? await caches.open("osrm-routes-v2").catch(() => null) : null;

  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) {
    return new Response(cached.body, { status: cached.status, headers: new Headers(cached.headers) });
  }

  try {
    const route = await fetchWalkingRoute(from, to);
    if (!route) {
      return Response.json({ error: "No walking route was found between these points" }, { status: 404 });
    }
    const response = Response.json(route, { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` } });
    await cache?.put(cacheKey, response.clone()).catch(() => undefined);
    return response;
  } catch {
    return Response.json({ error: "Walking directions are temporarily unavailable. Try again in a moment." }, { status: 503 });
  }
}
