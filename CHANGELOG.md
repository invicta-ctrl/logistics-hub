# Logistics Hub changelog

A concise index of what changed in each product version/revision and accepted specification amendment. It complements, but does not replace, the authoritative accepted specifications, `docs/PRODUCT_VERSION_GOVERNANCE.md`, and detailed per-version release records. Entries here never independently prove a release was deployed.

## Unreleased — documentation and governance

- **2026-11-04 · Governance · Changed:** Claude is the sole writer on all projects until further notice; ChatGPT audits, reviews and manages ([AGENTS.md](AGENTS.md), "Sole writer"). The two-lane writer exception is suspended. **Why:** Earl's instruction, ending writer handoffs between agents. **Impact:** process only; no application change. **Status:** documentation only.
- **2026-11-04 · Repository · Changed:** Open PRs #66, #72, #73, #74 and #77 were reconciled into one change and #60 was closed. Issue #35 became `docs/road-to-v3/10_ADAPTIVE_OPERATIONS_UI_DIRECTION.md` (direction only). Dependencies: undici 7.30.1 (security) and wrangler 4.157.0. **Impact:** no application source change. **Status:** documentation and tooling.

- **2026-11-04 · Governance · Changed:** Added a common changelog obligation for Codex, Claude and other agents in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md). The changelog must enumerate shipped changes per verified version/revision and record accepted specification amendments separately. **Why:** make change history easier to audit across agents. **Impact:** documentation/process only; no application change, deployment or product version increment. **Status:** documentation only; it creates no product release.

## Specification changes

Accepted specification changes made after adoption appear here with date, spec/amendment ID, the exact requirements changed and why, affected scope, acceptance reference and implementation status. An accepted specification change is **not** automatically a deployed product version. Draft proposals are not accepted entries.

## Released product versions and revisions

For each newly verified release, add a heading `### Vx.y[.revision] — YYYY-MM-DD` and short Added/Changed/Fixed/Removed bullets stating concrete user-facing or operational changes. Link the accepted scope, canonical release record and verification. Multiple fixes delivered in one revision appear under the **same** heading. A candidate stays unreleased until qualification; no version number is minted for documentation-only work.

### Existing release records

The following pre-adoption records remain the detailed source of truth. Listing them does **not** independently certify their deployment or owner acceptance; consult each record's latest evidence.

- [V1.16](docs/road-to-v2/releases/v1.16.md) — Ambient Assist and Intelligent Core
- [V1.16.1](docs/road-to-v2/releases/v1.16.1.md) — IP-0.2 redesign
- [V1.16.2](docs/road-to-v2/releases/v1.16.2.md) — Item list thumbnails
- [V1.16.3](docs/road-to-v2/releases/v1.16.3.md) — Staff page redesign
- [V1.16.4](docs/road-to-v2/releases/v1.16.4.md) — Integrated cleanup and performance
- [V1.16.5](docs/road-to-v2/releases/v1.16.5.md) — Page navigation fixes
- [V1.16.6](docs/road-to-v2/releases/v1.16.6.md) — Fresh attention and staff names

Earlier historical versions are retained under `docs/road-to-v2/releases/`. Do not invent missing release numbers or rewrite unverifiable history.
