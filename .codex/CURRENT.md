# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-05_ACTIVITY_ACCOUNTABILITY (accepted; stage 5.1 Activity API/read model checkpointed locally with the note-privacy repair, performance gate AC-A7 open, no UI yet)
STATUS: PART_04_10_COMPLETE (2026-09-30): public pages load fresh from the network (only /self-service opens from the phone's cache), merged to main and deployed by Workers Builds (after Part 4.9's home banner, 4.8's Self-Service photo, 4.7's light/dark switch and 4.6's visual cleanup). Part 4 (with 4.5–4.10) is closed by Earl's confirmation on 2026-10-01 (owner confirmation, not an agent test run); it no longer gates Part 5.
BRANCH: slice/part-05-activity (the one active slice; local only, not pushed; carries the acceptance docs checkpoint).
ACTIVE_WRITER: none after the repair checkpoint (forge yields); claim before editing
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
NEXT_EXACT_ACTION: Oracle resolves the Stage 5.1 attention/search performance design (AC-A7 stays open; no owner amendment approved); Sentinel then reviews the combined Stage 5.1 candidate on slice/part-05-activity (see SESSION_HANDOFF, top section). Only after that review and any fixes does Stage 5.2 (the Activity page) start on the same branch. Migration 0016 (index-only) is NOT applied anywhere; the API works without it, only slower, and applying it to production needs its own explicit authorization. Do not merge or push main (every push deploys). Open-Unit slice (slice/part-05b-open-units) still starts only after Part 5 core is merged to main and the slice is pruned. Owner prompt source: docs/specs/accepted/2026-10-01-part-05-owner-master-prompt.md.
