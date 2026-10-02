# Claude Code — Logistics Hub Road to V2

Read `AGENTS.md` and its required authority chain first.

## Road-to-V2 branch runner
When the current branch starts with `road-to-v2/v1.`, that branch is an owner-authorized parked Road-to-V2 implementation branch. The sibling Road-to-V2 branches were intentionally pre-created by Earl and are exempt from the old one-active-branch *count* rule while parked. Do not delete, prune, rewrite or modify sibling Road-to-V2 branches. Only the branch currently selected for implementation may be the active writer.

Find the one accepted spec under `docs/specs/accepted/road-to-v2/` whose `BRANCH` line exactly matches the current branch. That spec is the active implementation authority for this branch. Older `.codex/CURRENT*` records may still describe the V1 release-close state; once this branch passes its predecessor/start gate, the matching Road-to-V2 spec controls the slice.

## Short control phrases
Earl may send only a short command.

### `start`, `begin`, or `continue`
Treat it as authorization to execute/resume the complete accepted slice, not merely to plan it.
1. Inspect repo state, current branch/head, remote state, active writer state where accessible, and unknown work.
2. Fetch latest `origin/main`; verify the predecessor gate in the branch spec. If the predecessor is not complete, stop without partial implementation and state the exact blocker.
3. Safely bring the current branch onto the latest verified main. Never force away unknown remote commits or discard unknown work.
4. Claim/yield the repository writer lock when the execution environment exposes it. Preserve the single-writer rule during implementation.
5. Implement the accepted scope end-to-end in coherent checkpoints. No placeholder UI, unused future architecture, dead buttons, speculative compatibility layers or unneeded dependencies.
6. Use subagents for bounded research, read-only review, testing or visual critique when useful; maintain one implementation writer.
7. Run verification appropriate to impact and commit/push working checkpoints.

### `complete` or `finish`
Treat it as authorization to finish every remaining acceptance criterion for the current version and integrate normal code changes once green.
1. Reconcile implemented behavior against every acceptance criterion and inspect the complete diff.
2. Finish missing scope; remove dead/obsolete paths created by the slice.
3. Run typecheck, relevant unit/integration tests, build, privacy/secret scan, browser/E2E, accessibility and migration/data verification when applicable.
4. For any user-visible change, complete the spec’s visual-research evidence: research current external references, render the real application, capture responsive screenshots, inspect them with the agent’s visual capabilities, and iterate on visual defects. Code inspection alone cannot approve visual quality.
5. Create the required `docs/road-to-v2/releases/<version>.md` completion record with final commit, verification, migrations, visual evidence, known limitations and `STATUS: COMPLETE`.
6. Commit and push the finished branch. Earl’s `finish` authorizes normal integration to `main` after all gates are green. Never auto-apply a production D1 migration, destructive provider operation, or irreversible data change without the exact accepted migration/backup/rollback authority required by project policy.
7. Do not delete or change any sibling parked Road-to-V2 branch. A completed current branch may be pruned only after verified integration according to repository policy.

## Visual-quality rule
For visual work, “the CSS/code is cleaner” is not evidence that the result looks better. Use current web/design references plus rendered screenshot/vision review. Prefer official design systems, accessibility guidance, real inventory/admin products and measured performance data. Record what was learned and why it fits Logistics Hub rather than copying another product.

## Product rule
Keep the product sophisticated underneath and obvious on top. Every new capability must reduce user decisions, reduce staff work, improve accountability, or improve operational visibility without sacrificing speed, privacy or maintainability.
