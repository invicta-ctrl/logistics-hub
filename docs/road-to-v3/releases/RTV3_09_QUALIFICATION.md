# V2.9 (RTV3-09) — V3 Qualification / Release Candidate

**Release identity:** planned product **V2.9**; stable internal milestone **RTV3-09**. Historical V3.x names are retired. This qualification milestone **verifies** architectural and security work already delivered in V2.1–V2.8; it does not rescue deferred work. Verify deployment identity before claiming V2.9 or V3.0.

## Rule
RTV3-09 is a qualification release, not a rescue sprint.

No unfinished RTV3-01–RTV3-08 feature may be relabeled as "qualification work."

## Qualification domains
- full product journeys;
- public/staff authorization;
- D1 write/concurrency/idempotency;
- R2 evidence access;
- 1×/10×/100× fixtures;
- route/performance budgets;
- offline restart/reconnect/poison records;
- migration verification;
- code rollback / forward fix / restore distinction;
- D1 and R2 recovery proof;
- RPO/RTO exercise;
- AI off/outage/quota/malformed/deprecated-model cases;
- privacy;
- accessibility;
- supported browsers/devices;
- one-person-operable Logistics day;
- decommissioned V2 feature checks;
- incident/runbook exercise;
- CI/supply-chain verification.

## Exit
Every failed criterion is assigned to the owning domain/release and fixed through a bounded accepted change.

RTV3-09 closes only when the integrated candidate is supportable.
