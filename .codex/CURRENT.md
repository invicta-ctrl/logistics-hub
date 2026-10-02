# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-06_PARTLY_MERGED (2026-10-02): 6.1 (per-username login limit, stale-session sweep), 6.2 (backup and restore runbook) and 6.5a (focus, large-text and target-size fixes, accessibility spec) are on main: no migration, Self-Service stays closed by the `SELF_SERVICE` variable. 6.3 (Self-Service setting, migration 0018) and 6.4 (Owner-only retention, migration 0019) are built on `slice/part-06-plan` and are NOT merged: on 2026-10-02 neither migration was on production (read-only check of `d1_migrations`), and the Worker they ship reads `system_settings` on every staff session request, so merging first would lock staff out. Decision D1 (reconcile the plan with Earl's controlling prompt, unreadable from the cloud) is still open.
STATUS: PART_04_10_COMPLETE (2026-09-30): public pages load fresh from the network (only /self-service opens from the phone's cache), merged to main and deployed by Workers Builds (after Part 4.9's home banner, 4.8's Self-Service photo, 4.7's light/dark switch and 4.6's visual cleanup). Part 4 (with 4.5–4.10) is closed by Earl's confirmation on 2026-10-01 (owner confirmation, not an agent test run); it no longer gates Part 5.
BRANCH: slice/part-06-plan from baseline `c0c6e9963a9f846adf362a4ddeae683fc1eff375` (the Part 6.0 documentation-only exception stays on this slice pending Earl's plan decision). The known untracked `NUL` artifact remains preserved and uncommitted.
CLOUD_HANDOFF: .codex/SESSION_HANDOFF.md (current Part 6 continuity record; `.codex/PART_05_CLOUD_HANDOFF.md` is historical only)
ACTIVE_WRITER: none (claude-cloud yielded). The lock file is local to the Windows worktree and cannot be seen from the cloud, and codex's last recorded lock (06:29Z) was never yielded in the repo record: run `npm run agent:status` before writing locally and pull first.
SHARED_WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
PRODUCTION: Worker logistics-hub; D1 logistics-hub (binding DB); R2 logistics-hub-evidence (binding EVIDENCE, private); https://logistics.hausc.org; never hau-usc-logistics-production/staging
DEPLOYMENT: Workers Builds deploys every push to main; it does NOT apply D1 migrations. Migrations 0015, 0016, and 0017 are already applied to production and must never be blindly reapplied. Part 6.0 authorizes no production/provider mutation.
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
PART_06_PROPOSED_PLAN: docs/specs/proposed/2026-10-02-part-06-admin-hardening-plan.md (PROPOSED; not accepted)
SELF_SERVICE: CLOSED for maintenance on production since 2026-10-02 (PR #8; `SELF_SERVICE: "paused"` in wrangler.jsonc). Reopen only on Earl's instruction: set "open" and merge. While closed, ADMIN/OWNER test it in Administration (records held as TEST).
NEXT_EXACT_ACTION: Earl takes a dump and a Time Travel bookmark and applies 0018 and 0019 (docs/DEPLOYMENT.md, Part 6); then a session merges `slice/part-06-plan` (it already contains this main), runs the post-deploy checks listed there and deletes the slice branch. Never reapply 0015–0017; never reopen Self-Service without Earl.
