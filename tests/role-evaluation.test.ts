import { describe, expect, it } from "vitest";
import { absentNames, baselineAnswer, closest, isAmbiguous, passes, score, similarity, splitOf, variantsOf } from "../src/role-evaluation";

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
  it("splits the catalogue the same way every time, into two halves that both exist", () => {
    const names = Array.from({ length: 60 }, (_, index) => `Item ${index} thing`);
    const halves = names.map(splitOf);
    expect(halves).toEqual(names.map(splitOf));
    expect(halves.filter((half) => half === "TEST").length).toBeGreaterThan(10);
    expect(halves.filter((half) => half === "TUNE").length).toBeGreaterThan(10);
    expect(splitOf("Stapler")).toBe(splitOf("stapler"));
  });
  it("sets aside a variant that more than one name could explain", () => {
    const names = ["Packing tape roll", "Packing tape dispenser", "Marker black", "Black marker"];
    const drop = variantsOf("Packing tape roll").find((each) => each.kind === "drop");
    expect(drop?.text).toBe("Packing tape");
    expect(isAmbiguous(drop!, names)).toBe(true);
    // A reorder that lands on another real name is also not a fair question.
    expect(isAmbiguous({ kind: "reorder", text: "Black marker", truth: "Marker black" }, names)).toBe(true);
    expect(isAmbiguous({ kind: "typo", text: "Packing tpae roll", truth: "Packing tape roll" }, names)).toBe(false);
  });
  it("makes plausible names that are not in the catalogue, whose right answer is none", () => {
    const names = ["Heavy duty stapler", "Extension cord long", "Whiteboard marker blue", "Duct tape grey", "Paper cutter large", "Scotch tape clear"];
    const made = absentNames(names, 4);
    expect(made.length).toBeGreaterThan(0);
    for (const each of made) {
      expect(each.truth).toBeNull();
      expect(names.map((name) => name.toLowerCase())).not.toContain(each.text.toLowerCase());
      expect(each.kind).toBe("absent");
    }
    expect(absentNames(names, 4)).toEqual(made);
  });
  it("counts an answer where no name is right as wrong, and silence as neither right nor wrong", () => {
    const base = { truthOffered: false, baseline: null };
    const result = score([
      { ...base, truth: null, model: "Stapler", answered: true },
      { ...base, truth: null, model: null, answered: false },
      { ...base, truth: "A", model: "A", answered: true },
      { ...base, truth: "A", model: null, answered: false }
    ]);
    expect(result).toMatchObject({ cases: 4, absentCases: 2, absentAnswered: 1, modelAnswered: 2, modelRight: 1, modelWrong: 1, coverage: 0.5, baselineRight: 0 });
  });
  it("does not ask for net benefit where the baseline was silent on every case", () => {
    const right = { truth: "A", truthOffered: true, baseline: null, model: "A", answered: true };
    const cases = Array.from({ length: 40 }, () => right);
    expect(passes(score(cases)).pass).toBe(true);
    const silent = score(cases.map((each) => ({ ...each, model: "A" })));
    expect(passes({ ...silent, fixes: 0 }, { netBenefit: false })).toMatchObject({ pass: true, why: expect.stringContaining("not measurable") });
    expect(passes({ ...silent, fixes: 0 }).pass).toBe(false);
  });
});
