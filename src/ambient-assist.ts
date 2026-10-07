import type { Account } from "./accounts";
import { possibleDuplicates, type Known as DuplicateKnown } from "./duplicates";
import { type Actor, InputError, audit } from "./inventory";
import { key } from "./item-media";

/*
 * Ambient assist (accepted amendment 2026-10-08): the one place the Worker asks Workers AI anything. There is no AI page, prompt box
 * or chat: the Hub calls a model only when a person has just done something a model can help with, and only for the task named here.
 *
 *   - PHOTO_NAME (user action): a staff member adds a photo while cataloguing online. Gemma names the thing in a few words; the
 *     catalogue screen puts that name in an empty name field for the person to check, and the Hub's own duplicate rule compares it
 *     with the catalog. Category, unit and behaviour come from the Hub's built-in suggestions, never from a model (V1.11 measurement,
 *     2026-10-07: a model's guess at USC's categories was right 13% of the time).
 *   - PHOTO_RECHECK (after sync): a capture whose photo could not be checked when it was taken (offline, or the check failed) is
 *     checked once, after its record and photo are saved on the server. If the photo names an item already in the catalog that the
 *     Hub's duplicate rule did not raise at capture, that becomes an Attention entry ("Possible duplicate"); otherwise nothing is shown.
 *
 * What a model receives is fixed here: a catalogue photo (the item's own 320 px thumbnail, never evidence, ID, directory or
 * Self-Service media) and a fixed instruction. What comes back is a short name or nothing; a model never writes a record. Calls stop
 * at the owner's daily Neuron bands, after repeated failures (a breaker), when an owner turns photo suggestions off, or when the
 * Worker has no AI binding (local development and tests). In every one of those cases the Hub works exactly as it did without AI.
 */

/** The vision model chosen in the amendment, re-verified on the account's model list on 2026-10-07. */
export const PHOTO_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export type AiRunner = { run(model: string, input: unknown, options?: unknown): Promise<unknown> };

/** The owner's daily Neuron bands (amendment §13), counted per UTC day as Workers AI resets its allowance. */
export const BANDS = { conserve: 6_500, reserve: 8_000, critical: 9_000, stop: 9_500 } as const;
export type Band = "NORMAL" | "CONSERVE" | "RESERVE" | "CRITICAL" | "STOPPED";
/** A user action may run until the stop line; work no person is waiting for stops at the critical line. */
export type Urgency = "USER" | "BACKGROUND";
/**
 * The most one photo call may cost, counted before the call so two calls cannot both squeeze under a line. Measured 2026-10-07:
 * 3.6 Neurons for a 320 px photo; the reply's own `usage.neurons` replaces it once it answers, and a failed call keeps it.
 */
export const PHOTO_RESERVE = 6;
/** A call this slow is abandoned (one of 24 measured calls took 28 s); the person keeps typing meanwhile. */
export const CALL_TIMEOUT_MS = 10_000;
/** Consecutive failures that open the breaker, and how long it stays open. Per Worker instance: a restart simply tries again. */
export const BREAKER_FAILURES = 3;
export const BREAKER_MS = 10 * 60_000;

export const SWITCH_KEY = "ambient_assist";
const usageKey = (day: string) => `ai_neurons:${day}`;
const FINDING_PREFIX = "assist_photo_match:";
const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

export function bandOf(used: number): Band {
  if (used >= BANDS.stop) return "STOPPED";
  if (used >= BANDS.critical) return "CRITICAL";
  if (used >= BANDS.reserve) return "RESERVE";
  if (used >= BANDS.conserve) return "CONSERVE";
  return "NORMAL";
}

/** Whether a call that may cost `reserve` can start with `used` Neurons spent today. */
export function mayCall(used: number, urgency: Urgency, reserve = PHOTO_RESERVE): boolean {
  return used + reserve <= (urgency === "USER" ? BANDS.stop : BANDS.critical);
}

const breaker = { failures: 0, openUntil: 0 };
/** For tests: forget earlier failures. */
export const resetBreaker = () => { breaker.failures = 0; breaker.openUntil = 0; };

export async function assistOn(db: D1Database): Promise<boolean> {
  return await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(SWITCH_KEY).first<string>("value") !== "off";
}

export async function neuronsToday(db: D1Database, now = Date.now()): Promise<number> {
  return Number(await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(usageKey(utcDay(now))).first<string>("value") ?? 0) || 0;
}

/** Adds to today's count in one statement, so concurrent calls never lose each other's Neurons; drops counts older than a week. */
function spend(db: D1Database, neurons: number, now: number): Promise<unknown> {
  return db.batch([
    db.prepare(`INSERT INTO system_settings(key, value, updated_at) VALUES(?1, ?2, ?3)
      ON CONFLICT(key) DO UPDATE SET value = CAST(ROUND(CAST(value AS REAL) + ?2, 3) AS TEXT), updated_at = ?3`).bind(usageKey(utcDay(now)), neurons, new Date(now).toISOString()),
    db.prepare("DELETE FROM system_settings WHERE key LIKE 'ai_neurons:%' AND key < ?").bind(usageKey(utcDay(now - 7 * 86_400_000)))
  ]);
}

