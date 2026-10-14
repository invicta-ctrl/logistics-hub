---
title: Isolated Codex + Claude Parallel Worktrees
status: accepted
spec_id: HAU-AGENT-LANES-002
accepted_date: 2026-10-14
authority: owner instruction and Context Vault PARALLEL-PROJECT-LANES-002
supersedes_in_part: 2026-10-14 one-writer-per-entire-project policy in the previous policy-only PR
classification: development-workflow-amendment
---

# HAU-AGENT-LANES-002 — Parallel frontend and backend, serial integration

## Explicit authorization and limits

The owner approved **Codex and Claude working simultaneously on Logistics Hub**, on separate writable Git worktrees and separate short-lived `slice/*` branches, only when their assigned work and files are non-overlapping and the integration plan has been accepted. This is an exception to the historical one-writer/one-slice default, **not** an authorization for new UI features, release promotion, automatic model spending, production operations, or simultaneous merges.

**Two total implementation writers maximum account-wide; one writer per writable worktree.** If a third writer is present elsewhere, stop until account-wide capacity is available. Scout/Oracle/Sentinel/Harbor retain their accepted detached specialist roles and never become a third writer. Forge can replace, but never join, an occupied writer slot.

## Worktree and branch topology

| Role | Writable checkout | Active branch | Authorized responsibility |
|---|---|---|---|
| Codex (existing) | `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub` | Existing `slice/v1.16-release-controls` | V1.16 release qualification, backend/Worker and its accepted scoped repairs |
| Claude (new, after UI-spec acceptance) | `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub-claude-ui` | New `slice/ui-<accepted-scope>`, forked from **verified `origin/main`** | Accepted visual/UI/UX slice only |
| Integration steward | No third concurrent writer/worktree | Serial use of one assigned lane or protected PR merge | PR review, cross-lane coordination, version/release decisions and one-at-a-time integration |

The Claude path above is a **proposed provisioning target, not proof it exists**. The existing Codex checkout, active V1.16 branch, its known untracked `NUL`, PR #47 and all open release gates **must remain untouched**. Create the second worktree only after checking `git worktree list`, branch status, shared lock ownership, dirty files and the accepted UI scope. Never reset, clean, force, or reuse detached read-only worktrees. Do not run two development servers against the same local D1/R2/preview filesystem; give the UI lane a different preview port and isolated local test state or use static browser previews.

Normal idle mode remains `main` plus one `slice/*`; during **this accepted two-lane exception only**, `main` plus the two named active implementation slices are allowed, alongside short-lived **policy-only PR branches expressly approved by the owner**. No permanent `codex/*`, `claude/*`, `dev`, `backup` or `staging` branches. Existing historical/unknown refs are preserved pending independent provenance checks, not deleted to reach a nominal budget.

## File ownership and dependency contract

Before Claude's first source edit, the **single integration steward** approves a concrete, committed/PR-visible lane ownership table for the *specific accepted UI slice*, listing exact paths or bounded glob patterns, expected changed-file set, cross-lane interfaces, excluded files, acceptance tests and stop conditions. This document alone **does not grant Claude broad ownership of `src/**` or any particular UI file**.

**Codex reserved for the active V1.16 task:** `.codex/CURRENT.md`, `.codex/SESSION_HANDOFF.md`, `docs/road-to-v2/v1.16-execution-card.md`, `docs/road-to-v2/evidence/v1.16-*`, related exact source paths accepted under V1.16, and server/Worker/model-budget/role/stock logic when expressly in scope. Claude may read but not edit these paths.

**Claude candidate paths (only after exact file approval):** bounded UI CSS, semantic markup/TypeScript interactions, motion and owned browser-regression tests in `src/`, `public/`, and `tests/browser/`. This includes layout and visual design, but **not** API shape, auth/permissions, ledger semantics, AI models, persistence, backend request flow or real data. Treat `src/styles.css`, `src/main.ts`, `src/ui.ts` and shared visual/state modules as **reserved for steward arbitration**, not automatically owned by Claude merely because they render UI.

