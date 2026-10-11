# AGENTS.md — Logistics Hub

Read, in order:
1. `.agents/PROJECT_POLICY.md`
2. `.codex/CURRENT.md`
3. `.codex/SESSION_HANDOFF.md`
4. `docs/SHARED_AGENT_WORKFLOW.md`
5. the active accepted spec/task

Authority: Earl current instruction -> accepted spec/amendment -> verified repository state -> Context Vault.

## Road-to-V3 command routing

When the owner says `start RTV`, `start RTV3`, `continue RTV`, `continue RTV3`, or names an `RTV3-XX` milestone, Codex, Claude, and Forge must use the **single normative** entry point in `docs/road-to-v3/00_COORDINATOR_CARD.md` ("Owner command entry point") after following the authority chain above. Do not invoke the historical Road-to-V2 branch runner. A short command never waives an accepted specification, owner acceptance gate, writer lock, production preflight, migration controls, or the one-slice branch policy. Architectural and security corrections needed for a milestone ship with that milestone under `docs/road-to-v3/01_ENGINEERING_CONSTITUTION.md`.

Product versions for Road to V3 are **V2.1–V2.9**, one-to-one with RTV3-01–RTV3-09, then V3.0 GA. `start/continue V2.x` resolves through the same Coordinator Card. V2.1 F4 includes a truthful deployed product-version label in the existing Administration → System view, separately from the build hash.

## Non-negotiables

- Writable/local-preview worktree: `D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`.
- Approved MausBot Scout, Oracle, Sentinel, and Harbor worktrees are detached/read-only specialist worktrees under the accepted MausBot amendment.
- One active writer. Codex, Claude, or Forge must claim the writer lock before edits; yield before handoff.
- The writable worktree uses the one active slice branch. No Codex/Claude/MausBot-specific long-lived branches.
- Claude Cloud must commit and push each coherent working checkpoint to the one active `slice/*` branch so the local preview can auto-sync it. Unpushed cloud edits cannot appear locally.
- `main` is always the latest verified working product.
- At most one active short-lived `slice/<part>-<scope>` branch.
- A finished green slice is merged to `main` immediately and its branch is deleted/pruned.
- Never put a knowingly broken/incomplete slice on `main`.
- Preserve unknown work; no destructive reset/clean/history rewrite.
- Public repo: no staff/borrower PII, credentials, provider IDs, private exports, or private evidence.
- D1 structured truth; R2 evidence; inventory quantity is movement-derived. Rules for extending the data model: `docs/DATA_ARCHITECTURE.md`; for performance, bounded work and reliability: `docs/PERFORMANCE_RELIABILITY_DOCTRINE.md`.
- HTML5/CSS/TypeScript-first. No SPA framework without accepted amendment.
- Production/provider writes require explicit target/authority and rollback controls.
- Production preparation for a release (an R2 bucket, a D1 migration) runs only through the Cloud Operations lane: the GitHub `production` environment, `.github/workflows/production-ops.yml` and `ops/releases/<release>.json` (`docs/specs/accepted/2026-10-02-cloud-operations-amendment.md`). Never from a PC, never on a push.

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
