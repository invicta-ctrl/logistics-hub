# Every staff page in the revision-3 language — slice specification
ID: LH-IP02-S04 · revision 4
STATUS: ACCEPTED BY OWNER, 23 October 2026 / IMPLEMENTED 24 October 2026 (V1.16.3)
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
- 24 October 2026, Earl: "ship the v2 package", answered as "IP-0.2 redesign, S04", after S03 shipped as V1.16.1. That is the implementation GO; S04 ships as V1.16.3.
- 24 October 2026, Earl, during the slice, from his phone (folded in as owner directions):
  - **Phone clutter:**
    - Items rows: picture, name with its ID and kind, quantity over status; place, alias and the open-units line are left to the item's sheet.
    - The sheet's close button keeps its corner beside a long title, and sheets open without a focus ring on it.
    - The pedestal's note becomes a corner badge on a small tile; the place lines get room.
    - Home's reasons are one sideways row, with Filters and the count on one line; the queue rows drop the repeated "Open the item" link (guarded actions stay).
  - **One place for an item's picture:**
    - Pressing the picture, or its icon before there is a photo, opens one menu: add or change the photo, crop, background, choose an icon, remove.
    - "Take photo" goes, because the phone's own picker already offers the camera.
    - The icon and photo-or-icon choices move from Review & edit to an Item picture sheet opened from that menu.
    - On a phone the menu is a bottom action sheet.
  - **Swipe to dismiss:** a phone's sheet can be dragged down by its header to close it; unsaved changes still ask first.
  - **The pedestal and photo-matched frames reach the public Lending Hub and Self-Service.**
- **Implemented on `slice/ip02-s04-page-bodies`:**
  - **Shared language:** the page frame (48/56 titles, actions level with the lede), quiet views, a pill search, one Filters button at every width, and rows on rules.
  - **Pages:** Items (one primary action; filters open on arrival when the address narrows the list); Stock (Update stock as a sheet at every width); Activity (by day, with time, module icon and sentence).
  - **Administration and account:** My account in two columns; System's checks as a ruled list; figures on a ruled line; places, kits and loans as rows.
  - **Capabilities:** none dropped. Every view, count, filter, address key and guarded action stays.
- **Files beyond the manifest** (all for the owner's directions above): `src/item-photo.ts`, `src/item-visual-control.ts`, `src/item-visual.css`, `src/ui.ts` (sheet focus and swipe; framing everywhere), `src/attention.css`, `tests/browser/locations.spec.ts` and `tests/worker-browser/worker-visuals.spec.ts`.
- **Not done in this slice:** a readiness meter on kit rows and item pictures on loan rows. Their current rows keep their content, now on rules.
