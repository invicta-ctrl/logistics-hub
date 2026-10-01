import { OPEN_UNIT_CONDITIONS } from "./catalog-policy";
import { type Actor, BUMP_REVISION, InputError, audit, guarded, openUnitsOf } from "./inventory";

/*
 * Open-unit tracking (Part 5B, amendment A12). A Consumable in OPEN_UNIT mode is still counted by its
 * outer unit; staff only track which units are open. Open, Use and Condition never change stock;
 * Empty closes the unit and posts exactly one guarded -1 movement; Correct closes a unit that was
 * never really open, with no movement. The database keeps open units within on-hand (migration 0017).
 */

const ACTIONS = ["open", "use", "condition", "empty", "correct"] as const;
const UNIT_ID = /^OU-[0-9a-f-]{36}$/;
const KEY = /^[A-Za-z0-9-]{8,80}$/;

type Unit = { id: string; condition: string | null; closedAt: string | null; closeKind: string | null };

/** Only an active open-unit Consumable is tracked (items columns, alias i). */
export const TRACKED = "i.item_type = 'Consumable' AND i.consumption_mode = 'OPEN_UNIT' AND i.status <> 'INACTIVE'";
const OPEN_COUNT = "(SELECT COUNT(*) FROM open_units WHERE item_id = i.id AND closed_at IS NULL)";

