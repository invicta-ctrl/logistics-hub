## What and why

<!-- One or two sentences. Link the accepted spec / task ID. -->

- Accepted scope and exclusions:
- Task ID / spec: 
- Draft design references (no code authority), e.g. Issue #88:

## Identity

- Base SHA: 
- Final head SHA (update after every substantive push): 
- Writer slot / session / worktree / lock (`.codex/CURRENT.md`, "Writer slots"): 
- Files outside the task's owned paths touched: none / list and the steward's transfer

## Risk and security receipt

Tier (`AGENTS.md`): LOW / STANDARD / HIGH. Highest applicable tier wins.

- Trust boundaries inspected (mark N/A with a reason): credentials and PII in code, responses, logs; authorization and object ownership; session, CSRF, CORS, input validation; dependencies and CI supply chain; transaction, audit and failure recovery.
- Unresolved findings, owner-accepted exceptions:
- Independent review of the exact final diff (required for HIGH): reviewer, date, link, or `PENDING` with the saved packet:

## Gates

Mark each **PASS**, **FAIL**, **N/A** or **NOT RUN**, with a reason and a link or command for the exact head. An unrun gate is never described as passed. Canonical lists, not copied here: `AGENTS.md` (security review), `docs/WEB_QUALITY_RELEASE_GATES.md`, `docs/PERFORMANCE_RELIABILITY_DOCTRINE.md`.

| Gate | Status | Reason / link |
|---|---|---|
| `npm ci`, `npm run typecheck`, `npm run build` | | |
| `npm test` (failures triaged, not waived) | | |
| `npm run verify:privacy` (and `verify:migration`, `verify:catalog`, `verify:restore` where data is touched) | | |
| Focused regression test for the change (fails without it) | | |
| Negative and abuse tests (permission denial, duplicate and concurrent mutation, ownership) | | |
| `npm run test:browser` and `npm run test:browser:worker` | | |
| CI (`checks`, `worker-e2e`) and CodeQL (workflow **and** the combined check) | | |
| Changed routes at 320 / 390 / 768 / 1280 px, 200% zoom, keyboard and focus, touch targets, light and dark, reduced motion, popovers and overlays, empty / loading / error / offline, rapid repeated presses | | |
| Performance: before and after on repeatable fixtures (1x, 10x, 100x as applicable), median and p95, against the doctrine's thresholds | | |
| Migration: fresh and upgrade, backup, rollback (only if a migration is included) | | |
| Fresh-clone drill (policy or handoff changes): the questions, the answers, the result | | |

## Release and documentation

- [ ] `.codex/CURRENT.md` / `.codex/SESSION_HANDOFF.md` reconciled (steward) and stale records archived to `docs/archive/`, not deleted
- [ ] `CHANGELOG.md` entry (product: under the verified version; spec change: dated, no version)
- [ ] Release state stated truthfully: `QUALIFICATION_PENDING` / `MERGED_DEPLOYMENT_UNVERIFIED` / `DEPLOYED_OWNER_CHECK_PENDING` / `RELEASED_VERIFIED`
- Deployment, migration and rollback evidence, if any:

## Merge

Merging needs Earl's explicit go-ahead for this PR. Preparing or updating it is not that go-ahead.
