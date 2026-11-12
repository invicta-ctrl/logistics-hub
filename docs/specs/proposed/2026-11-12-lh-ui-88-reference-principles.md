# LH-UI-88 amendment A1: reference principles and the flows they imply

- **ID:** LH-UI-88-A1 · revision 1
- **Status:** PROPOSED. Not accepted, so it grants no authority to implement. When Earl accepts it, the integration steward moves it to `docs/specs/accepted/`, records it in `CHANGELOG.md` under "Specification changes", and updates the LH-UI-88 row in `.codex/CURRENT.md`. Until then the accepted spec [`2026-11-05-lh-ui-88-visual-refresh.md`](../accepted/2026-11-05-lh-ui-88-visual-refresh.md) governs unchanged.
- **Amends:** LH-UI-88. It adds the surface map (§5) and the new flows F1–F8 (§6). It changes D9 only where §4 says so, and adds slice S6 (§7).
- **Prepared:** 2026-11-12, against `main` `c142a50` (V1.16.15, production observed serving the same bundle). Writer: Claude, slot B (live roster entry of 2026-11-12). This file is documentation only. It changes no product code and uses no product revision (`docs/PRODUCT_VERSION_GOVERNANCE.md` §2).
- **Owner instruction (Earl, chat, 2026-11-12):** "apply these lists without affecting the theme and branding of the website". The list below is from the same message. He chose to have the spec amended for the new flows, and to run UI work in parallel with the CI/CD lane.

## 1. The references are principles, not looks

Each reference names one quality. None of them is a look to copy. No layout, asset, typeface, colour, illustration or copy is taken from any of these companies, and no page may be recognisable as theirs.

| Reference | The principle we take | Where it applies here |
|---|---|---|
| Apple | Motion that explains where things came from and went to (continuity, not decoration) | sheets, photo viewer, view changes |
| Duolingo | Guidance that is shown at the moment it is needed, one step at a time, and can be skipped | first-run, Self-Service, borrowing |
| Linear | Dense, aligned, keyboard-first; numbers line up, nothing wobbles | Items, Stock, Loans, Activity, Admin |
| Pentagram | Typography carries the hierarchy; a strong headline scale instead of boxes | public pages, page titles |
| MUJI | Remove what does not serve the task; one primary action per place | every surface |
| Airbnb | Search first; filters visible, countable and individually removable | Lending Hub, Items, Loans |
| Aesop | Art direction with restraint: one real photograph, calm copy that tells what the department does | landing, Lending Hub intro |
| Notion | A dashboard is a reading order: what needs you now, then what is coming, then the rest | staff Home |
| Stripe | Sections composed on one grid with a steady rhythm; each section makes one point | landing, Lending Hub intro |
| Framer | Every control answers touch, hover, focus and press within a frame; states are distinct | buttons, rows, chips, toggles |

## 2. Hard constraints (unchanged by this amendment)

- **Brand:** brand `#7a1419`, dark-mode brand `#e0646f` (D4), gold under D5, paper `#faf9f7` (D2); IBM Plex Sans throughout and Newsreader for public headlines (D3); the crest and the DOL marks unchanged. The token block at the top of `src/styles.css` is changed only by the steward; a slice that needs a token asks for it.
- **Navigation:** Home · Find · More and the current rail (D8). The four-tab bar stays out of scope.
- **Decisions:** D1–D10 hold, except D9, which changes only as written in §4.
- **Honest data:** every number, name, time and state comes from the live API. A guide or empty state never shows sample data as if it were real. Guidance may say what a page is for; it never says that a step has been completed unless the server has confirmed it.
- **Motion:** `transform` and `opacity` only, at 150–240 ms with the existing easings. Under `prefers-reduced-motion: reduce` motion becomes an instant change or an opacity fade of 150 ms or less. Nothing animates continuously, apart from the landing water Earl chose in S1. No animation shows success before the server has confirmed it: a saved state appears only after the response, and a failure returns the control to its previous state with the error.
- **Lean:** HTML, CSS and TypeScript only. No new dependency, animation library, font or paid asset. Reuse `reducedMotion()`, `animateNumber`, `emptyState()`, `sheet()`, `contextual-help.ts` and the view-transition pattern in `src/item-viewer.ts`.
- **Scope:** visual and client-side only. No route, permission, API, schema or migration changes. Guidance state lives in the browser (`localStorage`, as theme and rail folds already do) and can be lost without harm.
- **Acceptance (spec §5) applies to every slice:** widths 320–1440, 200% text, light and staff-dark (public pages stay light only), reduced motion, keyboard and focus, screen-reader names, no horizontal overflow, no hidden click targets, and lists of 550–600 items stay bounded.

