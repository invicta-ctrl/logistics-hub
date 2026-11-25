# Technical overview
## Product at a glance
- HAU-USC Logistics Hub; invicta-ctrl/logistics-hub; accountable owner Earl; operating owner Department of Logistics.
- Public landing, Lending Hub and Staff login; staff inventory/catalog, stock/pantry, lending, activity, administration, directory and offline self-service. Verify each accepted route and behavior during modernization planning.
- Verified source baseline main 30d4464f4b34fdc5591f6012c2840ce58ba620a9; product-release.json records V1.16.15. PR #96 remains open; no production read-back is asserted here.
- Sources: [configuration](governance.json), [specifications](docs/specs/), [checkpoint](docs/CURRENT.md), [plan](PLAN.md).

## Technology
Current stack: semantic HTML/CSS, TypeScript 5.9, Vite 7, Wrangler 4, Workers, D1, R2, Vitest 4 and Playwright; exact versions in package-lock.json. CI evidence for Node 22.23.4: PR #96 job 131078297553. Target React/React Router/Tailwind and shared UI per ENGINEERING-BASELINE.md, not yet implemented.

## System and structure
- src/worker.ts is request router and server-side auth; src/inventory.ts owns movement-derived stock; D1 DB holds structured truth; R2 EVIDENCE, CATALOG_MEDIA and STAFF_IDS have distinct access boundaries. Existing AI and IMAGES bindings are conditional features, not sources of truth. src/main.ts and domain modules render browser UI; src/sw.ts and offline modules handle PWA. See docs/DATA_ARCHITECTURE.md, docs/OFFLINE_SELF_SERVICE.md and docs/DEPLOYMENT.md.
- Current source src/ is flat and mapped during transition; public/ assets, tests/ fixtures and suites, migrations/ SQL, ops/releases/ manifests, scripts/ verification, docs/ authoritative records. Proposed app/ feature-oriented layout is described in PLAN.md; no source moves or framework changes in governance adoption.
- New visual baseline pending approved Figma designs. Current LH-UI-88 references and licensed institutional assets are retained.

## Development and operations
- npm ci; npm run dev:live (local Worker/D1 at 127.0.0.1:8791); npm run typecheck; npm test; npm run test:browser; npm run test:browser:worker; npm run build; npm run verify:privacy.
- Local generated credentials and provider bindings remain private; no production data in preview or public evidence.
- Existing release target is Cloudflare Worker logistics-hub, logistics.hausc.org; documented Workers Builds path and GitHub CI-only cutover gate. Actual current trigger and artifact identity require qualification; no deployment authorized here.
- See AGENTS.md, ARCHITECTURE.md, DESIGN.md, SKILLS.md, QUALITY.md and quality/README.md. Run governance, docs, foundation and readiness checks; record unrun/failed checks in CURRENT.

Governance tooling installed: ESLint 10.15.0, typescript-eslint 8.74.0 and @axe-core/playwright 4.14.1; actual package and lockfile are authoritative. The new readiness gate is fail-closed pending legacy lint, provenance, visual baseline and exact runtime qualification. No application source migration yet.
