#!/usr/bin/env node
// Fail closed if a deployable change reuses the previous published product version.
// Runs on protected PRs (base SHA vs merge candidate) and pushes to main (before vs HEAD).
// History reconstruction and production acceptance remain separate owner decisions.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NON_PRODUCT = [
  /^docs\//, /^tests\//, /^\.github\//, /^\.agents\//, /^\.codex\//,
  /^\.ai-bridge\//, /^\.gitignore$/, /^\.gitattributes$/,
  /^AGENTS\.md$/, /^CLAUDE\.md$/, /^README\.md$/, /^CHANGELOG\.md$/,
  /^scripts\/verify-product-version\.mjs$/,
  /^\.prettierignore$/, /^\.editorconfig$/,
];

export function isProductChange(path) {
  // Product-release metadata is built into the deployed artifact.
  if (path === "product-release.json") return true;
  if (!path || path.includes("..") || path.includes("\\")) return true;
  return !NON_PRODUCT.some((pattern) => pattern.test(path));
}

export function parseProductVersion(value) {
  if (typeof value !== "string") return null;
  const m = /^V(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/.exec(value);
  if (!m) return null;
  const [major, minor, patch] = m.slice(1).map((part) => part === undefined ? null : Number(part));
  if (![major, minor, patch].every((part) => part === null || Number.isSafeInteger(part))) return null;
  if (patch === 0) return null; // base release is V1.15, never V1.15.0
  return { major, minor, patch };
}

export function nextVersionAllowed(before, after) {
  const a = parseProductVersion(before), b = parseProductVersion(after);
  if (!a || !b) return false;
  // An independently merged patch gets precisely the next integer.
  if (a.major === b.major && a.minor === b.minor) {
    return b.patch === (a.patch === null ? 1 : a.patch + 1);
  }
  // An accepted new main release may advance the minor line (or major at .1).
  // CI validates syntax and record; human acceptance is still indispensable.
  return b.patch === null &&
    ((a.major === b.major && b.minor === a.minor + 1) ||
     (b.major === a.major + 1 && b.minor === 1));
}

export function checkVersionChange({ paths, before, after, recordExists = () => false }) {
  const failures = [];
  const impacting = paths.filter(isProductChange);
  const b = parseProductVersion(before?.version), a = parseProductVersion(after?.version);
  if (!a || !b) failures.push("Invalid previous or candidate product version.");
  if (!impacting.length) return { impacting, failures };

  if (!paths.includes("product-release.json")) failures.push("Product-affecting changes require product-release.json in this same PR/merge.");
  if (!nextVersionAllowed(before.version, after.version)) {
    failures.push("Product version must advance by exactly one revision, or be an independently accepted next main release.");
  }
  if (before.sourceCommit === after.sourceCommit || !/^[a-f0-9]{40}$/.test(after.sourceCommit ?? "")) {
    failures.push("Release sourceCommit must change to a verified full source SHA.");
  }
  const changes = after?.changes;
  if (!Array.isArray(changes) || changes.length < 2 || changes.length > 5 ||
      changes.some((text) => typeof text !== "string" || !text.trim() || text.length > 240)) {
    failures.push("Release must include 2–5 plain, non-empty changelog lines.");
  }
  const record = after?.record;
  if (typeof record !== "string" || (!/^docs\/[A-Za-z0-9/._-]+\.md$/.test(record) || record.includes("..")) || !recordExists(record)) {
    failures.push("Release must point to an existing canonical docs/**.md release record.");
  }
  return { impacting, failures };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim();
}

export function main() {
  const base = process.env.VERSION_BASE_SHA;
  if (!/^[a-f0-9]{40}$/.test(base ?? "")) {
    throw new Error("Missing exact PR base / previous main SHA. Refuse unqualified revision verification.");
  }
  const head = git("rev-parse", "HEAD");
  const paths = git("diff", "--name-only", base, head).split("\n").filter(Boolean);
  const before = JSON.parse(git("show", base + ":product-release.json"));
  const after = JSON.parse(readFileSync("product-release.json", "utf8"));
  const { impacting, failures } = checkVersionChange({ paths, before, after, recordExists: existsSync });
  console.log("Version governance: before=" + before.version + " candidate=" + after.version +
    " head=" + head.slice(0, 12) + " product_paths=" + impacting.length);
  if (!impacting.length) {
    console.log("No product-affecting change: documentation/tests/governance only; no revision minted.");
    return;
  }
  console.log("Changed product paths: " + impacting.join(", "));
  if (failures.length) {
    for (const message of failures) console.error("::error::" + message);
    throw new Error("Product version governance gate failed. Do not merge or deploy.");
  }
  console.log("Product revision metadata shape passes. Owner acceptance, actual deployment identity and postflight remain separate mandatory gates.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
