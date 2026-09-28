# Current Handoff — Part 1

Part 1 code is complete on `main`, including owner access. For state and the next action, see `.codex/SESSION_HANDOFF.md`. The only runbook is `docs/DEPLOYMENT.md`.

Verification for the owner-access slice (Linux cloud container, local Worker + D1):
- typecheck;
- `npm test`: 41 tests, including 19 access-control tests covering:
  - role limits, last owner, disabled sign-in;
  - session invalidation on reset, rename and role change;
  - recovery (valid, invalid, rotated, revoked, demoted owner, single-use, no admin reach);
  - cross-site rejection, secret hygiene, audit metadata, login and recovery throttling;
  - migration 0011 against real session rows with foreign keys on;
- `test:browser`: 7 tests; `test:browser:worker`: 8 real Worker + D1 E2E tests, including owner-creates-staff/forced-change/staff-denied and recovery-once;
- build, `verify:privacy`, `verify:migration`, `verify:catalog`, `npx wrangler deploy --dry-run`;
- axe (WCAG 2.1 AA and best practices): 0 violations on Administration, New account, Manage and My account at 1366 px and 390 px. There is no horizontal overflow, and staff are redirected away from `/staff/admin`;
- the Owner Console was driven against the preview:
  - sign-in, list, create Staff and Admin (generated password), reset, rename, disable, sign out everywhere;
  - an ADMIN refused on owner/admin targets; forced password change;
  - pasted-key recovery with auto sign-in and a new key, an invalid key rejected, and key deletion.

Not verifiable here: DPAPI pairing, the `D:\` launcher, production deploy and the production smoke suite. These run on Earl's PC.
