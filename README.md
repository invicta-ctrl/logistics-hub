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

Install dependencies with `npm install`, then apply the local D1 migrations before starting the complete Worker stack:

```powershell
npx wrangler d1 migrations apply logistics-hub-part-01-local --local
```

Use `npm run dev` for browser-only UI work, or `npm run dev:worker` after the migration command for the local Worker/D1 stack. The public catalog is sourced from local D1 and uses movement-derived balances. All migrated records remain unavailable to borrow until a later approved review makes an item explicitly lending-ready.

Staff sign-in is disabled by default. For an isolated loopback-only local test, create an ignored `.dev.vars` file with `ENVIRONMENT=development`, `DEV_AUTH_ENABLED=true`, and generated values for `SESSION_SECRET`, `DEV_STAFF_USERNAME`, and `DEV_STAFF_PASSWORD`. Generate fresh random values locally and never commit or reuse real credentials. Production authentication is not configured by this repository.

Run `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run test:browser:worker`, `npm run verify:migration`, `npm run verify:catalog`, and `npm run verify:privacy` before review.


## Shared Codex + Claude development

Both agents now use one authoritative local worktree:

`D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`

Do not create parallel active worktrees for the same Part. See `docs/SHARED_AGENT_WORKFLOW.md`.

Writer ownership:

```powershell
npm run agent:status
npm run agent:claim -- codex
npm run agent:yield -- codex
```

Use `claude` instead of `codex` when Claude owns the turn.

For a continuously running full-stack local preview:

```powershell
npm run dev:live
```

Then open `http://127.0.0.1:8791`. The command applies local D1 migrations, keeps the local Worker running, and rebuilds frontend assets as files change. Refresh the browser to see the newest full-stack build.

Before an agent yields—especially when usage is nearing its limit—it must update `.codex/SESSION_HANDOFF.md` with the exact current state and next action.
