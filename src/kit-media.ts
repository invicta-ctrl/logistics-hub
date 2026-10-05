import { type Actor, BUMP_REVISION, InputError, audit } from "./inventory";
import { CHANGED, MEDIA_ID, VARIANTS, type Variant, dropObjects, expectedPhoto, key, readVariant } from "./item-media";

/*
 * A kit's optional picture (V1.8), kept the way a place's is (location-media.ts): the objects live in the catalog bucket under
 * kits/<media id>/display and /thumb, kits.media_id is the only reference, and a replacement gets a new id. Staff only.
 */

export async function putKitPhoto(db: D1Database, bucket: R2Bucket, actor: Actor, kitId: string, form: FormData) {
  const expected = expectedPhoto(form.get("expected"));
  const display = await readVariant(form, "display");
  const thumb = await readVariant(form, "thumb");
  if (!await db.prepare("SELECT 1 FROM kits WHERE id = ?").bind(kitId).first()) throw new InputError(404, "Kit not found.");
  const mediaId = crypto.randomUUID();
  try {
    await bucket.put(key(mediaId, "display", "kits"), display.bytes, { httpMetadata: { contentType: "image/jpeg" } });
    await bucket.put(key(mediaId, "thumb", "kits"), thumb.bytes, { httpMetadata: { contentType: "image/jpeg" } });
    const [write] = await db.batch([
      db.prepare("UPDATE kits SET media_id = ?, media_width = ?, media_height = ? WHERE id = ? AND media_id IS ?").bind(mediaId, display.width, display.height, kitId, expected),
      audit(db, actor.accountId, expected ? "KIT_PHOTO_REPLACED" : "KIT_PHOTO_ADDED", "KIT", kitId, { mediaId }, true),
      db.prepare(`${BUMP_REVISION} AND changes() > 0`)
    ]);
    if (!write!.meta.changes) throw new InputError(409, CHANGED);
  } catch (error) {
    const referenced = error instanceof InputError ? false : await db.prepare("SELECT 1 FROM kits WHERE media_id = ?").bind(mediaId).first().then(Boolean, () => true);
    if (!referenced) await dropObjects(bucket, mediaId, "kits");
    throw error;
  }
  if (expected) await dropObjects(bucket, expected, "kits");
  return { photo: { id: mediaId, width: display.width, height: display.height } };
}

export async function removeKitPhoto(db: D1Database, bucket: R2Bucket, actor: Actor, kitId: string, expected: unknown) {
  const mediaId = expectedPhoto(expected);
  if (!mediaId) throw new InputError(400, "Reload the kit and try again.");
  const [removal] = await db.batch([
    db.prepare("UPDATE kits SET media_id = NULL, media_width = NULL, media_height = NULL WHERE id = ? AND media_id = ?").bind(kitId, mediaId),
    audit(db, actor.accountId, "KIT_PHOTO_REMOVED", "KIT", kitId, { mediaId }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]);
  if (!removal!.meta.changes) throw new InputError(409, CHANGED);
  await dropObjects(bucket, mediaId, "kits");
  return { photo: null };
}

/** One variant for signed-in staff. The id is random and a replacement gets a new one, so a browser may keep it for a day. */
export async function kitPicture(bucket: R2Bucket, mediaId: string, variant: string): Promise<Response> {
  if (!MEDIA_ID.test(mediaId) || !Object.hasOwn(VARIANTS, variant)) throw new InputError(404, "Not found.");
  const object = await bucket.get(key(mediaId, variant as Variant, "kits"));
  if (!object) throw new InputError(404, "Not found.");
  return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
}
