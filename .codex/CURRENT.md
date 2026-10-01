# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-05_ACTIVITY_ACCOUNTABILITY (accepted; stage 5.1 Activity API/read model corrected twice per owner decisions A and B(ii), Sentinel F1/F2 and AC-A7 evidence in docs/ACTIVITY_PERF.md, checkpointed locally, awaiting Sentinel review; no UI yet)
STATUS: PART_04_10_COMPLETE (2026-09-30): public pages load fresh from the network (only /self-service opens from the phone's cache), merged to main and deployed by Workers Builds (after Part 4.9's home banner, 4.8's Self-Service photo, 4.7's light/dark switch and 4.6's visual cleanup). Part 4 (with 4.5–4.10) is closed by Earl's confirmation on 2026-10-01 (owner confirmation, not an agent test run); it no longer gates Part 5.
BRANCH: slice/part-05-activity (the one active slice; local only, not pushed; carries the acceptance docs checkpoint).
ACTIVE_WRITER: none after the second correction checkpoint (forge yields); claim before editing
SHARED_WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
PRODUCTION: Worker logistics-hub; D1 logistics-hub (binding DB); R2 logistics-hub-evidence (binding EVIDENCE, private); https://logistics.hausc.org; never hau-usc-logistics-production/staging
DEPLOYMENT: Workers Builds deploys every push to main; it does NOT apply D1 migrations. Migration 0015 is already applied to production; never reapply it. Part 5 authorizes no production write: any new migration needs its own explicit authorization, and code that depends on an unapplied migration must not reach main first (docs/DEPLOYMENT.md).
PREVIEW: http://127.0.0.1:8791 via npm run dev:live (follows the pushed slice)
PRODUCT_REFERENCE: docs/PRODUCT_REFERENCE.md (reference only; never overrides Earl, accepted specs, or repo state)
RUNBOOK: docs/DEPLOYMENT.md
SESSION_HANDOFF: .codex/SESSION_HANDOFF.md
SHARED_WORKFLOW: docs/SHARED_AGENT_WORKFLOW.md
WORKFLOW_AMENDMENT: docs/specs/accepted/2026-09-30-mausbot-multi-worktree-amendment.md
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md
CURRENT_TASK: .codex/CURRENT_TASK.md
PART_04_BRIEF: .codex/PART_04_BRIEF.md
PART_04_5_BRIEF: .codex/PART_04_5_BRIEF.md
PART_04_6_BRIEF: .codex/PART_04_6_BRIEF.md
ACCEPTED_PART_05: docs/specs/accepted/2026-09-30-part-05-activity-accountability-plan.md (ACCEPTED 2026-10-01; Acceptance record at the top; Part 5 core, visual-cleanup record, Open-Unit Tracking A12)
NEXT_EXACT_ACTION: Sentinel passed code, regression and harness at 3204cba; the overall Stage 5.1 gate is pending production-scale evidence (Harbor's read-only counts and index names, Nexus receives them) and Sentinel's final gate result (see SESSION_HANDOFF, top section; AC-A7 evidence in docs/ACTIVITY_PERF.md). Only after both, and any fixes, does Stage 5.2 (the Activity page) start on the same branch. The CSV (5.3) must blank Loan and Phone/Self-Service free-text reason/note fields (owner decision B ii); not built. Migration 0016 (index-only) is applied to the disposable in-memory test databases (migratedD1) only; its production D1 / persistent state is NOT yet verified (Harbor performs Earl's approved read-only check of five table counts and the five 0016 index names; the result is not recorded until it arrives). The API works without it, only slower, and APPLYING it to production still needs its own explicit authorization. Do not merge, push or publish anything for the partial Stage 5.1; per Earl's 2026-10-01 decision (plan, owner decisions) each COMPLETED and verified Part is published to GitHub (PR) and then merged to main, only after it is shown working (every push to main deploys). Open-Unit slice (slice/part-05b-open-units) still starts only after Part 5 core is merged to main and the slice is pruned. Owner prompt source: docs/specs/accepted/2026-10-01-part-05-owner-master-prompt.md.
