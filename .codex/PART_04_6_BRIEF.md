# Part 4.6 Brief — Visual Cleanup

STATUS: COMPLETE (2026-09-30); merged to main by fast-forward; slice branch deleted
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

## Decisions made while implementing
- Body text stays 16 px (the plan's scale said 17) so dense staff tables do not grow.
- The Youth Development Day banner Earl chose on 2026-09-29 left the home hero, as the accepted plan says (one-event poster). The file is kept only as the worker suite's upload fixture, `tests/worker-browser/loan-photo.jpg`; restoring it is one figure in `landing()`.
- Header "Staff sign in" is a plain nav link, so gold is used once per dark surface ("Browse the Lending Hub"); both header links stay visible on phones.
- Availability reads "3 pieces available", "1 left", "All out". The live status on every live view reads "Updated <time of last change>" (shared `live()` helper), not only the Lending Hub.
- Self-service took Earl's card default, "Flat dark" (no answer arrived): dark Dusk palette, crest and gold kept; photo, aurora, grain, glass, gradients, glows, sparks and cross-fades removed. Earl asked for the photo back the same day; Part 4.8 restored it (docs/OFFLINE_SELF_SERVICE.md, section 16).
- Contrast: `--text-3` darkened to #6f675e (≥4.5:1 on every light surface); new `--line-field` (#958d82, ≥3:1) for field borders and the switch track.
- Also removed: route and screen cross-fades (View Transitions), CSS rules with no markup, the unreferenced `.loan-list--page` class.

