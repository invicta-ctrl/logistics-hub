# Part 5 Plan — Activity + Accountability (with the visual-cleanup record and Open-Unit Tracking)

**Repository:** `invicta-ctrl/logistics-hub`
**Status:** PROPOSED — PLANNING ONLY. Not accepted. Nothing here authorizes a migration, API or UI change, production write, or deployment.
**Prepared:** 2026-09-30 for Earl
**Accepted roadmap line (unchanged):** "5. Activity + Accountability: searchable operational history and safe exports." (`docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md`)
**Rules that apply:** `AGENTS.md`, `.agents/PROJECT_POLICY.md` (anti-bloat, one active `slice/*` branch, `main` always green, D1 is structured truth, R2 is evidence, stock is movement-derived, no PII in the public repo).

This one file holds the whole plan so it can be reviewed and accepted (or trimmed) in one place:

1. Where the product stands today
2. Part 5 core: Activity center and safe exports
3. The visual-cleanup plan: what was accepted and what is done
4. Open-Unit Tracking (proposed amendment A12)
5. Order of work, slices and gates
6. Decisions needed from Earl

---

## 1. Where the product stands today (verified from the repo)

Part 4.5 and the follow-up work are live on `main`. The parts of the product Part 5 builds on:

- **Operational history already exists, but in separate places.**
  - `inventory_movements`: append-only stock ledger; the only authority for quantity (`inventory_balances` is a view over it).
  - `loans`: internal lending with photos, purpose, return/damaged/lost.
  - `self_service_events`: every phone Take/Borrow/Return, with review state, held/applied, staff resolution and the photo of a return waiting for staff.
  - `audit_log`: catalog changes, account events and other staff actions (`actor_user_id`, `action`, `entity_type`, `entity_id`, `details_json`).
- **Views that show a slice of it:** the per-item History tab (movements + catalog changes merged into sentences), the Loans page (open/returned), the Self-service page (needs-attention and last 7 days), and an admin activity list (`/api/staff/admin/activity`).
- **What does not exist:** one searchable, filterable history across all of the above; any export. Staff cannot answer "who did what to this item last month" or "what left the shelf yesterday and why" without opening several screens.
- **Roles:** `STAFF`, `ADMIN`, `OWNER`, Worker-enforced.
- **Live refresh:** the shared revision + ETag/304 polling pattern (`catalog_revision`, the `live()` helper) is the way screens stay current.
- **Design system:** the flat, tokenised design from Part 4.6 to 4.10 (see section 3). Part 5 pages reuse it; no new components.

## 2. Part 5 core — Activity center and safe exports

### 2.1 Goal

Any staff member can answer, in one place and without a developer: **who did what, to which item, when, from where (desk or phone), and did it change stock?** Managers can take a safe copy of that history out of the system.

### 2.2 Principles

- **Read model, not a second ledger.** The activity center only reads the tables above. It never becomes an authority for quantity, loan state or review state.
- **Human sentences, never raw JSON.** "Maria Santos returned Folding Table ×1 (good). Staff confirmed. On hand 3 → 4."
- **Same words everywhere.** Names of actions match what staff see in Loans, Stock and Self-service.
- **Smallest durable change:** prefer one SQL read (a `UNION ALL` over existing tables plus indexes) over new tables. A new table is only added if a measured need appears.
- **Public data unaffected:** no activity, actor, borrower or photo information is added to any public DTO.

### 2.3 What counts as an activity (sources → entry types)

| Source | Entry types shown |
| --- | --- |
| `inventory_movements` | Stock in / out / adjustment / count, with reason, before and after quantity, and whether it changed the official quantity |
| `loans` | Loan lent, loan returned (good / damaged / lost), photo present |
| `self_service_events` | Phone take, borrow, return sent, return confirmed / not returned by staff, held for review and why, resolved by whom |
| `audit_log` | Item created/edited/deactivated (catalog changes), review completed, account and session events (admin only), settings |

Every entry has: time (Manila), actor (staff name, "Self-service" for phones, or "System"), item link, a plain sentence, source, whether stock changed (and by how much), and a stable ID for reference.

### 2.4 Activity page (`/staff/activity`)

