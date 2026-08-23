import { desc, eq, inArray, sql } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { accessibilityContributions, contributionReports } from "../../../../db/schema";
import { currentUser, readSessionToken } from "../../../../lib/auth";

/** The signed-in person's own reports, including the ones posted anonymously. */
export async function GET(request: Request) {
  try {
    if (!readSessionToken(request)) return Response.json({ error: "Sign in first" }, { status: 401 });
    await ensureSchema();
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });

    const db = await getDb();
    const rows = await db
      .select({
        id: accessibilityContributions.id,
        buildingId: accessibilityContributions.buildingId,
        buildingName: accessibilityContributions.buildingName,
        category: accessibilityContributions.category,
        location: accessibilityContributions.location,
        details: accessibilityContributions.details,
        status: accessibilityContributions.status,
        anonymous: accessibilityContributions.anonymous,
        photoKey: accessibilityContributions.photoKey,
        createdAt: accessibilityContributions.createdAt,
      })
      .from(accessibilityContributions)
      .where(eq(accessibilityContributions.userId, user.id))
      .orderBy(desc(accessibilityContributions.createdAt), desc(accessibilityContributions.id))
      .limit(100);

    // Worth seeing on your own profile: someone thinks a detail you added is
    // wrong, and you are the person best placed to correct it.
    const ids = rows.map((row) => row.id);
    const flagged = ids.length
      ? await db
          .select({ contributionId: contributionReports.contributionId, total: sql<number>`count(*)` })
          .from(contributionReports)
          .where(inArray(contributionReports.contributionId, ids))
          .groupBy(contributionReports.contributionId)
      : [];
    const counts = new Map(flagged.map((row) => [row.contributionId, Number(row.total)]));
    const contributions = rows.map(({ photoKey, ...row }) => ({
      ...row,
      photoUrl: photoKey ? `/api/contributions/photo?id=${row.id}` : null,
      reportCount: counts.get(row.id) ?? 0,
    }));

    return Response.json({ contributions });
  } catch {
    return Response.json({ error: "Your contributions are temporarily unavailable" }, { status: 500 });
  }
}
