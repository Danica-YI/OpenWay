import { ensureSchema } from "../../../../db";
import { clearedCookie, destroySession, readSessionToken } from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const token = readSessionToken(request);
    if (token) {
      await ensureSchema();
      await destroySession(token);
    }
  } catch {
    /* clearing the cookie below still signs them out of this browser */
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedCookie(request) } });
}
