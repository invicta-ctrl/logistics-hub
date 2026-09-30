# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-04.7_SELF_SERVICE_THEMES
STATUS: PART_04_7_COMPLETE (2026-09-30): Self-Service light/dark switch, merged to main and deployed by Workers Builds (Part 4.6 visual cleanup before it). Part 4.5 owner phone + signed-in staff acceptance still pending (it gates Part 5).
BRANCH: main (no active slice).
ACTIVE_WRITER: none; claim before editing
SHARED_WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
PRODUCTION: Worker logistics-hub; D1 logistics-hub (binding DB); R2 logistics-hub-evidence (binding EVIDENCE, private); https://logistics.hausc.org; never hau-usc-logistics-production/staging
DEPLOYMENT: Workers Builds deploys every push to main; it does NOT apply D1 migrations. Part 4.5 adds migration 0015 (additive, safe for the live Part 4 code) and no binding: apply 0015 remotely, verify, then merge/push main (docs/DEPLOYMENT.md, "Migration 0015").
PREVIEW: http://127.0.0.1:8791 via npm run dev:live (follows the pushed slice)
PRODUCT_REFERENCE: docs/PRODUCT_REFERENCE.md (reference only; never overrides Earl, accepted specs, or repo state)
RUNBOOK: docs/DEPLOYMENT.md
SESSION_HANDOFF: .codex/SESSION_HANDOFF.md
SHARED_WORKFLOW: docs/SHARED_AGENT_WORKFLOW.md
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md
CURRENT_TASK: .codex/CURRENT_TASK.md
PART_04_BRIEF: .codex/PART_04_BRIEF.md
PART_04_5_BRIEF: .codex/PART_04_5_BRIEF.md
PART_04_6_BRIEF: .codex/PART_04_6_BRIEF.md
NEXT_EXACT_ACTION: Owner runs the signed-in phone acceptance in SESSION_HANDOFF and looks over the Part 4.6 visuals and the Part 4.7 theme switch (decisions in PART_04_6_BRIEF). Part 5 and Open-Unit Tracking (A12) stay PROPOSED until Earl accepts them. Do not reapply 0015.
