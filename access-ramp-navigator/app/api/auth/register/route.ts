import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { createSession, hashPassword, isEmail, publicName, sessionCookie } from "../../../../lib/auth";

const MIN_PASSWORD = 8;

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const displayName = typeof payload.displayName === "string" ? payload.displayName.trim().slice(0, 60) : "";
    const password = typeof payload.password === "string" ? payload.password : "";

    if (!isEmail(email)) return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    if (displayName.length < 2) return Response.json({ error: "Enter the name you want shown" }, { status: 400 });
    if (password.length < MIN_PASSWORD) {
      return Response.json({ error: `Use at least ${MIN_PASSWORD} characters for your password` }, { status: 400 });
    }

    await ensureSchema();
    const db = await getDb();
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) return Response.json({ error: "That email already has an account" }, { status: 409 });

    const { hash, salt } = await hashPassword(password);
    const [account] = await db
      .insert(users)
      .values({ email, displayName, passwordHash: hash, passwordSalt: salt })
      .returning({ id: users.id, email: users.email, displayName: users.displayName });

    const token = await createSession(account.id);
    return Response.json(
      { user: { ...account, publicName: publicName(account.displayName) } },
      { status: 201, headers: { "Set-Cookie": sessionCookie(request, token) } },
    );
  } catch {
    return Response.json({ error: "The account could not be created" }, { status: 500 });
  }
}
