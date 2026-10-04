# Road to V2 — Accepted Amendment: Catalog Intelligence & Semantic Hardening

STATUS: ACCEPTED BY OWNER (Earl, 2026-10-04, accepting revision 2 of the proposal with the decisions in §17)
DATE: 2026-10-04
SUPERSEDES: `docs/specs/proposed/2026-10-04-catalog-intelligence-semantic-hardening.md` (revision 1, kept as history).
APPLIES TO: Road-to-V2 V1.6, V1.8, V1.9, V1.10, V1.11, V1.12, V1.13 and V1.15. V1.7 and V1.14 receive clarifications only, no new scope.
INTENT: Make catalog classification smarter by extending the deterministic suggestion engine already shipped in V1.5, and reduce visible semantic/UI noise, without any external AI dependency. An optional Workers AI second opinion is allowed in V1.11 under strict conditions (§13).
PREDECESSOR CONTEXT: V1.5 Rapid Catalogue is COMPLETE and merged to `main`.

## 1. Decision requested

The doctrine from revision 1 is unchanged:

> The Logistics Hub must remain fully operational without paid AI APIs or any external AI service. External AI may assist, but the built-in intelligence system remains authoritative and must continue to work when AI, internet access, quota, or a provider is unavailable.

This amendment differs from revision 1 of the proposal in four material ways (full list in Appendix A):

1. It builds on the behaviour model, aliases and suggestion engine that already exist instead of introducing a parallel taxonomy.
2. It moves the semantic-minimization work out of a "V1.9 HOTFIX" label and into the slices that already own those surfaces.
3. It moves the optional Cloudflare Workers AI second opinion from V1.14, whose accepted spec forbids new features, to V1.11, which already allows optional AI assistance (scope item 9). It is off by default and never required (§13).
4. It replaces confidence percentages with plain evidence tiers and adds a measurement step that decides whether any heavier layer is ever justified.

Earl accepted this amendment on 2026-10-04; his decisions on the open questions are recorded in §17. Each slice applies its §11 item once that item is in the slice's own accepted spec (§16).

## 2. What already exists (baseline)

This amendment extends these; it must not duplicate them.

| Concept | Where it lives today | Notes |
|---|---|---|
| Item type | `items.item_type`: `Loanable`, `Consumable`, `NEEDS_REVIEW` (`src/catalog-policy.ts`) | `NEEDS_REVIEW` is shown as "Unclassified" and hidden from public surfaces. |
| Consumption mode | `items.consumption_mode`: `WHOLE_UNIT`, `OPEN_UNIT` (migration 0017) | Open units are tracked in `open_units`, guarded by triggers. |
| Behaviour (staff choice at the shelf) | `BEHAVIOURS`: `BORROW`, `CONSUME`, `GRADUAL`, `REVIEW_LATER`, mapped to type + mode by `behaviourFields`/`behaviourOf` | This is the single behaviour vocabulary. V1.8's "loanable / whole-unit / gradual" concepts are these. |
| Self-Service action | `TAKE`, `BORROW`, `USE`, decided by the item, never chosen by the user (`src/self-service-app.ts`) | Already implements "the item decides". |
| Aliases | `items.aliases` (migration 0001) | Free text today. |
| Name normalization | `words()` in `src/duplicates.ts` | Shared by duplicate detection and suggestions. |
| Suggestion engine | `src/catalogue-suggest.ts` | Up to 5 look-alike confirmed items vote; the plurality wins; every suggestion carries a reason ("Like “Whiteboard marker” and 4 more"); session repetition as fallback; no network. |
| Keyword knowledge | `src/item-icons.ts` | Curated keywords, including local terms and brands (Zonrox, Kopiko, cartolina), mapped to icons. |
| Audit trail | `audit_log`, append-only (migration 0022) | Item changes are already audited. |
| Attention | Needs-attention views in Stock, Activity and Self-Service review | V1.10 unifies these into one Attention domain. |

## 3. Product principle

Sophisticated internal semantics exist to make the visible product simpler.

Internally the system may reason about behaviour, aliases, look-alike items, keyword hints, evidence strength and relationships. Staff and public screens show only what a person needs to act:

`Conditioner Sachet`
`24 sachets available`
`Cabinet A`
`[Take]`

Evidence and reasons appear where a person is making a classification decision (Rapid Catalogue, the item edit view, Attention), never on ordinary browse/transaction screens.

