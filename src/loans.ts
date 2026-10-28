import {
  LOAN_FIELDS, LOAN_OUTCOMES, LOAN_PURPOSES, PUBLIC_LENDING_ITEM_TYPE, STUDENT_ID_PATTERN, STUDENT_ID_SQL_GLOB, USC_ONLY_MESSAGE, WHOLE_DOMAINS, validateLoanDraft,
  wholeJson
} from "./catalog-policy";
import { type Actor, BUMP_REVISION, InputError, LOAN_COLUMNS, audit, balanceOf, countAwareStatus, isoDate, currentItemSQL, onHandOf } from "./inventory";
import { ERASED } from "./retention";

export const LOAN_ID = /^LN-[A-Za-z0-9-]{1,60}$/;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const DAY_MS = 86_400_000;
/** The actor id for anything a phone recorded through self-service (no staff account row). */
export const SELF_SERVICE_ACTOR = "SELF_SERVICE";

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
/** The stored type comes from the file's own bytes, never from what the browser claims. */
function photoType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * One line of text: control and invisible format characters (including bidi overrides that could
 * disguise a name in a staff list) removed, trimmed, inner whitespace collapsed, length-checked.
 */
export function cleanText(value: unknown, label: string, max: number, required: boolean): string | null {
  const text = typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().replace(/\s+/g, " ") : "";
  if (required && !text) throw new InputError(400, `${label} is required.`);
  if (text.length > max) throw new InputError(400, `${label} must be ${max} characters or fewer.`);
  return text || null;
}

/** Today in the office's time zone, so "return by" is judged by the Manila calendar. */
export const officeDay = (at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(at);

export type LoanDetails = {
  purpose: typeof LOAN_PURPOSES[number];
  borrowerName: string;
  studentId: string | null;
  reason: string | null;
  quantity: number;
  returnBy: string | null;
};

/**
 * Who is borrowing, how many and until when: one policy for the desk and the phone (V1.16.4 §4.5, D1). Individual and USC use both
 * need a full name, an 8-digit Student ID and a whole quantity; USC use adds its specific reason. A refusal is the first problem in
 * the form's order, in the words both forms show (`validateLoanDraft`); the ID is checked as sent, which both forms normalise as it
 * is typed. `legacy` is a phone record made before the identity rule: it keeps the rules it was made under, so a phone that saved
 * it offline is never refused for a rule it could not have known.
 */
export function loanDetails(get: (key: string) => unknown, today: string, legacy = false): LoanDetails {
  const purposeValue = get("purpose");
  if (typeof purposeValue !== "string" || !(LOAN_PURPOSES as readonly string[]).includes(purposeValue)) throw new InputError(400, "Choose Individual use or USC use.");
  const purpose = purposeValue as LoanDetails["purpose"];
  let borrowerName: string, studentId: string | null, reason: string | null, quantity: number;
  if (legacy) {
    borrowerName = cleanText(get("borrowerName"), purpose === "USC" ? "Name of the person using it" : "Borrower's full name", 120, true)!;
    studentId = cleanText(get("studentId"), "Student ID number", 30, purpose === "INDIVIDUAL")?.toUpperCase() ?? null;
    if (studentId && !STUDENT_ID_PATTERN.test(studentId)) throw new InputError(400, "Student ID number may use only letters, digits and dashes.");
    reason = cleanText(get("reason"), "Specific reason", 300, purpose === "USC");
    quantity = Number(get("quantity"));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) throw new InputError(400, "Quantity must be a whole number from 1 to 100000.");
  } else {
    borrowerName = cleanText(get("borrowerName"), "Borrower's full name", 120, false) ?? "";
    const typedId = cleanText(get("studentId"), "Student ID number", 30, false);
    reason = cleanText(get("reason"), "Specific reason", 300, false);
    const problems = validateLoanDraft({ purpose, borrowerName, studentId: typedId, reason, quantity: get("quantity") }, WHOLE_DOMAINS.loanQuantity, true);
    const first = LOAN_FIELDS.find((field) => problems[field]);
    if (first) throw new InputError(400, problems[first]!);
    studentId = typedId;
    quantity = (wholeJson(get("quantity"), WHOLE_DOMAINS.loanQuantity) as { value: number }).value;
  }
  const returnBy = isoDate(get("returnBy") || null, "Return date");
  if (returnBy && returnBy < today) throw new InputError(400, "The return date cannot be in the past.");
  return { purpose, borrowerName, studentId, reason, quantity, returnBy };
}

