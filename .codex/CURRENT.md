# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-04_LENDING (production acceptance open) → PART-04.5_OFFLINE_SELF_SERVICE (code complete on its slice)
STATUS: PART_04_PRODUCTION_PARTIAL (unchanged: photo upload/access/return acceptance still to be run by Earl) · PART_04_5_CODE_COMPLETE (local gates green; not merged, not deployed)
BRANCH: main = 41d00fe (unchanged). Active slice: slice/part-04-5-offline-self-service-pwa. slice/part-04-lending retained until Part 4 acceptance (already contained in main).
ACTIVE_WRITER: none (Claude Code Cloud yielded 2026-09-29 after pushing the Part 4.5 slice); claim before editing
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
NEXT_EXACT_ACTION: (1) Earl runs the remaining Part 4 production acceptance (photo upload, authenticated retrieval, unauthorized rejection, return outcomes) and closes Part 4. (2) Apply remote migration 0015 exactly once and verify (including its trigger). (3) Fast-forward main to the Part 4.5 slice, push, verify the deploy (docs/DEPLOYMENT.md), then delete both slice branches. Do not start Part 5.
