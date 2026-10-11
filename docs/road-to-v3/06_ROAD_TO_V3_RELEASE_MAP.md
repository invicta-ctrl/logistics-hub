# Road-to-V3 Milestone Map

`RTV3-*` identifiers are roadmap milestones. They are not product semver.

| Identifier | Milestone | Standalone outcome |
|---|---|---|
| **V2.0** | Product baseline | current Logistics Hub + Ambient Assist; **COMPLETE**, truthful handoff recorded 2026-10-08 in `docs/road-to-v2/releases/v2.0.md` ("Handoff to Road to V3") |
| **RTV3-01** | Foundation & Operability | measured, observable, recoverable, secure platform ready for new domains |
| **RTV3-02** | Event & Demand Orchestration | complete new event/requirement/request workflow independent of Promise |
| **RTV3-03** | Resource Promise & Fulfillment | time-aware availability, sourcing, reservation/promise planning |
| **RTV3-04** | Mission Control & Human Operations | goal workspace, execution, responsibility, safe handover, roster/capability graph |
| **RTV3-05** | Procurement & Replenishment | complete resource-gap-to-receiving-to-stock loop |
| **RTV3-06** | Lifecycle, Recovery & Zero-Loss | return/damage/recovery/found/catch-up/retirement closeout |
| **RTV3-07** | Predictive & Preventive Operations | forward-looking demand/risk/prevention using deterministic/statistical/AI hierarchy |
| **RTV3-08** | Operational Memory & Succession | turnover, State of Logistics, durable institutional continuity |
| **RTV3-09** | V3 Qualification / RC | integrated qualification with no rescue-feature scope |
| **V3.0** | Product General Availability | owner-approved promotion of the qualified system; no hidden feature sprint |

## Gate ownership

- RTV3-01 may proceed after a truthful V2.0 handoff.
- RTV3-02+ domain implementation requires the accepted Product Direction Amendment.
- Because RTV3-03–RTV3-08 depend on domains introduced after RTV3-02, the amendment gate is transitive.
- RTV3-09 requires all intended RTV3-01–RTV3-08 milestones to be complete.
- V3.0 requires RTV3-09 acceptance.

Future-milestone research/spec preparation may occur in parallel when it does not mutate shared truth or presume unaccepted product scope.


## Architecture and security ship with each milestone

The feature outcome and **its required architectural improvements** are one acceptance unit, not separate follow-up versions. The owner-accepted per-milestone specification must bind code quality, module ownership, obsolete-path retirement, authorization/privacy, database integrity, performance/reliability and appropriate regression/denial tests to the same release. See `01_ENGINEERING_CONSTITUTION.md` §2A, `templates/ACCEPTED_SPEC_TEMPLATE.md` and the release record template.

| Milestone | Engineering improvements delivered in the same milestone |
|---|---|
| RTV3-01 | measured platform baseline, operability/observability, critical code/security defects, CI/supply-chain safety, offline/recovery and Ambient Assist contracts |
| RTV3-02 | cohesive event/requirement domain, API/validation contracts, steward permissions, provenance, bounded event queries, replay-safe writes |
| RTV3-03 | Promise/availability boundary, concurrency and uniqueness constraints, time-window query/index efficiency, inventory authority separation |
| RTV3-04 | Mission/Human Operations boundaries, server-composed permission-filtered workspace reads, frontend split/refresh discipline and safe handovers |
| RTV3-05 | procurement/receiving transactions, audited approval boundaries, supplier/query performance, governed R2 evidence and no duplicate stock truth |
| RTV3-06 | lifecycle transition correctness, immutable ledger preservation, idempotent returns/recovery, bounded reconciliation and retired dead paths |
| RTV3-07 | isolated explainable analytics, scheduled/bounded computation, advisory-only access, cache/projection rebuildability and off-switch failures |
| RTV3-08 | privacy-filtered historical projections, bounded reports, retention, source-linked memory and role continuity |
| RTV3-09 | integrated qualification of all previously shipped engineering criteria; **no postponed feature or architectural rescue work** |

**Sizing:** nine RTV3 milestones are not nine Git slices. One active `slice/*` branch is permitted at a time under current repository governance; each accepted milestone ordinarily contains 6–10 bounded packets (RTV3-01 defines eight). The final Git slice count is set by accepted specs and safe integration boundaries, not guessed from the number of milestones.

