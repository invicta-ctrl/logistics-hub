import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const [kind, ...extra] = process.argv.slice(2);
const out = process.env.KAWING_EVIDENCE_DIR ? resolve(process.env.KAWING_EVIDENCE_DIR) : null;
if (out) mkdirSync(out, { recursive: true });
const vitest = "node_modules/vitest/vitest.mjs";
const playwright = "node_modules/@playwright/test/cli.js";
function run(name, file, args, reporter, env = {}) {
  const report = out && reporter ? resolve(out, name + ".json") : null;
  const options = reporter === "vitest" && report ? ["--reporter=json", "--outputFile=" + report] : reporter === "playwright" && report ? ["--reporter=json"] : [];
  const result = spawnSync(process.execPath, [file, ...args, ...options], {
    stdio: "inherit", env: { ...process.env, ...env, ...(reporter === "playwright" && report ? { PLAYWRIGHT_JSON_OUTPUT_FILE: report } : {}) }
  });
  const data = report && existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : null;
  return { name, exitCode: result.status ?? 1, report: data };
}
const unit = (name, files = [], env = {}) => run(name, vitest, ["run", ...files, ...extra], "vitest", env);
const browser = (name, files = [], env = {}) => run(name, playwright, ["test", ...files, ...extra], "playwright", env);
const worker = (name, files = [], env = {}) => run(name, "scripts/run-worker-browser-tests.mjs", [...files, ...extra], "playwright", env);
const plain = (name, file) => run(name, file, [], null);
let results;
switch (kind) {
  case "unit": results = [unit("unit")]; break;
  case "e2e": results = [browser("browser-e2e"), worker("worker-e2e")]; break;
  case "a11y": results = [browser("accessibility-regression", ["accessibility.spec.ts"]), worker("axe-worker", ["governance-a11y.spec.ts"], {LH_GOVERNANCE_AXE:"1"})]; break;
  case "visual": results = [browser("visual-depth", ["visual-depth.spec.ts"]), browser("visual-regression", ["governance-visual.spec.ts", "--update-snapshots=none"], {LH_GOVERNANCE_VISUAL:"1"})]; break;
  case "security": results = [unit("security-tests", ["tests/access.test.ts", "tests/hardening.test.ts", "tests/session.test.ts", "tests/audits.test.ts", "tests/privacy-scan.test.ts", "tests/dependencies.test.ts"]), plain("privacy-scan", "scripts/privacy-scan.mjs")]; break;
  case "perf": results = [unit("performance-tests", ["tests/activity-perf.test.ts", "tests/stock-activity-perf.test.ts", "tests/attention-performance.test.ts", "tests/home-performance.test.ts", "tests/search-performance.test.ts", "tests/scale-hot-paths.test.ts"], {ACTIVITY_PERF:"1",ACTIVITY_PERF_TIERS:"1000",STOCK_ACTIVITY_PERF:"1",STOCK_ACTIVITY_PERF_TIERS:"1000", ...(out ? {ACTIVITY_PERF_OUT:resolve(out,"activity-timings.md"),STOCK_ACTIVITY_PERF_OUT:resolve(out,"stock-timings.md")} : {})})]; break;
  default: throw Error("Unknown quality check: " + kind);
}
const missing = results.some(r => r.exitCode !== 0 || (out && r.name !== "privacy-scan" && !r.report));
if (out) {
  const details = Object.fromEntries(["activity-timings.md","stock-timings.md"].filter(n=>existsSync(resolve(out,n))).map(n=>[n,readFileSync(resolve(out,n),"utf8")]));
  if (kind !== "unit") writeFileSync(resolve(out, kind+".json"), JSON.stringify({ results, ...(kind==="perf"?{measurements:details}:{}) },null,2)+"\n");
}
process.exitCode = missing ? 1 : 0;
