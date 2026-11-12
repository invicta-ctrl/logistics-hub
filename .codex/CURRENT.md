# Current Work Pointer — Logistics Hub

Rewritten 2026-11-05 by the integration steward: first in PR #89, then after that merge in LH-RECORDS-01. The previous 336-line pointer (per-slice notes from 2026-10-15 to V1.16.12) is kept unchanged at [docs/archive/continuity/CURRENT_before_2026-11-05.md](../docs/archive/continuity/CURRENT_before_2026-11-05.md); the archive index is [docs/archive/README.md](../docs/archive/README.md). A file cannot name its own commit: the PR head is on the PR, and every dated fact below says where it was observed.

**Amended 2026-11-05 in PR #91 (LH-UI-88 S1)** by its writer, on Earl's chat instruction ("i authorize this, no need to wait for a steward"): the steward role was vacant when LH-RECORDS-01 merged, so this edit records only what the S1 slice and the merged PR #90 made true. A steward, once Earl names one, reconciles it with the live roster. It was corrected again in the same PR after the exact-head QA (review coverage, merge method, gates); the authority is unchanged and is Earl's instruction above, not the writer's.

**Amended 2026-11-06 in PR #91:** Earl answered "This session = steward for PR #91 only" and, separately, "apply the landing page now, I authorize it to be in this slice not on its own slice". This amendment records both, for PR #91 only. It is still not a roster entry.

**Amended 2026-11-11 with V1.16.15** by the LH-UI-88 S4 writer, on Earl's chat instructions "start S4 and fix the critical and major findings" and "push to main directly" (refused by branch protection; the slice is a PR). Only the slot A row and the LH-UI-88 row changed; the steward role stays vacant and the roster file was not edited. A steward reconciles the rest (the V1.16.14 rows below still read as before the merge).

**Amended 2026-11-12 in PR #93** by the steward Earl appointed ("fix it, be the steward. merge when green"): the Steward line under "Writer slots". The CI change it made is in [the V1.16.15 record](../docs/road-to-v2/releases/v1.16.15.md).

**Amended 2026-11-12 in the LH-CD-01 PR** by the same steward: V1.16.15 is now live, both writer slots are filled (A: LH-CD-01, B: the UI lane), and the LH-CD-01 task row is added. The V1.16.14 rows are still not reconciled.

## Read first

`AGENTS.md` (rules, writers, repository self-sufficiency, security review) → this file → [SESSION_HANDOFF.md](SESSION_HANDOFF.md) → [docs/SHARED_AGENT_WORKFLOW.md](../docs/SHARED_AGENT_WORKFLOW.md). The writer rules are [HAU-AGENT-LANES-003](../docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md). Authority: Earl's current instruction → accepted specification → verified repository state → Context Vault. This file is not evidence that a check passed: each row says where its fact was observed.

## Writer slots (dated snapshot of the steward's live roster, observed 2026-11-05; re-check, do not assume)

