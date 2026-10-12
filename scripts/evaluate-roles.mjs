// Bounded measurement of the Granite and Qwen roles (Final Pass amendment §7). Synthetic variants of the repository's public seed catalogue
// (typos, dropped words, reordering, plurals) scored against a deterministic baseline with the same candidate lists. Prints counts only.
//   node scripts/evaluate-roles.mjs --dry                 baseline only, no model call
//   node scripts/evaluate-roles.mjs [--split tune|test] [--granite 120] [--qwen 80] [--glm 10] [--stop-neurons 400] [--terms 40] [--summary path]
// Guarded text qualification: --guarded <new-frozen-public.json> --prior-neurons <verified-receipt-total>; no promotion or spent-fixture reuse.
// Photo qualification: --photos <frozen-public-manifest> --prior-neurons <verified-text-receipt-total> [--dry]; no text inference rerun.
// Fresh V1.16: --fixtures <reviewed-public.json> [--challenger qwen]; the challenger uses the same normalization tasks only.
// --split tune (default) uses only the TUNE half of the catalogue, the one prompts may be adjusted against. --split test uses the sealed TEST
// half: run it once per promotion claim, after the prompts are frozen. Names that are not in the catalogue are asked too (the right answer
// is no answer). Hard ceilings below cannot be raised from the command line. Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Calls go one at a time, stop at --stop-neurons, and count against the account's
// daily Workers AI allowance. Only a Free-tier, owner-approved run should use it.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createHash } from "node:crypto";

