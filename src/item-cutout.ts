import { type Actor, InputError, audit } from "./inventory";
import { MEDIA_ID, expectedPhoto, key } from "./item-media";

/*
 * Background removal for an item's profile photo (Final Pass amendment, FP-E). Cloudflare Images cuts the foreground out of the stored
 * display photo (`segment=foreground`, BiRefNet) and the result is kept beside the original as a transparent PNG. The original is never
 * changed or removed by this; "Use original" simply deletes the cutout. Nothing here runs unless the Worker has an `IMAGES` binding,
 * and no more than CUTOUT_MONTHLY_CAP photos a month are sent, a small fraction of the Free plan's 5,000 unique transformations.
 */

/** The part of the Cloudflare Images binding this file uses (https://developers.cloudflare.com/images/optimization/binding/). */
export type ImagesRunner = {
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: { segment: "foreground" }): { output(options: { format: "image/png" }): Promise<{ response(): Response }> };
  };
};

/** Photos sent for cutting in one UTC month. The account's Free allowance is 5,000 unique transformations; this keeps a wide margin. */
export const CUTOUT_MONTHLY_CAP = 500;
export const CUTOUT_TIMEOUT_MS = 20_000;
export const CUTOUT_BREAKER_FAILURES = 3;
export const CUTOUT_BREAKER_MS = 10 * 60_000;
/** A cutout of a 1600 px photo is bigger than the JPEG it came from; this is the most one may take. */
const MAX_CUTOUT_BYTES = 4_000_000;
const MAX_EDGE = 1600;
/** The share of the picture that has to be removed, and the share that has to stay, for the cut to count as a real cutout. */
const MIN_REMOVED = 0.03;
const MIN_KEPT = 0.03;

export const cutoutKey = (mediaId: string) => `items/${mediaId}/cutout`;
const monthKey = (now: number) => `image_cutouts:${new Date(now).toISOString().slice(0, 7)}`;

const breaker = { failures: 0, openUntil: 0 };
/** For tests: forget earlier failures. */
export const resetCutoutBreaker = () => { breaker.failures = 0; breaker.openUntil = 0; };

/** Cutouts already sent this month. */
export async function cutoutsThisMonth(db: D1Database, now = Date.now()): Promise<number> {
  return Number(await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(monthKey(now)).first<string>("value") ?? 0) || 0;
}

/**
 * Takes one place in this month's allowance in a single conditional statement, so two requests cannot both pass the last one. A place is
 * never given back: if the provider fails after the call started the transformation may still have been counted, so the count stays
 * on the safe side.
 */
