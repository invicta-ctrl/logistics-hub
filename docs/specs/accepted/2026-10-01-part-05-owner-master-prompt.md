# Owner Source Record — Part 5 Master Prompt (verbatim)

STATUS: SOURCE RECORD (verbatim copy; not a normalization)
PROVENANCE: Earl's Part 5 master prompt, "Nexus Master Prompt — Logistics Hub Part 5", received 2026-10-01 as a user message attachment (`LOGISTICS_HUB_PART_5_NEXUS_MAUSBOT_MASTER_PROMPT.md`, read in full by Forge from the OpenMausBot attachment store with the ordinary file reader). Two stored attachment copies are byte-identical; SHA-256 of the original file: `cc930f00d5f97199b985157ccd1bbe74087a81b9c736433fd3f6c5ee8dcb3636`.
CONTENTS: everything below the rule is the prompt text unchanged (line endings normalized to LF). It contains no credentials or private identifiers.
USE: read-only reference for review. The accepted plan's Acceptance record (`2026-09-30-part-05-activity-accountability-plan.md`) is the normalized working summary; it records one deliberate refinement of this prompt (impossible open/on-hand state is prevented, not merely flagged).

---

# Nexus Master Prompt — Logistics Hub Part 5
## Activity + Accountability + Open-Unit Tracking + PWA Action Routing

**Repository:** `invicta-ctrl/logistics-hub`  
**Workflow:** Accepted MausBot multi-worktree workflow  
**Primary coordinator:** Nexus  
**Primary writer:** Forge  
**Specialists:** Scout, Oracle, Sentinel, Harbor

---

# 1. Objective

Coordinate and complete **Part 5** of Logistics Hub as two sequential, production-ready slices:

1. **Part 5 Activity + Accountability**
   - unified operational Activity Center;
   - searchable/filterable history across inventory, catalog, loans, self-service, and staff actions;
   - safe filtered CSV exports;
   - clear auditability without creating a second ledger.

2. **Part 5B Open-Unit Tracking**
   - support consumables that are counted by outer unit but used gradually;
   - examples: reams, boxes, bottles, jars, rolls, packs, cans, tubs, pouches, containers;
   - do not count sheets, staples, milliliters, grams, meters, percentages, or other internal contents;
   - preserve the movement-derived quantity model;
   - correct the PWA so the user never manually chooses Borrow vs Consume/Take.

The Self-Service/PWA must become **item-driven**:

- Loanable → **Borrow**
- Consumable + `WHOLE_UNIT` → **Take**
- Consumable + `OPEN_UNIT` → **Use**

There must be no generic user-facing “Borrow or Consume” choice.

---

# 2. Authority and governance

Before any implementation, Nexus must read and treat as authoritative, in order:

1. Earl's current instruction in this prompt.
2. `AGENTS.md`
3. `.agents/PROJECT_POLICY.md`
4. `.codex/CURRENT.md`
5. `.codex/SESSION_HANDOFF.md`
6. `docs/SHARED_AGENT_WORKFLOW.md`
7. `docs/specs/accepted/2026-09-30-mausbot-multi-worktree-amendment.md`
8. the accepted office-operations specification;
9. the current Part 5 plan / Open-Unit planning documents;
10. verified repository and production state.

Repository:

`invicta-ctrl/logistics-hub`

Do not revive architecture from the old HAU-USC Logistics Management System.

Do not bypass accepted repository governance.

This prompt is Earl's current direction for Part 5. If the repository still records Part 5 / A12 as **PROPOSED**, Nexus must first have Forge formalize the accepted Part 5 scope/amendment in the authoritative specification documents before implementation begins. That documentation change must itself be small, reviewed, committed, and verified.

A production migration or deployment still requires its own explicit production authorization under the existing release rules.

---

# 3. MausBot role contract

## Nexus — coordinator only

Nexus:

