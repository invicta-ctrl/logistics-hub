# Current Work Pointer — Logistics Hub

**As of 2026-10-12 | Authority: live Git refs and writer lock take precedence.**

## Delivered baseline

- **V1.15 CLOSED/pruned:** final source `962c66e718bad84d29b8b470400753701d7f5cd2`, full CI 38133613254; closure/main `84f798fd0703dce4b0befa69c183ed04717ef4a8`, CI 38134402564 and deployment passed. Accepted planning PR #33 integrated at `179435fdd7f2a9b0aa21a5c956f0c0bc12a41fa7`; main CI 38135957807, CodeQL and configured deployment passed.
- **V1.16 A1 delivered/pruned:** `4511614c7b7fe18acfe7e0806399582c02b40516`, PR #34; full CI 38136947614, source/main CodeQL and actual main Workers Build 114464986328 passed. Capture/photo saving leaves the durable queue before optional cleanup; unavailable optional feedback cannot reject manual saving.
- **V1.16 A2 delivered/pruned:** source/main `65397388b5c88c713a3fa0ae567317ef4d1d4ed0`, PR #36. Full source CI 38187507116, CodeQL 38187507098; actual main CodeQL 38188178668 and Workers Build 114615134853 passed. Shared ten-second AI deadline, safe failure codes, ignored late replies and unchanged quota reserves; existing stock/count/loan/replay/return cases assert zero inference with a blocked binding.

- **V1.16 B1 delivered/pruned:** source/main `c89ef1c3b922b0a68c729f5065e8ba4c74e5afd0`, PR #37. Full source CI 38189559976, CodeQL 38189559964; actual main CodeQL 38190590509 and Workers Build 114622514327 passed. Existing Home operational hints use current sources, fresh private snapshots and screen-lifetime guards.

- **V1.16 C1 delivered/pruned:** source/main `6e9795d180a9a9a722a7734113466b9019e715bf`, PR #38. Full source CI 38193217620, CodeQL 38193217711; actual main CodeQL 38193998942 and Workers Build 114632742507 passed. Current bounded review outcomes/private model-policy stamps and atomic knowledge decision guards are live; knowledge remains code-reviewed, with no model promotion.

## Active work

- **Branch/base:** `slice/v1.16-product-version` from verified C1 main `6e9795d180a9a9a722a7734113466b9019e715bf`; root Codex holds the sole writer lock. Read live HEAD for checkpoints; preserve unknown local `work`.
- **D1:** artifact-bound product release identity and plain change summary in existing private Administration > System > This version. Initial governed source retains verified V1.15, with Unknown fallback; V1.16 is not released. Frozen contracts and exact delivery evidence are in `docs/road-to-v2/v1.16-execution-card.md`. Source qualification is pending.
- **Identity:** parent V1.15; candidate V1.16 remains unreleased. Independently useful future-version slices may deploy, with no invented V1.15.N/V1.16.N and no final V1.16 label.
- **QA:** owner retains live/manual product/photo/model QA. Local build/typecheck/diff/privacy and normal automatic CI qualify source; no local product/provider probes, model switch, paid infrastructure, schema or dependency change.

## Remaining scope and next action

The accepted authority is `docs/specs/accepted/v1.16-ambient-intelligent-core.md`; permanent version policy is `docs/PRODUCT_VERSION_GOVERNANCE.md`. Full V1.16 and final V2 readiness are **OPEN**: contextual-hint qualification, bounded verified-learning/model evaluation, private artifact-bound version/changelog and final acceptance remain. Text roles remain REVIEW_ONLY.

Finish D1 on the one active branch, push coherent checkpoints, integrate only when independently green, confirm actual main deployment and prune. Then reconcile all accepted gates, provider/challenger evaluation and owner QA before full V1.16 acceptance. Do not start V2.1/RTV3-01 until V1.16 final readiness qualifies.

## Historical continuity

Former cumulative pointers are preserved in [Git history](https://github.com/invicta-ctrl/logistics-hub/blob/aa09900827a94e0931a33416f70c3ae4c7e6bcf9/.codex/CURRENT.md). Canonical release records retain immutable evidence. Older branch instructions are inactive; see `docs/DOCUMENTATION_STATUS.md`.
