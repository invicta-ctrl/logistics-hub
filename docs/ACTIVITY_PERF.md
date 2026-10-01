# Activity query performance (AC-A7)

Evidence for the accepted AC-A7 of the Part 5 plan: Cursor-paginated Activity queries stay responsive on the current production-scale dataset, add no avoidable full-table scan per page, are measured after the final SQL shape, and get an index only where the measurement justifies it. Stage 5.1, `src/activity.ts` as committed with this file. There are no fixed millisecond gates.

## How to reproduce

`tests/activity-perf.test.ts` is skipped in `npm test` and runs only on request. It builds a fresh in-memory SQLite with every file in `migrations/` (as `migratedD1()` does for all tests), empties the ledger tables, loads a deterministic synthetic ledger (no `random()`, no imported personal data; the only real rows are the 397 migrated catalog items, which carry no personal data) and runs each query shape through the real `activityPage`. It prints the tier sizes, the timings and the full `EXPLAIN QUERY PLAN` of the exact statement that ran.

```
# bash
ACTIVITY_PERF=1 ACTIVITY_PERF_OUT=perf.md npx vitest run tests/activity-perf.test.ts
ACTIVITY_PERF=1 ACTIVITY_PERF_NO_0016=1 ACTIVITY_PERF_OUT=perf-no0016.md npx vitest run tests/activity-perf.test.ts
# PowerShell: $env:ACTIVITY_PERF="1"; $env:ACTIVITY_PERF_OUT="perf.md"; npx vitest run tests/activity-perf.test.ts
```

`ACTIVITY_PERF_TIERS="1000,20000,100000"` (default) sets the synthetic movement counts; `ACTIVITY_PERF_NO_0016=1` drops the five 0016 indexes first. The two runs below took about 25 s each on a developer laptop (AMD Ryzen 7 5800H, Windows 11, node 26.3.0, vitest 4.1.11, SQLite 3.53.1 from `node:sqlite`). Timings are machine-dependent; the statement ids (SQL id) and plan ids are not, so a rerun should reproduce them and show timings of the same shape.

Fixture construction (per tier `N` movements): items = the 397 migrated ones plus synthetic ones up to max(528, N/45) (every fifth Loanable, two stock areas, 40 shelves); `N` movements spread over a year and the items (60% stock in, 30% stock out, 10% counts, every seventh with a note); loans = 4% of N on Loanable items (a quarter damaged) with their loan-out movement and, when returned, a return movement; audit rows = 25% of N (a fifth each account creations, item edits twice, reorder entries, loan closings split a third damaged, a third good return, a third with no outcome); phone events = 25% of N (thirds of takes, borrows and returns; returns held for review; a fifteenth resolved; notes on some). Names, IDs and notes are synthetic (`Synthetic Borrower 7`, `00-7`, `scratch 12`, `class project 9`). `ANALYZE` runs after loading.

## What "current production scale" is, and what is not proven

