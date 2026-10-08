import { beforeEach, describe, expect, it } from "vitest";
import { type RouteState, FACT_CODES, MAX_TERMS, ROLE_LIMITS, ROLE_MODELS, ROUTE_STATE, type TextRole, arbitrateTask, normalizeTask, readChoice, resetRoleBreakers, route, runRole, secondOpinionTask } from "../src/ai-roles";
import { BANDS, type AiRunner, neuronsToday, resetBreaker } from "../src/ambient-assist";
import { migratedD1 } from "./d1-sqlite";

/* Final Pass FP-D (mocked): the three text adapters, their limits and the router. No live call has been made. */

const chat = (content: string, neurons?: number) => ({ choices: [{ message: { content } }], ...(neurons === undefined ? {} : { usage: { neurons } }) });
let db: D1Database;
let sent: Array<{ model: string; input: { messages: Array<{ content: string }>; max_tokens: number } }>;
let answer: () => unknown;
const ai: AiRunner = { run: async (model, input) => { sent.push({ model, input: input as never }); return answer(); } };
const SHADOW = { ...ROUTE_STATE };
const active = () => { for (const role of Object.keys(ROUTE_STATE) as TextRole[]) ROUTE_STATE[role] = "ACTIVE_ELIGIBLE" as RouteState; };

beforeEach(() => { Object.assign(ROUTE_STATE, SHADOW); db = migratedD1().d1; sent = []; answer = () => chat('{"term":"Stapler"}', 1.2); resetBreaker(); resetRoleBreakers(); });

describe("the four roles", () => {
  it("maps each role to its accepted model, and starts every text role in shadow", () => {
    expect(ROLE_MODELS).toEqual({
      VISION_EXTRACT: "@cf/google/gemma-4-26b-a4b-it", TEXT_NORMALIZE: "@cf/ibm-granite/granite-4.0-h-micro",
      CANDIDATE_ARBITRATE: "@cf/qwen/qwen3-30b-a3b-fp8", RARE_SECOND_OPINION: "@cf/zai-org/glm-4.7-flash"
    });
    expect(Object.values(ROUTE_STATE)).toEqual(["SHADOW_EVALUATION", "SHADOW_EVALUATION", "SHADOW_EVALUATION"]);
  });
});

describe("reading a reply", () => {
  it("keeps only a value that is exactly in the allowed list", () => {
    const task = normalizeTask("staplr", ["Stapler", "Hole puncher"]);
    expect(readChoice(chat('{"term":"Stapler"}'), task)).toBe("Stapler");
    expect(readChoice({ response: { term: "Stapler" } }, task)).toBe("Stapler");
    for (const bad of ['{"term":"stapler"}', '{"term":"Calculator"}', '{"term":null}', '{"other":"Stapler"}', "[]", "not json", ""]) expect(readChoice(chat(bad), task), bad).toBeNull();
    expect(readChoice(null, task)).toBeNull();
  });

  it("limits what is sent: allowed values, short text, bounded lists", () => {
    const task = arbitrateTask("x".repeat(500), Array.from({ length: 9 }, (_, index) => ({ id: `i${index}`, name: "n".repeat(300) })));
    expect(task.allowed).toHaveLength(5);
    expect(JSON.parse(task.user).name.length).toBeLessThanOrEqual(80);
    expect(secondOpinionTask(["CATEGORY_SPLIT"]).allowed).toContain("CHECK_NAME");
    // Free text cannot reach the second opinion: anything that is not a fixed code is dropped.
    expect(JSON.parse(secondOpinionTask(["CATEGORY_SPLIT", "Maria Santos borrowed this" as never]).user).conflicts).toEqual(["CATEGORY_SPLIT"]);
    expect(FACT_CODES.length).toBeGreaterThan(0);
  });

  it("keeps the closest terms when there are too many, and skips (never cuts) a term over 60 characters", () => {
    const terms = [...Array.from({ length: 60 }, (_, index) => `Filler item ${index}`), "Heavy duty stapler", "x".repeat(61)];
    const task = normalizeTask("stapler", terms);
    expect(task.allowed).toHaveLength(MAX_TERMS);
    expect(task.allowed[0]).toBe("Heavy duty stapler");
    expect(task.allowed.some((term) => term.length > 60)).toBe(false);
  });
});

