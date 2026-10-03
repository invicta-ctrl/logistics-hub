import { isListedForLending, selfServiceAction } from "./catalog-policy";
import { type Actor, BUMP_REVISION, InputError, audit } from "./inventory";

export const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The browser makes both variants (src/item-photo.ts); these are the Worker's ceilings, not the sizes it expects. */
export const VARIANTS = { display: { edge: 1600, bytes: 1_000_000 }, thumb: { edge: 480, bytes: 150_000 } } as const;
export type Variant = keyof typeof VARIANTS;

/** Item photos and location pictures share the catalog bucket, each under its own prefix. */
export const key = (mediaId: string, variant: Variant, folder: "items" | "locations" = "items") => `${folder}/${mediaId}/${variant}`;
const u16 = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!;

/** The EXIF orientation of an APP1 payload, or 1 when it has none or cannot be read. */
function exifOrientation(bytes: Uint8Array, from: number, to: number): number {
  if (to - from < 14 || String.fromCharCode(...bytes.subarray(from, from + 4)) !== "Exif") return 1;
  const tiff = from + 6;
  const little = bytes[tiff] === 0x49;
  // Anything outside the segment reads as 0, so a damaged EXIF block can never run past it.
  const read = (at: number, size: 2 | 4) => {
    if (at < tiff || at + size > to) return 0;
    let value = 0;
    for (let index = 0; index < size; index += 1) value = value * 256 + bytes[little ? at + size - 1 - index : at + index]!;
    return value;
  };
  const directory = tiff + read(tiff + 4, 4);
  for (let index = 0, entries = Math.min(read(directory, 2), 64); index < entries; index += 1) {
    const at = directory + 2 + index * 12;
    if (read(at, 2) === 0x0112) return read(at + 8, 2) || 1;
  }
  return 1;
}

/** Whether a table, frame or scan header holds exactly what it declares (and nothing more). */
function tablesFit(bytes: Uint8Array, marker: number, at: number, end: number): boolean {
  const body = at + 4;
  if (marker === 0xdd) return end - at === 6;
  if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return end - at === 10 + 3 * (bytes[at + 9] ?? 0);
  if (marker === 0xda) return end - at === 8 + 2 * (bytes[body] ?? 0);
  // DQT: tables of 64 or 128 values after a precision byte; DHT: 16 counts and that many symbols after a class byte.
  let next = body;
  while (next < end) {
    next += marker === 0xdb ? 1 + (bytes[next]! >> 4 ? 128 : 64) : 17 + bytes.subarray(next + 1, next + 17).reduce((sum, count) => sum + count, 0);
  }
  return next === end;
}

/**
 * Checks a browser-made JPEG by its own bytes and returns it rebuilt: only the tables, frame and scan data a
 * decoder needs. Every APPn (EXIF, GPS, thumbnails, ICC), comment and anything after the end marker is dropped, and
 * each table, frame and scan header must be exactly as long as its contents say, so no text hides beside them. The
 * compressed scan itself cannot be inspected without decoding it, which is why this guarantee is for what a browser
 * makes. A photo that still carries a rotation is refused (the browser applies it to the pixels before encoding); so
 * is anything not 8-bit, grey or YCbCr.
 */
export function cleanJpeg(bytes: Uint8Array, variant: Variant): { bytes: Uint8Array; width: number; height: number } {
  return checkJpeg(bytes, `${variant} photo`, VARIANTS[variant].edge);
}

