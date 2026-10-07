import { migratedD1 } from "./d1-sqlite";

/** Deterministic hub sizes for the V1.14 hardening tests. "current" is about the real Hub; the others multiply it. */
export const TIERS = { current: 500, growth: 5_000, stress: 50_000 } as const;
export type Tier = keyof typeof TIERS;

const series = (count: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;

/** Builds a migrated in-memory D1 holding `items` catalog records and history proportional to them. */
export function seedHub(items: number) {
  const database = migratedD1();
  const { sqlite } = database;
  const stamp = "2026-01-01T00:00:00.000Z";
  const item = (n: string) => `'S-' || printf('%06d', ${n})`;
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-S', 'scale', 'Scale', 'x')");
  const places = Math.max(10, Math.round(items / 8));
  sqlite.exec(`${series(places)} INSERT INTO locations(id, name, parent_id, visibility, active, created_at, updated_at)
    SELECT 'LOC-' || printf('%04d', 1000 + i), 'Place ' || i, CASE WHEN i > 10 THEN 'LOC-' || printf('%04d', 1000 + 1 + i % 10) END, 'STAFF_ONLY', 1, '${stamp}', '${stamp}' FROM n`);
  sqlite.exec(`${series(items)} INSERT INTO items(id, name, category, stock_area, item_type, unit, status, reorder_threshold, lending_audience, needs_review, location_id, updated_at)
    SELECT ${item("i")}, 'Scale item ' || i, 'CAT' || (i % 12), 'Inventory', CASE WHEN i % 10 = 0 THEN 'NEEDS_REVIEW' WHEN i % 3 = 0 THEN 'Loanable' ELSE 'Consumable' END, 'piece', 'ACTIVE',
      CASE WHEN i % 3 = 1 THEN 5 ELSE 0 END, CASE WHEN i % 3 = 0 THEN 'USC_ONLY' ELSE 'NOT_AVAILABLE_FOR_LENDING' END, 0,
      'LOC-' || printf('%04d', 1001 + i % ${places}), '${stamp}' FROM n`);
  // 12 ledger rows per item: an opening count, then stock-outs spread over the last 60 days.
  sqlite.exec(`${series(items * 12)} INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
    SELECT 'SM-' || i, CASE WHEN i <= ${items} THEN '${stamp}' ELSE datetime('now', '-' || (i % 60) || ' days') END, CASE WHEN i <= ${items} THEN 'OPENING' ELSE 'STOCK_OUT' END,
      CASE WHEN i <= ${items} THEN 'IN' ELSE 'OUT' END, ${item(`1 + (i - 1) % ${items}`)}, 1, 'piece', CASE WHEN i <= ${items} THEN 40 ELSE -1 END, 'POSTED' FROM n`);
  sqlite.exec(`${series(items)} INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, reason, photo_key, return_by, status, movement_id, created_at, created_by, closed_at, closed_by)
    SELECT 'LN-' || printf('%06d', i), ${item(`3 * (1 + i % ${Math.max(1, Math.floor(items / 3))})`)}, 1, 'USC', 'Borrower ' || (i % 400), 'S' || printf('%07d', i % 400), 'Event', 'k', NULL,
      CASE WHEN i % 40 = 0 THEN 'OUT' ELSE 'RETURNED' END, 'SM-' || i, datetime('now', '-' || (i % 400) || ' days'), 'ACC-S',
      CASE WHEN i % 40 = 0 THEN NULL ELSE datetime('now', '-' || (i % 400) || ' days') END, CASE WHEN i % 40 = 0 THEN NULL ELSE 'ACC-S' END FROM n`);
  sqlite.exec(`${series(items * 6)} INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
    SELECT 'SA-' || i, datetime('now', '-' || (i % 500) || ' days'), 'ACC-S', CASE WHEN i % 3 = 0 THEN 'ITEM_UPDATED' ELSE 'ITEM_CREATED' END, 'ITEM', ${item(`1 + i % ${items}`)}, '{}' FROM n`);
  sqlite.exec(`${series(Math.max(20, Math.round(items / 5)))} INSERT INTO staff_directory(id, full_name, department, position, officer, student_id, active, source_key, created_at, updated_at)
    SELECT 'PER-' || printf('%06d', i), 'Person ' || i, 'ARTS', 'Member', 0, 'S' || printf('%07d', 1000 + i), 1, 'src-' || i, '${stamp}', '${stamp}' FROM n`);
  sqlite.exec(`${series(items * 2)} INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, occurred_at, device_time, sent_at, received_at, applied, review, resolved_at)
    SELECT 'SE-' || printf('%08d', i), 'DEV-' || (i % 20), i, 'TAKE', ${item(`1 + i % ${items}`)}, 1, 'Person', datetime('now', '-' || (i % 300) || ' days'), '${stamp}', '${stamp}', '${stamp}', 1,
      CASE WHEN i % 50 = 0 THEN 'CHECK' END, CASE WHEN i % 50 = 0 AND i % 100 = 0 THEN '${stamp}' END FROM n`);
  sqlite.exec(`${series(Math.max(5, Math.round(items / 25)))} INSERT INTO kits(id, name, active, created_at, updated_at) SELECT 'KIT-' || printf('%04d', i), 'Kit ' || i, 1, '${stamp}', '${stamp}' FROM n`);
  sqlite.exec("PRAGMA foreign_keys = ON");
  return database;
}
