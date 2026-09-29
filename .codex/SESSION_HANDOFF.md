# Session Handoff — Shared Codex / Claude Worktree

STATUS: PART_04_PRODUCTION_PARTIAL (unchanged; see Part 4 below) · PART_04_5_CODE_COMPLETE on `slice/part-04-5-offline-self-service-pwa` (local gates green; not merged, not deployed, remote 0015 not applied)
ACTIVE_WRITER: none after this handoff (Claude Cloud yielded 2026-09-29; Earl's local lock is not visible from Cloud)
WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub (Cloud works in its own clone and pushes the slice)
BRANCH: slice/part-04-5-offline-self-service-pwa (from main 41d00fe); main unchanged; slice/part-04-lending retained until Part 4 production acceptance
LIVE_PREVIEW: http://127.0.0.1:8791 (`npm run dev:live` follows the pushed slice)

## Part 4.5 (Claude Cloud, 2026-09-29) — see `.codex/PART_04_5_BRIEF.md`, `docs/OFFLINE_SELF_SERVICE.md`
- **Commits on the slice:** `11e8697` Worker ingestion and reconciliation · `ce92f31` QR · `0d2b4ac` offline app and staff view · `812331c` docs · `c1a0d8c` navigation, deadlines, offline states · `69d75f5` polish · `a95a6af` pointers · `73ab684` Dusk design and second-wave audit fixes · then this docs checkpoint.
- **Second-wave audits (security, performance/code, reconciliation, UX/accessibility):** every finding was verified before a change. Fixed with tests: unlinked returns always held (no name matching or oracle); a return whose borrow was refused is refused; staff resolutions are final (trigger in 0015) so concurrent apply/match/dismiss roll back whole; a match raced by a desk close records nothing; error-held borrows keep their photo and a photo-less borrow cannot be applied; duplicate/refused uploads are deleted from R2; limits by network (IPv6 /64), 60 held records per network a day, 2 MB phone photos, quantity cap 30; `USC_ONLY` reason; clock-held borrows keep their return-by date; a late take just before a count is caught by Count needed; Background Sync retries while records wait; staff chunks no longer precached (offline staff page instead). UX: visible focus on every button, one-shot aurora and blur only on bar/sheet, content-height sheets, large-text reflow, 44 px targets, visible form questions, focus to the first invalid field, low stock in words, staff poster/activity fit 390 px.
- **Accepted, documented, not changed:** the hourly volume hold is read before the write, so simultaneous requests can pass it (request limits bound it); a 413 cannot occur from this client (4 × 2 MB < 12 MB).
- **Gates at `73ab684`:** typecheck (3 projects); `npm test` 100/100; `npm run test:browser` 9/9; `npm run test:browser:worker` 19/19 (real Worker + D1: offline take/borrow/return across reload and wiped caches, offline staff page, lost-answer resend proves idempotency, two phones); build; migration (`ok: true`), catalog and privacy checks; `wrangler deploy --dry-run`; Impeccable detector clean on the changed UI files. Real local D1 reports the trigger as `self_service_event_resolved: SQLITE_CONSTRAINT`, which the Worker matches.
- **Local preview databases:** `0015` gained its trigger after it was first pushed. A local `.wrangler/state` that applied the earlier `0015` lacks it; see docs/DEPLOYMENT.md ("Migration 0015") to rebuild or add it. Production has not applied `0015`.
- **Exact next action:** (1) Earl finishes Part 4 production acceptance (below). (2) Apply remote `0015` exactly once and verify, including the trigger (docs/DEPLOYMENT.md). (3) Fast-forward `main` to this slice, push, verify the deploy and the phone flow, then delete both slice branches. Do not start Part 5.

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

## Main push checkpoint (2026-09-29)
- Fetched/pruned; local and GitHub slice both `64c037e54853ffbafb414c95042be53b01bd1ba2`; local and remote main both remained `4f6cf4b282ceb86dad6847bf9ea4a0b5a94a541f` before integration. Main was an ancestor and worktree clean.
- Fast-forwarded local main to the slice and pushed `main`; push reported `4f6cf4b..64c037e`. Exact deployment and production behavior are still unverified. Keep the slice branch until acceptance passes.

## Exact next action
1. From a browser with local-file upload enabled, run the remaining synthetic production acceptance: Individual and USC loans, optional return date/overdue, evidence upload and authenticated retrieval, unauthorized rejection, good/damaged/lost returns, inventory effects, borrower statistics and history.
2. Re-run the production smoke after any final executable change.
3. Only after those checks pass, mark Part 4 complete, commit/push closeout docs, prove slice contained, delete local/remote slice, prune, leave clean main and yield the lock. Do not start Part 5.

## Known facts and limitations
- No item has a reorder level yet, so Low stock is empty until staff set levels.
- Some legacy classifications look wrong (for example "Sanitary Napkin/Pads" is Loanable); they remain for staff review.
- The legacy *category* "PANTRY" holds 16 office supplies; Pantry uses the stock area instead.
- The prior 8791 asset watcher stopped after rebuilds (Windows EPERM); Codex restarted `npm run dev:live` and verified the actual Worker at 8791. The ignored E2E cleanup directory can remain locked by Windows after a passing run; do not treat cleanup EPERM as a test failure.
- Workers Builds build `64c037e54853ffbafb414c95042be53b01bd1ba2` succeeded and the live deployment list shows a new 100% deployment at 2026-09-29 15:32 UTC. Dashboard build details link the build to the exact GitHub commit. `npm run admin -- verify https://logistics.hausc.org` and the production weak-validator check pass.
- Production UI verified landing, Lending Hub, authenticated Inventory/Loans navigation, synthetic item creation/deactivation, required quantity reasons, exact edit 8→10, relative edit 10→9, movement history, and required-photo validation. A synthetic public item was deactivated after testing.
- Production evidence upload could not be exercised: Chrome's file chooser requires the ChatGPT extension's "Allow access to file URLs" setting, while the browser policy blocked opening `chrome://extensions`. Do not represent the photo or return flows as production-accepted until rerun.
