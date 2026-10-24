# Every staff page in the revision-3 language — slice specification
ID: LH-IP02-S04 · revision 4
STATUS: ACCEPTED BY OWNER, 23 October 2026 / NO IMPLEMENTATION GO
Prepared against `slice/ip02-shell-home-landing` at `ff7458a`. Runs after LH-IP02-S03, which owns the Catalog, Locations' place checks and picture presentation; S04 reuses what S03 lands and does not redo it.

INTENT: Finish the redesign: every staff page body speaks the language the shell and Home already speak.
OBJECTIVE: One page frame, one row language, one toolbar and sheets for secondary forms across Items, Stock, Loans, Locations, Kits, Self-Service review, Activity, Administration and My account. No page loses a capability, a count, a filter, an address key or a guarded action.
TARGET: The staff page bodies listed in the manifest.
AUTHORITATIVE SOURCES: Owner direction of 23 October 2026 ([REVISION_4.md](REVISION_4.md)); [prototype-r4](prototype-r4/index.html) as visual intent; the accepted revision-3 tokens ([SLICE_01_VISUAL_TOKENS.md](SLICE_01_VISUAL_TOKENS.md)).
OUT OF SCOPE: Behaviour, data, permissions, API, schema, migrations, Worker routes, offline storage, the public pages, the Self-Service app, and anything S03 owns.
STOP CONDITIONS: S03 not landed; a page needing a behaviour change to fit the layout; a manifest file outside the list; failed checks; unavailable rollback.

## The shared language
Every page uses the same parts, drawn from revision 3's tokens:
1. **Page frame.**
   - A Newsreader 48/56 title (36/44 on phones) and one lede line.
   - At most one primary action and one secondary action.
   - The live status sits beside them.
2. **Views.**
   - One row of quiet tabs with counts.
   - A 2 px accent underline marks the current view.
   - The row scrolls sideways on phones.
   - The address keys each page uses today stay as they are.
3. **Toolbar.**
   - A pill search (40 px; 48 px on phones).
   - One Filter button that holds the page's existing selects.
   - A count of what is shown.
4. **Rows instead of boxed tables.**
   - Content: a picture or icon, name and reference, up to two context columns, quantity and status, and a chevron that appears on hover.
   - Feedback: hover and press states.
   - Narrow screens: under a 720 px container a row keeps only picture, name and quantity/status.
   - Status: always stated in text, with a marker.
5. **Sheets.** Secondary forms that are panels or inline blocks today (for example Stock's always-open Update stock panel) open as the existing sheet from the primary action.
6. **Empty states** sit on the page (icon, heading, one sentence, one action), not inside a bordered box.
7. **Figures.** Numbers sit on one ruled line, not in a grid of cards (Administration › Catalog).

## Per page (capabilities kept, layout changed)
| Page | Source | Layout change | Must keep |
|---|---|---|---|
| Items | src/staff.ts | Photo rows; review progress in the lede; item sheet led by the picture, then on-hand, then Overview, Review and edit, History | Views and their counts, filters, select and bulk actions, deep links (`?item=`, `?add=1`, `&tab=`), photo flows from S03 |
| Stock | src/stock-workspace.ts | One-tap filters; rows with on-hand, why and the one primary action; Update stock as a sheet | Views, reorder note, row menus and their keyboard behaviour, pending and conflict states |
| Loans | src/loans-workspace.ts, src/loan-form.ts | Rows with the item picture and due status; Lend an item as a sheet | Views, deep links (`?loan=`, `view=history`), the focused-row behaviour, loan photos |
| Locations | src/locations-workspace.ts, src/location-tree.ts | Rows with item count and last check; place sheet (S03 adds the check) | Tree order, inactive toggle, place media and reports |
| Kits | src/kits-workspace.ts, src/kits.css | Rows with a readiness meter; templates below | Kit and template flows, components, replenish |
| Self-Service review | src/self-service-review.ts | Records to check as rows | Views, QR code and poster, the identity decisions |
| Activity | src/activity-workspace.ts, src/activity.css | Feed grouped by day with time, module icon and sentence | One viewport tall, filters in the address, export, older pages |
| Administration | src/admin-frame.ts, src/admin-system.ts, src/admin-self-service.ts, src/admin.ts, src/admin-accountability.ts, src/directory-workspace.ts (frame only), src/admin.css | Tabs as views; System as a ruled list of checks under one status line; Staff as rows | Every check, toggle, account and directory flow; role gating |
| My account | src/admin.ts (`myAccount`), src/account-ui.ts | Profile and password in the main column; sessions and the recovery key beside them | Every account action and its confirmations |

Shared styles: src/styles.css (page frame, views, toolbar, rows, empty state, figures).

## Exact test write manifest
Limited to assertions that depend on page structure:
- tests/browser/app.spec.ts
- tests/browser/large-lists.spec.ts
- tests/browser/stock-loading.spec.ts
- tests/browser/locations.spec.ts
- tests/browser/audit.spec.ts
- tests/browser/card-wall.spec.ts
- tests/browser/accessibility.spec.ts
- tests/browser/tab-style.spec.ts
- tests/browser/visual-depth.spec.ts
- tests/browser/live.spec.ts
- tests/browser/polling.spec.ts
- tests/worker-browser/worker-live.spec.ts
- tests/worker-browser/worker-v115-phone.spec.ts

## Verification
- Typecheck and build.
- The full browser and worker-browser suites.
- Privacy scan and `diff --check`.
- Rendered review of every page at 390/768/1280/1440 in light and staff-dark, with loading, empty and error states.
- One bounded Impeccable pass. The UI quality gate last.
- Implementation may land in checkpoints, one page group at a time, each green.

## Acceptance record
- 23 October 2026, Earl: "I accept revision 4's visual intent and LH-IP02-S03 and LH-IP02-S04 as written."
- Pending: a separate implementation GO, given after LH-IP02-S03 lands.