## 4. Vocabulary — one concept, one term

Today the same behaviour has different names on different screens. This table becomes the reference for every slice from V1.6 on; V1.15 verifies it.

| Concept | Internal value | Staff term (classification) | Public / transaction term | State |
|---|---|---|---|---|
| Lent and returned | `Loanable` / `BORROW` | **Borrow & return** | **Borrow**, **Return** | Live; keep. |
| Used up whole, one unit at a time | `Consumable` + `WHOLE_UNIT` / `CONSUME` | **Take** *(today "Consume")* | **Take** | Decided (§17.1); lands in V1.8. |
| Opened and used gradually | `Consumable` + `OPEN_UNIT` / `GRADUAL` | **Use gradually** | **Use** | Live; keep. |
| Not yet decided | `NEEDS_REVIEW` / `REVIEW_LATER` | **Not sure / Review later** at capture; **Unclassified** in lists | never shown publicly | Live; keep. |
| Stock leaving through consumption | movement reason `CONSUMED` | **Taken or used** *(today "Consumed or used")* | n/a | Decided (§17.1); lands in V1.8. |

Rules:

- `Loanable` and `Consumable` may remain staff-facing nouns in filters and item details where a noun is needed; action buttons use the verbs above.
- Internal enum names never appear in UI copy.
- A new user-visible term for an existing concept requires an update to this table in the slice's spec.

## 5. Evidence order (authority)

Suggestions draw on four sources. A lower source never overrides a higher one.

1. **This item's own confirmed fields.** A field a person has confirmed is never changed by a suggestion. Suggestions only fill or offer values for fields that are empty or unclassified.
2. **Other confirmed catalog items.** The existing look-alike vote. Only items that are active, not `NEEDS_REVIEW` and not in the `UNSORTED` category vote. This is already the rule in `catalogue-suggest.ts` and remains so.
3. **The built-in knowledge base** (§6). Generic hints shipped with the application.
4. **Optional Workers AI second opinion.** From V1.11, only when enabled, and only under §13. It is never authoritative and never outranks sources 1–3.

Conflict handling depends on whether a person is present:

- **At capture time** (Rapid Catalogue, item edit): the person is right there. Show the conflicting options with their reasons and let them pick. Do not create a review item.
- **With no person present** (records that are still Unclassified): surface the record through Attention (V1.10). Never resolve the conflict automatically.

In Road-to-V2 the system does **not** re-examine already-confirmed items in the background to second-guess them. That would add noise without a measured need.

## 6. Built-in knowledge base (item hints)

A reusable, application-owned table of hints about common items. It works offline and has no external dependency.

### 6.1 Shape

Each entry has keywords and optional hints. Each hint is independent and may be omitted.

| Field | Meaning |
|---|---|
| `key` | Stable identifier. |
| `keywords` | Words and phrases matched against the normalized item name and aliases, including local terms and brand names. |
| `behaviour` | Optional: `BORROW`, `CONSUME` or `GRADUAL`. Omitted where it genuinely depends on the item. |
| `unit` | Optional typical unit (singular, as stored). |
| `category` | Optional typical category, only where it matches the live category list. |
| `icon` | Optional icon key from `item-icons.ts`. |
| `note` | Optional reviewer-facing note explaining the hint. |

### 6.2 Packaging and product are separate kinds of hint

Revision 1's table mixed packaging (sachet, aerosol), material (liquid, powder) and product (battery, PPE). They answer different questions, so they are separate kinds of entry:

- **Packaging/unit words mostly decide behaviour and unit.** "Sachet" → `CONSUME`, unit `sachet`. "Ream" → `GRADUAL`, unit `ream`. "Refill" → `GRADUAL`.
- **Product words mostly decide category and icon.** "Conditioner" → a toiletries/cleaning category and the bottle icon, with **no** behaviour hint, because a conditioner sachet and a conditioner bottle behave differently.

Hints from several matching entries combine. If they disagree on the same field, that field gets no knowledge-base hint.

Illustrative entries:

