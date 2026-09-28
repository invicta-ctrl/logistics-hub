# Shared Agent Workflow — Codex + Claude

## One workspace, one writer

Authoritative local worktree:

`D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`

Codex and Claude must both open this same folder.

There is only one active writer at a time. Do not create a second worktree for the same active Part.

Before editing:

```powershell
npm run agent:status
npm run agent:claim -- codex
```

or:

```powershell
npm run agent:claim -- claude
```

If another agent owns the lock, do not write. Read the handoff and wait for the owner to yield.

## Live local preview

Keep the full local application visible while development happens:

```powershell
npm run dev:live
```

Open:

`http://127.0.0.1:8791`

The live runner:
- prepares safe loopback-only development authentication when missing;
- applies local D1 migrations;
- builds the application once;
- watches frontend builds;
- runs the local Cloudflare Worker/D1 stack;
- never touches remote Cloudflare resources.

The preview uses the same worktree both agents edit. Refresh the browser after a change to see the newest full-stack build.

Local preview credentials are generated into ignored local-only files under `data/private/`. Never commit them.

## Turn-taking

The current agent owns the worktree until it explicitly yields.

A normal handoff is:

1. Stop starting new unrelated work.
2. Finish the nearest coherent atomic change.
3. Run the most relevant tests/typecheck.
4. Review `git status` and the diff.
5. Update `.codex/SESSION_HANDOFF.md`.
6. Update `.codex/CURRENT.md` if milestone/task state changed.
7. Commit a safe checkpoint whenever practical.
8. Release the lock:
   `npm run agent:yield -- <agent>`
9. Tell the next agent the exact commit and exact next action.

The next agent:

1. Opens this same worktree.
2. Reads AGENTS.md / CLAUDE.md as applicable.
3. Reads `.codex/CURRENT.md`, `CURRENT_HANDOFF.md`, and `SESSION_HANDOFF.md`.
4. Runs `npm run agent:status`.
5. Claims the lock.
6. Verifies HEAD/status and continues the exact next action.

## Low-usage handoff rule

When the platform reports roughly 25% or less usage remaining, or gives any imminent limit warning:

- do not begin a new large subtask;
- switch into handoff mode immediately;
- finish the smallest safe atomic unit already in progress;
- preserve a compiling/testable state whenever possible;
- update SESSION_HANDOFF before doing optional polish.

At roughly 15% or less remaining:
- only verification, documentation, checkpointing, and handoff are allowed;
- do not start new implementation.

The goal is that usage exhaustion never strands undocumented work.

## Dirty state rule

Uncommitted work is allowed while one agent owns the lock.

It must never be handed off without a precise SESSION_HANDOFF entry containing:
- active agent;
- branch + HEAD;
- what changed;
- files currently dirty;
- what is complete;
- what is incomplete;
- verification already run;
- exact next command/action;
- known risks/blockers.

Prefer small checkpoint commits over large uncommitted sessions.

## Preview ownership

The local preview is shared infrastructure, not agent-owned.

Do not kill/restart it just because ownership changes unless it is unhealthy or configuration changed.

If port 8791 is already active, use the existing preview.

## Production boundary

Local preview only unless Earl separately authorizes provider/Production changes.

Never reuse or mutate old HAU-USC Logistics production/staging resources as part of normal local development.
