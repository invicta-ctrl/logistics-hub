import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { createAccountSql, runD1 } from "./staff-account.mjs";

const root = process.cwd();
const devVars = path.join(root, ".dev.vars");
const credentialPath = path.join(root, "data", "private", "local-preview-credentials.txt");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const cloudSync = path.join(root, "scripts", "sync-cloud-preview.mjs");

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
    socket.connect(port, "127.0.0.1");
  });
}

function runNode(script, args, label) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(`${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (await portInUse(8791)) {
  console.log("Logistics Hub live preview is already running at http://127.0.0.1:8791");
  console.log("Start cloud sync separately with: npm run preview:sync-cloud");
  process.exit(0);
}

const vars = fs.existsSync(devVars) ? fs.readFileSync(devVars, "utf8") : "";
if (!/^SESSION_SECRET=/m.test(vars)) {
  fs.writeFileSync(devVars, `${vars}${vars && !vars.endsWith("\n") ? "\n" : ""}SESSION_SECRET=${crypto.randomBytes(48).toString("base64url")}\n`, { mode: 0o600 });
}

// A local database migrated before the seed was split (Sept 2026) records migration
// names that no longer exist; re-running would duplicate the seed. Keep it as a backup
// and rebuild the disposable preview database from the current migrations.
const stateDir = path.join(root, ".wrangler", "state");
if (fs.existsSync(stateDir)) {
  let applied = [];
  try { applied = runD1("SELECT name FROM d1_migrations", { json: true }).map((row) => row.name); } catch { /* fresh or unreadable state */ }
  const current = new Set(fs.readdirSync(path.join(root, "migrations")));
  const stale = applied.filter((name) => !current.has(name));
  if (stale.length) {
    const backup = path.join(root, ".wrangler", `state-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    fs.renameSync(stateDir, backup);
    console.log(`Local preview database predates the current migrations (${stale.join(", ")}); moved it to ${path.relative(root, backup)} and rebuilding.`);
  }
}

console.log("Applying local D1 migrations...");
runNode(wrangler, ["d1", "migrations", "apply", "DB", "--local"], "local D1 migration");

// One local test identity per role, each with a random password kept in an ignored private file.
const existing = new Set(runD1("SELECT username FROM staff_accounts", { json: true }).map((row) => row.username));
const created = [];
for (const [role, username, name] of [["OWNER", "preview-owner", "Preview Owner"], ["ADMIN", "preview-admin", "Preview Admin"], ["STAFF", "preview-staff", "Preview Staff"]]) {
  if (existing.has(username)) continue;
  const password = crypto.randomBytes(12).toString("base64url");
  runD1(createAccountSql(username, name, password, role));
  created.push(`${role.padEnd(6)} ${username}  ${password}`);
}
if (created.length) {
  fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
  fs.appendFileSync(credentialPath, `Local preview only — http://127.0.0.1:8791/staff\n${created.join("\n")}\n`, { mode: 0o600 });
  console.log(`Created local preview accounts (${created.length}); credentials are in data/private/local-preview-credentials.txt`);
}

console.log("Typechecking and building initial frontend...");
runNode(wrangler, ["types"], "wrangler types");
runNode(tsc, ["-p", "tsconfig.json"], "frontend typecheck");
runNode(tsc, ["-p", "tsconfig.worker.json"], "worker typecheck");
runNode(vite, ["build"], "initial Vite build");

const children = [];
function start(script, args, label) {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
  children.push(child);
  child.once("exit", (code) => {
    if (code && code !== 0) console.error(`${label} exited with code ${code}`);
  });
}

console.log("\nFull local preview: http://127.0.0.1:8791");
console.log("Frontend rebuild watcher, local Worker/D1, and cloud-branch sync are running.");
console.log("Claude Cloud must commit + push working checkpoints for the local preview to receive them.\n");

start(cloudSync, [], "cloud preview sync");
start(vite, ["build", "--watch"], "vite build watcher");
start(wrangler, ["dev", "--local", "--port", "8791"], "wrangler dev");

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
