# Coordinator Card — Road to V3

This file contains the **only normative boot sequence** for Road-to-V3 work.
Other files may reference it, but must not define another startup procedure.

## 1. Boot sequence

Before creating a thread or editing code:

1. Open the authoritative repository.
2. Verify repository root, remote, branch, HEAD, worktrees, dirty state, and active writer.
3. Read `AGENTS.md`.
4. Read `CLAUDE.md`.
5. Read repository project-policy/agent-governance files.
6. Read `.codex/CURRENT.md`.
7. Read `.codex/SESSION_HANDOFF.md`.
8. Read `.codex/CURRENT_TASK.md` when present.
9. Read the accepted specification/amendment for the active release.
10. Read the active release record and relevant migrations.
11. Read this package's active release card only after the higher-authority sources above.
12. Build the dependency graph.
13. Classify candidate work as independent, forward-compatible, blocked, or overlapping.
14. Freeze shared contracts before parallel specialist work depends on them.
15. Create bounded task packets.
16. Start only the threads that shorten the critical path.

If repository state cannot be determined, stop. Unknown repository state is not permission to proceed.


## Owner command entry point — `start RTV` / `continue RTV`

This is the **only command-dispatch procedure** for Codex, Claude, Forge, and independent cloud sessions. These instructions extend the boot sequence above; they do not replace it or override higher repository authority. The agent's own conversation history, cached plan, or working directory is not release authority.

### Recognized commands

- `start RTV`, `start RTV3`, `begin RTV`: reconcile actual repository state, then begin the **earliest eligible accepted** Road-to-V3 milestone or safely resume an already active accepted RTV slice.
- `start RTV3-XX`: target that milestone only, provided its predecessor, owner amendment, and accepted spec gates are satisfied; otherwise prepare the missing spec or report the exact blocked gate. Do not implement a successor early.
- `continue RTV`, `continue RTV3`, `resume RTV`: resume the **specific active accepted RTV task** recorded in repository continuity, without restarting completed work. If no active RTV task exists, perform the `start RTV` readiness procedure.
- `continue RTV3-XX`: resume that milestone if authoritative status says it is active; otherwise apply its start gates without pretending it has started.
- A generic `start` or `continue` with clear RTV context uses these same rules; without clear context, never use a historical Road-to-V2 runner as the default.

### Deterministic dispatcher

1. Execute the boot sequence in §1. Confirm exact repository, `origin/main` HEAD, current branch/worktree and dirty files, remote slice branches, current writer lock, accepted specs, active task, release evidence, and historical versus current handoff. The latest verified Git state outranks stale narrative headings. An inaccessible lock/status is UNKNOWN, not free.
2. If a non-RTV slice is already active or a different agent holds the writer lock, **do not interfere**: no second writable branch or main edit, no branch deletion, no takeover. Report the owner and safe next step; bounded read-only RTV preparation is permitted.
3. Identify the active RTV task, if any, from `.codex/CURRENT.md`, `.codex/CURRENT_TASK.md` if present, `.codex/SESSION_HANDOFF.md`, the accepted spec and release record, verified against Git branches/commits. Do not restart a merged slice or assume a release is complete based on a stale pointer.
4. If no active RTV task, select the earliest eligible milestone in `06_ROAD_TO_V3_RELEASE_MAP.md`. RTV3-01 requires the truthful V2 handoff and its own owner-accepted milestone specification. RTV3-02 and subsequent domain milestones additionally require the accepted Product Direction Amendment; successor prerequisites and P0 gates still apply. A roadmap card or draft is **not** an accepted implementation spec.
5. If the selected spec/amendment is missing, draft the smallest owner-reviewable specification using `templates/ACCEPTED_SPEC_TEMPLATE.md`, identify required decisions, and **stop before modifying implementation**. A shorthand command does not sign a spec, grant a production approval, or silently broaden scope.
6. Once authorized, use the **single** `slice/<part>-<scope>` branch based on current verified `main` and claim the writer lock using repository workflow. Do not create simultaneous V3 version branches or writable subagent worktrees unless a later accepted governance amendment explicitly permits them. Parallel reviewers/researchers may remain read-only.
7. Decompose the accepted milestone into bounded packets (normally 6–10; RTV3-01 has eight F1–F8 packets). Every packet must identify source baseline, owned files/contracts, feature outcome, **version-aligned engineering work**, acceptance tests, fallback, verification and handoff. Separate parallel research and reviews from the sole integrating writer.
8. Implement in small verified commits; keep architectural corrections, modularization, security fixes, reliability and performance improvements **inside the milestone that requires them**, per `01_ENGINEERING_CONSTITUTION.md` §2A. Do not defer a required fix to RTV3-09, or introduce speculative refactors merely to increase perceived code quality.
9. Before reporting completion, verify every accepted feature **and** engineering acceptance criterion; review full diffs, negative/denial paths, typecheck/tests/build, browser/a11y/privacy/performance/migration/rollback as relevant. Complete the release record and continuity docs, then integrate onto `main`, verify exact resulting commit and deployment state, and prune only a proven-merged slice. Follow the Cloud Operations lane for approved production preparations. Do not claim production verification from local tests.
10. Yield the writer lock and leave an exact repository-backed handoff. Respond with selected milestone, spec status, branch/commit, work done, checks run, unresolved gates, and the **single next action**. On interruption or agent switch, the next agent repeats reconciliation and continues; it does not trust the previous agent's memory.

