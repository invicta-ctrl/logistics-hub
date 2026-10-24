# Public landing — exact candidate slice specification
ID: LH-IP02-S02 · revision 1
STATUS: ACCEPTED BY OWNER, 23 OCTOBER 2026 / READY FOR IMPLEMENTATION KICKOFF / NO IMPLEMENTATION GO
Prepared 2026-10-23. Source facts were read only at the local `origin/main` tracking ref f61ee1b1d4bea731abdec8ce776cc65d1be185ae (not fetched). Refresh the exact base, full diff, permitted worktree and runtime identity before implementation.

INTENT: Define the public landing redesign as its own slice; this document authorizes no application edits.
OBJECTIVE: Rebuild the `/` page in the accepted revision 3 visual language, using its existing copy and links, without adding requests or changing the Lending Hub, Self-Service or staff routes.
TARGET: `landing()` and the shared public header and footer (`page()`) in `src/public.ts`, and their rules in `src/styles.css`.
AUTHORITATIVE SOURCES: The owner said on 23 October 2026 that "the landing looks right"; [LANDING_R3.md](LANDING_R3.md), with [landing-r3](landing-r3/index.html) as visual intent only; [SLICE_01_VISUAL_TOKENS.md](SLICE_01_VISUAL_TOKENS.md) for exact values; current accepted specs and workflow; the source and tests named below.
IN SCOPE:
- the landing hero, the data-free Lending Hub entry card, the services strip, "How borrowing works" and the restyled public header and footer;
- responsive behaviour, focus states, motion and reduced motion.
OUT OF SCOPE:
- the Lending Hub list body (`lending()`), Self-Service, offline and not-found bodies, beyond inheriting the shared header and footer;
- any API, Worker or schema change; any new request on `/`;
- staff routes (LH-IP02-S01); production.
CONSTRAINTS: Preserve V1.16 custody, the public/staff boundary, existing links and the offline reachability check in `src/main.ts`, which fetches `/`.
STOP CONDITIONS: Scope not accepted, no separate GO, conflicting writer on `src/styles.css`, unknown diff, changed contract, failed checks or unavailable rollback.

## Source facts at f61ee1b
- **Routing:** `src/main.ts:19` maps `"/"` statically to `landing` (imported at line 7 from `./public`). `"/lending"` maps to `lending` at line 20. `src/main.ts` stays unchanged.
- **Module:** `src/public.ts` exports `landing()` (line 68), `lending()` (line 100), `offlinePage()` (line 248) and `notFound()` (line 253). All four render through `page()` (line 11), which owns the public header (lockup, nav) and footer.
- **Brand assets:** the shared `CREST` and `MARK` image helpers in `src/ui.ts` (lines 192–194), served from `/brand/`. `src/ui.ts` stays unchanged.
- **Styles:** there is no `public.css`. The public header, hero, steps and footer rules are in `src/styles.css` (about lines 364–407: `.site-header`, `.lockup`, `.site-nav`, `.hero`, `.section`, `.steps`, `.site-footer`). That file is shared with the staff shell and with LH-IP02-S01.
- **Lending Hub URL keys:** `lending()` already reads `q`, `category`, `available` and `sort` (lines 142–145), so `/lending?q=…` and `/lending?available=1` work today.
- **Tests that assert today's landing:**
  - `tests/browser/app.spec.ts`, landing identity test from line 14: heading, header crest and mark, the "Logistics services" region, service links, home link name, Facebook link, and that **no `.shelf` exists and no `/api/public/catalog` request is made**;
  - `tests/browser/app.spec.ts` around line 625, the phone layout check;
  - `tests/browser/accessibility.spec.ts:76`;
  - `tests/worker-browser/worker-live.spec.ts:47`, the headline only.

## Contract
1. **Copy is kept.** These are unchanged:
   - the headline "Borrow equipment from the USC Department of Logistics";
   - the lede;
   - the service descriptions;
   - the three borrowing steps;
   - the footer institution lines, the © line and the "Student Council on Facebook" link (`target="_blank"`, `rel="noopener noreferrer"`, visually hidden "(opens in a new tab)").

   The hero eyebrow line and the services panel heading ("Find what you need…") are removed, as in the prototype.
2. **No new request on `/`.** The landing still makes zero `/api/public/catalog` requests. Availability lives only in the Lending Hub, as the existing test asserts.
3. **Lending Hub entry card instead of the prototype's sample shelf.** The prototype's sample counts never ship. The frosted card keeps the prototype's position and look, but it carries no numbers. It contains:
   - the title "Find equipment";
   - a search field whose form submits to `/lending?q=<text>` (empty submits to `/lending`);
   - a "Show what is available now" link to `/lending?available=1`.

   It must not use the class `shelf`. It works without JavaScript as a plain GET form to `/lending`, with routed navigation where the app router is running.
4. **Services strip.** It is a landmark named "Logistics services", with three links: Lending Hub `/lending`, Self-Service `/self-service`, and Staff sign-in `/staff`. Each link has an icon from the revision 3 icon family and its existing description.
5. **Header.**
   - The HAU USC crest sits beside "Department of Logistics".
   - Nav: "Lending Hub", and "Staff sign in" as an outlined pill. Lending Hub shows `aria-current` on `/lending`.
   - The home link keeps its accessible name "Department of Logistics HAU University Student Council home".
   - The DOL mark moves to the footer, which already renders both marks.
   - On phones the nav reduces to "Staff sign in" on one line; Lending Hub stays reachable from the hero and the services.
