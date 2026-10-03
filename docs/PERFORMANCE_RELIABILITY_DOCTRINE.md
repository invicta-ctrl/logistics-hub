# Performance & Reliability Doctrine

STATUS: OWNER-DIRECTED ARCHITECTURE DOCTRINE
SCOPE: All Road-to-V2 work unless an accepted specification explicitly overrides a rule
LAST REVIEWED: 2026-10-03

## Purpose

The Logistics Hub should behave like a durable, boring machine: predictable under normal load, graceful under failure, inexpensive to operate, and easy to reason about years later. Complexity is permitted only when it protects a real invariant, removes measured waste, or solves a demonstrated scaling problem. Simple workflows should remain simple.

This doctrine is not a mandate to optimize everything. It is a permanent guardrail against unbounded work, silent resource growth, fragile state duplication, and performance regressions.

## Core design rule: bounded work

As the Hub grows, ordinary user actions must not automatically become more expensive in proportion to the entire database, media library, or history.

For any common action, prefer a design where the amount of work is bounded by the user's immediate task:

- A list view should render only the rows needed for the current viewport/page plus a small buffer.
- An API should return a bounded page, not an unlimited collection, once a collection can reasonably grow large.
- A detail view should fetch the selected record and bounded related history, not every related event ever recorded.
- Images should load only when needed and at an appropriate variant/size.
- Background refresh should use revision/version checks or cache validation instead of repeatedly downloading unchanged data.
- Writes should occur because authoritative state changed, not because a user merely viewed, hovered, focused, or repeatedly refreshed a screen.

Small datasets and truly small workflows may stay simple. Do not add pagination, caching, queues, or abstractions where the data is demonstrably bounded and the simpler implementation is clearer.

## Non-negotiable data invariants

1. D1 remains the structured operational source of truth.
2. R2 stores governed files/media/evidence; object storage must not become an independent source of structured business truth.
3. Inventory quantity remains movement-derived from the append-only ledger. Do not introduce a mutable `current_quantity` shortcut as a second authority.
4. Idempotency, append-only rules, and auditability take priority over shaving a small amount of latency.
5. A cache, summary table, replica, or precomputed read model is always disposable/rebuildable from authoritative state unless an accepted specification explicitly defines otherwise.
6. Schema/index changes require an additive migration. Never edit or replay an already-applied production migration.

## Simplicity gate

Before adding infrastructure or a new abstraction, answer all of the following:

1. What measured problem exists now?
2. What user-visible or resource failure will occur if nothing changes?
3. Can an index, bounded query, smaller payload, browser cache, or simpler algorithm solve it first?
4. What new failure mode and maintenance burden does the proposed complexity introduce?
5. How will the change be measured and rolled back?

If these questions do not have strong answers, keep the simpler design.

Do not introduce Redis, Elasticsearch, another database, an event bus, a generic repository framework, a permanent distributed cache, or a second stock authority merely as future-proofing.

## Cloudflare resource envelope

The Hub is designed for the Cloudflare Free plan with generous headroom. Provider limits change, so official Cloudflare documentation must be rechecked before major releases and during V1.14.

Current reference snapshot as of 2026-10-03:

| Resource | Current Free allowance | Green design target | Caution | Protective action threshold |
| --- | ---: | ---: | ---: | ---: |
| Worker requests | 100,000/day | <=20% | >35% | >=50% |
| Worker CPU | 10 ms/request | common paths comfortably below ceiling | repeated near-limit samples | sustained approach to ceiling |
| D1 rows read | 5,000,000/day | <=20% | >35% | >=50% |
| D1 rows written | 100,000/day | <=20% | >35% | >=50% |
| D1 storage | 5 GB total | <=20% | >35% | >=50% |
| R2 Standard storage | 10 GB-month/month | <=20% | >35% | >=50% |
| R2 Class A operations | 1,000,000/month | <=20% | >35% | >=50% |
| R2 Class B operations | 10,000,000/month | <=20% | >35% | >=50% |

Official references:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/

These percentages are engineering guardrails, not promises that malicious traffic, provider incidents, or extraordinary imports can never exceed a quota. The rule is that normal Hub operation must never be intentionally designed near the provider ceiling.

### Resource-envelope policy