- **Live roster:** `D:\Documents\HAU-USC Logistics Hub\handoffs\WRITER_ROSTER.md` on Earl's PC, kept by the integration steward. It covers every repository, because the cap of two Claude writers is account-wide. This table is a copy; if they disagree, no new writer is admitted until the steward reconciles them.
- **Steward:** the LH-UI-88 S4 session (this writer), appointed by Earl on 2026-11-12 in chat: "fix it, be the steward. merge when green". It reconciles PR #93 and the CI fix it needed. Before that the role was vacant except for PR #91 (Earl, 2026-11-06: "This session = steward for PR #91 only"). The live roster file is updated by this steward.
- **Two-lane state:** HAU-AGENT-LANES-003 is merged (PR #89, `9a0cdfe`). A second lane still needs two accepted, disjoint task manifests.

| Slot | Holder | Task | Repository / branch / worktree | State |
|---|---|---|---|---|
| A | Claude (the steward session; S4 part 1 merged as PR #93) | **LH-CD-01** shipping pipeline (Earl, 2026-11-12: "build a shipping pipeline for CI and CD"); ops and CI files only, no `src/**` | `invicta-ctrl/logistics-hub`, `slice/lh-cd-01-ship`, worktree `D:\Documents\Projects\Logistics Hub\.claude\worktrees\lh-ui-88-s4` | QUALIFICATION_PENDING; merge needs Earl's word for its PR |
| B | Claude (UI lane session, started by the steward on Earl's "Both in parallel", 2026-11-12) | LH-UI-88 reference-principles amendment (proposed, for Earl's acceptance), then S2 Inventory (V1.16.16) | `invicta-ctrl/logistics-hub`, `claude/lh-ui-88-ui-lane-5c6439`, worktree `.claude\worktrees\lh-ui-88-redesign-c15339` | in progress; disjoint from slot A (`src/**`, its spec and record only) |

Released: **LH-RECORDS-01** (the steward's slot A) merged 2026-11-05 09:18 UTC as `main` `35f230f` (PR #90).

Released on 2026-11-05: HAU-PR89-W1 (PR #89 merged, session `local_d015ec49…`), Kawing-Platform KAW-GOV-01 (Kawing PR #5 merged) and the qrmenu demo overhaul (qrmenu PRs #1 and #2 merged).

Other Logistics checkouts exist and are **not** writable by a new writer: the shared `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub` (branch `slice/v1.16-header-gridlines`, with modified `.codex` and release-record files and an untracked `NUL`), `workspace\logistics-hub-v1164`, `repo\logistics-hub`, `worktrees\photo-menu-race` (merged PR #89, kept), several detached Codex worktrees under `C:\Users\adria\.codex\worktrees` and detached MausBot worktrees. Preserve all of them.

## Task board

| ID | Task | Spec | Base → branch | Slot | State | Next |
|---|---|---|---|---|---|---|
| LH-RECORDS-01 | Apply the 003 roster amendment; reconcile `CURRENT.md`, the handoff, `CHANGELOG.md`, the V1.16.12 record and the stale passages; a clearer deploy-gate message for a merge-button commit (with a test); retire Console option 13 | 003 (amended); Earl, 2026-11-05: "i approve all … documents reconciled" | `main` `9a0cdfe` → `slice/records-roster-reconcile` | — | **merged** (PR #90, `main` `35f230f`, 2026-11-05 09:18 UTC) | none |
| LH-UI-88 | Issue #88 visual refresh, slices S1–S5 | [accepted spec](../docs/specs/accepted/2026-11-05-lh-ui-88-visual-refresh.md) with its boards | `main` → one `slice/*` per slice | A (S4) | **S1 merged** (PR #91, `main` `b3a36f3`; its automatic Deploy stopped at the CodeQL gate). **S4 part 1 merged and live** (V1.16.15, PR #93, `main` `c142a50`, record [v1.16.15](../docs/road-to-v2/releases/v1.16.15.md)), started before S2 and S3 on Earl's word. **S2 in progress in slot B**; S3, S5 and the rest of S4 not started | Earl's visual check of V1.16.15; his decision on the landing water; his acceptance of the slot B amendment |
| LH-CD-01 | Shipping pipeline: `scripts/ops/ship.mjs` fast-forward, post-deploy smoke check, automatic rollback in `Deploy` | V1.17 task (`docs/road-to-v2/v1.17-ci-only-deploy-task.md`); Earl, 2026-11-12: "Auto-deploy green merges" | `main` `c142a50` → `slice/lh-cd-01-ship` | A | in review | Earl's word to merge; then Earl turns off Workers Builds' automatic deploys of `main` and sets `DEPLOY_FROM_CI=true`; a proof deploy |

Issue #88 (<https://github.com/invicta-ctrl/logistics-hub/issues/88>) states, kept separate: design reference linked — **yes**; UI spec proposed — yes; UI spec accepted — **yes** (`docs/specs/accepted/2026-11-05-lh-ui-88-visual-refresh.md`); mobile and desktop UI implemented — no; owner visually accepted — no. The current Home · Find · More navigation stays; the boards' Home · Items · Activity · More bar is out of scope until a separate navigation amendment is accepted.

### LH-UI-88 S1 manifest

- **Writer:** Claude, slot A (Earl's chat instruction). **Base:** `main` `35f230f`. **Isolation:** its own worktree; no secrets read; no provider writes; local D1 and R2 simulation only for the preview.
- **Owned paths:** `src/styles.css`, `src/self-service.css`, `src/pager.ts` (the phone breakpoint constant), `src/ui.ts` (one guard in the sheet drag settle, and `working()`), `src/public.ts` (the landing markup), `src/water.ts` (new), `public/brand/water-still.webp` (new), `tests/browser/landing-water.spec.ts` (new), `tests/browser/tab-style.spec.ts`, `tests/browser/v1167-sheets.spec.ts`, `tests/admin-control.test.ts` (the version pin), `product-release.json`, `docs/road-to-v2/releases/v1.16.14.md`, and these two pointers (amended on Earl's instruction).
- **Forbidden and untouched:** the server, APIs, migrations, `wrangler.jsonc`, `package.json` and the lockfile, `.github/**`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, accepted specifications.
- **Authority for the owned paths, and a gap to confirm:** the accepted spec (§4 S1 and §6) names `src/styles.css`, `src/self-service.css`, `src/pager.ts` and `src/ui.ts` as S1's files and gives each slice its own record and `product-release.json` entry. `AGENTS.md` lists global CSS tokens, release files and the `.codex` pointers as steward-exclusive unless a serial, frozen transfer is granted first. The steward is vacant, so no transfer was recorded; the S1 admission rested on Earl's chat instruction, which this repository does not quote verbatim; on 2026-11-06 he ratified it ("This session = steward for PR #91 only"), which also covers `src/styles.css` and `product-release.json` for S1. The pointer edits carry his quoted words ("i authorize this, no need to wait for a steward"). A later steward confirms or amends this.
- **Risk tier:** HIGH under the spec (the shared stylesheet styles every page); client presentation only, no change to authentication, roles, privacy handling, data or routes.
- **Landing page (a recorded deviation):** the spec defers the public backdrop to S4; on 2026-11-06 Earl authorized the public home page's water, grain and campus photograph inside S1 ("apply the landing page now, I authorize it to be in this slice not on its own slice"). The new files above are outside the original manifest for that reason. S4's other pages are untouched.
- **`CHANGELOG.md`:** edited for the V1.16.14 candidate entry and the LH-UI-88 status line only, as steward for PR #91 (Earl, 2026-11-06). The steward moves the entry under released versions when it is verified.
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
| V1.16.15 (LH-UI-88 S4 part 1, PR #93) | **DEPLOYED_OWNER_CHECK_PENDING** | merged 2026-11-12 as `main` `c142a50`; Workers Builds deployed it; the live entry bundle `/assets/main-DtRBHjiH.js` matches a local build and the LH-CD-01 smoke check passed (a targeted check, observed by the steward). Owed: Earl's visual check and Administration > System |
| V1.16.14 (LH-UI-88 S1 Foundations, PR #91) | **QUALIFICATION_PENDING** | candidate only: not merged, not deployed. Application source `db334d798a584939c2a872f01e225b59edca17ec` (includes Earl's landing page); the PR head is a later docs-only head (`gh pr view 91 --json headRefOid`). Checks for the exact head are in the receipt comment on PR #91, and a skipped job (`role-qualification`) is not a pass. **200% text criterion: FAIL / EXCEPTION PENDING** (S1 170 pass / 149 fail of 320 cells, base 168 / 151; the failures are mostly older than S1: record, "Accessibility at the final source"). Reviews: R1 to R7 were the S1 writer's own agents or Codex at `32e3d0a` only; **no reviewer independent of the writer has reviewed the exact final head; an exact-head independent review is owed** (`docs/road-to-v2/releases/v1.16.14.md`). Also owed: Earl's merge go-ahead and visual check |
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

1. Earl: look at the S1 preview (`http://127.0.0.1:8791`; restart it with `dataprivatepreview
estart-preview.cmd` in the S1 worktree) and decide whether the 200% text failures are accepted exceptions or block the merge, then give the merge go-ahead for PR #91, or feedback. Merge only with his explicit word, only after an independent review of the exact head and green CI, CodeQL and Worker E2E on that head. Merge method is his call: a merge-button commit makes the `Deploy` run fail its CodeQL gate by design (above), a fast-forward keeps the tested SHA; do not choose it for him. `--match-head-commit <sha>` pins the head.
2. Earl: relay the staged roster rows for S1 into the live roster, and name an integration steward for everything after PR #91 (the S1 session is steward for PR #91 only). That steward moves the V1.16.14 `CHANGELOG.md` entry under released versions when it is verified, and reconciles this snapshot. Also decide the order against branch `handoff/steward-2026-11-05` (`c2b1151`, no PR), which rewrites these same two pointers and says S1 is unstarted; it predates the S1 pointers and must be reconciled before it merges.
3. After Earl's feedback, a fresh admission for S2 Inventory, then S3 → S5, one at a time, each with its own branch, PR, gates, review and merge.
4. Earl: check Administration > System > This version (V1.16.12, V1.16.13) and pages on a long list; then visually accept each LH-UI-88 slice. Issue #88 closes only after that.