## 3. Direction contract (Hallmark, run once)

Hallmark ran once, as `redesign` in direction-only mode inside the existing boundaries, on 2026-11-12. Its pre-flight found no `design.md`. The tokens in `src/styles.css` (lines 3–187) and `src/self-service.css` are the locked system. Fonts are `@fontsource/ibm-plex-sans` and `@fontsource/newsreader`. There is no motion library, so the app is CSS-driven with `reducedMotion()`. The framework is vanilla TypeScript on a Worker. Hallmark would normally write `design.md` and `.hallmark/log.json`; neither is in the writer's owned paths, so this section is the record.

- **Genre:** editorial for the public pages (Newsreader headlines on paper, one photograph); modern-minimal for staff (Plex, hairlines, dense rows).
- **Locked:** palette and tokens, the type pairing, the crest, the maroon header and rail, Home · Find · More, the button voice (solid maroon primary, outlined maroon secondary), tags, and radii of 8/12/16.
- **Public page structure:** a single centred hero (already shipped), then left-aligned ruled sections on one 12-column grid. Each section makes one point and has at most one call to action. No three-card feature rows and no eyebrow numbering, except the ordinal "How borrowing works" steps, which are genuinely ordinal.
- **Staff structure:** page title in Newsreader, then one toolbar line (search, filters, count), then the list. The sheet holds the detail. Desktop keeps tables; phones get two-line rows with one status.
- **Motion vocabulary:** three movements only. A sheet rises from where it was opened. A view change crossfades. A changed number rolls (it already does). Press feedback is instant, with no delay.
- **May refine (Impeccable, one bounded pass per slice):** spacing, states, focus, responsive behaviour, copy length, motion timing, accessibility.
- **Rejected for this product:** decorative gradients, glassmorphism, fake device frames, invented statistics, celebratory toasts, confetti, italic headings, and a second accent colour.

## 4. Change to D9

D9 listed features the boards implied and kept them out of scope. This amendment brings three of them in, each limited as follows:

| D9 item | New status | Limit |
|---|---|---|
| Home quick actions | **In scope, F4.** | At most three. Each is a link to an existing page or sheet the role already allows: Update stock, Record a loan, Find an item. No new action. |
| A Find → Request → Collect strip | **In scope as F3, renamed Find → Visit → Borrow.** | It describes the existing process (V1.16.8 "how to borrow this" sheet). Online requests stay out of scope, as LH-LEND-01 option C says. |
| A Self-Service step indicator | **In scope, F2.** | Inside the Take, Use and Borrow sheets only, for the steps that already exist. |

The rest of D9 stays out of scope: Activity All/Borrow/Return or Stock in/out pills; an Admin "View changelog"; a Loans "Record a return" card; "Popular equipment"; separate "sourcing certainty" or "audit state" cues; and a header notification bell with a count.

## 5. Surface map

