import { LOAN_OUTCOMES, type ReviewReason, SELF_SERVICE_LIMITS, STUDENT_ID_PATTERN, selfServiceAction } from "./catalog-policy";
import { throttled } from "./accounts";
import { type Actor, BUMP_REVISION, COUNT_TOLERANCE_DAYS, HISTORY_ORDER, InputError, catalogRevision, countAwareStatus } from "./inventory";
import { LOAN_ID, type LoanDetails, SELF_SERVICE_ACTOR, cleanText, closeStatements, lendStatements, loanDetails, officeDay, readPhoto } from "./loans";

/*
 * Phone self-service (Part 4.5). A phone records Take, Borrow and Return as immutable events,
 * offline if need be, and syncs them here. Each event is stored once under its own id, then
 * either applied through the canonical ledger and lending statements, or held for a staff
 * decision. The rules, with examples, are in docs/OFFLINE_SELF_SERVICE.md.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ITEM_ID = /^ITM-[A-Za-z0-9-]{1,24}$/;
const MINUTE = 60_000;
/** Sent this soon after it was recorded (by the phone's own clock), the person is still at the shelf. */
const LIVE_MS = 2 * MINUTE;
/** Recorded after it was sent, or older than this: the phone's clock cannot be trusted. */
const CLOCK_SLACK_MS = 10 * MINUTE;
const MAX_AGE_MS = 30 * 24 * 60 * MINUTE;
const EVENT_TYPES = ["TAKE", "BORROW", "RETURN"] as const;
/** The database's refusal to change a resolved review (trigger in migration 0015). */
const RESOLVED = "self_service_event_resolved";
/** Loans a phone created: `LN-SS-<event id>`, a namespace no staff loan uses. */
const loanIdFor = (eventId: string) => `LN-SS-${eventId}`;

type EventType = typeof EVENT_TYPES[number];
export type SyncOutcome = "accepted" | "review" | "rejected" | "retry";
export type SyncResult = { id: string; outcome: SyncOutcome; message?: string; duplicate?: true };

/** A validated event. Everything a phone sends is untrusted until it has been through parseEvent(). */
type SelfServiceEvent = {
  id: string; seq: number; type: EventType; itemId: string; quantity: number; catalogRevision: number | null;
  personName: string; studentId: string | null;
  deviceTime: string;
  /** Business time: the device clock corrected by (arrival − send time), never later than arrival. */
  occurredAt: string; live: boolean; clockIssue: boolean;
  loan: LoanDetails | null;
  loanEventId: string | null; outcome: typeof LOAN_OUTCOMES[number] | null; note: string | null;
};

/**
 * One sync request, as the Worker received it. `network` (the sender's IPv4 address or IPv6 /64)
 * is used only for limits and is never stored; `clientTag` is its keyed hash, which is stored.
 */
export type Batch = { deviceId: string; sentAt: string; offsetMs: number; receivedAt: string; network: string; clientTag: string | null; events: unknown[] };

type ItemRow = { id: string; itemType: string; status: string; needsReview: number; lendingAudience: string };

/* ---------- Public catalog ---------- */

/** The phone's catalog snapshot: only what self-service needs, never notes, history, borrowers or photos. */
export async function selfServiceCatalog(db: D1Database) {
  const { results } = await db.prepare(`SELECT i.id, i.name, i.aliases, i.category, i.unit, i.item_type AS itemType, i.status, i.needs_review AS needsReview,
      i.lending_audience AS lendingAudience, i.storage_location AS location, COALESCE(b.on_hand, 0) AS onHand
    FROM items i LEFT JOIN inventory_balances b ON b.id = i.id
    WHERE i.status = 'ACTIVE' AND i.needs_review = 0 ORDER BY i.name COLLATE NOCASE`)
    .all<ItemRow & { name: string; aliases: string | null; category: string; unit: string; location: string | null; onHand: number }>();
  const items = results.flatMap((row) => {
    const action = selfServiceAction(row);
    if (!action) return [];
    return [{
      id: row.id, name: row.name, aliases: row.aliases, category: row.category, unit: row.unit, action,
      available: Math.max(0, row.onHand), location: row.location, audience: action === "BORROW" ? row.lendingAudience : null
    }];
  });
  return { items };
}

/* ---------- Reading a request ---------- */

const bad = (message: string) => new InputError(400, message);

function whole(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw bad(message);
  return value;
}

function uuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw bad(message);
  return value;
}

function isoTime(value: unknown, message: string): number {
  const time = typeof value === "string" && value.length <= 40 ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) throw bad(message);
  return time;
}

