import { desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { accessibilityContributions } from "../../../db/schema";

const CATEGORIES = new Set(["Ramp", "Accessible entrance", "Accessible toilet", "Lift", "Parking", "Door", "Other"]);

/**
 * Contributions are keyed by OpenStreetMap id, so any building on the map can
 * be reported on — not just a fixed list we shipped.
 */
const BUILDING_ID = /^(way|relation|node)\/\d{1,15}$/;

function isBuildingId(value: string): boolean {
  return BUILDING_ID.test(value);
}

async function ensureSchema() {
  const d1 = await getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS accessibility_contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building_id TEXT NOT NULL,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      details TEXT NOT NULL,
      contributor TEXT NOT NULL DEFAULT 'Community member',
      latitude REAL,
      longitude REAL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS contribution_building_idx ON accessibility_contributions (building_id, created_at)"),
  ]);

  // Local prototypes may already have the earlier table in their persisted
  // Wrangler state. Upgrade it in place as well as shipping the normal D1
  // migration, so contributors do not have to delete their local database.
  const columns = await d1.prepare("PRAGMA table_info(accessibility_contributions)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  for (const [name, definition] of [["latitude", "latitude REAL"], ["longitude", "longitude REAL"]] as const) {
    if (names.has(name)) continue;
    try {
      await d1.prepare(`ALTER TABLE accessibility_contributions ADD COLUMN ${definition}`).run();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.toLowerCase().includes("duplicate column")) throw error;
    }
  }
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function contributorName(request: Request, supplied: unknown) {
  const provided = cleanText(supplied, 60);
  if (provided) return provided;
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (encoded && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { return decodeURIComponent(encoded).slice(0, 60); } catch { /* use fallback */ }
  }
  return "Community member";
}

export async function GET(request: Request) {
  try {
    const buildingId = new URL(request.url).searchParams.get("buildingId") ?? "";
    if (!isBuildingId(buildingId)) return Response.json({ error: "Unknown building" }, { status: 400 });
    await ensureSchema();
    const db = await getDb();
    const rows = await db.select().from(accessibilityContributions)
      .where(eq(accessibilityContributions.buildingId, buildingId))
      .orderBy(desc(accessibilityContributions.createdAt), desc(accessibilityContributions.id))
      .limit(30);
    return Response.json({ contributions: rows });
  } catch {
    return Response.json({ error: "Community information is temporarily unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const buildingId = cleanText(payload.buildingId, 40);
    const category = cleanText(payload.category, 40);
    const location = cleanText(payload.location, 140);
    const details = cleanText(payload.details, 800);
    const latitude = typeof payload.latitude === "number" ? payload.latitude : Number.NaN;
    const longitude = typeof payload.longitude === "number" ? payload.longitude : Number.NaN;
    if (!isBuildingId(buildingId)) return Response.json({ error: "Choose a building on the map first" }, { status: 400 });
    if (!CATEGORIES.has(category)) return Response.json({ error: "Choose a valid accessibility feature" }, { status: 400 });
    if (location.length < 3 || details.length < 10) return Response.json({ error: "Add an exact location and useful detail" }, { status: 400 });
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return Response.json({ error: "Place the exact accessibility point on the map" }, { status: 400 });
    }

    await ensureSchema();
    const db = await getDb();
    const [contribution] = await db.insert(accessibilityContributions).values({
      buildingId, category, location, details, latitude, longitude,
      contributor: contributorName(request, payload.contributor),
      status: "pending_review",
    }).returning();
    return Response.json({ contribution }, { status: 201 });
  } catch {
    return Response.json({ error: "The contribution could not be saved" }, { status: 500 });
  }
}
