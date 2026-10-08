// Logistics Hub Owner Console.
//
//   npm run admin                    interactive menu
//   npm run admin -- status          production readiness report (needs Wrangler sign-in)
//   npm run admin -- deploy          preflight, migrate, deploy and verify production
//   npm run admin -- verify [url] [--local]   smoke-test a deployment
//   npm run admin -- install-launcher [folder]   create the Windows launcher
//
// Account work goes over HTTPS to the site's own authenticated Admin API: the
// same rules as the website, no Cloudflare or database access needed. Wrangler
// sign-in is only for deploying, migrations, provider status and first-owner setup.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { checkPassword, createAccountSql, runD1, validDisplayName, validUsername, wrangler } from "./staff-account.mjs";

const EXPECTED = { worker: "logistics-hub", database: "logistics-hub", binding: "DB" };
const FORBIDDEN = /hau-usc-logistics-(production|staging)/;
const root = fileURLToPath(new URL("..", import.meta.url));
const recordFile = path.join(root, ".wrangler", "admin", "deployments.json");
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => tty ? `\x1b[${code}m${text}\x1b[0m` : String(text);
const c = { bold: paint(1), dim: paint(2), red: paint(31), green: paint(32), yellow: paint(33), cyan: paint(36), inverse: paint(7) };

/* ---------- process helpers ---------- */

function run(command, args, { input, env, inherit = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", input, env: { ...process.env, ...env }, stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"], shell: command === "npm" && process.platform === "win32" });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}`, stdout: result.stdout ?? "" };
}
// CI=1 keeps Wrangler non-interactive; this console asks for every confirmation itself.
const wr = (args, options = {}) => run(process.execPath, [wrangler, ...args], { ...options, env: { CI: "1", WRANGLER_SEND_METRICS: "false", ...options.env } });
const git = (...args) => run("git", args).stdout.trim();

function readConfig() {
  const text = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  return { text, config: JSON.parse(text) };
}

function lastDeployment() {
  try { return JSON.parse(fs.readFileSync(recordFile, "utf8")).at(-1) ?? null; } catch { return null; }
}

function saveDeployment(record) {
  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  let history = [];
  try { history = JSON.parse(fs.readFileSync(recordFile, "utf8")); } catch { /* first deployment */ }
  fs.writeFileSync(recordFile, JSON.stringify([...history, record], null, 2) + "\n");
}

const pass = (label, detail = "") => { console.log(`  ${c.green("✓")} ${label}${detail ? c.dim(`  ${detail}`) : ""}`); return true; };
const fail = (label, detail = "", fix = "") => { console.log(`  ${c.red("✗")} ${label}${detail ? c.dim(`  ${detail}`) : ""}`); if (fix) console.log(`      ${c.yellow("→")} ${fix}`); return false; };
const note = (label, detail = "") => console.log(`  ${c.yellow("•")} ${label}${detail ? c.dim(`  ${detail}`) : ""}`);

/* ---------- checks shared by status and deploy ---------- */

function checkConfig() {
  const { text, config } = readConfig();
  const d1 = config.d1_databases?.find((entry) => entry.binding === EXPECTED.binding);
  if (FORBIDDEN.test(text)) return fail("wrangler.jsonc", "references an old hau-usc-logistics resource", "Remove it; this project deploys only to logistics-hub.") && null;
  if (config.name !== EXPECTED.worker) return fail("Worker name", `is "${config.name}"`, `Set "name": "${EXPECTED.worker}" in wrangler.jsonc.`) && null;
  if (!d1 || d1.database_name !== EXPECTED.database || !d1.database_id) return fail("D1 binding", "DB must bind database logistics-hub with a database_id", "Fix d1_databases in wrangler.jsonc.") && null;
  pass("Configuration", `Worker ${config.name} · D1 ${d1.database_name} (binding ${d1.binding})`);
  return d1;
}

function checkAuth() {
  const result = wr(["whoami", "--json"]);
  if (!result.ok) {
    return fail("Cloudflare sign-in", "Wrangler is not authenticated", "Run  npx wrangler login  (opens your browser), or set the CLOUDFLARE_API_TOKEN environment variable, then try again.");
  }
  let who = {};
  try { who = JSON.parse(result.stdout); } catch { /* older output */ }
  const accounts = (who.accounts ?? []).map((account) => account.name).join(", ");
  return pass("Cloudflare sign-in", [who.email, accounts].filter(Boolean).join(" · ") || (process.env.CLOUDFLARE_API_TOKEN ? "API token" : "authenticated"));
}

function checkDatabase(d1) {
  const result = wr(["d1", "info", EXPECTED.database, "--json"]);
  if (!result.ok) return fail("D1 access", `cannot read ${EXPECTED.database}`, "Sign in with the Cloudflare account that owns logistics-hub:  npx wrangler logout  then  npx wrangler login") && false;
  let info = {};
  try { info = JSON.parse(result.stdout); } catch { /* ignore */ }
  if (info.uuid && info.uuid !== d1.database_id) return fail("D1 binding", `wrangler.jsonc id does not match the account's ${EXPECTED.database} database`, "Stop: correct database_id in wrangler.jsonc before deploying.");
  return pass("D1 access", `${EXPECTED.database} matches the configured database_id`);
}

