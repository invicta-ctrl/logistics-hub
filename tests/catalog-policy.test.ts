import { describe, expect, it } from "vitest";
import { LOAN_FIELDS, STUDENT_ID_MESSAGES, WHOLE_DOMAINS, isListedForLending, listingGaps, normalizeStudentId, openUnitCandidate, parseWhole, selfServiceAction, validateLoanDraft, validateStudentId, wholeJson, wholeMessage } from "../src/catalog-policy";

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

describe("numbers and Student IDs (V1.16.4 §4.6)", () => {
  const quantity = WHOLE_DOMAINS.loanQuantity;
  it("reads plain whole numbers exactly, leading zeros and surrounding spaces included", () => {
    expect(parseWhole("5", quantity)).toEqual({ ok: true, value: 5 });
    expect(parseWhole(" 007 ", quantity)).toEqual({ ok: true, value: 7 });
    expect(parseWhole("100000", quantity)).toEqual({ ok: true, value: 100_000 });
    expect(parseWhole("0", WHOLE_DOMAINS.count)).toEqual({ ok: true, value: 0 });
    expect(parseWhole("-3", { min: -100, max: 100, signed: true })).toEqual({ ok: true, value: -3 });
  });

  it("refuses every look-alike with its own reason, never a clamp or a guess", () => {
    const cases: Array<[string, string]> = [
      ["", "EMPTY"], ["   ", "EMPTY"], ["1e3", "EXPONENT"], ["2E2", "EXPONENT"], ["0x10", "NOT_NUMBER"], ["2.5", "FRACTION"], ["5.0", "FRACTION"],
      ["-1", "NEGATIVE"], ["-2.5", "NEGATIVE"], ["1,000", "SEPARATOR"], ["1 000", "SEPARATOR"], ["１２", "NOT_NUMBER"], ["+5", "NOT_NUMBER"],
      ["NaN", "NOT_NUMBER"], ["Infinity", "NOT_NUMBER"], ["999999", "TOO_LARGE"], ["99999999999999999999", "TOO_LARGE"], ["0", "TOO_SMALL"], ["five", "NOT_NUMBER"]
    ];
    for (const [text, error] of cases) expect(parseWhole(text, quantity), text).toEqual({ ok: false, error });
  });

  it("holds JSON numbers to the same domain and reads JSON text as typed", () => {
    expect(wholeJson(3, quantity)).toEqual({ ok: true, value: 3 });
    expect(wholeJson("3", quantity)).toEqual({ ok: true, value: 3 });
    expect(wholeJson("1e3", quantity)).toEqual({ ok: false, error: "EXPONENT" });
    expect(wholeJson(2.5, quantity)).toEqual({ ok: false, error: "FRACTION" });
    expect(wholeJson(-1, quantity)).toEqual({ ok: false, error: "NEGATIVE" });
    expect(wholeJson(1e21, quantity)).toEqual({ ok: false, error: "TOO_LARGE" });
    expect(wholeJson(Number.NaN, quantity)).toEqual({ ok: false, error: "NOT_NUMBER" });
    expect(wholeJson(true, quantity)).toEqual({ ok: false, error: "NOT_NUMBER" });
    expect(wholeJson(null, quantity)).toEqual({ ok: false, error: "EMPTY" });
  });

  it("says what is wrong in words both surfaces share", () => {
    expect(wholeMessage("TOO_LARGE", "quantity", WHOLE_DOMAINS.selfServiceQuantity)).toBe("The quantity can be at most 30.");
    expect(wholeMessage("FRACTION", "count", WHOLE_DOMAINS.count)).toBe("The count must be a whole number.");
  });

  it("normalises a written or full-width Student ID without ever cutting it", () => {
    expect(normalizeStudentId("21-000115")).toBe("21000115");
    expect(normalizeStudentId("２１０００１１５")).toBe("21000115");
    expect(normalizeStudentId(" 2100 0115 ")).toBe("21000115");
    expect(normalizeStudentId("210001159")).toBe("210001159");
    expect(validateStudentId("00123456")).toBeNull();
    expect(normalizeStudentId("00123456")).toBe("00123456");
    expect(validateStudentId("21-000115")).toBeNull();
    expect(validateStudentId("210001159")).toBe("LENGTH");
    expect(validateStudentId("2100011")).toBe("LENGTH");
    expect(validateStudentId("21A00115")).toBe("NOT_DIGITS");
    expect(validateStudentId("")).toBe("EMPTY");
    expect(STUDENT_ID_MESSAGES.LENGTH).toBe("A Student ID has exactly 8 digits.");
  });

  it("asks the same of Individual and USC loans, apart from USC's reason", () => {
    const base = { borrowerName: "Ana Cruz", studentId: "21000115", reason: "", quantity: "1" };
    expect(validateLoanDraft({ ...base, purpose: "INDIVIDUAL" })).toEqual({});
    expect(validateLoanDraft({ ...base, purpose: "USC" })).toEqual({ reason: "Enter the specific USC reason." });
    expect(validateLoanDraft({ ...base, purpose: "USC", reason: "Org fair booth" })).toEqual({});
    expect(validateLoanDraft({ ...base, purpose: "USC", reason: "Org fair booth", studentId: "" })).toEqual({ studentId: "Enter the Student ID number." });
    expect(validateLoanDraft({ ...base, purpose: "INDIVIDUAL", uscOnly: true })).toEqual({ purpose: "This item is lent for USC use only." });
    expect(validateLoanDraft({ ...base, purpose: "INDIVIDUAL", quantity: "1e3" })).toEqual({ quantity: "Write the quantity out in full, like 1000." });
    expect(Object.keys(validateLoanDraft({ purpose: "X", borrowerName: "", studentId: "1", reason: "", quantity: "" }))).toEqual(["purpose", "borrowerName", "studentId", "quantity"]);
    expect(LOAN_FIELDS).toEqual(["purpose", "borrowerName", "studentId", "reason", "quantity"]);
  });
});
