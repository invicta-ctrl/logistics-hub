# LH-IP02-S01 — visual token and component hand-off (revision 3)
Status: OWNER-ACCEPTED VISUAL CONTRACT, 23 October 2026. It is part of [SLICE_01_SPECIFICATION.md](SLICE_01_SPECIFICATION.md) and authorizes no application edits.
Source of truth: [prototype-r3](prototype-r3/index.html) (`prototype.css?v=r3-2026-10-23f`). These are the exact values to reproduce. Map them into the existing `src/styles.css`, `src/home.css` and `src/attention.css` token and theme mechanisms. Do not copy the prototype stylesheet wholesale; prototype-only controls never ship.

## Colour tokens
| Role | Light | Staff-dark | Used for |
|---|---|---|---|
| frame | #7a1419 (oxblood, the live site's `--brand`) | #2b0a0c (the live site's `--brand-dark`) | Rail and app frame around the work panel |
| frame-ink / frame-muted | #fbf6ee / rgba(251,246,238,.8) | same | Rail text: active / resting |
| frame-hover / frame-active | rgba(43,10,12,.22) / .38 | rgba(255,255,255,.06) / .11 | Rail hover and current item |
| frame-line | rgba(255,255,255,.14) | .08 | Rail separators |
| gold-frame | #e8c27a | same | Rail count badge (text #2a1a1e), active rail icon, rail focus ring |
| avatar | rgba(43,10,12,.45), 1px inset rgba(255,255,255,.18), text #fbf6ee | same | Account avatar on the frame |
| bg | #ffffff | #171515 | Work panel |
| bg-2 | #f7f6f4 | #1c1a1a | Context column, segmented track |
| bg-hover / bg-press | #f3f2ef / #eceae6 | #222020 / #2a2727 | Row and control hover / press |
| line | #e9e6e1 | #2c2929 | Hairlines |
| ink / ink-2 / ink-3 | #1c1918 / #544e4a / #6d6762 | #f3efeb / #cbc4be / #a49d97 | Text: primary / secondary / meta |
| accent | #7a1419 | #8f1d24 | Primary button, selection (HAU USC maroon) |
| accent-strong | #5e0f13 | #a8272f | Primary hover |
| accent-text | #7a1419 | #e2bf86 | Links, selected title, focus ring |
| accent-soft | #f7eded | rgba(226,191,134,.09) | Selected row, active filter, banner |
| urgent | #7a1419 | #f2a59d | Now text and marker |
| gold | #b48535 | #d7b06f | Soon marker only |
| glass / glass-line | rgba(255,255,255,.74) / rgba(28,25,24,.08) | rgba(29,27,27,.74) / rgba(255,255,255,.08) | Floating layers; blur(24px) saturate(1.6) |
| scrim | rgba(24,14,17,.28) | rgba(0,0,0,.5) | Dialog backdrop; blur(4px) |
| sk / sk-hi | #efedea / #f9f8f6 | #232020 / #2e2a2a | Skeleton bar / sweep |

No decorative gradients. The skeleton sweep is the only gradient.

**Frame amendment (owner, 23 October 2026).** The frame changed from the near-black #25171b to the oxblood maroon #7a1419 ("Use the oxblood maroon #7a1419 for the staff prototype's side bar and frame"). Staff-dark uses the deep oxblood #2b0a0c. The rail was rechecked: 12 pairs pass in both themes, the lowest being muted rail text on the light frame at 6.87:1. The public landing band uses the same #7a1419 (LH-IP02-S02).

**Contrast (checked 23 October).** 26 pairs pass WCAG 2.x in both themes.
- **Text, minimum 4.5:1.** The lowest are meta on the selected tint (4.86) and meta on row hover (4.98).
- **Marks and focus rings, minimum 3:1.** The lowest is the light Soon marker (3.31).
- **Dark Now and Soon markers** differ by hue only. Urgency is therefore always stated in text: the group label and the record status.

## Space, radius, depth
- **Spacing:** 4, 8, 12, 16, 24, 32, 40, 48 and 64px. 4 is used only for stacked text and icon-text pairs; 12 only for icon and label gaps.
- **Radius:** 8 (controls, rows inside menus), 12 (rows, cards, popovers, primary button), 16 (panel, dialogs, sheets), full (pills, avatar, icon buttons).
- **Shadows (always offset):**
  - shadow-1: `0 1px 2px rgba(28,18,20,.06)`
  - shadow-2: `+ 0 8px 24px -8px rgba(28,18,20,.16)`
  - shadow-3: `0 2px 6px .06, 0 24px 56px -12px .28`
- **Work panel:** margin 8px inside the frame, radius 16, shadow-1.

## Typography
Two families only: IBM Plex Sans (UI) and Newsreader (display), from the existing dependencies.

