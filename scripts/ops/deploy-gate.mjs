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

function cli() {
  const { values } = parseArgs({ options: { "release-dir": { type: "string" }, wrangler: { type: "string" } } });
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

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
