import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

const root = process.cwd();
const devVars = path.join(root, ".dev.vars");
const credentialPath = path.join(root, "data", "private", "local-preview-credentials.txt");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

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
  process.exit(0);
}

if (!fs.existsSync(devVars)) {
  const username = "preview-staff";
  const password = crypto.randomBytes(12).toString("base64url");
  const secret = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(devVars,
    `ENVIRONMENT=development\nDEV_AUTH_ENABLED=true\nSESSION_SECRET=${secret}\nDEV_STAFF_USERNAME=${username}\nDEV_STAFF_PASSWORD=${password}\n`,
    { mode: 0o600 }
  );
  fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
  fs.writeFileSync(credentialPath,
    `Local preview only\nURL: http://127.0.0.1:8791/staff\nUsername: ${username}\nPassword: ${password}\n`,
    { mode: 0o600 }
  );
  console.log("Generated loopback-only preview credentials at data/private/local-preview-credentials.txt");
}

console.log("Applying local D1 migrations...");
runNode(wrangler, ["d1", "migrations", "apply", "logistics-hub-part-01-local", "--local"], "local D1 migration");

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
console.log("Frontend rebuild watcher and local Worker/D1 are running.");
console.log("Refresh the browser after edits to see the newest full-stack build.\n");

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