function pendingMigrations() {
  const result = wr(["d1", "migrations", "list", EXPECTED.binding, "--remote"]);
  if (!result.ok) return null;
  return [...new Set(result.out.match(/\d{4}_[\w-]+\.sql/g) ?? [])];
}

function checkGit({ strict }) {
  run("git", ["fetch", "--quiet", "origin", "main"]);
  const branch = git("branch", "--show-current");
  const head = git("rev-parse", "--short", "HEAD");
  const dirty = git("status", "--porcelain");
  const behind = git("rev-list", "--count", "HEAD..origin/main");
  const ahead = git("rev-list", "--count", "origin/main..HEAD");
  let ok = pass("Git", `${branch || "detached"} @ ${head}`);
  if (dirty) ok = (strict ? fail : note)("Working tree has uncommitted changes", "", strict ? "Commit or stash them; only a clean, verified main is deployed." : "") && ok;
  if (strict && branch !== "main") ok = fail("Branch", `on ${branch}`, "Run  git switch main  then  git pull --ff-only") && false;
  if (Number(behind) > 0) ok = (strict ? fail : note)(`Behind origin/main by ${behind} commit(s)`, "", strict ? "Run  git pull --ff-only" : "") && ok;
  if (Number(ahead) > 0) ok = (strict ? fail : note)(`Ahead of origin/main by ${ahead} unpushed commit(s)`, "", strict ? "Only pushed, verified main is deployed. Push through the normal slice workflow first." : "") && ok;
  return ok;
}

/* ---------- operations ---------- */

async function status() {
  console.log(c.bold("\nDeployment status"));
  checkGit({ strict: false });
  const d1 = checkConfig();
  if (!d1 || !checkAuth() || !checkDatabase(d1)) return false;
  const pending = pendingMigrations();
  if (pending === null) fail("Migrations", "could not read the remote migration list");
  else if (pending.length) note(`${pending.length} migration(s) pending`, pending.join(", "));
  else pass("Migrations", "production database is up to date");
  const deployments = wr(["deployments", "list", "--name", EXPECTED.worker, "--json"]);
  if (!deployments.ok) note("Worker", "not deployed yet");
  else {
    let latest;
    try { latest = JSON.parse(deployments.stdout).at(-1); } catch { /* ignore */ }
    pass("Worker", latest?.created_on ? `last deployed ${latest.created_on}` : "deployed");
    const secrets = wr(["secret", "list", "--name", EXPECTED.worker]);
    if (secrets.ok && secrets.stdout.includes("SESSION_SECRET")) pass("SESSION_SECRET", "configured");
    else note("SESSION_SECRET", "not configured yet; the next deploy sets it");
  }
  const record = lastDeployment();
  if (record) {
    let origin = null;
    try { origin = siteOrigin(record.url); } catch (error) { fail("Live site", error.message); }
    if (origin) {
      const health = await fetch(`${origin}/api/public/catalog`).then((response) => response.status, () => 0);
      (health === 200 ? pass : fail)("Live site", `${record.url} (commit ${record.commit}) → HTTP ${health || "unreachable"}`);
    }
  }
  return true;
}

function gate(label, args) {
  process.stdout.write(`  … ${label}`);
  const result = run("npm", args);
  readline.clearLine?.(process.stdout, 0);
  readline.cursorTo?.(process.stdout, 0);
  if (result.ok) return pass(label);
  console.log(c.dim(result.out.trim().split("\n").slice(-15).join("\n")));
  return fail(label, "failed", "Fix the failure above; nothing was deployed.");
}

