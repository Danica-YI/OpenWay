import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { createSession, isEmail, publicName, sessionCookie, verifyPassword } from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!isEmail(email) || !password) {
      return Response.json({ error: "Enter your email and password" }, { status: 400 });
    }

    await ensureSchema();
    const [account] = await (await getDb()).select().from(users).where(eq(users.email, email)).limit(1);

    // One message for both a missing account and a wrong password, so this
    // endpoint cannot be used to discover which emails are registered.
    const invalid = Response.json({ error: "Those details do not match an account" }, { status: 401 });
    if (!account) return invalid;
    if (!(await verifyPassword(password, account.passwordHash, account.passwordSalt))) return invalid;

    const token = await createSession(account.id);
    return Response.json(
      {
        user: {
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          publicName: publicName(account.displayName),
        },
      },
      { headers: { "Set-Cookie": sessionCookie(request, token) } },
    );
  } catch {
    return Response.json({ error: "Sign in is temporarily unavailable" }, { status: 500 });
  }
}
