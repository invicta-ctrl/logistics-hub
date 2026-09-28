// Logistics Hub local operator console.
//
//   npm run admin                 interactive menu (accounts, status, deploy, verify)
//   npm run admin -- status       Cloudflare/deployment readiness report
//   npm run admin -- deploy       preflight, migrate, deploy and verify production
//   npm run admin -- verify [url] [--local]   smoke-test a deployment
//
// Cloudflare access uses standard Wrangler authentication (`npx wrangler login`
// or a CLOUDFLARE_API_TOKEN environment variable). No credential is stored here.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { accountSql, checkPassword, createAccountSql, generatePassword, runD1, validUsername, wrangler } from "./staff-account.mjs";

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
    const health = await fetch(`${record.url}/api/public/catalog`).then((response) => response.status, () => 0);
    (health === 200 ? pass : fail)("Live site", `${record.url} (commit ${record.commit}) → HTTP ${health || "unreachable"}`);
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
  const pending = pendingMigrations() ?? [];
  const secrets = wr(["secret", "list", "--name", EXPECTED.worker]);
  const needsSecret = !(secrets.ok && secrets.stdout.includes("SESSION_SECRET"));
  const commit = git("rev-parse", "--short", "HEAD");

  console.log(c.bold("\n3. Plan"));
  console.log(`  Worker        ${EXPECTED.worker}`);
  console.log(`  D1            ${EXPECTED.database} (${d1.database_id})`);
  console.log(`  Commit        ${commit}  ${c.dim(git("log", "-1", "--format=%s"))}`);
  console.log(`  Migrations    ${pending.length ? pending.join(", ") : "none pending"}`);
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
    saveDeployment({ url, commit, deployedAt: new Date().toISOString(), d1Bookmark: bookmark });
    console.log(c.bold("\n5. Verify"));
    const verified = await verify(url, { remote: true });
    console.log(verified
      ? c.green(`\nLive and verified: ${url}  (commit ${commit})`)
      : c.red(`\nDeployed but verification failed. Roll back with  npx wrangler rollback  and, if data is affected,  npx wrangler d1 time-travel restore ${EXPECTED.binding} --bookmark=${bookmark}`));
    return verified;
  } finally {
    if (secretsFile) fs.rmSync(path.dirname(secretsFile), { recursive: true, force: true });
  }
}

async function verify(url, { remote }) {
  let ok = true;
  const check = (condition, label, detail) => { ok = (condition ? pass(label) : fail(label, detail)) && ok; };
  const get = (route, init = {}) => fetch(new URL(route, url), { redirect: "manual", ...init }).catch(() => null);
  console.log(c.dim(`  ${url}`));
  const home = await get("/");
  check(home?.status === 200 && home.headers.get("content-type")?.includes("text/html"), "Landing page serves HTML", `HTTP ${home?.status ?? "unreachable"}`);
  check(home?.headers.get("content-security-policy")?.includes("default-src 'self'") && home.headers.get("x-frame-options") === "DENY", "Security headers present", "CSP / X-Frame-Options missing");
  check((await get("/lending"))?.status === 200, "Lending Hub route", "");
  const catalog = await get("/api/public/catalog");
  const body = catalog?.status === 200 ? await catalog.json().catch(() => null) : null;
  check(Number.isInteger(body?.revision) && Array.isArray(body?.items), "Public catalog API", `HTTP ${catalog?.status}`);
  const etag = catalog?.headers.get("etag");
  check(Boolean(etag) && (await get("/api/public/catalog", { headers: { "if-none-match": etag } }))?.status === 304, "Live-update revision (ETag/304)", "");
  check((await get("/api/staff/session"))?.status === 401, "Staff API requires sign-in", "");
  const shell = await get("/staff/inventory");
  check(shell?.status === 302 && shell.headers.get("location")?.endsWith("/staff"), "Staff pages redirect when signed out", `HTTP ${shell?.status}`);
  const write = await get("/api/staff/items/ITM-0001/movements", { method: "POST", headers: { origin: new URL(url).origin, "content-type": "application/json" }, body: JSON.stringify({ kind: "IN", quantity: 1, key: "verify-anonymous-write" }) });
  check(write?.status === 401, "Anonymous stock writes are rejected", `HTTP ${write?.status}`);
  const login = await get("/api/staff/login", { method: "POST", headers: { origin: new URL(url).origin, "content-type": "application/json" }, body: JSON.stringify({ username: "verify-no-such-user", password: randomBytes(18).toString("base64url") }) });
  check(login?.status === 401, "Sign-in is configured (session key present)", login?.status === 503 ? "SESSION_SECRET missing" : `HTTP ${login?.status}`);
  try {
    const [row] = runD1("SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT on_hand FROM inventory_balances WHERE id = 'ITM-0001') AS itm1, (SELECT migration_delta FROM inventory_balances WHERE id = 'ITM-0001') AS delta, (SELECT COUNT(*) FROM inventory_balances WHERE migration_delta <> 0) AS discrepancies", { remote, json: true });
    check(row.items >= 397, "Inventory migrated", `${row.items} items`);
    check(row.delta === -1 && row.discrepancies === 1, "ITM-0001 reconciliation evidence preserved", `delta ${row.delta}, discrepancies ${row.discrepancies}`);
    pass("ITM-0001 current on-hand", String(row.itm1));
  } catch (error) {
    check(false, "D1 checks", error.message);
  }
  return ok;
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
  ask.close = () => rl.close();
  return ask;
}

