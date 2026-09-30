# Logistics Hub — Product Reference

> **What this file is.** A convenient description of the whole website, so an agent or a person can understand it quickly. It is a reference, not a design authority. It never overrides, in order: Earl's current instruction, the accepted specifications and amendments (`docs/specs/accepted/`), or the verified repository state. When Earl changes direction, update this file to match. Do not argue from it against the change.
>
> One canonical tracked copy lives in Git. It is changed in the same commit as the product change it describes, and pushed with it.

## Purpose
The operations system of the **Department of Logistics (DOL)** of the Holy Angel University (HAU) University Student Council (USC).
- **Public side:** shows students and USC staff what equipment can be borrowed right now.
- **Staff side:** keeps the inventory, catalog and day-to-day stock truthful. Quantities come from an append-only movement ledger; catalog records are reviewed by people.

It supersedes the older HAU-USC Logistics Management System for all new development. The old React frontend, Request Center, procurement, canvassing and deliverables are **not** revived.

## Public website
| Route | What it is |
| --- | --- |
| `/` | Landing. See the details below. |
| `/lending` | Lending Hub. See the details below. |
| `/self-service` | Phone Self-Service (Part 4.5): Take, Borrow, Return and My activity on a person's own phone, offline too. The one permanent QR code opens it. See below. |
| `/staff` | Staff sign-in. See the details below. |
| any other path | A branded "page not found". |

The landing page (`/`):
- an oxblood masthead carrying the HAU·USC crest and the DOL mark. On this page only, the lockup opens the official HAU University Student Council Facebook page (`https://www.facebook.com/holyangeluniversitysc`) in a new tab; on other public pages it returns home;
- a hero on deep oxblood: the headline, a gold "Browse the Lending Hub" action and a "How borrowing works" link, beside the whole, uncropped Youth Development Day 2026 banner (the banner sits above the headline on phones). There is deliberately no availability panel here: the landing page does not poll the catalog, and availability lives only in the Lending Hub;
- "How borrowing works" in three steps, ending in one "Open the Lending Hub" action and the notice that logistics requests are *not yet available* online.
- "Staff sign in" appears only in the masthead and footer.

The Lending Hub (`/lending`):
- the public, read-only catalogue, grouped by category, showing every listed item, Loanable or Consumable (a Consumable is marked "taken and not returned");
- search, an Available-now switch, category chips and sorting;
- live availability that refreshes every 15 s;
- filters kept in the URL.

Staff sign-in (`/staff`) uses the original legacy Staff Login campus photograph behind a new, secure sign-in form. A signed-in visit goes straight to the workspace.

The public catalog DTO carries only: `id`, `name`, `category`, `unit`, `available`, `audience`.

### Self-Service (`/self-service`)

Scanned from the one permanent QR code (`public/qr/logistics-self-service.svg` / `.png`, which hold only `https://logistics.hausc.org/self-service`). An installable app (PWA, "Logistics Hub"), phone-first, with its own oxblood app bar and a sync status pill (**Synced**, **Offline · N pending**, **N waiting**, **Syncing N…**, **N needs review**).
- **Home:** a greeting, "What do you need?", four tiles (Take, Borrow, Return with loans on this phone (Return lists only what this phone borrowed), My activity), search across everything, whether the phone is **Ready for offline use**, and an **Install Logistics Hub** card (a real Install button on Android/Chromium; **How to install** steps for iPhone, iPad and other browsers).
- **Take** (Consumable, self-service on): pick, quantity stepper, name (remembered on the phone), done. **Borrow** (listed Loanable, self-service on): the Part 4 rules (Individual: full name, student ID; USC: name, specific reason; both a photo taken on the phone), an optional return-by chip (Today, Tomorrow). **Return:** loans made on this phone in one tap (linked to the exact loan), or any self-service item with the borrower's name/ID for staff to match; Good, Damaged (note) or Lost (note).
- Counts are live when online and labelled as an estimate with the last sync time when not; the phone's own unsynced records are included.
- A receipt confirms each record and updates itself from "Saved on this phone" to "Synced with Logistics".
- **My activity:** loans on this phone, every record with its state (Waiting to sync, Synced, Staff will check, Not recorded), **Sync now**, **Clear synced history** and **Forget my details**. Settled records clear themselves after 30 days.
- Works offline after one online visit: every action is saved on the phone as an immutable event (IndexedDB) and synced later; the Worker reconciles events from many phones. Engineering: `docs/OFFLINE_SELF_SERVICE.md`. People: `docs/PWA_INSTALL_GUIDE.md`.

