# Logistics Hub

Operations system for the HAU-USC Department of Logistics.

- **Public:** a landing page, a live **Lending Hub** that lists only staff-reviewed Loanable items with current availability, and Staff login. Logistics Request is shown as not yet available.
- **Self-Service (`/self-service`):** one permanent QR code opens an installable app on people's own phones to Take, Borrow and Return self-service items and see My activity, and it keeps working offline (records sync later and reconcile across phones). Engineering: `docs/OFFLINE_SELF_SERVICE.md`; install guide for students and staff: `docs/PWA_INSTALL_GUIDE.md`.
- **Staff:** an Inventory + Catalog workspace with a live table, views (Needs review, Ready to list, Low stock, Inactive…), search across names, other names, IDs, categories and locations, and an item sheet for stock movements, catalog and lending settings, migrated-record review, and a readable change history.
- **Stack:** semantic HTML, CSS, TypeScript modules, Vite, one Cloudflare Worker, and D1. No SPA framework.

Read `AGENTS.md` and its required policy/handoff chain before changing anything. The [documentation authority map](docs/DOCUMENTATION_STATUS.md) distinguishes current instructions from historical evidence. `docs/PRODUCT_REFERENCE.md` describes the product.

## How it works

- Quantity is the sum of posted `inventory_movements`. The ledger is append-only, and database triggers enforce that. A stock movement is one guarded SQL statement, so stock cannot go negative and a retried request is never counted twice.
- Every inventory write bumps `catalog_revision`. Pages poll with `If-None-Match`, so an unchanged catalog costs a single-row read and returns `304`. Public pages poll every 15 s, and the staff table every 10 s. Polling pauses while the tab is hidden.
- Staff logins are explicit accounts in `staff_accounts`, with PBKDF2 hashes and signed, revocable D1 sessions. They are never inferred from the staff directory.
- Authorization is enforced by the Worker. Every `/api/staff/*` route and every `/staff/*` page needs a live session. Writes must also come from the same origin.

- Phones never write quantities: each self-service action is an immutable event with its own id, applied once through the same ledger and lending statements staff use. The service worker precaches each build's app shell and never caches `/api/*`.

Source: `src/worker.ts` (routing and auth), `src/inventory.ts` (data), `src/catalog-policy.ts` (listing and self-service rules), `src/self-service.ts` (self-service sync), `src/public.ts`, `src/staff-shell.ts` (staff sign-in and shell), `src/staff.ts` (Items), `src/self-service-app.ts`, `src/offline-*.ts`, `src/sw.ts` and `src/ui.ts` (browser).

## Local development

```sh
npm ci
npm run dev:live      # http://127.0.0.1:8791 — local Worker + D1, rebuilds on change
```

`dev:live` applies local migrations. It generates `.dev.vars` (`SESSION_SECRET`) and, when none exists, a local preview staff account. The preview credentials go in the ignored `data/private/local-preview-credentials.txt`. Manage staff accounts with the local admin console (its deploy option is the legacy route, see Deploying below): `npm run admin`, or double-click `LOGISTICS_ADMIN.cmd` on Windows. It opens on the site it used last (a red PRODUCTION or a green PREVIEW banner says which); press `S` (Switch site) to choose production or the LOCAL preview database.

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

Merging is not deploying. A merge to `main` is `MERGED_DEPLOYMENT_UNVERIFIED` until the live artifact is checked against a build of that commit (then `DEPLOYED_OWNER_CHECK_PENDING`, and `RELEASED_VERIFIED` once Earl has checked it). The current truth for each release is in `.codex/CURRENT.md` and its record under `docs/road-to-v2/releases/`.

- **How production is deployed today.** Cloudflare Workers Builds deploys each push to `main` by itself. The GitHub `Deploy` workflow runs after a green CI as a dry run (`DEPLOY_FROM_CI=dry-run`) and uploads nothing. A merge-button commit has no combined CodeQL check, so the gate refuses it by design: a red `Deploy` run on such a commit is expected, not a production failure. `docs/DEPLOYMENT.md` and `docs/road-to-v2/v1.17-ci-only-deploy-task.md` explain the gate and the switch to CI-only deploys (Earl's decision, not started).
- **Migrations and release-scoped production preparation** go only through the Cloud Operations lane (`.github/workflows/production-ops.yml`, `ops/releases/<release>.json`), never from a PC.
- **Owner Console (`npm run admin`).** Accounts are 1–7, owner password recovery is **8. Forgot owner password** (with 9 and 10 for the recovery key), status is 11 and 12, **13. Deploy verified main** is the legacy direct-Wrangler route (it needs the owner's Cloudflare sign-in and is not the accepted path for migrations), and 14 is first-time owner setup. Agents do not run options 12–14 and never create, read or store staff credentials. `docs/DEPLOYMENT.md` explains each step. Only the isolated `logistics-hub` Worker/D1 is ever targeted, never the old `hau-usc-logistics-*` resources.

## Agents and development workflow

Claude writes the code: one writer by default, and up to two on separate accepted disjoint tasks in their own worktrees, with one serial integration steward (`docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md`, HAU-AGENT-LANES-003). ChatGPT audits and reviews; Codex and Forge are read-only. Each writer has a worktree, a `slice/*` branch and a writer lock (`npm run agent:status|claim|yield -- claude`). See `docs/SHARED_AGENT_WORKFLOW.md`.

**Start here:** `AGENTS.md` (rules and reading order), then `.codex/CURRENT.md` (the live task board and writer slots) and `.codex/SESSION_HANDOFF.md` (last and next step). Superseded working documents are kept in `docs/archive/`. Every PR uses `.github/pull_request_template.md`.
