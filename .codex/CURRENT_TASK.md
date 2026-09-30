# Current Bounded Task — PART-04 Lending (internal loans), quantity editor, two item types
INTENT: FEATURE_IMPLEMENTATION + PRODUCT POLISH + PERFORMANCE
OBJECTIVE: Earl's 2026-09-29 instruction (see .codex/PART_04_BRIEF.md): an always-editable quantity with a required reason; Loanable/Consumable only; typed category and unit; no loan period or maximum per loan; a Loan tab (Individual use: name, student ID, photo; USC use: name, photo, specific reason); a loans dashboard ranking borrowers by purpose; then clean up, improve the front end and speed up the backend without bloat.
IN_SCOPE: migration 0014; src/loans.ts; /api/staff/loans and loan routes; src/movement-form.ts (quantity editor); src/loan-form.ts; src/loans-workspace.ts; item sheet changes; tests; docs.
OUT_OF_SCOPE: multi-item loans in one record, departments, borrower accounts, public requests (Request Center), exports and the activity center (Part 5), backups and settings (Part 6).
BRIEF: .codex/PART_04_BRIEF.md
STATUS: PART_04_PRODUCTION_ACCEPTANCE_COMPLETE — 0014 and private R2 verified; Part 4 code live at 64c037e; real-browser Owner and Staff flows accepted 2026-09-30. See SESSION_HANDOFF for evidence. Part 4.5 Step 2 is next; Part 5 is out of scope.
