# AGENTS.md — Logistics Hub

Read `.agents/PROJECT_POLICY.md`, `.codex/CURRENT.md`, `.codex/SESSION_HANDOFF.md`, and `docs/SHARED_AGENT_WORKFLOW.md` before edits.

Authority: Earl current instruction -> accepted spec/amendment -> verified repository state -> Context Vault.

Rules:
- One complete vertical slice at a time; every finished Part must function without a later Part.
- Codex and Claude share one authoritative worktree: `D:\\Documents\\HAU-USC Logistics Hub\\workspace\\logistics-hub`. Do not create a second active worktree for the same Part.
- Exactly one active writer at a time. Claim the local writer lock before edits with `npm run agent:claim -- codex` or `npm run agent:claim -- claude`; yield it before handoff.
- Verify root/branch/HEAD/status/writer before editing. Preserve unknown work; no reset/clean/history rewrite.
- Public repo: never commit staff/borrower PII, credentials, provider IDs, private exports, or evidence.
- D1 is structured truth; R2 stores evidence; stock quantity is derived from append-only movements.
- HTML5/CSS/TypeScript-first. React/SPA frameworks require an accepted amendment.
- Old HAU-USC Logistics repo is landing/domain/migration reference only, not an implementation baseline.
- Production/provider writes require exact target, preflight, backup/rollback, owner approval and post-change verification.
- Keep the local full-stack preview available with `npm run dev:live` at `http://127.0.0.1:8791` when practical.
- If usage falls near 25% or the platform warns of an imminent limit, stop starting large work and enter handoff mode. At ~15%, only verify, document, checkpoint, and yield. Never strand undocumented work.