| Entry | Keywords (examples) | Behaviour | Unit | Notes |
|---|---|---|---|---|
| Sachet | sachet, packet | Take | sachet | Single-use packaging. |
| Ream | ream, bond paper ream | Use gradually | ream | The canonical open-unit example (migration 0017). |
| Aerosol can | spray, aerosol | Use gradually | can | |
| Battery | battery, AA, AAA | Take | piece | |
| Disposable gloves / masks | gloves, facemask | Take | piece / pair | |
| Refill (gas, ink) | refill, LPG refill, ink refill | Use gradually | refill | Contents only; see §7. |
| Paper towel / tissue | tissue, paper towel | *(none)* | roll | Depends on how the office tracks it, so no behaviour hint. |

### 6.3 Storage

- Ship the knowledge base as a **versioned data file in the repository** (the same pattern as `src/item-icons.ts`), not a D1 table. That makes it reviewable in pull requests, available offline with the app bundle and free of D1 reads, and it needs no admin screen.
- Seed it from the **real catalog vocabulary**: current item names, aliases and the local terms already in `item-icons.ts`. A generic English list would be less useful.
- Match using the same normalization as `words()`. Do not maintain a second keyword list for the same concept: either `item-icons.ts` and the knowledge base share entries, or one derives from the other. The V1.8 implementation picks one and records why.
- A knowledge-base hint is evidence, not truth. It ranks below confirmed look-alike items.

## 7. Item vs contents

Some things have a reusable container and consumable contents (gas cylinder and LPG, printer and ink). Each catalog record keeps exactly one behaviour. Model the pair as **two records**:

- the container as its own record (for example `Gas cylinder`, Borrow & return or a stationary asset);
- the contents as a separate record (for example `LPG refill`, Use gradually);
- linked by an explicit relationship (V1.11) or a structured container (V1.8) where that adds value.

No new "contents behaviour" column is added. The knowledge base may hint "refill" → Use gradually, and Rapid Catalogue may offer to create the companion record, but it never splits a record automatically.

## 8. Suggestion pipeline

For a new item, or an item whose classification is still empty:

1. Normalize the typed name and aliases.
2. Exact alias/name match against confirmed items (existing duplicate detection).
3. Look-alike vote among confirmed items (existing).
4. Knowledge-base hints (§6).
5. Explicit relationships, where they exist (V1.11 onward).
6. Combine into, for each field, a suggested value, a **strength tier** and a reason.
7. Present the result. Nothing is saved until a person taps it.

### 8.1 Strength tiers (no percentages)

A plurality over at most five look-alikes is not a calibrated probability, so no percentage is shown anywhere, including Review and Administration.

| Tier | Starting definition (tuned by §9) | Presentation |
|---|---|---|
| **Strong** | An exact alias match to a confirmed item, or at least 3 look-alikes agree and no knowledge-base hint disagrees. | Pre-highlighted one-tap suggestion with its reason. |
| **Weak** | A single look-alike or a knowledge-base hint alone. | Offered quietly with its reason. |
| **Conflicting** | Look-alikes and a knowledge-base hint disagree, or the vote ties. | Both options shown, each with its reason. |
| **None** | No useful evidence. | No suggestion. The field stays empty or "Not sure / Review later". |

Reasons are plain sentences built from the evidence, for example: "Like “Shampoo sachet” and 3 more" · "Sachets are usually taken one at a time" · "Your last two items".

A Workers AI second opinion (V1.11, §13) is never more than **Weak** on its own. It never turns a Conflicting result into Strong; it is added as one more option with the reason "AI suggestion".

### 8.2 Feedback

- An accepted or edited suggestion becomes part of the confirmed item, so it automatically joins future look-alike votes. That is the learning loop, and no separate feedback store is needed.
- A suggestion dismissed at capture time is not stored.
- Recurring patterns are **not** promoted into rules automatically. Promotion means a person adds an alias to an item or a keyword entry to the knowledge base (§11, V1.13).

## 9. Measurement

"Smarter" must be measured, not asserted.

- V1.8 adds an evaluation script that runs **leave-one-out** over the confirmed catalog. For each confirmed item it hides the item's own fields, asks the pipeline for suggestions and records whether behaviour, unit and category match. Results are reported per tier.
- Report the **baseline** (V1.5 engine alone) and the result **with the knowledge base**. Thresholds in §8.1 are adjusted to the measured results, and the final values are recorded in the V1.8 release record.
- Run it against a fixture locally, or against private data only in a private local run. Only aggregate numbers go into the repository; no private catalog export is committed.
- V1.11 extends the same script to measure the Workers AI second opinion against the built-in result, using fixture data only, and records the outcome (§13).
- Local embeddings, or any AI use beyond §13, may only be proposed by a later amendment that cites the measured remaining errors and shows the simpler layers cannot fix them.