The self-service catalog DTO carries only: `id`, `name`, `aliases`, `category`, `unit`, `action` (TAKE or BORROW), `available`, `location`, `audience` (borrow only).

## Staff workspace
Every `/staff/*` page and `/api/staff/*` call needs a live session. Writes must come from the same origin.

### Inventory (`/staff/inventory`)

The table shows ID, item (with type and other names), category, location, on-hand quantity and status tags.

**Views:**
- All items;
- Needs review;
- Ready to list (Loanable, not listed, not inactive);
- On Lending Hub;
- Self-service (turned on for phones);
- Low stock (at or below the reorder level);
- Out of stock;
- Inactive.

**Filters:** category, location (including *No location set*) and type. On phones they fold behind one "Filters" button.

**Search** matches name, other names, ID, category and location. `/` focuses the search.

**Sorting** is by ID, name, category, location or on hand. The view, search, filters, sort and open item are all kept in the URL.

**Review progress** sits in the compact page header: "N of 397 records reviewed". "Needs review" is a neutral marker, not a warning colour.

**Item sheet** (a side sheet on desktop, a bottom sheet on phones), in up to four tabs:
- **Overview:**
  - **the quantity editor** first: the on-hand figure itself is the input. Staff change it (type a new total, type +5 or −2, use − / +, or arrow keys) and must pick a **reason** before it saves: for an increase, new stock received, returned, donation, physical count or other; for a decrease, consumed or used, given out, damaged, missing, transferred, physical count or other ("Other" needs a note). "Confirm a physical count" logs a count that matches. The Worker records the difference as a Stock in, Stock out or Count;
  - the reorder level, low or out-of-stock state, and how many more are out on loan;
  - migration evidence and verification notes; the review checklist;
  - Lending Hub status that says exactly what is missing (`listingGaps()`), then the facts and where the record came from.
- **Loan** (Loanable items only): lend this item, see what is out now, and return it (see Loans below). The tab shows how many loans are out.
- **Review & edit / Edit details:**
  - **Catalog:** name, other names, category and unit (typed freely; an existing spelling is reused regardless of letter case), type (**Loanable** or **Consumable**; *Unclassified* appears only while a migrated record still is), location, notes;
  - **Inventory settings:** status (Active, Verify, Inactive), reorder level, stock area (Inventory or Pantry) and, for pantry items, an optional earliest expiry;
  - **Public Lending Hub:** who it is shown to (there is no loan period or maximum per loan);
  - **Phone self-service:** automatic by item type (Consumable = Take, Loanable listed on the Lending Hub = Borrow); items show only their type, with no self-service status;
  - a "Details reviewed and verified" box;
  - "Mark reviewed & next", which walks the current filtered list.
- **History:** stock movements (including lent out and returned from loan, with the borrower) and catalog changes merged in one timeline, written as sentences with the actor and the time (never raw JSON).

**New item:** the Worker generates the ID (`ITM-####`). The opening quantity becomes the first movement. A duplicate name is warned about but not blocked.

### Stock & Pantry (`/staff/stock`)

