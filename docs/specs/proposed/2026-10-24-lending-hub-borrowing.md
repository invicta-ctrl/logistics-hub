# Lending Hub: a way to start a borrow — proposed specification
ID: LH-LEND-01 · revision 1
STATUS: PROPOSED FOR OWNER ACCEPTANCE / NOT ACCEPTED / NO IMPLEMENTATION GO
Prepared 2026-10-24 against `main` `7b4e736` (production V1.16.1, application source `03019a9`). Documentation only: this file changes no product code and does not consume a product revision (`docs/PRODUCT_VERSION_GOVERNANCE.md` §2).

INTENT: Give the owner a ranked choice for letting a visitor act on an item from the public Lending Hub, and spell out the recommended slice exactly enough to build once accepted.
OBJECTIVE: A visitor who finds an item on `/lending` can press it and learn how to borrow or take it. While Self-Service is open, they can also go straight to that item in Self-Service and record it there.
TARGET: `lending()` in `src/public.ts`, its rules in `src/styles.css`, and one field on `GET /api/public/catalog`.
AUTHORITATIVE SOURCES: Earl's report of 2026-10-24 (below); `AGENTS.md`, `.agents/PROJECT_POLICY.md`, `.codex/CURRENT.md`, `docs/PRODUCT_VERSION_GOVERNANCE.md`; the accepted IP-0.2 specifications in `docs/specs/accepted/2026-10-23-ip02-redesign/`; `docs/road-to-v3/06_ROAD_TO_V3_RELEASE_MAP.md` and the RTV3-02/RTV3-03 release cards; the source and tests named below.
IN SCOPE (recommended slice): a pressable Lending Hub row; a "how to borrow this" sheet per item; a Self-Service hand-off inside that sheet; the public catalog's Self-Service state.
OUT OF SCOPE: any online request, reservation or hold (see option C); the landing page; Self-Service screens and rules; Loans; any schema, migration or new table; production.
STOP CONDITIONS: Not accepted; no separate implementation GO; PR #65 (V1.16.2) not yet merged; a writer conflict on `src/styles.css` or `tests/browser/app.spec.ts`; a needed change to Self-Service behaviour; failed checks; no rollback.

## 1. The user problem

On 2026-10-24 Earl reported that on the public Lending Hub he "can't press anything to borrow stuff".

Nothing is broken. The Lending Hub has never had a borrow action:
- Each row (`li.catalogue__row`, `src/public.ts:168`) shows a picture, the name, the exceptions ("USC staff only", "Consumable, taken and not returned") and the count. It has no link, no button and no hover or press state.
- The only instruction is one line under the whole list (`src/public.ts:148`): "Borrow in person at the Logistics office. Staff record the loan and return date." On a long list, a visitor may never scroll that far.
- The landing page says the same in "How borrowing works", step 2: "Loans are arranged in person; online requests are not open yet."
- The V1.16.1 redesign did not change these rows. IP-0.2 S02 kept `lending()` out of scope, and S04 excludes the public pages.

So a visitor sees what they want and that it is available, then hits a dead end. The page looks like a shop, but it is a shelf list.

Meanwhile the product already has a way to record a borrow from a phone, and it is unconnected to the Lending Hub:
- **Self-Service** (`/self-service`, `src/self-service-app.ts`) offers every item the Lending Hub lists. A Loanable listed on the Lending Hub is offered as Borrow by the same rule (`selfServiceGaps()` reuses `listingGaps()`, `src/catalog-policy.ts:159`). A listed Consumable is offered as Take or Use.
- Both catalogs use the same item id (`items.id`). The Self-Service item page is addressable as `/self-service?do=item&item=<id>`, and the router loads it lazily (`src/main.ts:21`).
- A Self-Service borrow asks for the person's name, an 8-digit student ID number and a photo of them holding the item (`holdingPhoto()`, `src/self-service-app.ts:552`). In practice it is recorded at the office, with the item in hand. Staff check it in Self-Service review.
- Self-Service can be paused by an administrator. Production answered `GET /api/self-service/catalog` with 200 (open) on 2026-10-24, a read-only public check. The public catalog does not say whether it is open.
- **Loans** (`src/loans-workspace.ts`) is where staff record an in-person loan ("Lend an item").

