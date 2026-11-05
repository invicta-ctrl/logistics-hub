# LH-UI-88: mobile and desktop visual refresh (Issue #88)

- **Status:** ACCEPTED. Earl in chat, 2026-11-05: "accept the spec, ill attach the pngs here". He then attached three boards.
- **Recorded in Git** by LH-RECORDS-01. Decisions D2–D10 below are accepted as recommended.
- **Sources:**
  - Issue #88 (LH-MOBILE-UX-DRAFT-2026-11-05);
  - a read-only inventory of `src` at `main` `1e9a468`;
  - `docs/road-to-v3/10_ADAPTIVE_OPERATIONS_UI_DIRECTION.md`;
  - `docs/specs/accepted/2026-10-23-ip02-redesign/SLICE_01_VISUAL_TOKENS.md`.
- **Boards** (in [`2026-11-05-lh-ui-88-boards/`](2026-11-05-lh-ui-88-boards/)):
  - `Logistics_Hub_Mobile_Experience.jpg` (04 Public lending, 05 Staff sign-in, 06 Staff home);
  - `Logistics_Hub_Staff_Workspace.jpg` (07 More, 08 Item details, 09 Loans);
  - `Logistics_Hub_System_and_Services.jpg` (10 Administration, 11 Self-Service, 12 Stock movements).
- **Missing:** board 01–03 (`Logistics_Hub_Mobile_UX_Redesign.png`) was not supplied. When it is, it gets the same reconciliation as §7.

## 1. Goal

Make the staff and public site feel like one compact, calm maroon-and-gold tool on phones and on desktop, without changing what any page does. Desktop uses its width (tables, list and detail); it is not a stretched phone.

## 2. Decisions (accepted)

| # | Decision |
|---|---|
| D1 | The boards above plus the issue's written rules. The boards are design references, not pixel specifications. |
| D2 | Keep the warm paper canvas `#faf9f7`, not the issue's cool grey. |
| D3 | Keep IBM Plex Sans. Newsreader stays for public headlines only. |
| D4 | Keep brand `#7a1419` (10.3:1 on paper) and the lifted dark-mode brand `#e0646f`. The issue's `#741F24` on the dark canvas is 1.85:1, which fails. |
| D5 | Gold `#E4B84F` only as a fill with dark text, or on maroon (5.7:1). Never as text or a bare icon on light surfaces (1.86:1, which fails). Audit the existing `--gold #c9962a` text uses (2.67:1). A gold dot or icon on light needs a darker gold that reaches 3:1, and is never the only cue. |
| D6 | Radii 8/12/16, as in the accepted IP02 spec. Cards use 12–16. |
| D7 | One phone breakpoint: 760px for both the layout and the lists (today lists switch at 47.99rem). |
| D8 | **Out of scope:** the 4-tab bar Home · Items · Activity · More, and the regrouped More screen. Keep Home · Find · More and the current rail. A navigation amendment needs its own acceptance. |
| D9 | **Out of scope:** new features the boards imply, each of which needs its own small accepted spec. These are Home quick actions; Activity All/Borrow/Return or Stock in/out pills; an Admin "View changelog"; a Loans "Record a return" card; "Popular equipment"; a Find → Request → Collect strip; a Self-Service step indicator; separate "sourcing certainty" or "audit state" cues; and a header notification bell with a count. |
| D10 | Admin section selector: keep the five cells wrapping, so nothing scrolls sideways. Restyle only. |

## 3. In scope (visual only)

- **Tokens:**
  - colour roles per D2–D5 and radii per D6;
  - about 16px phone gutters, 44×44 targets and 48–52px inputs;
  - 150–200ms motion, off under reduced motion.
  - No coloured edge, ring or crescent on any rounded box (the standing rule since V1.16.9).
