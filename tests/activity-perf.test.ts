import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { migratedD1 } from "./d1-sqlite";
import { EXPORT_ROWS, activityCsv, activityPage, type ActivityQuery } from "../src/activity";

/**
 * AC-A7 evidence harness for the Activity query. Skipped in `npm test`; run it with
 *   ACTIVITY_PERF=1 ACTIVITY_PERF_OUT=<file> npx vitest run tests/activity-perf.test.ts
 * (PowerShell: `$env:ACTIVITY_PERF=1; $env:ACTIVITY_PERF_OUT="<file>"; npx vitest run ...`). Optional
 * ACTIVITY_PERF_TIERS="1000,20000,100000" sets the synthetic movement counts. It builds a fresh in-memory
 * SQLite with every migration, replaces the ledger with a deterministic synthetic one (no imported personal
 * data, no randomness), runs each query shape through the real `activityPage` and writes the timings and the
 * full EXPLAIN QUERY PLAN of the statement that ran. Local node:sqlite only, not D1.
 */
const TIERS = (process.env.ACTIVITY_PERF_TIERS ?? "1000,20000,100000").split(",").map(Number);
const WARMUP = 2;
const RUNS = 7;
const HASH = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 10);
// A deterministic stand-in for random(): a fixed integer mix of the row number and a salt, spread over a year.
const SPAN = 365 * 86400;
const when = (row: string, salt: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 1790000000 - ((${row} * 2654435761 + ${salt}) % 4294967296) % ${SPAN}, 'unixepoch')`;

const CASES: [string, Partial<ActivityQuery["filters"]>, string | null, number][] = [
  ["unfiltered, 50", {}, null, 50],
  ["unfiltered, 100", {}, null, 100],
  ["deep cursor, 50", {}, "2026-03-01T00:00:00.000Z|mov:ZZZZ", 50],
  ["date range (a month)", { from: "2026-08-01", to: "2026-08-31" }, null, 50],
  ["item", { item: "PERF-7" }, null, 50],
  ["actor", { actor: "ACC-3" }, null, 50],
  ["stockArea", { stockArea: "Pantry" }, null, 50],
  ["location", { location: "Shelf 3" }, null, 50],
  ["source=LOAN", { source: "LOAN" }, null, 50],
  ["changed=yes", { changed: "yes" }, null, 50],
  ["attention", { attention: true }, null, 50],
  ["text, rare (few matches)", { q: "scratch 12" }, null, 50],
  ["text, unmatched", { q: "zzzqqq" }, null, 50],
  ["text, common (fills the page)", { q: "Perf Item" }, null, 50],
  ["text + date range", { q: "scratch", from: "2026-08-01", to: "2026-08-31" }, null, 50],
  // An export is the same query, cursor-less, up to EXPORT_ROWS, plus building the CSV text (Worker CPU).
  ["export file, unfiltered", {}, null, EXPORT_ROWS],
  ["export file, text", { q: "scratch" }, null, EXPORT_ROWS]
];

describe.skipIf(!process.env.ACTIVITY_PERF)("activity performance (AC-A7)", () => {
  it("measures the final query at each synthetic tier", async () => {
    const out: string[] = [];
    const versions = new Map<string, string>();
    const planIndex = new Map<string, { plan: string; uses: string[] }>();
    for (const scale of TIERS) {
      const { sqlite, d1 } = migratedD1();
      sqlite.exec("PRAGMA foreign_keys = OFF");
      // A disposable fixture: lift the append-only guards (0009, 0022) only in this in-memory copy, to start from empty tables.
      sqlite.exec("DROP TRIGGER IF EXISTS inventory_movements_no_delete; DROP TRIGGER IF EXISTS audit_log_no_delete");
      for (const table of ["inventory_movements", "audit_log", "self_service_events", "loans"]) sqlite.exec(`DELETE FROM ${table}`);
      for (const [id, role] of [["ACC-1", "STAFF"], ["ACC-2", "ADMIN"], ["ACC-3", "STAFF"], ["ACC-4", "STAFF"]] as const) {
        sqlite.prepare("INSERT OR REPLACE INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(?, ?, ?, 'x', ?)").run(id, `u.${id}`, `Person ${id}`, role);
      }
      versions.set("sqlite", String((sqlite.prepare("SELECT sqlite_version() v").get() as { v: string }).v));
      const count = (table: string) => Number((sqlite.prepare(`SELECT count(*) c FROM ${table}`).get() as { c: number }).c);
      const base = count("items");
      const items = Math.max(528, Math.round(scale / 45));
      const loans = Math.round(scale * 0.04);
      const audits = Math.round(scale * 0.25);
      const phones = Math.round(scale * 0.25);
      const rows = (n: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})`;
      const pick = (where = "1") => `it AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS r FROM items WHERE ${where}), cnt AS (SELECT count(*) c FROM it)`;
      // Items: the migrated catalog plus synthetic ones up to the tier's item count; every fifth is Loanable, two areas, 40 shelves.
      sqlite.exec(`${rows(items - base)}
        INSERT INTO items(id, name, category, item_type, unit, stock_area, storage_location, aliases)
        SELECT 'PERF-' || i, 'Perf Item ' || i, 'SUPPLIES', CASE WHEN i % 5 = 0 THEN 'Loanable' ELSE 'Consumable' END, 'piece', CASE WHEN i % 2 THEN 'Inventory' ELSE 'Pantry' END, 'Shelf ' || (i % 40), NULL FROM n`);
      // Movements: 10% counts, 30% stock out, 60% stock in, spread over items and a year; every seventh has a note.
      sqlite.exec(`${rows(scale)}, ${pick()}
        INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, notes, reason, status)
        SELECT 'PM-' || n.i, ${when("n.i", 11)},
          CASE n.i % 10 WHEN 0 THEN 'COUNT_ADJUSTMENT' WHEN 1 THEN 'STOCK_OUT' WHEN 2 THEN 'STOCK_OUT' WHEN 3 THEN 'STOCK_OUT' ELSE 'STOCK_IN' END,
          CASE WHEN n.i % 10 IN (1,2,3) THEN 'OUT' ELSE 'IN' END, it.id, 1 + n.i % 5, 'piece', CASE WHEN n.i % 10 IN (1,2,3) THEN -(1 + n.i % 5) ELSE 1 + n.i % 5 END,
          'ACC-' || (1 + n.i % 4), CASE WHEN n.i % 7 = 0 THEN 'Shelf check note ' || n.i END, CASE WHEN n.i % 10 IN (1,2,3) THEN 'CONSUMED' ELSE 'PURCHASED' END, 'POSTED'
        FROM n JOIN it ON it.r = n.i % (SELECT c FROM cnt)`);
      // Loans (4% of the tier) on Loanable items, a quarter damaged, each with its loan-out movement and, when returned, a return movement.
      sqlite.exec(`${rows(loans)}, ${pick("item_type = 'Loanable'")}
        INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, reason, photo_key, movement_id, created_at, created_by, status, closed_at, closed_by, return_note)
        SELECT 'LN-P' || n.i, it.id, 1, 'USC', 'Synthetic Borrower ' || n.i, '00-' || n.i, 'Event ' || n.i, 'synthetic/' || n.i, 'PLM-' || n.i, ${when("n.i", 23)}, 'ACC-1',
          CASE WHEN n.i % 4 = 0 THEN 'DAMAGED' ELSE 'RETURNED' END, ${when("n.i", 37)}, 'ACC-1', CASE WHEN n.i % 3 = 0 THEN 'scratch ' || n.i END
        FROM n JOIN it ON it.r = n.i % (SELECT c FROM cnt)`);
      sqlite.exec(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, related_entity_type, related_entity_id, actor_user_id, status)
        SELECT movement_id, created_at, 'LOAN_OUT', 'OUT', item_id, 1, 'piece', -1, 'LOAN', id, 'ACC-1', 'POSTED' FROM loans`);
      sqlite.exec(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, related_entity_type, related_entity_id, actor_user_id, status)
        SELECT 'PLR-' || id, closed_at, 'LOAN_RETURN', 'IN', item_id, 1, 'piece', 1, 'LOAN', id, 'ACC-1', 'POSTED' FROM loans WHERE status = 'RETURNED'`);
      // Audit (25% of the tier): account creations, item edits, reorder entries and loan closings (a third damaged, a third good, a third with no outcome).
      sqlite.exec(`${rows(audits)}, ${pick()}
        INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
        SELECT 'PA-' || n.i, ${when("n.i", 41)}, 'ACC-' || (1 + n.i % 4),
          CASE n.i % 5 WHEN 0 THEN 'ACCOUNT_CREATED' WHEN 1 THEN 'ITEM_UPDATED' WHEN 2 THEN 'ITEM_UPDATED' WHEN 3 THEN 'LOAN_CLOSED' ELSE 'REORDER_OPENED' END,
          CASE WHEN n.i % 5 = 0 THEN 'ACCOUNT' ELSE 'ITEM' END, CASE WHEN n.i % 5 = 0 THEN 'ACC-9' ELSE it.id END,
          CASE n.i % 5 WHEN 3 THEN CASE (n.i / 5) % 3 WHEN 0 THEN '{"loanId":"LN-P' || (1 + n.i % ${loans}) || '","outcome":"DAMAGED","quantity":1}' WHEN 1 THEN '{"loanId":"LN-P' || (1 + n.i % ${loans}) || '","outcome":"RETURNED","quantity":1}' ELSE '{"loanId":"LN-P' || (1 + n.i % ${loans}) || '","quantity":1}' END
            WHEN 0 THEN '{"username":"u' || n.i || '","role":"STAFF"}' ELSE '{"name":"x"}' END
        FROM n JOIN it ON it.r = n.i % (SELECT c FROM cnt)`);
      // Phone events (25% of the tier): thirds of returns, takes and borrows; a third of returns held; a fifteenth resolved; notes on some.
      sqlite.exec(`${rows(phones)}, ${pick()}
        INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, purpose, reason, return_outcome, note, device_time, sent_at, occurred_at, received_at, applied, review, resolved_at, resolved_by, resolution_note)
        SELECT 'PE-' || n.i, 'D', n.i, CASE n.i % 3 WHEN 0 THEN 'RETURN' WHEN 1 THEN 'TAKE' ELSE 'BORROW' END, it.id, 1, 'Synthetic Person ' || n.i, '00-' || n.i, NULL,
          CASE WHEN n.i % 9 = 0 THEN 'class project ' || n.i END, NULL, CASE WHEN n.i % 11 = 0 THEN 'box was wet' END,
          n.t, n.t, n.t, n.t, CASE WHEN n.i % 3 = 1 THEN 1 ELSE 0 END, CASE WHEN n.i % 3 = 0 THEN 'RETURN_CHECK' END,
          CASE WHEN n.i % 15 = 0 THEN n.t END, CASE WHEN n.i % 15 = 0 THEN 'ACC-1' END, CASE WHEN n.i % 15 = 0 THEN 'checked ' || n.i END
        FROM (SELECT i, ${when("i", 53)} AS t FROM n) n JOIN it ON it.r = n.i % (SELECT c FROM cnt)`);
      // ACTIVITY_PERF_NO_0016=1 measures the query as production runs until migration 0016 is applied there.
      if (process.env.ACTIVITY_PERF_NO_0016) for (const index of ["idx_activity_movements", "idx_activity_audit", "idx_activity_audit_item", "idx_activity_phone", "idx_activity_resolved"]) sqlite.exec(`DROP INDEX ${index}`);
      sqlite.exec("ANALYZE");
      const sizes = { items: count("items"), movements: count("inventory_movements"), audit: count("audit_log"), loans: count("loans"), phone: count("self_service_events") };
      out.push(`### Tier ${scale}: ${sizes.items} items, ${sizes.movements} movements, ${sizes.audit} audit rows, ${sizes.loans} loans, ${sizes.phone} phone events`, "", "| Query | Rows | Median ms | Max ms | SQL id | Plan id |", "|---|---|---|---|---|---|");

      // The statement `activityPage` ran is the one whose text starts with WITH; capture it and explain that exact text with its own bindings.
      let captured: { sql: string; plan: string } | null = null;
      const realPrepare = sqlite.prepare.bind(sqlite);
      (sqlite as { prepare: unknown }).prepare = (sql: string) => {
        const statement = realPrepare(sql);
        const all = statement.all.bind(statement);
        statement.all = (...args: never[]) => {
          if (/^\s*WITH/.test(sql)) captured = { sql, plan: realPrepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((row) => String(row.detail)).join("\n") };
          return all(...args);
        };
        return statement;
      };
      for (const [name, filters, cursor, limit] of CASES) {
        const query = { filters, cursor, limit } as ActivityQuery;
        let result = await activityPage(d1, true, query);
        for (let i = 1; i < WARMUP; i += 1) result = await activityPage(d1, true, query);
        const times: number[] = [];
        for (let i = 0; i < RUNS; i += 1) {
          const start = performance.now();
          result = await activityPage(d1, true, query);
          if (limit > 100) activityCsv(result.events, result.nextCursor !== null);
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        const ran = captured as { sql: string; plan: string };
        const planId = HASH(ran.plan);
        const entry = planIndex.get(planId) ?? { plan: ran.plan, uses: [] };
        entry.uses.push(`${name} @${scale}`);
        planIndex.set(planId, entry);
        out.push(`| ${name} | ${result.events.length} | ${times[Math.floor(RUNS / 2)]!.toFixed(1)} | ${times[RUNS - 1]!.toFixed(1)} | ${HASH(ran.sql)} | ${planId} |`);
      }
      out.push("");
    }
    const header = [
      "## Harness output",
      "",
      `Tool versions: node ${process.version}, vitest 4.1.11 (package-lock), SQLite ${versions.get("sqlite")}, ${process.platform} ${process.arch}, ${(cpus()[0]?.model ?? "unknown CPU").trim()}.`,
      `Indexes: ${process.env.ACTIVITY_PERF_NO_0016 ? "migration 0016 indexes DROPPED (production state until 0016 is applied there)" : "migration 0016 indexes present (as applied by migratedD1 to every disposable test database)"}.`,
      `Method: ${WARMUP} warm-up then ${RUNS} timed runs per query as ADMIN, through \`activityPage\` (query build, SQL, row mapping and the balance read; no HTTP, no ETag digest); median and max reported. SQL id / Plan id are the first 10 hex of SHA-256 of the executed statement text / its EXPLAIN QUERY PLAN output (the same id means the same text). Dataset is deterministic (no random()), synthetic except the migrated catalog items.`,
      ""
    ];
    const plans = ["## Distinct query plans (full EXPLAIN QUERY PLAN, by Plan id)", ""];
    for (const [id, { plan, uses }] of planIndex) plans.push(`#### ${id} — used by: ${uses.join("; ")}`, "", "```", plan, "```", "");
    const text = [...header, ...out, ...plans].join("\n");
    if (process.env.ACTIVITY_PERF_OUT) writeFileSync(process.env.ACTIVITY_PERF_OUT, text);
    else console.log(text);
  }, 1_800_000);
});