6. **Shared chrome.** The new header and footer come from `page()`, so `lending()`, `offlinePage()` and `notFound()` inherit them. Those bodies are otherwise unchanged.

## Exact candidate source write manifest
| File | Permitted change | Boundary |
|---|---|---|
| src/public.ts | `landing()` markup; `page()` header and footer markup; the entry-card form | No change to `lending()` behaviour, polling, URL keys or catalog rendering; no new imports beyond `src/ui.ts` helpers already exported |
| src/styles.css | Public header, hero, entry card, services, steps and footer rules, mapped to existing tokens with revision 3 values | Only public-surface selectors. Staff shell rules belong to LH-IP02-S01. The V1.16 delta must be reconciled and custody transferred first. |

No other source file changes. That includes `src/main.ts`, `src/ui.ts`, the Worker and API, and the `/brand/` assets.

## Exact candidate test write manifest
- `tests/browser/app.spec.ts`: update the landing identity test.
  - Header crest present; mark present in the footer, aspect ratio kept.
  - Services landmark and links unchanged.
  - Keep `.shelf` count 0 and zero catalog requests.
  - Add: the entry card submits to `/lending?q=…`, and its available link goes to `/lending?available=1`.
  - Keep the phone layout check (no horizontal overflow; nav on one line).
- `tests/browser/accessibility.spec.ts`: keep the landing audit passing.

Read-only regression: `tests/worker-browser/worker-live.spec.ts` (headline). No new fixture files.

## Visual and responsive acceptance
Values come from [SLICE_01_VISUAL_TOKENS.md](SLICE_01_VISUAL_TOKENS.md).
- **≥961px:** an oxblood maroon band using the live site's existing `--brand` #7a1419 (owner direction, 23 October 2026). Text is on-dark #fbf6ee, muted text 80% of it; the lowest checked contrast is 6.4:1. The entry card and its field sit on a deeper oxblood tint (#2b0a0c at 28% and 35%). Headline in Newsreader 600, 64/72, max 14ch. Lede 18/28. One light 56px primary button and an underlined secondary link. The entry card sits to the right as the only glass surface. The services strip overlaps the band edge by 48px with radius 16. Below it: steps in three columns on the neutral base, with section heading Newsreader 40/48.
- **601–960px:** single column. Headline 48/56. The card goes below the actions. Services and steps stack.
- **≤600px:** headline 40/48, full-width primary button, nav reduced to "Staff sign in" (nowrap). No horizontal overflow at 320px.
- **Motion:** the hero settles once (16px rise, 600ms, staggered 80ms). Hover lifts the button and card and nudges the arrows. Reduced motion removes all of it. Nothing loops.
- **Accessibility:** all text pairs meet WCAG 2.x. The card search field has a visible label or an accessible name, plus a submit button. The skip link and focus rings stay visible on the dark band (gold outline).

## Verification plan (future execution only)
1. Record branch, HEAD, upstream, diff, owner/lock and base; inspect the complete diff.
2. `npm run test:browser -- tests/browser/app.spec.ts tests/browser/accessibility.spec.ts`
3. `npm run build` (includes typecheck); `npm run verify:privacy`; `git diff --check`.
4. Run the Worker browser suite, including `tests/worker-browser/worker-live.spec.ts`, under current repository gates.
5. Capture `/` at 320, 390, 768, 1280 and 1440, plus `/lending` and the not-found page to confirm the shared header and footer. Check reduced motion and keyboard focus. Confirm zero `/api/public/catalog` requests on `/`.
6. An independent read-only Auditor reviews the diff before acceptance.

## Ordering, ownership and rollback
- **Ordering:** `src/styles.css` is also in LH-IP02-S01's manifest and in V1.16's custody. Run the two slices serially, with one Writer for `styles.css` at a time, after the V1.16 integration and reconciliation.
- **Rollback:** reverting this slice restores today's landing. No migration or data is involved, and links and routes are unchanged.
- No new application lane is activated by this document.

## Acceptance record
Visual intent: landing-r3, named by the owner on 23 October 2026 ("The landing looks right"), updated the same day to match this spec (data-free entry card, header and footer).

ACCEPTED by owner, 23 October 2026 ("I accept LH-IP02-S02 as written, including the data-free entry card and the header change"):
- this contract and its file/test manifests;
- the data-free Lending Hub entry card. Live counts on `/` remain out of scope and would need their own amendment, because they would reverse the tested decision that the landing never polls the catalog.
- the header change: crest only in the header, with the DOL mark in the footer.

**Ready for implementation kickoff.** Before any writer starts:
- refresh the exact base;
- confirm V1.16 custody and the `src/styles.css` reconciliation;
- order this slice serially with LH-IP02-S01, since both edit `src/styles.css`;
- name one Writer and an independent Auditor;
- record recovery identities.

Application implementation GO: NOT GIVEN. It is a separate owner decision.
