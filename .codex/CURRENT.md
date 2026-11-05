# Current Work Pointer — Logistics Hub

Rewritten 2026-11-05 by the integration steward in PR #89. The previous 336-line pointer (per-slice notes from 2026-10-15 to V1.16.12) is kept unchanged at [docs/archive/continuity/CURRENT_before_2026-11-05.md](../docs/archive/continuity/CURRENT_before_2026-11-05.md); the archive index is [docs/archive/README.md](../docs/archive/README.md). A file cannot name its own commit: the PR head is on the PR, and every dated fact below says where it was observed.

## Read first

`AGENTS.md` (rules, writers, repository self-sufficiency, security review) → this file → [SESSION_HANDOFF.md](SESSION_HANDOFF.md) → [docs/SHARED_AGENT_WORKFLOW.md](../docs/SHARED_AGENT_WORKFLOW.md). The writer rules are [HAU-AGENT-LANES-003](../docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md). Authority: Earl's current instruction → accepted specification → verified repository state → Context Vault. This file is not evidence that a check passed: each row says where its fact was observed.

## Writer slots (roster, observed 2026-11-05; re-check, do not assume)

Two-lane operation is **inactive in the repository** until HAU-AGENT-LANES-003 is merged and two task manifests exist. The coordinator recorded these holders for Earl's 2026-11-05 handoff; they are not verified from Git.

| Slot | Holder | Task | Repository / branch / worktree | State |
|---|---|---|---|---|
| 1 | "Kawing Studio & dual-scenario demo overhaul" Claude session | its own accepted task | `invicta-ctrl/qrmenu`, PR #1 | reported done (session idle) |
| 2 | this Claude session, steward of Logistics' shared governance files | **HAU-PR89-W1** | `invicta-ctrl/logistics-hub`, `slice/v1.16.13-photo-menu-race`, worktree `D:\Documents\HAU-USC Logistics Hub\worktrees\photo-menu-race` | active |
| (queued) | Kawing-Platform governance, "Writer B" | governance-only PR | `invicta-ctrl/Kawing-Platform` | waiting for a free slot and the technical department's approval; nothing started here |
| none | the coordinator session | read-only preflight, roster | no worktree | read-only. If it edits files it takes a slot |

Other Logistics checkouts exist and are **not** mine: the shared `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub` (branch `slice/v1.16-header-gridlines`, with modified `.codex` and release-record files and an untracked `NUL`), `workspace\logistics-hub-v1164*`, `repo\logistics-hub`, several detached Codex worktrees under `C:\Users\adria\.codex\worktrees` and detached MausBot worktrees. Preserve all of them; do not write there.

## Task board

| ID | Task | Spec | Base → branch | Slot | State | Next |
|---|---|---|---|---|---|---|
| HAU-PR89-W1 | PR #89: the photo-menu fix (done) plus the 003 policy, truthful continuity files, archive, PR template, README fix, deploy-gate diagnosis; then qualification | [HAU-AGENT-LANES-003](../docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md) (accepted by Earl, 2026-11-05) | `main` `1e9a468` → `slice/v1.16.13-photo-menu-race` | 2 | active; L0 and L1 written, L2 qualification in progress (see the PR body for the gate table) | finish L2; independent review; Earl's merge go-ahead |
| (draft) | Issue #88: compact maroon/gold mobile and desktop UI baseline | none accepted | — | none | **DRAFT, design reference only**; linked here and in PR #89 | write a bounded UI spec and get it accepted; no UI change before that |

Issue #88 (<https://github.com/invicta-ctrl/logistics-hub/issues/88>) states, kept separate: design reference linked — **yes**; UI spec proposed — no; UI spec accepted — no; mobile and desktop UI implemented — no; owner visually accepted — no. Current 3-tab navigation stays until a 4-tab architecture is accepted. PR #89 changes no UI beyond the closing-menu fix. `src/styles.css` is held by PR #89; do not start Issue #88 CSS work until it is released.

## Release states (a merge is not a deployment)

