# Catalog in the workspace, and picture presentation — slice specification
ID: LH-IP02-S03 · revision 4
STATUS: ACCEPTED BY OWNER, 23 October 2026 / D1, D2, D2a, D3 DECIDED / NO IMPLEMENTATION GO
Prepared against `slice/ip02-shell-home-landing` at `ff7458a` (S01 and S02 implemented, pushed, no PR). Read-only facts below were checked at that commit.

INTENT: Fold website cataloguing into the workspace as a sheet under Administration, keep the offline Catalog as the installed app only, and present item pictures the way revision 4 shows.
OBJECTIVE: A person on the website never lands in a separate Catalog module with no way back. Cataloguing is the Add items sheet in session mode, with the place as a field. Photos on solid backgrounds sit in matching frames. Cut-outs stand on a pedestal.
TARGET: Staff shell rail, Administration › Catalog, the Add items sheet, Locations' place sheet, item pictures (lists, item sheet, capture).
AUTHORITATIVE SOURCES: Owner direction and answers of 23 October 2026 ([REVISION_4.md](REVISION_4.md)); [prototype-r4](prototype-r4/index.html) as visual intent; the accepted revision-3 tokens ([SLICE_01_VISUAL_TOKENS.md](SLICE_01_VISUAL_TOKENS.md)); Final Pass FP-E for background removal.
IN SCOPE: Rail entry removal; website routing of `/staff/catalogue`; the Catalog sheet; place checks reachable from Locations; background matching; the pedestal.
OUT OF SCOPE:
- the installed Catalog app's own screens (except the way back, below);
- offline storage and leases;
- every API, schema, migration and Worker route;
- the cut-out pipeline, its monthly cap and its acceptance check;
- any AI or provider setting;
- the Self-Service app and the public pages.
STOP CONDITIONS: A needed server change; a manifest file outside the list; failed checks; unavailable rollback.

## Facts at `ff7458a`
- `src/main.ts:25` routes `/staff/catalogue` to `catalogue-workspace.ts`. The route lives on its own page, `staff/catalogue.html`, with its own manifest; `main.ts:47–69` reloads between the two pages.
- `src/catalogue-shell.ts` frames the Catalog without the staff shell, which is why the website shows no way back.
- `src/catalogue-capture.ts` already sends a `locationId` with each captured item ("Next items are in", line 151), and a `direct` session mode backs Add items (`src/catalogue.ts:126–138`).
- `src/admin-frame.ts:29` sends the STAFF role away from every Administration page.
- `src/audit-screen.ts` (`checkScreen`, `checksCard`) runs place checks only from `catalogue-workspace.ts` (`?audit=`).
- Background removal (FP-E): `src/item-cutout.ts` (Worker), `src/cutout-share.ts` (browser judging and `subjectCrop`), `src/item-photo.ts` (photo type and controls). Item pictures draw through `itemVisual` (`src/ui.ts:91`) with `src/item-visual.css`.

## Contract
1. **Rail.** Catalogue is not a rail destination on the website. In search, the existing "Add items" shortcut (`src/search.ts:319`; its terms include "catalogue" and "catalog") stays as it is. Those who may open Administration › Catalog also get a "Catalog" result that opens it.
2. **`/staff/catalogue`** (D2 as refined by D2a; facts: `staff/catalogue.html` links `catalogue.webmanifest`, `start_url` `/staff/catalogue`, scope `/staff`).
   - **In the installed app** (`display-mode: standalone`): unchanged.
   - **In a browser tab:** the Catalog's own page, so it stays installable, but showing only the install view:
     - the Catalog is an app;
     - Install (the existing flow in `src/pwa.ts`, with the existing iOS steps);
     - Open the staff workspace;
     - for administrators, Catalog in Administration (`/staff/admin/catalog`).
   - No session, capture or check runs in a browser tab.
   - An old `?audit=` link goes straight to the place check in Locations (item 6).
3. **Administration › Catalog.**
   - The tab leads with Start cataloguing and the person's last session.
   - The existing classification figures and Other names follow, unchanged in meaning.
   - A note says the offline Catalog is the installed app. Its Install the Catalog app opens `/staff/catalogue` (item 2).
4. **The Catalog sheet** is the Add items sheet in session mode. It starts (or resumes) a session through the existing `POST /api/staff/catalogue/sessions`.
   - "Cataloguing in" is the first field and defaults to the last place used.
   - Every save sends that `locationId`, as capture does today.
   - The sheet stays open after a save, clears the name and photo, keeps the place, and counts "N saved in <place>".
   - Finish session ends it the way the Catalog does today.
   - No save is shown as done before the server confirms it.
5. **Who** (D1).
   - On the website, the Catalog sheet is for administrators only, under Administration, which stays closed to the STAFF role (`src/admin-frame.ts:29`, unchanged).
   - Hub staff catalogue in the installed app, as today.
   - The Add items sheet from Items is unchanged for everyone who has it today.
