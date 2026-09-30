# Offline Self-Service — Engineering Guide

Part 4.5. How phone self-service works, where each behaviour lives, and how to change it safely. For the people using it, see `docs/PWA_INSTALL_GUIDE.md`.

## 1. What it does

One permanent QR code opens `https://logistics.hausc.org/self-service`. A student or staff member uses **their own phone** to:

- **Take** a consumable (water, paper),
- **Borrow** equipment (with the Part 4 identity rules and a photo),
- **Return** what they borrowed (good, damaged or lost),
- see **My activity**.

After one online visit, the app is installed on the phone (a PWA) and keeps working without internet. Every action is saved on the phone first, as an immutable **event**, and synced later. The Worker reconciles events from many phones without losing any, and only asks staff about genuinely ambiguous cases.

**First-visit reality.** A phone that has never opened the page cannot use it offline: the app and the catalog must be downloaded once. The home screen says so plainly (**Getting ready for offline use…** → **Ready for offline use**). On iPhone and iPad a Safari tab and the Home Screen app keep separate storage, so offline use starts after **Add to Home Screen**; the app tells iPhone users that instead of a readiness claim.

## 2. Where things live

| Concern | File | Notes |
| --- | --- | --- |
| Eligibility rule, limits, review reasons | `src/catalog-policy.ts` | Shared by the Worker and the browser. `selfServiceAction()`, `selfServiceGaps()`, `SELF_SERVICE_LIMITS`, `REVIEW_REASONS`. |
| Worker API: catalog, sync, reconciliation, staff review | `src/self-service.ts` | The only server module for Part 4.5. |
| Canonical lending (staff and phones) | `src/loans.ts` | `loanDetails()`, `readPhoto()`, `lendStatements()`, `closeStatements()`. No second loan implementation. |
| Ledger helpers | `src/inventory.ts` | `HISTORY_ORDER` (business time), `countAwareStatus()` (supersede by a later count). |
| Routes, rate limits, headers | `src/worker.ts` | `/api/self-service/*`, `/api/staff/self-service*`, `/sw.js` and `/assets/*` caching. |
| Phone storage (IndexedDB) | `src/offline-store.ts` | No DOM; used by the page and the service worker. |
| Queue rules (pure, unit-tested) | `src/offline-queue.ts` | Batching, applying answers, estimates, open loans, retention. |
| Sync engine | `src/offline-sync.ts` | `record()`, `syncNow()`, `refreshCatalog()`. No DOM. |
| Service worker | `src/sw.ts` → `/sw.js` | Built by the plugin in `vite.config.ts`. |
| Install, update, readiness | `src/pwa.ts` | `startPwa()` in `main.ts`. |
| Phone screens | `src/self-service-app.ts`, `src/self-service.css` | Home, Take, Borrow, Return, My activity, Install. The "Dusk" theme (section 16). |
| Staff exception view + poster | `src/self-service-review.ts` | `/staff/self-service`. |
| Schema | `migrations/0015_self_service.sql` | Additive, plus a trigger that keeps a staff resolution final. |
| QR | `public/qr/logistics-self-service.{svg,png}`, `scripts/generate-self-service-qr.py` | |
| Manifest, icons | `public/manifest.webmanifest`, `public/icons/` | |
| Tests | `tests/self-service.test.ts` (Worker), `tests/offline-queue.test.ts` (queue rules), `tests/worker-browser/offline-self-service.spec.ts` (real offline E2E) | |

## 3. Eligibility (fail closed)

There is no per-item switch: the choice staff make (Inventory → item → **Edit details → Borrow or consume**, stored as the item type Loanable or Consumable) decides, and eligible items are offered automatically. (`items.self_service` from migration 0015 is no longer read; dropping it needs its own migration.) `selfServiceAction(item)` is the one rule:

- **TAKE**: Consumable, Active, reviewed.
- **BORROW**: Loanable, Active, reviewed and listed on the Lending Hub (so it has an audience). A `USC_STAFF_ONLY` audience allows USC use only.
- Anything else is not offered.

Staff screens show only the item's type (Loanable or Consumable); there is no self-service status, tag or view on items.

## 4. The catalog snapshot — `GET /api/self-service/catalog`

Public, revisioned (the shared `catalog_revision` is the ETag; unchanged → `304`), `no-store`. It carries only `id, name, aliases, category, unit, action, available, location, audience` plus the `revision`. Never notes, migration evidence, reorder data, history, borrowers or photos. `location` is included on purpose: self-service is unattended, so people need to know which shelf.

