# Session Handoff — Shared Codex / Claude Worktree

STATUS: PART_04_IN_PROGRESS
ACTIVE_WRITER: claude
WORKTREE: D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub
BRANCH: slice/part-04-lending (pushed at each checkpoint)
LIVE_PREVIEW: http://127.0.0.1:8791 (restart `npm run dev:live` to pick up migration 0014 and the new build)

## Part 4 (Claude, 2026-09-29) — see `.codex/PART_04_BRIEF.md`
- **Done and verified on the slice:**
  - migration 0014 (Saleable → Consumable, audited; the `loans` table);
  - `src/loans.ts` (lend with R2 photo, return / damaged / lost, dashboard statistics, photo stream) and routes in `src/worker.ts`;
  - the quantity editor (`src/movement-form.ts`) in the item sheet and Stock & Pantry, with a required reason and an `expectedOnHand` guard;
  - the Loan tab and shared loan form (`src/loan-form.ts`), the `/staff/loans` dashboard (`src/loans-workspace.ts`), simplified Edit details, the Lending Hub without loan terms.
- **Gates at checkpoint 45bf880:** typecheck, build, `npm test` 60/60 (8 new Part 4 tests), `npm run test:browser` 7/7, `npm run test:browser:worker` 15/15 (a new real Worker + D1 lending flow), privacy scan; no horizontal overflow at 320 / 375 / 768 / 1024–1440.
- **In progress:** a read-only multi-lens review (server, frontend, performance, design, bloat) with adversarial verification, then fixes.

## Exact next action
1. Finish the review fixes, re-run every gate, update docs, push the slice.
2. Earl, before the merge: `npx wrangler r2 bucket create logistics-hub-evidence`, then `npx wrangler d1 migrations apply DB --remote` from the shared workspace (0014 is safe for the live Part 3 code).
3. Then fast-forward `main` to the slice, push, verify the Workers Builds deploy, delete the slice, and yield the lock.

## Known facts and limitations
- No item has a reorder level yet, so Low stock is empty until staff set levels.
- Some legacy classifications look wrong (for example "Sanitary Napkin/Pads" is Loanable); they remain for staff review.
- The legacy *category* "PANTRY" holds 16 office supplies; Pantry uses the stock area instead.
- The running 8791 preview's asset watcher stopped after rebuilds (Windows EPERM). Restart `npm run dev:live`.
