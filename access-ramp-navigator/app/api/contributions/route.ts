import { desc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { accessibilityContributions, users } from "../../../db/schema";
import { currentUser, publicName } from "../../../lib/auth";
import { getPhotoBucket, MAX_PHOTO_BYTES } from "../../../lib/photos";

const CATEGORIES = new Set(["Ramp", "Accessible entrance", "Accessible toilet", "Lift", "Parking", "Door", "Other"]);

/**
 * Contributions are keyed by OpenStreetMap id, so any building on the map can
 * be reported on — not just a fixed list we shipped.
 */
const BUILDING_ID = /^(way|relation|node)\/\d{1,15}$/;

function isBuildingId(value: string): boolean {
  return BUILDING_ID.test(value);
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function formNumber(value: FormDataEntryValue | null): number {
  return typeof value === "string" ? Number(value) : Number.NaN;
}

function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Who to credit. An account is shown as "Jason Z."; anonymous reports and
 * signed-out reports are shown as "Community member". The author's full name
 * is never returned to other readers.
 */
function credit(row: { anonymous: boolean; storedName: string; authorName: string | null }): string {
  if (row.anonymous) return "Community member";
  if (row.authorName) return publicName(row.authorName);
  return row.storedName;
}

export async function GET(request: Request) {
  try {
    const buildingId = new URL(request.url).searchParams.get("buildingId") ?? "";
    if (!isBuildingId(buildingId)) return Response.json({ error: "Unknown building" }, { status: 400 });
    await ensureSchema();
    const db = await getDb();

    const rows = await db
      .select({
        id: accessibilityContributions.id,
        buildingId: accessibilityContributions.buildingId,
        category: accessibilityContributions.category,
        location: accessibilityContributions.location,
        details: accessibilityContributions.details,
        latitude: accessibilityContributions.latitude,
        longitude: accessibilityContributions.longitude,
        photoKey: accessibilityContributions.photoKey,
        photoLatitude: accessibilityContributions.photoLatitude,
        photoLongitude: accessibilityContributions.photoLongitude,
        photoAccuracy: accessibilityContributions.photoAccuracy,
        photoCapturedAt: accessibilityContributions.photoCapturedAt,
        status: accessibilityContributions.status,
        createdAt: accessibilityContributions.createdAt,
        anonymous: accessibilityContributions.anonymous,
        storedName: accessibilityContributions.contributor,
        authorName: users.displayName,
        authorId: accessibilityContributions.userId,
      })
      .from(accessibilityContributions)
      .leftJoin(users, eq(accessibilityContributions.userId, users.id))
      .where(eq(accessibilityContributions.buildingId, buildingId))
      .orderBy(desc(accessibilityContributions.createdAt), desc(accessibilityContributions.id))
      .limit(30);

    const viewer = await currentUser(request);
    const contributions = rows.map(({ storedName, authorName, authorId, anonymous, photoKey, ...rest }) => ({
      ...rest,
      photoUrl: photoKey ? `/api/contributions/photo?id=${rest.id}` : null,
      contributor: credit({ anonymous, storedName, authorName }),
      mine: viewer != null && authorId === viewer.id,
    }));

    return Response.json({ contributions });
  } catch {
    return Response.json({ error: "Community information is temporarily unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let storedPhotoKey: string | null = null;
  try {
    const payload = await request.formData();
    const buildingId = cleanText(payload.get("buildingId"), 40);
    const buildingName = cleanText(payload.get("buildingName"), 120) || null;
    const category = cleanText(payload.get("category"), 40);
    const location = cleanText(payload.get("location"), 140);
    const details = cleanText(payload.get("details"), 800);
    const latitude = formNumber(payload.get("latitude"));
    const longitude = formNumber(payload.get("longitude"));
    const anonymous = payload.get("anonymous") === "true";
    const photo = payload.get("photo");
    const photoLatitude = formNumber(payload.get("photoLatitude"));
    const photoLongitude = formNumber(payload.get("photoLongitude"));
    const photoAccuracy = formNumber(payload.get("photoAccuracy"));
    const photoCapturedAt = cleanText(payload.get("photoCapturedAt"), 40) || null;

    if (!isBuildingId(buildingId)) return Response.json({ error: "Choose a building on the map first" }, { status: 400 });
    if (!CATEGORIES.has(category)) return Response.json({ error: "Choose a valid accessibility feature" }, { status: 400 });
    if (location.length < 3 || details.length < 10) {
      return Response.json({ error: "Add an exact location and useful detail" }, { status: 400 });
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return Response.json({ error: "Place the exact accessibility point on the map" }, { status: 400 });
    }
    if (photo instanceof File) {
      if (photo.type !== "image/jpeg" || photo.size < 1 || photo.size > MAX_PHOTO_BYTES) {
        return Response.json({ error: "The camera photo must be a JPEG smaller than 5 MB" }, { status: 400 });
      }
      if (!Number.isFinite(photoLatitude) || photoLatitude < -90 || photoLatitude > 90 || !Number.isFinite(photoLongitude) || photoLongitude < -180 || photoLongitude > 180 || !photoCapturedAt) {
        return Response.json({ error: "Precise camera location is required for the photo" }, { status: 400 });
      }
      if (!Number.isFinite(photoAccuracy) || photoAccuracy <= 0 || photoAccuracy > 100) {
        return Response.json({ error: "The camera location is not accurate enough. Move outdoors or closer to a window and try again" }, { status: 400 });
      }
      const allowedPinDistance = Math.max(30, Math.min(100, photoAccuracy * 2));
      if (distanceMetres(latitude, longitude, photoLatitude, photoLongitude) > allowedPinDistance) {
        return Response.json({ error: "The accessibility pin is too far from where the photo was taken" }, { status: 400 });
      }
    }

    await ensureSchema();
    const author = await currentUser(request);
    const db = await getDb();
    if (photo instanceof File) {
      storedPhotoKey = `contributions/${crypto.randomUUID()}.jpg`;
      await (await getPhotoBucket()).put(storedPhotoKey, photo.stream(), {
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: { capturedAt: photoCapturedAt! },
      });
    }

    const [saved] = await db
      .insert(accessibilityContributions)
      .values({
        buildingId,
        buildingName,
        category,
        location,
        details,
        latitude,
        longitude,
        photoKey: storedPhotoKey,
        photoContentType: storedPhotoKey ? "image/jpeg" : null,
        photoLatitude: storedPhotoKey ? photoLatitude : null,
        photoLongitude: storedPhotoKey ? photoLongitude : null,
        photoAccuracy: storedPhotoKey ? photoAccuracy : null,
        photoCapturedAt: storedPhotoKey ? photoCapturedAt : null,
        userId: author?.id ?? null,
        anonymous,
        // Kept for rows with no account behind them.
        contributor: "Community member",
        status: "pending_review",
      })
      .returning();

    return Response.json(
      {
        contribution: {
          id: saved.id,
          buildingId: saved.buildingId,
          category: saved.category,
          location: saved.location,
          details: saved.details,
          latitude: saved.latitude,
          longitude: saved.longitude,
          photoUrl: saved.photoKey ? `/api/contributions/photo?id=${saved.id}` : null,
          photoLatitude: saved.photoLatitude,
          photoLongitude: saved.photoLongitude,
          photoAccuracy: saved.photoAccuracy,
          photoCapturedAt: saved.photoCapturedAt,
          status: saved.status,
          createdAt: saved.createdAt,
          contributor: credit({ anonymous, storedName: "Community member", authorName: author?.displayName ?? null }),
          mine: author != null,
        },
      },
      { status: 201 },
    );
  } catch {
    if (storedPhotoKey) {
      try {
        await (await getPhotoBucket()).delete(storedPhotoKey);
      } catch {
        // Best-effort cleanup; preserve the original submission error.
      }
    }
    return Response.json({ error: "The contribution could not be saved" }, { status: 500 });
  }
}