The phone keeps one full snapshot in IndexedDB and refreshes it on launch, every 30 s while visible, after each sync, and when the connection returns. Hundreds of items fit easily, so there is no delta protocol.

## 5. Events

### On the phone (`LocalEvent`, `offline-queue.ts`)

The wire part (sent unchanged on every retry):

```
{ v: 1, id: UUID, seq: 1, 2, 3 …, type: TAKE | BORROW | RETURN, itemId, quantity (1–30),
  occurredAt: ISO (phone clock), catalogRevision,
  person: { name, studentId? },
  purpose?, reason?, returnBy?            // BORROW (Individual: name + student ID; USC: name + reason)
  loanEventId?, outcome?, note? }         // RETURN (note required unless good; a photo of the item is always required)
```

plus local bookkeeping: `state` (`pending | synced | review | rejected`), `message`, `attempts`, `nextAttemptAt`, `appliedRevision`, `hasPhoto`, `itemName`, `unit`.

- `id` is generated **before** saving and is the idempotency key end to end.
- `seq` is the phone's own order; a return is always sent after its borrow.
- The device id is a random UUID stored in IndexedDB. There is no fingerprinting.
- A borrow's photo is compressed in the browser (≤ 1600 px JPEG, refused over 2 MB) and saved **in the same IndexedDB transaction** as the event (`saveEvent()`), so neither can exist without the other. Four photos at most per request stay well inside the 12 MB request cap.

### On the Worker (`self_service_events`)

