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

Migration `0015` (Part 4.5, phone Self-Service) is additive: `items.self_service` (no longer read once items are offered by type), the new `self_service_events` table with a trigger that keeps a staff resolution final, then a revision bump. The Part 4 code never reads either, so it is safe to apply first. It adds no binding (loan photos from phones go to the same `EVIDENCE` bucket). Order for Part 4.5: apply `0015` to production, verify it, then push `main`:

```
npx wrangler d1 migrations list DB --remote        # shows 0015_self_service.sql as the only pending migration
npx wrangler d1 migrations apply DB --remote       # applies 0015 exactly once
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS offered FROM items WHERE self_service = 1; SELECT COUNT(*) AS events FROM self_service_events;"   # both 0
npx wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'self_service_events_resolved_final';"   # one row
```

The trigger was added to `0015` on 2026-09-29, before the migration reached production. A **local** preview database that applied an earlier `0015` lacks it; delete the local state (`.wrangler/state`) so `npm run dev:live` rebuilds it, or add the trigger by hand with `npx wrangler d1 execute DB --local --command "CREATE TRIGGER IF NOT EXISTS self_service_events_resolved_final BEFORE UPDATE ON self_service_events WHEN OLD.resolved_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'self_service_event_resolved'); END;"`.

After the push deploys: `npm run admin -- verify https://logistics.hausc.org`, then open `https://logistics.hausc.org/self-service` on a phone (it should say there is nothing to take or borrow yet), `…/manifest.webmanifest` (`application/manifest+json`) and `…/sw.js` (`Cache-Control: no-cache`). Turn on self-service for one real item from its Edit details, take or borrow it from a phone, and confirm the record under **Self-service** in the staff workspace.

Part 5 (Activity and exports) needs no migration and no binding: its code reads existing tables only, so `main` can be pushed without touching D1. Migration `0016` adds five read indexes and nothing else; production works without it (`docs/ACTIVITY_PERF.md`: about 10 ms per page at today's size) and it matters only as the ledger grows. Applying it is a separate, explicitly authorized step (bookmark, list, apply once, then check the five index names in `sqlite_master`), never bundled into a release. After the push deploys: as Staff, open **Activity**, search, filter and **Load older**; export the whole list once with **Export CSV** (if the export fails with a resource error, the Workers plan's CPU limit is the likely cause: narrow the dates and see `docs/ACTIVITY_PERF.md`); as an Owner, confirm the export appears under **Accounts & exports**; signed out, `POST /api/staff/activity/export` answers 401 or 403.

