# AGENTS.md — Logistics Hub

Read, in order:
1. `.agents/PROJECT_POLICY.md`
2. `.codex/CURRENT.md`
3. `.codex/SESSION_HANDOFF.md`
4. `docs/SHARED_AGENT_WORKFLOW.md`
5. the active accepted spec/task

Authority: Earl current instruction -> accepted spec/amendment -> verified repository state -> Context Vault.

Documentation map: `docs/DOCUMENTATION_STATUS.md`. `.codex/CURRENT.md` and `.codex/SESSION_HANDOFF.md` are the **only live task pointers**; historical Part briefs, older `proposed` drafts, and old release plans must never restart a closed task. Preserve accepted specs, release/migration evidence and rollback provenance. The retired Road-to-V2 multi-branch runner is not active.

## Road-to-V3 command routing

When the owner says `start RTV`, `start RTV3`, `continue RTV`, `continue RTV3`, or names an `RTV3-XX` milestone, Codex, Claude, and Forge must use the **single normative** entry point in `docs/road-to-v3/00_COORDINATOR_CARD.md` ("Owner command entry point") after following the authority chain above. Do not invoke the historical Road-to-V2 branch runner. A short command never waives an accepted specification, owner acceptance gate, writer lock, production preflight, migration controls, or the one-slice branch policy. Architectural and security corrections needed for a milestone ship with that milestone under `docs/road-to-v3/01_ENGINEERING_CONSTITUTION.md`.

Product versions for Road to V3 remain **V2.1–V2.9** (RTV3-01–RTV3-09) then V3.0 GA. The owner explicitly placed **V1.16 Ambient Assist + Intelligent Core** immediately before Road to V3, despite the historical completed V2.0 baseline. V1.16 owns the first truthful deployed product-version/changelog display in the existing Administration → System > This version; V2.1/F4 must reuse and extend it, not build a second version display. V1.16's detailed implementation authority was explicitly accepted by the owner on 2026-10-11 at docs/specs/accepted/v1.16-ambient-intelligent-core.md.

## Mandatory product subversions after merging to main (owner rule, 2026-10-11)

**All agents must follow `docs/PRODUCT_VERSION_GOVERNANCE.md` without being reminded.** Base releases are `V<major>.<minor>` (example `V1.15`); each separately completed, verified, product-affecting revision **after that version was merged into main** automatically receives the next `V<major>.<minor>.<revision>`: `V1.15.1`, `V1.15.2`, `V1.15.3`, etc. Count **one per independently merged release**, not one per edit/commit/checkpoint; include all fixes in that revision's changelog. Do not increment for documentation-only, failed or unmerged work. **An independently delivered V1.16 development slice that reaches production while V1.15 is the running release needs its own verified V1.15.x revision**; the future V1.16 label is not an exemption. Historical missed revisions must be reconciled with actual evidence, never numbered by counting commits. Verify the last actual release/current main, avoid collisions, preserve history; never backfill invented revision numbers.

Every qualifying main merge must have a verified version identity, concise changelog/release record, tests, deployment evidence and truthful Administration > System display **once the accepted V1.16 version feature is actually deployed**. Until then record the revision in repository evidence without pretending the UI exists. Incomplete slices never merge or count as released. This is permanent, not V1.16-only; see detailed governing contract.

## Non-negotiables