- **Components:**
  - a compact maroon header with crest and title, and large page titles;
  - a pill search field and the filter bar;
  - chips and the view switcher;
  - white cards with hairline borders, and table rows;
  - solid maroon primary and outlined maroon secondary buttons;
  - status pills: tinted, with icon and text, and one primary status per row;
  - sheets (Back, focus return, scroll restore);
  - empty, loading and error states.
- **Phone rows:**
  - the item name (two lines allowed);
  - the quantity with its unit (never "0" for unknown);
  - one status;
  - one primary action that the role allows.
- **Desktop:** keep the efficient tables. Tighten density and spacing, keep search and filters always visible, and keep hover and keyboard cues. No layout jump between 760 and 1280px.
- **Unchanged:**
  - every route, permission and server call;
  - the 25-at-a-time paging;
  - quantities and units;
  - audit and movement records;
  - lending consent and privacy;
  - the three-tab phone bar and the rail.
- **Honest data:** the numbers, names and times on the boards are illustrative. Pages show only live values.

## 4. Slices (each its own branch, PR, tests and screenshots; one writer at a time on shared CSS)

1. **S1 Foundations:** tokens, radii, the D7 breakpoint, header, chips, views, sheets.
   - Files: `src/styles.css` (token blocks and shared components), the `src/self-service.css` tokens, `src/pager.ts` (the breakpoint), `src/ui.ts`.
   - Risk HIGH, because `src/styles.css` styles every page.
   - Pinned tests to update deliberately: `tests/browser/tab-style.spec.ts`, `tests/browser/ui-media-theme.spec.ts`.
2. **S2 Inventory:** Items, Low & out of stock, Stock views, item sheet (board 08). Files: `src/staff.ts`, `src/stock-workspace.ts`, `src/item-viewer.ts`, and the row and card CSS.
3. **S3 Operations:** Home, Loans, Kits, Locations, Activity and Self-Service review (boards 06, 09, 12). Visual only.
4. **S4 Public and Self-Service:** landing, Lending Hub, staff sign-in and the Self-Service screens (boards 04, 05, 11). Public pages stay light-only.
5. **S5 Administration:** board 10, restyled within the five-cell wrap. Health shows only responding checks, with their time and "Check again". The version is read live.
6. **(Later, separate acceptance)** the navigation amendment.

## 5. Acceptance per slice

- **Widths:** 320, 375, 390, 430, 768, 1024, 1280 and 1440.
- **Conditions:** portrait; keyboard open; 200% text; light and staff-dark; reduced motion; keyboard and focus; screen-reader names.
- **Behaviour:**
  - no horizontal overflow and no clipped text;
  - no hidden click targets (the V1.16.13 closing-menu rule stays);
  - Back, deep links and sheets restore focus and scroll.
- **Regressions:** the existing desktop tasks still pass, lists of 550–600 items stay bounded, and existing timings are no slower.
- **Checks:**
  - typecheck, build, unit, browser, Worker E2E, privacy and accessibility;
  - before and after screenshots against the boards.
- **Issue #88** stays open until the slices are delivered and Earl has checked them visually.

## 6. Order and custody

Slices S1 to S5 run one at a time, because they all share `src/styles.css`. Each is a product revision under `docs/PRODUCT_VERSION_GOVERNANCE.md`, with its own release record and `product-release.json` entry. Each needs a writer slot from the steward's live roster (HAU-AGENT-LANES-003).

## 7. Board reconciliation

- **Adopt:**
  - the header, titles, canvas, cards, buttons and pills described in §3;
  - item detail (08): a quantity block with its unit, a key-value list (Location, Reorder level, Category), Overview/History segments and a primary action;
  - Admin System (10): "All checked services responding", the time, "Check again", Health checks rows, a version card read live, and Backups worded "Documentation, not live backup proof";
  - public landing (04) and sign-in (05);
  - gold only on the avatar fill with dark text and on count badges.
- **Do not adopt:**
  - everything listed in D8 and D9;
  - the sideways admin row (D10);
  - board 08's double status ("Out of stock" plus "Needs restock"): show one primary status, with reorder information in the key-value list.
