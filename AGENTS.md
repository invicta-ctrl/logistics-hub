# AGENTS.md — Logistics Hub

Read, in order:
1. `.agents/PROJECT_POLICY.md`
2. `.codex/CURRENT.md` (the live task board, with the writer slots)
3. `.codex/SESSION_HANDOFF.md`
4. `docs/SHARED_AGENT_WORKFLOW.md`
5. the active accepted spec/task (the writer rules: `docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md`)

Authority: Earl current instruction -> accepted spec/amendment -> verified repository state -> Context Vault.

## Writers (owner rules 2026-11-04 and 2026-11-05; spec HAU-AGENT-LANES-003)

Earl, 2026-11-04: "for all current, past, and future projects. claude will be the sole writer until further notice. chatgpt will remain auditor, reviewer, and manager." Earl, 2026-11-05, accepted up to **two simultaneous Claude writers** on separate accepted disjoint tasks: [`docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md`](docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md) (HAU-AGENT-LANES-003). It partly supersedes the absolute one-writer rule of 2026-11-04 and the writer identities of HAU-AGENT-LANES-002 (kept as history).
- **Claude:** the only implementation writer, and the integration steward (one, serial). **One writer and one active implementation slice by default.** A second Claude writer needs, before its first edit, a separately accepted bounded slice with task ID, base SHA, owned and forbidden paths, tests, its own branch and worktree, its own writer lock, isolated shared state and stop conditions. **Two slots maximum, account-wide, across every desktop, cloud and repository session.** Unused capacity is never a reason to invent a task. The slot roster is in `.codex/CURRENT.md` ("Writer slots"); check it, do not assume it.
- **Two-lane operation is inactive** until HAU-AGENT-LANES-003 is merged to `main`, local and remote state and locks are reconciled, and two independent accepted task manifests exist.
- **A third writer is forbidden.** A coordinator, tester or integrator that edits files occupies a slot.
- **ChatGPT:** independent auditor, reviewer, prompt builder and manager; may write only when Earl expressly authorizes the scope, after verifying the roster, branch and file ownership. While it edits it occupies one of the two writer slots. An owner-authorized policy-only PR may use a temporary separate branch but must integrate serially.
- **Codex and Forge:** read-only. Historical writer and lane assignments, including Codex in HAU-AGENT-LANES-002, are superseded.
- **Steward-exclusive** unless a serial, frozen transfer is granted first: this file, `CLAUDE.md`, `.agents/**`, accepted specs, `.codex/CURRENT.md`, `.codex/SESSION_HANDOFF.md`, `CHANGELOG.md`, CI, release and ops files, `package.json` and the lockfile, migrations, Worker and API interfaces, schemas, authentication and roles, shared types, global CSS tokens and common design and state.
- **Unchanged:** the authority chain above, the per-action owner authorization for pushes, merges, deploys and migrations, and every release gate. An instruction to prepare a PR is not a go-ahead to merge it.

## Repository self-sufficiency (owner rule, 2026-11-05)

A fresh clone and an agent with no conversation history must be able to find, from the repository alone: the accepted task and spec, the current branch, PR and SHA, the writer slots and who holds them, the commands that run the checks, the gates, the verified deployed state, the blocker and the next action. Keep that true.
- **At session start verify, do not assume:** the repository root; local and remote branch and SHA; clean, dirty and untracked files; `git worktree list`; the writer roster and locks; the accepted scope; `.codex/CURRENT.md` and the handoff; current PRs, CI, release and deployment. Local dirty work is not in GitHub.
- **While working:** one bounded accepted task per writer; exact file ownership; preserve unknown work; never rewrite another agent's work or broaden scope; checkpoint the evidence, the change, the blocker and the next action in the handoff.
- **Documents:** keep current normative documents apart from historical evidence. Reconcile a stale or contradictory instruction when you find it; archive older records by copying them to `docs/archive/` (index: `docs/archive/README.md`) rather than deleting them; keep one discoverable live current pointer. No mass source moves without a separate accepted, reversible path migration with full tests.
- **State words:** `MERGED_DEPLOYMENT_UNVERIFIED` (on `main`; production not checked), `DEPLOYED_OWNER_CHECK_PENDING` (production verified to serve it; Earl has not checked) and `RELEASED_VERIFIED`. A merge is not a deployment, and a green CI or CodeQL run is not a deployment. Only verified evidence advances a state.
- **Every PR** uses `.github/pull_request_template.md`: exact base and head, accepted scope, writer, risk tier, PASS, FAIL, N/A or NOT RUN with a reason and a link for each gate, the independent review, and the docs and changelog reconciliation. The canonical checklists are `docs/WEB_QUALITY_RELEASE_GATES.md`, `docs/PERFORMANCE_RELIABILITY_DOCTRINE.md` and the security review below; the template points to them and does not copy them. GitHub branch protection does not enforce agent behavior unless it has been read back and verified.
- **Cold-start proof** before an integration that changes policy or the handoff: a read-only agent with no history, given only a fresh clone, answers the questions above. Record the questions, the answers and the result in the PR; a failure is repaired and the drill rerun.

