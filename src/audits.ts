import { bulkUpdate } from "./bulk";
import { type Actor, BUMP_REVISION, InputError, audit, pathsOf, recordMovement, text, usablePlace } from "./inventory";
import { reportLocation } from "./location-reports";
import { LOCATION_ID } from "./location-tree";

/*
 * Physical inventory by location (V1.7). An audit is one staff member checking what should be at one place and the places inside it.
 * What they see is recorded as observations: append-only, keyed by the request id the device made, so a resend never repeats one.
 * Nothing here changes stock. Each discrepancy is settled at the review, after finishing, through the existing ledger: a count
 * movement guarded by the figure the observation was made against, so a count never overwrites a balance that moved meanwhile.
 */

export const AUDIT_ID = /^LA-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ITEM_ID = /^ITM-[A-Za-z0-9-]{1,24}$/;
export const OUTCOMES = ["CONFIRMED", "MISMATCH", "CANT_FIND", "FOUND_HERE", "UNLISTED", "NEEDS_REVIEW"] as const;
export type Outcome = typeof OUTCOMES[number];
/** Outcomes that need a decision at the review; CONFIRMED needs none. */
export const DISCREPANCIES: readonly Outcome[] = ["MISMATCH", "CANT_FIND", "FOUND_HERE", "UNLISTED", "NEEDS_REVIEW"];
export const RESOLUTIONS = ["POSTED_COUNT", "MOVED_HERE", "REPORTED", "NO_CHANGE"] as const;
type Resolution = typeof RESOLUTIONS[number];
/** Large enough for a whole storeroom, bounded however big the catalog grows. */
const EXPECTED_LIMIT = 2000;
const FINISHED = "That check is finished. Start a new one to keep checking this place.";

type AuditRow = { id: string; locationId: string; place: string | null; status: string; expectedAtStart: number; placeNote: string | null; startedAt: string; updatedAt: string;
  finishedAt: string | null; startedBy: string; owner: string; finishedBy: string | null };
const AUDIT_COLUMNS = `a.id, a.location_id AS locationId, lp.path AS place, a.status, a.expected_at_start AS expectedAtStart, a.place_note AS placeNote, a.started_at AS startedAt,
  a.updated_at AS updatedAt, a.finished_at AS finishedAt, a.started_by AS startedBy, s.display_name AS owner, f.display_name AS finishedBy
  FROM location_audits a JOIN staff_accounts s ON s.id = a.started_by LEFT JOIN staff_accounts f ON f.id = a.finished_by LEFT JOIN location_paths lp ON lp.id = a.location_id`;

/** The place and every place inside it, as a CTE named `inside(id)`. */
const INSIDE = `WITH RECURSIVE inside(id, depth) AS (SELECT ?1, 0 UNION ALL SELECT l.id, inside.depth + 1 FROM locations l JOIN inside ON l.parent_id = inside.id WHERE inside.depth < 8)`;

const object = (input: unknown): Record<string, unknown> => input && typeof input === "object" ? input as Record<string, unknown> : {};
const shown = ({ startedBy, ...row }: AuditRow, me: string) => ({ ...row, mine: startedBy === me });

function placeId(value: unknown): string {
  if (typeof value !== "string" || !LOCATION_ID.test(value)) throw new InputError(400, "Choose the place to check.");
  return value;
}

async function auditRow(db: D1Database, id: string): Promise<AuditRow> {
  if (!AUDIT_ID.test(id)) throw new InputError(404, "Check not found.");
  const row = await db.prepare(`SELECT ${AUDIT_COLUMNS} WHERE a.id = ?`).bind(id).first<AuditRow>();
  if (!row) throw new InputError(404, "Check not found.");
  return row;
}

async function ownAudit(db: D1Database, actor: Actor, id: string): Promise<AuditRow> {
  const row = await auditRow(db, id);
  if (row.startedBy !== actor.accountId) throw new InputError(403, `${row.owner} is checking this place. Only they can add to their check.`);
  return row;
}

/** How many items are recorded at the place (and inside it) now; retired items are not expected anywhere. */
const expectedCount = (db: D1Database, locationId: string) =>
  db.prepare(`${INSIDE} SELECT COUNT(*) AS n FROM items i WHERE i.location_id IN (SELECT id FROM inside) AND i.status <> 'INACTIVE'`).bind(locationId).first<number>("n");

