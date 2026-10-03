# Icon system and staff shell: research and rendered evidence

Scope: the shared icon primitive (`icon()` in `src/ui.ts`, the `.icon` contract in `src/styles.css`), the staff shell's section icons, the account menu and the phone bottom bar. Mainline work on `main` (Earl, 2026-10-03), not a Road-to-V2 slice; later slices consume this primitive and do not add a second one. Screenshots in `docs/visual-research/icons/` show the fictional demo accounts and the public seed catalogue, never real staff.

## How the evidence was made

- The real application: a local Worker and D1 (`wrangler dev --local`) with every migration (`0001`–`0020`), the 397 seeded items and the two demo accounts, rendered in Chromium through Playwright with reduced motion.
- Before = `main` at `fa31e97`; after = this change. `npm run evidence -- --out <dir> --base fa31e97 --pages items,item-profile,stock,loans,self-service,activity,admin,account,shell,public-photos`.
- The new `shell` scene (`scripts/visual-evidence.mjs`) photographs the bar and then the open menu (avatar menu, or More on phones) at 320, 375, 414, 768, 1024 and 1440 px, a short phone (667×375) and a short laptop (1280×560), browser zoom 125% and 150% on a 1440 px screen and 150% on a 768 px tablet (a narrower CSS viewport at a higher pixel ratio, as browsers zoom), and root text at 150% (320, 375, 1024) and 200% (320). It also measures, per scene, squashed icons (width ≠ height), cut-off labels (the laid-out text against its box, since an ellipsis hides overflow), neighbouring labels run together, sections overlapping the account control, icon-only controls without a name, targets under 24 px and sideways page scroll, into `shell-checks.json`.
- I inspected the images by eye; the findings below come from that inspection and from the measurements, not from reading the CSS.

## Sources (accessed 2026-10-03)

The proxy blocked lucide.dev; every source below was read through search-result excerpts of the pages named, not the full pages.

