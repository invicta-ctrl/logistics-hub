# Logistics Hub

Operations system for the HAU-USC Department of Logistics.

- **Public:** a landing page, a live **Lending Hub** that lists only staff-reviewed Loanable items with current availability, and Staff login. Logistics Request is shown as not yet available.
- **Self-Service (`/self-service`):** one permanent QR code opens an installable app on people's own phones to Take, Borrow and Return self-service items and see My activity, and it keeps working offline (records sync later and reconcile across phones). Engineering: `docs/OFFLINE_SELF_SERVICE.md`; install guide for students and staff: `docs/PWA_INSTALL_GUIDE.md`.
- **Staff:** an Inventory + Catalog workspace with a live table, views (Needs review, Ready to list, Low stock, Inactive…), search across names, other names, IDs, categories and locations, and an item sheet for stock movements, catalog and lending settings, migrated-record review, and a readable change history.
- **Stack:** semantic HTML, CSS, TypeScript modules, Vite, one Cloudflare Worker, and D1. No SPA framework.

Read `AGENTS.md`, then `.codex/CURRENT.md`, before changing anything. `docs/PRODUCT_REFERENCE.md` describes the whole product.

## How it works

- Quantity is the sum of posted `inventory_movements`. The ledger is append-only, and database triggers enforce that. A stock movement is one guarded SQL statement, so stock cannot go negative and a retried request is never counted twice.
- Every inventory write bumps `catalog_revision`. Pages poll with `If-None-Match`, so an unchanged catalog costs a single-row read and returns `304`. Public pages poll every 15 s, and the staff table every 10 s. Polling pauses while the tab is hidden.
- Staff logins are explicit accounts in `staff_accounts`, with PBKDF2 hashes and signed, revocable D1 sessions. They are never inferred from the staff directory.
- Authorization is enforced by the Worker. Every `/api/staff/*` route and every `/staff/*` page needs a live session. Writes must also come from the same origin.

- Phones never write quantities: each self-service action is an immutable event with its own id, applied once through the same ledger and lending statements staff use. The service worker precaches each build's app shell and never caches `/api/*`.

Source: `src/worker.ts` (routing and auth), `src/inventory.ts` (data), `src/catalog-policy.ts` (listing and self-service rules), `src/self-service.ts` (self-service sync), `src/public.ts`, `src/staff.ts`, `src/self-service-app.ts`, `src/offline-*.ts`, `src/sw.ts` and `src/ui.ts` (browser).

## Local development

```sh
npm ci
npm run dev:live      # http://127.0.0.1:8791 — local Worker + D1, rebuilds on change
```

`dev:live` applies local migrations. It generates `.dev.vars` (`SESSION_SECRET`) and, when none exists, a local preview staff account. The preview credentials go in the ignored `data/private/local-preview-credentials.txt`. Manage staff accounts and deployments with the local admin console: `npm run admin`, or double-click `LOGISTICS_ADMIN.cmd` on Windows. It targets PRODUCTION by default; press `E` to switch to the LOCAL preview database.

## Checks

```sh
npm run typecheck
npm test                     # Worker + SQL tests against every real migration
npm run test:browser         # UI tests, 320–1440 px
npm run test:browser:worker  # real Worker + D1 end-to-end in throwaway state
npm run verify:migration && npm run verify:catalog && npm run verify:privacy
npm run build
```

If Playwright's bundled browser is missing, set `PLAYWRIGHT_CHROMIUM_PATH` to a local Chromium.

## Deploying

Run `npm run admin` and choose **8. Deploy latest verified main**. It preflights, records a D1 rollback point, applies pending migrations, deploys, then smoke-tests the live site. `docs/DEPLOYMENT.md` explains each step. Only the isolated `logistics-hub` Worker/D1 is ever targeted, never the old `hau-usc-logistics-*` resources.

## Shared Codex + Claude development

Both agents use one worktree, one active slice branch, and one writer lock (`npm run agent:status|claim|yield -- <agent>`). See `docs/SHARED_AGENT_WORKFLOW.md`. Before yielding, update `.codex/SESSION_HANDOFF.md`.
