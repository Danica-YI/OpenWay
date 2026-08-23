import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { accessibilityContributions } from "../../../../db/schema";
import { getPhotoBucket } from "../../../../lib/photos";

export async function GET(request: Request) {
  const id = Number.parseInt(new URL(request.url).searchParams.get("id") ?? "", 10);
  if (!Number.isSafeInteger(id) || id < 1) return new Response("Not found", { status: 404 });

  await ensureSchema();
  const db = await getDb();
  const [photo] = await db
    .select({ key: accessibilityContributions.photoKey, contentType: accessibilityContributions.photoContentType })
    .from(accessibilityContributions)
    .where(eq(accessibilityContributions.id, id))
    .limit(1);
  if (!photo?.key) return new Response("Not found", { status: 404 });

  const object = await (await getPhotoBucket()).get(photo.key);
  if (!object) return new Response("Not found", { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": photo.contentType ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