- does not edit repository source;
- does not create a development branch itself;
- decomposes work;
- assigns bounded tasks;
- maintains dependency order;
- reconciles specialist findings;
- prevents duplicated work;
- decides when a task is ready to hand to Forge;
- decides when Sentinel must re-check;
- stops when authority, safety, or state is unclear.

Nexus must not act as a hidden second writer.

## Scout — read-only discovery

Scout works only in its approved detached worktree.

Scout may inspect the exact commit assigned by Nexus, map existing modules/routes/queries/tests/migrations/UI patterns, identify reuse opportunities and risks, and report evidence to Nexus.

Scout must not edit source, create branches, make commits, or repair findings.

## Oracle — read-only architecture/recommendation

Oracle works only in its approved detached worktree.

Oracle may review implementation approach, schema/data-model direction, concurrency/idempotency, migration design, query/index strategy, and recommend simpler alternatives.

Oracle must not implement directly, edit source, create branches, or make commits.

All accepted Oracle recommendations are implemented by Forge.

## Forge — sole normal repository writer

Forge uses:

`D:\Documents\HAU-USC Logistics Hub\workspace\logistics-hub`

Forge must verify root/branch/HEAD/status/writer, claim the writer lock, work only on the one active `slice/*` branch, preserve unknown work, make the smallest durable implementation, commit each coherent green checkpoint, push as needed, update handoff docs, and yield before another writer takes over.

Forge is the only MausBot role allowed to change repository source.

## Sentinel — independent read-only verification

Sentinel works only in its approved detached worktree at the **exact candidate commit**.

Sentinel independently verifies acceptance criteria, security, migration correctness, idempotency/concurrency, responsive behavior, accessibility, privacy, regression safety, and anti-bloat.

Sentinel does not fix findings. Findings return to Nexus → Forge. Material fixes require Sentinel re-verification of the new exact commit.

## Harbor — release/deploy only

Harbor works only at an explicitly authorized exact release commit.

Harbor performs release/deploy operations only, does not edit source, verifies exact target/environment/source identity, preflight, rollback/recovery readiness, applies only explicitly authorized migrations, and performs post-change verification.

Harbor must never deploy an unverified or ambiguously authorized commit.

---

# 4. Preflight before Part 5 starts

Nexus must not immediately hand implementation to Forge.

## 4.1 Verify current repository state

Have Scout inspect current `main` and report:

- current HEAD;
- whether an active slice exists;
- writer state;
- current Part 4.5 / Part 4.10 status;
- current Part 5 plan/spec status;
- migration state relevant to Part 5.

## 4.2 Verify the Part 4.5 gate

Current repo governance states Part 4.5 owner phone + signed-in staff acceptance gates Part 5.

Nexus must verify whether that acceptance has been completed and recorded.

If not completed:

- do not begin Part 5 implementation;
- report the exact remaining acceptance steps to Earl;
- stop the affected implementation path.

Do not invent completion.

## 4.3 Formalize Part 5 acceptance if still PROPOSED

If Part 5 core and Open-Unit Tracking A12 are still marked `PROPOSED`:

- Forge may make a bounded documentation-only change to record Earl's accepted scope from this prompt;
- no production write;
- no migration;
- update the authoritative spec/current pointer as required;
- verify and commit.

Only after the accepted scope is authoritative should implementation begin.

---

# 5. Technical principles

Keep the implementation:

- HTML5 / CSS / TypeScript first;
- Cloudflare Worker + D1 + R2;
- framework-light;
- small and maintainable;
- easy for a beginner developer to understand;
- modular without speculative abstractions;
- visually consistent with current Logistics Hub;
- responsive;
- accessible;
- fast;
- safe under retries, double taps, offline replay, and concurrency.

D1 remains structured truth.

R2 remains evidence storage.

The append-only movement ledger remains the **sole authority for physical quantity**.

Do not create:

- a second quantity authority;
- a second activity ledger;
- a second offline queue;
- a second design system;
- agent-specific implementations;
- speculative future architecture.

Prefer extending existing modules and removing obsolete paths after verification.

---

# 6. Slice order

Only **one active slice branch** may exist at a time.

Sequence:

