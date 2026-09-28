# Current Handoff — Part 2

Part 2 (Inventory + Catalog) and the DOL redesign are complete on `main`. For state and the next action, see `.codex/SESSION_HANDOFF.md`. The only runbook is `docs/DEPLOYMENT.md`. For the whole-product description, see `docs/PRODUCT_REFERENCE.md`.

Verification for Part 2 (Windows, local Worker + D1):
- `npm run typecheck` and `npm run build`;
- `npm test`: 46 tests. The new ones cover:
  - stale-edit 409 and a missing version;
  - alias normalization;
  - canonical category and location spellings;
  - listing gaps and history events;
  - role gating;
- `test:browser`: 7 tests, including every public route at 320, 375, 768, 1024 and 1440 px, and the sign-in background;
- `test:browser:worker`: 11 real Worker + D1 E2E tests.
  - The new ones cover migrated review with "Mark reviewed & next", alias search, the location filter and humanized history; create with duplicate-name warning, lending validation and deactivation; and a 320 px phone.
  - All Part 1 flows still pass.
- `verify:migration` (397 items; only the ITM-0001 discrepancy), `verify:catalog` (0 listed from the snapshot), `verify:privacy` (0 matches);
- axe-core WCAG 2.1 AA: 0 violations on landing, Lending Hub, sign-in, 404, inventory, the item sheet (all three tabs), Administration and My account, at 1440 px and 375 px, with no horizontal overflow;
- Impeccable detector: clean after one fix batch.

Not verifiable here: the production deploy (no Git-connected Cloudflare build exists; deploys go through the Owner Console), DPAPI pairing, and the `D:\` launcher.
