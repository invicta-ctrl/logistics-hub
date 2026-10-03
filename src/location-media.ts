import { type Actor, BUMP_REVISION, InputError, audit } from "./inventory";
import { CHANGED, MEDIA_ID, VARIANTS, type Variant, dropObjects, expectedPhoto, key, readVariant } from "./item-media";

/*
 * A place's reference picture (V1.4): one per place, shared by every item kept there. The objects live in the catalog bucket
 * under locations/<media id>/display and /thumb; locations.media_id is the only reference, a replacement gets a new id, and the
 * write order is the item photos' (objects first, one D1 batch to switch, old objects last). Changing the picture leaves
 * locations.updated_at alone, so an open edit form of the same place is not made stale by it.
 */

/** Adds or replaces a place's picture; only if the place still has the picture the client saw. */
export async function putLocationPhoto(db: D1Database, bucket: R2Bucket, actor: Actor, locationId: string, form: FormData) {
  const expected = expectedPhoto(form.get("expected"));
  const display = await readVariant(form, "display");
  const thumb = await readVariant(form, "thumb");
  if (!await db.prepare("SELECT 1 FROM locations WHERE id = ?").bind(locationId).first()) throw new InputError(404, "Place not found.");
  const mediaId = crypto.randomUUID();
  try {
    await bucket.put(key(mediaId, "display", "locations"), display.bytes, { httpMetadata: { contentType: "image/jpeg" } });
    await bucket.put(key(mediaId, "thumb", "locations"), thumb.bytes, { httpMetadata: { contentType: "image/jpeg" } });
    const [write] = await db.batch([
      db.prepare("UPDATE locations SET media_id = ?, media_width = ?, media_height = ? WHERE id = ? AND media_id IS ?").bind(mediaId, display.width, display.height, locationId, expected),
      audit(db, actor.accountId, expected ? "LOCATION_PHOTO_REPLACED" : "LOCATION_PHOTO_ADDED", "LOCATION", locationId, { mediaId }, true),
      db.prepare(`${BUMP_REVISION} AND changes() > 0`)
    ]);
    if (!write!.meta.changes) throw new InputError(409, CHANGED);
  } catch (error) {
    // After a lost answer D1 may already point at these files: keep them whenever the reference may exist.
    const referenced = error instanceof InputError ? false : await db.prepare("SELECT 1 FROM locations WHERE media_id = ?").bind(mediaId).first().then(Boolean, () => true);
    if (!referenced) await dropObjects(bucket, mediaId, "locations");
    throw error;
  }
  if (expected) await dropObjects(bucket, expected, "locations");
  return { photo: { id: mediaId, width: display.width, height: display.height } };
}

/** Removes the picture the client saw: the reference first, then its files. */
export async function removeLocationPhoto(db: D1Database, bucket: R2Bucket, actor: Actor, locationId: string, expected: unknown) {
  const mediaId = expectedPhoto(expected);
  if (!mediaId) throw new InputError(400, "Reload the place and try again.");
  const [removal] = await db.batch([
    db.prepare("UPDATE locations SET media_id = NULL, media_width = NULL, media_height = NULL WHERE id = ? AND media_id = ?").bind(locationId, mediaId),
    audit(db, actor.accountId, "LOCATION_PHOTO_REMOVED", "LOCATION", locationId, { mediaId }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]);
  if (!removal!.meta.changes) throw new InputError(409, CHANGED);
  await dropObjects(bucket, mediaId, "locations");
  return { photo: null };
}

/** One variant for signed-in staff. The id is random and a replacement gets a new one, so a browser may keep it for a day. */
export async function locationPicture(bucket: R2Bucket, mediaId: string, variant: string): Promise<Response> {
  if (!MEDIA_ID.test(mediaId) || !Object.hasOwn(VARIANTS, variant)) throw new InputError(404, "Not found.");
  const object = await bucket.get(key(mediaId, variant as Variant, "locations"));
  if (!object) throw new InputError(404, "Not found.");
  return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
}

/**
 * A place's picture for Self-Service, only while staff share that place with it (the place and every place above it are
 * active and shared, the `shown` column of the location_paths view) and Self-Service is open. Anything else, and any guessed
 * id, answers 404. An hour in a browser's cache bounds how long a withdrawn picture can linger on a phone that loaded it.
 */
export async function publicLocationPicture(db: D1Database, bucket: R2Bucket, mediaId: string, variant: string, ifNoneMatch: string | null, selfServiceOpen: () => Promise<boolean>): Promise<Response> {
  if (!MEDIA_ID.test(mediaId) || !Object.hasOwn(VARIANTS, variant)) throw new InputError(404, "Not found.");
  const shown = await db.prepare("SELECT 1 FROM locations l JOIN location_paths p ON p.id = l.id WHERE l.media_id = ? AND p.shown = 1").bind(mediaId).first();
  if (!shown || !await selfServiceOpen()) throw new InputError(404, "Not found.");
  const headers = { "cache-control": "public, max-age=3600", etag: `"${mediaId}-${variant}"` };
  if (ifNoneMatch?.replace(/^W\//, "") === headers.etag) return new Response(null, { status: 304, headers });
  const object = await bucket.get(key(mediaId, variant as Variant, "locations"));
  if (!object) throw new InputError(404, "Not found.");
  return new Response(object.body, { headers: { ...headers, "content-type": "image/jpeg" } });
}
