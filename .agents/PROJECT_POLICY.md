# Logistics Hub Project Policy

STATUS: ACTIVE
AUTHORITATIVE_REPOSITORY: invicta-ctrl/logistics-hub

## Product boundary

This repo supersedes the prior HAU-USC Logistics Management System for new development.

Public now: retained/ported YDD landing, Lending Hub, Staff Login. Logistics Request is unavailable.
Staff priority: Inventory/Catalog -> Stock/Pantry -> Lending -> Activity/Audit -> Admin/Hardening.

## Technical direction

- Semantic HTML5, modern CSS, TypeScript/small JS modules.
- Cloudflare Worker + D1 + R2.
- No React/SPA framework unless a later accepted amendment proves a concrete need.
- Prefer platform capabilities over dependencies.
- D1 is structured operational truth.
- R2 is governed evidence/file storage.
- Stock is derived from append-only movements.
- Staff/borrower PII never enters public Git.

## Simplicity / anti-bloat

Every change must be the smallest durable solution that satisfies the accepted slice.

Do:
- reuse existing code before adding a new abstraction;
- keep functions/modules narrowly purposeful;
- delete obsolete/replaced code in the same slice;
- keep configuration and documentation authoritative and non-duplicative;
- add dependencies only when the platform/current stack cannot solve the problem cleanly;
- write comments for invariants or non-obvious reasons, not line-by-line narration;
- write tests for meaningful behavior and regressions, not duplicate coverage;
- prefer direct readable code over generic frameworks, registries, factories, wrappers, or future hooks.

Do not add:
- speculative features;
- unused extension points;
- duplicate helpers;
- duplicate configs/docs;
- compatibility layers with no current consumer;
- agent-specific implementations of the same feature;
- placeholder architecture for future Parts.

If a slice replaces an older path, remove the dead path once migration/verification is green.

## Git / branch policy

Keep Git boring.

Allowed normal branches:
1. `main` — latest verified working product.
2. Exactly one active short-lived slice branch, named `slice/<part>-<scope>`.

No permanent `dev`, `staging`, `backup`, model-specific, agent-specific, or duplicate feature branches.

Both Codex and Claude work on the SAME active slice branch and SAME shared worktree, one writer at a time.

**Cross-project concurrency (owner-approved 2026-10-14):** Codex and Claude may run separately authorized implementation sessions at the same time on different authoritative projects, up to two writers account-wide, only if project ownership and mutable resources are isolated. The whole Logistics Hub (including UI, API, submodules, alternate repos, branches and worktrees) counts as **one project**: its frontend and V1.16 release work cannot have simultaneous code/configuration writers. Read-only UI audits, research and specifications may proceed in parallel. Shared databases, provider settings, files, release controls or dependencies across different projects require serialized writes. Do not change this project's one-writable-worktree, one-slice, writer-lock, CI, release or production gates. Account-wide source: Context Vault `governance/agents/specs/CROSS-PROJECT-CONCURRENCY-001.md`.

### Slice lifecycle

1. Start the slice from current `main`.
2. Work in small coherent increments.
3. Commit each completed/working atomic increment on the active slice branch.
4. Do not commit broken states to `main`.
5. When the slice acceptance criteria and required gates are green:
   - update current/handoff docs;
   - rebase/fast-forward safely onto latest `main` if needed;
   - merge/fast-forward the finished slice into `main`;
   - push `main`;
   - delete the merged slice branch locally and remotely;
   - run `git fetch --prune`.
6. Only then create the next slice branch from fresh `main`.

Prefer linear history. Avoid merge bubbles when a safe fast-forward or rebase is possible.

Never delete an unmerged branch until unique commits are checked and its work is explicitly obsolete.

Temporary exception, accepted 2026-10-02 (`docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`): one branch, `ops/cloud-production-runner`, may exist beside the frozen V1.2 branch to build the Cloud Operations lane. It is merged to `main` and deleted before V1.2 is integrated; the budget above is unchanged afterwards.

