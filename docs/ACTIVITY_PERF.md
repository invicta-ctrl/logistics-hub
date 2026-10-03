# Activity query performance (AC-A7)

Evidence for the accepted AC-A7 of the Part 5 plan: Cursor-paginated Activity queries stay responsive on the current production-scale dataset, add no avoidable full-table scan per page, are measured after the final SQL shape, and get an index only where the measurement justifies it. `src/activity.ts` as committed with this file (Stage 5.3: the page query, plus the CSV export that reuses it). There are no fixed millisecond gates.

## How to reproduce

`tests/activity-perf.test.ts` is skipped in `npm test` and runs only on request. It builds a fresh in-memory SQLite with every file in `migrations/` (as `migratedD1()` does for all tests), empties the ledger tables, loads a deterministic synthetic ledger (no `random()`, no imported personal data; the only real rows are the 397 migrated catalog items, which carry no personal data) and runs each query shape through the real `activityPage` (the two export shapes also build the CSV text with `activityCsv`). It prints the tier sizes, the timings and the full `EXPLAIN QUERY PLAN` of the exact statement that ran.

```
# bash
ACTIVITY_PERF=1 ACTIVITY_PERF_OUT=perf.md npx vitest run tests/activity-perf.test.ts
ACTIVITY_PERF=1 ACTIVITY_PERF_NO_0016=1 ACTIVITY_PERF_OUT=perf-no0016.md npx vitest run tests/activity-perf.test.ts
# PowerShell: $env:ACTIVITY_PERF="1"; $env:ACTIVITY_PERF_OUT="perf.md"; npx vitest run tests/activity-perf.test.ts
```

`ACTIVITY_PERF_TIERS="1000,20000,100000"` (default) sets the synthetic movement counts; `ACTIVITY_PERF_NO_0016=1` drops the five 0016 indexes first. The two runs below took about 35 s and 50 s in the Claude Cloud container (Linux x64, Intel Xeon @ 2.10GHz, node 22.22.0, vitest 4.1.11, SQLite 3.50.4 from `node:sqlite`); the first record (Stage 5.1, Windows 11, AMD Ryzen 7 5800H, node 26.3.0, SQLite 3.53.1) is in Git history at `3204cba`. Timings are machine-dependent; the statement ids (SQL id) and plan ids are not, so a rerun of the same code should reproduce them and show timings of the same shape. Every one of the 45 page shapes returned the same row count as the first record.

Fixture construction (per tier `N` movements): items = the 397 migrated ones plus synthetic ones up to max(528, N/45) (every fifth Loanable, two stock areas, 40 shelves); `N` movements spread over a year and the items (60% stock in, 30% stock out, 10% counts, every seventh with a note); loans = 4% of N on Loanable items (a quarter damaged) with their loan-out movement and, when returned, a return movement; audit rows = 25% of N (a fifth each account creations, item edits twice, reorder entries, loan closings split a third damaged, a third good return, a third with no outcome); phone events = 25% of N (thirds of takes, borrows and returns; returns held for review; a fifteenth resolved; notes on some). Names, IDs and notes are synthetic (`Synthetic Borrower 7`, `00-7`, `scratch 12`, `class project 9`). `ANALYZE` runs after loading.

## What "current production scale" is, and what is not proven

