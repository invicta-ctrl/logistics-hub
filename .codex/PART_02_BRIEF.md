# Part 2 Brief — Inventory + Catalog

STATUS: ACTIVE
BRANCH: slice/part-02-inventory-catalog (from origin/main 0784659)
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md (Part 2)
INSTRUCTION: Earl, 2026-09-29 — Part 2 Inventory + Catalog, plus a visual redesign that matches the local preview direction and reuses legacy branding.

## Precondition audit (2026-09-29)
- `origin/main` 0784659 holds all Part 1 code, including owner access (0011).
- Part 1 is **not production-closed**. `wrangler deployments list` shows the last production deploy as a manual upload on 2026-09-28 16:53 UTC, running an older build. Migrations 0010–0011 are unapplied remotely, no OWNER exists, and no Git-connected auto-deploy from `main` was observed. Those steps stay with Earl (credentials, owner bootstrap). Part 2 proceeds locally without touching production.
- Stale branches: `origin/slice/part-01-polish-launch`, `origin/slice/part-01-owner-access` and `origin/claude/relaxed-dijkstra-aw1i6o` are contained in `main`. The shared workspace holds a local `slice/part-01-polish-launch` with three commits that are not on `main`. Those commits are docs and merges only, and their content is superseded by 4bc8beb and 0784659.

## Reused from Part 1 (do not rebuild)
- `/staff/inventory`: the live ETag table, view tabs, category filter, sortable columns, URL state (`view`, `q`, `category`, `sort`, `item`), the `/` shortcut and keyboard row navigation.
- Item side sheet: stock in, stock out and count (guarded, idempotent, append-only), movement history, and the unsaved-changes guard.
- `createItem` (system IDs `ITM-####`, opening balance as a movement) and `updateItem` (field diff audited as `ITEM_UPDATED`).
- `isListedForLending` fail-closed policy; the public DTO; `catalog_revision` polling.
- Roles STAFF/ADMIN/OWNER, sessions, same-origin writes, and the single `audit()` writer.

## Data facts (local D1 = migrated seed)
- 397 items, all `needs_review = 1`.
- 0 have a storage location and 0 have aliases.
- 143 are `NEEDS_REVIEW` type (shown as "Unclassified") and 3 have status VERIFY with a verification note.
- 102 are legacy Loanable. None are listed.
- There are 14 categories in legacy capitals. `PREVIOUS TERM` and `OTHERS` exist, and there are no case-duplicates today.

## Missing Part 2 work
1. **Aliases:** editable, stored normalized, shown on items, and searchable.
2. **Views:**
   - add Inactive and Low stock;
   - exclude inactive items from Out of stock and Ready to list;
   - add a location filter (including "No location") and a type filter.
3. **Search:** match name, ID, aliases, category and location.
4. **Categories and locations:**
   - the server reuses the canonical spelling of an existing category or location when input matches case- and whitespace-insensitively;
   - existing values are suggested;
   - missing locations are visible.
5. **Item detail:** reorganized into Overview (facts, stock, lending readiness) · Details (catalog, inventory settings, lending, review) · History.
6. **Lending readiness:** `listingGaps()` is the single policy source. The sheet explains exactly why an item is or is not listed, and what is still missing.
7. **Migrated review:**
   - a review checklist;
   - "Mark reviewed & next" moves through the current filtered list;
   - review progress is shown.
8. **History:** catalog audit events (created, field changes, review, activation, lending) are merged with movements, humanized (no raw JSON), with actor and time.
9. **Safe edits:** optimistic concurrency on `updated_at`, so a stale sheet cannot silently overwrite another staff member's change. Deactivate and reactivate are explicit actions; nothing is deleted.
10. **Client validation:** mirrors the Worker, and warns before creating a duplicate item name.
11. **Migration 0012:** an index for per-item audit history. There is no schema change to quantity, and `current_quantity` is never stored.

## Redesign (same slice)
- Follow the local preview direction: a full-bleed dark oxblood hero with the retained YDD photograph and a gold primary action. Elevate it with the HAU·USC crest and DOL mark lockup, and a live availability panel.
- Staff sign-in uses the original legacy Staff Login background (production `/brand/login-background`, 1654×951 PNG) as an optimized WebP.
- Staff app bar in DOL oxblood; dense, clear inventory surfaces.
- New brand assets go in `public/brand/`, one canonical file each.

## Out of scope
Purchasing and replenishment, pantry, expiry (Part 3); loans (Part 4); the activity center and exports (Part 5); settings and backups (Part 6). Request Center and the old React frontend are not revived.
