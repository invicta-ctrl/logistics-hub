// Bounded measurement of the Granite and Qwen roles (Final Pass amendment §7). Synthetic variants of the repository's public seed catalogue
// (typos, dropped words, reordering, plurals) scored against a deterministic baseline with the same candidate lists. Prints counts only.
//   node scripts/evaluate-roles.mjs --dry                 baseline only, no model call
//   node scripts/evaluate-roles.mjs [--split tune|test] [--granite 120] [--qwen 80] [--glm 10] [--stop-neurons 400] [--terms 40] [--summary path]
// --split tune (default) uses only the TUNE half of the catalogue, the one prompts may be adjusted against. --split test uses the sealed TEST
// half: run it once per promotion claim, after the prompts are frozen. Names that are not in the catalogue are asked too (the right answer
// is no answer). Hard ceilings below cannot be raised from the command line. Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Calls go one at a time, stop at --stop-neurons, and count against the account's
// daily Workers AI allowance. Only a Free-tier, owner-approved run should use it.
import { build } from "esbuild";

const arg = (name, fallback) => process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : fallback;
const dry = process.argv.includes("--dry");
/** Ceilings no flag can lift: a run is at most this many calls and this many Neurons, and ends after a short run of failures. */
const HARD = { calls: 300, neurons: 400, consecutiveFailures: 5 };
const limits = { granite: Math.min(arg("--granite", 120), 150), qwen: Math.min(arg("--qwen", 80), 100), glm: Math.min(arg("--glm", 10), 20) };
const termCount = Math.min(arg("--terms", 40), 40);
const stopAt = Math.min(arg("--stop-neurons", 400), HARD.neurons);
const splitFlag = process.argv.includes("--split") ? process.argv[process.argv.indexOf("--split") + 1] : "tune";
if (splitFlag !== "tune" && splitFlag !== "test") { console.error("--split is tune or test."); process.exit(1); }
const split = splitFlag.toUpperCase();
const summaryPath = process.argv.includes("--summary") ? process.argv[process.argv.indexOf("--summary") + 1] : null;
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

const stats = { neurons: 0, calls: 0, failed: 0, streak: 0, ms: [] };
async function ask(role, task) {
  const limit = m.ROLE_LIMITS[role];
  // The role's conservative reserve must fit in what is left, and a failed call keeps its reserve (the provider may still have charged it).
  if (stats.neurons + limit.reserve > stopAt || stats.calls >= HARD.calls || stats.streak >= HARD.consecutiveFailures) return { stopped: true };
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
    if (!response.ok || !body.success) { stats.failed += 1; stats.streak += 1; stats.neurons += limit.reserve; return { answered: false, value: null }; }
    stats.streak = 0;
    stats.neurons += Number(body.result?.usage?.neurons ?? limit.reserve);
    return { answered: true, value: m.readChoice(body.result, task) };
  } catch { stats.failed += 1; stats.streak += 1; stats.calls += 1; stats.neurons += limit.reserve; return { answered: false, value: null }; }
}
const pick = (items, count) => { const step = Math.max(1, Math.floor(items.length / Math.max(1, count))); return items.filter((_, index) => index % step === 0).slice(0, count); };
const pct = (x) => x === null ? "–" : `${Math.round(x * 100)}%`;

// Granite: variants the baseline cannot resolve, with the 40 closest catalogue names offered.
// Variants of this half's names only; ones that more than one name could explain are set aside and counted.
const mine = names.filter((name) => m.splitOf(name) === split);
const every = mine.flatMap((name) => m.variantsOf(name));
const ambiguousSetAside = every.filter((v) => m.isAmbiguous(v, names)).length;
const absent = m.absentNames(mine, Math.round(limits.granite / 4));
const all = [...every.filter((v) => !m.isAmbiguous(v, names)), ...absent];
const unresolved = all.filter((v) => m.baselineAnswer(v.text, m.closest(v.text, names, 40)) === null);
const graniteBaseline = m.score(all.map((v) => { const terms = m.closest(v.text, names, 40); return { truth: v.truth, truthOffered: terms.includes(v.truth), baseline: m.baselineAnswer(v.text, terms), model: null, answered: false }; }));
const graniteCases = [];
// Baseline-unresolved variants plus the names that are not in the catalogue (kept in the same run so abstaining is measured).
for (const v of dry ? [] : [...pick(unresolved.filter((each) => each.truth !== null), limits.granite - absent.length), ...absent]) {
  const terms = m.closest(v.text, names, termCount);
  const task = m.normalizeTask(v.text, terms);
  const result = await ask("TEXT_NORMALIZE", task);
  if (result.stopped) break;
  graniteCases.push({ truth: v.truth, truthOffered: task.allowed.includes(v.truth), baseline: null, model: result.value, answered: result.answered });
}
// Qwen: variants whose two closest names are nearly tied, with 5 candidates offered.
const ambiguous = all.filter((v) => v.truth !== null).filter((v) => { const top = m.closest(v.text, names, 5).map((n) => m.similarity(v.text, n)); return top[1] >= 0.3 && top[0] - top[1] < 0.15; });
const qwenCases = [];
const absentForQwen = absent.slice(0, Math.round(limits.qwen / 4));
for (const v of dry ? [] : [...pick(ambiguous, limits.qwen - absentForQwen.length), ...absentForQwen]) {
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
const report = (label, s, options) => `${label}: ${s.cases} cases (${s.absentCases} with no right name); truth offered in ${s.truthOffered}; baseline answered ${s.baselineAnswered} (precision ${pct(s.baselinePrecision)}); model answered ${s.modelAnswered} (coverage ${pct(s.coverage)}, precision ${pct(s.modelPrecision)}, wrong ${s.modelWrong}, answered where no name was right ${s.absentAnswered}); fixes ${s.fixes}, breaks ${s.breaks}${options?.netBenefit === false ? " (breaks are zero by construction here)" : ""}; gate: ${JSON.stringify(m.passes(s, options))}`;
const lines = [];
const say = (line) => { lines.push(line); console.log(line); };
say(`split ${split}${split === "TEST" ? " (sealed: run once per promotion claim)" : " (tuning half)"}; catalogue names ${names.length}, this half ${mine.length}; variants ${all.length} (${ambiguousSetAside} ambiguous set aside, ${absent.length} not in the catalogue); baseline alone: ${all.length - unresolved.length} resolved, ${unresolved.length} left to a model; near-tied ${ambiguous.length}`);
say(report("Deterministic baseline, all variants", graniteBaseline));
if (!dry) {
  say(report("Granite on baseline-unresolved variants", m.score(graniteCases), { netBenefit: false }));
  say(report("Qwen on near-tied variants (baseline = nearest name)", m.score(qwenCases)));
  say(`GLM follow-ups: ${JSON.stringify(glm)}`);
  const ms = [...stats.ms].sort((a, b) => a - b);
  say(`calls ${stats.calls} (ceiling ${HARD.calls}), failed ${stats.failed}, Neurons ${Math.round(stats.neurons * 10) / 10} (ceiling ${stopAt}), latency p50 ${ms[Math.floor(ms.length * 0.5)] ?? "–"} ms, p95 ${ms[Math.floor(ms.length * 0.95)] ?? "–"} ms. These calls use the REST API and are not in the app's daily counter.`);
}
if (summaryPath) (await import("node:fs")).writeFileSync(summaryPath, `${lines.join("\n")}\n`);