6. **Place checks** (D3). A place's sheet in Locations offers Check this place. It opens the existing check screen inside the staff shell. Resuming a paused check works from the place sheet and from Home's Continue.
7. **Way back in the app.** The installed Catalog keeps its own frame. Its signed-in menu gains "Open the staff workspace", so even the app is never a dead end.
8. **Background matching** (D5).
   - **Where:** a picture's frame takes the photo's own edge colour when the edge is near-uniform: mean of the outer pixels, largest channel spread ≤ 12. This applies to item rows, the item sheet, capture and the Catalog sheet.
   - **When not:** a busy edge, an unreadable picture or a cut-out keeps the neutral frame.
   - **Contrast:** matching never lowers the contrast of anything drawn on the frame. Labels on a matched frame use the glass treatment.
9. **Pedestal** (D4). An accepted cut-out is drawn cropped to its subject (the existing `subjectCrop`) and stood on the pedestal:
   - studio floor;
   - plinth with a shaded side and a lit top;
   - contact shadow.
   It appears in the item sheet, item rows and the Catalog sheet, in light and staff-dark.

   The controls:
   - "Background removed" labels it.
   - "Use the original photo" and "Remove background" sit under the picture, with the existing guard, cap and failure text.
   - The original photo is always kept.

## Exact source write manifest
| File | Change | Boundary |
|---|---|---|
| src/staff-shell.ts | Remove Catalogue from the rail sections; keep everything else S01 settled | Session, role and count behaviour unchanged |
| src/search.ts | A "Catalog" result for those who may open Administration › Catalog | The Add items shortcut and record search unchanged |
| src/main.ts | `?audit=` on `/staff/catalogue` in a browser tab goes to the place check in Locations | Catalog page and manifest switching unchanged |
| src/catalogue-workspace.ts | In a browser tab (not `display-mode: standalone`), the install-only view | Everything in the installed app unchanged; uses `src/pwa.ts` unchanged |
| src/admin-catalog.ts | Cataloguing section, Start cataloguing, last session, app note | Figures and Other names unchanged |
| src/staff.ts | Add items sheet gains session mode (place field, stay open, count, finish) | Single Add items unchanged |
| src/locations-workspace.ts | Place sheet: Check this place, Resume the check | Place data and permissions unchanged |
| src/audit-screen.ts | Mountable inside the staff shell | Check rules, outcomes and settling unchanged |
| src/catalogue-capture.ts (amendment, 23 Oct 2026) | Separate "embedded in a host" from "direct Add items mode", so a place-based session can run inside the Catalog sheet | Capture rules, saving, sync and the installed app unchanged |
| src/catalogue-shell.ts | "Open the staff workspace" in the signed-in menu | Offline frame unchanged |
| src/item-photo.ts | Pedestal presentation and the controls' placement | FP-E guard, cap and acceptance unchanged |
| src/photo-frame.ts (new) | Edge sampling and the frame colour; the pedestal markup helper | Browser only; stores and sends nothing |
| src/ui.ts | `itemVisual` calls the frame helper | Signature unchanged |
| src/item-visual.css, src/admin.css, src/styles.css | Frame, pedestal, Catalog tab and sheet styles from revision 4 | Revision-3 tokens only |

## Exact test write manifest
- tests/browser/staff-shell.spec.ts, tests/browser/shell.spec.ts: rail without Catalogue.
- tests/browser/catalogue.spec.ts: the browser-tab install view, the installed-app page (emulated standalone), the way back, `?audit=`.
- tests/browser/app.spec.ts: picture frames and the pedestal on item rows.
- tests/browser/accessibility.spec.ts: the Catalog sheet and the pedestal at 320–1440 and 200% text.
- tests/browser/search.spec.ts: the Catalog search result.
- tests/worker-browser/worker-live.spec.ts, tests/worker-browser/worker-v115-phone.spec.ts: the session sheet against the real Worker, phone targets and safe areas.

A new fixture file is added only by naming it here first.

## Verification
- Typecheck and build.
- The focused suites above, then the full browser and worker-browser suites.
- Privacy scan and `diff --check`.
- Rendered review at 390/768/1280/1440 in light and staff-dark: Items, the item sheet (photo, matched, cut-out), the Catalog sheet before and after two saves, a place check from Locations.
- One bounded Impeccable pass. The UI quality gate last.

