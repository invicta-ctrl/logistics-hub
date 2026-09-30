# Current Bounded Task — PART-05 Stage 5.1 (Activity read model and API)
INTENT: execute Stage 5.1 only
OBJECTIVE: unified Activity read model and `GET /api/staff/activity`, verified locally; checkpoint commit; stop before UI.
SCOPE: `src/activity.ts`, the route in `src/worker.ts`, reuse hooks in `src/self-service.ts` and `src/inventory.ts`, `tests/activity.test.ts`, index-only migration `0016_activity_feed_index.sql` (local only, never applied to production), checkpoint docs.
EXCLUDED: UI, CSV, Part 5B, new dependencies, provider/config/cloud writes, main integration, push, deploy, production migration. Never reapply 0015.
STATUS: Sentinel findings 1 and 2 (note privacy and missing reason/note context) repaired and verified locally; repair checkpoint committed on slice/part-05-activity. NOT accepted: the AC-A7 performance gate (attention/search, owned by Oracle) is OPEN. Sentinel reviews the combined candidate later.