- One list, newest first, cursor-paginated (D1-friendly; no `OFFSET` scans), a "Load older" control, live "Updated <time>" like the other staff views.
- **Filters** (kept in the URL, like Inventory): text search (item name/ID, actor, note), item, actor, source (movements / loans / self-service / catalog / accounts), event type, date range, stock area/location, "changed stock" vs "did not change stock", "needs attention only".
- **Row:** sentence, actor, time, source tag (one `.tag`), quantity change as text ("−2", "+1", "no change"). Click opens the existing item sheet or loan; no new detail screen.
- **Mobile:** filters collapse into the existing sheet; rows stay one column with 44 px targets.
- **Access:** all staff can read operational activity; account/session events are ADMIN and OWNER only (server-side filter, not a UI hide).

### 2.5 Safe exports

- CSV only, generated by the Worker from the same query the page uses, so an export always equals what staff filtered.
- **Safe by construction:**
  - formula-injection guard on every text cell (a value starting with `=`, `+`, `-`, `@`, tab or CR is prefixed so spreadsheets never execute it);
  - correct quoting, UTF-8 with BOM for Excel, a fixed column list, a row cap with an honest "more rows exist, narrow the filter" message;
  - never includes password hashes, session tokens, recovery material, photo keys or photo bytes, IP or network hashes, or `details_json` blobs;
  - student ID and borrower name are included only for ADMIN and OWNER, and the export says so in its header; STAFF exports leave them out. (Decision needed, see section 6.)
- **Exports are themselves audited:** who exported, which filter, how many rows, when.
- Rate-limited per account; `Content-Disposition` filename without user input; `Cache-Control: private, no-store`.
- Columns: event time, item ID, item name, unit, activity type, actor, source, quantity before/after where applicable, quantity change, reason/note, event/correlation ID.

### 2.6 Data and migration

Preferred: **no new tables.** Add read indexes only if the queries need them (`created_at`, `(item_id, created_at)`, `(actor_user_id, created_at)` on `audit_log`; existing indexes already cover movements and self-service events). Any migration is additive, tested on a throwaway D1, and applied to production only with Earl's explicit approval, a Time Travel bookmark taken first, and post-apply checks (the same procedure used for 0014 and 0015).

### 2.6.1 Correction to remember

`self_service_events.review` is free text and `items.self_service` (migration 0015) is no longer read. A later cleanup migration can drop the column; do not bundle it into Part 5 unless Earl asks.

### 2.7 Out of scope for Part 5 core

Exports of photos, PDF reports, charts/dashboards beyond counts, scheduled or emailed exports, per-location quantity, purchasing, the Request Center, settings/backups/roles administration (Part 6), and anything that changes stock behavior (Open-Unit Tracking is separate, section 4).

### 2.8 Acceptance criteria (Part 5 core)

- **AC-A1** A staff member can find any movement, loan, self-service record or catalog change from one page and filter by item, actor, source, type and date.
- **AC-A2** Every entry reads as a plain sentence with actor, time and item; no raw JSON.
- **AC-A3** The page never shows account/session events to STAFF (server-enforced) and no activity data appears in any public API.
- **AC-A4** CSV export matches the current filter exactly, is capped and says so, and is safe against spreadsheet formula injection.
- **AC-A5** Sensitive fields (hashes, tokens, photo keys, network hashes, `details_json`) never appear in an export; borrower identity follows the role rule in section 6.
- **AC-A6** Each export is recorded in the audit log.
- **AC-A7** Pagination stays fast on the real data volume (measured on the 500+ item catalog with thousands of movements); no full-table scan per page.
- **AC-A8** Works at 320, 375, 768 and 1024–1440 px with no horizontal page scroll; keyboard and screen-reader usable (filters labelled, results announced through the result count).
- **AC-A9** No regression: Part 1–4.5 flows and gates unchanged.

## 3. The visual-cleanup plan — record and status

The plan ("Logistics Hub visual cleanup plan", 2026-09-30) was accepted by Earl ("Start cleanup") and **has been implemented on `main` as Part 4.6, extended by Part 4.7 to 4.10** (see `.codex/PART_04_6_BRIEF.md`). It is recorded here because Part 5 builds on it and because a few of its items remain open. It is **not** work to redo.