/**
 * Reads the multipart sync request: `batch` (JSON: deviceId, sentAt, events) plus one
 * `photo:<event id>` part per borrow. The clock offset is arrival − sentAt: both times come
 * from the same phone clock as the events, so no earlier measurement is trusted.
 */
export function readBatch(form: FormData, now = Date.now()): Omit<Batch, "clientTag" | "network"> {
  let batch: unknown;
  try {
    batch = JSON.parse(String(form.get("batch") ?? ""));
  } catch {
    throw bad("Malformed sync request.");
  }
  const { deviceId, sentAt, events } = (batch ?? {}) as { deviceId?: unknown; sentAt?: unknown; events?: unknown };
  if (!Array.isArray(events) || events.length < 1 || events.length > SELF_SERVICE_LIMITS.eventsPerSync) throw bad(`Send 1 to ${SELF_SERVICE_LIMITS.eventsPerSync} records at a time.`);
  let photoCount = 0;
  form.forEach((_, key) => { if (key.startsWith("photo:")) photoCount += 1; });
  if (photoCount > SELF_SERVICE_LIMITS.photosPerSync) throw bad(`Send at most ${SELF_SERVICE_LIMITS.photosPerSync} photos at a time.`);
  const sent = isoTime(sentAt, "Malformed send time.");
  return { deviceId: uuid(deviceId, "Malformed device id."), sentAt: new Date(sent).toISOString(), offsetMs: now - sent, receivedAt: new Date(now).toISOString(), events };
}

/**
 * The sender's network: an IPv4 address, or an IPv6 address by its /64 (one phone or household
 * can use many addresses inside it). Used for limits only and never stored.
 */
