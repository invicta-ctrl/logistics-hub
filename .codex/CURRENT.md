# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
ROAD_TO_V2: V1.2 COMPLETE ON ITS BRANCH, WAITING ON OWNER ACTIONS (2026-10-02; `road-to-v2/v1.2-item-profiles-media`; record `docs/road-to-v2/releases/v1.2.md`; Earl must create the R2 bucket `logistics-hub-catalog-media` and apply migration 0020 before it is merged; V1.3 may start on top of it). V1.1 COMPLETE ON MAIN (2026-10-02). Earl declared V1 closed. V1.1 Experience Foundation is integrated: new staff shell (Items | Stock | Loans | Self-Service | Activity | Administration; avatar menu; phone bottom bar with More), `/staff/inventory` 301 to `/staff/items`, tokens and motion, `npm run evidence`, CI. Record: docs/road-to-v2/releases/v1.1.md. The order and rules for V1.2–V1.15 are in CLAUDE.md (re-sequenced 2026-10-02).
MILESTONE: PART-06_COMPLETE_ON_MAIN (2026-10-02): Part 6 is complete on main: 6.1 (per-username login limit, stale-session sweep), 6.2 (backup and restore runbook), 6.5a (focus, large-text and target-size fixes, accessibility spec), 6.3 (Self-Service open/closed setting in Administration, migration 0018) and 6.4 (Owner-only removal of old names, student IDs and photos, migration 0019). Earl applied 0018 and 0019 to production on 2026-10-02 before the merge (docs/DEPLOYMENT.md, Part 6). Decision D1 (reconcile the plan with Earl's controlling prompt, unreadable from the cloud) is still open.
STATUS: PART_04_10_COMPLETE (2026-09-30): public pages load fresh from the network (only /self-service opens from the phone's cache), merged to main and deployed by Workers Builds (after Part 4.9's home banner, 4.8's Self-Service photo, 4.7's light/dark switch and 4.6's visual cleanup). Part 4 (with 4.5–4.10) is closed by Earl's confirmation on 2026-10-01 (owner confirmation, not an agent test run); it no longer gates Part 5.
BRANCH: main (V1.1 merged by fast-forward). Next: `road-to-v2/v1.2-item-profiles-media`, which already carries V1.1 through forward propagation. Six superseded Road-to-V2 branch names await Earl's deletion (docs/specs/accepted/road-to-v2/2026-10-02-roadmap-amendments.md). The known untracked `NUL` artifact remains preserved and uncommitted.
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
NEXT_EXACT_ACTION: Earl: create the R2 bucket and apply migration 0020 (exact steps in `docs/road-to-v2/releases/v1.2.md`, OWNER_ACTIONS), then integrate V1.2 to `main`; delete the six superseded branch names. Or `start` on `road-to-v2/v1.3-staff-directory` (V1.2 is `STATUS: COMPLETE`, waiting on owner actions, so its predecessor gate passes; it must not depend on a photo existing in production). Never reapply 0015–0019; never reopen Self-Service without Earl.
