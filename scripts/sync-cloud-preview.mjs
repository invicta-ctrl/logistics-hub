import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const stateDir = path.join(root, ".agent-state");
const lockPath = path.join(stateDir, "lock.json");
const intervalMs = 5000;

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
  }).trim();
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

function workingTreeDirty() {
  return Boolean(git(["status", "--porcelain"], { quiet: true }));
}

function currentBranch() {
  return git(["branch", "--show-current"], { quiet: true });
}

function remoteSliceBranches() {
  const out = git(
    ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/slice/"],
    { quiet: true }
  );
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function branchExists(name) {
  try {
    git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function syncOnce() {
  if (localWriterActive()) return;
  if (workingTreeDirty()) return;

  try {
    git(["fetch", "origin", "--prune"], { quiet: true });
  } catch (error) {
    console.error("[cloud-sync] fetch failed:", error.message);
    return;
  }

  const slices = remoteSliceBranches();

  if (slices.length > 1) {
    console.error("[cloud-sync] multiple remote slice branches found; refusing automatic checkout:", slices.join(", "));
    return;
  }

  try {
    if (slices.length === 1) {
      const remote = slices[0];
      const local = remote.replace(/^origin\//, "");
      const current = currentBranch();

      if (current !== local) {
        if (branchExists(local)) {
          git(["switch", local], { quiet: true });
        } else {
          git(["switch", "--track", "-c", local, remote], { quiet: true });
        }
        console.log(`[cloud-sync] switched local preview to ${local}`);
      }

      const before = git(["rev-parse", "HEAD"], { quiet: true });
      git(["merge", "--ff-only", remote], { quiet: true });
      const after = git(["rev-parse", "HEAD"], { quiet: true });

      if (before !== after) {
        console.log(`[cloud-sync] updated ${local}: ${before.slice(0, 7)} -> ${after.slice(0, 7)}`);
      }
      return;
    }

    // No active slice branch remains. Follow main.
    const current = currentBranch();
    if (current !== "main") {
      git(["switch", "main"], { quiet: true });
      console.log("[cloud-sync] active slice disappeared; switched preview back to main");
    }

    const before = git(["rev-parse", "HEAD"], { quiet: true });
    git(["merge", "--ff-only", "origin/main"], { quiet: true });
    const after = git(["rev-parse", "HEAD"], { quiet: true });
    if (before !== after) {
      console.log(`[cloud-sync] updated main: ${before.slice(0, 7)} -> ${after.slice(0, 7)}`);
    }
  } catch (error) {
    console.error("[cloud-sync] sync skipped:", error.message);
  }
}

console.log("[cloud-sync] watching GitHub for one active slice/* branch every 5s");
console.log("[cloud-sync] pauses automatically while a local writer lock exists or the worktree is dirty");

syncOnce();
setInterval(syncOnce, intervalMs);