export function networkOf(request: Request): string {
  const address = (request.headers.get("CF-Connecting-IP") ?? "local").toLowerCase();
  if (!address.includes(":")) return address;
  const [head = "", tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":")}::/64`;
}

/** Validates one event and works out its business time. Throws InputError for anything malformed. */
export function parseEvent(raw: unknown, batch: Pick<Batch, "sentAt" | "offsetMs" | "receivedAt">): SelfServiceEvent {
  if (!raw || typeof raw !== "object") throw bad("Malformed record.");
  const record = raw as Record<string, unknown>;
  if (record.v !== 1) throw bad("This version of the app is out of date. Please update it.");
  const id = uuid(record.id, "Malformed record id.");
  const seq = whole(record.seq, 1, 2 ** 31, "Malformed record sequence.");
  const type = record.type as EventType;
  if (!EVENT_TYPES.includes(type)) throw bad("Unknown action.");
  if (typeof record.itemId !== "string" || !ITEM_ID.test(record.itemId)) throw bad("Unknown item.");
  const quantity = whole(record.quantity, 1, SELF_SERVICE_LIMITS.quantity, `Quantity must be a whole number from 1 to ${SELF_SERVICE_LIMITS.quantity}.`);
  const catalogRevision = record.catalogRevision === null || record.catalogRevision === undefined ? null : whole(record.catalogRevision, 0, 2 ** 31, "Malformed catalog revision.");
  const person = (record.person && typeof record.person === "object" ? record.person : {}) as Record<string, unknown>;
  const personName = cleanText(person.name, "Your name", 120, true)!;
  const studentId = type === "TAKE" ? null : cleanText(person.studentId, "Student ID number", 30, false)?.toUpperCase() ?? null;
  if (studentId && !STUDENT_ID_PATTERN.test(studentId)) throw bad("Student ID number may use only letters, digits and dashes.");

  const deviceMs = isoTime(record.occurredAt, "Malformed time.");
  const sentMs = Date.parse(batch.sentAt);
  const receivedMs = Date.parse(batch.receivedAt);
  // Recorded after it was sent, or implausibly old: the time cannot be trusted, so it is held.
  const clockIssue = deviceMs > sentMs + CLOCK_SLACK_MS || sentMs - deviceMs > MAX_AGE_MS;
  const occurred = clockIssue ? receivedMs : Math.min(deviceMs + batch.offsetMs, receivedMs);
  const event: SelfServiceEvent = {
    id, seq, type, itemId: record.itemId, quantity, catalogRevision, personName, studentId, deviceTime: new Date(deviceMs).toISOString(),
    occurredAt: new Date(occurred).toISOString(), live: !clockIssue && sentMs - deviceMs <= LIVE_MS, clockIssue,
    loan: null, loanEventId: null, outcome: null, note: null
  };
  if (type === "BORROW") {
    // The staff form's rules, with "today" being the day the borrow happened (for an untrusted
    // clock, the earliest day it could have happened, so the borrow is held rather than refused).
    const fields: Record<string, unknown> = { purpose: record.purpose, borrowerName: person.name, studentId: person.studentId, reason: record.reason, quantity, returnBy: record.returnBy ?? null };
    event.loan = loanDetails((key) => fields[key], officeDay(new Date(clockIssue ? Math.min(deviceMs, receivedMs) : occurred)));
  }
  if (type === "RETURN") {
    if (typeof record.outcome !== "string" || !(LOAN_OUTCOMES as readonly string[]).includes(record.outcome)) throw bad("Choose Good condition, Damaged or Lost.");
    event.outcome = record.outcome as SelfServiceEvent["outcome"];
    event.note = cleanText(record.note, event.outcome === "LOST" ? "What happened" : "The damage", 300, event.outcome !== "RETURNED");
    event.loanEventId = record.loanEventId === null || record.loanEventId === undefined ? null : uuid(record.loanEventId, "Malformed loan reference.");
  }
  return event;
}

/* ---------- Answers ---------- */

/** What the phone is told when staff will look at an event. It never reveals anyone else's details. */
const PHONE_MESSAGES: Record<ReviewReason, string> = {
  RETURN_CHECK: "Return sent. Logistics staff will check the photo, then update the stock.",
  UNMATCHED_RETURN: "Return recorded. Logistics will match it to the loan.",
  RETURN_CONFLICT: "This loan was already closed differently. Staff will check it.",
  NOT_ELIGIBLE: "Saved for staff to confirm: this item is no longer self-service.",
  USC_ONLY: "Saved for staff to confirm: this item is lent for USC use only.",
  VOLUME: "Saved for staff to confirm: a lot of this item was recorded in the last hour.",
  CLOCK: "Saved for staff to confirm: your phone's clock looked wrong.",
  COUNT_OVERLAP: "Recorded. Staff will recount this item.",
  ERROR: "Saved for staff to check."
};
function answer(id: string, review: ReviewReason | null, duplicate = false): SyncResult {
  return { id, outcome: review ? "review" : "accepted", ...(review ? { message: PHONE_MESSAGES[review] } : {}), ...(duplicate ? { duplicate: true as const } : {}) };
}
const rejected = (id: string, message: string): SyncResult => ({ id, outcome: "rejected", message });

/* ---------- Writing one event ---------- */

type Effect = { applied: 0 | 1; review: ReviewReason | null; loanId?: string | null; movementId?: string | null; photoKey?: string | null };

/** The one insert of an event row. */
function eventRow(db: D1Database, event: SelfServiceEvent, batch: Batch, effect: Effect): D1PreparedStatement {
  return db.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, purpose, reason,
      return_outcome, note, return_by, loan_event_id, photo_key, device_time, sent_at, occurred_at, received_at, client_tag, catalog_revision,
      loan_id, movement_id, applied, review)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)`)
    .bind(event.id, batch.deviceId, event.seq, event.type, event.itemId, event.quantity, event.personName, event.loan?.studentId ?? event.studentId,
      event.loan?.purpose ?? null, event.loan?.reason ?? null, event.outcome, event.note, event.loan?.returnBy ?? null, event.loanEventId, effect.photoKey ?? null,
      event.deviceTime, batch.sentAt, event.occurredAt, batch.receivedAt, batch.clientTag, event.catalogRevision,
      effect.loanId ?? null, effect.movementId ?? null, effect.applied, effect.review);
}

/**
 * Runs one event's batch. A concurrent copy of the same event loses on the primary key and reads
 * as a duplicate. `decide` may settle the review from the batch's own results (see applyReturn).
 */
async function write(db: D1Database, event: SelfServiceEvent, statements: D1PreparedStatement[], review: ReviewReason | null,
  decide?: (results: D1Result[]) => ReviewReason | null): Promise<SyncResult> {
  try {
    const results = await db.batch([...statements, db.prepare(BUMP_REVISION)]);
    return answer(event.id, decide ? decide(results) : review);
  } catch (error) {
    const twin = await db.prepare("SELECT review FROM self_service_events WHERE id = ?").bind(event.id).first<{ review: ReviewReason | null }>();
    if (twin) return answer(event.id, twin.review, true);
    throw error;
  }
}

/**
 * Keeps an event for a staff decision without applying it. A network may leave only so many of
 * these a day, so a flood of made-up records cannot bury the review page or fill storage.
 */
async function hold(db: D1Database, event: SelfServiceEvent, batch: Batch, review: ReviewReason, extra: Partial<Effect> = {}): Promise<SyncResult> {
  if (review !== "ERROR" && review !== "RETURN_CHECK" && await throttled(db, `self-service-held:${batch.network}`, SELF_SERVICE_LIMITS.heldPerNetworkDay, 24 * 60 * MINUTE)) {
    return rejected(event.id, "Too many records from this network need a staff check today. Please see Logistics staff.");
  }
  return write(db, event, [eventRow(db, event, batch, { applied: 0, review, ...extra })], review);
}