Documentation map: `docs/DOCUMENTATION_STATUS.md`. `.codex/CURRENT.md` and `.codex/SESSION_HANDOFF.md` are the **only live task pointers**; historical Part briefs, older `proposed` drafts, and old release plans must never restart a closed task. Preserve accepted specs, release/migration evidence and rollback provenance. The retired Road-to-V2 multi-branch runner is not active.

## Road-to-V3 command routing

When the owner says `start RTV`, `start RTV3`, `continue RTV`, `continue RTV3`, or names an `RTV3-XX` milestone, Codex, Claude, and Forge must use the **single normative** entry point in `docs/road-to-v3/00_COORDINATOR_CARD.md` ("Owner command entry point") after following the authority chain above. Do not invoke the historical Road-to-V2 branch runner. A short command never waives an accepted specification, owner acceptance gate, writer lock, production preflight, migration controls, or the one-slice branch policy. Architectural and security corrections needed for a milestone ship with that milestone under `docs/road-to-v3/01_ENGINEERING_CONSTITUTION.md`.

Product versions for Road to V3 remain **V2.1–V2.9** (RTV3-01–RTV3-09) then V3.0 GA. The owner explicitly placed **V1.16 Ambient Assist + Intelligent Core** immediately before Road to V3, despite the historical completed V2.0 baseline. V1.16 owns the first truthful deployed product-version/changelog display in the existing Administration → System > This version; V2.1/F4 must reuse and extend it, not build a second version display. V1.16's detailed implementation authority was explicitly accepted by the owner on 2026-10-11 at docs/specs/accepted/v1.16-ambient-intelligent-core.md.

## Mandatory product subversions after merging to main (owner rule, 2026-10-11)

**All agents must follow `docs/PRODUCT_VERSION_GOVERNANCE.md` without being reminded.** Base releases are `V<major>.<minor>` (example `V1.15`); each separately completed, verified, product-affecting revision **after that version was merged into main** automatically receives the next `V<major>.<minor>.<revision>`: `V1.15.1`, `V1.15.2`, `V1.15.3`, etc. Count **one per independently merged release**, not one per edit/commit/checkpoint; include all fixes in that revision's changelog. Do not increment for documentation-only work, failed/rejected work, or unreleased main-version slices. Verify the last actual release/current main, avoid collisions, preserve history; never backfill invented revision numbers.

Every qualifying main merge must have a verified version identity, concise changelog/release record, tests, deployment evidence and truthful Administration > System display **once the accepted V1.16 version feature is actually deployed**. Until then record the revision in repository evidence without pretending the UI exists. Incomplete slices never merge or count as released. This is permanent, not V1.16-only; see detailed governing contract.

## Mandatory changelog (owner rule, 2026-11-04)

Maintain the repository-root `CHANGELOG.md` as a concise, chronological index of **every verified product version/revision** and **every accepted specification or amendment revision**. All agents (Codex, Claude, Forge and successors) follow this without prompting. The existing per-version release records and accepted specifications remain authoritative for detailed evidence; the changelog links to them and is not a second version registry.

