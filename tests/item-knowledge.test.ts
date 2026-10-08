import { describe, expect, it } from "vitest";
import { type Known, STRONG_VOTES, suggest } from "../src/catalogue-suggest";
import { words } from "../src/duplicates";
import { ITEM_ICONS } from "../src/item-icons";
import { KNOWLEDGE, KNOWLEDGE_VERSION, knowledgeHints, matchingEntries } from "../src/item-knowledge";
import { evaluate, report } from "../src/suggest-evaluation";

/* V1.8 catalog intelligence: the built-in knowledge base, the strength tiers (no percentages) and the leave-one-out measurement. */

const item = (fields: Partial<Known> & { name: string }): Known => ({ category: "SCHOOL SUPPLIES", itemType: "Consumable", consumptionMode: "WHOLE_UNIT", unit: "piece", stockArea: "Inventory", status: "ACTIVE", ...fields });
const CATEGORIES = ["SCHOOL SUPPLIES", "CLEANING SUPPLIES & EQUIPMENT", "MEDICAL SUPPLIES", "PANTRY"];

describe("the knowledge base", () => {
  it("is versioned, keyed once, and every entry says why it is offered", () => {
    expect(KNOWLEDGE_VERSION).toBeGreaterThanOrEqual(1);
    expect(new Set(KNOWLEDGE.map((entry) => entry.key)).size).toBe(KNOWLEDGE.length);
    for (const entry of KNOWLEDGE) {
      expect(entry.note.length, entry.key).toBeGreaterThan(5);
      expect(entry.keywords.length, entry.key).toBeGreaterThan(0);
      expect(entry.behaviour || entry.unit || entry.category, `${entry.key} has an opinion`).toBeTruthy();
    }
  });

  it("carries no icon and never duplicates an item-icons.ts entry: one list per question", () => {
    // Words may be shared (a "ribbon" has a picture and a category); a whole keyword list may not be.
    const icons = ITEM_ICONS.map((icon) => new Set(icon.keywords.map((keyword) => words(keyword).join(" "))));
    for (const entry of KNOWLEDGE) {
      const mine = entry.keywords.map((keyword) => words(keyword).join(" "));
      expect(icons.some((theirs) => mine.length >= theirs.size && mine.every((word) => theirs.has(word))), `${entry.key} repeats an icon's whole list`).toBe(false);
    }
    expect(KNOWLEDGE.some((entry) => "icon" in entry)).toBe(false);
  });

  it("matches the way the catalog reads names: plurals, other names, phrases, and nothing half-matched", () => {
    expect(matchingEntries("Shampoo sachets").map((entry) => entry.key)).toEqual(["sachet"]);
    expect(matchingEntries("Printer paper", "bond ream").map((entry) => entry.key)).toContain("ream");
    expect(matchingEntries("Poster Colors set").map((entry) => entry.key)).toContain("paint");
    expect(matchingEntries("Glassware").map((entry) => entry.key)).not.toContain("kitchenware");
    expect(matchingEntries("Gloves (nitrile)").map((entry) => entry.key)).toEqual(["gloves"]);
  });

  it("hints from packaging decide behaviour and unit; product words decide category, not behaviour", () => {
    expect(knowledgeHints("Conditioner sachet", CATEGORIES)).toMatchObject({ behaviour: { value: "CONSUME" }, unit: { value: "sachet", why: "Sachets are usually taken one at a time" } });
    expect(knowledgeHints("Bond paper ream", CATEGORIES)).toMatchObject({ behaviour: { value: "GRADUAL" }, unit: { value: "ream" } });
    expect(knowledgeHints("Acrylic paint", CATEGORIES)).toEqual({ category: { value: "SCHOOL SUPPLIES", why: "Art supplies" } });
    expect(knowledgeHints("Paper towel", CATEGORIES).behaviour).toBeUndefined();
  });

  it("entries that disagree on a field leave it without a hint, and a category the catalog lacks is never offered", () => {
    // "sachet" says sachet, "roll" says roll: no unit hint; behaviour still comes from the one entry that has an opinion.
    expect(knowledgeHints("Tape roll sachet", CATEGORIES)).toMatchObject({ behaviour: { value: "CONSUME" } });
    expect(knowledgeHints("Tape roll sachet", CATEGORIES).unit).toBeUndefined();
    expect(knowledgeHints("Acrylic paint", ["PANTRY"]).category).toBeUndefined();
  });
});

