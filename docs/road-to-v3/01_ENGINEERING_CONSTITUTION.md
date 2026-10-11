# Engineering Constitution

These rules apply to every Road-to-V3 release.

## 1. Authority and truth

- D1 remains structured operational truth.
- R2 remains governed media/evidence storage.
- Physical stock quantity remains derived from the accepted movement/ledger model.
- Derived projections may accelerate reads but never become competing authorities.
- AI-derived state is advisory/rebuildable until a human-approved normal domain action makes a change authoritative.

## 2. Release independence

Every release must remain useful if no later release is ever built.

Successors may automate, compose, explain, or accelerate predecessors.
They may not rescue an incomplete predecessor.


## 2A. Version-aligned architecture, code quality and security delivery

For **every** RTV3 milestone, code-quality, modularization, security, data integrity, performance, reliability, accessibility and maintainability improvements needed by its accepted feature scope are part of **that same milestone's implementation and release acceptance**. RTV3-01 establishes foundational controls; RTV3-02–RTV3-08 evolve them alongside each domain; RTV3-09 qualifies the integrated system and must not become a deferred architecture-fix sprint.

The accepted milestone spec must include a baseline and a bounded engineering-delivery matrix identifying:
- existing modules, contracts, data ownership and security boundaries affected;
- necessary simplification, cohesion/modularization, obsolete-code removal and dependency reductions;
- necessary authorization, privacy, input validation, negative tests and operational security;
- D1/R2 correctness, indexes, concurrency, idempotency, migration and rollback as applicable;
- performance, observability, offline/recovery, accessibility and browser behavior as applicable;
- packet ownership, specific acceptance criteria, evidence and any justified `N/A` items.

Plan, implement, test, review and ship each required correction **with the corresponding user-facing capability**. Do not call the milestone COMPLETE while a known required engineering correction remains unresolved or depends on a future release. Defer only clearly nonessential work through a recorded owner-approved scope/risk decision, without breaking predecessor independence or critical safety gates.

Refactoring is **not** a standing license for wholesale rewrites. First remove/merge/reuse existing code; create new abstractions only when the accepted slice needs them and they measurably clarify or harden the system. Preserve known-good behavior, repository branch/writer policy, authoritative D1/R2/ledger invariants, and rollback safety. Record before/after evidence or honestly mark any unmeasurable claim.


## 3. Write correctness

Do not mix atomicity, concurrency, and idempotency into one ladder.

### Atomicity
Choose the smallest mechanism that makes the authoritative state transition indivisible:
- one SQL statement where possible;
- D1 batch/transactional grouping where multiple statements must succeed together;
- database constraints for impossible states.

### Concurrency
Protect conditional state transitions:
- expected-current predicates;
- affected-row assertions;
- uniqueness constraints;
- conflict responses that are safe to retry/review.

### Idempotency
Design idempotency **at the operation boundary before implementation**, not as the last step:
- client/generated idempotency key where needed;
- stable operation identity;
- duplicate/replay semantics;
- retry-safe server behavior.

## 4. Offline correctness

Offline records are user data.

If a record is quarantined because it is malformed or unreplayable, it must remain:

- visible to the user/admin in an appropriate recovery surface;
- exportable or copyable;
- diagnosable with a reason code;
- retryable after correction when safe;
- explicitly discardable only through a deliberate action.

Never silently hide or drop an offline record.

A poison record must not block unrelated queued work.

## 5. Failure and rollback

Keep three mechanisms distinct:

1. **Worker/code rollback** — previous application version.
2. **Forward-fix migration** — repair schema/data behavior without pretending code rollback rewinds D1.
3. **Data restore** — recover D1/R2 data from an accepted recovery point.

A code rollback is not a database restore.

## 6. Restore objectives

Initial Road-to-V3 owner targets, to be proven or amended during RTV3-01:

- core D1 operational truth: **RPO ≤ 1 hour**;
- governed R2 evidence/media: **RPO ≤ 24 hours** unless a stricter source-specific mechanism is proven;
- core Logistics operation: **RTO ≤ 4 hours** during a staffed incident;
- full evidence/media restoration: **RTO ≤ 8 hours**.

If platform evidence cannot meet these targets, RTV3-01 must document the measured capability and obtain an explicit owner amendment rather than using vague language such as "proportionate."

Restore verification must prove representative business records and governed R2 references/content, not only that tables exist.

## 7. Incident ownership

### SEV-1
Examples: production unavailable, data corruption, authorization bypass, destructive deployment, broad loss of core operation.