## Acceptance record
- 23 October 2026, Earl: "D1: staff catalogue only in the installed app; on the website the Catalog is under Administration for administrators. Accept D2 and D3 as proposed."
- 23 October 2026, Earl: "Accept D2a: in a browser tab, /staff/catalogue shows only the install view (install, open the staff workspace, and for administrators Catalog in Administration)."
- 23 October 2026, Earl: "I accept revision 4's visual intent and LH-IP02-S03 and LH-IP02-S04 as written."
- Pending: a separate implementation GO.
- 23 October 2026, Earl, at implementation: accepted the manifest amendment adding `src/catalogue-capture.ts`. The capture screen's one `direct` argument meant both "inside this host" and "Add items mode", so a place-based session could only draw the Catalog's own frame over the page.
- 23 October 2026, Earl, at implementation: accepted the test-manifest amendment adding `tests/browser/audit.spec.ts`. Its place-check tests drove the Catalog in a plain browser tab, which now shows only the install view (D2a); they now open it as the installed app, unchanged otherwise. The in-workspace check path is tested in `catalogue.spec.ts`.
- 23 October 2026, Earl, at implementation: accepted the test-manifest amendment adding `tests/worker-browser/worker-v115-cleanup.spec.ts`. It asserted the cleaned picture's tile address and the "Use original" label; the pedestal shows the cut-out itself and the button reads "Use the original photo". Only those presentation assertions change; the cleanup flow, cap and checks it verifies are unchanged.
- 24 October 2026, Earl, at implementation: accepted the test-manifest amendment adding eight worker-browser suites, limited to assertions that follow the accepted changes.
  - **S01 follow-ups:** `worker-locations`, `worker-v115-journeys`, `worker-v115-optional` and `worker-v115-refresh`. S01's gate ran only the two worker suites in its manifest, so these four broken assertions reached the pushed S01 commit `ff7458a`; this amendment repairs them.
  - **S03:** `worker-v15-catalogue`, `worker-v16-catalog-pwa`, `worker-v17-location-audit` and `worker-v115-review-ai` now run the Catalog as the installed app.
- 24 October 2026: implemented on `slice/ip02-shell-home-landing` as `73958a1`, after the S01 test follow-up `5a93cf4`. Both were pushed to `origin` the same day at Earl's instruction.
  - **Gate:** full browser suite 287/287; full worker-browser suite green across runs (90 tests); typecheck and build; privacy scan and `diff --check`. Unit tests run serially fail only `production-release` (known Windows-only) and `role-evaluation`, which fails the same way at the committed base `ff7458a`.
  - **Deviation:** `src/staff.ts` needed no change. The session sheet lives in `src/admin-catalog.ts` and reuses the capture screen directly.
- 24 October 2026, Earl, before the pull request: "make remove bg, crop, and change photo be in the same place when I click the photo proper not a dedicated button below it. also remove the subtext 'background removal keeps the original photo'".
  - **Implemented:** an item photo opens one menu from the photo itself: View larger, Change photo, Take photo, Crop thumbnail, Remove background (or Use the original photo, or Enable background removal), and Remove photo. The separate edit buttons under the photo and the "The original photo is kept." note are gone. The viewer's Edit photo opens the same menu. Kit and place pictures are unchanged.
  - **Files:** `src/item-photo.ts`, `src/ui.ts` (two icons), `src/item-visual.css`, `src/styles.css` and `src/staff.ts`, whose viewer now grows from the photo tile. Tests: `tests/browser/catalogue.spec.ts`, `tests/worker-browser/worker-live.spec.ts` and `tests/worker-browser/worker-v115-cleanup.spec.ts`. Only their assertions about where the controls are shown change.
  - **Outside the test manifest:** `tests/worker-browser/worker-visuals.spec.ts` opened the viewer with the old "View photo of" button. It is a direct consequence of this instruction, so it now opens the viewer through the photo's menu, recorded here rather than held for a separate amendment.
  - **Also fixed while doing this:** a redraw of the photo panel (the profile refreshing after a rejected cut) used to close a menu the person had open, and now opens it again. The menu opens from the photo's left edge (`data-row-menu="start"`, an option of the shared row-menu positioning in `src/ui.ts`) and sizes to its longest choice.
  - **Gate:**
    - Typecheck and build pass.
    - Full browser suite 287/287; full worker-browser suite 90/90.
    - After the last CSS-only change: the photo browser suites `catalogue`, `app` and `accessibility` (130 tests) and the photo worker suites `worker-v115-cleanup`, `worker-live`, `worker-visuals` and `worker-v115-phone` (40 tests), all green.
    - Privacy scan and `diff --check` clean.
    - Unit tests run serially fail only `production-release` and `role-evaluation`, as before.
    - Rendered at 1280, 768 and 390 against the local Worker, in light and staff-dark.
- 24 October 2026, Earl: V1.16 confirmed released, and "launch V2" chosen as "Ship the redesign". LH-IP02-S01, S02 and S03 ship together as V1.16.1 (PR #61). S04 is not part of it.
  - **Independent review before release:** eight findings, all fixed in `75508ae`. The most serious: a remembered place that had since been retired (409) failed every Catalog sheet start. The others: the remembered place was not kept, the sheet's title id was shared, stone-coloured originals were put on a pedestal, the photo menu lacked menu keys and had a toggle, and a dead Back press followed a cleared Attention entry.
  - **Files beyond the manifest, for those fixes:** `src/catalogue-places.ts` (one remembered-place helper shared by the app and the sheet), `src/catalogue-workspace.ts` (uses it) and `src/attention-workspace.ts` (S01's file).
  - **Specs in the repository:** this packet's accepted specifications are copied to `docs/specs/accepted/2026-10-23-ip02-redesign/` for the release record.