| Source | What I took from it |
|---|---|
| Lucide icon design guide, https://lucide.dev/contribute/icon-design-guide | 24×24 canvas, at least 1 unit of padding, one stroke width, round caps and joins, centred strokes. Small dots are tiny circles rather than zero-length lines. The existing Hub icons already follow this family at a 1.75 stroke; the guide confirmed the dots were the outlier. |
| Carbon Design System, icon usage, https://carbondesignsystem.com/elements/icons/usage/ | A small fixed size scale (16, 20, 24, 32) and consistent sizes across the product; 16 and 20 px icons balance IBM Plex at 14–16 px, the Hub's typeface. Beside text, icons are centre-aligned, not baseline-aligned. Interactive icons need 44 px targets. |
| Material Design 3, navigation bar (via the material-components-android docs and SAP Fiori's M3 notes) | 24 dp bar icons, labels always shown (no icon-only bars), an active indicator behind the icon, short labels. |
| WCAG 2.2 (1.4.4 Resize text, 1.4.10 Reflow, 2.5.8 Target size) and current icon-only button guidance (getwcag.com/accessibility-guide/button-name; designsystem.wwu.edu, icons used as links and buttons) | Text must survive 200% without losing content; reflow is required down to 320 CSS px; targets at least 24 px. Icon-only controls get their name from the control (`aria-label` or visible text); the SVG itself is `aria-hidden` and `focusable="false"` so it is never announced twice. |

## What was wrong (before)

1. **Bottom-bar labels were cut short.** Five equal columns at 320 and 375 px showed "Self-Se…"; with 150% text the same; with 200% text every label became an ellipsis ("It…", "St…"). Measured in `icons/before-shell-checks.json`; visible in `icons/before-shell-320.jpg` and `icons/before-shell-text200-320.jpg`.
2. **Unicode glyphs as icons.** The three quantity steppers (staff quantity editor, loan form, Self-Service) drew "−" and "+" as text, so their weight, size and centring followed the font, not the icon family.
3. **The More icon needed its own stroke width** (`stroke-width: 3`), because its dots were zero-length lines whose size came from the stroke. The vertical "more" glyph in the Self-Service install steps had tiny dots for the same reason.
4. **Stroke weights varied by component**: 1.25 in empty states, 2.25 on done checklist items, 3 on More.
5. **Sizes were set ad hoc**: eight width/height pairs (14, 16, 18, 22, 24, 28 px) restated per component.
6. **Pixel nudges**: `margin-top: .05rem`, `.1rem` and `.125rem` per component to line an icon up with its text, each correct only for one font size.
7. **Semantics**: Activity used a plain clock (reads as "time" or "due"); the Public Lending Hub item used only the generic "opens elsewhere" arrow, so its icon said how it opens but not what it is.

## What changed (after)

- **One contract.** `.icon` takes its size from `--icon-size` (default `--icon-md`) and five tokens: `--icon-xs` .875rem (chips, sort, small controls), `--icon-sm` 1rem (beside text, buttons), `--icon-md` 1.125rem (alone), `--icon-lg` 1.375rem (bars, tiles, steppers on the phone), `--icon-xl` 1.75rem (photo pickers). One stroke (1.75), round caps and joins, `fill: none`, `stroke: currentColor`, `flex: none` (never squashed by a flex row), and `vertical-align: middle` when an icon sits inline in text. All component overrides of stroke width are gone.
- **Structural alignment.** An icon that leads a run of text (alerts, callouts, toasts, hints, listing status, location, the Self-Service notices) is centred on the first line with `margin-top: calc((1lh - size) / 2)`, which holds at any text size. The per-component nudges are removed.
- **Dots are drawn as circles** (`dots`, `more`), so More needs no special stroke.
- **Steppers use the drawn `minus` and `plus`**; their names stay "One less" / "One more".
- **Semantic map** (information architecture unchanged):

  | Destination | Icon | Why |
  |---|---|---|
  | Items | box | One catalogued thing. |
  | Stock | stacked layers | Quantities on shelves, distinct from a single box. |
  | Loans | two-way arrows | Out and back. |
  | Self-Service | phone | It is the phone app. |
  | Activity (and Self-Service "My activity") | history (clock with a turning-back arrow) | A record of what happened, not a time. |
  | Administration | shield with a check | Privileged settings and accounts. |
  | My account | person | Unchanged. |
  | Public Lending Hub | globe, with a small new-tab mark at the row's end | What it is (the public site) and how it opens. |
  | Sign out | door with an arrow | Unchanged. |
  | More | three dots | Unchanged meaning, now drawn as dots. |

- **Bottom bar.** Each section is as wide as its label needs and the spare width is shared (`grid-auto-columns: auto`, a fixed column gap between sections), so "Self-Service" is whole at 320 and 375 px. Icons sit at one height whatever the labels do. Larger text first wraps a label at its hyphen (150% text on 320 px: "Self-/Service", every label whole). Only a bar narrower than five wrapped labels, measured with a container query in label-ems so the text size counts (200% text on 320 px), puts labels back on one line shortened with an ellipsis: V1.1's rule that every section stays on screen at 200% (`tests/worker-browser/worker-live.spec.ts`, "staff workspace fits a 320 px phone") wins over whole labels there, and each full name stays in the accessibility tree.
- **Account menu.** Each item keeps its own icon at the start; Public Lending Hub adds the new-tab mark at the end, small (`--icon-xs`), so the row reads "public site, opens in a new tab" without words.

## Rendered results

- `icons/before-shell-checks.json` and `icons/after-shell-checks.json` (15 scenes): before, 5 failed on cut-off labels (320, 375, 150% text on 320 and 375, 200% text on 320); after, 14 are clean (no squashed icon, no cut-off or run-together label, no overlap between sections and the account control, no unnamed icon-only control, no target under 24 px, no sideways page scroll) and only 200% text on 320 px still shortens labels, by design (above).
- 320 px (`before-` and `after-shell-320.jpg`): "Self-Se…" is now "Self-Service"; the five icons sit level; the active pill is unchanged.
- More sheet and avatar menu (`*-shell-320-menu.jpg`, `*-shell-1440-menu.jpg`): the history and globe icons read clearly at both sizes; the new-tab mark is visibly secondary.
- 150% text at 375 px (`*-shell-text150-375.jpg`): every label whole on one line. At 320 px (`*-shell-text150-320.jpg`): every label whole, Self-Service on two lines at its hyphen, icons level.
- 200% text at 320 px (`*-shell-text200-320.jpg`): all five sections on screen with one ellipsis each, a little more of each label than before ("Lo…" for "L…").
- Steppers (`*-owner-desktop-item-profile.jpg`, `*-owner-desktop-stock.jpg`, `*-public-selfservice-sheet-phone.jpg`): the text "+" sat lower than the "−" and took the font's weight; the drawn minus and plus are centred and match the family.
- Leading icons (`*-owner-desktop-stock.jpg` hint line, the profile's location and review checklist): each sits on its first line of text.
- Self-Service home (`after-selfservice-home-phone.png`): My activity's history icon in its tile ring; the offline-status icon level with its heading.
- No timing regression: cold load to first row 487 → 371 ms and section switch 109 → 90 ms (medians on the same machine; a CSS and icon change, so the difference is run-to-run noise, not a speed-up).

## Rejected

- A second icon library (Lucide, Material Symbols, Phosphor): the existing family is complete for current needs and already matches the guides above; a library would add a dependency and a second visual voice.
- Icon-only bottom bar or hiding labels with large text: M3 and WCAG 1.4.4 both rule it out.
- Shortening "Self-Service" in the bar, or moving it under More when space is tight: changes the information architecture to fit an icon.
- Per-icon pixel offsets: replaced by the first-line rule above.

## Tests

`tests/browser/shell.spec.ts` renders the staff shell at 320, 375, 414, 768 and 1440 px and with 150% text at 320, 375 and 1024 px, opens the avatar menu or More, and asserts: no label cut short (laid-out text inside its box), neighbouring labels never run together, every icon square, no sections overlapping, every icon `aria-hidden`, every icon-only control named, no sideways scroll, and every destination reachable from that layout. A separate case checks that at 200% text on 320 px every section stays on screen and More opens the menu. Against the previous stylesheet four cases fail on cut-off labels; without the column gap the 150% case at 320 px fails on run-together labels.

## Known limitations

- At 200% text on a 320 px phone five labels cannot fit side by side, so each is shortened with an ellipsis (unchanged V1.1 behaviour); icons and full accessible names remain.
- `@container` queries need iOS 16+; older Safari keeps the wrapped labels at 200% (still on screen, possibly cut on both lines).
- The bare-item placeholder in the items table and the select chevron are CSS data URLs, so they restate their paths outside `src/ui.ts`; both use the family's stroke.
- iOS before 16.4 does not know the `lh` unit; there, a leading icon sits at the top of its line instead of centred (the old nudges were also approximations).
