import { describe, expect, it } from "vitest";
import { isListedForLending, listingGaps, openUnitCandidate, selfServiceAction } from "../src/catalog-policy";

const listed = { status: "ACTIVE", needsReview: false, lendingAudience: "STUDENTS_AND_USC_STAFF", itemType: "Loanable" };

describe("public lending policy", () => {
  it("lists reviewed, active, Loanable or Consumable items with an approved audience", () => {
    expect(isListedForLending(listed)).toBe(true);
    expect(isListedForLending({ ...listed, lendingAudience: "USC_STAFF_ONLY" })).toBe(true);
    expect(isListedForLending({ ...listed, lendingAudience: "UNKNOWN" })).toBe(false);
    expect(isListedForLending({ ...listed, itemType: "Consumable" })).toBe(true);
    expect(isListedForLending({ ...listed, itemType: "NEEDS_REVIEW" })).toBe(false);
  });

  it("fails closed for unresolved, inactive, and explicitly unavailable items", () => {
    expect(isListedForLending({ ...listed, needsReview: true })).toBe(false);
    expect(isListedForLending({ ...listed, needsReview: 1 })).toBe(false);
    expect(isListedForLending({ ...listed, status: "VERIFY" })).toBe(false);
    expect(isListedForLending({ ...listed, lendingAudience: "NOT_AVAILABLE_FOR_LENDING" })).toBe(false);
  });

  it("names every missing condition, so staff know exactly what blocks publication", () => {
    expect(listingGaps(listed)).toEqual([]);
    expect(listingGaps({ status: "INACTIVE", needsReview: 1, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", itemType: "NEEDS_REVIEW" }))
      .toEqual(["Set the type to Loanable or Consumable", "Choose who may use it", "Set the status to Active", "Mark the details reviewed"]);
  });
});

describe("open units (Part 5B)", () => {
  const paper = { itemType: "Consumable", consumptionMode: "WHOLE_UNIT", status: "ACTIVE", unit: "ream" };
  it("suggests whole-unit Consumables by their counting word only, and never changes anything", () => {
    for (const unit of ["ream", "box", "bottle", "jar", "roll", "pack", "can", "tub", "pouch", "container", " Ream "]) expect(openUnitCandidate({ ...paper, unit }), unit).toBe(true);
    for (const unit of ["piece", "sheet", "gallon", "tube", "reams?", ""]) expect(openUnitCandidate({ ...paper, unit }), unit).toBe(false);
    expect(openUnitCandidate({ ...paper, consumptionMode: "OPEN_UNIT" })).toBe(false);
    expect(openUnitCandidate({ ...paper, itemType: "Loanable" })).toBe(false);
    expect(openUnitCandidate({ ...paper, itemType: "NEEDS_REVIEW" })).toBe(false);
    expect(openUnitCandidate({ ...paper, status: "INACTIVE" })).toBe(false);
  });

  it("lets the item decide the phone action: Borrow, Take or Use", () => {
    const ready = { status: "ACTIVE", needsReview: false, lendingAudience: "STUDENTS_AND_USC_STAFF" };
    expect(selfServiceAction({ ...ready, itemType: "Loanable" })).toBe("BORROW");
    expect(selfServiceAction({ ...ready, itemType: "Consumable", consumptionMode: "WHOLE_UNIT" })).toBe("TAKE");
    expect(selfServiceAction({ ...ready, itemType: "Consumable", consumptionMode: "OPEN_UNIT" })).toBe("USE");
    expect(selfServiceAction({ ...ready, itemType: "Loanable", consumptionMode: "OPEN_UNIT" })).toBe("BORROW");
    expect(selfServiceAction({ ...ready, itemType: "Consumable", consumptionMode: "OPEN_UNIT", needsReview: true })).toBe(null);
  });
});