/** The checks this person has open or paused: what Catalogue resumes and what Home offers to continue. */
export const openChecks = (db: D1Database, actor: Actor) => db.prepare(`SELECT ${AUDIT_COLUMNS} WHERE a.status <> 'FINISHED' AND a.started_by = ? ORDER BY a.updated_at DESC LIMIT 20`).bind(actor.accountId);

/** The checks this person has open or paused, who else is checking where, and the latest finished checks. */
export async function auditState(db: D1Database, actor: Actor) {
  const [mine, others, finished] = await db.batch([
    openChecks(db, actor),
    db.prepare(`SELECT ${AUDIT_COLUMNS} WHERE a.status <> 'FINISHED' AND a.started_by <> ? ORDER BY a.started_at LIMIT 20`).bind(actor.accountId),
    db.prepare(`SELECT ${AUDIT_COLUMNS} WHERE a.status = 'FINISHED' ORDER BY a.finished_at DESC LIMIT 10`)
  ]);
  const list = (result: D1Result | undefined) => (result!.results as AuditRow[]).map((row) => shown(row, actor.accountId));
  return { mine: list(mine), others: list(others), finished: list(finished) };
}

/**
 * Starts a check of a place, or answers with the one already open there: this person's resumes; someone else's is refused, so two people
 * never check one shelf against each other unknowingly. A device that started a check without a connection proposes the id it used.
 */
