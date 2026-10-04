# Data architecture — Logistics Hub

STATUS: ACTIVE DOCTRINE (Earl, 2026-10-03). Applies to `main` and every Road-to-V2 slice unless an accepted spec overrides a rule.
It describes the architecture that exists and the rules for extending it. It is not a replacement design.

## The three invariants

1. **D1 is structured operational truth.** Every fact the Hub acts on (an item, a loan, who did what) is a D1 row.
2. **R2 is governed file storage.** Photos and scans live in R2; D1 holds the only reference to each object. R2 is never listed or read to discover business facts.
3. **Quantity is derived from the append-only movement ledger.** On hand is the sum of POSTED `inventory_movements`. No table stores a current quantity.

## Where each kind of truth lives

Extend these concepts. Do not build a renamed parallel system beside one of them.

| Concept | Authority | Notes |
|---|---|---|
| Catalog | `items` | One row per item. Edits write an `ITEM_UPDATED` row to `audit_log` in the same batch. `catalog_revision` is a change counter clients poll, not data. Where an item is kept is `items.location_id` (V1.4); `items.storage_location` is the text typed before V1.4, kept as migration evidence and never read or written again. |
| Quantity | `inventory_movements` (+ view `inventory_balances`) | Triggers refuse UPDATE and DELETE (0009). A correction is a new movement. `idempotency_key` is unique when present. `legacy_reported_*` columns on `items` are migration evidence and never enter arithmetic. |
| Lending | `loans` | One loan per item lent, tied to its `LOAN_OUT` movement; only a good return writes `LOAN_RETURN`. The handover photo is in R2 (`photo_key`). |
| Phone Self-Service | `self_service_events` | The idempotency record and the staff review queue. What an event changed lives in `inventory_movements` / `loans`. A resolved record is final except for retention erasure (0019 trigger). |
| Open units | `open_units` | Which outer units are open. Never a quantity; database triggers keep open units ≤ on hand (0017). |
| Restock plan | `reorders` | A plan, never stock. At most one open entry per item (partial unique index). |
| Authorized DOL staff | `staff_users` | Who is DOL staff and may be given access (department, committee, active, whether sign-in is allowed). Filled privately from the DOL roster by `scripts/build-private-staff-seed.mjs`; the roster never enters Git. No live code reads it yet. |
| Sign-in | `staff_accounts`, `staff_sessions`, `owner_recovery_keys`, `auth_throttle` | Login identity only: username, password, role. An account belongs to an authorized staff member through `staff_accounts.staff_user_id`, set explicitly, never inferred from names (0009). |
| Accountability | `audit_log` | Who changed what, for catalog, accounts, settings and retention. Append-only: triggers refuse UPDATE and DELETE (0022). Movements, loans and phone events are their own history; the Activity feed reads all of them (`src/activity.ts`). |
| Settings | `system_settings` | One row per setting, each change audited. Add a key with a CHECK on its allowed values. |
| Item photos | `item_media` | One primary photo per item; the row is the only reference to its R2 objects. |
| Locations (V1.4) | `locations`, view `location_paths`, `items.location_id` | The places items are kept, as a hierarchy of at most five levels (`parent_id`), each with plain-language `directions`, a `visibility` (staff only, or shared with Self-Service), at most one reference picture (`media_id`, shared by every item kept there) and `active`. The view gives every place its full path, depth and whether Self-Service may show it (it and every place above it is active and shared). Migration 0024 made one place per distinct typed value and linked items by that exact value; look-alikes (`Cabinet 1`, `cabinet 1`) stay separate until staff combine them with Move items. |
| Location reports (V1.4) | `location_reports` | "I can’t find it" and "Location looks wrong", from staff or a phone (a phone's report carries the name it gave, `reporter_name`, added by 0025): an attention signal and an audit record that never changes stock or an item's place. Written once, resolved once with a note, never edited or removed (triggers). |
| Checks of a place (V1.7) | `location_audits`, `location_audit_observations`, `location_audit_resolutions` | One staff member checking what should be at a place and the places inside it (one open check per place). Observations are append-only, keyed by the device's request id, and never change stock, a place or an item; each keeps the on-hand figure the device showed and the server's on arrival. A finding is settled once, after the check is finished, through what already guards that change (a `COUNT_ADJUSTMENT` movement keyed `audit-<observation>`, the bulk Move, a location report, or a reasoned no-change); the resolution names what it wrote. "Last seen at its place", "last checked" and "finding to settle" are derived from these rows and the ledger, never stored. Triggers refuse edits and removals (0028). |
| Staff directory (V1.3) | `staff_directory`, `staff_id_cards` | Who a person is in the USC: one row per person (`PER-` id, department code, officer status beside it, optional unique student ID, unique `source_key` for imported scans). A link to a sign-in is the explicit, audited `account_id`. A card row is the only reference to that person's two ID scans in R2. |
| Legacy evidence | `reservations`, `legacy_access_accounts` | Migrated as found and kept for reconciliation. Live code does not read them; nothing new should write them. |

Authorized staff (`staff_users`) and the USC Staff Directory (V1.3) are different concepts and stay separate (Earl, 2026-10-03): the roster says who is DOL staff and may hold access; the directory is for looking people up and tracking their usage, and grants nothing. Neither replaces the other.

## Integrity is enforced by the database

Application checks are for good messages; the database is the backstop every writer meets, including a second Worker racing the first.

- Append-only and finality triggers: `inventory_movements_no_update/_no_delete`, `audit_log_no_update/_no_delete`, `self_service_events_resolved_final`, `open_units_closed_final`, `open_units_kept`, and for checks of a place (0028) `location_audit_observations_no_update/_no_delete/_open`, `location_audit_resolutions_no_update/_no_delete`, `location_audits_finished_final`, `location_audits_kept`. SQLite's `INSERT OR REPLACE` gets past a delete trigger, so nothing writes the append-only tables with it (a test checks the source); `INSERT OR IGNORE` stays the way to make an audit write idempotent.
- Cross-table invariants as triggers: `open_units_within_stock`, `movements_within_open_units`, `items_keep_open_units`, and `staff_accounts_keep_owner` / `_on_delete` (the last active Owner is never removed, 0023); for places (0024) `locations_no_cycle`, `locations_parent_active_*`, `locations_children_active` and `items_location_active_*` (no loop, no active place under an inactive one, no item kept in an inactive place), and `location_reports_no_delete` / `_resolve_only`.
- Uniqueness as partial indexes: one live owner recovery key, one open reorder per item, one idempotency key per movement.
- CHECK constraints for every closed vocabulary (roles, statuses, purposes, setting values) and for coupled columns (`(status = 'OUT') = (closed_at IS NULL)`).
- Multi-statement writes go in one `db.batch` (atomic on D1). Writes that must happen once carry an idempotency key, and a retry returns the first result.

## R2 boundary

| Binding | Bucket | Holds | Keys | Who can read |
|---|---|---|---|---|
| `EVIDENCE` | `logistics-hub-evidence` | Loan handover photos, held phone-borrow photos | `loans/<loan id>`, held photo keys recorded on the phone event | Signed-in staff only |
| `CATALOG_MEDIA` | `logistics-hub-catalog-media` | Item photos and place pictures (display and thumbnail) | `items/<media id>/display`, `items/<media id>/thumb`; `locations/<media id>/display`, `locations/<media id>/thumb` | Staff; the public sees thumbnails of publicly listed items only, and a place's picture (both sizes) only while staff share that place with Self-Service and Self-Service is open |
| `STAFF_IDS` | `logistics-hub-staff-ids` | Official USC ID scans, front and back (V1.3) | `ids/<media id>/front`, `ids/<media id>/back` | Administrators and the owner, each opening audited; only the owner adds, replaces or removes |

Rules:
- **One bucket per privacy class**, each with its own binding, so a defect in one media route cannot reach another class. New private material gets its own bucket (as V1.3's staff ID scans did); it never shares one of the above.
- **D1 holds the only reference.** A route serves an object only after finding its key in a D1 row the caller may see. Object keys are never accepted from the client.
- **Write order.** Upload to R2 first, then write the D1 row in a batch; if the batch fails, delete the object. Erasure goes the other way: delete objects first, then clear the reference, so a retry finishes the job and nothing is orphaned (`src/retention.ts`).
- **Never overwrite in place.** A replacement gets a new key (`item_media.media_id`), so a cached or in-flight copy is never silently changed.
- **No listing on user paths.** Hardening exercises may list a bucket to find orphans; requests never do.
- Creating a bucket in production is an owner action through the Cloud Operations lane (`ops/releases/<release>.json`).

## Migrations

- **Additive and numbered.** One series, `NNNN_snake_case.sql`, numbered 0001 upwards with no repeat. A slice branch that is not yet on `main` renumbers its migrations when `main` gains one first, unless production already applied them. The only gap allowed is a number a release manifest pins whose file is still on its release branch (`main` carried `0022` while V1.3's `0021`, already applied to production, waited to integrate).
- **Never edit an applied migration.** Production never re-runs it, so an edit only makes fresh databases (tests, local, a restore) differ from production. `tests/migration-history.test.ts` pins every applied migration and every migration a release manifest pins; `.gitattributes` keeps their bytes identical on every checkout.
- **Old code must survive the new schema.** Production is migrated before the code that needs the change is deployed, so the code already live must keep working on the migrated database: add tables, columns with defaults, indexes and triggers; do not rename or remove what live code reads.
- **Rebuilding a table** (only to change a CHECK, which SQLite cannot alter): copy every row, recreate every index and trigger, and test the migration on a populated database, as `tests/migration-sql.test.ts` does for 0011 and 0017.
- **Production only through the lane.** Applying a migration to production is an owner action through `.github/workflows/production-ops.yml`, with backup, pinned hash and verification (`docs/DEPLOYMENT.md`, "Cloud Operations"). Never from a PC, never on a push.

## Read paths: measure before adding state

`docs/PERFORMANCE_RELIABILITY_DOCTRINE.md` owns the rules for queries, indexes, pagination, caching and the resource budget. For the data model the short version is: a bounded query, the right index and a verified query plan come before any new state; a cached or materialized read model is added only when those are measured and insufficient, and then it is explicitly non-authoritative, rebuildable from D1 truth and never written by a user action as if it were the record. `docs/ACTIVITY_PERF.md` is the worked example of the evidence an index needs.

## Patterns kept from the legacy HAU-USC system, and what stays out

Borrowed, where they earn their place:
- Feature boundaries: one module per domain (`src/loans.ts`, `src/open-units.ts`, …), with the Worker routing to plain functions.
- Provider adapters at the edge only: D1 and R2 are used directly through their bindings; tests swap in `tests/d1-sqlite.ts`.
- Deterministic, user-readable errors (`InputError` with a status, never a stack). The Worker calls no outside service today; one that does (an importer reading Google Drive, say) gets a timeout and a bounded retry, runs outside the request path where it can, and never becomes runtime truth.
- Source fingerprints and checksums for anything imported or applied (release manifests, migration pins, import preflights).
- Idempotency keys on every retried write.
- Explicit capability checks per role, tested as a matrix (`tests/access.test.ts`).
- Structured diagnostics through Workers observability, without PII.
- Isolated end-to-end tests: each run gets a throwaway local Worker and D1 (`scripts/run-worker-browser-tests.mjs`).
- Static security analysis (`.github/workflows/codeql.yml`).

Not restored: React, MUI, Radix, Apps Script, Sheets as operational truth, repository/service layers, dependency injection, generic factories, duplicated pipelines, or infrastructure for a need nobody has measured.

## Pending production steps

- `0028_location_audits.sql` (V1.7) is additive: three new tables, their indexes and triggers; no existing table or row changes. It applies with the V1.7 release manifest (`ops/releases/v1.7.json`) before V1.7 merges. The code live before it never reads the new tables.

- `0024_locations.sql` (V1.4) is additive and applies with the V1.4 release manifest, after `0022` and `0023`. It creates one place per distinct typed storage value, links items by that exact value and writes one `LOCATIONS_RECONCILED` audit entry with the counts. It changes no quantity, no typed value and no `updated_at`. The code live before it keeps working on the migrated database: it still reads `items.storage_location`, which is untouched.
- `0022_audit_log_append_only.sql` and `0023_last_active_owner.sql` are on `main` but not yet applied to production. The lane applies only migrations a release manifest pins, so the next release that runs it (V1.4, unless another comes first) pins both beside its own. Nothing depends on them meanwhile: they only add triggers, and until `0023` is applied the Worker's own check still refuses the last Owner outside a race.
