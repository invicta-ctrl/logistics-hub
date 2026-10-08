# Data-Surface UI evidence

## UX-1 — container-aware Stock and Items cards — verified 2026-10-09 (Asia/Manila)

Fictional mocked fixtures only. The original UX-0 report was absent from the Git tree, so this records the reproduced baseline and UX-1 result on the same main-derived slice.

| Case | Baseline | UX-1 result |
| --- | --- | --- |
| Items, 1440px viewport with a 620px or 700px table container | Table | Card with the item ID under the name; a selected-row checkbox stays inside the card and keeps focus |
| Items, 1440px viewport with a 1000px table container | Table | Table; ID column stays visible and its sticky header remains at the app-bar edge after scrolling to row 11 |
| Stock, 1024px viewport / 576px table container | The action column was clipped after `Sto…` | Card; both Stock in and Add to restock buttons are inside the wrapper |
| Stock and Items, 320/390/768/1024/1440px viewport checks | No page overflow; viewport rules determined card mode | No page overflow; the 44rem container determines card mode for the responsive wrappers |

- Baseline: `npx playwright test tests/browser/large-lists.spec.ts --output test-results/ux1-baseline` produced the intended regression failure: the 620px contained Items table was still a table. It captured the original visual state before the CSS change.
- Final result: `npx playwright test tests/browser/large-lists.spec.ts --output test-results/ux1-final-persistent-selection` passed 4/4. Its layout metrics confirm cards at 620px and 700px, a table at 1000px, all Stock action buttons inside their wrapper, and a 620px card after the bulk-selection rerender with a persistent external-container rule.
- Relevant accessibility regression: `npx playwright test tests/browser/accessibility.spec.ts --output test-results/ux1-accessibility-final` passed 26/26 after the final display-only ID correction.
- Preserved visual evidence (unchanged fictional fixture PNG bytes): [Stock 1024 before](data-surface-ui/stock-1024-before.png), [Stock 1024 after](data-surface-ui/stock-1024-after.png), and [Items 620 after](data-surface-ui/items-container-620-after.png).
- The scoped Impeccable detector review on 2026-10-09 found no UX-1-introduced warning; its three findings are unchanged pre-existing animation/width-transition rules outside this diff.

Unrun: real phone and screen-reader checks. UX-2 action menus, UX-3 number/sort semantics, and UX-4 Directory Usage remain out of scope.
