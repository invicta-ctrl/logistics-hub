#!/usr/bin/env node
// Post-deploy smoke check (LH-CD-01), run by .github/workflows/deploy.yml right after a real deploy. It passes only when the
// live site serves the exact entry bundle this build produced and the public catalog answers; otherwise the workflow rolls
// back to the version that was live before. Read-only: two public GETs per attempt, no credentials.
//
//   node scripts/ops/smoke.mjs --url https://logistics.hausc.org --dist release/dist
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";

/** The hashed module entry a build's index.html loads, e.g. /assets/main-DtRBHjiH.js. */
export function entryBundle(html) {
  return html.match(/<script[^>]*type="module"[^>]*src="(\/assets\/[^"]+\.js)"/)?.[1] ?? null;
}

/** One attempt. fetchText(url) resolves { status, text }. Returns null when healthy, else the reason. */
export async function smokeOnce(base, expected, fetchText) {
  const home = await fetchText(new URL("/", base).href);
  if (home.status !== 200) return `home page answered ${home.status}`;
  const live = entryBundle(home.text);
  if (live !== expected) return `home page loads ${live ?? "no entry bundle"}, not this build's ${expected}`;
  const bundle = await fetchText(new URL(expected, base).href);
  if (bundle.status !== 200) return `entry bundle answered ${bundle.status}`;
  const catalog = await fetchText(new URL("/api/public/catalog", base).href);
  if (catalog.status !== 200) return `public catalog answered ${catalog.status}`;
  try { if (!Array.isArray(JSON.parse(catalog.text).items)) return "public catalog has no items list"; } catch { return "public catalog is not JSON"; }
  return null;
}

/** Retries while the new version propagates; resolves null when healthy, else the last reason. */
export async function smoke(base, expected, fetchText, { attempts = 12, wait = 10_000, sleep = setTimeout } = {}) {
  let reason = "not tried";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { reason = await smokeOnce(base, expected, fetchText); } catch (error) { reason = `request failed: ${error.message}`; }
    if (reason === null) return null;
    if (attempt < attempts) await sleep(wait);
  }
  return reason;
}

async function cli() {
  const { values } = parseArgs({ options: { url: { type: "string" }, dist: { type: "string" } } });
  if (!/^https:\/\/[a-z0-9.-]+$/.test(values.url ?? "") || !values.dist) throw new Error("--url https://<host> and --dist <dir> are required.");
  const expected = entryBundle(fs.readFileSync(path.join(values.dist, "index.html"), "utf8"));
  if (!expected) throw new Error("This build's index.html names no entry bundle.");
  const fetchText = async (url) => {
    const response = await fetch(url, { headers: { "cache-control": "no-cache" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    return { status: response.status, text: await response.text() };
  };
  const reason = await smoke(values.url, expected, fetchText);
  if (reason) { console.error(`Smoke check failed: ${reason}.`); process.exit(1); }
  console.log(`Smoke check passed: ${values.url} serves ${expected} and the public catalog answers.`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
