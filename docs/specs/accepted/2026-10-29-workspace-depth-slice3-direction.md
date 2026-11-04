# Workspace depth, slice 3: design direction (Administration and the rail)

STATUS: ACCEPTED by Earl 2026-10-29 ("Approve direction"), proposed the same day as the direction `2026-10-29-workspace-depth.md` §5 requires before any slice 3 code.
SCOPE: §5 of the accepted spec, released with slices 1 and 2 as one V1.16.7 (the spec's amendment).
METHOD: one Hallmark direction pass (redesign inside the existing system). Read before writing: the five Administration sections at 1440 and 390 px on the V1.16.7 build, `src/admin-frame.ts`, `src/staff-shell.ts`, `src/card-motion.ts` and the rail's rules in `src/styles.css`.

## What stays (locked)

- The oxblood rail, warm paper, gold actions, IBM Plex Sans and Newsreader, rows on rules, and the existing buttons, sheets, tags and stat cells.
- The Administration heading, the five sections in their order, their URLs, and everything each section does today. No setting moves to another section.
- No new library and no CSP change. CSS (3D transforms, layered shadows, `linear()` springs, `@starting-style`), the Web Animations API and the View Transitions API.
- Headings stay upright; nothing is invented (every figure on a page is a figure the Worker returned).

## What is wrong today (from the screenshots)

1. Each section has its own shape. System is a status table, Catalog is a stack of prose, figures and forms, Staff is cards. Nobody can tell at a glance whether a section needs them.
2. The decisions are buried: "Turn off", "Change it in Self-Service" and "Manage" are small links at the end of long rows.
3. On a phone the section tabs scroll sideways and cut off ("elf-Service"), and they move with the page.
4. The rail is one flat oxblood field. Its destinations are words on it, the current one a darker block; the groups cannot fold, so Administration sits at the bottom of a long list.

## Administration: one shape for every section

Every section reads top to bottom in the same four bands. A band with nothing in it is left out, never shown empty.

1. **Verdict.** One line, in the existing callout: what the section's state is, in words. Green rule when all is well, gold when something is waiting, red when something failed. The System callout today is the model ("Everything checked is working.").
2. **Needs a decision.** Only when there is one. Rows on rules, each with what is waiting, since when, and its one action as a real button on the row's right. Examples from today's data: Self-Service closed for maintenance; 141 unclassified items; an account waiting for a role.
3. **At a glance.** The section's figures in the stat cells Catalog already uses (Active items, Classified …), at most four, each linking to where the figure comes from.
4. **Settings, in titled groups.** Each group is a Newsreader-free Plex heading on a rule; each setting is one row: its name, its current value with the status dot, one sentence on what it does, and a **Change** button. A row never ends in a bare text link.

Sections map onto it using only what each section already shows; no new figure or setting is invented:

| Section | Verdict | Needs a decision | At a glance | Settings groups |
|---|---|---|---|---|
| System | Everything checked is working, or what is not | A check that failed; Self-Service closed | (none: the checks are the content) | Right now (the checks), AI suggestions, Picture cleanup, This version |
| Self-Service | Open, or closed for maintenance | Closed for maintenance (Reopen) | (none) | Self-Service on phones, What phones ask for, Test Self-Service |
| Catalog | How complete the catalog is | Unclassified items (Show them in Items) | Active, Classified, Unclassified, At capture (today's cells) | Cataloguing, Other names, Hints |
| Staff | Accounts and roles | (as the data allows; none today) | (none) | Accounts (rows, each with Manage), What each role can do |
| Accountability | What is kept, and whether anything is old enough to remove | Old personal details ready to remove | (none) | Old personal details, Security activity |

**One confirmation sheet.** Every Change and every decision opens the same sheet (`confirmImpact`, extended):
- kicker (the section), the question as title ("Turn off AI suggestions?");
- a **Now → After** line, the current value struck to the new one;
- **Who it affects**, in a short list;
- whether it can be undone, in one sentence;
- Cancel, and the confirm button (red when it removes or closes something).
The confirm button shows that it is working; the sheet closes only when the Worker says yes, and only then does the row's value change, with one short gold settle on the new value. A refusal stays in the sheet with the Worker's reason.

**Section tabs on a phone stay put.** The five sections become a segmented bar fixed under the page heading: five equal cells, an icon over a one-word label (System, Self-Service, Catalog, Staff, Records for Accountability, whose page title keeps its full name). Nothing scrolls sideways. With 200% text the bar wraps to two rows of cells rather than cutting a label. On a desktop it stays the underlined row it is now. The current cell's marker slides between cells, and moving between sections redraws only the bands, never the heading or the bar (as V1.16.5 does).

## The rail: separate, raised, alive

**Separate buttons.** Each destination becomes its own plate on the rail: a small radius, a hairline lighter top edge (an inner highlight), a soft shadow under it, and a 4 px gap to the next. At rest the plates sit close to the rail; hovered, a plate lifts 1 px and its shadow grows; pressed, it sinks 1 px and its shadow tightens (90 ms). Items' children stay lighter rows inside Items, not plates of their own, so the hierarchy reads.

**The current destination is lit.** It is raised further than the rest, a shade lighter, with a gold edge on its left side and a warm top highlight. One lit plate exists: when you move page, it travels from the old destination to the new one (about 380 ms, a spring that settles without a visible bounce), instead of one block switching off and another on.

**Folding.** Circulation, Records and Manage each get a chevron button on their label; Items gets one beside it (Items itself stays a link). The children fold away and back with the same spring, the chevron turning with them. Folded, Items keeps the Low & out of stock count on itself, and opening any of its pages unfolds it. The choice is kept on this device (`localStorage`), never in the account. Each chevron is a button with `aria-expanded` and the group's name.

**Moving between pages.** Where the View Transitions API exists, the page crossfades: the old page fades in 120 ms, the new one fades and lifts 8 px into place in about 220 ms, and the rail, bar and Administration heading are named so they never take part. Elsewhere, the existing fade. The page is drawn first and animated after, so motion never delays content.

**Sheets.** Sheets slide in with the same spring (a settle of under 2%, no bounce), the backdrop dims with them, and closing is faster than opening. Buttons answer press everywhere with the plate's sink.

**Living surfaces (continuous, ornamental, as Earl allowed).** Two, and only two, so they stay special:
1. A slow band of warm light crosses the lit rail plate about every 8 seconds.
2. Live status dots (System's checks, Self-Service open) breathe gently, once every 3 seconds.
Both stop while the tab is hidden, and both are transform and opacity only. A third, depth that follows the pointer, is not proposed: the photo cards already do it, and on the rail it would fight the travelling plate.

## Motion, measured

- Every motion here is transform or opacity. The spring is one CSS `linear()` curve shared by the plate, the folds and the sheets.
- Before release: a page move and opening a sheet stay within the V1.16.4 timing budgets on a phone at 4× CPU slowdown; the two continuous animations cost no measurable frame time on the phone profile and pause when the tab is hidden.
- Full motion is the design. Visitors whose system asks for reduced motion get crossfades instead of travel and lift, and no continuous animation; that changes nothing for anyone else.

## Files expected to change (nothing deleted)

`src/admin-frame.ts` (bands, the bar, the extended sheet), the five `src/admin-*.ts` sections and `src/admin.css`; `src/staff-shell.ts` and the rail's rules in `src/styles.css`; the page-move code in `src/ui.ts`/router; new browser tests. No route, permission, API or data change.

## Hallmark handoff

Direction: one four-band shape for every Administration section, one confirmation sheet, a fixed segmented bar on phones; a rail of raised plates with one travelling lit plate, folding groups, crossfading pages and spring sheets, with two quiet continuous lights.
Locked: tokens, fonts, rows on rules, the section order and contents, the four bands, the plate and lit-plate model.
May refine: spacing, states, durations within the budgets, accessibility, responsive behaviour, copy.
Targets: Administration (five sections) and the staff rail on desktop, tablet and phone.
Remaining risks: the segmented bar at 320 px with 200% text; the travelling plate when the rail scrolls; View Transitions in WebKit (unverified on Windows).
Recommended Impeccable command: `animate`, then the bounded `polish` for the whole update.
