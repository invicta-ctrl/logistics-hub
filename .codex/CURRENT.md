# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-05_ACTIVITY_ACCOUNTABILITY core (stages 5.1–5.4) CODE COMPLETE on handoff/part-05-activity-cloud (Claude Cloud, 2026-10-01): Activity read model/API, `/staff/activity` page, safe audited CSV export, polish; all local gates green; production counts recorded; PR to `main` opened; awaiting Sentinel verification of the exact head and Earl's merge. Not merged, not deployed.
STATUS: PART_04_10_COMPLETE (2026-09-30): public pages load fresh from the network (only /self-service opens from the phone's cache), merged to main and deployed by Workers Builds (after Part 4.9's home banner, 4.8's Self-Service photo, 4.7's light/dark switch and 4.6's visual cleanup). Part 4 (with 4.5–4.10) is closed by Earl's confirmation on 2026-10-01 (owner confirmation, not an agent test run); it no longer gates Part 5.
BRANCH: handoff/part-05-activity-cloud (the one active Part 5 slice, owner-approved WIP branch; holds slice/part-05-activity plus the cloud continuation). After merge and production verification it is deleted and pruned; local `slice/part-05-activity` is then obsolete (fast-forwardable to this branch, no unique commits).
CLOUD_HANDOFF: .codex/PART_05_CLOUD_HANDOFF.md
ACTIVE_WRITER: none (Claude Cloud yields after the Part 5 core checkpoint); claim before editing
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
NEXT_EXACT_ACTION: (1) Sentinel verifies the exact head of handoff/part-05-activity-cloud (the PR head) against plan section 2.8 / prompt section 8; findings go back to a writer and need re-verification. (2) Earl decides the merge of the PR into `main` (every push to `main` deploys; Part 5 needs no migration and no binding; `0016` is optional and separately authorized). (3) After the deploy: the production checks in docs/DEPLOYMENT.md (Activity, search, filters, Load older; one full Export CSV, which also settles whether the Workers plan's CPU limit allows a large file; the owner sees the export under Accounts & exports; signed-out export refused). (4) Delete and prune the slice branches (remote handoff/part-05-activity-cloud, local slice/part-05-activity) once merged. (5) Only then Part 5B (A12 Open-Unit Tracking) on slice/part-05b-open-units from fresh `main`; its migration needs its own production authorization. Owner prompt source: docs/specs/accepted/2026-10-01-part-05-owner-master-prompt.md.
