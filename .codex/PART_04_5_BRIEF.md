# Part 4.5 Brief — Offline Self-Service + PWA + Single QR + Sync/Reconciliation

STATUS: CODE_COMPLETE on the slice; production waits for Part 4 acceptance and remote migration 0015 (see `.codex/SESSION_HANDOFF.md`)
BRANCH: slice/part-04-5-offline-self-service-pwa (from main 41d00fe)
INSTRUCTION: Earl, 2026-09-29 (Claude Code Cloud prompt "Part 4.5 — Offline Self-Service + PWA + Single QR + Sync/Reconciliation")
ENGINEERING GUIDE: docs/OFFLINE_SELF_SERVICE.md · USER GUIDE: docs/PWA_INSTALL_GUIDE.md

## What was asked
One permanent QR → `/self-service`: people use their own phones to Take, Borrow and Return eligible items and see My activity; installable; keeps working offline after one online visit; actions saved as immutable events, synced later and reconciled across phones without losing any; staff see only genuine exceptions; private photos; update behaviour; tests; docs.

## Decisions (and why)
- **Eligibility:** one flag, `items.self_service`, default off (fail closed). `selfServiceAction()` in `catalog-policy.ts`: Consumable → Take (Active, reviewed); listed Loanable → Borrow. No new status vocabulary.
- **One table:** `self_service_events` is both the idempotency record and the review queue. Effects go to the canonical tables through the same statements staff use (`lendStatements`, `closeStatements`, the ledger). Loans from phones are `LN-SS-<event id>`.
- **Time:** business time = phone clock corrected by (arrival − `sentAt`), measured on the same clock in the same request; history ordered by business time (`HISTORY_ORDER`). Implausible clocks are held.
- **Physical truth:** self-service is never refused for quantity; staff movements keep the strict guard. Negative stock is a derived, self-clearing item-level "Count needed".
- **Counts as observations:** a later physical count supersedes an earlier offline movement (`SUPERSEDED`, decided inside the INSERT).
- **Safety over convenience:** late events for ineligible items and >30 units/item/hour are held, never applied. Unlinked returns auto-close only an unambiguous good-condition return and never reveal whether a loan exists. Linked returns must come from the phone that borrowed.
- **No new dependencies.** Hand-written service worker built by a ~20-line Vite plugin; IndexedDB without a wrapper library.
- **Performance:** route-level code splitting (main bundle 127 KB → 34 KB; a QR visit loads ~72 KB of JS), immutable asset caching, precached shell.

## Adversarial design review (before implementation) — accepted
C1 late-ineligible events applied (fixed: held) · C2 anonymous abuse containment (volume hold, network tag, two-stage rate limits; per-item toggle is the kill switch) · M1 per-event negative flag false positives (derived check) · M2 stale clock offsets (sentAt) · M3 poison events (held as ERROR) · M5 unmatched-return oracle and cross-phone linked returns (fixed) · M6 photo deletion races (per-attempt keys, `LN-SS-` namespace) · M7 held borrows keep their evidence (photo_key, return_by). Not adopted: storing payload hashes for replayed ids with different payloads (only an attacker's own event is affected); a staff "reverse event" tool (a count is the canonical correction; loans close from Loans).

## Out of scope
Offline staff actions (no offline credentials), a global settings/kill switch (Part 6), server-side retention purge of names on takes (Part 6), multi-item loans, borrower accounts.
