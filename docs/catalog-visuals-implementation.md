# Independent Catalog Visual System

STATUS: IMPLEMENTED AND VERIFIED LOCALLY; APPROVED PREPARATION RELEASE
INTEGRATION: FEATURE NOT PUSHED; PREPARATION PACKAGE READY
OWNER_ACTIONS: Configure the required Production environment protections if still absent. Migration 0026 has not been applied; feature deployment waits for READY_TO_MERGE.

## Authority and baseline

Earl authorized this independent update directly on main, with no new branch, and confirmed Claude had finished and yielded. Accepted scope: `docs/specs/accepted/2026-10-03-independent-catalog-visuals.md`. The cloud worktree was clean and safely fast-forwarded to main `8951c899bbd632c774ed37e134f5aa25abae961f` before taking the exposed Codex writer lock. V1.4 is already integrated (`540853e`); its production preparation and final outcome are recorded in `docs/road-to-v2/releases/v1.4.md`. Older CURRENT/handoff entries describing it as pending are historical.

Before integration, Claude's V1.4.1 follow-up arrived on main. Edits stopped when overlap was detected; the verified candidate was preserved. Earl then confirmed the new work had yielded. Main was safely fast-forwarded to `1913716da1f8e5b1a8c168996cbbb734b3c66bd1` (V1.4.1 integration `629bf3f`), then the candidate was reconciled without resetting or rewriting history. Claude's name/report/attention changes and applied `0025_location_report_reporter.sql` remain intact. The catalog draft was renumbered to 0026; the operations release-name check retains V1.4.1 support. All required local checks now pass on this combined baseline; no push has occurred.

V1.2's item media architecture is inherited, not rebuilt. No Claude commit or Road-to-V2 branch is changed. V1.2 remains complete; V1.4 stays intact. Successor branches take this foundation from main at their next authorized integration. This update starts no successor slice.

## User behavior and implementation

- Every catalog item gets a deterministic icon immediately; no backfill of icon assignments. Name and aliases match specific phrases before category, type and a package fallback.
- New-item and review forms show a live suggestion. Creating/importing an unknown item requires no icon selection. Creation can save an optional override.
- Item profiles offer System Icon, Real Photo, a searchable 63-icon picker and Use suggested icon. Selecting an icon retains a saved photograph; selecting/uploading a photograph retains the icon fallback.
- Staff Items, Lending Hub and Self-Service use fixed visual frames. Loading, missing, failed and offline photos reveal the bundled icon. The staff large-photo viewer also falls back to an icon on failure.
- Decorative SVGs and list photos do not repeat adjacent item names. Profile photos use the item name. Native buttons and search support keyboard selection and preserve existing focus treatment.

Important files: `src/item-icons.ts` (authoritative resolver and curated MIT Tabler SVG), `src/item-visual-control.ts` (profile choices), `src/item-visuals.ts` (authenticated/versioned metadata write), `src/ui.ts` and `src/item-visual.css` (shared frame/fallback), `src/item-photo.ts` (existing upload/viewer), `src/inventory.ts`, `src/self-service.ts`, `src/staff.ts`, `src/public.ts` and `src/self-service-app.ts` (DTOs and consumers). License: `licenses/TABLER.txt`, Tabler Icons v3.48.0. No dependency, AI artwork, icon CDN or external matching service was added.

## Coverage

| Verified source | Items | Specific | Category | Type | Generic |
|---|---:|---:|---:|---:|---:|
| Committed historical migration snapshot | 397 | 396 | 1 | 0 | 0 |
| Live signed-out Lending Hub, read-only on 2026-10-04 | 40 | 40 | 0 | 0 | 0 |

The only historical name without a specific match is **Straw**, which receives the kitchen utensils category icon. Current private inventory totals 549 in V1.4's production record; this session has no authenticated staff access or production credentials, so these counts do **not** describe all 549 current items. Every possible input still resolves to a bundled icon. A complete current coverage audit remains a signed-in/read-only follow-up; do not copy private inventory exports into this repository.

## Data, storage and security

`0026_item_visuals.sql` adds nullable `items.visual_type` and `items.icon_key`; NULL preserves photo preference and automatic suggestion. Only explicit choices are stored, as `tabler:<curated-key>`. No quantity, movement, loan, stock area, provenance, classification or location is changed. Migration rehearsal compares existing item fields, movements, places and media before/after.

Reuse private `CATALOG_MEDIA`, `item_media` and `items/<media-id>/display|thumb`; no new bucket or EVIDENCE prefix. Existing browser JPEG processing applies orientation, resizes and strips metadata; JPEG/PNG/WebP source uploads are limited to 20 MB. The Worker checks JPEG MIME and structure, strips unsafe metadata, bounds dimensions and stored sizes (display 1600 px/1 MB; thumb 480 px/150 KB), generates UUID object keys and never trusts filenames. Authenticated writes retain CSRF/session checks, media compare-and-swap and audit/revision gating. The current UI also sends the item version, preventing a delayed upload from overwriting a newer visual choice.

Public access remains the guarded 320 px thumbnail; full photos stay staff-only. Selecting System Icon hides the retained photo in both public DTOs and makes new public thumbnail requests return 404, including conditional requests. Staff can still access the retained photograph. Previously issued public thumbnails retain the existing one-hour browser cache bound. PWA shell/assets cache bundled icons; APIs are not cached and no new photo caching policy is introduced. Old catalog snapshots without icon metadata still compute suggestions.

## Production sequence — approved by Earl on 2026-10-04

