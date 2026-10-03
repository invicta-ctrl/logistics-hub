import { HISTORY_ORDER, actorName } from "../src/inventory";

/**
 * The Stock activity query as it was before R7 (baseline 8777602): a running total over the whole ledger,
 * then the newest 100 of the Hub's own movements. Kept only as the reference the faster query must match.
 */
export const REFERENCE_RECENT_ACTIVITY = `SELECT id, createdAt, itemId, itemName, unit, movementType, related, change, afterQuantity, reason, notes, actor FROM (
    SELECT m.id, m.created_at AS createdAt, m.item_id AS itemId, i.name AS itemName, i.unit, m.movement_type AS movementType, m.related_entity_type AS related,
      m.signed_quantity AS change, m.reason, m.notes, ${actorName("a", "m.actor_user_id")} AS actor, m.imported_from AS importedFrom,
      CASE WHEN m.imported_from IS NULL THEN julianday(m.created_at) ELSE 0 END AS happened, m.rowid AS seq,
      SUM(CASE WHEN m.status = 'POSTED' THEN m.signed_quantity ELSE 0 END) OVER (PARTITION BY m.item_id ORDER BY ${HISTORY_ORDER}) AS afterQuantity
    FROM inventory_movements m JOIN items i ON i.id = m.item_id LEFT JOIN staff_accounts a ON a.id = m.actor_user_id
  ) WHERE importedFrom IS NULL ORDER BY happened DESC, seq DESC LIMIT 100`;

// A deterministic stand-in for random(): a fixed integer mix of the row number and a salt, spread over a year.
const SPAN = 365 * 86400;
export const syntheticTime = (row: string, salt: number) =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', 1790000000 - ((${row} * 2654435761 + ${salt}) % 4294967296) % ${SPAN}, 'unixepoch')`;

/** Replaces the ledger with `movements` synthetic rows over `items` synthetic items: every twentieth imported, every fiftieth VOID. */
export function syntheticLedger(sqlite: { exec: (sql: string) => void }, movements: number, items: number) {
  sqlite.exec("PRAGMA foreign_keys = OFF");
  // A disposable fixture: lift the append-only guard (0009) only in this in-memory copy, to start from an empty ledger.
  sqlite.exec("DROP TRIGGER IF EXISTS inventory_movements_no_delete; DELETE FROM inventory_movements");
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${items})
    INSERT INTO items(id, name, category, item_type, unit, stock_area) SELECT 'PERF-' || i, 'Perf Item ' || i, 'SUPPLIES', 'Consumable', 'piece', 'Inventory' FROM n`);
  if (movements < 1) return;
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${movements}),
      it AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS r FROM items WHERE id LIKE 'PERF-%'), cnt AS (SELECT count(*) c FROM it)
    INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, status, imported_from, notes)
    SELECT 'PM-' || n.i, ${syntheticTime("n.i", 11)}, CASE WHEN n.i % 3 = 0 THEN 'STOCK_OUT' ELSE 'STOCK_IN' END, CASE WHEN n.i % 3 = 0 THEN 'OUT' ELSE 'IN' END,
      it.id, 1 + n.i % 5, 'piece', CASE WHEN n.i % 3 = 0 THEN -(1 + n.i % 5) ELSE 1 + n.i % 5 END, CASE WHEN n.i % 4 = 0 THEN 'SELF_SERVICE' ELSE 'ACC-' || (n.i % 4) END,
      CASE WHEN n.i % 50 = 0 THEN 'VOID' ELSE 'POSTED' END, CASE WHEN n.i % 20 = 0 THEN 'legacy sheet' END, CASE WHEN n.i % 7 = 0 THEN 'note ' || n.i END
    FROM n JOIN it ON it.r = n.i % (SELECT c FROM cnt)`);
}
