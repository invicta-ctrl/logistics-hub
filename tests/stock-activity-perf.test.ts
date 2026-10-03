import { cpus } from "node:os";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migratedD1 } from "./d1-sqlite";
import { recentActivity } from "../src/stock";
import { REFERENCE_RECENT_ACTIVITY, syntheticLedger } from "./stock-activity-reference";

/**
 * R7 evidence harness for the Stock workspace's activity list. Skipped in `npm test`; run it with
 *   STOCK_ACTIVITY_PERF=1 STOCK_ACTIVITY_PERF_OUT=<file> npx vitest run tests/stock-activity-perf.test.ts
 * Optional STOCK_ACTIVITY_PERF_TIERS="1000,20000,100000" (default) sets the synthetic movement counts, and
 * STOCK_ACTIVITY_PERF_ITEMS=<n> spreads them over n items instead of max(528, movements / 45) (a few busy items).
 * Each tier builds a fresh in-memory SQLite with every migration and a deterministic synthetic ledger,
 * checks that `recentActivity` returns exactly what the pre-R7 query returns, and times both
 * (2 warm-up, 7 timed runs, median). Local node:sqlite only, not D1.
 */
const TIERS = (process.env.STOCK_ACTIVITY_PERF_TIERS ?? "1000,20000,100000").split(",").map(Number);
const WARMUP = 2;
const RUNS = 7;

describe.skipIf(!process.env.STOCK_ACTIVITY_PERF)("stock activity performance (R7)", () => {
  it("returns the reference rows at each tier and records the timings and plans", async () => {
    const out: string[] = ["| Movements | Items | Rows | Before median ms | After median ms | Speed-up | Identical |", "|---|---|---|---|---|---|---|"];
    const plans: string[] = [];
    let sqliteVersion = "";
    for (const scale of TIERS) {
      const { sqlite, d1 } = migratedD1();
      sqliteVersion = String((sqlite.prepare("SELECT sqlite_version() v").get() as { v: string }).v);
      const items = Number(process.env.STOCK_ACTIVITY_PERF_ITEMS) || Math.max(528, Math.round(scale / 45));
      syntheticLedger(sqlite, scale, items);
      sqlite.exec("ANALYZE");
      const time = async (run: () => Promise<unknown[]>) => {
        let rows: unknown[] = [];
        for (let i = 0; i < WARMUP; i += 1) rows = await run();
        const times: number[] = [];
        for (let i = 0; i < RUNS; i += 1) {
          const start = performance.now();
          rows = await run();
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return { rows, median: times[Math.floor(RUNS / 2)]! };
      };
      const before = await time(async () => (await d1.prepare(REFERENCE_RECENT_ACTIVITY).all()).results);
      let statement = "";
      const realPrepare = d1.prepare.bind(d1);
      (d1 as { prepare: unknown }).prepare = (sql: string) => { statement = sql; return realPrepare(sql); };
      const after = await time(() => recentActivity(d1));
      (d1 as { prepare: unknown }).prepare = realPrepare;
      expect(after.rows).toEqual(before.rows);
      out.push(`| ${scale} | ${items} | ${after.rows.length} | ${before.median.toFixed(1)} | ${after.median.toFixed(1)} | ${(before.median / after.median).toFixed(1)}x | yes |`);
      if (scale === TIERS[TIERS.length - 1]) {
        const explain = (sql: string) => (sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((row) => row.detail).join("\n");
        plans.push(`#### Before, tier ${scale}`, "", "```", explain(REFERENCE_RECENT_ACTIVITY), "```", "", `#### After, tier ${scale}`, "", "```", explain(statement), "```");
      }
    }
    const header = `Tool versions: node ${process.version}, SQLite ${sqliteVersion}, ${process.platform} ${process.arch}, ${(cpus()[0]?.model ?? "unknown CPU").trim()}. ` +
      `Method: ${WARMUP} warm-up then ${RUNS} timed runs per query through the D1 stand-in; median reported.`;
    const text = [header, "", ...out, "", ...plans, ""].join("\n");
    if (process.env.STOCK_ACTIVITY_PERF_OUT) writeFileSync(process.env.STOCK_ACTIVITY_PERF_OUT, text);
    console.log(text);
  }, 600_000);
});
