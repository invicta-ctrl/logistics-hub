# Reconciliation Register

This is a live claimable tracker. Every row has an owner, status, and date.

Status values: `OPEN`, `IN_PROGRESS`, `CLOSED`, `ACCEPTED_RISK`, `SUPERSEDED`.

| ID | Finding | Resolution | Owner | Status | Date |
|---|---|---|---|---|---|
| R-001 | Duplicate normative boot sequences | `00_COORDINATOR_CARD.md` is the only normative boot sequence | Roadmap owner | CLOSED | 2026-10-08 |
| R-002 | V2 handoff gate required measurements V2 could not supply | V2 verifies known state; RTV3-01 measures new baselines | RTV3-01 coordinator | CLOSED | 2026-10-08 |
| R-003 | P0 both hard-blocking and deferrable | One rule: reproducible P0 blocks owning milestone closure | Coordinator | CLOSED | 2026-10-08 |
| R-004 | Foundation had real code but no DoD/size cap | RTV3-01 has eight packets + explicit DoD | RTV3-01 coordinator | CLOSED | 2026-10-08 |
| R-005 | Budget numbers invented before measurement | RTV3-01 inventories routes, measures, then freezes budgets | Performance owner | CLOSED | 2026-10-08 |
| R-006 | Product amendment had no owner/timeline | Pre-draft in RTV3-01; owner acceptance gates RTV3-02 | Owner + coordinator | CLOSED | 2026-10-08 |
| R-007 | Fixture hierarchy inconsistent | 1× / 10× / 100× everywhere + explicit pass criteria | Verification owner | CLOSED | 2026-10-08 |
| R-008 | `bounded` undefined | Formal finite-input/hard-cap definition in coordinator card | Coordinator | CLOSED | 2026-10-08 |
| R-009 | Atomicity/idempotency conflated | Separate atomicity, concurrency, idempotency contracts | Architecture owner | CLOSED | 2026-10-08 |
| R-010 | `On Mission` could imply tracking | Explicit no GPS, no venue inference, no permission effects | RTV3-04 owner | CLOSED | 2026-10-08 |
| R-011 | Offline quarantine risked hidden data loss | quarantine must remain visible/exportable/retryable/non-blocking | RTV3-01 owner | CLOSED | 2026-10-08 |
| R-012 | Product gate appeared to cover only early milestones | gate explicitly transitive through RTV3-02–RTV3-08 | Coordinator | CLOSED | 2026-10-08 |
| R-013 | Supply-chain security scheduled too late | moved to RTV3-01 | Security owner | CLOSED | 2026-10-08 |
| R-014 | No realistic activity inputs | RTV3-01 fixture profiles: ordinary, event-heavy, burst/reconnect | Performance owner | CLOSED | 2026-10-08 |
| R-015 | RPO/RTO vague | explicit initial targets; must be proven/amended | Recovery owner | CLOSED | 2026-10-08 |
| R-016 | Incident ownership/timebox absent | SEV model with owners and response targets | Ops owner | CLOSED | 2026-10-08 |
| R-017 | No V2-feature decommissioning policy | mandatory cutover/decommission section per superseding milestone | All milestone owners | CLOSED | 2026-10-08 |
| R-018 | Monolithic roadmap violated context economy | split package + coordinator/release cards/templates | Roadmap owner | CLOSED | 2026-10-08 |
| R-019 | `Optional intelligence later` stale after V1.15 | Ambient Assist is V2 baseline; RTV3-07 is predictive/preventive expansion | AI owner | CLOSED | 2026-10-08 |
| R-020 | V2.1–V2.9 naming made shipped/planned `V2` ambiguous | Use non-semver Road-to-V3 IDs RTV3-01…RTV3-09; reserve V3.0 for GA | Roadmap owner | CLOSED | 2026-10-08 |
| R-021 | Delete-before-adding doctrine lost in split | Restored optimization ladder + DAMP/YAGNI rule | Architecture owner | CLOSED | 2026-10-08 |
| R-022 | Standing anti-pattern list lost | Restored explicit anti-pattern section | Architecture owner | CLOSED | 2026-10-08 |
| R-023 | Denial-test requirement lost | Restored mandatory negative/failure tests | Security owner | CLOSED | 2026-10-08 |
| R-024 | Browser/device support undefined | Restored support policy; RTV3-01 records actual tested matrix | Frontend owner | CLOSED | 2026-10-08 |
| R-025 | Accessibility checks collapsed to aspiration | Restored explicit verification checklist | Accessibility owner | CLOSED | 2026-10-08 |
| R-026 | Evidence-before-claim block lost | Restored evidence template | Verification owner | CLOSED | 2026-10-08 |
| R-027 | Motion budget lost | Restored default timing/motion policy | Frontend owner | CLOSED | 2026-10-08 |
| R-028 | Unknown production read could be treated as clean | Restored global `UNKNOWN ≠ CLEAN` fail-closed rule | Ops/security owner | CLOSED | 2026-10-08 |
| R-029 | Fixture tiers lacked pass criteria | Added tier-specific pass criteria | Verification owner | CLOSED | 2026-10-08 |
| R-030 | AI quota policy was inherited but not re-derived | RTV3-01 F7 explicitly re-derives quota policy from measurement | AI owner | CLOSED | 2026-10-08 |
| R-031 | Claude model names were pinned without re-check rule | Added verification date + role-based fallback rule | Coordinator | CLOSED | 2026-10-08 |
| R-032 | RTV3-01 DoD/packets lacked dependency ordering | Added execution DAG | RTV3-01 coordinator | CLOSED | 2026-10-08 |
| R-033 | V2.0 status was "pending truthful handoff/verification" | Handoff recorded against `03` §1: `docs/road-to-v2/releases/v2.0.md`, "Handoff to Road to V3"; evidence `docs/road-to-v2/evidence/v2.0-production-readiness.md` | Roadmap owner (Earl) | CLOSED | 2026-10-08 |
| R-034 | `02` §2 lists Granite, Gemma, Qwen and GLM as the "current V2 role set", and §6 says "normal target around 8,000". V2.0 ships one model, `@cf/google/gemma-4-26b-a4b-it`, for two tasks (PHOTO_NAME, PHOTO_RECHECK); Granite, Qwen and GLM were not built (V1.15 record). The code's daily bands are conserve 6,500, reserve 8,000, critical 9,000, stop 9,500 (`src/ambient-assist.ts`). Impact: none on V2; a thread reading `02` alone would assume roles that do not exist. | Repository truth wins. RTV3-01 F7 reconciles `02` with the shipped router and re-derives the quota from measurement (`03` §8). Next action: F7 task packet | RTV3-01 coordinator | OPEN | 2026-10-08 |

