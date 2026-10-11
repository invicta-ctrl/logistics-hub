import type { Account } from "./accounts";
import { type Actor, BUMP_REVISION, InputError, audit } from "./inventory";
import { MEDIA_ID, expectedPhoto, key, readVariant } from "./item-media";

/*
 * Background removal for an item's profile photo (Final Pass amendment, FP-E). Cloudflare Images cuts the foreground out of the stored
 * display photo (`segment=foreground`, BiRefNet) and the result is kept beside the original as a transparent PNG. The original is never
 * changed or removed by this; "Use original" simply deletes the cutout. Nothing here runs unless the Worker has an `IMAGES` binding,
 * and no more than CUTOUT_MONTHLY_CAP photos a month are sent, a small fraction of the Free plan's 5,000 unique transformations.
 *
 * The Worker only checks the shape of what comes back (a PNG with transparency, the photo's proportions, a sane size). Whether the cut is
 * a real cutout is judged in the browser from the picture's alpha channel (src/cutout-share.ts): decoding a 1280 px PNG here took 50 to
 * 120 ms of CPU against the 10 ms a Workers Free request gets, which would kill the request after the provider call was already counted.
 * A new cut is stored as PENDING and is not the item's picture: the browser judges it and then accepts it (copied to the live key) or
 * rejects it (deleted), so a closed tab or a failed request leaves the original in use and nothing bad live.
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
/** A cleaned picture keeps the photo's proportions (to within this share), because the Images call does not resize. */
const ASPECT_TOLERANCE = 0.02;

/** The owner's switch. Absent means off: a deployment that gains the `IMAGES` binding still cleans nothing until the owner turns this on. */
export const CLEANUP_KEY = "picture_cleanup";
export async function cleanupOn(db: D1Database): Promise<boolean> {
  return await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(CLEANUP_KEY).first<string>("value") === "on";
}

export type CleanupStatus = { on: boolean; available: boolean; sentThisMonth: number; monthlyCap: number };
export async function cleanupStatus(db: D1Database, images: ImagesRunner | undefined, now = Date.now()): Promise<CleanupStatus> {
  return { on: await cleanupOn(db), available: Boolean(images), sentThisMonth: await cutoutsThisMonth(db, now), monthlyCap: CUTOUT_MONTHLY_CAP };
}

