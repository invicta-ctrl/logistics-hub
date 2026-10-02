# Claude Code — Logistics Hub Road to V2

Read `AGENTS.md` and its required authority chain first.

On any `road-to-v2/v1.*` branch, find the accepted spec under `docs/specs/accepted/road-to-v2/` whose `BRANCH` exactly matches the current branch. That spec is the active slice authority after its predecessor gate passes. The sibling Road-to-V2 branches were intentionally pre-created by Earl; keep them parked and untouched. Only the selected branch becomes the active implementation writer.

If Earl says `start`, `begin`, or `continue`: inspect branch/remote/writer state, fetch latest `origin/main`, verify the predecessor gate, safely rebase onto latest verified main without discarding unknown work, claim the writer lock where available, then implement the entire accepted slice end-to-end. Use subagents only for bounded research/review/testing while keeping one writer. No placeholders, speculative future architecture, dead buttons or unnecessary dependencies.

If Earl says `complete` or `finish`: satisfy every acceptance criterion, inspect the full diff, run required typecheck/tests/build/privacy/browser/E2E/accessibility and migration/data verification, complete visual research and screenshot/vision review for user-visible work, create `docs/road-to-v2/releases/<version>.md` with `STATUS: COMPLETE`, final commit, migrations, verification, visual evidence and known limitations, then commit/push. `finish` authorizes normal code integration to `main` after all gates are green, but does not waive required backup/rollback authority for production migrations, destructive provider actions or irreversible data changes.

For visual work, cleaner code is not proof of better design. Research current external references, render the real app, capture desktop/tablet/phone screenshots, inspect them visually with the agent, compare against baseline and iterate. Keep motion fast, native where practical, and reduced-motion safe. Normal workflows must remain fast and independent of optional AI/network intelligence.

Product rule: sophisticated underneath, obvious on top. Every capability must reduce user decisions, reduce staff work, improve accountability or improve operational visibility without sacrificing speed, privacy or maintainability.