**Principles (unchanged, every Part 5 screen is checked against them):** one light theme everywhere (self-service keeps its own dark theme by Earl's later decision); oxblood for brand and primary actions only; gold only on dark surfaces and focus; real content above the fold; motion only when it explains a change; each fact said once per page; no copy that could sit on any website.

**Status by step**

| Plan step | Status |
| --- | --- |
| 1 Remove style-generator comments/jargon | Done (4.6 step 1) |
| 2 Tokens: type scale, two shadows, two radii, no literal colours | Done (4.6 step 2) |
| 3 Motion: keep only what explains a change | Done (4.6 step 3) |
| 4 Flat public, sign-in and filter-bar surfaces | Done (4.6 step 4) |
| 5 Home: new headline/lede, no kicker or duplicate notices | Done (4.6 step 5); the Youth Development Day banner was restored by Earl's later decision (4.9) |
| 6 Logo always links home; Facebook link in footer; no placeholder link | Done (4.6 step 6) |
| 7 Quieter Lending Hub (timestamp, exceptions-only audience tag, "1 left") | Done (4.6 step 7) |
| 8 Sign-in as one centred card | Done (4.6 step 8) |
| 9 One look per component (buttons, chips, tags) | Done (4.6 step 9) |
| 10 Semantic HTML fixes (`<search>`, empty-state heading level, names, tabindex, table captions) | Done (4.6 step 10) |
| 11 Loans stats renamed "Top borrowers" / "Most borrowed items" | Done (4.6 step 11) |
| 12 Contrast to WCAG AA | Done (4.6 step 12) |
| 13 Self-service re-themed | Done as flat dark (4.6 step 13), then light/dark switch (4.7) and campus photo (4.8) by Earl's decisions |
| 14 Merge, delete branch, production check | Merged and deployed; production look-over is an owner acceptance item |
| Cache behavior for public pages | Fresh from the network; only `/self-service` opens from the phone's cache (4.10) |

**Still open from the plan (needs Earl):**

- **axe accessibility check in the Playwright suite** — adds a dev dependency, so it needs Earl's approval. Recommended before Part 5 ships its new page, so the new page is checked from day one.
- **"Where to find us" line** (office location and hours) on the home page — needs the facts from Earl.
- Earl's look-over of the visuals and the theme switch (decisions listed in `PART_04_6_BRIEF.md`).

**How Part 5 must use it:** the Activity page uses the existing page header, filter bar, `.tag`, table/list rows, the shared sheet, `live()` status and empty states. It adds no new visual pattern.

## 4. Open-Unit Tracking (proposed amendment A12)

Source: `PART_05_OPEN_UNIT_TRACKING_AMENDMENT.md` (Earl, 2026-09-30, PROPOSED). This section keeps its decisions in one place; the amendment text stays the detailed reference. **Nothing in this section is authorized until Earl accepts it.** It expands Part 5, changes inventory behavior, and needs a production migration.

### 4.1 The problem

Reams, boxes, bottles, rolls, packs, jars and cans are counted as containers but used a little at a time. Today a Consumable "Take" deducts a whole unit, which is wrong for these items, and counting sheets/staples/millilitres is impractical.

### 4.2 The idea

Keep the official unit exactly as counted. Track only **sealed vs open**. Opening a unit and recording ordinary use never change stock; **marking an open unit empty deducts exactly one unit through the existing guarded movement path.**

Example: *A4 Bond Paper — 8 reams on hand · 7 sealed · 1 open · Low.* Mark empty → 7 reams on hand.

### 4.3 Item behavior

- Per-Consumable choice, in Edit details next to "Borrow or consume": **How is this item normally used? Whole unit / Open and use gradually.**
- Default for every existing item: **Whole unit** (no behavior change). No auto-classification from names; staff opt in. An optional review view lists likely candidates by unit word (ream, box, bottle, jar, roll, pack, can, tub, pouch, container) without changing anything.
- Loanables are unaffected.

### 4.4 State model

`SEALED`, `OPEN`, `EMPTY` (a terminal event, not a persistent unit). Optional rough condition on an open unit: `PLENTY`, `HALF`, `LOW` (labels only; never quantities, never percentages). Sealed count is derived as `on_hand − open_units`; there is no stored sealed quantity and no second quantity authority. More than one open unit is allowed (warning: "1 unit is already open. Use the existing unit when possible.").

### 4.5 Staff workflow (Open → Use → Mark low, optional → Empty)

Open a ream · Record use (no content quantity) · Set condition · Mark empty with an inline confirm ("This will reduce on-hand stock from 8 to 7 reams") · Open another · Correct open units. Available from the item sheet and from Stock & Pantry rows; one-hand friendly on phones (targets of 44 px, no modal chains).

### 4.6 Self-service

- Whole-unit Consumables: current **Take** behavior, unchanged.
- Open-unit Consumables: the phone shows **Use** (no how-many-sheets question). A Use event records activity only, never deducts, and syncs through the existing immutable, idempotent offline event path. Phones cannot mark a unit empty, set condition or correct state; those stay staff actions (a phone "empty" report, if ever wanted, would be a review-required event, not a stock movement).
- This slice (self-service Use) is optional and can ship after the staff workflow. The current phone list ("Get an item") already shows Take or Borrow from the item's type, so "Use" would be a third label on the same list.

### 4.7 Invariants (must be enforced and tested)

1. The movement ledger is the sole authority for on-hand quantity.
2. Opening a unit never changes quantity.
3. Recording use never changes quantity.
4. Marking one open unit empty reduces quantity by exactly one, through the normal guarded movement path.
5. A unit cannot be marked empty twice; a retry cannot double-deduct; two competing empties produce exactly one movement.
6. Open units can never exceed on-hand quantity; opening more than stock supports is rejected.
7. A physical count remains observed truth and counts containers (3 sealed + 1 open = 4); the open count is reconciled separately and never rewrites history.
8. If a correction leaves fewer units on hand than open units, the system flags **Open-unit state needs review** and does not invent values.
9. Condition labels never affect quantity.
10. Loanables and existing Whole-unit Consumables behave exactly as before.
11. Every transition is attributable (actor/device/time) and visible in History and the Activity center.
12. Public data exposes nothing about open units or who used what.
13. Offline retries are idempotent.

### 4.8 Data model direction (final schema chosen at implementation, after re-reading D1)

- Item-level `consumption_mode` (`WHOLE_UNIT` default, `OPEN_UNIT`), relevant only to Consumables.
- A minimal open-unit record: id, item, opened at/by, optional condition with updated at/by, closed at/by, idempotency/correlation ids. No contents remaining, no percentages, no fractional stock.
- Additive migration; default `WHOLE_UNIT` for all existing rows; historical quantities untouched; applied to production only with Earl's approval, a Time Travel bookmark and post-apply checks.
- Mode changes with open units present (Open → Whole, Consumable → Loanable, deactivate) require resolving open units first; a zero count with an open unit forces reconciliation.

### 4.9 Activity and export integration

New activity types: unit opened, use recorded, condition changed, extra unit opened, unit marked empty, open state corrected, count reconciled with open state, discrepancy flagged / resolved. They appear in the Part 5 Activity page with human sentences, and export as events with `quantity_delta = 0` for use/open/condition, never as invented "estimated quantity used". Reports keep two separate metrics: **uses recorded** and **stock units exhausted**.

### 4.10 Permissions

STAFF, ADMIN and OWNER can open, record use, set condition, mark empty, reconcile. Public/self-service users can only record Use on eligible items. All enforced in the Worker.

### 4.11 UI on the settled components (no new pattern)

Quantity with a quiet second line ("8 reams on hand" then "7 sealed · 1 open · Low" in the existing `.cell-sub`); condition as the existing chip group (`aria-pressed`); buttons by the four variants (Mark empty is the one primary per open unit, Record use secondary, extras behind a ghost "More", Discard in the danger variant only inside its confirmation); inline confirmation inside the shared sheet; toast "Marked empty. 7 reams on hand."; the only motion is the existing count roll; row actions wrap below 480 px. Copy in counter words; never "fractional", "partial quantity" or "residual".

### 4.12 Acceptance criteria (A12, condensed from AC-01 to AC-18)

Configurable per item; usable with no content counting; open and use leave quantity unchanged; empty deducts exactly one; full audit trail; condition optional and quantity-neutral; multiple open units with a warning; open ≤ on-hand always; reconciliation without touching the ledger; count compatibility; existing behavior preserved; phone Use (if included) deducts nothing; idempotent under retries, double taps, sync replays and concurrency; responsive one-hand UX; activity/exports separate "use" from "exhausted"; no second quantity authority; migration changes no history and reclassifies nothing.

### 4.13 Tests required

Unit/data: every invariant above, including retry and concurrent-empty cases, count reconciliation and impossible-state flagging. Browser at the existing viewports: configure, open, use, set Low, mark empty, quantity change, multiple-open warning, one-hand mobile flow, reconciliation, history text. Worker + D1: migration safety, append-only behavior, idempotent empty, auth boundaries, offline `Use` sync if included. Plus the standing gates in section 5.

## 5. Order of work, slices and gates

**Prerequisite (met):** Part 4.5 is on `main` and deployed; the visual cleanup is done; there is no active slice branch. The three leftover remote branches are merged and only need deleting by someone with push rights (see the handoff).

**Recommended order**

1. **Slice `slice/part-05-activity`** — Part 5 core. Four verified commits:
   - **5.1 Read model and API:** the unified activity query (cursor pagination, filters, role rules) with tests on the pure data behavior. Stop when the query is correct and fast.
   - **5.2 Activity page:** `/staff/activity`, filters in the URL, live status, links to items and loans, mobile.
   - **5.3 Safe CSV export:** generation, injection guard, caps, audited exports, role rules.
   - **5.4 Polish and regression:** responsive/accessibility pass, empty and error states, docs, full gates. Merge to `main`, delete the slice, verify production.
2. **Slice `slice/part-05b-open-units`** — A12, only after Earl accepts the amendment and after Part 5 core is merged (the Activity page is where its events become searchable). Internal order:
   - **OU-1** spec acceptance, final schema, migration, item mode, invariants and pure data tests (stop until green);
   - **OU-2** staff workflow (open, use, condition, empty, Stock & Pantry actions, item summary, concurrency/idempotency);
   - **OU-3** activity, reconciliation, count integration, export semantics;
   - **OU-4** phone `Use` (optional);
   - **OU-5** polish, migration verification, full regression, product-reference and handoff.
   The amendment text calls these 5A–5E; they are renamed OU-1 to OU-5 here so they do not collide with Part 5 core's 5.1 to 5.4.

**Gates for every commit and before every merge:** `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser`, `npm run test:browser:worker`, `npm run verify:privacy`, `npm run verify:migration`, `npm run verify:catalog`, `wrangler deploy --dry-run`, plus screenshots at 390 and 1366 px for touched pages. Any migration additionally: throwaway-D1 test, Time Travel bookmark, list-then-apply exactly once, read-only post-checks, no reapply.

**Governance for each slice:** claim the writer lock, one active `slice/*` branch, commit and push each green checkpoint, merge to `main` immediately when green, delete the slice, update `.codex/CURRENT.md` and the handoff, and stop at the slice's stop condition. Production writes need Earl's explicit target and authority.

## 6. Decisions needed from Earl before any of this starts

1. **Accept Part 5 core as written?** (Yes / trim / change scope.)
2. **Borrower identity in exports:** include borrower name and student ID for ADMIN and OWNER only (recommended), for all staff, or never?
3. **Approve the axe accessibility dev dependency** for the Playwright suite? (Recommended; it is the only new dependency proposed.)
4. **Office location and hours** for the home page "Where to find us" line (from the visual plan).
5. **Accept Open-Unit Tracking (A12)?** If yes, confirm: opt-in per item; default Whole unit; phone `Use` included in scope or deferred; and that its production migration will be a separate approval when the time comes.
6. **Branch names:** `slice/part-05-activity` and `slice/part-05b-open-units` (the visual plan used a different name for a slice that is already finished).
7. **Delete the three merged remote branches** (someone with push rights).

## Planning status

**PROPOSED.** This file authorizes nothing. Part 5 and A12 stay PROPOSED until Earl accepts them under project governance; only then is a slice branch created and the first migration written.
