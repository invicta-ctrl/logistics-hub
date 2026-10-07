import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { attention, attentionSummary, selfServiceToCheck } from "../src/attention";
import { migratedD1 } from "./d1-sqlite";

/*
 * V1.10 performance evidence. Attention is derived on request, so its cost is the cost of its queries. This seeds a hub several times
 * the size of the real one (3,400 items, 62,000 movements, 5,000 loans, 800 audit observations, 600 reports) and times the two
 * endpoints and the Self-Service count the session route now makes. The node:sqlite stand-in measures query work, not the network
 * round trip to D1, so the budgets are generous regression guards and the figures go in docs/road-to-v2/releases/v1.10.md.
 * Set ATTENTION_PERF_LOG to a file to append the figures.
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
  // 20 movements per item: an opening count, then receipts and uses that leave some items low and a few out.
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${ITEMS * 20})
    INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
    SELECT 'PM-' || i, '2026-0' || (1 + i % 9) || '-15T00:00:00.000Z', CASE WHEN i % 20 = 1 THEN 'OPENING' ELSE 'COUNT_ADJUSTMENT' END, CASE WHEN i % 20 = 1 THEN 'IN' ELSE 'ADJUST' END,
      'PERF-' || printf('%05d', 1 + (i - 1) % ${ITEMS}), 1, 'piece', CASE WHEN i <= ${ITEMS} THEN 4 WHEN i % 7 = 0 THEN -1 ELSE 0 END, 'POSTED' FROM n`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
    INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
    SELECT 'PL-' || i, '${iso(10)}', 'LOAN_OUT', 'OUT', 'PERF-' || printf('%05d', 3 * (1 + i % ${ITEMS / 3})), 0, 'piece', 0, 'POSTED' FROM n`);
  // 5,000 loans: most returned, 150 out (60 overdue), 120 damaged or lost in the last 60 days.
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
    INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, reason, photo_key, return_by, status, movement_id, return_note, created_at, created_by, closed_at, closed_by)
    SELECT 'LN-' || printf('%06d', i), 'PERF-' || printf('%05d', 3 * (1 + i % ${ITEMS / 3})), 1, 'USC', 'Perf Borrower', NULL, 'Event', 'k',
      CASE WHEN i <= 150 THEN date('now', CASE WHEN i <= 60 THEN '-5 days' ELSE '+5 days' END) ELSE NULL END,
      CASE WHEN i <= 150 THEN 'OUT' WHEN i <= 270 THEN CASE WHEN i % 2 THEN 'DAMAGED' ELSE 'LOST' END ELSE 'RETURNED' END,
      'PL-' || i, NULL, '${iso(10)}', 'ACC-P', CASE WHEN i <= 150 THEN NULL ELSE '${iso(8)}' END, CASE WHEN i <= 150 THEN NULL ELSE 'ACC-P' END FROM n`);
  sqlite.exec(`INSERT INTO location_audits(id, location_id, started_by, status, expected_at_start, started_at, updated_at, finished_at, finished_by)
    VALUES('LA-' || printf('%036d', 1), 'LOC-9001', 'ACC-P', 'OPEN', 100, '${iso(20)}', '${iso(20)}', NULL, NULL)`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 800)
    INSERT INTO location_audit_observations(id, audit_id, item_id, outcome, expected_on_hand, counted, on_hand_at_receipt, observed_by, observed_at, received_at)
    SELECT printf('%036d', i), 'LA-' || printf('%036d', 1), 'PERF-' || printf('%05d', i), CASE WHEN i % 2 THEN 'CANT_FIND' ELSE 'MISMATCH' END, 5, CASE WHEN i % 2 THEN NULL ELSE 3 END, 5, 'ACC-P', '${iso(20)}', '${iso(20)}' FROM n`);
  sqlite.exec(`UPDATE location_audits SET status = 'FINISHED', finished_at = '${iso(20)}', finished_by = 'ACC-P'`);
  sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600)
    INSERT INTO location_reports(id, item_id, location_id, kind, source, reported_by, created_at)
    SELECT printf('%036d', i), 'PERF-' || printf('%05d', 1 + i % 300), 'LOC-9001', 'CANT_FIND', 'STAFF', 'ACC-P', '${iso(5)}' FROM n`);
});

const timed = async (run: () => Promise<unknown>) => {
  await run();
  const spent: number[] = [];
  for (let at = 0; at < RUNS; at++) { const started = performance.now(); await run(); spent.push(performance.now() - started); }
  spent.sort((a, b) => a - b);
  return { median: spent[Math.floor(RUNS / 2)]!, worst: spent.at(-1)! };
};
const note = (line: string) => { if (process.env.ATTENTION_PERF_LOG) appendFileSync(process.env.ATTENTION_PERF_LOG, `${line}\n`); };

describe("the session route", () => {
  it("counts Self-Service records as fast as the count it replaced", async () => {
    // Every staff page asks the session route first, so this is the one number on the navigation path. 4,000 phone records, 300 waiting.
    database.sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4000)
      INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, device_time, sent_at, occurred_at, received_at, applied, review)
      SELECT 'SE-' || i, 'dev', i, 'TAKE', 'PERF-' || printf('%05d', 1 + i % ${ITEMS}), 1, 'Sample Person', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1,
        CASE WHEN i <= 300 THEN 'STOCK_SHORT' ELSE NULL END FROM n`);
    const before = await timed(async () => database.sqlite.prepare("SELECT (SELECT COUNT(*) FROM self_service_events WHERE review IS NOT NULL AND resolved_at IS NULL) + (SELECT COUNT(*) FROM location_reports WHERE source = 'SELF_SERVICE' AND resolved_at IS NULL) AS n").get());
    const after = await timed(() => selfServiceToCheck(database.d1));
    note(`session route's Self-Service count: before ${before.median.toFixed(2)} ms median, after ${after.median.toFixed(2)} ms median`);
    expect(after.median).toBeLessThan(25);
  });
});

describe("per-reason cost", () => {
  it("prints where the time goes", () => {
    const { sqlite } = database;
    const run = (name: string, sql: string) => { sqlite.prepare(sql).all(); const t = performance.now(); for (let i = 0; i < 5; i++) sqlite.prepare(sql).all(); note(`  ${name}: ${((performance.now() - t) / 5).toFixed(1)} ms`); };
    run("stock out", "SELECT COUNT(*) FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.status <> 'INACTIVE' AND b.on_hand <= 0");
    run("stock low", "SELECT COUNT(*) FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.status <> 'INACTIVE' AND b.on_hand > 0 AND i.reorder_threshold > 0 AND b.on_hand <= i.reorder_threshold");
    run("balances alone", "SELECT COUNT(*) FROM inventory_balances");
    run("loans overdue", "SELECT COUNT(*) FROM loans l JOIN items i ON i.id = l.item_id WHERE l.status = 'OUT' AND l.return_by < date('now')");
    run("findings", "SELECT COUNT(*) FROM location_audit_observations");
    for (const row of sqlite.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.status <> 'INACTIVE' AND b.on_hand <= 0").all() as Array<{ detail: string }>) note(`  plan: ${row.detail}`);
  });
});

describe("Attention at several times the real size", () => {
  it("the shell numbers stay fast and match the inbox", async () => {
    const figures = await timed(() => attentionSummary(database.d1));
    note(`summary (shell numbers): median ${figures.median.toFixed(1)} ms, worst ${figures.worst.toFixed(1)} ms`);
    expect(figures.median).toBeLessThan(250);
    const [numbers, inbox] = [await attentionSummary(database.d1), await attention(database.d1)];
    expect(numbers.needsAction).toBe(Object.values(numbers.bySource).reduce((sum, count) => sum + count, 0));
    expect(inbox.entries.length).toBeGreaterThan(0);
    expect(numbers.bySource.Loans).toBeGreaterThan(100);
  });

  it("the inbox is bounded and answers quickly", async () => {
    const figures = await timed(() => attention(database.d1));
    const inbox = await attention(database.d1);
    note(`inbox (all reasons, 100 per reason): median ${figures.median.toFixed(1)} ms, worst ${figures.worst.toFixed(1)} ms, ${inbox.entries.length} entries, ${inbox.groups.reduce((sum, group) => sum + group.total, 0)} in total`);
    expect(figures.median).toBeLessThan(600);
    for (const group of inbox.groups) expect(inbox.entries.filter((entry) => entry.reason === group.reason).length).toBeLessThanOrEqual(100);
  });
});
