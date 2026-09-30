# Accepted Amendment — MausBot Multi-Worktree Workflow

STATUS: ACCEPTED
ACCEPTED_BY: Earl
ACCEPTED_DATE: 2026-09-30
APPLIES_TO: invicta-ctrl/logistics-hub

## Objective

Allow MausBot specialist bots to use isolated Git worktrees for read/review/release duties while preserving the repository's single-writer rule, one active slice branch, local preview behavior, and production safeguards.

## Authoritative working-folder map

| Bot | Working folder | Git mode | Write authority |
| --- | --- | --- | --- |
| Nexus | `D:\Documents\MausBot\Nexus` | non-repository coordination folder | none |
| Forge | `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub` | existing active writable worktree | primary repository writer |
| Scout | `D:\Documents\MausBot\worktrees\logistics-hub-scout` | detached worktree at the exact commit being inspected | read-only |
| Oracle | `D:\Documents\MausBot\worktrees\logistics-hub-oracle` | detached worktree at the exact commit being analyzed | read-only; recommendations return to Forge |
| Sentinel | `D:\Documents\MausBot\worktrees\logistics-hub-sentinel` | detached worktree at the exact candidate commit | read-only verification |
| Harbor | `D:\Documents\MausBot\worktrees\logistics-hub-harbor` | detached worktree at the exact release commit | release/deploy operations only; no source edits |

## Rules

1. Exactly one repository writer exists at a time. Forge is the normal writer and must claim the writer lock before source edits.
2. Codex and Claude may still take the writer lock in the authoritative writable worktree under the existing handoff rules.
3. Scout, Oracle, Sentinel, and Harbor remain detached and do not create permanent branches. Their worktrees do not change the branch budget.
4. No bot-specific long-lived branches are introduced. The repository still has `main` plus at most one active `slice/<part>-<scope>` branch.
5. Read-only worktrees must be refreshed to the exact commit under inspection before each assignment. They must not be assumed current merely because the folder exists.
6. Oracle does not implement directly in its detached worktree. If Oracle recommends a change, Forge performs it after receiving the handoff.
7. Sentinel reviews and tests the exact candidate commit independently. It does not repair findings in place.
8. Harbor deploys only an explicitly authorized, exact verified commit. It does not develop features or fix source code.
9. The existing writable worktree remains the local-preview worktree so `npm run dev:live` and the current cloud-sync behavior are not disrupted.
10. Unknown local work is preserved. Worktree creation/removal must never reset, clean, or overwrite the writable worktree.
11. Production/provider mutations still require the existing exact-target, preflight, rollback/recovery, authority, and post-change verification controls.

## Folder lifecycle

- `D:\Documents\MausBot\Nexus` is a normal coordination folder.
- The four specialist folders under `D:\Documents\MausBot\worktrees\` are real Git worktrees registered by `git worktree`, not copied repositories or ordinary folders.
- Scout, Oracle, and Sentinel should normally detach at the active candidate commit.
- Harbor should normally detach at the currently authorized release baseline or exact release candidate.
- Repoint a detached worktree rather than creating another branch when its target changes.

## Acceptance criteria

- Repository governance explicitly permits the MausBot worktree model above.
- The writer-lock command accepts `forge`.
- Nexus folder exists.
- Scout, Oracle, Sentinel, and Harbor folders exist and are registered Git worktrees of this repository.
- Forge remains on the existing authoritative writable worktree.
- Auxiliary worktrees are detached and clean after creation.
- Existing untracked/unknown work in the Forge worktree is preserved.
- No extra permanent Git branches are created.
- Part 4.5 product behavior, migration state, and release state are unchanged by this amendment.