- incident owner: Project Owner or delegated authorized system owner;
- technical incident commander: first available authorized maintainer assigned by the owner/coordinator;
- acknowledgement target: 15 minutes during staffed incident response;
- first containment decision: 60 minutes;
- status update cadence: every 30 minutes until contained.

### SEV-2
Major workflow impaired with workaround.

- acknowledgement target: 4 staffed hours;
- owner/update recorded in repository issue/release incident record.

### SEV-3
Localized defect/non-critical regression.

- enters normal backlog/release triage.

Do not log secrets, private IDs, private image contents, or unnecessary model payloads in incident telemetry.

## 8. Performance and budgets

Roadmap documents must not invent route budgets before measurement.

RTV3-01 must:

1. inventory public/staff routes;
2. group them by operational profile;
3. measure current bundle, request, D1, R2, payload, rendering, and interaction behavior;
4. establish accepted budgets from evidence;
5. record those budgets in the RTV3-01 release evidence / accepted performance contract.

Every later release inherits the measured budget contract and may amend it only with evidence.

## 9. Fixtures

Use the same fixture hierarchy throughout the program:

- **1×** — representative current-scale fixture;
- **10×** — growth fixture;
- **100×** — stress fixture.

A release may additionally add a domain-specific adversarial fixture, but may not silently remove one of the three tiers.

RTV3-01 must define realistic synthetic activity assumptions for these fixtures, including ordinary day, event-heavy day, and burst/reconnect behavior where applicable.

## 10. Security belongs early

Supply-chain and operational-tooling security is RTV3-01 work, not a late Road-to-V3 cleanup.

Include:

- CI action pinning/current policy;
- stale allowlists;
- secret scanning;
- deployment target verification;
- fail-closed Git/deploy state;
- migration verification;
- production decrypt/output protections;
- dependency/runtime version policy;
- least-privilege Cloudflare credentials;
- private-data scan validity.

## 11. Human Operations privacy

Operational status must never become surveillance.

Permitted examples:
- Available;
- On Mission;
- Temporarily Unavailable;
- Handover Active.

"On Mission" is a workflow state only.

It must never:
- capture GPS/location;
- infer location from a mission venue;
- require continuous location permission;
- expose precise whereabouts;
- affect staff permissions;
- score productivity;
- create attendance history.

Mission venue belongs to the Mission/Event domain, not to a staff-location telemetry system.


## 12. Frontend behavior

Frontend behavior must preserve:

- responsive primary workflows;
- calm visual hierarchy;
- bounded dense panels with internal scrolling where appropriate;
- public/staff code separation unless a demonstrated reason requires overlap;
- motion that clarifies state rather than decorates routine work.

Accessibility requirements are defined only in **§19 Accessibility verification checklist**.
Do not duplicate or weaken that checklist here.


## 13. Decommissioning rule

Whenever Road-to-V3 supersedes a V2 feature, the release spec must include:

- old capability being superseded;
- data mapping/migration;
- coexistence period if any;
- cutover trigger;
- old entry-point behavior after cutover;
- rollback behavior;
- archival/deletion rule;
- documentation update;
- proof that no orphan data/workflow remains.

No "new screen added, old screen forgotten."

## 14. Delete before adding

Before adding infrastructure, abstraction, cache, queue, framework, projection, table, or background worker, attempt the cheaper simplification ladder first:

```text
remove obsolete work
↓
merge duplicated behavior
↓
avoid repeated work
↓
bound the workload
↓
fix access path / index
↓
cache only measured repeated reads
↓
add a rebuildable projection only when evidence justifies it
↓
optimize implementation
↓
add new infrastructure only when the simpler steps are insufficient
```

Use DAMP/YAGNI over speculative abstraction.

A new abstraction must remove more complexity than it introduces.

Every task should ask:

> What can be deleted, merged, or made unnecessary before we add another mechanism?

## 15. Standing anti-patterns

Do not introduce these without an explicit accepted architectural amendment:

- a second authoritative database beside D1;
- Redis or another external cache merely because caching is familiar;
- mutable `current_quantity` as competing stock truth when movement-derived quantity is authoritative;
- a generic repository/service/framework layer that hides simple domain code without measurable benefit;
- a speculative message queue/event bus with no demonstrated fan-out/reliability requirement;
- a second permission system or client-only authorization;
- browser-held privileged secrets;
- AI directly executing SQL or privileged writes;
- duplicate AI stacks per feature instead of the shared Ambient Assist router;
- unbounded whole-table/history scans in interactive paths;
- a second staff-presence/location system;
- shadow audit/history stores that can diverge from authoritative records.

