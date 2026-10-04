# Road to V2 — Proposed Amendments: Catalog Intelligence & Semantic Hardening

STATUS: PROPOSED — OWNER REVIEW REQUIRED
DATE: 2026-10-04
APPLIES TO: Road-to-V2 V1.6–V1.15
INTENT: Add organization-specific catalog intelligence and reduce visible semantic/UI noise without creating a mandatory external AI dependency.
PREDECESSOR CONTEXT: V1.5 Rapid Catalogue is COMPLETE on `main`.

## 1. Decision requested

Earl wants the Logistics Hub to become materially smarter while preserving the project's core philosophy:

> The Logistics Hub must remain fully operational without paid AI APIs or any external AI service. External AI may assist, but the built-in intelligence system remains authoritative and must continue to work when AI, internet access, quota, or a provider is unavailable.

This proposal should be reviewed and improved by Claude before acceptance. It is **not implementation authority until Earl explicitly accepts it**.

Once accepted, update the shared `CLAUDE.md` and all affected Road-to-V2 specs in the existing forward-propagation order. Do not create a V1.16 solely for this work unless a later review proves the existing slices cannot safely absorb it.

## 2. Product principle

Use sophisticated internal semantics to make the visible product simpler.

### Internal

The system may understand concepts such as:

- reusable item;
- whole-unit consumable;
- gradual/open-unit consumable;
- reusable container;
- consumable contents;
- canonical type;
- aliases;
- evidence;
- similarity;
- confidence;
- classification source;
- verified examples;
- relationships.

### Public/staff-facing

Show only what a person needs to understand or act.

Example:

`Conditioner Sachet`
`24 sachets available`
`Cabinet A`
`[Take]`

Do not expose internal classifications merely because the database knows them.

## 3. Intelligence authority hierarchy

The intelligence system must use a layered approach, in this order:

1. **Verified human decisions** — strongest organizational authority.
2. **Built-in deterministic rules and verified catalog knowledge** — primary machine authority.
3. **Internal canonical knowledge base / typical consumable database** — generic domain knowledge owned by the application.
4. **Local similarity / local ML / embeddings**, where useful and affordable to run without a service dependency.
5. **Optional Cloudflare Workers AI assistance** — supporting evidence only; never authoritative.

A lower layer must not silently override a higher layer.

If two high-confidence sources disagree, the correct outcome is **review**, not silent mutation.

## 4. Typical Consumable Types Database

Create a reusable internal knowledge base for common inventory behavior. This is not a third-party API and must work locally.

The data model should be reviewed and improved by Claude, but should conceptually support:

- canonical type;
- category/domain;
- stock behavior;
- usage/depletion pattern;
- typical units;
- aliases/synonyms;
- examples;
- confidence/default weight;
- optional notes/evidence.

Illustrative examples:

| Canonical type | Typical behavior | Typical units | Examples |
|---|---|---|---|
| Sachet | whole-unit consumable / usually single-use | sachet, packet | conditioner sachet, shampoo sachet |
| Liquid consumable | gradual depletion | bottle, mL, L | detergent, dishwashing liquid |
| Powder consumable | gradual depletion | pack, kg, g | laundry powder |
| Aerosol consumable | gradual depletion | can | disinfectant spray |
| Battery | whole-unit depletion | piece | AA/AAA battery |
| Paper consumable | whole-unit or gradual depending on item | sheet, roll, pack | tissue, paper towel |
| Disposable PPE | whole-unit / single-use | piece, pair | gloves, masks |
| Gas/fuel contents | gradual depletion | kg, L, refill | LPG/fuel |

The database is a **knowledge source**, not an automatic truth source. Examples and defaults must be reviewable.

## 5. Behavior modeling

Avoid a simplistic `is_consumable` boolean when the actual domain needs more nuance.

Example:

**Gas cylinder**

- object/container: reusable;
- contents: consumable;
- depletion: gradual;
- classification may depend on what the catalog record actually represents.

The intelligence engine should therefore be capable of distinguishing the **item itself** from the **contents/usage behavior** when appropriate.

The same principle applies to kits/containers and other structured inventory objects.

## 6. Intelligence pipeline

For a new or edited catalog item, use a deterministic-first pipeline:

