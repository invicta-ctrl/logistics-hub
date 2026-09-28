# Deployment — Logistics Hub on Cloudflare

Target: **new, isolated** resources only.

| Resource | Name |
| --- | --- |
| Worker | `logistics-hub` (served at `https://logistics-hub.<account-subdomain>.workers.dev`) |
| D1 | `logistics-hub` (binding `DB`, id in `wrangler.jsonc`) |
| Secret | `SESSION_SECRET`, generated during the first deploy |
| R2 | none: Part 1 stores no files |

Never target `hau-usc-logistics-production` or `hau-usc-logistics-staging`. The admin console refuses to deploy if `wrangler.jsonc` references either one.

## The simple way: the local admin console

On Windows, double-click `LOGISTICS_ADMIN.cmd`. Anywhere else, run `npm run admin`.

1. **Sign in to Cloudflare once:** run `npx wrangler login` (it opens your browser). Alternatively, set a `CLOUDFLARE_API_TOKEN` environment variable with edit access to Workers Scripts and D1. No token is ever stored in this repository.
2. **7. Check Cloudflare/deployment status.** This confirms your sign-in, that the account can see D1 `logistics-hub` and its id matches `wrangler.jsonc`, any pending migrations, and the Worker, secret and live-site state. Anything missing is shown with the exact fix.
3. **8. Deploy latest verified main.** The console then:
   - **Preflights:** you must be on `main`, clean, and equal to `origin/main`. It then runs the typecheck, unit and Worker tests, build, privacy scan, and migration and catalog checks.
   - **Records a rollback point:** it reads a D1 Time Travel bookmark before any change.
   - **Shows the plan** and asks you to type `deploy`.
   - **Applies** the pending migrations.
   - **Deploys** the Worker. On the first deploy it also generates `SESSION_SECRET` in the same step, so the site never runs without it.
   - **Verifies** the live site and D1 (see below), and prints the URL and deployed commit.
   - **Keeps a record:** the URL, commit and bookmark of each deploy go in `.wrangler/admin/deployments.json`, which is ignored by Git.
4. **2. Create staff account** (target: PRODUCTION). Press Enter at the password prompt to generate a strong password. It is shown once and never stored.

Account menu: list, create, reset password, edit display name or username, enable, disable. Changing a password or username, or disabling an account, signs that person out everywhere. Every production change shows its target and asks you to type `production`. Press `E` to switch to the LOCAL preview database.

## Verification

Menu **9** (or `npm run admin -- verify <url>`) checks:
- the landing page and Lending Hub serve HTML, with the CSP and frame-blocking headers;
- the public catalog API responds, with live-update `ETag`/`304`;
- staff APIs and pages require sign-in, and anonymous stock writes are rejected;
- sign-in is configured (not `503`);
- D1 has 397+ items, and the ITM-0001 migration evidence (-1) is the only discrepancy.

## Rollback

- **Worker:** `npx wrangler rollback` returns to the previous version.
- **Data:** `npx wrangler d1 time-travel restore DB --bookmark=<bookmark printed by the deploy>`.
- **Staff access:** console option **6** disables an account and revokes its sessions at once.

## Manual reference (what the console runs)

```sh
npx wrangler d1 time-travel info DB --json
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy --secrets-file <temporary file holding SESSION_SECRET>   # first deploy only; otherwise plain deploy
```

Remote D1 rejects explicit `BEGIN TRANSACTION`/`COMMIT` and any query over 100 KB. The seed is split into parts to fit, and `tests/migration.test.ts` enforces both limits.

## Operating notes

- On launch the public Lending Hub is empty **by design**. Staff publish items from the *Ready to list* view: open an item, go to *Details & lending*, choose who may borrow, and tick *Details reviewed and verified*.
- Quantities change only through Stock in, Stock out and Count. The ledger is append-only.
- `ITM-0001` intentionally stays at 7 (movement-derived) against the legacy 8.
