# Visual depth evidence

## Stage Home, Resource Theater, quieter Loans — 2026-10-14 (Asia/Manila)

Owner request of 2026-10-14: use the visual-depth reference review to improve the staff frontend. Built on `slice/visual-depth-1wx3gp` (PR 51) as an isolated UI lane under HAU-AGENT-LANES-002. Production, migrations and the V1.16 records are out of scope.

Screenshots come from `node scripts/visual-evidence.mjs --base origin/main --pages visual-depth`: two throwaway local Workers (main and this branch) with the same seeded fixture data, signed in as the demo owner, at 1440×900, 1024×768, 390×844 and 320×720, with reduced motion so every frame is final. The one photo is a drawn, obviously fictional product shot uploaded through the real endpoint. No number, place or status on these pages is invented by the design: each comes from the seeded Worker.

| Surface | Before | After |
| --- | --- | --- |
| Home | A title, one line of text, then three boxed lists | A stage: the date and "Home" as a kicker, the greeting, the one answer that matters ("23 things to act on…"), search, and a storeroom drawing that never changes with the data. The first reason reads first; quick actions are tool tiles; insights are notes under a rule, not boxes |
| Home, nothing to do | A green alert box | The same stage (the idle scene) and a settled note between two rules |
| Item profile | A plain side sheet; small photo tile and lines of text | A panel attached to its row (a notch points at it; the row stays marked). The item stands on a drafting plate: its photo as a specimen card, or its icon with a floor shadow. Stock readings in the serif; the place is labelled **Recorded place**, never a live position |
| Loans | Every overdue loan a pink box with a red outline | A red rule at the row's edge plus the red due tag. Each open loan with a due date has a small time track (lent → due → today) drawn from its own dates |
| Empty lists | A dashed box | The drafting plate, its icon set down like an object |
| Tables, loan lists, buttons | Flat | Raised material: edge light and a small shadow; buttons press a pixel |

### Screens

| Screen | 1440 | 1024 | 390 | 320 |
| --- | --- | --- | --- | --- |
| Home, busy | [before](visual-depth/before/depth-home-1440.jpg) · [after](visual-depth/after/depth-home-1440.jpg) | [before](visual-depth/before/depth-home-1024.jpg) · [after](visual-depth/after/depth-home-1024.jpg) | [before](visual-depth/before/depth-home-390.jpg) · [after](visual-depth/after/depth-home-390.jpg) | [before](visual-depth/before/depth-home-320.jpg) · [after](visual-depth/after/depth-home-320.jpg) |
| Home, nothing to do | [before](visual-depth/before/depth-home-calm-1440.jpg) · [after](visual-depth/after/depth-home-calm-1440.jpg) | [before](visual-depth/before/depth-home-calm-1024.jpg) · [after](visual-depth/after/depth-home-calm-1024.jpg) | [before](visual-depth/before/depth-home-calm-390.jpg) · [after](visual-depth/after/depth-home-calm-390.jpg) | [before](visual-depth/before/depth-home-calm-320.jpg) · [after](visual-depth/after/depth-home-calm-320.jpg) |
| Item profile (lent item, no photo) | [before](visual-depth/before/depth-item-1440.jpg) · [after](visual-depth/after/depth-item-1440.jpg) | [before](visual-depth/before/depth-item-1024.jpg) · [after](visual-depth/after/depth-item-1024.jpg) | [before](visual-depth/before/depth-item-390.jpg) · [after](visual-depth/after/depth-item-390.jpg) | [before](visual-depth/before/depth-item-320.jpg) · [after](visual-depth/after/depth-item-320.jpg) |
| Item profile (drawn photo) | [before](visual-depth/before/depth-item-photo-1440.jpg) · [after](visual-depth/after/depth-item-photo-1440.jpg) | [before](visual-depth/before/depth-item-photo-1024.jpg) · [after](visual-depth/after/depth-item-photo-1024.jpg) | [before](visual-depth/before/depth-item-photo-390.jpg) · [after](visual-depth/after/depth-item-photo-390.jpg) | [before](visual-depth/before/depth-item-photo-320.jpg) · [after](visual-depth/after/depth-item-photo-320.jpg) |
| Loans, out now | [before](visual-depth/before/depth-loans-1440.jpg) · [after](visual-depth/after/depth-loans-1440.jpg) | [before](visual-depth/before/depth-loans-1024.jpg) · [after](visual-depth/after/depth-loans-1024.jpg) | [before](visual-depth/before/depth-loans-390.jpg) · [after](visual-depth/after/depth-loans-390.jpg) | [before](visual-depth/before/depth-loans-320.jpg) · [after](visual-depth/after/depth-loans-320.jpg) |
| Empty list (Stock activity today) | [before](visual-depth/before/depth-empty-1440.jpg) · [after](visual-depth/after/depth-empty-1440.jpg) | [before](visual-depth/before/depth-empty-1024.jpg) · [after](visual-depth/after/depth-empty-1024.jpg) | [before](visual-depth/before/depth-empty-390.jpg) · [after](visual-depth/after/depth-empty-390.jpg) | [before](visual-depth/before/depth-empty-320.jpg) · [after](visual-depth/after/depth-empty-320.jpg) |