Daily quantity work over the same items and ledger (Inventory stays the catalog workspace).
- **Header:** today's movement count and who recorded the last one; one "Update stock" action.
- **Needs attention:** one list with filter chips (Out of stock, Low stock, Needs count, Expiring). Each row says why, and offers the next action (Stock in or Count, Add to restock). Items without a reorder level are never called low; a hint says how many have none.
- **Restock list:** a lightweight replenishment list, not procurement: restock quantity, Needs restock → Planned, **Receive** (records a Stock in that closes the entry) or Dismiss; suggestions from reorder levels; closed entries from the last two weeks.
- **Pantry:** items whose stock area is Pantry (a catalog field; 10 food and kitchen items migrated), with reorder level, optional earliest expiry (Expired, or expiring within 14 days) and quick Use and Restock actions.
- **Activity:** today's or recent staff movements, each with the change, before → after, reason, actor and time.
- **Update stock:** item search (name or ID), then the same quantity editor as the item sheet (`src/movement-form.ts`). Row actions preset it: Stock in suggests "new stock received", Count opens a physical count, Use removes one as consumed, Receive adds the restock quantity and closes the restock entry. After saving, the item field is ready for the next entry, and a session list shows what was just recorded. A sticky panel on desktop; a bottom sheet on phones and tablets.

### Loans (`/staff/loans`)

Internal lending, recorded by staff (the public Lending Hub still only shows availability).
- **Lending** happens from an item's **Loan** tab or from **Lend an item** on this page (item search, then the same form, `src/loan-form.ts`):
  - **Individual use:** borrower's full name, **student ID number** and a **photo** are required;
  - **USC use:** the name of the person using it, a **photo** and a **specific reason** are required; the student ID is optional;
  - quantity (up to what is on the shelf) and an optional return-by date. The photo is taken or chosen on the device, shrunk to 1600 px JPEG in the browser, and kept in R2. A returning student's name fills in from their ID.
- **Out now:** every open loan, overdue first (a return-by date before today, Manila time), with who, what, since when, the reason, and **Return**.
- **Return** shows the hand-over photo and asks how it came back: **returned in good condition** (back on the shelf), **damaged** or **lost or not returned** (both stay off the shelf and need a note).
- **Borrowers:** for the last 30 days, 12 months or all time: loans (split individual and USC), items lent, distinct borrowers, damaged or lost; the **top borrowers ranked separately for Individual use and USC use** (loans, items, out now, damaged or lost); and the most borrowed items. A borrower is their student ID when known, otherwise their name.
- **Returned:** the 100 most recent closed loans with their outcome and notes. Search covers name, student ID, item and reason.

### Self-service (`/staff/self-service`)

Records made on phones reconcile on their own; this page shows only what needs a person. The nav tab shows how many need attention.
- **Needs attention:**
  - **Count needed:** items whose balance, rebuilt in the order things happened since the last count, went below zero (derived; clears itself after a count or a late return);
  - **Records to check:** returns waiting for a photo check (Confirm returned updates stock; Not returned leaves the loan out) and other held records (an offline record for an item no longer self-service, an individual borrow of a USC-only item, more than 30 units of one item in an hour, an implausible phone clock, an unexpected error) with **Apply** or **Dismiss** (a held borrow's photo can be opened); returns not linked to a borrow on the same phone, to match with the open loans of that item (**Match and close loan**; only **Dismiss** when none is open); records made right beside a count (**Mark checked**). Each shows who, when (with the sync time and the phone's own clock when they differ), and short phone and network tags. A decision is final: if two staff act on one record at once, the second is told someone else resolved it.
- **Last 7 days:** every self-service record and its state.
- **QR code & poster:** the one QR code, a print-ready A4 poster ("Borrow · Take · Return — Scan for Logistics Self-Service — Install it once for offline access — logistics.hausc.org/self-service") and SVG/PNG downloads.

### Administration and My account
- **Administration (`/staff/admin`, ADMIN and OWNER only):** the accounts table, create, manage (profile, role, reset, sign out everywhere, enable or disable), and security activity.
- **My account (`/staff/account`):** password, profile, sign out other devices, and (for an OWNER) the recovery key.
- The Owner Console (`npm run admin`, or `LOGISTICS_ADMIN.cmd`) uses the same Admin API. `docs/DEPLOYMENT.md` is the only runbook.

## Roles
| Role | Can |
| --- | --- |
| STAFF | Everything in Inventory, Catalog, Stock & Pantry and Loans, and their own account |
| ADMIN | STAFF, plus managing STAFF accounts |
| OWNER | Everything, including roles, other owners and the recovery key |