/** Owner only (checked by the caller). Setting it to its current value changes nothing and writes no audit entry. */
export async function setCleanup(db: D1Database, actor: Account, input: unknown): Promise<{ on: boolean }> {
  const on = (input as { on?: unknown } | null)?.on;
  if (typeof on !== "boolean") throw new InputError(400, "Choose on or off.");
  if (on !== await cleanupOn(db)) {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO system_settings(key, value, updated_at, updated_by) VALUES(?1, ?2, ?3, ?4)
        ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3, updated_by = ?4`).bind(CLEANUP_KEY, on ? "on" : "off", now, actor.accountId),
      audit(db, actor.accountId, "SETTING_CHANGED", "SETTING", CLEANUP_KEY, { setting: CLEANUP_KEY, from: on ? "off" : "on", to: on ? "on" : "off" }, true)
    ]);
  }
  return { on: await cleanupOn(db) };
}

export const cutoutKey = (mediaId: string) => `items/${mediaId}/cutout`;
export const cutoutThumbKey = (mediaId: string) => `items/${mediaId}/cutout-thumb`;
/** A new cut waits here until the browser has judged it; nothing serves it as the item's picture and a closed tab leaves nothing live. */
export const claimKey = (mediaId: string) => `cutout_claim:${mediaId}`;
/** A claim older than this is a request that died; it no longer blocks (the provider timeout is 20 s). */
const CLAIM_MS = 60_000;
async function claimCutout(db: D1Database, mediaId: string, now = Date.now()): Promise<void> {
  const claim = await db.prepare(`INSERT INTO system_settings(key, value, updated_at) VALUES(?1, '1', ?2)
    ON CONFLICT(key) DO UPDATE SET updated_at = ?2 WHERE updated_at < ?3`)
    .bind(claimKey(mediaId), new Date(now).toISOString(), new Date(now - CLAIM_MS).toISOString()).run();
  if (!claim.meta.changes) throw new InputError(409, "This photo is already being changed. Give it a moment.");
}
export const pendingKey = (mediaId: string) => `items/${mediaId}/cutout-pending`;
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

/**
 * The shape of a cleaned picture, read from the chunk headers alone (no pixel is decoded, so it costs next to nothing): a PNG of 8-bit
 * RGBA, not interlaced, no larger than the photo's own limit, with the photo's proportions, carrying picture data and an end marker.
 */
export function checkCutoutShape(bytes: Uint8Array, source: { width: number; height: number }): { width: number; height: number } {
  const refuse = (why: string): never => { throw new InputError(502, `The cleaned picture was not used: ${why}.`); };
  if (bytes.length > MAX_CUTOUT_BYTES) refuse("it is too large");
  if (bytes.length < 33 || SIGNATURE.some((value, index) => bytes[index] !== value)) refuse("it is not a PNG");
  let width = 0;
  let height = 0;
  let data = false;
  let ended = false;
  for (let at = 8; at + 12 <= bytes.length && !ended;) {
    const length = u32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (at + 12 + length > bytes.length) refuse("it is cut short");
    if (type === "IHDR") {
      if (at !== 8 || length !== 13) refuse("it is not a valid PNG");
      width = u32(bytes, at + 8);
      height = u32(bytes, at + 12);
      if (bytes[at + 16] !== 8 || bytes[at + 17] !== 6 || bytes[at + 20] !== 0) refuse("it is not an ordinary 8-bit PNG with transparency");
    } else if (type === "IDAT") data = true;
    else if (type === "IEND") ended = true;
    at += 12 + length;
  }
  if (!ended || !data || !width || !height) refuse("it is not a valid PNG");
  if (Math.max(width, height) > MAX_EDGE) refuse("it is larger than the photo it came from");
  if (Math.abs(width / height - source.width / source.height) > ASPECT_TOLERANCE * (source.width / source.height)) refuse("it does not have the photo's proportions");
  return { width, height };
}

/**
 * Cuts the foreground out of an item's current photo and stores it as that photo's cleaned picture. `expected` is the photo the client
 * was looking at, so a photo replaced meanwhile is never given another photo's cutout. Answers 503 with a plain sentence whenever the
 * cleanup cannot run; the original photo and the staff member's work are untouched in every case.
 */
export async function makeCutout(db: D1Database, bucket: R2Bucket, images: ImagesRunner | undefined, actor: Actor, itemId: string, expected: unknown, now = Date.now()) {
  const mediaId = expectedPhoto(expected);
  if (!mediaId) throw new InputError(400, "Reload the item and try again.");
  if (!images || !await cleanupOn(db)) throw new InputError(503, "Picture cleanup is turned off.");
  const current = await db.prepare("SELECT media_id AS mediaId, width, height FROM item_media WHERE item_id = ?").bind(itemId).first<{ mediaId: string; width: number; height: number }>();
  if (!current || current.mediaId !== mediaId) throw new InputError(409, "Someone else changed this photo. Reload to see the latest, then try again.");
  // Already cleaned, or a cut already waiting for a browser's verdict (a second tap, another tab, a tab closed early): nothing is sent and
  // no allowance is spent.
  if (await hasCutout(bucket, mediaId)) return { cutout: true };
  if (await bucket.head(pendingKey(mediaId)).catch(() => null)) return { pending: true };
  if (now < breaker.openUntil) throw new InputError(503, "Picture cleanup is resting after errors. Try again in a few minutes.");
  const source = await bucket.get(key(mediaId, "display"));
  if (!source) throw new InputError(404, "Photo not found.");
  // One cut at a time per photo, claimed in a single statement: a second tab asking now would otherwise spend a second transformation and
  // could overwrite the pending bytes after the first browser had judged them.
  await claimCutout(db, mediaId, now);
  try {
    // Look again now that the photo is ours: another request may have finished between the first look and the claim.
    if (await hasCutout(bucket, mediaId)) return { cutout: true };
    if (await bucket.head(pendingKey(mediaId)).catch(() => null)) return { pending: true };
    return await cutAndHold(db, bucket, images, mediaId, current, source.body as ReadableStream<Uint8Array>, now);
  } finally {
    await db.prepare("DELETE FROM system_settings WHERE key = ?").bind(claimKey(mediaId)).run().catch(() => undefined);
  }
}

/** The provider call and the pending write, run while the photo is claimed. */
async function cutAndHold(db: D1Database, bucket: R2Bucket, images: ImagesRunner, mediaId: string, current: { mediaId: string; width: number; height: number }, source: ReadableStream<Uint8Array>, now: number) {
  if (!await reserveCutout(db, now)) throw new InputError(503, "This month's picture cleanup allowance is used. The original photo is still in use.");
  // The timeout below stops waiting, not the provider: a call that finishes late may still count as a transformation, which is why the
  // reservation above is never given back.
  const fail = (): never => {
    breaker.failures += 1;
    if (breaker.failures >= CUTOUT_BREAKER_FAILURES) breaker.openUntil = now + CUTOUT_BREAKER_MS;
    throw new InputError(503, "The background could not be removed this time. The original photo is still in use.");
  };
  let bytes: Uint8Array;
  try {
    const output = await Promise.race([
      images.input(source).transform({ segment: "foreground" }).output({ format: "image/png" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CUTOUT_TIMEOUT_MS))
    ]);
    const answer = output.response();
    if (!answer.ok) throw new Error(`images ${answer.status}`);
    bytes = new Uint8Array(await answer.arrayBuffer());
  } catch (error) {
    console.error("cutout_failed", { mediaId, error: error instanceof Error ? error.message : "error" });
    return fail();
  }
  // A malformed result is the provider's fault, not the person's: it counts toward the breaker like any other failed call.
  try { checkCutoutShape(bytes, current); } catch (error) { console.error("cutout_rejected", { mediaId, why: error instanceof InputError ? error.message : "error" }); return fail(); }
  breaker.failures = 0;
  await bucket.put(pendingKey(mediaId), bytes, { httpMetadata: { contentType: "image/png" } });
  // The photo may have been replaced while the provider worked: keep the cut only if it is still the item's photo.
  const still = await db.prepare("SELECT 1 FROM item_media WHERE media_id = ?").bind(mediaId).first();
  if (!still) { await bucket.delete(pendingKey(mediaId)).catch(() => undefined); throw new InputError(409, "Someone else changed this photo. Reload to see the latest, then try again."); }
  return { pending: true };
}

/**
 * The browser looked at the pending cut and found a real cutout: make it the item's cleaned picture. Safe to repeat (a cut already
 * accepted answers the same). Sends nothing to the provider and spends nothing.
 */
export async function acceptCutout(db: D1Database, bucket: R2Bucket, actor: Actor, itemId: string, expected: unknown, form?: FormData) {
  const mediaId = expectedPhoto(expected);
  if (!mediaId) throw new InputError(400, "Reload the item and try again.");
  await claimCutout(db, mediaId);
  try {
    const current = await db.prepare("SELECT media_id AS mediaId, width, height FROM item_media WHERE item_id = ?").bind(itemId).first<{ mediaId: string; width: number; height: number }>();
    if (!current || current.mediaId !== mediaId) throw new InputError(409, "Someone else changed this photo. Reload to see the latest, then try again.");
    const pending = form?.get("pending") === "0" ? null : await bucket.get(pendingKey(mediaId));
    const source = pending ?? await bucket.get(cutoutKey(mediaId));
    if (!source) throw new InputError(404, "There is no cleaned picture waiting. Try removing the background again.");
    if (form && source.httpEtag && form.get("source") !== source.httpEtag) throw new InputError(409, "The cleaned photo changed. Reload it before saving the thumbnail.");
    const thumb = form ? await readVariant(form, "thumb") : null;
    if (thumb && Math.max(thumb.width, thumb.height) > 320) throw new InputError(400, "The cleaned thumbnail is too large.");
    // An accepted photo made by an older page can gain its small thumbnail without another provider call.
    if (!pending && !thumb) return { cutout: true };
    if (pending) {
      const bytes = new Uint8Array(await new Response(pending.body).arrayBuffer());
      checkCutoutShape(bytes, current);
      await bucket.put(cutoutKey(mediaId), bytes, { httpMetadata: { contentType: "image/png" } });
    }
    if (thumb) await bucket.put(cutoutThumbKey(mediaId), thumb.bytes, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: source.httpEtag ? { source: source.httpEtag } : undefined });
    const still = await db.prepare("SELECT 1 FROM item_media WHERE item_id = ? AND media_id = ?").bind(itemId, mediaId).first();
    if (!still) {
      await Promise.all([bucket.delete(cutoutKey(mediaId)), bucket.delete(cutoutThumbKey(mediaId))]);
      throw new InputError(409, "Someone else changed this photo. Reload to see the latest, then try again.");
    }
    await bucket.delete(pendingKey(mediaId)).catch(() => undefined);
    await db.batch([
      ...(pending ? [audit(db, actor.accountId, "ITEM_CUTOUT_ADDED", "ITEM", itemId, { mediaId })] : []),
      db.prepare("UPDATE items SET updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM item_media WHERE item_id = ? AND media_id = ?)").bind(new Date().toISOString(), itemId, itemId, mediaId),
      db.prepare(`${BUMP_REVISION} AND changes() > 0`)
    ]);
    return { cutout: true };
  } finally {
    await db.prepare("DELETE FROM system_settings WHERE key = ?").bind(claimKey(mediaId)).run().catch(() => undefined);
  }
}

/** Goes back to the original photo: deletes the cleaned picture only. Safe to repeat. */
export async function removeCutout(db: D1Database, bucket: R2Bucket, actor: Actor, itemId: string, expected: unknown, pendingSource: string | null = null) {
  const mediaId = expectedPhoto(expected);
  if (!mediaId) throw new InputError(400, "Reload the item and try again.");
  await claimCutout(db, mediaId);
  try {
    const current = await db.prepare("SELECT media_id AS mediaId FROM item_media WHERE item_id = ?").bind(itemId).first<{ mediaId: string }>();
    if (!current || current.mediaId !== mediaId) throw new InputError(409, "Someone else changed this photo. Reload to see the latest, then try again.");
    if (pendingSource !== null) {
      const pending = await bucket.head(pendingKey(mediaId));
      if (!pending || pending.httpEtag !== pendingSource || await hasCutout(bucket, mediaId)) throw new InputError(409, "The cleaned photo changed. Reload it before trying again.");
      await bucket.delete(pendingKey(mediaId));
      return { cutout: false };
    }
    await bucket.delete(pendingKey(mediaId)).catch(() => undefined);
    await bucket.delete(cutoutThumbKey(mediaId));
    if (await bucket.head(cutoutKey(mediaId))) {
      await bucket.delete(cutoutKey(mediaId));
      await db.batch([
        audit(db, actor.accountId, "ITEM_CUTOUT_REMOVED", "ITEM", itemId, { mediaId }),
        db.prepare("UPDATE items SET updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM item_media WHERE item_id = ? AND media_id = ?)").bind(new Date().toISOString(), itemId, itemId, mediaId),
        db.prepare(`${BUMP_REVISION} AND changes() > 0`)
      ]);
    }
    return { cutout: false };
  } finally {
    await db.prepare("DELETE FROM system_settings WHERE key = ?").bind(claimKey(mediaId)).run().catch(() => undefined);
  }
}

/** A derivative is selected only while it belongs to the live accepted full cutout. */
export async function hasCutoutThumb(bucket: R2Bucket, mediaId: string): Promise<boolean> {
  const [source, thumb] = await Promise.all([bucket.head(cutoutKey(mediaId)), bucket.head(cutoutThumbKey(mediaId))]);
  return Boolean(source && thumb && (!source.httpEtag || thumb.customMetadata?.source === source.httpEtag));
}

/** Whether a photo has a cleaned picture, for the item's detail. */
export async function hasCutout(bucket: R2Bucket, mediaId: string): Promise<boolean> {
  return MEDIA_ID.test(mediaId) && Boolean(await bucket.head(cutoutKey(mediaId)).catch(() => null));
}

/**
 * Streams the cleaned picture to a signed-in staff member. Unlike the photo (whose id changes with every replacement), a cleaned picture
 * can be made again under the same id after "Use original", so a browser must ask again each time rather than keep a day-old copy.
 */
export async function cutoutPicture(bucket: R2Bucket, mediaId: string, pending = false): Promise<Response> {
  if (!MEDIA_ID.test(mediaId)) throw new InputError(404, "Not found.");
  const object = await bucket.get(pending ? pendingKey(mediaId) : cutoutKey(mediaId));
  if (!object) throw new InputError(404, "Not found.");
  const thumb = await bucket.head(key(mediaId, "thumb"));
  return new Response(object.body, { headers: { "content-type": "image/png", "cache-control": "private, no-cache", ...(object.httpEtag ? { etag: object.httpEtag } : {}),
    ...(thumb?.customMetadata?.cropRect ? { "x-photo-crop": thumb.customMetadata.cropRect } : {}) } });
}