1. Normalize name/input.
2. Look for exact known records and aliases.
3. Search the typical consumable/item-type knowledge base.
4. Cross-reference similar verified catalog records.
5. Use explicit item relationships where available.
6. Apply deterministic behavior rules.
7. Optionally use local similarity/ML if available and appropriate.
8. Produce a recommendation, confidence and evidence.
9. Decide:
   - high-confidence -> suggestion can be shown prominently;
   - medium/ambiguous -> send to Intelligence Review;
   - conflicting evidence -> send to review;
   - no useful evidence -> leave unclassified rather than inventing certainty.
10. Human acceptance/edit/rejection becomes verified evidence for future recommendations.

No step may silently rewrite authoritative inventory quantity, movement history, permissions, loans, evidence or other protected system truth.

## 7. Intelligence Review experience

The review surface should explain **why** the system recommends something.

Illustrative card:

### Conditioner Sachet

**Suggested**
Consumable · Single-use

**Confidence**
96%

**Evidence**
- Matches internal type: Sachet
- Similar to 14 verified catalog records
- 12 verified records use the same behavior
- Alias/name match detected

Actions:

`Accept` · `Edit` · `View details` · `Reject`

Review should be fast for obvious cases and deeper only when needed.

Accepted/rejected/edited decisions should be stored as structured feedback. A single human action must not automatically rewrite global rules; promotion of recurring patterns into a trusted rule should require a deliberate mechanism defined in the accepted implementation.

## 8. Version allocation

### V1.6 — Offline intelligence foundation

Do not expand the visible product scope unnecessarily.

Ensure the built-in knowledge/rule layer used by Rapid Catalogue can operate with the Catalog PWA's offline constraints. No Cloudflare AI dependency.

### V1.7 — Verification evidence

Allow useful physical-inventory/audit outcomes to become reviewable evidence for classification/identity where appropriate.

Physical observations must not silently rewrite stock or classification authority.

### V1.8 — Behavior taxonomy + Typical Consumable Types Database

Establish shared behavior semantics needed by Kits/Containers and the intelligence layer.

Use the existing V1.8 concepts of loanable, whole-unit consumable, and gradual/open-unit consumable as foundations rather than creating duplicate terminology.

### V1.9 — Semantic Minimization & Progressive Disclosure HOTFIX

Keep this slice deliberately small.

Scope is limited to visible UX cleanup:
- remove redundant/common-sense explanatory text;
- simplify labels and button copy;
- prefer one consistent term for one concept;
- hide secondary explanations behind contextual help;
- use information triggers only where a concept is ambiguous, technical, unfamiliar or consequential;
- make the same help available through tap/focus on phones/keyboards;
- do not add a tooltip/help icon to every field;
- do not expose internal intelligence terminology to ordinary public users;
- ensure the correct action is shown instead of asking the user to choose technical modes the system already knows.

Example:

`Unit   ⓘ`
`Sachet`

Contextual help may explain what `Unit` means, but the full explanation does not permanently consume screen space.

For desktop, use a small accessible hover/focus popover with a modest delay. Do **not** require an arbitrary multi-second delay. For touch, tapping the trigger opens the same explanation.

This hotfix is UI/UX hardening only. Do not turn V1.9 into a general design-system or content rewrite.

### V1.10 — Intelligence Review + Attention integration

Use the existing Attention domain to surface records that need classification review.

Add a reason such as:
`catalog classification review needed`

The review item should link directly to the record and auto-resolve when the underlying review requirement is satisfied.

Do not create a second parallel alert system.

### V1.11 — Cross-reference Intelligence

Extend the accepted Intelligent Search/Relationships work into reusable catalog intelligence:
- aliases and normalized names;
- catalog similarity;
- consumable-type matching;
- explicit relationships;
- location/context signals;
- optional local embeddings/similarity where measured useful.

Core search and intelligence must remain functional without an external AI service.

Do not introduce an external search engine merely for this work.

### V1.12 — Operational Intelligence

Use verified classifications and authoritative usage data for explainable insights:
- frequently used consumables;
- repeated consumable stock-outs;
- classification gaps;
- recurring catalog corrections;
- patterns worth staff attention.

Insights must show enough evidence/time-window context to be understandable and remain advisory.

