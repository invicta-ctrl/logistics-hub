# Accepted Spec — <Version> <Name>

## Status
PROPOSED / ACCEPTED / SUPERSEDED

## Authority
Owner:
Date:
Base commit:
Release:

## Outcome
<One coherent user/operational outcome>

## In scope
- ...

## Version-aligned engineering delivery (mandatory for this milestone)
Ship necessary improvements with this release, not in a later cleanup or RTV3-09. Refer to Engineering Constitution §2A.
- affected code paths / current baseline:
- module ownership, cohesion, API/contracts and simplification:
- obsolete paths/duplicate code to remove:
- security/permissions/privacy/negative cases:
- D1/R2 data truth, migrations, concurrency, idempotency:
- performance/observability/offline/recovery/accessibility (as applicable):
- bounded packet owners, acceptance tests and evidence per item:
- justified non-applicable items (N/A with reason):
- architecture/security defects that block release completion:


## Explicitly out of scope
- ...

## Existing behavior being superseded
- ...

## Decommissioning plan
- old capability:
- data mapping:
- coexistence:
- cutover:
- old entry point:
- rollback:
- archive/delete:
- docs:

## Domain truth
- authoritative store:
- derived state:
- prohibited second authorities:

## Bounded workloads
- population:
- hard cap:
- time window:
- payload cap:
- retry cap:

## Atomicity
- ...

## Concurrency
- ...

## Idempotency
- ...

## Offline behavior
- ...

## Authorization/privacy
- ...

## AI
- permitted tasks:
- prohibited tasks:
- data allowlist:
- fallback:
- model role(s):

## Performance budget
Use RTV3-01 measured contract:
- ...

## Fixture pass criteria
Declare before execution:
- 1× pass criterion:
- 10× pass criterion:
- 100× pass criterion:

## Acceptance criteria
1.
2.

## Verification
- unit:
- integration:
- browser:
- 1×:
- 10×:
- 100×:
- security:
- recovery where relevant:

## Rollback/recovery
- code:
- forward fix:
- restore:

## Owner actions
- ...
