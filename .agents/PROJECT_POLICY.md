# Logistics Hub Project Policy

STATUS: ACTIVE
AUTHORITATIVE_REPOSITORY: invicta-ctrl/logistics-hub

This repo supersedes the prior HAU-USC Logistics Management System for new development.

Public now: retained/ported YDD landing, Lending Hub, Staff Login. Logistics Request is unavailable.
Staff priority: Inventory/Catalog -> Stock/Pantry -> Lending -> Activity/Audit -> Admin/Hardening.

Technical: semantic HTML5, modern CSS, TypeScript/small JS modules, Cloudflare Worker, D1, R2. No React by default.

Every Part is a complete vertical slice: UI + validation + API + data + authorization + tests + browser flow. No fake completed routes.

Migration:
- Current Production spreadsheet is inventory truth.
- Legacy Current Inventory may fill unresolved metadata but never override current quantities/history.
- Latest Production scheduled backup is verification evidence.
- Staff migration is private. Never commit names, emails, student IDs, schedules, or roster exports.

Entry: AGENTS -> CURRENT -> CURRENT_TASK -> CURRENT_HANDOFF -> accepted spec -> Git handshake -> active slice only.
