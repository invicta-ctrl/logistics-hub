// Data retention (Part 6.4). Who a long-settled loan or phone record was (name, student ID, photo) is
// erased on the Owner's request; the record itself (item, quantity, times, decision, stock) stays.
// Free text people typed (reasons, notes) is kept. Nothing runs by itself.
import { BUMP_REVISION, audit } from "./inventory";
import type { Account } from "./accounts";

export const ERASED = "[removed]";
/** A loan's identity goes two years after it closed; a settled phone record's after one year. */
export const LOAN_DAYS = 730;
export const PHONE_DAYS = 365;
/** Rows per request, so one request stays small; the page asks again while more remain. */
const BATCH = 50;
const DAY_MS = 24 * 60 * 60_000;

// A loan still out, or a phone record still waiting for staff or tied to a loan still out, is never due. `cut` is the SQL
// parameter holding the cutoff for that kind of record.
const loansDue = (cut: string) => `status <> 'OUT' AND closed_at < ${cut} AND (borrower_name <> '${ERASED}' OR COALESCE(student_id, '${ERASED}') <> '${ERASED}' OR photo_key <> '')`;
const phoneDue = (cut: string) => `received_at < ${cut} AND (review IS NULL OR resolved_at IS NOT NULL) AND (person_name <> '${ERASED}' OR student_id IS NOT NULL OR photo_key IS NOT NULL)
  AND (loan_id IS NULL OR NOT EXISTS (SELECT 1 FROM loans l WHERE l.id = self_service_events.loan_id AND l.status = 'OUT'))`;
// Every key a record still points at. A phone borrow and the loan it made share one photo, so an object belongs to every
// record that references it and goes only when none of them keeps it any more.
const REFERENCES = "SELECT photo_key AS k FROM loans WHERE photo_key <> '' UNION SELECT photo_key FROM self_service_events WHERE photo_key IS NOT NULL";
const inList = (parameter: string) => `(SELECT value FROM json_each(${parameter}))`;

const cutoff = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

/** What an erase would remove right now: the dry run. Photos are the objects it would delete, not the references it clears. */
export async function retentionPreview(db: D1Database) {
  const [counts] = await db.batch([db.prepare(`WITH due_loans AS (SELECT id, photo_key FROM loans WHERE ${loansDue("?1")}),
      due_phone AS (SELECT id, photo_key FROM self_service_events WHERE ${phoneDue("?2")}),
      due_keys AS (SELECT photo_key AS k FROM due_loans WHERE photo_key <> '' UNION SELECT photo_key FROM due_phone WHERE photo_key IS NOT NULL),
      kept AS (SELECT photo_key AS k FROM loans WHERE photo_key <> '' AND id NOT IN (SELECT id FROM due_loans)
        UNION SELECT photo_key FROM self_service_events WHERE photo_key IS NOT NULL AND id NOT IN (SELECT id FROM due_phone))
    SELECT (SELECT COUNT(*) FROM due_loans) AS loans, (SELECT COUNT(*) FROM due_phone) AS phoneRecords,
      (SELECT COUNT(*) FROM due_keys WHERE k NOT IN (SELECT k FROM kept)) AS photos`).bind(cutoff(LOAN_DAYS), cutoff(PHONE_DAYS))]);
  const { loans, phoneRecords, photos } = counts!.results[0] as { loans: number; phoneRecords: number; photos: number };
  return { loans, phoneRecords, photos };
}

/**
 * Erases up to BATCH loans and BATCH phone records, pinned by id so that what is selected, what is deleted and what is
 * cleared are the same records even when two erasures run at once. Photos go first and the database second: deleting a
 * missing object is a no-op, so a failure anywhere leaves the records due and a retry finishes the job. An object is
 * deleted only when no record outside this set still references it (R3); the audit counts, taken in the same transaction
 * as the clearing, are exactly what this request changed, so a concurrent duplicate counts nothing (R4).
 */