- Green is the expected operating zone.
- Crossing caution requires investigation before adding more load-producing features.
- Crossing the protective threshold requires corrective work, a documented exception, or an explicit plan change before rollout.
- A feature may not consume most of a shared free-tier allowance merely because it technically fits today.
- Prefer eliminating unnecessary work over purchasing complexity.
- Quota checks must distinguish normal product usage from migrations, restoration rehearsals, bulk imports, load tests, and development/test traffic.

## Database performance policy

### Query rules

- All user-facing queries over potentially growing tables must be bounded or demonstrably selective.
- Prefer cursor/keyset pagination over deep offset pagination for growing ordered collections.
- Avoid `SELECT *` on hot paths when the caller needs only a small summary shape.
- Avoid whole-ledger scans on routine requests.
- Do not denormalize authoritative state solely to avoid writing a correct index or query.
- Use D1 batch/transaction semantics when operations must succeed or fail together or when batching safely reduces round trips.
- Keep read/write paths easy to trace from endpoint to SQL.

### Index rules

Every index must correspond to a real query pattern. Before adding one:

1. Capture the representative query and fixture scale.
2. Run/record `EXPLAIN QUERY PLAN`.
3. Measure D1 `duration`, `rows_read`, `rows_written`, and returned rows where available.
4. Add the narrowest useful index.
5. Re-run the same measurement.
6. Keep the index only when it materially improves the intended workload without unreasonable write/storage cost.
7. Run the appropriate SQLite/D1 optimization step after index changes where supported.

Indexes are not trophies. Unused or redundant indexes increase write cost and storage and should be removed through normal migration/review processes when proven unnecessary.

### Inventory balance rule

The movement-derived balance model is intentionally reliable and should remain the default. If ledger growth eventually makes repeated aggregation too expensive, escalation order is:

1. verify query plan and predicates;
2. improve/add measured indexes;
3. narrow/bound the caller's requested scope;
4. cache only safe, reconstructable read results;
5. only then consider a reconciled/materialized balance read model with explicit rebuild/reconciliation rules.

A materialized balance must never silently become a second authority.

## Frontend performance policy

### Large collections

A user should not pay browser cost for every database row merely because the collection contains them.

For large or potentially growing lists:

- Use bounded server results and/or viewport virtualization/windowing.
- Keep the live DOM approximately bounded as total record count grows.
- Preserve natural scrolling, accessibility, keyboard behavior, focus, sorting/filtering semantics, and stable row dimensions.
- Do not hide database inefficiency behind client-side virtualization; both layers must be appropriate to their responsibilities.

A list that scales from 500 to 5,000 to 50,000 records should not create linearly growing live DOM work during ordinary browsing.

### JavaScript and layout

- Prefer platform/browser primitives and existing project patterns over adding libraries for small conveniences.
- Avoid wrapper-heavy markup when it provides no semantic, accessibility, or layout value.
- Expensive layout/style work discovered by measurement is a valid defect even when API latency is low.
- Route transitions and state changes must not depend on decorative animation completing successfully.

## Media and R2 policy

- Store operationally useful image variants rather than repeatedly shipping oversized originals to list views.
- List/card surfaces use thumbnails; detail/profile surfaces request only the size they need.
- Lazy-load non-critical media and reserve dimensions to prevent layout shift.
- Use stable/versioned cacheable object URLs or equivalent cache validation where privacy rules permit.
- Avoid unnecessary R2 `list` calls on user-facing paths; structured D1 metadata should identify required objects.
- A missing image must not break item lookup, stock movement, lending, or other core operations.
- Private media must never become public merely to gain caching convenience.

## Network and refresh policy

- Never use high-frequency polling by default when revision/version checks, explicit refresh, cache validation, or an existing event mechanism can solve the same problem.
- A revision check should be cheaper than re-fetching the payload it protects.
- Debounce bursty user-driven reads where doing so is invisible to correctness.
- Retry only operations known to be retry-safe/idempotent.
- Use exponential/backoff behavior for repeatable network failures rather than immediate request storms.
- Offline queues must remain bounded and observable to the user when they contain unsynced authoritative actions.

## Reliability policy

### Critical-path isolation

Core workflows should have the fewest required dependencies possible.

Examples:

- Failure to load a photo must not block inventory actions.
- Failure to load a dashboard metric must not block a loan or stock movement.
- Failure of optional search enhancement must leave a basic recovery/browsing path when practical.
- Telemetry failure must not fail the underlying transaction.

### Graceful failure

For every state-changing workflow, define:

