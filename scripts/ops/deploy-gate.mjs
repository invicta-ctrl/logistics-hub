#!/usr/bin/env node
// Deploy gate (R9, docs/specs/accepted/2026-10-03-review-hardening-amendment.md, H8), run by .github/workflows/deploy.yml
// before every production deploy. It refuses while the release has a migration production has not applied: migrations
// reach production only through the Cloud Operations lane (production-ops.yml), never with a deploy.
//
//   node scripts/ops/deploy-gate.mjs --release-dir <checkout of the commit to deploy> --wrangler <path to wrangler.js>
//
// Its one question to Cloudflare is the fixed, read-only QUERIES.migrations of the Cloud Operations script.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import { QUERIES } from "./production-release.mjs";

const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/;

/** The release's migrations, in order. */
export function treeMigrations(releaseDir) {
  return fs.readdirSync(path.join(releaseDir, "migrations")).filter((name) => MIGRATION.test(name)).sort();
}

/** The names production has applied, from `wrangler d1 execute --json` output; null when the answer is not that shape. */
export function appliedMigrations(stdout) {
  let body;
  try { body = JSON.parse(stdout); } catch { return null; }
  const rows = Array.isArray(body) && body[0]?.success === true ? body[0].results : null;
  if (!Array.isArray(rows) || rows.some((row) => typeof row?.name !== "string")) return null;
  return rows.map((row) => row.name);
}

/** Migrations in the release that production lacks. An applied migration the release does not carry is fine: code survives a newer schema. */
export function pendingMigrations(tree, applied) {
  const done = new Set(applied);
  return tree.filter((name) => !done.has(name));
}

/** Both the latest main push analysis and the combined security result must qualify these exact bytes. */
export function codeqlState(runs, checks, sha, repo) {
  if (!Array.isArray(runs) || !Array.isArray(checks)) throw new Error("Unreadable CodeQL qualification answer.");
  const latest = (rows) => rows.filter((row) => Number.isSafeInteger(row.id) && row.id > 0).sort((a, b) => b.id - a.id)[0];
  const run = latest(runs.filter((row) => row?.head_sha === sha && row.event === "push" && row.head_branch === "main"
    && row.path === ".github/workflows/codeql.yml" && row.head_repository?.full_name === repo));
  const check = latest(checks.filter((row) => row?.head_sha === sha && row.name === "CodeQL"
    && row.app?.id === 57789 && row.app.slug === "github-advanced-security"));
  if ([run, check].some((row) => row?.status === "completed" && row.conclusion !== "success")) return "failed";
  return [run, check].every((row) => row?.status === "completed" && row.conclusion === "success") ? "success" : "pending";
}

async function requireCodeql(sha, repo) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "") || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "") || !process.env.GH_TOKEN) {
    throw new Error("A full source SHA, repository and read-only GitHub token are required.");
  }
  const read = (endpoint, key) => {
    const result = spawnSync("gh", ["api", endpoint], { encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    if (result.status !== 0) throw new Error("GitHub qualification could not be read. Nothing deployed.");
    let body;
    try { body = JSON.parse(result.stdout); } catch { throw new Error("Unreadable CodeQL qualification answer."); }
    if (!Number.isSafeInteger(body.total_count) || body.total_count < 0 || body.total_count > 100 || !Array.isArray(body[key])
      || body[key].length > 100) throw new Error("CodeQL qualification answer exceeds its bounded contract.");
    return body[key];
  };
  const deadline = Date.now() + 120_000;
  for (;;) {
    const runs = read(`repos/${repo}/actions/workflows/codeql.yml/runs?head_sha=${sha}&event=push&per_page=100`, "workflow_runs");
    const checks = read(`repos/${repo}/commits/${sha}/check-runs?check_name=CodeQL&filter=all&per_page=100`, "check_runs");
    const state = codeqlState(runs, checks, sha, repo);
    if (state === "success") { console.log(`CodeQL analysis and combined security check passed on ${sha}.`); return; }
    if (state === "failed") throw new Error("CodeQL did not qualify this exact source. Nothing deployed.");
    if (Date.now() >= deadline) throw new Error("CodeQL qualification is missing or unfinished. Nothing deployed; rerun after it passes.");
    await setTimeout(5000);
  }
}

async function cli() {
  const { values } = parseArgs({ options: { "release-dir": { type: "string" }, wrangler: { type: "string" }, "github-sha": { type: "string" }, "github-repo": { type: "string" } } });
  if (values["github-sha"] !== undefined || values["github-repo"] !== undefined) {
    if (values["release-dir"] || values.wrangler) throw new Error("GitHub and migration qualification are separate steps.");
    await requireCodeql(values["github-sha"], values["github-repo"]);
    return;
  }
  const releaseDir = values["release-dir"];
  if (!releaseDir || !values.wrangler) throw new Error("--release-dir and --wrangler are required.");
  const result = spawnSync(process.execPath, [values.wrangler, "d1", "execute", "DB", "--remote", "--json", "--command", QUERIES.migrations],
    { cwd: releaseDir, encoding: "utf8", env: { ...process.env, CI: "true", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" }, maxBuffer: 16 * 1024 * 1024 });
  const applied = result.status === 0 ? appliedMigrations(result.stdout) : null;
  if (!applied) {
    console.error("Could not read production's applied migrations, so nothing was deployed.");
    process.exit(1);
  }
  const tree = treeMigrations(releaseDir);
  const pending = pendingMigrations(tree, applied);
  if (pending.length) {
    console.error(`Not deployed: production has not applied ${pending.join(", ")}. Apply it through the Cloud Operations lane first (docs/DEPLOYMENT.md).`);
    process.exit(1);
  }
  console.log(`Production has applied all ${tree.length} migrations this release carries.`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
