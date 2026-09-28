# Current Work Pointer — Logistics Hub
PROGRAM: Logistics Hub
MILESTONE: PART-01_YDD_GATEWAY_AND_FOUNDATION
STATUS: OWNER_ACCESS_COMPLETE_ON_MAIN; PRODUCTION_DEPLOY_AND_OWNER_BOOTSTRAP_PENDING_ON_EARL_PC
BRANCH: main
ACTIVE_WRITER: NONE
SHARED_WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
PRODUCTION: Worker logistics-hub; D1 logistics-hub (binding DB); never hau-usc-logistics-production/staging
PRODUCTION_STATE: read-only check 2026-09-28 — Worker deployed (older build); D1 migrations 0001–0009 applied; 397 items; 0 accounts. Pending: 0010, 0011.
ACCESS: roles STAFF/ADMIN/OWNER enforced by the Worker; Administration + My Account pages; Owner Console over the Admin API; owner recovery key (DPAPI pairing). No OWNER exists in production yet.
LAUNCHER: D:\Documents\Logi hub access\LOGISTICS_ADMIN.cmd (created by the console on first run on Earl's PC; not yet verified on Windows)
PREVIEW: http://127.0.0.1:8791 via npm run dev:live (LOCAL identities preview-owner / preview-admin / preview-staff)
RUNBOOK: docs/DEPLOYMENT.md (the one deployment and credential path)
SESSION_HANDOFF: .codex/SESSION_HANDOFF.md
SHARED_WORKFLOW: docs/SHARED_AGENT_WORKFLOW.md
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md
CURRENT_TASK: .codex/CURRENT_TASK.md
OPEN_PART_01_ITEMS: production deploy (0010, 0011) + verification; real OWNER bootstrap; D:\ launcher + DPAPI pairing + recovery verified on Windows
NEXT_EXACT_ACTION: on Earl's PC from clean main — npx wrangler login; LOGISTICS_ADMIN.cmd → 12 (status) → 13 (deploy) → 14 (first-time owner setup, Earl types his own credentials) → 8 (recovery check). Then set STATUS: COMPLETE_AND_PRODUCTION_VERIFIED.