- **Product changes:** Prepare the entry with the qualifying slice/PR. At release qualification, place it under the exact verified `V<major>.<minor>[.<revision>]` and release date, listing each shipped fix/improvement. One independently released change-set gets one version entry, regardless of commits; preserve the existing numbering and release gates in `docs/PRODUCT_VERSION_GOVERNANCE.md`.
- **Specification changes:** When a specification or amendment is accepted or an accepted one is revised, record a separate dated entry under `Specification changes` with its identifier, changed requirements, reason and affected scope, acceptance reference, and status. It is **not** a product release or version increment. Proposals and work in progress stay explicitly marked pending in their proposal/PR/handoff; never present them as accepted or shipped.
- **Entry minimum:** date; version or amendment ID; what changed and why (prefer Added/Changed/Fixed/Removed); material user, contract, migration or rollback impact; the authoritative spec/release link; and relevant PR/commit and verification reference. Link detailed records instead of duplicating long evidence tables.
- **Ownership and gate:** During parallel work, the integration steward owns this shared file; other writers supply proposed entries in their assigned PR/handoff. The steward reconciles the final changelog as part of each qualified integration/accepted amendment. Missing or misleading entries block that integration. Never overwrite prior history, fabricate old entries or count documentation-only changes as product revisions.

## Non-negotiables

Writer rules are in "Writers" above (HAU-AGENT-LANES-003); the bullets here only add the Git and branch consequences.