const valueFlags = new Set(["--fixtures", "--challenger", "--granite", "--qwen", "--glm", "--stop-neurons", "--terms", "--split", "--summary", "--photos", "--guarded", "--prior-neurons"]);
const seenFlags = new Set();
for (let index = 2; index < process.argv.length; index += 1) {
  const flag = process.argv[index];
  if (seenFlags.has(flag) || (flag !== "--dry" && !valueFlags.has(flag)) || (valueFlags.has(flag) && (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")))) { console.error("Unknown, repeated, or missing evaluation argument. Nothing was sent."); process.exit(1); }
  seenFlags.add(flag);
  if (valueFlags.has(flag)) index += 1;
}
const arg = (name, fallback) => {
  const value = process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : fallback;
  if (!Number.isFinite(value)) { console.error("Evaluation limits must be finite. Nothing was sent."); process.exit(1); }
  return value;
};
const dry = process.argv.includes("--dry");
const textArg = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const guardedPath = textArg("--guarded");
const guarded = Boolean(guardedPath);
const fixturePath = textArg("--fixtures") ?? guardedPath;
const photoPath = textArg("--photos");
if ((guarded && (process.argv.includes("--fixtures") || process.argv.includes("--challenger"))) || (photoPath && (fixturePath || process.argv.includes("--challenger")))) { console.error("Choose raw text, guarded text or photo qualification. Nothing was sent."); process.exit(1); }
const challenger = textArg("--challenger");
if (process.argv.includes("--fixtures") && (!fixturePath || fixturePath.startsWith("--"))) { console.error("--fixtures needs a reviewed public fixture file."); process.exit(1); }
if (process.argv.includes("--challenger") && (challenger !== "qwen" || !fixturePath)) { console.error("The only permitted challenger is qwen, with --fixtures; production role mappings stay unchanged."); process.exit(1); }
/** Ceilings no flag can lift: a run is at most this many calls and this many Neurons, and ends after a short run of failures. */
const HARD = { calls: 300, neurons: 400, consecutiveFailures: 5 };
const limits = { granite: Math.min(arg("--granite", 120), 150), qwen: Math.min(arg("--qwen", 80), 100), glm: Math.min(arg("--glm", 10), 20) };
const termCount = Math.min(arg("--terms", 40), 40);
const stopAt = Math.min(arg("--stop-neurons", 400), HARD.neurons);
if (Object.values(limits).some((n) => !Number.isInteger(n) || n < 0) || !Number.isInteger(termCount) || termCount < 1 || !Number.isFinite(stopAt) || stopAt <= 0) { console.error("Call limits must be non-negative integers; terms and the Neuron cap must be positive."); process.exit(1); }
const priorNeurons = arg("--prior-neurons", 0);
if (priorNeurons < 0 || priorNeurons > 400 || (!dry && (photoPath || guarded) && (!process.argv.includes("--prior-neurons") || priorNeurons < 128.288))) { console.error("Guard/photo inference needs a conservative verified prior receipt total (at least 128.288), within 400. Nothing was sent."); process.exit(1); }
const splitFlag = process.argv.includes("--split") ? process.argv[process.argv.indexOf("--split") + 1] : "tune";
if (splitFlag !== "tune" && splitFlag !== "test") { console.error("--split is tune or test."); process.exit(1); }
const split = splitFlag.toUpperCase();
const summaryPath = process.argv.includes("--summary") ? process.argv[process.argv.indexOf("--summary") + 1] : null;
const root = fileURLToPath(new URL("..", import.meta.url));
const { outputFiles } = await build({
  stdin: {
    resolveDir: root,
    contents: `
      export * from "./src/role-evaluation";
      export { aiReplyText } from "./src/catalog-ai";
      export { PHOTO_MODEL, PHOTO_RESERVE, photoName, readPhotoReading, resetBreaker } from "./src/ambient-assist";
      export { ROLE_LIMITS, ROLE_MODELS, FACT_CODES, FOLLOW_UPS, arbitrateTask, normalizeTask, readChoice, secondOpinionTask, runRole, resetRoleBreakers, ROUTE_STATE } from "./src/ai-roles";
      import { migratedD1 } from "./tests/d1-sqlite";
      export { migratedD1 };
      export const seedNames = () => migratedD1().sqlite.prepare("SELECT name FROM items WHERE status <> 'INACTIVE' AND category <> 'UNSORTED' ORDER BY name").all().map((row) => row.name);`
  },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", external: ["node:*"]
});
const m = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
// Both modes read one bounded regular-file descriptor snapshot; no symlink/path replacement may change approved egress.
function fixtureBytes(path) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error();
    const buffer = Buffer.alloc(512_001); let count = 0;
    while (count < buffer.length) { const read = fs.readSync(fd, buffer, count, buffer.length - count, count); if (!read) break; count += read; }
    if (count > 512_000) throw new Error();
    return buffer.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
let fixture = null, fixtureHash = null;
const PUBLIC_FIXTURE_SHA256 = guarded ? "da86911b98bf97973e0b5c38b1706ff9c235146986307fef86696095f0f81467" : "72d23615672d32fddca71650bd02ea48952df1e8f88556cb4748de97ef404297";
if (fixturePath) {
  try {
    const bytes = fixtureBytes(fixturePath);
    fixtureHash = createHash("sha256").update(bytes).digest("hex");
    if (!dry && fixtureHash !== PUBLIC_FIXTURE_SHA256) { console.error("Unreviewed fixture bytes. No inference was sent."); process.exit(2); }
    fixture = JSON.parse(bytes);
    if (!fixture || typeof fixture !== "object" || typeof fixture.fixtureVersion !== "string" || !fixture.fixtureVersion.trim() || fixture.fixtureVersion.length > 80
      || !Array.isArray(fixture.nameCases) || !fixture.nameCases.length || fixture.nameCases.length > (guarded ? 40 : 150)) throw new Error();
    const ids = new Set();
    for (const each of fixture.nameCases) {
      if (!each || typeof each.id !== "string" || !each.id || each.id.length > 80 || ids.has(each.id)
        || typeof each.name !== "string" || !each.name.trim() || each.name.length > 80
        || !Array.isArray(each.terms) || each.terms.length < 2 || each.terms.length > 40
        || each.terms.some((term) => typeof term !== "string" || !term.trim() || term.length > 60 || /[\x00-\x1f]/.test(term))
        || new Set(each.terms).size !== each.terms.length || /[\x00-\x1f]/.test(each.name)
        || !(each.truth === null || (typeof each.truth === "string" && each.terms.includes(each.truth)))) throw new Error();
      ids.add(each.id);
      const task = m.normalizeTask(each.name, each.terms);
      if (each.truth !== null && !task.allowed.includes(each.truth)) throw new Error();
    }
    if (!Array.isArray(fixture.followUpCases) || fixture.followUpCases.length > 20) throw new Error();
    for (const each of fixture.followUpCases) {
      if (!each || !Array.isArray(each.facts) || each.facts.length > m.FACT_CODES.length || new Set(each.facts).size !== each.facts.length
        || each.facts.some((code) => !m.FACT_CODES.includes(code)) || !Array.isArray(each.acceptable) || !each.acceptable.length
        || each.acceptable.some((code) => code !== null && !m.FOLLOW_UPS.includes(code))) throw new Error();
    }
  } catch { console.error("Invalid bounded fixture file. Nothing was sent."); process.exit(1); }
}
let photoFixture = null, photoFixtureHash = null;
if (photoPath) {
  try {
    const bytes = fixtureBytes(photoPath);
    photoFixtureHash = createHash("sha256").update(bytes).digest("hex");
    if (photoFixtureHash !== "fc57239292b72193ef2059ef317fbfac0a3469b74d83e5d8ac56ba3ff587f5ee") { console.error("Unreviewed photo manifest. No inference was sent."); process.exit(2); }
    photoFixture = JSON.parse(bytes);
    if (!photoFixture || !Array.isArray(photoFixture.photos) || !photoFixture.photos.length || photoFixture.photos.length > 40) throw new Error();
    const ids = new Set();
    for (const each of photoFixture.photos) {
      const diagnostic = each.kind === "OFFICE_DIAGNOSTIC";
      const url = diagnostic ? null : new URL(each.source);
      if (typeof each.id !== "string" || ids.has(each.id) || !["POSITIVE", "NON_ITEM", "AMBIGUOUS", "OFFICE_DIAGNOSTIC"].includes(each.kind)
        || !/^[a-f0-9]{64}$/.test(each.sha256)
        || (diagnostic ? each.source !== "LOGISTICS_PUBLIC_CALCULATOR" || each.itemName !== "2-Liner Scientific Calculator"
          : url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com" || url.search || url.hash
            || !/^\/(?:marcusklasson\/GroceryStoreDataset\/fc80ba90f803d79d0383df52c5a4ac5de99ff6fc\/dataset\/test\/|scikit-image\/scikit-image\/e8a42ba85aaf5fd9322ef9ca51bc21063b22fcae\/skimage\/data\/)/.test(url.pathname))
        || !(each.kind === "AMBIGUOUS" ? each.acceptableNames === null : Array.isArray(each.acceptableNames))
        || (Array.isArray(each.acceptableNames) && each.acceptableNames.some((name) => typeof name !== "string" || !name || name.length > 60))
        || ["acceptableBrands", "acceptableModels"].some((field) => !Array.isArray(each[field]) || each[field].length > 8 || each[field].some((value) => typeof value !== "string" || !value || value.length > 60))) throw new Error();
      ids.add(each.id);
    }
  } catch { console.error("Invalid bounded photo manifest. No inference was sent."); process.exit(1); }
}
const names = fixture || photoFixture ? [] : [...new Set(m.seedNames())];
const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
if (!dry && (!account || !token)) { console.error("Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Nothing was sent."); process.exit(1); }

// The fresh qualification path uses only the currently accepted Free models. Catalog reads consume no inference allowance.
if (!dry && (fixture || photoFixture)) {
  const permitted = new Set(["@cf/google/gemma-4-26b-a4b-it", "@cf/ibm-granite/granite-4.0-h-micro", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/zai-org/glm-4.7-flash"]);
  if (!/^[a-f0-9]{32}$/i.test(account)) { console.error("Account identity is invalid. No inference was sent."); process.exit(2); }
  for (const model of Object.values(m.ROLE_MODELS)) {
    if (!permitted.has(model)) { console.error("Model is outside the accepted Free allowlist. No inference was sent."); process.exit(2); }
    let refusal = "CATALOG_UNAVAILABLE";
    try {
      const endpoint = new URL(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/models/search`);
      endpoint.searchParams.set("search", model);
      const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      const body = await response.json().catch(() => ({}));
      refusal = response.status === 401 || response.status === 403 ? "ACCESS_DENIED" : response.status === 429 || body.errors?.some((error) => error?.code === 3040) ? "RATE_LIMITED" : "CATALOG_INVALID";
      const found = Array.isArray(body.result) ? body.result.find((each) => each?.name === model) : null;
      if (!response.ok || !body.success || !found || found.properties?.some((property) => /deprecat/i.test(property.property_id) && [true, "true", "1"].includes(property.value))) throw new Error();
      console.log(`catalog preflight available: ${model}`);
    } catch { console.error(`Catalog preflight ${refusal}. No inference was sent.`); process.exit(2); }
  }
  console.log("Catalog availability is not invocation/quality evidence; account-wide allowance headroom is UNMEASURED here. Free-only per-run caps remain enforced.");
}

const stats = { neurons: 0, calls: 0, failed: 0, streak: 0, ms: [], calibrationErrors: 0, halt: null };
const byModel = new Map();
const bucketFor = (role, model) => {
  const key = `${role}:${model}`;
  if (!byModel.has(key)) byModel.set(key, { task: role, model, calls: 0, available: 0, valid: 0, answers: 0, abstentions: 0, invalid: 0,
    failures: {}, ms: [], providerReportedNeurons: 0, reportedCalls: 0, fallbackReservedNeurons: 0 });
  return byModel.get(key);
};
// readChoice deliberately collapses invalid output and null for runtime safety; measurement distinguishes them without weakening it.
function checkedChoice(reply, task) {
  let decoded = m.aiReplyText(reply);
  if (decoded === null || decoded === undefined) {
    const message = reply?.choices?.[0]?.message;
    decoded = message?.reasoning_content ?? message?.reasoning;
  }
  if (typeof decoded === "string") { try { decoded = JSON.parse(decoded.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return { valid: false, value: null }; } }
  const valid = Boolean(decoded && typeof decoded === "object" && !Array.isArray(decoded) && Object.keys(decoded).length === 1
    && Object.keys(decoded)[0] === task.field && (decoded[task.field] === null || task.allowed.includes(decoded[task.field])));
  return { valid, value: valid ? m.readChoice(reply, task) : null };
}
async function invoke(role, model, input, reserve) {
  const limit = { reserve };
  // A failed request keeps its reservation: a timeout cannot prove the provider did not charge it.
  if (stats.neurons + limit.reserve > stopAt || stats.calls >= HARD.calls || stats.streak >= HARD.consecutiveFailures || stats.calibrationErrors || stats.halt || ((guarded || photoFixture) && priorNeurons + stats.neurons + limit.reserve > 400) || (photoFixture && (stats.calls >= 40 || stats.neurons + limit.reserve > 240))) return { stopped: true };
  const bucket = bucketFor(role, model);
  const started = Date.now();
  stats.calls += 1; bucket.calls += 1;
  const failed = (code) => {
    stats.failed += 1; stats.streak += 1; stats.neurons += limit.reserve; bucket.fallbackReservedNeurons += limit.reserve;
    bucket.failures[code] = (bucket.failures[code] ?? 0) + 1;
    if (code === "RATE_LIMITED" || code === "ACCESS_DENIED") stats.halt = code;
    return { answered: false, value: null };
  };
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(10000),
      // lgtm[js/file-access-to-http] Only SHA256-verified public fixture bytes reach inference; private or changed files are refused before any request.
      body: JSON.stringify(input)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) return failed(response.status === 401 || response.status === 403 ? "ACCESS_DENIED" : response.status === 429 || body.errors?.some((error) => error?.code === 3040) ? "RATE_LIMITED" : response.status >= 500 ? "PROVIDER_ERROR" : "CALL_FAILED");
    bucket.available += 1;
    const used = body.result?.usage?.neurons;
    if (typeof used === "number" && Number.isFinite(used) && used >= 0) {
      stats.neurons += used; bucket.providerReportedNeurons += used; bucket.reportedCalls += 1;
      if (used > limit.reserve) stats.calibrationErrors += 1;
    } else { stats.neurons += limit.reserve; bucket.fallbackReservedNeurons += limit.reserve; }
    return { available: true, reply: body.result };
  } catch (error) { return failed(error?.name === "TimeoutError" || error?.name === "AbortError" ? "CALL_TIMEOUT" : "CALL_FAILED"); }
  finally { const ms = Date.now() - started; stats.ms.push(ms); bucket.ms.push(ms); }
}
async function ask(role, task, challengerCall = false) {
  const limit = m.ROLE_LIMITS[challengerCall ? "CANDIDATE_ARBITRATE" : role];
  const model = m.ROLE_MODELS[challengerCall ? "CANDIDATE_ARBITRATE" : role];
  const result = await invoke(role, model, { messages: [{ role: "system", content: task.system }, { role: "user", content: task.user }],
    response_format: { type: "json_schema", json_schema: { type: "object", properties: { [task.field]: { type: ["string", "null"], enum: [...task.allowed, null] } }, required: [task.field], additionalProperties: false } },
    max_tokens: m.ROLE_LIMITS[role].maxTokens, temperature: 0, ...(limit.thinkingOption ? { chat_template_kwargs: { enable_thinking: false } } : {}) }, limit.reserve);
  if (!result.available) return result;
  const bucket = bucketFor(role, model), answer = checkedChoice(result.reply, task);
  if (!answer.valid) { bucket.invalid += 1; stats.streak += 1; return { answered: false, value: null }; }
  stats.streak = 0; bucket.valid += 1;
  if (answer.value === null) bucket.abstentions += 1; else bucket.answers += 1;
  return { answered: true, value: answer.value };
}
const pick = (items, count) => { const step = Math.max(1, Math.floor(items.length / Math.max(1, count))); return items.filter((_, index) => index % step === 0).slice(0, count); };
const pct = (x) => x === null ? "–" : `${Math.round(x * 100)}%`;

const report = (label, s, options) => `${label}: ${s.cases} cases (${s.absentCases} with no right name); truth offered in ${s.truthOffered}; baseline answered ${s.baselineAnswered} (precision ${pct(s.baselinePrecision)}); model answered ${s.modelAnswered} (coverage ${pct(s.coverage)}, precision ${pct(s.modelPrecision)}, wrong ${s.modelWrong}, answered where no name was right ${s.absentAnswered}); fixes ${s.fixes}, breaks ${s.breaks}${options?.netBenefit === false ? " (breaks are zero by construction here)" : ""}; gate: ${JSON.stringify(m.passes(s, options))}`;
const lines = [];
const say = (line) => { lines.push(line); console.log(line); };
if (guarded) {
  say(`guarded fixture ${fixture.fixtureVersion}; sha256 ${fixtureHash}; ${fixture.nameCases.length} cases (${fixture.nameCases.filter((each) => each.truth !== null).length} positives); exact current runRole adapters; production roles remain REVIEW_ONLY`);
  say("Raw provider scores cover only actually invoked cases; pre-call suppression is not provider abstention. Guarded scores cover completed cases including suppression. This diagnostic is not a model promotion claim or a representative USC population.");
  const baseline = m.score(fixture.nameCases.map((each) => ({ truth: each.truth, truthOffered: each.terms.includes(each.truth), baseline: m.baselineAnswer(each.name, each.terms), model: null, answered: false })));
  say(report("Deterministic baseline, guarded fresh cases before inference", baseline));
  if (dry) say("guarded dry validation only: zero inference calls; provider and guarded quality/availability/cost are UNMEASURED");
  else {
    const local = m.migratedD1(); m.resetRoleBreakers();
    const core = () => local.sqlite.prepare("SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM inventory_movements) AS movements, (SELECT COALESCE(SUM(on_hand),0) FROM inventory_balances) AS onHand, (SELECT COUNT(*) FROM loans) AS loans").get();
    const before = JSON.stringify(core());
    let refusedCoreWrite = false;
    const db = { ...local.d1, prepare(sql) {
      if (!/^\s*SELECT\b/i.test(sql) && !/^\s*(?:INSERT INTO|DELETE FROM) system_settings\b/i.test(sql)) { refusedCoreWrite = true; throw new Error("CORE_WRITE_REFUSED"); }
      return local.d1.prepare(sql);
    } };
    const expected = {}, completed = {};
    for (const role of ["TEXT_NORMALIZE", "CANDIDATE_ARBITRATE"]) {
      const count = Math.min(role === "TEXT_NORMALIZE" ? limits.granite : limits.qwen, fixture.nameCases.length);
      expected[role] = count; completed[role] = 0;
      if (m.ROUTE_STATE[role] !== "REVIEW_ONLY") { stats.halt = "REVIEW_ONLY_CONTRACT"; break; }
      const raw = [], shown = [], durations = [], reasons = {};
      let preSuppressed = 0, postVetoed = 0, unavailable = 0;
      for (const each of fixture.nameCases.slice(0, count)) {
        const reserve = m.ROLE_LIMITS[role].reserve;
        if (stats.halt || stats.calibrationErrors || stats.streak >= HARD.consecutiveFailures || stats.calls >= HARD.calls || stats.neurons + reserve > stopAt || priorNeurons + stats.neurons + reserve > 400) break;
        const terms = each.terms.slice(0, 5);
        const task = role === "TEXT_NORMALIZE" ? m.normalizeTask(each.name, each.terms) : m.arbitrateTask(each.name, terms.map((name, index) => ({ id: `c${index}`, name })));
        const chosenName = (value) => role === "TEXT_NORMALIZE" ? value : value === null ? null : terms[Number(value.slice(1))] ?? null;
        const source = { truth: each.truth, truthOffered: role === "TEXT_NORMALIZE" ? task.allowed.includes(each.truth) : terms.includes(each.truth), baseline: m.baselineAnswer(each.name, role === "TEXT_NORMALIZE" ? task.allowed : terms) };
        const started = Date.now();
        let transport = null, decoded = null, pending = null;
        const result = await m.runRole(db, { run(model, input) {
          if (model !== m.ROLE_MODELS[role] || input.max_tokens !== m.ROLE_LIMITS[role].maxTokens) throw new Error("TEXT_CONTRACT_REFUSED");
          pending = invoke(role, model, input, reserve).then((reply) => {
            transport = reply;
            if (!reply.available) { const error = new Error("PROVIDER_UNAVAILABLE"); error.status = stats.halt === "ACCESS_DENIED" ? 403 : stats.halt === "RATE_LIMITED" ? 429 : 500; throw error; }
            decoded = checkedChoice(reply.reply, task);
            const bucket = bucketFor(role, model);
            if (decoded.valid) { bucket.valid += 1; stats.streak = 0; if (decoded.value === null) bucket.abstentions += 1; else bucket.answers += 1; }
            else { bucket.invalid += 1; stats.streak += 1; }
            return reply.reply;
          });
          return pending;
        } }, role, task, "USER");
        if (pending) await pending.catch(() => {});
        if (result.value !== null || result.observed !== null || (result.proposal && (result.proposal.kind !== "REVIEW_ONLY" || result.proposal.role !== role || result.proposal.field !== task.field))) { stats.halt = "REVIEW_ONLY_CONTRACT"; break; }
        if (!pending && result.reason !== "INSUFFICIENT_EVIDENCE") { stats.halt = result.reason; break; }
        durations.push(Date.now() - started); completed[role] += 1;
        reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
        if (!pending) preSuppressed += 1;
        else {
          raw.push({ ...source, model: decoded?.valid ? chosenName(decoded.value) : null, answered: Boolean(decoded?.valid) });
          if (!transport?.available) unavailable += 1;
          if (decoded?.valid && decoded.value !== null && result.reason === "INSUFFICIENT_EVIDENCE") postVetoed += 1;
        }
        shown.push({ ...source, model: result.proposal ? chosenName(result.proposal.value) : null, answered: result.outcome === "ANSWER" || Boolean(pending && decoded?.valid) });
      }
      const rawScore = m.score(raw), guardedScore = m.score(shown), sorted = [...durations].sort((a, b) => a - b);
      const latency = (share) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] : null;
      say(report(`${role}, raw provider invoked subset`, rawScore));
      say(report(`${role}, guarded end-to-end`, guardedScore));
      const summary = { role, expected: count, completed: completed[role], providerInvoked: raw.length, preSuppressed, postVetoed, providerUnavailable: unavailable, reasons,
        rawPopulation: "INVOKED_SUBSET_ONLY", rawScore, guardedScore, rawGate: m.passes(rawScore), guardedGate: m.passes(guardedScore),
        guardedP50Ms: latency(0.5), guardedP95Ms: latency(0.95), promotion: "NOT_AUTHORIZED_REVIEW_ONLY" };
      say(`guarded measurement ${JSON.stringify(summary)}`);
    }
    const coreUnchanged = !refusedCoreWrite && before === JSON.stringify(core());
    const complete = ["TEXT_NORMALIZE", "CANDIDATE_ARBITRATE"].every((role) => expected[role] !== undefined && completed[role] === expected[role]) && coreUnchanged && !stats.halt && !stats.calibrationErrors;
    say(`guarded receipt ${JSON.stringify({ expected, completed, complete, coreUnchanged, stopped: stats.halt ?? (stats.calibrationErrors ? "RESERVATION_CALIBRATION" : !complete ? "BUDGET_OR_FAILURE_STREAK" : null),
      priorVerifiedAccountedNeurons: priorNeurons, guardedAccountedNeurons: stats.neurons, combinedAccountedNeurons: priorNeurons + stats.neurons, combinedCap: 400, rolesRemainReviewOnly: true })}`);
    local.sqlite.close(); if (!complete) process.exitCode = 2;
  }
} else if (photoFixture) {
  say(`photo fixture ${photoFixture.fixtureVersion}; sha256 ${photoFixtureHash}; ${photoFixture.photos.length} images; exact current preparePhoto/photoName adapters; no promotion or general USC claim`);
  const { chromium } = await import("@playwright/test");
  const client = await build({ stdin: { resolveDir: root, contents: 'export { preparePhoto } from "./src/item-photo";' }, bundle: true, platform: "browser", format: "iife", globalName: "PhotoQualification", write: false, logLevel: "silent" });
  const browserEnv = { ...process.env }; delete browserEnv.CLOUDFLARE_API_TOKEN; delete browserEnv.CLOUDFLARE_ACCOUNT_ID; delete browserEnv.GH_TOKEN; delete browserEnv.GITHUB_TOKEN; delete browserEnv.SESSION_SECRET;
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}), env: browserEnv });
  const prepared = [];
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent('<main id="app"></main>');
    await page.addScriptTag({ content: client.outputFiles[0].text });
    const download = async (source) => {
      const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(10000) });
      if (!response.ok || !response.body) throw new Error();
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 1_000_000) throw new Error(); chunks.push(Buffer.from(chunk)); }
      return Buffer.concat(chunks);
    };
    // Download/verify/prepare every approved source before the first inference. The public diagnostic stores no media identifiers.
    for (const each of photoFixture.photos) {
      let source = each.source;
      if (each.kind === "OFFICE_DIAGNOSTIC") {
        const catalog = JSON.parse((await download("https://logistics.hausc.org/api/public/catalog")).toString("utf8"));
        const matches = catalog.items?.filter((item) => item.name === each.itemName);
        if (matches?.length !== 1 || !/^[a-f0-9-]{36}$/.test(matches[0].photo)) throw new Error();
        source = `https://logistics.hausc.org/api/public/media/${matches[0].photo}/detail?v=2`;
      }
      const bytes = await download(source);
      if (createHash("sha256").update(bytes).digest("hex") !== each.sha256) throw new Error();
      const type = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : null;
      if (!type) throw new Error();
      const thumbnail = await page.evaluate(async ({ bytes, type }) => {
        const result = await PhotoQualification.preparePhoto(new File([new Uint8Array(bytes)], "approved-public-fixture", { type }));
        const image = await createImageBitmap(result.thumb);
        try { return { bytes: Array.from(new Uint8Array(await result.thumb.arrayBuffer())), type: result.thumb.type, width: image.width, height: image.height }; }
        finally { image.close(); }
      }, { bytes: [...bytes], type });
      if (thumbnail.type !== "image/jpeg" || Math.max(thumbnail.width, thumbnail.height) > 320 || thumbnail.bytes.length > 400_000) throw new Error();
      prepared.push({ each, jpeg: new Uint8Array(thumbnail.bytes) });
    }
  } catch { console.error("Photo source/prepare validation failed. No inference was sent."); await browser.close(); process.exit(2); }
  await browser.close();
  say(`photo preparation ${JSON.stringify({ approved: prepared.length, encoded: "JPEG", maximumEdge: 320, sourceHashesVerified: true, noBrowserProviderCredentials: true })}`);
  if (dry) say("photo dry validation: zero inference calls; accuracy/cost/availability UNMEASURED");
  else {
    const local = m.migratedD1(); m.resetBreaker();
    const core = () => local.sqlite.prepare("SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM inventory_movements) AS movements, (SELECT COALESCE(SUM(on_hand),0) FROM inventory_balances) AS onHand, (SELECT COUNT(*) FROM loans) AS loans").get();
    const before = JSON.stringify(core());
    const caseResults = [], officeDiagnostics = [];
    const scored = { completed: 0, emittedNames: 0, scoredAnswers: 0, correctNames: 0, wrongNames: 0, positiveCases: photoFixture.photos.filter((each) => each.kind === "POSITIVE").length, positiveAnswers: 0,
      negativeCases: photoFixture.photos.filter((each) => each.kind === "NON_ITEM").length, negativeAnswers: 0, abstentions: 0, invalidFallbacks: 0, unscoredAmbiguousNames: 0, unsupportedPrintedIdentifiers: 0, brandAnswers: 0, supportedBrands: 0, unsupportedBrands: 0, expectedBrandCases: photoFixture.photos.filter((each) => each.acceptableBrands.length).length,
      positiveBrandAnswers: 0, modelAnswers: 0, supportedModels: 0, unsupportedModels: 0, expectedModelCases: photoFixture.photos.filter((each) => each.acceptableModels.length).length, outcomes: {} };
    const flat = (name) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    for (const { each, jpeg } of prepared) {
      if (stats.halt || stats.calibrationErrors || stats.streak >= HARD.consecutiveFailures || stats.neurons + m.PHOTO_RESERVE > Math.min(stopAt, 240) || priorNeurons + stats.neurons + m.PHOTO_RESERVE > 400) break;
      let transport = null, pending = null;
      const answer = await m.photoName(local.d1, { run: (model, input) => {
        if (model !== m.PHOTO_MODEL || model !== m.ROLE_MODELS.VISION_EXTRACT || input.max_tokens !== 64) throw new Error("PHOTO_CONTRACT_REFUSED");
        pending = invoke("VISION_EXTRACT", model, input, m.PHOTO_RESERVE).then((result) => {
          transport = result;
          if (!result.available) { const error = new Error("PROVIDER_UNAVAILABLE"); error.status = stats.halt === "ACCESS_DENIED" ? 403 : stats.halt === "RATE_LIMITED" ? 429 : 500; throw error; }
          return result.reply;
        });
        return pending;
      } }, jpeg, "USER", "PHOTO_QUALIFICATION");
      if (pending) await pending.catch(() => {});
      scored.outcomes[answer.outcome] = (scored.outcomes[answer.outcome] ?? 0) + 1;
      if (!pending) { stats.halt = answer.outcome; break; }
      scored.completed += 1;
      if (!transport?.available) { caseResults.push({ fixture: each.id, result: "PROVIDER_UNAVAILABLE" }); continue; }
      const bucket = bucketFor("VISION_EXTRACT", m.PHOTO_MODEL);
      let decoded = m.aiReplyText(transport.reply);
      if (typeof decoded === "string") { try { decoded = JSON.parse(decoded); } catch { decoded = null; } }
      const valid = Boolean(decoded && typeof decoded === "object" && !Array.isArray(decoded) && Object.keys(decoded).length === 4
        && ["name", "brand", "model", "packaging"].every((field) => decoded[field] === null || typeof decoded[field] === "string"));
      if (valid) { bucket.valid += 1; stats.streak = 0; } else { bucket.invalid += 1; stats.streak += 1; }
      if (answer.name) { if (valid) bucket.answers += 1; scored.emittedNames += 1; } else { if (valid) { bucket.abstentions += 1; scored.abstentions += 1; } else scored.invalidFallbacks += 1; }
      if (each.kind === "OFFICE_DIAGNOSTIC") {
        officeDiagnostics.push({ fixture: each.id, nameAnswered: Boolean(answer.name), correctName: Boolean(answer.name && each.acceptableNames.some((expected) => flat(expected) === flat(answer.name))),
          brandAnswered: Boolean(answer.reading?.brand), supportedBrand: Boolean(answer.reading?.brand && each.acceptableBrands.some((expected) => flat(expected) === flat(answer.reading.brand))),
          modelAnswered: Boolean(answer.reading?.model), supportedModel: Boolean(answer.reading?.model && each.acceptableModels.some((expected) => flat(expected) === flat(answer.reading.model))),
          population: "CURRENT_PUBLIC_DIAGNOSTIC_NOT_HELDOUT" });
      } else if (each.kind === "AMBIGUOUS") { if (answer.name) scored.unscoredAmbiguousNames += 1; }
      else {
        if (each.kind === "POSITIVE") { if (answer.name) scored.positiveAnswers += 1; }
        else { if (answer.name) scored.negativeAnswers += 1; }
        if (answer.name) { scored.scoredAnswers += 1; if (each.acceptableNames.some((expected) => flat(expected) === flat(answer.name))) scored.correctNames += 1; else scored.wrongNames += 1; }
      }
      caseResults.push({ fixture: each.id, result: each.kind === "AMBIGUOUS" ? "UNSCORED_AMBIGUOUS" : !answer.name ? "NO_NAME" : each.acceptableNames.some((expected) => flat(expected) === flat(answer.name)) ? "RIGHT_NAME" : "WRONG_NAME", schemaValid: valid });
      if (answer.reading?.brand) {
        scored.brandAnswers += 1;
        if (each.acceptableBrands.length) scored.positiveBrandAnswers += 1;
        if (each.acceptableBrands.some((expected) => flat(expected) === flat(answer.reading.brand))) scored.supportedBrands += 1;
        else { scored.unsupportedBrands += 1; scored.unsupportedPrintedIdentifiers += 1; }
      }
      if (answer.reading?.model) {
        scored.modelAnswers += 1;
        if (each.acceptableModels.some((expected) => flat(expected) === flat(answer.reading.model))) scored.supportedModels += 1;
        else { scored.unsupportedModels += 1; scored.unsupportedPrintedIdentifiers += 1; }
      }
    }
    const coreUnchanged = before === JSON.stringify(core());
    const complete = scored.completed === prepared.length && coreUnchanged && !stats.halt && !stats.calibrationErrors;
    say(`photo cases ${JSON.stringify(caseResults)}`);
    say(`photo measurement ${JSON.stringify({ ...scored, officeDiagnostics, namePrecision: scored.scoredAnswers ? scored.correctNames / scored.scoredAnswers : null,
      positiveCoverage: scored.positiveCases ? scored.positiveAnswers / scored.positiveCases : null, brandPrecision: scored.brandAnswers ? scored.supportedBrands / scored.brandAnswers : null,
      brandCoverage: scored.expectedBrandCases ? scored.positiveBrandAnswers / scored.expectedBrandCases : null, modelPrecision: scored.modelAnswers ? scored.supportedModels / scored.modelAnswers : null, modelPositiveCoverage: scored.expectedModelCases ? "FINITE_FIXTURE_ONLY" : "UNMEASURED_NO_POSITIVE_MODEL_IDS", coreUnchanged, packagingQuality: "NOT_SCORED", generalOfficeAccuracy: "UNMEASURED", promotion: "NOT_AUTHORIZED" })}`);
    say(`photo receipt ${JSON.stringify({ expected: prepared.length, completed: scored.completed, complete, stopped: stats.halt ?? (stats.calibrationErrors ? "RESERVATION_CALIBRATION" : !complete ? "BUDGET_OR_FAILURE_STREAK" : null),
      priorVerifiedAccountedNeurons: priorNeurons, photoAccountedNeurons: stats.neurons, combinedAccountedNeurons: priorNeurons + stats.neurons, photoCap: Math.min(stopAt, 240), combinedCap: 400 })}`);
    local.sqlite.close(); if (!complete) process.exitCode = 2;
  }
} else if (fixture) {
  const all = fixture.nameCases.map((each) => ({ ...each, task: m.normalizeTask(each.name, each.terms) }));
  const baseline = m.score(all.map((each) => ({ truth: each.truth, truthOffered: each.task.allowed.includes(each.truth),
    baseline: m.baselineAnswer(each.name, each.terms), model: null, answered: false })));
  say(`fresh fixture ${fixture.fixtureVersion}; sha256 ${fixtureHash}; ${all.length} name cases (${all.filter((each) => each.truth === null).length} ambiguous/absent); existing source prompts frozen; production roles remain REVIEW_ONLY`);
  say(report("Deterministic baseline, fresh cases", baseline));
  const incumbentCases = [], challengerCases = [], arbitrationCases = [];
  let unpairedCalls = 0;
  for (const each of dry ? [] : all.slice(0, limits.granite)) {
    const incumbent = await ask("TEXT_NORMALIZE", each.task);
    if (incumbent.stopped) break;
    const evaluated = (result) => ({ truth: each.truth, truthOffered: each.task.allowed.includes(each.truth),
      baseline: m.baselineAnswer(each.name, each.terms), model: result.value, answered: result.answered });
    if (challenger) {
      const rival = await ask("TEXT_NORMALIZE", each.task, true);
      if (rival.stopped) { unpairedCalls += 1; break; }
      challengerCases.push(evaluated(rival));
    }
    incumbentCases.push(evaluated(incumbent));
  }
  for (const each of dry ? [] : all.slice(0, limits.qwen)) {
    const near = each.terms.slice(0, 5);
    const task = m.arbitrateTask(each.name, near.map((name, index) => ({ id: `c${index}`, name })));
    const result = await ask("CANDIDATE_ARBITRATE", task);
    if (result.stopped) break;
    arbitrationCases.push({ truth: each.truth, truthOffered: near.includes(each.truth), baseline: m.baselineAnswer(each.name, near),
      model: result.value === null ? null : near[Number(result.value.slice(1))] ?? null, answered: result.answered });
  }
  const followUps = { cases: 0, right: 0, wrong: 0, abstained: 0, unavailableOrInvalid: 0 };
  for (const each of dry ? [] : fixture.followUpCases.slice(0, limits.glm)) {
    const result = await ask("RARE_SECOND_OPINION", m.secondOpinionTask(each.facts));
    if (result.stopped) break;
    followUps.cases += 1;
    if (!result.answered) followUps.unavailableOrInvalid += 1;
    else if (result.value === null) followUps.abstained += 1;
    else if (each.acceptable.includes(result.value)) followUps.right += 1; else followUps.wrong += 1;
  }
  if (!dry) {
    say(report("Granite, fresh normalization", m.score(incumbentCases)));
    if (challenger) say(report("Qwen challenger, exact same normalization tasks", m.score(challengerCases)));
    say(`paired normalization cases ${challenger ? challengerCases.length : 0}; unpaired calls excluded from quality comparison ${unpairedCalls}`);
    say(report("Qwen, fresh candidate arbitration", m.score(arbitrationCases)));
    say(`GLM fresh synthetic single-conflict priorities: ${JSON.stringify(followUps)}; precision ${pct(followUps.right + followUps.wrong ? followUps.right / (followUps.right + followUps.wrong) : null)}; limited synthetic support is not staff utility or a promotion pass`);
    const expected = { normalization: Math.min(limits.granite, all.length), arbitration: Math.min(limits.qwen, all.length), followUps: Math.min(limits.glm, fixture.followUpCases.length) };
    const completed = { normalization: incumbentCases.length, arbitration: arbitrationCases.length, followUps: followUps.cases };
    const complete = Object.keys(expected).every((task) => expected[task] === completed[task]) && !stats.calibrationErrors && !stats.halt;
    const stopped = stats.halt ?? (stats.calibrationErrors ? "RESERVATION_CALIBRATION" : stats.streak >= HARD.consecutiveFailures ? "FAILURE_STREAK"
      : stats.calls >= HARD.calls ? "CALL_CEILING" : !complete ? "NEURON_BUDGET" : null);
    say(`measurement receipt ${JSON.stringify({ expected, completed, pairedNormalization: challenger ? challengerCases.length : 0, complete, stopped })}; completed measurement is not a model quality or promotion pass`);
    if (!complete) process.exitCode = 2;
  } else say("dry validation only: zero inference calls; provider quality/availability/cost are UNMEASURED");
} else {
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
say(`split ${split}${split === "TEST" ? " (sealed: run once per promotion claim)" : " (tuning half)"}; catalogue names ${names.length}, this half ${mine.length}; variants ${all.length} (${ambiguousSetAside} ambiguous set aside, ${absent.length} not in the catalogue); baseline alone: ${all.length - unresolved.length} resolved, ${unresolved.length} left to a model; near-tied ${ambiguous.length}`);
say(report("Deterministic baseline, all variants", graniteBaseline));
if (!dry) {
  say(report("Granite on baseline-unresolved variants", m.score(graniteCases), { netBenefit: false }));
  say(report("Qwen on near-tied variants (baseline = nearest name)", m.score(qwenCases)));
  say(`GLM follow-ups: ${JSON.stringify(glm)}`);
  const ms = [...stats.ms].sort((a, b) => a - b);
  say(`calls ${stats.calls} (ceiling ${HARD.calls}), failed ${stats.failed}, Neurons ${Math.round(stats.neurons * 10) / 10} (ceiling ${stopAt}), latency p50 ${ms[Math.floor(ms.length * 0.5)] ?? "–"} ms, p95 ${ms[Math.floor(ms.length * 0.95)] ?? "–"} ms. These calls use the REST API and are not in the app's daily counter.`);
}
}
if (!dry) {
  for (const bucket of byModel.values()) {
    const sorted = [...bucket.ms].sort((a, b) => a - b);
    const latency = (share) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] : null;
    const { ms, ...counts } = bucket;
    say(`provider metrics ${JSON.stringify({ ...counts, availability: bucket.calls ? bucket.available / bucket.calls : null,
      p50Ms: latency(0.5), p95Ms: latency(0.95) })}`);
  }
  say(`accounted Neurons ${Math.round(stats.neurons * 1000) / 1000}; calls ${stats.calls}; failed ${stats.failed}; calibration errors ${stats.calibrationErrors}; hard ceilings ${HARD.calls} calls / ${stopAt} Neurons / ${HARD.consecutiveFailures} consecutive failures. REST calls are outside the app counter; reservations are not provider usage receipts.`);
}
if (summaryPath) fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`);
