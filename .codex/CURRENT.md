# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-01_YDD_GATEWAY_AND_FOUNDATION (launch, admin console, final polish)
STATUS: PART_01_COMPLETE_ON_MAIN; PRODUCTION_LAUNCH_READY_FROM_LOCAL_ADMIN_CONSOLE
BRANCH: main
ACTIVE_WRITER: NONE
SHARED_WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
SESSION_HANDOFF: .codex/SESSION_HANDOFF.md
SHARED_WORKFLOW: docs/SHARED_AGENT_WORKFLOW.md
DEPLOYMENT_RUNBOOK: docs/DEPLOYMENT.md
ADMIN_CONSOLE: npm run admin  (Windows: LOGISTICS_ADMIN.cmd)
LIVE_PREVIEW: http://127.0.0.1:8791 via npm run dev:live
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md
CURRENT_TASK: .codex/CURRENT_TASK.md
CURRENT_HANDOFF: .codex/CURRENT_HANDOFF.md
PRODUCTION_TARGET: Worker logistics-hub + D1 logistics-hub (binding DB, id in wrangler.jsonc); never hau-usc-logistics-production/staging
PRODUCTION_STATE: D1 has only 0001_core.sql applied (no data, verified 2026-09-28 read-only); Worker not deployed
PRODUCTION_DEPLOYMENT: AUTHORIZED_BY_EARL; NOT_YET_EXECUTED — the Claude cloud container cannot reach api.cloudflare.com and the Cloudflare connector cannot upload Workers
NEXT_EXACT_ACTION: on Earl's machine, npx wrangler login, then LOGISTICS_ADMIN.cmd → 7 (status) → 8 (deploy latest verified main) → 2 (create staff accounts on PRODUCTION).
