import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { attentionSummary } from "../src/attention";
import { insights, resumable } from "../src/home";
import { migratedD1 } from "./d1-sqlite";

/*
 * V1.12 performance evidence. Home adds two reads to the staff app: what a person can resume (two tiny queries) and the insights
 * (one batch of bounded queries, fetched after the page is drawn). What needs attention costs nothing extra: Home reads the numbers
 * the staff bar already loads. This seeds a hub several times the real one (3,000 items, 60,000 ledger rows plus 30,000 recent
 * stock-outs, 5,000 loans, 26,000 item audit entries, 800 restock requests, 600 reports, 150 kit checks) and times each read. The
 * node:sqlite stand-in measures query work, not the network round trip to D1, so the budgets are generous regression guards and the
 * figures go in docs/road-to-v2/releases/v1.12.md. Set HOME_PERF_LOG to a file to append the figures.
 */

const ITEMS = 3000;
const RUNS = 15;
let database: ReturnType<typeof migratedD1>;

beforeAll(() => {
  database = migratedD1();
  const { sqlite } = database;
  const now = Date.now();
  const iso = (offsetDays: number) => new Date(now - offsetDays * 86_400_000).toISOString();
  sqlite.exec("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-P', 'perf', 'Perf', 'x')");
  sqlite.exec("INSERT INTO locations(id, name, visibility, active, created_at, updated_at) VALUES('LOC-9001', 'Perf shelf', 'STAFF_ONLY', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${ITEMS})
    INSERT INTO items(id, name, category, stock_area, item_type, unit, status, reorder_threshold, lending_audience, needs_review, location_id, updated_at)
    SELECT 'PERF-' || printf('%05d', i), 'Perf item ' || i, 'SUPPLIES', 'Inventory', CASE WHEN i % 10 = 0 THEN 'NEEDS_REVIEW' WHEN i % 3 = 0 THEN 'Loanable' ELSE 'Consumable' END, 'piece', 'ACTIVE',
      CASE WHEN i % 3 = 1 THEN 5 ELSE 0 END, 'NOT_AVAILABLE_FOR_LENDING', 0, CASE WHEN i % 20 = 0 THEN NULL ELSE 'LOC-9001' END, '2026-01-01T00:00:00.000Z' FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${ITEMS * 20})
    INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
    SELECT 'PM-' || i, '2026-0' || (1 + i % 9) || '-15T00:00:00.000Z', CASE WHEN i % 20 = 1 THEN 'OPENING' ELSE 'COUNT_ADJUSTMENT' END, CASE WHEN i % 20 = 1 THEN 'IN' ELSE 'ADJUST' END,
      'PERF-' || printf('%05d', 1 + (i - 1) % ${ITEMS}), 1, 'piece', CASE WHEN i <= ${ITEMS} THEN 4 WHEN i % 7 = 0 THEN -1 ELSE 0 END, 'POSTED' FROM n`);
  // 30,000 stock-outs in the last 30 days, spread over the consumables.
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30000)
    INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
    SELECT 'PO-' || i, datetime('now', '-' || (i % 30) || ' days'), 'STOCK_OUT', 'OUT', 'PERF-' || printf('%05d', 1 + (i % ${ITEMS})), 1, 'piece', -1, 'POSTED' FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
    INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
    SELECT 'PL-' || i, '${iso(10)}', 'LOAN_OUT', 'OUT', 'PERF-' || printf('%05d', 3 * (1 + i % ${ITEMS / 3})), 0, 'piece', 0, 'POSTED' FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
    INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, reason, photo_key, return_by, status, movement_id, return_note, created_at, created_by, closed_at, closed_by)
    SELECT 'LN-' || printf('%06d', i), 'PERF-' || printf('%05d', 3 * (1 + i % ${ITEMS / 3})), 1, 'USC', 'Perf Borrower', NULL, 'Event', 'k', NULL, 'RETURNED', 'PL-' || i, NULL,
      datetime('now', '-' || (i % 400) || ' days'), 'ACC-P', datetime('now', '-' || (i % 400) || ' days'), 'ACC-P' FROM n`);
  // Item audit entries: 6,000 edits in the last 90 days (a third change an item's use), and 20,000 older and other entries.
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 6000)
    INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
    SELECT 'AU-' || i, datetime('now', '-' || (i % 90) || ' days'), 'ACC-P', 'ITEM_UPDATED', 'ITEM', 'PERF-' || printf('%05d', 1 + (i % ${ITEMS})),
      CASE WHEN i % 3 = 0 THEN '{"itemType":{"from":"Loanable","to":"Consumable"}}' ELSE '{"notes":{"from":null,"to":"x"}}' END FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000)
    INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
    SELECT 'AV-' || i, datetime('now', '-' || (i % 700) || ' days'), 'ACC-P', CASE WHEN i % 2 THEN 'ITEM_CREATED' ELSE 'ITEM_PHOTO_ADDED' END, 'ITEM', 'PERF-' || printf('%05d', 1 + (i % ${ITEMS})), '{}' FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 800)
    INSERT INTO reorders(id, item_id, status, created_at, updated_at) SELECT 'RO-' || i, 'PERF-' || printf('%05d', 1 + (i % 400)), CASE WHEN i % 5 = 0 THEN 'DISMISSED' ELSE 'RESTOCKED' END, datetime('now', '-' || (i % 200) || ' days'), datetime('now') FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600)
    INSERT INTO location_reports(id, item_id, location_id, kind, source, reported_by, created_at)
    SELECT printf('%036d', i), 'PERF-' || printf('%05d', 1 + i % 300), 'LOC-9001', 'CANT_FIND', 'STAFF', 'ACC-P', datetime('now', '-' || (i % 150) || ' days') FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30)
    INSERT INTO kits(id, name, active, created_at, updated_at) SELECT 'KIT-' || printf('%04d', i), 'Perf kit ' || i, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z' FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 150)
    INSERT INTO kit_checks(id, kit_id, checked_by, checked_at, ok_count, flagged_count, unchecked_count) SELECT 'KC-' || printf('%036d', i), 'KIT-' || printf('%04d', 1 + i % 30), 'ACC-P', datetime('now', '-' || (i % 100) || ' days'), 1, 1, 0 FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 150)
    INSERT INTO kit_check_observations(check_id, item_id, outcome, required, on_hand) SELECT 'KC-' || printf('%036d', i), 'PERF-00001', CASE WHEN i % 2 THEN 'LOW' ELSE 'OK' END, 2, 1 FROM n`);
  sqlite.exec(`INSERT INTO catalogue_sessions(id, started_by, location_id, status, started_at, updated_at) VALUES('CS-' || printf('%036d', 1), 'ACC-P', 'LOC-9001', 'ACTIVE', '${iso(1)}', '${iso(0)}')`);
  sqlite.exec(`INSERT INTO location_audits(id, location_id, started_by, status, expected_at_start, started_at, updated_at) VALUES('LA-' || printf('%036d', 1), 'LOC-9001', 'ACC-P', 'PAUSED', 100, '${iso(2)}', '${iso(1)}')`);
});

const timed = async (run: () => Promise<unknown>) => {
  await run();
  const spent: number[] = [];
  for (let at = 0; at < RUNS; at++) { const started = performance.now(); await run(); spent.push(performance.now() - started); }
  spent.sort((a, b) => a - b);
  return { median: spent[Math.floor(RUNS / 2)]!, worst: spent.at(-1)! };
};
const note = (line: string) => { if (process.env.HOME_PERF_LOG) appendFileSync(process.env.HOME_PERF_LOG, `${line}\n`); };

describe("Home's reads", () => {
  it("resumes work in two tiny queries, off the critical path of nothing else", async () => {
    const actor = { accountId: "ACC-P", username: "perf", displayName: "Perf", role: "STAFF" } as never;
    const result = await resumable(database.d1, actor);
    expect(result.catalogue?.place).toBe("Perf shelf");
    expect(result.checks).toHaveLength(1);
    const spent = await timed(() => resumable(database.d1, actor));
    note(`resumable work: ${spent.median.toFixed(2)} ms median, ${spent.worst.toFixed(2)} ms worst`);
    expect(spent.median).toBeLessThan(15);
  });

  it("answers the insights as one bounded batch, and every card stays within five rows", async () => {
    const result = await insights(database.d1);
    for (const card of result.cards) expect(card.rows.length).toBeLessThanOrEqual(5);
    expect(result.cards.map((card) => card.id)).toEqual(expect.arrayContaining(["borrowed", "used", "short", "reports", "kits", "corrections"]));
    const spent = await timed(() => insights(database.d1));
    note(`insights: ${spent.median.toFixed(1)} ms median, ${spent.worst.toFixed(1)} ms worst (${result.cards.length} cards)`);
    expect(spent.median).toBeLessThan(250);
  });

  it("adds nothing to the Attention numbers it reuses", async () => {
    const spent = await timed(() => attentionSummary(database.d1));
    note(`the Attention summary the bar loads (Home reuses it): ${spent.median.toFixed(1)} ms median`);
    expect(spent.median).toBeLessThan(250);
  });

  it("prints the plan of each insight query", () => {
    const { sqlite } = database;
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const plan = (name: string, sql: string, ...bind: string[]) => { for (const row of sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bind) as Array<{ detail: string }>) note(`  ${name}: ${row.detail}`); };
    plan("borrowed", "SELECT l.item_id, COUNT(*) FROM loans l WHERE l.created_at >= ? GROUP BY l.item_id", cutoff);
    plan("used", "SELECT m.item_id, COUNT(*) FROM inventory_movements m WHERE m.created_at >= ? AND m.movement_type = 'STOCK_OUT' GROUP BY m.item_id", cutoff);
    plan("corrections", "SELECT a.entity_id, COUNT(*) FROM audit_log a WHERE a.entity_type = 'ITEM' AND a.action = 'ITEM_UPDATED' AND a.created_at >= ? GROUP BY a.entity_id", cutoff);
    plan("reports", "SELECT r.location_id, COUNT(*) FROM location_reports r WHERE r.created_at >= ? GROUP BY r.location_id", cutoff);
    expect(true).toBe(true);
  });
});
