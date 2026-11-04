# V1.16.7 durable loan-thumbnail retention amendment

STATUS: ACCEPTED narrow repair scope by Earl, 2026-11-03; implementation/rollout remains QUALIFICATION_PENDING.
PARENT: `docs/specs/accepted/2026-10-29-workspace-depth.md` (combined V1.16.7, slices 1–3).

## Invariant and scope

A staff browser may derive one small private JPEG thumbnail for a loan photo. Owner retention must irreversibly remove original and thumbnail image **contents**, including across a delayed upload, concurrent erasure, and D1/R2 failure. A photo still referenced by any eligible phone event or loan must remain. D1 is entitlement and operational truth; R2 is private evidence. No public image route, new provider, credentials, unrelated model changes or new background service.

## Durable R2 write fence and D1 journal

1. A thumbnail is written only by R2's atomic **create-if-absent** (`If-None-Match: *`) against the original `photo_key + '.thumb'`. If the object already exists, inspect it: an existing JPEG is kept, an erasure marker refuses the save, and unexpected metadata fails closed. Never use read-HEAD-then-unconditional-PUT.
2. When a photo key has **no record outside the selected due set retaining it**, record its key in an additive D1 `retention_photo_cleanup` journal before any R2 mutation. Retries and concurrent owner requests use the same unique key; do not mark complete until original deletion and irreversible thumbnail revocation both succeeded.
3. Revoke a thumbnail by **overwriting its R2 key with a zero-byte, non-image, private erasure marker**. Only after this succeeds delete the original image. The marker remains indefinitely: it must never be deleted by application code or bucket lifecycle. R2 conditional creation either wins first and is then overwritten, or loses to the marker and cannot recreate a JPEG. This holds even if the thumbnail never previously existed, and even across a Worker request delayed indefinitely.
4. The marker deliberately retains one *non-image* object per erased photo key. This is a tightly bounded exception to `docs/DATA_ARCHITECTURE.md`'s never-overwrite and delete-object-first rules, justified by durable revocation under concurrent R2 writes. The completed D1 journal is the marker's sole remaining reference; audit records remain immutable. Retention removes personal photo **bytes** rather than physically removing the thumbnail-key object. Do not claim zero R2 objects after erasure. This design tradeoff is documented for owner/reviewer qualification before release.
5. After successful R2 steps, in one D1 batch clear only still-due pinned identities, write exactly-once retention audit, bump revision when changed, and mark processed journal rows complete. Failure leaves original references due or journal PENDING, allowing idempotent retry even if selected due rows disappeared; next request drains bounded pending jobs.
6. Existing full-photo and thumbnail GET routes remain staff-authenticated; thumbnail GET must treat a marker as 404 and return valid JPEG with `Cache-Control: private, no-store`. The updated UI must use a distinct thumbnail URL variant to avoid previously cached 24-hour responses. No photo key from the client.

## Verification and release gates

- Deterministic tests force both commit orderings of conditional JPEG creation vs erasure marker, concurrent creates, marker persistence, legacy photos without thumbnail, and idempotent retries.
- Failure injections: D1 journal insert, R2 marker PUT, original DELETE, and D1 final audit/identity update; all recover with no sensitive orphan, no premature identity clearing, no repeated audit and preserved shared loan/phone references.
- Extend real-migration SQLite fixture and R2 mock with atomic conditional create, metadata and failure injection. This is not equivalent to a live D1/R2 concurrency claim.
- Confirm production R2 lifecycle cannot expire marker keys and no deployed unconditional thumbnail writer overlaps the first retention run; otherwise HOLD release, including any migration.
- Verify access-control/cache behavior, original and thumb responses, UI cache URL, normal regression suites, Worker E2E, browser/mobile/200%-text/a11y, privacy, performance and exact-head CI/CodeQL. Audit the Directory fix and outstanding V1.16.7 items.
- Production D1 migration, backup, rollback and reconciliation run only through the approved GitHub Cloud Operations `production` lane and pinned release manifest, never directly on a PC.
- **NO MERGE OR DEPLOY** until all release gates and required approvals pass. Record blocked/unrun gates truthfully.

## Owner checkpoint authorization — 2026-11-03 (later instruction)

Earl expressly waived the separate human-review step **for the current V1.16.7 checkpoint on `slice/v1.16.7-item-and-place-sheets`**. The active Codex Writer may make and push a fully diff-reviewed, security-checked commit through an actually authorized mechanism, without requesting Earl's personal review unless Earl asks or a consequential decision exceeds accepted scope. This supersedes this release's earlier human-reviewed-commit requirement only. It does **not** override an enforced tool or protected-file guard, authorize a workaround through another tool/identity/path, excuse tests/CI/CodeQL, or permit main merge, production migration, or deployment while any release gate remains open.