Every rule is enforced by the Worker (`src/accounts.ts`, `src/worker.ts`). The browser only hides controls.

## Parts (roadmap)
| Part | Scope | State |
| --- | --- | --- |
| 1 YDD Gateway + Foundation | Landing, fail-closed Lending Hub, staff auth and roles, owner recovery, movement ledger, live refresh | **Complete** — local + GitHub verified 2026-09-29 |
| 2 Inventory + Catalog | Complete item management, search, views, classification, locations, reorder settings, lending readiness, migrated review, history | **Complete** — local + GitHub verified 2026-09-29 |
| 3 Stock + Pantry | Stock workspace, movement reasons, counts, low stock, restock list, pantry, optional expiry, activity; whole-product polish | **Complete** — local + GitHub verified; production D1 migrated 2026-09-29 |
| 4 Lending | Internal loans by purpose (Individual use with student ID, USC use with reason), photo evidence (R2), return / damaged / lost, overdue, borrower rankings; quantity editor with required reasons; two item types | **Deployed, production acceptance partial** — R2, migration 0014, core navigation and quantity/history checks verified; photo upload/retrieval and return outcomes remain open |
| 4.5 Offline Self-Service | One permanent QR, `/self-service` (Take, Borrow, Return, My activity) on people's own phones, installable PWA that works offline, IndexedDB event queue, idempotent sync and reconciliation, staff exception view, printable poster | **Code complete on `slice/part-04-5-offline-self-service-pwa`**; production needs migration 0015 first (see `docs/DEPLOYMENT.md`) and Part 4 acceptance |
| 5 Activity + Accountability | Full activity center and safe exports | Planned |
| 6 Admin + Hardening | System settings, backups, final production hardening | Planned |

Each Part must work end to end without depending on a later Part.

## Operational rules and data invariants
- **Quantity is movement-derived.** `inventory_balances.on_hand` is the sum of POSTED `inventory_movements`. No `current_quantity` field is ever stored or edited.
- The ledger is **append-only**: database triggers refuse UPDATE and DELETE. Corrections are new movements (a Count), and the opening quantity is a movement.
- Movements are single guarded statements with idempotency keys. Stock cannot go negative, and a retry never counts twice. Each movement stores its operational reason.
- **A count records observed truth.** Staff enter what is on the shelf; the Worker computes the adjustment. A count that matches is still recorded (a 0 adjustment), so the observation is kept.
- **Low stock needs a reorder level** (`stockState()` in `src/catalog-policy.ts`, shared by Worker and browser). "Needs count" marks items whose legacy quantity is doubtful (a migration discrepancy or a VERIFY record) until a count is recorded in the Hub.
- **The restock list never holds stock.** `reorders` stores status, restock quantity and note; at most one open entry per item. An entry becomes Restocked only through the Stock in that received it, in the same batch. No suppliers, quotes or purchase orders.
- **Pantry is a view,** not a separate inventory: `items.stock_area = 'Pantry'`. Expiry is one optional earliest date per item, not lots or batches.
- **On-hand quantity remains movement-derived.** Each loan records the quantity lent and links to its guarded, idempotent LOAN_OUT movement; only a good return writes LOAN_RETURN. Damaged or lost items stay off the shelf. Overdue is derived from the return-by date. Each loan keeps its purpose, borrower, student ID or reason, and the R2 key of its photo.
- **A quantity edit is guarded.** The editor sends the figure it showed (`expectedOnHand`); if someone else changed the item meanwhile, the save is refused with the new figure instead of overwriting it.
- **Two item types.** Loanable (comes back) or Consumable (used up). Migration 0014 reclassified the 112 legacy "Saleable" records as Consumable, with the change in each item's history.
- **Catalog edits never touch quantity history.**
  - Edits carry the version the editor loaded (`updatedAt`), and a stale edit gets `409` instead of silently overwriting.
  - Categories, units and locations reuse the stored spelling of an existing value that matches regardless of case or spacing.
  - Nothing with history is deleted; items are made Inactive.
