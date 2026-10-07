// Leave-one-out measurement of the catalog suggestions (amendment §9). Prints aggregates only: tier counts and hit rates, never item names.
//   npm run evaluate:suggestions                 the repository's own public seed catalog (migrations applied to a throwaway database)
//   npm run evaluate:suggestions -- --from f.json a private local export (an array of items with name, aliases, category, itemType, consumptionMode, unit, stockArea, status);
//                                                 run it privately and never commit the file or its per-item output.
//   npm run evaluate:suggestions -- --ai [--ai-limit 300]
//                                                 also measures the Workers AI second opinion (amendment §13.6) on the same catalog:
//                                                 one call per item whose built-in result is not Strong, sent only through aiPayload
//                                                 (name, other names, live option lists). Needs CLOUDFLARE_ACCOUNT_ID and a
//                                                 CLOUDFLARE_API_TOKEN with Workers AI read access; the calls count against that
//                                                 account's daily allowance (measured 2026-10-07: 0.65 Neuron a call, 138 for the
//                                                 seed catalog). It also prints latency, invalid replies and the Neurons Workers AI reported.
import fs from "node:fs";
import { build } from "esbuild";

const arg = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const from = arg("--from");
const withAi = process.argv.includes("--ai");
const limit = Number(arg("--ai-limit") ?? 300);
const root = new URL("..", import.meta.url).pathname;
const { outputFiles } = await build({
  stdin: {
    resolveDir: root,
    contents: `
      import { evaluate, evaluateWithAi, report, reportAi } from "./src/suggest-evaluation";
      import { AI_MODEL, aiMessages, aiReplyText, aiSchema, readAiAnswer } from "./src/catalog-ai";
      import { KNOWLEDGE, KNOWLEDGE_VERSION } from "./src/item-knowledge";
      import { migratedD1 } from "./tests/d1-sqlite";
      const catalogOf = (external) => external ?? migratedD1().sqlite.prepare("SELECT name, aliases, category, item_type AS itemType, consumption_mode AS consumptionMode, unit, stock_area AS stockArea, status FROM items").all();
      export function run(external) {
        const catalog = catalogOf(external);
        const before = evaluate(catalog, { knowledge: false });
        const after = evaluate(catalog, { knowledge: true });
        return { text: [report("Baseline (look-alike vote only)", before), "", report("With the knowledge base v" + KNOWLEDGE_VERSION + " (" + KNOWLEDGE.length + " entries)", after)].join("\\n"), before, after };
      }
      export async function runAi(external, account, token, limit) {
        const stats = { ms: [], invalid: 0, outOfOption: 0, neurons: 0 };
        const ask = async (payload) => {
          const started = Date.now();
          const response = await fetch("https://api.cloudflare.com/client/v4/accounts/" + account + "/ai/run/" + AI_MODEL, {
            method: "POST",
            headers: { authorization: "Bearer " + token, "content-type": "application/json" },
            body: JSON.stringify({ messages: aiMessages(payload), response_format: { type: "json_schema", json_schema: aiSchema(payload) }, max_tokens: 80, temperature: 0 }),
            signal: AbortSignal.timeout(15000)
          });
          const body = await response.json().catch(() => ({}));
          stats.ms.push(Date.now() - started);
          if (!response.ok || !body.success) throw new Error("Workers AI answered " + response.status);
          stats.neurons += Number(body.result?.usage?.neurons ?? 0);
          let reply = aiReplyText(body.result);
          if (typeof reply === "string") { try { reply = JSON.parse(reply); } catch { reply = null; } }
          if (!reply || typeof reply !== "object" || Array.isArray(reply)) stats.invalid += 1;
          else {
            const kept = readAiAnswer({ response: reply }, payload);
            if (["category", "unit", "behaviour"].some((field) => typeof reply[field] === "string" && kept[field] === undefined)) stats.outOfOption += 1;
          }
          return body.result;
        };
        const result = await evaluateWithAi(catalogOf(external), ask, limit);
        const ms = [...stats.ms].sort((a, b) => a - b);
        const at = (share) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(share * ms.length))] + " ms" : "–";
        const usage = { neurons: Math.round(stats.neurons * 10) / 10, invalid: stats.invalid, outOfOption: stats.outOfOption, p50: at(0.5), p95: at(0.95) };
        const text = reportAi("Built-in with the knowledge base, plus the Workers AI suggestion (" + AI_MODEL + ")", result)
          + "\\n  replies: " + usage.invalid + " not JSON, " + usage.outOfOption + " naming a value outside the options; latency p50 " + usage.p50 + ", p95 " + usage.p95 + "; " + usage.neurons + " Neurons reported";
        return { text, result: { ...result, usage } };
      }`
  },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", external: ["node:*"]
});
const module = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const external = from ? JSON.parse(fs.readFileSync(from, "utf8")) : null;
const { text, before, after } = module.run(external);
console.log(text);
let ai = null;
if (withAi) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) {
    console.error("--ai needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI read). Nothing was sent.");
    process.exitCode = 1;
  } else {
    ({ result: ai } = await module.runAi(external, account, token, limit).then((answer) => { console.log(`\n${answer.text}`); return answer; }));
  }
}
if (process.argv.includes("--json")) console.log(JSON.stringify({ before, after, ai }));
