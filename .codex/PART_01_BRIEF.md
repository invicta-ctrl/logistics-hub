# Part 1 Task Brief — YDD Gateway + Foundation

STATUS: READY_AFTER_BOOTSTRAP_ACCEPTANCE
PART: 01
BRANCH: feature/part-01-ydd-foundation
BASELINE: bootstrap/office-ops-v0.1
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md

## INTENT
Implement the first independently usable vertical slice of Logistics Hub.

## OBJECTIVE
Deliver a working YDD-facing public gateway plus permanent system foundation:
- retain/port the previous approved public landing visual identity;
- public read-only Lending Hub backed by real migrated inventory;
- Staff Login foundation;
- Logistics Request visible as unavailable, with no request backend.

Part 1 must be usable by itself. Do not defer required behavior to Part 2.

## TARGET
Work only in the Part 1 worktree:
`D:\Documents\Codex\HAU-USC Logistics\worktrees\logistics-hub-part-01-ydd-foundation`

## AUTHORITATIVE SOURCES
1. `AGENTS.md`
2. `.agents/PROJECT_POLICY.md`
3. `.codex/CURRENT.md`
4. `.codex/CURRENT_TASK.md`
5. `.codex/CURRENT_HANDOFF.md`
6. accepted spec named above
7. `migrations/0001_core.sql`, `migrations/0002_inventory_seed.sql`
8. `data/migration/inventory.production.json`, `inventory-reconciliation.json`
9. old HAU-USC Logistics repository only for the retained landing visual identity/assets and explicitly needed landing behavior.

Do not copy the old React architecture.

## STARTING HANDSHAKE
Before editing:
1. Verify repository root.
2. Verify branch is `feature/part-01-ydd-foundation`.
3. Record full HEAD and upstream.
4. Require clean tracked status.
5. Confirm no conflicting writer.
6. Confirm bootstrap PR #1 is accepted/merged or explicitly authorized as the base.
7. Run `node scripts/verify-migration-data.mjs`.
8. Run a tracked-files check for `data/private`; only `README.md` may be tracked.
9. Never print or commit private roster contents.

## STACK
- semantic HTML5
- CSS3 with tokens/custom properties
- TypeScript and small JavaScript modules
- Vite
- Cloudflare Worker in TypeScript
- D1 structured data
- R2 evidence/assets where needed later
- Vitest and/or focused unit tests
- Playwright for browser acceptance

Do not add React or another SPA framework unless an accepted amendment establishes a concrete need.

## IN SCOPE

### 1. Project foundation
Create the minimal package/build/runtime structure needed for a maintainable permanent application. Keep dependencies small.

### 2. Public landing
Port the recognizable previous landing presentation without inheriting its component architecture.

Preserve as appropriate:
- HAU/USC/DOL institutional identity;
- YDD/current council presentation;
- hero background/environment and tasteful entrance behavior;
- responsive/reduced-motion behavior.

Change the public decision model to:
- **Lending Hub** — active;
- **Staff Login** — active;
- **Logistics Request** — visibly unavailable/non-actionable.

Remove request tracking and request submission from Part 1.

### 3. Public Lending Hub
Route: `/lending`.

Use real migrated data, not fixtures.

Support:
- browse;
- search;
- category filters where data permits;
- item photo/placeholder;
- availability;
- concise lending description/details.

Fail closed:
- unresolved/VERIFY/needs-review items are not publicly lendable;
- items not explicitly eligible for lending are not exposed as borrowable;
- no online loan submission in Part 1.

### 4. Staff Login
Route: `/staff`.

Establish real server-side auth/session boundaries suitable for later staff modules.

Private staff directory exists locally under ignored `data/private`. Directory identity is distinct from login identity.
- Never auto-enable login merely because an email appears in a historical source.
- Old Production access account remains separate until exact identity reconciliation.
- No PII may enter Git.

A successful authorized login may enter a minimal permanent staff shell/home sufficient for Part 1. Do not build Part 2 inventory administration yet.

### 5. Data access
Use the migrated D1-compatible schema/seed.

Inventory truth:
`SUM(POSTED inventory_movements.signed_quantity)`

Do not calculate live stock from `legacy_reported_*` columns.

Known migration issue:
- `ITM-0001` movement-derived on-hand is 7;
- legacy snapshot reported 8;
- preserve and surface as migration/reconciliation evidence;
- do not guess a correction.

### 6. Responsive/accessibility
Required:
- keyboard navigation;
- visible focus;
- reduced motion;
- 320/375/768/1024/1440-class responsive coverage;
- semantic landmarks/headings/forms;
- useful empty/loading/error states.

“Less semantics” means simpler business language, not removing HTML/accessibility semantics.

## OUT OF SCOPE
- Logistics Request API/submission/tracking;
- event management;
- procurement/canvassing/deliverables;
- Release Desk;
- Part 2 catalog editing;
- Part 3 stock/pantry mutation workflows;
- Part 4 direct loan/return/evidence workflow;
- production deployment;
- remote provider mutation without exact target/preflight/approval;
- staff/borrower PII in Git.

## DELIVERABLES
- locally runnable Part 1;
- permanent HTML/CSS/TS application foundation;
- real public inventory catalog reads;
- working auth boundary;
- YDD-ready landing;
- tests;
- updated current/task/handoff records;
- complete reviewed diff.

## VERIFICATION
Minimum:
1. dependency/lockfile integrity;
2. migration verifier passes;
3. lint/typecheck as configured;
4. unit tests;
5. browser tests for `/`, `/lending`, `/staff`;
6. public lending excludes unresolved/non-lendable inventory;
7. no Logistics Request mutation endpoint exists;
8. private directory remains ignored/untracked;
9. build passes;
10. Cloudflare local/dry-run only if provider config is introduced;
11. complete diff review.

## STOP CONDITIONS
Stop before implementation or further mutation if:
- bootstrap baseline changed incompatibly;
- tracked work is unexpectedly dirty;
- another writer owns the worktree;
- staff/borrower PII would enter source, logs or Git;
- a remote provider/Production mutation becomes necessary;
- a migration discrepancy would need to be hidden or guessed;
- excluded legacy architecture/workflow is required;
- verification fails outside a bounded repair.

Stop after Part 1 is green. Do not begin Part 2 automatically.