## Automatic post-release revision identity — owner mandate (2026-10-11)

The single normative procedure is `docs/PRODUCT_VERSION_GOVERNANCE.md`; AGENTS.md, CLAUDE.md and shared handoffs must enforce it. A main product release is `Vx.xx`. After it has actually merged, **each new independently complete, tested, merged product-affecting fix or improvement** to that release is `Vx.xx.1`, then `Vx.xx.2`, `Vx.xx.3` and so on. One verified merge/release equals one increment, regardless of checkpoint count; separately merged fixes count separately. Documentation-only changes, failed attempts and incomplete slices do not increment. A future unreleased main version is not eligible for patch numbering.

Before integration determine the candidate from the highest **verified** patch of the targeted release line, reconcile current main/deployed state and any in-flight work, and verify no duplicate identifier. Document each release and its user-facing changelog; when the accepted Administration version display exists, show only the verified running build's version and revision notes. Missing or contradictory release evidence is UNKNOWN and must be resolved, never guessed. A version number never authorizes otherwise restricted implementation, production writes or unsafe merges.

## Shared-agent execution

Authoritative local worktree:

`D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`

Exactly one active writer at a time. The active agent must claim the local writer lock before editing and yield it before the next agent writes.

The accepted MausBot multi-worktree amendment permits detached, read-only specialist worktrees for Scout, Oracle, Sentinel, and Harbor while keeping the existing Logistics Hub shared worktree as the sole writable/local-preview worktree. These detached worktrees do not create branches and do not change the branch budget. Forge is the normal MausBot writer and must use the writable worktree and writer lock.

The handoff file `.codex/SESSION_HANDOFF.md` is mandatory.

When usage is near its limit:
- at ~25% or any imminent-limit warning: stop starting large work and enter handoff mode;
- at ~15%: no new implementation; only verify, checkpoint, document, and yield.

Prefer a small safe checkpoint commit over leaving a large undocumented dirty diff.

## Slice completion gates

Use only gates relevant to the slice, but never skip correctness/security gates.

Baseline:
- typecheck;
- focused unit tests;
- build;
- privacy/secret scan;
- migration/data verification when data changes;
- browser/E2E for user-visible flows;
- final diff review.

A green slice is merged to `main` immediately. A partially working slice stays off `main`.

### Owner's explicit completion and checkpoint contract (2026-10-11)

- Under **no circumstance** claim or present an unfinished version, broken workflow, or incomplete product as finished. State unresolved work accurately in the active-branch handoff, not in a false release claim.
- Push each coherent, reviewed, working checkpoint to the one active slice branch, after focused verification; preserve exact commits and next action. Do not leave useful safe progress invisible to the shared worktree.
- Merge **every independently complete and verified slice** into updated `main` as soon as it meets its own accepted acceptance criteria and exact-head checks, verify production/build and prune only confirmed-integrated slice branches. Subsequent slices branch from the new `main`; there is still only one active writable slice branch.
- Never merge a partial feature, future-required button or incomplete release into `main`. The release version/changelog must describe the **verified running artifact**, not the intended future work.
- Owner-accepted V1.16 Ambient Assist + Intelligent Core work is pre-Road-to-V3; its implementation follows the accepted V1.16 specification and all remaining writer/security/production gates. Its release identity will be implemented in the existing Administration > System view and carried into V2.1 rather than duplicated.


## Migration

- Current Production spreadsheet remains migration source evidence.
- Legacy Current Inventory may fill unresolved metadata only.
- Latest Production backup verifies migration parity.
- Staff migration remains private.
- Never hide reconciliation discrepancies by rewriting history.

## Production boundary

Local preview/development is allowed.
Remote provider/Production mutation requires exact target, preflight, rollback/backup, explicit owner authority, and post-change verification.

Release-scoped production preparation is done by the Cloud Operations lane (GitHub `production` environment, `.github/workflows/production-ops.yml`, `ops/releases/<release>.json`), which enforces exactly this list and only what a reviewed manifest authorizes. It never runs on a push to `main`.