| Role | Face | Weight | Size / line | Tracking |
|---|---|---|---|---|
| Page title | Newsreader | 600 | 48/56 (36/44 ≤600px) | -0.022em |
| Record title | Newsreader | 600 | 32/40 (28/36 ≤600px) | -0.015em |
| Dialog title | Newsreader | 600 | 28/36 | -0.015em |
| Section heading | Plex | 600 | 24/32 (20/28 ≤600px) | -0.015em |
| State heading | Plex | 600 | 20/28 | -0.01em |
| Row title, body | Plex | 500 / 400 | 15/24 | 0 |
| Controls, nav | Plex | 500 | 14/20 | 0 |
| Meta | Plex | 400 | 13/20 | 0 |
| Labels | Plex | 600 | 12/16, uppercase | 0.08em |

Text never shrinks to fit; rows grow or wrap instead. References (`DM-0218`) and date-times (`20 Oct, 09:04`) never break across lines.

## Components
- **Rail (≥1200px, 240px wide):**
  - Top: the HAU USC crest (38×44) and "Logistics Hub" 16/24 600.
  - Find: a 40px button with "Ctrl K"/"⌘ K".
  - Groups: Home (no label), then Resources, Circulation, Records and Manage, each with a label; links are 40px.
  - Pinned bottom: the Department of Logistics mark (32×28) with "Department of Logistics / HAU USC", then the account row (32px circular avatar) and a theme button.
  - Only the link list scrolls. Below 960px of height, links become 32px and groups sit 8px apart.
- **Queue:**
  - Head: "Needs attention" with a Filter pill button (40px, radius full) whose menu lists reasons with counts. An active filter becomes an accent-soft chip with a clear button.
  - Segmented view: All · Now · Soon · Later. Track 40px with 4px padding and radius 12; the thumb is equal-width and moves with `translateX` only.
  - Group labels: 32px above, 8px below.
  - Rows:
    - min-height 72px, padding 16, radius 12, columns 20px icon · text · urgency · 16px chevron;
    - row text aligns with the heading, and the hover background extends 16px beyond it;
    - when the container is under 560px, urgency drops under the text.
- **Context column** (clamp(320px, 28vw, 400px); 400–480 at ≥1600px):
  - Nothing selected: "Continue" (resume button with the place icon), then "Insight" with an "About this insight" disclosure.
  - Selected: the record document. A 64px sticky glass bar holds the source, previous, next and close. Below it: title, plain-language reason, urgency status, a facts list (Where, Recorded, Last activity, Reference; 112px label column), "Why it's here", and a 48px primary action in a sticky glass footer.
- **Phone (≤600px):**
  - 56px glass header with the crest; glass bottom bar Home · Find · More, 64px plus safe area.
  - Record as a bottom sheet at 92dvh, radius 16 at the top.
  - Primary controls 48px; segments 40px inside a 48px track.
- **Tablet (601–1199px):** 72px icon rail with circular 40px targets, tooltips to the right and an "All destinations" drawer. Single column below 1000px, with the record as a 448px side sheet.
- **Tooltips:** one top-layer label positioned in the viewport, after a 400ms hover delay or immediately on keyboard focus. They are hidden on labeled rail links.
- **Icons:** one outline family, 24px grid, 1.5px stroke, round joins. Path data is in `prototype-r3/prototype.js` (`icons`). The mapping is: Home house; Items box; Stock layers; Locations pin; Kits case; Catalogue book; Loans hand-over arrows; Self-Service review phone-check; Activity history; Administration shield. There are no icon tiles.

## Motion
Durations: 140ms (feedback), 220ms (state), 360ms (layout and overlays). Easing is `cubic-bezier(.16,1,.3,1)` in and `cubic-bezier(.4,0,1,1)` out. Exits are faster than entrances.
- **Rows:** background fade and chevron slide-in on hover; scale(.995) on press.
- **List arrival:** rows rise 8px with a 40ms stagger, capped at 8 items.
- **Segmented thumb:** slides in 360ms.
- **Buttons:** the primary lifts 1px and its arrow moves +4px on hover, then scale(.98) on press. Icon-button circles grow from scale .6.
- **Disclosure:** `grid-template-rows` 0fr→1fr with a chevron flip.
- **Popovers:** scale .97→1 from their origin.
- **Dialogs:** translate 8px, scale .98→1, and the backdrop blurs in. Sheets slide 100%.
- **Selection:** the selected row's title travels into the record heading (View Transitions, instant fallback).
- **Loading:** a row-shaped skeleton with one shared sweep (`background-attachment: fixed`).
- **Now pulse:** the marker pulses twice when the list arrives, then stops.

Nothing loops. `prefers-reduced-motion` removes every animation and transition, and nothing ever waits on motion to show content.

## Not carried over
- **Removed in revision 3 and not restored by the owner:** density toggle, queue text search, the `/` shortcut, the keyboard-shortcut panel.
- **Dropped in revision 3:** revision 2's urgency horizon tint.
- **Prototype apparatus that never ships:** the prototype bar, the state selector and the synthetic destination dialogs.
