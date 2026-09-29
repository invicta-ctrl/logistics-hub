# Session Handoff — Shared Codex / Claude Worktree

STATUS: PART_04_LOCAL_GREEN; production release pending
ACTIVE_WRITER: codex (stale Claude lock yielded and claimed after Earl confirmed takeover)
WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
BRANCH: slice/part-04-lending (pushed at each checkpoint)
LIVE_PREVIEW: http://127.0.0.1:8791 (`npm run dev:live` restarted; local 0014 applied)

## Part 4 (Claude, 2026-09-29) — see `.codex/PART_04_BRIEF.md`
- **Done and verified on the slice:**
  - migration 0014 (Saleable → Consumable, audited; the `loans` table);
  - `src/loans.ts` (lend with R2 photo, return / damaged / lost, dashboard statistics, photo stream) and routes in `src/worker.ts`;
  - the quantity editor (`src/movement-form.ts`) in the item sheet and Stock & Pantry, with a required reason and an `expectedOnHand` guard;
  - the Loan tab and shared loan form (`src/loan-form.ts`), the `/staff/loans` dashboard (`src/loans-workspace.ts`), simplified Edit details, the Lending Hub without loan terms.
- **Gates at checkpoint 45bf880:** typecheck, build, `npm test` 60/60 (8 new Part 4 tests), `npm run test:browser` 7/7, `npm run test:browser:worker` 15/15 (a new real Worker + D1 lending flow), privacy scan; no horizontal overflow at 320 / 375 / 768 / 1024–1440.
- **Review completed (Luna Max read-only):** accepted and fixed four major findings: stale physical counts, missing API reasons, saved-loan refresh failure messaging, and authenticated photo caching. Corrected two stale quantity/DTO statements. Minor dashboard query/schema-hardening ideas were not added because they do not block accepted Part 4 behavior and would broaden the slice.
- **Final local gates (2026-09-29):** typecheck; 61/61 unit; 8/8 browser; 15/15 real Worker + D1; build; privacy, migration and catalog checks; Wrangler dry run. Hallmark visual review found 0 critical/0 major across the named routes and item sheet; Impeccable detector returned `[]`; no observed accessibility regression. Public and staff screens fit 320/375/768/1440 without document horizontal overflow. Local 0014 applied.

## Production mutation checkpoint (2026-09-29)
- Local and GitHub slice equal `d581208facdb465e2cd673bed0133f1a3ca9caf6` before provider changes; worktree clean then.
- Remote `main` remained `4f6cf4b282ceb86dad6847bf9ea4a0b5a94a541f`; production `loans`, `loan_items`, `evidence` each had 0 rows; main source had no references to those tables; only 0014 was pending.
- D1 Time Travel bookmark captured in ignored `.wrangler/part4-pre-migration-bookmark.json`. Preserve it for recovery; do not commit or print its value.
- Created R2 bucket `logistics-hub-evidence`, verified listed, no custom domains, and r2.dev disabled. Never touch the old hau-usc-logistics production/staging resources.
- Applied remote 0014 exactly once. Wrangler reported success; subsequent list showed no pending migration. Post-migration D1 read-only checks: Saleable 0, Consumable 152, reclassification audits 112, loans 0, only the new loans table remains from the old loan placeholders. Do not reapply 0014.
- A pre-merge live smoke of the still-deployed Part 3 Worker found that Cloudflare compression weakens the catalog ETag (`W/"r4"`) and the Worker only accepted the strong form, so the production ETag/304 check failed. Fixed on the slice. Re-ran typecheck, build, 61/61 unit, 8/8 browser, 15/15 real Worker + D1, privacy/migration/catalog, and Wrangler dry run. Restarted `npm run dev:live` at 8791 and verified both strong and weak validators return 304 locally. Re-run the production smoke after the new commit deploys.

## Exact next action
1. Commit/push the weak-ETag fix to the slice, confirm local/remote SHA equality, fetch/prune, and verify/reconcile main.
2. Fast-forward/push main, verify deployed SHA and production behavior without real borrower PII.
3. Only after production passes, mark Part 4 complete, commit closeout, delete contained local/remote slice, prune, leave clean main and yield the lock. Do not start Part 5.

## Known facts and limitations
- No item has a reorder level yet, so Low stock is empty until staff set levels.
- Some legacy classifications look wrong (for example "Sanitary Napkin/Pads" is Loanable); they remain for staff review.
- The legacy *category* "PANTRY" holds 16 office supplies; Pantry uses the stock area instead.
- The prior 8791 asset watcher stopped after rebuilds (Windows EPERM); Codex restarted `npm run dev:live` and verified the actual Worker at 8791. The ignored E2E cleanup directory can remain locked by Windows after a passing run; do not treat cleanup EPERM as a test failure.