describe("running a role", () => {
  const task = () => normalizeTask("staplr", ["Stapler", "Hole puncher"]);

  it("stays silent in shadow unless a bounded evaluation asks, and never sends anything then", async () => {
    expect(await runRole(db, ai, "TEXT_NORMALIZE", task(), "USER")).toMatchObject({ outcome: "ABSTAIN", reason: "SHADOW_ONLY", value: null, observed: null, shadow: true });
    expect(sent).toHaveLength(0);
    // Even in an evaluation the usable value stays null; the answer is only in `observed`.
    const evaluated = await runRole(db, ai, "TEXT_NORMALIZE", task(), "USER", { evaluation: true });
    expect(evaluated).toMatchObject({ outcome: "ANSWER", value: null, observed: "Stapler", shadow: true, neurons: 1.2 });
    expect(sent[0]!.model).toBe(ROLE_MODELS.TEXT_NORMALIZE);
  });

  it("sends the fixed instruction, the supplied lists and the role's token limit, and bills the reported Neurons", async () => {
    active();
    const result = await runRole(db, ai, "TEXT_NORMALIZE", task(), "USER", {});
    expect(result).toMatchObject({ outcome: "ANSWER", value: "Stapler", shadow: false });
    expect(sent[0]!.input.max_tokens).toBe(ROLE_LIMITS.TEXT_NORMALIZE.maxTokens);
    expect(sent[0]!.input.messages).toHaveLength(2);
    // Granite is not a thinking model: it is sent no thinking option.
    expect(sent[0]!.input).not.toHaveProperty("chat_template_kwargs");
    expect(await neuronsToday(db)).toBeCloseTo(1.2, 5);
  });

  it("counts the reserve when a reply reports no Neurons, and abstains on an invalid answer", async () => {
    active();
    answer = () => chat('{"term":"Invented"}');
    expect(await runRole(db, ai, "TEXT_NORMALIZE", task(), "USER", {})).toMatchObject({ outcome: "ABSTAIN", reason: "NO_VALID_ANSWER", value: null });
    expect(await neuronsToday(db)).toBe(ROLE_LIMITS.TEXT_NORMALIZE.reserve);
  });

  it("refuses without a binding, with the owner switch off, with nothing to choose from, or at the allowance line", async () => {
    active();
    expect(await runRole(db, undefined, "TEXT_NORMALIZE", task(), "USER", {})).toMatchObject({ outcome: "UNAVAILABLE", reason: "NO_BINDING" });
    expect(await runRole(db, ai, "TEXT_NORMALIZE", normalizeTask("x", []), "USER", {})).toMatchObject({ reason: "NOTHING_TO_CHOOSE" });
    await db.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES(?, ?, ?)").bind(`ai_neurons:${new Date().toISOString().slice(0, 10)}`, String(BANDS.stop - 1), new Date().toISOString()).run();
    expect(await runRole(db, ai, "CANDIDATE_ARBITRATE", arbitrateTask("x", [{ id: "a", name: "A" }, { id: "b", name: "B" }]), "USER", {})).toMatchObject({ outcome: "ABSTAIN", reason: "BUDGET" });
    expect(sent).toHaveLength(0);
    await db.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES('ambient_assist', 'off', ?)").bind(new Date().toISOString()).run();
    expect(await runRole(db, ai, "TEXT_NORMALIZE", task(), "USER", {})).toMatchObject({ reason: "SWITCHED_OFF" });
  });

  it("keeps the reserve after a failure, opens that role's breaker after three, and leaves the other roles alone", async () => {
    active();
    answer = () => { throw new Error("down"); };
    for (let index = 0; index < 3; index += 1) expect(await runRole(db, ai, "TEXT_NORMALIZE", task(), "USER", {})).toMatchObject({ outcome: "UNAVAILABLE", reason: "CALL_FAILED" });
    expect(await runRole(db, ai, "TEXT_NORMALIZE", task(), "USER", {})).toMatchObject({ reason: "BREAKER_OPEN" });
    expect(sent).toHaveLength(3);
    answer = () => chat('{"id":"a"}', 2);
    const other = await runRole(db, ai, "CANDIDATE_ARBITRATE", arbitrateTask("x", [{ id: "a", name: "A" }, { id: "b", name: "B" }]), "USER", {});
    expect(other).toMatchObject({ outcome: "ANSWER", value: "a" });
  });

  it("turns thinking off for the reasoning models", async () => {
    active();
    answer = () => chat('{"id":"a"}', 2);
    await runRole(db, ai, "CANDIDATE_ARBITRATE", arbitrateTask("x", [{ id: "a", name: "A" }, { id: "b", name: "B" }]), "USER");
    expect(sent[0]!.input).toHaveProperty("chat_template_kwargs", { enable_thinking: false });
  });

  it("lets Qwen choose only a supplied id and GLM only a fixed follow-up", async () => {
    active();
    answer = () => chat('{"id":"zzz"}');
    expect((await runRole(db, ai, "CANDIDATE_ARBITRATE", arbitrateTask("x", [{ id: "a", name: "A" }, { id: "b", name: "B" }]), "USER", {})).value).toBeNull();
    answer = () => chat('{"follow_up":"CHECK_CATEGORY"}', 3);
    expect((await runRole(db, ai, "RARE_SECOND_OPINION", secondOpinionTask(["NAME_AND_PHOTO_DISAGREE"]), "USER", {})).value).toBe("CHECK_CATEGORY");
    answer = () => chat('{"follow_up":"DELETE_THE_ITEM"}');
    expect((await runRole(db, ai, "RARE_SECOND_OPINION", secondOpinionTask(["UNIT_SPLIT"]), "USER", {})).value).toBeNull();
  });
});

describe("the router", () => {
  const base = { exactMatch: false, unmatchedName: null, terms: [], candidates: [], conflict: [], used: 100 };
  it("calls nothing when an exact match resolves the draft, or when nothing is unresolved", () => {
    expect(route({ ...base, exactMatch: true, unmatchedName: "x", terms: ["a"], candidates: [{ id: "1", name: "a" }, { id: "2", name: "b" }] })).toEqual([]);
    expect(route(base)).toEqual([]);
  });
  it("asks Granite only when the rules failed and terms exist, Qwen only with two or more candidates, never more than two", () => {
    expect(route({ ...base, unmatchedName: "staplr", terms: ["Stapler"] })).toEqual(["TEXT_NORMALIZE"]);
    expect(route({ ...base, unmatchedName: "staplr", terms: [] })).toEqual([]);
    expect(route({ ...base, candidates: [{ id: "1", name: "a" }] })).toEqual([]);
    expect(route({ ...base, unmatchedName: "x", terms: ["a"], candidates: [{ id: "1", name: "a" }, { id: "2", name: "b" }], conflict: ["UNIT_SPLIT"] })).toEqual(["TEXT_NORMALIZE", "CANDIDATE_ARBITRATE"]);
  });
  it("keeps GLM for a rare conflict with ample allowance", () => {
    expect(route({ ...base, conflict: ["CATEGORY_SPLIT"] })).toEqual(["RARE_SECOND_OPINION"]);
    expect(route({ ...base, conflict: ["CATEGORY_SPLIT"], used: 6_600 })).toEqual([]);
  });
});
