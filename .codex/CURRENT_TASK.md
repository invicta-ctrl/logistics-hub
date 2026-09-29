# Current Bounded Task — PART-04.5 Offline Self-Service + PWA + Single QR + Sync/Reconciliation
INTENT: FEATURE_IMPLEMENTATION + PRODUCT POLISH + PERFORMANCE
OBJECTIVE: Earl's 2026-09-29 Part 4.5 instruction (see .codex/PART_04_5_BRIEF.md): one permanent QR → /self-service on people's own phones (Take, Borrow, Return, My activity), an installable PWA that keeps working offline, an IndexedDB event queue, idempotent sync, reconciliation across phones, a staff exception view, private photos, update behaviour, tests and docs.
IN_SCOPE: migration 0015; src/self-service.ts; src/loans.ts (shared lending statements); src/offline-{queue,store,sync}.ts; src/sw.ts + vite.config.ts; src/pwa.ts; src/self-service-app.ts + .css; src/self-service-review.ts; staff integration (item toggle, view, nav); public/manifest.webmanifest, public/icons, public/qr; tests; docs/OFFLINE_SELF_SERVICE.md, docs/PWA_INSTALL_GUIDE.md.
OUT_OF_SCOPE: offline staff actions (no offline credentials), global settings/kill switch and server-side retention purge (Part 6), exports and the activity center (Part 5), multi-item loans, borrower accounts.
BRIEF: .codex/PART_04_5_BRIEF.md
STATUS: CODE_COMPLETE on the slice (local gates green). Merge to main waits for (1) Part 4 production acceptance and (2) remote migration 0015, in that order; see .codex/SESSION_HANDOFF.md.