export async function startAudit(db: D1Database, actor: Actor, input: unknown) {
  const body = object(input);
  if (body.id !== undefined && (typeof body.id !== "string" || !AUDIT_ID.test(body.id))) throw new InputError(400, "That check id is not valid. Reload and try again.");
  const locationId = placeId(body.locationId);
  const open = async () => db.prepare(`SELECT a.id, a.started_by AS startedBy, s.display_name AS owner FROM location_audits a JOIN staff_accounts s ON s.id = a.started_by
    WHERE a.location_id = ? AND a.status <> 'FINISHED'`).bind(locationId).first<{ id: string; startedBy: string; owner: string }>();
  const resumed = (found: { id: string; startedBy: string; owner: string }) => {
    if (found.startedBy !== actor.accountId) throw new InputError(409, `${found.owner} is already checking this place. Ask them, or check another place.`);
    return { id: found.id, resumed: true };
  };
  const existing = await open();
  if (existing) return resumed(existing);
  await usablePlace(db, locationId);
  const used = typeof body.id === "string" ? await db.prepare("SELECT started_by FROM location_audits WHERE id = ?").bind(body.id).first<string>("started_by") : null;
  if (used && used !== actor.accountId) throw new InputError(409, "That check id is already used. Reload and try again.");
  const id = typeof body.id === "string" && !used ? body.id : `LA-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expected = await expectedCount(db, locationId) ?? 0;
  const place = (await pathsOf(db, [locationId])).get(locationId) ?? null;
  try {
    await db.batch([
      db.prepare("INSERT INTO location_audits(id, location_id, started_by, status, expected_at_start, started_at, updated_at) VALUES(?, ?, ?, 'OPEN', ?, ?, ?)")
        .bind(id, locationId, actor.accountId, expected, now, now),
      audit(db, actor.accountId, "AUDIT_STARTED", "AUDIT", id, { place, locationId, expected })
    ]);
  } catch (error) {
    // Two starts at once (two devices, or two people): the database allows one open check per place.
    const raced = await open();
    if (raced) return resumed(raced);
    throw error;
  }
  return { id, resumed: false };
}

type Observation = { id: string; itemId: string | null; outcome: Outcome; expectedOnHand: number | null; counted: number | null; onHandAtReceipt: number | null;
  recordedLocationId: string | null; seenLocationId: string | null; note: string | null; observedAt: string; receivedAt: string; observedBy: string };
const OBSERVATION_COLUMNS = `o.id, o.item_id AS itemId, o.outcome, o.expected_on_hand AS expectedOnHand, o.counted, o.on_hand_at_receipt AS onHandAtReceipt,
  o.recorded_location_id AS recordedLocationId, o.seen_location_id AS seenLocationId, o.note, o.observed_at AS observedAt, o.received_at AS receivedAt, s.display_name AS observedBy`;
/** The latest observation of each item in an audit (a second look replaces the first in progress; both stay on record). */
const LATEST = `SELECT ${OBSERVATION_COLUMNS} FROM location_audit_observations o JOIN staff_accounts s ON s.id = o.observed_by
  WHERE o.audit_id = ?1 AND o.rowid IN (SELECT MAX(rowid) FROM location_audit_observations WHERE audit_id = ?1 GROUP BY COALESCE(item_id, id))`;

/**
 * One check: the place, the items recorded there now (with where inside it, on hand, on loan and when last counted or seen), the latest
 * observation of each, and anything found that was not on the list. Progress is counted from these, so it is always the live truth.
 */
export async function auditDetail(db: D1Database, actor: Actor, id: string) {
  const row = await auditRow(db, id);
  const [expected, latest, placeInfo] = await db.batch([
    db.prepare(`${INSIDE} SELECT i.id, i.name, i.unit, i.status, i.location_id AS locationId, lp.path AS place, COALESCE(b.on_hand, 0) AS onHand, p.media_id AS photoId,
        (SELECT COALESCE(SUM(l.quantity), 0) FROM loans l WHERE l.item_id = i.id AND l.status = 'OUT') AS onLoan,
        (SELECT MAX(m.created_at) FROM inventory_movements m WHERE m.item_id = i.id AND m.movement_type = 'COUNT_ADJUSTMENT' AND m.imported_from IS NULL) AS lastCountedAt
      FROM items i LEFT JOIN inventory_balances b ON b.id = i.id LEFT JOIN location_paths lp ON lp.id = i.location_id LEFT JOIN item_media p ON p.item_id = i.id
      WHERE i.location_id IN (SELECT id FROM inside) AND i.status <> 'INACTIVE' ORDER BY lp.path, i.name COLLATE NOCASE, i.id LIMIT ${EXPECTED_LIMIT}`).bind(row.locationId),
    db.prepare(LATEST).bind(id),
    db.prepare("SELECT l.directions, l.media_id AS mediaId, l.media_width AS mediaWidth, l.media_height AS mediaHeight FROM locations l WHERE l.id = ?").bind(row.locationId)
  ]);
  const observations = latest!.results as Observation[];
  const items = expected!.results as Array<{ id: string }>;
  const listed = new Set(items.map((item) => item.id));
  const byItem = new Map(observations.filter((entry) => entry.itemId && listed.has(entry.itemId)).map((entry) => [entry.itemId!, entry]));
  // Seen here but recorded elsewhere, or not in the catalog at all.
  const extras = observations.filter((entry) => !entry.itemId || !listed.has(entry.itemId));
  const extraNames = extras.some((entry) => entry.itemId) ? await namesOf(db, extras.map((entry) => entry.itemId).filter((value): value is string => Boolean(value))) : new Map<string, string>();
  return {
    audit: shown(row, actor.accountId),
    place: placeInfo!.results[0] ?? null,
    items: items.map((item) => ({ ...item, observation: byItem.get(item.id) ?? null })),
    extras: extras.map((entry) => ({ ...entry, name: entry.itemId ? extraNames.get(entry.itemId) ?? entry.itemId : entry.note })),
    checked: byItem.size
  };
}

async function namesOf(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const { results } = await db.prepare(`SELECT id, name FROM items WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; name: string }>();
  return new Map(results.map((row) => [row.id, row.name]));
}

function whole(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100_000) throw new InputError(400, `${label} must be a whole number from 0 to 100000.`);
  return value;
}

/**
 * Records what was seen. The device sends the on-hand figure it showed (`expectedOnHand`); the server keeps its own beside it, so a
 * count made against stale figures is never mistaken for the truth at the review. Observing a paused check resumes it.
 */
