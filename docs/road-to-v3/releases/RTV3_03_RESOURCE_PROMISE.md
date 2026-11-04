# V2.3 (RTV3-03) — Resource Promise & Fulfillment

**Release identity:** planned product **V2.3**; stable internal milestone **RTV3-03**. Historical V3.x roadmap names are retired. Verify deployment identity before announcing the release; ship required architecture, modularization, and security improvements within this same release (Engineering Constitution §2A).

## Outcome
Convert demand into a time-aware, explainable resource plan.

## Capabilities
- resource availability by relevant time/window;
- Promise/reservation domain;
- conflict detection;
- source selection;
- accepted substitutes;
- reallocation options;
- internal authorized sources;
- rent/procurement handoff candidates without requiring procurement to exist.

Fulfillment ladder:
1. owned and available;
2. becoming available in time;
3. safe reallocation;
4. authorized internal source;
5. accepted substitute;
6. rental/external source;
7. procurement candidate.

## Correctness
- Promise is not physical stock;
- races are protected;
- expected-current and uniqueness rules defined;
- idempotency is designed at operation boundary;
- high-contention paths have tests.

## AI
May rank/explain already-valid alternatives.
May not create/approve a Promise without normal domain rules and human authority.

## Independence
If RTV3-04 never exists, RTV3-03 still provides a complete fulfillment-planning workflow.

## Adaptive Operations UI note (direction only)

See [`10_ADAPTIVE_OPERATIONS_UI_DIRECTION.md`](../10_ADAPTIVE_OPERATIONS_UI_DIRECTION.md). It is not accepted scope: adopting it needs this milestone's own prospective amendment.
- **Integration:** Time-aware owned/future/reallocation/internal source/substitute/rental/procurement candidate ladder; split-source coverage, conflicts and human Promise review.
- **Boundary:** Promise ≠ physical stock; protect expected-current/concurrency/idempotency; no unilateral AI reservation/release.
