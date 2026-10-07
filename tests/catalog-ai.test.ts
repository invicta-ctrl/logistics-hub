import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_REASON, AI_TIER, type AiPayload, aiMessages, aiPayload, aiSchema, readAiAnswer } from "../src/catalog-ai";
import { evaluateWithAi } from "../src/suggest-evaluation";
import { migratedD1 } from "./d1-sqlite";

/* The Workers AI second opinion's boundary (amendment §13.2–13.3): what may be sent, what may come back, and that nothing calls it yet. */

const options = { categories: ["Office Equipment and Supplies", "Medical Supplies", "UNSORTED", "Medical Supplies"], units: ["piece", "box", "roll"] };

describe("the payload allowlist", () => {
  it("sends the typed name, its other names and the live option lists, and nothing else a record carries", () => {
    // Every other field a record (or a careless caller) could hold, each with a value that must never leave.
    const record = {
      name: "  Blue   whiteboard marker ", aliases: "board pen; dry-erase marker", id: "ITM-SECRET-ID", notes: "SECRET-NOTE", location: "SECRET-SHELF",
      locationId: "LOC-9999", photoId: "SECRET-PHOTO", photo: { key: "SECRET-PHOTO-KEY" }, borrower: "SECRET-BORROWER", studentId: "SECRET-STUDENT-ID",
      createdBy: "SECRET-ACCOUNT", category: "SECRET-OWN-CATEGORY", unit: "SECRET-OWN-UNIT", onHand: 987654, evidence: "SECRET-EVIDENCE", directory: { name: "SECRET-PERSON" }
    };
    const payload = aiPayload(record, options);
    expect(Object.keys(payload).sort()).toEqual(["aliases", "name", "options"]);
    expect(Object.keys(payload.options).sort()).toEqual(["behaviours", "categories", "units"]);
    expect(payload).toEqual({
      name: "Blue whiteboard marker",
      aliases: ["board pen", "dry-erase marker"],
      options: {
        categories: ["Medical Supplies", "Office Equipment and Supplies"],
        units: ["box", "piece", "roll"],
        behaviours: [{ value: "BORROW", meaning: "lent out and brought back" }, { value: "CONSUME", meaning: "taken whole and not returned" }, { value: "GRADUAL", meaning: "opened, then used up a little at a time" }]
      }
    });
    const sent = JSON.stringify([aiMessages(payload), aiSchema(payload)]);
    expect(sent).not.toMatch(/SECRET|987654|LOC-9999/);
    expect(aiMessages(payload)).toHaveLength(2);
    expect(aiMessages(payload)[1]!.content).toBe(JSON.stringify(payload));
  });

  it("the measurement hands the model only payloads, never records", async () => {
    const { sqlite } = migratedD1();
    const catalog = (sqlite.prepare("SELECT name, aliases, category, item_type AS itemType, consumption_mode AS consumptionMode, unit, stock_area AS stockArea, status FROM items").all() as Array<Record<string, string>>)
      .slice(0, 60).map((item) => ({ ...item, notes: "SECRET-NOTE", id: "ITM-SECRET" })) as unknown as Parameters<typeof evaluateWithAi>[0];
    const seen: AiPayload[] = [];
    const result = await evaluateWithAi(catalog, async (payload) => { seen.push(payload); return { response: "{}" }; }, 1_000);
    expect(seen.length).toBe(result.calls);
    expect(seen.length).toBeGreaterThan(0);
    for (const payload of seen) {
      expect(Object.keys(payload).sort()).toEqual(["aliases", "name", "options"]);
      expect(JSON.stringify(payload)).not.toContain("SECRET");
    }
  });
});

describe("what may come back", () => {
  const payload = aiPayload({ name: "Gauze pad" }, options);
  it("keeps only values that are exactly one of the options", () => {
    expect(readAiAnswer({ response: { category: "Medical Supplies", unit: "box", behaviour: "CONSUME" } }, payload)).toEqual({ category: "Medical Supplies", unit: "box", behaviour: "CONSUME" });
    expect(readAiAnswer({ response: '```json\n{"category":"Medical Supplies","unit":null,"behaviour":"GRADUAL"}\n```' }, payload)).toEqual({ category: "Medical Supplies", behaviour: "GRADUAL" });
    // Not an option, the wrong case, "not sure", the placeholder category, made-up fields: all dropped.
    expect(readAiAnswer({ response: { category: "First Aid", unit: "Box", behaviour: "REVIEW_LATER", stockArea: "Pantry" } }, payload)).toEqual({});
    expect(readAiAnswer({ response: { category: "UNSORTED" } }, payload)).toEqual({});
  });

  it("reads the chat-completion shape Workers AI returns today (the V1.11 harness missed it until 2026-10-07)", () => {
    const reply = { object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: '{"category":"Medical Supplies","unit":"box","behaviour":"CONSUME"}' } }], usage: { neurons: 0.54 } };
    expect(readAiAnswer(reply, payload)).toEqual({ category: "Medical Supplies", unit: "box", behaviour: "CONSUME" });
    expect(readAiAnswer({ choices: [] }, payload)).toEqual({});
    expect(readAiAnswer({ choices: [{ message: { content: null } }] }, payload)).toEqual({});
  });

  it("an unreadable or empty answer is no suggestion, never an error", () => {
    for (const reply of [null, undefined, "", "not json", "[1,2]", { response: 42 }, { response: ["Medical Supplies"] }, { response: "{\"category\": " }]) expect(readAiAnswer(reply, payload)).toEqual({});
  });

  it("an answer is at most Weak and says it is an AI suggestion", () => {
    expect(AI_TIER).toBe("WEAK");
    expect(AI_REASON).toBe("AI suggestion");
  });

  it("the measurement survives a failing provider and stops at its call limit", async () => {
    const { sqlite } = migratedD1();
    const catalog = sqlite.prepare("SELECT name, aliases, category, item_type AS itemType, consumption_mode AS consumptionMode, unit, stock_area AS stockArea, status FROM items").all() as unknown as Parameters<typeof evaluateWithAi>[0];
    const failing = await evaluateWithAi(catalog, async () => { throw new Error("3040: Out of capacity"); }, 5);
    expect(failing.calls).toBe(5);
    expect(failing.failed).toBe(5);
    expect(failing.skipped).toBeGreaterThan(0);
    expect(failing.fields.category.NONE.answered).toBe(0);
  });
});

describe("the V1.11 second opinion stays a measurement", () => {
  it("is reached by no route or page: measured on 2026-10-07 and left off (V1.15 plan, Ambient AI Assist amendment)", () => {
    const users = readdirSync("src").filter((file) => /\.ts$/.test(file) && readFileSync(`src/${file}`, "utf8").includes("./catalog-ai"));
    expect(users).toEqual(["suggest-evaluation.ts"]);
  });

  it("the Workers AI binding is used by ambient assist alone, which the Worker alone calls", () => {
    expect(readFileSync("wrangler.jsonc", "utf8")).toMatch(/"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"\s*\}/);
    const sources = readdirSync("src").filter((file) => /\.ts$/.test(file));
    expect(sources.filter((file) => /\bai\.run\(|\.AI\.run\(/.test(readFileSync(`src/${file}`, "utf8")))).toEqual(["ambient-assist.ts"]);
    expect(sources.filter((file) => /env\.AI\b/.test(readFileSync(`src/${file}`, "utf8")))).toEqual(["worker.ts"]);
  });
});