1. `slice/part-05-activity`
2. merge/prune/return to clean `main`
3. `slice/part-05b-open-units`
4. merge/prune/return to clean `main`

Do not run both implementation slices in parallel.

Scout, Oracle, and Sentinel may inspect concurrently in detached read-only worktrees at the exact assigned commit.

---

# 7. Slice 1 — Activity + Accountability

Branch:

`slice/part-05-activity`

## 7.1 Goal

Create:

`/staff/activity`

The Activity Center should answer:

> Who did what, to which item, when, through which workflow, and did it change stock?

Use:

- `inventory_movements`
- `loans`
- `self_service_events`
- `audit_log`

Prefer a unified read/query model such as `UNION ALL` over existing tables plus only necessary indexes.

Do not create a new activity table unless evidence proves it is needed.

## 7.2 Scout assignment

Map:

- existing activity/history queries;
- item History;
- Loans activity/history;
- Self-Service activity/review data;
- admin activity;
- pagination/search/filter utilities;
- live revision / ETag patterns;
- role enforcement;
- export helpers, if any;
- relevant tests.

Return a concise file/module map and reuse recommendations.

## 7.3 Oracle assignment

Review Scout's map and recommend the smallest design for:

- unified query/read model;
- cursor pagination;
- filters;
- role-based visibility;
- export safety;
- indexes if needed;
- event normalization;
- stable IDs.

Explicitly determine whether a new table is avoidable.

## 7.4 Forge stages

### 5.1 Read model and API

Implement unified activity query, cursor pagination, role rules, filters, human-readable normalized entries, stable identifiers, and stock-impact metadata.

Include where relevant:

- stock in/out;
- adjustment;
- physical count;
- item create/edit/classification/deactivate/reactivate;
- loan created/returned/damaged/lost;
- self-service Take/Borrow/Return;
- staff-confirmed or rejected return;
- held/review-required records;
- relevant admin/security events for ADMIN/OWNER only.

No raw JSON in user-facing output.

Every entry should expose where relevant:

- Manila-local timestamp;
- actor;
- item;
- action;
- source;
- stock impact;
- reason/note;
- stable event/correlation ID.

Stop and verify before moving to UI.

### 5.2 Activity Center UI

Create `/staff/activity`.

Support:

- newest first;
- cursor pagination;
- Load older;
- live updated state;
- URL-persisted filters;
- text search;
- item;
- actor;
- source;
- event type;
- date range;
- location / stock area;
- changed stock / no stock change;
- needs-attention only;
- mobile filter sheet;
- empty/error states.

Open existing related item/loan workflows where practical. Do not create unnecessary detail screens.

### 5.3 Safe CSV export

Export exactly the filtered activity query.

Requirements:

- UTF-8;
- Excel-friendly;
- fixed columns;
- proper quoting;
- row cap;
- clear truncation message;
- server-controlled filename;
- `Cache-Control: private, no-store`;
- rate limiting;
- audited export events.

Neutralize formula-injection prefixes such as `=`, `+`, `-`, `@`, tab, and carriage return.

Never export password hashes, session tokens, recovery secrets, credentials, R2/photo keys, image bytes, network hashes, raw `details_json`, or private infrastructure data.

Each export records actor, time, filters, and row count.

### 5.4 Polish and regression

Complete responsive behavior, keyboard use, labels, screen-reader basics, performance, empty/error states, docs, product reference, and regression verification.

---

# 8. Slice 1 Sentinel verification

Sentinel verifies the exact candidate commit for:

- Slice 1 acceptance criteria;
- role boundaries;
- no public activity leakage;
- export formula-injection defense;
- sensitive-field exclusion;
- export/filter parity;
- pagination correctness;
- query performance;
- responsive behavior;
- keyboard/screen-reader basics;
- no regression to Parts 1–4.5;
- no unnecessary architecture.

Findings return to Nexus → Forge → Sentinel re-verification.

Only after Sentinel is green may integration proceed.

---

# 9. Finish Slice 1

Forge must:

