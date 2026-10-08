# Proposed amendment: Data-surface UI (Stock actions, container-aware tables, number semantics)

STATUS: ACCEPTED BY OWNER (Earl, "accept" in the Data-Surface UI plan review thread, 2026-10-08 12:46 UTC, in reply to this draft and its recommended placement). REGISTERED IN THE REPOSITORY (commit 6c2d874), NOT IMPLEMENTED
REGISTER AS: `docs/specs/accepted/2026-10-NN-data-surface-ui-amendment.md` once Earl accepts (a standalone UX slice, not a Road-to-V2 version and not an RTV3 milestone)
BASE: `main` at `8068b0e`
SOURCE: Earl's "Data-Surface UI Philosophy, Findings and Fix Plan" (2026-10-08), narrowed by the verified-findings report in this folder
BRANCH WHEN STARTED: `slice/ux-data-surface` from verified `main`, one writer, one worktree (`AGENTS.md`)

## Authority
Owner: Earl. Accepted 2026-10-08 12:46 UTC, including the recommended placement (after the V1.15 Final Pass merges, before RTV3-01 starts). This draft changes no code, no accepted spec, no RTV3 package file and no V1.15 Final Pass scope.

## Outcome
Staff can see the item, how many there are and what state it is in at a glance on Stock, Restock, Pantry and Items, on a phone or in a narrow panel, without a row of buttons competing with the item name. Unknown quantities are never shown as zero.

## In scope (frontend only)
1. **Row actions (Stock needs attention, Restock, Pantry).** Show at most one primary action per row, plus a "More actions" button that opens a small popover menu holding the rest. Primary action per surface: Needs attention keeps Count / Stock in / Open units; Restock keeps Receive; Pantry keeps Use / Open units. Moved into More: Add to restock, Mark planned / Not planned, Dismiss, Pantry Restock. The menu is a keyboard and touch operable popover reusing the existing `.menu` popover pattern; one small helper in `src/ui.ts`. Handlers, endpoints, confirmations and permissions are unchanged. The Restock quantity input stays visible.
2. **Container-aware table-to-card conversion.** This fixes a live defect (UX-0: at 768 and 1024 px the Stock Actions column is clipped away by the side panel). Move the `.data-table` phone rules out of the `max-width: 760px` media query into an `@container` rule on `.data-table-wrap` (the shell and navigation rules stay on the media query). Start at 44rem and set the final width from measured wrapping. Keep the existing card anatomy.
3. **Number and empty-value semantics.** (a) Restock shows an unknown on-hand as "Not available", not `0`. (b) Reorder level and Restock qty are end aligned with tabular figures like On hand. (c) The phone label "Reorder level:" moves from CSS `::before` into markup. (d) Quantities of 1,000 or more use one shared grouping formatter. Reorder level of 0 keeps showing "Not set" (0 turns the level off).
4. **Sort calm (desktop Items).** Inactive sort icons are hidden until hover or focus; the active column keeps its icon and `aria-sort`. No change to sort order, URL state or tie-breaking.
5. **Directory Usage table.** Same container rule and `Item / Qty` then `Date / How` card order. No change to Student ID matching or what is shown.

## Explicitly out of scope
Density modes (the item thumbnail is 3rem so a 40 px row would clip it; revisit only if UX-0 shows demand), text truncation and tooltips (cells wrap today), sticky identity columns and horizontal-scroll tables (none exist), Stock glance sheet, Items phone sort control, Loans Borrowers (already right aligned), Kits/Places/Home/Administration, Activity, Staff Directory wall and profiles, public and Self-Service pages, money formatting (no price fields yet). Also no API, D1, R2, migration, dependency, framework, AI, role or Student-ID change, and nothing in the V1.15 Final Pass or RTV3 package.

## Existing behaviour being superseded
Per-row button groups on the three Stock tables; the phone block of `.data-table` rules keyed to viewport width; always-visible inactive sort icons; the `?? 0` display on Restock rows. Nothing else.