- Codex's existing writable/local-preview worktree remains `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`. A second isolated writable Claude UI worktree is permitted **only** under `docs/specs/accepted/2026-10-14-isolated-agent-worktrees.md` and an accepted bounded UI slice.
- Approved MausBot Scout, Oracle, Sentinel, and Harbor worktrees are detached/read-only specialist worktrees under the accepted MausBot amendment.
- Default: one project writer. **Accepted two-lane exception:** Codex and Claude may write concurrently on distinct Git worktrees/short-lived branches **only** with disjoint file-level ownership, accepted separate tasks, per-worktree locks and one serial integration steward; at most two writers account-wide. Unproven isolation falls back to one writer. Read-only review can always run. See the isolated-agent-worktrees amendment.
- By default one writable slice; the accepted two-lane exception permits the existing Codex V1.16 slice plus **one** additional Claude UI slice, each in its own worktree. No long-lived agent/model branches.
- Claude Cloud must checkpoint only to its **own authorized UI slice branch**. The original local-preview sync watcher is **not** a two-branch synchronizer and must not switch Codex's active V1.16 branch. Separate the UI preview and local state.
- `main` is always the latest verified working product.
- At most one active `slice/*` branch **per writer lane**; two total only while the accepted isolated two-lane exception is active. Unaccepted/unknown branch work is preserved.
- Complete green slices integrate to `main` **serially through the designated steward**, after exact-base CI and deployment preflight; the other writer pauses before any rebase or cross-lane integration. Prune only confirmed-integrated branches.
- **Never present an incomplete version or product as completed or deployed.** Preserve incomplete work only on the active slice, label it accurately in handoffs, and never ship broken dependencies, fake working buttons or missing primary workflows. Every coherent working checkpoint must be tested, committed and pushed to **that writer's assigned slice branch**; do not hold progress only in a cloud session. As soon as a slice is independently usable and its gates are green, **the steward** serially integrates its PR into updated `main` after reconciling the other lane and deployment consequences, verifies main/CI/deployment and prunes only confirmed-integrated refs. An unmerged second lane remains independently preserved and must pause/rebase/retest before its own integration. The product release/version label changes only after the full version actually qualifies and is deployed. Incomplete checkpoints never go to `main`.
- Never put a knowingly broken/incomplete slice on `main`.
- Preserve unknown work; no destructive reset/clean/history rewrite.
- Public repo: no staff/borrower PII, credentials, provider IDs, private exports, or private evidence.
- D1 structured truth; R2 evidence; inventory quantity is movement-derived. Rules for extending the data model: `docs/DATA_ARCHITECTURE.md`; for performance, bounded work and reliability: `docs/PERFORMANCE_RELIABILITY_DOCTRINE.md`.
- HTML5/CSS/TypeScript-first. No SPA framework without accepted amendment.
- Production/provider writes require explicit target/authority and rollback controls.
- Production preparation for a release (an R2 bucket, a D1 migration) runs only through the Cloud Operations lane: the GitHub `production` environment, `.github/workflows/production-ops.yml` and `ops/releases/<release>.json` (`docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`). Never from a PC, never on a push.

## Anti-bloat

Make the smallest durable change.

Before creating a new file/helper/dependency/abstraction, ask:
1. Can the existing code do this clearly?
2. Is this needed by the current accepted slice?
3. Does this reduce complexity rather than move it somewhere else?

Avoid speculative architecture, generic frameworks, duplicate helpers/configs/docs, unused future hooks, excessive comments, redundant tests, and compatibility layers with no current consumer.

When replacing code, remove the obsolete path after verification. Do not leave two ways to do the same thing.

Keep modules cohesive and readable. Optimize for a future agent understanding the change quickly, not for theoretical extensibility.

## Working rhythm

- One bounded atomic change.
- Verify it.
- Commit when it is working.
- Continue.
- When a whole slice is green, pause the other lane at a checkpoint, integrate **one verified PR at a time** into `main`, verify CI/deployment and only then prune confirmed-integrated work; the remaining writer refreshes and retests against the new base.

Keep `npm run dev:live` available at `http://127.0.0.1:8791` when practical.

## Usage-limit handoff

At ~25% remaining usage or an imminent-limit warning:
- stop starting large work;
- finish the smallest safe atomic unit;
- run relevant verification;
- update SESSION_HANDOFF;
- commit a safe checkpoint when practical.

At ~15%:
- no new implementation;
- only verify, document, checkpoint, and yield.

Never leave undocumented unfinished work.
