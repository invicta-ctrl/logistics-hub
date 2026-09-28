# Deployment — Logistics Hub on Cloudflare

Target: **new, isolated** resources only.

| Resource | Name |
| --- | --- |
| Worker | `logistics-hub` (served at `https://logistics-hub.<account-subdomain>.workers.dev`) |
| D1 | `logistics-hub` (binding `DB`) |
| Secret | `SESSION_SECRET` |
| R2 | none — Part 1 stores no files. Add a bucket when evidence uploads (Part 4) need one. |

Never target `hau-usc-logistics-production` or `hau-usc-logistics-staging`; they belong to the old system.

## Prerequisites

The deploying shell needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs edit permission for Workers Scripts and D1. It also needs network access to `api.cloudflare.com`. Never commit or paste the token.

## First launch

Run these from a clean, verified `main`:

```sh
npm ci
npm run typecheck && npm test && npm run build

# 1. The database already exists and is bound in wrangler.jsonc
#    (logistics-hub, 3ffd8edf-a176-4f63-8b7c-5215d11c98d8, empty until step 2).

# 2. Schema + the verified 397-item inventory seed with opening-balance movements (0001–0005).
npx wrangler d1 migrations apply DB --remote

# 3. Session signing secret (random, never stored in Git).
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" | npx wrangler secret put SESSION_SECRET

# 4. Deploy the Worker and static assets.
npx wrangler deploy

# 5. Create each staff login explicitly; the password is prompted, not echoed.
npm run staff:account -- create <username> --name "<Display Name>" --remote
```

## Verify the live deployment

```sh
BASE=https://logistics-hub.<account-subdomain>.workers.dev
curl -s $BASE/api/public/catalog               # {"revision":1,"items":[],...} until staff list items
curl -s -o /dev/null -w "%{http_code}\n" $BASE/staff/inventory          # 302 without a session
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "origin: $BASE" \
  -H "content-type: application/json" -d '{"kind":"IN","quantity":1,"key":"smoke-anon-1"}' \
  $BASE/api/staff/items/ITM-0001/movements                              # 401
npx wrangler d1 execute DB --remote --command \
  "SELECT COUNT(*) AS items, (SELECT on_hand FROM inventory_balances WHERE id='ITM-0001') AS itm1 FROM items"  # 397, 7
```

Then sign in on `/staff` and check the flow end to end: list one item, then confirm it appears on `/lending` in another browser within about 15 seconds.

## Routine releases

```sh
npx wrangler d1 migrations apply DB --remote   # only when migrations/ changed
npx wrangler deploy
```

## Rollback

- Worker: `npx wrangler rollback` returns to the previous version.
- Data: D1 Time Travel. Run `npx wrangler d1 time-travel info DB`, then `npx wrangler d1 time-travel restore DB --timestamp=<ISO time before the change>`.
- Staff access: `npm run staff:account -- disable <username> --remote` disables the account and revokes its sessions at once.

## Operating notes

- On launch the public Lending Hub is empty **by design**. All 397 migrated records are still awaiting review. Staff publish items from the *Loanable, not yet listed* queue: open an item, go to *Details & lending*, choose who may borrow, and tick *Details reviewed and verified*.
- Quantities change only through Stock in, Stock out, and Count. The ledger is append-only, enforced by database triggers.
- `ITM-0001` intentionally stays at 7 (movement-derived); the legacy snapshot reported 8. Record a Count only after a physical count.