export async function eraseOldDetails(db: D1Database, bucket: R2Bucket, actor: Account) {
  const loanBefore = cutoff(LOAN_DAYS);
  const phoneBefore = cutoff(PHONE_DAYS);
  const [loans, phone] = await db.batch([
    db.prepare(`SELECT id, photo_key AS photoKey FROM loans WHERE ${loansDue("?1")} ORDER BY id LIMIT ${BATCH}`).bind(loanBefore),
    db.prepare(`SELECT id, photo_key AS photoKey FROM self_service_events WHERE ${phoneDue("?1")} ORDER BY id LIMIT ${BATCH}`).bind(phoneBefore)
  ]);
  const loanRows = loans!.results as Array<{ id: string; photoKey: string }>;
  const phoneRows = phone!.results as Array<{ id: string; photoKey: string | null }>;
  if (!loanRows.length && !phoneRows.length) return { loans: 0, phoneRecords: 0, photos: 0, more: false };
  const loanIds = JSON.stringify(loanRows.map((row) => row.id));
  const phoneIds = JSON.stringify(phoneRows.map((row) => row.id));
  const keys = [...new Set([...loanRows, ...phoneRows].map((row) => row.photoKey).filter((key): key is string => Boolean(key)))];
  const kept = new Set(keys.length ? ((await db.prepare(`SELECT photo_key AS k FROM loans WHERE photo_key IN ${inList("?1")} AND id NOT IN ${inList("?2")}
      UNION SELECT photo_key FROM self_service_events WHERE photo_key IN ${inList("?1")} AND id NOT IN ${inList("?3")}`)
    .bind(JSON.stringify(keys), loanIds, phoneIds).all<{ k: string }>()).results.map((row) => row.k)) : []);
  const doomed = keys.filter((key) => !kept.has(key));
  for (const key of doomed) await bucket.delete(key);

  const auditId = crypto.randomUUID();
  // ?1/?2 cutoffs, ?3/?4 pinned ids, ?5 deleted keys. The first statement counts exactly the rows the next two change.
  const changing = `WITH l AS (SELECT id, photo_key AS k FROM loans WHERE id IN ${inList("?3")} AND ${loansDue("?1")}),
      p AS (SELECT id, photo_key AS k FROM self_service_events WHERE id IN ${inList("?4")} AND ${phoneDue("?2")})`;
  await db.batch([
    db.prepare(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
      ${changing} SELECT ?6, ?7, ?8, 'RETENTION_ERASED', 'RETENTION', 'details', json_object('loans', (SELECT COUNT(*) FROM l), 'phoneRecords', (SELECT COUNT(*) FROM p),
        'photos', (SELECT COUNT(*) FROM ${inList("?5")} WHERE value IN (SELECT k FROM l UNION SELECT k FROM p)))
      WHERE (SELECT COUNT(*) FROM l) + (SELECT COUNT(*) FROM p) > 0`).bind(loanBefore, phoneBefore, loanIds, phoneIds, JSON.stringify(doomed), auditId, new Date().toISOString(), actor.accountId),
    db.prepare(`UPDATE loans SET borrower_name = '${ERASED}', student_id = CASE WHEN student_id IS NULL THEN NULL ELSE '${ERASED}' END, photo_key = ''
      WHERE id IN ${inList("?2")} AND ${loansDue("?1")}`).bind(loanBefore, loanIds),
    db.prepare(`UPDATE self_service_events SET person_name = '${ERASED}', student_id = NULL, photo_key = NULL
      WHERE id IN ${inList("?2")} AND ${phoneDue("?1")}`).bind(phoneBefore, phoneIds),
    db.prepare(`${BUMP_REVISION} AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`).bind(auditId)
  ]);
  const row = await db.prepare("SELECT details_json AS details FROM audit_log WHERE id = ?").bind(auditId).first<string>("details");
  const counts = row ? JSON.parse(row) as { loans: number; phoneRecords: number; photos: number } : { loans: 0, phoneRecords: 0, photos: 0 };
  const left = await retentionPreview(db);
  return { ...counts, more: left.loans + left.phoneRecords > 0 };
}