/** The self-service Take: a STOCK_OUT the phone recorded. Never refused for quantity; see stockIssues(). */
function takeStatement(db: D1Database, movementId: string, eventId: string, itemId: string, quantity: number, at: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity,
      related_entity_type, related_entity_id, actor_user_id, idempotency_key, reason, status)
    SELECT ?1, ?2, 'STOCK_OUT', 'OUT', i.id, ?3, i.unit, -?3, 'SELF_SERVICE', ?4, '${SELF_SERVICE_ACTOR}', ?5, 'CONSUMED', ${countAwareStatus("i.id", "?2")}
    FROM items i WHERE i.id = ?6`).bind(movementId, at, quantity, eventId, `ss:${eventId}`, itemId);
}

type Context = { overlap: boolean; recentUnits: number };

/**
 * Per-event facts, in one query: a physical count right beside `at`, and this item's
 * self-service volume in the last hour. Read before the write, so two requests at the same
 * moment can both pass the volume check; the request throttles bound that.
 */
async function context(db: D1Database, itemId: string, at: string, receivedAt: string): Promise<Context> {
  const row = await db.prepare(`SELECT EXISTS (SELECT 1 FROM inventory_movements WHERE item_id = ?1 AND movement_type = 'COUNT_ADJUSTMENT' AND status = 'POSTED'
        AND imported_from IS NULL AND julianday(created_at) BETWEEN julianday(?2) - ?3 AND julianday(?2) + ?3) AS overlap,
      (SELECT COALESCE(SUM(quantity), 0) FROM self_service_events WHERE item_id = ?1 AND event_type <> 'RETURN' AND applied = 1
        AND received_at > strftime('%Y-%m-%dT%H:%M:%fZ', ?4, '-1 hour')) AS recentUnits`)
    .bind(itemId, at, COUNT_TOLERANCE_DAYS, receivedAt).first<{ overlap: number; recentUnits: number }>();
  return { overlap: row?.overlap === 1, recentUnits: row?.recentUnits ?? 0 };
}

/**
 * An unexpected failure: the event is kept for staff (with its photo) if the database is
 * reachable; otherwise the phone keeps it and tries again later.
 */
async function failed(db: D1Database, bucket: R2Bucket, event: SelfServiceEvent, batch: Batch, error: unknown, photoKey: string | null = null): Promise<SyncResult> {
  console.error("self_service_event_failed", { type: event.type, message: error instanceof Error ? error.message : "unknown" });
  const kept = await hold(db, event, batch, "ERROR", { photoKey }).catch(() => null);
  if (photoKey && (!kept || kept.duplicate)) await bucket.delete(photoKey);
  return kept ?? { id: event.id, outcome: "retry" };
}

/**
 * Validates and stores a phone's photo in the private bucket. The key is unique per attempt, so a
 * failed attempt never deletes the photo of a concurrent successful one. Returns the answer to
 * send instead when the photo is unusable or the upload must be retried.
 */
async function uploadPhoto(bucket: R2Bucket, event: SelfServiceEvent, photoPart: unknown, again: string, keyPrefix: string): Promise<{ key: string } | SyncResult> {
  const photo = await readPhoto(photoPart).catch((error: unknown) => { if (error instanceof InputError) return error; throw error; });
  if (photo instanceof InputError) return rejected(event.id, `${photo.message} Take the photo again and ${again}.`);
  if (photo.bytes.length > SELF_SERVICE_LIMITS.photoBytes) return rejected(event.id, `The photo is too large. Take it again and ${again}.`);
  const key = `${keyPrefix}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await bucket.put(key, photo.bytes, { httpMetadata: { contentType: photo.contentType } });
  } catch (error) {
    console.error("self_service_photo_failed", { message: error instanceof Error ? error.message : "unknown" });
    return { id: event.id, outcome: "retry", message: "The photo could not be uploaded yet." };
  }
  return { key };
}

/**
 * Take and Borrow. Ineligible while the person is still here: refused. Anything that cannot
 * be applied safely (ineligible late, implausible clock, over the hourly volume) is held for
 * staff with all its evidence, including a borrow's photo. Otherwise it is applied.
 */
