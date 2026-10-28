# Shell + merged Home workspace — exact candidate slice specification
ID: LH-IP02-S01 · revision 3
STATUS: ACCEPTED BY OWNER, 23 OCTOBER 2026 / READY FOR IMPLEMENTATION KICKOFF / NO IMPLEMENTATION GO
Prepared 2026-10-20 against remote main 6b8454a34ba3e138a945e78fc3264970bf54ddf3. Revised 2026-10-22 after the owner accepted merging Home and Attention ([REVISION_2.md](REVISION_2.md)). Revision 2 source facts were read only at 6b8454a. The local `origin/main` tracking ref has since moved to f61ee1b and was not fetched or inspected.
Revised 2026-10-23: the owner said revision 3 "looks right" and named [prototype-r3](prototype-r3/index.html) as the visual intent ([REVISION_3.md](REVISION_3.md)). Revision 3's visual items replace revision 2's in the pending list. The file and test manifests are unchanged; contract item 8 and journeys 5 and 11 follow revision 3's removals.
Signed off 2026-10-23: the owner accepted the remaining pending items (see the acceptance record). The exact visual values are in [SLICE_01_VISUAL_TOKENS.md](SLICE_01_VISUAL_TOKENS.md). Read-only recheck at the local `origin/main` tracking ref f61ee1b1 (not fetched):
- every manifest file and the source facts below are unchanged, including the line numbers;
- the only difference in the slice's files since 6b8454a is three deleted lines in `src/styles.css`.
Refresh exact base, full diff, permitted worktree and runtime identity before implementation.

INTENT: Define the first independently useful application slice; this document authorizes no application edits.
OBJECTIVE: Replace shared staff navigation and present Home and Attention as one Home workspace, retaining all existing contracts and keeping other routes usable.
TARGET: Existing staff shell, Home and Attention.
AUTHORITATIVE SOURCES: Owner conditional acceptance, the 22 October Home + Attention merge acceptance and the 23 October direction naming revision 3 as the visual intent; current accepted specs/workflow; source files listed below; [prototype-r3](prototype-r3/index.html) as proposed visual intent only.
IN SCOPE: Grouped navigation, responsive shell, the merged Home workspace (queue + context column), the Attention route as an entry into it, existing search integration and state/focus behavior.
OUT OF SCOPE: Backend/API/schema changes; new workflow policies; new persisted views; new state platform; redesigning all other module bodies; production.
CONSTRAINTS: Preserve V1.16 custody, current role/access rules, data invariants and release identity.
DELIVERABLES: One working, verified future slice plus exact checkpoint/review evidence.
VERIFICATION: Named focused suites, required checks, matrix below and independent audit.
STOP CONDITIONS: Final scope not accepted, no separate GO, conflicting writer, unknown diff, changed contract, failed checks or unavailable rollback.

## Merged workspace contract (from revision 2; item 8 updated in revision 3)
Facts at 6b8454a: `src/main.ts` routes `/staff/home` (line 23) and `/staff/attention` (line 31) to separate modules. Attention reads `source`, `urgency`, `age` and `reason` from the URL and writes them back through `writeParams`. These files link to `/staff/attention`, with or without those keys:
- `src/staff-shell.ts:77` (the bell)
- `src/search.ts:311,317`
- `src/home.ts:111–112`
- `src/admin-catalog.ts:98`
- `src/home-workspace.ts` (reason links, "Open Attention", the error recovery)