export async function reserveCutout(db: D1Database, now: number): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO system_settings(key, value, updated_at) SELECT ?1, '1', ?2 WHERE ?3 >= 1
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = ?2 WHERE CAST(value AS INTEGER) + 1 <= ?3`)
    .bind(monthKey(now), new Date(now).toISOString(), CUTOUT_MONTHLY_CAP).run();
  return Boolean(result.meta.changes);
}

const u32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function inflate(parts: Uint8Array[], expected: number): Promise<Uint8Array> {
  const stream = new Blob(parts as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const out = new Uint8Array(expected);
  let used = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (used + value.length > expected) { await reader.cancel(); throw new Error("too much picture data"); }
    out.set(value, used);
    used += value.length;
  }
  if (used !== expected) throw new Error("picture data is cut short");
  return out;
}

export type CutoutCheck = { width: number; height: number; removed: number; kept: number };

/**
 * Reads a PNG's own bytes and says what the cut did: an 8-bit RGBA picture, not interlaced, of a sane size, in which part of the picture
 * is fully transparent (the removed background) and part is opaque (the kept subject). A picture with no transparency is the original
 * passed through, one that is nearly all transparent has lost the product, and either is refused instead of replacing the photo.
 */
export async function inspectCutout(bytes: Uint8Array): Promise<CutoutCheck> {
  const refuse = (why: string): never => { throw new InputError(502, `The cleaned picture was not used: ${why}.`); };
  if (bytes.length > MAX_CUTOUT_BYTES) refuse("it is too large");
  if (bytes.length < 33 || SIGNATURE.some((value, index) => bytes[index] !== value)) refuse("it is not a PNG");
  let width = 0;
  let height = 0;
  const data: Uint8Array[] = [];
  let ended = false;
  for (let at = 8; at + 12 <= bytes.length && !ended;) {
    const length = u32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (at + 12 + length > bytes.length) refuse("it is cut short");
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      if (at !== 8 || length !== 13) refuse("it is not a valid PNG");
      width = u32(body, 0);
      height = u32(body, 4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) refuse("it is not an ordinary 8-bit PNG with transparency");
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") ended = true;
    at += 12 + length;
  }
  if (!ended || !width || !height || !data.length) refuse("it is not a valid PNG");
  if (Math.max(width, height) > MAX_EDGE) refuse("it is larger than the photo it came from");
  const stride = width * 4;
  let raw: Uint8Array;
  try { raw = await inflate(data, (stride + 1) * height); } catch { return refuse("its picture data is not valid"); }
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  let clear = 0;
  let solid = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)]!;
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    if (filter > 4) refuse("its picture data is not valid");
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? current[index - 4]! : 0;
      const up = previous[index]!;
      const upLeft = index >= 4 ? previous[index - 4]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        predicted = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
      }
      current[index] = (line[index]! + predicted) & 255;
    }
    for (let index = 3; index < stride; index += 4) {
      if (current[index]! < 16) clear += 1;
      else if (current[index]! > 240) solid += 1;
    }
    [previous, current] = [current, previous];
  }
  const total = width * height;
  const result = { width, height, removed: clear / total, kept: solid / total };
  if (result.removed < MIN_REMOVED) refuse("no background was found to remove");
  if (result.kept < MIN_KEPT) refuse("too little of the item was kept");
  return result;
}

/**
 * Cuts the foreground out of an item's current photo and stores it as that photo's cleaned picture. `expected` is the photo the client
 * was looking at, so a photo replaced meanwhile is never given another photo's cutout. Answers 503 with a plain sentence whenever the
 * cleanup cannot run; the original photo and the staff member's work are untouched in every case.
 */
export async function makeCutout(db: D1Database, bucket: R2Bucket, images: ImagesRunner | undefined, actor: Actor, itemId: string, expected: unknown, now = Date.now()) {
  const mediaId = expectedPhoto(expected);
  if (!mediaId) throw new InputError(400, "Reload the item and try again.");
  if (!images) throw new InputError(503, "Picture cleanup is not switched on.");
  const current = await db.prepare("SELECT media_id AS mediaId FROM item_media WHERE item_id = ?").bind(itemId).first<{ mediaId: string }>();
  if (!current || current.mediaId !== mediaId) throw new InputError(409, "Someone else changed this photo. Reload to see the latest, then try again.");
  if (now < breaker.openUntil) throw new InputError(503, "Picture cleanup is resting after errors. Try again in a few minutes.");
  const source = await bucket.get(key(mediaId, "display"));
  if (!source) throw new InputError(404, "Photo not found.");
  if (!await reserveCutout(db, now)) throw new InputError(503, "This month's picture cleanup allowance is used. The original photo is still in use.");
  const fail = (): never => {
    breaker.failures += 1;
    if (breaker.failures >= CUTOUT_BREAKER_FAILURES) breaker.openUntil = now + CUTOUT_BREAKER_MS;
    throw new InputError(503, "The background could not be removed this time. The original photo is still in use.");
  };
  let bytes: Uint8Array;
  try {
    const output = await Promise.race([
      images.input(source.body as ReadableStream<Uint8Array>).transform({ segment: "foreground" }).output({ format: "image/png" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CUTOUT_TIMEOUT_MS))
    ]);
    const answer = output.response();
    if (!answer.ok) throw new Error(`images ${answer.status}`);
    bytes = new Uint8Array(await answer.arrayBuffer());
  } catch (error) {
    console.error("cutout_failed", { mediaId, error: error instanceof Error ? error.message : "error" });
    return fail();
  }
  // A bad result is the provider's fault, not the person's: it counts toward the breaker like any other failed call.
  const check = await inspectCutout(bytes).catch((error: unknown) => { console.error("cutout_rejected", { mediaId, why: error instanceof InputError ? error.message : "error" }); return fail(); });
  breaker.failures = 0;
  await bucket.put(cutoutKey(mediaId), bytes, { httpMetadata: { contentType: "image/png" } });
  // The photo may have been replaced while the provider worked: keep the cutout only if it is still the item's photo.
  const still = await db.prepare("SELECT 1 FROM item_media WHERE item_id = ? AND media_id = ?").bind(itemId, mediaId).first();
  if (!still) { await bucket.delete(cutoutKey(mediaId)).catch(() => undefined); throw new InputError(409, "Someone else changed this photo. Reload to see the latest, then try again."); }
  await db.batch([audit(db, actor.accountId, "ITEM_CUTOUT_ADDED", "ITEM", itemId, { mediaId, removed: Math.round(check.removed * 100), kept: Math.round(check.kept * 100) })]);
  return { cutout: true, removed: check.removed, kept: check.kept };
}

/** Goes back to the original photo: deletes the cleaned picture only. Safe to repeat. */
export async function removeCutout(db: D1Database, bucket: R2Bucket, actor: Actor, itemId: string, expected: unknown) {
  const mediaId = expectedPhoto(expected);
  if (!mediaId) throw new InputError(400, "Reload the item and try again.");
  const current = await db.prepare("SELECT media_id AS mediaId FROM item_media WHERE item_id = ?").bind(itemId).first<{ mediaId: string }>();
  if (!current || current.mediaId !== mediaId) throw new InputError(409, "Someone else changed this photo. Reload to see the latest, then try again.");
  if (await bucket.head(cutoutKey(mediaId))) {
    await bucket.delete(cutoutKey(mediaId));
    await db.batch([audit(db, actor.accountId, "ITEM_CUTOUT_REMOVED", "ITEM", itemId, { mediaId })]);
  }
  return { cutout: false };
}

/** Whether a photo has a cleaned picture, for the item's detail. */
export async function hasCutout(bucket: R2Bucket, mediaId: string): Promise<boolean> {
  return MEDIA_ID.test(mediaId) && Boolean(await bucket.head(cutoutKey(mediaId)).catch(() => null));
}

/** Streams the cleaned picture to a signed-in staff member, with the same private caching as the photo itself. */
export async function cutoutPicture(bucket: R2Bucket, mediaId: string): Promise<Response> {
  if (!MEDIA_ID.test(mediaId)) throw new InputError(404, "Not found.");
  const object = await bucket.get(cutoutKey(mediaId));
  if (!object) throw new InputError(404, "Not found.");
  return new Response(object.body, { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" } });
}