/** cleanJpeg for any browser-made JPEG: `label` names it in a refusal ("front scan"), `edge` is its longest allowed side. */
export function checkJpeg(bytes: Uint8Array, label: string, edge: number): { bytes: Uint8Array; width: number; height: number } {
  const refuse = (why: string): never => { throw new InputError(400, `The ${label} ${why}`); };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) refuse("must be a JPEG image.");
  const kept: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  let width = 0;
  let height = 0;
  let scanned = false;
  let scanFrom = 0;
  let ended = false;
  let at = 2;
  while (at < bytes.length && !ended) {
    // Between a scan's header and the next marker the bytes are compressed image data.
    if (scanned && bytes[at] !== 0xff) { at += 1; continue; }
    if (bytes[at] !== 0xff) refuse("is not a valid JPEG.");
    while (bytes[at + 1] === 0xff) at += 1;
    const marker = bytes[at + 1];
    if (marker === undefined) refuse("is cut short.");
    // Stuffed bytes (FF 00) and restart markers belong to the scan.
    if (scanned && (marker === 0x00 || (marker! >= 0xd0 && marker! <= 0xd7))) { at += 2; continue; }
    // The compressed data of the scan just read runs up to this marker.
    if (scanFrom) { kept.push(bytes.subarray(scanFrom, at)); scanFrom = 0; }
    if (marker === 0xd9) {
      if (!width || !scanned) refuse("is not a valid JPEG.");
      kept.push(Uint8Array.of(0xff, 0xd9));
      ended = true;
      continue;
    }
    if (at + 4 > bytes.length) refuse("is cut short.");
    const end = at + 2 + u16(bytes, at + 2);
    if (end < at + 4 || end > bytes.length) refuse("is cut short.");
    if (marker! >= 0xe0 && marker! <= 0xef) {
      if (marker === 0xe1 && exifOrientation(bytes, at + 4, end) !== 1) refuse("still needs rotating. Choose the photo again.");
    } else if (marker !== 0xfe) {
      // Tables, the frame and scans only: anything else (arithmetic or lossless coding, stray markers) is not from a browser.
      if (![0xdb, 0xc4, 0xdd, 0xc0, 0xc1, 0xc2, 0xda].includes(marker!)) refuse("must be an ordinary JPEG.");
      if (!tablesFit(bytes, marker!, at, end)) refuse("is not a valid JPEG.");
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (width) refuse("is not a valid JPEG.");
        height = u16(bytes, at + 5);
        width = u16(bytes, at + 7);
        const components = bytes[at + 9];
        if (bytes[at + 4] !== 8 || (components !== 1 && components !== 3)) refuse("must be an ordinary 8-bit colour or grey JPEG.");
      } else if (marker === 0xda) {
        if (!width) refuse("is not a valid JPEG.");
        scanned = true;
        scanFrom = end;
      }
      kept.push(bytes.subarray(at, end));
    }
    at = end;
  }
  if (!ended) refuse("is cut short.");
  if (!width || !height || Math.max(width, height) > edge) refuse(`must be between 1 and ${edge} pixels.`);
  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  kept.reduce((offset, part) => { out.set(part, offset); return offset + part.length; }, 0);
  return { bytes: out, width, height };
}

export async function readVariant(form: FormData, variant: Variant) {
  const value = form.get(variant);
  if (!(value instanceof File) || value.size === 0) throw new InputError(400, `The ${variant} photo is missing.`);
  if (value.size > VARIANTS[variant].bytes) throw new InputError(400, `The ${variant} photo is too large.`);
  return cleanJpeg(new Uint8Array(await value.arrayBuffer()), variant);
}

/** A client names the photo it was looking at ("" for none), so a change made meanwhile is never overwritten. */
export function expectedPhoto(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !MEDIA_ID.test(value)) throw new InputError(400, "Reload the item and try again.");
  return value;
}

export const CHANGED = "Someone else changed this photo. Reload to see the latest, then try again.";

/** Removes a photo's objects. D1 no longer points at them, so a failure here only leaves an unused file behind. */
export async function dropObjects(bucket: R2Bucket, mediaId: string, folder: "items" | "locations" = "items"): Promise<void> {
  await Promise.all((Object.keys(VARIANTS) as Variant[]).map((variant) => bucket.delete(key(mediaId, variant, folder)).catch(() => {
    console.error("media_cleanup_failed", { mediaId, variant });
  })));
}

/**
 * Adds or replaces an item's profile photo. Both variants are stored first under a new id; one D1 batch then
 * switches the reference, but only if the item still has the photo the client saw. So D1 never points at a missing
 * file, a refused or failed write leaves the old photo untouched, and the old files go only after the switch.
 */
