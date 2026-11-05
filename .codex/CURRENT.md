# Current Work Pointer — Logistics Hub

Rewritten 2026-11-05 at 09:40 UTC by the outgoing integration steward, at handoff. Earl stopped all work and is deleting every local Claude session, so whoever reads this next starts without chat history.

- Earlier versions of this pointer are in Git history. The pre-2026-11-05 336-line pointer is kept at [docs/archive/continuity/CURRENT_before_2026-11-05.md](../docs/archive/continuity/CURRENT_before_2026-11-05.md).
- A file cannot name its own commit. Each dated fact below says where it was observed.

## Read first

1. `AGENTS.md`: rules, writers, repository self-sufficiency, security review.
2. This file.
3. [SESSION_HANDOFF.md](SESSION_HANDOFF.md): the full instruction handoff for the next agent.
4. [docs/SHARED_AGENT_WORKFLOW.md](../docs/SHARED_AGENT_WORKFLOW.md).

The writer rules are [HAU-AGENT-LANES-003](../docs/specs/accepted/2026-11-05-claude-parallel-writer-lanes.md), amended by PR #90. Authority runs in this order: Earl's current instruction, then the accepted specification, then verified repository state, then the Context Vault.

## Writer slots (dated snapshot of the live roster, observed 2026-11-05 09:40 UTC)

- **Live roster:** `D:\Documents\HAU-USC Logistics Hub\handoffs\WRITER_ROSTER.md`, on Earl's PC. A copy is at [docs/archive/continuity/WRITER_ROSTER_2026-11-05.md](../docs/archive/continuity/WRITER_ROSTER_2026-11-05.md).
- **Account-wide limit:** at most two Claude file-writing sessions.
- **Steward:** **vacant.** The previous steward, session `local_c6813149…`, is being deleted. The next agent becomes steward only when Earl says so; it then logs "steward adoption" in the live roster (or, if it cannot reach that file, asks Earl to relay it).

| Slot | Holder | Task | State |
|---|---|---|---|
| A | none | — | free |
| B | none | — | free |

Released on 2026-11-05:
- HAU-PR89-W1 (PR #89);
- LH-RECORDS-01 (PR #90);
- Kawing KAW-GOV-01 (PR #5) and KAW-RECORDS-01 (PR #6);
- qrmenu QRM-PUBLISH-01;
- LH-UI-88 S1, whose writer was stopped before writing anything.

**Other checkouts on Earl's PC.** No new writer may write in these. Preserve all of them: never reset, clean, delete or switch them.
- `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`: branch `slice/v1.16-header-gridlines`, dirty, with an untracked `NUL`.
- `workspace\logistics-hub-v1164`.
- `repo\logistics-hub`: the clone the steward worktrees come from.
- `worktrees\photo-menu-race`: PR #89, merged.
- `worktrees\records-reconcile`: PR #90, merged.
- `worktrees\lh-ui-88-s1`: branch `slice/lh-ui-88-s1-foundations` at `35f230f`, no commits, local only.
- `worktrees\steward-handoff`: this branch.
- Detached Codex worktrees under `C:\Users\adria\.codex\worktrees`.
- Detached MausBot worktrees.

## Task board

| ID | Task | Spec | State | Next |
|---|---|---|---|---|
| LH-UI-88 | Issue #88 visual refresh, slices S1–S5 | [accepted spec](../docs/specs/accepted/2026-11-05-lh-ui-88-visual-refresh.md) and its [boards](../docs/specs/accepted/2026-11-05-lh-ui-88-boards/) | **accepted, not started** | S1 Foundations (V1.16.14), then S2 → S5 one at a time. They run serially because all share `src/styles.css`. SESSION_HANDOFF.md has the S1 brief. |
| STEWARD-HANDOFF | This records-only branch, `handoff/steward-2026-11-05` | — | pushed; not merged | Merge after Earl's go-ahead. It changes only `.codex/*` and an archive copy of the roster. |

**Issue #88** (<https://github.com/invicta-ctrl/logistics-hub/issues/88>). Each state is listed separately:
- design reference linked: yes;
- UI spec accepted: yes;
- mobile and desktop UI implemented: **no**;
- owner visually accepted: **no**.

It closes only after all five slices ship and Earl checks them. Board 01–03 was never supplied.

## Release states (a merge is not a deployment)

| Release | State | Evidence and where observed |
|---|---|---|
| V1.16.13 (closing-menu CSS from PR #89, named by PR #90) | **MERGED_DEPLOYMENT_UNVERIFIED** | PR #90 merged at head `41521ed` as `main` `35f230f` (2026-11-05, on Earl's "i approve all"). CI `checks`, `worker-e2e`, CodeQL and Workers Builds succeeded on `35f230f` (GitHub check runs, observed by the steward). Codex reviewed the exact head and found no major issues. `build.json` is not public, so the live version name was not observed. **Owed:** Earl's check of Administration > System > This version, which should read V1.16.13. Record: `docs/road-to-v2/releases/v1.16.13.md`. |
| V1.16.12 (pagination, PR #87) | DEPLOYED_OWNER_CHECK_PENDING | merged as `1e9a468`. 121 of 122 live assets were byte-identical to a local build. **Owed:** Earl's check of paging on a long list. |
| V1.16.7 – V1.16.11 | DEPLOYED_OWNER_CHECK_PENDING, as recorded | not re-verified |
| V1.16 (full release) | OPEN | `docs/specs/accepted/v1.16-ambient-intelligent-core.md` |

## Deploy gate (known behaviour, not a failure)

- **Why the run fails:**
  - The GitHub `Deploy` workflow is a dry run (`DEPLOY_FROM_CI=dry-run`).
  - It always fails at `scripts/ops/deploy-gate.mjs` on a commit made with the merge button, because GitHub adds the combined `CodeQL` check (app 57789) only to pull-request heads.
  - Since PR #90, the error message says exactly this.
- **What actually deploys:** production deploys `main` through Cloudflare **Workers Builds**.
- **What not to do:** don't approve the GitHub `Deploy` environment without Earl's exact go-ahead for that target. The V1.17 CI-only deploy switch is Earl's decision (`docs/road-to-v2/v1.17-ci-only-deploy-task.md`).
- **Owner Console:** option 13 is retired and refuses to run.

## Other repositories (observed 2026-11-05)

- **`invicta-ctrl/Kawing-Platform`:** `main` `12670de`; only `main` exists; no open PRs or issues. There, a qualifying independent AI review counts as technical approval. That rule does **not** apply in this repository.
- **`invicta-ctrl/Kawing-Platform-Prototype`** (formerly `qrmenu`, which redirects): `main` `525ea46`; only `main` exists; no open PRs or issues. The live Site serves a build that is byte-identical to `main`.
- **logistics-hub:** remote branches are `main` and `handoff/steward-2026-11-05`. The only open issue is #88. There are no open PRs.

## Next exact action

1. **Earl:** name the next steward. Approve merging `handoff/steward-2026-11-05` (open a PR from it first; it is records-only).
2. **New steward:** adopt the roster, then admit one S1 writer and run LH-UI-88 S1 with the brief in SESSION_HANDOFF.md.
3. **Earl:**
   - check Administration > System > This version: it should read V1.16.13;
   - check paging on a long list (V1.16.12);
   - visually accept each LH-UI-88 slice.
