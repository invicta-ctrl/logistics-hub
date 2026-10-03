import { LOAN_OUTCOMES, LOAN_PURPOSES, PUBLIC_LENDING_ITEM_TYPE, STUDENT_ID_PATTERN } from "./catalog-policy";
import { type Actor, BUMP_REVISION, InputError, LOAN_COLUMNS, audit, countAwareStatus, isoDate } from "./inventory";
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
 * Who is borrowing, how many and until when. One set of rules for the staff form and a phone:
 * Individual use needs a student ID, USC use a specific reason, both a name.
 */
export function loanDetails(get: (key: string) => unknown, today: string): LoanDetails {
  const purposeValue = get("purpose");
  if (typeof purposeValue !== "string" || !(LOAN_PURPOSES as readonly string[]).includes(purposeValue)) throw new InputError(400, "Choose Individual use or USC use.");
  const purpose = purposeValue as LoanDetails["purpose"];
  const borrowerName = cleanText(get("borrowerName"), purpose === "USC" ? "Name of the person using it" : "Borrower's full name", 120, true)!;
  const studentId = cleanText(get("studentId"), "Student ID number", 30, purpose === "INDIVIDUAL")?.toUpperCase() ?? null;
  if (studentId && !STUDENT_ID_PATTERN.test(studentId)) throw new InputError(400, "Student ID number may use only letters, digits and dashes.");
  const reason = cleanText(get("reason"), "Specific reason", 300, purpose === "USC");
  const quantity = Number(get("quantity"));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) throw new InputError(400, "Quantity must be a whole number from 1 to 100000.");
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
      FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.id = ?7${write.allowShort ? "" : " AND b.on_hand >= ?3"}`)
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
  return db.prepare(`SELECT l.id, l.item_id AS itemId, b.on_hand AS onHand FROM loans l JOIN inventory_movements m ON m.id = l.movement_id
    JOIN inventory_balances b ON b.id = l.item_id WHERE m.idempotency_key = ?`).bind(key).first<{ id: string; itemId: string; onHand: number }>();
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
  const details = loanDetails((key) => form.get(key), officeDay());
  const key = form.get("key");
  if (typeof key !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(key)) throw new InputError(400, "Missing request key.");

  // A retried request that already succeeded returns the loan it made.
  const earlier = await byKey(db, key);
  if (earlier) {
    if (earlier.itemId !== itemId) throw new InputError(409, "That request was already used for another item. Please try again.");
    return { id: earlier.id, onHand: earlier.onHand };
  }
  const item = await db.prepare("SELECT item_type AS itemType, status FROM items WHERE id = ?").bind(itemId).first<{ itemType: string; status: string }>();
  if (!item) throw new InputError(404, "Item not found.");
  if (item.itemType !== PUBLIC_LENDING_ITEM_TYPE) throw new InputError(400, "Only Loanable items can be lent. Change the item's type first.");
  if (item.status === "INACTIVE") throw new InputError(400, "Inactive items cannot be lent. Reactivate the item first.");
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
  const written = await db.prepare("SELECT b.on_hand AS onHand FROM loans l JOIN inventory_balances b ON b.id = l.item_id WHERE l.id = ?").bind(id).first<number>("onHand");
  if (written !== null) return { id, onHand: written };
  await bucket.delete(photoKey);
  const raced = await byKey(db, key);
  if (raced?.itemId === itemId) return { id: raced.id, onHand: raced.onHand };
  const balance = await db.prepare("SELECT on_hand AS onHand FROM inventory_balances WHERE id = ?").bind(itemId).first<number>("onHand");
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
    // Earlier borrowers, newest spelling first, so a returning student is filled in from their ID.
    db.prepare(`SELECT borrower_name AS name, student_id AS studentId, MAX(created_at) AS lastAt FROM loans
      WHERE student_id IS NOT NULL AND borrower_name <> '${ERASED}' GROUP BY student_id ORDER BY lastAt DESC LIMIT 500`)
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