No automatic procurement or stock mutation.

### V1.13 — Intelligence Administration

Within the existing Administration information architecture, provide authorized management for:
- knowledge-base entries;
- consumable/item types;
- aliases;
- rules/policies;
- review outcomes;
- optional AI assistance settings/status.

Avoid creating a separate intelligence administration application.

### V1.14 — Optional Cloudflare AI assistance + hardening

Introduce Cloudflare Workers AI only as a **supporting second opinion** after the built-in engine is mature.

Cloudflare AI may be used when:
- the built-in confidence is low;
- evidence conflicts;
- a case is ambiguous;
- another bounded condition explicitly warrants a second opinion.

Cloudflare AI must never be required for:
- catalog CRUD;
- inventory quantity;
- loans;
- transactions;
- search;
- review;
- offline operation;
- core classification.

Implement a failure-isolation/circuit-breaker pattern:
- success -> AI result becomes additional evidence;
- timeout/error -> continue using built-in intelligence;
- quota exhausted -> stop AI calls for the appropriate period and continue normally;
- offline -> no AI calls;
- provider unavailable -> built-in engine remains fully operational.

Do not assume today's Cloudflare limits remain permanent. Verify current official limits during implementation and protect the free-plan operating envelope.

No paid-provider dependency may be introduced into a normal workflow.

### V1.15 — Final consolidation

Use the existing V1.15 consolidation slice to verify:
- all intelligence paths are coherent;
- there is one visible vocabulary per concept;
- obsolete technical labels/copy are removed;
- public/staff UI exposes only necessary semantics;
- contextual help is used selectively;
- built-in intelligence works when Cloudflare AI is completely unavailable;
- no external AI call is required for critical workflows;
- privacy/security boundaries for catalog knowledge and optional AI payloads are documented;
- realistic journeys still feel simpler despite increased internal intelligence.

V1.15 must not become a venue for adding new intelligence features that should have been specified earlier.

## 9. Semantic Minimization Rules

Apply these rules across the product, but implement them incrementally through the versions above.

### Rule A — Omission first

If a label/value is self-explanatory, do not append a paragraph explaining it.

### Rule B — Progressive disclosure

Secondary information should appear only when a user signals that they need it: hover/focus/tap, a details view, or an explicit review/admin surface.

### Rule C — Help is selective

Do not place `ⓘ` on every field.

Use contextual help for:
- technical terms;
- ambiguous labels;
- policy-dependent behavior;
- unfamiliar system states;
- consequential actions.

Do not explain:
- obvious item names;
- obvious quantities;
- obvious primary buttons;
- information the surrounding UI already makes clear.

### Rule D — One concept, one public term

If the same action is called “Take” in one place, do not call it “Consume” somewhere else without a real behavioral distinction.

### Rule E — Internal semantics stay internal

Technical taxonomy, confidence mechanics, rule source and model metadata belong in Review/Admin where justified, not in ordinary public/staff UI.

### Rule F — Buttons express the user's action

Do not expose implementation terminology as a decision.

Prefer:
`Take`, `Borrow`, `Return`, `Review`, `Accept`, `Edit`

over technical state-machine wording.

### Rule G — Intelligence should reduce choices

If the system knows enough to select the correct path, it should remove unnecessary user decisions rather than exposing every possible backend state.

## 10. Local/non-AI implementation preference

Preferred order:

1. database-backed deterministic rules;
2. normalized/fuzzy matching already supportable by the current stack;
3. small/local ML or embeddings only where measurement demonstrates real value;
4. optional Cloudflare Workers AI as a supporting service.

Do not add a paid AI API merely to make the feature feel intelligent.

Do not add Redis, Elasticsearch, a second operational database, an event bus, a generic AI framework, or another speculative infrastructure layer for this feature family.

## 11. Data and authority constraints

- D1 remains structured operational truth.
- R2 remains governed media/evidence storage.
- Inventory quantity remains movement-derived from the ledger.
- Intelligence outputs are advisory until accepted by an authorized human where acceptance is required.
- Knowledge-base entries and verified examples must have clear ownership and auditability.
- No private Staff Directory, official ID, transaction evidence or other sensitive data should be sent to an external AI provider unless explicitly authorized by an accepted privacy/security design.
- Public repository contents must not contain private catalog exports, private evidence or provider credentials.
- Caches/vector indexes, if introduced, must be reconstructable and non-authoritative.

