# Current Bounded Task — V1.15 V2 consolidation (Claude Cloud, sole integrator)
INTENT: finish V1.15 under its spec, the 2026-10-07 amendments and the 2026-10-08 Ambient AI Assist amendment, then write the release records.
BRANCH: `road-to-v2/v1.15-v2-consolidation`; derive the head with `git rev-parse HEAD`.
AUTHORITY: `docs/specs/accepted/road-to-v2/v1.15-v2-consolidation.md` and its accepted amendments; Earl's 2026-10-07 continuation prompt.
EXCLUDED: merge or push to `main`, production D1/R2 writes, provider configuration beyond the reviewed `AI` binding, reopening Self-Service, anything sent to AI other than intentional catalog photos.
STATUS: IN PROGRESS. Ambient AI Assist is pushed; see `.codex/SESSION_HANDOFF.md` (top) for the full handoff block.
NEXT ACTION: merge `wip/v1.15-codex-windows` when it exists, then the remaining V1.15 acceptance work.

---

# Previous task — none active (Part 6 complete on main; awaiting Earl's acceptance)
INTENT: Part 6 is on main and its migrations are applied; wait for Earl's signed-in acceptance and decision D1.
OBJECTIVE: deliver the proposed Admin + Hardening plan (per-username login limit and session sweep, backup runbook, accessibility fixes, Self-Service setting, Owner-only retention) as one branch that another local or cloud writer can resume without chat history.
BRANCH: `slice/part-06-plan`, started at `c0c6e9963a9f846adf362a4ddeae683fc1eff375`; derive the current documentation checkpoint with `git rev-parse HEAD` rather than copying a self-referential SHA here.
AUTHORITY: Earl's `D:\Download\LOGISTICS_HUB_PART_6_CODEX_MASTER_PROMPT.md` (UTF-8 SHA-256 `f7c4f1ac5e11dcea2087f68bb03dfcb4a34a292cdf0f2f981794df311892d5ac`), the accepted reboot specification, the MausBot amendment, and the current repository state.
SCOPE: `src/` (accounts, worker, settings, retention, admin, loans, main, styles, activity labels), migrations `0018` and `0019`, tests (unit, mocked browser, real-Worker browser), `docs/DEPLOYMENT.md`, `docs/PRODUCT_REFERENCE.md`, `docs/OFFLINE_SELF_SERVICE.md`, the plan and `.codex/*`.
EXCLUDED: any production or provider operation (no migration applied, no deploy, no read of production data, `npm run admin -- verify` deliberately not run), merge to `main`, reopening Self-Service, reapplying 0015–0017, a new dependency.
STATUS: COMPLETE ON MAIN (2026-10-02, Claude Cloud). Part 6 is complete on main: 6.1 (per-username login limit, stale-session sweep), 6.2 (backup and restore runbook), 6.5a (focus, large-text and target-size fixes, accessibility spec), 6.3 (Self-Service open/closed setting in Administration, migration 0018) and 6.4 (Owner-only removal of old names, student IDs and photos, migration 0019). Earl applied 0018 and 0019 to production on 2026-10-02 before the merge (docs/DEPLOYMENT.md, Part 6). Decision D1 (reconcile the plan with Earl's controlling prompt, unreadable from the cloud) is still open. Gates on the merged tree: typecheck and build; `npm test` 158 passed + 1 skipped; `test:browser` 29/29; `test:browser:worker` 26/26; privacy 0; migration ok (known 1 mismatch); catalog; `wrangler deploy --dry-run`. Evidence: plan section 6.
NEXT ACTION: Earl's signed-in acceptance on production and D1; no implementation is pending.

---

# Previous task — PART-05 core (Activity + Accountability), stages 5.1–5.4 (released)
INTENT: finish Part 5 core and hand it to verification and release
OBJECTIVE: Activity read model and API (5.1), `/staff/activity` (5.2), safe CSV export (5.3), polish and regression (5.4); every local gate green; a PR to `main` for Sentinel and Earl.
SCOPE: `src/activity.ts`, `src/activity-workspace.ts`, the routes in `src/worker.ts`, shared labels in `src/catalog-policy.ts`, `live()` / `preservingFocus` in `src/ui.ts`, the nav link and item-history link in `src/staff.ts`, the compact app bar in `src/styles.css`, `tests/activity.test.ts`, `tests/activity-perf.test.ts`, `tests/worker-browser/worker-live.spec.ts`, index-only migration `0016` (not applied to production; optional), docs (`docs/ACTIVITY_PERF.md`, `docs/PRODUCT_REFERENCE.md`, `docs/DEPLOYMENT.md`, `.codex/*`).
EXCLUDED: Part 5B (Open-Unit Tracking), merge or push to `main`, deploy, any production write or migration (only the two approved read-only counts were run), new dependencies. Never reapply 0015.
STATUS: RELEASED 2026-10-01: `main` = 1a498a1 (PR #3 merged by fast-forward on Earl's instruction; Sentinel waived for this release), deployed by Workers Builds and verified signed-out on production; signed-in checks are owner acceptance items. Before release it was CODE COMPLETE on handoff/part-05-activity-cloud (Claude Cloud, 2026-10-01). Gates on the final head: typecheck; build; `npm test` 123 passed (1 skipped perf harness); `npm run test:browser` 11/11; `npm run test:browser:worker` 22/22; verify:privacy 0 matches; verify:migration ok (known 1 balance mismatch); verify:catalog; `wrangler deploy --dry-run`. Production counts recorded (items 549, movements 686, audit 658, loans 12, phone events 21; no 0016 index). PR to `main` opened; Sentinel verification and Earl's merge decision pending. Details: `.codex/SESSION_HANDOFF.md` (top section).