async function applyOut(db: D1Database, bucket: R2Bucket, event: SelfServiceEvent, batch: Batch, item: ItemRow, photoPart: unknown): Promise<SyncResult> {
  const uscOnly = event.type === "BORROW" && item.lendingAudience === "USC_STAFF_ONLY" && event.loan!.purpose !== "USC";
  const eligible = selfServiceAction(item) === event.type && !uscOnly;
  if (!eligible && event.live) return rejected(event.id, uscOnly ? "This item is lent for USC use only." : "This item is not available for self-service right now. Please ask Logistics staff.");
  let photoKey: string | null = null;
  if (event.type === "BORROW") {
    // Saved with its photo in one step on the phone, so a missing photo is never a real borrow.
    const stored = await uploadPhoto(bucket, event, photoPart, "borrow once more", `loans/${loanIdFor(event.id)}`);
    if ("outcome" in stored) return stored;
    photoKey = stored.key;
  }
  let result: SyncResult;
  try {
    const facts = await context(db, event.itemId, event.occurredAt, batch.receivedAt);
    const held: ReviewReason | null = event.clockIssue ? "CLOCK" : uscOnly ? "USC_ONLY" : !eligible ? "NOT_ELIGIBLE"
      : facts.recentUnits + event.quantity > SELF_SERVICE_LIMITS.unitsPerItemHour ? "VOLUME" : null;
    const review: ReviewReason | null = facts.overlap ? "COUNT_OVERLAP" : null;
    const movementId = `MOV-${crypto.randomUUID()}`;
    if (held) result = await hold(db, event, batch, held, { photoKey });
    else if (event.type === "TAKE") {
      result = await write(db, event, [
        takeStatement(db, movementId, event.id, event.itemId, event.quantity, event.occurredAt),
        eventRow(db, event, batch, { applied: 1, review, movementId })
      ], review);
    } else {
      const loanId = loanIdFor(event.id);
      result = await write(db, event, [
        ...lendStatements(db, { id: loanId, itemId: event.itemId, details: event.loan!, photoKey: photoKey!, movementId, key: `ss:${event.id}`, actorId: SELF_SERVICE_ACTOR, at: event.occurredAt, allowShort: true, countAware: true }),
        eventRow(db, event, batch, { applied: 1, review, loanId, movementId, photoKey })
      ], review);
    }
  } catch (error) {
    return failed(db, bucket, event, batch, error, photoKey);
  }
  // A copy of this event was already stored (with its own photo), or it was refused: this upload is not needed.
  if (photoKey && (result.duplicate || result.outcome === "rejected")) await bucket.delete(photoKey);
  return result;
}

type LinkedLoan = { id: string | null; itemId: string; quantity: number; status: string; createdAt: string };

/**
 * The borrow a return names, if this same phone made it, with its loan (none while the borrow is
 * held for staff). A return without that link (borrowed at the desk, on another phone, or the
 * phone lost its data) always waits for staff to match it: matching by name or student ID would
 * let anyone close someone else's loan, and would tell them whether it exists.
 */
async function linkedBorrow(db: D1Database, event: SelfServiceEvent, deviceId: string): Promise<LinkedLoan | null> {
  return db.prepare(`SELECT l.id, l.item_id AS itemId, l.quantity, l.status, l.created_at AS createdAt
    FROM self_service_events b LEFT JOIN loans l ON l.id = b.loan_id AND l.item_id = b.item_id
    WHERE b.id = ? AND b.device_id = ? AND b.event_type = 'BORROW' AND b.item_id = ?`).bind(event.loanEventId, deviceId, event.itemId).first<LinkedLoan>();
}

/**
 * Marks a return applied only if this request's close actually closed the loan (by
 * self-service, at exactly `at`, with this request's movement if any). Used by phone returns and
 * staff matching alike, so a close by someone else a moment earlier is never recorded as this one.
 * `fields` may set more columns, bound from ?5 on.
 */
function closedByThis(db: D1Database, eventId: string, loanId: string, at: string, movementId: string, fields: string, ...extra: unknown[]): D1PreparedStatement {
  return db.prepare(`UPDATE self_service_events SET ${fields}applied = 1, loan_id = ?2, movement_id = (SELECT return_movement_id FROM loans WHERE id = ?2)
    WHERE id = ?1 AND EXISTS (SELECT 1 FROM loans WHERE id = ?2 AND closed_by = '${SELF_SERVICE_ACTOR}' AND closed_at = ?3
      AND return_movement_id IS (SELECT id FROM inventory_movements WHERE id = ?4))`).bind(eventId, loanId, at, movementId, ...extra);
}

/**
 * A return never changes stock by itself. It arrives with a photo of the item and waits for DOL
 * staff (RETURN_CHECK); accepting it (resolveReview "match") closes the loan and puts the quantity
 * back. One that cannot be tied to exactly one matching open loan is held for a person with the
 * reason why. A loan already closed the same way at the desk needs nothing.
 */
