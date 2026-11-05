# Current Work Pointer — Logistics Hub

Rewritten 2026-11-05 by the integration steward: first in PR #89, then after that merge in LH-RECORDS-01. The previous 336-line pointer (per-slice notes from 2026-10-15 to V1.16.12) is kept unchanged at [docs/archive/continuity/CURRENT_before_2026-11-05.md](../docs/archive/continuity/CURRENT_before_2026-11-05.md); the archive index is [docs/archive/README.md](../docs/archive/README.md). A file cannot name its own commit: the PR head is on the PR, and every dated fact below says where it was observed.

**Amended 2026-11-05 in PR #91 (LH-UI-88 S1)** by its writer, on Earl's chat instruction ("i authorize this, no need to wait for a steward"): the steward role was vacant when LH-RECORDS-01 merged, so this edit records only what the S1 slice and the merged PR #90 made true. A steward, once Earl names one, reconciles it with the live roster.

## Read first

`AGENTS.md` (rules, writers, repository self-sufficiency, security review) → this file → [SESSION_HANDOFF.md](SESSION_HANDOFF.md) → [docs/SHARED_AGENT_WORKFLOW.md](../docs/SHARED_AGENT_WORKFLOW.md). The writer rules are [HAU-AGENT-LANES-003](../docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md). Authority: Earl's current instruction → accepted specification → verified repository state → Context Vault. This file is not evidence that a check passed: each row says where its fact was observed.

## Writer slots (dated snapshot of the steward's live roster, observed 2026-11-05; re-check, do not assume)

