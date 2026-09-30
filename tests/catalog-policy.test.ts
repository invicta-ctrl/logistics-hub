import { describe, expect, it } from "vitest";
import { isListedForLending, listingGaps } from "../src/catalog-policy";

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
