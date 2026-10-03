# Public item photos — visual record (2026-10-03)

Amendment: `docs/specs/accepted/2026-10-03-public-item-photos-amendment.md`. Screenshots: `docs/visual-research/public-photos/` (JPEG; the pictures in them are fictional product shots drawn by `scripts/visual-evidence.mjs`, so no image file or real photo is in the repository). Regenerate with `npm run evidence -- --out docs/visual-research/public-photos --pages public-photos`.

## What was rendered

The real Worker and D1 (a throwaway local database, demo accounts), with 24 items listed publicly, a photo on two of every three, signed out as the public sees it, at desktop (1440), tablet (768), phone (390) and the narrowest phone (320): the Lending Hub list, the Self-Service "Get an item" list, and the Self-Service item sheet.

## Design choices

- The thumbnail sits in the row's left margin (48 px; 40 px at 320 px wide), positioned absolutely with a fixed size, the way the staff table does it, so rows never shift as pictures arrive and an item without a photo adds no element. Once any item has a photo, every row keeps the margin, so names line up (checked in a browser test at 320, 390 and 1280 px); with no photo anywhere the list is exactly what it was.
- The Self-Service sheet shows the same 320 px thumbnail at 160 px, letterboxed rather than cropped, so a person can confirm the whole item before borrowing. No larger size is public.
- Pictures are decorative (`alt=""`): the name is beside them.

## Defects found by looking, and fixed

1. **A ghost box at the top of every Self-Service screen.** The first render showed a dark rounded square above the header. A DOM probe found `<div class="ss-photo">`, an existing decorative element (the home screen's campus picture, hidden elsewhere by `display: none`) that the new sheet-photo rule had un-hidden by reusing the class name. The new class is `ss-item-photo`; a browser test now asserts the campus element stays `display: none` off the home screen, and fails if the collision returns.
2. **Three-line names at 320 px** ("1/8 / Illustration / Board") in both lists. A smaller thumbnail and margin at 360 px and below keep it to two lines.

## Measured

- Lending Hub cold-load layout shift, same build, before and after photos exist: desktop 0.546 then 0.564, phone 0.034 then 0.033. Photos add at most about 0.02 (within run-to-run variation); the rest is the page's existing skeleton-to-list swap (the elements that move are the live-status line, the list container, the note and the footer), which this change did not cause and did not touch.
- Thumbnails: 12 requests, 34 kB for the first screen on desktop; 8 to 11 requests, 22 to 31 kB on a phone (rows near the screen only; `loading="lazy"`).

## Not done

- External design references were not re-read: the network policy blocks those hosts in this environment (the same limit recorded in `docs/visual-research/v1.2.md`). The choices follow what V1.2 already researched for thumbnails (fixed-size boxes, lazy loading, decorative alt text) and what the staff table already does.
- Real phone cameras and screen readers were not tested; offline Self-Service shows no pictures (the service worker never touches `/api/`), which looks as the lists did before.
