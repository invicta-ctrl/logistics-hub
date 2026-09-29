import { OPEN_REORDER_STATUSES } from "./catalog-policy";
import { type Actor, BUMP_REVISION, InputError, audit, staffInventory } from "./inventory";

const OPEN = [...OPEN_REORDER_STATUSES].map((status) => `'${status}'`).join(",");
const REORDER_ID = /^RO-[A-Za-z0-9-]{1,60}$/;
const ITEM_ID = /^ITM-[A-Za-z0-9-]{1,24}$/;

/** Everything the Stock workspace needs, polled as one revisioned payload. */
export async function stockOverview(db: D1Database) {
  const [inventory, reorders, activity] = await Promise.all([staffInventory(db), listReorders(db), recentActivity(db)]);
  return { ...inventory, reorders, activity };
}

/** Open entries, plus the last two weeks of closed ones so staff can see what was just done. */
async function listReorders(db: D1Database) {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { results } = await db.prepare(`SELECT r.id, r.item_id AS itemId, i.name AS itemName, i.unit, r.status, r.desired_quantity AS desiredQuantity,
      r.note, r.created_at AS createdAt, r.updated_at AS updatedAt, r.closed_at AS closedAt, a.display_name AS updatedBy
    FROM reorders r JOIN items i ON i.id = r.item_id LEFT JOIN staff_accounts a ON a.id = r.updated_by
    WHERE r.status IN (${OPEN}) OR r.closed_at >= ? ORDER BY r.status IN (${OPEN}) DESC, r.updated_at DESC`).bind(since).all();
  return results;
}

/**
 * Staff stock activity, newest first, with the quantity before and after each movement.
 * The running total covers every movement (migrated ones too) so before/after are exact;
 * only the Hub's own movements are listed.
 */
async function recentActivity(db: D1Database) {
  const { results } = await db.prepare(`SELECT id, createdAt, itemId, itemName, unit, movementType, change, afterQuantity, reason, notes, actor FROM (
      SELECT m.id, m.created_at AS createdAt, m.item_id AS itemId, i.name AS itemName, i.unit, m.movement_type AS movementType,
        m.signed_quantity AS change, m.reason, m.notes, a.display_name AS actor, m.imported_from AS importedFrom, m.rowid AS seq,
        SUM(CASE WHEN m.status = 'POSTED' THEN m.signed_quantity ELSE 0 END) OVER (PARTITION BY m.item_id ORDER BY m.rowid) AS afterQuantity
      FROM inventory_movements m JOIN items i ON i.id = m.item_id LEFT JOIN staff_accounts a ON a.id = m.actor_user_id
    ) WHERE importedFrom IS NULL ORDER BY seq DESC LIMIT 100`).all();
  return results;
}

function desired(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === 0) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100_000) throw new InputError(400, "Restock quantity must be a whole number from 1 to 100000.");
  return value;
}

function noteText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > 300) throw new InputError(400, "Note must be 300 characters or fewer.");
  return text || null;
}

export async function openReorder(db: D1Database, actor: Actor, body: unknown) {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof record.itemId !== "string" || !ITEM_ID.test(record.itemId)) throw new InputError(400, "Choose an item.");
  const itemId = record.itemId;
  const quantity = desired(record.desiredQuantity);
  const note = noteText(record.note);
  const item = await db.prepare("SELECT status FROM items WHERE id = ?").bind(itemId).first<string>("status");
  if (!item) throw new InputError(404, "Item not found.");
  if (item === "INACTIVE") throw new InputError(400, "Inactive items cannot be restocked. Reactivate the item first.");
  const id = `RO-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`INSERT INTO reorders(id, item_id, status, desired_quantity, note, created_at, created_by, updated_at, updated_by)
        VALUES(?, ?, 'NEEDS_RESTOCK', ?, ?, ?, ?, ?, ?)`).bind(id, itemId, quantity, note, now, actor.accountId, now, actor.accountId),
      audit(db, actor.accountId, "REORDER_OPENED", "ITEM", itemId, { desiredQuantity: quantity, note }),
      db.prepare(BUMP_REVISION)
    ]);
  } catch (error) {
    // The one-open-entry index turns a duplicate into a constraint failure.
    if (error instanceof Error && /UNIQUE/i.test(error.message)) throw new InputError(409, "This item is already on the restock list.");
    throw error;
  }
  return { id };
}

/** Plan, re-open or dismiss an open entry. Restocked is set only by receiving a Stock in. */
export async function updateReorder(db: D1Database, actor: Actor, id: string, body: unknown) {
  if (!REORDER_ID.test(id)) throw new InputError(404, "Restock entry not found.");
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const status = record.status;
  if (status !== "NEEDS_RESTOCK" && status !== "PLANNED" && status !== "DISMISSED") throw new InputError(400, "Choose Needs restock, Planned or Dismissed.");
  const current = await db.prepare("SELECT item_id AS itemId, status, desired_quantity AS desiredQuantity, note, updated_at AS updatedAt FROM reorders WHERE id = ?")
    .bind(id).first<{ itemId: string; status: string; desiredQuantity: number | null; note: string | null; updatedAt: string }>();
  if (!current) throw new InputError(404, "Restock entry not found.");
  if (!OPEN_REORDER_STATUSES.has(current.status)) throw new InputError(409, "That restock entry is already closed.");
  if (record.updatedAt !== current.updatedAt) throw new InputError(409, "Someone else changed this restock entry. Refresh to see the latest list.");
  const next = {
    status,
    desiredQuantity: record.desiredQuantity === undefined ? current.desiredQuantity : desired(record.desiredQuantity),
    note: record.note === undefined ? current.note : noteText(record.note)
  };
  const changes = Object.fromEntries(Object.entries(next).filter(([key, value]) => current[key as keyof typeof current] !== value)
    .map(([key, value]) => [key, { from: current[key as keyof typeof current], to: value }]));
  if (!Object.keys(changes).length) return { changed: 0 };
  const now = new Date().toISOString();
  const [update] = await db.batch([
    db.prepare(`UPDATE reorders SET status = ?, desired_quantity = ?, note = ?, updated_at = ?, updated_by = ?, closed_at = ?
      WHERE id = ? AND updated_at = ? AND status IN (${OPEN})`)
      .bind(next.status, next.desiredQuantity, next.note, now, actor.accountId, status === "DISMISSED" ? now : null, id, current.updatedAt),
    audit(db, actor.accountId, "REORDER_UPDATED", "ITEM", current.itemId, changes, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]);
  if (!update!.meta.changes) throw new InputError(409, "Someone else changed this restock entry. Refresh to see the latest list.");
  return { changed: Object.keys(changes).length };
}
