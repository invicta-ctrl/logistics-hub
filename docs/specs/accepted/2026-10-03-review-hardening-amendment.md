# Accepted Amendment — Review-driven hardening (R1–R9)

STATUS: ACCEPTED
ACCEPTED_BY: Earl (instruction of 2026-10-03: "I accept all")
ACCEPTED_DATE: 2026-10-03
PROPOSED_BY: Claude Cloud (mainline session), 2026-10-03
APPLIES_TO: invicta-ctrl/logistics-hub, `main` (Earl's direct-main instruction for this session)
SOURCE: the main-branch architecture and performance review of 2026-10-03, baseline `8777602cd0b6b86d0333307389f5d25395653bf4`, as restated in Earl's hardening prompt (the review file itself was not available to this session)
SCOPE: correctness repairs to accounts, recovery, retention, loan evidence and live refresh; one Stock query; one test harness; a release-gating design. One new migration (`0023`). No new feature, dependency, framework, binding, secret or bucket.

## Why

The review found nine defects in code that is already accepted and live. Four break invariants that earlier work promised (at least one active Owner; a recovery key works once; retention keeps a loan's photo for 730 days after it closes; erasure never loses track of a private object). No accepted specification authorizes these repairs, a new migration, a performance budget or a release gate, so they are proposed here.

## Baseline and revalidation (current `main` at `17127ef`, 2026-10-03)

`8777602` is an ancestor of `17127ef`; the 31 commits between them are the V1.3 integration, docs and this session's merge of the performance doctrine. None touches the affected code paths. Each finding was rechecked on `17127ef` with a disposable test on the real migrated schema (`tests/d1-sqlite.ts`, all migrations through `0022`; the file was not kept):

| # | Finding | Result on `17127ef` |
|---|---|---|
| R1 | Last-Owner safeguard is a count read before the write | **Reproduced.** Two Owners disabling each other at once: both succeed, 0 active Owners remain. |
| R2 | Recovery key reusable under concurrency | **Reproduced.** One key used twice at once: both succeed, 2 `OWNER_RECOVERY_USED` audits. |
| R3 | Phone erasure deletes a photo its loan still keeps | **Reproduced.** Phone record 400 days old, its loan closed 100 days ago, same key: erasure deleted the object, the loan still points at it. |
| R4 | Concurrent erasure loses track of photos | **Reproduced.** Two erasures over 100 eligible loans: each reports 50, all 100 references cleared, 50 objects left untracked. |
| R5 | Uncertain commit deletes loan evidence | **Reproduced.** Batch committed then threw: loan and movement stand, photo deleted. |
| R6 | Overlapping live refreshes apply out of order | **Confirmed by reading** `live()` in `src/ui.ts`: `refresh` is `tick` itself, visibility resume calls `tick`, nothing tracks a request in flight, and the ETag is whichever response finished last. A controlled-order test comes with the repair. |
| R7 | Stock activity scales with the whole ledger | **Confirmed by reading** `recentActivity` in `src/stock.ts`: a window `SUM` over every movement, then `LIMIT 100`. The baseline is measured in the slice. |
| R8 | Activity performance harness fails on the audit protection | **Reproduced.** `ACTIVITY_PERF=1 ACTIVITY_PERF_TIERS=1000` fails with `audit_log is append-only`. Introduced by `0022` (this session's migration), because ordinary runs skip the harness. |
| R9 | Deployment can bypass checks | **Confirmed.** `main` reports `"protected": false` and has no rulesets. The deploy path is ambiguous: `docs/DEPLOYMENT.md` names the Owner Console's "Deploy verified main" as the one path, while `.github/workflows/ci.yml` and `.codex/CURRENT.md` say Workers Builds deploys every push to `main`. Its settings live in Cloudflare and are not visible from the repository. |

## What changes (one slice each, in this order; each verified before the next)

**H1 — R1, last active Owner (migration `0023_last_active_owner.sql`).** Database triggers, like 0017's stock guards: an `UPDATE OF role, active` on `staff_accounts` that turns an active Owner into a non-Owner or inactive is aborted (`RAISE(ABORT, 'last_active_owner')`) when no active Owner would remain; a `DELETE` of the last active Owner is aborted the same way. D1 runs each batch as one transaction and serializes writers, so the second of two racing batches sees the first's commit and is rolled back whole: no session revocation, no recovery-key revocation, no audit. The Worker maps the abort to a 409 with the existing message. Creating accounts and bootstrapping the first Owner are untouched (the triggers fire only when an active Owner is removed). The read-before-write count stays only as an early friendly message.

**H2 — R2, single-use recovery (no migration).** The success audit becomes the consumption record: the batch's first statement inserts `OWNER_RECOVERY_USED` with id `RECOVERY-<key id>` only `WHERE` the key is unrevoked and its account is still an Owner. Its details carry a random per-request token, and every later statement (password, re-enable, session revocation, key revocation) runs only `WHERE EXISTS` that exact audit row. A second request inserts nothing and changes nothing (the audit id is unique per key), and the Worker answers it with the usual 401. Rotation, revocation or demotion committed first leaves the key unconsumable. Secrets stay as now: never logged, never in evidence.

**H3 — R3 and R4 together, retention (no migration).**
- *Ownership:* an evidence object stays while any record that keeps it is inside its retention window. Erasing a record clears that record's reference, and deletes the object only when no other unerased record (`loans.photo_key`, `self_service_events.photo_key`) still references the same key.
- *Pinned work:* each run selects at most 50 records of each kind (ids and keys), deletes the objects that no other record keeps, then clears exactly those ids with a guard that they are still due and not yet erased. Counts come from the rows actually changed.
- *Failure order:* objects first, then D1. A failed object delete stops the run before D1 changes, and a retry deletes again (a no-op if already gone) and then clears. Two concurrent runs both act on the same pinned set: deletes are idempotent and the second clear changes 0 rows, so nothing is counted twice and no reference is cleared without its object being handled.
- *Preview:* the preview counts with the same rule: records due, and objects that would actually be deleted.
- The 365-day phone and 730-day-after-closure loan windows are unchanged.
- Existing dangling references or orphans in production are **not** touched. That needs a separate reconciliation procedure.

**H4 — R5, loan evidence on an uncertain commit (no migration).** On a batch error, `createLoan` asks D1 whether its loan id or request key exists, following `putItemPhoto`'s pattern:
- **Exists:** the photo is kept and the original loan is returned (a retry with the same key returns it too, with no second movement).
- **Definitely absent:** the photo is deleted.
- **D1 cannot answer:** the photo is kept and the error is raised. The object sits under `loans/<loan id>`, so a later orphan check (V1.14) can match it to D1 by name.

The same check is applied to the Self-Service borrow photo path (`failed()` in `src/self-service.ts`) if inspection shows the same flaw.

**H5 — R8, harness (tests only).** The disposable performance fixture drops `audit_log_no_delete` before clearing, as `tests/activity.test.ts` already does; `0022` is not changed. `tests/migration-sql.test.ts` keeps proving the production protection. CI gains a smoke run of the harness at tier 1000.

**H6 — R6, live refresh (`src/ui.ts` only).**
- One request is in flight at a time. A refresh requested meanwhile (after a mutation, or on resume) is remembered and runs as soon as the current one ends, so it is never lost.
- Each request carries a sequence number. A response older than the last accepted one is dropped, and the ETag is taken only from an accepted response.
- `stop()` aborts the request in flight (`AbortController`), and nothing is applied after it.
- Each request times out (15 s) and counts as offline; a 401 still stops polling.
- Tests use controlled response ordering in the supported browser suite.

**H7 — R7, Stock activity (query only).**
- Pick the latest 100 non-imported movements first (the existing `idx_inventory_movements_created` order). Compute `afterQuantity` for those rows from each touched item's own ledger with the same `HISTORY_ORDER`, so imported history, backdated and same-time rows and non-POSTED statuses give the same numbers.
- Equivalence is proven by exact comparison of old and new results on identical fixtures at about 1k, 20k and 100k movements, including those edge cases. Query plans are recorded. An index is added only if a plan shows it is needed, and then it is covered by this amendment's migration rules.
- **Budget:** at 100k movements, the median of 7 local synthetic runs is at least 5× faster than the current query and under 30 ms. At 1k it is no slower than now (+10% noise). Results are identical at every tier.
- These are synthetic local SQLite timings, not D1 production latency. The remaining aggregate cost (the per-item history of touched items) is documented. No cache or materialized quantity.

**H8 — R9, release gating (design here, enforcement is an owner action).**
- **Proposed path:** Workers Builds no longer deploys `main` directly. A `deploy.yml` workflow runs only on `workflow_run` of CI completing with success on `main`. It checks out that exact `head_sha`, builds it, and deploys with `wrangler deploy` from the GitHub `production` environment (the one the lane already uses; a required reviewer can be added there).
- **Promotes:** only a SHA whose CI passed. A failing or cancelled CI run never reaches the job.
- **Migrations:** stay out of deploys. Production migrations remain only in `production-ops.yml`, and a deploy refuses to run while a migration in the tree is not applied in production (a read-only `d1 migrations list`).
- **Rollback:** `wrangler rollback <version>` from the same environment via a manual `workflow_dispatch` with a typed confirmation.
- **Emergency override:** a manual dispatch that names a SHA and a reason, recorded in the run.
- **Safe validation:** run the workflow against a throwaway non-production Worker name with a deliberately failing check and a passing one, before it ever targets `logistics-hub`.

Enforcement needs your actions outside the repository: turn off Workers Builds' automatic production deploys (or point them at a branch nothing pushes to), add the deploy token to the `production` environment, and optionally protect `main` so that only checks-passing commits merge. Until then R9 is reported as **pending owner configuration**, not fixed.

## What does not change

Append-only movements and audit, movement-derived stock, idempotency keys, roles and their powers, the retention windows, migration evidence, offline Self-Service, the Vite/TypeScript/Worker/D1/R2 architecture, and every historical migration. No production data is deleted, migrated or reconciled by this work; no deploy or cloud setting is changed by an agent.

## Migration implications

`0023_last_active_owner.sql` (triggers only; additive). Like `0022`, it reaches production only through the Cloud Operations lane: the next release manifest that runs the lane pins `0022` and `0023`. Code that relies on the trigger must still behave correctly before it is applied: the existing count check keeps the friendly message, and the trigger makes it race-proof once applied.

## Acceptance criteria

As in Earl's prompt, per finding. In short:
- **R1:** deterministic concurrent disable, demotion and mixed tests leave at least one active Owner; the loser gets a clear 409 and leaves no audit or partial change.
- **R2:** exactly one recovery wins and only its password works; the loser changes nothing; also tested racing rotation, revocation and demotion.
- **R3/R4:** OUT, recently closed, fully eligible, shared-key and missing-object cases. Concurrent runs, object-delete failure, D1 failure and retry end with no skipped record, double count, untracked object or early deletion. Preview counts match execution.
- **R5:** rollback cleans up; a lost response keeps referenced evidence; a retry returns the original loan with no second movement; an unresolved error stays recoverable.
- **R6:** reversed responses never regress the view; a post-mutation refresh is eventually shown; no competing loops; nothing after stop; timeout and 401 handled.
- **R7:** the budget above with identical results at 1k, 20k and 100k.
- **R8:** an enabled run measures tiers 1000 and 20000; production protection still tested.
- **R9:** validated on a throwaway Worker that a failing check cannot promote and a passing one can. Otherwise pending.

Each repaired defect gets a regression test that fails before and passes after.

## Verification (each slice, then all)

Targeted tests first. Then `npm run build`, `npm test`, `npm run test:browser`, `npm run test:browser:worker`, `npm run verify:privacy`, `npm run verify:migration` and `npm run verify:catalog`, and the explicit harness `ACTIVITY_PERF=1 ACTIVITY_PERF_TIERS=1000,20000 ACTIVITY_PERF_OUT=/tmp/lh-activity-perf.md ./node_modules/.bin/vitest run tests/activity-perf.test.ts`. Then CI green on the pushed commit. Each step's exit status is checked; an unrun check is reported as unrun.

## Rollback

Each slice is its own commit on `main` and reverts cleanly (`git revert`). `0023` is undone by a later migration that drops its triggers, never by editing it. H8 adds files only; enforcement is undone by re-enabling Workers Builds.

## Exclusions

Reconciling existing damaged evidence or orphaned objects in production; applying `0022`/`0023` to production; any deploy or Cloudflare/GitHub setting change by an agent; changes to retention windows, roles or stock rules; dependency upgrades.

## Decision

Earl accepted all of H1–H8 on 2026-10-03. Slices run in order H1, H2, H3, H4, H5, H6, H7, H8, each verified and pushed on its own.
