# Session Handoff — Shared Codex / Claude Worktree

STATUS: IDLE_ON_MAIN
ACTIVE_WRITER: NONE
WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
BRANCH: main
LIVE_PREVIEW: http://127.0.0.1:8791

## Part 2 on main (Claude, 2026-09-29)
- **Catalog:**
  - aliases ("Other names"), normalized and searchable;
  - a category or location that matches an existing value regardless of case or spacing reuses its stored spelling;
  - optimistic concurrency: `PATCH /api/staff/items/:id` needs the `updatedAt` the editor loaded, and a stale edit gets 409;
  - `listingGaps()` in `src/catalog-policy.ts` is the single lending-policy source.
- **Workspace:**
  - views: All, Needs review, Ready to list, On Lending Hub, Low stock, Out of stock, Inactive;
  - filters: category, location (including *No location set*), type;
  - search over name, other names, ID, category and location;
  - sortable location column; review progress meter.
- **Item sheet:**
  - Overview: quantity vs reorder level, migration evidence, review checklist, lending readiness with the exact gaps, stock, provenance;
  - Review & edit: catalog, inventory settings, lending, "Mark reviewed & next";
  - History: movements plus humanized catalog audit.
- **Migration `0012`:** the `audit_log(entity_type, entity_id, created_at)` index, and nothing else.
- **Redesign:**
  - an oxblood masthead with the HAU·USC crest and the DOL mark;
  - a full-bleed YDD hero with a live "On the shelf now" panel;
  - staff sign-in on the original legacy Staff Login photograph (`public/brand/hau-campus-dusk.webp`);
  - an oxblood staff app bar.
  All brand images now live in `public/brand/`.
- **Docs:** `docs/PRODUCT_REFERENCE.md` (new), `.codex/PART_02_BRIEF.md`.

## Exact next action (Earl's PC, clean main)
Production still runs an older manual upload. There is **no Git-connected Cloudflare build**, so pushing `main` does not deploy.
1. `npx wrangler login`.
2. `LOGISTICS_ADMIN.cmd`, then 12 (status), then 13 (deploy verified main). This applies `0010`–`0012` and verifies the live site.
3. Run 14 (first-time owner setup), then 8 (recovery check), as in `docs/DEPLOYMENT.md`.
4. Staff start reviewing: *Needs review*, then "Mark reviewed & next". Then publish from *Ready to list*.
If Earl wants automatic deploys from `main`, connect Workers Builds to this repository in the Cloudflare dashboard. That is a provider change, and it needs his action.

## Dirty files
None expected.

## Known unresolved
- The Part 1 production closure is still pending. See the steps above.
- ITM-0001 stays at 7, movement-derived, against the legacy 8. This is intentional migration evidence.
- All 397 migrated records need human review. None has a storage location yet.
- `wrangler dev` on Windows can disable its assets watcher with `EPERM` after a rebuild. If the preview serves stale assets, restart `npm run dev:live`.
