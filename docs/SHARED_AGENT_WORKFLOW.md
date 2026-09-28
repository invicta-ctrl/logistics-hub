# Shared Agent Workflow — Codex + Claude

## The entire workflow in one sentence

**One shared worktree + one active slice branch + one writer + small verified commits + immediate merge to main when green + prune the finished branch.**

## Workspace

Both agents open:

`D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`

Do not create separate active worktrees for Codex and Claude.

## Branch budget

Normal state has only:
- `main`
- optionally one current `slice/<part>-<scope>` branch

That is the branch budget.

Forbidden as permanent workflow:
- `dev`
- `staging`
- `backup`
- `codex/*`
- `claude/*`
- parallel feature branches for the same Part

## Starting a slice

When idle, shared workspace should be on `main`.

Create exactly one branch:

```powershell
git fetch origin --prune
git switch main
git pull --ff-only
git switch -c slice/<part>-<scope>
```

Both agents then take turns on that branch.

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

If the other agent owns it, do not write.

## Local preview

Run once and keep it alive:

```powershell
npm run dev:live
```

Open:

`http://127.0.0.1:8791`

The preview belongs to the project, not an individual agent. Handoffs should not restart it unless needed.

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

The next agent reads the handoff, claims the lock, verifies HEAD/status, and continues the exact next action. It does not redo planning already settled.

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
4. Integrate into `main` using the simplest safe linear method.
5. Verify `main` after integration.
6. Push `main`.
7. Delete the merged slice branch locally and remotely.
8. Run `git fetch --prune`.
9. Leave the shared worktree on clean `main`.

No finished slice should sit around on a stale branch once `main` is green.

## Branch pruning safety

After integration, delete a branch only when:

`git merge-base --is-ancestor <branch> main`

succeeds, or equivalent verification proves all commits are on `main`.

Never delete a branch with unique unmerged commits merely because it looks old.

## Production boundary

This workflow is local/Git only unless Earl separately authorizes remote provider/Production actions.

`docs/DEPLOYMENT.md` is the only deployment and credential runbook: deploy with the Owner Console (`LOGISTICS_ADMIN.cmd` → 13) from clean, verified `main`, and manage accounts through the site's Administration page or the console (Admin API). Agents never create, read or store real staff credentials.
