# Logistics Hub — Final Road to V3 Executive Baseline

The authoritative package is the directory `LOGISTICS_HUB_ROAD_TO_V3_FINAL/`.

The corrected chronology is:

**V2.0 product baseline → RTV3-01…RTV3-09 roadmap milestones → V3.0 product GA**

Key reconciliation decisions:

1. Ambient Assist is already a V2.0 platform capability.
2. RTV3-07 introduces predictive/preventive operations; it does not introduce AI itself.
3. V2 handoff verifies only what V2 can know; RTV3-01 owns new measurement/baselines.
4. RTV3-01 is a real eight-packet engineering release with a Definition of Done.
5. One P0 rule exists: reproducible P0 blocks owning release closure.
6. No numeric route/performance budgets are frozen before RTV3-01 measurement.
7. The Road-to-V3 Product Direction Amendment is pre-drafted in RTV3-01 and gates RTV3-02+.
8. `bounded` has a formal hard-cap definition.
9. Offline quarantine must be visible, exportable, retryable, and non-blocking.
10. Supply-chain/deployment-tooling security moves to RTV3-01.
11. Initial RPO/RTO and incident response objectives are explicit and testable.
12. Every superseding release includes a V2 decommissioning plan.
13. The former monolithic roadmap is split into coordinator, constitution, AI baseline, release cards, templates, and reconciliation register.
14. The repository is the shared memory between Claude and Codex.
15. Claude Project instructions hold stable operating doctrine; current task state stays in the repo.

Recommended Claude Project configuration:
- Coordinator: **Opus 5.5 / High**.
- Default implementation thread: **Sonnet 5.5 / High**.
- Complex DB/security/offline/recovery thread: **Sonnet 5.5 / highest available effort only when justified**.
- Review/verification: **Sonnet 5.5 / High**.
- Documentation/evidence: **Sonnet 5.5 / Medium or normal**.

Use the ready-to-paste project goal in `CLAUDE_PROJECT_GOAL.md`.

Road-to-V3 milestone IDs are intentionally non-semver so `V2` never ambiguously means both the shipped baseline and future program work.