## 10. Semantic minimization rules

Applied incrementally through the slices in §11.

- **Rule A — Omission first.** If a label or value explains itself, do not add a paragraph explaining it.
- **Rule B — Progressive disclosure.** Secondary information appears only when the user asks for it: hover/focus/tap, a details view, or a review/admin surface.
- **Rule C — Selective help.** Do not put `ⓘ` on every field. Use contextual help for technical terms, ambiguous labels, policy-dependent behaviour, unfamiliar system states and consequential actions. Do not explain obvious names, quantities or primary buttons.
- **Rule D — One concept, one term.** Follow the vocabulary table in §4.
- **Rule E — Internal semantics stay internal.** Evidence tiers, reasons, knowledge-base sources and AI attribution appear only where someone is classifying (Rapid Catalogue, item edit, Attention, Administration). Never on browse or transaction screens. Wherever an AI suggestion is shown, it is labelled as one.
- **Rule F — Buttons say what the user is doing.** Prefer `Take`, `Borrow`, `Return`, `Use`, `Accept`, `Edit` over state-machine wording.
- **Rule G — The system removes choices it can make.** This applies at **transaction time**: where item configuration decides the action, do not ask. It does **not** apply at classification time. V1.5's rule stands: an uncertain classification is never saved silently.

Contextual help requirements (wherever it is used):

- one shared, accessible component that opens on hover/focus with a short delay (no multi-second delay) and on tap;
- reachable and dismissible by keyboard, announced to screen readers;
- a trigger target size meeting WCAG 2.2 AA (2.5.8), consistent with the Part 6.5a target-size work.

## 11. Version allocation

Each entry lists what is added to that slice's accepted spec. Each slice's existing exclusions stay in force.

### V1.6 — Catalog PWA

- The existing suggestion engine keeps working offline over the cached catalog snapshot, with the same results as online.
- No knowledge base and no new suggestion features here: V1.6 excludes "new cataloguing features beyond taking V1.5 offline".

### V1.7 — Physical inventory (clarification only)

- An audit outcome that says a record looks misdescribed uses V1.7's existing **review-needed** state. It does not change classification, and V1.7 does not consume it as classification evidence. V1.10 decides how review-needed records surface.

### V1.8 — Kits & containers

- Apply the two renames decided under §17.1 everywhere they appear: the staff classification choice "Consume" becomes **Take**, and the movement label "Consumed or used" becomes **Taken or used**. Both are single label constants in `src/catalog-policy.ts`; update the tests and copy that assert them.
- Adopt the rest of the §4 vocabulary on every screen V1.8 builds or touches.
- Add the knowledge base (§6), seeded from the real catalog vocabulary, and include it in the offline app bundle.
- Extend `catalogue-suggest.ts` with knowledge-base hints and the strength tiers (§8).
- Add the evaluation script and record baseline and after results (§9).
- Document and support the container/contents pattern (§7) with kits/containers where it fits.
- Exclusions unchanged: no intelligent global search.

### V1.9 — Self-Service 2.0

- Apply Rules A–G to the Self-Service screens V1.9 rebuilds. V1.9 already requires "one correct transaction action" and no redundant Borrow/Consume choice.
- Ship the shared contextual-help component (§10). Later slices reuse it rather than building their own.
- **Not a hotfix**, and no product-wide copy rewrite: staff-side copy outside V1.9's surfaces belongs to V1.15 scope item 2 (§17.2).

### V1.10 — Attention

- The existing V1.10 reason "catalog record missing … classification" covers Unclassified records. The entry links to the item's edit view, which shows the top suggestion, its tier and its reason. The entry resolves automatically once the item is classified.
- Add V1.7 review-needed audit outcomes about record descriptions as a reason, if V1.7 produced them.
- No separate "Intelligence Review" page and no second alert system.

### V1.11 — Intelligent search & relationships

