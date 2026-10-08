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
