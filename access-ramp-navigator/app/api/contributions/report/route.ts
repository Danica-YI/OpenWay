import { and, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { accessibilityContributions, contributionReports } from "../../../../db/schema";
import { currentUser } from "../../../../lib/auth";
import { REPORT_REASONS } from "../../../../lib/moderation";

const REASONS = new Set(REPORT_REASONS);

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const contributionId = typeof payload.contributionId === "number" ? payload.contributionId : Number.NaN;
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    const details = typeof payload.details === "string" ? payload.details.trim().slice(0, 400) : "";

    if (!Number.isInteger(contributionId) || contributionId < 1) {
      return Response.json({ error: "Choose the report you are flagging" }, { status: 400 });
    }
    if (!REASONS.has(reason)) return Response.json({ error: "Choose a reason" }, { status: 400 });

    await ensureSchema();
    const db = await getDb();

    // Flagging a row that is already gone should not create an orphan.
    const [target] = await db
      .select({ id: accessibilityContributions.id })
      .from(accessibilityContributions)
      .where(eq(accessibilityContributions.id, contributionId))
      .limit(1);
    if (!target) return Response.json({ error: "That report has already been removed" }, { status: 404 });

    const reporter = await currentUser(request);

    // One flag per person per contribution: a second click should not make
    // something look more disputed than it is.
    if (reporter) {
      const [existing] = await db
        .select({ id: contributionReports.id })
        .from(contributionReports)
        .where(and(eq(contributionReports.contributionId, contributionId), eq(contributionReports.userId, reporter.id)))
        .limit(1);
      if (existing) return Response.json({ alreadyReported: true }, { status: 200 });
    }

    await db.insert(contributionReports).values({
      contributionId,
      userId: reporter?.id ?? null,
      reason,
      details: details || null,
    });

    return Response.json({ reported: true }, { status: 201 });
  } catch {
    return Response.json({ error: "Could not flag that report just now" }, { status: 500 });
  }
}