One row per event id: who/what/when, `device_time`, `sent_at`, `occurred_at` (business time), `received_at`, `client_tag` (a keyed hash of the sender's network, never the address), `loan_id`, `movement_id`, `applied`, `review`, and the resolution. What an event *changed* lives in the canonical tables:

| Event | Canonical effect |
| --- | --- |
| TAKE | an `inventory_movements` STOCK_OUT, reason CONSUMED, `related_entity_type = 'SELF_SERVICE'`, key `ss:<id>` |
| BORROW | a loan `LN-SS-<id>` plus its LOAN_OUT movement (via `lendStatements`), photo in R2 |
| RETURN | nothing yet: it is held with its photo (`RETURN_CHECK`). Staff confirming it (`resolveReview` `match`) closes the loan via `closeStatements` (LOAN_RETURN only for a good return), which is what puts stock back |

Records made by phones carry the actor id `SELF_SERVICE`; staff screens show it as "Self-service".

**Adding a new event type**: add it to `EVENT_TYPES` and `parseEvent()` in `self-service.ts` (validation), write its canonical statements (reuse ledger/lending builders), add its row to the `CHECK` in a new migration, then a form in `self-service-app.ts`. Add a Worker test first.

## 6. Sync — `POST /api/self-service/sync`

Multipart: `batch` = `{ deviceId, sentAt, events[] }` plus one `photo:<event id>` part per borrow. At most **5 events and 4 photos** per request, which keeps a request inside D1's per-invocation query budget.

Answer: `{ revision, results: [{ id, outcome, message?, duplicate? }] }`:

| outcome | meaning | phone state |
| --- | --- | --- |
| `accepted` | recorded | `synced` |
| `review` | recorded or held; staff will check | `review` (message says why) |
| `rejected` | not recorded (invalid, or ineligible while the person is still there) | `rejected` |
| `retry` | transient (e.g. R2 unavailable) | stays `pending`, backs off |

- Events are processed **in the order sent**. The first `retry` stops the batch (later events answer `retry`), so a return is never processed before its borrow.
- A repeated id answers its stored outcome with `duplicate: true` and writes nothing. Each event's writes and its row are one atomic D1 batch; a concurrent copy loses on the primary key and reads as a duplicate.
- An unexpected error on one event is **held** for staff (`ERROR`, with a borrow's photo kept) instead of blocking the phone's queue forever. Only an unreachable database means `retry`.

**When the phone syncs** (`offline-sync.ts`, `self-service-app.ts`): on launch, when the connection returns, when the app comes back to the foreground, right after each new record, on **Sync now**, on a timer for the next backoff (5 s, 10 s, … up to 15 min), and through Background Sync where the browser has it (Chromium; the service worker runs the same `syncNow()` and asks the browser to try again while anything still waits). A Web Lock keeps the page and the service worker from sending at the same moment; the server is idempotent anyway.

## 7. Time

- The phone stamps `occurredAt` with its own clock and sends `sentAt` with each batch. The Worker computes `offset = received − sentAt` (both from the same phone clock), so **business time = occurredAt + offset**, capped at arrival. No earlier measurement is trusted.
- **Live** = sent within 2 minutes of being recorded (the person is still at the shelf). **Late** = anything else.
- Recorded after it was sent, or more than 30 days old → the clock cannot be trusted → **held** (`CLOCK`). A held borrow's return-by date is judged against the earliest day it could have happened, so it is held rather than refused.
- Movements and loans written by sync carry `created_at = business time`. History is ordered by `HISTORY_ORDER`: migrated rows keep their import order, then everything recorded in the Hub in the order it happened — never upload order. `julianday()` compares the migrated `+08:00` and the Hub's `Z` timestamps correctly.

## 8. Reconciliation rules

Self-service events are **physical facts**. The Worker preserves every valid event and never uses last-write-wins.

1. **Eligibility.** Live and ineligible → `rejected` with a clear message. Late and ineligible → **held** (`NOT_ELIGIBLE`, or `USC_ONLY` for an individual borrow of a USC-only item), never applied: claiming an earlier time can never unlock a staff-only item.
2. **Quantity never refuses a self-service event.** The phone keeps normal use within its estimate and warns when someone records more ("staff will be asked to recount"); the movement is posted anyway, because the item physically left. Staff stock movements keep their strict non-negative guard unchanged.
3. **Volume.** More than 30 self-service units of one item in an hour → further takes and borrows are **held** (`VOLUME`). This bounds what an abusive client can do to the records; staff apply or dismiss. The check reads before it writes, so two requests at the same instant can both pass it; the request limits (section 11) bound that.
4. **Counts are observations.** A physical count recorded more than 5 minutes after an event already saw its effect, so the event's movement is stored with status `SUPERSEDED` (kept as evidence, excluded from on-hand). This is decided **inside the INSERT** (`countAwareStatus()`), so a count saved a moment earlier is always seen. Within 5 minutes of a count → posted and flagged `COUNT_OVERLAP`.
5. **Negative stock is derived, not stored.** The staff view rebuilds each touched item's balance in business order from its last count (including the count's own balance, which a late take just before it can push below zero); if it went below zero, the item appears under **Count needed** until a count or a late return settles it. (A per-event flag would give false alarms: a late return can make the history valid again.)
6. **Linked return** (`loanEventId`): must name a borrow **this same phone** made, of the same item; otherwise it is refused (a return whose borrow was itself refused goes with it). **Every return needs a photo of the item** (refused without one) and **never changes stock by itself**: it is held as `RETURN_CHECK` with its photo, and the loan stays out until DOL staff confirm it on `/staff/self-service` (**Confirm returned** closes the loan and returns a good item to stock; **Not returned** leaves the loan out and deletes the photo). A borrow still held, a different quantity or an already closed loan is held for staff with its own reason (`RETURN_CONFLICT` etc.); a loan the desk already closed the same way needs nothing. Return holds are not counted against the per-network daily limit, because each is tied to a borrow this phone made.
7. **A return must name a borrow this same phone made.** The phone's Return screen lists only that phone's own open loans (no catalog search), and the Worker refuses any return without `loanEventId` ("Only something borrowed on this phone can be returned here. Return anything else at the Logistics desk."). Nothing is stored for a refused return. This keeps anyone from returning, or closing, a loan they did not make, and there is no matching by name or student ID, so nothing can be learned about other people's loans. A return of something borrowed at the desk, on another phone, or after the phone lost its data is recorded by staff in Loans.
8. **Photo.** A borrow without a valid photo is rejected (the phone saves them together, so a missing photo is never a real borrow). A held borrow keeps its photo in R2 so staff can still apply it; dismissing deletes it.

### Worked examples (all in `tests/self-service.test.ts`)

- **Consumable**: 20 water; phones −2, −1, −3 in all six arrival orders → 14, three movements.
- **Two phones, one scissors**: A borrows 10:00 / returns 10:30; B borrows 10:35 / returns 11:00; B syncs first → both borrows apply, both returns wait with their photos; each staff confirmation closes its loan, and once both are confirmed the balance is 1, history in business order, no alarm.
- **Overlapping loans that fit** (5 scissors, two borrowers) → no alarm. **Impossible overlap** (1 unit, two loans) → **Count needed**.
- **Late take before a count** → `SUPERSEDED`, on-hand unchanged.

### Staff actions (`/staff/self-service`)

- **Count needed**: open the item and count (clears itself).
- **Held take or borrow**: **Apply** (exactly as if it had been eligible, at its business time) or **Dismiss**. A borrow with no photo cannot be applied.
- **Return to match**: pick the open loan → **Match and close loan**, or **Dismiss**. With no open loan of that item, only **Dismiss** is offered.
- **Return to check** (`RETURN_CHECK`): the return's photo, who borrowed it and **Confirm returned · update stock** or **Not returned**.
- **Recorded · check** (`COUNT_OVERLAP`): **Mark checked** after a recount.

A resolution is final: a trigger (`self_service_events_resolved_final`) refuses any change to a resolved record, so when two staff act on one record at once the second batch rolls back whole and gets "Someone else resolved this a moment ago". A match whose loan was closed at the desk in between records nothing and says so. Dismiss deletes a held borrow's photo only after it actually resolved the record.

The Self-service nav tab counts the records to check.

## 9. Service worker, caching and updates

- `vite.config.ts` builds `src/sw.ts` as one classic script, `/sw.js`, with this build's version and file list baked in. Any change to the app changes `sw.js`, which is how installed phones learn there is an update. The Worker serves `/sw.js` with `no-cache` and `/assets/*` (content-hashed) as `immutable`.
- **Precached** under `logistics-shell-<version>`: the page, the scripts and styles of the public pages and the Self-Service screens (`OFFLINE_SCREENS` in `vite.config.ts`, with everything they import), WOFF2 fonts, the manifest, icons, brand marks and the campus photograph. Staff screens are not saved on phones. The version covers every file of the build, so any change still updates phones. Old versions are deleted only when the new one activates.
- **Navigations**: public pages open instantly from the cached page; `/staff*` goes to the network first (the Worker's session check still decides) and falls back to the cached page offline, which shows **This page needs a connection** with a link to Self-Service.
- **`/api/*` is never intercepted or cached.** Nothing personal ever enters Cache Storage.
- **Updates**: a new version installs in the background and waits. The app applies it when the person returns to a screen with nothing unsaved (home or My activity, no open sheet); otherwise the bar offers **Update**. Pending events live in IndexedDB, which updates never touch (the E2E deletes every cache mid-queue to prove it).

## 10. Install experience

- **Android / Chromium**: the app captures `beforeinstallprompt` and offers a real **Install** button; otherwise **How to install** shows the menu steps (all three current Chrome wordings).
- **iPhone / iPad**: detected (iPadOS by `Macintosh` + touch). **How to install** gives the current Safari steps (Share → View More → Add to Home Screen, Open as Web App on) and explains that offline recording works from the Home Screen app.
- The manifest has Take / Borrow / Return / My activity shortcuts (long-press the icon on Android).

## 11. Security and privacy

- Every event is untrusted: strict UUIDs and `ITM-` ids, whitelisted enums, quantity 1–30, text cleaned by `cleanText()` (control and invisible format characters such as bidi overrides removed, whitespace collapsed, length-limited), photos sniffed by their bytes (JPEG/PNG/WebP, ≤ 2 MB), item existence and type checked, duplicates ignored.
- `POST /api/self-service/sync` requires same-origin, a `Content-Length` of at most 12 MB, and passes rate limits before parsing (120 requests / 10 min per network) and after (300 records / 10 min per network, 100 per phone). A **network** is an IPv4 address or an IPv6 /64 (`networkOf()`), since one phone can use many IPv6 addresses. A `429` only makes the phone retry later.
- A network can leave at most **60 held records a day** for staff (`heldPerNetworkDay`); past that, new records that would need a staff check are refused with "please see Logistics staff", so a flood of made-up records cannot bury the review page. Unexpected-error holds are exempt.
- `client_tag` is an HMAC of the network under the session secret with its own domain label; without the secret no tag is stored. The address itself is never stored.
- A photo uploaded for a request that turns out to be a duplicate or is refused is deleted from R2 straight away.
- Self-service can never read loans, names or photos; photos stream only to signed-in staff (`private, no-store`). Output is always escaped (`html`\`\``).
- On the phone, personal data (the remembered name and student ID, pending records, photos) lives only in IndexedDB. Photos are deleted as soon as the server answers for their borrow. Settled history is forgotten after 30 days, and **Clear synced history** / **Forget my details** clear it sooner. Pending records and open loans are never forgotten.
- **Staff offline**: staff screens need a live session and never work offline; there are no offline credentials. Staff can use Self-Service like anyone else.
- **Retention on the server**: names on takes are kept for accountability like other records. A purge policy belongs to Part 6 (Admin + Hardening).

## 12. Failure recovery

| Situation | What happens |
| --- | --- |
| Offline or server unreachable | Records stay `pending`; the pill shows **Offline · N waiting**; sync resumes by itself. |
| Server busy (`429`) or error | The whole request backs off and retries. |
| R2 unavailable for a photo | That borrow answers `retry`; the batch stops so its return waits. |
| A bug makes one event fail | It is held for staff (`ERROR`); the rest of the phone's queue continues. |
| The phone's data is cleared before sync | Those records are lost (the guide warns about this). Anything already synced is safe. |
| A new version is deployed | Installed phones update on their next idle moment; queues are untouched. |

## 13. Limitations

- First use needs internet; iPhone offline use needs the Home Screen app.
- iOS has no Background Sync: records send while the app is open.
- Availability offline is an estimate; other phones' offline records cannot be known until they sync.
- A person could record a take without actually taking anything. Accountability is the name, the phone and network tags, the hourly volume hold and staff counts — not identity verification.
- A phone can only return what it borrowed itself. If a phone loses its data before returning, or something was borrowed at the desk or on another phone, staff record the return in Loans.
- The volume hold can be passed by simultaneous requests (see rule 3).

## 14. Tests

- `npm test`: `tests/self-service.test.ts` (Worker rules, security, reconciliation examples, and staff races staged with `meanwhile()`, which runs another actor just before the next D1 batch) and `tests/offline-queue.test.ts` (queue rules).
- `npm run test:browser:worker`: `tests/worker-browser/offline-self-service.spec.ts` opens the production build with its service worker on a real Worker + D1, goes offline with Playwright's network emulation, records a take, a borrow with a photo and a return across a reload and a wiped cache, checks the offline staff page, then syncs and checks D1, R2 and the phone's IndexedDB. It then marks every record unsent again (lost answers) and proves the resend changes nothing. Two more phones show every take counting in any sync order.

## 15. QR code

`public/qr/logistics-self-service.svg` / `.png` hold only `https://logistics.hausc.org/self-service` (QR version 4, error correction Q, 4-module quiet zone, black on white). `uv run scripts/generate-self-service-qr.py` regenerates them deterministically and proves them with two decoders, including a blurred 300 px copy. Staff print the poster from **Self-service → QR code & poster**.

## 16. Design: "Dusk"

Self-Service keeps the Hub's institutional language (crest and mark, oxblood and gold, Newsreader over IBM Plex) in an after-hours key, at Earl's request (2026-09-29). Everything is scoped to `.is-self-service`: the tokens at the top of `self-service.css` re-theme the shared components, and nothing outside Self-Service changes.

- Part 4.6 flattened it ("Flat dark"): no aurora, grain, frosted glass, gradients or glows. Surfaces are solid; Take and Borrow tiles carry the brand colour; the primary button is flat gold on dark and oxblood on light.
- Part 4.7 added a light theme (Earl, 2026-09-30, "a light and dark animated option"). A sun/moon switch in the app bar flips `body[data-theme]`; dark stays the default and each phone keeps its choice in `localStorage` (`ss-theme`), so a phone that cannot store it falls back to dark next visit. The token block in `self-service.css` holds the light values on `.is-self-service` and overrides them under `[data-theme="dark"]`; components read only role tokens (`--accent`, `--primary`, `--action`). The new theme spreads as a circle from the switch through the View Transitions API; with reduced motion or no support it swaps instantly. `theme-color` follows the theme.
- Part 4.8 brought the campus photograph back behind the top of home (Earl, 2026-09-30), in both themes. `--photo-wash` fades it into the canvas and dims it under the bar and greeting: a night wash in dark, a paper wash in light, measured at AA or better at 320, 390 and 820 px. On home the bar sits on the photograph and scrolls away with it; other screens keep the solid sticky bar. The sun/moon switch matches the sync pill beside it.
- The only other motion is the sheet opening and closing and the sync spinner, behind `prefers-reduced-motion: no-preference`; hover states are behind `hover: hover`.
- Accessibility: buttons draw focus as a gold outline that their shadows cannot override; targets are at least 44 px; the tiles reflow to one column for large text; the first invalid field takes focus; low stock is said in words ("Only 2 left"), not only colour.