Item opened from its row (the attached panel; computers only): 1440 [before](visual-depth/before/depth-item-attached-1440.jpg) · [after](visual-depth/after/depth-item-attached-1440.jpg), 1024 [before](visual-depth/before/depth-item-attached-1024.jpg) · [after](visual-depth/after/depth-item-attached-1024.jpg). The other item frames open by address, so nothing in view opened them and the panel is not attached. Whole Home page at 1440: [before](visual-depth/before/depth-home-full-1440.jpg) · [after](visual-depth/after/depth-home-full-1440.jpg).

Timings (the script's own probe, median of 7 loads per run, two runs): Items cold load to first row 234 → 228 ms and 242 → 273 ms; section switch 65 → 65 ms and 74 → 75 ms. The two runs disagree in direction, so this reads as noise, not a measured change. Bundle (gzip): main CSS 23.75 → 25.60 kB, Home CSS 1.20 → 2.29 kB, Home script 3.11 → 3.94 kB (the drawing), staff script 39.51 → 39.85 kB. No new dependency.

### Depth and motion

- Depth is used for meaning only: ambient (page), raised (lists, tables, tiles), floating (menus), modal (the attached panel). Edge light marks a lit top edge; the drafting grid and crop marks appear only on editorial surfaces (the item profile, Home's stage, empty lists).
- Motion runs only under `prefers-reduced-motion: no-preference`: the panel grows from its row (260 ms, settle easing) and leaves toward it; the item settles on its plate after the record arrives; Home's drawing settles once. The existing reduce rule stops all of it, and every screenshot above was taken with reduced motion.
- `sheet().open(origin)` records the origin's visible centre as viewport coordinates through the CSSOM (the `style-src 'self'` policy forbids inline style attributes). It attaches only when at least 3rem of the origin is in view beside the open panel; scrolling the page behind detaches it. Phone sheets never attach.

### Accessibility checks

- Contrast (WCAG 2.2 AA, computed from the tokens): kicker and labels `--text-3` on `--subtle` 4.97:1, on white 5.56:1; "Home" `--brand` on `--subtle` 9.67:1; overdue `--bad` on `--bad-tint` 6.50:1; tile details `--text-3` on white 5.56:1.
- The h1 is still "Home"; the date separator is silent (`content: "/" / ""`); the drawing and the loan tracks are `aria-hidden` and repeat nothing that is not already in words.
- Keyboard order on Home is unchanged: search, Open Attention, the first reason. Focus rings show on tiles (offset outline) and rows.
- 320 px and 200% text: the Home, Items, Locations, Attention and Search browser tests check for no sideways scroll at 320, 390, 768 and 1366 px and at 200% text; all pass.

### Test evidence

All on the final code of this slice, in a cloud container (Chromium at `/opt/pw-browsers/chromium`):

- `npm run typecheck`: passed.
- `npx vitest run`: 815 passed, 2 skipped.
- `npm run verify:privacy`: passed.
- `npx playwright test` (mocked browser suite): 247 passed in 4.7 min. In an earlier run under extra load, `home.spec.ts` "a held optional insight does not block navigation or expire a newer screen" failed twice, then passed 10 times out of 10 on this branch and 10 out of 10 on `main`. It races a held 401 against the next page's code loading, in code this slice does not change.
- `npm run test:browser:worker` (real local Worker and D1): 90 passed in 11.3 min.
- PR 51 CI on the first checkpoint: `checks`, `worker-e2e` and CodeQL green.

Unrun: real phones, a screen reader, and forced-colours mode.
