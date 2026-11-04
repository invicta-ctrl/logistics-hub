# Live UX workflow audit — implementation candidate

**ID:** LH-UX-20261030 · **Revision:** 1  
**Status:** PROPOSED — NOT ACCEPTED — NO IMPLEMENTATION OR DEPLOYMENT AUTHORITY  
**Prepared:** 2026-10-30 · **Repository:** invicta-ctrl/logistics-hub  
**Documentation branch:** docs/ux-workflow-audit-proposal-20261030

## Authority and objective

**Objective:** Make Logistics Hub's existing buttons, staff workflows, and layouts more predictable, informative, and efficient, while resolving a potentially stale Self-Service return workflow safely. This packet preserves *all* actionable findings from Earl's authenticated, read-only live UI review of 2026-10-30, so Codex or Claude can reconcile them with the **current** accepted release work and implement them in small verified slices once Earl accepts a specification and gives implementation GO.

**Authoritative sources (read in order):** current owner instruction; AGENTS.md; .agents/PROJECT_POLICY.md; .codex/CURRENT.md; .codex/SESSION_HANDOFF.md; docs/SHARED_AGENT_WORKFLOW.md; docs/PRODUCT_VERSION_GOVERNANCE.md; relevant accepted slice/spec; docs/DATA_ARCHITECTURE.md; docs/PERFORMANCE_RELIABILITY_DOCTRINE.md; relevant Road-to-V3 V2.1 foundation card. This proposal has no authority to supersede any of them.

**Observed target:** authenticated staff desktop on https://logistics.hausc.org, Administration System product label V1.16.6, build e966354cc2eb, 2026-10-30. Remote main was observed at 812013f20fd979596ecc595995cf753c3e7c674e. This is a dated observation, not a permanent release claim. The live UI showed application, database and media stores answering. No production mutations were made in the review.

**State discrepancy that the next agent must reconcile:** .codex/CURRENT.md and .codex/SESSION_HANDOFF.md begin with the V1.16.4 takeover/qualification even though the observed live UI says V1.16.6 and main includes V1.16.6 release records; the latest V1.16.6 record still uses qualification-pending language. Neither an active writer lock nor an exact active local worktree could be verified during preparation. Do not infer a writable lane, overwrite shared pointers, invent the next version number, or add this work to an in-progress release until the owner-designated integration steward reconciles actual source, lock, and acceptance.

**In scope for design/implementation after acceptance:** staff buttons and copy; stock receiving, counting and restock presentation; Self-Service return review consistency; location guidance fallbacks; catalogue density; existing activity information; loan-form change warning; image controls and item settings organization; clearly labeled data-completeness work queues.

**Explicit exclusions:** automatic stock/threshold correction; inventory imports; deleting or rewriting QA/loan/audit records; breaking immutable movement and audit history; publishing borrower/staff PII or internal photos to Git; creating online reservations, procurement orders or Road-to-V3 demand domains; changing permissions; production database or R2 writes; a broad UI redesign or a new SPA framework. These require separate acceptance, provenance and, where applicable, migrations and production controls.

## Evidence and priority ledger

The labels below distinguish *observed interface behavior* from *operational data gaps*, *hypotheses requiring backend tests*, and *design preferences*. The exact private borrower, student, loan, phone and photo identifiers intentionally do not appear in this public document.

