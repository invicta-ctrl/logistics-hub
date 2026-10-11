# Product Version & Revision Governance

**Status:** Owner-directed governing policy, 2026-10-11. Applies to Codex, Claude Code, Forge/MausBot and every agent acting on Logistics Hub, including V1.16 and the V2.1–V3.0 roadmap.

**Authority and entry points:** AGENTS.md, .agents/PROJECT_POLICY.md, docs/SHARED_AGENT_WORKFLOW.md, and CLAUDE.md invoke this single detailed policy. An accepted release specification and explicit owner instructions take precedence for scope, but no agent may quietly skip revision identity or claim a release before proof.

## 1. Naming contract

- **Main/product release:** `V<major>.<minor>`, e.g. `V1.15`, `V1.16`, `V2.1`, `V2.9`, `V3.0`.
- **Post-release revision:** `V<major>.<minor>.<revision>`, e.g. `V1.15.1`, `V1.15.2`, `V1.15.3`.
- All components are base-10 non-negative integers; post-release revision starts at `1` and increments by exactly one. Never reuse a published number or skip a number deliberately. Do not pad zeros or create an extra fourth component.
- The original `V1.15` release is not retrospectively relabeled `V1.15.0` in user-facing copy. It is the base of the `V1.15.*` revision series.
- A new accepted main release starts a fresh series: after `V1.16` is really released, its first subsequent completed change is `V1.16.1`, not `V1.15.N`. After `V2.1` ships, its patches are `V2.1.1`, `V2.1.2`, etc.; `V2.2` begins a new base.
- V1.16 is an owner-approved historically out-of-sequence completion release after the earlier V2.0 historical handoff. Do not fabricate a new chronological order or rewrite old V2.0 evidence; use the product release explicitly selected by the owner and verified against the actual current artifact.

## 2. Automatic revision trigger — MANDATORY

Once a main version has been **completed and merged into main**, every subsequent independently completed **product-affecting** change to that released version MUST be treated as a subversion/revision of that version. This includes:
- bug fixes, hotfixes, regressions and recovery fixes;
- visual, layout, mobile, copy and accessibility adjustments;
- workflow behavior, performance, security, data-handling or permission corrections;
- improvements or adjustments to an already shipped capability, including AI behavior;
- any deployed functional/configuration changes, even if the owner informally calls them "another small fix."

**One accepted, independently deployable change-set merged into main = exactly one successive revision number** for the active already-released version line. For example:
- V1.15 base already on main -> first independently merged post-release fix = V1.15.1;
- next independently merged fix = V1.15.2;
- next independently merged fix = V1.15.3.
If a fix requires four commits/checkpoints on its one active slice branch, those are **not** four revisions. If the owner requests three fixes as three separately independently completed, merged releases, those must be three successive revisions, even if all happen on one day. If multiple fixes are intentionally bundled into **one** verified, independently deployable release, increment once and enumerate every included fix in its changelog.

**No increment:** drafts, proposed specifications, documentation-only governance/history changes, unmerged branches, review comments, CI retries, failed/deferred implementations, checkpoints before merging, provider diagnostics with no product artifact change, or pure records-only commits that do not modify the running product. Never mint a product version merely to make a changelog or documentation look complete.

**Subversion is not permission:** it does not waive spec acceptance for substantive changes, writer-lock ownership, security checks, provider usage limits, migration/production preflight or sign-off requirements.

## 3. Determine the next subversion without guessing

