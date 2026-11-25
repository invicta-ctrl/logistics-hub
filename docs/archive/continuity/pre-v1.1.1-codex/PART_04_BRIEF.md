# Part 4 Brief — Lending (internal loans), quantity editor, two item types

STATUS: PRODUCTION_ACCEPTANCE_COMPLETE (2026-09-30; Staff-role photo access, lending, returns, quantities, dashboard/history and synthetic cleanup verified; closure pushed on main b787b75)
BRANCH: slice/part-04-lending (from main 4f6cf4b)
ACCEPTED_SPEC: docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md (Part 4), as directed by Earl's current instruction below
INSTRUCTION: Earl, 2026-09-29 (after Part 3 went live)

## Earl's instruction (authoritative where it differs from the spec)
1. Item sheet: the current quantity is shown and can always be changed; a reason is required so staff know whether it was new stock (requested) or someone consumed it.
2. Edit details: no "Saleable" (Loanable or Consumable only); category and unit are typed, not chosen from a drop-down; remove loan period and maximum per loan.
3. A **Loan** tab beside Edit details to process loans internally:
   - **Individual use:** full name, student ID number and photo, all required;
   - **USC use:** name of the person who used it, proof photo and a specific reason, all required.
4. A loans dashboard with statistics of who borrows most, distinguishing USC use from individual use.
5. Then clean everything, improve the front end, make the backend faster without bloat. Near the usage limit, push to the slice branch (not main) so another agent can continue.

Divergences from the v0.1 spec, per Earl: loans are classified by **purpose** (INDIVIDUAL / USC) rather than borrower class (STUDENT / USC_STAFF); one item per loan (quantity > 1 allowed) from the item's Loan tab; no department field; no item-level loan period; a per-loan return-by date is optional and drives the derived "overdue".

## Data facts
- 112 items were "Saleable" (crepe paper, tape, envelopes, forks, glass cups): consumable supplies. Migration 0014 makes them Consumable with one system audit row each.
- The 0001 `loans`, `loan_items` and `evidence` tables were placeholders: never used by code, 0 rows locally and in production (read-only check 2026-09-29). 0014 replaces them.
- One production item had a loan period / maximum set; the columns stay (unused) rather than rewriting data.
- R2 is enabled; Codex created private `logistics-hub-evidence` on 2026-09-29 after the final local gates and verified no public endpoint.

## What was built
- **Migration 0014:** Saleable → Consumable (audited); new `loans` table (purpose, borrower name, student ID or reason by CHECK, R2 photo key, return-by, status OUT/RETURNED/DAMAGED/LOST, LOAN_OUT and LOAN_RETURN movement links, who and when).
- **Worker (`src/loans.ts`):** lend (multipart with photo; photo type from bytes; guarded LOAN_OUT movement, never negative, idempotent; photo removed if nothing was written), return / damaged / lost (only a good return writes LOAN_RETURN; closing twice is harmless), `/api/staff/loans` (open, recent returns, per-period rankings and totals, known borrowers; revisioned), staff-only photo stream. Movements accept `expectedOnHand`.
- **UI:** quantity editor (`src/movement-form.ts`) in the item sheet and Stock & Pantry; Loan tab and shared loan form with in-browser photo shrink (`src/loan-form.ts`); `/staff/loans` dashboard (`src/loans-workspace.ts`); Edit details simplified; Lending Hub rows state only the audience.

## Production prerequisites before merging (Codex authorized by Earl's current instruction)
1. `npx wrangler r2 bucket create logistics-hub-evidence`
2. `npx wrangler d1 migrations apply DB --remote` (applies 0014; safe for the live Part 3 code)
3. Then fast-forward `main` and push.