**Measured 2026-10-01** (Claude Cloud, under Earl's 2026-10-01 approval of exactly this read-only check; the two `SELECT`s in `.codex/PART_05_CLOUD_HANDOFF.md`, run through the Cloudflare D1 connector against the database configured in `wrangler.jsonc` as `logistics-hub` / `DB`; 0 rows written, no other statement run): `items` 549, `inventory_movements` 686, `audit_log` 658, `loans` 12, `self_service_events` 21. None of the five 0016 index names exists in production (the second query returned no rows), so production runs the query as run 2 below measures it.

The 1,000-movement tier (528 items, 1,070 movements, 250 audit rows, 250 phone events) is therefore a fair, slightly generous stand-in for production today (more movements and phone events than production, about 40% of its audit rows), and the 20,000 and 100,000 tiers are growth stress tiers. At that tier every query shape in both runs takes under 20 ms locally (run 2, without 0016, 18 ms for the unfiltered page), so the API is responsive in production without 0016. D1 latency itself is still unmeasured.

The earlier estimate, kept for provenance: `docs/MIGRATION_STATUS.md` (2026-09-28) records 397 items, their opening-balance movements and one legacy ledger row; the 2026-09-30 catalog-sheet record adds 131 items and 75 count adjustments; Part 4 acceptance recorded three synthetic loans.

## Migration 0016 status

`migrations/0016_activity_feed_index.sql` (five indexes, no data change) is applied to every disposable in-memory database that `migratedD1()` builds, so the feature tests and run 1 use the indexes. It is NOT applied to production D1: on 2026-10-01 none of its five index names existed there (see above). Applying it needs its own authorization (docs/DEPLOYMENT.md); the code does not depend on it. Run 2 measures the query as production runs it until then.

## Results and decision

- **Index-supported paging is flat and small.** With 0016: unfiltered, limit 100, deep cursor, date range, item, actor, source, changed filters take 5 to 12 ms at the 1,000 tier and 11 to 33 ms at 100,000 movements (run 1). Each arm walks its ordering index and stops at the page size, then does primary-key lookups; the before/after balance reads `idx_inventory_movements_item_created` for the items on the page only. No per-request full-table scan on these paths.
- **The 0016 indexes are justified by measurement.** Without them (run 2) the same unfiltered page goes 18 ms (1,000) to 82 ms (20,000) to 343 ms (100,000): each arm sorts its whole table per request. With them: 10 / 17 / 22 ms. At production size (686 movements on 2026-10-01; the 1,000 tier) both are under 20 ms, so nothing is urgent today; the indexes matter as the ledger grows, and they are already written. No other index was added: the remaining slow shapes are not indexable.
- **Inherent scans, with growth (run 1, 1,000 / 20,000 / 100,000 tier).** Text search (`LIKE '%q%'`, the plan walks the arm's ordering index and filters): unmatched or rare 13 / 65-72 / 411-419 ms; a common term or one combined with a date range stops early (10-12 / 18-27 / 22-52 ms). `attention`: 13 / 86 / 400 ms (it reads every item's movements to find a negative running balance at any age, as the ledger-authority design requires). `stockArea`: 10 / 26 / 134 ms (reads that area's items' movements and sorts). A leading-wildcard substring and a whole-ledger balance cannot use a B-tree index; adding a full-text table, a stored balance or a denormalized column would be a schema and authority change that the measurements at production size (13 ms at the 1,000 tier) do not justify, and the accepted AC-A7 does not require them. Revisit if production passes about 20,000 movements (those queries then take 65-90 ms) or a slow search is reported; rerun the harness after any material change to `src/activity.ts`, per AC-A7.
- **Limits of this evidence.** Local `node:sqlite`, not D1 (its latency and SQLite build are unmeasured); one machine; synthetic distributions; `activityPage` only, without HTTP, sessions or the ETag digest (which costs a few ms and was measured earlier).

## Run 1 — 0016 indexes present

### Harness output

Tool versions: node v26.3.0, vitest 4.1.11 (package-lock), SQLite 3.53.1, win32 x64, AMD Ryzen 7 5800H with Radeon Graphics.
Method: 2 warm-up then 7 timed runs per query as ADMIN, through `activityPage` (query build, SQL, row mapping and the balance read; no HTTP, no ETag digest); median and max reported. SQL id / Plan id are the first 10 hex of SHA-256 of the executed statement text / its EXPLAIN QUERY PLAN output (the same id means the same text). Dataset is deterministic (no random()), synthetic except the migrated catalog items.

#### Tier 1000: 528 items, 1070 movements, 250 audit rows, 40 loans, 250 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 10.3 | 11.9 | 6dbdbccff1 | 4d30e4267a |
| unfiltered, 100 | 100 | 12.4 | 16.5 | 6dbdbccff1 | 4d30e4267a |
| deep cursor, 50 | 50 | 11.0 | 12.6 | 596c5d6c47 | 44cd88dafb |
| date range (a month) | 50 | 11.1 | 16.4 | cbb8373e2c | d22bd81894 |
| item | 1 | 7.5 | 12.4 | 662e8b7033 | 0f6675c801 |
| actor | 50 | 10.3 | 10.8 | a6b16c5d5d | 4d30e4267a |
| stockArea | 50 | 9.8 | 12.3 | 908a40023a | 94674ed49f |
| location | 7 | 8.5 | 9.7 | 1840be119f | 94674ed49f |
| source=LOAN | 50 | 6.8 | 9.0 | cd15729ca6 | 3b18fa2e81 |
| changed=yes | 50 | 4.9 | 6.1 | 721c0c2356 | 349474697f |
| attention | 50 | 13.0 | 17.6 | f9627c3b93 | 3af5ab8482 |
| text, rare (few matches) | 0 | 13.1 | 15.9 | f2525e1b00 | 4d30e4267a |
| text, unmatched | 0 | 13.2 | 17.3 | f2525e1b00 | 4d30e4267a |
| text, common (fills the page) | 50 | 11.5 | 12.4 | f2525e1b00 | 4d30e4267a |
| text + date range | 1 | 10.3 | 12.2 | 53f257ca2b | d22bd81894 |

#### Tier 20000: 528 items, 21400 movements, 5000 audit rows, 800 loans, 5000 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 16.9 | 21.7 | 6dbdbccff1 | 4d30e4267a |
| unfiltered, 100 | 100 | 24.4 | 26.4 | 6dbdbccff1 | 4d30e4267a |
| deep cursor, 50 | 50 | 18.7 | 22.1 | 596c5d6c47 | 44cd88dafb |
| date range (a month) | 50 | 18.4 | 19.8 | cbb8373e2c | d22bd81894 |
| item | 50 | 10.5 | 13.1 | 662e8b7033 | 25697f4699 |
| actor | 50 | 18.0 | 20.0 | a6b16c5d5d | 4d30e4267a |
| stockArea | 50 | 25.8 | 29.3 | 908a40023a | 82af1d4b55 |
| location | 50 | 16.9 | 19.8 | 1840be119f | 82af1d4b55 |
| source=LOAN | 50 | 16.3 | 19.8 | cd15729ca6 | 3b18fa2e81 |
| changed=yes | 50 | 15.2 | 17.7 | 721c0c2356 | 349474697f |
| attention | 50 | 86.4 | 89.9 | f9627c3b93 | 3af5ab8482 |
| text, rare (few matches) | 7 | 72.3 | 81.4 | f2525e1b00 | 4d30e4267a |
| text, unmatched | 0 | 65.3 | 69.3 | f2525e1b00 | 4d30e4267a |
| text, common (fills the page) | 50 | 17.5 | 24.1 | f2525e1b00 | 4d30e4267a |
| text + date range | 42 | 26.5 | 33.3 | 53f257ca2b | d22bd81894 |

#### Tier 100000: 2222 items, 107000 movements, 25000 audit rows, 4000 loans, 25000 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 22.3 | 23.9 | 6dbdbccff1 | 4d30e4267a |
| unfiltered, 100 | 100 | 32.7 | 37.8 | 6dbdbccff1 | 4d30e4267a |
| deep cursor, 50 | 50 | 20.1 | 23.4 | 596c5d6c47 | 44cd88dafb |
| date range (a month) | 50 | 22.7 | 24.5 | cbb8373e2c | d22bd81894 |
| item | 50 | 11.2 | 12.1 | 662e8b7033 | 25697f4699 |
| actor | 50 | 23.9 | 25.3 | a6b16c5d5d | 4d30e4267a |
| stockArea | 50 | 134.2 | 149.6 | 908a40023a | 82af1d4b55 |
| location | 50 | 35.9 | 41.6 | 1840be119f | 82af1d4b55 |
| source=LOAN | 50 | 20.6 | 23.3 | cd15729ca6 | 3b18fa2e81 |
| changed=yes | 50 | 19.4 | 23.3 | 721c0c2356 | 349474697f |
| attention | 50 | 400.2 | 424.5 | f9627c3b93 | 3af5ab8482 |
| text, rare (few matches) | 50 | 419.3 | 495.0 | f2525e1b00 | 4d30e4267a |
| text, unmatched | 0 | 411.0 | 426.6 | f2525e1b00 | 4d30e4267a |
| text, common (fills the page) | 50 | 22.1 | 25.9 | f2525e1b00 | 4d30e4267a |
| text + date range | 50 | 52.3 | 57.2 | 53f257ca2b | d22bd81894 |

### Distinct query plans (full EXPLAIN QUERY PLAN, by Plan id)

##### 4d30e4267a — used by: unfiltered, 50 @1000; unfiltered, 100 @1000; actor @1000; text, rare (few matches) @1000; text, unmatched @1000; text, common (fills the page) @1000; unfiltered, 50 @20000; unfiltered, 100 @20000; actor @20000; text, rare (few matches) @20000; text, unmatched @20000; text, common (fills the page) @20000; unfiltered, 50 @100000; unfiltered, 100 @100000; actor @100000; text, rare (few matches) @100000; text, unmatched @100000; text, common (fills the page) @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 44cd88dafb — used by: deep cursor, 50 @1000; deep cursor, 50 @20000; deep cursor, 50 @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### d22bd81894 — used by: date range (a month) @1000; text + date range @1000; date range (a month) @20000; text + date range @20000; date range (a month) @100000; text + date range @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 0f6675c801 — used by: item @1000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 94674ed49f — used by: stockArea @1000; location @1000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 3b18fa2e81 — used by: source=LOAN @1000; source=LOAN @20000; source=LOAN @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 11
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-14)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 8
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-14)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 349474697f — used by: changed=yes @1000; changed=yes @20000; changed=yes @100000