export type Photo = { bytes: Uint8Array; contentType: string };

/** An uploaded hand-over photo, checked by size and by its own bytes (JPEG, PNG or WebP). */
export async function readPhoto(value: unknown): Promise<Photo> {
  if (!(value instanceof File) || value.size === 0) throw new InputError(400, "A photo is required.");
  if (value.size > MAX_PHOTO_BYTES) throw new InputError(400, "The photo is too large. Use one under 8 MB.");
  const bytes = new Uint8Array(await value.arrayBuffer());
  const contentType = photoType(bytes);
  if (!contentType) throw new InputError(400, "The photo must be a JPEG, PNG or WebP image.");
  return { bytes, contentType };
}

export type LendWrite = {
  id: string; itemId: string; details: LoanDetails; photoKey: string; movementId: string; key: string;
  actorId: string; at: string; allowShort?: boolean; countAware?: boolean;
};

/**
 * The statements that lend, for one atomic D1 batch: the LOAN_OUT movement (refused if it would
 * drive stock negative, unless `allowShort`), the loan (only if that movement was written), its
 * audit entry and the revision. Self-service sync appends its own event row to the same batch.
 */
export function lendStatements(db: D1Database, write: LendWrite): D1PreparedStatement[] {
  const { details } = write;
  return [
    db.prepare(`INSERT OR IGNORE INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity,
        related_entity_type, related_entity_id, actor_user_id, idempotency_key, status)
      SELECT ?1, ?2, 'LOAN_OUT', 'OUT', i.id, ?3, i.unit, -?3, 'LOAN', ?4, ?5, ?6, ${write.countAware ? countAwareStatus("i.id", "?2") : "'POSTED'"}
      FROM items i JOIN ${balanceOf("?7")} b ON b.id = i.id WHERE i.id = ?7 AND ${currentItemSQL()}${write.allowShort ? "" : " AND b.on_hand >= ?3"}`)
      .bind(write.movementId, write.at, details.quantity, write.id, write.actorId, write.key, write.itemId),
    db.prepare(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, reason, photo_key, return_by, movement_id, created_at, created_by)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM inventory_movements WHERE id = ?)`)
      .bind(write.id, write.itemId, details.quantity, details.purpose, details.borrowerName, details.studentId, details.reason, write.photoKey,
        details.returnBy, write.movementId, write.at, write.actorId, write.movementId),
    audit(db, write.actorId, "LOAN_CREATED", "ITEM", write.itemId, { loanId: write.id, quantity: details.quantity, purpose: details.purpose }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ];
}

async function byKey(db: D1Database, key: string) {
  return db.prepare(`SELECT l.id, l.item_id AS itemId, ${onHandOf("l.item_id")} AS onHand, l.quantity, l.purpose, l.borrower_name AS borrowerName, l.student_id AS studentId,
      l.reason, l.return_by AS returnBy FROM loans l JOIN inventory_movements m ON m.id = l.movement_id
    WHERE m.idempotency_key = ?`).bind(key).first<{ id: string; itemId: string; onHand: number } & LoanDetails>();
}

/**
 * A retried request answers with the loan the key already made (R5). When the retry asks for something else (the borrower's name
 * corrected after an answer was lost), the answer says so (`differs`), so the desk is told the loan kept the details first sent.
 */
const SAME_LOAN: Array<keyof LoanDetails> = ["purpose", "borrowerName", "studentId", "reason", "quantity", "returnBy"];
/** `details` is null when the retry's own details are now refused: they cannot be the ones the loan kept. */
function replayOf(earlier: ({ id: string; itemId: string; onHand: number } & LoanDetails) | null, itemId: string, details: LoanDetails | null) {
  if (!earlier) return null;
  if (earlier.itemId !== itemId) throw new InputError(409, "That request was already used for another item. Please try again.");
  const differs = !details || SAME_LOAN.some((field) => (earlier[field] ?? null) !== (details[field] ?? null));
  return { id: earlier.id, onHand: earlier.onHand, replayed: true as const, ...(differs ? { differs: true as const } : {}) };
}

/**
 * Whether any record points at this evidence key: true, false, or null when D1 cannot answer. An upload is deleted only on a
 * definite false. An error can arrive after a batch committed (the answer lost on the way back), so "the write failed" never
 * proves the photo is unused; when D1 cannot say, the photo is kept under its record-derived key for reconciliation.
 */
export async function photoReferenced(db: D1Database, key: string): Promise<boolean | null> {
  try {
    return Boolean(await db.prepare("SELECT 1 FROM loans WHERE photo_key = ?1 UNION ALL SELECT 1 FROM self_service_events WHERE photo_key = ?1 LIMIT 1").bind(key).first());
  } catch {
    return null;
  }
}

/** Deletes an upload no record turned out to use; keeps it whenever that is not certain. */
export async function dropUnusedPhoto(db: D1Database, bucket: R2Bucket, key: string): Promise<void> {
  if (await photoReferenced(db, key) === false) await bucket.delete(key);
}

/**
 * Hands out a Loanable item (staff). The photo goes to R2 first; one D1 batch then writes the
 * guarded LOAN_OUT movement, the loan, its audit entry and the revision. If nothing was written
 * the photo is removed again.
 */
export async function createLoan(db: D1Database, bucket: R2Bucket, actor: Actor, itemId: string, form: FormData) {
  const key = form.get("key");
  const keyed = typeof key === "string" && /^[A-Za-z0-9-]{8,80}$/.test(key);
  const read = () => loanDetails((name) => form.get(name), officeDay());
  // A retried request that already succeeded returns the loan it made, marked as such, so the desk shows it instead of a second (R5).
  // It is found before the details are checked: a retry its rules now refuse (a return date that midnight made past) still finds its loan.
  const found = keyed ? await byKey(db, key) : null;
  if (found) {
    let retried: LoanDetails | null = null;
    try { retried = read(); } catch (error) { if (!(error instanceof InputError)) throw error; }
    return replayOf(found, itemId, retried)!;
  }
  const details = read();
  if (!keyed) throw new InputError(400, "Missing request key.");
  const item = await db.prepare("SELECT item_type AS itemType, status, lending_audience AS audience FROM items WHERE id = ?").bind(itemId).first<{ itemType: string; status: string; audience: string }>();
  if (!item) throw new InputError(404, "Item not found.");
  if (item.itemType !== PUBLIC_LENDING_ITEM_TYPE) throw new InputError(400, "Only Loanable items can be lent. Change the item's type first.");
  if (item.status === "INACTIVE") throw new InputError(400, "Inactive items cannot be lent. Reactivate the item first.");
  // A desk loan is live, so there is nothing to hold: Individual use of a USC-only item is refused outright (D3).
  if (item.audience === "USC_STAFF_ONLY" && details.purpose !== "USC") throw new InputError(400, USC_ONLY_MESSAGE);
  const photo = await readPhoto(form.get("photo"));

  const id = `LN-${crypto.randomUUID()}`;
  const photoKey = `loans/${id}`;
  await bucket.put(photoKey, photo.bytes, { httpMetadata: { contentType: photo.contentType } });
  try {
    await db.batch(lendStatements(db, { id, itemId, details, photoKey, movementId: `MOV-${crypto.randomUUID()}`, key, actorId: actor.accountId, at: new Date().toISOString() }));
  } catch (error) {
    // Rolled back: the upload is unused. Committed with the answer lost: carry on and return the loan. Unknown: keep the photo.
    const saved = await photoReferenced(db, photoKey);
    if (saved === false) await bucket.delete(photoKey);
    if (!saved) throw error;
  }
  const written = await db.prepare(`SELECT ${onHandOf("l.item_id")} AS onHand FROM loans l WHERE l.id = ?`).bind(id).first<number>("onHand");
  if (written !== null) return { id, onHand: written };
  await bucket.delete(photoKey);
  const raced = await byKey(db, key);
  if (raced?.itemId === itemId) return replayOf(raced, itemId, details)!;
  const balance = await db.prepare(`SELECT ${onHandOf("?")} AS onHand`).bind(itemId).first<number>("onHand");
  throw new InputError(409, `Only ${balance ?? 0} on hand; cannot lend ${details.quantity}.`);
}

export type CloseWrite = {
  loanId: string; itemId: string; quantity: number; outcome: typeof LOAN_OUTCOMES[number]; note: string | null;
  actorId: string; at: string; movementId: string; countAware?: boolean;
};

/**
 * The statements that end an OUT loan, for one atomic D1 batch. Only a good return writes the
 * LOAN_RETURN movement that puts the quantity back; damaged or lost items stay off the shelf.
 * Nothing changes if the loan is no longer OUT.
 */
export function closeStatements(db: D1Database, write: CloseWrite): D1PreparedStatement[] {
  return [
    db.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, related_entity_type, related_entity_id, actor_user_id, status)
      SELECT ?1, ?2, 'LOAN_RETURN', 'IN', l.item_id, l.quantity, i.unit, l.quantity, 'LOAN', l.id, ?3, ${write.countAware ? countAwareStatus("l.item_id", "?2") : "'POSTED'"}
      FROM loans l JOIN items i ON i.id = l.item_id WHERE l.id = ?4 AND l.status = 'OUT' AND ?5 = 'RETURNED'`)
      .bind(write.movementId, write.at, write.actorId, write.loanId, write.outcome),
    db.prepare(`UPDATE loans SET status = ?1, closed_at = ?2, closed_by = ?3, return_note = ?4,
      return_movement_id = (SELECT m.id FROM inventory_movements m WHERE m.id = ?5) WHERE id = ?6 AND status = 'OUT'`)
      .bind(write.outcome, write.at, write.actorId, write.note, write.movementId, write.loanId),
    audit(db, write.actorId, "LOAN_CLOSED", "ITEM", write.itemId, { loanId: write.loanId, outcome: write.outcome, quantity: write.quantity }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ];
}