- Search matching uses aliases and knowledge-base keywords.
- Relationships include container ↔ contents (§7) alongside the accepted types.
- **No embeddings**, local or remote, and no vector index. Name, alias and keyword matching is sufficient at current and ~10x scale.
- Under scope item 9 (optional AI assistance), V1.11 may add the **optional Workers AI classification second opinion** defined in §13. It ships **off by default**, behind a setting in the existing Administration settings (`system_settings`, Administrator or Owner, audited). V1.13 later places that setting in its Catalog section. Core search and classification stay fully deterministic whether it is on or off.

### V1.12 — Operations home

- Within the accepted insights scope, add **classification gaps** (count of Unclassified items, linking to Attention) and **frequent corrections** (items or keywords whose behaviour is repeatedly changed, derived from `audit_log` with an explicit time window).
- Both are advisory and explainable, with no scores.

### V1.13 — Administration

Under **Catalog**, add:

- alias management per item;
- a read-only view of the shipped knowledge base (what hints exist and why);
- classification coverage (how many items are Unclassified, how many were classified from a suggestion);
- the Workers AI setting from V1.11 with honest status: enabled or disabled, today's call count against the daily cap, and whether the circuit breaker is open. Show it only where the data is real; never fabricate provider health.

Not included: a rule-authoring screen. Editable organization-specific knowledge-base entries stored in D1 are added only if V1.13 shows a concrete need that aliases plus knowledge-base updates through pull requests cannot meet. That decision is recorded in the V1.13 release record.

### V1.14 — Offline & performance (clarification only)

- No new scope. V1.14's existing offline matrix and performance budgets include the suggestion engine and the knowledge-base bundle size.
- Its existing failure-isolation work (scope 16) and Cloudflare resource model (scope 9) include the V1.11 Workers AI path: timeouts, errors, exhausted quota and a disabled setting must leave cataloguing unaffected, and AI usage is modelled against the current Workers AI allowance.
- Nothing from this amendment adds a service, binding or feature to V1.14.

### V1.15 — Consolidation

Verify:

- one term per concept across all surfaces, matching §4;
- obsolete technical labels removed;
- contextual help used selectively, through the one shared component;
- suggestions and classification fully work with no network;
- every critical workflow works with the Workers AI setting off, and with it on while the provider fails;
- the privacy boundary for AI payloads (§13) is documented and matches the code;
- no percentage or opaque score appears anywhere;
- realistic journeys feel simpler despite the added internal intelligence.

V1.15 adds no intelligence features.

## 12. Data and authority constraints

- D1 remains structured operational truth; R2 remains governed media/evidence storage.
- Inventory quantity remains movement-derived from the ledger.
- Suggestions are advisory and are never saved without a person's action.
- Knowledge-base changes go through repository review; alias and item changes go through the audited item paths.
- No caches, vector indexes or new bindings (KV, Vectorize, queues) are introduced for this feature family. The single exception is the Workers AI binding in V1.11 (§13); any counter or breaker state it needs lives in D1.
- The public repository never contains private catalog exports, private evidence or provider credentials. Evaluation results are aggregates only (§9).

## 13. Optional Workers AI second opinion (V1.11)

Earl's decision (§17.3): Cloudflare Workers AI is allowed in V1.11, inside its existing optional-AI scope item 9, as a classification second opinion. It is not allowed in V1.14 or V1.15, and no other external or paid model is allowed.

### 13.1 When it runs

- Only when the Administration setting is on. It ships off.
- Only when the device is online. Offline Catalog PWA work never waits for it or queues calls for it.
- Only for fields whose built-in result is Weak, Conflicting or None (§8.1). Never when the built-in result is Strong, and never for a field a person has already confirmed.
- Asynchronously, after the name is entered, never per keystroke. Capture, save and next never wait for it. If the answer arrives after the person has moved on, it is discarded.
- Through a staff-authenticated Worker endpoint, limited to the roles that can catalogue. No public route calls it.

### 13.2 What it may receive

- **Allowlist:** the typed item name, its aliases, and the live category, unit and behaviour option lists. Nothing else.
- **Never:** photos, location images, transaction evidence, identities, Staff Directory or ID data, notes, or anything linked to a person.
- The allowlist is enforced in code by a single payload builder, with a test that fails if any other field reaches it.

### 13.3 What it may do

- Its answer becomes one more evidence item, at most Weak (§8.1), labelled "AI suggestion".
- It never saves anything, never changes a confirmed field, and never resolves a conflict.
- A response that names a value outside the live option lists is discarded.

### 13.4 Failure isolation and quota

