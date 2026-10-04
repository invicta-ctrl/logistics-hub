# Independent Catalog Visual System

STATUS: ACCEPTED BY OWNER FOR IMPLEMENTATION
AUTHORITY: Earl's Catalog Visual System prompt and “Implement it now”; main-only exception, one coherent verified feature update, no new branch. On 2026-10-04 Earl explicitly approved the concrete two-stage main release and protected application of migration 0026 ("I approve and finish this now"). Earl confirmed Claude finished and yielded before implementation.
BASELINE: V1.4 on main (`8951c89`, code integration `540853e`). This is independent of Road to V2; V1.2 remains closed, and the roadmap order and later specs remain intact.
RECONCILIATION: Earl confirmed the new V1.4.1 work yielded; implementation now starts from main `1913716` and preserves its applied migration 0025. This update uses additive draft 0026.

## Accepted behavior

Every item has a bundled human-designed system icon. One deterministic resolver uses the name, aliases, specific keywords, category, type and a package fallback. Automatic suggestions require no per-item writes; creation/import cannot be blocked by a missing match. Staff can choose a curated Tabler icon, reset to automatic, upload a real item photograph or select a retained photograph. The selected photograph takes priority; its saved or automatic system icon remains the loading, error and offline fallback.

Use the existing V1.4 design, item photo processing, authorized routes and private `CATALOG_MEDIA` objects (`items/<media-id>/display|thumb`). Public catalogs use only the guarded 320 px thumbnail as accepted in the public-photo amendment. Keep location pictures, Where-is-it, evidence, staff IDs, inventory classification, source provenance and the stock/loan ledgers unchanged. No runtime icon service, AI artwork, framework or paid provider dependency.

## Durable metadata and rollout

`0026_item_visuals.sql` adds nullable `items.visual_type` and `items.icon_key`. NULL preserves existing photos and computes automatic icons; no bulk assignments. Overrides use validated `tabler:<key>` strings. Selecting an icon retains its photograph; uploading/selecting a photograph retains its icon fallback. Metadata edits are authenticated, audited, revisioned and guarded by the item edit version. The photo write keeps its media compare-and-swap and guards the item version when sent by the current UI.

Production application is separate authority: use the existing Cloud Operations lane with `ops/releases/catalog-visuals.json`, exact verified SHA, read-only preflight, encrypted backup, Time Travel bookmark and reconciliation. Never automatically apply production migrations. Earl approved the manifest-first exception after the feature and preparation-only package were verified: publish preparation on main, run the protected preflight/prepare for only 0026, then publish the feature. Required main-only deployment restrictions and a reviewer remain mandatory. Do not bypass the lane or push code that queries unapplied columns.

## Verification and continuity

Required: focused resolver/priority/create/upload/concurrency tests; full typecheck/build/unit/browser/Worker browser/privacy/catalog gates; additive migration rehearsal; rendered desktop and phone catalogs, profile icons/photos, picker, generic fallback, dark mode and failed/offline photographs. Inspect the complete diff and remote/writer state before commit and push. Completion evidence and exact SHAs belong in the independent implementation record; successors inherit the resolver and existing media pipeline from main rather than rebuilding them. Do not start or modify a successor branch as part of this update.
