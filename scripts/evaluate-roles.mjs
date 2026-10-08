// Bounded measurement of the Granite and Qwen roles (Final Pass amendment §7). Synthetic variants of the repository's public seed catalogue
// (typos, dropped words, reordering, plurals) scored against a deterministic baseline with the same candidate lists. Prints counts only.
//   node scripts/evaluate-roles.mjs --dry                 baseline only, no model call
//   node scripts/evaluate-roles.mjs [--granite 120] [--qwen 80] [--glm 10] [--stop-neurons 400] [--terms 40]
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Calls go one at a time, stop at --stop-neurons, and count against the account's
// daily Workers AI allowance. Only a Free-tier, owner-approved run should use it.
import { build } from "esbuild";

const arg = (name, fallback) => process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : fallback;
const dry = process.argv.includes("--dry");
const limits = { granite: arg("--granite", 120), qwen: arg("--qwen", 80), glm: arg("--glm", 10) };
const termCount = arg("--terms", 40);
const stopAt = arg("--stop-neurons", 400);
const root = new URL("..", import.meta.url).pathname;
const { outputFiles } = await build({
  stdin: {
    resolveDir: root,
    contents: `
      export * from "./src/role-evaluation";
      export { ROLE_LIMITS, ROLE_MODELS, arbitrateTask, normalizeTask, readChoice, secondOpinionTask } from "./src/ai-roles";
      import { migratedD1 } from "./tests/d1-sqlite";
      export const seedNames = () => migratedD1().sqlite.prepare("SELECT name FROM items WHERE status <> 'INACTIVE' AND category <> 'UNSORTED' ORDER BY name").all().map((row) => row.name);`
  },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", external: ["node:*"]
});
const m = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const names = [...new Set(m.seedNames())];
const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
if (!dry && (!account || !token)) { console.error("Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Nothing was sent."); process.exit(1); }

const stats = { neurons: 0, calls: 0, failed: 0, ms: [] };
async function ask(role, task) {
  if (stats.neurons >= stopAt) return { stopped: true };
  const limit = m.ROLE_LIMITS[role];
  const started = Date.now();
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${m.ROLE_MODELS[role]}`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ messages: [{ role: "system", content: task.system }, { role: "user", content: task.user }],
        response_format: { type: "json_schema", json_schema: { type: "object", properties: { [task.field]: { type: ["string", "null"], enum: [...task.allowed, null] } }, required: [task.field], additionalProperties: false } },
        max_tokens: limit.maxTokens, temperature: 0, ...(limit.thinkingOption ? { chat_template_kwargs: { enable_thinking: false } } : {}) })
    });
    const body = await response.json().catch(() => ({}));
    stats.calls += 1; stats.ms.push(Date.now() - started);
    if (!response.ok || !body.success) { stats.failed += 1; return { answered: false, value: null }; }
    stats.neurons += Number(body.result?.usage?.neurons ?? limit.reserve);
    return { answered: true, value: m.readChoice(body.result, task) };
  } catch { stats.failed += 1; stats.calls += 1; return { answered: false, value: null }; }
}
const pick = (items, count) => { const step = Math.max(1, Math.floor(items.length / Math.max(1, count))); return items.filter((_, index) => index % step === 0).slice(0, count); };
const pct = (x) => x === null ? "–" : `${Math.round(x * 100)}%`;

// Granite: variants the baseline cannot resolve, with the 40 closest catalogue names offered.
const all = names.flatMap((name) => m.variantsOf(name));
const unresolved = all.filter((v) => m.baselineAnswer(v.text, m.closest(v.text, names, 40)) === null);
const graniteBaseline = m.score(all.map((v) => { const terms = m.closest(v.text, names, 40); return { truth: v.truth, truthOffered: terms.includes(v.truth), baseline: m.baselineAnswer(v.text, terms), model: null, answered: false }; }));
const graniteCases = [];
for (const v of dry ? [] : pick(unresolved, limits.granite)) {
  const terms = m.closest(v.text, names, termCount);
  const task = m.normalizeTask(v.text, terms);
  const result = await ask("TEXT_NORMALIZE", task);
  if (result.stopped) break;
  graniteCases.push({ truth: v.truth, truthOffered: task.allowed.includes(v.truth), baseline: null, model: result.value, answered: result.answered });
}
// Qwen: variants whose two closest names are nearly tied, with 5 candidates offered.
const ambiguous = all.filter((v) => { const top = m.closest(v.text, names, 5).map((n) => m.similarity(v.text, n)); return top[1] >= 0.3 && top[0] - top[1] < 0.15; });
const qwenCases = [];
for (const v of dry ? [] : pick(ambiguous, limits.qwen)) {
  const near = m.closest(v.text, names, 5);
  const task = m.arbitrateTask(v.text, near.map((name, index) => ({ id: `c${index}`, name })));
  const result = await ask("CANDIDATE_ARBITRATE", task);
  if (result.stopped) break;
  const chosen = result.value === null ? null : near[Number(result.value.slice(1))] ?? null;
  qwenCases.push({ truth: v.truth, truthOffered: near.includes(v.truth), baseline: near[0], model: chosen, answered: result.answered });
}
// GLM: only conformance and distribution; its outputs are follow-up questions, not scoreable against a truth here.
const glm = {};
for (let index = 0; !dry && index < limits.glm; index += 1) {
  const codes = m.secondOpinionTask(["CATEGORY_SPLIT", "POSSIBLE_DUPLICATE", "UNIT_SPLIT", "NAME_AND_PHOTO_DISAGREE"].slice(0, 1 + (index % 4)));
  const result = await ask("RARE_SECOND_OPINION", codes);
  if (result.stopped) break;
  const key = result.answered ? (result.value ?? "null") : "failed";
  glm[key] = (glm[key] ?? 0) + 1;
}
const report = (label, s) => `${label}: ${s.cases} cases; truth offered in ${s.truthOffered}; baseline answered ${s.baselineAnswered} (precision ${pct(s.baselinePrecision)}); model answered ${s.modelAnswered} (precision ${pct(s.modelPrecision)}, wrong ${s.modelWrong}); fixes ${s.fixes}, breaks ${s.breaks}; gate: ${JSON.stringify(m.passes(s))}`;
console.log(`catalogue names ${names.length}; variants ${all.length}; baseline alone: ${all.length - unresolved.length} resolved, ${unresolved.length} left to a model; ambiguous ${ambiguous.length}`);
console.log(report("Deterministic baseline, all variants", graniteBaseline));
if (!dry) {
  console.log(report("Granite on baseline-unresolved variants", m.score(graniteCases)));
  console.log(report("Qwen on near-tied variants (baseline = nearest name)", m.score(qwenCases)));
  console.log(`GLM follow-ups: ${JSON.stringify(glm)}`);
  const ms = [...stats.ms].sort((a, b) => a - b);
  console.log(`calls ${stats.calls}, failed ${stats.failed}, Neurons ${Math.round(stats.neurons * 10) / 10}, latency p50 ${ms[Math.floor(ms.length * 0.5)] ?? "–"} ms, p95 ${ms[Math.floor(ms.length * 0.95)] ?? "–"} ms`);
}