Part 5B (Open-Unit Tracking) **needs migration `0017` before its code reaches `main`**: the code reads `items.consumption_mode` and `open_units` on every inventory and phone catalog request. `0017` is safe for the code already live (Part 5 core): it adds a column with a default (`WHOLE_UNIT` for every item, nothing reclassified), the empty `open_units` table, triggers that do nothing while no unit is open, and rebuilds `self_service_events` with the same columns, rows, indexes and resolution trigger so its `CHECK` also accepts `USE`. No quantity or movement is touched. `wrangler d1 migrations apply` applies pending migrations in order, so `0016` (Part 5's read indexes) goes first. Order, from the release commit, with Earl's explicit authorization:

```bash
npx wrangler d1 time-travel info DB                # record the bookmark (rollback point) before anything changes
npx wrangler d1 migrations list DB --remote        # must list exactly 0016_activity_feed_index.sql and 0017_open_units.sql
npx wrangler d1 migrations apply DB --remote       # applies both, once; never re-run 0015
```

Then, read-only: `SELECT COUNT(*) FROM items WHERE consumption_mode <> 'WHOLE_UNIT'` is 0; `SELECT COUNT(*) FROM open_units` is 0; `self_service_events` has the same row count as before; `sqlite_master` lists `open_units`, the four `open_units`/`items`/`inventory_movements` triggers, `self_service_events_resolved_final` and the six `self_service_events` indexes; the on-hand total over `inventory_balances` is unchanged. Only then merge the Part 5B pull request to `main`. Rollback before the merge: restore the bookmark (`npx wrangler d1 time-travel restore DB --bookmark=<bookmark>`), which also discards anything recorded since.

**Applied 2026-10-02** (Earl, from his worktree: `0016` from `main`, then `0017` from `slice/part-05b-open-units`, each with `wrangler d1 migrations apply DB --remote`; `d1_migrations` now lists 17). Before it, a throwaway D1 built from production's exact schema took both migrations as one request each and showed the triggers working on real D1 (it was deleted afterwards). Pre-change point for Time Travel: 2026-10-02T02:11:43Z. Read-only post-checks matched the pre-change snapshot: 549 items with the same types, none reclassified (all `WHOLE_UNIT`), 689 movements, 97,000 units on hand, the 22 phone records identical (same ids, states and text lengths, including the return still waiting for staff), 0 open units, revision 203 → 204, no foreign-key problems, every index and trigger present and no leftover table. Then `main` was fast-forwarded to the PR #5 head. After the deploy: in Inventory, set a ream-type Consumable to **Open and use gradually**, open a unit, record a use, mark it empty (on hand −1), and check the item's History and Activity; on a phone, the item shows **Use**.

Part 6 (Administration + Hardening) **needs migrations `0018` and `0019` before its code reaches `main`**: the Worker reads `system_settings` on every phone catalog and sync call and on every staff session request, so without `0018` those fail. `0018` is safe for the code already live: it only adds the table with one row, `self_service = paused`, which that code ignores (it still reads the `SELF_SERVICE` variable, also paused). `0019` replaces the trigger that makes a resolved phone record immutable with one that still refuses every change except replacing its identity with the erased marker, which is what the Owner's retention action needs; code already live never changes a resolved record, so it behaves the same. Only Earl applies them to production. Order, from the Part 6 branch:

```bash
npx wrangler d1 export DB --remote --output data/private/backup-YYYYMMDD.sql   # a dump first (see Backups and restore)
npx wrangler d1 time-travel info DB                # record the bookmark (rollback point)
npx wrangler d1 migrations list DB --remote        # must list exactly 0018_system_settings.sql and 0019_retention_erasure.sql
npx wrangler d1 migrations apply DB --remote       # applies both, once, in order
```

Then, read-only: `SELECT key, value FROM system_settings` returns one row, `self_service | paused`; `SELECT COUNT(*) FROM d1_migrations` is one more than before; `sqlite_master` lists `self_service_events_resolved_final` (now with the erasure exception); the item, movement, loan and phone-record counts are unchanged. Only then merge the Part 6 pull request to `main`. After the deploy, sign in as an Owner or Administrator, open Administration, and confirm **Self-Service on phones** reads *Closed for maintenance*; the phone catalog still answers 503. Reopening is a decision for Earl, made on that page. **Old personal details** (Owner only) lists what is due before it removes anything; take a dump first (Backups and restore) and expect it to list nothing for a long time: loans exist only since 2026-09-29 (migration `0014`) and phone records since 2026-09-30, so the first records fall due in autumn 2027. Rollback before the merge: restore the bookmark (`npx wrangler d1 time-travel restore DB --bookmark=<bookmark>`).

**Applied 2026-10-02** (Earl, from a clean temporary clone of `slice/part-06-plan` at `8c7b0b1`, because the shared worktree had uncommitted local edits and was left alone). Before it: a dump (`data/private/backup-20261002.sql`, private) and a Time Travel bookmark taken at about 09:09 UTC (kept by Earl, not recorded here); `migrations list` showed exactly `0018` and `0019`. `migrations apply DB --remote` applied both; read-only post-checks: `system_settings` is one row, `self_service | paused`; `d1_migrations` has 19 rows; 549 items, 689 movements and 97,000 on hand, equal to the pre-change snapshot. The new trigger's SQL was not read back. Then `main` was fast-forwarded to the branch.

## Backups and restore

What protects what (Part 6.2, decision D3):

| Data | Protection | Gap |
|---|---|---|
| D1: items, movements, loans, phone records, accounts, audit | Time Travel (`npx wrangler d1 time-travel info DB`; restore with `time-travel restore`), plus a SQL dump on demand | The Time Travel window depends on the Cloudflare plan: read it from the Cloudflare docs for the plan in use, do not assume it |
| R2 evidence photos | none | No copy, no versioning. A deleted photo (by retention, or by deleting the bucket) cannot be brought back; D1 keeps only its key. Accepted because the photos are short-lived evidence and Part 6.4 erases them on schedule |
| Worker code | Git (`main`) and `npx wrangler rollback` | none |

**Take a dump** (read-only on production) before any migration, retention run or bulk change, beside the Time Travel bookmark:

```
npx wrangler d1 export DB --remote --output data/private/backup-YYYYMMDD.sql
```

The file holds every account's password hash, student IDs and names. It stays under `data/private/` (ignored by Git) or other private storage; never commit, attach or paste it.

**Restore from a dump** into a new, empty database, never over the live one (`wrangler d1 execute --file` leaves a failed import unapplied, so a retry is safe):

```
npx wrangler d1 create logistics-hub-restore
npx wrangler d1 execute logistics-hub-restore --remote --file data/private/backup-YYYYMMDD.sql
```

Then compare it with what you expect (`SELECT COUNT(*)` on `items`, `inventory_movements`, `staff_accounts`, `loans`, `self_service_events`; `d1_migrations` lists every migration) before pointing anything at it. To undo a bad change in place, use Time Travel restore instead (it also discards what was recorded since the bookmark). Pointing the Worker at a restored database means changing `database_id` in `wrangler.jsonc`, which is an owner decision.

**Rehearsed on 2026-10-02 (Claude Cloud, local only):** a local D1 migrated through 0017 with an owner account was exported with `wrangler d1 export DB --local` and restored into an empty local database with `wrangler d1 execute --file`. Result: all 49 schema objects (tables, indexes, 8 triggers, 1 view) identical; 16 tables with 922 rows, equal table by table (397 items, 393 movements, 17 `d1_migrations`); `PRAGMA foreign_key_check` clean. **Not rehearsed:** any remote restore or Time Travel restore. That needs a throwaway remote database or Earl's own run; until then both remote paths are documented but unproven here.

## Operating notes

- **Self-Service is open or closed by a setting** (Part 6.3, migration `0018`): Administration → **Self-Service on phones** (Administrator or Owner) closes it for maintenance or reopens it at once, with no deploy, and each change is an Activity entry. Closed, the Worker answers the phone catalog and sync with 503 and records nothing; phones keep what they saved and send it when it reopens (about 30 s after the next check). `0018` seeds it **closed**, as it has been since 2026-10-02 (PR #8), so deploying the code that reads it cannot reopen it; the old `SELF_SERVICE` variable in `wrangler.jsonc` no longer exists. Local end-to-end tests open it in their own throwaway database. While closed, administrators test it in Administration → Test Self-Service; their records wait in Self-service as tests (Dismiss them when done).
- The public Lending Hub is empty until staff publish items from *Ready to list*. This is fail-closed by design.
- Quantities change only through Stock in, Stock out and Count. The ledger is append-only.
- `ITM-0001` intentionally stays at 7 (movement-derived) against the legacy 8.

## Cloud Operations (production preparation from GitHub, not from a PC)

From V1.2 on, preparing production for a release (an R2 bucket, a D1 migration) is done by the workflow **Production operations** (`.github/workflows/production-ops.yml`), driven by a manifest in `ops/releases/<release>.json`. Authority and the full list of safety rules: `docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`. The older manual runbooks above (Parts 5B and 6) stay as the emergency fallback and as history.

**One-time setup (Earl, in GitHub).** Settings → Environments → **production** (the first run creates it if it does not exist), then:

- Make a backup key pair once, on any machine you trust, and keep the **private** half offline (a password manager or an encrypted drive; it is the only way to open a backup, and it must never go into GitHub): `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out ops-backup-private.pem` then `openssl pkey -in ops-backup-private.pem -pubout -out ops-backup-public.pem`.
- Add three environment secrets: `CLOUDFLARE_API_TOKEN` (a token for the Logistics Hub account only, with **D1: Edit** and **Workers R2 Storage: Edit** and nothing else), `CLOUDFLARE_ACCOUNT_ID`, and `OPS_BACKUP_PUBLIC_KEY` (the full text of `ops-backup-public.pem`). A private key pasted there by mistake is refused and named in the report; remove it from the secret at once.
- **Required protections on the environment** (the workflow's own `main` check is only a second line; these are the real controls): limit **deployment branches** to `main`, and add yourself as a **required reviewer** so no run touches production without your approval. Also keep `main` writable only by people you trust, because the tooling that runs is the tooling on `main`.

Until the three secrets exist, every run stops at once with `NO_CREDENTIALS`, contacts nothing, and says so in its report. A missing or unusable `OPS_BACKUP_PUBLIC_KEY` stops even the read-only preflight, so a wrong secret shows up before anything is prepared.

**Running a release.** Actions → **Production operations** → Run workflow (branch `main`):

1. `release` = `v1.2`, `expected_sha` = the full 40-character commit the release will ship (the head of `road-to-v2/v1.2-item-profiles-media`, or `main` once it carries V1.2), `mode` = **preflight**. This only reads. It checks that the tree is that exact commit and is on the release branch or `main`; that `wrangler.jsonc` names only the Logistics Hub's own Worker, D1 database and buckets; that the migration file is the one the manifest pins; that production has applied exactly the migrations before the pending one; that the bucket to create does not exist and the bucket that must exist does, with its creation time recorded, and is private. Read the report (the run's summary, and the `ops-report-…` artifact).
2. If the preflight passed, run it again with `mode` = **prepare** and `confirm` = `PREPARE v1.2 <the full sha>`. It repeats the preflight, then: makes a D1 export and encrypts it to `OPS_BACKUP_PUBLIC_KEY` (a random AES-256-GCM key, wrapped with RSA-OAEP, so the runner cannot open it again), checks the export is plausible, and deletes the plaintext; records a Time Travel bookmark; takes a baseline of the data; creates the private bucket and checks it is private; applies exactly the pending migration; and reconciles read-only (exactly the intended schema change, item, movement, on-hand, loan and phone-record figures equal the baseline, new tables empty, the evidence bucket still there with the same creation time, and the bucket list differing by exactly the new bucket). The result is **READY_TO_MERGE** or a stop.
3. Only then integrate the release to `main` by the existing protocol. Merging never migrates production by itself.

Run prepare when nobody is recording stock or lending (the data check compares the moment before and the moment after the change).

**What a report holds.** Every step with its evidence (names, counts, hashes), the operations performed, the bookmark, and the result, with no production rows. The backup is a separate artifact, `ops-backup-<release>`, ciphertext only. Both are kept 90 days. The report names the fingerprint of the key the backup was sealed to. To open a backup (it holds production data, so do it offline, keep the result private and delete it afterwards): `node scripts/ops/production-release.mjs decrypt --in <file>.sql.enc --key ops-backup-private.pem --file backup.sql`. A report holds only the names of the manifest's own buckets and the account's bucket count, never other bucket names.

**When it stops.** It stops on anything unexpected and the report names the step and whether production was changed.

| Stops at | Means | Production changed? | What to do |
|---|---|---|---|
| `NO_CREDENTIALS`, `NO_BACKUP_KEY`, `BAD_BACKUP_KEY`, `NOT_MAIN`, `NOT_IN_GITHUB`, `NOT_CONFIRMED`, `WRONG_SHA`, `BAD_SHA`, `SHA_NOT_ON_RELEASE`, `DIRTY_TREE`, `UNEXPECTED_CONFIG`, `WRONG_RESOURCE`, `MIGRATION_FILE`, `BAD_MANIFEST` | The inputs, secrets or release tree are not what the manifest expects | No | Fix the input or the release; run again |
| `UNEXPECTED_MIGRATIONS`, `ALREADY_PRESENT`, `MISSING_BUCKET`, `BUCKET_EXISTS`, `BUCKET_NOT_PRIVATE` (preflight), `D1_UNREACHABLE`, `UNEXPECTED_RESPONSE` | Production is not in the state the manifest expects | No | Find out why before anything else. `BUCKET_EXISTS` means something already ran: decide by hand what that bucket is (an empty one can be deleted, then run again) |
| `BACKUP_FAILED`, `BACKUP_INVALID`, `BACKUP_UNVERIFIED`, `BOOKMARK_FAILED`, `STATE_MOVED` | No safe backup or rollback point, or production moved during the preflight | No | Fix and run again |
| `CREATE_FAILED`, `BUCKET_MISSING_AFTER_CREATE`, `BUCKET_NOT_PRIVATE` (after creating) | The bucket step went wrong | A bucket may exist; no migration ran | Look at the bucket in the dashboard; delete it if empty and run again |
| `APPLY_FAILED`, `APPLY_NOT_RECORDED` | The migration failed and may have partly run, or wrangler said it succeeded but the migration is not recorded | **Possibly** | Check the schema; restore the bookmark in the report if needed |
| `RECONCILE_MISMATCH` | After the change, production does not match the manifest | **Yes** | Read the listed differences; restore the bookmark (below) unless they are acceptable |

**Rollback.** The report's bookmark: `npx wrangler d1 time-travel restore DB --bookmark=<bookmark>` (it also discards anything recorded since), or load the decrypted backup into an empty database. An empty new bucket can simply be deleted.

**Adding a release.** A new release needs its own `ops/releases/<release>.json` (resources, exact pending migrations with their SHA-256, the schema they add, the figures that must not change), reviewed like code. Nothing outside a manifest can run, and the command allowlist in `scripts/ops/production-release.mjs` refuses anything else.

