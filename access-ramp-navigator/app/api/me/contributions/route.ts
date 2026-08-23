import { desc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { accessibilityContributions } from "../../../../db/schema";
import { currentUser, readSessionToken } from "../../../../lib/auth";

/** The signed-in person's own reports, including the ones posted anonymously. */
export async function GET(request: Request) {
  try {
    if (!readSessionToken(request)) return Response.json({ error: "Sign in first" }, { status: 401 });
    await ensureSchema();
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });

    const db = await getDb();
    const contributions = await db
      .select({
        id: accessibilityContributions.id,
        buildingId: accessibilityContributions.buildingId,
        buildingName: accessibilityContributions.buildingName,
        category: accessibilityContributions.category,
        location: accessibilityContributions.location,
        details: accessibilityContributions.details,
        status: accessibilityContributions.status,
        anonymous: accessibilityContributions.anonymous,
        createdAt: accessibilityContributions.createdAt,
      })
      .from(accessibilityContributions)
      .where(eq(accessibilityContributions.userId, user.id))
      .orderBy(desc(accessibilityContributions.createdAt), desc(accessibilityContributions.id))
      .limit(100);

    return Response.json({ contributions });
  } catch {
    return Response.json({ error: "Your contributions are temporarily unavailable" }, { status: 500 });
  }
}