- A short timeout. A timeout, error, unparseable answer, exhausted quota or unavailable provider means no AI suggestion and normal built-in behaviour, with no slowdown of any core action.
- A daily call cap set well inside the current free Workers AI allowance, using V1.14's operating bands (green at or below roughly 20%). Verify the current allowance and model catalog from official Cloudflare documentation at implementation time and record the source date.
- A circuit breaker: after repeated failures or on reaching the cap, stop calling until the next period. Cap and breaker state live in D1; no KV or other new binding.
- Pick the model at implementation time from the current catalog. The choice and its measured effect go in the V1.11 release record.

### 13.5 Privacy and logging

- Record what the Worker logs about AI calls. Default: counts and outcomes only, never the payload or the response text.
- Check and record Cloudflare's current data-handling terms for Workers AI at implementation time.

### 13.6 Evidence required in the V1.11 release record

- Measurement (§9) on fixture data: built-in result vs built-in plus AI, per tier.
- Tests showing that with the setting off, and with it on while the provider fails, every critical workflow is unchanged: catalog CRUD, quantities, loans, transactions, search, review, offline operation and classification.
- The payload allowlist test.

If the measurement shows no useful improvement, V1.11 records that, and the setting stays off by default.

## 14. Performance and cost guardrails

- Suggestions run on the device over the already-cached catalog. No server call per keystroke.
- Candidate sets stay bounded (the existing 5-voter limit, a bounded keyword match).
- The knowledge base has a size budget set in V1.8 and verified in V1.14.
- Insight queries (V1.12) stay off the critical navigation path.
- Workers AI calls are bounded by §13: never per keystroke, never for Strong results, capped daily, and stopped by the circuit breaker.
- Any new asset needs a measured reason and a rollback path.

## 15. Out of scope

Unless separately amended:

- any external or paid AI (OpenAI, Gemini, Claude) in Road-to-V2, and any Workers AI use other than the V1.11 classification second opinion (§13);
- embeddings, vector databases, Vectorize, KV or new bindings for this feature family (the Workers AI binding in V1.11 is the only exception);
- image recognition or classification from photos (V1.5 image hashes remain duplicate-detection only);
- background re-classification or second-guessing of confirmed items;
- confidence percentages or opaque scores;
- automatic promotion of patterns into rules;
- a rule-authoring UI;
- AI-controlled inventory mutations, autonomous procurement or autonomous staff decisions;
- facial recognition, per-item QR rollout, a generic chatbot/agent or a natural-language command framework;
- external search infrastructure;
- a V1.16 or a new feature family presented as "intelligence".

## 16. Acceptance and propagation procedure

Procedure, now that Earl has accepted it:

1. *(Done 2026-10-04.)* Create the accepted amendment under `docs/specs/accepted/road-to-v2/` on `main`, following the 2026-10-02 precedent, and mark revision 1 as superseded.
2. On `road-to-v2/v1.6-catalog-pwa` (the earliest affected branch), merge `main`, add one line to the shared `CLAUDE.md` Product rule pointing to the accepted amendment, and add the V1.6 item from §11 to the V1.6 spec. Propagate forward.
3. In version order, add each slice's §11 item to that branch's accepted spec only. Do not copy the whole amendment into each spec. Propagate forward after each.
4. Follow the existing Road-to-V2 merge rules: no rebase, force-push or reset, and never update an earlier branch from a later one.
5. Each commit and push in steps 1–3 needs Earl's authorization, under the single-writer rule.
6. Record rejected and deferred portions (§18) in the accepted amendment.

## 17. Owner decisions (Earl, 2026-10-04)

1. **Vocabulary (§4): yes.** The staff classification label "Consume" becomes **Take**, and the movement label "Consumed or used" becomes **Taken or used**, so staff and public use one verb. Lands in V1.8.
2. **Timing of the minimization work: within the slices.** V1.9 applies it to the screens it rebuilds and ships the contextual-help component; V1.15 does the product-wide sweep. No independent main-only update.
3. **External AI: allowed inside V1.11.** An optional Workers AI classification second opinion under V1.11's existing scope item 9, off by default, under every condition in §13. Not in V1.14 or V1.15.

## 18. Rejected and deferred from revision 1

