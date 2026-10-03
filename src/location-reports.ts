import { selfServiceAction } from "./catalog-policy";
import { type Actor, BUMP_REVISION, InputError, audit, text } from "./inventory";
import { REPORT_KINDS } from "./location-tree";

/*
 * "I can’t find it" and "Location looks wrong" (V1.4). A report is an attention signal and an audit record, nothing more: it
 * never changes stock or where an item is kept. Staff look, fix the place through the item if it is wrong, and resolve the
 * report with a note. A report is written once and resolved once (migration 0024 refuses any other change or removal).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SELF_SERVICE_ACTOR = "SELF_SERVICE";

const object = (input: unknown): Record<string, unknown> => input && typeof input === "object" ? input as Record<string, unknown> : {};

/**
 * Records a report for an item. `reporter` is the signed-in staff member, or null for a phone (Self-Service), which may only
 * report an item it offers and has no free text. The client's `id` makes a retry harmless; a phone's network can leave only
 * one open report of a kind per item, so a repeated tap or a stuck retry adds no noise for staff.
 */
export async function reportLocation(db: D1Database, reporter: Actor | null, itemId: string, input: unknown, clientTag: string | null = null) {
  const record = object(input);
  const id = record.id;
  if (typeof id !== "string" || !UUID.test(id)) throw new InputError(400, "Missing request id.");
  const kind = record.kind;
  if (typeof kind !== "string" || !(REPORT_KINDS as readonly string[]).includes(kind)) throw new InputError(400, "Choose what to report.");
  const note = reporter ? text(record, "note", "Note", 300, false) : null;
  const item = await db.prepare(`SELECT i.id, i.item_type AS itemType, i.status, i.needs_review AS needsReview, i.lending_audience AS lendingAudience, i.consumption_mode AS consumptionMode
    FROM items i WHERE i.id = ?`).bind(itemId).first<{ id: string; itemType: string; status: string; needsReview: number; lendingAudience: string; consumptionMode: string }>();
  if (!item) throw new InputError(404, "Item not found.");
  if (!reporter && !selfServiceAction(item)) throw new InputError(404, "Item not found.");
  const source = reporter ? "STAFF" : "SELF_SERVICE";
  const actorId = reporter?.accountId ?? SELF_SERVICE_ACTOR;
  const now = new Date().toISOString();
  const [insert] = await db.batch([
    db.prepare(`INSERT INTO location_reports(id, item_id, location_id, kind, source, note, reported_by, client_tag, created_at)
      SELECT ?1, i.id, i.location_id, ?2, ?3, ?4, ?5, ?6, ?7 FROM items i WHERE i.id = ?8
        AND NOT EXISTS (SELECT 1 FROM location_reports WHERE id = ?1)
        AND (?3 = 'STAFF' OR NOT EXISTS (SELECT 1 FROM location_reports WHERE item_id = i.id AND kind = ?2 AND source = 'SELF_SERVICE' AND client_tag IS ?6 AND resolved_at IS NULL))`)
      .bind(id, kind, source, note, reporter?.accountId ?? null, clientTag, now, itemId),
    audit(db, actorId, "LOCATION_REPORTED", "ITEM", itemId, { reportId: id, kind, source }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]);
  return { id, recorded: insert!.meta.changes > 0 };
}

/** Closes an open report with an optional note; the item and its place are untouched (staff change those through the item). */
export async function resolveReport(db: D1Database, actor: Actor, reportId: string, input: unknown) {
  if (!UUID.test(reportId)) throw new InputError(404, "Report not found.");
  const note = text(object(input), "note", "Note", 300, false);
  const report = await db.prepare("SELECT item_id AS itemId, kind FROM location_reports WHERE id = ?").bind(reportId).first<{ itemId: string; kind: string }>();
  if (!report) throw new InputError(404, "Report not found.");
  const now = new Date().toISOString();
  const [update] = await db.batch([
    db.prepare("UPDATE location_reports SET resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ? AND resolved_at IS NULL").bind(now, actor.accountId, note, reportId),
    audit(db, actor.accountId, "LOCATION_REPORT_RESOLVED", "ITEM", report.itemId, { reportId, kind: report.kind }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]);
  if (!update!.meta.changes) throw new InputError(409, "Someone already resolved this report. Refresh to see the latest.");
  return { id: reportId, resolvedAt: now };
}