## 12. Performance and cost guardrails

The intelligence system must be designed for the Cloudflare Free-plan environment and ordinary low-cost hosting.

- Do not make an AI call for every catalog record by default.
- Prefer local/deterministic matching for the common case.
- Bound candidate searches and evidence lists.
- Keep heavy similarity/index work off critical navigation paths where possible.
- Measure Worker CPU, D1 reads, response size and browser work before introducing heavier inference.
- Cloudflare AI usage must be optional and quota-aware.
- AI failure must not slow or block core inventory actions.
- Any new cache/index/model asset must have a measured reason and a rollback/recovery path.

## 13. Acceptance gates for Claude review

Before turning this proposal into accepted amendments, Claude should check:

1. Does each addition belong in the stated version without violating its existing scope?
2. Can the intelligence foundation be implemented without paid AI?
3. Can every AI-assisted workflow operate normally when Cloudflare is disabled?
4. Is the consumable knowledge base specific enough to be useful but generic enough to avoid unsafe assumptions?
5. Are ambiguous classifications routed to humans instead of silently asserted?
6. Does the semantic-minimization hotfix remain small enough for V1.9?
7. Are any proposed schema changes duplicating existing V1.8/V1.11 concepts?
8. Are privacy boundaries sufficient for optional AI calls?
9. Does the plan avoid speculative infrastructure?
10. Are the visible UI changes actually reducing staff/public cognitive load?

Claude should improve the proposal where needed, but preserve the central doctrines:
- built-in intelligence remains authoritative;
- AI remains optional;
- free operation remains possible;
- human review remains available;
- internal complexity should produce simpler external UX.

## 14. Acceptance and propagation procedure

If Earl accepts this amendment:

1. Mark this document as accepted or create the corresponding accepted amendment under `docs/specs/accepted/road-to-v2/` according to repository convention.
2. Update the shared `CLAUDE.md` with the new cross-version rules and the instruction that the amendment applies to V1.6–V1.15.
3. Update each affected accepted spec only at the earliest slice where the new requirement first applies; do not duplicate the full proposal into every spec.
4. Preserve existing version boundaries and exclusions unless a specific requirement above explicitly changes them.
5. Propagate the shared changes forward in the existing order:
   V1.6 → V1.7 → V1.8 → V1.9 → V1.10 → V1.11 → V1.12 → V1.13 → V1.14 → V1.15.
6. Use the established Road-to-V2 merge/propagation rules. Never rewrite history, force-push or update a preceding branch from a later branch.
7. Keep V1.9 semantic hardening and V1.14 Cloudflare assistance bounded so neither slice becomes a feature dump.
8. Record any rejected or deferred portion explicitly rather than quietly dropping it.

## 15. Out of scope for this amendment

Unless separately amended, do not add:
- mandatory external AI;
- paid OpenAI/Gemini/Claude APIs;
- AI-controlled inventory mutations;
- autonomous procurement;
- autonomous staff decisions;
- facial recognition;
- per-item QR rollout;
- a generic chatbot/agent;
- a full natural-language command framework;
- external search infrastructure;
- speculative distributed caches/vector databases;
- a new post-V2 feature family disguised as “intelligence.”

## 16. Desired end state

By V2.0, the Logistics Hub should behave like this:

A staff member enters or photographs an unfamiliar item.

The system quietly checks:
- what it already knows;
- what similar verified catalog items do;
- what the internal consumable/type knowledge says;
- what relationships/context suggest;
- optionally, whether a free Cloudflare AI second opinion is useful.

The user sees only what they need.

If confidence is strong:
> **Suggested: Consumable · Sachet**

If uncertain:
> **Needs review**

The reviewer can:
> **Accept / Edit / View details**

The system records the human decision and becomes better at future recommendations.

If Cloudflare disappears tomorrow, the Logistics Hub still works.

The intended outcome is not “add AI to Logistics Hub.”

The intended outcome is:

> **Make Logistics Hub smarter underneath, simpler on top, and independent of external AI.**
