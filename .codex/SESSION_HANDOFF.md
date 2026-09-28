# Session Handoff — Shared Codex / Claude Worktree

STATUS: IDLE_ON_MAIN
ACTIVE_WRITER: NONE
WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
BRANCH: main
LIVE_PREVIEW: http://127.0.0.1:8791

## Completed (Part 1 product upgrade, Claude)
- Real staff auth: explicit `staff_accounts` (PBKDF2) managed with the local admin console (`npm run admin`); the env-var dev login is removed.
- Staff inventory workspace at `/staff/inventory`: a live table and filter tiles, plus an item drawer with Stock in / Stock out / Count, details and lending editing (audited), and history.
- Public Lending Hub lists only reviewed, active Loanable items that have an audience. It fails closed and shows live availability.
- Live refresh: the `catalog_revision` counter plus ETag/304 polling (public every 15 s, staff every 10 s).
- Ledger invariants: guarded single-statement movements, idempotency keys, and append-only triggers (migration 0009).
- Redesign: cropped large DOL mark (no caption), new landing, Lending Hub and staff shell. Fonts are self-hosted and the CSP is `'self'` only.
- Worker tests run on every real migration via node:sqlite. E2E runs a real Worker + D1 in PID-scoped throwaway `.wrangler/e2e-*` state.

## Completed (frontend polish round, Claude)
- Token-based design system: neutral surfaces, oxblood for actions only, one type scale, hairlines, dot status tags, SVG icons, self-hosted fonts.
- Editorial landing; a catalogue-style Lending Hub grouped by category; staff app bar, view tabs, a sortable table, a side sheet, toasts, and an unsaved-changes guard.
- Filters, sort and the open item are kept in the URL; `/` focuses search; live refresh preserves keyboard focus.
- Migration `0010` (formerly 0005): `inventory_balances.migration_delta` now compares the legacy snapshot with the migrated ledger only, so later staff movements never create false discrepancies.
- axe-core: 0 WCAG 2.1 AA violations on every screen. The code review findings are fixed. The security review found nothing.

## Completed (cloud-sync hardening, Claude)
- `scripts/sync-cloud-preview.mjs` never leaves a branch with unpushed commits, and returns to `main` only from a merged, pruned slice. It re-checks the lock and a dirty tree right before every switch or merge. It fetches only `main` and `slice/*`, with a 30 s timeout, polling every 15 s and backing off to 60 s.

## Completed (launch tooling and final polish, Claude)
- Reconciled: Earl's seed split (slice), the watcher hardening (claude branch) and main were merged into `slice/part-01-polish-launch` with no work lost. Production D1 was verified read-only: only `0001_core.sql` applied, no data.
- Remote D1 rejects `BEGIN TRANSACTION` (error 7500, verified) and queries over 100 KB. Seed parts `0002`–`0007` contain neither, and `tests/migration.test.ts` enforces this. The evidence view is `0010`.
- `dev:live` moves a local database migrated before the renumbering to `.wrangler/state-backup-<time>` and rebuilds, so nothing is lost and no manual reset is needed.
- Local admin console (`npm run admin`, `LOGISTICS_ADMIN.cmd`):
  - accounts: list, create (with a generated password option), reset password, edit name or username, enable, disable;
  - production changes require typing `production`;
  - operations: status (with fixes), deploy (strict preflight, Time Travel bookmark, typed `deploy`, migrations, generated `SESSION_SECRET` on first launch, live verification) and verify.
- UI:
  - an editorial split hero with the emblem medallion;
  - Lending Hub chips, sort, clear and last-one states;
  - staff stepper, destructive Stock out, delta badges, rolling counts, a timeline history, a mobile bottom sheet, and arrow-key rows;
  - a motion system (View Transitions, scroll-driven CSS, reduced-motion clamp).
- Verification: axe reports 0 violations on 8 screens.

## Exact next action
On Earl's machine, from clean `main`:
1. Run `npx wrangler login` once.
2. Run `LOGISTICS_ADMIN.cmd` and choose 7 (status), then 8 (deploy). This applies migrations `0002`–`0010`, sets `SESSION_SECRET`, deploys and verifies.
3. Choose 2 on PRODUCTION to create the real staff accounts.
4. Staff publish items from the "Ready to list" view.

## Dirty files
None expected.

## Known unresolved
- The Cloudflare launch has not run yet: the Claude cloud container cannot reach api.cloudflare.com, and the Cloudflare connector has no Worker-upload tool. The admin console performs the launch from Earl's machine.
- ITM-0001 reconciliation stays intentionally movement-derived: 7 versus 8 reported by the legacy system. It is shown to staff as migration evidence.
- The public Lending Hub is empty until staff review items. That is deliberate and fail-closed; no item is auto-published.
- `docs/WORKTREE_SETUP.md` and `scripts/setup-worktree.ps1` describe the older per-Part worktree model; `docs/SHARED_AGENT_WORKFLOW.md` supersedes them.
- Restart `npm run dev:live` once to pick up the watcher fix and rebuild the local preview database.
- `origin/claude/relaxed-dijkstra-aw1i6o` is fully merged, but this session's Git proxy refused to delete it; delete it from GitHub.
