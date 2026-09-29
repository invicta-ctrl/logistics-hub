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
| `/staff` | Staff sign-in. See the details below. |
| any other path | A branded "page not found". |

The landing page (`/`):
- an oxblood masthead carrying the HAU·USC crest and the DOL mark. On this page only, the lockup opens the official HAU University Student Council Facebook page (`https://www.facebook.com/holyangeluniversitysc`) in a new tab; on other public pages it returns home;
- a hero on deep oxblood: the headline, a gold "Browse the Lending Hub" action and a "How borrowing works" link, beside the whole, uncropped Youth Development Day 2026 banner (the banner sits above the headline on phones). There is deliberately no availability panel here: the landing page does not poll the catalog, and availability lives only in the Lending Hub;
- "How borrowing works" in three steps, ending in one "Open the Lending Hub" action and the notice that logistics requests are *not yet available* online.
- "Staff sign in" appears only in the masthead and footer.

The Lending Hub (`/lending`):
- the public, read-only catalogue, grouped by category;
- search, an Available-now switch, category chips and sorting;
- live availability that refreshes every 15 s;
- filters kept in the URL.

Staff sign-in (`/staff`) uses the original legacy Staff Login campus photograph behind a new, secure sign-in form. A signed-in visit goes straight to the workspace.

The public catalog DTO carries only: `id`, `name`, `category`, `unit`, `available`, `audience`, `maxPerLoan`, `loanDays`.

## Staff workspace
Every `/staff/*` page and `/api/staff/*` call needs a live session. Writes must come from the same origin.

### Inventory (`/staff/inventory`)

The table shows ID, item (with type and other names), category, location, on-hand quantity and status tags.

**Views:**
- All items;
- Needs review;
- Ready to list (Loanable, not listed, not inactive);
- On Lending Hub;
- Low stock (at or below the reorder level);
- Out of stock;
- Inactive.

**Filters:** category, location (including *No location set*) and type. On phones they fold behind one "Filters" button.

**Search** matches name, other names, ID, category and location. `/` focuses the search.

**Sorting** is by ID, name, category, location or on hand. The view, search, filters, sort and open item are all kept in the URL.

**Review progress** sits in the compact page header: "N of 397 records reviewed". "Needs review" is a neutral marker, not a warning colour.

**Item sheet** (a side sheet on desktop, a bottom sheet on phones), in three tabs:
- **Overview:**
  - on-hand quantity against the reorder level;
  - migration evidence and verification notes;
  - the review checklist;
  - Lending Hub status that says exactly what is missing (`listingGaps()`);
  - Record stock first (Stock in, Stock out, Count), then the facts and where the record came from.
- **Review & edit / Edit details:**
  - **Catalog:** name, other names, category, type, unit, location, notes;
  - **Inventory settings:** status (Active, Verify, Inactive), reorder level, stock area (Inventory or Pantry) and, for pantry items, an optional earliest expiry;
  - **Lending:** who may borrow, loan period, maximum per loan;
  - a "Details reviewed and verified" box;
  - "Mark reviewed & next", which walks the current filtered list.
- **History:** stock movements and catalog changes merged in one timeline, written as sentences with the actor and the time (never raw JSON).

**New item:** the Worker generates the ID (`ITM-####`). The opening quantity becomes the first movement. A duplicate name is warned about but not blocked.

### Stock & Pantry (`/staff/stock`)

Daily quantity work over the same items and ledger (Inventory stays the catalog workspace).
- **Header:** today's movement count and who recorded the last one; one "Record movement" action.
- **Needs attention:** one list with filter chips (Out of stock, Low stock, Needs count, Expiring). Each row says why, and offers the next action (Stock in or Count, Add to restock). Items without a reorder level are never called low; a hint says how many have none.
- **Restock list:** a lightweight replenishment list, not procurement: restock quantity, Needs restock → Planned, **Receive** (records a Stock in that closes the entry) or Dismiss; suggestions from reorder levels; closed entries from the last two weeks.
- **Pantry:** items whose stock area is Pantry (a catalog field; 10 food and kitchen items migrated), with reorder level, optional earliest expiry (Expired, or expiring within 14 days) and quick Use and Restock actions.
- **Activity:** today's or recent staff movements, each with the change, before → after, reason, actor and time.
- **Record movement:** item search (name or ID), Stock in, Stock out or Count, quantity with a live before → after preview, reason (Stock in: delivery or purchase, returned, donation, other; Stock out: consumed, issued, damaged, missing, transferred, other; Other needs a note), and note. After recording, the movement type and reason stay and the item field is ready for the next entry; a session list shows what was just recorded. A sticky panel on desktop; a bottom sheet on phones and tablets.
- The same movement form is used in the Inventory item sheet (`src/movement-form.ts`).