Before starting a post-release change:
1. Read the current owner's target/main version, `main` HEAD, currently deployed artifact/version when verifiable, the last **verified** release record/tag/commit and any active slice or writer lock. If the owner explicitly targets a historical line, reconcile the actual production ancestry and accepted release evidence before claiming a new `V1.15.N` on top of a different deployed base.
2. Inspect preceding revisions for that exact `major.minor` line in actual release records and, when available, immutable tags/build metadata. Resolve any contradiction, missing release, unmerged change or concurrent writer before assigning a number.
3. Propose the next integer `N = highest verified, integrated revision for this line + 1`. If none exists, start at 1. The candidate number stays *pending* while the slice is in progress; it is not a released version.
4. Immediately before integration, re-read fresh remote main/ref and verified release history. Reject stale or duplicate allocation. The single-writer/one-active-slice policy applies; if another version was merged, recompute and reconcile changelog/source identity.
5. Reserve the identifier as the **next release candidate** in the current slice's checkpoint/handoff. Promote it to an actual released version **only after** its independently working accepted scope, typecheck/build/tests/privacy/security/diff, exact-head CI, main integration and required deployment/postflight evidence pass. If a gate fails, do not consume the number or falsely present it as released.
6. Record exact target version, parent release, source SHA, merged main SHA, deployed identity/status, relevant migrations/backout, verification and owner-visible changes. Keep one canonical release record for each release in the existing release-record convention. Avoid a second mutable version registry.
7. Never invent or retrospectively renumber historical V1.15 changes simply by counting commits. If the owner requests historical backfill, reconstruct each independently merged and deployed fix from verifiable Git/CI/deployment evidence; mark unprovable history `UNKNOWN` rather than assign fictitious V1.15.1–N.

## 4. Branch, checkpoint, merge and handoff discipline

- Use the **one active** short-lived `slice/<part>-<scope>` branch, one authorized writer, and existing handoff policy. Branch naming may include the candidate revision for clarity (e.g. `slice/v1.15.2-photo-fix`) but the branch name is **not** release evidence.
- Each safe, coherent, working checkpoint is committed/pushed to this same branch. Do not label a checkpoint as its own subversion.
- Independently functioning fixes/slices that pass accepted criteria and exact-head CI integrate into latest main promptly, verify configured Workers Build/deployment, then prune their proven-merged branch; the next independent fix uses a new slice from updated main.
- An incomplete feature must not be merged or described as complete. If its next independent slice is required to make it work, it has not satisfied this policy.
- If a larger main version is still underway, independently completed slices may reach main, but must not prematurely claim the unreleased main version or manufacture patch numbers on a not-yet-released line. Preserve the last **truthful running** product-version identity until the main release qualification gate is met.
- Document-only governance commits can be integrated as verified documentation slices without consuming a revision of the product.

## 5. Website version & change summary

- **After V1.16 ships its accepted version-display capability**, Administration > System > This version must display the actual **Product version** and a brief **What's new** summary for the immutable running build, separately from build fingerprint, commit, built date and migration status.
- For a revision deployment, show `V1.15.1`, `V1.15.2`, etc., and summarize only that revision's verified changes, ideally 2–5 concise items. Main releases show `V1.16`, `V2.1`, etc.
- A release candidate may be labeled as pending in private release records, but the public/staff product must not display it as shipped. Absent/malformed version metadata is `Unknown` rather than a guessed value.
- A rollback to an **existing immutable artifact** displays that artifact's original version and notes rollback separately in operations evidence; a newly built corrective/revert release merged to main consumes the next revision number. No reuse of the rolled-back version identifier for different bytes.
- Any change to how version metadata is encoded must reuse the single governed build/Administration route and have denial, rollback, stale-cache and cross-device tests. Never expose private build.json or add a duplicate Administration panel.
- Before the V1.16 version UI is actually deployed, maintain truthful release records; do not claim the planned UI is already live.

## 6. Mandatory agent release checklist

Before each independent merge/release, Codex, Claude and Forge MUST check and state in the release record:
- `PARENT VERSION`, `CANDIDATE VERSION`, `RELEASE TYPE` (new main / post-release revision / documentation-only);
- verified previous release identity + refs, owner-approved scope and source SHA;
- what changed and *why this increments (or does not increment) the revision*;
- full relevant automated checks, independent usefulness, denied/failure cases, diff/privacy evidence;
- actual main merge SHA, CI/Workers Build/deployed SHA and rollback identity;
- actual Administration product version/short changelog when supported and evidence on phone/desktop where relevant;
- exact next step if any evidence is unknown, unavailable or blocked.

**Definition of done:** no version/subversion may be marked COMPLETE or RELEASED merely because code, a PR or a branch exists. Release numbers reflect verified independently delivered revisions, not messages, guesses, number of commits, or requests. Agents follow this contract automatically; the owner never has to remind them to create `Vx.xx.xx` after a released version is revised.