- **Live roster:** `D:\Documents\HAU-USC Logistics Hub\handoffs\WRITER_ROSTER.md` on Earl's PC, kept by the integration steward. It covers every repository, because the cap of two Claude writers is account-wide. This table is a copy; if they disagree, no new writer is admitted until the steward reconciles them.
- **Steward:** vacant as of 2026-11-05 (observed in the S1 session: the roster file could not be edited from it). The coordinator session that held the role, `local_c6813149-65ea-41fc-ac29-130177305dde`, authored LH-RECORDS-01 (PR #90) and is not the S1 writer. A session that cannot read the roster file asks Earl to relay its admission request. The S1 admission below is Earl's chat instruction, not a roster entry; the steward records it when named.
- **Two-lane state:** HAU-AGENT-LANES-003 is merged (PR #89, `9a0cdfe`). A second lane still needs two accepted, disjoint task manifests.

| Slot | Holder | Task | Repository / branch / worktree | State |
|---|---|---|---|---|
| A | Claude (LH-UI-88 S1 writer) | **LH-UI-88 S1 Foundations**, candidate V1.16.14, PR #91 | `invicta-ctrl/logistics-hub`, `slice/lh-ui-88-s1-foundations`, worktree `D:\Documents\Projects\Logistics Hub\.claude\worktrees\lh-ui-88-redesign-c15339` | active, QUALIFICATION_PENDING |
| B | none | — | — | free |

Released: **LH-RECORDS-01** (the steward's slot A) merged 2026-11-05 09:18 UTC as `main` `35f230f` (PR #90).

Released on 2026-11-05: HAU-PR89-W1 (PR #89 merged, session `local_d015ec49…`), Kawing-Platform KAW-GOV-01 (Kawing PR #5 merged) and the qrmenu demo overhaul (qrmenu PRs #1 and #2 merged).

Other Logistics checkouts exist and are **not** writable by a new writer: the shared `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub` (branch `slice/v1.16-header-gridlines`, with modified `.codex` and release-record files and an untracked `NUL`), `workspace\logistics-hub-v1164`, `repo\logistics-hub`, `worktrees\photo-menu-race` (merged PR #89, kept), several detached Codex worktrees under `C:\Users\adria\.codex\worktrees` and detached MausBot worktrees. Preserve all of them.

## Task board

| ID | Task | Spec | Base → branch | Slot | State | Next |
|---|---|---|---|---|---|---|
| LH-RECORDS-01 | Apply the 003 roster amendment; reconcile `CURRENT.md`, the handoff, `CHANGELOG.md`, the V1.16.12 record and the stale passages; a clearer deploy-gate message for a merge-button commit (with a test); retire Console option 13 | 003 (amended); Earl, 2026-11-05: "i approve all … documents reconciled" | `main` `9a0cdfe` → `slice/records-roster-reconcile` | — | **merged** (PR #90, `main` `35f230f`, 2026-11-05 09:18 UTC) | none |
| LH-UI-88 | Issue #88 visual refresh, slices S1–S5 | [accepted spec](../docs/specs/accepted/2026-11-05-lh-ui-88-visual-refresh.md) with its boards (recorded by LH-RECORDS-01) | `main` → one `slice/*` per slice | A (S1) | **S1 in review**: PR #91, `slice/lh-ui-88-s1-foundations`, candidate V1.16.14, QUALIFICATION_PENDING. **S2–S5 not started** | Earl's merge go-ahead for PR #91 and his visual check; then S2 Inventory with its own admission, branch and PR. Slices run one at a time because all share `src/styles.css` |

Issue #88 (<https://github.com/invicta-ctrl/logistics-hub/issues/88>) states, kept separate: design reference linked — **yes**; UI spec proposed — yes; UI spec accepted — **yes** (`docs/specs/accepted/2026-11-05-lh-ui-88-visual-refresh.md`); mobile and desktop UI implemented — no; owner visually accepted — no. The current Home · Find · More navigation stays; the boards' Home · Items · Activity · More bar is out of scope until a separate navigation amendment is accepted.

### LH-UI-88 S1 manifest

- **Writer:** Claude, slot A (Earl's chat instruction). **Base:** `main` `35f230f`. **Isolation:** its own worktree; no secrets read; no provider writes; local D1 and R2 simulation only for the preview.
- **Owned paths:** `src/styles.css`, `src/self-service.css`, `src/pager.ts` (the phone breakpoint constant), `src/ui.ts` (one guard in the sheet drag settle), `tests/browser/tab-style.spec.ts`, `tests/browser/v1167-sheets.spec.ts`, `tests/admin-control.test.ts` (the version pin), `product-release.json`, `docs/road-to-v2/releases/v1.16.14.md`, and these two pointers (amended on Earl's instruction).
- **Forbidden and untouched:** the server, APIs, migrations, `wrangler.jsonc`, `package.json` and the lockfile, `.github/**`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, accepted specifications.
- **Risk tier:** HIGH under the spec (the shared stylesheet styles every page); client presentation only, no change to authentication, roles, privacy handling, data or routes.
- **`CHANGELOG.md`:** the steward-exclusive file is not edited here. The proposed entry for V1.16.14 is in the release record and the PR body; the next steward adds it when the version is released.
- **State:** not merged, not deployed (QUALIFICATION_PENDING). Merge needs Earl's explicit word for PR #91.

### LH-RECORDS-01 manifest (merged, kept for the record)

- **Writer:** the steward, slot A. **Base:** `main` `9a0cdfe`. **Isolation:** its own worktree; no secrets read; no provider writes.
- **Owned paths:** `product-release.json`, `docs/road-to-v2/releases/v1.16.13.md`, `tests/admin-control.test.ts` (the version pin), `docs/specs/accepted/2026-11-05-lh-ui-88-visual-refresh.md` and its `boards/`, `.codex/CURRENT.md`, `.codex/SESSION_HANDOFF.md`, `CHANGELOG.md`, `CLAUDE.md`, `.agents/PROJECT_POLICY.md`, `README.md`, `docs/DOCUMENTATION_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/PRODUCT_REFERENCE.md`, `docs/PRODUCT_VERSION_GOVERNANCE.md`, `docs/road-to-v2/releases/v1.16.12.md`, `docs/road-to-v2/v1.16-execution-card.md`, `docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md`, `docs/specs/accepted/v1.16-ambient-intelligent-core.md` (one clause), `scripts/ops/deploy-gate.mjs` (the timeout message only), `tests/deploy-gate.test.ts`, `scripts/admin.mjs` (option 13 refuses).
- **Forbidden:** `src/**`, migrations, `wrangler.jsonc`, `package.json` and the lockfile, `.github/**`.
- **Risk tier:** HIGH (deploy and release-control text and the deploy gate's message). The gate's decision is unchanged: `codeqlState` returns the same answers and the gate still fails closed; only the text after the wait names the cause. Console 13 now refuses; nothing new can deploy.
- **Stop conditions:** a third writer; an overlap; a failed or unrun required check; a HIGH finding; a merge without Earl's go-ahead.

## Release states (a merge is not a deployment)

| Release | State | Evidence and where observed |
|---|---|---|
| V1.16.14 (LH-UI-88 S1 Foundations, PR #91) | **QUALIFICATION_PENDING** | candidate only: not merged, not deployed. Source `f5ae589`; the PR head was `c281d7f` when CI, CodeQL, Worker E2E and Workers Builds were observed green on it (2026-11-05, `gh pr view 91`). Independent reviews R1 (exact diff) and R2 (Codex, one P2 fixed) are in `docs/road-to-v2/releases/v1.16.14.md`. Owed: Earl's merge go-ahead and visual check |
| V1.16.13 (PR #89: photo-menu test fix and closing-menu CSS; named by PR #90, merged `35f230f`) | **MERGED_DEPLOYMENT_UNVERIFIED** for its version name | the CSS merged 2026-11-05 07:45 UTC as `main` `9a0cdfe` from head `68a57ec` (Earl's go-ahead in chat); CI, CodeQL and Workers Builds passed on it, and the live stylesheet at `https://logistics.hausc.org` was observed to contain `.menu[popover]:not(:popover-open){pointer-events:none}` (a targeted check). The name V1.16.13 (`product-release.json`) ships with LH-RECORDS-01; a deployed visual change is a mandatory revision (`docs/PRODUCT_VERSION_GOVERNANCE.md` §2). Record: `docs/road-to-v2/releases/v1.16.13.md`. `Deploy` run 41990736342 failed at the CodeQL gate as designed (below) |
| V1.16.12 (pagination, PR #87) | **DEPLOYED_OWNER_CHECK_PENDING** | merged as `1e9a468`; Workers Builds deployed it; the live assets matched a local build of that tree, 121 of 122 byte for byte, `build.json` not served (observed by the steward on 2026-11-05). Owed: Earl's check of Administration > System > This version and pages on a long list. Record: `docs/road-to-v2/releases/v1.16.12.md` |
| V1.16.7 – V1.16.11 | **DEPLOYED_OWNER_CHECK_PENDING**, as recorded | the archived pointer records each as merged, deployed by Workers Builds and byte-checked, with Earl's Administration > System checks still owed. Not re-verified here |
| V1.16 (full release) | OPEN | `docs/specs/accepted/v1.16-ambient-intelligent-core.md`; the V1.16.x revisions are post-release follow-ups |

## Security qualification of the deploy (diagnosed 2026-11-05)

`Deploy` runs 41891241652 (on `1e9a468`) and 41990736342 (on `9a0cdfe`) failed in `deploy-gate.mjs` (`requireCodeql`) after its 120 s wait: the exact-main CodeQL **workflow** run passed, but no combined **`CodeQL` check from GitHub Advanced Security (app 57789)** exists on a commit made by GitHub's merge button; PR heads get one. The gate is fail-closed on purpose (`tests/deploy-gate.test.ts` rejects the Actions `analyze (...)` jobs as a substitute) and stays so. `DEPLOY_FROM_CI` is `dry-run`; production deploys come from Workers Builds until Earl approves the V1.17 switch (`docs/road-to-v2/v1.17-ci-only-deploy-task.md`), which says to merge only by fast-forwarding `main` to a checked head. So a red `Deploy` run on a merge-button commit is documented behavior, not a production failure.
- **Fixed in LH-RECORDS-01:** the gate now says so after its wait (`codeqlTimeoutMessage`), with a test; its decision is unchanged.
- **Fixed in LH-RECORDS-01:** Owner Console option 13 (and `npm run admin -- deploy`) refuses and deploys nothing; the old direct-Wrangler implementation is removed and stays in Git history.
- **Earl's decision, not code:** the V1.17 cutover and a fast-forward merge method.

## Next exact action

1. Earl: look at the S1 preview (`http://127.0.0.1:8791` while the S1 session runs) and give the merge go-ahead for PR #91, or feedback. Merge only with his explicit word: `gh pr merge 91 --merge --match-head-commit <sha>`.
2. Earl: name an integration steward (the role is vacant). The steward records the S1 admission in the live roster, adds the V1.16.14 `CHANGELOG.md` entry when it is released, and reconciles this snapshot.
3. After Earl's feedback, a fresh admission for S2 Inventory, then S3 → S5, one at a time, each with its own branch, PR, gates, review and merge.
4. Earl: check Administration > System > This version (V1.16.12, V1.16.13) and pages on a long list; then visually accept each LH-UI-88 slice. Issue #88 closes only after that.
