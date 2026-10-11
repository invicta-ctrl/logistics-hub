# Documentation Status and Authority Map

**Audit date:** 2026-10-11. **Repository:** `invicta-ctrl/logistics-hub`. This status map is a documentation-only governance checkpoint, **not** an implemented V1.16 feature or a product subversion.

## Which documentation is authoritative NOW?

Read the current documents in the following priority order, then verify Git/head and lock:

| Responsibility | Single current source |
|---|---|
| Agent startup, owner precedence, one-writer and merge rules | `AGENTS.md` → `.agents/PROJECT_POLICY.md` |
| Current specific task | `.codex/CURRENT.md` |
| Last and next step / writer handoff | `.codex/SESSION_HANDOFF.md` |
| Shared Codex/Claude/Forge working rhythm | `docs/SHARED_AGENT_WORKFLOW.md` |
| Automatic product revisions `Vx.xx.N` | `docs/PRODUCT_VERSION_GOVERNANCE.md` |
| Current product workflows / technical constraints | `docs/PRODUCT_REFERENCE.md`, `docs/DATA_ARCHITECTURE.md`, `docs/PERFORMANCE_RELIABILITY_DOCTRINE.md`, `docs/DEPLOYMENT.md` |
| Accepted V1.16 scope | `docs/specs/accepted/v1.16-ambient-intelligent-core.md` |
| V1.16 implementation slices | `docs/road-to-v2/v1.16-execution-card.md` |
| V3 entry/commands and scope | `docs/road-to-v3/00_COORDINATOR_CARD.md`, `docs/road-to-v3/01_ENGINEERING_CONSTITUTION.md`, accepted milestone spec and relevant release card |
| V3 product naming / roadmap | `docs/road-to-v3/06_ROAD_TO_V3_RELEASE_MAP.md` and `docs/road-to-v3/README.md` |
| V3 owner decisions / unresolved findings | `docs/road-to-v3/decisions/OWNER_DECISIONS.md`, `docs/road-to-v3/08_RECONCILIATION_REGISTER.md` |

`CLAUDE.md` now simply points agents to the above authority without resurrecting the historical forward-propagation workflow. **The owner-approved V1.16 is not yet implemented or fully released** on this documentation checkpoint; Road to V3 remains downstream.

## Cleanup decisions

### RETIRED from the working tree — recoverable in Git history

The following files had ceased to be current authority or were duplicates of accepted records. The pre-cleanup versions remain at the immutable [2026-10-11 main baseline](https://github.com/invicta-ctrl/logistics-hub/tree/711547d41d4c560fe35d0d46de755f3e8718796c):

| Retired path | Why |
|---|---|
| `.codex/CURRENT_TASK.md` | Out-of-date “none active / V1.15 not started” task pointer; conflicts with accepted V1.16 `.codex/CURRENT.md` |
| `.codex/CURRENT_HANDOFF.md` | Part 4/5 historic work presented as “Current”; `.codex/SESSION_HANDOFF.md` is the only live handoff |
| `docs/road-to-v3/COORDINATOR_PROMPT.md` | Redundant convenient coordinator instructions; `00_COORDINATOR_CARD.md` is the sole normative dispatcher |
| `docs/road-to-v3/PACKAGE_MANIFEST.md` | Duplicated active package listing in `docs/road-to-v3/README.md` |
| `docs/specs/proposed/2026-10-02-road-to-v2-roadmap-amendments.md` | Road-to-V2 proposal overtaken by accepted roadmap amendment and completed V2 history |
| `docs/specs/proposed/2026-10-02-part-06-admin-hardening-plan.md` | Historical Part 6 plan marked complete; deployment/product reference remains; pending historic decision not current source authority |
| `docs/specs/proposed/2026-10-04-catalog-intelligence-semantic-hardening.md` | Superseded by `docs/specs/accepted/road-to-v2/2026-10-04-catalog-intelligence-semantic-hardening-amendment.md` |

References to retired proposals in surviving accepted/historical documents point to their immutable earlier Git revision. Removing from the live tree is **not a declaration that past decisions never occurred**.

### RETAIN as historical evidence — not active instructions

- `docs/specs/accepted/road-to-v2/` and older `docs/specs/accepted/`: owner decisions, past constraints and release provenance. Their historic phrases “NOT STARTED” or branch-specific rules are **time-specific records**, not current work pointers.
- `docs/road-to-v2/releases/`, `docs/road-to-v2/evidence/`, `docs/visual-research/`: audit, real release/CI results, owner acceptance and visual evidence. Do not delete or rewrite history to make current versions appear cleaner.
- `.codex/PART_*_BRIEF.md` and `.codex/PART_05_CLOUD_HANDOFF.md`: archival per-part historical task records. Never invoke their old branches or permit production mutations based on them.
- `docs/road-to-v2/v1.14-hardening-plan.md` and `docs/road-to-v2/v1.15-consolidation-plan.md`: historic execution plans, subordinate to final release records; no active task should continue their unfinished checklist.
- `docs/MIGRATION_STATUS.md`: dated September 2026 snapshot only, not today's deployed migration count. The actual D1 migration table/production lane decides the live truth.
- `docs/road-to-v3/09_FINAL_PATCH_NOTES.md`: historical roadmap structure freeze and reconciliation rationale. Live version map and owner decisions supersede obsolete naming references.
- `docs/road-to-v3/07_PRODUCT_DIRECTION_AMENDMENT_DRAFT.md`: **deliberately unaccepted future-gate draft**, not stale. Retain until owner decision; V2.2+ is not authorized by this draft alone.
- Relevant operational runbooks and contract templates remain working reference material; templates are not accepted specs.

### COMPACTED without erasing history

- `CLAUDE.md`: removed dead Road-to-V2 multi-branch runner/forward propagation, historical automatic-release instructions and duplicated operational policy. Historical [CLAUDE.md](https://github.com/invicta-ctrl/logistics-hub/blob/aa09900827a94e0931a33416f70c3ae4c7e6bcf9/CLAUDE.md) is recoverable.
- `.codex/CURRENT.md`: trimmed stale V1.1–V1.15 per-version summaries to one current V1.16 pointer. [Historic content](https://github.com/invicta-ctrl/logistics-hub/blob/aa09900827a94e0931a33416f70c3ae4c7e6bcf9/.codex/CURRENT.md).
- `.codex/SESSION_HANDOFF.md`: trimmed accumulated historic Claude/Codex notes to current actionable handoff. [Historic content](https://github.com/invicta-ctrl/logistics-hub/blob/aa09900827a94e0931a33416f70c3ae4c7e6bcf9/.codex/SESSION_HANDOFF.md).

## Preservation and future documentation rule

1. New current task facts belong in the existing current/handoff pair; do **not** create another CURRENT_TASK, branch-specific long-lived plan, second startup document, AI governance or duplicate package manifest.
2. Do not remove accepted historical scopes, test/release evidence, migration/audit records or an active unresolved accepted amendment merely because its date is old. Label dated snapshots clearly and point agents to live authority.
3. Keep documentation updates alongside the independently working code slice they describe; record the exact deployed reality, not hoped-for functionality.
4. For future cleanups, check live cross-references before deleting; preserve old content in version history and summarize the authority replacement here. Never silently assume an unavailable writer lock or CI result is green.
5. This cleanup does not consume a `Vx.xx.N` product version because it is documentation-only.
