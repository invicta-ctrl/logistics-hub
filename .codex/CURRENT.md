# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-03_STOCK_AND_PANTRY
STATUS: PART_03_VERIFIED_ON_SLICE; MERGE_WAITS_FOR_REMOTE_MIGRATION_0013
BRANCH: slice/part-03-stock-pantry
ACTIVE_WRITER: claude (until merge and handoff)
SHARED_WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
PRODUCTION: Worker logistics-hub; D1 logistics-hub (binding DB); https://logistics.hausc.org; never hau-usc-logistics-production/staging
DEPLOYMENT: Workers Builds deploys every push to main; it does NOT apply D1 migrations. Apply additive migrations to production before pushing main.
PREVIEW: http://127.0.0.1:8791 via npm run dev:live
PRODUCT_REFERENCE: docs/PRODUCT_REFERENCE.md (reference only; never overrides Earl, accepted specs, or repo state)
RUNBOOK: docs/DEPLOYMENT.md
SESSION_HANDOFF: .codex/SESSION_HANDOFF.md
SHARED_WORKFLOW: docs/SHARED_AGENT_WORKFLOW.md
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md
CURRENT_TASK: .codex/CURRENT_TASK.md
PART_03_BRIEF: .codex/PART_03_BRIEF.md
NEXT_EXACT_ACTION: Earl applies migration 0013 to production D1 (additive; safe for the live code), then Claude fast-forwards main to the slice, pushes, confirms the Workers Builds deploy, and prunes the slice.
