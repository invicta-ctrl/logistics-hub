# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-04_LENDING
STATUS: PART_04_PRODUCTION_PARTIAL (deployed; photo upload/access acceptance remains blocked by browser tooling)
BRANCH: main (slice/part-04-lending retained pending production acceptance)
ACTIVE_WRITER: codex (Earl confirmed Claude's lock was stale; yielded and claimed via agent scripts)
SHARED_WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
PRODUCTION: Worker logistics-hub; D1 logistics-hub (binding DB); R2 logistics-hub-evidence (binding EVIDENCE, created 2026-09-29, private: no custom domain or r2.dev access); https://logistics.hausc.org; never hau-usc-logistics-production/staging
DEPLOYMENT: Workers Builds deploys every push to main; it does NOT apply D1 migrations or create buckets. R2 bucket private and remote 0014 verified; merge/push main and verify deployed runtime.
PREVIEW: http://127.0.0.1:8791 via npm run dev:live
PRODUCT_REFERENCE: docs/PRODUCT_REFERENCE.md (reference only; never overrides Earl, accepted specs, or repo state)
RUNBOOK: docs/DEPLOYMENT.md
SESSION_HANDOFF: .codex/SESSION_HANDOFF.md
SHARED_WORKFLOW: docs/SHARED_AGENT_WORKFLOW.md
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md
CURRENT_TASK: .codex/CURRENT_TASK.md
PART_04_BRIEF: .codex/PART_04_BRIEF.md
NEXT_EXACT_ACTION: Re-run synthetic production photo upload/access/return acceptance from a browser with local-file upload enabled; do not mark PART_04_COMPLETE or delete the slice until evidence upload, authenticated retrieval, unauthorized rejection, and return outcomes are directly verified in production.
