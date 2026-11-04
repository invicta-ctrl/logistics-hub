# Adaptive Operations UI: cross-release direction (V2.1–V3.0)

STATUS: DIRECTION ONLY. This is not an accepted milestone specification and changes no accepted scope. It does not replace the V2.2+ Product Direction Amendment gate (`07_PRODUCT_DIRECTION_AMENDMENT_DRAFT.md`). Each milestone that adopts this direction records its own prospective amendment before substantial implementation.
SOURCE: owner request of 2026-10-11, carried as GitHub issue #35 (design-only handoff), transferred here on 2026-11-04 and the issue closed.
MAPPING: `06_ROAD_TO_V3_RELEASE_MAP.md` is unchanged. Product versions V2.1–V2.9, then V3.0; internal IDs RTV3-01–RTV3-09 stay.

## Direction

Adaptive UI is deterministic-first, task-specific progressive disclosure using existing HTML/CSS/TypeScript, `src/ui.ts`, `src/styles.css` design tokens, and existing Workers/D1/R2/ledger contracts. Reuse current data-surface UI patterns; **do not add React, a generic dynamic UI engine, a new AI chat, a top-level tab, new permission system, competing quantity truth or paid API dependency**. Preserve oxblood/warm paper/gold, restrained hierarchy, one clear primary action + accessible More actions, accessible focus/sheets, container-sensitive mobile cards, bounded history scrollers, honest Unknown/Potential/Confirmed states. Ambient Assist remains optional, privacy-limited and advisory; normal workflows operate with AI off.

## By release

Each release stays independently useful.

| Product version | Integration within existing release | Explicit boundary |
|---|---|---|
| **V2.1 / RTV3-01 Foundation** | Qualify/reuse existing interaction primitives, semantic labels, input/focus/a11y, responsive density and measured budgets during F5/F4/F7; only touch existing scoped surfaces. | **No new Event, Promise or Procurement capability; no extra shared UI engine.** V1.16 readiness gate remains. |
| **V2.2 / RTV3-02 Events** | New goal-oriented event-demand workspace; reveal category/time/venue/context-dependent requirement fields; bounded clarification history and owner/requester role-specific copy. | Not the retired Request Center; demand capture works without V2.3; no invented demand or automatic approval. |
| **V2.3 / RTV3-03 Fulfillment** | Time-aware owned/future/reallocation/internal source/substitute/rental/procurement candidate ladder; split-source coverage, conflicts and human Promise review. | Promise ≠ physical stock; protect expected-current/concurrency/idempotency; no unilateral AI reservation/release. |
| **V2.4 / RTV3-04 Mission Control** | One bounded server-composed goal workspace with next permitted action, mission blockers, responsibilities and safe human handovers. | Role checked on server; no GPS, attendance/productivity scoring, AI staffing decisions; works without V2.5. |
| **V2.5 / RTV3-05 Procurement** | Existing *authorized* gap becomes a sourcing review; show actual quotes, evidence, expiry and discrepancies only as present; separate proposal, approval, receiving. | No automatically originated procurement need, guessed vendor/price or autonomous purchase; R2 private evidence protected. |
| **V2.6 / RTV3-06 Lifecycle** | Feed verified returns/damage/reconciliation state back into existing resource views and recovery actions. | No ledger rewrite, shadow on-hand value or automatically usable returned stock. |
| **V2.7 / RTV3-07 Predictive** | Explicit what-if controls; later evidence-backed bounded forecasts with source, uncertainty, freshness and measured error. | Scenario arithmetic is not a historical forecast; no autonomous procurement/stock changes; switch-off leaves core working. |
| **V2.8 / RTV3-08 Memory** | Contextual, provenance-linked handovers/State-of-Logistics, privacy-filtered succinct notes. | Generated summaries never authoritative and never required for operation. |
| **V2.9 / RTV3-09 Qualification** | End-to-end keyboard/mobile/a11y, offline recovery, denial, concurrency, privacy/performance and AI-off qualification of all shipped patterns. | No deferred rescue feature sprint. |
| **V3.0 GA** | Owner-reviewed promotion of qualified releases. | No new unreviewed UI scope. |

Keep product mapping exactly V2.1–V2.9 then V3.0; internal RTV3-01–RTV3-09 identifiers remain intact.

## Test scenario: five extension cords (synthetic)

Requested 5; simulated USC candidates 2; **potential, unconfirmed** shared units 1; unresolved 2. The formula `5=2+1+2` is a **presentation example**, not proof of available/committed quantity. No use window, current inventory or source authority is known. Show **zero actual commitments known**, not "3 confirmed available." Changing quantity/what-if only changes local demonstration numbers. Do not place Promise, reserve, allocate, write stock movement/ledger, approve, procure, or save. Real changes always go through role-checked normal domain endpoints and stock movement rules after human review.

## Acceptance and verification for future scoped releases

- At 320/390/768/1024/1440 px and constrained parent containers, no clipped actions/sideways page scrolling; touch and keyboard focus/Escape/return paths work. Test 200% text and reduced motion.
- Clear and distinguishable Candidate, Potential, Unresolved, Unknown, Promised, Released; unknown never becomes zero; all state not dependent solely on color.
- Role-denied actions fail server-side; stale concurrent Promise/stock updates fail safely; offline drafts survive malformed/reconnect paths; privacy allowlists block forbidden AI payloads.
- No AI or prediction required for any core workflow; quota/403/429/timeout/invalid output doesn't block users; no autonomous operational truth mutation.
- Each release remains usable if every successor is never shipped; no new API/data model/dependency without accepted milestone spec; privacy, typecheck, focused tests, browser tests and measured budgets evidence.

## Design artifacts

The owner's ChatGPT session includes a self-contained, offline synthetic HTML prototype and a detailed Markdown design proposal. Their binary bytes are **not yet in the repository**. A future authorized docs slice should review/transfer the safe design assets into a suitable `docs/road-to-v3/` path, avoiding production deployment paths and sensitive data. Do not treat this GitHub issue as proof the assets were committed or implemented.

**Stop conditions:** conflicting writer/branch, stale/absent accepted spec, missing Product Direction Amendment for V2.2+, privacy boundary, accidental main/product changes, non-evidence-based performance claims.
