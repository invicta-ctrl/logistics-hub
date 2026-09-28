# Logistics Hub

Focused HAU-USC Department of Logistics office operations system.

- Retained YDD-facing public landing identity.
- Public Lending Hub and Staff Login.
- Logistics Request unavailable for now.
- Inventory/cataloguing first; then stock/pantry, lending, activity/audit, administration.
- HTML5/CSS/TypeScript-first frontend with Cloudflare Worker + D1 + R2.

Bootstrap branch: `bootstrap/office-ops-v0.1`.

Read `AGENTS.md` then `.codex/CURRENT.md` before implementation.

## Part 1 local development

Install dependencies with `npm install`, then use `npm run dev` for the browser UI or `npm run dev:worker` for the complete local Worker/D1 stack. The local Worker is migrated with:

```powershell
npx wrangler d1 migrations apply logistics-hub-part-01-local --local
```

The public catalog is sourced from local D1 and uses movement-derived balances. All migrated records remain unavailable to borrow until a later approved review makes an item explicitly lending-ready. Development staff login is disabled unless an operator supplies loopback-only runtime configuration and a session secret; production authentication is not configured by this repository.

Run `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run test:browser:worker`, `npm run verify:migration`, `npm run verify:catalog`, and `npm run verify:privacy` before review.