/**
 * Ends a loan. A good return writes the LOAN_RETURN movement that puts the quantity back;
 * damaged or lost items stay off the shelf and need a note. Closing twice is harmless.
 */
export async function closeLoan(db: D1Database, actor: Actor, id: string, body: unknown) {
  if (!LOAN_ID.test(id)) throw new InputError(404, "Loan not found.");
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const outcome = record.outcome;
  if (typeof outcome !== "string" || !(LOAN_OUTCOMES as readonly string[]).includes(outcome)) throw new InputError(400, "Choose Returned, Damaged or Lost.");
  const note = typeof record.note === "string" ? record.note.trim() : "";
  if (note.length > 300) throw new InputError(400, "Note must be 300 characters or fewer.");
  if (outcome !== "RETURNED" && !note) throw new InputError(400, outcome === "LOST" ? "Say what is known about the loss." : "Describe the damage.");
  const loan = await db.prepare("SELECT item_id AS itemId, quantity, status FROM loans WHERE id = ?").bind(id).first<{ itemId: string; quantity: number; status: string }>();
  if (!loan) throw new InputError(404, "Loan not found.");
  if (loan.status !== "OUT") {
    if (loan.status === outcome) return { status: outcome };
    throw new InputError(409, "This loan was already closed. Refresh to see the latest.");
  }
  const [, update] = await db.batch(closeStatements(db, {
    loanId: id, itemId: loan.itemId, quantity: loan.quantity, outcome: outcome as CloseWrite["outcome"], note: note || null,
    actorId: actor.accountId, at: new Date().toISOString(), movementId: `MOV-${crypto.randomUUID()}`
  }));
  if (!update!.meta.changes) {
    const current = await db.prepare("SELECT status FROM loans WHERE id = ?").bind(id).first<string>("status");
    if (current === outcome) return { status: outcome };
    throw new InputError(409, "This loan was already closed. Refresh to see the latest.");
  }
  return { status: outcome };
}

