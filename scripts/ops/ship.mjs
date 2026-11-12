#!/usr/bin/env node
// Ship a qualified pull request (LH-CD-01; V1.17 task, docs/road-to-v2/v1.17-ci-only-deploy-task.md, "After the switch").
// GitHub's merge button makes a new commit that never gets the combined CodeQL check, so the Deploy gate refuses it. This
// fast-forwards `main` to the PR's own checked head instead: the commit that shipped is the commit every check passed on.
//
//   node scripts/ops/ship.mjs <pr>          report whether the PR can ship; changes nothing
//   node scripts/ops/ship.mjs <pr> --push   fast-forward main to its head (needs Earl's go-ahead for that PR)
//
// It reads main's protection rules instead of copying them, so a changed rule is never silently skipped.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SHA = /^[0-9a-f]{40}$/;

/**
 * Whether a PR can be fast-forwarded onto main. Pure: every fact comes in as data.
 * pr: `gh pr view --json state,isDraft,baseRefName,headRefOid`; required: [{ context, app_id }] from main's protection;
 * checks: the head commit's check runs; upToDate: whether main is an ancestor of the head (strict, and a fast-forward).
 */
export function shipDecision({ pr, required, checks, upToDate }) {
  const reasons = [];
  if (pr?.state !== "OPEN") reasons.push(`the PR is ${pr?.state ?? "unreadable"}, not open`);
  if (pr?.isDraft) reasons.push("the PR is a draft");
  if (pr?.baseRefName !== "main") reasons.push(`the PR targets ${pr?.baseRefName}, not main`);
  const sha = pr?.headRefOid;
  if (!SHA.test(sha ?? "")) reasons.push("the PR names no head commit");
  if (!Array.isArray(required) || required.length === 0) reasons.push("main's required checks could not be read");
  if (!upToDate) reasons.push("the head is not based on the current main; update the branch and let its checks run again");
  for (const rule of Array.isArray(required) ? required : []) {
    // The latest run of each required check on this exact head, from the app the rule names.
    const runs = (Array.isArray(checks) ? checks : []).filter((run) => run?.head_sha === sha && run.name === rule.context
      && (rule.app_id == null || run.app?.id === rule.app_id));
    const latest = runs.sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
    if (!latest) reasons.push(`${rule.context} has not run on ${sha?.slice(0, 7)}`);
    else if (latest.status !== "completed") reasons.push(`${rule.context} is still ${latest.status}`);
    else if (latest.conclusion !== "success") reasons.push(`${rule.context} ended ${latest.conclusion}`);
  }
  return { ship: reasons.length === 0, sha, reasons };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${(result.stderr || "").trim().split("\n").pop()}`);
  return result.stdout;
}
const ghJson = (args) => JSON.parse(run("gh", args));

async function cli() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { push: { type: "boolean", default: false } } });
  const number = positionals[0];
  if (!/^\d+$/.test(number ?? "")) throw new Error("Usage: node scripts/ops/ship.mjs <pr-number> [--push]");
  const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  const pr = ghJson(["pr", "view", number, "--json", "state,isDraft,baseRefName,headRefOid,url"]);
  const required = ghJson(["api", `repos/${repo}/branches/main/protection/required_status_checks`]).checks;
  const checks = ghJson(["api", `repos/${repo}/commits/${pr.headRefOid}/check-runs?filter=all&per_page=100`]).check_runs;
  run("git", ["fetch", "--quiet", "origin", "main", `pull/${number}/head`]);
  const upToDate = spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", pr.headRefOid]).status === 0;
  const decision = shipDecision({ pr, required, checks, upToDate });
  if (!decision.ship) {
    console.error(`Not shipping ${pr.url}:\n- ${decision.reasons.join("\n- ")}`);
    process.exit(1);
  }
  if (!values.push) {
    console.log(`${pr.url} can ship: main would fast-forward to ${decision.sha}. Run again with --push once Earl has said to merge it.`);
    return;
  }
  // A plain push, never --force: GitHub refuses it unless it is a fast-forward to a commit whose required checks passed.
  run("git", ["push", "origin", `${decision.sha}:refs/heads/main`]);
  console.log(`main is now ${decision.sha} (${pr.url}). GitHub marks the PR merged; CI on main runs next, then Deploy.`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
