import { describe, expect, it } from "vitest";
import { MAX_DEPTH, ancestry, cleanName, inOrder, levelsBelow, lookAlikes, pathOf, placesOf, withinPlace, type Place } from "../src/location-tree";

const place = (id: string, name: string, parentId: string | null = null, active = true): Place => ({ id, name, parentId, active });
const tree = placesOf([place("A", "Office"), place("B", "Storage Area", "A"), place("C", "Cabinet 2", "B"), place("D", "Cabinet 10", "B"), place("E", "Shelf 1", "C"), place("F", "Garage")]);

describe("place tree helpers", () => {
  it("builds paths, walks to the root and lists everything inside a place", () => {
    expect(pathOf(tree, "E")).toBe("Office › Storage Area › Cabinet 2 › Shelf 1");
    expect(ancestry(tree, "E").map((entry) => entry.id)).toEqual(["E", "C", "B", "A"]);
    expect(pathOf(tree, null)).toBeNull();
    expect(pathOf(tree, "missing")).toBeNull();
    expect([...withinPlace(tree, "B")].sort()).toEqual(["B", "C", "D", "E"]);
    expect(levelsBelow(tree, "A")).toBe(4);
    expect(levelsBelow(tree, "F")).toBe(1);
  });

  it("orders places for reading, with numbers in natural order, each before what is inside it", () => {
    expect(inOrder(tree).map(({ place: entry, depth }) => `${depth}:${entry.name}`)).toEqual(["1:Garage", "1:Office", "2:Storage Area", "3:Cabinet 2", "4:Shelf 1", "3:Cabinet 10"]);
  });

  it("survives a broken or looping parent link instead of hanging", () => {
    const loop = placesOf([place("X", "X", "Y"), place("Y", "Y", "X")]);
    expect(ancestry(loop, "X").length).toBeLessThanOrEqual(MAX_DEPTH + 3);
    expect(inOrder(loop)).toEqual([]);
    expect(withinPlace(loop, "X").size).toBe(2);
    expect(pathOf(placesOf([place("Z", "Orphan", "gone")]), "Z")).toBe("Orphan");
  });

  it("finds look-alike siblings but not the same name under different parents", () => {
    const list = placesOf([place("1", "Cabinet 1", "P"), place("2", "cabinet  1", "P"), place("3", "Cabinet-1", "P"), place("4", "Cabinet 1", "Q"), place("5", "Shelf", "P")]);
    expect(lookAlikes(list).map((group) => group.map((entry) => entry.id))).toEqual([["1", "2", "3"]]);
  });

  it("cleans a name: collapses spaces, refuses empty, long, control characters and the path sign", () => {
    expect(cleanName("  Shelf   2 ")).toBe("Shelf 2");
    for (const bad of ["", "   ", "x".repeat(121), "A › B", "bell\u0007here", 5, null]) expect(cleanName(bad), String(bad)).toBeNull();
  });

  it("filters 600 items by a place and its contents in a few milliseconds", () => {
    const wide = placesOf([place("root", "Root"), ...Array.from({ length: 60 }, (_, index) => place(`P${index}`, `Place ${index}`, index % 6 === 0 ? "root" : `P${index - (index % 6)}`))]);
    const items = Array.from({ length: 600 }, (_, index) => ({ id: index, locationId: index % 7 ? `P${index % 60}` : null }));
    const started = performance.now();
    const inside = withinPlace(wide, "root");
    const shown = items.filter((item) => item.locationId && inside.has(item.locationId));
    const spent = performance.now() - started;
    expect(shown.length).toBe(items.filter((item) => item.locationId).length);
    expect(spent).toBeLessThan(50);
  });
});