The merge is made without changing the router or any of those linking files:
1. **One workspace, two entries.** `homeWorkspace` and `attentionWorkspace` mount the same composition: page heading, Attention queue and context column. Both keep their route entries in `src/main.ts`, which stays unchanged.
2. **Defaults preserve meaning.** `/staff/home` opens on active work (NOW + SOON), the same set as Home's existing total. `/staff/attention` opens with exactly the entry set it shows today for the same URL keys, including its "any urgency" default when `urgency` is absent. No existing deep link changes which records it shows.
3. **One queue implementation.** Filtering, grouping, bounded "first N of total" lists, guarded actions and polling exist once, owned by `attention-workspace.ts`. Home composes them and does not duplicate them. There is one live poll per visit, not one per entry.
4. **Reason links filter in place.** On Home, a reason group (today `attentionHref`, `/staff/attention?reason=…`) sets the queue's existing `reason` key without leaving the page. Its count and the filtered list stay the same set. "Open Attention" and "Everything in Attention" become the queue's existing Clear / Show everything.
5. **Shell.** Home is the single active destination for both entries; there is no separate Attention navigation item. The bell keeps its count and its `/staff/attention` link. Loans/Stock attention badges are unchanged.
6. **Context column.** *(Amended by [V1.16.4](../2026-10-24-v1.16.4-integrated-cleanup.md) §4.1: Insights are a closed disclosure, asked for only when opened, on Home and in Attention's context column; the catalog completeness card is no longer shown.)* With nothing selected, it shows the existing resumable place checks and the independent advisory insights. With an entry selected, it shows one record document (no Overview/Activity tabs): urgency and reason, the fields the `Entry` already carries (title, why, since/age, source, action/href), activity derived from `since`, and the entry's existing source action and guarded actions. Facts the entry does not carry, such as the prototype's place and quantity lines, are not fetched by this slice. Showing them needs a separate amendment.
7. **Selection and history (accepted 23 October).** Selecting an entry is reflected through the existing `writeParams` mechanism with one key, `entry`, holding the existing `Entry.key`. Opening adds one history entry, so Back closes the document (on phone it closes the sheet). Switching between entries while one is open replaces that history entry. An `entry` value that no longer matches a loaded entry is dropped quietly, leaving the queue unchanged.
8. **Queue text search** was removed in revision 3, because global Find already locates a record. It is not part of this slice unless the owner restores it. If restored, its count states that it searches loaded entries only and never implies a server-wide match.

## Exact candidate source write manifest
One future Writer owns these files exclusively for this slice, only after accepted transfer:
| File | Permitted change | Boundary |
|---|---|---|
| src/staff-shell.ts | Grouped navigation and responsive frame; Home as the one active destination for both entries; bell/count unchanged; menu/search/theme hooks, focus and cleanup | Keep session redirects, hub=false and forced-password paths, role gating, live counts, attention summary request and sign-out contract |
| src/styles.css | Shell tokens, shared semantic component styling and constrained compatibility rules | V1.16 existing CSS delta must be reconciled and custody explicitly transferred first; no unrelated module restyle |
| src/home-workspace.ts | Merged composition: heading, queue (from attention-workspace.ts), context column with resume checks and optional insights; reason links filter in place | No new fetch model, advisory algorithm, catalogue-resume feature or altered count; insights never gate the queue |
| src/home.css | Home density, type, surfaces, context column and responsive layout | No dependency on optional insights to render core work |
| src/attention-workspace.ts | Queue as a mountable part shared by both entries; `attentionWorkspace` becomes the Attention entry into the merged workspace; record document from existing entry fields; guarded actions | Existing URL keys and their entry sets, bounded results, action guards, polling and behavior retained |
| src/attention.css | Queue, record document, states, local responsive reflow | No new cross-module detail implementation or duplicated source-of-truth state |

No other source file changes by default. That includes src/main.ts, src/ui.ts, src/search-palette.ts, src/search.ts, src/home.ts, src/admin-catalog.ts, src/theme.ts, Worker/API, migrations, PWA/service worker, product-release metadata, font dependencies and build configuration. The merge needs none of them, because both route entries remain and existing links keep their meaning. If one becomes necessary, stop and amend this manifest with a concrete reason. Use the existing palette and theme mechanisms; prototype-only controls are never ported.

## Exact candidate test write manifest
Extend existing tests only when necessary to express changed behavior or preserve meaningful regressions:
- tests/browser/staff-shell.spec.ts
- tests/browser/shell.spec.ts
- tests/browser/home.spec.ts
- tests/browser/attention.spec.ts
- tests/browser/accessibility.spec.ts

**Amendment, 23 October 2026 (owner):** "Amend LH-IP02-S01's test manifest to include search.spec, ui-media-theme.spec, large-lists.spec, catalogue.spec, app.spec, worker-live.spec and worker-v115-phone.spec." The side-rail shell changes structure those suites assert, so the manifest also includes these files, limited to their shell-dependent assertions:
- tests/browser/search.spec.ts
- tests/browser/ui-media-theme.spec.ts
- tests/browser/large-lists.spec.ts
- tests/browser/catalogue.spec.ts
- tests/browser/app.spec.ts
- tests/worker-browser/worker-live.spec.ts
- tests/worker-browser/worker-v115-phone.spec.ts

Read/reuse existing tests/home.test.ts, tests/home-performance.test.ts, tests/attention.test.ts, tests/attention-performance.test.ts as contract regressions; no default edits to server tests. Synthetic fixtures stay within approved test mechanisms and contain no private records. If a new fixture/helper file is required, explicitly add its path before work. Do not add mirror tests that merely reproduce CSS implementation.

Future records: the steward-authorized .codex/CURRENT.md and .codex/SESSION_HANDOFF.md, the slice checkpoint and existing release evidence identified at kickoff. These remain prohibited during current V1.16 custody. Proposed specification destination: docs/specs/proposed/2026-10-20-ip02-shell-home-attention.md until final acceptance; move/link through existing document authority rather than retaining two normative copies.

## Required user journeys
1. Enter Home through a valid staff session; preserve must-change-password and non-Hub account redirects. Role/access variants remain server-authoritative; role labels never confer access.
2. Navigate every currently authorized destination from desktop rail, tablet menu and phone navigation/More. Public routes and restricted account surfaces retain their current shell rules. Links preserve paths/query semantics; current route has one clear active state, and both Home entries mark Home.
3. Home shows NOW+SOON Attention totals and reason counts from the shell's existing answer; routine LATER work is separate. Choosing a reason filters the queue in place to the same set its count describes.
4. Continue a paused place check from the context column using the current destination. The current Home implementation displays checks, not a newly invented catalogue-resume function.
5. Insights load independently after core work, with source/window and advisory meaning retained; revision 3 shows them on demand behind "About this insight". Slow/error/expired late responses cannot disrupt a route already left.
6. The queue retains source, urgency, age and reason filtering, Clear/Show everything, URL/history, grouping and bounded "first N of total" behavior. Counts distinguish loaded entries and full group totals; do not recalculate a server-wide total from a truncated list.
7. Every existing `/staff/attention` link opens the merged workspace and shows exactly the entry set it shows at the base for the same keys. That covers the bell, the search entries "Attention" and "Overdue loans", the Home insight progress links, the Catalog administration note, and bookmarked URLs with `source`, `urgency`, `age` or `reason`.
8. Select an entry to read its record document beside the queue (desktop) or in a sheet (tablet/phone). The document shows only already-available authorized entry data and keeps the direct source link. If a separate request or new detail contract is needed, keep the direct link for this slice and amend later.
9. The existing conditional Mark reviewed, Confirm identity, Ignore and Keep both operations remain governed: current confirmations and guards, disabled/busy state, server response, error recovery, repeat-submit prevention and count refresh. They behave identically from the record document and the queue. This slice introduces no new approval policy.
10. Keyboard triage: the queue is one tab stop with roving focus. ↑/↓/Home/End move between entries; Enter/Space opens the record document; while a document is open, moving focus also moves the selection. Esc closes the document and returns focus to its entry. Previous/next controls in the document do the same by pointer.
11. Existing global search and page shortcuts remain discoverable, permission-aware and usable by touch. Retain the current Ctrl/Cmd+K workspace binding only outside editable fields and IME composition, with platform-accurate hints. This intentionally takes precedence over the browser's Ctrl+K search while the workspace body is focused; the owner accepted that explicit tradeoff with this specification on 23 October. No other browser shortcuts are intercepted. Revision 3 has no `/` queue-search key, which would also have intercepted Firefox Quick Find. Escape and close restore context.
12. Navigate away/back and between the two entries without duplicate polling, listeners, stale announcements, mismatched counts or unintended history entries.

## Exact responsive/visual acceptance
At 390/768/1280/1440, capture Home and the `/staff/attention` entry in light and staff-dark themes on fixed approved synthetic fixtures: nothing selected, one entry selected, and loading. Also smoke every current staff route under the new shared shell. Public bodies remain unchanged.

- 1440/1280: grouped rail, with the HAU USC crest at the top and the Department of Logistics mark and account at the bottom (owner-directed placement, 22 October). No context bar. The queue sits beside a full-height context column whose record action stays in view without scrolling the page. On windows shorter than 960px the rail tightens so every destination stays visible. In narrow queue containers each row's urgency moves under its text rather than colliding with it.
- 768: navigation collapses to a 72px icon rail with tooltips plus an "All destinations" drawer. The queue keeps the full width; the context column sits below it; a selected record opens as a side sheet.
- 390: the phone header, the Home · Find · More bar and the More drawer expose all authorized routes. A selected record opens as a bottom sheet whose actions are not covered by the mobile keyboard or safe area. References and times never break across lines, and the body has no accidental horizontal clipping.
- Large text/zoom: use wrapping/reflow; essential labels, counts, action consequences and focused controls remain reachable.
- Typography: preserve IBM Plex Sans and Newsreader from existing font dependencies and approved marks, with no third family. Text never shrinks below its role to fit; rows grow or wrap instead.
- Depth: a neutral work panel inside the brand frame, fine separators, and offset shadows only where something is raised. Blur appears only on layers that float over content. Final chosen values require owner visual acceptance.
- Feedback: every interactive element has distinct hover (fine pointers only), focus-visible and pressed states. Icon-only controls carry an accessible name and a visible tooltip that no container can clip. Urgency is always stated in text (group label and record status), never by colour alone; Later uses a hollow marker.
- Motion: short contextual panel/sheet/selection feedback, interruption-safe; nothing loops, and reduced motion removes nonessential travel. No animated layout polling or delayed success.
- Revision 3 visual language, accepted by the owner on 23 October. The exact values are in [SLICE_01_VISUAL_TOKENS.md](SLICE_01_VISUAL_TOKENS.md); all 26 checked colour pairs meet WCAG 2.x contrast.
  - **Colour:** a neutral white/stone base with HAU USC maroon (#7a1419) as the single accent. Gold appears only in the rail count badge, the active rail icon and the Soon marker. Staff-dark keeps maroon buttons, uses gold for text accents and gives Now a soft red.
  - **Frame:** an oxblood maroon #7a1419 brand frame (deep oxblood #2b0a0c in staff-dark) around a rounded work panel. This was amended by the owner on 23 October from the earlier near-black frame.
  - **Spacing and type:** 8pt spacing, with 4px and 12px half-steps. Two families:
    - Newsreader 600 at 48/56 (36/44 on phone) and 32/40;
    - IBM Plex Sans at 24/32, 15/24, 13/20 and 12/16 small caps.
  - **Glass, only on floating layers:** the Find palette, the filter menu, the phone header and bottom bar, the record's sticky bars, and a blurred dialog backdrop.
  - **Icons:** one redrawn outline family with no icon tiles. The avatar and icon-button highlights are circular.
  - **Motion:**
    - row hover and press;
    - the sliding view indicator;
    - button lift and arrow nudge;
    - the insight disclosure;
    - popover, dialog and sheet transitions;
    - the row title travelling into the record heading (View Transitions with an instant fallback);
    - a row-shaped skeleton with one shared sweep;
    - a one-time Now pulse.
  - **No longer proposed:** revision 2's urgency horizon tint (dropped in revision 3).

## States and functional parity
Demonstrate loading, no data, no matches, error/retry, denied, stale and offline at the applicable boundary. Loading uses a skeleton shaped like the queue and context column, with counts as placeholders. It appears only while a real request is pending: no synthetic delay. The prototype's short boot delay exists only to show the state. Conflict and receipt states apply only to actual existing actions/subflows; do not add a phone receipt to ordinary Home to satisfy a screenshot grid. Preserve drafts/focus where current actions support them. Queued phone data, submitted event and accepted server mutation remain distinct. No success toast before authoritative success; no fake save/stock movement.

Prototype controls and simulated receipts illustrate the broader design system. They are not accepted application features. Their controls, synthetic destination dialogs and data never enter production source.

## Verification plan (future execution only)
1. Record exact branch/HEAD/upstream/diff, owner/lock, other-lane state, base and deployed identity; inspect complete logical diff before commit.
2. npm run test -- tests/home.test.ts tests/home-performance.test.ts tests/attention.test.ts tests/attention-performance.test.ts
3. npm run test:browser -- tests/browser/staff-shell.spec.ts tests/browser/shell.spec.ts tests/browser/home.spec.ts tests/browser/attention.spec.ts tests/browser/accessibility.spec.ts. Include entry-continuity cases: every link listed in the merged workspace contract yields the same entry set as at the base; Home reason filtering matches its count; one poll per visit across both entries; Back/Forward with and without a selected entry.
4. npm run build (includes required typecheck); npm run verify:privacy; git diff --check.
5. Run required Worker/browser/exact-head CI/security checks according to current repository gates; do not claim browser mocks prove Worker/server permission or real release acceptance.
6. Human keyboard/screen-reader, zoom/large-text/reduced-motion/forced-colors and viewport/theme/role matrix, including roving queue focus, sheet/menu/dialog focus and touch equivalents.
7. Compare baseline/candidate bundle and request/render behavior with same fixtures/device/cache and exact builds. Set budgets from measured baseline before accepting a regression allowance. Confirm the merge does not load the Attention module twice or add a request to Home's first render.
8. Independent read-only Auditor reviews the exact implementation/test diff. Resolve material findings, then root/steward accepts only this slice.

These are required future checks, not checks executed on the application by this research task. A browser screenshot or prototype pass never substitutes for this plan.

## Ownership, integration and rollback
Current writer stays V1.16; no new application lane is activated. A future kickoff names one permitted Writer and independent Auditor, exact file transfer including styles.css, and serial integration steward. Revalidate base after V1.16 integration; reconcile other lanes before any rebase/merge. Native governance and the project's permitted-worktree rules apply.

Before implementation, record known-good source/build/runtime identities and the recovery path. No schema migration is expected. Revert the complete atomic slice if its shell harms other routes. Because both route entries and every linking file stay unchanged, a revert restores the separate Home and Attention pages without link repair. Preserve the exact previous artifact and use the existing controlled rollback process if later deployed. Verify recovered navigation/roles/Home/Attention and other-route smoke. A source revert alone is not deployment rollback evidence. Do not remove recovery artifacts or unknown work.

## Acceptance record
Candidate slice concept: accepted by owner. Home + Attention merge into one workspace: ACCEPTED by owner, 22 October 2026. Visual intent: prototype-r3, named by the owner on 23 October 2026 ("Revision 3 looks right").

ACCEPTED by owner, 23 October 2026 ("I'm ready to sign those off"):
- the file/test manifest and the merged workspace contract;
- the `entry` selection key;
- revision 3 visual language and [SLICE_01_VISUAL_TOKENS.md](SLICE_01_VISUAL_TOKENS.md);
- the behavior/visual contract and the rollback above.

Revision 3's removals (density toggle, queue text search, the `/` shortcut, the keyboard-shortcut panel) stand; the owner has not restored any of them.

**Ready for implementation kickoff.** Before any writer starts, these still apply:
- refresh the exact base;
- confirm V1.16 custody and the `src/styles.css` reconciliation;
- name one Writer and an independent Auditor;
- record recovery identities.

Application implementation GO: NOT GIVEN. It is a separate owner decision. No merge/deploy/prune is authorized by accepting this specification alone.