```
MATERIALIZE page
CO-ROUTINE (subquery-1)
SCAN m USING INDEX idx_activity_movements
SEARCH i USING INDEX sqlite_autoindex_items_1 (id=?)
SEARCH a USING INDEX sqlite_autoindex_staff_accounts_1 (id=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_loans_1 (id=?) LEFT-JOIN
SCAN (subquery-1)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN p
CORRELATED SCALAR SUBQUERY 9
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-12)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-12)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 3af5ab8482 — used by: attention @1000; attention @20000; attention @100000

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
CO-ROUTINE (subquery-22)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-22)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 2
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
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
CORRELATED SCALAR SUBQUERY 19
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 20
SCAN bad
CREATE BLOOM FILTER
```

##### 25697f4699 — used by: item @20000; item @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 82af1d4b55 — used by: stockArea @20000; location @20000; stockArea @100000; location @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

## Run 2 — 0016 indexes dropped (production state until 0016 is applied)

### Harness output

Tool versions: node v26.3.0, vitest 4.1.11 (package-lock), SQLite 3.53.1, win32 x64, AMD Ryzen 7 5800H with Radeon Graphics.
Indexes: migration 0016 indexes DROPPED (production state until 0016 is applied there).
Method: 2 warm-up then 7 timed runs per query as ADMIN, through `activityPage` (query build, SQL, row mapping and the balance read; no HTTP, no ETag digest); median and max reported. SQL id / Plan id are the first 10 hex of SHA-256 of the executed statement text / its EXPLAIN QUERY PLAN output (the same id means the same text). Dataset is deterministic (no random()), synthetic except the migrated catalog items.