- **Lending is fail-closed.** An item is public only when it is Active, reviewed, type Loanable, and has an audience. `listingGaps()` in `src/catalog-policy.ts` is the single source of that rule. Migrated Loanable items are never auto-published.
- **Migration evidence stays visible.** ITM-0001 derives 7 from the ledger while the legacy system reported 8 (delta −1). It is shown to staff, not corrected.
- **Audit.** `audit_log` records who changed what and when, with no passwords, hashes, keys or tokens. The events are ITEM_CREATED, ITEM_UPDATED (as a field diff), REORDER_OPENED/UPDATED/RESTOCKED and LOAN_CREATED/LOAN_CLOSED on the item, plus account and recovery events.
- **Privacy.** The public repository holds no staff or borrower PII, credentials, provider IDs or private exports (`npm run verify:privacy`). Borrower names, student IDs and photos live only in D1 and R2 and are served only to signed-in staff; photo keys are loan IDs.
- **Self-service is fail-closed and event-based.** An item is offered on phones only when staff turn it on and `selfServiceAction()` in `src/catalog-policy.ts` allows it (Consumable: Active and reviewed; Loanable: also listed). Phones never write quantities: each action is an immutable event with a client-generated id, stored once in `self_service_events` and applied through the same ledger and lending statements staff use (`lendStatements`, `closeStatements`). Replays are no-ops. History is ordered by when things happened, not when they synced. A physical count supersedes earlier offline movements it already saw. Phone records are never refused for quantity (the shelf is the truth), but staff movements keep their strict guard. Anything that cannot be applied safely is held for staff, never guessed. Details: `docs/OFFLINE_SELF_SERVICE.md`.

