# RTV3-03 — Resource Promise & Fulfillment

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
