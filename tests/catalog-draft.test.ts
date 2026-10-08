import { describe, expect, it } from "vitest";
import { DRAFT_FIELDS, type DraftInput, composeDraft, isStale, needsAttention } from "../src/catalog-draft";
import { type Known, suggest } from "../src/catalogue-suggest";

/* Final Pass FP-B: the draft contract. Every Add items field has a source and a state; a person's entry always wins; a photo never proves a quantity. */

const item = (fields: Partial<Known> & { name: string }): Known => ({ category: "OFFICE EQUIPMENT AND SUPPLIES", itemType: "Loanable", consumptionMode: "WHOLE_UNIT", unit: "piece", stockArea: "Inventory", status: "ACTIVE", ...fields });
const staplers = ["Stapler", "Heavy duty stapler", "Mini stapler", "Stapler, desk", "Red stapler"].map((name) => item({ name }));
const input = (over: Partial<DraftInput> = {}): DraftInput => ({ revision: 1, typed: {}, edited: new Set(), suggestions: {}, photo: null, session: {}, defaultQuantity: 1, ...over });

describe("the catalogue draft", () => {
  it("gives every field a state, and unknown where nothing defensible exists", () => {
    const draft = composeDraft(input());
    for (const field of DRAFT_FIELDS) expect(draft[field].state, field).toBeTruthy();
    expect(draft.name.state).toBe("unknown");
    expect(draft.serial).toMatchObject({ value: null, state: "unknown", source: null });
    expect(draft.expiry.value).toBeNull();
    expect(draft.reorder.value).toBeNull();
    expect(draft.description.value).toBeNull();
  });

  it("never claims a photo proves the quantity: the starting 1 is a default to confirm", () => {
    const draft = composeDraft(input({ photo: { name: "Stapler" } }));
    expect(draft.quantity).toMatchObject({ value: 1, source: "DEFAULT", state: "needs-confirmation" });
    expect(composeDraft(input({ typed: { quantity: "12" }, edited: new Set(["quantity"]) })).quantity).toMatchObject({ value: 12, source: "USER", state: "verified" });
  });

  it("takes the place from the session, never from the picture", () => {
    expect(composeDraft(input()).place.state).toBe("unknown");
    expect(composeDraft(input({ session: { place: "loc-1", placeName: "Storeroom A" } })).place).toMatchObject({ value: "loc-1", source: "SESSION", state: "verified" });
  });

  it("suggests the photo's name, and the person's typing wins, even a cleared name", () => {
    expect(composeDraft(input({ photo: { name: "Stapler" } })).name).toMatchObject({ value: "Stapler", source: "OBSERVED_PHOTO", state: "suggested" });
    const typed = composeDraft(input({ photo: { name: "Stapler" }, typed: { name: "Desk stapler" }, edited: new Set(["name"]) }));
    expect(typed.name).toMatchObject({ value: "Desk stapler", source: "USER", wasUserEdited: true });
    const cleared = composeDraft(input({ photo: { name: "Stapler" }, typed: { name: "" }, edited: new Set(["name"]) }));
    expect(cleared.name).toMatchObject({ value: null, source: "USER", state: "unknown", wasUserEdited: true });
  });

  it("turns strong confirmed-item evidence into suggestions and weak or split evidence into confirmations", () => {
    const strong = composeDraft(input({ suggestions: suggest("Stapler", staplers, []) }));
    expect(strong.category).toMatchObject({ value: "OFFICE EQUIPMENT AND SUPPLIES", source: "VERIFIED_CATALOG", state: "suggested" });
    const weak = composeDraft(input({ suggestions: suggest("Heavy stapler", [staplers[0]!], []) }));
    expect(weak.category.state).toBe("needs-confirmation");
    const split = composeDraft(input({ suggestions: { category: { value: "A", why: "Like “x”", tier: "CONFLICTING", basis: "CATALOG", other: { value: "B", why: "Like “y”" } } } }));
    expect(split.category).toMatchObject({ value: null, state: "needs-confirmation", other: { value: "B" } });
  });

  it("labels knowledge-base and session evidence as such", () => {
    const knowledge = composeDraft(input({ suggestions: suggest("Shampoo sachets", [], []) }));
    expect(knowledge.unit).toMatchObject({ value: "sachet", source: "KNOWLEDGE", state: "needs-confirmation" });
    const session = composeDraft(input({ suggestions: suggest("Odd thing", [], [item({ name: "Last thing" })]) }));
    expect(session.category.source).toBe("SESSION");
  });

  it("shows brand and model only when the photo read them, and always for checking", () => {
    const read = composeDraft(input({ photo: { name: "Stapler", brand: "Max", model: "HD-10" } }));
    expect(read.brand).toMatchObject({ value: "Max", source: "OBSERVED_PHOTO", state: "needs-confirmation" });
    expect(composeDraft(input({ photo: { name: "Stapler", brand: "  ", model: "!!!" } })).brand.state).toBe("unknown");
    expect(composeDraft(input({ photo: { name: "Stapler", model: "!!!" } })).model.value).toBeNull();
  });

  it("lists what a person still has to look at", () => {
    const draft = composeDraft(input({ photo: { name: "Stapler" }, suggestions: suggest("Stapler", staplers, []) }));
    expect(needsAttention(draft)).toContain("quantity");
    expect(needsAttention(draft)).not.toContain("category");
    expect(needsAttention(composeDraft(input()))).toEqual(expect.arrayContaining(["name", "category", "behaviour", "unit", "quantity"]));
  });

  it("drops a result for an older revision", () => {
    expect(isStale(2, 3)).toBe(true);
    expect(isStale(3, 3)).toBe(false);
  });
});
