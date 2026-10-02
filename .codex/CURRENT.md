# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-05 PRODUCTION_ACCEPTED (2026-10-02): Part 5 core, Part 5B Open-Unit Tracking, the optional "Used gradually?" review view (PR #6), and clear Activity sentences for status/type changes (PR #7) are released. Production D1 migrations 0016 + 0017 were applied once and verified before Part 5B release. Earl confirmed the final signed-in Part 5B production acceptance check complete on 2026-10-02.
STATUS: PART_04_10_COMPLETE (2026-09-30): public pages load fresh from the network (only /self-service opens from the phone's cache), merged to main and deployed by Workers Builds (after Part 4.9's home banner, 4.8's Self-Service photo, 4.7's light/dark switch and 4.6's visual cleanup). Part 4 (with 4.5–4.10) is closed by Earl's confirmation on 2026-10-01 (owner confirmation, not an agent test run); it no longer gates Part 5.
BRANCH: slice/part-05-self-service-review-status (active: phones learn staff decisions). Merged and due for deletion: slice/part-05-self-service-admin-test. All other merged Part 5 branches are deleted remotely; local remote-tracking refs were pruned on 2026-10-02. The known untracked `NUL` artifact remains preserved and uncommitted.
CLOUD_HANDOFF: .codex/PART_05_CLOUD_HANDOFF.md
ACTIVE_WRITER: claude (Claude Cloud, slice/part-05-self-service-review-status)
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
SELF_SERVICE: CLOSED for maintenance on production since 2026-10-02 (PR #8; `SELF_SERVICE: "paused"` in wrangler.jsonc). Reopen only on Earl's instruction: set "open" and merge. While closed, ADMIN/OWNER test it in Administration (records held as TEST).
NEXT_EXACT_ACTION: (0) Earl tries Administration → Test Self-Service (PR #10, live) and dismisses his test records in Self-service. Part 6 (Admin + Hardening) only after a new accepted plan. No Part 5 acceptance work remains. Self-Service stays closed for maintenance until Earl instructs reopening. Never reapply 0015, 0016 or 0017.
