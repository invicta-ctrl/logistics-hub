# Shared Agent Workflow — Claude writers, ChatGPT review, read-only specialists

Rewritten 2026-11-05 for [HAU-AGENT-LANES-003](specs/accepted/2026-11-05-claude-parallel-writer-lanes.md). The previous text (the Codex + Claude two-lane and shared-worktree rhythm, HAU-AGENT-LANES-002) is kept unchanged at [archive/agent-workflows/SHARED_AGENT_WORKFLOW_before_2026-11-05.md](archive/agent-workflows/SHARED_AGENT_WORKFLOW_before_2026-11-05.md). Where this file and `AGENTS.md` differ, `AGENTS.md` wins.

## The workflow in one sentence

**One Claude writer, one accepted slice, one branch by default. Up to two Claude writers only on two separately accepted, disjoint slices, each in its own worktree and branch, with one serial integration steward. Small verified commits; merge one PR at a time, only on Earl's go-ahead; a merge is not a deployment.**

## Roles

| Role | Who | May |
|---|---|---|
| Implementation writer | Claude (one, or two with an accepted second manifest) | edit its own slice's allowlisted paths on its own branch |
| Integration steward | Claude (exactly one) | edit the steward-exclusive files, run the serial integration, keep the roster and the handoff |
| Independent reviewer | ChatGPT | audit and review the exact final diff, build prompts; writes only an expressly owner-authorized scoped edit |
| Specialists | Codex, Forge, MausBot Scout, Oracle, Sentinel, Harbor | read only. Harbor deploys an explicitly authorized exact commit and never edits source |
| Owner | Earl | accepts specs, gives each merge go-ahead, authorizes deploys and migrations |

A third writer is forbidden. A coordinator, tester or integrator that edits files holds a writer slot.

## Start of a session

Verify, do not assume (`AGENTS.md`, "Repository self-sufficiency"): the repository root, local and remote branch and SHA, clean or dirty and untracked files, `git worktree list`, the writer roster and locks in `.codex/CURRENT.md`, the accepted scope, the handoff, and the current PRs, CI, release and deployment. Local dirty work is not in GitHub. Then claim your lane:

```sh
npm run agent:status
npm run agent:claim -- claude
```

The lock is local to one checkout. It is not a project-wide scheduler: the roster is.

## Workspaces

One worktree per writer, each on its own `slice/<part>-<scope>` branch, created from verified `origin/main`:

```sh
git fetch origin --prune
git worktree add -b slice/<part>-<scope> "D:\Documents\HAU-USC Logistics Hub\worktrees\<name>" origin/main
```

Never put two writers on one branch or in one worktree. Separate chat threads do not isolate files. The older shared checkout `workspace\logistics-hub` is historical and may hold another session's dirty work: preserve it and do not write there unless it is yours. The detached MausBot specialist worktrees (Scout, Oracle, Sentinel, Harbor under `D:\Documents\MausBot\worktrees\`) are read-only; refresh them to the exact commit under inspection before each assignment.

Branch budget: `main` plus one `slice/*` per active writer slot (two at most). Forbidden as permanent workflow: `dev`, `staging`, `backup`, `codex/*`, `claude/*`, parallel feature branches for the same Part. Preserve unknown historical refs.

## Isolation between writers

Give each writer its own `.wrangler` e2e state and port (`scripts/run-worker-browser-tests.mjs` already uses a per-process state directory and a random port), its own preview port, and its own test data. `npm run dev:live` (`http://127.0.0.1:8791`) follows a single `slice/*` branch; do not retarget it to another writer's branch. The preview seeds LOCAL test identities `preview-owner`, `preview-admin` and `preview-staff`; their passwords are in the Git-ignored `data/private/local-preview-credentials.txt` and `.wrangler/state` only. Agents never create, read or store real staff credentials.

## Revision numbers

Read `docs/PRODUCT_VERSION_GOVERNANCE.md` before changing a product version that is on `main`. Follow-up product fixes become `Vx.xx.1`, `Vx.xx.2`, and so on: one per independently released and verified change, not per commit. Track the next number as a **candidate** in the handoff, never as released. Documentation and policy changes take none.

## Implementation rhythm

For each atomic unit: understand the bounded change; make the smallest change; remove code it makes obsolete; run focused verification; review the diff for bloat; commit the working unit. Do not wait for a whole Part before the first safe commit.

Reject or simplify a diff that adds an unnecessary dependency, a helper used once, an abstraction for a hypothetical case, duplicated logic, configuration or docs, two competing implementations, dead code, generated artifacts that should be ignored, verbose comments, duplicate tests, or changes outside the slice. Prefer deleting complexity to documenting it.

## Handoff

Before yielding: stop at a coherent boundary; run the relevant tests and typecheck; check `git status`; commit the safe unit and push it to your own branch; then update the record.
- The **steward** updates `.codex/CURRENT.md` (task board, writer slots) and `.codex/SESSION_HANDOFF.md` (last and next step).
- **Another writer** records progress in its own PR body or lane handoff and proposes changelog entries there, never in the shared pointers.
- Include: branch and HEAD, completed and incomplete work, dirty files, the checks run (PASS, FAIL, N/A or NOT RUN), the exact next action and the blockers.
- Yield the lock: `npm run agent:yield -- claude`.

A takeover is manual: the yielding writer checkpoints; the receiving writer verifies origin, HEAD and a clean tree, then claims the lock. Cross-lane file transfers need the steward's frozen, serial approval.

Usage limits: at about 25% remaining, finish the nearest safe atomic unit and enter handoff mode; at about 15%, only verify, document, checkpoint and yield. A new session recovers from the repository state, not from hidden memory.

## Finishing a slice

A slice is ready for review when its acceptance criteria are met and its gates are green on the exact head: typecheck, focused tests, build, privacy and secret scan, migration and data verification where data changes, Worker and browser tests for user-visible flows, mobile and accessibility, performance, CodeQL and CI, and the final-diff security review with its receipt (`AGENTS.md`). Use `.github/pull_request_template.md` and mark each gate PASS, FAIL, N/A or NOT RUN with a reason and a link.

Serial integration (the steward, one PR at a time): freeze the other lane; inspect the exact final diff; verify the gates; get the independent review (a saved, PENDING packet if ChatGPT is unreachable); get **Earl's explicit go-ahead for that PR**; merge; verify `main`; update the handoff, changelog and release record; then update and retest the other lane. A finished slice does not sit on a stale branch once `main` is green.

After a merge the release state is `MERGED_DEPLOYMENT_UNVERIFIED`. It becomes `DEPLOYED_OWNER_CHECK_PENDING` when the live artifact is verified against a build of that commit, and `RELEASED_VERIFIED` when Earl has checked it. Never write "deployed" or "released" on a merge or a green check alone.

## Branch pruning safety

Delete a branch only after `git merge-base --is-ancestor <branch> main` succeeds, or equivalent proof that all its commits are on `main`, and only with the owner's authority for deletions. Never delete a branch with unique unmerged commits because it looks old.

## Production boundary

This workflow is local and Git only unless Earl separately authorizes remote provider or production actions. `docs/DEPLOYMENT.md` is the deployment and credential runbook; migrations and release-scoped production preparation go only through the Cloud Operations lane (`docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`), never from a PC and never on a push. The Owner Console (`LOGISTICS_ADMIN.cmd`, `npm run admin`) manages accounts and recovery; see the README and `docs/DEPLOYMENT.md` for its menu, and note that its deploy option is the legacy direct-Wrangler path, not the accepted CI path.