**Steward-exclusive/shared until explicit handoff:** `AGENTS.md`, `CLAUDE.md`, `.agents/**`, all shared `.codex/**` pointers, `.github/**`, `ops/**`, `migrations/**`, `wrangler.jsonc`, `package*.json`, CI/test harness configs, `src/worker.ts`, cross-lane API/DTO/contracts, product-release.json and changelogs, and branch/protection/production settings. If either lane needs one of these, pause affected writing and use a reviewed, serial ownership transfer or a separate integration slice. A conflict in an unlisted generated artifact/test fixture is also an overlap.

A dedicated UI lane checkpoint lives in its own PR body or `docs/agent-lanes/<ui-slice>-handoff.md` **on Claude's branch** (only if included in the approved manifest). It never edits Codex's live `.codex/` files. The steward alone updates common current pointers after integration.

## Required two-lane start handshake (fail closed)

1. Verify canonical Context Vault amendment and this specification are committed and loaded by **fresh agents**. A remote merge does not sync dirty local managed `AGENTS.md` replicas.
2. Verify live `origin/main`, PR #47, Codex branch/status/lock and the proposed Claude worktree's absence/clean eligibility. If pre-existing unknown work is present, stop and preserve it.
3. Identify exactly **two** account-wide writer slots, each owner's accepted task, scope, lane and local lock. The current `npm run agent:claim -- <agent>` operates on one worktree's `.agent-state` only; it **does not** prove global concurrency safety. Do not use it as the sole scheduling gate.
4. Obtain the accepted UI slice and explicit path allowlist, then create the second worktree and uniquely named UI branch from current verified main; record both branch HEADs and paths.
5. Claim the correct local writer lock in each worktree. Record two-lane ownership and integration steward in the PR/task records before editing; either writer fails closed if the other's scope is unknown.
6. Keep both lane branches independently committed and pushed at coherent checkpoints. Claude Cloud must publish to its own UI branch; the existing local `dev:live` auto-sync targets the existing sole `slice` behavior and **must not be redirected or assumed to track both branches**.

## Controlled integration protocol

- Each agent touches **only its allowlisted files**; use a changed-file review against its recorded manifest before every PR/merge. Both remain accountable for focused tests and security/privacy regressions.
- No writer cherry-picks, rebases, fast-forwards or merges the **other active lane's branch** while the other agent owns it. Interface/contract changes need steward review, a frozen handoff and explicit sequential ownership.
- PRs target `main` separately. The steward integrates **only one complete and accepted PR at a time** after current-base protected checks (build, typecheck, unit, browser, Worker E2E, privacy, security and applicable data tests). Update `main`/upstream and rebase/retest the remaining lane only after its writer pauses at a checkpoint and explicitly yields its worktree lock; never force a rebase of uncommitted work.
- A released/merged slice must truthfully pass `docs/PRODUCT_VERSION_GOVERNANCE.md`: documentation-only policy merges do not create a patch number; a product UI improvement may require the next independent product revision. V1.16 remains OPEN/NO-GO until its own acceptance. An unqualified slice is not labeled complete or deployed and must not be merged simply because another lane is ready.
- Before **any** `main` merge, verify Cloudflare Workers Builds and CI-deploy switch current state, production consequences, migrations, rollback, required environment controls and owner approval. No preview branch may deploy production. Only approved operations manifests can prepare production; D1/R2 remain authoritative and protected.

## Verification / negative gates

Expected allow: Codex V1.16 release-document update and Claude approved isolated UI CSS/test edit in different branches/worktrees, disjoint files/dependencies, with two accounted locks.

Expected deny: two writers in one worktree; third account-wide writer; two lanes editing `src/styles.css` or a shared DTO without transfer; Claude writing `.codex/CURRENT.md`; unclear accepted UI spec; duplicate preview state; conflicting or unknown dirty work; model/provider/production writes without separate approval; CI/red checks; simultaneous merges; V1.16 promotion from a policy-only PR.

Review exact logical diff, preserve all data/privacy restrictions, and revert to single-writer handoff on any uncertainty. This policy **does not create a new worktree, launch an agent, approve a visual redesign, or bypass an external production gate**.
