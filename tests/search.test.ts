import { describe, expect, it } from "vitest";
import { type IndexItem, type SearchIndex, MAX_PER_KIND, SHORTCUTS, prepare, rankPeople, searchCatalog, searchShortcuts } from "../src/search";

/* V1.11 global search: the matching and ranking rules, over a small catalog built for each rule. */

let next = 0;
const item = (name: string, fields: Partial<IndexItem> = {}): IndexItem => ({
  id: `ITM-${String(++next).padStart(4, "0")}`, name, aliases: null, category: "SCHOOL SUPPLIES", itemType: "Consumable", status: "ACTIVE",
  placeId: null, iconKey: null, visualType: null, photoId: null, ...fields
});
const index = (over: Partial<SearchIndex>): SearchIndex => ({ items: [], places: [], kits: [], links: [], ...over });
const names = (hits: Array<{ item: IndexItem }>) => hits.map((hit) => hit.item.name);

describe("items", () => {
  it("puts the exact name first, then names that start with the words, then everything else", () => {
    const catalog = prepare(index({ items: [item("Glue Gun - small"), item("Super Glue"), item("Glue"), item("Glue Stick"), item("Gluten-free Biscuits", { category: "PANTRY" })] }));
    expect(names(searchCatalog(catalog, "glue").items)).toEqual(["Glue", "Glue Stick", "Glue Gun - small", "Super Glue"]);
    // A half-typed word matches the start of a longer one, so the list narrows as you type.
    expect(names(searchCatalog(catalog, "glu").items)).toEqual(["Glue", "Glue Stick", "Glue Gun - small", "Gluten-free Biscuits", "Super Glue"]);
  });

  it("needs every word, in any field, and says which field when the name does not", () => {
    const catalog = prepare(index({ items: [item("Whiteboard Marker - Blue"), item("Permanent Marker - Blue"), item("Highlighter", { aliases: "marker pen; text marker" })] }));
    expect(names(searchCatalog(catalog, "blue marker").items)).toEqual(["Permanent Marker - Blue", "Whiteboard Marker - Blue"]);
    const pen = searchCatalog(catalog, "marker pen").items;
    expect(pen).toMatchObject([{ item: { name: "Highlighter" }, why: { by: "alias", text: "marker pen" } }]);
    expect(searchCatalog(catalog, "blue marker").items.every((hit) => hit.why === null)).toBe(true);
  });

  it("finds by category and by the knowledge base's kind of thing, below any name match", () => {
    const catalog = prepare(index({ items: [item("Facemask", { category: "MEDICAL SUPPLIES" }), item("Gauze Pad - 4x4", { category: "MEDICAL SUPPLIES" }), item("Medical Tape", { category: "OFFICE" })] }));
    expect(searchCatalog(catalog, "face mask").items).toMatchObject([{ item: { name: "Facemask" }, why: { by: "kind", text: "Masks" } }]);
    expect(searchCatalog(catalog, "first aid").items).toMatchObject([{ item: { name: "Gauze Pad - 4x4" }, why: { by: "kind", text: "First-aid supplies" } }]);
    expect(names(searchCatalog(catalog, "medical").items)).toEqual(["Medical Tape", "Facemask", "Gauze Pad - 4x4"]);
    expect(searchCatalog(catalog, "medical").items[1]!.why).toEqual({ by: "category", text: "MEDICAL SUPPLIES" });
  });

  it("offers things of the same kind only when nothing matches the words themselves", () => {
    const ribbon = item("Ribbon - Red", { category: "PARTY NEEDS" });
    const rope = item("Abaca Rope");
    // "twine" is in no record, but twine is the same kind of thing as ribbon and rope.
    expect(names(searchCatalog(prepare(index({ items: [ribbon, rope] })), "twine").items)).toEqual(["Abaca Rope", "Ribbon - Red"]);
    expect(searchCatalog(prepare(index({ items: [ribbon, rope] })), "twine").items[0]!.why).toEqual({ by: "kind", text: "Ribbon and yarn" });
    // With a rope in the catalog, "rope" finds the rope and leaves the ribbons alone.
    expect(names(searchCatalog(prepare(index({ items: [ribbon, rope] })), "rope").items)).toEqual(["Abaca Rope"]);
    // A key that is also one of its own things never names the whole kind: "glue" is not "Art and school supplies".
    expect(names(searchCatalog(prepare(index({ items: [item("Chalk - White"), item("Glue Stick")] })), "glue").items)).toEqual(["Glue Stick"]);
  });

  it("finds what is kept in a place and every place inside it, and says where", () => {
    const places = [{ id: "LOC-1", name: "Cabinet 1", parentId: null, active: true }, { id: "LOC-2", name: "Shelf A", parentId: "LOC-1", active: true }, { id: "LOC-3", name: "Storage Room", parentId: null, active: true }];
    const catalog = prepare(index({ places, items: [item("Stapler", { placeId: "LOC-2" }), item("Puncher", { placeId: "LOC-3" }), item("Cabinet Key", { placeId: "LOC-3" })] }));
    const found = searchCatalog(catalog, "cabinet");
    expect(found.items).toMatchObject([{ item: { name: "Cabinet Key" }, why: null, place: "Storage Room" }, { item: { name: "Stapler" }, why: { by: "place", text: "Cabinet 1" }, place: "Cabinet 1 › Shelf A" }]);
    expect(found.places).toMatchObject([{ place: { name: "Cabinet 1" }, why: null, items: 1 }, { place: { name: "Shelf A" }, why: { by: "within", text: "Cabinet 1" }, parent: "Cabinet 1" }]);
    expect(names(searchCatalog(catalog, "stapler cabinet").items)).toEqual(["Stapler"]);
  });

  it("finds a kit by its name or place, and by what is in it", () => {
    const needle = item("Needles (pack)");
    const thread = item("Threads");
    const catalog = prepare(index({ items: [needle, thread, item("Sewing Machine")], kits: [{ id: "KIT-0001", name: "Sewing Kit", placeId: null, active: true, items: [needle.id, thread.id] }, { id: "KIT-0002", name: "Old Sewing Box", placeId: null, active: false, items: [] }] }));
    const sewing = searchCatalog(catalog, "sewing");
    expect(sewing.kits.map((hit) => hit.kit.name)).toEqual(["Sewing Kit", "Old Sewing Box"]);
    // The kit's own items come up too, saying which kit they are in.
    expect(sewing.items).toMatchObject([{ item: { name: "Sewing Machine" }, why: null }, { item: { name: "Needles (pack)" }, why: { by: "kit", text: "Sewing Kit" } }, { item: { name: "Threads" }, why: { by: "kit", text: "Sewing Kit" } }]);
    expect(searchCatalog(catalog, "needles").kits).toMatchObject([{ kit: { name: "Sewing Kit" }, why: { by: "includes", text: "Needles (pack)" } }]);
  });

  it("follows a strong match's links one hop, read from the other end, and never a weak match's", () => {
    const gun = item("Glue Gun");
    const sticks = item("Glue Sticks - refill");
    const old = item("Hot Melt Applicator", { status: "INACTIVE" });
    const cylinder = item("LPG Cylinder");
    const lpg = item("LPG Refill");
    const stove = item("Camping Stove", { category: "KITCHEN" });
    const catalog = prepare(index({
      items: [gun, sticks, old, cylinder, lpg, stove],
      links: [{ from: gun.id, to: sticks.id, kind: "USED_WITH" }, { from: old.id, to: gun.id, kind: "REPLACEMENT" }, { from: cylinder.id, to: lpg.id, kind: "CONTENTS" }, { from: stove.id, to: cylinder.id, kind: "USED_WITH" }]
    }));
    // Read from the found item's own side: the sticks are "Used with Glue Gun", the old applicator is "Replaced by Glue Gun".
    expect(searchCatalog(catalog, "glue gun").items).toMatchObject([
      { item: { name: "Glue Gun" }, why: null },
      { item: { name: "Glue Sticks - refill" }, why: { by: "link", kind: "USED_WITH", side: "to", text: "Glue Gun" } },
      { item: { name: "Hot Melt Applicator" }, why: { by: "link", kind: "REPLACEMENT", side: "from", text: "Glue Gun" } }
    ]);
    expect(searchCatalog(catalog, "gun").items.map((hit) => [hit.item.name, hit.why?.by ?? null])).toEqual([["Glue Gun", null], ["Glue Sticks - refill", "link"], ["Hot Melt Applicator", "link"]]);
    // "LPG Refill goes in LPG Cylinder": searching the refill finds its container, saying so from the container's side.
    expect(searchCatalog(catalog, "lpg refill").items).toMatchObject([{ item: { name: "LPG Refill" } }, { item: { name: "LPG Cylinder" }, why: { by: "link", kind: "CONTENTS", side: "from" } }]);
    // One hop only: the stove is linked to the cylinder, not to the refill.
    expect(names(searchCatalog(catalog, "lpg refill").items)).not.toContain("Camping Stove");
    // A category match is not what was clearly meant, so its links are not followed.
    expect(names(searchCatalog(catalog, "kitchen").items)).toEqual(["Camping Stove"]);
  });

  it("opens a record by its ID, typed or scanned however it was written", () => {
    const catalog = prepare(index({ items: Array.from({ length: 30 }, (_, n) => item(`Paper ${n}`)), places: [{ id: "LOC-ABC12", name: "Room", parentId: null, active: true }] }));
    const target = catalog.index.items[11]!;
    expect(searchCatalog(catalog, target.id).items[0]!.item.id).toBe(target.id);
    expect(searchCatalog(catalog, target.id.toLowerCase().replace("-", "")).items[0]!.item.id).toBe(target.id);
    expect(searchCatalog(catalog, "loc-abc12").places[0]!.place.id).toBe("LOC-ABC12");
  });

  it("keeps inactive records, below the active ones", () => {
    const catalog = prepare(index({ items: [item("Stapler - old", { status: "INACTIVE" }), item("Stapler - heavy duty")] }));
    expect(names(searchCatalog(catalog, "stapler").items)).toEqual(["Stapler - heavy duty", "Stapler - old"]);
  });

  it("needs two characters, and caps each kind", () => {
    const catalog = prepare(index({ items: Array.from({ length: 120 }, (_, n) => item(`Crepe Paper ${n}`)) }));
    expect(searchCatalog(catalog, "c").items).toEqual([]);
    expect(searchCatalog(catalog, "   ").items).toEqual([]);
    expect(searchCatalog(catalog, "cr").items).toHaveLength(MAX_PER_KIND);
    // Ties break by name, numbers in order, so the same query always lists the same way.
    expect(names(searchCatalog(catalog, "crepe paper").items).slice(0, 3)).toEqual(["Crepe Paper 0", "Crepe Paper 1", "Crepe Paper 2"]);
  });

  it("copes with long names, accents and punctuation", () => {
    const long = "Heavy-Duty Industrial Extension Cord Reel with Four Grounded Outlets and Circuit Breaker - 50 metres (Orange)";
    const catalog = prepare(index({ items: [item(long), item("Piñata - Large"), item("Scissors (Kids')")] }))
    expect(names(searchCatalog(catalog, "extension cord").items)).toEqual([long]);
    expect(names(searchCatalog(catalog, "pinata").items)).toEqual(["Piñata - Large"]);
    expect(names(searchCatalog(catalog, "kids scissors").items)).toEqual(["Scissors (Kids')"]);
  });
});

