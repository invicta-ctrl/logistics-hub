import { describe, expect, it } from "vitest";
import { isPubliclyLendable } from "../src/catalog-policy";

const approved = { status: "ACTIVE", needsReview: false, lendingAudience: "STUDENTS_AND_USC_STAFF", itemType: "EQUIPMENT", onHand: 1 };

describe("public lending policy", () => {
  it("requires every approved enum and a posted positive quantity", () => {
    expect(isPubliclyLendable(approved)).toBe(true);
    expect(isPubliclyLendable({ ...approved, onHand: 0 })).toBe(false);
    expect(isPubliclyLendable({ ...approved, lendingAudience: "UNKNOWN" })).toBe(false);
    expect(isPubliclyLendable({ ...approved, itemType: "NEEDS_REVIEW" })).toBe(false);
  });

  it("fails closed for unresolved, inactive, and explicitly unavailable items", () => {
    expect(isPubliclyLendable({ ...approved, needsReview: true })).toBe(false);
    expect(isPubliclyLendable({ ...approved, status: "VERIFY" })).toBe(false);
    expect(isPubliclyLendable({ ...approved, lendingAudience: "NOT_AVAILABLE_FOR_LENDING" })).toBe(false);
  });
});
