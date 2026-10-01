# Part 5 Cloud Handoff — Logistics Hub (WIP branch, not for merge)

INTENT: let Claude Cloud or any cloud agent continue Part 5 from a portable GitHub branch.
OBJECTIVE: finish Part 5 core (Activity + safe exports) from Stage 5.1 (code complete, not accepted) through 5.2 UI, 5.3 CSV and 5.4 polish, then Part 5B only after Part 5 core is merged.
TARGET: repository `invicta-ctrl/logistics-hub`; WIP branch `handoff/part-05-activity-cloud` (pushed by Harbor from the local `slice/part-05-activity` with an explicit refspec; the cloud agent works directly on this branch and treats it as the one active slice).
AUTHORITY: Earl, 2026-10-01: "Upload all of this work into a separate github branch and provide instructions/proper handoff for claude cloud or any cloud agents to continue the tasks." This overrides the no-partial-publication rule ONLY for this WIP branch. Standing release rule (accepted plan, owner decisions): each COMPLETED and verified Part goes to a GitHub PR, then `main`, and only after it is shown working. Minimum authority a cloud agent must read first: `AGENTS.md`, `CLAUDE.md`, `.agents/PROJECT_POLICY.md`, `.codex/CURRENT.md`, `.codex/CURRENT_TASK.md`, `.codex/SESSION_HANDOFF.md`, `docs/SHARED_AGENT_WORKFLOW.md`, the accepted plan `docs/specs/accepted/2026-09-30-part-05-activity-accountability-plan.md` and the owner master prompt `docs/specs/accepted/2026-10-01-part-05-owner-master-prompt.md`. `AGENTS.md` and `CLAUDE.md` name a host-only absolute worktree path and `npm run agent:claim`; for this explicitly owner-requested cloud continuation the cloud checkout of this branch replaces that path assumption, and nothing else is relaxed: one writer, Sentinel review of meaningful changes, the gates and the production rules all stand.
SCOPE: continue Part 5 per the plan section 5. Read in this order: the minimum-authority list above, this file, then `docs/ACTIVITY_PERF.md`.
EXCLUSIONS: no merge to `main`, no push to `main`, no deploy, no production or provider write, no production migration, never reapply `0015`, no axe devDependency and no other new dependency without an accepted amendment (the plan's acceptance record settles that no axe dependency is added; keep and extend the existing accessibility checks), no second long-lived branch.
CONSTRAINTS: public repo, so no PII, credentials, provider IDs, private exports or raw logs in commits. One writer at a time (see "Writer rule"). Smallest durable change; delete replaced code.
STOP CONDITIONS: dirty or unknown state, a drifted branch, a refused command or tool, a secret in output, a failing gate. Preserve evidence and report; do not retry a refused command by another route.

## Status update (Claude Cloud, 2026-10-01): Part 5 core is code complete

- Stages 5.1–5.4 are done on this branch and every local gate is green (see `.codex/SESSION_HANDOFF.md`, top section, and `.codex/CURRENT.md`). A pull request from this branch to `main` is open for Sentinel and Earl; nothing was merged, pushed to `main` or deployed.
- The production-counts blocker below is closed: the two approved read-only `SELECT`s ran once each (items 549, inventory_movements 686, audit_log 658, loans 12, self_service_events 21; no 0016 index). Recorded in `docs/ACTIVITY_PERF.md`.
- Still owed: Sentinel's verification of the exact PR head; Earl's merge; the post-deploy checks in `docs/DEPLOYMENT.md`; branch cleanup; then Part 5B. Linux / Node 22.22.0 was used here (`node:sqlite` works with an experimental warning); the browser suites ran with `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` because the image's Chromium predates Playwright 1.63's.
- The sections below describe the branch as it was handed over (Stage 5.1 only) and are kept as the record of that handoff.

## Where things stood at handoff (verified 2026-10-01)

- Base: `main` = `origin/main` = `76f43b126f2a3ae8203baeba5c5a46d8a04ecf74` (verified locally and by a read-only `git ls-remote`). The WIP branch is built on that baseline.
- Commits on top of `main` (oldest first): `bf63206` accept Part 5 + A12; `1cc389c` acceptance fixes, owner prompt source; `4c0b437` Stage 5.1 read model and API; `181a4d2` privacy repair (superseded); `eb47f62` owner decisions A, B(ii), AC-A7 recorded; `8bb774c` typed reasons/notes as written; `3204cba` unknown loan closings kept, reproducible AC-A7 harness; `a0ef769` owner standing approval and release sequence; `50818da` browser results recorded. Those are the nine predecessor Part 5 commits through `50818da`; the handoff documentation commits follow, and the pushed HEAD is the latest of them (confirm with `git log`; no SHA or count here can name itself).
- Source and tests are unchanged since `3204cba` (later commits are documentation only).
- **Stage 5.1 is NOT accepted.** Code, regression and the perf harness passed Sentinel at `3204cba`. Missing: production-scale evidence (see "Open blocker") and Sentinel's final gate result on the exact candidate. Stage 5.2 has not started. No UI, no CSV.
- Migration `0016_activity_feed_index.sql` (five index-only statements) is applied to the disposable in-memory test databases only. Its production state is UNKNOWN. The API is correct without it, only slower. Code on `main` must not depend on an unapplied migration (a push to `main` deploys; Workers Builds does not apply D1 migrations).

## Owner decisions in force (exact effect)

- **A:** staff Activity shows typed reasons and notes exactly as written, like Loans and Self-Service. The structured `borrower_name`, `student_id` and `person_name` columns are never selected and never searchable. The old `safe()` heuristic is gone; do not reintroduce it.
- **Damaged/lost note:** the audit arm LEFT JOINs `loans` one-to-one on a `json_valid`/`json_extract($.loanId)` guard and shows `loans.return_note`. Do not duplicate audit rows.
- **Unknown closings:** only a confirmed good return is suppressed, via the NULL-safe `COALESCE(outcome,'') = 'RETURNED'`; malformed, missing, null or unknown outcomes stay visible once. (Regression test in `tests/activity.test.ts`.)
- **B(ii) for Stage 5.3 (not implemented):** in any CSV export the Loan and Phone/Self-Service free-text reason and note fields are BLANK; the authenticated Activity UI keeps them. Exports also need the injection guard, caps, audit entries and role rules from plan section 2.5.
- **AC-A7 (revised):** responsive on current production-scale data, no avoidable per-page full-table scan, measured after the final SQL shape, an index only where justified, re-measure after any material query change. No fixed millisecond gates.
- **Release (2026-10-01 standing approval):** completed Part, GitHub PR, then `main`; each Part must be shown working before `main` is updated. A WIP branch is not ready to merge.

## Evidence already gathered (reuse; do not rerun without cause)

Source `3204cba` (docs-only changes after it). Windows 11, Node 26.3.0.
- `npm run typecheck`, `npm run build`, `npm test` 119 tests (19 in `tests/activity.test.ts`), `verify:privacy` 0 matches, `verify:catalog`, local `wrangler deploy --dry-run`: passed.
- `verify:migration`: `ok` with the one pre-existing `balanceMismatches: 1` (legacy ISSUE movement, ITM-0001); unchanged by Part 5.
- `npm run test:browser` 10/10 and `npm run test:browser:worker` 20/20 on `a0ef769`.
- AC-A7: `docs/ACTIVITY_PERF.md` has the commands, fixture construction, tiers (1,070 / 21,400 / 107,000 movements) with and without 0016, full `EXPLAIN QUERY PLAN` per statement, SQL and plan ids (a rerun reproduced them; timings vary). Limits: local `node:sqlite`, not D1 latency; the EXPLAIN pass adds overhead; synthetic data; production row counts are not recorded.
- Reproduce the perf run (about 25 s per run, no network): `ACTIVITY_PERF=1 ACTIVITY_PERF_OUT=perf.md npx --no-install vitest run tests/activity-perf.test.ts` and the same with `ACTIVITY_PERF_NO_0016=1`. It is skipped in `npm test` unless `ACTIVITY_PERF=1`.

## Open blocker at handoff: production-scale counts and index names (CLOSED 2026-10-01, see the status update)

The approved read-only production check could not be run from the local host: its tool permissions blocked the commands before Cloudflare was reached (a broader command allowlist was proposed, NOT approved and NOT performed). Counts and index presence are therefore unknown; nothing here claims them. Do not retry a refused command by another route or relax a control.

A cloud agent should first check what its own supported tools and permissions allow (the host's tools, sign-in and secrets are not inherited). If it can authenticate to Cloudflare through a supported secure sign-in (never paste secrets in chat or commits), the existing owner authorization (Earl's 2026-10-01 approval, recorded in the plan's owner decisions) covers exactly these two read-only commands, run as written (`--no-install` uses only the committed Wrangler, `--config wrangler.jsonc` fixes the target; do not substitute implicit discovery or a package install) against production D1 `logistics-hub` (binding `DB`, configured in `wrangler.jsonc`), and nothing else, and only if the agent's own tool permissions allow them:

```
npx --no-install wrangler d1 execute DB --config wrangler.jsonc --remote --json --command "SELECT (SELECT count(*) FROM items) AS items, (SELECT count(*) FROM inventory_movements) AS inventory_movements, (SELECT count(*) FROM audit_log) AS audit_log, (SELECT count(*) FROM loans) AS loans, (SELECT count(*) FROM self_service_events) AS self_service_events"
npx --no-install wrangler d1 execute DB --config wrangler.jsonc --remote --json --command "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_activity_movements','idx_activity_audit','idx_activity_audit_item','idx_activity_phone','idx_activity_resolved') ORDER BY name"
```

Aggregate counts and index names only: no raw rows, no provider IDs or account details in anything recorded. Record the five counts and the index names (none expected until 0016 is applied) in `docs/ACTIVITY_PERF.md` ("What current production scale is") and the handoff. Applying 0016 is NOT authorized by this handoff; it needs its own explicit owner approval, the Time Travel bookmark and the list-then-apply-once procedure in `docs/DEPLOYMENT.md`. If the agent cannot run the check, say so and leave the counts UNKNOWN for Earl or Harbor.

## Cloud environment (actual commands; Windows-verified only)

All checks above ran on Windows 11 with Node 26.3.0. Linux/cloud runs have NOT been performed, and whether `wrangler types` needs a login in a clean environment is unverified. Tests use `node:sqlite` (`tests/d1-sqlite.ts`), so the Node version must provide it. Use Node 26.3.0, the only version verified; any other version is unverified, and none is assumed compatible.

```
git fetch origin handoff/part-05-activity-cloud
git switch handoff/part-05-activity-cloud     # or: git clone -b handoff/part-05-activity-cloud https://github.com/invicta-ctrl/logistics-hub.git
npm ci                                         # package-lock.json is committed; allowScripts in package.json whitelists esbuild and workerd
npm run typecheck                              # runs `wrangler types` (writes the gitignored worker-configuration.d.ts) and tsc x3
npm test                                       # vitest, no network, no browser
npm run build
npx --no-install playwright install chromium   # needed once for the browser suites; add --with-deps on a bare Linux image
npm run test:browser                           # Playwright against `npm run dev` on 127.0.0.1:4173
npm run test:browser:worker                    # builds, wrangler dev --local, throwaway .wrangler/e2e-<pid> state, random credentials
npm run verify:privacy && npm run verify:migration && npm run verify:catalog
npx --no-install wrangler deploy --config wrangler.jsonc --dry-run   # no upload; whether it needs a Cloudflare login in a clean cloud environment is unverified
```

Limitations: the private-roster part of `verify:privacy` reads the gitignored `data/private/` and so skips itself in a fresh clone (only the tracked-content and path checks run). `.dev.vars`, `.wrangler/` (including the EPERM-locked `e2e-7576` test state), `dist/`, `.agent-state/` and `test-results/` are gitignored and are not in the branch. Production sign-in, `wrangler dev` workerd on Linux and the Playwright system libraries are untested here. `npm run agent:*` is a file lock under the gitignored `.agent-state/`, so it does not coordinate across machines: the local writer stays yielded while a cloud agent writes, and the single-writer rule is kept by the baton, not by the lock.

## Writer rule

One writer at a time across local and cloud. While the cloud agent writes this branch, the local worktree must not (Nexus assigns the baton). Local `slice/part-05-activity` equals this branch at the pushed HEAD until someone writes. The cloud agent commits and pushes each green checkpoint to `handoff/part-05-activity-cloud` and updates `.codex/CURRENT.md`, `CURRENT_TASK.md` and `SESSION_HANDOFF.md` truthfully (including line endings: `.codex/*` and `docs/ACTIVITY_PERF.md` use CRLF, the accepted plan and the owner prompt use LF). Never push `main`. Never force-push or rewrite this branch.

## Next actions, in order

1. Rehydrate: fetch, confirm the branch HEAD, read the files listed under SCOPE, run `npm ci`, `npm test`, `npm run verify:privacy`.
2. Close Stage 5.1: obtain the production counts and index names if a supported path exists (above), record them, then Sentinel's final gate on the exact candidate commit. Record a checkpoint.
3. Stage 5.2: `/staff/activity` page (filters in the URL, live status, links to items and loans, mobile at 390 and 1366 px) on the existing components, consuming `GET /api/staff/activity` (`src/activity.ts`: `parseActivityQuery`, `activityPage`). Gates per plan section 5 plus screenshots.
4. Stage 5.3: safe CSV on `activityPage` (newest first, no cursor): rule B(ii), injection guard, caps, audited exports, role rules.
5. Stage 5.4: polish, accessibility, empty and error states, docs, all gates.
6. When Part 5 core is complete and shown working: GitHub PR to `main`, merge only on the owner's rule, then production verification (a required new migration, if any, applied first under its own authorization). Only then start Part 5B OU-1 to OU-5 on `slice/part-05b-open-units`.

## Key files

`src/activity.ts` (read model), `src/worker.ts` (route `/api/staff/activity`), `src/self-service.ts` and `src/inventory.ts` (shared `OPEN_REVIEW` and balance CTEs), `migrations/0016_activity_feed_index.sql`, `tests/activity.test.ts`, `tests/activity-perf.test.ts`, `tests/d1-sqlite.ts` (D1 stand-in applying every migration), `tests/browser/` and `tests/worker-browser/` (suites), `docs/ACTIVITY_PERF.md`, `docs/DEPLOYMENT.md`.
