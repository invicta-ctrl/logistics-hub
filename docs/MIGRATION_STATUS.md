# Migration Status — 2026-09-28

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
No remote Cloudflare D1/R2 resource has been created or mutated because the exact new Logistics Hub provider target has not yet been established and preflighted.
