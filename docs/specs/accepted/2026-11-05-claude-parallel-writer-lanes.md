---
title: Two Claude implementation writers, one serial integration steward
status: accepted
spec_id: HAU-AGENT-LANES-003
accepted_date: 2026-11-05
authority: owner decision (Earl Lawrence Adriano, chat, 2026-11-05), recorded in Git by PR #89
supersedes_in_part: the 2026-11-04 absolute one-writer rule in AGENTS.md "Sole writer"; the writer identities and topology of HAU-AGENT-LANES-002 (Codex + Claude)
classification: development-workflow-amendment
---

# HAU-AGENT-LANES-003 — Two Claude writers, disjoint tasks, serial integration

## Decision

On 2026-11-05 Earl accepted: **at most TWO simultaneous Claude implementation writers**, on **two separate accepted, disjoint tasks**, each in an **isolated Git worktree or independent cloud sandbox**, with **ONE serial integration steward**. Every security, release, deployment and approval gate stays as it was.

Governance acceptance is not acceptance of any product code, migration, infrastructure change, release or deploy. **Two-lane operation stays inactive** until (1) this policy is merged to `main`, (2) local and remote state and locks are reconciled, and (3) two independent accepted task manifests exist. Until then the rule in force is one writer and one active implementation slice.

## What this changes, and what it keeps

| Subject | Before | Now |
|---|---|---|
| Implementation writers | One (AGENTS.md "Sole writer", 2026-11-04) | Claude only; one by default, **up to two** under the conditions below |
| Codex, Forge | Read-only | Read-only (unchanged). HAU-AGENT-LANES-002 allowed Codex to write beside Claude; that allowance is **superseded** |
| ChatGPT | Auditor, reviewer, manager; writes only an expressly owner-authorized scoped edit | Unchanged: independent audit, review and prompts |
| Third writer | Not applicable | **Forbidden.** A coordinator, tester or integrator that edits files occupies a writer slot; it cannot edit while both slots are full |
| Integration | Serial | Serial, one steward (unchanged) |

[HAU-AGENT-LANES-002](2026-10-14-isolated-agent-worktrees.md) stays in the repository as history. Only its incompatible terms (Codex as a writer, the Codex V1.16 lane, the `workspace\logistics-hub-claude-ui` provisioning target) are superseded. Its steward-exclusive path list and its file-ownership manifest idea are kept and restated below. The older MausBot detached read-only worktrees (Scout, Oracle, Sentinel, Harbor) are unchanged and never count as writers.

## Conditions for a second writer

A writer needs **all** of the following, written down before its first edit, in the PR or handoff it works from:

1. a separately accepted, bounded vertical slice with its exclusions and acceptance criteria. **No invented tasks to fill spare capacity;** an unused slot stays idle;
2. a task ID and a dependency map;
3. a base SHA;
4. an owned-path allowlist and a forbidden-path list;
5. its tests;
6. its branch and worktree (or cloud checkout) identity, and its local writer lock (`npm run agent:claim -- claude`);
7. its isolation of shared services and data (below);
8. its stop conditions.

Two writers each use their own branch and their own worktree. **Separate chat threads do not isolate files**, and a Claude Code "Projects" thread-count preference does not enforce the cap. Before opening the second slot, list every other local Claude Desktop, Claude Code and cloud session (`git worktree list`, the app's session list) and record who holds each slot in the roster.

## Steward-exclusive files

Unless the steward grants a serial, frozen ownership transfer first, only the steward edits: `AGENTS.md`, `CLAUDE.md`, `.agents/**`, accepted specifications and governance, `.codex/CURRENT.md`, `.codex/SESSION_HANDOFF.md`, `CHANGELOG.md`, release, CI and ops files (`.github/**`, `ops/**`, `product-release.json`), `package.json` and the lockfile, migrations, Worker and API interfaces, schemas, authentication and roles, shared DTOs and types, global CSS tokens (`src/styles.css` and the token files), and common design and state. Do not add compatibility shims to avoid an ownership question. A writer who needs one of these stops that step, says so in its handoff and waits for the steward.

## Writer-slot roster and isolation

- The **live roster** is the integration steward's cross-repository roster (its location is recorded in `.codex/CURRENT.md`; currently `D:\Documents\HAU-USC Logistics Hub\handoffs\WRITER_ROSTER.md` on Earl's PC). The "Writer slots" table in `.codex/CURRENT.md` is a dated snapshot of it: slot, holder (session), task ID, repository, branch, worktree, base and head SHA, state. If they disagree, no new writer is admitted until the steward reconciles them. A worktree-local writer lock is not a global scheduler; the roster is checked, not assumed, whenever a slot changes hands.
- Isolate everything two writers could trample: D1 and R2 state, the local preview and its watcher (`npm run dev:live` follows one `slice/*` branch), test databases, `.wrangler` e2e state, caches, ports, credentials and any cloud resource that can mutate. Use your own `.wrangler` state directory and port. Local and cloud clones cannot see each other's uncommitted work; commit and push to the assigned branch to share.
- Read no secrets. A writer never touches production or provider state without its own exact-target authorization.

