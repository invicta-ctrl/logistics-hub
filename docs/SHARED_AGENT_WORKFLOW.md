# Shared Agent Workflow — Codex + Claude + MausBot

## The entire workflow in one sentence

**Default: one writable worktree, one active slice, one writer. Accepted isolated exception: two writable worktrees, two independently scoped slice branches, one writer per worktree, explicit disjoint file ownership, and one serial integration steward.** Preserve small verified commits, branch protections and safe pruning.

**Approved within-Logistics concurrency:** Codex continues V1.16/backend on its existing checkout while Claude may implement a separately **accepted bounded** UI slice on a second dedicated worktree/branch. Maximum **two** implementation writers account-wide. Exact allowlisted files, disjoint dependencies, two per-worktree locks and one steward controlling shared files/serial PR merges are mandatory. No accepted UI spec or overlap => Claude stays read-only. See `docs/specs/accepted/2026-10-14-isolated-agent-worktrees.md` and Context Vault `PARALLEL-PROJECT-LANES-002`. The exploratory design-reference document is **not** acceptance to redesign.

**Owner release doctrine (2026-10-11):** Never present an incomplete product/version as complete. Coherent working checkpoints are committed and pushed to the single active slice branch. After its own accepted scope, verification and exact-head CI pass, an independently usable slice merges immediately to updated main, its deployment is verified, and the branch is pruned. Resume version-level work using a new slice branched from the latest main. Never publish a partially functional capability to main or falsely advertise its version in Administration. A blocked slice remains transparently recorded in handoff; do not silently truncate scope to claim completion.

## Workspace

Codex (and Forge only as its serialized handoff) use the existing writable/local-preview worktree:

`D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`

Approved MausBot specialist worktrees:
- Scout: `D:\Documents\MausBot\worktrees\logistics-hub-scout`
- Oracle: `D:\Documents\MausBot\worktrees\logistics-hub-oracle`
- Sentinel: `D:\Documents\MausBot\worktrees\logistics-hub-sentinel`
- Harbor: `D:\Documents\MausBot\worktrees\logistics-hub-harbor`

These are detached Git worktrees, not active development branches. Refresh them to the exact commit under inspection before each assignment. Scout, Oracle, and Sentinel are read-only. Harbor performs release/deploy operations against an explicitly authorized exact commit and does not edit source.

Exception: the integration steward may provision **one** additional Claude UI Git worktree at `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub-claude-ui` **after** accepted UI scope, clean-worktree preflight and explicit path ownership. No additional Forge/Codex writable checkout; existing MausBot specialist worktrees stay read-only.

## Branch budget

Normal state has only:
- `main`
- optionally one current `slice/<part>-<scope>` branch

That is the **default** branch budget. In the accepted two-lane mode, the existing Codex V1.16 slice and one new UI `slice/*` may coexist, each on a separate writable worktree. No other implementation slice starts while both are active; preserve unknown historical refs. Policy-only PR branches are a distinct, owner-approved temporary exception.

Forbidden as permanent workflow:
- `dev`
- `staging`
- `backup`
- `codex/*`
- `claude/*`
- parallel feature branches for the same Part

## Mandatory revision number for post-release changes

Read `docs/PRODUCT_VERSION_GOVERNANCE.md` before a change to any main-merged product version. A base release uses `Vx.xx`; its independently completed follow-up fixes/improvements merged to main become `Vx.xx.1`, `Vx.xx.2`, etc. One released, verified slice = one increment; do not count commits or intermediate pushed checkpoints. Several separately merged fixes produce several successive revisions; several fixes intentionally bundled into one independently shipped slice produce one revision with all fixes listed. Documentation-only governance, unsuccessful work and unmerged changes do not consume a revision.

At slice start read last proven main-merged release, targeted release line, existing revision records and actual deployed version if available. Track next patch as **candidate** in handoff, not a released claim. Before merging refresh main and version history to prevent duplicates. After all green gates, commit/push, integrate and verify main/production, record the final version, concise changelog, exact SHA/CI/rollback and Administration version UI when available; prune the merged branch. For a new main version not yet delivered, do not invent its patch series. Never invent historical `V1.15.N` from commit counts.

## Starting a slice

When idle, shared workspace should be on `main`.

Create exactly one branch:

```powershell
git fetch origin --prune
git switch main
git pull --ff-only
git switch -c slice/<part>-<scope>
```

In default mode Codex, Claude, and Forge take turns on that branch. **For the accepted two-lane mode**, the steward creates the Claude UI worktree/branch from verified `origin/main` only after a file-level lane manifest is accepted; Codex retains the existing V1.16 branch. Do not put both writers on one branch.

## Writer lock

Before editing:

```powershell
npm run agent:status
npm run agent:claim -- codex
```

or:

```powershell
npm run agent:claim -- claude
```

For MausBot Forge:

```powershell
npm run agent:claim -- forge
```

If another writer owns **that worktree's** lock, do not write there. **The lock is worktree-local**, not an account-wide lease: two-lane activation additionally requires steward verification of disjoint accepted paths, two writer slots and isolated state. When in doubt, use single-writer handoff.

## Local preview

Run once and keep it alive:

