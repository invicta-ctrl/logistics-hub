# AGENTS.md — Logistics Hub

Read, in order:
1. `.agents/PROJECT_POLICY.md`
2. `.codex/CURRENT.md`
3. `.codex/SESSION_HANDOFF.md`
4. `docs/SHARED_AGENT_WORKFLOW.md`
5. the active accepted spec/task

Authority: Earl current instruction -> accepted spec/amendment -> verified repository state -> Context Vault.

## Non-negotiables

- Shared worktree only: `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`.
- One active writer. Claim the writer lock before edits; yield before handoff.
- Both agents use the same active slice branch. No Codex/Claude-specific branches.
- `main` is always the latest verified working product.
- At most one active short-lived `slice/<part>-<scope>` branch.
- A finished green slice is merged to `main` immediately and its branch is deleted/pruned.
- Never put a knowingly broken/incomplete slice on `main`.
- Preserve unknown work; no destructive reset/clean/history rewrite.
- Public repo: no staff/borrower PII, credentials, provider IDs, private exports, or private evidence.
- D1 structured truth; R2 evidence; inventory quantity is movement-derived.
- HTML5/CSS/TypeScript-first. No SPA framework without accepted amendment.
- Production/provider writes require explicit target/authority and rollback controls.

## Anti-bloat

Make the smallest durable change.

Before creating a new file/helper/dependency/abstraction, ask:
1. Can the existing code do this clearly?
2. Is this needed by the current accepted slice?
3. Does this reduce complexity rather than move it somewhere else?

Avoid speculative architecture, generic frameworks, duplicate helpers/configs/docs, unused future hooks, excessive comments, redundant tests, and compatibility layers with no current consumer.

When replacing code, remove the obsolete path after verification. Do not leave two ways to do the same thing.

Keep modules cohesive and readable. Optimize for a future agent understanding the change quickly, not for theoretical extensibility.

## Working rhythm

- One bounded atomic change.
- Verify it.
- Commit when it is working.
- Continue.
- When the whole slice is green, integrate it into `main`, prune the slice branch, then start the next slice from fresh `main`.

Keep `npm run dev:live` available at `http://127.0.0.1:8791` when practical.

## Usage-limit handoff

At ~25% remaining usage or an imminent-limit warning:
- stop starting large work;
- finish the smallest safe atomic unit;
- run relevant verification;
- update SESSION_HANDOFF;
- commit a safe checkpoint when practical.

At ~15%:
- no new implementation;
- only verify, document, checkpoint, and yield.

Never leave undocumented unfinished work.