Who: students and USC staff, mostly on phones, sometimes planning from elsewhere and sometimes standing in the office.

## 2. Options, ranked

### Rank 1 (recommended): A with B inside it

**A. A "how to borrow this" sheet per item.** Pressing a row opens a sheet with the item's picture, name, availability, its exceptions, and the steps to borrow or take it in person.

**B. A hand-off into Self-Service for items it offers.** Inside that sheet, while Self-Service is open and the item is not all out, a second block reads "At the office? Record it yourself on your phone" with an "Open in Self-Service" link to that item's Self-Service page.

Why this ranks first:
- It answers the actual complaint: every row is pressable, and pressing it always leads somewhere true.
- It reuses what exists: the shared `.sheet` dialog and `sheet()` helper (`src/ui.ts:341`), the public picture derivatives, Self-Service's item page, identity rules, photo proof, offline queue and staff review.
- It adds no personal data, no public write path, no table and no migration.
- It makes no new promise. Nothing is held or reserved. The count stays the movement-derived count it is today.
- It is one small, independently useful, reversible slice. As a product change it takes the next V1.16.x revision (section 6).

What it does not do: it does not let someone ask for an item from home. That is option C.

### Rank 2: A alone

The same sheet, without the Self-Service block. Choose this if Earl does not want the public site to send visitors into Self-Service, or if Self-Service is usually paused. It still fixes "can't press anything", and B can be added later without rework, because B lives inside A's sheet.

B is not offered on its own. A bare "Borrow" button on each row that jumps into Self-Service would mislead a visitor who is not at the office: the form would then ask for a photo of them holding an item they do not have. B needs A's sheet to explain when to use it.

### Rank 3 (not recommended now): C. A request or reservation that staff confirm in Loans

A public form (who, what, how many, when) creates a request. Staff confirm or decline it in a new Loans view, and the requester learns the outcome.

Why it does not belong in a V1.16.x revision:
- **Roadmap.** Reservations are Road to V3's "Promise/reservation domain" (`docs/road-to-v3/releases/RTV3_03_RESOURCE_PROMISE.md`, V2.3), and requester context belongs to Event & Demand (`RTV3_02_EVENT_DEMAND.md`, V2.2). Both need the Product Direction Amendment, which is still a pre-draft (`docs/road-to-v3/07_PRODUCT_DIRECTION_AMENDMENT_DRAFT.md`).
- **Policy.** `.agents/PROJECT_POLICY.md` says "Logistics Request is unavailable", and the legacy Request Center stays retired.
- **Truth.** A confirmed reservation is a promise, not physical stock (RTV3-03: "Promise is not physical stock"). Showing it would need a second availability figure beside the movement-derived count. That is exactly the domain RTV3-03 must design, with race protection and uniqueness rules.
- **Privacy and abuse.** It would be the first public form to collect a name, a student ID and some contact detail from someone without the item in hand. It would need a retention rule (`src/retention.ts` covers only loans and phone records today), throttling like Self-Service's (`SELF_SERVICE_LIMITS`), and a decision on how a requester hears back. The Hub sends no email or SMS today.
- **Ownership.** The Loans page body is in LH-IP02-S04's accepted file manifest (`src/loans-workspace.ts`, `src/loan-form.ts`), which is not started.

Recommendation for C: record it as an input to the RTV3-02 and RTV3-03 specifications. Section 8 lists the questions those specifications must answer. If Earl wants online requests before Road to V3, that needs its own accepted specification, which answers the same questions, and probably an amendment to the policy line above.

## 3. The recommended slice (A with B)

