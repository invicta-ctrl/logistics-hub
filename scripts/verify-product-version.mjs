#!/usr/bin/env node
// Pre-merge version guard. Production/owner acceptance remains a separate gate.
// Based on PR #54, aligned with the accepted V1.16 and Road-to-V3 policy.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  if (path === "product-release.json") return true;
  if (!path || path.includes("..") || path.includes("\\") || path.startsWith("/")) return true;
  return !NON_PRODUCT.some((pattern) => pattern.test(path));
}

export function parseProductVersion(value) {
  if (typeof value !== "string" || value.length > 30) return null;
  const match = /^V(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.([1-9]\d*))?$/.exec(value);
  if (!match) return null;
  const numbers = match.slice(1).map((n) => n === undefined ? null : Number(n));
  if (numbers.some((n) => n !== null && !Number.isSafeInteger(n))) return null;
  const [major, minor, patch] = numbers;
  return { major, minor, patch };
}

export function nextVersionAllowed(before, after) {
  const a = parseProductVersion(before), b = parseProductVersion(after);
  if (!a || !b) return false;
  if (b.patch !== null) {
    return a.major === b.major && a.minor === b.minor && b.patch === (a.patch ?? 0) + 1;
  }
  // Each next accepted minor release advances one position. Historical V2.0
  // was already completed before the exceptional V1.16 completion release.
  if (b.major === a.major && b.minor === a.minor + 1) return true;
  if (a.major === 1 && a.minor === 16 && b.major === 2 && b.minor === 1) return true;
  // Road-to-V3 concludes with V3.0 GA after V2.9 (not V3.1).
  return a.major === 2 && a.minor === 9 && b.major === 3 && b.minor === 0;
}

export function validNotes(changes) {
  // Match src/system-status.ts readProduct exactly.
  return Array.isArray(changes) && changes.length >= 2 && changes.length <= 5 &&
    changes.every((note) => typeof note === "string" && note === note.trim() &&
      note.length >= 2 && note.length <= 180 && !/[<>\x00-\x1f]/.test(note));
}

export function checkVersionChange({ paths, before, after, recordExists = () => false }) {
  const failures = [];
  const impacting = paths.filter(isProductChange);
  if (!parseProductVersion(before?.version) || !parseProductVersion(after?.version)) {
    failures.push("Previous or candidate product version is invalid.");
  }
  if (!impacting.length) return { impacting, failures };

  if (!paths.includes("product-release.json")) {
    failures.push("A product change must update product-release.json in the same PR.");
  }
  if (!nextVersionAllowed(before?.version, after?.version)) {
    failures.push("A product version must advance by one patch or the next accepted main release.");
  }
  if (before?.sourceCommit === after?.sourceCommit || !/^[a-f0-9]{40}$/.test(after?.sourceCommit ?? "")) {
    failures.push("Release sourceCommit must change to a full verified source SHA.");
  }
  if (!validNotes(after?.changes)) {
    failures.push("What's new must contain 2-5 trimmed, plain notes of 2-180 characters.");
  } else if (JSON.stringify(after.changes) === JSON.stringify(before?.changes)) {
    failures.push("What's new must describe this release rather than repeat the parent notes.");
  }
  const record = after?.record;
  if (typeof record !== "string" || !/^docs\/[A-Za-z0-9/._-]+\.md$/.test(record) ||
      record.includes("..") || !recordExists(record) ||
      record === before?.record || !paths.includes(record)) {
    failures.push("A new or updated canonical release record is required in the same change.");
  }
  return { impacting, failures };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim();
}

export function main() {
  const base = process.env.VERSION_BASE_SHA;
  if (!/^[a-f0-9]{40}$/.test(base ?? "") || /^0+$/.test(base)) {
    throw new Error("Missing exact PR base or previous main commit.");
  }
  const head = git("rev-parse", "HEAD");
  const paths = git("diff", "--name-only", base, head).split("\n").filter(Boolean);
  const before = JSON.parse(git("show", base + ":product-release.json"));
  const after = JSON.parse(readFileSync("product-release.json", "utf8"));
  const recordExists = (record) => {
    try { git("cat-file", "-e", "HEAD:" + record); return true; } catch { return false; }
  };
  const { impacting, failures } = checkVersionChange({ paths, before, after, recordExists });
  if (impacting.length && /^[a-f0-9]{40}$/.test(after.sourceCommit ?? "")) {
    const source = after.sourceCommit;
    try {
      git("merge-base", "--is-ancestor", source, head);
      // SourceCommit may precede the release-record/manifest commits, but not
      // any later app/runtime change. Never accept a made-up or stale hash.
      const sinceSource = git("diff", "--name-only", source, head).split("\n")
        .filter((path) => path && path !== "product-release.json" && isProductChange(path));
      if (sinceSource.length) failures.push("Product source changed after sourceCommit: " + sinceSource.join(", "));
    } catch {
      failures.push("sourceCommit is not a proven ancestor of this release candidate.");
    }
  }
  console.log("Version gate: base=" + base.slice(0, 12) +
    " head=" + head.slice(0, 12) + " product_paths=" + impacting.length +
    " version=" + (after.version ?? "missing"));
  if (failures.length) {
    for (const failure of failures) console.error("::error::" + failure);
    throw new Error("Product version governance gate failed.");
  }
  console.log(impacting.length
    ? "Product version metadata qualified; production and owner gates remain separate."
    : "No product change; no revision minted.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