describe("strength tiers", () => {
  const confirmed = [
    item({ name: "Shampoo sachet", unit: "sachet", category: "CLEANING SUPPLIES & EQUIPMENT" }),
    item({ name: "Conditioner bottle", unit: "bottle", category: "CLEANING SUPPLIES & EQUIPMENT", consumptionMode: "OPEN_UNIT" })
  ];

  it("a knowledge-base hint alone is Weak, with its reason; nothing is saved or percent-scored", () => {
    const result = suggest("Batteries AA", [], []);
    expect(result.behaviour).toEqual({ value: "CONSUME", why: "Batteries are used up", tier: "WEAK", basis: "KNOWLEDGE" });
    expect(JSON.stringify(result)).not.toMatch(/%|percent|confidence/i);
  });

  it("look-alikes and the knowledge base disagreeing is Conflicting: both options, each with its reason", () => {
    const cats = [item({ name: "Detergent sachet liquid", category: "CLEANING SUPPLIES & EQUIPMENT", consumptionMode: "OPEN_UNIT", unit: "sachet" })];
    const result = suggest("Detergent sachet", cats, []);
    expect(result.behaviour).toMatchObject({ tier: "CONFLICTING", value: "GRADUAL", other: { value: "CONSUME", why: "Sachets are usually taken one at a time" } });
    expect(result.behaviour!.why).toMatch(/^Like “Detergent sachet liquid”/);
  });

  it("a tied vote is Conflicting too, and a lone look-alike is Weak", () => {
    const tied = [item({ name: "Glue stick", unit: "piece" }), item({ name: "Glue bottle", unit: "bottle" })];
    expect(suggest("Glue", tied, []).unit).toMatchObject({ tier: "CONFLICTING" });
    expect(suggest("Shampoo sachet jumbo", confirmed.slice(0, 1), [], { knowledge: false }).unit).toMatchObject({ tier: "WEAK", value: "sachet" });
  });

  it(`Strong needs an exact match, or ${STRONG_VOTES} agreeing look-alikes with nothing contradicting them`, () => {
    const many = Array.from({ length: 5 }, (_, index) => item({ name: `Whiteboard marker ${["black", "blue", "red", "green", "pink"][index]}`, category: "SCHOOL SUPPLIES" }));
    expect(suggest("whiteboard marker", many, []).category).toMatchObject({ tier: "STRONG", value: "SCHOOL SUPPLIES" });
    expect(suggest("whiteboard marker", many.slice(0, 2), []).category).toMatchObject({ tier: "WEAK" });
    expect(suggest("Whiteboard marker black", many.slice(0, 2), []).category).toMatchObject({ tier: "STRONG" });
    // The same five look-alikes, but the knowledge base says otherwise for this field: not Strong.
    const others = many.map((each) => ({ ...each, category: "OTHERS" }));
    expect(suggest("whiteboard marker", [...others, item({ name: "Sticker sheet", category: "SCHOOL SUPPLIES" })], [], { knowledge: true }).category?.tier).not.toBe("STRONG");
  });

  it("the session's own repetition still comes last, as Weak", () => {
    expect(suggest("zebra", [], [item({ name: "A", category: "TOOLS" }), item({ name: "B", category: "TOOLS" })]).category).toEqual({ value: "TOOLS", why: "Same as your last two items", tier: "WEAK", basis: "SESSION" });
  });
});

describe("the leave-one-out measurement", () => {
  const catalog = [
    ...["black", "blue", "red", "green", "pink"].map((color) => item({ name: `Whiteboard marker ${color}` })),
    item({ name: "Bond paper A4", unit: "ream", consumptionMode: "OPEN_UNIT", category: "PAPER" }),
    item({ name: "Mystery", itemType: "NEEDS_REVIEW", category: "UNSORTED" })
  ];
  it("hides each confirmed item in turn, counts per tier, and never counts an unclassified record", () => {
    const result = evaluate(catalog, { knowledge: true });
    expect(result.items).toBe(6);
    for (const field of ["behaviour", "unit", "category"] as const) {
      const cells = Object.values(result.fields[field]);
      expect(cells.reduce((sum, cell) => sum + cell.n, 0)).toBe(6);
    }
    expect(result.fields.category.STRONG.n).toBeGreaterThan(0);
    expect(result.fields.category.STRONG.right).toBe(result.fields.category.STRONG.n);
    expect(report("Fixture", result)).toMatch(/Fixture: 6 confirmed items[\s\S]*behaviour: suggested for/);
  });
  it("shows what the knowledge base adds over the look-alike vote alone", () => {
    const lonely = [item({ name: "Detergent sachet", unit: "sachet" }), item({ name: "Detergent bar", unit: "piece" })];
    const without = evaluate(lonely, { knowledge: false });
    const withKb = evaluate(lonely, { knowledge: true });
    const offered = (e: typeof without) => e.items - e.fields.behaviour.NONE.n;
    expect(offered(withKb)).toBeGreaterThanOrEqual(offered(without));
  });
});
