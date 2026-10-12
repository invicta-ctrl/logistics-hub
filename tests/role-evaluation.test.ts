import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
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

  it("measures current guarded adapters without treating pre-call suppression as provider abstention or trusted values", () => {
    const guardFlags = ["--guarded", "tests/fixtures/v116-guarded-role-heldout.json", "--granite", "40", "--qwen", "40", "--glm", "0", "--prior-neurons", "128.288"];
    const dir = mkdtempSync(join(tmpdir(), "guarded-role-evaluation-")), preload = join(dir, "transport.mjs");
    writeFileSync(preload, `
      import fs from 'node:fs';
      const fixture = JSON.parse(fs.readFileSync('tests/fixtures/v116-guarded-role-heldout.json'));
      const truth = new Map(fixture.nameCases.map(each => [each.name, each.truth])); let calls = 0;
      globalThis.fetch = async (url, options) => {
        if (!String(url).startsWith('https://api.cloudflare.com/client/v4/accounts/')) throw new Error('unexpected egress');
        if (String(url).includes('/ai/models/search')) return {ok:true,status:200,json:async()=>({success:true,result:[{name:new URL(url).searchParams.get('search')}]})};
        calls++; const payload = JSON.parse(options.body), input = JSON.parse(payload.messages[1].content);
        if ('truth' in input || 'family' in input || 'kind' in input || !options.signal || truth.get(input.name) === null) throw new Error('unsafe or pre-suppressed task reached provider');
        const field = String(url).includes('granite') ? 'term' : 'id';
        if (payload.max_tokens !== (field === 'term' ? 40 : 60)) throw new Error('adapter changed');
        const answer = field === 'term' ? truth.get(input.name) : input.candidates.find(each => each.name === truth.get(input.name))?.id;
        if (process.env.QUALIFICATION_SCENARIO === 'denied') return {ok:false,status:403,json:async()=>({success:false})};
        let result = {[field]:answer};
        if (process.env.QUALIFICATION_SCENARIO === 'mixed') {
          if (calls === 1) result = {[field]:payload.response_format.json_schema.properties[field].enum.find(value => value !== null && value !== answer)};
          if (calls === 2) result = {[field]:null}; if (calls === 3) result = {bad:42};
        }
        return {ok:true,status:200,json:async()=>({success:true,result:{choices:[{message:field === 'term'?{content:JSON.stringify(result)}:{content:null,reasoning_content:JSON.stringify(result)}}],usage:{neurons:.5}}})};
      };
    `);
    const records = (output: string, prefix: string) => output.split("\n").filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
    try {
      const dry = run(["--dry", ...guardFlags]);
      expect(dry.status).toBe(0);
      expect(dry.stdout).toContain("baseline answered 24 (precision 100%)");
      const ideal = run(guardFlags, preload);
      expect(ideal.status).toBe(0);
      for (const result of records(ideal.stdout, "guarded measurement ")) expect(result).toMatchObject({completed:40,providerInvoked:32,preSuppressed:8,postVetoed:0,
        rawPopulation:"INVOKED_SUBSET_ONLY",rawScore:{cases:32,absentCases:0,modelAnswered:32,fixes:8},guardedScore:{cases:40,absentCases:8,modelAnswered:32,fixes:8},promotion:"NOT_AUTHORIZED_REVIEW_ONLY"});
      expect(metrics(ideal.stdout).map(each => each.abstentions)).toEqual([0,0]);
      expect(records(ideal.stdout,"guarded receipt ")[0]).toMatchObject({complete:true,coreUnchanged:true,rolesRemainReviewOnly:true,guardedAccountedNeurons:32});
      const mixed = run(guardFlags, preload, "mixed");
      expect(mixed.status).toBe(0);
      expect(records(mixed.stdout,"guarded measurement ")[0]).toMatchObject({preSuppressed:8,postVetoed:1,rawScore:{modelWrong:1},guardedScore:{modelWrong:0,modelAnswered:29}});
      expect(metrics(mixed.stdout)[0]).toMatchObject({abstentions:1,invalid:1});
      const denied = run(guardFlags, preload, "denied");
      expect(denied.status).toBe(2);
      expect(records(denied.stdout,"guarded receipt ")[0]).toMatchObject({complete:false,stopped:"ACCESS_DENIED"});
      expect(metrics(denied.stdout).reduce((sum, each) => sum + each.calls, 0)).toBe(1);
      const capped = run([...guardFlags.slice(0,-1),"399.5"], preload);
      expect(capped.status).toBe(2);
      expect(records(capped.stdout,"guarded receipt ")[0]).toMatchObject({complete:false,guardedAccountedNeurons:0});
      expect(metrics(capped.stdout)).toHaveLength(0);
      const changed = JSON.parse(readFileSync("tests/fixtures/v116-guarded-role-heldout.json", "utf8")); changed.nameCases[0].name = "DO_NOT_SEND_PRIVATE_TEST_DATA";
      const changedPath = join(dir,"changed.json"); writeFileSync(changedPath,JSON.stringify(changed));
      const refused = run(["--guarded",changedPath,...guardFlags.slice(2)],preload);
      expect(refused.status).toBe(2); expect(refused.stderr).toContain("Unreviewed fixture bytes");
      expect(refused.stdout).not.toContain("catalog preflight"); expect(refused.stdout).not.toContain("DO_NOT_SEND_PRIVATE_TEST_DATA");
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });

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

  it("refuses altered or symlinked photo manifests before downloads, browser preparation or inference", () => {
    const dir = mkdtempSync(join(tmpdir(), "photo-fixture-"));
    const changedPath = join(dir, "changed.json"), linkPath = join(dir, "linked.json"), preload = join(dir, "egress.mjs");
    const changed = JSON.parse(readFileSync("tests/fixtures/v116-photo-heldout.json", "utf8"));
    changed.photos[0].id = "DO_NOT_SEND_PRIVATE_TEST_DATA";
    writeFileSync(changedPath, JSON.stringify(changed));
    symlinkSync(join(process.cwd(), "tests/fixtures/v116-photo-heldout.json"), linkPath);
    writeFileSync(preload, `globalThis.fetch = async () => { console.log('UNAUTHORIZED_EGRESS'); throw new Error(); };`);
    try {
      for (const path of [changedPath, linkPath]) {
        const refused = run(["--photos", path, "--dry"], preload);
        expect(refused.status).not.toBe(0);
        expect(refused.stderr).toMatch(/Unreviewed photo manifest|Invalid bounded photo manifest/);
        expect(refused.stdout).not.toMatch(/UNAUTHORIZED_EGRESS|DO_NOT_SEND_PRIVATE_TEST_DATA|photo preparation/);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses unreviewed file egress and reads one bounded descriptor snapshot despite a replaced pathname", () => {
    const dir = mkdtempSync(join(tmpdir(), "role-fixture-"));
    const path = join(dir, "fixture.json"), preload = join(dir, "snapshot.mjs");
    const original = readFileSync("tests/fixtures/v116-role-heldout.json");
    const changed = JSON.parse(original.toString());
    changed.nameCases[0].name = "DO_NOT_SEND_PRIVATE_TEST_DATA";
    writeFileSync(path, JSON.stringify(changed));
    writeFileSync(preload, `globalThis.fetch = async () => { console.log('UNAUTHORIZED_EGRESS'); throw new Error(); };`);
    try {
      const input = [...flags]; input[input.indexOf("--fixtures") + 1] = path;
      const refused = run(input, preload);
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain("Unreviewed fixture bytes");
      expect(refused.stdout).not.toContain("UNAUTHORIZED_EGRESS");
      expect(refused.stdout).not.toContain("DO_NOT_SEND_PRIVATE_TEST_DATA");
      writeFileSync(path, original);
      writeFileSync(preload, `
        import fs from 'node:fs';
        const open = fs.openSync;
        fs.openSync = function (name, ...args) {
          const fd = open.call(this, name, ...args);
          if (name === ${JSON.stringify(path)}) {
            fs.unlinkSync(name); fs.writeFileSync(name, ${JSON.stringify(JSON.stringify(changed))});
            console.log('CONTROLLED_PATH_REPLACEMENT');
          }
          return fd;
        };
        globalThis.fetch = async () => { throw new Error('unexpected dry egress'); };
      `);
      const snapshot = run(["--dry", ...input], preload);
      expect(snapshot.status).toBe(0);
      expect(snapshot.stdout).toContain("CONTROLLED_PATH_REPLACEMENT");
      expect(snapshot.stdout).toContain("72d23615672d32fddca71650bd02ea48952df1e8f88556cb4748de97ef404297");
      expect(snapshot.stdout).toContain("baseline answered 36 (precision 100%)");
    } finally { rmSync(dir, { recursive: true, force: true }); }
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
