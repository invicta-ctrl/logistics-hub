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

// A loan still out, or a phone record still waiting for staff or tied to a loan still out, is never due.
const LOANS_DUE = `status <> 'OUT' AND closed_at < ?1 AND (borrower_name <> '${ERASED}' OR COALESCE(student_id, '${ERASED}') <> '${ERASED}' OR photo_key <> '')`;
const PHONE_DUE = `received_at < ?1 AND (review IS NULL OR resolved_at IS NOT NULL) AND (person_name <> '${ERASED}' OR student_id IS NOT NULL OR photo_key IS NOT NULL)
  AND (loan_id IS NULL OR NOT EXISTS (SELECT 1 FROM loans l WHERE l.id = self_service_events.loan_id AND l.status = 'OUT'))`;

const cutoff = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

/** What an erase would remove right now: the dry run. */
export async function retentionPreview(db: D1Database) {
  const [loans, phone, loanPhotos, phonePhotos] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE ${LOANS_DUE}`).bind(cutoff(LOAN_DAYS)),
    db.prepare(`SELECT COUNT(*) AS n FROM self_service_events WHERE ${PHONE_DUE}`).bind(cutoff(PHONE_DAYS)),
    db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE ${LOANS_DUE} AND photo_key <> ''`).bind(cutoff(LOAN_DAYS)),
    db.prepare(`SELECT COUNT(*) AS n FROM self_service_events WHERE ${PHONE_DUE} AND photo_key IS NOT NULL`).bind(cutoff(PHONE_DAYS))
  ]);
  const count = (result: D1Result) => (result.results[0] as { n: number }).n;
  return { loans: count(loans!), phoneRecords: count(phone!), photos: count(loanPhotos!) + count(phonePhotos!) };
}

/**
 * Erases up to BATCH loans and BATCH phone records. Photos go first and the database second: deleting a
 * missing object is a no-op, so a failure between the two is simply retried, and no photo is left behind.
 */
export async function eraseOldDetails(db: D1Database, bucket: R2Bucket, actor: Account) {
  const loanBefore = cutoff(LOAN_DAYS);
  const phoneBefore = cutoff(PHONE_DAYS);
  const [loans, phone] = await db.batch([
    db.prepare(`SELECT id, photo_key AS photoKey FROM loans WHERE ${LOANS_DUE} ORDER BY id LIMIT ${BATCH}`).bind(loanBefore),
    db.prepare(`SELECT id, photo_key AS photoKey FROM self_service_events WHERE ${PHONE_DUE} ORDER BY id LIMIT ${BATCH}`).bind(phoneBefore)
  ]);
  const rows = [...loans!.results, ...phone!.results] as Array<{ id: string; photoKey: string | null }>;
  const keys = rows.map((row) => row.photoKey).filter((key): key is string => Boolean(key));
  if (!rows.length) return { loans: 0, phoneRecords: 0, photos: 0, more: false };
  for (const key of keys) await bucket.delete(key);
  const counts = { loans: loans!.results.length, phoneRecords: phone!.results.length, photos: keys.length };
  await db.batch([
    db.prepare(`UPDATE loans SET borrower_name = '${ERASED}', student_id = CASE WHEN student_id IS NULL THEN NULL ELSE '${ERASED}' END, photo_key = ''
      WHERE id IN (SELECT id FROM loans WHERE ${LOANS_DUE} ORDER BY id LIMIT ${BATCH})`).bind(loanBefore),
    db.prepare(`UPDATE self_service_events SET person_name = '${ERASED}', student_id = NULL, photo_key = NULL
      WHERE id IN (SELECT id FROM self_service_events WHERE ${PHONE_DUE} ORDER BY id LIMIT ${BATCH})`).bind(phoneBefore),
    db.prepare(BUMP_REVISION),
    audit(db, actor.accountId, "RETENTION_ERASED", "RETENTION", "details", counts)
  ]);
  const left = await retentionPreview(db);
  return { ...counts, more: left.loans + left.phoneRecords > 0 };
}
