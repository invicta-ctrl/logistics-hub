# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-04_LENDING
STATUS: PART_04_IN_PROGRESS (features verified on the slice; review-and-improve pass in progress)
BRANCH: slice/part-04-lending
ACTIVE_WRITER: claude
SHARED_WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
PRODUCTION: Worker logistics-hub; D1 logistics-hub (binding DB); R2 logistics-hub-evidence (binding EVIDENCE, not yet created); https://logistics.hausc.org; never hau-usc-logistics-production/staging
DEPLOYMENT: Workers Builds deploys every push to main; it does NOT apply D1 migrations or create buckets. Create the R2 bucket and apply 0014 before pushing main.
PREVIEW: http://127.0.0.1:8791 via npm run dev:live
PRODUCT_REFERENCE: docs/PRODUCT_REFERENCE.md (reference only; never overrides Earl, accepted specs, or repo state)
RUNBOOK: docs/DEPLOYMENT.md
SESSION_HANDOFF: .codex/SESSION_HANDOFF.md
SHARED_WORKFLOW: docs/SHARED_AGENT_WORKFLOW.md
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md
CURRENT_TASK: .codex/CURRENT_TASK.md
PART_04_BRIEF: .codex/PART_04_BRIEF.md
NEXT_EXACT_ACTION: Finish the review-and-improve pass on slice/part-04-lending, re-run all gates, push the slice. Merge to main only after Earl creates the R2 bucket and applies 0014 to production.
