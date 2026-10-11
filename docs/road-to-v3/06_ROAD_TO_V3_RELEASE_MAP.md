# Road-to-V3 Release Map — V2.0 → V2.1–V2.9 → V3.0

Owner amendment (2026-10-11): `RTV3-01`–`RTV3-09` are stable **internal milestone identifiers**. The actual planned **product versions** are `V2.1`–`V2.9`. Labels are shown on the site only after the corresponding verified release is deployed; a documentation commit is not a product version bump.

| Product version | Internal milestone | Standalone outcome |
|---|---|---|
| **V2.0** | Existing shipped baseline | Logistics Hub + Ambient Assist; historical handoff in `docs/road-to-v2/releases/v2.0.md` |
| **V2.1** | `RTV3-01` | Foundation & Operability, including **visible deployed product version** in Administration → System |
| **V2.2** | `RTV3-02` | Event & Demand Orchestration, independent of Promise |
| **V2.3** | `RTV3-03` | Resource Promise & Fulfillment, time-aware availability and planning |
| **V2.4** | `RTV3-04` | Mission Control & Human Operations, execution and safe handovers |
| **V2.5** | `RTV3-05` | Procurement & Replenishment, sourcing through stock receiving |
| **V2.6** | `RTV3-06` | Lifecycle, Recovery & Zero-Loss, complete closeout |
| **V2.7** | `RTV3-07` | Predictive & Preventive Operations, advisory prevention |
| **V2.8** | `RTV3-08` | Operational Memory & Succession, turnover continuity |
| **V2.9** | `RTV3-09` | Qualification / release candidate; no rescue feature sprint |
| **V3.0** | General Availability | Owner-approved promotion of qualified platform |

**Naming continuity:** old `V3.1`–`V3.7` roadmap labels and RTV3 file names remain searchable history, not instructions to ship versions after V3.0. Check `08_RECONCILIATION_REGISTER.md` for identifier history.

## Gate ownership

- RTV3-01 may proceed after a truthful V2.0 handoff.
- RTV3-02+ domain implementation requires the accepted Product Direction Amendment.
- Because RTV3-03–RTV3-08 depend on domains introduced after RTV3-02, the amendment gate is transitive.
- RTV3-09 requires all intended RTV3-01–RTV3-08 milestones to be complete.
- V3.0 requires RTV3-09 acceptance.
- V2.1/RTV3-01 F4 must verify its **actual deployed product version** in Administration → System separately from the existing build fingerprint. Each later release must update this same view upon verified deployment.

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