**Measured 2026-10-01** (Claude Cloud, under Earl's 2026-10-01 approval of exactly this read-only check; the two `SELECT`s in `.codex/PART_05_CLOUD_HANDOFF.md`, run through the Cloudflare D1 connector against the database configured in `wrangler.jsonc` as `logistics-hub` / `DB`; 0 rows written, no other statement run): `items` 549, `inventory_movements` 686, `audit_log` 658, `loans` 12, `self_service_events` 21. None of the five 0016 index names exists in production (the second query returned no rows), so production runs the query as run 2 below measures it.

The 1,000-movement tier (528 items, 1,070 movements, 250 audit rows, 250 phone events) is therefore a fair, slightly generous stand-in for production today (more movements and phone events than production, about 40% of its audit rows), and the 20,000 and 100,000 tiers are growth stress tiers. At that tier every page shape in both runs takes under 20 ms locally (run 2, without 0016, about 10 ms for the unfiltered page) and an export of everything about 40 ms, so the API is responsive in production without 0016. D1 latency itself is still unmeasured.

The earlier estimate, kept for provenance: `docs/MIGRATION_STATUS.md` (2026-09-28) records 397 items, their opening-balance movements and one legacy ledger row; the 2026-09-30 catalog-sheet record adds 131 items and 75 count adjustments; Part 4 acceptance recorded three synthetic loans.

## Migration 0016 status

`migrations/0016_activity_feed_index.sql` (five indexes, no data change) is applied to every disposable in-memory database that `migratedD1()` builds, so the feature tests and run 1 use the indexes. On 2026-10-01 none of its five index names existed in production (see above); it was applied there on 2026-10-02 with `0017` (`docs/DEPLOYMENT.md`, Part 5B). Run 2 measures the query as production ran it before that.

## Part 5B recheck (2026-10-01)

Part 5B changed the SQL slightly: the phone arm also lists `USE` events, an emptied open unit is typed from `related_entity_type`, and the audit arm also answers the Stock source (open-unit steps). Migration `0017` re-creates `idx_activity_phone` with the phone arm's new predicate, so the partial index still matches it. Rerun of tiers 1,000 and 20,000 with `0016` and `0017` applied (same container): every page shape returns the same rows and the **same plan id** as run 1 below, only the SQL ids changed; timings are of the same shape (1,000 tier: 3 to 12 ms per page, 39 ms for an export of everything). Between applying `0017` and merging, the code already live cannot use the re-created phone index (its predicate differs), so it sorts the phone events per request: 21 rows in production on 2026-10-01, negligible. The new statements are on the item sheet only (open units, uses recorded, units used up), each an indexed lookup for one item.

## Results and decision

- **What changed since the first record (Stage 5.3), and why it was re-measured.** Each movement's balance after it was a correlated `SUM` per row over its item's earlier movements; it now joins the `running` balance CTE that the same statement already computed for its items (the "needs attention" check), so one window pass serves both. The per-row subquery was quadratic in an item's history and made a 5,000-row export of one busy item take about 6 s; the join makes it linear. The SQL and plan ids therefore all changed; the row counts did not.
- **Index-supported paging is flat and small.** With 0016: unfiltered, limit 100, deep cursor, date range, item, actor, source, changed filters take 4 to 9 ms at the 1,000 tier and 10 to 24 ms at 100,000 movements (run 1). Each arm walks its ordering index and stops at the page size, then does primary-key lookups; balances read only the items on the page. No per-request full-table scan on these paths.
- **The 0016 indexes are justified by measurement.** Without them (run 2) the unfiltered page goes 10 ms (1,000) to 57 ms (20,000) to 230 ms (100,000): each arm sorts its whole table per request. With them: 8 / 11 / 17 ms. At production size (686 movements on 2026-10-01; the 1,000 tier) both are under 15 ms, so nothing is urgent today; the indexes matter as the ledger grows, and they are already written. No other index was added: the remaining slow shapes are not indexable.
- **Inherent scans, with growth (run 1, 1,000 / 20,000 / 100,000 tier).** Text search (`LIKE '%q%'`, the plan walks the arm's ordering index and filters): unmatched or rare 10-11 / 37-52 / 296-309 ms; a common term or one combined with a date range stops early (10-11 / 20-33 / 21-39 ms). `attention`: 10 / 69 / 326 ms (it reads every item's movements to find a negative running balance at any age, as the ledger-authority design requires). `stockArea`: 8 / 27 / 93 ms. A leading-wildcard substring and a whole-ledger balance cannot use a B-tree index; a full-text table, a stored balance or a denormalized column would be a schema and authority change that the measurements at production size (about 10 ms) do not justify, and the accepted AC-A7 does not require them. Revisit if production passes about 20,000 movements or a slow search is reported; rerun the harness after any material change to `src/activity.ts`, per AC-A7.
- **Export (Stage 5.3).** An export runs the same statement with no cursor and a limit of `EXPORT_ROWS` (2,000), then builds the CSV. Run 1: all 1,485 entries of the 1,000 tier in 36 ms; 2,000 entries in 111 ms at 20,000 and 280 ms at 100,000 movements; a text-filtered export 9 / 83 / 529 ms. The Worker-CPU part (row mapping and CSV text, everything but SQL) was measured separately at about 10 µs per entry (roughly 20 ms for a full 2,000-entry file; 5,000 would be about 50 ms), which is why the cap is 2,000: it holds all of production's history today (about 1,400 visible entries) and bounds the CPU of one request. On 2026-10-01 a full production export (1,333 entries) succeeded, so the current Workers plan allows a full file today; if the history grows past the cap, the file says so and the dates narrow it. Exports are rare and rate-limited (10 per 10 minutes per account).
- **Re-run after the review fix (PR #3).** The phone-resolution entry now also selects what staff decided (one projected column in one arm, no filter or order change). The tables below are that re-run: every plan id and every row count is unchanged, the SQL ids are new because the statement text changed, and the timings are within run-to-run noise of the figures quoted above (which come from the run just before it).
- **Limits of this evidence.** Local `node:sqlite`, not D1 (its latency and SQLite build are unmeasured); one machine; synthetic distributions; `activityPage` (and `activityCsv` for exports) only, without HTTP, sessions or the ETag digest (which costs a few ms and was measured earlier).

## Stock workspace activity list (R7, 2026-10-03)

Finding R7 of the accepted review-hardening amendment (`docs/specs/accepted/2026-10-03-review-hardening-amendment.md`, H7): the Stock workspace's "recent activity" (`recentActivity` in `src/stock.ts`, polled every 15 s while the workspace is open) summed a running total over the **whole** ledger on every poll to show 100 rows. It now picks the 100 rows first, walking the `idx_activity_movements` time index (migration `0016`, applied to production 2026-10-02), and sums the running total only for the items those rows touch. No cache, no new state, no migration.

**Exactness.** The list keeps the ledger order (`HISTORY_ORDER`: stored time, then insertion). The index key is that time normalized to UTC milliseconds, which orders the same way except for text that is not a date, which the index files under one oldest key. So the query takes every row at or after the 100th-newest key, plus every row under the oldest key, and re-sorts them exactly. A tie at the edge or an odd timestamp cannot change the page. `tests/hardening.test.ts` (R7) compares the result with the pre-R7 query, kept verbatim in `tests/stock-activity-reference.ts`, on an empty ledger, a short and a long one, 150 rows sharing the 100th time inserted out of id order, and mixed offsets, missing milliseconds, a space separator, non-dates, an impossible date, an empty string and a bare day number. Replacing the selection with a plain "newest 100 by index" fails the last two, so the tests guard the real hazard. The same two statements also returned identical rows on wrangler's local D1 (workerd's SQLite, all migrations applied, plus rows with a non-date, a `+08:00` offset, a space-separated time and a VOID status), which also shows D1 accepts `AS MATERIALIZED`.

**Reproduce.** `STOCK_ACTIVITY_PERF=1 STOCK_ACTIVITY_PERF_OUT=<file> npx vitest run tests/stock-activity-perf.test.ts` (tiers via `STOCK_ACTIVITY_PERF_TIERS`, default 1000,20000,100000; `STOCK_ACTIVITY_PERF_ITEMS=<n>` for a few busy items). Each tier is a fresh in-memory SQLite with every migration and a deterministic synthetic ledger (every twentieth row imported, every fiftieth VOID). The harness fails unless the rows are identical, and CI runs it at the 1,000 tier.

**Budget (from H7): met.** At 100,000 movements the median is 8.6 ms against 210 ms before (24×; the budget was at least 5× and under 30 ms). At 1,000 it is 0.8 ms against 2.2 ms (the budget was no slower than +10%). Rows were identical at every tier.

Tool versions: node v22.22.0, SQLite 3.50.4, linux x64, Intel(R) Xeon(R) Processor @ 2.10GHz. Method: 2 warm-up then 7 timed runs per query through the D1 stand-in; median reported.

| Movements | Items | Rows | Before median ms | After median ms | Speed-up | Identical |
|---|---|---|---|---|---|---|
| 1000 | 528 | 100 | 2.2 | 0.8 | 2.9x | yes |
| 20000 | 528 | 100 | 35.0 | 4.6 | 7.6x | yes |
| 100000 | 2222 | 100 | 210.3 | 8.6 | 24.4x | yes |

#### Before, tier 100000

```
CO-ROUTINE (subquery-1)
CO-ROUTINE (subquery-3)
SCAN m USING INDEX idx_inventory_movements_item_created
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-3)
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
```

#### After, tier 100000

```
MATERIALIZE recent
SEARCH m USING INTEGER PRIMARY KEY (rowid=?)
LIST SUBQUERY 3
COMPOUND QUERY
LEFT-MOST SUBQUERY
SEARCH m USING INDEX idx_activity_movements (<expr>>?)
SCALAR SUBQUERY 1
SCAN m USING INDEX idx_activity_movements
CREATE BLOOM FILTER
UNION ALL
SEARCH m USING COVERING INDEX idx_activity_movements (<expr>=?)
CREATE BLOOM FILTER
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE ledger
CO-ROUTINE (subquery-8)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 5
SCAN recent
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-8)
SCAN r
SEARCH m USING INTEGER PRIMARY KEY (rowid=?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
BLOOM FILTER ON l (seq=?)
SEARCH l USING AUTOMATIC COVERING INDEX (seq=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
```

**Remaining cost.** The running totals still read every movement of each item on the page, because a balance is the sum of its item's ledger and no stored balance exists (by design, `docs/DATA_ARCHITECTURE.md`). When the newest 100 movements fall on a few items with long histories, the query costs about what it did before, never more:

| Movements | Items | Rows | Before median ms | After median ms | Speed-up | Identical |
|---|---|---|---|---|---|---|
| 1000 | 5 | 100 | 2.5 | 2.0 | 1.2x | yes |
| 20000 | 5 | 100 | 40.6 | 28.3 | 1.4x | yes |
| 100000 | 5 | 100 | 285.2 | 232.3 | 1.2x | yes |

Today production has under 1,000 movements over about 550 items, so both shapes are around 1 ms. Revisit with a measured, non-authoritative read model only if one item's history reaches tens of thousands of movements.

## Run 1 — 0016 indexes present

### Harness output

Tool versions: node v22.22.0, vitest 4.1.11 (package-lock), SQLite 3.50.4, linux x64, Intel(R) Xeon(R) Processor @ 2.10GHz.
Indexes: migration 0016 indexes present (as applied by migratedD1 to every disposable test database).
Method: 2 warm-up then 7 timed runs per query as ADMIN, through `activityPage` (query build, SQL, row mapping and the balance read; no HTTP, no ETag digest); median and max reported. SQL id / Plan id are the first 10 hex of SHA-256 of the executed statement text / its EXPLAIN QUERY PLAN output (the same id means the same text). Dataset is deterministic (no random()), synthetic except the migrated catalog items.

#### Tier 1000: 528 items, 1070 movements, 250 audit rows, 40 loans, 250 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 10.6 | 12.8 | 95bdaef99d | c80c5828ab |
| unfiltered, 100 | 100 | 11.8 | 14.6 | 95bdaef99d | c80c5828ab |
| deep cursor, 50 | 50 | 8.2 | 8.4 | 6fe9be9905 | 6b9250a6a4 |
| date range (a month) | 50 | 9.4 | 11.2 | 763ce66a18 | 94439784f2 |
| item | 1 | 7.4 | 9.9 | aa0623476c | 4fe04c81a1 |
| actor | 50 | 8.5 | 8.7 | 961b981250 | c80c5828ab |
| stockArea | 50 | 9.3 | 10.5 | edbafb106b | 43e7ba87bb |
| location | 7 | 7.9 | 10.3 | 88ee1f5894 | 43e7ba87bb |
| source=LOAN | 50 | 5.9 | 7.8 | fe7d680a09 | 607d89e9d2 |
| changed=yes | 50 | 3.6 | 3.9 | e63e462373 | b988fef532 |
| attention | 50 | 8.3 | 9.5 | 8cf9acef35 | cc408b0679 |
| text, rare (few matches) | 0 | 8.6 | 8.9 | 2c158825e0 | c80c5828ab |
| text, unmatched | 0 | 9.0 | 9.3 | 2c158825e0 | c80c5828ab |
| text, common (fills the page) | 50 | 8.9 | 15.5 | 2c158825e0 | c80c5828ab |
| text + date range | 1 | 8.7 | 12.9 | f1d75e2166 | 94439784f2 |
| export file, unfiltered | 1485 | 32.2 | 53.0 | 95bdaef99d | c80c5828ab |
| export file, text | 22 | 8.3 | 9.2 | 2c158825e0 | c80c5828ab |

#### Tier 20000: 528 items, 21400 movements, 5000 audit rows, 800 loans, 5000 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 16.0 | 16.6 | 95bdaef99d | c80c5828ab |
| unfiltered, 100 | 100 | 20.6 | 23.5 | 95bdaef99d | c80c5828ab |
| deep cursor, 50 | 50 | 12.8 | 13.0 | 6fe9be9905 | 6b9250a6a4 |
| date range (a month) | 50 | 13.8 | 14.4 | 763ce66a18 | 94439784f2 |
| item | 50 | 8.4 | 8.7 | aa0623476c | c734f00d4a |
| actor | 50 | 13.2 | 13.4 | 961b981250 | c80c5828ab |
| stockArea | 50 | 17.7 | 18.3 | edbafb106b | cfba005778 |
| location | 50 | 12.3 | 18.5 | 88ee1f5894 | cfba005778 |
| source=LOAN | 50 | 11.4 | 12.2 | fe7d680a09 | 607d89e9d2 |
| changed=yes | 50 | 8.3 | 9.3 | e63e462373 | b988fef532 |
| attention | 50 | 56.4 | 68.5 | 8cf9acef35 | cc408b0679 |
| text, rare (few matches) | 7 | 60.5 | 79.3 | 2c158825e0 | c80c5828ab |
| text, unmatched | 0 | 45.8 | 82.7 | 2c158825e0 | c80c5828ab |
| text, common (fills the page) | 50 | 16.1 | 18.5 | 2c158825e0 | c80c5828ab |
| text + date range | 42 | 23.6 | 27.3 | f1d75e2166 | 94439784f2 |
| export file, unfiltered | 2000 | 118.5 | 174.1 | 95bdaef99d | c80c5828ab |
| export file, text | 412 | 80.8 | 95.2 | 2c158825e0 | c80c5828ab |

#### Tier 100000: 2222 items, 107000 movements, 25000 audit rows, 4000 loans, 25000 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 18.5 | 28.0 | 95bdaef99d | c80c5828ab |
| unfiltered, 100 | 100 | 23.5 | 48.4 | 95bdaef99d | c80c5828ab |
| deep cursor, 50 | 50 | 16.0 | 16.5 | 6fe9be9905 | 6b9250a6a4 |
| date range (a month) | 50 | 17.6 | 21.5 | 763ce66a18 | 94439784f2 |
| item | 50 | 9.5 | 11.3 | aa0623476c | c734f00d4a |
| actor | 50 | 18.5 | 21.1 | 961b981250 | c80c5828ab |
| stockArea | 50 | 94.2 | 155.5 | edbafb106b | cfba005778 |
| location | 50 | 30.3 | 35.4 | 88ee1f5894 | cfba005778 |
| source=LOAN | 50 | 19.0 | 19.7 | fe7d680a09 | 607d89e9d2 |
| changed=yes | 50 | 13.2 | 15.8 | e63e462373 | b988fef532 |
| attention | 50 | 321.7 | 365.3 | 8cf9acef35 | cc408b0679 |
| text, rare (few matches) | 50 | 314.6 | 370.6 | 2c158825e0 | c80c5828ab |
| text, unmatched | 0 | 293.9 | 355.9 | 2c158825e0 | c80c5828ab |
| text, common (fills the page) | 50 | 27.1 | 31.8 | 2c158825e0 | c80c5828ab |
| text + date range | 50 | 43.8 | 58.6 | f1d75e2166 | 94439784f2 |
| export file, unfiltered | 2000 | 253.6 | 291.6 | 95bdaef99d | c80c5828ab |
| export file, text | 2000 | 571.8 | 642.7 | 2c158825e0 | c80c5828ab |

### Distinct query plans (full EXPLAIN QUERY PLAN, by Plan id)

##### c80c5828ab — used by: unfiltered, 50 @1000; unfiltered, 100 @1000; actor @1000; text, rare (few matches) @1000; text, unmatched @1000; text, common (fills the page) @1000; export file, unfiltered @1000; export file, text @1000; unfiltered, 50 @20000; unfiltered, 100 @20000; actor @20000; text, rare (few matches) @20000; text, unmatched @20000; text, common (fills the page) @20000; export file, unfiltered @20000; export file, text @20000; unfiltered, 50 @100000; unfiltered, 100 @100000; actor @100000; text, rare (few matches) @100000; text, unmatched @100000; text, common (fills the page) @100000; export file, unfiltered @100000; export file, text @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN m USING INDEX idx_activity_movements
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SCAN a USING INDEX idx_activity_audit
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SCAN e USING INDEX idx_activity_phone
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SCAN e USING INDEX idx_activity_resolved
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 6b9250a6a4 — used by: deep cursor, 50 @1000; deep cursor, 50 @20000; deep cursor, 50 @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SEARCH m USING INDEX idx_activity_movements (<expr><?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SEARCH a USING INDEX idx_activity_audit (<expr><?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SEARCH e USING INDEX idx_activity_phone (<expr><?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SEARCH e USING INDEX idx_activity_resolved (<expr><?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 94439784f2 — used by: date range (a month) @1000; text + date range @1000; date range (a month) @20000; text + date range @20000; date range (a month) @100000; text + date range @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SEARCH m USING INDEX idx_activity_movements (<expr>>? AND <expr><?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SEARCH a USING INDEX idx_activity_audit (<expr>>? AND <expr><?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SEARCH e USING INDEX idx_activity_phone (<expr>>? AND <expr><?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SEARCH e USING INDEX idx_activity_resolved (<expr>>? AND <expr><?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 4fe04c81a1 — used by: item @1000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX idx_audit_log_entity_item (entity_type=? AND entity_id=?)
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 43e7ba87bb — used by: stockArea @1000; location @1000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN i
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SEARCH a USING INDEX idx_activity_audit_item (entity_type=?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SCAN e USING INDEX idx_activity_phone
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SCAN e USING INDEX idx_activity_resolved
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 607d89e9d2 — used by: source=LOAN @1000; source=LOAN @20000; source=LOAN @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN m USING INDEX idx_activity_movements
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SCAN a USING INDEX idx_activity_audit
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-13)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 8
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-13)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 11
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### b988fef532 — used by: changed=yes @1000; changed=yes @20000; changed=yes @100000

```
MATERIALIZE page
CO-ROUTINE (subquery-1)
SCAN m USING INDEX idx_activity_movements
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-1)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-11)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-11)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 9
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### cc408b0679 — used by: attention @1000; attention @20000; attention @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-8)
SCAN m USING INDEX idx_activity_movements
BLOOM FILTER ON i (id=?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
LIST SUBQUERY 7
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-21)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-21)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 2
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-8)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-11)
SCAN a USING INDEX idx_activity_audit
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
LIST SUBQUERY 10
SCAN bad
CREATE BLOOM FILTER
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-11)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-14)
SCAN e USING INDEX idx_activity_phone
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
LIST SUBQUERY 13
SCAN bad
CREATE BLOOM FILTER
SCAN (subquery-14)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-17)
SCAN e USING INDEX idx_activity_resolved
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
LIST SUBQUERY 16
SCAN bad
CREATE BLOOM FILTER
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SCAN (subquery-17)
USE TEMP B-TREE FOR ORDER BY
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 19
SCAN bad
CREATE BLOOM FILTER
```

##### c734f00d4a — used by: item @20000; item @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX idx_audit_log_entity_item (entity_type=? AND entity_id=?)
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### cfba005778 — used by: stockArea @20000; location @20000; stockArea @100000; location @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN i
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SEARCH a USING INDEX idx_activity_audit_item (entity_type=?)
BLOOM FILTER ON i (id=?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SCAN i
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SCAN e USING INDEX idx_activity_resolved
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

## Run 2 — 0016 indexes dropped (production state until 0016 is applied)

### Harness output

Tool versions: node v22.22.0, vitest 4.1.11 (package-lock), SQLite 3.50.4, linux x64, Intel(R) Xeon(R) Processor @ 2.10GHz.
Indexes: migration 0016 indexes DROPPED (production state until 0016 is applied there).
Method: 2 warm-up then 7 timed runs per query as ADMIN, through `activityPage` (query build, SQL, row mapping and the balance read; no HTTP, no ETag digest); median and max reported. SQL id / Plan id are the first 10 hex of SHA-256 of the executed statement text / its EXPLAIN QUERY PLAN output (the same id means the same text). Dataset is deterministic (no random()), synthetic except the migrated catalog items.

#### Tier 1000: 528 items, 1070 movements, 250 audit rows, 40 loans, 250 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 13.5 | 15.7 | 95bdaef99d | 22e4a5e256 |
| unfiltered, 100 | 100 | 11.0 | 13.8 | 95bdaef99d | 22e4a5e256 |
| deep cursor, 50 | 50 | 10.8 | 11.6 | 6fe9be9905 | 22e4a5e256 |
| date range (a month) | 50 | 10.0 | 12.0 | 763ce66a18 | 22e4a5e256 |
| item | 1 | 7.1 | 7.5 | aa0623476c | 4fe04c81a1 |
| actor | 50 | 8.3 | 9.2 | 961b981250 | 22e4a5e256 |
| stockArea | 50 | 8.0 | 9.0 | edbafb106b | 9ca63a8c21 |
| location | 7 | 8.7 | 10.0 | 88ee1f5894 | 9ca63a8c21 |
| source=LOAN | 50 | 5.7 | 9.4 | fe7d680a09 | 64e8548ea6 |
| changed=yes | 50 | 4.5 | 5.2 | e63e462373 | 6b73536ebe |
| attention | 50 | 13.2 | 14.5 | 8cf9acef35 | 72feb6976a |
| text, rare (few matches) | 0 | 10.4 | 11.7 | 2c158825e0 | 734f5a3b85 |
| text, unmatched | 0 | 9.3 | 15.9 | 2c158825e0 | 734f5a3b85 |
| text, common (fills the page) | 50 | 10.3 | 11.0 | 2c158825e0 | 734f5a3b85 |
| text + date range | 1 | 10.5 | 17.5 | f1d75e2166 | 22e4a5e256 |
| export file, unfiltered | 1485 | 35.7 | 51.5 | 95bdaef99d | 22e4a5e256 |
| export file, text | 22 | 9.4 | 12.3 | 2c158825e0 | 734f5a3b85 |

#### Tier 20000: 528 items, 21400 movements, 5000 audit rows, 800 loans, 5000 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 55.9 | 63.8 | 95bdaef99d | c77c161538 |
| unfiltered, 100 | 100 | 57.6 | 77.2 | 95bdaef99d | c77c161538 |
| deep cursor, 50 | 50 | 66.7 | 87.8 | 6fe9be9905 | c77c161538 |
| date range (a month) | 50 | 48.6 | 52.0 | 763ce66a18 | c77c161538 |
| item | 50 | 8.6 | 9.7 | aa0623476c | c734f00d4a |
| actor | 50 | 22.1 | 23.2 | 961b981250 | 132f38b123 |
| stockArea | 50 | 19.6 | 23.7 | edbafb106b | 95031aa7e0 |
| location | 50 | 10.6 | 13.3 | 88ee1f5894 | 95031aa7e0 |
| source=LOAN | 50 | 28.3 | 34.3 | fe7d680a09 | 518e93c127 |
| changed=yes | 50 | 34.6 | 39.2 | e63e462373 | 58b2484e14 |
| attention | 50 | 91.4 | 99.2 | 8cf9acef35 | 2611a40216 |
| text, rare (few matches) | 7 | 31.8 | 36.0 | 2c158825e0 | c77c161538 |
| text, unmatched | 0 | 29.4 | 30.4 | 2c158825e0 | c77c161538 |
| text, common (fills the page) | 50 | 46.2 | 52.3 | 2c158825e0 | c77c161538 |
| text + date range | 42 | 67.8 | 92.6 | f1d75e2166 | c77c161538 |
| export file, unfiltered | 2000 | 162.1 | 214.7 | 95bdaef99d | c77c161538 |
| export file, text | 412 | 53.9 | 55.3 | 2c158825e0 | c77c161538 |

#### Tier 100000: 2222 items, 107000 movements, 25000 audit rows, 4000 loans, 25000 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 204.6 | 262.2 | 95bdaef99d | c77c161538 |
| unfiltered, 100 | 100 | 255.3 | 311.2 | 95bdaef99d | c77c161538 |
| deep cursor, 50 | 50 | 268.4 | 335.0 | 6fe9be9905 | c77c161538 |
| date range (a month) | 50 | 186.1 | 229.1 | 763ce66a18 | c77c161538 |
| item | 50 | 10.0 | 13.1 | aa0623476c | c734f00d4a |
| actor | 50 | 73.4 | 84.6 | 961b981250 | 132f38b123 |
| stockArea | 50 | 111.8 | 137.6 | edbafb106b | 95031aa7e0 |
| location | 50 | 24.0 | 28.4 | 88ee1f5894 | 95031aa7e0 |
| source=LOAN | 50 | 75.4 | 92.5 | fe7d680a09 | 518e93c127 |
| changed=yes | 50 | 161.9 | 207.8 | e63e462373 | 58b2484e14 |
| attention | 50 | 509.7 | 587.8 | 8cf9acef35 | 2611a40216 |
| text, rare (few matches) | 50 | 155.7 | 175.4 | 2c158825e0 | c77c161538 |
| text, unmatched | 0 | 126.1 | 139.5 | 2c158825e0 | c77c161538 |
| text, common (fills the page) | 50 | 246.3 | 264.5 | 2c158825e0 | c77c161538 |
| text + date range | 50 | 192.8 | 223.5 | f1d75e2166 | c77c161538 |
| export file, unfiltered | 2000 | 550.0 | 618.3 | 95bdaef99d | c77c161538 |
| export file, text | 2000 | 413.1 | 472.6 | 2c158825e0 | c77c161538 |

### Distinct query plans (full EXPLAIN QUERY PLAN, by Plan id)

##### 22e4a5e256 — used by: unfiltered, 50 @1000; unfiltered, 100 @1000; deep cursor, 50 @1000; date range (a month) @1000; actor @1000; text + date range @1000; export file, unfiltered @1000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN m
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SCAN a
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SCAN e
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SCAN e
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 4fe04c81a1 — used by: item @1000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX idx_audit_log_entity_item (entity_type=? AND entity_id=?)
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 9ca63a8c21 — used by: stockArea @1000; location @1000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN i
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SEARCH a USING INDEX idx_audit_log_entity (entity_type=?)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SCAN i
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SCAN i
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 64e8548ea6 — used by: source=LOAN @1000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN m
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SCAN a
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-13)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 8
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-13)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 11
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 6b73536ebe — used by: changed=yes @1000

```
MATERIALIZE page
CO-ROUTINE (subquery-1)
SCAN m
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-11)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-11)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 9
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 72feb6976a — used by: attention @1000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-8)
SCAN i
LIST SUBQUERY 7
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-21)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-21)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 2
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-8)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-11)
SCAN a
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
LIST SUBQUERY 10
SCAN bad
CREATE BLOOM FILTER
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-11)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-14)
SCAN e
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
LIST SUBQUERY 13
SCAN bad
CREATE BLOOM FILTER
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-14)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-17)
SCAN e
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
LIST SUBQUERY 16
SCAN bad
CREATE BLOOM FILTER
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-17)
USE TEMP B-TREE FOR ORDER BY
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 19
SCAN bad
CREATE BLOOM FILTER
```

##### 734f5a3b85 — used by: text, rare (few matches) @1000; text, unmatched @1000; text, common (fills the page) @1000; export file, text @1000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN i
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SCAN a
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SCAN e
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SCAN e
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### c77c161538 — used by: unfiltered, 50 @20000; unfiltered, 100 @20000; deep cursor, 50 @20000; date range (a month) @20000; text, rare (few matches) @20000; text, unmatched @20000; text, common (fills the page) @20000; text + date range @20000; export file, unfiltered @20000; export file, text @20000; unfiltered, 50 @100000; unfiltered, 100 @100000; deep cursor, 50 @100000; date range (a month) @100000; text, rare (few matches) @100000; text, unmatched @100000; text, common (fills the page) @100000; text + date range @100000; export file, unfiltered @100000; export file, text @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN i
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SCAN a
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SCAN i
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SCAN i
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### c734f00d4a — used by: item @20000; item @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX idx_audit_log_entity_item (entity_type=? AND entity_id=?)
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 132f38b123 — used by: actor @20000; actor @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN m
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SCAN a
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SCAN i
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SCAN e
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 95031aa7e0 — used by: stockArea @20000; location @20000; stockArea @100000; location @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN i
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SCAN i
SEARCH a USING INDEX idx_audit_log_entity_item (entity_type=? AND entity_id=?)
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-5)
SCAN i
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-5)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-7)
SCAN i
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-7)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-17)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-17)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 15
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 518e93c127 — used by: source=LOAN @20000; source=LOAN @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-1)
SCAN i
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-3)
SCAN a
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-3)
USE TEMP B-TREE FOR ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-13)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 8
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-13)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 11
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 58b2484e14 — used by: changed=yes @20000; changed=yes @100000