function printAccounts(rows) {
  if (!rows.length) return console.log(c.dim("  No staff accounts yet. Choose 2 to create one."));
  const columns = ["username", "name", "state", "last_sign_in", "open_sessions"];
  const width = Object.fromEntries(columns.map((key) => [key, Math.max(key.length, ...rows.map((row) => String(row[key]).length))]));
  console.log(c.dim(`  ${columns.map((key) => key.replaceAll("_", " ").padEnd(width[key])).join("   ")}`));
  for (const row of rows) console.log(`  ${columns.map((key) => { const text = String(row[key]).padEnd(width[key]); return key === "state" && row.state === "disabled" ? c.yellow(text) : text; }).join("   ")}`);
}

async function newPassword(ask) {
  const typed = await ask.hidden("  New password (at least 12 characters; press Enter to generate one): ");
  if (!typed) {
    const generated = generatePassword();
    console.log(`  Generated password: ${c.bold(generated)}`);
    console.log(c.dim("  It is shown once and never stored. Give it to the staff member privately."));
    return generated;
  }
  checkPassword(typed);
  if (typed !== await ask.hidden("  Repeat the password: ")) throw new Error("Passwords did not match. Nothing was changed.");
  return typed;
}

async function interactive() {
  const ask = prompter();
  let remote = true;
  const d1 = (sql, json = false) => runD1(sql, { remote, json });
  const envLabel = () => remote ? c.inverse(c.red(" PRODUCTION ")) : c.inverse(c.green(" LOCAL "));
  const guard = async (action) => !remote || ask.confirm("production", `${action} on PRODUCTION (D1 ${EXPECTED.database}).`);
  const pickAccount = async () => {
    const username = await ask("  Username: ");
    const [row] = d1(accountSql.exists(username), true);
    if (!row) throw new Error(`No account named "${username}".`);
    return row;
  };
  const actions = {
    1: async () => printAccounts(d1(accountSql.list, true)),
    2: async () => {
      const username = validUsername(await ask("  New username (e.g. jdelacruz): "));
      if (d1(accountSql.exists(username), true).length) throw new Error(`"${username}" already exists.`);
      const name = await ask("  Display name (shown in the app and history): ");
      const password = await newPassword(ask);
      if (!await guard(`Create account "${username}"`)) return note("Cancelled");
      d1(createAccountSql(username, name, password));
      pass(`Account "${username}" created`);
    },
    3: async () => {
      const account = await pickAccount();
      const password = await newPassword(ask);
      if (!await guard(`Reset the password of "${account.username}" and sign them out everywhere`)) return note("Cancelled");
      d1(accountSql.resetPassword(account.username, password));
      pass("Password reset", "their open sessions were signed out");
    },
    4: async () => {
      const account = await pickAccount();
      const name = await ask(`  Display name [${account.name}] (Enter to keep): `);
      const username = await ask(`  Username [${account.username}] (Enter to keep): `);
      if (!name && !username) return note("No changes");
      if (username && username !== account.username && d1(accountSql.exists(validUsername(username)), true).length) throw new Error(`"${username}" already exists.`);
      if (!await guard(`Edit "${account.username}"${username ? " (a username change signs them out)" : ""}`)) return note("Cancelled");
      if (name) d1(accountSql.setDisplayName(account.username, name));
      if (username && username !== account.username) d1(accountSql.rename(account.username, username));
      pass("Account updated");
    },
    5: async () => {
      const account = await pickAccount();
      if (!await guard(`Enable "${account.username}"`)) return note("Cancelled");
      d1(accountSql.setActive(account.username, true));
      pass(`"${account.username}" enabled`);
    },
    6: async () => {
      const account = await pickAccount();
      if (!await guard(`Disable "${account.username}" and sign them out everywhere`)) return note("Cancelled");
      d1(accountSql.setActive(account.username, false));
      pass(`"${account.username}" disabled`, "their open sessions were signed out");
    },
    7: () => status(),
    8: () => deploy(ask),
    9: async () => {
      const record = lastDeployment();
      const url = (await ask(`  Site URL${record ? ` [${record.url}]` : ""}: `)) || record?.url;
      if (!url) throw new Error("No deployment recorded yet. Deploy first (8) or enter the site URL.");
      console.log(c.bold("\nProduction verification"));
      (await verify(url, { remote: true })) ? console.log(c.green("\nAll checks passed.")) : console.log(c.red("\nSome checks failed."));
    },
    e: async () => { remote = !remote; }
  };

  for (;;) {
    console.log(`\n${c.bold("LOGISTICS HUB — LOCAL ADMIN")}\n`);
    console.log(`${c.dim("Environment")}  ${envLabel()}  ${remote ? `Worker ${EXPECTED.worker} · D1 ${EXPECTED.database}` : "local preview database (.wrangler/state)"}`);
    console.log(`\n${c.dim("Accounts")}\n  1. List staff accounts\n  2. Create staff account\n  3. Reset password\n  4. Edit account (name or username)\n  5. Enable account\n  6. Disable account`);
    console.log(`\n${c.dim("Operations")}\n  7. Check Cloudflare/deployment status\n  8. Deploy latest verified main\n  9. Run production verification`);
    console.log(`\n  E. Switch to ${remote ? "LOCAL" : "PRODUCTION"} database\n  0. Exit\n`);
    let choice;
    try { choice = (await ask("Choose: ")).toLowerCase(); } catch { break; }
    if (choice === "0" || choice === "q") break;
    const action = actions[choice];
    if (!action) { console.log(c.yellow("  Choose a number from the menu.")); continue; }
    if (!remote && ["8", "9"].includes(choice)) console.log(c.dim("  (Deploy and verification always target production.)"));
    try { await action(); } catch (error) { console.log(`  ${c.red("✗")} ${error.message}`); }
  }
  ask.close();
}

/* ---------- entry ---------- */

const [command, ...rest] = process.argv.slice(2);
try {
  if (!fs.existsSync(wrangler)) throw new Error("Dependencies are missing. Run  npm ci  first.");
  if (!command) await interactive();
  else if (command === "status") process.exitCode = await status() ? 0 : 1;
  else if (command === "deploy") { const ask = prompter(); process.exitCode = await deploy(ask) ? 0 : 1; ask.close(); }
  else if (command === "verify") {
    const url = rest.find((value) => value.startsWith("http")) ?? lastDeployment()?.url;
    if (!url) throw new Error("Usage: npm run admin -- verify <url> [--local]");
    process.exitCode = await verify(url, { remote: !rest.includes("--local") }) ? 0 : 1;
  } else throw new Error("Usage: npm run admin [-- status | deploy | verify <url> [--local]]");
} catch (error) {
  console.error(`${c.red("✗")} ${error.message}`);
  process.exitCode = 1;
}