export type AssistStatus = { on: boolean; available: boolean; neuronsToday: number; band: Band; stopAt: number };
export async function assistStatus(db: D1Database, ai: AiRunner | undefined, now = Date.now()): Promise<AssistStatus> {
  const used = await neuronsToday(db, now);
  return { on: await assistOn(db), available: Boolean(ai), neuronsToday: Math.round(used * 10) / 10, band: bandOf(used), stopAt: BANDS.stop };
}

/** Owner only (checked by the caller). Setting it to its current value changes nothing and writes no audit entry. */
export async function setAssist(db: D1Database, actor: Account, input: unknown): Promise<{ on: boolean }> {
  const on = (input as { on?: unknown } | null)?.on;
  if (typeof on !== "boolean") throw new InputError(400, "Choose on or off.");
  if (on !== await assistOn(db)) {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO system_settings(key, value, updated_at, updated_by) VALUES(?1, ?2, ?3, ?4)
        ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3, updated_by = ?4`).bind(SWITCH_KEY, on ? "on" : "off", now, actor.accountId),
      audit(db, actor.accountId, "SETTING_CHANGED", "SETTING", SWITCH_KEY, { setting: SWITCH_KEY, from: on ? "off" : "on", to: on ? "on" : "off" }, true)
    ]);
  }
  return { on: await assistOn(db) };
}

/* ---------- The photo task ---------- */

const INSTRUCTION = "You help a student council storeroom catalogue its supplies. Name the single main object in the photo in one to four plain "
  + "English words, the way a storeroom list would (for example \"stapler\", \"extension cord\"). Never describe or name a person. "
  + "Reply with JSON only.";
const NAME_SCHEMA = { type: "object", properties: { name: { type: ["string", "null"] } }, required: ["name"], additionalProperties: false };
/** Words that mean the photo shows people rather than a thing: such an answer is dropped, never shown or stored. */
const PEOPLE = /\b(person|people|man|men|woman|women|boy|girl|child|children|kid|face|selfie|student|staff|portrait|hand|hands)\b/i;

/** A model's answer reduced to a name a person can check, or null. */
export function readPhotoName(reply: unknown): string | null {
  let value: unknown = reply;
  if (reply && typeof reply === "object") {
    const choices = (reply as { choices?: unknown }).choices;
    value = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content : (reply as { response?: unknown }).response;
  }
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return null; } }
  const raw = value && typeof value === "object" ? (value as { name?: unknown }).name : null;
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").replace(/[^\p{L}\p{N}\s'&/-]/gu, " ").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 48 || name.split(" ").length > 5 || !/\p{L}/u.test(name) || PEOPLE.test(name)) return null;
  return name.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
}

/** The Neurons a reply reports, or the reserve when it reports none (counted high rather than low). */
const neuronsOf = (reply: unknown) => {
  const used = Number((reply as { usage?: { neurons?: unknown } } | null)?.usage?.neurons);
  return Number.isFinite(used) && used > 0 ? used : PHOTO_RESERVE;
};

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};

export type PhotoOutcome = "NAMED" | "NO_NAME" | "OFF" | "UNAVAILABLE" | "BUDGET" | "BREAKER" | "FAILED";
/** Aggregate only: the task, the outcome, the time and the cost. Never the photo or the answer. */
const log = (task: string, outcome: PhotoOutcome, ms: number, neurons: number) => console.log(JSON.stringify({ assist: task, model: PHOTO_MODEL, outcome, ms, neurons }));

/**
 * Names the thing in a catalogue photo (a JPEG of at most `MAX_PHOTO_BYTES`), or answers null for any reason at all: the caller shows
 * nothing different then. Never throws.
 */
export const MAX_PHOTO_BYTES = 400_000;
export async function photoName(db: D1Database, ai: AiRunner | undefined, jpeg: Uint8Array, urgency: Urgency, task = "PHOTO_NAME", now = Date.now()): Promise<{ name: string | null; outcome: PhotoOutcome }> {
  const started = Date.now();
  const done = (outcome: PhotoOutcome, name: string | null = null, neurons = 0) => { log(task, outcome, Date.now() - started, neurons); return { name, outcome }; };
  try {
    if (!ai) return done("UNAVAILABLE");
    if (!await assistOn(db)) return done("OFF");
    if (breaker.openUntil > now) return done("BREAKER");
    if (!mayCall(await neuronsToday(db, now), urgency)) return done("BUDGET");
    if (jpeg.length < 4 || jpeg.length > MAX_PHOTO_BYTES || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return done("NO_NAME");
    // Counted first; corrected to the reported cost below. A call that failed or timed out may still have run, so it keeps the reserve.
    await spend(db, PHOTO_RESERVE, now);
    let reply: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      reply = await Promise.race([
        ai.run(PHOTO_MODEL, {
          messages: [{ role: "system", content: INSTRUCTION }, { role: "user", content: [{ type: "text", text: "What is this item?" }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64(jpeg)}` } }] }],
          response_format: { type: "json_schema", json_schema: NAME_SCHEMA }, max_tokens: 40, temperature: 0, chat_template_kwargs: { enable_thinking: false }
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), CALL_TIMEOUT_MS); })
      ]);
    } catch {
      breaker.failures += 1;
      if (breaker.failures >= BREAKER_FAILURES) { breaker.openUntil = now + BREAKER_MS; breaker.failures = 0; }
      return done("FAILED", null, PHOTO_RESERVE);
    } finally {
      clearTimeout(timer);
    }
    breaker.failures = 0;
    const neurons = neuronsOf(reply);
    if (neurons !== PHOTO_RESERVE) await spend(db, neurons - PHOTO_RESERVE, now);
    const name = readPhotoName(reply);
    return done(name ? "NAMED" : "NO_NAME", name, neurons);
  } catch {
    return done("FAILED");
  }
}

