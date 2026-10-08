import { describe, expect, it } from "vitest";
import { baselineAnswer, closest, passes, score, similarity, variantsOf } from "../src/role-evaluation";

describe("role evaluation helpers", () => {
  it("makes the same variants every time, and keeps the truth", () => {
    const first = variantsOf("Heavy duty stapler");
    expect(first).toEqual(variantsOf("Heavy duty stapler"));
    expect(first.map((each) => each.kind)).toEqual(["typo", "drop", "reorder", "plural"]);
    expect(first.every((each) => each.truth === "Heavy duty stapler")).toBe(true);
    expect(first.find((each) => each.kind === "typo")!.text).not.toBe("Heavy duty stapler");
    expect(variantsOf("Tap").length).toBe(0);
  });
  it("ranks near names by trigram overlap and tolerates a typo", () => {
    const names = ["Stapler", "Hole puncher", "Scissors", "Staples"];
    expect(closest("stapelr", names, 2)[0]).toBe("Stapler");
    expect(similarity("abc", "")).toBe(0);
  });
  it("answers only when clearly ahead", () => {
    expect(baselineAnswer("Stapler", ["Stapler", "Hole puncher"])).toBe("Stapler");
    expect(baselineAnswer("Stapler", ["Stapler red", "Stapler blue"])).toBeNull();
    expect(baselineAnswer("zzz", ["Stapler"])).toBeNull();
  });
  it("scores fixes and breaks against the baseline, and gates on precision, support and net benefit", () => {
    const right = { truth: "A", truthOffered: true, baseline: null, model: "A", answered: true };
    const cases = [...Array.from({ length: 40 }, () => right), { truth: "B", truthOffered: true, baseline: "B", model: "C", answered: true }];
    const result = score(cases);
    expect(result).toMatchObject({ cases: 41, fixes: 40, breaks: 1, modelAnswered: 41, modelRight: 40, modelWrong: 1 });
    expect(passes(result).pass).toBe(true);
    expect(passes(score(cases.slice(0, 10))).why).toContain("answers");
    expect(passes(score([...cases, ...Array.from({ length: 10 }, () => ({ ...right, model: "Z" }))])).why).toContain("precision");
  });
});
