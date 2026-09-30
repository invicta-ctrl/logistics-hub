# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-04.5_OFFLINE_SELF_SERVICE
STATUS: PART_04_5_RELEASED_AND_DEPLOYED (2026-09-30); automated production checks pass; owner phone + signed-in staff acceptance pending
BRANCH: main = slice/part-04-5-offline-self-service-pwa = 63e1b16 (manifest-link fix on top of merge 5a0f368). Both slice branches are fully merged; delete after owner acceptance.
ACTIVE_WRITER: none after this handoff (claude cloud yields); claim before editing
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
NEXT_EXACT_ACTION: Owner runs the signed-in acceptance in SESSION_HANDOFF (phone install, offline take/borrow/return syncs once, staff exception view, photo 200/401). Then delete slice/part-04-5-offline-self-service-pwa and slice/part-04-lending (both merged) and git fetch --prune. Do not reapply 0015. Do not start Part 5.