| ID | Priority | Classification | Live observation / problem |
|---|---|---|---|
| UX-01 | P1 | **Verified cross-view inconsistency; double-count risk unproven** | A Self-Service return remains in the pending-confirmation queue even though the matching loan is shown closed and an independently recorded stock-restoring return movement appears later in Activity. The queue still presents an action labeled “Confirm returned · update stock”. |
| UX-02 | P2 | **Verified UX mismatch** | Clicking “Stock in” opens a generic “Update stock” form that first offers “Confirm physical count” at the unchanged quantity. It becomes a receiving action only after the user increases quantity. |
| UX-03 | P2 | **Verified semantic mismatch** | “Restock 0” means zero queued entries, yet the same view showed multiple reorder-level suggestions under an empty-state message. |
| UX-04 | P2 | **Operational setup gap** | Most active items lack reorder levels; they cannot be called low-stock under the current rules. The screen disclosed this limitation. |
| UX-05 | P2 | **Operational data-readiness gap / UX limitation** | Every sampled place entry lacked directions; a sampled “Where is it?” sheet only echoed the storage label without an image or route. Many catalogue items have no assigned place. |
| UX-06 | P2 | **Operational reconciliation needed** | Several unusually high quantities were flagged “Needs count”; a physical count is required to establish truth. This is not proof that the stored values are incorrect. |
| UX-07 | P2 | **Verified reporting nuisance** | Historical Returned loans displayed visibly synthetic QA records alongside normal records. |
| UX-08 | P3 | **Verified information gap** | Multiple Activity entries said only “Change by [person]”, without showing the field changed. |
| UX-09 | P3 | **Verified interaction, UX judgment** | Switching only the purpose radio in an unsubmitted loan form triggered a full unsaved-change warning on close. |
| UX-10 | P3 | **Design judgment** | The large catalogue presents tall rows and 100-at-a-time loading, resulting in lengthy scrolling for bulk reviews. |
| UX-11 | P3 | **UX/accessibility judgment** | Kit/place picture areas expose overlapping “Add picture”, camera and choose-file affordances; the choice architecture should be simplified while preserving actual capabilities. |
| UX-12 | P3 | **UX judgment** | Stock adjustments and stock settings appear in an item Overview, while descriptive edits live under Edit details; the meaning of “edit” is inconsistent. |

**Working observations worth preserving:** public search submits and opens Lending Hub filters; sidebar navigation works; global search found items and opened an item; item Overview/Loan/Edit details/History tabs work; Stock, Loans, Self-Service, Locations, Kits, Activity and Administration views respond; disabled actions on an empty kit remain disabled; forms can be dismissed. Authentication succeeded through a protected login. No side-effect submissions, photo uploads, real-phone responsive tests or formal animation measurements were performed. Do **not** claim those passed.

## Acceptance criteria by issue

### UX-01 — Self-Service return state reconciliation (first integrity slice)

1. Reproduce with synthetic local data: phone return is submitted while a loan is out; a separate authorized staff return closes that same loan and restores the applicable quantity; the phone event remains awaiting review.
2. The review endpoint revalidates the authoritative loan state, remaining quantity and existing movement/event relationship before any stock-restoring write. A stale “confirm” cannot increase stock beyond the actual outstanding amount or duplicate an already-processed event.
3. Concurrent confirmations, stale browser tabs, double-clicks and retries are idempotent under the actual Worker/D1 transaction behavior. Preserve valid partial-return semantics, if supported; do not impose an incorrect one-movement-per-loan assumption.
4. The UI refreshes or safely rejects a stale card with clear copy such as “This loan was already returned. No stock was changed.” The pending record is resolved through an auditable domain state, not deleted. Clearly distinguish an already-returned item from a genuinely missing/failed return.
5. Preserve the original phone event, photo retention constraints, loan closure and immutable movement/audit records. Respect role authorization. No duplicate credit to stock even if the UI was outdated.
6. Tests cover staff-return-after-phone-pending, two staff confirmations, retry after uncertain response, stale ETag/tab, duplicate phone event, and quantity greater than one. Confirm the regression against a Worker-compatible D1 test; a SQLite stand-in alone does not establish production concurrency.
7. Before any live remediation, inspect the existing conflicting record read-only with approved access and select an explicit reconciliation disposition. No production confirmation from this proposal.

### UX-02 — Receiving versus physical count

1. “Stock in” enters an explicit **receive stock** flow with the item already selected, a visible positive quantity-to-add field, a clear before/after preview, and a submit action that names the receipt. No stock write occurs until staff submits valid required fields.
2. “Count” enters a separate **physical count** flow, showing the measured absolute quantity and any variance clearly. The two intents never switch silently based only on number entry.
3. Preserve existing allowed reasons, notes, authorization, append-only movements and audit provenance; reject invalid units, negative/out-of-range values, duplicates and stale versions through existing server guards.
4. Cancel/close leaves no persistent stock, restock or activity change. Keyboard and mobile interactions are consistent.

