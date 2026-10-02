# Claude Code — Logistics Hub Road to V2

Read `AGENTS.md` and its required authority chain first.

This file is shared: every Road-to-V2 branch carries the same copy. Change it on the earliest branch the change applies to, then let forward propagation (below) carry it to every later branch.

## Road-to-V2 order
Version order is execution order. Each branch's spec under `docs/specs/accepted/road-to-v2/` names its predecessor.

| Version | Branch | Slice |
|---|---|---|
| V1.1 | `road-to-v2/v1.1-experience-foundation` | Experience foundation and navigation |
| V1.2 | `road-to-v2/v1.2-item-profiles-media` | Item profiles and media |
| V1.3 | `road-to-v2/v1.3-staff-directory` | USC Staff Directory |
| V1.4 | `road-to-v2/v1.4-smart-locations` | Smart locations and wayfinding |
| V1.5 | `road-to-v2/v1.5-rapid-catalogue` | Rapid Catalogue (online-first) and bulk operations |
| V1.6 | `road-to-v2/v1.6-catalog-pwa` | Staff Catalog PWA and offline cataloguing |
| V1.7 | `road-to-v2/v1.7-physical-inventory` | Physical inventory and location audits |
| V1.8 | `road-to-v2/v1.8-kits-containers` | Kits and structured containers |
| V1.9 | `road-to-v2/v1.9-self-service-2` | Self-Service 2.0 |
| V1.10 | `road-to-v2/v1.10-attention-automation` | Attention and operational automation |
| V1.11 | `road-to-v2/v1.11-intelligent-search` | Intelligent search and relationships |
| V1.12 | `road-to-v2/v1.12-operations-home` | Operations home and practical insights |
| V1.13 | `road-to-v2/v1.13-admin-control` | Administration and system control |
| V1.14 | `road-to-v2/v1.14-offline-performance` | Offline, performance and reliability hardening |
| V1.15 | `road-to-v2/v1.15-v2-consolidation` | V2 consolidation |

The order was re-sequenced on 2026-10-02 (accepted amendment `docs/specs/accepted/road-to-v2/2026-10-02-roadmap-amendments.md`).

## Road-to-V2 branch runner
When the current branch starts with `road-to-v2/v1.`, it is an owner-authorized Road-to-V2 implementation branch. The other Road-to-V2 branches were pre-created by Earl and are exempt from the old one-active-branch *count* rule. Never delete, prune or rewrite them. Only the branch currently being implemented has an active writer; the only other change any branch receives is forward propagation.

Find the one accepted spec under `docs/specs/accepted/road-to-v2/` whose `BRANCH` line exactly matches the current branch. That spec is the active implementation authority for this branch. Older `.codex/CURRENT*` records may still describe the V1 release-close state; once this branch passes its predecessor/start gate, the matching Road-to-V2 spec controls the slice.

## Forward propagation (Earl, 2026-10-02)
Every time a Road-to-V2 branch receives new commits, bring every **succeeding** branch up to date, in order. Never update a preceding branch from a later one.
1. Merge the updated branch into the next branch in the table (`git merge`, no rebase), then merge that branch into the one after it, and so on through V1.15. Use a merge commit message such as `merge: bring road-to-v2/v1.N forward`.
2. On a `CLAUDE.md` conflict, keep the incoming copy. It is the same shared file, coming from an earlier branch.
3. Resolve any other conflict by keeping both sides' intent. If a later branch has started its own implementation and the two sides change the same logic, stop and report rather than guess.
4. Never force-push, rebase or reset these branches. Push each one with a normal push before moving to the next.
5. A spec's start-gate wording "safely rebase onto latest main" is satisfied by merging `origin/main` into the branch. The branch already carries its predecessors through propagation, so no history is rewritten.

## Release records and owner actions (Earl, 2026-10-02)
`docs/road-to-v2/releases/<version>.md` separates what the agent finished from what only Earl can do.
- `STATUS: COMPLETE` means scope, tests, evidence and review are green on the branch.
- `INTEGRATION:` is either `MERGED <commit>` or `WAITING ON OWNER ACTIONS`.
- `OWNER_ACTIONS:` lists each production or private step with its exact command, its preflight and backup, its rollback, and how to verify it. Examples: applying a D1 migration before merging (`docs/DEPLOYMENT.md`), creating an R2 bucket, or importing private data. Write `none` when there are none.
- A successor's predecessor gate passes when the predecessor's record says `STATUS: COMPLETE` on `main`, or on the predecessor branch with `INTEGRATION: WAITING ON OWNER ACTIONS`. The successor builds on the predecessor branch (already propagated) and records which owner actions are still pending. It must never depend on a pending owner action having happened, for example on production data that has not been imported yet.
- Once Earl completes the owner actions, integrate the waiting branches to `main` in version order.

## Short control phrases
Earl may send only a short command.

### `start`, `begin`, or `continue`
Treat it as authorization to execute/resume the complete accepted slice, not merely to plan it.
1. Inspect repo state, current branch/head, remote state, active writer state where accessible, and unknown work.
2. Fetch latest `origin/main` and the predecessor branch; verify the predecessor gate (see Release records). If the predecessor is not complete, stop without partial implementation and state the exact blocker.
3. Safely bring the current branch onto the latest verified main by merge. Never force away unknown remote commits or discard unknown work.
4. Claim/yield the repository writer lock when the execution environment exposes it. Preserve the single-writer rule during implementation.
5. Implement the accepted scope end-to-end in coherent checkpoints. No placeholder UI, unused future architecture, dead buttons, speculative compatibility layers or unneeded dependencies.
6. Use subagents for bounded research, read-only review, testing or visual critique when useful; maintain one implementation writer.
7. Run verification appropriate to impact, commit/push working checkpoints, and propagate each pushed checkpoint forward.

### `complete` or `finish`
Treat it as authorization to finish every remaining acceptance criterion for the current version and integrate normal code changes once green.
1. Reconcile implemented behavior against every acceptance criterion and inspect the complete diff.
2. Finish missing scope; remove dead/obsolete paths created by the slice.
3. Run typecheck, relevant unit/integration tests, build, privacy/secret scan, browser/E2E, accessibility and migration/data verification when applicable. CI (`.github/workflows/ci.yml`) must be green on the final commit.
4. For any user-visible change, complete the spec's visual-research evidence: research current external references, render the real application, capture responsive screenshots, inspect them with the agent's visual capabilities, and iterate on visual defects. Code inspection alone cannot approve visual quality. Start from `npm run evidence -- --out <dir> --base <predecessor>` and extend `--pages` for the slice's new surfaces.
5. Create the required `docs/road-to-v2/releases/<version>.md` completion record with final commit, verification, migrations, visual evidence, known limitations, `STATUS: COMPLETE`, `INTEGRATION:` and `OWNER_ACTIONS:`.
6. Commit and push the finished branch, then propagate it forward. Earl's `finish` authorizes normal integration to `main` after all gates are green and no owner action is pending. Never auto-apply a production D1 migration, destructive provider operation, or irreversible data change without the exact accepted migration/backup/rollback authority required by project policy.
7. A completed branch may be pruned only after verified integration according to repository policy.

## Visual-quality rule
For visual work, "the CSS/code is cleaner" is not evidence that the result looks better. Use current web/design references plus rendered screenshot/vision review. Prefer official design systems, accessibility guidance, real inventory/admin products and measured performance data. Record what was learned and why it fits Logistics Hub rather than copying another product.

## Product rule
Keep the product sophisticated underneath and obvious on top. Every new capability must reduce user decisions, reduce staff work, improve accountability, or improve operational visibility without sacrificing speed, privacy or maintainability.
