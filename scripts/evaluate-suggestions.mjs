// Leave-one-out measurement of the catalog suggestions (amendment §9). Prints aggregates only: tier counts and hit rates, never item names.
//   npm run evaluate:suggestions                 the repository's own public seed catalog (migrations applied to a throwaway database)
//   npm run evaluate:suggestions -- --from f.json a private local export (an array of items with name, aliases, category, itemType, consumptionMode, unit, stockArea, status);
//                                                 run it privately and never commit the file or its per-item output.
//   npm run evaluate:suggestions -- --ai [--ai-limit 300]
//                                                 also measures the Workers AI second opinion (amendment §13.6) on the same catalog:
//                                                 one call per item whose built-in result is not Strong, sent only through aiPayload
//                                                 (name, other names, live option lists). Needs CLOUDFLARE_ACCOUNT_ID and a
//                                                 CLOUDFLARE_API_TOKEN with Workers AI read access; the calls count against that
//                                                 account's daily allowance (about one Neuron each with the chosen model).
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
      import { AI_MODEL, aiMessages, aiSchema } from "./src/catalog-ai";
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
        const ask = async (payload) => {
          const response = await fetch("https://api.cloudflare.com/client/v4/accounts/" + account + "/ai/run/" + AI_MODEL, {
            method: "POST",
            headers: { authorization: "Bearer " + token, "content-type": "application/json" },
            body: JSON.stringify({ messages: aiMessages(payload), response_format: { type: "json_schema", json_schema: aiSchema(payload) }, max_tokens: 80, temperature: 0 }),
            signal: AbortSignal.timeout(15000)
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || !body.success) throw new Error("Workers AI answered " + response.status);
          return body.result;
        };
        const result = await evaluateWithAi(catalogOf(external), ask, limit);
        return { text: reportAi("Built-in with the knowledge base, plus the Workers AI suggestion (" + AI_MODEL + ")", result), result };
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
