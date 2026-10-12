# Owner Decisions

The following are now explicit roadmap defaults unless the owner amends them.


## Road-to-V3 version sequence and Administration display (owner accepted, 2026-10-11)

**Later same-day amendment:** the original “first version display in V2.1 F4” assignment below was superseded by the owner-accepted V1.16 pre-roadmap release. V1.16 now owns the initial version/changelog capability, and V2.1 F4 reuses and qualifies it. Preserve this older entry only as the dated owner-decision sequence.

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


## V1.16 pre-roadmap owner approval — 2026-10-11 (release implementation pending)

- The owner explicitly requested a **V1.16** release after closing V1.15, before progressing into Road to V3. V2.0's historical handoff is not rewritten; Road-to-V3 still uses V2.1–V2.9 then V3.0.
- Requested V1.16 objective: invisible Ambient Assist and independent deterministic Intelligent Core, quiet safe learning from verified staff corrections, model routing/evaluation, no AI-chat dependency, total normal-workflow continuity under exhaustion and outage.
- Requested existing Administration > System > This version enhancements: show actual deployed **product version** and a short **verified release changelog** as well as technical build fingerprint, commit, built time and migration state. This is moved forward from V2.1 F4; future V2.1 must reuse it.
- Owner's durable release rule: never represent an incomplete product/version as complete; push working checkpoints to the single active slice; merge each independently usable, verified complete slice into updated main promptly, prune its integrated branch, then start the next slice from updated main. Keep blocked/unfinished work accurately in handoff and off main.
- The detailed implementation specification at docs/specs/accepted/v1.16-ambient-intelligent-core.md was explicitly accepted by the owner on 2026-10-11: “I approve, after v1.16. V2 will be genuinely complete and ready to proceed with v3 roadmap.” This authorizes in-scope work subject to writer lock, normal verification and production safeguards, but is not evidence of a completed release. Final V2 readiness requires V1.16 complete, merged and deployed with qualified evidence.

## Permanent version and subversion governance — owner-directed 2026-10-11

- **Naming:** main versions `Vx.xx`; each independently completed and verified product-affecting revision **after that main release is merged** receives the next `Vx.xx.1`, `Vx.xx.2`, `Vx.xx.3`, etc., automatically. This requirement applies to all future agents and product releases.
- **Count by integrated release, not by commit:** separate completed/merged fixes mean separate third-component versions. Multiple commits/checkpoints for one fix or intentionally bundled release still count as one revision. Documentation-only or unfinished work does not increment a product version.
- **Evidence and display:** verify parent version, current main, existing release history and deployed identity before final allocation. One truthful release record/changelog per revision; the approved V1.16 Administration version system must support the revision number. Unknown history must not be fabricated.
- **Binding policy:** `docs/PRODUCT_VERSION_GOVERNANCE.md`, invoked normatively by AGENTS.md, CLAUDE.md, .agents/PROJECT_POLICY.md and docs/SHARED_AGENT_WORKFLOW.md. Never present an incomplete revision as shipped or weaken existing single-writer/security/release gates.


## V1.16 final qualification and acceptance — owner-directed 2026-10-12

- Use live GitHub authority; verify completed A1/A2/B1/C1/D1 evidence without rebuilding their capabilities. Agents perform technically feasible production/mobile/desktop/photo/fallback/integrity/permission/System/accessibility QA themselves.
- Freeze fresh held-out fixtures, benchmark an existing failing task against a permitted challenger, and record real precision, abstention, latency, availability and free usage. Preserve REVIEW_ONLY for unqualified roles; no paid API, automatic model promotion or quota-exhaustion completion claim.
- Finish independently verified accepted-scope repairs on one writable slice with exact-source CI/CodeQL, configured deployment, postflight and rollback controls. Preserve unknown work and historical release evidence.
- Final approval is a distinct owner acceptance gate, requested only after all agent-executable gates pass. Only that explicit approval permits governed V1.16 product identity promotion; verify actual running artifact and Administration version/changelog before RELEASED_VERIFIED and closure.
- Explicit states: VERSION_VERIFYING, BLOCKED_EXTERNAL, PAUSED_USAGE_LIMIT, AWAITING_OWNER_ACCEPTANCE, RELEASED_VERIFIED. An interruption preserves exact executable continuation with V1.16 OPEN. No V2.1 or final V2 readiness before accepted, verified release.
