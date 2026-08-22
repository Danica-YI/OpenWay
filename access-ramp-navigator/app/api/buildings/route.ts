import { MAX_BBOX_SPAN, bboxSpan, fetchOverpass, normalize, parseBBox } from "../../../lib/osm";

/**
 * Buildings in view, from OpenStreetMap.
 *
 * Proxied through the worker so the browser never talks to Overpass directly:
 * that keeps the API key-free, avoids CORS, and lets one cached response serve
 * every visitor looking at the same part of the map.
 */

const CACHE_SECONDS = 3600;

/** Round the viewport to a grid so nearby pans reuse one cached response. */
function cacheKeyFor(request: Request, bbox: ReturnType<typeof parseBBox>): string {
  if (!bbox) return request.url;
  const round = (value: number) => (Math.round(value * 500) / 500).toFixed(3);
  const url = new URL(request.url);
  url.search = `?bbox=${round(bbox.south)},${round(bbox.west)},${round(bbox.north)},${round(bbox.east)}`;
  return url.toString();
}

export async function GET(request: Request) {
  const bbox = parseBBox(new URL(request.url).searchParams.get("bbox"));
  if (!bbox) {
    return Response.json({ error: "A valid bbox of south,west,north,east is required" }, { status: 400 });
  }
  if (bboxSpan(bbox) > MAX_BBOX_SPAN) {
    return Response.json({ error: "Zoom in to load buildings", buildings: [], zoomIn: true }, { status: 200 });
  }

  const cacheKey = new Request(cacheKeyFor(request, bbox), { method: "GET" });
  const cache = typeof caches !== "undefined" ? await caches.open("osm-buildings").catch(() => null) : null;

  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) {
    // A Response straight out of the cache has immutable headers, which breaks
    // the framework's own header handling downstream. Hand back a fresh copy.
    return new Response(cached.body, { status: cached.status, headers: new Headers(cached.headers) });
  }

  try {
    const buildings = normalize(await fetchOverpass(bbox));
    const response = Response.json(
      { buildings },
      { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` } },
    );
    await cache?.put(cacheKey, response.clone()).catch(() => undefined);
    return response;
  } catch {
    return Response.json(
      { error: "OpenStreetMap data is temporarily unavailable. Try again in a moment.", buildings: [] },
      { status: 503 },
    );
  }
}