- review complete diff;
- run gates;
- update authoritative docs/handoff;
- commit final state;
- integrate safely into `main`;
- verify `main`;
- push `main`;
- prove slice fully merged;
- delete/prune the slice;
- leave clean `main`;
- yield writer lock.

Nexus confirms closure before Slice 2.

---

# 10. Slice 2 — Open-Unit Tracking

Branch:

`slice/part-05b-open-units`

## 10.1 Goal

Support consumables counted by outer unit but used gradually.

Examples:

- ream;
- box;
- bottle;
- jar;
- roll;
- pack;
- can;
- pouch;
- tub;
- container.

Do not track internal quantities such as sheets, staples, milliliters, grams, length, percentages, or fractional packages.

---

# 11. Consumption modes

Consumables support:

`WHOLE_UNIT`

and

`OPEN_UNIT`

Default every existing item to:

`WHOLE_UNIT`

Do not auto-classify by name.

Staff opt in per item.

Loanables are unaffected.

---

# 12. Open-Unit behavior

For `OPEN_UNIT`:

Opening a unit → **quantity delta 0**  
Recording ordinary use → **quantity delta 0**  
Changing rough condition → **quantity delta 0**  
Marking an open unit Empty → **quantity delta -1**

Empty must deduct through the existing guarded append-only movement path.

Example:

`8 reams on hand · 7 sealed · 1 open · Low`

Using five sheets leaves stock at 8 reams.

Marking the open ream Empty changes stock to 7 reams.

No sheet counting occurs.

---

# 13. Open-Unit state model

Lifecycle:

`SEALED → OPEN → EMPTY`

Optional condition:

- Plenty
- Half-ish
- Low

Conditions never affect quantity.

Do not store percentages or estimated remaining contents.

Derived sealed count:

`sealed = on_hand - open_units`

Do not persist a second sealed-stock authority.

---

# 14. Multiple open units

Multiple units may be open.

If one is already open, warn:

> 1 unit is already open. Use the existing unit when possible.

Do not prohibit intentional additional opening.

`open_units` must never exceed `on_hand`.

---

# 15. Scout assignment for Open Units

Map:

- item schema/edit flow;
- quantity paths;
- movement guard logic;
- physical count/reconciliation;
- Stock & Pantry;
- self-service routing;
- offline queue;
- self-service sync;
- idempotency keys;
- migrations;
- History/Activity integration;
- browser and Worker+D1 tests.

Return exact reuse points and conflicts.

---

# 16. Oracle assignment for Open Units

Review:

- smallest schema;
- additive migration;
- idempotent Empty transition;
- concurrent Empty handling;
- `open_units <= on_hand`;
- physical-count interaction;
- unsafe mode changes;
- offline Use behavior;
- Activity integration;
- rollback/recovery implications.

Prevent creation of a second quantity authority.

---

# 17. Expected data-model direction

Final schema is chosen only after reading current D1 state.

Expected item field:

`consumption_mode`

Values:

- `WHOLE_UNIT`
- `OPEN_UNIT`

Default:

`WHOLE_UNIT`

Minimal open-unit record may contain:

- id;
- item_id;
- opened_at;
- opened_by;
- condition;
- condition_updated_at;
- condition_updated_by;
- closed_at;
- closed_by;
- idempotency/correlation identifier.

Do not store remaining sheets, mL, grams, length, percentages, or fractional stock.

Migration must be additive and preserve existing quantities/history.

---

# 18. Forge stages for Open Units

## OU-1 — schema, migration, configuration, invariants

Implement final schema, migration, `consumption_mode`, safe defaults, invariant tests, and mode-change protections.

Do not apply production migration here.

Stop and verify.

## OU-2 — staff workflow

Staff can:

- Open a unit;
- Record use;
- change condition;
- Mark empty;
- Open another;
- reconcile/correct open-unit state.

Integrate into item sheet, Stock & Pantry, History, and Activity.

When marking Empty, show:

> This will reduce on-hand stock from 8 to 7 reams.

