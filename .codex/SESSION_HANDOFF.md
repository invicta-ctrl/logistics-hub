# Session Handoff — Logistics Hub

Rewritten 2026-11-05 at 09:40 UTC by the outgoing integration steward. Earl said: "stop everything, push to cloud and prepare complete contextual and instruction handoff for the next agent. i will be deleting all of local sessions now".

This file is complete on its own. No chat history survives.
- The task board, slots and release states are in [CURRENT.md](CURRENT.md). It wins if the two files ever differ.
- The handoff from before 2026-11-05 is kept at [docs/archive/continuity/SESSION_HANDOFF_before_2026-11-05.md](../docs/archive/continuity/SESSION_HANDOFF_before_2026-11-05.md).

## 1. What happened on 2026-11-05 (all verified on GitHub)

- **PR #89** merged at `68a57ec`, giving `main` `9a0cdfe`. It held:
  - the photo-menu test fix;
  - the closing-menu CSS: a fading popover no longer takes taps;
  - HAU-AGENT-LANES-003 (at most two Claude writers, one serial steward);
  - the agent-file reconciliation and the archive.
- **PR #90 (LH-RECORDS-01)** merged at `41521ed`, giving `main` `35f230f`.
  - **Review:** Codex reviewed three rounds. R1 had three P1 findings and R2 had one; all were fixed. R3 on the exact head found no major issues. All required checks were green, and they were green again on `main`.
  - **Roster amendment (003):** the live roster is the steward's cross-repository roster on Earl's PC, and the `CURRENT.md` table is its snapshot.
  - **V1.16.13:** numbered for PR #89's CSS, with two release notes, as `readProduct()` requires 2–5. A regression test sends the checked-in `product-release.json` through the System endpoint.
  - **LH-UI-88:** the accepted spec and its boards are recorded in Git.
  - **Deploy gate:** it now names the absent combined CodeQL check on a merge-button commit. Its decision is unchanged and it still fails closed.
  - **Owner Console:** option 13 (deploy from the PC) is retired and its old code removed.
  - **Records:** stale passages in the docs are reconciled.
- **Kawing-Platform:** PR #5 (two-writer governance) and PR #6 (records) are merged. **Kawing-Platform-Prototype** (formerly qrmenu): PRs #1, #2 and #3 are merged. Every one of those repositories now has only `main`, with no open PRs or issues.
- **Branch pruning:** every merged branch was deleted on GitHub. The local worktrees are kept.
- **LH-UI-88 S1:**
  - A writer session was admitted and then stopped by Earl before it wrote anything.
  - Its local branch `slice/lh-ui-88-s1-foundations` is equal to `35f230f` and was never pushed.
  - **S1 has not started.**

## 2. Standing rules the next agent must keep (Earl's, verbatim where quoted)

- **Writers:** "Maximum two simultaneous Claude file-writing threads globally", across all repositories. Codex and Forge are read-only. ChatGPT reviews, and edits only when Earl scopes the change.
- **Merges:** each merge needs Earl's explicit go-ahead for that PR, and independent review of the exact head first. Codex is triggered by a PR comment containing `@codex review`; its receipt says "Reviewed commit: `sha`". Merge with `gh pr merge N --merge --match-head-commit <sha>`.
- **Destructive operations:** "No branch deletion, reset, force-push, secret access or destructive cleanup" unless Earl authorizes it. Pruning *merged* branches was authorized on 2026-11-05. Preserve every worktree and any dirty work.
- **Secrets:** never print or commit them, including the HAUSC Cloudflare Access credentials. Production mutations, migrations and approving the GitHub `Deploy` environment each need Earl's separate exact go-ahead.
- **Navigation:** "Preserve three-tab behavior until Earl accepts a separate navigation/route mapping". The phone bar stays Home · Find · More.
- **Rounded boxes:** no coloured edge stripe, ring or crescent on any rounded box (rails, verdicts, banners, cards).
- **Versioning:** every deployed visual or functional change is a product revision (`docs/PRODUCT_VERSION_GOVERNANCE.md` §2). It needs `product-release.json` (2–5 notes of 2–180 chars, no `<>`, a 40-hex `sourceCommit`), a release record under `docs/road-to-v2/releases/`, the version pin in `tests/admin-control.test.ts`, and a `CHANGELOG.md` entry. The steward writes the shared files.
- **State words:** a merge is not a deployment. Use MERGED_DEPLOYMENT_UNVERIFIED, DEPLOYED_OWNER_CHECK_PENDING or RELEASED_VERIFIED, and only on evidence.
- **Earl's reports:** when Earl asks for a one-word reply (for example "DONE"), give it only when it is true. Otherwise say briefly what is still open.

## 3. Next work, in order

1. **Earl:** name the next steward (the agent reading this, if he says so).
   - Open a PR from `handoff/steward-2026-11-05`. It is records-only: `.codex/*` and an archive copy of the roster.
   - Merge it on Earl's go-ahead, then delete the branch.