export async function observe(db: D1Database, actor: Actor, auditId: string, input: unknown) {
  const row = await ownAudit(db, actor, auditId);
  const body = object(input);
  const requestId = body.id;
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) throw new InputError(400, "Missing request id. Reload and try again.");
  const replay = await db.prepare("SELECT audit_id AS auditId FROM location_audit_observations WHERE id = ?").bind(requestId).first<{ auditId: string }>();
  if (replay) {
    if (replay.auditId !== auditId) throw new InputError(409, "That request was already used. Reload and try again.");
    return { id: requestId, replayed: true };
  }
  if (row.status === "FINISHED") throw new InputError(409, FINISHED);
  const outcome = body.outcome;
  if (typeof outcome !== "string" || !(OUTCOMES as readonly string[]).includes(outcome)) throw new InputError(400, "Choose what you found.");
  const kind = outcome as Outcome;
  const note = text(body, "note", kind === "UNLISTED" ? "What it is" : "Note", 300, kind === "UNLISTED");
  const observedAt = typeof body.observedAt === "string" && !Number.isNaN(Date.parse(body.observedAt)) ? new Date(body.observedAt).toISOString() : new Date().toISOString();
  let itemId: string | null = null;
  let counted: number | null = null;
  let expectedOnHand: number | null = null;
  let seenLocationId: string | null = null;
  if (kind !== "UNLISTED") {
    if (typeof body.itemId !== "string" || !ITEM_ID.test(body.itemId)) throw new InputError(400, "Choose the item.");
    itemId = body.itemId;
    if (body.expectedOnHand !== undefined && body.expectedOnHand !== null) {
      if (typeof body.expectedOnHand !== "number" || !Number.isInteger(body.expectedOnHand)) throw new InputError(400, "Reload the check and try again.");
      expectedOnHand = body.expectedOnHand;
    }
    // What the counter saw on screen is what any count is checked against later; only "Needs review" says nothing about quantity.
    if (expectedOnHand === null && kind !== "NEEDS_REVIEW") throw new InputError(400, "Reload the check and try again.");
  }
  if (kind === "CONFIRMED") counted = expectedOnHand;
  if (kind === "MISMATCH" || kind === "FOUND_HERE") counted = whole(body.counted, "How many");
  if (kind === "MISMATCH" && counted === expectedOnHand) throw new InputError(400, "That is the expected number: choose Here instead.");
  if (kind === "FOUND_HERE" || kind === "UNLISTED") {
    seenLocationId = body.seenLocationId === undefined || body.seenLocationId === null ? row.locationId : placeId(body.seenLocationId);
  }
  const now = new Date().toISOString();
  try {
    const [insert] = await db.batch([
      db.prepare(`INSERT INTO location_audit_observations(id, audit_id, item_id, outcome, expected_on_hand, counted, on_hand_at_receipt, recorded_location_id, seen_location_id, note, observed_by, observed_at, received_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, (SELECT COALESCE(on_hand, 0) FROM inventory_balances WHERE id = ?3), (SELECT location_id FROM items WHERE id = ?3), ?7, ?8, ?9, ?10, ?11
        WHERE ?3 IS NULL OR EXISTS (SELECT 1 FROM items WHERE id = ?3)`)
        .bind(requestId, auditId, itemId, kind, expectedOnHand, counted, seenLocationId, note, actor.accountId, observedAt, now),
      db.prepare("UPDATE location_audits SET status = 'OPEN', updated_at = ? WHERE id = ? AND status <> 'FINISHED'").bind(now, auditId)
    ]);
    if (!insert!.meta.changes) throw new InputError(404, "Item not found.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("location_audit_finished")) throw new InputError(409, FINISHED);
    if (/location_audit_observations\.id|PRIMARY KEY constraint failed: location_audit_observations/i.test(message)) return { id: requestId, replayed: true };
    throw error;
  }
  return { id: requestId, replayed: false };
}

/** Pause or resume, and the note that the place's directions or picture need fixing. Only the person checking. */
export async function updateAudit(db: D1Database, actor: Actor, id: string, input: unknown) {
  const row = await ownAudit(db, actor, id);
  if (row.status === "FINISHED") throw new InputError(409, FINISHED);
  const body = object(input);
  const status = body.status === undefined ? row.status : body.status;
  if (status !== "OPEN" && status !== "PAUSED") throw new InputError(400, "Choose Pause or Resume.");
  const placeNote = body.placeNote === undefined ? row.placeNote : text(body, "placeNote", "Note about the place", 300, false);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE location_audits SET status = ?, place_note = ?, updated_at = ? WHERE id = ? AND status <> 'FINISHED'").bind(status, placeNote, now, id),
    ...(status !== row.status ? [audit(db, actor.accountId, status === "PAUSED" ? "AUDIT_PAUSED" : "AUDIT_RESUMED", "AUDIT", id, { place: row.place })] : [])
  ]);
  return { status, placeNote };
}

