# Workspace depth: item and place sheets, loans, Self-Service, Activity, Administration and the rail

STATUS: ACCEPTED by Earl on 2026-10-29: "Use your defaults". He gave that answer to the list of every open question, each with a recommended answer. The answers he accepted are recorded in §6 and apply throughout. Slice 3's visual direction still needs his separate approval before its code (§5).
ORIGIN: Earl's message of 2026-10-29 (seven production screenshots), reproduced in §1.
BASE: V1.16.6 on `main` (V1.16.4, the page-move fix V1.16.5, and the Attention and staff-name fix V1.16.6).
AMENDED by Earl on 2026-10-29, during slice 1: "i want you to combine 1.16.7-1.16.9 in one update now".
- Slices 1, 2 and 3 are built in order on one branch and released together as one post-release revision, V1.16.7: one record, one merge and one deploy (`docs/PRODUCT_VERSION_GOVERNANCE.md` counts released changes, so the combined update takes the next free number).
- The slice headings below keep their original numbers (V1.16.8, V1.16.9) only as names for the parts of the update.
- Everything else stands. Each slice's acceptance applies to the combined update, and slice 3's visual direction still needs Earl's approval before its code (§5). The merge still waits for Earl's go-ahead.
OUT OF SCOPE: the Administration toasts and the flicker when switching tabs. Those were defects in V1.16.4, fixed and released in V1.16.5.

## 1. What Earl asked for

1. Stock settings belong in Edit details; Overview holds the item's general and profile information.
2. The item's theater holds only its picture, and the picture is sized to fill the theater on desktop and phone.
3. Low & out of stock shows each item's picture.
4. An item opened from Locations looks and works exactly as it does in All items.
5. Loans show the photo itself, not only a "Photo" link, and each loan opens to all its details.
6. Self-Service: Needs attention and Last 7 days become one tab, Overview, with a way to show every record.
7. Activity: entries open to their full detail in place, so the list stays light. Activity buttons elsewhere (Self-Service, Items) lead to Activity, filtered; Loans keeps its own.
8. Administration is overhauled.
9. The rail's buttons are separated, with depth, and moving between pages is animated. Everything should feel alive, with depth: a premium, Apple-like feel.

## 2. Constraints that stay

- These stay: the oxblood, gold and warm-paper tokens, IBM Plex Sans and Newsreader, rows on rules, and the existing components.
- HTML, CSS and TypeScript are preferred: motion starts from CSS, the Web Animations API and the View Transitions API. Earl permits other tools (an animation library, WebGL/canvas for depth) where they do something these cannot. Each one added is named in its slice, with its download size and why it is needed, and stays within the V1.16.4 performance budgets.
- Full motion is the design (Earl, 2026-10-29: reduced motion is not his preference). The workspace is designed and judged with every animation on.
- Continuous ornamental animation is permitted (Earl, 2026-10-29). Motion never says an action succeeded before the Worker confirms it.
- Accessibility holds as in V1.16.4: axe 0, a 44 px target for every touch control, nothing cut off at 320 px with 200% text, and keyboard order unchanged.
- Performance holds the V1.16.4 budgets. Pictures already in the item list are reused, and no list asks for display-size images.
- Design process: one Hallmark direction pass for slice 3, the visual change. Slices 1 and 2 follow the existing direction, with one bounded Impeccable pass each. The UI quality gate runs on every slice.

## 2a. Technology for motion and depth (researched 2026-10-29)

Earl asked for GSAP, Motion, Three.js/WebGL, Lottie/dotLottie, Rive, Framer, Spline and Jitter "if possible". Each was checked against current official documentation for:
- licence;
- use from plain TypeScript;
- download size;
- what the Content-Security-Policy would need (`src/worker.ts`).

**Base (slices 1 to 3): no new dependency and no CSP change.** The browser already does what the brief asks:
- CSS 3D (`perspective`, `translateZ`, `preserve-3d`), with layered shadows for depth.
- Spring curves written as CSS `linear()`, and `@starting-style` for sheets that open and close.
- The Web Animations API for page moves, started after the page draws so it never delays content.
- The View Transitions API for the photo theater, which already morphs natively.