## Checkpoints and testing

Each lane is tested on its own. Checkpoint with small verified commits to the lane's own branch only, with exact SHAs and failure evidence. Read-only testers and reviewers may work in parallel; a tester that edits files is writing, and takes a slot.

## Serial integration

1. Freeze and checkpoint lane B.
2. Inspect lane A's exact full diff at its final SHA.
3. Run the prescribed gates for that diff: security and privacy, CI, CodeQL, unit, Worker E2E, browser, mobile and accessibility, performance.
4. Obtain the independent ChatGPT review of the final diff where required. If ChatGPT is unreachable, save the complete review packet and mark the review PENDING; pending is not passed.
5. Obtain the required approval. **A merge needs Earl's explicit go-ahead for that PR;** an instruction to prepare a PR is not one.
6. Merge at most one PR, verify `main`, update the handoffs, changelog and release evidence.
7. Update and requalify lane B against the new `main`.

If files overlap, or ownership is unclear, stop the affected writers and return to one writer.

## Release states, so a merge is never read as a deploy

| State | Meaning | Only advances on |
|---|---|---|
| `QUALIFICATION_PENDING` | Not merged, or merged without its gates | the exact-head gates passing and Earl's merge go-ahead |
| `MERGED_DEPLOYMENT_UNVERIFIED` | On `main`; nobody has checked what production serves | a byte-for-byte or version check of the live artifact against a build of that commit |
| `DEPLOYED_OWNER_CHECK_PENDING` | Production serves it, verified; Earl has not yet seen it | Earl's check (Administration > System > This version and the changed workflow) |
| `RELEASED_VERIFIED` | Deployed, verified and owner-checked | (terminal) |

A merge is not a deployment. A green CI or CodeQL run is not a deployment. Only verified evidence moves a state forward; a record may say what was observed and when, never what was hoped.

## Unchanged

D1 and R2 truth and evidence contracts; inventory and audit invariants; privacy; backup and rollback; the Cloud Operations migration and deploy procedures (`docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`); the fail-closed deploy gate (an exact-main CodeQL workflow run **and** the combined CodeQL check, `scripts/ops/deploy-gate.mjs`); the security receipt (`AGENTS.md`); version and changelog rules; every approval gate. No branch deletion, reset, force-push, secret access or destructive cleanup to satisfy a branch budget.

## Acceptance record

- Owner decision: Earl, 2026-11-05, in chat (the saved owner handoff names this amendment HAU-AGENT-LANES-003 and says it is "real; ... not yet assumed recorded in Git"). Earl confirmed in the Claude session that executed PR #89's Wave 1 that this task is to be run as written (2026-11-05).
- Recorded in Git by PR #89. Status: **accepted; two-lane operation inactive** until the activation conditions above are met.
- Changelog: `CHANGELOG.md`, "Specification changes". Not a product version.
- Merged to `main` by PR #89 as `9a0cdfe` (2026-11-05).
- Amended 2026-11-05 (owner decision, Earl: "i approve all" after the amendment was put to him): the live roster moved to the steward's cross-repository roster; the repository table is a snapshot. Recorded by LH-RECORDS-01. The activation conditions, the steward-exclusive files, serial integration, Earl's per-PR merge go-ahead and the release states are unchanged. Kawing-Platform's AI-approval rule does not apply here.
