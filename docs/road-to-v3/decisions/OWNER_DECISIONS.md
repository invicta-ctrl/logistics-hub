# Owner Decisions

The following are now explicit roadmap defaults unless the owner amends them.


## Road-to-V3 version sequence and Administration display (owner accepted, 2026-10-11)

- **Product releases:** V2.0 is the shipped baseline; the Road to V3 progression is V2.1, V2.2, …, V2.9, then V3.0 GA. Internal identifiers `RTV3-01`…`RTV3-09` remain stable aliases, mapping one-to-one to V2.1…V2.9, to preserve existing release cards, task references and handoffs. Historical `V3.1–V3.7` titles are not planned post-V3 releases.
- **V2.1 / RTV3-01 F4 includes Administration → System product version.** The existing System page already exposes a 12-hex build fingerprint, commit and built time. Add an explicitly labeled, verified **Product version: V2.1** to that *same* view; retain existing diagnostics and authorization. This becomes the canonical display for subsequent V2.x and V3.0 releases.
- **Source of truth:** version must come from the actual deployed release's build/deployment metadata, not a hard-coded UI label, the source branch or a new public endpoint. Existing `build.json.version` is the PWA/build fingerprint; preserve its format and semantics and add a separate product-release field. Unknown/malformed/mismatched metadata must show an honest unknown state. Rollback must show the version actually serving.
- **Verification:** V2.1 F4 needs authorized/unauthorized access tests, version/build separation, missing-metadata behavior, and source-versus-deployed identity postflight on production. Future release checks verify their promoted product version.
- This owner acceptance updates **roadmap naming and V2.1 scope only**; it does not accept an implementation specification, permit source edits before gates, override current one-writer governance, or authorize production mutation. Preserve historical V2.0 records.


## Recovery targets
- D1 operational truth RPO ≤ 1 hour.
- R2 evidence/media RPO ≤ 24 hours.
- Core operation RTO ≤ 4 hours during staffed incident response.
- Full evidence/media RTO ≤ 8 hours.

These are targets to prove in RTV3-01, not claims that the current platform already meets them.

## Incident response
- SEV-1 acknowledgement target: 15 minutes during staffed incident response.
- First containment decision target: 60 minutes.
- SEV-1 status update cadence: 30 minutes.
- SEV-2 acknowledgement target: 4 staffed hours.

## Product amendment
RTV3-01 pre-drafts the Road-to-V3 product-direction amendment.
Owner acceptance is required before RTV3-02 implementation.

## Claude
- Coordinator: Opus 5.5 High.
- Threads: Sonnet 5.5 High by default.
- Highest thread effort reserved for genuinely complex/critical work.