async function deploy(ask) {
  console.log(c.bold("\nDeploy latest verified main → production"));
  console.log(c.bold("\n1. Preflight"));
  if (!checkGit({ strict: true })) return false;
  const d1 = checkConfig();
  if (!d1 || !checkAuth() || !checkDatabase(d1)) return false;
  for (const [label, args] of [
    ["Typecheck", ["run", "-s", "typecheck"]], ["Unit and Worker tests", ["test", "--silent"]], ["Production build", ["run", "-s", "build"]],
    ["Privacy and secret scan", ["run", "-s", "verify:privacy"]], ["Migration data verification", ["run", "-s", "verify:migration"]], ["Public catalog verification", ["run", "-s", "verify:catalog"]]
  ]) if (!gate(label, args)) return false;

  console.log(c.bold("\n2. Rollback point"));
  const travel = wr(["d1", "time-travel", "info", EXPECTED.binding, "--json"]);
  let bookmark = null;
  try { bookmark = JSON.parse(travel.stdout).bookmark ?? null; } catch { /* reported below */ }
  if (!bookmark) return fail("D1 Time Travel bookmark", "could not be read", "Retry; deployment stops without a rollback point.");
  pass("D1 Time Travel bookmark", bookmark);
  const pending = pendingMigrations();
  if (pending === null) return fail("Migrations", "could not read the production migration list", "Nothing was changed. Check your connection and Cloudflare access, then retry.");
  // Generate a session key only for a Worker that has never been deployed. If an existing
  // Worker's secrets cannot be read, stop: replacing the key would sign every staff member out.
  const deployments = wr(["deployments", "list", "--name", EXPECTED.worker, "--json"]);
  const firstDeploy = !deployments.ok;
  let previousVersion = null;
  try { previousVersion = JSON.parse(deployments.stdout).at(-1)?.versions?.[0]?.version_id ?? null; } catch { /* first deploy */ }
  if (previousVersion) pass("Current Worker version (rollback target)", previousVersion);
  const secrets = wr(["secret", "list", "--name", EXPECTED.worker]);
  if (!firstDeploy && !secrets.ok) return fail("Worker secrets", "could not be read", "Nothing was changed. Retry; if it persists, check that your Cloudflare token can read Worker secrets.");
  const needsSecret = firstDeploy || !secrets.stdout.includes("SESSION_SECRET");
  const commit = git("rev-parse", "--short", "HEAD");

  console.log(c.bold("\n3. Plan"));
  console.log(`  Worker        ${EXPECTED.worker}`);
  console.log(`  D1            ${EXPECTED.database} (${d1.database_id})`);
  console.log(`  Commit        ${commit}  ${c.dim(git("log", "-1", "--format=%s"))}`);
  console.log(`  Migrations    ${pending.length ? pending.join(", ") : "none pending"}`);
  console.log(`  Replaces      ${previousVersion ?? "nothing (first deploy)"}`);
  console.log(`  Session key   ${needsSecret ? "will be generated and stored as a Worker secret" : "already configured (unchanged)"}`);
  if (!await ask.confirm("deploy", "This changes PRODUCTION.")) {
    note("Cancelled", "nothing was changed");
    return false;
  }

  console.log(c.bold("\n4. Apply"));
  if (pending.length) {
    const migrate = wr(["d1", "migrations", "apply", EXPECTED.binding, "--remote"], { inherit: true });
    if (!migrate.ok) return fail("Migrations", "failed", `Nothing was deployed. Restore if needed: npx wrangler d1 time-travel restore ${EXPECTED.binding} --bookmark=${bookmark}`);
    pass("Migrations applied", pending.join(", "));
  }
  let secretsFile = null;
  try {
    if (needsSecret) {
      secretsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lh-")), "secrets.json");
      fs.writeFileSync(secretsFile, JSON.stringify({ SESSION_SECRET: randomBytes(48).toString("base64url") }), { mode: 0o600 });
    }
    const deployed = wr(["deploy", ...(secretsFile ? ["--secrets-file", secretsFile] : [])]);
    if (!deployed.ok) {
      console.log(c.dim(deployed.out.trim().split("\n").slice(-20).join("\n")));
      return fail("Worker deploy", "failed", `The previous Worker version is still live. Database rollback if needed: npx wrangler d1 time-travel restore ${EXPECTED.binding} --bookmark=${bookmark}`);
    }
    const url = deployed.out.match(/https:\/\/logistics-hub\.[a-z0-9-]+\.workers\.dev/i)?.[0];
    if (!url) return fail("Worker deploy", "succeeded but no workers.dev URL was reported", "Enable the workers.dev route for logistics-hub in the Cloudflare dashboard, then run verification.");
    pass("Worker deployed", url);
    const version = deployed.out.match(/Current Version ID:\s*([0-9a-f-]{36})/i)?.[1] ?? null;
    if (version) pass("New Worker version", version);
    saveDeployment({ url, commit, version, previousVersion, deployedAt: new Date().toISOString(), d1Bookmark: bookmark, migrations: pending });
    saveConfig({ ...readUserConfig(), productionUrl: url });
    console.log(c.bold("\n5. Verify"));
    const verified = await verify(url, { database: "remote" });
    console.log(verified
      ? c.green(`\nLive and verified: ${url}  (commit ${commit})`)
      : c.red(`\nDeployed but verification failed. Roll back with  npx wrangler rollback${previousVersion ? ` ${previousVersion}` : ""}  and, if data is affected,  npx wrangler d1 time-travel restore ${EXPECTED.binding} --bookmark=${bookmark}`));
    return verified;
  } finally {
    if (secretsFile) fs.rmSync(path.dirname(secretsFile), { recursive: true, force: true });
  }
}

