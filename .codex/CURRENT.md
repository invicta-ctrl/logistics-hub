# Current Work Pointer — Logistics Hub

**As of 2026-10-11 | Authority: active Git refs and writer lock take precedence over this pointer.**

## Active work — V1.16 A1 enrichment isolation

- **Verified main / V1.15 closure:** `84f798fd0703dce4b0befa69c183ed04717ef4a8`. Final V1.15 source `962c66e718bad84d29b8b470400753701d7f5cd2` passed CI 38133613254; main CI 38134402564, CodeQL and configured Workers Build passed. The V1.15 source slice is deleted locally/remotely; unknown local `work` is preserved.
- **Current main/base:** `179435fdd7f2a9b0aa21a5c956f0c0bc12a41fa7`. Documentation-only PR [#33](https://github.com/invicta-ctrl/logistics-hub/pull/33) merged; exact-head CI 38135247650 passed; actual main Workers Build 114459855837 and CodeQL 38135957767 passed. Planning branch deleted/pruned; runtime unchanged from verified V1.15.
- **Active slice:** `slice/v1.16-enrichment-isolation`, first independent A1 source work from that main. Root is the sole writer; read-only specialists supplied narrow patch/evidence suggestions.
- **Product runtime:** A1 detaches bounded one-shot photo cleanup from core catalogue synchronization and makes optional AI-feedback lookup failure fall back to manual saving. Local build/typecheck passed; pushed-source CI/integration are pending. V1.16 and final V2 readiness remain OPEN.
- **First checkpoint:** `5affc10ab7532506b798f57700b6d330e7bd02f7` pushed; unit/build/privacy, CodeQL 38136434385 and Workers Build passed. CI 38136348498 caught two changed-fixture assumptions (offline routed writes and a review-later row label) plus an unrelated tab-navigation timeout. Corrected fixtures also assert one manual capture after reconnect; all source code remains unchanged. Fresh exact-head CI is required before integration.
- **Writer:** Codex verified the local lock was free and claimed it before reconciling this branch. Read-only specialists inspect existing contracts; root is the sole tracked writer. Verify `agent:status` before any handoff/takeover.
- **History:** V1.15 approved implementation and final refinements closed on main. Final product photo/provider QA is owner-controlled as stated in the V1.15 release records; do not silently claim new verification.

## Accepted scope and release gates

- **V1.16:** `docs/specs/accepted/v1.16-ambient-intelligent-core.md` and `docs/road-to-v2/v1.16-execution-card.md`. Invisible optional Ambient Assist; deterministic independent Intelligent Core; verified-correction learning; model routing and evaluation; truthful product-version + actual changelog within existing Administration > System. All criteria, exact-head CI, deployment and owner QA must pass before the *final V2 ready for V3* claim.
- **Product version revisions:** `docs/PRODUCT_VERSION_GOVERNANCE.md` governs automatic `Vx.xx.1`, `Vx.xx.2`, etc. for each separately integrated, verified, post-release product revision. Documentation-only commits and intermediate checkpoints do not count.
- **V3:** Road-to-V3 actual product sequence V2.1–V2.9 (RTV3-01–RTV3-09) then V3.0. No V3 implementation is authorized by V1.16 completion alone; milestone acceptance gates remain.
- **No incomplete version:** independently completed, green slices integrate to latest main promptly. Incomplete work remains in the one active slice and is described accurately.

## Next safe action

Parent V1.15; candidate V1.16 is unreleased. A1 is a complete independent behavior slice of that accepted future version, not a new post-release patch number. No migrations, dependencies, model-role changes or live provider probes. The S0 contract and exact affected regression cases are in the execution card.

1. Finish A1, run build/typecheck/diff/privacy, commit/push the coherent checkpoint and await exact-head automatic CI/CodeQL/Workers Build. Owner retains manual/product/provider QA.
2. Integrate A1 only when independently green, verify actual main deployment, then prune its confirmed-merged branch. Preserve unknown local `work`.
3. Continue the next unfinished accepted V1.16 slice from fresh main; do not claim full release/V2 readiness until every accepted gate is complete.

## Historical continuity

Previous work-pointer content is preserved in immutable [Git history](https://github.com/invicta-ctrl/logistics-hub/blob/aa09900827a94e0931a33416f70c3ae4c7e6bcf9/.codex/CURRENT.md). The `docs/road-to-v2/releases/` records preserve completed-version evidence. **Do not treat historic “IN PROGRESS” or old branch instructions as active.** The documentation map is `docs/DOCUMENTATION_STATUS.md`.
