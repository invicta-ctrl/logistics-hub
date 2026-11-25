# Logistics Hub — modernization plan
Owner direction (2026-11-25): adopt Governance Template v1.1.1 throughout the project, including architecture, design and governance; prepare the repository for Claude Code Desktop. Codex is inactive unless expressly assigned. This plan expresses direction, not acceptance of any product migration.

## Next development cycle
- Establish functional parity inventory from current public, staff, lending, stock/pantry, catalogue, self-service/PWA, activity, administration and account flows. Preserve permissions, offline sync and historical records.
- Approve new architecture and Figma visual baseline, then implement React + TypeScript + React Router/Vite, Tailwind and qualified shadcn-compatible accessible components; TanStack Table and Drizzle only where justified. Retain Cloudflare Workers/D1/R2 and verify existing integrations and transaction invariants.
- Target logical application structure: app/routes, app/components, app/features, app/styles, app/server, app/lib, app/contracts, app/assets only when meaningful; tests and migrations remain explicit root roles. Retain existing src during governance adoption, then migrate by approved vertical slice; do not create empty folders or parallel permanent architectures.
- Use the approved design references and full frontend research, product-specific semantic tokens, mobile/desktop accessibility, meaningful motion and Storybook for shared components.
- Each slice is independently usable and verifiable; preserve rollback and previous version operability. Obtain accepted migration/feature specs before product edits; use existing product version governance.
- Reconcile the earlier Road-to-V3 V2.1–V3.0 release map with the separately supplied post-V2 V3.1–V3.7 roadmap before selecting any milestone. V2 consolidation, accepted closure and a verified main are required before post-V2 implementation. No release renumbering by assumption.
- Preserve PR #96 and all prior evidence; decide whether to integrate or supersede its inventory changes in an accepted spec. No automatic closure or merge.
- Scope for this repository preparation: LH-GOV-001. Product implementation starts only after template qualification and a bounded accepted next spec.