When an exception is truly needed, the accepted spec must identify the anti-pattern, justify the exception with evidence, define ownership, and define removal/rollback.

## 16. Denial tests are mandatory

A control is incomplete until both allowed **and denied/failure** behavior are exercised.

Examples:

- authorized role succeeds **and** unauthorized role is rejected;
- public route serves public media **and** cannot retrieve private evidence;
- valid CSRF/session succeeds **and** invalid/revoked state fails;
- active account works **and** revoked/disabled account loses access;
- rate limiting allows normal traffic **and** actually throttles abuse;
- expected-current write succeeds **and** stale concurrent write is rejected safely;
- AI allowlisted payload runs **and** forbidden identity/evidence payload is blocked before provider invocation;
- offline valid record replays **and** malformed record is quarantined without blocking later work.

Security, privacy, permission, concurrency, and recovery acceptance criteria must include negative cases.

## 17. Unknown is not clean

A failed or unreadable production/Git/provider/security state is **UNKNOWN**, never equivalent to:

- clean;
- zero;
- first deploy;
- no secrets;
- no changes;
- no previous deployment;
- migration not applied;
- provider healthy.

Consequential deploy, secret, migration, restore, production-target, or permission decisions must fail closed when the required state cannot be established.

Never convert an exception into a safe default merely to let automation continue.

## 18. Browser and device support policy

Unless an accepted release spec narrows or expands support with evidence, qualification targets:

### Desktop
- Chrome: current major and previous major;
- Edge: current major and previous major;
- Firefox: current major and previous major;
- Safari: current major and previous major where platform availability permits.

### Mobile
- iOS Safari: current major and previous major;
- Android Chrome: current major and previous major.

PWA/install/update behavior is additionally tested on representative supported iOS and Android devices when the feature depends on PWA behavior.

A release does not need exhaustive physical-device coverage for every patch, but RTV3-09 qualification must record the actual tested matrix and any accepted gaps.

## 19. Accessibility verification checklist

WCAG 2.2 AA is the target, and each affected interface must explicitly verify at least:

1. semantic landmarks/heading structure;
2. accessible names for controls;
3. full keyboard operation where applicable;
4. visible focus indication;
5. sufficient contrast;
6. reduced-motion behavior;
7. 200% text zoom without destructive horizontal scrolling for primary workflows;
8. practical touch target sizing on mobile;
9. status/error/success meaning not conveyed by color alone.

Accessibility evidence should test real task flows, not only static lint output.

## 20. Evidence before claim

Do not claim a regression is fixed, a route is faster, a query is bounded, a restore works, or an AI change saves quota without evidence.

Use:

```text
BEFORE:
AFTER:
DELTA:
FIXTURE / DATA SHAPE:
METHOD / COMMAND / TOOL:
PASS CRITERION:
LIMITATIONS:
```

If the before-state cannot be reproduced, say so.  
If the evidence is synthetic, label it synthetic.  
If a provider metric is unavailable, use a conservative proxy and label it honestly.

## 21. Motion budget

Motion must communicate state/continuity, not decorate routine work.

Default interaction guidance:

- micro feedback: approximately **120–180 ms**;
- ordinary panel/sheet transitions: generally **≤300 ms**;
- prefer `transform` and `opacity` over layout-triggering animation;
- avoid stacked sequential animations that block the user's next action;
- respect `prefers-reduced-motion`;
- do not make save/navigation wait for animation completion.

These are UX defaults, not excuses to ignore measured device performance.

## 22. Fixture pass criteria

The required 1× / 10× / 100× fixtures must have declared pass criteria before results are run.

### 1× representative
Pass only if:
- correctness and security criteria pass;
- accepted route/interaction budgets pass;
- no unbounded scan is present;
- no fixture-specific exception is needed.

### 10× growth
Pass only if:
- correctness remains identical;
- no queue starvation/data loss appears;
- accepted growth budgets pass;
- query/row/payload growth is explainable and within the accepted contract.

### 100× stress
This is a resilience/shape test, not permission for arbitrary slowness.

Pass only if:
- no corruption or authority divergence occurs;
- no crash/lockup/permanent queue wedge occurs;
- workloads remain bounded;
- backpressure/pagination/degradation behavior is controlled;
- any relaxed latency threshold was predeclared in the accepted spec before the run.

A release cannot "pass" merely because all three fixture commands completed.