### 3.1 The row
- Each row gets one real button, named by the item ("Folding Table"). It sits in the row's `h3`, and its hit area covers the whole row using the stretched-target pattern, so the row stays one list item with one control.
- The availability text stays outside the button and readable. The button points at it with `aria-describedby`.
- A chevron is always visible at the row's end, and the row has hover and press states. This deliberately differs from S04's staff rows, where the chevron appears only on hover: the defect being fixed is that nothing on this page looks pressable.
- Rows still show only the exceptions. No loan periods, audiences or return dates are added, so the existing "rows name only the exception" test stays true.
- The lede gains one sentence: "What you can borrow or take, and how many are in the office now. Choose an item to see how to borrow it." The note under the list stays as it is: it remains true.

### 3.2 The sheet
It opens from the row as the existing `dialog.sheet`, through the shared `sheet()` helper, which provides the transition, reduced motion, Escape and focus return to the opener. It is built from the catalog the page already holds, so it makes no request beyond the picture.

Contents, top to bottom:
1. Kicker: the category name. Heading (`h2`, the dialog's label): the item name. A close button.
2. The item's picture: the public detail derivative that Self-Service's item page uses (`itemVisual` with `itemThumbnailUrl(id, "public", "detail")`). No new media address: `publicThumb()` already serves it for any listed item.
3. Availability, from the same `availability()` the row uses ("3 pieces available", "1 left", "All out").
4. What it is, in one line, from the item type and audience:
   - Loanable: "Borrow it and bring it back."
   - Consumable: "Taken and not returned."
   - Either one, when the item is USC staff only, adds "For USC use only."
5. **How to borrow it** (Loanable) or **How to get it** (Consumable), as two short steps:
   1. "Come to the Logistics office." Any place or hours line is Earl's copy (decision O2); the spec invents none.
   2. Loanable: "Staff record the loan and its return date with you." Consumable: "Staff record what you take."
6. **Self-Service block**, shown only when all three are true:
   - the catalog says Self-Service is open;
   - the item is still listed;
   - its count is above zero.

   It reads: "At the office? Record it yourself on your phone. Self-Service asks for your name, your student ID number and a photo of you holding the item." Then comes one link, "Open in Self-Service", to `/self-service?do=item&item=<id>`, with the id encoded. Self-Service then decides Borrow, Take or Use, as it does today. The block is hidden when it is paused, when the field is missing (fail closed) and when the item is all out.

Live behaviour while the sheet is open:
- The 15-second poll keeps the sheet's count current, and it rolls the number the same way rows do.
- If the item leaves the catalog, the sheet says "This item is no longer on the Lending Hub" and hides the Self-Service block.
- If Self-Service pauses or reopens, the block follows on the next poll.
- If the item's row has gone from the list by the time the sheet closes, focus moves to the search field (builder's call).

