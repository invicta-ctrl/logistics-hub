# Ambient Assist Baseline and Road-to-V3 AI Architecture

## 1. Architectural position

Ambient Assist is inherited from V2.0.

It is not a RTV3-07 invention and it is not a separate AI product.

Principles:

> AI follows the work. Staff do not follow the AI.

> Local/deterministic first. AI second. Cheapest capable model. Async by default. Human confirmation for consequential changes.

> AI may refine existing operational intent. AI may not originate operational intent.

## 2. Current V2 role set

Implementation-time preferred roles:

- Granite role — routine text/classification/normalization.
- Gemma role — intentional catalog/inventory vision only.
- Qwen role — bounded existing-intent workflow ambiguity.
- GLM role — rare difficult-case escalation.

Most Hub actions should use zero AI.
Most AI-assisted actions should use one model.

Model IDs are provider choices behind stable task contracts.

## 3. Forbidden AI data

Do not send:

- Student IDs;
- official staff IDs;
- Staff Directory portrait media;
- identity-proof media;
- faces for identity;
- borrower proof;
- private transaction evidence;
- unrestricted audit/database exports;
- secrets/tokens/passwords.

Catalog/inventory vision must use an intentional bounded media path.

## 4. No authoritative AI writes

AI returns constrained proposals.

The normal Hub re-validates:

- current state;
- stale-write expectations;
- permission;
- legal transition;
- human review requirement;

then calls the ordinary domain endpoint.

## 5. Road-to-V3 evolution

### RTV3-01
Harden the AI platform:
- one task registry/router;
- schema validation;
- privacy allowlists;
- quota/circuit breaker;
- provider/model registry;
- failure isolation;
- aggregate observability;
- evaluation harness;
- model replacement procedure.

### RTV3-02
Event/Demand:
- parse or normalize already-entered event requirements;
- identify ambiguity;
- suggest allowed field mappings;
- never invent event needs.

### RTV3-03
Resource Promise:
- rank already-valid fulfillment alternatives;
- explain conflicts;
- never create or approve a Promise autonomously.

### RTV3-04
Mission/Human Operations:
- summarize blockers;
- explain handovers;
- identify responsibility gaps from explicit role/state data;
- never assign staff, infer location, or alter permission.

### RTV3-05
Procurement:
- compare bounded existing supplier/quote information when authorized;
- normalize descriptions;
- explain discrepancies;
- never originate a purchase need, choose a supplier autonomously, or approve spending.

### RTV3-06
Lifecycle:
- explain anomalies and reconciliation conflicts;
- propose review categories;
- never rewrite movement/audit truth.

### RTV3-07
Predictive & Preventive:
This is where genuinely forward-looking intelligence is introduced:
- demand forecasting;
- shortage-risk estimation;
- overlap/conflict warning;
- reorder timing;
- repeat-failure patterns;
- preventable-loss indicators.

Hierarchy:
```text
deterministic rule
↓
simple statistics
↓
bounded forecasting/scoring
↓
AI interpretation only when it adds measured value
```

### RTV3-08
Operational Memory:
- concise State-of-Logistics synthesis;
- turnover/handover summaries;
- institutional-memory assistance;
- privacy-preserving aggregation.

### RTV3-09
Qualification:
prove:
- AI off;
- provider outage;
- quota exhausted;
- malformed output;
- stale model;
- model unavailable;
- privacy rejection;
- circuit breaker;
- offline reconnect;
- human correction wins.

## 6. Quota behavior

Carry forward the current V2 planning policy unless RTV3-01 measurement amends it:

- normal target around 8,000 Neurons/day;
- elastic reserve to 9,500;
- protected stop at/above 9,500;
- core Hub remains functional with AI unavailable.

Quota is an optimization constraint, never a correctness dependency.