async function applyReturn(db: D1Database, bucket: R2Bucket, event: SelfServiceEvent, batch: Batch, photoPart: unknown): Promise<SyncResult> {
  const borrow = event.loanEventId ? await linkedBorrow(db, event, batch.deviceId) : null;
  // Its borrow was refused, so there is nothing to return; the phone drops both.
  if (event.loanEventId && !borrow) return rejected(event.id, "The borrow this return belongs to was not recorded. Please see Logistics staff.");
  const loan = borrow?.id ? { ...borrow, id: borrow.id } : null;
  if (loan && loan.status === event.outcome) return write(db, event, [eventRow(db, event, batch, { applied: 0, review: null, loanId: loan.id })], null);
  const stored = await uploadPhoto(bucket, event, photoPart, "return it once more", `returns/${event.id}`);
  if ("outcome" in stored) return stored;
  const review: ReviewReason = event.clockIssue ? "CLOCK" : !loan ? "UNMATCHED_RETURN"
    : loan.quantity !== event.quantity || loan.status !== "OUT" ? "RETURN_CONFLICT" : "RETURN_CHECK";
  let result: SyncResult;
  try {
    result = await hold(db, event, batch, review, { photoKey: stored.key, loanId: loan?.id ?? null });
  } catch (error) {
    return failed(db, bucket, event, batch, error, stored.key);
  }
  if (result.duplicate || result.outcome === "rejected") await bucket.delete(stored.key);
  return result;
}

/**
 * Ingests one batch from one phone, in the order sent (the phone's own sequence). The first
 * transient failure stops the batch, so a return is never processed before its borrow. An
 * unexpected error is held for staff rather than retried forever.
 */
export async function syncEvents(db: D1Database, bucket: R2Bucket, batch: Batch, photos: (id: string) => unknown) {
  const ids = batch.events.map((raw) => typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id.slice(0, 40) : "");
  const itemIds = batch.events.map((raw) => (raw as { itemId?: unknown })?.itemId).filter((id): id is string => typeof id === "string" && ITEM_ID.test(id));
  const marks = (list: string[]) => list.map(() => "?").join(",") || "''";
  // Everything the batch needs to know up front, in two queries.
  const [known, items] = await db.batch([
    db.prepare(`SELECT id, review FROM self_service_events WHERE id IN (${marks(ids)})`).bind(...ids),
    db.prepare(`SELECT id, item_type AS itemType, status, needs_review AS needsReview, lending_audience AS lendingAudience
      FROM items WHERE id IN (${marks(itemIds)})`).bind(...itemIds)
  ]);
  const stored = new Map((known.results as Array<{ id: string; review: ReviewReason | null }>).map((row) => [row.id, row.review]));
  const catalog = new Map((items.results as ItemRow[]).map((row) => [row.id, row]));

  const results: SyncResult[] = [];
  let stopped = false;
  for (const [index, raw] of batch.events.entries()) {
    const id = ids[index]!;
    if (stopped) { results.push({ id, outcome: "retry" }); continue; }
    if (stored.has(id)) { results.push(answer(id, stored.get(id)!, true)); continue; }
    let event: SelfServiceEvent;
    try {
      event = parseEvent(raw, batch);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      results.push(rejected(id, error.message));
      continue;
    }
    const item = catalog.get(event.itemId);
    if (!item) { results.push(rejected(id, "This item is no longer in the catalog.")); continue; }
    const result = await (event.type === "RETURN" ? applyReturn(db, bucket, event, batch, photos(event.id)) : applyOut(db, bucket, event, batch, item, photos(event.id)))
      .catch((error: unknown) => failed(db, bucket, event, batch, error));
    results.push(result);
    stopped = result.outcome === "retry";
  }
  return { revision: await catalogRevision(db), results };
}

/* ---------- Staff review ---------- */

const EVENT_COLUMNS = `SELECT e.id, e.event_type AS type, e.item_id AS itemId, i.name AS itemName, i.unit, e.quantity, e.person_name AS personName,
  e.student_id AS studentId, e.purpose, e.reason, e.return_outcome AS returnOutcome, e.note, e.return_by AS returnBy, e.occurred_at AS occurredAt,
  e.received_at AS receivedAt, e.device_time AS deviceTime, e.loan_id AS loanId, e.applied, e.review, e.photo_key IS NOT NULL AS hasPhoto,
  e.resolved_at AS resolvedAt, e.resolution_note AS resolutionNote, r.display_name AS resolvedBy,
  substr(e.device_id, 1, 6) AS device, e.client_tag AS network
  FROM self_service_events e JOIN items i ON i.id = e.item_id LEFT JOIN staff_accounts r ON r.id = e.resolved_by`;

/**
 * Items whose balance, rebuilt in business order since their last physical count, went below
 * zero: something was recorded that the shelf could not have held. Derived on every read, so
 * it clears itself when a late return fills the gap or a new count is recorded.
 */