Avoid modal chains.

## OU-3 — reconciliation + counts + Activity/Export integration

Rules:

- physical counts count outer units;
- `3 sealed + 1 open = 4`;
- open state reconciles separately;
- reconciliation never rewrites movement history;
- if `open_units > on_hand`, flag **Open-unit state needs review**;
- do not invent values.

Add Activity events:

- unit opened;
- use recorded;
- condition changed;
- extra unit opened;
- unit marked empty;
- open state corrected;
- count reconciled;
- discrepancy flagged/resolved.

For Open-Unit Use:

`quantity_delta = 0`

Reports/exports distinguish:

- Uses recorded
- Stock units exhausted

Never estimate internal content used.

## OU-4 — PWA / Self-Service correction

Mandatory.

The PWA must be item-driven.

The user must never choose between Borrow and Consume/Take.

Routing:

### Loanable
→ **Borrow**

### Consumable + `WHOLE_UNIT`
→ **Take**

### Consumable + `OPEN_UNIT`
→ **Use**

Remove obsolete user-facing generic Borrow/Consume action selection.

For Open-Unit `Use`:

- no sheets question;
- no amount;
- no percentage;
- no remaining-content question.

A `Use` event records activity only and changes stock by 0.

Self-service users cannot mark Empty, set condition, reconcile open state, or adjust stock.

Reuse the existing immutable offline queue and sync path. Do not create a second offline system.

## OU-5 — polish and regression

Complete responsive/accessibility pass, copy, error/empty states, Activity/export integration, migration verification, docs, product reference, and final regression.

---

# 19. Non-negotiable Open-Unit invariants

1. Movement ledger remains sole quantity authority.
2. Open changes stock by 0.
3. Use changes stock by 0.
4. Condition changes stock by 0.
5. Empty changes stock by exactly -1.
6. One open unit cannot be emptied twice.
7. Retry cannot double-deduct.
8. Double-click cannot double-deduct.
9. Offline replay cannot double-deduct.
10. Two competing Empty operations produce exactly one valid deduction.
11. `open_units <= on_hand`.
12. Counts observe outer units only.
13. Reconciliation does not rewrite ledger history.
14. Impossible open/on-hand state is flagged, not fabricated.
15. Existing `WHOLE_UNIT` behavior remains unchanged.
16. Loanables remain unchanged.
17. Every transition is attributable.
18. Public APIs expose no private open-unit operations.
19. Existing self-service queue remains the only offline action queue.
20. PWA action is derived from item configuration, not user choice.

---

# 20. Unsafe mode changes

If open units exist, prevent silent transitions such as:

- `OPEN_UNIT → WHOLE_UNIT`;
- Consumable → Loanable;
- deactivation that invalidates state;
- physical count to zero while an open unit exists.

Require explicit reconciliation first.

Never silently delete or fabricate open-unit records.

---

# 21. Slice 2 Sentinel verification

Sentinel verifies the exact candidate for:

- migration safety;
- default `WHOLE_UNIT`;
- no historical quantity changes;
- no auto-reclassification;
- Open/Use/Condition delta 0;
- Empty delta -1;
- retry/double-click/concurrent safety;
- offline replay safety;
- `open_units <= on_hand`;
- count compatibility;
- discrepancy flagging;
- mode-change protections;
- Activity events;
- export semantics;
- automatic PWA Borrow / Take / Use routing;
- removal of generic Borrow/Consume user choice;
- self-service Use not changing stock;
- public/private boundaries;
- responsive/accessibility behavior;
- no duplicate offline/quantity architecture;
- no regression to lending/stock/self-service.

Findings go Nexus → Forge → Sentinel re-verification.

---

# 22. Verification gates

Forge runs relevant focused checks at each checkpoint.

Before either slice is complete:

```bash
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:browser:worker
npm run verify:privacy
npm run verify:migration
npm run verify:catalog
wrangler deploy --dry-run
```

Also verify touched pages near:

- 390 px
- 768 px
- 1366 px