/**
 * The Loans dashboard in one revisioned payload: what is out now, recent returns, and
 * statistics for three periods, so switching period needs no round trip. A borrower is
 * their student ID when known, otherwise their name.
 */
export async function loansOverview(db: D1Database) {
  const now = Date.now();
  const periods = "WITH periods(period, since) AS (VALUES ('30d', ?1), ('12m', ?2), ('all', ''))";
  const bind = (statement: D1PreparedStatement) => statement.bind(new Date(now - 30 * DAY_MS).toISOString(), new Date(now - 365 * DAY_MS).toISOString());
  const who = "COALESCE(l.student_id, lower(l.borrower_name))";
  const [open, closed, borrowers, items, totals, known] = await db.batch([
    db.prepare(`${LOAN_COLUMNS} WHERE l.status = 'OUT' ORDER BY l.created_at`),
    db.prepare(`${LOAN_COLUMNS} WHERE l.status <> 'OUT' ORDER BY l.closed_at DESC LIMIT 100`),
    bind(db.prepare(`${periods}, grouped AS (
        SELECT p.period, l.purpose, ${who} AS who, MAX(l.borrower_name) AS name, MAX(l.student_id) AS studentId, COUNT(*) AS loans,
          SUM(l.quantity) AS units, SUM(l.status = 'OUT') AS outNow, SUM(l.status IN ('DAMAGED', 'LOST')) AS problems, MAX(l.created_at) AS lastAt
        FROM periods p JOIN loans l ON l.created_at >= p.since AND l.borrower_name <> '${ERASED}' GROUP BY p.period, l.purpose, who)
      SELECT period, purpose, name, studentId, loans, units, outNow, problems, lastAt FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY period, purpose ORDER BY loans DESC, units DESC, lastAt DESC) AS rank FROM grouped)
      WHERE rank <= 10 ORDER BY period, purpose, rank`)),
    bind(db.prepare(`${periods} SELECT period, itemId, itemName, loans, units FROM (
        SELECT p.period, l.item_id AS itemId, i.name AS itemName, COUNT(*) AS loans, SUM(l.quantity) AS units,
          ROW_NUMBER() OVER (PARTITION BY p.period ORDER BY COUNT(*) DESC, SUM(l.quantity) DESC) AS rank
        FROM periods p JOIN loans l ON l.created_at >= p.since JOIN items i ON i.id = l.item_id GROUP BY p.period, l.item_id)
      WHERE rank <= 8 ORDER BY period, rank`)),
    bind(db.prepare(`${periods} SELECT p.period, l.purpose, COUNT(*) AS loans, SUM(l.quantity) AS units, COUNT(DISTINCT CASE WHEN l.borrower_name = '${ERASED}' THEN NULL ELSE ${who} END) AS borrowers,
        SUM(l.status IN ('DAMAGED', 'LOST')) AS problems FROM periods p JOIN loans l ON l.created_at >= p.since GROUP BY p.period, l.purpose`)),
    // Borrowers of the last year, newest spelling first, so a returning student is filled in from their ID. Older ones are typed again.
    // The time bound keeps this off the whole loans history. Only an ID a new loan accepts is offered (V1.16.4 §4.5).
    db.prepare(`SELECT borrower_name AS name, student_id AS studentId, MAX(created_at) AS lastAt FROM loans
      WHERE created_at >= ?1 AND student_id GLOB '${STUDENT_ID_SQL_GLOB}' AND borrower_name <> '${ERASED}' GROUP BY student_id ORDER BY lastAt DESC LIMIT 500`).bind(new Date(now - 365 * DAY_MS).toISOString())
  ]);
  return { today: officeDay(), open: open.results, closed: closed.results, borrowers: borrowers.results, items: items.results, totals: totals.results, known: known.results };
}

/** Staff-only photo stream. Keys are loan IDs, so the URL reveals nothing about the borrower. */
export async function loanPhoto(db: D1Database, bucket: R2Bucket, id: string): Promise<Response> {
  if (!LOAN_ID.test(id)) throw new InputError(404, "Photo not found.");
  const key = await db.prepare("SELECT photo_key AS photoKey FROM loans WHERE id = ?").bind(id).first<string>("photoKey");
  const object = key ? await bucket.get(key) : null;
  if (!object) throw new InputError(404, "Photo not found.");
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, no-store" } });
}