### UX-03 — Honest restock summaries

1. Show **queued restock entries** and **automatic suggestions** as distinct counts and sections in the tab, header and empty state. “No entries queued” must not imply no restocking candidates.
2. Suggestion actions create a reviewable entry only after explicit staff choice and applicable validation. They never place purchase orders, receive goods, promise stock or alter movement-derived inventory automatically.
3. A threshold changing, new stock arriving, an entry being closed and a live refresh update displayed counts without stale badges.

### UX-04 — Reorder-level setup coverage

1. Surface the number/proportion of active catalogue records with no effective low-stock threshold, with a direct reviewed workflow for completing values; never silently assign guessed thresholds.
2. Explicitly explain that “out of stock” and “low stock” have different detection rules and that missing thresholds mean unknown low-stock coverage.
3. If bulk editing is accepted for a later slice, specify role rights, range/type validation, audit, preview and rollback before implementation. Without that separate authorization, improve only guidance and navigation.

### UX-05 — Useful, privacy-safe locations

1. When a place lacks directions/photo, “Where is it?” provides the known place label plus an honest and useful fallback (“Ask Logistics staff”) rather than suggesting a complete route exists.
2. Location management visibly identifies records missing guidance and offers a focused completion action. Reuse place-level instructions/pictures across assigned items without duplicating descriptions.
3. Honor staff-only visibility and inherited visibility rules; never leak staff-only directions to Self-Service. Do not invent photos, places, hierarchy, routes or room directions.
4. Existing place IDs and item history remain stable. Hierarchy restructuring or mass item reassignment is a separately reviewed data operation.

### UX-06 — Physical-count anomalies

1. Present flagged “Needs count” items clearly and make the physical-count path discoverable, with reason/variance preview.
2. Do not silently normalize extraordinary quantities. Require staff physical verification and append an audited correction movement only after authorized confirmation; preserve the before count and evidence.

### UX-07 — Synthetic QA records in reports

1. If a trustworthy provenance marker already exists, clearly label/filter synthetic tests in Returned and borrower aggregates; staff can still inspect the complete immutable history when authorized.
2. Never infer “test” from a person's name alone. If provenance is absent, write an explicit follow-up data/model proposal rather than forging a marker or changing historical records.
3. Do not delete, relabel or alter production loans, loan photos or movement history under this slice.

### UX-08 — Informative Activity summaries

1. Where the immutable event already contains safe old/new data, show the field(s) changed and meaningful before/after values in an expandable detail view. Otherwise say “Details unavailable” instead of fabricating a diff.
2. Respect role-based visibility, redaction, retention, PII boundaries and CSV export restrictions. Never put protected typed notes, student IDs or photo URLs into new public data or ungoverned downloads.
3. Existing Activity filters, source tabs and the chronology remain intact.

### UX-09 — Proportionate dirty-form warnings

1. Untouched forms close immediately. Only meaningful unsaved information triggers the warning, with changes described accurately where feasible.
2. A purpose-only radio selection can be discarded safely without an alarming generic data-loss message if no borrower/quantity/photo/other material information was entered. The policy should be applied consistently rather than patched in one dialog.
3. Meaningful input stays protected when switching tabs, closing, pressing Escape or following a link. Confirm or cancel never persists changes by itself.

### UX-10 — Catalogue density and navigation

1. Provide an accessible compact listing mode for high-volume catalogues without removing readable default rows. Persist the preference only through existing authorized client settings.
2. Maintain sticky headings where useful, deterministic sorting, search/filter state, keyboard access, focus retention, progressive loading and direct-link item opening.
3. Render at 320, 390, 768 and 1280 px without unintentional horizontal overflow; do not claim mobile verified until screenshots and interaction tests run.

### UX-11 — Picture entry points

1. Replace redundant visible/assistive-tech photo actions with one intelligible picture area offering clearly differentiated camera capture and file selection when the platform supports them.
2. Preserve validation, permissions, original-image retention and existing optional background cleanup. Canceling never uploads or overwrites.
3. Verify touch targets, keyboard, screen-reader labels and unsupported-camera fallback on representative devices.