export async function putItemPhoto(db: D1Database, bucket: R2Bucket, actor: Actor, itemId: string, form: FormData) {
  const expected = expectedPhoto(form.get("expected"));
  const display = await readVariant(form, "display");
  const thumb = await readVariant(form, "thumb");
  if (!await db.prepare("SELECT 1 FROM items WHERE id = ?").bind(itemId).first()) throw new InputError(404, "Item not found.");
  const mediaId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await bucket.put(key(mediaId, "display"), display.bytes, { httpMetadata: { contentType: "image/jpeg" } });
    await bucket.put(key(mediaId, "thumb"), thumb.bytes, { httpMetadata: { contentType: "image/jpeg" } });
    const [write] = await db.batch([
      expected
        ? db.prepare("UPDATE item_media SET media_id = ?, width = ?, height = ?, created_at = ?, created_by = ? WHERE item_id = ? AND media_id = ?")
          .bind(mediaId, display.width, display.height, now, actor.accountId, itemId, expected)
        : db.prepare("INSERT INTO item_media(item_id, media_id, width, height, created_at, created_by) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM item_media WHERE item_id = ?1)")
          .bind(itemId, mediaId, display.width, display.height, now, actor.accountId),
      audit(db, actor.accountId, expected ? "ITEM_PHOTO_REPLACED" : "ITEM_PHOTO_ADDED", "ITEM", itemId, { mediaId }, true),
      db.prepare(`${BUMP_REVISION} AND changes() > 0`)
    ]);
    if (!write!.meta.changes) throw new InputError(409, CHANGED);
  } catch (error) {
    // An error after the batch committed (a timeout the client never saw an answer to) would leave D1 pointing at these files:
    // keep them whenever the reference may exist, since an unused file is harmless and a dangling reference is not.
    const referenced = error instanceof InputError ? false : await db.prepare("SELECT 1 FROM item_media WHERE media_id = ?").bind(mediaId).first().then(Boolean, () => true);
    if (!referenced) await dropObjects(bucket, mediaId);
    throw error;
  }
  if (expected) await dropObjects(bucket, expected);
  return { photo: { id: mediaId, width: display.width, height: display.height } };
}

/** Removes the profile photo the client saw: the reference first, then its files. */
export async function removeItemPhoto(db: D1Database, bucket: R2Bucket, actor: Actor, itemId: string, expected: unknown) {
  const mediaId = expectedPhoto(expected);
  if (!mediaId) throw new InputError(400, "Reload the item and try again.");
  const [removal] = await db.batch([
    db.prepare("DELETE FROM item_media WHERE item_id = ? AND media_id = ?").bind(itemId, mediaId),
    audit(db, actor.accountId, "ITEM_PHOTO_REMOVED", "ITEM", itemId, { mediaId }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]);
  if (!removal!.meta.changes) throw new InputError(409, CHANGED);
  await dropObjects(bucket, mediaId);
  return { photo: null };
}

/**
 * Streams one variant to a signed-in staff member. The id is random and a replacement gets a new one, so the bytes
 * behind a URL never change and a browser may keep them for a day (a list of photos then costs no requests);
 * "private" keeps shared caches out, and a day bounds how long a removed photo can linger in a browser.
 */
export async function itemPhoto(bucket: R2Bucket, mediaId: string, variant: string): Promise<Response> {
  if (!MEDIA_ID.test(mediaId) || !Object.hasOwn(VARIANTS, variant)) throw new InputError(404, "Not found.");
  const object = await bucket.get(key(mediaId, variant as Variant));
  if (!object) throw new InputError(404, "Not found.");
  return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
}

/**
 * The one public image route: the small thumbnail of an item's current photo, for the Lending Hub and Self-Service lists.
 * It answers only while the id is the item's current photo AND a public list actually shows the item: the Lending Hub
 * lists it, or Self-Service offers it and is open (the same policy functions the two catalogs use). So a removed or
 * replaced photo, an unlisted item, the 1280 px display size and any guessed id all answer 404, and nothing but the id
 * is read from the request. An hour in a browser's cache bounds how long a removed photo can linger on a phone that
 * already loaded it.
 */
export async function publicThumb(db: D1Database, bucket: R2Bucket, mediaId: string, ifNoneMatch: string | null, selfServiceOpen: () => Promise<boolean>): Promise<Response> {
  if (!MEDIA_ID.test(mediaId)) throw new InputError(404, "Not found.");
  const item = await db.prepare(`SELECT i.item_type AS itemType, i.lending_audience AS lendingAudience, i.status AS status, i.needs_review AS needsReview, i.consumption_mode AS consumptionMode
    FROM item_media m JOIN items i ON i.id = m.item_id WHERE m.media_id = ?`).bind(mediaId).first<{ itemType: string; lendingAudience: string; status: string; needsReview: number; consumptionMode: string }>();
  const shown = Boolean(item) && (isListedForLending(item!) || (Boolean(selfServiceAction(item!)) && await selfServiceOpen()));
  if (!shown) throw new InputError(404, "Not found.");
  const headers = { "cache-control": "public, max-age=3600", etag: `"${mediaId}"` };
  if (ifNoneMatch?.replace(/^W\//, "") === headers.etag) return new Response(null, { status: 304, headers });
  const object = await bucket.get(key(mediaId, "thumb"));
  if (!object) throw new InputError(404, "Not found.");
  return new Response(object.body, { headers: { ...headers, "content-type": "image/jpeg" } });
}
