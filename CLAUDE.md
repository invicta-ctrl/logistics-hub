# Claude Code — Logistics Hub (current operating instructions)

**Current and authoritative.** This file intentionally contains no historical Road-to-V2 branch runner or forward-propagation instructions.

## Required entry sequence

1. Read `AGENTS.md` and follow its authority order.
2. Read `.agents/PROJECT_POLICY.md`, `.codex/CURRENT.md`, `.codex/SESSION_HANDOFF.md` and `docs/SHARED_AGENT_WORKFLOW.md`.
3. Read the **active accepted** specification/amendment, verified repository state, release record, and task-specific policies. If any source conflicts, resolve by the repository authority chain; don't use an older chat, stale plan or superseded proposal as permission.
4. Before modifying source, verify current worktree, remote refs, uncommitted changes and exact writer lock; claim the sole writer lock according to the shared workflow. Never use a second writable branch or infer that a disconnected writer has yielded.

## Active release boundary — 2026-10-11

- **V1.15 is historically closed.** Do not restart the old Road-to-V2 branch runner. Completed releases V1.1–V1.15, previous migrations and production operations remain auditable under `docs/road-to-v2/releases/` and `docs/specs/accepted/`.
- **V1.16 Ambient Assist + Intelligent Core is owner-accepted but not yet an implemented release.** The sole active source of detailed scope is `docs/specs/accepted/v1.16-ambient-intelligent-core.md` and its execution card `docs/road-to-v2/v1.16-execution-card.md`. Its completion and deployed confirmation are required before declaring final V2 readiness for the V3 roadmap.
- **V3 roadmap:** V2.1–V2.9 (stable internal aliases RTV3-01–RTV3-09), then V3.0. For `start/continue RTV` and `start/continue V2.x`, use only `docs/road-to-v3/00_COORDINATOR_CARD.md` and its gates. V2.1/F4 reuses the product-version/changelog implementation from completed V1.16, never duplicates it.
- **Automatic version revisions:** `docs/PRODUCT_VERSION_GOVERNANCE.md` is mandatory. A completed main release `Vx.xx` followed by a separately merged verified product change becomes `Vx.xx.1`, `Vx.xx.2`, etc. Count independently released changes, not checkpoints. Do not invent historical patch versions or mark an unreleased version complete.

## Permanent engineering and release rules

- One active writer and one `slice/*` branch. Checkpoint each coherent working increment to the active branch; on passing independent acceptance and exact-head CI, merge the complete slice promptly to updated `main`, verify configured deployment and prune only confirmed-integrated refs. Incomplete functionality stays off main and is reported truthfully.
- Never deliver or describe an incomplete version as a finished product. Required correctness/security/denial/performance/browser checks, production preflight, backups, rollback and owner gates are not waived by the words `start`, `finish` or `continue`.
- D1 structured business truth, R2 governed media, movement-derived stock, server-enforced permissions, append-only audit, safe offline recovery and deterministic-first intelligent features are invariant. Ambient AI is optional and must not block core work or receive forbidden private data.
- Avoid new speculative dependencies, duplicate caches/registries, obsolete execution paths or a second source of truth. Design for one-person operations, usable phones, accessible interaction and concise staff-facing copy.
- Record exact branch/HEAD, completed versus incomplete work, meaningful test evidence, next action and named writer in `.codex/SESSION_HANDOFF.md` before yielding.
- Production and migration work follows `docs/DEPLOYMENT.md`, `docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`, `ops/releases/` and the protected operations lane. No bypass by older Road-to-V2 instructions.

## Historical material

The removed legacy instructions are retained in Git history at [the pre-cleanup `CLAUDE.md`](https://github.com/invicta-ctrl/logistics-hub/blob/aa09900827a94e0931a33416f70c3ae4c7e6bcf9/CLAUDE.md). Historical instructions do **not** govern new work. See `docs/DOCUMENTATION_STATUS.md` for the documentation authority map.
