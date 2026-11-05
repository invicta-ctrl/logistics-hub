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
2. Normally one active short-lived slice branch, named `slice/<part>-<scope>`. When a second Claude writer's task is accepted under HAU-AGENT-LANES-003, one more slice branch for that writer, in its own worktree.

No permanent `dev`, `staging`, `backup`, model-specific, agent-specific, or duplicate feature branches.

**Owner-approved parallel development (HAU-AGENT-LANES-003, 2026-11-05):** up to two Claude writers may work at once on two separately accepted, disjoint tasks, each on its own branch, in its own isolated worktree or cloud checkout, with its own writer lock, isolated ports and test state, and one serial integration steward. Codex and Forge are read-only; ChatGPT audits and reviews. A third writer is forbidden. Two-lane operation is inactive until that specification is merged and two task manifests exist. Shared and governance files are steward-exclusive (`docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md`). The 2026-10-14 Codex + Claude arrangement (HAU-AGENT-LANES-002) is history, superseded where it differs.

### Slice lifecycle

1. Start the slice from current `main`.
2. Work in small coherent increments.
3. Commit each completed/working atomic increment on the active slice branch.
4. Do not commit broken states to `main`.
5. When the slice acceptance criteria and required gates are green, the slice is **ready to merge**. Merging needs Earl's explicit go-ahead for that PR (`AGENTS.md`); then, serially, by the steward:
   - update current/handoff docs;
   - rebase/fast-forward safely onto latest `main` if needed;
   - merge/fast-forward the finished slice into `main`;
   - push `main`;
   - delete the merged slice branch locally and remotely;
   - run `git fetch --prune`.
6. In one-lane mode create the next slice only then. With two accepted lanes, the other lane's branch may already exist; it pauses, updates to the new `main` and retests before its own integration.

Prefer linear history. Avoid merge bubbles when a safe fast-forward or rebase is possible.

Never delete an unmerged branch until unique commits are checked and its work is explicitly obsolete.

Temporary exception, accepted 2026-10-02 (`docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`): one branch, `ops/cloud-production-runner`, may exist beside the frozen V1.2 branch to build the Cloud Operations lane. It is merged to `main` and deleted before V1.2 is integrated; the budget above is unchanged afterwards.

## Automatic post-release revision identity — owner mandate (2026-10-11)

The single normative procedure is `docs/PRODUCT_VERSION_GOVERNANCE.md`; AGENTS.md, CLAUDE.md and shared handoffs must enforce it. A main product release is `Vx.xx`. After it has actually merged, **each new independently complete, tested, merged product-affecting fix or improvement** to that release is `Vx.xx.1`, then `Vx.xx.2`, `Vx.xx.3` and so on. One verified merge/release equals one increment, regardless of checkpoint count; separately merged fixes count separately. Documentation-only changes, failed attempts and incomplete slices do not increment. A future unreleased main version is not eligible for patch numbering.

Before integration determine the candidate from the highest **verified** patch of the targeted release line, reconcile current main/deployed state and any in-flight work, and verify no duplicate identifier. Document each release and its user-facing changelog; when the accepted Administration version display exists, show only the verified running build's version and revision notes. Missing or contradictory release evidence is UNKNOWN and must be resolved, never guessed. A version number never authorizes otherwise restricted implementation, production writes or unsafe merges.

## Shared-agent execution

Writable checkouts: one worktree per writer, each on its own `slice/*` branch (the roster is `.codex/CURRENT.md`, "Writer slots"). The older shared checkout `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub` is historical and may hold dirty work of another session: preserve it and do not write there unless it is yours.

Normal mode permits one active writer. Under HAU-AGENT-LANES-003 two Claude writers may write concurrently **only in separate worktrees on disjoint accepted file scopes**; each claims and yields its own worktree-local writer lock. The lock script is local to each checkout and is **not a project-wide scheduler**: the steward verifies the roster, the account-wide writer count, shared-resource isolation and exact ownership separately.

The accepted MausBot multi-worktree amendment permits detached, read-only specialist worktrees for Scout, Oracle, Sentinel, and Harbor. They do not create branches, do not change the branch budget and never count as writers. Harbor performs release/deploy operations only against an explicitly authorized exact commit and does not edit source. Forge is read-only.

The steward alone writes `.codex/SESSION_HANDOFF.md`, `.codex/CURRENT.md` and the other shared governance files during parallel work. A second writer records its progress in its own PR body or lane handoff and proposes changelog entries there. The steward updates shared pointers only at serial integration.

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

A green slice is merged to `main` as soon as Earl gives that PR's go-ahead; a PR prepared or updated is not that go-ahead. A partially working slice stays off `main`.

### Owner's explicit completion and checkpoint contract (2026-10-11)

- Under **no circumstance** claim or present an unfinished version, broken workflow, or incomplete product as finished. State unresolved work accurately in the active-branch handoff, not in a false release claim.
- Push each coherent, reviewed, working checkpoint to **the assigned lane's own slice branch**, after focused verification; preserve exact commits and next action. During parallel mode, do not switch the primary V1.16 worktree or cloud-preview watcher to Claude's UI branch.
- Merge **every independently complete and verified slice** into updated `main`, once Earl has given that PR's explicit go-ahead and it meets its own accepted acceptance criteria and exact-head checks, verify production/build and prune only confirmed-integrated slice branches. Subsequent slices branch from verified new `main`; the accepted parallel exception allows the other active UI slice to remain isolated until a steward-led pause/rebase/retest and serialized merge.
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