/* ---------- After sync: one check of a capture's photo ---------- */

type CatalogRow = DuplicateKnown & { mediaId: string | null };

/**
 * Checks a just-synced capture's photo once against the catalog as it is now. Called after the item's first photo is saved, which
 * happens once per item (a repeat upload is refused), so the check cannot run twice. Stays silent unless the photo names an item the
 * Hub's own duplicate rule did not already raise for this record (those the person saw, and chose to keep, when it was saved).
 */
export async function recheckCapturedPhoto(db: D1Database, ai: AiRunner | undefined, media: R2Bucket, itemId: string, now = Date.now()): Promise<"SILENT" | "FOUND" | "SKIPPED"> {
  // Cheap checks first, so nothing is read from storage or sent to a model when the answer cannot matter.
  if (!ai || !await assistOn(db) || breaker.openUntil > now || !mayCall(await neuronsToday(db, now), "BACKGROUND")) return "SKIPPED";
  const rows = (await db.prepare(`SELECT i.id, i.name, i.aliases, i.category, i.model, i.serial_number AS serialNumber, m.dhash AS photoHash, i.status, m.media_id AS mediaId
    FROM items i LEFT JOIN item_media m ON m.item_id = i.id WHERE i.status <> 'INACTIVE'`).all<CatalogRow>()).results;
  const item = rows.find((row) => row.id === itemId);
  if (!item?.mediaId) return "SKIPPED";
  const others = rows.filter((row) => row.id !== itemId);
  // What the Hub's own rule finds for the record as saved: already shown to the person at capture, so never raised again.
  const seen = new Set(possibleDuplicates(item, others).map((match) => match.id));
  const thumb = await media.get(key(item.mediaId, "thumb"));
  if (!thumb) return "SKIPPED";
  const { name } = await photoName(db, ai, new Uint8Array(await new Response(thumb.body).arrayBuffer()), "BACKGROUND", "PHOTO_RECHECK", now);
  if (!name) return "SILENT";
  // The record may have changed while the model answered: re-read it before deciding anything.
  const current = await db.prepare("SELECT status FROM items WHERE id = ?").bind(itemId).first<{ status: string }>();
  if (!current || current.status === "INACTIVE") return "SILENT";
  const match = possibleDuplicates({ name }, others).find((each) => !seen.has(each.id));
  if (!match) return "SILENT";
  await db.prepare("INSERT OR IGNORE INTO system_settings(key, value, updated_at) VALUES(?1, ?2, ?3)")
    .bind(FINDING_PREFIX + itemId, JSON.stringify({ with: match.id, seen: name }), new Date(now).toISOString()).run();
  return "FOUND";
}

/* ---------- Attention ---------- */

/**
 * The Attention reason for a finding above. It lasts while both items are in use and nobody has decided; making either item
 * inactive (the ordinary way to retire a duplicate) or choosing "Keep both" settles it.
 */
export const PHOTO_MATCH_FROM = `FROM system_settings s JOIN items i ON i.id = substr(s.key, ${FINDING_PREFIX.length + 1}) JOIN items o ON o.id = json_extract(s.value, '$.with')
  WHERE s.key LIKE '${FINDING_PREFIX}%' AND i.status <> 'INACTIVE' AND o.status <> 'INACTIVE'`;

/** "Keep both": a person looked and decided they are different things. Audited; the finding is removed. */
export async function keepBoth(db: D1Database, actor: Actor, itemId: string): Promise<{ ok: true }> {
  const finding = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(FINDING_PREFIX + itemId).first<string>("value");
  if (!finding) throw new InputError(409, "This item no longer needs that check.");
  const other = (JSON.parse(finding) as { with?: string }).with ?? null;
  await db.batch([
    db.prepare("DELETE FROM system_settings WHERE key = ?").bind(FINDING_PREFIX + itemId),
    audit(db, actor.accountId, "POSSIBLE_DUPLICATE_KEPT", "ITEM", itemId, { other }, true)
  ]);
  return { ok: true };
}
