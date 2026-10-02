# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-06_COMPLETE_ON_MAIN (2026-10-02): Part 6 is complete on main: 6.1 (per-username login limit, stale-session sweep), 6.2 (backup and restore runbook), 6.5a (focus, large-text and target-size fixes, accessibility spec), 6.3 (Self-Service open/closed setting in Administration, migration 0018) and 6.4 (Owner-only removal of old names, student IDs and photos, migration 0019). Earl applied 0018 and 0019 to production on 2026-10-02 before the merge (docs/DEPLOYMENT.md, Part 6). Decision D1 (reconcile the plan with Earl's controlling prompt, unreadable from the cloud) is still open.
STATUS: PART_04_10_COMPLETE (2026-09-30): public pages load fresh from the network (only /self-service opens from the phone's cache), merged to main and deployed by Workers Builds (after Part 4.9's home banner, 4.8's Self-Service photo, 4.7's light/dark switch and 4.6's visual cleanup). Part 4 (with 4.5–4.10) is closed by Earl's confirmation on 2026-10-01 (owner confirmation, not an agent test run); it no longer gates Part 5.
BRANCH: main (no active slice). `slice/part-06-plan` is merged by fast-forward and due for deletion. The known untracked `NUL` artifact remains preserved and uncommitted.
CLOUD_HANDOFF: .codex/SESSION_HANDOFF.md (current Part 6 continuity record; `.codex/PART_05_CLOUD_HANDOFF.md` is historical only)
ACTIVE_WRITER: none (claude-cloud yielded after the 6.5b checkpoint). The lock file is local to the Windows worktree and cannot be seen from the cloud, and codex's last recorded lock (06:29Z) was never yielded in the repo record: run `npm run agent:status` before writing locally and pull this branch first.
SHARED_WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
PRODUCTION: Worker logistics-hub; D1 logistics-hub (binding DB); R2 logistics-hub-evidence (binding EVIDENCE, private); https://logistics.hausc.org; never hau-usc-logistics-production/staging
DEPLOYMENT: Workers Builds deploys every push to main; it does NOT apply D1 migrations. Migrations 0015–0019 are applied to production and must never be blindly reapplied (0018 and 0019 on 2026-10-02, by Earl).
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
PART_06_PLAN: docs/specs/proposed/2026-10-02-part-06-admin-hardening-plan.md (built and merged on Earl's instruction of 2026-10-02; section 6 is the outcome; D1 open; not formally accepted)
SELF_SERVICE: CLOSED for maintenance on production since 2026-10-02 (PR #8). It is now a setting (Administration → Self-Service on phones, Administrator or Owner; stored in `system_settings`, seeded closed by migration 0018, audited); the `wrangler.jsonc` variable no longer exists. Reopen only on Earl's instruction. While closed, ADMIN/OWNER test it in Administration (records held as TEST).
NEXT_EXACT_ACTION: Earl's signed-in acceptance on production: Administration reads *Closed for maintenance* for Self-Service on phones, *Old personal details* (Owner) lists nothing, the staff pages still load; plus decision D1 and whether to keep the per-username login limit, which an attacker who knows a username can use to keep that account blocked for most of each 15 minutes (plan section 4, trade-off). Earl's PC worktree is at 44c5cbf with uncommitted edits to four docs: review `git diff` there before pulling (the migrations were applied from a clean temporary clone). Never reapply 0015–0019; never reopen Self-Service without Earl.