#### Tier 1000: 528 items, 1070 movements, 250 audit rows, 40 loans, 250 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 18.3 | 22.4 | 6dbdbccff1 | e28732b9ad |
| unfiltered, 100 | 100 | 18.6 | 25.1 | 6dbdbccff1 | e28732b9ad |
| deep cursor, 50 | 50 | 15.1 | 18.6 | 596c5d6c47 | e28732b9ad |
| date range (a month) | 50 | 16.9 | 21.8 | cbb8373e2c | e28732b9ad |
| item | 1 | 8.3 | 12.5 | 662e8b7033 | 0f6675c801 |
| actor | 50 | 11.1 | 13.1 | a6b16c5d5d | e28732b9ad |
| stockArea | 50 | 10.6 | 14.5 | 908a40023a | 55b9f66b69 |
| location | 7 | 12.2 | 13.4 | 1840be119f | 55b9f66b69 |
| source=LOAN | 50 | 8.7 | 12.0 | cd15729ca6 | 2688d98964 |
| changed=yes | 50 | 8.6 | 10.2 | 721c0c2356 | 76af09df38 |
| attention | 50 | 20.1 | 22.4 | f9627c3b93 | ff3988ab23 |
| text, rare (few matches) | 0 | 16.0 | 18.6 | f2525e1b00 | bb007895d0 |
| text, unmatched | 0 | 17.1 | 20.0 | f2525e1b00 | bb007895d0 |
| text, common (fills the page) | 50 | 16.4 | 18.1 | f2525e1b00 | bb007895d0 |
| text + date range | 1 | 16.1 | 19.8 | 53f257ca2b | e28732b9ad |

