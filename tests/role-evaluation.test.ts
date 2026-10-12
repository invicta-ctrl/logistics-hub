import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("bounded fresh provider evaluation", () => {
  const flags = ["--fixtures", "tests/fixtures/v116-role-heldout.json", "--challenger", "qwen", "--granite", "10", "--qwen", "0", "--glm", "0"];
  const run = (args: string[], preload?: string, scenario = "") => spawnSync(process.execPath,
    [...(preload ? ["--import", preload] : []), "scripts/evaluate-roles.mjs", ...args], { encoding: "utf8", timeout: 15_000,
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: preload ? "a".repeat(32) : "", CLOUDFLARE_API_TOKEN: preload ? "test-only" : "", QUALIFICATION_SCENARIO: scenario } });
  const metrics = (output: string) => output.split("\n").filter((line) => line.startsWith("provider metrics ")).map((line) => JSON.parse(line.slice(17)));

  it("validates fresh fixtures without credentials or inference, and refuses malformed limits and unpermitted challengers", () => {
    const dry = run(["--dry", ...flags]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("zero inference calls");
    expect(dry.stdout).toContain("baseline answered 36 (precision 100%)");
    const noAuth = run(flags);
    expect(noAuth.status).toBe(1);
    expect(noAuth.stderr).toContain("Nothing was sent");
    for (const args of [["--dry", "--granite", "NaN"], ["--dry", "--stop-neurons", "-1"], ["--dry", "--fixtures"], ["--dry", "--challenger", "paid-model"]]) {
      expect(run(args).status).toBe(1);
    }
  });

  it("keeps valid abstention, invalid output and failures distinct; caps paired calls and refuses partial measurements", () => {
    const dir = mkdtempSync(join(tmpdir(), "role-evaluation-"));
    const preload = join(dir, "transport.mjs");
    writeFileSync(preload, `
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        if (!String(url).startsWith('https://api.cloudflare.com/client/v4/accounts/')) throw new Error('unexpected destination');
        if (String(url).includes('/ai/models/search')) return { ok: true, status: 200, json: async () => ({ success: true, result: [{ name: new URL(url).searchParams.get('search'), properties: [{property_id:'deprecated',value:'false'}] }] }) };
        calls++;
        const payload = JSON.parse(options.body), input = JSON.parse(payload.messages[1].content);
        if ('truth' in input || 'acceptable' in input || 'family' in input || payload.max_tokens !== 40 || !options.signal) throw new Error('unsafe task');
        const field = Object.keys(payload.response_format.json_schema.properties)[0];
        const ok = (content, neurons) => ({ ok: true, status: 200, json: async () => ({ success: true, result: { choices: [{message:{content:JSON.stringify(content)}}], ...(neurons === undefined ? {} : {usage:{neurons}}) } }) });
        const error = status => ({ ok: false, status, json: async () => ({ success: false }) });
        if (process.env.QUALIFICATION_SCENARIO === 'mixed') return calls === 1 ? ok({[field]:payload.response_format.json_schema.properties[field].enum[0]}, .2) : calls === 2 ? ok({[field]:null}, .3) : calls === 3 ? ok({bad:42}, .4) : error(429);
        if (process.env.QUALIFICATION_SCENARIO === 'denied') return error(403);
        if (process.env.QUALIFICATION_SCENARIO === 'invalid') return ok({bad:42}, .1);
        if (process.env.QUALIFICATION_SCENARIO === 'calibration') return ok({[field]:null}, 3);
        return ok({[field]:null});
      };
    `);
    try {
      const mixed = run(flags, preload, "mixed");
      expect(mixed.status).toBe(2);
      const [incumbent, challenger] = metrics(mixed.stdout);
      expect(incumbent).toMatchObject({ calls: 2, answers: 1, invalid: 1, abstentions: 0 });
      expect(challenger).toMatchObject({ calls: 2, abstentions: 1, failures: { RATE_LIMITED: 1 }, fallbackReservedNeurons: 3 });
      expect(mixed.stdout).toContain("accounted Neurons 3.9");
      expect(mixed.stdout).toContain('"complete":false');
      expect(mixed.stdout).toContain("unpaired calls excluded from quality comparison 0");
      for (const scenario of ["denied", "calibration"]) {
        const stopped = run(flags, preload, scenario);
        expect(stopped.status).toBe(2);
        expect(metrics(stopped.stdout).reduce((n, bucket) => n + bucket.calls, 0)).toBe(1);
      }
      const invalid = run(flags, preload, "invalid");
      expect(invalid.status).toBe(2);
      expect(metrics(invalid.stdout).reduce((n, bucket) => n + bucket.invalid, 0)).toBe(5);
      expect(metrics(invalid.stdout).reduce((n, bucket) => n + bucket.abstentions, 0)).toBe(0);
      const capped = run([...flags, "--stop-neurons", "5"], preload);
      expect(capped.status).toBe(2);
      expect(metrics(capped.stdout).reduce((n, bucket) => n + bucket.calls, 0)).toBe(2);
      expect(capped.stdout).toContain("accounted Neurons 5");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
