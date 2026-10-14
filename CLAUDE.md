# Claude Code — Logistics Hub (current operating instructions)

**Current and authoritative.** This file intentionally contains no historical Road-to-V2 branch runner or forward-propagation instructions.

## Required entry sequence

1. Read `AGENTS.md` and follow its authority order.
2. Read `.agents/PROJECT_POLICY.md`, `.codex/CURRENT.md`, `.codex/SESSION_HANDOFF.md` and `docs/SHARED_AGENT_WORKFLOW.md`.
3. Read the **active accepted** specification/amendment, verified repository state, release record, and task-specific policies. If any source conflicts, resolve by the repository authority chain; don't use an older chat, stale plan or superseded proposal as permission.
4. Before implementation, verify the accepted UI slice, approved file allowlist, separate Claude worktree and branch, both lane states, and per-worktree lock. The owner-approved two-lane exception permits a separate Claude UI slice from main; without its accepted file ownership and integration plan, stay read-only. See `docs/specs/accepted/2026-10-14-isolated-agent-worktrees.md`.

## Active release boundary — 2026-10-11

- **V1.15 is historically closed.** Do not restart the old Road-to-V2 branch runner. Completed releases V1.1–V1.15, previous migrations and production operations remain auditable under `docs/road-to-v2/releases/` and `docs/specs/accepted/`.
- **V1.16 Ambient Assist + Intelligent Core has five independently delivered capabilities, but the full release is OPEN.** The sole active source of detailed scope is `docs/specs/accepted/v1.16-ambient-intelligent-core.md` and its execution card `docs/road-to-v2/v1.16-execution-card.md`. Its completion and deployed confirmation are required before declaring final V2 readiness for the V3 roadmap.
- **V3 roadmap:** V2.1–V2.9 (stable internal aliases RTV3-01–RTV3-09), then V3.0. For `start/continue RTV` and `start/continue V2.x`, use only `docs/road-to-v3/00_COORDINATOR_CARD.md` and its gates. V2.1/F4 reuses the product-version/changelog implementation from completed V1.16, never duplicates it.
- **Automatic version revisions:** `docs/PRODUCT_VERSION_GOVERNANCE.md` is mandatory. A completed main release `Vx.xx` followed by a separately merged verified product change becomes `Vx.xx.1`, `Vx.xx.2`, etc. Count independently released changes, not checkpoints. Do not invent historical patch versions or mark an unreleased version complete.

## Permanent engineering and release rules

- Default is one implementation writer and one slice. The owner-approved two-lane exception allows Codex on V1.16 and Claude on an independently accepted UI slice, in separate writable worktrees with disjoint files and per-worktree locks (maximum two writers account-wide). Checkpoint to each assigned branch; never edit the other lane's paths or the shared `.codex` pointers. Only the steward merges complete qualified PRs, one at a time, after current-base checks and production preflight. Incomplete work stays off main.
- Never deliver or describe an incomplete version as a finished product. Required correctness/security/denial/performance/browser checks, production preflight, backups, rollback and owner gates are not waived by the words `start`, `finish` or `continue`.
- D1 structured business truth, R2 governed media, movement-derived stock, server-enforced permissions, append-only audit, safe offline recovery and deterministic-first intelligent features are invariant. Ambient AI is optional and must not block core work or receive forbidden private data.
- Avoid new speculative dependencies, duplicate caches/registries, obsolete execution paths or a second source of truth. Design for one-person operations, usable phones, accessible interaction and concise staff-facing copy.
- Record exact branch/HEAD, completed versus incomplete work, meaningful test evidence, next action and named writer in `.codex/SESSION_HANDOFF.md` before yielding.
- Production and migration work follows `docs/DEPLOYMENT.md`, `docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`, `ops/releases/` and the protected operations lane. No bypass by older Road-to-V2 instructions.

## Historical material

The removed legacy instructions are retained in Git history at [the pre-cleanup `CLAUDE.md`](https://github.com/invicta-ctrl/logistics-hub/blob/aa09900827a94e0931a33416f70c3ae4c7e6bcf9/CLAUDE.md). Historical instructions do **not** govern new work. See `docs/DOCUMENTATION_STATUS.md` for the documentation authority map.