async function verify(url, { database }) {
  let ok = true;
  const check = (condition, label, detail) => { ok = (condition ? pass(label) : fail(label, detail)) && ok; };
  const get = (route, init = {}) => fetch(new URL(route, url), { redirect: "manual", ...init }).catch(() => null);
  console.log(c.dim(`  ${url}`));
  const home = await get("/");
  check(home?.status === 200 && home.headers.get("content-type")?.includes("text/html"), "Landing page serves HTML", `HTTP ${home?.status ?? "unreachable"}`);
  check(home?.headers.get("content-security-policy")?.includes("default-src 'self'") && home.headers.get("x-frame-options") === "SAMEORIGIN", "Security headers present", "CSP / X-Frame-Options missing");
  check((await get("/lending"))?.status === 200, "Lending Hub route", "");
  const catalog = await get("/api/public/catalog");
  const body = catalog?.status === 200 ? await catalog.json().catch(() => null) : null;
  check(Number.isInteger(body?.revision) && Array.isArray(body?.items), "Public catalog API", `HTTP ${catalog?.status}`);
  const etag = catalog?.headers.get("etag");
  check(Boolean(etag) && (await get("/api/public/catalog", { headers: { "if-none-match": etag } }))?.status === 304, "Live-update revision (ETag/304)", "");
  check((await get("/api/staff/session"))?.status === 401, "Staff API requires sign-in", "");
  const shell = await get("/staff/items");
  check(shell?.status === 302 && shell.headers.get("location")?.endsWith("/staff"), "Staff pages redirect when signed out", `HTTP ${shell?.status}`);
  const write = await get("/api/staff/items/ITM-0001/movements", { method: "POST", headers: { origin: new URL(url).origin, "content-type": "application/json" }, body: JSON.stringify({ kind: "IN", quantity: 1, key: "verify-anonymous-write" }) });
  check(write?.status === 401, "Anonymous stock writes are rejected", `HTTP ${write?.status}`);
  const login = await get("/api/staff/login", { method: "POST", headers: { origin: new URL(url).origin, "content-type": "application/json" }, body: JSON.stringify({ username: "verify-no-such-user", password: randomBytes(18).toString("base64url") }) });
  check(login?.status === 401, "Sign-in is configured (session key present)", login?.status === 503 ? "SESSION_SECRET missing" : `HTTP ${login?.status}`);
  if (!database) return ok;
  try {
    const [row] = runD1("SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT on_hand FROM inventory_balances WHERE id = 'ITM-0001') AS itm1, (SELECT migration_delta FROM inventory_balances WHERE id = 'ITM-0001') AS delta, (SELECT COUNT(*) FROM inventory_balances WHERE migration_delta <> 0) AS discrepancies", { remote: database === "remote", json: true });
    check(row.items >= 397, "Inventory migrated", `${row.items} items`);
    check(row.delta === -1 && row.discrepancies === 1, "ITM-0001 reconciliation evidence preserved", `delta ${row.delta}, discrepancies ${row.discrepancies}`);
    pass("ITM-0001 current on-hand", String(row.itm1));
  } catch (error) {
    check(false, "D1 checks", error.message);
  }
  return ok;
}

/* ---------- local settings and the paired recovery key ---------- */

// Per-user settings live outside the repository. On Windows the recovery key is
// encrypted with DPAPI for the current Windows user; nothing here is a plaintext secret.
const settingsDir = process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "LogisticsHub")
  : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "logistics-hub");
const configFile = path.join(settingsDir, "console.json");
const pairingFile = path.join(settingsDir, "owner-recovery.dpapi.json");
const PREVIEW_URL = "http://127.0.0.1:8791";
// Site addresses come from local files (settings, deployment records). Only an https:// site
// or the local preview is ever contacted, so a stray value cannot send credentials in the clear.
function siteOrigin(value) {
  let url = null;
  try { url = new URL(String(value)); } catch { /* reported below */ }
  if (url?.origin === PREVIEW_URL || (url?.protocol === "https:" && !url.username && !url.password)) return url.origin;
  throw new Error(`Not a Logistics Hub address: ${value}. Use the production https:// address or the local preview.`);
}

function readUserConfig() {
  try { return JSON.parse(fs.readFileSync(configFile, "utf8")); } catch { return {}; }
}
function saveConfig(config) {
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
}

