# Add items: Category and Counted in from a confident catalogue match (2026-10-13)

Follow-up to the V1.15 Final Pass, requested by Earl. No version number is minted (V1.16 is unreleased; `docs/PRODUCT_VERSION_GOVERNANCE.md`). No migration, no new provider call, no AI: the match is the built-in deterministic look-alike vote in `src/catalogue-suggest.ts`.

## What changed

- **Category** and **Counted in** are written into the field when the match is confident, and each says where it came from underneath: "From the catalogue: Like “X” and N more. Change it if that is wrong."
- Confident means `confidentMatch` in `src/catalogue-suggest.ts`: the typed name is exactly a reviewed item's name or other name, or all five look-alikes agree. Four of five, the knowledge base, and the "same as your last item" hint stay buttons.
- A person's entry always wins. A keystroke or a tap on a chip or "Use these" makes the field theirs (even if they empty it); a field that already holds anything we did not write is never changed; a saved draft reopened for editing is theirs. When the name changes and the match goes, only what the catalogue wrote is taken back.
- The same ownership rule as the Model field (`modelEdited` / `modelFromPhoto`). A field the catalogue wrote is not offered again in the "Suggested: … Use these" line.

## Why this gate, and what is not yet measured

The gate is deliberately narrow: only reviewed items vote (`verified`: active, not flagged for review, valid category, unit and type), and it needs an exact name or all five look-alikes in agreement. Four of five agreeing, the knowledge base and the last-item hint stay buttons.

**Its accuracy on reviewed data has not been measured, and this note makes no accuracy claim.** The repository's migrated seed catalog carries `needs_review = 1` on every row, so `npm run evaluate:suggestions` correctly reports zero reviewed items there (`docs/road-to-v2/releases/v1.15-final-pass.md`). An earlier draft of this change treated the seed's classified rows as reviewed and quoted 97% (category) and 100% (unit) for the gate; that was a measurement of unreviewed legacy labels, it was wrong to present it as evidence, and it has been withdrawn along with the script change that produced it.

What would settle it: after real cataloguing has produced reviewed records, run `npm run evaluate:suggestions -- --from <private local export>` (never committed). The report now prints, per field, how often the gate would write into an empty field and how often it would be right. Until then the safeguards are structural: it speaks only from human-confirmed items, it says where the value came from, a person's own entry always wins, and one tap or keystroke changes it.

## Verification

- `npx tsc --noEmit`, full `npx vitest run` (816 passed), `tests/browser/catalogue.spec.ts` (70 passed, including two new specs for the prefill: source line, name change takes back only what was written, own entry wins, emptied field stays empty, saved values, reset).
- New unit tests for the gate in `tests/catalogue.test.ts`: exact, five of five, four of five, four voters only, knowledge and session hints.

## Not in this change

Brand. The `items` table has no `brand` column, so it needs a migration, its Production operations record and Earl's explicit approval to apply it before the code that writes it can merge. It is a separate pull request.
