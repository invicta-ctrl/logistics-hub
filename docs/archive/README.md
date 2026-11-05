# Archive index

Superseded working documents, kept byte for byte so no history is lost. **Nothing here is current instruction.** Read `AGENTS.md` first, then the live pointers named in [DOCUMENTATION_STATUS.md](../DOCUMENTATION_STATUS.md). Relative links inside an archived file point where they pointed at its original path; they may not resolve from here. The same text is also in Git history.

| Archived file | Was | Archived | Replaced by |
|---|---|---|---|
| [continuity/CURRENT_before_2026-11-05.md](continuity/CURRENT_before_2026-11-05.md) | `.codex/CURRENT.md` at `main` `1e9a468`: 336 lines of per-slice pointers from 2026-10-15 to V1.16.12 | 2026-11-05 (PR #89) | `.codex/CURRENT.md`: one truthful task board |
| [continuity/SESSION_HANDOFF_before_2026-11-05.md](continuity/SESSION_HANDOFF_before_2026-11-05.md) | `.codex/SESSION_HANDOFF.md` at `main` `1e9a468`: handoffs from V1.16.7 and earlier | 2026-11-05 (PR #89) | `.codex/SESSION_HANDOFF.md`: the last and next step only |
| [agent-workflows/SHARED_AGENT_WORKFLOW_before_2026-11-05.md](agent-workflows/SHARED_AGENT_WORKFLOW_before_2026-11-05.md) | `docs/SHARED_AGENT_WORKFLOW.md` at `main` `1e9a468`: the Codex + Claude two-lane and shared-worktree rhythm (HAU-AGENT-LANES-002) | 2026-11-05 (PR #89) | `docs/SHARED_AGENT_WORKFLOW.md` under [HAU-AGENT-LANES-003](../specs/accepted/2026-11-05-claude-parallel-writer-lanes.md) |

Rules for this folder (also in `AGENTS.md`, "Repository self-sufficiency"):

1. Archive by copying the exact prior content, then shorten the live file. Never delete evidence to make the live file tidy.
2. Add a row above with the date, the PR and what replaced it. Do not archive a file twice under the same name; use a new date.
3. Accepted specifications stay in `docs/specs/accepted/` and are marked superseded in place (HAU-AGENT-LANES-002 is the example). Release records and evidence stay where they are.