```powershell
npm run dev:live
```

Open:

`http://127.0.0.1:8791`

The existing preview belongs to the **Codex V1.16 worktree** during parallel mode. Do not retarget its cloud-sync watcher to Claude's UI branch: it is single-branch-oriented. Use a separate preview port and isolated local D1/R2/test-state for Claude, or static preview evidence. Handoffs should not restart the primary preview unless needed.

The preview seeds three LOCAL test identities when missing: `preview-owner` (Owner), `preview-admin` (Administrator) and `preview-staff` (Staff). Their random passwords are appended to the Git-ignored `data/private/local-preview-credentials.txt`; they exist only in `.wrangler/state`.

For Claude Cloud, the local preview can only see work that has been committed and pushed to GitHub. `npm run dev:live` starts a cloud-sync watcher that fast-forwards the preview to the single active `origin/slice/*` branch (or `main` once that slice is merged and pruned). It polls every 15 seconds, backing off to 60 seconds while nothing changes, and only when the local worktree is clean and no local writer lock is held. It never switches away from a local branch with unpushed commits, so push a slice branch before relying on the preview. Claude Cloud should push coherent working checkpoints frequently rather than holding a large unpushed session.

## Implementation rhythm

For each atomic unit:

1. Understand the bounded change.
2. Modify the smallest amount of code.
3. Remove code made obsolete by the change.
4. Run focused verification.
5. Review the diff for bloat and duplication.
6. Commit the working unit.

Do not wait until an entire Part is finished before making the first safe commit.

Good commits are small enough that the next agent can understand/revert them, but large enough to represent a coherent working change.

## Anti-bloat review before every commit

Reject or simplify the diff if it contains:
- a dependency that is not necessary;
- a helper used once without improving readability;
- an abstraction for a hypothetical future case;
- duplicated logic/configuration/docs;
- two competing implementations;
- dead code left behind;
- generated artifacts that should be ignored;
- verbose comments that merely restate code;
- tests that duplicate the same behavior without added value;
- changes outside the active slice with no necessity.

Prefer deleting complexity over documenting why it exists.

## Handoff between agents

Before yielding:

1. Stop at a coherent boundary.
2. Run relevant tests/typecheck.
3. Check `git status`.
4. Commit the safe atomic work when practical.
5. Update `.codex/SESSION_HANDOFF.md` with:
   - current branch + HEAD;
   - completed work;
   - incomplete work;
   - dirty files, if any;
   - verification run;
   - exact next action;
   - blockers/risks.
6. Yield:
   `npm run agent:yield -- <agent>`.

In single-lane mode, the next agent reads the handoff and claims that lock. In parallel mode, **Codex alone writes shared `.codex` pointers while V1.16 is open**; Claude writes an approved UI-lane checkpoint only on its own branch, and the steward coordinates shared pointers/integration at serialized handoffs.

## Manual Codex ↔ Claude takeover on one slice

A **single-lane takeover** remains manual: yielding writer checkpoints and yields, receiving writer verifies origin/HEAD/clean state and claims that lane's lock. For **parallel mode**, do not switch branches/worktrees to take over: each writer remains in its own lane and only its approved file set. Cross-lane transfers require both writers to pause, steward arbitration, updated file ownership, tests and an explicit handoff. Cloud-preview sync never authorizes writers.

## Usage-aware handoff

At ~25% remaining usage or any warning:
- enter handoff mode;
- no new large subtask;
- complete the nearest safe atomic unit;
- checkpoint and document.

At ~15%:
- implementation stops;
- only verify, document, commit/checkpoint, and yield.

## Finishing a slice

A slice is ready for `main` only when its acceptance criteria are satisfied and required gates are green.

Typical gates:
- typecheck;
- focused tests;
- build;
- privacy/secret scan;
- migration/data verification if relevant;
- browser/E2E if user-visible;
- final diff review.

Then:

1. Update CURRENT / SESSION_HANDOFF.
2. Commit final slice state.
3. Push the slice branch if review/backup is useful.
4. The nominated steward integrates **one complete PR at a time** after verifying disjoint changed paths, current-base checks, release/version rules, production merge consequences and rollback; pause the other writer for rebase/retest.
5. Verify `main` after integration.
6. Push `main`.
7. Delete the merged slice branch locally and remotely.
8. Run `git fetch --prune`.
9. In single-lane mode leave the shared worktree on clean `main`. In two-lane mode preserve any unmerged other branch and its worktree; only clean/prune proven-integrated refs after the other lane's status has been reconciled.

No finished slice should sit around on a stale branch once `main` is green.

## Branch pruning safety

After integration, delete a branch only when:

`git merge-base --is-ancestor <branch> main`

succeeds, or equivalent verification proves all commits are on `main`.

Never delete a branch with unique unmerged commits merely because it looks old.

## Production boundary

This workflow is local/Git only unless Earl separately authorizes remote provider/Production actions.

`docs/DEPLOYMENT.md` is the only deployment and credential runbook: deploy with the Owner Console (`LOGISTICS_ADMIN.cmd` → 13) from clean, verified `main`, and manage accounts through the site's Administration page or the console (Admin API). Agents never create, read or store real staff credentials.
