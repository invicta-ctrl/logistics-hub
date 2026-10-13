# Add items: Category and Counted in from a confident catalogue match (2026-10-13)

Follow-up to the V1.15 Final Pass, requested by Earl. No version number is minted (V1.16 is unreleased; `docs/PRODUCT_VERSION_GOVERNANCE.md`). No migration, no new provider call, no AI: the match is the built-in deterministic look-alike vote in `src/catalogue-suggest.ts`.

## What changed

- **Category** and **Counted in** are written into the field when the match is confident, and each says where it came from underneath: "From the catalogue: Like “X” and N more. Change it if that is wrong."
- Confident means `confidentMatch` in `src/catalogue-suggest.ts`: the typed name is exactly a reviewed item's name or other name, or all five look-alikes agree. Four of five, the knowledge base, and the "same as your last item" hint stay buttons.
- A person's entry always wins. A keystroke or a tap on a chip or "Use these" makes the field theirs (even if they empty it); a field that already holds anything we did not write is never changed; a saved draft reopened for editing is theirs. When the name changes and the match goes, only what the catalogue wrote is taken back.
- The same ownership rule as the Model field (`modelEdited` / `modelFromPhoto`). A field the catalogue wrote is not offered again in the "Suggested: … Use these" line.

## Why this gate

Leave-one-out on the repository's public seed catalog, 253 reviewed items, built-in suggestions only (`npm run evaluate:suggestions`; the seed loader now marks a typed row as reviewed because every imported row is still flagged `needs_review`, which the stricter `verified` rule of V1.16 otherwise excludes, leaving zero items):

| Evidence | Category | Counted in |
|---|---|---|
| All five look-alikes agree (5 of 5) | 75 items, right 97% | 48 items, right 100% |
| Exact reviewed name or other name | 2 items, right 100% (too few to quote) | 2 items, right 100% |
| Four of five agree | 14 items, right 71% | 20 items, right 85% |
| Four of four (fewer than five exist) | 15 items, right 93% | 8 items, right 88% |
| Knowledge base only | 7 items, right 57% | 6 items, right 50% |

Written into an empty field with the gate above: category 77 of 253 items (30%), right 97%; unit 50 of 253 (20%), right 100%. With the knowledge base on: category 74 (29%), right 97%; unit 46 (18%), right 100%.

These are leave-one-out figures on the seed catalogue, where an item's real siblings are present. They say how often the gate is right when it speaks, not how often it will speak on a new shelf. On production, until more items are reviewed, it will speak less often, and the "Review later" and button paths are unchanged.

## Verification

- `npx tsc --noEmit`, full `npx vitest run` (816 passed), `tests/browser/catalogue.spec.ts` (70 passed, including two new specs for the prefill: source line, name change takes back only what was written, own entry wins, emptied field stays empty, saved values, reset).
- New unit tests for the gate in `tests/catalogue.test.ts`: exact, five of five, four of five, four voters only, knowledge and session hints.

## Not in this change

Brand. The `items` table has no `brand` column, so it needs a migration, its Production operations record and Earl's explicit approval to apply it before the code that writes it can merge. It is a separate pull request.
