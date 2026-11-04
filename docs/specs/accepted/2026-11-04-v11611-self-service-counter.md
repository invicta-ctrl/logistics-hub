# V1.16.11 Self-Service "Counter" redesign

Status: **Accepted** by Earl on 2026-11-04 in chat. Parent: V1.16.9 (`main` `4e407ce`). It follows V1.16.10 (DoL Director, PR #85) in merge order. Writer: Claude.

Earl's words, with screenshots of the Lending Hub item sheet, the public hero and the Self-Service home:
- "the photo is not filling all the way. browse and see whats available now points to the same place. Improve the design of the self service ui/ux drastically"
- "change this logo to the proper department of logistics logo" (the public header's crest)
- Direction: **"Counter (Recommended)"**. Theme: **"Light default (Recommended)"**.
- "keep the hau campus as a subtle background"

## 1. Photos fill their frame

- **Lending Hub item sheet:** the picture's frame is the sheet's full width at 4:3, up to 24rem tall. A cleaned picture's pedestal is scaled to the frame.
- **Self-Service item page:** the same, up to 26rem tall. The details sit in one card under it.
- **Self-Service cards:** the picture runs edge to edge across the top of the card.

## 2. The hero's two links go to different places

- **Before:** "Browse the Lending Hub" opened `/lending`, and "Show what is available now" opened `/lending?available=1`. With nearly every item available (42 of 43 that day), both showed the same list.
- **After:** the first stays. The second reads "At the office? Use Self-Service" and opens `/self-service`.

## 3. The Department of Logistics mark

- The public header and the Self-Service bar show the DoL mark in place of the HAU crest.
- The mark sits on a paper disc so it reads on oxblood.
- This replaces LH-IP02-S02's crest in the header, on Earl's instruction.

## 4. Self-Service: "Counter"

**Theme:**
- Light is the default. Dark applies only when this phone chose it (`ss-theme`).
- The bar is oxblood in both themes.

**Home:**
- The HAU campus photo is a faint, darkened band behind the bar and heading. Nothing else carries it.
- The heading, greeting and search sit on the band.
- Four large tiles: Borrow and Take, then Return and My activity.
  - Borrow and Take open their group's list. Each shows only while its group is offered.
  - Return and My activity always show.
- The catalog shelves follow as photo cards. Each count has a dot for its level.

**Item page:**
- Picture, then one details card: type, count, how, where.
- One action button is pinned to the bottom of the screen.

**Forms:** every sheet is numbered steps.
1. What: About the loan, Amount or Condition.
2. Who you are.
3. A photo.
4. The Data Privacy Waiver Statement and consent.

- A step shows a check once it is complete: no invalid identity field, a photo taken, consent given.
- Borrow now asks its reason, amount and return date before identity.

## 5. Not changed

- What each form sends, its validation, and the server.
- The Data Privacy Waiver Statement's wording.
- Offline queueing, the install page, staff pages.

No new packages. Motion follows `prefers-reduced-motion`. No continuous animation. No coloured edge on a rounded box.

## 6. Acceptance

- Self-Service starts light. The campus band shows on home only, and dark is remembered once chosen.
- On the item page, the picture is as wide as the details card.
- The public header shows the DoL mark and no crest. The hero's second link opens Self-Service.
- The Self-Service, app and accessibility browser suites pass, including 320 px phones and 200% text.
