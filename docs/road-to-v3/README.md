# Logistics Hub — Final Road to V3
## Product versions V2.0 → V2.1–V2.9 → V3.0 (RTV3 IDs remain internal aliases)

**Status:** FINAL OWNER ROADMAP BASELINE  
**Repository:** `invicta-ctrl/logistics-hub`  
**Roadmap type:** Post-V2 planning and execution baseline  
**AI baseline:** V2.0 already includes Ambient Assist. Road-to-V3 extends that platform instead of introducing AI for the first time.

## Naming rule — owner amended 2026-10-11

**Road to V3 means product V2.0 → V2.1–V2.9 → V3.0.** Internal milestone IDs `RTV3-01`–`RTV3-09` remain stable aliases for existing documentation, accepted specs, coordinator commands and release records.

| Product version | Internal milestone | Capability |
|---|---|---|
| **V2.1** | `RTV3-01` | Foundation & Operability |
| **V2.2** | `RTV3-02` | Event & Demand Orchestration |
| **V2.3** | `RTV3-03` | Resource Promise & Fulfillment |
| **V2.4** | `RTV3-04` | Mission Control & Human Operations |
| **V2.5** | `RTV3-05` | Procurement & Replenishment |
| **V2.6** | `RTV3-06` | Lifecycle, Recovery & Zero-Loss |
| **V2.7** | `RTV3-07` | Predictive & Preventive Operations |
| **V2.8** | `RTV3-08` | Operational Memory & Succession |
| **V2.9** | `RTV3-09` | Qualification / Release Candidate |
| **V3.0** | GA | General Availability |

The first Road-to-V3 release, **V2.1 / RTV3-01**, must add an actual deployed product version to the existing **Administration → System** panel; preserve Build, Commit and Built metadata. Subsequent releases must reflect their verified deployed product version. V3.1–V3.7 labels found in historical drafts do not schedule releases beyond V3.0.

## How to use this package

### Short commands — Codex and Claude

When Earl says `start RTV` or `continue RTV` (including `RTV3-XX`), **both agents use** `00_COORDINATOR_CARD.md` → **Owner command entry point** after checking `AGENTS.md` and actual repository state. The command is not a blanket authorization to implement without an accepted spec or to preempt another active writer. Missing specs go to owner acceptance first; already completed work must not be rerun.

Every RTV3 release includes the **code-quality, architecture, security, performance and modularization work required for that release**. The acceptance template and release record must prove these items shipped with the corresponding functionality (Engineering Constitution §2A). RTV3-09 validates integration, rather than rescuing unfinished engineering work.


Do **not** load the entire package into every agent.

The coordinator starts with:

1. `00_COORDINATOR_CARD.md`
2. `01_ENGINEERING_CONSTITUTION.md`
3. the active release card under `releases/`
4. the accepted repository specification/amendment for that milestone
5. current repository continuity files

Specialist threads receive only the active task packet, relevant release card, relevant contracts, and necessary neighboring code.

### Package map

- `00_COORDINATOR_CARD.md` — the only normative boot sequence and orchestration rules.
- `01_ENGINEERING_CONSTITUTION.md` — cross-release invariants and anti-patterns.
- `02_AMBIENT_AI_BASELINE.md` — inherited V2 AI architecture and Road-to-V3 extension rules.
- `03_V2_HANDOFF_AND_RTV3_01_FOUNDATION.md` — satisfiable handoff gate and RTV3-01 DoD.
- `04_SHARED_CONTEXT_AND_CODEX_CONTINUITY.md` — repository-backed continuity between Claude and Codex.
- `05_CLAUDE_MODEL_AND_EFFORT_POLICY.md` — coordinator/thread model policy.
- `06_ROAD_TO_V3_RELEASE_MAP.md` — compact program map.
- `07_PRODUCT_DIRECTION_AMENDMENT_DRAFT.md` — pre-drafted owner decision required before RTV3-02.
- `08_RECONCILIATION_REGISTER.md` — live review-findings tracker and old↔new identifier mapping.
- `releases/` — one card per Road-to-V3 milestone.
- `templates/` — accepted-spec, task-packet, handoff, release-record templates.
- `decisions/` — owner decisions that need explicit acceptance.

## Authority rule

During implementation, repository authority wins over this planning package:

```text
current explicit owner instruction
↓
accepted spec / accepted amendment
↓
AGENTS.md / CLAUDE.md / repository policy
↓
.codex current state and release records
↓
this Road-to-V3 package
↓
historical planning documents
```

If reality differs from the roadmap, reconcile; do not guess.
