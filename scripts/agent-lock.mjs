import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [command = "status", requestedAgent] = process.argv.slice(2);
const allowed = new Set(["codex", "claude", "forge"]);
const stateDir = path.resolve(".agent-state");
const lockPath = path.join(stateDir, "lock.json");

function readLock() {
  if (!fs.existsSync(lockPath)) return null;
  try { return JSON.parse(fs.readFileSync(lockPath, "utf8")); }
  catch { return { agent: "UNKNOWN", invalid: true }; }
}

function gitValue(args) {
  try { return execFileSync("git", args, { encoding: "utf8" }).trim(); }
  catch { return ""; }
}

function status() {
  const lock = readLock();
  const result = {
    worktree: process.cwd(),
    branch: gitValue(["branch", "--show-current"]),
    head: gitValue(["rev-parse", "HEAD"]),
    owner: lock?.agent ?? null,
    claimedAt: lock?.claimedAt ?? null
  };
  console.log(JSON.stringify(result, null, 2));
}

if (command === "status") {
  status();
  process.exit(0);
}

if (!allowed.has(requestedAgent)) {
  console.error("Agent must be 'codex', 'claude', or 'forge'.");
  process.exit(2);
}

if (command === "claim") {
  fs.mkdirSync(stateDir, { recursive: true });
  const existing = readLock();
  if (existing?.agent && existing.agent !== requestedAgent) {
    console.error(`Writer lock is owned by ${existing.agent} since ${existing.claimedAt ?? "unknown"}.`);
    process.exit(3);
  }
  const record = {
    agent: requestedAgent,
    claimedAt: new Date().toISOString(),
    branch: gitValue(["branch", "--show-current"]),
    headAtClaim: gitValue(["rev-parse", "HEAD"])
  };
  fs.writeFileSync(lockPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  console.log(`${requestedAgent} owns the shared writer lock.`);
  process.exit(0);
}

if (command === "yield") {
  const existing = readLock();
  if (!existing) {
    console.log("No active writer lock.");
    process.exit(0);
  }
  if (existing.agent !== requestedAgent) {
    console.error(`Cannot yield: lock belongs to ${existing.agent}.`);
    process.exit(4);
  }
  fs.rmSync(lockPath, { force: true });
  console.log(`${requestedAgent} yielded the shared writer lock.`);
  process.exit(0);
}

console.error("Usage: node scripts/agent-lock.mjs status|claim|yield [codex|claude|forge]");
process.exit(2);