| Revision 1 item | Outcome | Reason |
|---|---|---|
| "Typical Consumable Types Database" as a D1 table mixing packaging, material and product | **Changed** to a repository data file with separate packaging/product hints (§6) | Avoids D1 reads and an admin screen; fixes the sachet-vs-bottle problem. |
| Separate "verified human decisions" and "verified catalog knowledge" layers | **Merged** (§5) | A confirmed item is a human decision. |
| Item vs contents as a modelled distinction | **Changed** to two linked records (§7) | No new column; reuses V1.8/V1.11. |
| V1.6 "offline intelligence foundation" | **Narrowed** (§11) | V1.6 excludes new cataloguing features; the knowledge base arrives in V1.8. |
| V1.7 audit outcomes as classification evidence | **Narrowed** to the existing review-needed state (§11) | Keeps V1.7 on counts and locations. |
| V1.9 "Semantic Minimization HOTFIX" | **Re-allocated** to V1.9 surfaces and V1.15 (§17.2) | V1.9 is a full rebuild; the staff-wide sweep is already V1.15 scope. |
| "Intelligence Review" surface and card | **Changed** to the item edit view plus Attention (§11) | No parallel review system. |
| Confidence shown as a percentage (96%) | **Rejected** (§8.1) | Uncalibrated; conflicts with V1.12's ban on opaque scores. |
| Automatic promotion of patterns into rules | **Rejected** for Road-to-V2 (§8.2) | Promotion is a deliberate alias or knowledge-base edit. |
| Local embeddings / ML (V1.11) | **Deferred** (§9, §15) | No measured need; conflicts with V1.14 budgets. |
| V1.13 rules/policies administration | **Narrowed** (§11) | No rule-authoring UI. |
| Cloudflare Workers AI in V1.14 | **Moved** to V1.11 as an off-by-default classification second opinion (§13, §17.3) | V1.14 and V1.15 forbid new features; V1.11 already allows optional AI assistance. |
| "Photographs an unfamiliar item" in the end state | **Rejected** (§15) | Nothing deterministic classifies from a photo. |
| "If Cloudflare disappears tomorrow" | **Reworded** (§19) | The whole application runs on Cloudflare; the real guarantee is that everything works with Workers AI disabled or failing. |

## 19. Desired end state

By V2.0:

A staff member types an unfamiliar item name in Rapid Catalogue, online or offline.

The system quietly checks:

- whether the name or an alias matches something already confirmed;
- what similar confirmed items are;
- what the built-in knowledge base says about the packaging and product words;
- what relationships suggest;
- only if the built-in evidence is weak, the device is online and an administrator has switched it on: a Workers AI second opinion, labelled as such.

The person sees only what helps them decide:

> **Take** · *Like “Shampoo sachet” and 3 more*

If the evidence conflicts, both options are shown with their reasons. If there is none, the item can be saved as **Not sure / Review later**, and it appears in Attention until someone classifies it.

Whatever the person confirms becomes evidence for the next item. No number pretends to be a probability. If Workers AI is switched off, out of quota or down, nothing changes except that its suggestion is absent.

> **Smarter underneath, simpler on top, and never dependent on AI.**

## Appendix A — Changes from revision 1

1. Added §2 Baseline: existing behaviour model, aliases, suggestion engine, keyword table and audit log.
2. Added §4 Vocabulary table and the related owner decision.
3. Rewrote the authority hierarchy into §5 Evidence order: four layers, separate handling of capture-time and background conflicts, no background second-guessing.
4. Restructured the knowledge base (§6): hints instead of types, packaging separated from product, stored as a repository data file seeded from local vocabulary.
5. Replaced item-vs-contents modelling with two linked records (§7).
6. Replaced confidence percentages with strength tiers and reasons (§8.1); simplified feedback (§8.2).
7. Added leave-one-out measurement as the gate for any heavier layer (§9).
8. Clarified Rule G (transaction time only) and added contextual-help accessibility requirements (§10).
9. Re-allocated slice work to fit each accepted spec's scope and exclusions (§11); V1.7 and V1.14 receive clarifications only.
10. Moved the Workers AI second opinion from V1.14 to V1.11's existing optional-AI scope: off by default, never more than Weak, enforced payload allowlist, daily cap, circuit breaker in D1, and required evidence (§13).
11. Made the propagation procedure explicit about branches and authorization (§16); recorded Earl's decisions (§17) and the rejected/deferred record (§18).
