# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-05 COMPLETE (2026-10-02; follow-ups: the optional "Used gradually?" review view, PR #6, and clear Activity sentences for status and type changes, PR #7, `main` 8e80023): Part 5B Open-Unit Tracking RELEASED: production D1 migrations 0016 + 0017 applied by Earl with `wrangler d1 migrations apply DB --remote` (Claude's read-only post-checks match the pre-change snapshot), then `main` fast-forwarded d24de85..c00d43d (PR #5, merged) by Claude Cloud; Workers Builds deploys it. Part 5 core was released 2026-10-01.
STATUS: PART_04_10_COMPLETE (2026-09-30): public pages load fresh from the network (only /self-service opens from the phone's cache), merged to main and deployed by Workers Builds (after Part 4.9's home banner, 4.8's Self-Service photo, 4.7's light/dark switch and 4.6's visual cleanup). Part 4 (with 4.5–4.10) is closed by Earl's confirmation on 2026-10-01 (owner confirmation, not an agent test run); it no longer gates Part 5.
BRANCH: main (no active slice). Merged and due for deletion: slice/part-05-activity-sentences, slice/part-05-open-unit-candidates, slice/part-05b-open-units, slice/part-05-activity-fixes, handoff/part-05-activity-cloud (the cloud session cannot delete remote branches).
CLOUD_HANDOFF: .codex/PART_05_CLOUD_HANDOFF.md
ACTIVE_WRITER: none (Claude Cloud yields after the Part 5B checkpoint); claim before editing
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
NEXT_EXACT_ACTION: (1) Earl checks Part 5B signed in on production: set a ream-type Consumable to "Open and use gradually", open a unit, record a use, mark it empty (on hand −1), check History and Activity; on a phone the item shows Use. (2) Delete the merged branches. (3) Part 6 (Admin + Hardening) only after a new accepted plan. Never reapply 0015, 0016 or 0017.