### UX-12 — Consistent item action hierarchy

1. Keep stock movements, stock configuration and descriptive item edits distinct in copy and navigation. Staff should know whether an action changes quantity, configuration or item details before opening it.
2. Avoid duplicate mutable controls or a second source of truth. Retain current authorization, logging and item deep links.
3. Validate with a brief task-based walkthrough: find an item, see its stock, change a threshold, record receipt, review history, locate item, begin/cancel a loan.

## Recommended bounded implementation order and ownership

- **Slice A (integrity): UX-01 only.** Confirm server defect and repair only if reproduced. If the current behavior is already safe, fix stale queue reconciliation/copy without weakening guards. Keep this out of unrelated UI cleanup.
- **Slice B (inventory clarity): UX-02 and UX-03**, if source overlap and acceptance permit one coherent release; otherwise split.
- **Slice C (location and setup guidance): UX-04 through UX-06** as minimal UI navigation/copy changes first; actual database reconciliation, thresholds or place-content entry are **manual/administrative tasks** and separate from code.
- **Slice D (reporting): UX-07 and UX-08**, only after provenance and privacy audits.
- **Slice E (interaction polish): UX-09 through UX-12**, as one or more independently testable UI slices, not a wholesale redesign.

These are candidate groupings, **not authorized live release identifiers**. Follow the one-active-slice policy and writer locks; the accepted two-lane exception needs separate file manifests and a serial integration steward. For each slice, the implementing agent must first inspect current code/tests and map exact file ownership. Candidate test locations include tests/browser/app.spec.ts, tests/browser/live.spec.ts, tests/browser/accessibility.spec.ts, tests/worker.test.ts, and Worker end-to-end tests. Do not assume any named file still owns a behavior without checking current main and the writer branch.

## Verification contract

Each accepted code slice must:
1. Reconcile target repository root, current main and deploy/source commit, actual production version, CURRENT/HANDOFF, active writer(s), worktrees, branch ownership, acceptance and exclusions.
2. Reproduce/bound the defect in local synthetic data before repair when practical, identify a regression test, and prove successful/cancel/retry/stale/error paths.
3. Run relevant typecheck, unit/Worker E2E, browser/accessibility/multi-width checks, build, privacy/secret scan and diff review. Keep tests deterministic; report any unrun live D1 concurrency or real-device checks.
4. Preserve D1 structured truth, movement-derived stock, append-only movements/audit, R2 evidence governance, authorization, privacy and retention. Never mutate live data merely to pass a UI test.
5. For any migration or release, obtain an exact target/artifact, approved spec, provider preflight, backup/rollback and applicable reconciliation. Version number, changelog and deployment claims follow docs/PRODUCT_VERSION_GOVERNANCE.md.
6. Commit working checkpoints to the authorized active writer branch, hand off exact source/head and tests, integrate serially via steward only after every gate, and verify production separately.

**Stop conditions:** unaccepted scope; target-version contradiction; unknown writer/lock with path overlap; live data repair implied; missing authoritative test or approval; failed security/privacy/invariant gate; absent rollback for consequential changes; conflict with an accepted Road-to-V3 milestone. Report the narrow blocker rather than guessing.

## Owner decision and Codex/Claude handoff

**Decision requested:** Accept this document as a *scoped backlog / implementation-program amendment*, keeping slice acceptance and implementation GO separately governed. Recommended answer: accept the 12 outcomes and their priorities, then authorize **Slice A (UX-01)** first after the active steward reconciles main and writer state. The rest remain queued for their own bounded acceptance/release decisions.

**Immediate agent action after acceptance:** read this file from the documentation PR, inspect the current accepted release and repository, determine whether UX-01 is already covered or needs a new independent revision, and write the smallest exact source/test file manifest plus regression proof before changing application code. Do not merge this proposed file as implicit acceptance and do not append all findings to an in-progress branch by assumption.

**Documentation-only verification:** this candidate changes neither executable code nor the product version. The GitHub PR and branch are a retrieval/handoff artifact; no production rollout is claimed.

## Acceptance record

Not accepted at time of writing. Earl may accept, amend, or reject the proposal. No implementation GO recorded here.