function stockIssues(db: D1Database, since: string): D1PreparedStatement {
  return db.prepare(`WITH touched AS (SELECT DISTINCT item_id FROM self_service_events WHERE received_at >= ?1 AND applied = 1),
    counted AS (SELECT item_id, MAX(julianday(created_at)) AS at FROM inventory_movements
      WHERE movement_type = 'COUNT_ADJUSTMENT' AND status = 'POSTED' AND imported_from IS NULL AND item_id IN (SELECT item_id FROM touched) GROUP BY item_id),
    running AS (SELECT m.item_id AS itemId, m.created_at AS at, CASE WHEN m.imported_from IS NULL THEN julianday(m.created_at) ELSE 0 END AS t,
      SUM(m.signed_quantity) OVER (PARTITION BY m.item_id ORDER BY ${HISTORY_ORDER}) AS balance
      FROM inventory_movements m WHERE m.status = 'POSTED' AND m.item_id IN (SELECT item_id FROM touched))
    SELECT r.itemId, i.name AS itemName, i.unit, MIN(r.balance) AS lowest, MIN(CASE WHEN r.balance < 0 THEN r.at END) AS since,
      (SELECT on_hand FROM inventory_balances WHERE id = r.itemId) AS onHand,
      (SELECT COUNT(*) FROM loans WHERE item_id = r.itemId AND status = 'OUT') AS openLoans
    FROM running r JOIN items i ON i.id = r.itemId LEFT JOIN counted c ON c.item_id = r.itemId
    WHERE r.t >= COALESCE(c.at, 0) GROUP BY r.itemId HAVING MIN(r.balance) < 0 ORDER BY i.name`).bind(since);
}

/** The staff exception view in one revisioned payload: open reviews, stock issues, the last week's activity and loans an unmatched return could belong to. */
export async function selfServiceReview(db: D1Database) {
  const since = new Date(Date.now() - 7 * 24 * 60 * MINUTE).toISOString();
  const [open, issues, recent, candidates] = await db.batch([
    db.prepare(`${EVENT_COLUMNS} WHERE e.review IS NOT NULL AND e.resolved_at IS NULL ORDER BY e.received_at DESC LIMIT 200`),
    stockIssues(db, new Date(Date.now() - 30 * 24 * 60 * MINUTE).toISOString()),
    db.prepare(`${EVENT_COLUMNS} WHERE e.received_at >= ? ORDER BY e.occurred_at DESC LIMIT 200`).bind(since),
    db.prepare(`SELECT l.id, l.item_id AS itemId, l.quantity, l.purpose, l.borrower_name AS borrowerName, l.student_id AS studentId, l.created_at AS createdAt
      FROM loans l WHERE l.status = 'OUT' AND l.item_id IN (SELECT item_id FROM self_service_events WHERE review IN ('RETURN_CHECK', 'UNMATCHED_RETURN', 'RETURN_CONFLICT', 'CLOCK') AND event_type = 'RETURN' AND resolved_at IS NULL)
      ORDER BY l.created_at`)
  ]);
  return { open: open.results, stockIssues: issues.results, recent: recent.results, candidates: candidates.results, enabledItems: (await selfServiceCatalog(db)).items.length };
}

type HeldEvent = {
  id: string; type: EventType; itemId: string; quantity: number; personName: string; studentId: string | null; purpose: LoanDetails["purpose"] | null;
  reason: string | null; returnBy: string | null; outcome: typeof LOAN_OUTCOMES[number] | null; note: string | null; occurredAt: string;
  photoKey: string | null; applied: number; review: ReviewReason | null; resolvedAt: string | null;
};

/**
 * Closes a review. `apply` applies a held Take or Borrow exactly as if it had been eligible;
 * `match` closes the chosen open loan with a held Return, at the time it happened; `dismiss`
 * closes the review without changing anything (a held borrow's photo is then deleted).
 * A resolution is final: the database refuses to change a resolved record (migration 0015), so
 * of two staff acting on one record at once, the second batch is rolled back whole.
 */