The repo already has a spring and tilt engine (`src/card-motion.ts`), CSS 3D tiles, the photo morph and a page fade. Slice 3 builds on them.

| Candidate | Verdict | Why |
|---|---|---|
| Motion (`motion/mini`, MIT, about 3 KB gzip) | Later, if needed | The one library worth adding: for a drag-to-dismiss sheet or an interruptible gesture that the base cannot do cleanly. Loaded only with that sheet. |
| Three.js (MIT, about 131 KB gzip) | Later, if wanted | Only for real WebGL in the photo theater (lit or depth-mapped photos), after the CSS 3D theater has been tried. Loaded only when the viewer opens. No CSP change, provided its photos come from our own address and no compressed models are used. |
| lottie-web, light build (MIT, about 45 KB gzip) | Later, if assets exist | Only if designer-made Lottie animations are supplied. Empty states and success ticks need no library. |
| GSAP + Flip | Not used | Repeats the native photo morph, about 27 KB gzip, no 3D in Flip, and a licence Webflow can change. |
| dotLottie, Rive, Spline | Not used | Each needs the CSP weakened (`wasm-unsafe-eval`, `blob:`, outside hosts) and weighs 0.4–1.1 MB. Spline declares no licence. |
| Framer, Jitter | Not used | Builders, not libraries: Framer has no export for a site like this; Jitter's free exports carry a watermark. |

The first staff page grows by 0 KB in every case. Before any code, two things are measured:
- the cost of the 3D layers and sheet transitions on a 4×-slowed phone;
- that the Web Animations API is not blocked by our CSP.

## 3. Slice 1 (V1.16.7): the item sheet, its picture, and the place sheet

**Item sheet**
- **Theater:** shows only the item's picture.
  - With a photo, the photo fills the theater's stage at the stage's own proportions, on desktop and phone.
  - Without one, the icon sits centered at stage size with the "Add a photo" action, not as a small tile in a corner (screenshot 3).
  - The ID and name stay in the sheet's header.
- **Overview** (the profile): what the item is.
  - Pieces on hand with Lend.
  - Status and where it is offered (Lending Hub).
  - Type and category.
  - Recorded place, with Where is it?
  - Unit, model, serial and other names.
  - Availability and record.
  - The + / − stock stepper stays on Overview, because counting is the most common task.
- **Edit details:** gains Stock settings, in its own group after the item's fields:
  - Reorder level, Stock area and Status.
  - Add to restock and Add to kit.
- **Loan and History:** unchanged.

**Low & out of stock**
- Every row shows the item's list thumbnail (or its icon), the same component as All items.

**Place sheet (Locations)**
- Opening a place shows the item sheet's layout:
  - a theater with the place's picture;
  - Overview: path, items kept here, last check, Check this place;
  - Edit details: name, inside, directions, who sees them, picture actions;
  - History.
- Opening an item from a place's list opens the same item sheet as All items, with the same tabs and actions.

**Acceptance**
- Browser tests pin the tab contents, the theater with a picture and without one at 375 and 1440 px, thumbnails in Low & out of stock, and that an item opened from Locations has the same sheet as one opened from All items.
- The V1.16.4 accessibility and performance checks pass.

## 4. Slice 2 (V1.16.8): loans, Self-Service and Activity

**Loans**
- **Thumbnail:** a loan with a release photo shows a small thumbnail where "Photo" is now. It is staff-only, with the same private caching as other staff pictures, loaded only when the row is in view.
- **Opening a loan:** every loan row opens a loan sheet with:
  - the borrower (name, Student ID, use and reason);
  - the item, linked to its sheet;
  - quantity and dates (lent, due, returned);
  - who lent it and who closed it, or Self-Service;
  - the photo, large;
  - notes and the audit trail.
- **Actions in the sheet:** Return and Extend, wherever the list offers them today.