- Canonical writable checkout: a worktree per writer under `D:\Documents\HAU-USC Logistics Hub\worktrees\` (or an independent cloud checkout), each on its own `slice/*` branch. The older shared checkout `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub` and the Codex-era worktrees are historical: do not write in one that another session holds, and preserve any dirty work found there.
- Approved MausBot Scout, Oracle, Sentinel, and Harbor worktrees are detached/read-only specialist worktrees under the accepted MausBot amendment. They never count as writers.
- Default: one writable slice. A second slice exists only while a second writer's manifest is accepted (HAU-AGENT-LANES-003); then at most one active `slice/*` branch **per writer slot**, two in total. No long-lived agent or model branches. Unaccepted or unknown branch work is preserved.
- Claude Cloud checkpoints only to its **own authorized slice branch**. The local-preview sync watcher (`npm run dev:live`) follows one `slice/*` branch and is not a two-branch synchronizer; give each writer its own preview port and test state.
- `main` is always the latest verified working product.
- Complete green slices integrate to `main` **serially through the one steward**, after exact-base CI and deployment preflight and Earl's go-ahead for that PR; the other writer pauses before any rebase or cross-lane integration. Prune only confirmed-integrated branches.
- **Never present an incomplete version or product as completed or deployed.** Preserve incomplete work only on the active slice, label it accurately in handoffs, and never ship broken dependencies, fake working buttons or missing primary workflows. Every coherent working checkpoint must be tested, committed and pushed to **that writer's assigned slice branch**; do not hold progress only in a cloud session. As soon as a slice is independently usable and its gates are green, **the steward** serially integrates its PR into updated `main` after reconciling the other lane and deployment consequences, verifies main/CI/deployment and prunes only confirmed-integrated refs. An unmerged second lane remains independently preserved and must pause, update and retest before its own integration. The product release/version label changes only after the full version actually qualifies and is deployed. Incomplete checkpoints never go to `main`.
- Never put a knowingly broken/incomplete slice on `main`.
- Preserve unknown work; no destructive reset/clean/history rewrite.
- Public repo: no staff/borrower PII, credentials, provider IDs, private exports, or private evidence.
- D1 structured truth; R2 evidence; inventory quantity is movement-derived. Rules for extending the data model: `docs/DATA_ARCHITECTURE.md`; for performance, bounded work and reliability: `docs/PERFORMANCE_RELIABILITY_DOCTRINE.md`.
- HTML5/CSS/TypeScript-first. No SPA framework without accepted amendment.
- Production/provider writes require explicit target/authority and rollback controls.
- Production preparation for a release (an R2 bucket, a D1 migration) runs only through the Cloud Operations lane: the GitHub `production` environment, `.github/workflows/production-ops.yml` and `ops/releases/<release>.json` (`docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`). Never from a PC, never on a push.

## Mandatory agent-operated security review before main (owner rule, 2026-11-04)

Every agent that writes, reviews, audits, qualifies or recommends changes must complete an applicable security review of the **entire final diff at the exact proposed HEAD** before calling a PR merge-ready or merging it. This is an **agent obligation**, independent of GitHub branch-protection settings. Reuse the baseline slice gates in `.agents/PROJECT_POLICY.md` and record evidence in the existing PR, release record or handoff; do not create a duplicate checklist.

1. **Classify the highest applicable risk:** LOW = documentation-only; STANDARD = ordinary application/config/dependency changes; HIGH = changes to authentication, roles, sessions, privacy/consent, secrets, stock/borrowing mutations, D1/R2 data, migrations, deployment, or security/release controls. Mixed changes use the highest tier.
2. **Inspect the changed trust boundaries:** credentials/PII in code, API responses, logs and artifacts; authorization/object ownership and cross-user access; session, CSRF/CORS and input validation; dependency and CI supply-chain changes; transaction/audit integrity and failure recovery. Mark genuinely irrelevant items N/A.
3. **Verify applicable checks on the final candidate:** build/typecheck, focused tests, privacy/secret scan, CI and CodeQL, Worker E2E/browser checks where affected. For HIGH changes, add focused negative/abuse regressions: permission denials, duplicate and concurrent mutations, immutable stock/audit records, borrowing consent, R2 ownership/cleanup, and D1 fresh/upgrade migration, backup and rollback where relevant. Never describe an unrun check as passed.
4. **Record a compact security receipt:** base and final HEAD SHA, risk tier, affected boundaries, each applicable check as PASS/FAIL/N/A/NOT RUN with test/run reference, reviewer and exact-head review evidence (independent of the writer for HIGH changes), unresolved findings and explicit owner-accepted exceptions. Update the receipt after any substantive head change.
5. **Block a merge recommendation or integration** for failed or unrun required security gates, an unreviewed final diff, or unresolved HIGH/CRITICAL findings, unless Earl explicitly accepts a narrowly scoped, documented exception. Documentation-only changes receive lightweight diff/privacy sanity checks; unrelated tests may be N/A.

The integration steward verifies this receipt before serial integration to `main`. Security findings, exceptions and incomplete checks remain visible in the handoff, never silently waived.

## Anti-bloat

Make the smallest durable change.

Before creating a new file/helper/dependency/abstraction, ask:
1. Can the existing code do this clearly?
2. Is this needed by the current accepted slice?
3. Does this reduce complexity rather than move it somewhere else?

Avoid speculative architecture, generic frameworks, duplicate helpers/configs/docs, unused future hooks, excessive comments, redundant tests, and compatibility layers with no current consumer.

When replacing code, remove the obsolete path after verification. Do not leave two ways to do the same thing.

Keep modules cohesive and readable. Optimize for a future agent understanding the change quickly, not for theoretical extensibility.

## Scoped engineering and web-quality reference (documentation proposal, 2026-11-03)

- Before qualifying an approved user-facing slice, consult `docs/WEB_QUALITY_RELEASE_GATES.md` for the 15 UX + 20 prelaunch observations. Record relevant PASS/FAIL/N/A/NOT RUN evidence in the **existing** active release/handoff; do not assume every marketing item applies to private app routes.
- `docs/ENGINEERING_KNOWLEDGE_MAP.md` maps the 140 Backend/DSA/HLD/LLD/AI/DevOps/Security concepts. It is a study/review reference, **not** permission to add unused infrastructure, frameworks, architecture or work outside the accepted slice.
- Custody, dirty worktrees, owner-approved amendments and production gates stay untouched; the live state is in `.codex/CURRENT.md`. The integration steward alone reconciles this documentation proposal into current `main` and any open writer lane; a GitHub branch does not automatically update a local worktree.

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
