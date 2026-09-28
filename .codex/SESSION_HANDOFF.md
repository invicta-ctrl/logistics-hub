# Session Handoff — Shared Codex / Claude Worktree

STATUS: IDLE_ON_MAIN
ACTIVE_WRITER: NONE
WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
BRANCH: main
LIVE_PREVIEW: http://127.0.0.1:8791

## Part 1 on main (summary)
- **Public:** the landing page, and a Lending Hub that fails closed, shows only reviewed items, and refreshes live via `catalog_revision` with ETag/304.
- **Staff workspace:** inventory with Stock in, Stock out and Count on an append-only, movement-derived ledger; item details and lending; history.
- **Data:** 397 migrated items. ITM-0001 intentionally stays at 7 against the legacy 8, shown to staff as migration evidence (`0010`).
- **Design:** a token design system with self-hosted fonts, a `'self'`-only CSP, and a motion system with a reduced-motion clamp.

## Owner access slice (Claude, merged)
- **Migration `0011`:**
  - roles `STAFF`/`ADMIN`/`OWNER` and `must_change_password`;
  - `owner_recovery_keys` (verifier only);
  - `auth_throttle`;
  - indexes.
  It rebuilds `staff_accounts`, which ends existing sessions once. Its foreign-key safety was tested against real session rows.
- **`src/accounts.ts`:** a single server implementation of every account rule, used by the website and the console.
  - ADMIN manages STAFF only.
  - The last OWNER cannot be removed.
  - Sensitive changes revoke sessions.
  - Changes are audited to `audit_log` without secrets.
- **Worker API:**
  - `/api/staff/me*` for self service;
  - `/api/staff/admin/*` for administration;
  - `/api/recovery/owner`, which only resets the owner's password.
  Login and recovery are throttled in D1. Mutations require the same origin.
- **UI:**
  - `/staff/admin`: account table, create (generated or typed password), manage (profile, role, reset, sign out everywhere, enable/disable), security activity;
  - `/staff/account`: password, profile, sign out other devices, recovery key.
  The navigation is Inventory · Administration · My account.
- **Owner Console (`scripts/admin.mjs`):**
  - account work goes over HTTPS to the Admin API, with no Wrangler needed;
  - recovery (a paired DPAPI key or a pasted key, then auto sign-in and a fresh key), pairing, and rotate/delete;
  - developer options: status, deploy (which records the replaced Worker version and the Time Travel bookmark), and first-time owner setup, which works only while there are zero owners;
  - it writes the `D:\Documents\Logi hub access\LOGISTICS_ADMIN.cmd` launcher on Windows.
  The obsolete direct-D1 account SQL was removed.
- **Docs:** `docs/DEPLOYMENT.md` is now the single deployment and credential runbook. `docs/WORKTREE_SETUP.md` and `scripts/setup-worktree.ps1` were retired.

## Exact next action (Earl's PC, clean main)
1. `npx wrangler login`.
2. Double-click `LOGISTICS_ADMIN.cmd` in the worktree. The first run creates `D:\Documents\Logi hub access\LOGISTICS_ADMIN.cmd`; use that from then on.
3. Choose **12** (production status), then **13** (deploy). This applies `0010` and `0011`, keeps the existing `SESSION_SECRET`, and verifies.
4. Choose **14** (first-time owner setup). Earl types his own username, display name and password. The console signs in and pairs the PC.
5. Verify production:
   - **S** to production and sign in;
   - create temporary Admin and Staff accounts, check their sign-in and permissions, then disable them;
   - **8** (recovery with the paired key), then confirm the old key fails.
6. When all of this passes, set `.codex/CURRENT.md` STATUS to `COMPLETE_AND_PRODUCTION_VERIFIED`, with `OPEN_PART_01_ITEMS: none`.

## Dirty files
None expected.

## Known unresolved
- Production is not yet deployed with this code and has no OWNER. The cloud container has no Cloudflare API, Windows or `D:\` access. The production state was verified read-only via the Cloudflare connector: 0001–0009 applied, 397 items, 0 accounts.
- DPAPI pairing and the `.cmd` launcher are untested on real Windows. Their logic was reviewed, and the launcher content was generated and checked with CRLF line endings.
- The public Lending Hub is empty until staff publish items. This is deliberate.
- The remote branches `slice/part-01-polish-launch` and `claude/relaxed-dijkstra-aw1i6o` are fully contained in `main`, but the cloud Git proxy refuses remote branch deletion. Delete them, and `slice/part-01-owner-access` if it is still present, from GitHub or with `git push origin --delete <branch>` locally.