**Self-Service (staff page)**
- **One Overview tab:** what needs attention first, then recent records, newest first.
- **Range:** the last 7 days by default. A "Show all records" control loads older records page by page, with the same paging as Activity.
- **Search:** covers whatever is shown.
- The QR code and poster tab stays.

**Activity**
- **Row contents:** each row shows one line, saying what happened, to what, by whom and when.
- **Opening a row:** shows the full detail in place: before and after values, quantities, place, reason, linked records and the request reference. Only one row is open at a time, and opening is keyboard-accessible.
- **Links from other pages:**
  - "All activity for this item" (item sheet) leads to Activity filtered to that item.
  - Self-Service's activity links lead to Activity filtered to Self-Service.
  - Loans keeps its own history.

**Acceptance**
- Browser tests for the loan sheet with and without a photo, Show all records paging, Activity rows opening and closing, and every redirected link landing on the right filter.
- A staff account sees no administrator-only detail.

## 5. Slice 3 (V1.16.9): Administration and the rail, with depth and motion

This slice begins with a Hallmark direction pass, which Earl approves before any code.

**Administration**
- **Shared page shape:** each section starts with what needs a decision and a status summary, then its settings in titled groups.
- **One sheet pattern:** every change opens the same confirm-impact sheet.
- **Consistent layout:** the section tabs stay put on a phone. System, Self-Service, Catalog, Staff and Accountability share one layout.
- **Tab moves:** a move between sections never redraws the title (as in V1.16.5).

**Rail and navigation**
- **Collapsible Items and groups** (Earl, 2026-10-29; groups per §6.3): the same chevron control folds the Circulation, Records and Manage groups. A chevron on Items folds its six children (All items, Low & out of stock, Stock & movements, Pantry, Locations, Kits) away and back, with an animated fold.
  - Folded, Items still shows the Low & out of stock count, and the current child stays reachable: opening one of its pages unfolds it.
  - The choice is remembered on this device. It is a display preference, not account data.
  - Keyboard and screen readers: the chevron is a button with `aria-expanded`.
- **Separate buttons:** each destination is its own pressable surface with a light shadow and an inner highlight. The current one is raised, with a lit edge, and pressing sinks it slightly.
- **Moving between pages:** the current marker travels from the old destination to the new one. The page settles in with a short fade and lift (about 200 ms); where the View Transitions API exists the pages crossfade, and elsewhere a fade.
- **Depth on sheets and cards:** layered surfaces with soft shadows. Sheets slide in with spring-like easing, and buttons respond to press.
- **Living surfaces:** continuous ambient motion is allowed where it adds life: for example, a slow light across the current destination, a breathing status dot, or depth that follows the pointer. The Hallmark pass decides which, and how much.

**Acceptance**
- Earl approves the Hallmark direction.
- Measurements show a page move stays within the V1.16.4 timing budgets on a phone at 4× CPU slowdown.
- Continuous animation costs no measurable frame time on the phone profile, and pauses while the tab is hidden.
- Visual matrix at 320–1440 px, light and dark; axe 0.

## 6. Decisions (Earl, 2026-10-29: "Use your defaults")

1. **Places (slice 1):** both. The place sheet takes the item sheet's layout, and an item opened from a place is the same sheet as in All items.
2. **Stock & movements (slice 2):** Movements keeps its own list. It is the stock ledger, and Activity is the feed across all sources.
3. **Collapsing the rail (slice 3):** Items' children and the Circulation, Records and Manage groups collapse. They share one control, and the choice is remembered on each device.
4. **Order:** slices 1, 2 and 3 as written. Each is merged and deployed when it is done, and only on Earl's go-ahead.
5. **Libraries:** none is added now; the base in §2a is the stack. Motion (`motion/mini`) or Three.js are added only if a slice needs what the base cannot do, named in that slice with size and reason.
6. **Hardening:** the 2026-10-29 audit's low-severity findings are a hardening slice of their own, after slice 1, with its own specification. Not part of this one.
