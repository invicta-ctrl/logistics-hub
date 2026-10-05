// Leave-one-out measurement of the catalog suggestions (amendment §9). Prints aggregates only: tier counts and hit rates, never item names.
//   npm run evaluate:suggestions                 the repository's own public seed catalog (migrations applied to a throwaway database)
//   npm run evaluate:suggestions -- --from f.json a private local export (an array of items with name, aliases, category, itemType, consumptionMode, unit, stockArea, status);
//                                                 run it privately and never commit the file or its per-item output.
import fs from "node:fs";
import { build } from "esbuild";

const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : null;
const root = new URL("..", import.meta.url).pathname;
const { outputFiles } = await build({
  stdin: {
    resolveDir: root,
    contents: `
      import { evaluate, report } from "./src/suggest-evaluation";
      import { KNOWLEDGE, KNOWLEDGE_VERSION } from "./src/item-knowledge";
      import { migratedD1 } from "./tests/d1-sqlite";
      export default function run(external) {
        const catalog = external ?? migratedD1().sqlite.prepare("SELECT name, aliases, category, item_type AS itemType, consumption_mode AS consumptionMode, unit, stock_area AS stockArea, status FROM items").all();
        const before = evaluate(catalog, { knowledge: false });
        const after = evaluate(catalog, { knowledge: true });
        return { text: [report("Baseline (look-alike vote only)", before), "", report("With the knowledge base v" + KNOWLEDGE_VERSION + " (" + KNOWLEDGE.length + " entries)", after)].join("\\n"), before, after };
      }`
  },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", external: ["node:*"]
});
const module = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const { text, before, after } = module.default(from ? JSON.parse(fs.readFileSync(from, "utf8")) : null);
console.log(text);
if (process.argv.includes("--json")) console.log(JSON.stringify({ before, after }));