export async function openUnitAction(db: D1Database, actor: Actor, itemId: string, body: unknown) {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = record.action as typeof ACTIONS[number];
  if (!ACTIONS.includes(action)) throw new InputError(400, "Choose Open, Use, Condition, Empty or Correct.");
  const now = new Date().toISOString();
  const item = await db.prepare(`SELECT i.unit, i.item_type = 'Consumable' AND i.consumption_mode = 'OPEN_UNIT' AS tracked, i.status, COALESCE(b.on_hand, 0) AS onHand, ${OPEN_COUNT} AS open
    FROM items i LEFT JOIN inventory_balances b ON b.id = i.id WHERE i.id = ?`).bind(itemId).first<{ unit: string; tracked: number; status: string; onHand: number; open: number }>();
  if (!item) throw new InputError(404, "Item not found.");

  if (action === "open") {
    const key = typeof record.key === "string" && KEY.test(record.key) ? record.key : null;
    if (!key) throw new InputError(400, "Missing request key.");
    const unitId = `OU-${crypto.randomUUID()}`;
    await guarded(db.batch([
      db.prepare(`INSERT OR IGNORE INTO open_units(id, item_id, idempotency_key, opened_at, opened_by)
        SELECT ?1, i.id, ?2, ?3, ?4 FROM items i WHERE i.id = ?5 AND ${TRACKED} AND COALESCE((SELECT on_hand FROM inventory_balances WHERE id = i.id), 0) > ${OPEN_COUNT}`)
        .bind(unitId, key, now, actor.accountId, itemId),
      audit(db, actor.accountId, "UNIT_OPENED", "ITEM", itemId, { unitId, alreadyOpen: item.open }, true),
      db.prepare(`${BUMP_REVISION} AND changes() > 0`)
    ]));
    const opened = await db.prepare("SELECT item_id AS itemId FROM open_units WHERE idempotency_key = ?").bind(key).first<string>("itemId");
    if (opened === itemId) return summary(db, itemId);
    if (opened) throw new InputError(409, "That request was already used for another item. Please try again.");
    if (!item.tracked || item.status === "INACTIVE") throw new InputError(409, "This item is not set to be opened and used gradually. Change it in Edit details first.");
    const { onHand } = await summary(db, itemId);
    throw new InputError(409, onHand <= 0 ? "Nothing on hand to open. Record the stock first." : `All ${onHand} on hand are already open.`);
  }

  if (typeof record.unitId !== "string" || !UNIT_ID.test(record.unitId)) throw new InputError(400, "Choose an open unit.");
  const unitId = record.unitId;
  const unit = await db.prepare("SELECT id, condition, closed_at AS closedAt, close_kind AS closeKind FROM open_units WHERE id = ? AND item_id = ?").bind(unitId, itemId).first<Unit>();
  if (!unit) throw new InputError(404, "That open unit was not found. Refresh to see the latest.");
  // A repeated Empty (a retry or a double tap) is answered with the state it already produced.
  if (action === "empty" && unit.closeKind === "EMPTY") return summary(db, itemId);
  if (unit.closedAt) throw new InputError(409, "That unit is no longer open. Refresh to see the latest.");

  if (action === "use") {
    const key = typeof record.key === "string" && KEY.test(record.key) ? record.key : null;
    if (!key) throw new InputError(400, "Missing request key.");
    // Keyed by the request, so a retry or double tap records one use.
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
        SELECT ?1, ?2, ?3, 'UNIT_USED', 'ITEM', ?4, json_object('unitId', ?5) WHERE EXISTS (SELECT 1 FROM open_units WHERE id = ?5 AND item_id = ?4 AND closed_at IS NULL)`)
        .bind(`USE-${key}`, now, actor.accountId, itemId, unitId),
      db.prepare(`${BUMP_REVISION} AND changes() > 0`)
    ]);
    return summary(db, itemId);
  }

  if (action === "condition") {
    const condition = record.condition;
    if (typeof condition !== "string" || !(OPEN_UNIT_CONDITIONS as readonly string[]).includes(condition)) throw new InputError(400, "Choose Plenty, Half or Low.");
    await guarded(db.batch([
      db.prepare("UPDATE open_units SET condition = ?1, condition_at = ?2, condition_by = ?3 WHERE id = ?4 AND closed_at IS NULL AND condition IS NOT ?1")
        .bind(condition, now, actor.accountId, unitId),
      audit(db, actor.accountId, "UNIT_CONDITION", "ITEM", itemId, { unitId, condition: { from: unit.condition, to: condition } }, true),
      db.prepare(`${BUMP_REVISION} AND changes() > 0`)
    ]));
    return summary(db, itemId);
  }

  if (action === "correct") {
    await guarded(db.batch([
      db.prepare("UPDATE open_units SET closed_at = ?1, closed_by = ?2, close_kind = 'CORRECTED' WHERE id = ?3 AND closed_at IS NULL").bind(now, actor.accountId, unitId),
      // An open count above on-hand can only be a stored fault; closing a unit is how staff clear it.
      audit(db, actor.accountId, "UNIT_CORRECTED", "ITEM", itemId, { unitId, ...(item.open > item.onHand ? { resolvedDiscrepancy: true } : {}) }, true),
      db.prepare(`${BUMP_REVISION} AND changes() > 0`)
    ]));
    return summary(db, itemId);
  }

  // Empty: the unit is closed first (so the open count already excludes it), then exactly one -1
  // movement is posted for the unit this request closed. Its idempotency key is the unit's, so two
  // competing Empties cannot both deduct: the second finds the unit closed and writes nothing.
  const movementId = `MOV-${crypto.randomUUID()}`;
  await guarded(db.batch([
    db.prepare(`UPDATE open_units SET closed_at = ?1, closed_by = ?2, close_kind = 'EMPTY', movement_id = ?3
      WHERE id = ?4 AND item_id = ?5 AND closed_at IS NULL AND COALESCE((SELECT on_hand FROM inventory_balances WHERE id = ?5), 0) >= 1`)
      .bind(now, actor.accountId, movementId, unitId, itemId),
    db.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity,
        related_entity_type, related_entity_id, actor_user_id, idempotency_key, reason, status)
      SELECT ?1, ?2, 'STOCK_OUT', 'OUT', i.id, 1, i.unit, -1, 'OPEN_UNIT', ?3, ?4, 'ou-empty:' || ?3, 'CONSUMED', 'POSTED'
      FROM items i WHERE i.id = ?5 AND EXISTS (SELECT 1 FROM open_units WHERE id = ?3 AND movement_id = ?1)`)
      .bind(movementId, now, unitId, actor.accountId, itemId),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]));
  const closed = await db.prepare("SELECT close_kind AS closeKind FROM open_units WHERE id = ?").bind(unitId).first<string>("closeKind");
  if (closed === "EMPTY") return summary(db, itemId);
  if (closed) throw new InputError(409, "That unit is no longer open. Refresh to see the latest.");
  throw new InputError(409, "Nothing on hand to mark empty. Record a count first.");
}

/** What the open-unit controls show after any action. */
export async function summary(db: D1Database, itemId: string) {
  const [balance, units] = await db.batch([
    db.prepare("SELECT on_hand AS onHand FROM inventory_balances WHERE id = ?").bind(itemId),
    openUnitsOf(db, itemId)
  ]);
  return { onHand: (balance!.results[0] as { onHand: number } | undefined)?.onHand ?? 0, openUnits: units!.results };
}