/** Ends the check. Items not looked at stay "not checked" in the summary; nothing about stock changes. */
export async function finishAudit(db: D1Database, actor: Actor, id: string) {
  const row = await ownAudit(db, actor, id);
  if (row.status === "FINISHED") return { finishedAt: row.finishedAt };
  const detail = await auditDetail(db, actor, id);
  const now = new Date().toISOString();
  const outcomes = [...detail.items.map((item) => item.observation?.outcome), ...detail.extras.map((entry) => entry.outcome)]
    .reduce<Record<string, number>>((out, outcome) => outcome ? { ...out, [outcome]: (out[outcome] ?? 0) + 1 } : out, {});
  await db.batch([
    db.prepare("UPDATE location_audits SET status = 'FINISHED', finished_at = ?1, finished_by = ?2, updated_at = ?1 WHERE id = ?3 AND status <> 'FINISHED'").bind(now, actor.accountId, id),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`),
    audit(db, actor.accountId, "AUDIT_FINISHED", "AUDIT", id, { place: row.place, expected: detail.items.length, checked: detail.checked, outcomes }, true)
  ]);
  return { finishedAt: now };
}

/**
 * Whether stock moved between the figure the counter saw and now: the device's figure was stale when it was recorded (offline while
 * something else moved), or something moved after it arrived. Then the count cannot be posted as it is: it is counted again.
 */
const changedSince = (entry: { itemId: string | null; expectedOnHand: number | null; onHandAtReceipt: number | null; onHandNow: number }) =>
  entry.itemId !== null && entry.expectedOnHand !== null && (entry.expectedOnHand !== entry.onHandAtReceipt || entry.onHandNow !== entry.onHandAtReceipt);

/**
 * The discrepancy review: each item's latest discrepancy in this check, what was decided about it (if anything), and whether stock
 * moved after it was counted (`changedSince`): then the count is stale, and the review asks for a fresh one rather than posting it.
 */
export async function auditReview(db: D1Database, actor: Actor, id: string) {
  const row = await auditRow(db, id);
  // Where the item was recorded when it was seen (not where it is now: settling may have moved it), and where it was seen.
  const { results } = await db.prepare(`SELECT ${OBSERVATION_COLUMNS}, i.name, i.unit, i.location_id AS locationId, lp.path AS recordedPlace, sp.path AS seenPlace,
      COALESCE(b.on_hand, 0) AS onHandNow, i.updated_at AS itemUpdatedAt,
      r.action AS resolution, r.note AS resolutionNote, r.resolved_at AS resolvedAt, rs.display_name AS resolvedBy, r.movement_id AS movementId
    FROM location_audit_observations o JOIN staff_accounts s ON s.id = o.observed_by LEFT JOIN items i ON i.id = o.item_id
    LEFT JOIN inventory_balances b ON b.id = o.item_id LEFT JOIN location_paths lp ON lp.id = o.recorded_location_id LEFT JOIN location_paths sp ON sp.id = o.seen_location_id
    LEFT JOIN location_audit_resolutions r ON r.observation_id = o.id LEFT JOIN staff_accounts rs ON rs.id = r.resolved_by
    WHERE o.rowid IN (SELECT MAX(rowid) FROM location_audit_observations WHERE audit_id = ?1 GROUP BY COALESCE(item_id, id))
      AND o.outcome IN (${DISCREPANCIES.map((outcome) => `'${outcome}'`).join(",")})
    ORDER BY o.received_at, o.rowid`).bind(id).all<Observation & { onHandNow: number; resolution: string | null }>();
  return {
    audit: shown(row, actor.accountId),
    discrepancies: results.map((entry) => ({ ...entry, changedSince: changedSince(entry) }))
  };
}

/**
 * Settles one discrepancy, after the check is finished, with a full sign-in. Every path goes through what already guards that change:
 *   POSTED_COUNT  a count movement (the ledger's COUNT, keyed `audit-<observation>` so a retry never posts twice), guarded by the figure
 *                 the count was made against; when stock moved since, a fresh count (`counted` + the figure on screen) is required.
 *                 Only for a count differs or can't find, at the item's own place: a count is the item's whole stock
 *   MOVED_HERE    the item's place becomes where it was seen (the bulk Move, with its own "changed meanwhile" guard and audit entry)
 *   REPORTED      an "I can't find it" / "Location looks wrong" report for staff to follow up
 *   NO_CHANGE     a decision to leave the record as it is, with the reason
 * The observation is never changed; the resolution row says what was done, by whom and when, and names the movement it posted.
 */
export async function resolveObservation(db: D1Database, actor: Actor, observationId: string, input: unknown) {
  if (!REQUEST_ID.test(observationId)) throw new InputError(404, "Not found.");
  const found = await db.prepare(`SELECT o.id, o.audit_id AS auditId, o.item_id AS itemId, o.outcome, o.counted, o.expected_on_hand AS expectedOnHand, o.on_hand_at_receipt AS onHandAtReceipt, o.seen_location_id AS seenLocationId,
      a.status, lp.path AS place, r.action AS resolved, i.updated_at AS itemUpdatedAt
    FROM location_audit_observations o JOIN location_audits a ON a.id = o.audit_id LEFT JOIN location_paths lp ON lp.id = a.location_id
    LEFT JOIN location_audit_resolutions r ON r.observation_id = o.id LEFT JOIN items i ON i.id = o.item_id WHERE o.id = ?`).bind(observationId)
    .first<{ id: string; auditId: string; itemId: string | null; outcome: Outcome; counted: number | null; expectedOnHand: number | null; onHandAtReceipt: number | null; seenLocationId: string | null; status: string; place: string | null; resolved: string | null; itemUpdatedAt: string | null }>();
  if (!found) throw new InputError(404, "Not found.");
  if (found.status !== "FINISHED") throw new InputError(409, "Finish the check first: its review settles what it found.");
  const body = object(input);
  const action = body.action;
  if (typeof action !== "string" || !(RESOLUTIONS as readonly string[]).includes(action)) throw new InputError(400, "Choose what to do about it.");
  const chosen = action as Resolution;
  if (found.resolved) {
    if (found.resolved === chosen) return { action: chosen, replayed: true };
    throw new InputError(409, "This was already settled. Reload to see how.");
  }
  if (!found.itemId && chosen !== "NO_CHANGE") throw new InputError(400, "It is not in the catalog: add it through cataloguing, then mark this No change.");
  const note = text(body, "note", "Reason", 300, chosen === "NO_CHANGE");
  const now = new Date().toISOString();
  let movementId: string | null = null;
  let reportId: string | null = null;
  if (chosen === "POSTED_COUNT") {
    // A count is the item's whole stock, so it stands only for an item checked at its own place: a few found somewhere else say
    // nothing about the rest (move it, report it, or count it where it is kept).
    if (found.outcome !== "MISMATCH" && found.outcome !== "CANT_FIND") throw new InputError(400, "Only a count made at the item's own place can be posted.");
    // A fresh count replaces a stale one: it is made against the figure on screen now, and recorded as a new observation would be.
    const fresh = body.counted !== undefined;
    // As recorded, a count stands only if nothing moved between what the counter saw and its arrival; the ledger's guard covers the rest.
    if (!fresh && found.expectedOnHand !== found.onHandAtReceipt) throw new InputError(409, "Stock changed after this was counted. Count it again and enter what you see now.");
    const counted = fresh ? whole(body.counted, "How many") : found.outcome === "CANT_FIND" ? 0 : found.counted!;
    const expected = fresh ? whole(body.expectedOnHand, "The figure on screen") : found.onHandAtReceipt;
    const key = `audit-${found.id}`;
    await recordMovement(db, actor, found.itemId!, {
      kind: "COUNT", quantity: counted, expectedOnHand: expected, key,
      note: `${fresh ? "Counted again at the review of" : "Counted in"} the check of ${found.place ?? "a place"}${note ? `: ${note}` : ""}`.slice(0, 500)
    }).catch((error: unknown) => {
      if (error instanceof InputError && error.status === 409 && /changed this item/.test(error.message)) {
        throw new InputError(409, "Stock changed after this was counted. Count it again and enter what you see now.");
      }
      throw error;
    });
    movementId = await db.prepare("SELECT id FROM inventory_movements WHERE idempotency_key = ?").bind(key).first<string>("id");
  } else if (chosen === "MOVED_HERE") {
    if (found.outcome !== "FOUND_HERE") throw new InputError(400, "Only something found here can be moved here.");
    const moved = await bulkUpdate(db, actor, { action: "MOVE", value: found.seenLocationId, items: [{ id: found.itemId, updatedAt: found.itemUpdatedAt }] });
    if (moved.skipped.length) throw new InputError(409, `${moved.skipped[0]!.reason} Reload and try again.`);
  } else if (chosen === "REPORTED") {
    if (found.outcome !== "CANT_FIND" && found.outcome !== "NEEDS_REVIEW" && found.outcome !== "FOUND_HERE") throw new InputError(400, "Report only what could not be found or looks wrong.");
    reportId = found.id;
    await reportLocation(db, actor, found.itemId!, { id: reportId, kind: found.outcome === "CANT_FIND" ? "CANT_FIND" : "LOCATION_WRONG", note: note ?? `From the check of ${found.place ?? "a place"}.` });
  }
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO location_audit_resolutions(observation_id, action, movement_id, report_id, note, resolved_by, resolved_at) VALUES(?, ?, ?, ?, ?, ?, ?)`)
      .bind(found.id, chosen, movementId, reportId, note, actor.accountId, now),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`),
    audit(db, actor.accountId, "AUDIT_RESOLVED", "AUDIT", found.auditId, { observation: found.id, item: found.itemId, outcome: found.outcome, action: chosen, ...movementId ? { movement: movementId } : {} }, true)
  ]);
  return { action: chosen, replayed: false, movementId };
}

/**
 * A finding of a finished check that nothing has settled: no resolution, no later look at the same item, no later count. `o` is the
 * observation and `a` its check. An item's freshness and the Attention inbox both read it, so they always say the same thing.
 */
export const UNSETTLED_FINDING = `a.status = 'FINISHED' AND o.outcome IN (${DISCREPANCIES.map((outcome) => `'${outcome}'`).join(",")})
  AND NOT EXISTS (SELECT 1 FROM location_audit_resolutions r WHERE r.observation_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM location_audit_observations later WHERE later.item_id = o.item_id AND later.rowid > o.rowid)
  AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.item_id = o.item_id AND m.movement_type = 'COUNT_ADJUSTMENT' AND m.created_at > o.received_at)`;

/**
 * Derived freshness for an item, never stored: when it was last seen at its recorded place, when it was last counted, and the latest
 * discrepancy that nothing has settled since (no resolution, no later count, no later confirmation).
 */
export async function itemFreshness(db: D1Database, itemId: string) {
  const [verified, counted, open] = await db.batch([
    db.prepare(`SELECT MAX(o.received_at) AS at FROM location_audit_observations o JOIN items i ON i.id = o.item_id
      WHERE o.item_id = ? AND o.outcome IN ('CONFIRMED','MISMATCH') AND o.recorded_location_id IS i.location_id`).bind(itemId),
    // Counts recorded in the Hub only: a migrated row is not a physical count anyone made here.
    db.prepare("SELECT MAX(created_at) AS at FROM inventory_movements WHERE item_id = ? AND movement_type = 'COUNT_ADJUSTMENT' AND imported_from IS NULL").bind(itemId),
    db.prepare(`SELECT o.outcome, o.received_at AS at, o.audit_id AS auditId FROM location_audit_observations o JOIN location_audits a ON a.id = o.audit_id
      WHERE o.item_id = ?1 AND ${UNSETTLED_FINDING} ORDER BY o.rowid DESC LIMIT 1`).bind(itemId)
  ]);
  return {
    lastVerifiedAt: (verified!.results[0] as { at: string | null } | undefined)?.at ?? null,
    lastCountedAt: (counted!.results[0] as { at: string | null } | undefined)?.at ?? null,
    openDiscrepancy: (open!.results[0] as { outcome: Outcome; at: string; auditId: string } | undefined) ?? null
  };
}