| Release | State | Evidence and where observed |
|---|---|---|
| V1.16.12 (pagination, PR #87) | **MERGED_DEPLOYMENT_UNVERIFIED** | merged to `main` as merge commit `1e9a468` (2026-11-04 18:40 UTC; PR #87). CI run 41889453855 and CodeQL push run 41889453758 passed on it. Cloudflare's "Workers Builds: logistics-hub" check shows success for that commit, a provider signal and not a byte check. The GitHub `Deploy` run 41891241652 failed at its CodeQL gate, as designed (below). Not done: compare the live assets with a build of `1e9a468`; Earl's System check. Its release record still says `INTEGRATION: pending`, which predates the merge; this file is the later fact |
| V1.16.7 – V1.16.11 | **DEPLOYED_OWNER_CHECK_PENDING**, as recorded | the archived pointer records each as merged, deployed by Workers Builds and byte-checked (121 of 122 assets, `build.json` not served), with Earl's Administration > System checks still owed. Not re-verified by this session |
| V1.16 (full release) | OPEN | `docs/specs/accepted/v1.16-ambient-intelligent-core.md`; the V1.16.x revisions are post-release follow-ups |
| PR #89 fix (candidate V1.16.13) | **QUALIFICATION_PENDING**, not merged | the photo-menu Worker E2E reads the popover's state with no retry (the real cause: a fading menu counted as open); a closing menu also takes no presses, as defense in depth (Chromium already ignored it when hit-testing). Candidate number only: the steward decides whether one CSS property is a revision (`docs/PRODUCT_VERSION_GOVERNANCE.md`). Merge needs Earl's explicit go-ahead |

Production's live state is **UNVERIFIED** from here: no Cloudflare read was made. Do not mark a release deployed from this table.

## Security qualification of the deploy (diagnosed 2026-11-05)

`Deploy` run 41891241652 on `1e9a468` failed in `scripts/ops/deploy-gate.mjs` (`requireCodeql`) after its 120 s wait: the exact-main CodeQL **workflow** run passed, but no combined **`CodeQL` check from GitHub Advanced Security (app 57789)** exists on that commit. A commit created by GitHub's merge button never gets one; PR heads do (the PR #89 head has it). The gate is fail-closed on purpose (`tests/deploy-gate.test.ts` rejects the Actions `analyze (...)` jobs as a substitute) and must stay so. `DEPLOY_FROM_CI` is `dry-run`; production deploys come from Workers Builds until Earl approves the V1.17 switch (`docs/road-to-v2/v1.17-ci-only-deploy-task.md`), which says to merge only by fast-forwarding `main` to a checked head. So the red run is the documented behavior of a merge-button commit, not a defect in CI or in production.
- **BLOCKED** (needs an accepted deploy/CI amendment; outside this task's allowed paths): a clearer gate message when the combined check is absent on a merge-button commit, with a negative test. Smallest amendment: allow `scripts/ops/deploy-gate.mjs` message text and one test in `tests/deploy-gate.test.ts`, no change to what is accepted.
- **BLOCKED** (Earl's settings, not code): the V1.17 cutover and a fast-forward merge method.
- **BLOCKED** (needs an accepted amendment; `scripts/admin.mjs` is outside this task): Owner Console option 13 still deploys directly with Wrangler and applies pending migrations from a PC, which `AGENTS.md` forbids for release preparation. The README now says so. A documentation note does not disable it. Smallest amendment: make option 13 refuse while the Cloud Operations lane exists, or remove it.

## Next exact action

1. Steward (this session): finish HAU-PR89-W1's qualification and update the PR body with PASS, FAIL, N/A and NOT RUN for the exact head.
2. ChatGPT: independent review of the complete exact-head diff of PR #89. The packet is saved and the review is **PENDING** (see the handoff).
3. Earl: decide whether to merge PR #89 (explicit go-ahead; not implied by this file), and later check Administration > System > This version for V1.16.7–V1.16.12.
4. After any authorized merge: verify `main`, then check the live assets against a build of the merged commit to move V1.16.12 out of `MERGED_DEPLOYMENT_UNVERIFIED`, then repeat the fresh-clone drill on a clean `main` checkout.