## Decommissioning plan
Old CSS phone `.data-table` block and `.col-level::before` text are deleted in the same slice after the container rules pass; no coexistence, no flag. Rollback is reverting the slice (frontend only).

## Domain truth, bounded workloads, atomicity, concurrency, idempotency, offline, AI
Unchanged. Authoritative stores stay D1 and the stock movement ledger. Opening a menu or sheet never writes. Each action issues exactly the same single request as today (no double post from menu plus button). Offline queues and drafts unchanged. No AI. Items list keeps the 100-row increment; no new rendered rows.

## Authorization and privacy
No new data is shown. Role-denied actions stay denied, and a hidden action stays reachable by keyboard and touch. Student IDs are not added to any row.

## Performance budget
No new network call, no new dependency. Markup per row does not grow; the 100-row Items page and the existing Stock bounds are the budget (compare against the V1.14/V1.15 numbers before and after).

## Packets (single writer, in order)
- **UX-0 baseline: DONE 2026-10-08** (`ux0-baseline.md`, five widths on mocked data; Directory Usage, real device and screen reader unrun). It was to render Items, Stock (three tabs) and Directory Usage on `main` at 320/390/768/1024/1440 and at container widths 620/700/1000; record wrapping, row height, sticky header under containment, 200% text, keyboard focus. Output: screenshots and a short ranked note. Confirms or removes items 2 and 4 before any code.
- **UX-1 (first, fixes the clipped actions):** item 2 for Items and Stock tables.
- **UX-2:** item 1 (the one behaviour-adjacent change; uses the new card layout).
- **UX-3:** items 3 and 4 (pure display).
- **UX-4:** item 5, delete the old CSS, regression pass.

## Acceptance criteria
1. At 390 px a Stock or Restock row shows name, on hand, one status and at most one primary button plus a labelled More actions control; every former action is reachable by keyboard and touch, with the same confirmations and permissions.
2. Restock never shows `0` for an on-hand it could not load.
3. Every Stock action (Count, Stock in, Receive, Use, and the rest) is visible or reachable at 320, 390, 768, 1024 and 1440 px, none clipped. Items, Stock and Directory Usage cards switch on container width: a 620 px container inside a 1440 px browser uses the card layout, a 1000 px one keeps the table. No page-level sideways scroll.
4. Reorder level 0 still reads "Not set". On hand, Reorder level and Restock qty share an end-aligned numeric style.
5. Only the active Items header shows a sort icon at rest; all sorts, `aria-sort` and `?sort=` still work.
6. Activity scroller, 100-row increment, bulk select, URL filters, item sheet and focus return are unchanged and their existing tests pass.
7. No migration, dependency, API or role change appears in the diff.

## Verification
- unit and integration: existing stock, restock and loan tests unchanged and green.
- browser: extend `tests/browser/large-lists.spec.ts` and `accessibility.spec.ts`; add a container-width case and a More actions keyboard case (Escape, focus return, `aria-expanded`, pending state); run `worker-v115-phone.spec.ts`.
- visual: before and after screenshots at the UX-0 widths, inspected, not code-read.
- manual and unrun: real phone and screen reader are unrun unless Earl runs them; record that.
- privacy scan, typecheck, build, CI green on the final commit.

## Rollback and recovery
Revert the slice commit(s). No data or schema to restore.

## Owner actions
Accept or reject this draft; choose the slot below. Merge to `main` is Earl's, as for every release.

## Placement (decision for Earl)
**Recommended default:** run after the V1.15 Final Pass merges and before RTV3-01 starts, as its own short `slice/ux-data-surface`. Reason: the Final Pass (photo to draft in Add items) very likely touches `staff.ts` and `src/styles.css` too (inferred, not checked), so the two should be serialized, and finishing the UI slice first lets RTV3-02 to 08 inherit it. The plan instead suggests after the RTV3-01 foundation gate; that also works since it needs no packet-cap change, but delays the benefit. UX-0 is read-only and can run now in parallel with the Final Pass.