describe("people", () => {
  const row = (name: string, fields: Partial<Parameters<typeof rankPeople>[0][number]> = {}) => ({ id: `PER-${name}`, name, department: "DoL", departmentName: "Department of Logistics", position: null, officer: false, active: true, ...fields });
  it("ranks by name first, then position, then department", () => {
    const rows = [row("Ana Reyes", { position: "Logistics Head" }), row("Logan Cruz"), row("Ben Uy", { department: "DoF", departmentName: "Department of Finance" })];
    expect(rankPeople(rows, "log").people.map((hit) => hit.name)).toEqual(["Logan Cruz", "Ana Reyes"]);
    expect(rankPeople(rows, "finance").people).toMatchObject([{ name: "Ben Uy", why: { by: "department", text: "Department of Finance" } }]);
    expect(rankPeople(rows, "head").people).toMatchObject([{ name: "Ana Reyes", why: { by: "position", text: "Logistics Head" } }]);
  });
});

describe("go to", () => {
  const ids = (query: string, admin = false) => searchShortcuts(query, admin).map((hit) => hit.shortcut.id);
  it("opens the existing filter for a few fixed words, and nothing else is parsed", () => {
    expect(ids("overdue")[0]).toBe("overdue");
    expect(ids("late returns")[0]).toBe("overdue");
    expect(searchShortcuts("overdue", false)[0]!.shortcut.href).toBe("/staff/attention?source=Loans&urgency=NOW");
    expect(ids("low stock")[0]).toBe("low");
    expect(ids("out of")[0]).toBe("out");
    expect(ids("show me everything overdue from last week")).toEqual([]);
  });

  it("opens a loan by its reference", () => {
    expect(searchShortcuts("ln-2026-0042", false)).toMatchObject([{ shortcut: { title: "Loan LN-2026-0042", href: "/staff/loans?loan=LN-2026-0042" } }]);
  });

  it("shows Administration only to administrators, and a short list before typing", () => {
    expect(ids("directory")).toEqual([]);
    expect(ids("directory", true)).toEqual(["directory"]);
    expect(ids("admin")).toEqual([]);
    expect(ids("")).toEqual(SHORTCUTS.filter((each) => each.start && !each.admin).map((each) => each.id));
    expect(ids("", true)).toEqual(SHORTCUTS.filter((each) => each.start).map((each) => each.id));
  });

  it("only ever navigates to a Hub page", () => {
    for (const shortcut of SHORTCUTS) expect(shortcut.href, shortcut.id).toMatch(/^\/staff\/[a-z/-]*(\?[A-Za-z]+=[A-Za-z_]+(&[A-Za-z]+=[A-Za-z_]+)*)?$/);
  });
});
