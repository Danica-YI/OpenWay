import { ensureSchema } from "../../../../db";
import { currentUser, publicName, readSessionToken } from "../../../../lib/auth";

export async function GET(request: Request) {
  try {
    if (!readSessionToken(request)) return Response.json({ user: null });
    await ensureSchema();
    const user = await currentUser(request);
    return Response.json({ user: user ? { ...user, publicName: publicName(user.displayName) } : null });
  } catch {
    return Response.json({ user: null });
  }
}
