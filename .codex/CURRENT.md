# Current Work Pointer — Logistics Hub

Rewritten 2026-11-05 by the integration steward: first in PR #89, then after that merge in LH-RECORDS-01. The previous 336-line pointer (per-slice notes from 2026-10-15 to V1.16.12) is kept unchanged at [docs/archive/continuity/CURRENT_before_2026-11-05.md](../docs/archive/continuity/CURRENT_before_2026-11-05.md); the archive index is [docs/archive/README.md](../docs/archive/README.md). A file cannot name its own commit: the PR head is on the PR, and every dated fact below says where it was observed.

## Read first

`AGENTS.md` (rules, writers, repository self-sufficiency, security review) → this file → [SESSION_HANDOFF.md](SESSION_HANDOFF.md) → [docs/SHARED_AGENT_WORKFLOW.md](../docs/SHARED_AGENT_WORKFLOW.md). The writer rules are [HAU-AGENT-LANES-003](../docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md). Authority: Earl's current instruction → accepted specification → verified repository state → Context Vault. This file is not evidence that a check passed: each row says where its fact was observed.

## Writer slots (dated snapshot of the steward's live roster, observed 2026-11-05; re-check, do not assume)

- **Live roster:** `D:\Documents\HAU-USC Logistics Hub\handoffs\WRITER_ROSTER.md` on Earl's PC, kept by the integration steward. It covers every repository, because the cap of two Claude writers is account-wide. This table is a copy; if they disagree, no new writer is admitted until the steward reconciles them.
- **Steward:** the Claude Code coordinator session `local_c6813149-65ea-41fc-ac29-130177305dde` (Claude desktop app on Earl's PC). A session that cannot read the roster file asks Earl to relay its admission request.
- **Two-lane state:** HAU-AGENT-LANES-003 is merged (PR #89, `9a0cdfe`). A second lane still needs two accepted, disjoint task manifests.

| Slot | Holder | Task | Repository / branch / worktree | State |
|---|---|---|---|---|
| A | the steward | **LH-RECORDS-01**: roster amendment, post-merge records, deploy-gate message, Console 13 retired | `invicta-ctrl/logistics-hub`, `slice/records-roster-reconcile`, worktree `D:\Documents\HAU-USC Logistics Hub\worktrees\records-reconcile` | active |
| B | none | — | — | free |

Released on 2026-11-05: HAU-PR89-W1 (PR #89 merged, session `local_d015ec49…`), Kawing-Platform KAW-GOV-01 (Kawing PR #5 merged) and the qrmenu demo overhaul (qrmenu PRs #1 and #2 merged).

Other Logistics checkouts exist and are **not** writable by a new writer: the shared `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub` (branch `slice/v1.16-header-gridlines`, with modified `.codex` and release-record files and an untracked `NUL`), `workspace\logistics-hub-v1164`, `repo\logistics-hub`, `worktrees\photo-menu-race` (merged PR #89, kept), several detached Codex worktrees under `C:\Users\adria\.codex\worktrees` and detached MausBot worktrees. Preserve all of them.

## Task board

| ID | Task | Spec | Base → branch | Slot | State | Next |
|---|---|---|---|---|---|---|
| LH-RECORDS-01 | Apply the 003 roster amendment; reconcile `CURRENT.md`, the handoff, `CHANGELOG.md`, the V1.16.12 record and the stale passages; a clearer deploy-gate message for a merge-button commit (with a test); retire Console option 13 | 003 (amended); Earl, 2026-11-05: "i approve all … documents reconciled" | `main` `9a0cdfe` → `slice/records-roster-reconcile` | A | active | gates, independent review, merge |
| LH-UI-88 | Issue #88 visual refresh, slices S1–S5 | proposed spec accepted by Earl in chat 2026-11-05, boards attached; to be recorded in Git by S1 | `main` → one `slice/*` per slice | none yet | **accepted, not started** | S1 Foundations after LH-RECORDS-01 merges; slices run one at a time because all share `src/styles.css` |

Issue #88 (<https://github.com/invicta-ctrl/logistics-hub/issues/88>) states, kept separate: design reference linked — **yes**; UI spec proposed — yes; UI spec accepted — **yes, in chat** (recorded in Git by its first slice); mobile and desktop UI implemented — no; owner visually accepted — no. The current Home · Find · More navigation stays; the boards' Home · Items · Activity · More bar is out of scope until a separate navigation amendment is accepted.

### LH-RECORDS-01 manifest

- **Writer:** the steward, slot A. **Base:** `main` `9a0cdfe`. **Isolation:** its own worktree; no secrets read; no provider writes.
- **Owned paths:** `.codex/CURRENT.md`, `.codex/SESSION_HANDOFF.md`, `CHANGELOG.md`, `CLAUDE.md`, `.agents/PROJECT_POLICY.md`, `README.md`, `docs/DOCUMENTATION_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/PRODUCT_REFERENCE.md`, `docs/PRODUCT_VERSION_GOVERNANCE.md`, `docs/road-to-v2/releases/v1.16.12.md`, `docs/road-to-v2/v1.16-execution-card.md`, `docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md`, `docs/specs/accepted/v1.16-ambient-intelligent-core.md` (one clause), `scripts/ops/deploy-gate.mjs` (the timeout message only), `tests/deploy-gate.test.ts`, `scripts/admin.mjs` (option 13 refuses).
- **Forbidden:** `src/**`, migrations, `wrangler.jsonc`, `package.json` and the lockfile, `.github/**`, `product-release.json`.
- **Risk tier:** HIGH (deploy and release-control text and the deploy gate's message). The gate's decision is unchanged: `codeqlState` returns the same answers and the gate still fails closed; only the text after the wait names the cause. Console 13 now refuses; nothing new can deploy.
- **Stop conditions:** a third writer; an overlap; a failed or unrun required check; a HIGH finding; a merge without Earl's go-ahead.

## Release states (a merge is not a deployment)

| Release | State | Evidence and where observed |
|---|---|---|
| PR #89 change (photo-menu test fix and closing-menu CSS) | **DEPLOYED_OWNER_CHECK_PENDING**, no version bump | merged 2026-11-05 07:45 UTC as `main` `9a0cdfe` from head `68a57ec` (Earl's go-ahead in chat). CI `checks` and `worker-e2e`, CodeQL and Workers Builds passed on `9a0cdfe`. The live stylesheet at `https://logistics.hausc.org` was observed to contain `.menu[popover]:not(:popover-open){pointer-events:none}` (a targeted check of the only product change, not a full byte check). `product-release.json` is unchanged, so the site still reports V1.16.12: the steward decided one defensive CSS property is not a new revision. `Deploy` run 41990736342 failed at the CodeQL gate as designed (below) |
| V1.16.12 (pagination, PR #87) | **DEPLOYED_OWNER_CHECK_PENDING** | merged as `1e9a468`; Workers Builds deployed it; the live assets matched a local build of that tree, 121 of 122 byte for byte, `build.json` not served (observed by the steward on 2026-11-05). Owed: Earl's check of Administration > System > This version and pages on a long list. Record: `docs/road-to-v2/releases/v1.16.12.md` |
| V1.16.7 – V1.16.11 | **DEPLOYED_OWNER_CHECK_PENDING**, as recorded | the archived pointer records each as merged, deployed by Workers Builds and byte-checked, with Earl's Administration > System checks still owed. Not re-verified here |
| V1.16 (full release) | OPEN | `docs/specs/accepted/v1.16-ambient-intelligent-core.md`; the V1.16.x revisions are post-release follow-ups |

## Security qualification of the deploy (diagnosed 2026-11-05)

`Deploy` runs 41891241652 (on `1e9a468`) and 41990736342 (on `9a0cdfe`) failed in `deploy-gate.mjs` (`requireCodeql`) after its 120 s wait: the exact-main CodeQL **workflow** run passed, but no combined **`CodeQL` check from GitHub Advanced Security (app 57789)** exists on a commit made by GitHub's merge button; PR heads get one. The gate is fail-closed on purpose (`tests/deploy-gate.test.ts` rejects the Actions `analyze (...)` jobs as a substitute) and stays so. `DEPLOY_FROM_CI` is `dry-run`; production deploys come from Workers Builds until Earl approves the V1.17 switch (`docs/road-to-v2/v1.17-ci-only-deploy-task.md`), which says to merge only by fast-forwarding `main` to a checked head. So a red `Deploy` run on a merge-button commit is documented behavior, not a production failure.
- **Fixed in LH-RECORDS-01:** the gate now says so after its wait (`codeqlTimeoutMessage`), with a test; its decision is unchanged.
- **Fixed in LH-RECORDS-01:** Owner Console option 13 (and `npm run admin -- deploy`) refuses and deploys nothing; the old code is kept behind `PC_DEPLOY_RETIRED` for history.
- **Earl's decision, not code:** the V1.17 cutover and a fast-forward merge method.

## Next exact action

1. Steward: finish LH-RECORDS-01 (gates, PR, independent review of the exact head, merge on Earl's approval), then update the live roster and this snapshot.
2. Steward: admit the LH-UI-88 S1 writer (slot B) and run S1 → S5 one at a time, each with its own PR, gates, review and merge.
3. Earl: check Administration > System > This version (V1.16.12) and pages on a long list; then visually accept each LH-UI-88 slice. Issue #88 closes only after that.
