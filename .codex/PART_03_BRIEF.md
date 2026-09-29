# Part 3 Brief — Stock + Pantry (with whole-product polish)

STATUS: ACTIVE
BRANCH: slice/part-03-stock-pantry (from main 72a6a79)
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md (Part 3)
INSTRUCTION: Earl, 2026-09-29 — a 10× product polish pass across every surface, then Part 3.

## Hallmark audit before the redesign (16 surfaces × 1440/375)
- **Major, structural:** the landing's "What the Department offers" repeated the masthead's destinations, and "Staff sign in" appeared four times on a public page.
- **Major:** staff pages opened with a marketing-scale header. The first table row started about 400 px down on desktop and about 620 px down on a phone.
- **Major:** every one of the 397 rows carried an orange "Needs review" tag, the same colour later needed for Low stock (alarm fatigue).
- **Major:** Record stock sat below the fold in the item sheet.
- **Major, mobile:** the search box and three filter selects stacked above the list.
- **Major, consistency:** form actions were right-aligned in some panels and left-aligned in others.
- **Minor:** the Admin role used the warning colour; an empty timeline still drew its rule; the hero had excess padding.

## Polish decisions
- One shared sheet behaviour (`sheet()` + `sheetContent()` in `ui.ts`) for Inventory, Administration and Stock.
- A compact operations header with inline review progress; a mobile "Filters" disclosure; "Needs review" is a neutral pending marker; Record stock comes first in the item sheet; panel actions start-aligned.
- Landing: hero → how borrowing works → one closing call to action with the "not yet available" requests notice. Staff sign-in appears in the masthead and footer only.
- The router ignores same-page `#fragment` jumps, so anchors never re-render a view.

## Part 3 data facts (migration source)
- **Pantry is already in the catalog model:** `items.stock_area = 'Pantry'` marks 10 food and kitchen items (flour, sugar, salt, ketchup, oyster sauce, noodles, water, snacks, coffee stirrers). Pantry is a view over that field; it is not a new table.
  - The legacy *category* "PANTRY" instead holds 16 office supplies (ballpens, bond paper, envelopes). That is a legacy labelling issue left for staff review, not rewritten.
- **Reorder levels:** no item has one yet. Low stock therefore starts empty, and the UI makes setting reorder levels easy instead of guessing thresholds.
- **Expiry:** the migration source has no expiry data at all. The pantry holds perishable food, so Part 3 adds the smallest model, one optional "earliest expiry" date per item, shown only for pantry items. There are no lots or batches: nothing in the data supports batch tracking.
- **Count needed:** the legacy quantity is questionable for ITM-0001 (migration delta −1) and the 3 VERIFY-status records. Those are the only honest "needs count" candidates until they are physically counted.

## Part 3 plan
- **Migration 0013:**
  - `inventory_movements.reason` (a movement's operational reason);
  - `items.expires_on` (optional, pantry);
  - a `reorders` table (restock list: status, desired quantity and note only, never a quantity of stock);
  - an index for recent activity.
- **Movements:**
  - reasons: Stock in = delivery, returned, donation, other; Stock out = consumed, issued, damaged, missing, transferred, other;
  - "Other" needs a note;
  - a Count may confirm an unchanged quantity (a 0 movement records the observation);
  - responses include the before and after quantity.
- **Restock list:** Needs restock → Planned → Restocked (only by recording a Stock in against it) or Dismissed; at most one open entry per item; audited on the item.
- **`/staff/stock`:** an attention strip (Out of stock, Low stock, Restock list, Needs count, Expiring), each opening its list; a fast Record movement panel (a bottom sheet on phones); Restock list; Pantry; Activity (today and recent) with before/after, reason, actor and time.
- **Live refresh:** the same `catalog_revision` ETag endpoint pattern (`/api/staff/stock`).

## Out of scope
Suppliers, quotations, purchase orders and procurement approval; lots and batches; loans (Part 4); the global activity center and exports (Part 5).