Perform keyboard checks, accessible-label checks, no horizontal overflow, final diff review, and anti-bloat review.

Do not claim unrun tests.

Sentinel independently verifies the exact candidate commit.

---

# 23. Migration and production boundary

Implementation completion does **not** authorize production mutation.

For D1 production migration:

1. verify exact target;
2. verify exact release commit;
3. test on throwaway D1;
4. take required Time Travel / rollback checkpoint;
5. list pending migrations;
6. confirm exact intended migration;
7. obtain Earl's explicit production authorization;
8. Harbor applies it;
9. Harbor performs read-only post-apply verification;
10. never blindly reapply.

Workers Builds deploying `main` does not replace D1 migration controls.

If code depends on an unapplied migration, Nexus must ensure release sequencing remains production-safe.

---

# 24. Harbor release flow

Harbor is used only after:

- Forge finishes;
- Sentinel verifies the exact candidate;
- `main` contains the verified release state;
- target is confirmed;
- release order is safe;
- Earl explicitly authorizes production action.

Harbor receives:

- exact commit SHA;
- exact environment;
- exact migration(s), if any;
- expected preflight state;
- rollback/recovery reference;
- post-change checks.

Harbor stops on any identity/target mismatch.

---

# 25. Anti-bloat requirements

Before each Forge commit, reject or simplify:

- unnecessary dependencies;
- one-use abstractions that reduce clarity;
- speculative hooks;
- duplicate helpers/config/docs;
- parallel implementations;
- dead code;
- unused compatibility code;
- tests with no new behavioral value.

Prefer deletion and reuse.

If the PWA action-selector path becomes obsolete, remove it after item-driven routing is verified.

---

# 26. Nexus orchestration rules

Nexus should:

- delegate the smallest bounded useful task;
- not ask multiple bots to independently implement the same feature;
- use Scout for mapping;
- use Oracle for consequential design review;
- use Forge for source edits;
- use Sentinel for independent candidate verification;
- use Harbor only for authorized release work;
- keep one active slice only;
- preserve commit identity across reviews;
- require exact-commit handoffs;
- avoid repeated broad scans when evidence exists;
- stop at meaningful checkpoints.

Nexus may parallelize **read-only** work when independent, but must not create competing implementations.

---

# 27. Required handoff format

## Scout / Oracle / Sentinel

Report:

- exact commit inspected;
- scope inspected;
- findings;
- evidence/files;
- risks;
- recommended next action;
- blockers.

## Forge

Report:

- branch;
- HEAD;
- writer-lock state;
- changes made;
- files changed;
- verification run;
- diff concerns;
- commit SHA;
- exact next action;
- blockers;
- handoff/current-doc update state.

## Harbor

Report:

- exact release commit;
- exact environment;
- preflight result;
- backup/rollback reference;
- migration/deploy action;
- post-change checks;
- final production state;
- unresolved operational issues.

---

# 28. Deliverables

At final Part 5 completion, Nexus reports:

1. Activity Center;
2. safe CSV exports;
3. Open-Unit Tracking;
4. automatic PWA Borrow / Take / Use routing;
5. removal of obsolete manual Borrow/Consume choice;
6. Activity/export integration;
7. migration(s);
8. test + Sentinel evidence;
9. responsive/accessibility verification;
10. branch/commit history;
11. exact production state if release was authorized;
12. unresolved risks or owner decisions.

Do not claim production completion if Harbor was not authorized or production verification did not run.

---

# 29. Stop conditions

Nexus stops the affected path rather than guessing if:

- Part 4.5 acceptance gate remains incomplete;
- Part 5/A12 authority is unresolved;
- another writer owns the lock;
- repository state contains unknown conflicting work;
- an unexpected migration conflicts with schema;
- production target is ambiguous;
- rollback/recovery prerequisites are missing;
- destructive Git/database action would be required;
- inventory invariants would be broken;
- exact candidate commit cannot be established.

For ordinary reversible implementation choices within scope, let Forge decide and continue.

Complete one slice fully before beginning the next.