2. **Steward:** log "steward adoption" in the live roster. Its copy is `docs/archive/continuity/WRITER_ROSTER_2026-11-05.md`; the original is on Earl's PC under `handoffs\`.
3. **Steward:** admit **one** writer for **LH-UI-88 S1 Foundations (V1.16.14)** with the brief in §4. Fresh branch from `main`. The old local `slice/lh-ui-88-s1-foundations` worktree may be reused if it is still at `35f230f`.
4. **The S1 PR:** fix every P1 or P2 finding until Codex is clean on the exact head and all checks are green. Then:
   - add the CHANGELOG entry and refresh `.codex/*` as steward;
   - Earl's go-ahead, then merge, then delete the branch;
   - verify `main` CI and Workers Builds;
   - record the release state.
5. **S2 → S5:** repeat one at a time, as V1.16.15 and later. Never run two slices at once, because they all touch `src/styles.css`.
6. **Earl, owed:**
   - Administration > System > This version should read V1.16.13 now, then each new version;
   - paging on a long list (V1.16.12);
   - visual acceptance of each slice;
   - board 01–03 if he wants it reconciled.
   - Issue #88 closes only after all of this.

## 4. LH-UI-88 S1 writer brief

- **Spec:** read all of `docs/specs/accepted/2026-11-05-lh-ui-88-visual-refresh.md`: D1–D10, §3 scope, §4 S1, §5 acceptance and §7 board reconciliation. The boards in `docs/specs/accepted/2026-11-05-lh-ui-88-boards/` are references, not pixel specifications.
- **Scope:**
  - tokens: colour roles per D2–D5 and radii 8/12/16 per D6;
  - about 16px phone gutters, 44×44 targets and 48–52px inputs;
  - 150–200ms motion, off under `prefers-reduced-motion`;
  - one phone breakpoint at 760px (D7). Lists switch at 47.99rem today, in `src/pager.ts` and the CSS;
  - compact maroon header with crest and title, and large page titles;
  - pill search field and filter bar, chips and the view switcher;
  - white cards with hairline borders;
  - solid maroon primary and outlined maroon secondary buttons;
  - tinted status pills with icon and text;
  - sheets: Back, focus return, scroll restore;
  - empty, loading and error states.
- **Owned paths:**
  - `src/styles.css` (tokens and shared components);
  - the tokens in `src/self-service.css`;
  - `src/pager.ts` and `src/ui.ts`;
  - `tests/browser/tab-style.spec.ts` and `tests/browser/ui-media-theme.spec.ts` (update these deliberately);
  - new S1 tests and screenshots;
  - the version files: `product-release.json` V1.16.14, `docs/road-to-v2/releases/v1.16.14.md`, and the pin in `tests/admin-control.test.ts`.
  - **Not owned:** `CHANGELOG.md` and `.codex/*` (the steward's).
- **Limits:**
  - Visual only. Routes, permissions, server calls, the 25-at-a-time paging, quantities and units stay as they are.
  - No D8 navigation change and no D9 features.
  - Gold is never text or a bare icon on light surfaces (D5).
  - No fabricated data and no new dependencies.
  - HTML/CSS/TS, never React.
- **Skills:** Impeccable for execution quality, `web-design-guidelines` for a read-only accessibility check, and `ui-quality-gate` with Playwright for final verification.
- **Gates:**
  - typecheck, build, unit, browser, Worker E2E and `npm run verify:privacy`;
  - widths 320, 375, 390, 430, 768, 1024, 1280 and 1440;
  - light and staff-dark; 200% text; keyboard and focus;
  - no horizontal overflow, clipped text or hidden click targets;
  - before and after screenshots compared with the boards.
- **PR:** open it from `.github/pull_request_template.md` with every gate marked PASS, FAIL, N/A or NOT RUN. Risk tier HIGH. Request a Codex review of the exact head. The writer does **not** merge.

## 5. Resume without chat history

1. `git fetch origin`; `git worktree list`; `git status`.
2. Read `AGENTS.md`, then `CURRENT.md`, then this file.
3. Install with `npm ci` (Node 22, as in CI).
4. Run the checks:
   - `npm run typecheck`;
   - `npm test`;
   - `npm run verify:privacy`;
   - `npm run build`;
   - `npm run test:browser`;
   - `npm run test:browser:worker`.
5. **Windows notes:**
   - **Worker E2E:** it may leave `.wrangler/e2e-*` behind (an `EPERM` on cleanup; the folder is Git-ignored).
   - **Symlink test:** `tests/role-evaluation.test.ts` needs symlink rights.
   - **Timeouts:** `tests/production-release.test.ts` needs `--testTimeout=60000` on a slow PC.
6. **Privacy scan:** `verify:privacy` fails with ENOBUFS on files over about 1 MB. Commit images as compressed JPEGs.
7. **Shell (the Claude desktop app with lean-ctx):** loops, `$(...)` and backticks inside double quotes break. Write scripts to files, and pass `gh` comment bodies with `--body-file`.
8. **Live site:** https://logistics.hausc.org. `build.json` is not public; the version shows in Administration > System.