```
MATERIALIZE page
CO-ROUTINE (subquery-1)
SCAN i
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-1)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
MATERIALIZE running
CO-ROUTINE (subquery-11)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-11)
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 9
MATERIALIZE bad
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN touched
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 2611a40216 — used by: attention @20000; attention @100000

```
MATERIALIZE page
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-8)
SCAN i
LIST SUBQUERY 7
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-21)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
CREATE BLOOM FILTER
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-21)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 2
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
CREATE BLOOM FILTER
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-8)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-11)
SCAN a
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?) LEFT-JOIN
LIST SUBQUERY 10
SCAN bad
CREATE BLOOM FILTER
SEARCH c USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-11)
USE TEMP B-TREE FOR ORDER BY
RIGHT
MERGE (UNION ALL)
LEFT
CO-ROUTINE (subquery-14)
SCAN i
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
LIST SUBQUERY 13
SCAN bad
CREATE BLOOM FILTER
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-14)
USE TEMP B-TREE FOR ORDER BY
RIGHT
CO-ROUTINE (subquery-17)
SCAN i
LIST SUBQUERY 16
SCAN bad
CREATE BLOOM FILTER
SEARCH e USING INDEX idx_self_service_events_item (item_id=?)
SEARCH r USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-17)
USE TEMP B-TREE FOR ORDER BY
SCAN p
SEARCH r USING AUTOMATIC COVERING INDEX (movementId=?) LEFT-JOIN
LIST SUBQUERY 19
SCAN bad
CREATE BLOOM FILTER
```
