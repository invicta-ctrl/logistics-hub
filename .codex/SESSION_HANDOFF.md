# Session Handoff — Shared Codex / Claude Worktree

STATUS: IDLE_ON_MAIN
ACTIVE_WRITER: NONE
WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
BRANCH: main
LIVE_PREVIEW: http://127.0.0.1:8791

## Completed (Part 1 product upgrade, Claude)
- Real staff auth: explicit `staff_accounts` (PBKDF2) managed by `npm run staff:account`; the env-var dev login is removed.
- Staff inventory workspace at `/staff/inventory`: a live table and filter tiles, plus an item drawer with Stock in / Stock out / Count, details and lending editing (audited), and history.
- Public Lending Hub lists only reviewed, active Loanable items that have an audience. It fails closed and shows live availability.
- Live refresh: the `catalog_revision` counter plus ETag/304 polling (public every 15 s, staff every 10 s).
- Ledger invariants: guarded single-statement movements, idempotency keys, and append-only triggers (migration 0004).
- Redesign: cropped large DOL mark (no caption), new landing, Lending Hub and staff shell. Fonts are self-hosted and the CSP is `'self'` only.
- Worker tests run on every real migration via node:sqlite. E2E runs a real Worker + D1 in throwaway `.wrangler/e2e` state.

## Exact next action
Deploy per `docs/DEPLOYMENT.md` (first launch), then create the real staff accounts with `--remote`. Staff then review and publish items from the "Loanable, not yet listed" queue (102 legacy-Loanable records).

## Dirty files
None expected.

## Known unresolved
- The Cloudflare launch has not run yet. The Claude cloud container had no Cloudflare token, and its network policy denied api.cloudflare.com.
- ITM-0001 reconciliation stays intentionally movement-derived: 7 versus 8 reported by the legacy system. It is shown to staff as migration evidence.
- The public Lending Hub is empty until staff review items. That is deliberate and fail-closed; no item is auto-published.
- `docs/WORKTREE_SETUP.md` and `scripts/setup-worktree.ps1` describe the older per-Part worktree model; `docs/SHARED_AGENT_WORKFLOW.md` supersedes them.