function dpapi(operation, text) {
  if (process.platform !== "win32") throw new Error("Pairing uses Windows data protection and is only available on Windows.");
  const convert = operation === "protect"
    ? "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($in), $scope, 'CurrentUser'))"
    : "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in), $scope, 'CurrentUser'))";
  // The secret travels on stdin, never on a command line.
  const script = `Add-Type -AssemblyName System.Security; $in = [Console]::In.ReadToEnd().Trim(); $scope = [Text.Encoding]::UTF8.GetBytes('LogisticsHub.OwnerRecovery'); ${convert}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { input: text, encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error("Windows could not protect or read the recovery key for this user account.");
  return result.stdout.trim();
}

function pairedKey(site) {
  let record;
  try { record = JSON.parse(fs.readFileSync(pairingFile, "utf8")); } catch { return null; }
  return record.site === site ? { ...record, key: () => dpapi("unprotect", record.protected) } : null;
}
function pair(site, recoveryKey) {
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(pairingFile, JSON.stringify({ site, keyId: recoveryKey.split(".")[1], pairedAt: new Date().toISOString(), protected: dpapi("protect", recoveryKey) }, null, 2) + "\n");
}
const unpair = () => fs.rmSync(pairingFile, { force: true });

/* ---------- Windows launcher ---------- */

const LAUNCHER_DIR = "D:\\Documents\\Logi hub access";

// A thin launcher outside the project: it finds the one shared worktree and runs its
// LOGISTICS_ADMIN.cmd, so there is never a second copy of the console to keep in sync.
function installLauncher(folder = LAUNCHER_DIR) {
  const hub = root.replace(/[\\/]+$/, "").replaceAll("/", "\\");
  const lines = [
    "@echo off", "setlocal", "title Logistics Hub - Owner Console",
    `set "HUB=${hub}"`,
    'if not exist "%HUB%\\scripts\\admin.mjs" (',
    "  echo.", "  echo  The Logistics Hub project was not found at:", "  echo    %HUB%",
    "  echo  Put the project back in that folder, or run LOGISTICS_ADMIN.cmd from wherever it now lives.",
    "  echo.", "  pause", "  exit /b 1", ")",
    'call "%HUB%\\LOGISTICS_ADMIN.cmd" %*', "endlocal"
  ];
  const file = path.join(folder, "LOGISTICS_ADMIN.cmd");
  const content = lines.join("\r\n") + "\r\n";
  let current = null;
  try { current = fs.readFileSync(file, "utf8"); } catch { /* not installed yet */ }
  if (current === content) return { file, changed: false };
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, content);
  return { file, changed: true };
}

/* ---------- the site's Admin API ---------- */

// Talks to a Logistics Hub site exactly like the browser does: same-origin requests
// carrying the HttpOnly session cookie. Every permission rule is enforced by the site.
class Site {
  constructor(url) {
    this.url = siteOrigin(url);
    this.cookie = "";
    this.me = null;
  }
  get production() { return this.url !== PREVIEW_URL; }
  async call(method, route, body) {
    const response = await fetch(this.url + route, {
      method, redirect: "manual",
      headers: { origin: new URL(this.url).origin, ...(body ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    }).catch(() => null);
    if (!response) throw new Error(`Cannot reach ${this.url}. Check your internet connection${this.production ? "" : " and that  npm run dev:live  is running"}.`);
    const session = response.headers.getSetCookie?.().find((value) => value.startsWith("lh_staff_session="))?.split(";")[0];
    if (session !== undefined) this.cookie = session.endsWith("=") ? "" : session;
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && route.startsWith("/api/staff/") && route !== "/api/staff/login") { this.me = null; this.cookie = ""; }
    if (!response.ok) throw Object.assign(new Error(data.error ?? `The site answered HTTP ${response.status}.`), { status: response.status, code: data.code });
    return data;
  }
  async signIn(username, password) {
    const result = await this.call("POST", "/api/staff/login", { username, password });
    this.me = await this.call("GET", "/api/staff/session");
    return result;
  }
  async signOut() {
    if (this.cookie) await this.call("POST", "/api/staff/logout").catch(() => null);
    this.cookie = "";
    this.me = null;
  }
}

/* ---------- interactive console ---------- */

function prompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  let muted = false;
  rl._writeToOutput = (text) => { if (!muted) process.stdout.write(text); };
  const lines = [];
  const waiting = [];
  rl.on("line", (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
  rl.on("close", () => { while (waiting.length) waiting.shift()(null); });
  const line = (question) => {
    process.stdout.write(question);
    return lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve) => waiting.push(resolve));
  };
  const ask = async (question) => {
    const answer = await line(question);
    if (answer === null) throw new Error("Input closed.");
    return answer.trim();
  };
  ask.hidden = async (question) => {
    muted = true;
    try { const answer = await line(question); if (answer === null) throw new Error("Input closed."); return answer; }
    finally { muted = false; process.stdout.write("\n"); }
  };
  ask.confirm = async (word, warning) => {
    console.log(`\n${c.yellow(warning)}`);
    return (await ask(`Type ${c.bold(word)} to continue, or press Enter to cancel: `)).toLowerCase() === word;
  };
  ask.yes = async (question) => /^y(es)?$/i.test(await ask(`${question} [y/N]: `));
  ask.close = () => rl.close();
  return ask;
}

const ROLE_NAMES = { STAFF: "Staff", ADMIN: "Administrator", OWNER: "Owner" };
const when = (value) => value ? `${String(value).replace("T", " ").slice(0, 16)} UTC` : "never";

function printAccounts(accounts) {
  const rows = accounts.map((account) => ({
    name: account.displayName, username: account.username, role: ROLE_NAMES[account.role], active: account.active ? "yes" : "disabled",
    "last sign-in": when(account.lastLoginAt), sessions: String(account.openSessions)
  }));
  const columns = Object.keys(rows[0] ?? { name: 0 });
  const width = Object.fromEntries(columns.map((key) => [key, Math.max(key.length, ...rows.map((row) => row[key].length))]));
  console.log(c.dim(`  ${columns.map((key) => key.padEnd(width[key])).join("   ")}`));
  for (const row of rows) console.log(`  ${columns.map((key) => { const text = row[key].padEnd(width[key]); return row.active === "disabled" ? c.yellow(text) : text; }).join("   ")}`);
}

/** A typed password (entered twice, never echoed) or, on Enter, a generated one. */
async function choosePassword(ask, { allowGenerate = true } = {}) {
  const typed = await ask.hidden(`  New password (at least 12 characters${allowGenerate ? "; press Enter to generate one" : ""}): `);
  if (!typed && allowGenerate) return { generate: true };
  checkPassword(typed);
  if (typed !== await ask.hidden("  Repeat the password: ")) throw new Error("Passwords did not match. Nothing was changed.");
  return { password: typed };
}

function showOnce(label, secret, advice) {
  console.log(`\n  ${label}: ${c.bold(secret)}`);
  console.log(c.dim(`  Shown once and never stored. ${advice}`));
}

async function interactive() {
  const ask = prompter();
  const config = readUserConfig();
  let site;
  try { site = new Site(config.site ?? config.productionUrl ?? lastDeployment()?.url ?? PREVIEW_URL); } catch (error) { note(error.message); site = new Site(PREVIEW_URL); }

  if (process.platform === "win32" && fs.existsSync("D:\\")) {
    try {
      const launcher = installLauncher();
      if (launcher.changed) pass("Launcher ready", launcher.file);
    } catch (error) { note("Launcher", `could not be created in ${LAUNCHER_DIR}: ${error.message}`); }
  }

  const label = () => site.production ? c.inverse(c.red(" PRODUCTION ")) : c.inverse(c.green(" PREVIEW "));
  const guard = async (action) => !site.production || ask.confirm("yes", `${action} on the PRODUCTION site.`);
  const signedIn = () => { if (!site.me) throw new Error("Sign in first (option 1)."); return site.me; };
  const accounts = async () => (await site.call("GET", "/api/staff/admin/accounts")).accounts;
  const pickAccount = async () => {
    signedIn();
    const username = await ask("  Username: ");
    const account = (await accounts()).find((row) => row.username.toLowerCase() === username.toLowerCase());
    if (!account) throw new Error(`No account named "${username}".`);
    return account;
  };
  const accountPath = (account, suffix = "") => `/api/staff/admin/accounts/${account.id}${suffix}`;
  const reported = (label, generated, username) => {
    pass(label);
    if (generated) showOnce("Temporary password", generated, `Give it to ${username} privately; they choose their own at first sign-in.`);
  };

  async function signIn(username, password) {
    const result = await site.signIn(username, password);
    if (result.mustChangePassword) {
      console.log(c.yellow("\n  This account must set a new password before it can do anything else."));
      const next = await choosePassword(ask, { allowGenerate: false });
      await site.call("POST", "/api/staff/me/password", { currentPassword: password, newPassword: next.password });
      site.me = await site.call("GET", "/api/staff/session");
      pass("Password changed");
    }
    pass(`Signed in as ${site.me.displayName}`, `${site.me.username} · ${ROLE_NAMES[site.me.role]}`);
    if (site.me.role !== "STAFF") return;
    note("Staff accounts cannot administer accounts", "sign in with an administrator or owner account");
  }

  async function issueRecoveryKey({ replacing }) {
    const me = signedIn();
    if (me.role !== "OWNER") throw new Error("Only the owner has a recovery key.");
    if (replacing && !await ask.confirm("yes", "A new key immediately invalidates the current one, including any copy on paper or another computer.")) return note("Cancelled");
    const { recoveryKey } = await site.call("POST", "/api/staff/me/recovery-key");
    if (process.platform === "win32") {
      pair(site.url, recoveryKey);
      pass("This computer is paired", `the key is encrypted for your Windows user in ${settingsDir}`);
      if (await ask.yes("  Also show the key once to keep an offline copy (paper, password manager)?")) showOnce("Recovery key", recoveryKey, "Keep it offline; anyone holding it can reset the owner password.");
    } else {
      showOnce("Recovery key", recoveryKey, "This computer cannot store it safely. Keep it offline; anyone holding it can reset the owner password.");
    }
  }

  const actions = {
    1: async () => {
      await site.signOut();
      await signIn(await ask("  Username: "), await ask.hidden("  Password: "));
    },
    2: async () => { signedIn(); printAccounts(await accounts()); },
    3: async () => {
      const me = signedIn();
      const username = validUsername(await ask("  New username (e.g. jdelacruz): "));
      const displayName = validDisplayName(await ask("  Display name (shown in the app and history): "));
      const role = me.role === "OWNER" && /^a/i.test(await ask("  Role — Staff or Administrator? [S/a]: ")) ? "ADMIN" : "STAFF";
      const secret = await choosePassword(ask);
      if (!await guard(`Create ${ROLE_NAMES[role]} account "${username}"`)) return note("Cancelled");
      const created = await site.call("POST", "/api/staff/admin/accounts", { username, displayName, role, ...secret });
      reported(`Account "${created.username}" created (${ROLE_NAMES[role]})`, created.generatedPassword, created.username);
    },
    4: async () => {
      const account = await pickAccount();
      const secret = await choosePassword(ask);
      if (!await guard(`Reset the password of "${account.username}" and sign them out everywhere`)) return note("Cancelled");
      const result = await site.call("POST", accountPath(account, "/password"), secret);
      reported("Password reset; their open sessions were signed out", result.generatedPassword, account.username);
    },
    5: async () => {
      const account = await pickAccount();
      const displayName = await ask(`  Display name [${account.displayName}] (Enter to keep): `);
      const username = await ask(`  Username [${account.username}] (Enter to keep): `);
      let role;
      if (signedIn().role === "OWNER" && account.id !== site.me.id) {
        const answer = (await ask(`  Role [${ROLE_NAMES[account.role]}] — Staff, Administrator or Owner (Enter to keep): `)).toLowerCase();
        role = { s: "STAFF", a: "ADMIN", o: "OWNER" }[answer[0]];
      }
      const change = { ...(displayName ? { displayName } : {}), ...(username ? { username } : {}), ...(role && role !== account.role ? { role } : {}) };
      if (!Object.keys(change).length) return note("No changes");
      if (!await guard(`Edit "${account.username}"${change.username || change.role ? " (this signs them out everywhere)" : ""}`)) return note("Cancelled");
      const result = await site.call("PATCH", accountPath(account), change);
      pass("Account updated", result.sessionsRevoked ? "their open sessions were signed out" : "");
    },
    6: async () => {
      const account = await pickAccount();
      const active = !account.active;
      if (!await guard(`${active ? "Enable" : "Disable"} "${account.username}"${active ? "" : " and sign them out everywhere"}`)) return note("Cancelled");
      await site.call("PATCH", accountPath(account), { active });
      pass(`"${account.username}" ${active ? "enabled" : "disabled"}`);
    },
    7: async () => {
      const account = await pickAccount();
      if (!await guard(`Sign "${account.username}" out on every device`)) return note("Cancelled");
      await site.call("POST", accountPath(account, "/sessions/revoke"));
      pass(`"${account.username}" signed out everywhere`);
    },
    8: async () => {
      const paired = pairedKey(site.url);
      const recoveryKey = paired ? paired.key() : (await ask.hidden("  Recovery key (starts with LHR1.): ")).trim();
      if (paired) pass("Using this computer's paired recovery key", `issued ${when(paired.pairedAt)}`);
      console.log("  Choose the owner's new password.");
      const secret = await choosePassword(ask, { allowGenerate: false });
      if (!await guard("Reset the OWNER password with the recovery key and sign the owner out everywhere")) return note("Cancelled");
      const { username } = await site.call("POST", "/api/recovery/owner", { recoveryKey, newPassword: secret.password });
      // The key is single-use: forget it, sign in with the new password, and issue a fresh one.
      if (paired) unpair();
      await site.signOut();
      pass("Owner password reset", `${username} was signed out everywhere; the used key no longer works`);
      await signIn(username, secret.password);
      console.log("  Issuing a new recovery key to replace the used one.");
      await issueRecoveryKey({ replacing: false });
    },
    9: () => issueRecoveryKey({ replacing: Boolean(signedIn().recovery?.configured) }),
    10: async () => {
      const me = signedIn();
      if (me.role !== "OWNER") throw new Error("Only the owner has a recovery key.");
      if (!me.recovery?.configured) return note("No recovery key is set", "choose 9 to create one and pair this computer");
      if (/^r/i.test(await ask("  Rotate (new key, re-pair) or Delete (no key at all)? [R/d]: "))) return issueRecoveryKey({ replacing: true });
      if (!await ask.confirm("yes", "Without a recovery key a forgotten owner password needs Cloudflare access to fix.")) return note("Cancelled");
      await site.call("DELETE", "/api/staff/me/recovery-key");
      unpair();
      site.me = await site.call("GET", "/api/staff/session");
      pass("Recovery key revoked", "no key exists now");
    },
    11: async () => {
      console.log(c.bold("\nLocal preview"));
      (await verify(PREVIEW_URL, { database: "local" })) ? console.log(c.green("\n  Preview is healthy.")) : console.log(c.yellow("\n  Start it with  npm run dev:live  and try again."));
    },
    12: async () => {
      const url = config.productionUrl ?? lastDeployment()?.url;
      if (url) {
        console.log(c.bold("\nProduction site"));
        await verify(url, {});
      } else note("Production site", "address not known yet; set it with S");
      await status();
    },
    13: async () => {
      const ok = await deploy(ask);
      if (ok) Object.assign(config, readUserConfig());
    },
    14: async () => {
      console.log(c.bold("\nFirst-time owner setup (production)"));
      console.log(c.dim("  Only for a database with no owner yet. Needs Cloudflare sign-in once; afterwards everything goes through the site."));
      const d1 = checkConfig();
      if (!d1 || !checkAuth()) return;
      let owners;
      try { [{ owners }] = runD1("SELECT COUNT(*) AS owners FROM staff_accounts WHERE role = 'OWNER'", { remote: true, json: true }); }
      catch (error) { throw new Error(`${error.message} Deploy first (13) so the production database has owner support.`); }
      if (owners > 0) return fail("An owner already exists", "", "Sign in as the owner (1), or use Forgot owner password (8).");
      const username = validUsername(await ask("  Owner username: "));
      const displayName = validDisplayName(await ask("  Owner display name: "));
      const secret = await choosePassword(ask, { allowGenerate: false });
      if (!await ask.confirm("yes", `Create OWNER "${username}" in production D1 ${EXPECTED.database}.`)) return note("Cancelled");
      runD1(`${createAccountSql(username, displayName, secret.password, "OWNER")} INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json) SELECT lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ','now'), id, 'OWNER_BOOTSTRAPPED', 'ACCOUNT', id, json_object('username', username) FROM staff_accounts WHERE username = '${username}';`, { remote: true });
      pass(`Owner "${username}" created`);
      const url = config.productionUrl ?? lastDeployment()?.url;
      if (!url) return note("Next", "set the production address with S, sign in (1), then pair this computer (9)");
      site = new Site(url);
      await signIn(username, secret.password);
      await issueRecoveryKey({ replacing: false });
    },
    s: async () => {
      const current = config.productionUrl ?? lastDeployment()?.url;
      const answer = await ask(`  P = production${current ? ` (${current})` : ""}, L = local preview (${PREVIEW_URL}), or paste a production https:// address: `);
      let url = /^l/i.test(answer) ? PREVIEW_URL : /^https:\/\//i.test(answer) ? new URL(answer).origin : current;
      if (!url) throw new Error("Paste the production address (https://…) first.");
      if (url !== PREVIEW_URL) config.productionUrl = url;
      await site.signOut();
      site = new Site(url);
      saveConfig({ ...config, site: url });
      pass("Site", url);
    }
  };

  for (;;) {
    const who = site.me ? `${site.me.displayName} (${ROLE_NAMES[site.me.role]})` : c.dim("not signed in");
    console.log(`\n${c.bold("LOGISTICS HUB — OWNER CONSOLE")}\n`);
    console.log(`${label()}  ${site.url}  ·  ${who}`);
    console.log(`\n${c.dim("Accounts")}\n   1. Sign in\n   2. List accounts\n   3. Create account\n   4. Reset a password\n   5. Edit account (name, username, role)\n   6. Enable or disable an account\n   7. Sign an account out everywhere`);
    console.log(`\n${c.dim("Owner recovery")}\n   8. Forgot owner password\n   9. Pair this computer (new recovery key)\n  10. Rotate or delete the recovery key`);
    console.log(`\n${c.dim("Developer (Cloudflare sign-in)")}\n  11. Preview status\n  12. Production status\n  13. Deploy verified main\n  14. First-time owner setup`);
    console.log(`\n   S. Switch site (production / local preview)\n   0. Exit\n`);
    let choice;
    try { choice = (await ask("Choose: ")).toLowerCase(); } catch { break; }
    if (choice === "0" || choice === "q") break;
    const action = actions[choice];
    if (!action) { console.log(c.yellow("  Choose a number from the menu.")); continue; }
    try { await action(); } catch (error) { console.log(`  ${c.red("✗")} ${error.message}`); }
  }
  await site.signOut();
  ask.close();
}

/* ---------- entry ---------- */

const [command, ...rest] = process.argv.slice(2);
try {
  if (!command) await interactive();
  else if (command === "install-launcher") {
    const launcher = installLauncher(rest[0]);
    pass(launcher.changed ? "Launcher written" : "Launcher already up to date", launcher.file);
  } else {
    if (!fs.existsSync(wrangler)) throw new Error("Dependencies are missing. Run  npm ci  first.");
    if (command === "status") process.exitCode = await status() ? 0 : 1;
    else if (command === "deploy") {
      const ask = prompter();
      try { process.exitCode = await deploy(ask) ? 0 : 1; } finally { ask.close(); }
    } else if (command === "verify") {
      const url = rest.find((value) => value.startsWith("http")) ?? readUserConfig().productionUrl ?? lastDeployment()?.url;
      if (!url) throw new Error("Usage: npm run admin -- verify <url> [--local]");
      process.exitCode = await verify(url, { database: rest.includes("--local") ? "local" : "remote" }) ? 0 : 1;
    } else throw new Error("Usage: npm run admin [-- status | deploy | verify <url> [--local] | install-launcher [folder]]");
  }
} catch (error) {
  console.error(`${c.red("✗")} ${error.message}`);
  process.exitCode = 1;
}
