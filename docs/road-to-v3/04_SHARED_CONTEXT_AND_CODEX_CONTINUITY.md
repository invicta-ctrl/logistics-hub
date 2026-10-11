# Shared Context and Codex Continuity

The repository is the continuity authority.

**Version continuity:** every new Road-to-V3 handoff records the planned/verified **product version (V2.1–V2.9)** and its stable **RTV3-XX milestone ID** together. Previous `V3.1–V3.7` roadmap versions are historical only. The coordinator maps `start/continue V2.x` and `start/continue RTV3-XX` to the same accepted task; see `06_ROAD_TO_V3_RELEASE_MAP.md`.

Claude Project memory, thread history, and Codex chat history are conveniences, not durable project state.

## 1. Required continuity files

Use the repository's existing conventions, especially:

- `.codex/CURRENT.md`
- `.codex/SESSION_HANDOFF.md`
- `.codex/CURRENT_TASK.md` when present
- accepted specifications/amendments
- release records
- migration records
- relevant architecture docs

Do not create competing "Claude-only" truth files if existing repository conventions already cover the information.

## 2. Checkpoint rule

After each coherent implementation checkpoint:

1. review the diff;
2. run task-appropriate verification;
3. commit atomically on the authorized branch/worktree;
4. push when repository policy permits;
5. update continuity state with exact commit/test/blocker information.

Do not wait until a model is near its usage limit.

## 3. Mandatory handoff state

Every implementation lane records:

```text
TASK:
STATUS:
ACTIVE RELEASE:
PRODUCT VERSION:
INTERNAL RTV3 MILESTONE:
ACCEPTED SPEC:
BASE COMMIT:
BRANCH / WORKTREE:
LAST PUSHED COMMIT:
FILES CHANGED:
CONTRACTS ADDED / CHANGED:
MIGRATIONS:
TESTS RUN:
RESULTS:
UNRUN CHECKS:
PERFORMANCE NOTES:
SECURITY / PRIVACY NOTES:
KNOWN LIMITATIONS:
BLOCKERS:
NEXT EXACT ACTION:
MERGE ORDER / DEPENDENCIES:
```

Codex should be able to resume from this state without asking the owner to reconstruct Claude history.

## 4. Claude ↔ Codex transfer protocol

When handing work from Claude to Codex:

1. ensure coherent code is committed or clearly preserved on the authorized task branch;
2. update `.codex/CURRENT_TASK.md` with the next exact action;
3. update `.codex/SESSION_HANDOFF.md` with the state above;
4. include the active accepted-spec path;
5. include exact files/contracts in scope;
6. include unrun tests;
7. include explicit do-not-touch scope;
8. Codex re-runs the normal repository boot sequence before editing.

When handing back to Claude, use the same mechanism.

No tool assumes the other tool's chat context exists.

## 5. Usage exhaustion

If Claude or Codex reaches a usage/session limit:

- no architectural state should be lost;
- the last coherent checkpoint should already be in Git/repository continuity files;
- a replacement session resumes from repository state;
- never blindly repeat a migration, deployment, push, secret update, or external write after an interrupted session—verify whether it already succeeded.

## 6. Shared context in Claude Projects

The Claude Project Goal should contain only stable operating rules, not current task state.

Current task state belongs in the repository.

This prevents the project instructions from becoming stale as the active release changes.