## Status evidence rules

### `OPEN`
Use when the finding is unresolved and no accepted disposition exists.

Required:
- owner;
- current impact/severity;
- next exact action;
- target milestone/date where known.

### `IN_PROGRESS`
Use only when an authorized task is actively addressing the finding.

Required:
- owner;
- branch/task reference;
- latest evidence/checkpoint;
- next exact action.

### `CLOSED`
Use only when the finding is fixed or proven stale/non-reproducible with evidence.

Required:
- closing evidence;
- date;
- owner/reviewer confirmation where applicable.

### `ACCEPTED_RISK`
This is an owner decision, not an engineering shortcut.

Required:
- explicit named owner/authorized decision-maker;
- written rationale;
- affected scope;
- known impact;
- compensating controls;
- why remediation is deferred or declined;
- expiry/review date or milestone;
- conditions that automatically reopen the finding;
- evidence/reference to the accepted decision.

A reproducible P0 may not be converted to `ACCEPTED_RISK` merely to close a milestone unless the current accepted authority explicitly permits that severity reclassification and records the rationale.

### `SUPERSEDED`
Use only when a newer finding/spec/control replaces the old one.

Required:
- replacement reference;
- reason;
- date.

## Identifier migration / reverse mapping

Historical roadmap identifiers are retired for new work but preserved for searchability.

| Historical original | Intermediate revision | Current authoritative milestone |
|---|---|---|
| old `V3.0 Foundation` | `V2.1` | **RTV3-01 Foundation & Operability** |
| old `V3.1 Event/Demand` | `V2.2` | **RTV3-02 Event & Demand** |
| old `V3.2 Resource Promise` | `V2.3` | **RTV3-03 Resource Promise** |
| old `V3.3 Mission/Human Ops` | `V2.4` | **RTV3-04 Mission & Human Ops** |
| old `V3.4 Procurement` | `V2.5` | **RTV3-05 Procurement** |
| old `V3.5 Lifecycle` | `V2.6` | **RTV3-06 Lifecycle/Zero-Loss** |
| old `V3.6 Predict/Prevent` | `V2.7` | **RTV3-07 Predict/Prevent** |
| old `V3.7 Memory/Succession` | `V2.8` | **RTV3-08 Memory/Succession** |
| old `V3.8 Qualification` | `V2.9` | **RTV3-09 Qualification/RC** |
| — | `V3.0 GA` | **V3.0 General Availability** |

When a historical document uses an old identifier, translate it through this table before acting.