#### Tier 20000: 528 items, 21400 movements, 5000 audit rows, 800 loans, 5000 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 82.3 | 89.9 | 6dbdbccff1 | 043df01664 |
| unfiltered, 100 | 100 | 97.3 | 107.6 | 6dbdbccff1 | 043df01664 |
| deep cursor, 50 | 50 | 97.6 | 98.9 | 596c5d6c47 | 043df01664 |
| date range (a month) | 50 | 68.4 | 76.3 | cbb8373e2c | 043df01664 |
| item | 50 | 11.2 | 14.8 | 662e8b7033 | 25697f4699 |
| actor | 50 | 34.2 | 37.7 | a6b16c5d5d | 3d5c17e114 |
| stockArea | 50 | 26.9 | 28.4 | 908a40023a | 499dfd42d5 |
| location | 50 | 10.9 | 13.8 | 1840be119f | 499dfd42d5 |
| source=LOAN | 50 | 30.6 | 32.0 | cd15729ca6 | c0a2e0d65d |
| changed=yes | 50 | 52.0 | 55.3 | 721c0c2356 | 1b2935c894 |
| attention | 50 | 112.2 | 116.4 | f9627c3b93 | 2a57d7fb7b |
| text, rare (few matches) | 7 | 48.1 | 52.1 | f2525e1b00 | 043df01664 |
| text, unmatched | 0 | 46.8 | 49.9 | f2525e1b00 | 043df01664 |
| text, common (fills the page) | 50 | 63.3 | 73.8 | f2525e1b00 | 043df01664 |
| text + date range | 42 | 71.5 | 79.1 | 53f257ca2b | 043df01664 |

#### Tier 100000: 2222 items, 107000 movements, 25000 audit rows, 4000 loans, 25000 phone events

| Query | Rows | Median ms | Max ms | SQL id | Plan id |
|---|---|---|---|---|---|
| unfiltered, 50 | 50 | 343.0 | 348.8 | 6dbdbccff1 | 043df01664 |
| unfiltered, 100 | 100 | 382.6 | 436.8 | 6dbdbccff1 | 043df01664 |
| deep cursor, 50 | 50 | 417.2 | 433.8 | 596c5d6c47 | 043df01664 |
| date range (a month) | 50 | 285.6 | 334.4 | cbb8373e2c | 043df01664 |
| item | 50 | 12.7 | 14.7 | 662e8b7033 | 25697f4699 |
| actor | 50 | 103.1 | 124.0 | a6b16c5d5d | 3d5c17e114 |
| stockArea | 50 | 164.2 | 175.2 | 908a40023a | 499dfd42d5 |
| location | 50 | 29.1 | 35.1 | 1840be119f | 499dfd42d5 |
| source=LOAN | 50 | 101.6 | 114.7 | cd15729ca6 | c0a2e0d65d |
| changed=yes | 50 | 245.8 | 320.9 | 721c0c2356 | 1b2935c894 |
| attention | 50 | 793.3 | 962.9 | f9627c3b93 | 2a57d7fb7b |
| text, rare (few matches) | 50 | 278.2 | 318.2 | f2525e1b00 | 043df01664 |
| text, unmatched | 0 | 253.8 | 323.3 | f2525e1b00 | 043df01664 |
| text, common (fills the page) | 50 | 400.4 | 426.3 | f2525e1b00 | 043df01664 |
| text + date range | 50 | 280.8 | 302.1 | 53f257ca2b | 043df01664 |

