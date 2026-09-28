# Current Handoff — Part 1

Part 1 is on `main`, including the product upgrade. See `.codex/SESSION_HANDOFF.md` for state and next action, and `docs/DEPLOYMENT.md` for the launch runbook.

Verification for the upgrade:
- typecheck (frontend and Worker)
- `npm test`: 20 tests on real migrations
- `npm run test:browser`: 6 UI tests, 320–1440 px
- `npm run test:browser:worker`: 5 real Worker + D1 E2E tests, including live public refresh from staff writes and the rejection of anonymous and cross-site writes
- `verify:migration`, `verify:catalog`, `verify:privacy`
- `wrangler deploy --dry-run`, which binds only the `logistics-hub` D1

Visual review: screenshots at 1440 and 375 px showed no overflow and no console errors.