A `continue RTV` instruction **never** authorizes an unapproved scope, automatically skips a required owner decision, or bypasses a live non-RTV slice.


## 2. Default orchestration

Use the Claude Project as a coordinator, not as a second source of truth.

Default roles:

- **Coordinator:** plans, decomposes, freezes contracts, selects threads, reviews outputs, controls integration.
- **Writer:** one bounded implementation lane for the active slice unless current repository governance explicitly authorizes more.
- **Review threads:** read-only security, DB, offline, performance, accessibility, responsive, architecture, and regression review.
- **Verification thread:** tests, build, browser/evidence, migration/recovery checks.
- **Documentation thread:** drafts repository updates, release evidence, reconciliation records; it does not redefine scope.

Parallelism is useful only when it lowers critical-path time without creating merge or contract risk.

## 3. Writer rule

The default is **one active writer for one active slice**.

If current accepted repository authority explicitly permits isolated task writers, the coordinator may use them only with:

- non-overlapping ownership;
- frozen contracts;
- separate worktrees/branches;
- explicit merge order;
- repository-backed handoffs.

Otherwise, specialist threads return:

- findings;
- test evidence;
- patch suggestions;
- proposed diffs;
- task packets;

and the active writer applies them.

## 4. One-rule P0 policy

There is only one P0 rule:

> **A reproducible P0 blocks promotion/closure of the release that owns the affected behavior.**

A P0 does **not** prevent starting the release whose purpose is to reproduce and fix it.

Examples:

- A V2.0 review finding may be reproduced during RTV3-01.
- If confirmed P0, RTV3-01 cannot close until it is fixed or the owner formally reclassifies it with written rationale.
- RTV3-02 must not start while RTV3-01 owns an open reproducible P0.
- A later release may not ship with an open P0 in its scope.

No separate "deferrable P0" category exists.

## 5. Bounded — formal definition

A workload is **bounded** only when all of the following are explicit:

- the input population;
- the maximum item count or page size;
- the time/window range where applicable;
- the maximum payload size where applicable;
- the maximum retry/attempt behavior where applicable;
- a server-side or domain-level enforcement mechanism.

"Small," "reasonable," "recent," and "limited" are not bounds.

## 6. Release-size rule

Each numbered release should normally fit within **6–10 bounded implementation packets** plus review/verification.

If the accepted scope requires materially more, split it before implementation rather than weakening verification.

RTV3-01 has an explicit packet decomposition in its release card.

## 7. Context-economy rule

Do not paste the entire roadmap into implementation threads.

Coordinator context:
- coordinator card;
- constitution;
- active release card;
- relevant accepted spec;
- current repository state.

Implementation thread:
- task packet;
- frozen contracts;
- relevant code/files;
- required tests.

Reviewer:
- review objective;
- changed diff;
- relevant invariants;
- acceptance criteria.

## 8. Stop conditions

Stop the affected task if:

- active writer ownership conflicts;
- the accepted spec is missing or contradictory;
- a required contract is not frozen;
- destructive migration is unexpectedly required;
- a privacy boundary would be crossed;
- an AI model would need prohibited identity/evidence data;
- current provider capability invalidates an accepted assumption;
- the task creates a second operational truth;
- external action status is unknown after interruption.

Do not broaden scope to work around a stop condition.