export async function resolveReview(db: D1Database, bucket: R2Bucket, actor: Actor, id: string, body: unknown) {
  if (!UUID.test(id)) throw new InputError(404, "Nothing to review.");
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = record.action;
  if (action !== "apply" && action !== "match" && action !== "dismiss") throw new InputError(400, "Choose Apply, Match or Dismiss.");
  const note = cleanText(record.note, "Note", 300, false);
  const event = await db.prepare(`SELECT id, event_type AS type, item_id AS itemId, quantity, person_name AS personName, student_id AS studentId, purpose, reason,
      return_by AS returnBy, return_outcome AS outcome, note, occurred_at AS occurredAt, photo_key AS photoKey, applied, review, resolved_at AS resolvedAt
    FROM self_service_events WHERE id = ?`).bind(id).first<HeldEvent>();
  if (!event?.review) throw new InputError(404, "Nothing to review.");
  if (event.resolvedAt) return { resolved: true };
  const now = new Date().toISOString();
  const resolution = [now, actor.accountId, note] as const;
  // Marks the review resolved; `fields` may set more columns, bound from ?5 on.
  const resolve = (fields = "", ...extra: string[]) => db.prepare(`UPDATE self_service_events SET ${fields}resolved_at = ?1, resolved_by = ?2, resolution_note = ?3 WHERE id = ?4`)
    .bind(...resolution, id, ...extra);
  const run = (statements: D1PreparedStatement[]) => db.batch([...statements, db.prepare(BUMP_REVISION)]).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes(RESOLVED)) throw new InputError(409, "Someone else resolved this a moment ago. Refresh to see the latest.");
    throw error;
  });

  if (action === "dismiss") {
    await run([resolve()]);
    if (!event.applied && event.photoKey) await bucket.delete(event.photoKey);
    return { resolved: true };
  }
  if (event.applied) throw new InputError(409, "This record was already applied. Dismiss the review once checked.");
  const movementId = `MOV-${crypto.randomUUID()}`;

  if (action === "apply") {
    if (event.type === "RETURN") throw new InputError(400, "Match a return to its loan instead.");
    if (event.type === "BORROW" && !event.photoKey) throw new InputError(400, "This borrow has no photo. Dismiss it and lend the item at the desk instead.");
    const loanId = loanIdFor(event.id);
    await run(event.type === "TAKE"
      ? [resolve("applied = 1, movement_id = ?5, ", movementId), takeStatement(db, movementId, event.id, event.itemId, event.quantity, event.occurredAt)]
      : [
        resolve("applied = 1, movement_id = ?5, loan_id = ?6, ", movementId, loanId),
        ...lendStatements(db, {
          id: loanId, itemId: event.itemId, photoKey: event.photoKey!, movementId, key: `ss:${event.id}`, actorId: SELF_SERVICE_ACTOR, at: event.occurredAt, allowShort: true, countAware: true,
          details: { purpose: event.purpose ?? "INDIVIDUAL", borrowerName: event.personName, studentId: event.studentId, reason: event.reason, quantity: event.quantity, returnBy: event.returnBy }
        })
      ]);
    return { resolved: true };
  }

  if (event.type !== "RETURN" || !event.outcome) throw new InputError(400, "Only a return can be matched to a loan.");
  if (typeof record.loanId !== "string" || !LOAN_ID.test(record.loanId)) throw new InputError(400, "Choose an open loan.");
  const loan = await db.prepare("SELECT item_id AS itemId, quantity, status, created_at AS createdAt FROM loans WHERE id = ?").bind(record.loanId)
    .first<{ itemId: string; quantity: number; status: string; createdAt: string }>();
  if (!loan || loan.itemId !== event.itemId) throw new InputError(400, "Choose an open loan of the same item.");
  if (loan.status !== "OUT") throw new InputError(409, "That loan was already closed. Refresh to see the latest.");
  if (loan.quantity !== event.quantity) throw new InputError(400, `That loan is for ${loan.quantity}, but ${event.quantity} came back. Return it from Loans and record a count instead.`);
  const at = event.occurredAt < loan.createdAt ? loan.createdAt : event.occurredAt;
  const results = await run([
    ...closeStatements(db, { loanId: record.loanId, itemId: loan.itemId, quantity: loan.quantity, outcome: event.outcome, note: event.note, actorId: SELF_SERVICE_ACTOR, at, movementId, countAware: true }),
    closedByThis(db, id, record.loanId, at, movementId, "resolved_at = ?5, resolved_by = ?6, resolution_note = ?7, ", ...resolution)
  ]);
  // Closed at the desk between reading and writing: nothing was changed.
  if (!results.at(-2)!.meta.changes) throw new InputError(409, "That loan was already closed. Refresh to see the latest.");
  return { resolved: true };
}

/** Staff-only stream of a held borrow's photo (an applied borrow's photo is served with its loan). */
export async function heldPhoto(db: D1Database, bucket: R2Bucket, id: string): Promise<Response> {
  if (!UUID.test(id)) throw new InputError(404, "Photo not found.");
  const key = await db.prepare("SELECT photo_key AS photoKey FROM self_service_events WHERE id = ?").bind(id).first<string>("photoKey");
  const object = key ? await bucket.get(key) : null;
  if (!object) throw new InputError(404, "Photo not found.");
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, no-store" } });
}
