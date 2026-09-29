# Deployment and access — Logistics Hub on Cloudflare

There is **one deployment path** (the Owner Console's *Deploy verified main*) and **one credential path** (the site's Administration page, or the Owner Console, both using the site's authenticated Admin API). Nothing else is supported.

| Resource | Name |
| --- | --- |
| Worker | `logistics-hub` (`https://logistics-hub.<account-subdomain>.workers.dev`) |
| D1 | `logistics-hub` (binding `DB`, id in `wrangler.jsonc`) |
| Secret | `SESSION_SECRET`, generated once on the first deploy and never regenerated |
| R2 | `logistics-hub-evidence` (binding `EVIDENCE`): loan photos, private, streamed only through the Worker to signed-in staff. Create it once before the first deploy that includes Part 4: `npx wrangler r2 bucket create logistics-hub-evidence` |

Never target `hau-usc-logistics-production` or `hau-usc-logistics-staging`. The console refuses to deploy if `wrangler.jsonc` references either one.

## Roles

| Role | Can do |
| --- | --- |
| **Staff** | Inventory; their own name, username and password |
| **Administrator** | Everything Staff can, plus create and manage **Staff** accounts |
| **Owner** | Everything: Staff, Administrators and other Owners, roles, and the owner recovery key |

Rules enforced by the Worker on every request: an Administrator can never create, change, reset, disable or promote an Owner or another Administrator (including themselves). The last active Owner cannot be disabled or demoted. Passwords are stored only as PBKDF2 hashes. A password reset, username change, role change or disable ends that account's sessions. An account created or reset by someone else must choose its own password at the next sign-in. Sign-in is limited to 5 attempts a minute and recovery to 5 per 15 minutes per client. Account changes are recorded in `audit_log` (no secrets), shown as *Security activity* on the Administration page.

## The Owner Console

On Windows, double-click **`D:\Documents\Logi hub access\LOGISTICS_ADMIN.cmd`**. The console creates this launcher the first time it runs on a PC with a `D:` drive; `npm run admin -- install-launcher [folder]` recreates it. The launcher only points at the shared worktree `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub` and runs its `LOGISTICS_ADMIN.cmd`, so it never holds a second copy of the app. On other systems, run `npm run admin`.

```
Accounts          1 Sign in · 2 List · 3 Create · 4 Reset password · 5 Edit (name, username, role)
                  6 Enable/disable · 7 Sign out everywhere
Owner recovery    8 Forgot owner password · 9 Pair this computer · 10 Rotate or delete the key
Developer         11 Preview status · 12 Production status · 13 Deploy verified main · 14 First-time owner setup
S                 Switch site (production / local preview)
```

Options 1–10 talk to the site over HTTPS as a signed-in user, exactly like the browser. They need **no Cloudflare sign-in and no database access**, and the site enforces the same rules as the website. Only options 12–14 use Wrangler (`npx wrangler login` once, or a `CLOUDFLARE_API_TOKEN`). The console keeps per-user settings (production address, paired key) in `%LOCALAPPDATA%\LogisticsHub`, outside the repository. Production writes ask you to type `yes`.

## Owner recovery key

- A 256-bit random key, formatted `LHR1.<id>.<secret>`. D1 stores only its SHA-256 verifier.
- It can do exactly one thing: set a new password for its Owner account, re-enable it, and sign it out everywhere. It cannot sign in, and it cannot touch inventory or accounts. Recovery attempts are rate limited and audited.
- It is **single-use**. Issuing a new key revokes the old one. Revoking leaves no key. Losing the Owner role also ends it.
- **Pair this computer (9):** the key is encrypted with Windows DPAPI for your Windows user and saved in `%LOCALAPPDATA%\LogisticsHub\owner-recovery.dpapi.json`. It is never stored in Git, `.env`, plaintext JSON or a `.cmd` file. The console offers to show it once for an offline copy (paper or a password manager).
- **Forgot owner password (8):** the console uses the paired key, or asks you to paste an offline one. You choose the new password. It then signs you in and immediately issues and pairs a fresh key.
- Without any key, a forgotten Owner password needs Cloudflare access (a new owner via option 14 is refused while an Owner exists; use D1 Time Travel or ask the Cloudflare account holder).

## First launch (Earl's PC)

1. `npx wrangler login` once.
2. Console **12. Production status:** checks sign-in, that D1 `logistics-hub` matches `wrangler.jsonc`, pending migrations, the Worker and `SESSION_SECRET`.
3. Console **13. Deploy verified main.** It runs:
   - **Preflight:** you must be on clean `main`, equal to `origin/main`. It runs typecheck, tests, build, privacy, migration and catalog checks.
   - **Rollback point:** it records a D1 Time Travel bookmark and the Worker version currently live.
   - **Plan:** it shows the plan and asks you to type `deploy`.
   - **Apply:** pending migrations only. It generates `SESSION_SECRET` only if the Worker has none, and stops rather than replace an existing one.
   - **Verify** the live site (next section).
   - **Record:** each deploy goes in `.wrangler/admin/deployments.json` (Git-ignored), including the bookmark, old and new versions, and migrations.
4. Console **14. First-time owner setup.** This works only while production has no Owner. Type your own username, display name and password; the console hashes the password locally. It signs you in and pairs this computer (step 9).
5. Create Administrators and Staff from the website's **Administration** page or console option 3.

## Verification

`npm run admin -- verify <url>` (also run automatically after a deploy) checks:
- landing and Lending Hub return 200 with the CSP and frame-blocking headers;
- the public catalog has an `ETag`/`304`;
- staff APIs and pages require sign-in, and anonymous stock writes are rejected;
- sign-in is configured;
- D1 has 397+ items, and ITM-0001's −1 migration evidence is the only discrepancy.

## Rollback

- **Worker:** `npx wrangler rollback <previous version id printed by the deploy>`.
- **Data:** `npx wrangler d1 time-travel restore DB --bookmark=<bookmark printed by the deploy>`.
- **Access:** disable an account (Administration page or console 6); this ends its sessions immediately.

Remote D1 rejects explicit `BEGIN TRANSACTION`/`COMMIT` and queries over 100 KB; `tests/migration.test.ts` enforces both. Migration `0011` rebuilds `staff_accounts` to add roles, which ends all existing sessions once. Migration `0012` (Part 2) only adds an index.

Workers Builds deploys every push to `main` automatically, but it does not apply D1 migrations. Before pushing a `main` that adds a migration, apply it to production (Console **13**, or `npx wrangler d1 migrations apply DB --remote` from that commit). Migrations must stay safe for the code already live, so it keeps working until the push lands. Migration `0013` (Part 3) is additive: a movement reason column, an optional expiry column and the `reorders` table. Migration `0014` (Part 4) reclassifies the 112 "Saleable" items as Consumable (audited per item), replaces the never-used, empty `loans` / `loan_items` / `evidence` placeholders with the new `loans` table, and bumps the revision; the Part 3 code references none of those tables and accepts Consumable, so it is safe to apply first.

A deploy that adds a binding needs the resource first: Part 4 adds the R2 bucket above, and a push without it fails the Workers Builds deploy (the live version keeps serving). Order for Part 4: create the bucket, apply `0014`, then push `main`.

## Operating notes

- The public Lending Hub is empty until staff publish items from *Ready to list*. This is fail-closed by design.
- Quantities change only through Stock in, Stock out and Count. The ledger is append-only.
- `ITM-0001` intentionally stays at 7 (movement-derived) against the legacy 8.
