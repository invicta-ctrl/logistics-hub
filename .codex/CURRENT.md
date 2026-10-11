# Current Work Pointer — Logistics Hub

**As of 2026-10-11 | Authority: active Git refs and writer lock take precedence over this pointer.**

## Active work — documentation cleanup on V1.16 planning branch

- **Main (last checked):** `711547d41d4c560fe35d0d46de755f3e8718796c`, historical V1.15/V2.0 close.
- **Active remote slice:** `slice/v1.16-ambient-core`, containing accepted V1.16 specification, shared agent/version policy and documentation normalization (PR [#33](https://github.com/invicta-ctrl/logistics-hub/pull/33)). Refresh exact remote refs; this SHA is **not** the active branch HEAD.
- **Product runtime:** V1.16 has **NOT** been coded, released or deployed by this documentation work. Do not label the release complete or V2 ready for V3.
- **Writer:** the owner stated that the former V1.15 writer lock was lifted. Remote document editing does **not** prove the local lock is currently free; a subsequent code writer must verify and claim it.
- **History:** V1.15 approved implementation and final refinements closed on main. Final product photo/provider QA is owner-controlled as stated in the V1.15 release records; do not silently claim new verification.

## Accepted scope and release gates

- **V1.16:** `docs/specs/accepted/v1.16-ambient-intelligent-core.md` and `docs/road-to-v2/v1.16-execution-card.md`. Invisible optional Ambient Assist; deterministic independent Intelligent Core; verified-correction learning; model routing and evaluation; truthful product-version + actual changelog within existing Administration > System. All criteria, exact-head CI, deployment and owner QA must pass before the *final V2 ready for V3* claim.
- **Product version revisions:** `docs/PRODUCT_VERSION_GOVERNANCE.md` governs automatic `Vx.xx.1`, `Vx.xx.2`, etc. for each separately integrated, verified, post-release product revision. Documentation-only commits and intermediate checkpoints do not count.
- **V3:** Road-to-V3 actual product sequence V2.1–V2.9 (RTV3-01–RTV3-09) then V3.0. No V3 implementation is authorized by V1.16 completion alone; milestone acceptance gates remain.
- **No incomplete version:** independently completed, green slices integrate to latest main promptly. Incomplete work remains in the one active slice and is described accurately.

## Next safe action

1. Finish and verify this documentation-only cleanup checkpoint with diff/privacy and CI/CodeQL, integrate it through the existing PR only when green, then prune the integrated branch.
2. For V1.16 source work, verify the current repository/writer lock and resume at the first unfinished accepted vertical slice from the latest main. Preserve any unknown local changes and production safeguards.
3. Record exact main/deployed identity, evidence and owner QA before reporting V1.16 or V2 final readiness complete.

## Historical continuity

Previous work-pointer content is preserved in immutable [Git history](https://github.com/invicta-ctrl/logistics-hub/blob/aa09900827a94e0931a33416f70c3ae4c7e6bcf9/.codex/CURRENT.md). The `docs/road-to-v2/releases/` records preserve completed-version evidence. **Do not treat historic “IN PROGRESS” or old branch instructions as active.** The documentation map is `docs/DOCUMENTATION_STATUS.md`.