Each row lists concrete, bounded changes. "Visual" changes fit the existing slices. Flows (F#) are defined in §6.

| Surface | Principles | Changes | Slice |
|---|---|---|---|
| **Public landing** | Pentagram, Aesop, Stripe, MUJI | Newsreader headline scale with one size step per level; the services strip and "How borrowing works" on one grid with steady section spacing; the campus photograph as the single image, with a one-line caption saying what the department does; at most one call to action per section; no duplicate exits (P1 from the 2026-11-11 critique). | S4 part 2 |
| **Lending Hub** | Airbnb, Linear, Framer | F6 search and filter refinements; aligned availability counts; a press state on rows; F3 in the item sheet. | S4 part 2 |
| **Staff sign-in** | MUJI, Framer | One column: crest, title, two fields, one button; distinct focus, error and busy states on the button (busy only while the request runs, never "signed in" before the response). No new flow. | S4 part 2 |
| **Self-Service** | Duolingo, MUJI, Apple | F2: a skippable first-run guide and a step indicator in the sheets; bring the Self-Service family back into line with the staff brand (P1 from the critique); receipt check-mark only after the server's response (already true; kept). | S4 part 2 |
| **Home** | Notion, MUJI | F4: reading order and quick actions; F1 first-run card. | S3 (F4), S6 (F1) |
| **Items / Stock** | Linear, MUJI, Framer, Airbnb | Visual: two-line phone rows with one status and "+N", the sheet's facts as a ruled key-value list, press feedback, tabular numbers (S2, under the current spec). Flow: F5 search and filter refinements. | S2 (visual), S6 (F5) |
| **Loans** | Linear, Airbnb | Aligned due dates and tabular numbers; one primary status per row; search field and view tabs in one toolbar line; overdue stays a static tint. | S3 |
| **Activity** | Linear, Notion | Day headings as reading anchors; aligned change column; the existing applied-filter chips restyled as the shared pattern that F5 and F6 reuse. | S3 |
| **Admin** | Linear, MUJI, Framer | Board 10 within the five-cell wrap (D10); health rows show only responding checks with their time and "Check again"; the version read live; the tab marker's slide kept, and off under reduced motion. | S5 |
| **Cross-surface motion** | Apple, Framer | F7. | S6 |
| **Page titles and empty states** | Pentagram, Duolingo | F8. | each slice, for its own pages |

## 6. New flows

Risk tier for every flow: **HIGH** under the accepted spec, because each touches `src/styles.css`, which styles every page. Each flow is client-side only and changes no authentication, role, data or route. All browser tests named below are new or extended specs in `tests/browser/`; each runs at 320 and 1280, plus reduced motion.

### F1 — Staff first-run guidance (S6)

- **What:** the first time an account opens Home in a browser, a "First steps" card sits above the queue with three links: *Find an item*, *Update stock*, *Record a loan*. Each link opens the existing page. A step is ticked only after this browser has seen a successful response for that action (a search that returned results, a stock movement saved, or a loan recorded). "Hide" dismisses the card for good in this browser. Roles without stock or loan rights see only the steps they can do.
- **Files:** `src/home-workspace.ts`, `src/home.css`, and one small module `src/first-steps.ts` (the stored state and the three listeners).
- **Acceptance:**
  - (a) A new browser profile shows the card, and after "Hide" and a reload it does not.
  - (b) Opening Update stock without saving leaves its step unticked; saving a movement (server 200) ticks it, and a failed save (mocked 500) does not.
  - (c) A view-only role sees no Update stock step.
  - (d) The card has a heading and a list, and every link has a name.
  - (e) Under reduced motion the card appears without movement.

### F2 — Self-Service first-run and step indicator (S4 part 2)

- **What:** on first open in a browser, three short panels: *Find it*, *Take, use or borrow*, *Return it*. Each has one sentence and "Next"; "Skip" is always visible, and the guide never appears again once it is skipped or finished. In the Take, Use and Borrow sheets, a step indicator ("Step 1 of 2: choose how many") reflects the sheet's existing steps.
- **Files:** `src/self-service-app.ts`, `src/self-service.css`, `src/contextual-help.ts` (reused).
- **Acceptance:**
  - (a) The guide shows once, and Skip or finish prevents it on reload.
  - (b) Focus starts on the first panel's heading and returns to the page after closing; Escape closes it.
  - (c) The step indicator's text matches the visible step in every sheet.
  - (d) No receipt or check-mark appears before the server confirms (mocked delay).
  - (e) At 320px with 200% text there is no overflow.

### F3 — Guided borrowing path on the public side (S4 part 2)

- **What:** the Lending Hub item sheet (V1.16.8) shows *Find → Visit → Borrow* as a short horizontal step line. The current step is "Find", because the visitor is looking at the item. Each step has one line from the existing "How borrowing works" copy. While Self-Service is open, the "Borrow" step carries the existing Self-Service hand-off. No online request is added.
- **Files:** `src/public.ts` (`lendingSheetBody`), `src/styles.css` (public rules).
- **Acceptance:**
  - (a) The three steps render as an ordered list with the current step marked `aria-current="step"`.
  - (b) The Self-Service hand-off appears only when the catalog says Self-Service is open (both states mocked).
  - (c) The copy matches the landing steps word for word.
  - (d) At 320px the steps wrap to a vertical list.

### F4 — Home dashboard hierarchy and quick actions (S3)

- **What:** Home reads in one order: a one-line lede with the live count of what needs a person now; "Now" groups first, then "Soon", then "Later" (folded); insights last. At most three quick actions sit beside the title on desktop and under it on phones, each a link to an existing page that the role allows. Counts come from `/api/staff/attention` only.
- **Files:** `src/home-workspace.ts`, `src/home.css`.
- **Acceptance:**
  - (a) With a mocked queue the DOM order is lede, Now, Soon, Later, insights.
  - (b) The lede's number equals the sum the server returned.
  - (c) An empty queue shows the existing "Nothing needs a person right now" state and no zero badges.
  - (d) Quick actions are hidden for roles without the right (mocked view-only session).
  - (e) There is no layout jump between 760 and 1280px (spec §3).

### F5 — Items search and filter refinements (S6)

- **What:** under the toolbar, each applied filter (Show, Category, Place, Type) appears as a removable chip, using the Activity chip pattern, with "Clear all". The result count updates as you type. A no-match state names the active filters and offers "Clear filters". The words matching the search are marked in the row name with `<mark>`. All filtering stays client-side over the one fetched inventory, and the URL parameters are unchanged.
- **Files:** `src/staff.ts`, `src/styles.css` (toolbar and chip rules).
- **Acceptance:**
  - (a) Setting two filters shows two chips; removing one updates the list, the URL and the "Filters (n)" count.
  - (b) An old `?category=…&q=…` address restores the same chips.
  - (c) The highlight never splits a character or breaks screen-reader reading of the name.
  - (d) With 600 items, typing stays bounded: no per-keystroke full re-render beyond the existing paging (timing no slower than the `large-lists.spec.ts` baseline).
  - (e) Chips are buttons named "Remove filter: <name>".

### F6 — Lending Hub search and filter refinements (S4 part 2)

- **What:** category chips show their live counts. "Available now" becomes a chip in the same row on phones. On phones the search and chips stick under the header while scrolling. A no-match state suggests clearing the one filter that would bring results back, counted from the loaded catalog. Grouping, paging and the URL state are unchanged.
- **Files:** `src/public.ts`, `src/styles.css`.
- **Acceptance:**
  - (a) Chip counts equal the catalog rows per category (mocked catalog).
  - (b) The sticky bar never covers the sheet or a focused row (focus-visible test).
  - (c) The no-match suggestion names a filter that, when removed, yields at least one row.
  - (d) The chip row scrolls on its own, with no page overflow, at 320px and 200% text.

### F7 — Motion system (S6)

- **What:**
  - An Items or Stock row's sheet rises from the row it was opened from, reusing the view-transition pattern of `src/item-viewer.ts`, and returns focus and scroll on close.
  - View tabs crossfade the list in 150 ms.
  - Press states respond instantly; release eases out in 120 ms.
  - A save button shows its busy state during the request. It shows "Saved" only after the 2xx response, and it shows the error and returns to its previous state on failure.
  - Nothing animates continuously.
- **Files:** `src/ui.ts`, `src/staff.ts`, `src/stock-workspace.ts`, `src/styles.css` (motion block).
- **Acceptance:**
  - (a) Under reduced motion no transform transition or animation runs (computed style check).
  - (b) A mocked slow save shows busy and then "Saved" only after the response; a mocked 500 shows the error, and the field keeps its value.
  - (c) Closing a sheet returns focus to the row that opened it, at the same scroll position.
  - (d) Only `transform` and `opacity` are transitioned (stylesheet scan test).

### F8 — Page titles and empty states (each slice, for its own pages)

- **What:** the page title in Newsreader with one subtitle line of live context, for example "397 items · updated 1:30 AM". Each empty state says in one sentence what the list is for and gives one next action that the role allows. No illustration is added beyond the existing item icons.
- **Files:** the slice's own page modules; `src/ui.ts` (`emptyState()`).
- **Acceptance:**
  - (a) Every subtitle value is read from the API response (mocked values appear verbatim).
  - (b) Each empty state has exactly one action, and it is permitted for the mocked role.
  - (c) No heading is italic (computed style).

## 7. Slices and order

S1 (merged, V1.16.14) and S4 part 1 (merged, V1.16.15) stand. Slices still run one at a time on `src/styles.css`, each with its own branch, PR, release record and product revision.

| Slice | Content | Needs this amendment? |
|---|---|---|
| S2 Inventory | Visual only, as in the accepted spec (now in review on `slice/lh-ui-88-s2-inventory`) | no |
| S3 Operations | Accepted scope, plus F4 and F8 for its pages | F4, F8 |
| S4 part 2 Public and Self-Service | Accepted scope, plus F2, F3, F6 and F8 | yes |
| S5 Administration | Accepted scope, plus F8 | F8 |
| **S6 Guidance and interaction (new)** | F1, F5, F7 | yes |

**Process per slice:** implement within §3, then run one bounded Impeccable pass (`polish` by default; `adapt` where phones are the main risk). Then run the `ui-quality-gate` and the browser tests, collect before and after screenshots at the spec §5 widths, and complete the PR template. Hallmark does not run again unless Earl rejects the direction in §3.

## 8. Stop conditions

Stop if any of these happens:
- a flow needs a server, API, schema or permission change;
- a change would alter a token, a font or the navigation;
- a guide would need data that the API does not return;
- motion would need a layout property or a library;
- a third writer appears, or `src/styles.css` overlaps another slice;
- a required check fails or does not run;
- a merge is attempted without Earl's word for that PR.

## 9. Acceptance of this amendment

Earl accepts or edits it in chat. On acceptance, the steward:
- moves this file to `docs/specs/accepted/`;
- adds the "Specification changes" entry to `CHANGELOG.md` (LH-UI-88-A1: §5 surface map, flows F1–F8, the D9 change, S6);
- updates the LH-UI-88 task row.