## Architecture
- **Front end:** semantic HTML, CSS and TypeScript modules built by Vite. There is no SPA framework; routing is a small client router over `data-route` links. Public pages ship in the main bundle; Self-Service and each staff area load on first use (a phone scanning the QR never downloads the staff workspace).
- **PWA:** `public/manifest.webmanifest` (start URL `/self-service`, shortcuts for Take, Borrow, Return, My activity) and a service worker (`src/sw.ts`, built to `/sw.js` by `vite.config.ts`) that precaches each build's app shell and never touches `/api/*`. Phone data lives in IndexedDB (`src/offline-store.ts`); sync is `src/offline-sync.ts`.
- **Worker:** one Cloudflare Worker, `logistics-hub` (`src/worker.ts`), serves the API and the static assets (`run_worker_first`). The public address is `https://logistics.hausc.org`; the `logistics-hub.<account>.workers.dev` address also works. It sets strict security headers and a `'self'`-only CSP.
- **Data:** D1 `logistics-hub` (binding `DB`) with migrations `0001`–`0015`. R2 bucket `logistics-hub-evidence` (binding `EVIDENCE`) holds loan photos, streamed only through the Worker to signed-in staff.
- **Staff APIs:** `/api/staff/inventory`, `/api/staff/stock` and `/api/staff/loans` (all revisioned), `/api/staff/items/:id`, `…/movements` (with optional `expectedOnHand`) and `…/loans` (multipart, with the photo), `/api/staff/loans/:id/return` and `…/photo`, `/api/staff/reorders` (POST) and `/api/staff/reorders/:id` (PATCH), `/api/staff/self-service` (revisioned) and `…/:eventId/resolve` (apply, match or dismiss) and `…/:eventId/photo`, plus account and admin routes.
- **Self-service APIs (public):** `GET /api/self-service/catalog` (revisioned) and `POST /api/self-service/sync` (same-origin, size-capped, rate-limited per network and per phone; at most 5 events and 4 photos per request).
- **Caching:** content-hashed `/assets/*` are `immutable` for a year; `/sw.js` is `no-cache`; every API answer is `no-store`.
- **Live refresh:** the `catalog_revision` counter plus ETag/304 polling (public every 15 s, staff Inventory and Stock every 10 s, Loans and Self-service every 15 s, the phone's self-service catalog every 30 s), which pauses in hidden tabs. Stock, restock, loan and self-service writes bump the revision, so Inventory, Stock, Loans, the item sheet, the Lending Hub and phones all follow.
- **Never** touch the old `hau-usc-logistics-production` or `hau-usc-logistics-staging` resources.

## Branding and retained legacy assets
- **Direction:**
  - Institutional oxblood for the masthead, hero, app bar and footer.
  - Warm paper for the work surfaces.
  - Exception: phone Self-Service uses the "Dusk" theme (Earl, 2026-09-29): the same crest, mark, oxblood, gold and type in an after-hours key over the campus photograph, scoped to `.is-self-service` (docs/OFFLINE_SELF_SERVICE.md, section 16). Staff and public pages keep warm paper.
  - Gold for primary actions on dark and for focus.
  - Newsreader for display and IBM Plex Sans for UI (self-hosted).
- **Density:** staff screens favour speed and density (a compact operations header, dot status tags, one shared sheet); public pages are more editorial.
- **Feedback:** toasts sit bottom-left on desktop, clear of the side sheet and record panel; empty timelines draw nothing.
- **Canonical brand files (`public/brand/`):**

| File | Source |
| --- | --- |
| `hau-campus-dusk.webp` | The original **Staff Login background** of the legacy Logistics Management website: the production brand slot `/brand/login-background`, a 1654×951 PNG of 2.15 MB (sha256 `1e9b1873…af90c6`). Converted to WebP q84 at the same pixel size (191 KB), otherwise unaltered. |
| `hau-usc-crest.webp` | The legacy `/brand/usc-logo` (a 1545×1999 PNG, sha256 `d1cb4968…3dda5`), trimmed and scaled to 240 px tall. |
| `dol-mark.png` | The Part 1 cropped DOL mark (also the favicon). |
| `ydd-2026-banner.jpg` | The landing hero image, set by Earl on 2026-09-29: the "Siglawang: Yabong ng Pamana" Youth Development Day 2026 banner (the HAU USC Facebook cover used by the legacy site, 960×356, sha256 `6ec7c5a7…`). Shown whole, never cropped or veiled, because it carries its own title. It replaced the earlier retained YDD photograph. |

`public/touch-icon.png` is the iOS home-screen icon. `public/icons/` (192, 512 and a maskable 512) are the installed-app icons: the DOL mark on warm paper, like the touch icon, resized with Lanczos and quantized to 96 colours. The old site's combined lockup is not used; the crest and the mark are composed in code instead.

`public/qr/logistics-self-service.svg` and `.png` are the one permanent Self-Service QR code (only `https://logistics.hausc.org/self-service`; version 4, error correction Q, 4-module quiet zone). `scripts/generate-self-service-qr.py` regenerates and decode-checks them.

## Local preview and verification
- `npm run dev:live` serves `http://127.0.0.1:8791`: a local Worker plus D1, preview accounts per role (credentials in the ignored `data/private/`), and cloud-branch sync.
- **Gates:**
  - `npm run typecheck`;
  - `npm test` (Worker and SQL tests over every real migration);
  - `npm run test:browser` (320–1440 px);
  - `npm run test:browser:worker` (real Worker and D1);
  - `npm run build`;
  - `verify:migration`, `verify:catalog`, `verify:privacy`.

## Git and deployment workflow
- `main` is the latest verified product. There is at most one short-lived `slice/<part>-<scope>` branch, shared by Codex and Claude under one writer lock (`npm run agent:claim|yield`).
- A green slice is merged to `main` immediately, and the slice branch is deleted.
- **Production deploys only from `main`.** Cloudflare Workers Builds deploys each push to `main` automatically, but it does **not** apply D1 migrations. A `main` that adds a migration needs that migration applied to production first (it must be safe for the code already live), then the push. A `main` that adds a binding (such as the R2 bucket) needs the resource created first, or the deploy fails. The Owner Console's *Deploy verified main* (`docs/DEPLOYMENT.md`) remains the gated path with a Time Travel bookmark and a Worker rollback id.
- Production and provider writes need Earl's explicit authority.
