import { desc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { accessibilityContributions, users } from "../../../db/schema";
import { currentUser, publicName } from "../../../lib/auth";

const CATEGORIES = new Set(["Ramp", "Accessible entrance", "Accessible toilet", "Lift", "Parking", "Door", "Other"]);

/**
 * Contributions are keyed by OpenStreetMap id, so any building on the map can
 * be reported on — not just a fixed list we shipped.
 */
const BUILDING_ID = /^(way|relation|node)\/\d{1,15}$/;

function isBuildingId(value: string): boolean {
  return BUILDING_ID.test(value);
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Who to credit. An account is shown as "Jason Z."; anonymous reports and
 * signed-out reports are shown as "Community member". The author's full name
 * is never returned to other readers.
 */
function credit(row: { anonymous: boolean; storedName: string; authorName: string | null }): string {
  if (row.anonymous) return "Community member";
  if (row.authorName) return publicName(row.authorName);
  return row.storedName;
}

export async function GET(request: Request) {
  try {
    const buildingId = new URL(request.url).searchParams.get("buildingId") ?? "";
    if (!isBuildingId(buildingId)) return Response.json({ error: "Unknown building" }, { status: 400 });
    await ensureSchema();

    const rows = await getDb()
      .select({
        id: accessibilityContributions.id,
        buildingId: accessibilityContributions.buildingId,
        category: accessibilityContributions.category,
        location: accessibilityContributions.location,
        details: accessibilityContributions.details,
        status: accessibilityContributions.status,
        createdAt: accessibilityContributions.createdAt,
        anonymous: accessibilityContributions.anonymous,
        storedName: accessibilityContributions.contributor,
        authorName: users.displayName,
        authorId: accessibilityContributions.userId,
      })
      .from(accessibilityContributions)
      .leftJoin(users, eq(accessibilityContributions.userId, users.id))
      .where(eq(accessibilityContributions.buildingId, buildingId))
      .orderBy(desc(accessibilityContributions.createdAt), desc(accessibilityContributions.id))
      .limit(30);

    const viewer = await currentUser(request);
    const contributions = rows.map(({ storedName, authorName, authorId, anonymous, ...rest }) => ({
      ...rest,
      contributor: credit({ anonymous, storedName, authorName }),
      mine: viewer != null && authorId === viewer.id,
    }));

    return Response.json({ contributions });
  } catch {
    return Response.json({ error: "Community information is temporarily unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const buildingId = cleanText(payload.buildingId, 40);
    const buildingName = cleanText(payload.buildingName, 120) || null;
    const category = cleanText(payload.category, 40);
    const location = cleanText(payload.location, 140);
    const details = cleanText(payload.details, 800);
    const anonymous = payload.anonymous === true;

    if (!isBuildingId(buildingId)) return Response.json({ error: "Choose a building on the map first" }, { status: 400 });
    if (!CATEGORIES.has(category)) return Response.json({ error: "Choose a valid accessibility feature" }, { status: 400 });
    if (location.length < 3 || details.length < 10) {
      return Response.json({ error: "Add an exact location and useful detail" }, { status: 400 });
    }

    await ensureSchema();
    const author = await currentUser(request);

    const [saved] = await getDb()
      .insert(accessibilityContributions)
      .values({
        buildingId,
        buildingName,
        category,
        location,
        details,
        userId: author?.id ?? null,
        anonymous,
        // Kept for rows with no account behind them.
        contributor: "Community member",
        status: "pending_review",
      })
      .returning();

    return Response.json(
      {
        contribution: {
          id: saved.id,
          buildingId: saved.buildingId,
          category: saved.category,
          location: saved.location,
          details: saved.details,
          status: saved.status,
          createdAt: saved.createdAt,
          contributor: credit({ anonymous, storedName: "Community member", authorName: author?.displayName ?? null }),
          mine: author != null,
        },
      },
      { status: 201 },
    );
  } catch {
    return Response.json({ error: "The contribution could not be saved" }, { status: 500 });
  }
}
