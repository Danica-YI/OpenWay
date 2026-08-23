import { inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { accessibilityContributions } from "../../../../db/schema";

const BUILDING_ID = /^(way|relation|node)\/\d{1,15}$/;
const MAX_IDS = 400;

/**
 * How many community reports exist for each building in view, so the map can
 * show where people have already contributed.
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json() as { ids?: unknown };
    const ids = Array.isArray(payload.ids)
      ? payload.ids.filter((id): id is string => typeof id === "string" && BUILDING_ID.test(id)).slice(0, MAX_IDS)
      : [];
    if (!ids.length) return Response.json({ counts: {} });

    const db = await getDb();
    const rows = await db
      .select({ buildingId: accessibilityContributions.buildingId, total: sql<number>`count(*)` })
      .from(accessibilityContributions)
      .where(inArray(accessibilityContributions.buildingId, ids))
      .groupBy(accessibilityContributions.buildingId);

    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.buildingId] = Number(row.total);
    return Response.json({ counts });
  } catch {
    // A missing count is cosmetic; never block the map on it.
    return Response.json({ counts: {} });
  }
}
