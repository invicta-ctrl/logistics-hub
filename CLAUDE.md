# Claude Code — Logistics Hub Road to V2

Read `AGENTS.md` and its required authority chain first.

When the current branch starts with `road-to-v2/v1.`, it is an owner-authorized parked Road-to-V2 branch. Sibling Road-to-V2 branches are intentionally pre-created; do not delete, prune, rewrite or modify them. Only the selected branch becomes the active implementation writer.

Find the accepted spec under `docs/specs/accepted/road-to-v2/` whose `BRANCH` exactly matches the current branch. That spec controls this slice after its predecessor gate passes, even if older `.codex/CURRENT*` files still describe V1 closure.

If Earl says `start`, `begin`, or `continue`: inspect repo/remote/writer state, fetch latest `origin/main`, verify the predecessor gate, safely rebase onto the latest verified main, preserve unknown work, claim the writer lock where available, then implement the entire accepted slice end-to-end in coherent checkpoints. Use subagents only for bounded research/review/testing while keeping one writer. Do not ship placeholders, unused future architecture, dead buttons or unnecessary dependencies.

If Earl says `complete` or `finish`: reconcile every acceptance criterion, finish missing work, inspect the full diff, run typecheck/tests/build/privacy/browser/E2E/accessibility plus migration/data verification where applicable, complete the required visual-research evidence, create `docs/road-to-v2/releases/<version>.md` with final commit, verification, migrations, visual evidence, known limitations and `STATUS: COMPLETE`, then commit/push. `finish` authorizes normal code integration to `main` once all gates are green; it does not waive required backup/rollback authority for production D1 migrations, destructive provider actions or irreversible data changes.

For user-visible work, code quality alone cannot prove visual quality. Research current external references, render the real application, capture responsive screenshots, inspect them with the agent’s visual capabilities, compare against baseline and iterate. Prefer official design/accessibility guidance, real inventory/admin products and measured performance data. Respect `prefers-reduced-motion` and keep normal interactions independent of AI/network intelligence.

Product rule: keep the system sophisticated underneath and obvious on top. Every capability must reduce user decisions, reduce staff work, improve accountability or improve operational visibility without sacrificing speed, privacy or maintainability.