1. authoritative commit point;
2. retry behavior;
3. duplicate/idempotency behavior;
4. interruption/reload behavior;
5. user-visible recovery state;
6. audit evidence;
7. rollback or compensating procedure where applicable.

Never silently discard queued evidence or silently overwrite a newer authoritative state.

### Recovery

- Continue tested D1 backup/restore and Time Travel procedures.
- Recovery instructions must name the exact target and verification steps.
- Destructive production operations require explicit target confirmation, rollback/recovery preparation, and post-change verification under existing project policy.
- R2 metadata and D1 references must be checked for orphan/stale relationships during hardening exercises.

## Observability without telemetry bloat

Use provider/runtime telemetry and targeted development instrumentation before creating a custom analytics subsystem.

Required measurable dimensions for hot paths include, where available:

- end-to-end request latency;
- Worker CPU time;
- D1 SQL duration;
- D1 rows read/written/returned;
- query plan for known hot SQL;
- API response size;
- number of requests/subrequests for a user action;
- R2 operations and transferred object sizes;
- browser main-thread time, style/layout work, DOM size, and memory trend for large surfaces.

Development diagnostics may expose a compact timing breakdown (for example through standard timing headers or local instrumentation) but must not leak secrets, PII, SQL values, or internal authorization data to public clients.

## Performance test tiers

Do not benchmark only the current production snapshot. Use deterministic fixtures representing at least:

1. **Current-like:** approximately today's catalog/activity scale.
2. **Growth:** roughly 10x the important collection/ledger dimension.
3. **Stress:** roughly 100x where feasible for isolated read-path tests, or the largest practical fixture justified by the subsystem.

The purpose is not to make every operation equally fast at 100x. The purpose is to expose accidental O(N) behavior, unbounded DOM/data transfer, full-table scans, retry storms, and storage growth before production reaches that scale.

## Regression contract for every Road-to-V2 slice

A feature that touches a hot or growing path must provide evidence that it did not materially regress the relevant resource/performance dimension.

At minimum, reviewers should ask:

- Did this add an unbounded query, response, DOM list, cache, queue, or media fetch?
- Did this add writes for an action that used to be read-only?
- Did rows read/written materially increase?
- Did request count/subrequest count materially increase?
- Did the feature create a new periodically repeating request?
- Did the browser workload grow with total database size when it could remain bounded?
- Does failure of the new dependency block a critical workflow?
- Is added complexity justified by measured need?

Do not block a simple, low-risk feature with irrelevant benchmarking. Apply the evidence proportionally to the path being changed.

## When advanced techniques become justified

The following are allowed only after simpler remedies are measured and insufficient:

### Read replication

Consider D1 read replication/Sessions when measured network/database placement latency materially dominates read-heavy user workflows. Preserve required consistency semantics and verify read-your-own-writes behavior.

### Materialized read models

Consider only for repeatedly expensive aggregates that cannot be made sufficiently cheap with query/index/bounding improvements. They must be rebuildable, reconciled, and clearly non-authoritative.

### Dedicated search infrastructure

Do not add it while indexed D1 search/query approaches meet product requirements at measured scale. Revisit only when V2 search requirements demonstrably exceed D1's practical role.

### Background processing

Add queues/background workers only when a task is genuinely too expensive, slow, or failure-prone for the request path and the operational benefit exceeds the new state/retry complexity.

## V1.14 responsibility

V1.14 Offline, Performance & Reliability Hardening is the proof phase for this doctrine, not the first time these rules apply. V1.14 must:

- establish measured baselines and growth/stress fixtures;
- verify that large lists, APIs, images, caches, queues, and histories remain bounded;
- measure Cloudflare resource-envelope consumption and model realistic daily/monthly usage;
- identify and repair expensive D1 query plans and unnecessary R2/Worker operations;
- validate offline/retry/conflict/idempotency behavior under interruption;
- confirm recovery paths, privacy boundaries, and degraded-state UX;
- produce before/after evidence and document justified exceptions.

Earlier Road-to-V2 slices should follow the doctrine when touched, but V1.14 owns the comprehensive cross-product proof.

## Definition of durable success

The Hub is healthy when adding more records primarily increases storage, not the amount of work required for every ordinary user action; when optional features can fail without taking down critical workflows; when authoritative state remains simple and recoverable; and when normal operation stays far enough below provider limits that traffic spikes, maintenance, and mistakes have room to breathe.
