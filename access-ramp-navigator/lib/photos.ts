export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export async function getPhotoBucket(): Promise<R2Bucket> {
  const { env } = await import("cloudflare:workers");
  if (!env.PHOTOS) throw new Error("Cloudflare R2 binding `PHOTOS` is unavailable.");
  return env.PHOTOS;
}
