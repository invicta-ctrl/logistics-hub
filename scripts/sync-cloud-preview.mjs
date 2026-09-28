import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const lockPath = path.join(root, ".agent-state", "lock.json");
const baseIntervalMs = 15_000;
const maxIntervalMs = 60_000;
const fetchTimeoutMs = 30_000;
const fetchRefspecs = [
  "+refs/heads/main:refs/remotes/origin/main",
  "+refs/heads/slice/*:refs/remotes/origin/slice/*"
];

function git(args, timeout) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout
  }).trim();
}

function gitOk(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

let lastMessage = "";
function log(message) {
  if (message !== lastMessage) console.log(`[cloud-sync] ${message}`);
  lastMessage = message;
}

function localWriterActive() {
  if (!fs.existsSync(lockPath)) return false;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return Boolean(lock?.agent);
  } catch {
    return true;
  }
}

function writerBusy() {
  return localWriterActive() || Boolean(git(["status", "--porcelain"]));
}

// A writer can claim the lock or start editing while the fetch runs, so re-check right before HEAD moves.
function mutate(args) {
  if (writerBusy()) throw new Error("a local writer became active during the fetch");
  git(args);
}

function remoteRefs() {
  return git([
    "for-each-ref",
    "--format=%(refname:short) %(objectname)",
    "refs/remotes/origin/main",
    "refs/remotes/origin/slice/"
  ]);
}

// Never leave a branch holding commits that are not on origin/main or an origin slice branch.
function safeToLeave(branch) {
  return git(["rev-list", "--count", branch, "--not", "origin/main", "--glob=refs/remotes/origin/slice/*"]) === "0";
}

function upstreamGone(branch) {
  return git(["for-each-ref", "--format=%(upstream:track)", `refs/heads/${branch}`]) === "[gone]";
}

function fastForward(local, remote) {
  const before = git(["rev-parse", "HEAD"]);
  mutate(["merge", "--ff-only", remote]);
  const after = git(["rev-parse", "HEAD"]);
  if (before !== after) log(`updated ${local}: ${before.slice(0, 7)} -> ${after.slice(0, 7)}`);
}

function followSlice(current, remote) {
  const local = remote.replace(/^origin\//, "");
  if (current !== local) {
    if (!safeToLeave(current)) {
      log(`staying on ${current}: it has unpushed commits, so ${local} was not checked out`);
      return;
    }
    const exists = gitOk(["show-ref", "--verify", "--quiet", `refs/heads/${local}`]);
    mutate(exists ? ["switch", local] : ["switch", "--track", "-c", local, remote]);
    log(`switched local preview to ${local}`);
  }
  fastForward(local, remote);
}

function followMain(current) {
  if (current !== "main") {
    // Leave only a slice that was merged and pruned upstream, never local-only or unpushed work.
    if (!upstreamGone(current) || !safeToLeave(current)) {
      log(`staying on ${current}: no active origin slice, and ${current} is not a merged and pruned slice`);
      return;
    }
    mutate(["switch", "main"]);
    log(`${current} was merged and pruned; switched preview back to main`);
  }
  fastForward("main", "origin/main");
}

// Returns true while polling should stay at the base rate.
function syncOnce() {
  if (writerBusy()) return true;

  const before = remoteRefs();
  try {
    git(["fetch", "--prune", "--no-tags", "origin", ...fetchRefspecs], fetchTimeoutMs);
  } catch (error) {
    log(`fetch failed: ${error.message}`);
    return false;
  }
  const after = remoteRefs();

  // A slice already contained in origin/main is merged; following it would move the preview backwards.
  const slices = after
    .split(/\r?\n/)
    .map((line) => line.split(" ")[0])
    .filter((ref) => ref.startsWith("origin/slice/") && !gitOk(["merge-base", "--is-ancestor", ref, "origin/main"]));

  try {
    const current = git(["branch", "--show-current"]);
    if (!current) {
      log("detached HEAD; not syncing");
    } else if (slices.length > 1) {
      log(`multiple remote slice branches found; refusing automatic checkout: ${slices.join(", ")}`);
    } else if (slices.length === 1) {
      followSlice(current, slices[0]);
    } else {
      followMain(current);
    }
  } catch (error) {
    log(`sync skipped: ${error.message}`);
  }
  return before !== after;
}

let delayMs = baseIntervalMs;
function tick() {
  delayMs = syncOnce() ? baseIntervalMs : Math.min(delayMs * 2, maxIntervalMs);
  setTimeout(tick, delayMs);
}

console.log(`[cloud-sync] following one active origin/slice/* branch, else main; polling every ${baseIntervalMs / 1000}-${maxIntervalMs / 1000}s`);
console.log("[cloud-sync] pauses while a local writer lock exists or the worktree is dirty; never leaves a branch with unpushed commits");

tick();