### Distinct query plans (full EXPLAIN QUERY PLAN, by Plan id)

##### e28732b9ad — used by: unfiltered, 50 @1000; unfiltered, 100 @1000; deep cursor, 50 @1000; date range (a month) @1000; actor @1000; text + date range @1000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 0f6675c801 — used by: item @1000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 55b9f66b69 — used by: stockArea @1000; location @1000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 2688d98964 — used by: source=LOAN @1000

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
SCAN p
CORRELATED SCALAR SUBQUERY 11
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-14)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 8
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-14)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 76af09df38 — used by: changed=yes @1000

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
SCAN p
CORRELATED SCALAR SUBQUERY 9
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-12)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-12)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### ff3988ab23 — used by: attention @1000

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
CO-ROUTINE (subquery-22)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-22)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 2
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
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
CORRELATED SCALAR SUBQUERY 19
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 20
SCAN bad
CREATE BLOOM FILTER
```

##### bb007895d0 — used by: text, rare (few matches) @1000; text, unmatched @1000; text, common (fills the page) @1000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 043df01664 — used by: unfiltered, 50 @20000; unfiltered, 100 @20000; deep cursor, 50 @20000; date range (a month) @20000; text, rare (few matches) @20000; text, unmatched @20000; text, common (fills the page) @20000; text + date range @20000; unfiltered, 50 @100000; unfiltered, 100 @100000; deep cursor, 50 @100000; date range (a month) @100000; text, rare (few matches) @100000; text, unmatched @100000; text, common (fills the page) @100000; text + date range @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 25697f4699 — used by: item @20000; item @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 3d5c17e114 — used by: actor @20000; actor @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 499dfd42d5 — used by: stockArea @20000; location @20000; stockArea @100000; location @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 15
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 16
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-18)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-18)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### c0a2e0d65d — used by: source=LOAN @20000; source=LOAN @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 11
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 12
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-14)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 8
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-14)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 1b2935c894 — used by: changed=yes @20000; changed=yes @100000

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
SCAN p
CORRELATED SCALAR SUBQUERY 9
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 10
MATERIALIZE bad
MATERIALIZE running
CO-ROUTINE (subquery-12)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 6
MATERIALIZE touched
SCAN page
USE TEMP B-TREE FOR DISTINCT
SCAN touched
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-12)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN touched
SCAN r
SEARCH c USING AUTOMATIC COVERING INDEX (item_id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
SCAN bad
CREATE BLOOM FILTER
```

##### 2a57d7fb7b — used by: attention @20000; attention @100000

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
CO-ROUTINE (subquery-22)
SEARCH m USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 4
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
SCAN (subquery-22)
MATERIALIZE counted
SEARCH inventory_movements USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 2
SCAN items USING COVERING INDEX sqlite_autoindex_items_1
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
CORRELATED SCALAR SUBQUERY 19
SEARCH x USING INDEX sqlite_autoindex_inventory_movements_1 (id=?)
SEARCH r USING INDEX idx_inventory_movements_item_created (item_id=?)
LIST SUBQUERY 20
SCAN bad
CREATE BLOOM FILTER
```
