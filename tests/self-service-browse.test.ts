import { describe, expect, it } from "vitest";
import { foldReference, selfServiceReference } from "../src/catalog-policy";
import type { CatalogItem, LocalEvent } from "../src/offline-queue";
import { behaviourLine, conciseLocation, frequentItems, groupOf, grouped, matching } from "../src/self-service-browse";

const item = (id: string, name: string, extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ id, name, aliases: null, category: "SUPPLIES", unit: "piece", action: "TAKE", available: 5, location: null, audience: null, area: "Inventory", ...extra });
const event = (itemId: string, seq: number, type: LocalEvent["type"] = "TAKE", state: LocalEvent["state"] = "synced"): LocalEvent =>
  ({ v: 1, id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, seq, type, itemId, quantity: 1, occurredAt: "2026-10-05T01:00:00.000Z", catalogRevision: 1, person: { name: "Ana" }, state, attempts: 0, nextAttemptAt: 0, hasPhoto: false, itemName: itemId, unit: "piece" });

describe("human references", () => {
  it("is the same short code every time for one record, in the shape SS-XXXX-XXXX", () => {
    const id = "3f6c2a9e-1b7d-4c3a-9d2e-5a8b7c6d4e10";
    expect(selfServiceReference(id)).toBe(selfServiceReference(id));
    expect(selfServiceReference(id)).toMatch(/^SS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("differs between records, and never uses a letter people mistake for a digit", () => {
    const references = new Set(Array.from({ length: 5000 }, () => selfServiceReference(crypto.randomUUID())));
    expect(references.size).toBe(5000);
    for (const reference of references) expect(reference.slice(3)).not.toMatch(/[ILOU]/);
  });

  it("reads back from anything a person might type: case, spaces, missing dash, look-alike letters", () => {
    const reference = selfServiceReference("3f6c2a9e-1b7d-4c3a-9d2e-5a8b7c6d4e10");
    const typed = [reference, reference.toLowerCase(), reference.replace("-", " "), reference.replaceAll("-", ""), ` ${reference.toLowerCase()} `];
    for (const text of typed) expect(foldReference(text)).toBe(foldReference(reference));
    expect(foldReference("SS-O1L0")).toBe(foldReference("ss 0110"));
  });
});

describe("groups", () => {
  const catalog = [
    item("a", "Folding table", { action: "BORROW" }), item("b", "Stapler", { action: "BORROW" }),
    item("c", "Bottled water", { area: "Pantry" }), item("d", "Printer paper", { action: "USE" }), item("e", "Coffee", { area: "Pantry", action: "TAKE" }),
    item("f", "Older snapshot item", { area: undefined })
  ];

  it("puts lent things in Equipment, pantry food in Pantry and everything else in Supplies", () => {
    expect(catalog.map(groupOf)).toEqual(["equipment", "equipment", "pantry", "supplies", "pantry", "supplies"]);
    expect(grouped(catalog).map((group) => [group.name, group.items.length])).toEqual([["Equipment", 2], ["Supplies", 2], ["Pantry", 2]]);
  });

  it("leaves out a group nobody offers anything from, so a phone never shows an empty shelf", () => {
    expect(grouped([item("a", "Folding table", { action: "BORROW" })]).map((group) => group.id)).toEqual(["equipment"]);
    expect(grouped([])).toEqual([]);
  });
});

describe("frequently used", () => {
  const catalog = [item("a", "A"), item("b", "B"), item("c", "C"), item("d", "D"), item("e", "E")];

  it("ranks by how often this phone used an item, then how recently, and counts no return as use", () => {
    const events = [event("a", 1), event("b", 2), event("b", 3), event("c", 4), event("c", 5, "RETURN"), event("a", 6)];
    expect(frequentItems(events, catalog).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("ignores records that were not recorded and items no longer offered, and stops at the limit", () => {
    const events = [event("a", 1, "TAKE", "rejected"), event("gone", 2), ...catalog.map((entry, index) => event(entry.id, 3 + index))];
    expect(frequentItems(events, catalog, 2).map((entry) => entry.id)).toEqual(["e", "d"]);
    expect(frequentItems([], catalog)).toEqual([]);
  });
});

describe("what a card says", () => {
  it("shows the last two steps of a place, the part a person walking in needs", () => {
    expect(conciseLocation("Office › Storage room › Shelf B")).toBe("Storage room › Shelf B");
    expect(conciseLocation("Pantry")).toBe("Pantry");
    expect(conciseLocation(null)).toBeNull();
  });

  it("explains each kind of item in one plain sentence, and says so when it is for USC use only", () => {
    expect(behaviourLine("BORROW", "STUDENTS_AND_USC_STAFF")).toContain("bring it back");
    expect(behaviourLine("BORROW", "USC_STAFF_ONLY")).toContain("USC use only");
    expect(behaviourLine("TAKE", null)).toContain("nothing to return");
    expect(behaviourLine("USE", null)).toContain("Just say you used some");
  });
});

describe("finding an item", () => {
  const catalog = [item("a", "Folding table", { aliases: "Mesa", location: "Office › Storage" }), item("b", "Bottled water")];

  it("matches the name, other names and place, needing every word typed", () => {
    expect(matching(catalog, "table").map((entry) => entry.id)).toEqual(["a"]);
    expect(matching(catalog, "mesa").map((entry) => entry.id)).toEqual(["a"]);
    expect(matching(catalog, "storage fold").map((entry) => entry.id)).toEqual(["a"]);
    expect(matching(catalog, "table water")).toEqual([]);
  });

  it("ignores accents and case, and does not match on the category", () => {
    expect(matching([item("c", "Café filter")], "CAFE").length).toBe(1);
    expect(matching(catalog, "supplies")).toEqual([]);
  });
});
