# Part 4.6 Brief — Visual Cleanup

STATUS: IN_PROGRESS (2026-09-30)
BRANCH: slice/part-04-6-visual-cleanup (from main 72475b8)
INSTRUCTION: Earl, 2026-09-30: accepted the visual cleanup plan by choosing "Start cleanup" (plan: Claude Doc "Logistics Hub visual cleanup plan", main tab). Part 5 and Open-Unit Tracking (A12) in the same doc remain PROPOSED.

## What it is
Subtraction, not a redesign. Keep the identity (oxblood, gold, Newsreader over IBM Plex Sans); remove effects layered on top of it and copy that restates itself. No new dependencies, frameworks or files beyond this brief.

## Rules every change is checked against
- One light theme on public and staff pages; oxblood for brand and primary actions only; gold only for focus and the one primary action on a dark surface.
- Newsreader only for page titles (h1) and the brand name; section and card headings in Plex Sans 600.
- Tokens only: two shadows (`--shadow-sm`, `--shadow-md`), two radii (6 px controls, 10 px cards and sheets), no literal colours outside `:root`.
- Motion only when it explains a change: sheet open/close, count roll, live-update row highlight, skeleton.
- Each fact said once per page; copy in the words staff and borrowers use at the counter.
- Markup that reads right to assistive tech: no visible text hidden with aria-hidden, names that match what is on screen.

## Steps (one verified commit each)
1 comments and jargon · 2 tokens (type scale, shadows, radii, literal colours) · 3 motion · 4 flat surfaces · 5 home · 6 header and footer · 7 Lending Hub · 8 sign-in · 9 buttons, chips, tags · 10 semantic fixes · 11 loans stats · 12 contrast · 13 self-service · 14 merge to main, delete the branch, production check.

## Gates per step
typecheck + build, `npm test`, `npm run test:browser`, screenshots at 1366 and 390 px of the touched pages. Before merge also `npm run test:browser:worker`, privacy scan and `wrangler deploy --dry-run`. No migration.

## Out of scope
Workflow or data changes; the axe dev dependency (needs Earl's approval); Part 5.