### Administration and My account
- **Administration (`/staff/admin`, ADMIN and OWNER only):** the accounts table, create, manage (profile, role, reset, sign out everywhere, enable or disable), and security activity.
- **My account (`/staff/account`):** password, profile, sign out other devices, and (for an OWNER) the recovery key.
- The Owner Console (`npm run admin`, or `LOGISTICS_ADMIN.cmd`) uses the same Admin API. `docs/DEPLOYMENT.md` is the only runbook.

## Roles
| Role | Can |
| --- | --- |
| STAFF | Everything in Inventory, Catalog and Stock & Pantry, and their own account |
| ADMIN | STAFF, plus managing STAFF accounts |
| OWNER | Everything, including roles, other owners and the recovery key |

Every rule is enforced by the Worker (`src/accounts.ts`, `src/worker.ts`). The browser only hides controls.

## Parts (roadmap)
| Part | Scope | State |
| --- | --- | --- |
| 1 YDD Gateway + Foundation | Landing, fail-closed Lending Hub, staff auth and roles, owner recovery, movement ledger, live refresh | **Complete** — local + GitHub verified 2026-09-29 |
| 2 Inventory + Catalog | Complete item management, search, views, classification, locations, reorder settings, lending readiness, migrated review, history | **Complete** — local + GitHub verified 2026-09-29 |
| 3 Stock + Pantry | Stock workspace, movement reasons, counts, low stock, restock list, pantry, optional expiry, activity; whole-product polish | **Complete** — local verified 2026-09-29 |
| 4 Lending | Borrowers (STUDENT or USC_STAFF), multi-item loans, due and return, damage and loss, photo evidence (R2) | Planned |
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
- **Catalog edits never touch quantity history.**
  - Edits carry the version the editor loaded (`updatedAt`), and a stale edit gets `409` instead of silently overwriting.
  - Categories and locations reuse the stored spelling of an existing value that matches regardless of case or spacing.
  - Nothing with history is deleted; items are made Inactive.
- **Lending is fail-closed.** An item is public only when it is Active, reviewed, type Loanable, and has an audience. `listingGaps()` in `src/catalog-policy.ts` is the single source of that rule. Migrated Loanable items are never auto-published.
- **Migration evidence stays visible.** ITM-0001 derives 7 from the ledger while the legacy system reported 8 (delta −1). It is shown to staff, not corrected.
- **Audit.** `audit_log` records who changed what and when, with no passwords, hashes, keys or tokens. The events are ITEM_CREATED, ITEM_UPDATED (as a field diff) and REORDER_OPENED/UPDATED/RESTOCKED on the item, plus account and recovery events.
- **Privacy.** The public repository holds no staff or borrower PII, credentials, provider IDs or private exports (`npm run verify:privacy`).

## Architecture
- **Front end:** semantic HTML, CSS and TypeScript modules built by Vite. There is no SPA framework; routing is a small client router over `data-route` links.
- **Worker:** one Cloudflare Worker, `logistics-hub` (`src/worker.ts`), serves the API and the static assets (`run_worker_first`). The public address is `https://logistics.hausc.org`; the `logistics-hub.<account>.workers.dev` address also works. It sets strict security headers and a `'self'`-only CSP.
- **Data:** D1 `logistics-hub` (binding `DB`) with migrations `0001`–`0013`. R2 is reserved for Part 4 evidence.
- **Staff APIs:** `/api/staff/inventory` and `/api/staff/stock` (both revisioned), `/api/staff/items/:id` and `…/movements`, `/api/staff/reorders` (POST) and `/api/staff/reorders/:id` (PATCH), plus account and admin routes.
- **Live refresh:** the `catalog_revision` counter plus ETag/304 polling (public every 15 s, staff Inventory and Stock every 10 s), which pauses in hidden tabs. Stock and restock writes bump the revision, so Inventory, Stock, the item sheet and the Lending Hub all follow.
- **Never** touch the old `hau-usc-logistics-production` or `hau-usc-logistics-staging` resources.

## Branding and retained legacy assets
- **Direction:**
  - Institutional oxblood for the masthead, hero, app bar and footer.
  - Warm paper for the work surfaces.
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

`public/touch-icon.png` is the iOS home-screen icon. The old site's combined lockup is not used; the crest and the mark are composed in code instead.

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
- **Production deploys only from `main`.** Cloudflare Workers Builds deploys each push to `main` automatically, but it does **not** apply D1 migrations. A `main` that adds a migration needs that migration applied to production first (it must be additive), then the push. The Owner Console's *Deploy verified main* (`docs/DEPLOYMENT.md`) remains the gated path with a Time Travel bookmark and a Worker rollback id.
- Production and provider writes need Earl's explicit authority.
