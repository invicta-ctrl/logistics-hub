# Session Handoff — Logistics Hub

Rewritten 2026-11-05 by the integration steward in PR #89. Everything this file held before (handoffs from V1.16.7 and earlier, the Codex-era takeovers and the historical executable continuations) is kept unchanged at [docs/archive/continuity/SESSION_HANDOFF_before_2026-11-05.md](../docs/archive/continuity/SESSION_HANDOFF_before_2026-11-05.md). The task board, the writer slots and the release states are in [CURRENT.md](CURRENT.md); this file is the last step, the next step and what a new session needs to resume without any chat history.

## Last step (2026-11-05, HAU-PR89-W1, writer slot 2)

PR #89 (<https://github.com/invicta-ctrl/logistics-hub/pull/89>), branch `slice/v1.16.13-photo-menu-race`, based on `main` `1e9a468`. Not merged. The head SHA is on the PR; this file cannot name its own commit.

**What the PR holds**
- The fix, unchanged since `491c6cd` apart from one comment: `tests/worker-browser/worker-live.spec.ts` (the photo-menu helper reads `:popover-open`; the retry is gone) and `src/styles.css` (a closing popover menu gets `pointer-events: none`). Root cause: a closed `.menu` stays drawn while it fades (`display … allow-discrete`), so the old test took "visible" for "open". **Correction to the PR's first description:** it said a fading menu could take presses. Measured 2026-11-05 with `elementFromPoint` and a real press, with and without the CSS change, on desktop width and a 390 px phone: the point under the fading "Remove photo" resolved to the form or the photo beneath in both cases, and no confirm opened. Chromium already skips a closing popover when hit-testing, so the CSS line is defense in depth for other engines, not a fix for an observed failure. The test-only change is the real fix; Earl may prefer to drop the CSS line.
- Governance, steward-written: [HAU-AGENT-LANES-003](../docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md) (002 kept as history and marked superseded in part); `AGENTS.md`, `CLAUDE.md`, `.agents/PROJECT_POLICY.md` and `docs/SHARED_AGENT_WORKFLOW.md` reconciled to it; `docs/archive/` with an index and exact copies of the three superseded documents; new `CURRENT.md` and this file; `docs/DOCUMENTATION_STATUS.md`, `README.md` (Owner Console options and the deploy description corrected), `CHANGELOG.md` (a dated specification entry, not a version); `.github/pull_request_template.md`.
- Issue #88 is linked as a **DRAFT design reference only**. No UI changed.

**README facts verified in `scripts/admin.mjs` (2026-11-05)**
- Option **8** is "Forgot owner password"; the old README said to choose 8 to deploy.
- Option **13** is "Deploy verified main", the legacy direct-Wrangler route.
- The site switch is **S**, not E.

**Deploy qualification failure** (`Deploy` run 41891241652): diagnosed as the documented fail-closed behavior for a merge-button commit; see CURRENT.md. Nothing was changed in CI, the deploy workflow or the gate.

**Triage of the four failures in the full Windows `npm test` run** (the same four pass on Linux CI)
- `tests/role-evaluation.test.ts` "refuses altered or symlinked photo manifests": `EPERM` creating a symlink. Windows needs Developer Mode or an elevated shell for symlinks. Environment, not code; CI covers it.
- `tests/production-release.test.ts`, three tests: each spawns many child processes and takes 7 to 10 s on this PC against vitest's 5 s limit. Run alone they still time out; with `--testTimeout=60000` all 46 pass. Timing on Windows, not a defect.

## Pending / not done

- **Independent review by ChatGPT of the exact final diff: PENDING.** The review packet is saved in the PR (comment titled "Independent review packet") and in the session notes folder. ChatGPT was not reachable from this session. A pending review is not a passed one.
- **Merge: needs Earl's explicit go-ahead.** Preparing the PR is not one.
- **Outside this task's allowed paths, so left for the steward or a follow-up amendment**
  - `docs/road-to-v2/releases/v1.16.12.md` still reads `INTEGRATION: pending`; PR #87 merged as `1e9a468`. CURRENT.md states the later fact.
  - `docs/DEPLOYMENT.md` still describes console option 13 as the first deploy route; the README now warns.
  - `scripts/admin.mjs` option 13 still deploys from a PC and applies migrations, against the Cloud Operations rule: needs an accepted amendment to disable or remove it.
  - A clearer `deploy-gate.mjs` message for a missing combined CodeQL check: needs an accepted deploy/CI amendment.
- V1.16.12 production state: **UNVERIFIED** (MERGED_DEPLOYMENT_UNVERIFIED). Nobody has compared the live assets with a build of `1e9a468` since the merge.

## Next exact action

1. ChatGPT: independent review of the final PR #89 diff, using the saved packet. Record the result on the PR.
2. Earl: decide on merging PR #89. After a merge: verify `main`; check the live assets against a build of the merged commit; repeat the fresh-clone drill on a clean `main` checkout and record its SHA.
3. Steward: open the follow-up for the four items above, and the Issue #88 UI specification when Earl wants it.

## Resume without chat history

1. `git fetch origin`; `git worktree list`; `git status`. Read `AGENTS.md`, then `CURRENT.md`, then this file.
2. The PR's worktree is `D:\Documents\HAU-USC Logistics Hub\worktrees\photo-menu-race` (a clone of the branch works too). Install with `npm ci` (Node 22 as in CI).
3. Checks: `npm run typecheck`, `npm test`, `npm run verify:privacy`, `npm run build`, `npm run test:browser`, `npm run test:browser:worker`. The worker runner needs `node_modules/wrangler` and uses its own `.wrangler/e2e-<pid>` state and a random port; on Windows it can leave the `.wrangler/e2e-*` folder behind (`EPERM` on cleanup), which is Git-ignored.
4. The scratch evidence of this session is in the PR body and the review-packet comment; nothing else needs recovering.
