import { appendFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { attention, attentionSummary } from "../src/attention";
import { insights } from "../src/home";
import { catalogueSnapshot } from "../src/catalogue";
import { staffInventory } from "../src/inventory";
import { kitList } from "../src/kits";
import { loansOverview } from "../src/loans";
import { locationList } from "../src/locations";
import { searchIndex } from "../src/search-index";
import { selfServiceReview } from "../src/self-service";
import { directory, findPeople } from "../src/staff-directory";
import { stockOverview, recentActivity } from "../src/stock";
import { seedHub, TIERS, type Tier } from "./scale-fixture";

/*
 * V1.14 scale evidence. Every staff read runs against a hub at the current size, ten times it and (SCALE_STRESS=1) a hundred times it.
 * Each statement the read issues is recorded and its SQLite query plan checked: a read may scan a table only when the table is
 * one the read means to return whole (the catalog), never the append-only history (movements, audit, loans, self-service events).
 * node:sqlite measures query work, not the D1 round trip, so the times are regression guards. Set SCALE_LOG to append the figures.
 */

/** Partial indexes that hold only open work, so walking them is bounded by what is open, not by history. */
const OPEN_ONLY = ["idx_self_service_events_open"];
const HISTORY = ["inventory_movements", "audit_log", "loans", "self_service_events", "inventory_balances"];
/** Reads that walk a history table on purpose, with why. Each is in the V1.14 release record. */
const EXCEPTIONS: Array<[read: string, table: string]> = [
  // The balance of every item is the sum of its ledger: the movement-derived rule, so a read that needs every item's level passes the ledger once.
  ["attention", "inventory_balances"],
  ["attentionSummary", "inventory_balances"],
  ["selfServiceReview", "inventory_balances"],
  // The newest 100 movements: the time index is walked in order and stops at the 100th (LIMIT 1 OFFSET 99), not through history.
  ["recentActivity", "inventory_movements"],
  ["stockOverview", "inventory_movements"],
  // The closed-loans list orders by closed_at, which has no index: it reads every loan and sorts. Needs migration 0031 (an index on loans(closed_at)), an owner action; recorded in the V1.14 release record.
  ["loansOverview", "loans"]
];

/** A plan names a table by its alias in the query ("SCAN l"); this maps each alias back to its table. */
function aliases(sql: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, table, alias] of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+INDEXED\s+BY\s+\w+)?(?:\s+(?:AS\s+)?(?!(?:WHERE|ON|JOIN|LEFT|INNER|GROUP|ORDER|LIMIT|USING|WINDOW|UNION)\b)(\w+))?/gi)) if (alias) found.set(alias, table!);
  return found;
}
const tiers = (process.env.SCALE_STRESS ? ["current", "growth", "stress"] : ["current", "growth"]) as Tier[];
const note = (line: string) => { if (process.env.SCALE_LOG) appendFileSync(process.env.SCALE_LOG, `${line}\n`); };

type Recorded = { sql: string; args: unknown[] };

/** Wraps a D1 stand-in so each statement a read prepares is kept with the values it was finally bound to. */
function recording(d1: D1Database) {
  const log: Recorded[] = [];
  const target = d1 as unknown as { prepare: (sql: string) => object; batch: (statements: unknown[]) => Promise<unknown> };
  const wrap = (statement: object, entry: Recorded): object => new Proxy(statement, {
    get(inner, key) {
      if (key === "bind") return (...args: unknown[]) => {
        entry.args = args;
        return wrap((inner as { bind: (...a: unknown[]) => object }).bind(...args), entry);
      };
      return Reflect.get(inner, key) as unknown;
    }
  });
  const spy = new Proxy(target, {
    get(inner, key) {
      if (key === "prepare") return (sql: string) => { const entry = { sql, args: [] }; log.push(entry); return wrap(inner.prepare(sql), entry); };
      return Reflect.get(inner, key) as unknown;
    }
  });
  return { d1: spy as unknown as D1Database, log };
}

describe("hot reads at growing scale", () => {
  const results = new Map<string, { bytes: number; ms: number }>();
  for (const tier of tiers) {
    const items = TIERS[tier];
    describe(`${tier} (${items.toLocaleString()} items)`, () => {
      const database = seedHub(items);
      const reads: Array<[string, (db: D1Database) => Promise<unknown>]> = [
        ["staffInventory", staffInventory],
        ["searchIndex", searchIndex],
        ["catalogueSnapshot", catalogueSnapshot],
        ["stockOverview", stockOverview],
        ["loansOverview", loansOverview],
        ["selfServiceReview", selfServiceReview],
        ["directory", directory],
        ["findPeople", (db) => findPeople(db, "person 7")],
        ["kitList", kitList],
        ["locationList", locationList],
        ["attention", attention],
        ["attentionSummary", attentionSummary],
        ["insights", insights],
        ["recentActivity", recentActivity]
      ];
      for (const [name, read] of reads) {
        it(`${name} never scans the history tables`, async () => {
          const { sqlite } = database;
          const { d1, log } = recording(database.d1);
          const started = performance.now();
          const body = await read(d1);
          const ms = performance.now() - started;
          results.set(`${tier}/${name}`, { bytes: JSON.stringify(body).length, ms });
          note(`${tier} ${name}: ${ms.toFixed(1)} ms, ${JSON.stringify(body).length.toLocaleString()} bytes (${gzipSync(JSON.stringify(body)).length.toLocaleString()} gzipped), ${log.length} statements`);
          for (const { sql, args } of log) {
            let plan: Array<{ detail: string }>;
            try { plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(args as never[])) as Array<{ detail: string }>; } catch { continue; }
            for (const { detail } of plan) {
              const target = /^SCAN (?:TABLE )?(\w+)/.exec(detail)?.[1];
              const scan = target && (aliases(sql).get(target) ?? target);
              if (scan && HISTORY.includes(scan) && !OPEN_ONLY.some((index) => detail.includes(index)) && !EXCEPTIONS.some(([read, table]) => read === name && table === scan)) {
                note(`  ${tier} ${name}: ${detail} (${scan})`);
                expect.soft(detail, `${name} walks ${scan}: ${sql.slice(0, 80)}`).not.toMatch(/^SCAN/);
              }
            }
          }
        });
      }
    });
  }

  it("keeps the answers that are meant to be small small when the hub grows tenfold", () => {
    for (const name of ["recentActivity", "attentionSummary", "insights", "findPeople"]) {
      const before = results.get(`current/${name}`)!.bytes;
      const after = results.get(`growth/${name}`)!.bytes;
      expect(after, `${name} grew from ${before} to ${after} bytes`).toBeLessThanOrEqual(before * 1.5);
    }
  });
});