Do not push feature code before 0026 is applied: the catalog reads its new columns. Workers Builds deploys pushes to main and does not run migrations. AGENTS and the accepted Cloud Operations amendment require production preparation through `.github/workflows/production-ops.yml`, the `production` environment and a reviewed manifest on main. Its tooling and release SHA must be fetchable on main. Earl approved the necessary exception to his single-push instruction after the candidate and preparation package passed verification ("I approve and finish this now").

The accepted sequence is two stages, both on main and without a new branch:

1. Push only the verified preparation files: migration 0026, `ops/releases/catalog-visuals.json`, the exact `catalog-visuals` slug allowed in the existing operations script, its documentation, and the historical locations migration fixture correction. The currently deployed V1.4.1 application ignores the nullable fields and continues to work. Do not include feature source files yet.
2. From GitHub Actions → Production operations on **main**, run release **catalog-visuals**, mode **preflight**, with that full preparation commit SHA. Require PREFLIGHT_OK. Then run **prepare**, same SHA, with exact confirmation `PREPARE catalog-visuals <full-sha>` and the normal environment approval. Require READY_TO_MERGE, an encrypted backup and Time Travel bookmark, exactly 0026 recorded, only `table:items` changed and all five reconciliation counts unchanged. No bucket creation is authorized. Never reapply 0015–0019 or prior migrations.
3. Re-fetch main, reconcile safely, re-run required gates as needed, commit/push the verified feature and check CI/deployment plus signed-out and signed-in catalog behavior. Record the operation runs, feature SHA and pushed main SHA here and in the handoff.

The sequence and only migration 0026 are owner-authorized. The resumed cloud session has authenticated GitHub CLI access; Cloudflare credentials remain solely in the existing workflow environment. Read-only inspection found the environment named `Production` has no required reviewers or deployment-branch restriction. Attempts to set the required owner reviewer and exact main branch policy returned HTTP 403 (Resource not accessible by integration); no setting changed. This is an integration permission limitation, not an owner-approval rejection. An owner/admin with environment-write permission must configure these protections before prepare. Do not remove them, bypass the lane or run migrations from the shell. A preparation push and read-only preflight can proceed; feature source waits for protected preparation to succeed.

Rollback: before deploying feature code, old V1.4.1 can run with the new nullable fields; leave them in place. After deploying, redeploy the old verified application without removing photo objects. Use the saved Time Travel bookmark only under owner-approved recovery, accounting for legitimate later writes. Do not delete uploaded photographs or reset inventory to undo presentation metadata.

## Verification and rendered review

| Command | Actual result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run build` | Passed (includes typecheck) |
| `npm test -- --reporter=dot` | 405 passed, 2 skipped (opt-in performance harnesses), combined V1.4.1 baseline |
| `npm run test:browser` | 71 passed on combined V1.4.1 baseline |
| `npm run test:browser:worker` | 36 passed on combined V1.4.1 baseline, including real PWA offline, auth, lending, media, public-photo preference and visual fallback flows |
| `npm run verify:catalog` | Passed, historical 397-item report |
| `npm run verify:migration` | Passed; existing one known migration parity discrepancy remains visible |
| `ACTIVITY_PERF=1 ACTIVITY_PERF_TIERS=1000 npx vitest run tests/activity-perf.test.ts` | 1 passed |
| `STOCK_ACTIVITY_PERF=1 STOCK_ACTIVITY_PERF_TIERS=1000 npx vitest run tests/stock-activity-perf.test.ts` | 1 passed |
| `npm run evidence -- --out docs/visual-research/catalog-visuals --base 8951c89 --pages items,item-profile,item-photos,public-photos,locations,catalog-visuals` | Completed baseline/candidate captures and performance comparison |
| `npm run evidence -- --out docs/visual-research/catalog-visuals/after --pages items,item-profile,public-photos,catalog-visuals` | Completed fresh V1.4.1 captures; representative desktop/phone states inspected |
| `npm run verify:privacy` | Passed on staged candidate: 479 files, zero secret or private roster matches |
| `npx wrangler deploy --dry-run` | Passed; no production mutation |
| `git diff --check` | Passed |

The first browser attempt required installation of the lockfile's current Chromium; stale fixture expectations for empty thumbnails and DTO keys were updated to assert icons. A concurrent evidence run caused two unrelated browser timeouts; the final complete browser rerun passed without modifying unrelated timing tests. The final complete Worker rerun passed after replacing the last old empty-thumbnail expectation with icon fallback assertions. After V1.4.1 reconciliation, an unrelated Ctrl-click tab assertion timed out while heavy verification overlapped; the complete browser rerun passed 71/71 without changing that test. Final unit and Worker runs include the retained-photo public-access checks. No failed run is counted as passing.

The exact preparation-only package was also rehearsed separately against the current V1.4.1 application: `npm run build` passed, `npm test -- --reporter=dot` passed 352 tests with 2 opt-in skips, and manifest loading verified the pinned 0026 hash plus existing V1.4.1 release support. No feature source was included in that rehearsal.

Focused coverage lives in `tests/item-icons.test.ts`, `tests/item-visuals.test.ts`, `tests/item-media.test.ts`, `tests/browser/app.spec.ts` and `tests/worker-browser/worker-visuals.spec.ts`. The complete candidate diff was reviewed, including schema/operations guards, DTO privacy, upload CAS and fallback/accessibility behavior. Starting main SHA is recorded above; no final/pushed feature SHA exists yet. The candidate remains staged so a separately approved preparation commit can precede the feature without rewriting history.

Actual desktop/phone Worker renders and baseline comparisons: `docs/visual-research/catalog-visuals.md`. Synthetic demo accounts and browser-drawn photo fixtures only; no real staff or borrower information appears in the evidence.
