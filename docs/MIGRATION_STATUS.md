# Migration Status — 2026-09-28

This is the record of the original V1 data migration as it stood on 2026-09-28. The current production migration level is in `docs/DATA_ARCHITECTURE.md` ("Production migration level").

## Inventory
- Current Production items captured: 397.
- Unique item IDs: 397.
- Existing posted Production ledger rows captured: 1.
- Existing reservation rows captured: 1.
- Latest Production scheduled-backup item-row mismatches: 0.
- Computed balance vs legacy-reported available mismatches: 1.

The mismatch is preserved for reconciliation; physical quantity in the new system is derived from opening balance + posted movements.

## Staff
- Production access rows present: 1 (legacy access, not treated as the full roster).
- DOL committee-designation respondents found: 10.
- Additional named Director for Logistics from July 4 general-meeting record: 1.
- Candidate DOL directory rows: 11.
- Staff PII committed to Git: 0.

Directory records and login identities are deliberately separate. A staff member may exist with login disabled until a verified email is available. Legacy Production access rows are imported into a separate private reconciliation table, not auto-merged by name.

## Runtime
The new isolated target is Worker `logistics-hub` with D1 `logistics-hub`. Remote migrations `0001`–`0010` load the full verified seed: 397 items, opening-balance movements, the one legacy ledger row, and the one reservation. `0011` adds roles and owner recovery; `0012` adds an index for item history and changes no data. `0013` (Part 3) adds a movement reason, an optional item expiry and the `reorders` restock list; no existing row changes. `0014` (Part 4) reclassifies the 112 legacy "Saleable" records as Consumable, with one system-attributed ITEM_UPDATED audit row per item, and replaces the empty 0001 loan placeholders with the `loans` table. `0015` (Part 4.5) adds `items.self_service` (off for every item) and the empty `self_service_events` table; no existing row changes. Launch steps are in `docs/DEPLOYMENT.md`; the old `hau-usc-logistics-*` resources are never touched.

## Lending readiness
All 397 migrated records remain `needs_review`, so none are public at launch. 102 carry the legacy `Loanable` classification; staff see them in the "Loanable, not yet listed" queue and publish each one explicitly.
