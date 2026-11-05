# Claude Code — Logistics Hub (current operating instructions)

**Current and authoritative.** This file intentionally contains no historical Road-to-V2 branch runner or forward-propagation instructions.

**Current owner rules (2026-11-04, 2026-11-05):** `AGENTS.md` controls writer custody, repository self-sufficiency and the mandatory **agent-operated pre-main security review**. Claude is the only implementation writer and the one integration steward: one writer by default, and **at most two** on separate accepted disjoint tasks in isolated worktrees under [HAU-AGENT-LANES-003](docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md) (inactive until that spec is merged and two task manifests exist). ChatGPT audits, reviews and may make explicitly owner-authorized, scoped repository edits; Codex and Forge remain read-only. HAU-AGENT-LANES-002 (Codex + Claude) is history.

## Required entry sequence

1. Read `AGENTS.md` and follow its authority order.
2. Read `.agents/PROJECT_POLICY.md`, `.codex/CURRENT.md`, `.codex/SESSION_HANDOFF.md` and `docs/SHARED_AGENT_WORKFLOW.md`.
3. Read the **active accepted** specification/amendment, verified repository state, release record, and task-specific policies. If any source conflicts, resolve by the repository authority chain; don't use an older chat, stale plan or superseded proposal as permission.
4. Before writing, verify the active accepted slice, exact branch/HEAD, your writer slot in the steward's live roster (snapshot: `.codex/CURRENT.md`, "Writer slots"), your writer lock and your file ownership. Preserve every active branch and uncommitted work. Never become a third writer; a temporary ChatGPT policy-only branch requires Earl's scoped authorization and serial integration.

## Active release boundary — 2026-10-11

- **V1.15 is historically closed.** Do not restart the old Road-to-V2 branch runner. Completed releases V1.1–V1.15, previous migrations and production operations remain auditable under `docs/road-to-v2/releases/` and `docs/specs/accepted/`.
- **V1.16 Ambient Assist + Intelligent Core has five independently delivered capabilities, but the full release is OPEN.** The sole active source of detailed scope is `docs/specs/accepted/v1.16-ambient-intelligent-core.md` and its execution card `docs/road-to-v2/v1.16-execution-card.md`. Its completion and deployed confirmation are required before declaring final V2 readiness for the V3 roadmap.
- **V3 roadmap:** V2.1–V2.9 (stable internal aliases RTV3-01–RTV3-09), then V3.0. For `start/continue RTV` and `start/continue V2.x`, use only `docs/road-to-v3/00_COORDINATOR_CARD.md` and its gates. V2.1/F4 reuses the product-version/changelog implementation from completed V1.16, never duplicates it.
- **Automatic version revisions:** `docs/PRODUCT_VERSION_GOVERNANCE.md` is mandatory. A completed main release `Vx.xx` followed by a separately merged verified product change becomes `Vx.xx.1`, `Vx.xx.2`, etc. Count independently released changes, not checkpoints. Do not invent historical patch versions or mark an unreleased version complete.

## Permanent engineering and release rules

- **Changelog is mandatory:** Apply the single rule in `AGENTS.md` and update the root `CHANGELOG.md` for every qualified version/revision and accepted specification amendment. Each entry identifies what changed, why, its release/spec authority and relevant verification; an accepted spec update is recorded separately from a deployed product version. In a parallel lane, include the proposed entry in Claude's PR/handoff and let the integration steward update the shared file. Never invent a released version or treat an intermediate checkpoint as one.

- Writers: Claude only, one by default and at most two under HAU-AGENT-LANES-003, each with an accepted bounded slice, an owned-path allowlist, its own branch, worktree and lock, and isolated ports and test state; one serial integration steward. The steward alone edits the shared governance files listed in `AGENTS.md`. ChatGPT may author only an expressly owner-authorized bounded change that overlaps no writer. Codex/Forge are read-only. Keep incomplete work off `main`.
- A merge is not a deployment: say `MERGED_DEPLOYMENT_UNVERIFIED`, `DEPLOYED_OWNER_CHECK_PENDING` or `RELEASED_VERIFIED`, and only on verified evidence. A request to prepare a PR is not a go-ahead to merge it; merging needs Earl's explicit word for that PR.
- Open every PR from `.github/pull_request_template.md`, with each gate marked PASS, FAIL, N/A or NOT RUN. Keep the repository self-sufficient (`AGENTS.md`, "Repository self-sufficiency"): archive, do not delete, and leave a fresh clone able to find the task, the SHA, the writers, the gates and the next action.
- Never deliver or describe an incomplete version as a finished product. Required correctness/security/denial/performance/browser checks, production preflight, backups, rollback and owner gates are not waived by the words `start`, `finish` or `continue`.
- D1 structured business truth, R2 governed media, movement-derived stock, server-enforced permissions, append-only audit, safe offline recovery and deterministic-first intelligent features are invariant. Ambient AI is optional and must not block core work or receive forbidden private data.
- Avoid new speculative dependencies, duplicate caches/registries, obsolete execution paths or a second source of truth. Design for one-person operations, usable phones, accessible interaction and concise staff-facing copy.
- Preserve and reconcile `.codex/CURRENT.md` and `.codex/SESSION_HANDOFF.md` as live task pointers. Only the active authorized writer/steward updates shared pointers, without overwriting another agent's state; record exact branch/HEAD, verification, blockers and next action before yielding.
- Production and migration work follows `docs/DEPLOYMENT.md`, `docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`, `ops/releases/` and the protected operations lane. No bypass by older Road-to-V2 instructions.

## Historical material

The removed legacy instructions are retained in Git history at [the pre-cleanup `CLAUDE.md`](https://github.com/invicta-ctrl/logistics-hub/blob/aa09900827a94e0931a33416f70c3ae4c7e6bcf9/CLAUDE.md). Historical instructions do **not** govern new work. See `docs/DOCUMENTATION_STATUS.md` for the documentation authority map.