### 3.3 The address
- An open sheet is `?item=<id>` alongside the existing `q`, `category`, `available` and `sort` keys.
- Opening a sheet pushes a history entry, so a phone's Back button closes the sheet instead of leaving the page. Closing it goes back if the sheet pushed the entry, or replaces the entry if the page was loaded with `?item=`.
- `lending()` registers `ownQuery()` (`src/ui.ts:229`), as Self-Service does, so the router hands it query-only changes instead of re-rendering the page.
- Filters keep using `writeParams()` (replace).
- A link with `?item=` restores the sheet once the catalog arrives. An id that is not in the catalog shows the list and drops the key (builder's call; nothing personal is involved either way).

### 3.4 The public catalog
- `GET /api/public/catalog` adds `selfService: "open" | "paused"`. It is read with the existing `selfServiceState()` in the route (`src/worker.ts:650`), so `src/inventory.ts` gains no dependency on `src/settings.ts`, which already imports from it.
- `setSelfService()` (`src/settings.ts:13`) also bumps the catalog revision in its batch, and only when the value actually changed (the existing `${BUMP_REVISION} AND changes() > 0` pattern). Without that, a visitor holding the old ETag would get 304 and never see the change. This keeps a 304 poll at one D1 read; salting the ETag instead would add a second read to every poll from every visitor.
- No other DTO change. The catalog still carries no location, aliases, consumption mode, borrower, loan or due date.

### 3.5 Accessibility, motion, performance
- The sheet is a modal `dialog` labelled by its heading. Escape and the close button close it, and focus returns to the row's button.
- Targets are at least 44 px. Text meets WCAG 2.x contrast. The public pages are light only (`src/theme.ts` applies dark to staff routes alone), so there is no dark variant to build.
- Motion is the sheet's existing transition and the row's press feedback. Reduced motion removes both, and nothing loops.
- Opening a sheet makes no API request. Polling stays at 15 s. The Self-Service chunk loads only if the link is followed.
- No inline `style` attributes (the CSP forbids them).

## 4. Privacy

- The page still collects nothing. There is no form, no new storage, no cookie and no analytics, and the address holds only an item id, never a name or student ID.
- The sheet shows only what the public catalog and the public picture route already publish. It shows no location: Self-Service shows a place only for places staff share with it, and only inside Self-Service. It also shows no borrower, no "who has it" and no expected-return date, which would expose loan patterns.
- The new `selfService` field reveals only whether Self-Service is open. Anyone can already learn that: the Self-Service catalog answers 503 while paused, and every Self-Service address shows the maintenance page.
- The hand-off passes only the item id. Self-Service keeps its existing privacy contract unchanged: identity checked for format only, photo proof visible only to staff and deleted from the phone once sent, phone records' personal details erasable after one year (`src/retention.ts`).
- Tests and fixtures use the existing synthetic items. No staff or borrower data enters the public repository (`npm run verify:privacy`).
- Option C would change this section entirely. See section 8.

## 5. What changes in which files (recommended slice)

| File | Permitted change | Boundary |
|---|---|---|
| `src/public.ts` | `lending()`: row button, sheet markup and behaviour, `item` address key through `ownQuery()`, Self-Service block, lede sentence; `Catalog` type gains `selfService` | `landing()`, `page()`, `offlinePage()` and `notFound()` unchanged; no new request; no new import beyond existing `src/ui.ts` exports |
| `src/styles.css` | Lending Hub row affordance (chevron, hover, press, focus) and the sheet's body layout, on existing tokens | Only `.catalogue__*` and the new Lending Hub sheet selectors; reuse `.sheet`; no staff-shell rules |
| `src/worker.ts` | `/api/public/catalog` adds `selfService` from `selfServiceState()` | No other route |
| `src/settings.ts` | `setSelfService()` bumps the catalog revision when the value changes | Validation, audit and same-value no-op unchanged |
| `docs/PRODUCT_REFERENCE.md` | Lending Hub section; the public catalog DTO line, which also corrects today's stale list (it omits `itemType`, `photo`, `iconKey`) | Description only |
| Release record and `product-release.json` | At release, under `docs/PRODUCT_VERSION_GOVERNANCE.md` | Only at qualified release |

No change: `src/self-service-app.ts` (its `?do=item&item=` address already works), `src/main.ts`, `src/ui.ts`, `src/inventory.ts`, `src/item-visual.css` (PR #65 edits it), migrations, Loans, Self-Service review and the landing page.

## 6. Tests

Existing files only, with no new fixture files.

- `tests/worker.test.ts`
  - The public catalog carries `selfService` matching the setting.
  - Changing the setting changes the revision, so a client holding the old ETag gets 200 with the new value. Setting the same value changes neither.
  - The DTO's key set is exactly the documented allowlist: still no location, aliases, consumption mode or loan fields.
- `tests/browser/app.spec.ts` (Lending Hub tests)
  - Every row exposes one button named by its item. Click, Enter and Space open the sheet, whose heading, count and exceptions match the row.
  - Escape and the close button close the sheet and return focus to the row. Phone Back closes it and stays on `/lending`.
  - `?item=` restores the sheet. An unknown id shows the list and drops the key. Filters still round-trip through the address with a sheet open.
  - With `selfService: "open"`, the link's href is `/self-service?do=item&item=<id>`, and following it shows that item's Self-Service page.
  - With `"paused"`, with the field missing, or with a count of 0, there is no link.
  - A Consumable says "take", not "borrow". A USC-staff-only item says "For USC use only".
  - Opening the sheet makes no `/api/` request.
  - The existing assertions stay: rows name only the exceptions, and no loan periods appear.
  - The public-viewport test also checks the open sheet at 320, 390, 768 and 1280 px, with no horizontal overflow.
- `tests/browser/live.spec.ts`
  - A count changing on the next poll updates the open sheet.
  - An item unlisted while its sheet is open shows the "no longer on the Lending Hub" state.
  - Self-Service pausing hides the block.
- `tests/browser/accessibility.spec.ts`: the axe audit of `/lending` with a sheet open.
- `tests/worker-browser/worker-live.spec.ts`: against the real Worker, open a row and follow the hand-off to the Self-Service item page.

Gates:
- typecheck and build;
- the full browser and worker-browser suites;
- `npm run verify:privacy` and `git diff --check`;
- a rendered review of `/lending` with a sheet open at 390, 768 and 1280 px, with reduced motion and keyboard only;
- one bounded Impeccable pass, then the UI quality gate;
- an independent read-only review of the diff before merge.

## 7. Version, ordering and rollback

- **Version.** A product-affecting change merged after V1.16.1 takes the next V1.16.x revision. PR #65 is V1.16.2 and is in flight, so this would be V1.16.3 if #65 merges first. Recompute from verified release history immediately before integration.
- **Ordering.**
  - Start from `main` after PR #65 merges: both edit `tests/browser/app.spec.ts`.
  - LH-IP02-S04 (accepted, no GO) also edits `src/styles.css` and `tests/browser/app.spec.ts`, so run the two serially, with one writer at a time. The default order is this slice first, because it is small and S04 does not touch public pages. Earl may reverse that (O4).
- **Rollback.** Reverting the slice restores today's read-only rows. There is no migration and no data. The extra DTO field is ignored by older clients, and the extra revision bump is harmless.
- This document activates no lane and claims no writer lock.

## 8. Inputs for RTV3-02 and RTV3-03 (option C)

If online requests or reservations are pursued, their specification must decide:

1. **Who may request.** Today Self-Service checks a student ID's format only.
2. **How a requester hears back.** The Hub sends no email or SMS. A reference code and a status page is the only channel that exists today.
3. **Holds.** Does a confirmed request hold stock? A hold is a Promise, not physical stock: how is it shown beside the movement-derived count, protected against races and kept unique?
4. **Lapses.** What happens on expiry, a no-show or a cancellation?
5. **Abuse limits.** A public write path needs bounds like Self-Service's per-item and per-network limits.
6. **Retention.** The requester's personal details need a retention rule, which `src/retention.ts` would have to cover.
7. **The staff surface.** Where staff confirm requests, given that S04 owns the Loans layout, and what goes in the audit trail.
8. **Copy.** Landing step 2 ("online requests are not open yet") and `.agents/PROJECT_POLICY.md` ("Logistics Request is unavailable") would change.

## 9. Open owner decisions

- **O1 Direction.** Accept A with B as one slice (recommended), A alone, or neither.
- **O2 Office copy.** The exact place and hours line for step 1 of the sheet. The Hub stores no hours, and this spec invents none. Without an answer, the sheet says only "Come to the Logistics office."
- **O3 Who sees the hand-off.** Every visitor while Self-Service is open (recommended: Self-Service already fits desktops, and the copy says "At the office?"), or phones only.
- **O4 Order.** This slice before LH-IP02-S04 (default) or after it.
- **O5 Option C.** Confirm that online requests and reservations go to RTV3-02/RTV3-03 under the Product Direction Amendment, not a V1.16.x revision. Otherwise ask for a separate specification that answers section 8 first.
- **Implementation GO.** A separate decision after acceptance.

## Acceptance record

Not accepted. Earl accepts, amends or rejects this document on its pull request.
