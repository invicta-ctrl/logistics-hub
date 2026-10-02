#!/usr/bin/env node
// Cloud Operations: release-scoped production preparation, run from GitHub Actions (.github/workflows/production-ops.yml),
// not from anyone's PC. Authority and rules: docs/specs/accepted/2026-10-02-cloud-operations-amendment.md.
//
//   preflight  read-only checks of the exact release against production; changes nothing.
//   prepare    preflight, then: private backup, Time Travel bookmark, create the manifest's R2 buckets, apply the manifest's
//              D1 migrations, read-only reconciliation. Any unexpected state stops the run (fail closed).
//
// What is allowed is exactly what ops/releases/<release>.json lists. Every wrangler or API call goes through `allowed()`.
// The release checkout is only ever READ: wrangler runs in a fresh directory built from the manifest (see prepareWorkdir),
// never inside the release tree, so nothing the release contains (.env, another wrangler config) can steer it.
import { constants, createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** A run that stopped on purpose: the step it stopped at, a stable code, and what to do. */
export class Stop extends Error {
  constructor(step, code, message) { super(message); this.step = step; this.code = code; }
}
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MODES = ["preflight", "prepare"];
const SHA = /^[0-9a-f]{40}$/;
const BOOKMARK = /[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{16,64}/i;
/** The figures a manifest may require to stay equal; the names of the columns of QUERIES.counts. */
export const COUNT_KEYS = ["items", "movements", "onHand", "loans", "phoneEvents"];

/* ---------- Manifest and release tree ---------- */

export function loadManifest(file, release) {
  if (!/^v1\.\d{1,2}$/.test(release ?? "")) throw new Stop("PRECHECK", "BAD_RELEASE", `The release must look like v1.2, not "${release}".`);
  if (!fs.existsSync(file)) throw new Stop("PRECHECK", "NO_MANIFEST", `There is no release manifest at ${file}.`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const text = (value) => typeof value === "string" && value.length > 0;
  const d1 = manifest.target?.d1;
  const buckets = [...(manifest.target?.r2?.existing ?? []), ...(manifest.target?.r2?.create ?? [])];
  const valid = manifest.release === release && text(manifest.branch) && text(manifest.target?.worker) && text(d1?.binding) && text(d1?.name) && /^[0-9a-f-]{36}$/.test(d1?.id ?? "")
    && Array.isArray(manifest.target?.r2?.existing) && Array.isArray(manifest.target?.r2?.create) && buckets.every((bucket) => text(bucket.binding) && /^[a-z0-9-]{3,63}$/.test(bucket.name ?? ""))
    && Array.isArray(manifest.target?.forbidden) && manifest.target.forbidden.length > 0
    && Array.isArray(manifest.migrations?.pending) && manifest.migrations.pending.every((entry) => /^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name ?? "") && /^[0-9a-f]{64}$/.test(entry.sha256 ?? ""))
    && Array.isArray(manifest.expect?.schemaAdded) && Array.isArray(manifest.expect?.unchanged) && manifest.expect.unchanged.every((key) => COUNT_KEYS.includes(key))
    && manifest.expect?.tableRowsAfter && typeof manifest.expect.tableRowsAfter === "object" && Object.keys(manifest.expect.tableRowsAfter).every((table) => /^[a-z_]+$/.test(table));
  if (!valid) throw new Stop("PRECHECK", "BAD_MANIFEST", `The manifest ${file} is incomplete or does not belong to ${release}.`);
  return manifest;
}

/** wrangler.jsonc: JSON with comments and trailing commas. */
export function parseJsonc(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") { out += next; i += 1; } else if (c === '"') inString = false;
    } else if (c === '"') { inString = true; out += c; }
    else if (c === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i += 1; out += "\n"; }
    else if (c === "/" && next === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1; i += 1; }
    else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * Everything that can be checked without Cloudflare: the exact commit, that it belongs to the release (or to main), that
 * its wrangler.jsonc names only the manifest's resources (and nothing else wrangler would honour), and that its pending
 * migration files are the ones the manifest pins.
 */
export function verifyReleaseTree({ manifest, releaseDir, expectedSha, git }) {
  const stop = (code, message) => { throw new Stop("PRECHECK", code, message); };
  if (!SHA.test(expectedSha ?? "")) stop("BAD_SHA", "expected_sha must be the full 40-character commit id.");
  const head = git(["rev-parse", "HEAD"]);
  if (head !== expectedSha) stop("WRONG_SHA", `The release tree is at ${head.slice(0, 12)}, not the expected ${expectedSha.slice(0, 12)}.`);
  if (git(["status", "--porcelain"]) !== "") stop("DIRTY_TREE", "The release tree has uncommitted changes.");
  const onBranch = [`origin/${manifest.branch}`, "origin/main"].some((ref) => git(["merge-base", "--is-ancestor", expectedSha, ref], true) === "ok");
  if (!onBranch) stop("SHA_NOT_ON_RELEASE", `Commit ${expectedSha.slice(0, 12)} is on neither origin/${manifest.branch} nor origin/main.`);

  // wrangler never runs here (see prepareWorkdir), but a release that carries another config or environment file is not one we recognise.
  const stray = fs.readdirSync(releaseDir).filter((name) => /^(wrangler\.(json|toml)|\.env.*|\.dev\.vars.*)$/.test(name));
  if (stray.length) stop("UNEXPECTED_CONFIG", `The release root contains ${stray.join(", ")}; only wrangler.jsonc may configure it.`);
  const configText = fs.readFileSync(path.join(releaseDir, "wrangler.jsonc"), "utf8");
  const config = parseJsonc(configText);
  // Every key and value of the parsed config, not its comments: the real file carries a comment that warns against the old resources.
  const configJson = JSON.stringify(config);
  for (const name of manifest.target.forbidden) if (configJson.includes(name)) stop("WRONG_RESOURCE", `wrangler.jsonc configures ${name}, which no release may touch.`);
  const d1 = manifest.target.d1;
  if (config.name !== manifest.target.worker) stop("WRONG_RESOURCE", `The Worker is "${config.name}", not "${manifest.target.worker}".`);
  const bound = config.d1_databases ?? [];
  const exact = bound.length === 1 && same(Object.keys(bound[0]).sort(), ["binding", "database_id", "database_name", "migrations_dir"])
    && bound[0].binding === d1.binding && bound[0].database_name === d1.name && bound[0].database_id === d1.id && bound[0].migrations_dir === "migrations";
  if (!exact) stop("WRONG_RESOURCE", "The D1 binding in wrangler.jsonc is not exactly the manifest's database (binding, name, id and migrations_dir, with no other keys such as migrations_table).");
  const wantBuckets = [...manifest.target.r2.existing, ...manifest.target.r2.create].map((bucket) => `${bucket.binding}=${bucket.name}`).sort();
  const haveBuckets = (config.r2_buckets ?? []).map((bucket) => `${bucket.binding}=${bucket.bucket_name}`).sort();
  if (!same(wantBuckets, haveBuckets)) stop("WRONG_RESOURCE", `The R2 bindings in wrangler.jsonc (${haveBuckets.join(", ")}) are not exactly the manifest's (${wantBuckets.join(", ")}).`);

  const files = fs.readdirSync(path.join(releaseDir, "migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const { name, sha256: pinned } of manifest.migrations.pending) {
    if (!files.includes(name)) stop("MIGRATION_FILE", `The release has no migrations/${name}.`);
    if (sha256(fs.readFileSync(path.join(releaseDir, "migrations", name))) !== pinned) stop("MIGRATION_FILE", `migrations/${name} is not the file the manifest pins (hash differs).`);
  }
  return { files, branch: manifest.branch };
}

/**
 * The only place wrangler runs: a fresh directory holding a config written from the manifest (not copied from the release)
 * and the release's migration files. No .env, no other config, no state from the release tree, so nothing it contains can
 * change which account, database or migrations wrangler uses.
 */
export function prepareWorkdir({ manifest, releaseDir, base = os.tmpdir() }) {
  const dir = fs.mkdtempSync(path.join(base, "lh-wrangler-"));
  const d1 = manifest.target.d1;
  fs.writeFileSync(path.join(dir, "wrangler.jsonc"), `${JSON.stringify({ name: manifest.target.worker, d1_databases: [{ binding: d1.binding, database_name: d1.name, database_id: d1.id, migrations_dir: "migrations" }] }, null, 2)}\n`);
  fs.mkdirSync(path.join(dir, "migrations"));
  fs.mkdirSync(path.join(dir, ".home"));
  for (const name of fs.readdirSync(path.join(releaseDir, "migrations")).filter((entry) => /^\d{4}_[a-z0-9_]+\.sql$/.test(entry))) {
    fs.copyFileSync(path.join(releaseDir, "migrations", name), path.join(dir, "migrations", name));
  }
  return dir;
}

/* ---------- Private backup: only the owner's private key can open it ---------- */

const MAGIC = Buffer.from("LHOPS2");
/** The backup key is an RSA public key. A private key pasted by mistake is refused: it must never sit in a GitHub secret. */
export function backupKeyInfo(pem) {
  if (typeof pem !== "string" || pem.trim() === "") throw new Stop("PRECHECK", "NO_BACKUP_KEY", "OPS_BACKUP_PUBLIC_KEY is not set in the production environment.");
  if (/PRIVATE KEY/.test(pem)) throw new Stop("PRECHECK", "BAD_BACKUP_KEY", "OPS_BACKUP_PUBLIC_KEY holds a PRIVATE key. Remove it from the secret now and use the public key.");
  let key;
  try { key = createPublicKey(pem); } catch { throw new Stop("PRECHECK", "BAD_BACKUP_KEY", "OPS_BACKUP_PUBLIC_KEY is not a valid public key in PEM form."); }
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (key.asymmetricKeyType !== "rsa" || !(bits >= 3072)) throw new Stop("PRECHECK", "BAD_BACKUP_KEY", "The backup key must be an RSA public key of at least 3072 bits.");
  return { fingerprintSha256: sha256(key.export({ type: "spki", format: "der" })), rsaBits: bits };
}
/** A random AES-256-GCM key encrypts the data; that key is wrapped (RSA-OAEP, SHA-256) to the owner's public key. */
export function sealBackup(plain, publicPem) {
  backupKeyInfo(publicPem);
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const wrapped = publicEncrypt({ key: createPublicKey(publicPem), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, dataKey);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  // The AES layer is proven here with the key still in hand; only the owner's private key can open the wrapped copy.
  const check = createDecipheriv("aes-256-gcm", dataKey, iv);
  check.setAAD(MAGIC);
  check.setAuthTag(tag);
  if (!Buffer.concat([check.update(body), check.final()]).equals(plain)) throw new Stop("BACKUP", "BACKUP_UNVERIFIED", "The encrypted backup failed its own check. Nothing was changed.");
  const size = Buffer.alloc(2);
  size.writeUInt16BE(wrapped.length);
  return Buffer.concat([MAGIC, size, wrapped, iv, tag, body]);
}
export function openBackup(data, privatePem) {
  if (data.length < MAGIC.length + 2 || !data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("This is not an encrypted Logistics Hub backup.");
  const wrappedLength = data.readUInt16BE(MAGIC.length);
  const at = MAGIC.length + 2 + wrappedLength;
  const dataKey = privateDecrypt({ key: createPrivateKey(privatePem), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, data.subarray(MAGIC.length + 2, at));
  const decipher = createDecipheriv("aes-256-gcm", dataKey, data.subarray(at, at + 12));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(data.subarray(at + 12, at + 28));
  return Buffer.concat([decipher.update(data.subarray(at + 28)), decipher.final()]);
}

/* ---------- The only things this script may ask Cloudflare ---------- */

/** Fixed, read-only statements: nothing else is ever sent to the production database through this script. */
export const QUERIES = Object.freeze({
  migrations: "SELECT name FROM d1_migrations ORDER BY id",
  schema: "SELECT type, name, sql FROM sqlite_master ORDER BY type, name",
  counts: "SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM inventory_movements) AS movements, (SELECT COALESCE(SUM(on_hand), 0) FROM inventory_balances) AS onHand, (SELECT COUNT(*) FROM loans) AS loans, (SELECT COUNT(*) FROM self_service_events) AS phoneEvents",
  rows: (table) => { if (!/^[a-z_]+$/.test(table)) throw new Error("bad table"); return `SELECT COUNT(*) AS n FROM ${table}`; }
});

/** The command allowlist. `args` is a wrangler argument vector; anything not listed here is refused before it runs. */
export function allowed(args, manifest, mayChange) {
  const create = new Set(manifest.target.r2.create.map((bucket) => bucket.name));
  const fixed = new Set([QUERIES.migrations, QUERIES.schema, QUERIES.counts, ...Object.keys(manifest.expect.tableRowsAfter).map((table) => QUERIES.rows(table))]);
  const [a, b, c, d] = args;
  const d1 = manifest.target.d1.binding;
  for (const name of manifest.target.forbidden) if (args.some((arg) => String(arg).includes(name))) return false;
  if (a === "d1" && b === "execute") return args.length === 7 && c === d1 && d === "--remote" && args[4] === "--json" && args[5] === "--command" && fixed.has(args[6]);
  if (a === "d1" && b === "export") return args.length === 6 && c === d1 && d === "--remote" && args[4] === "--output" && typeof args[5] === "string";
  if (a === "d1" && b === "time-travel") return same(args, ["d1", "time-travel", "info", d1, "--json"]);
  if (a === "d1" && b === "migrations") return mayChange && same(args, ["d1", "migrations", "apply", d1, "--remote"]);
  if (a === "r2" && b === "bucket" && c === "create") return mayChange && args.length === 4 && create.has(d);
  return false;
}
export function allowedPath(requestPath, accountId) {
  return new RegExp(`^/accounts/${accountId}/r2/buckets(\\?per_page=\\d{1,4}|/[a-z0-9-]{3,63}/domains/(managed|custom))$`).test(requestPath);
}

/**
 * The Cloudflare adapter. `exec(args)` runs wrangler and returns { status, stdout, stderr }; `rest(path)` does a GET against the
 * Cloudflare API and returns { status, body }. Both are injected, so the tests can stand in for production. R2 is read through
 * the REST API (names, creation dates, public access); wrangler only ever creates the one bucket.
 */
export function createCloud({ exec, rest, manifest, accountId, mayChange }) {
  const run = (args) => {
    if (!allowed(args, manifest, mayChange)) throw new Stop("GUARD", "REFUSED_COMMAND", `Refused: "${args.slice(0, 4).join(" ")}" is not an operation this release may run.`);
    return exec(args);
  };
  const get = async (requestPath) => {
    if (!allowedPath(requestPath, accountId)) throw new Stop("GUARD", "REFUSED_REQUEST", `Refused: ${requestPath.replace(accountId, "<account>")} is not a request this release may make.`);
    return rest(requestPath);
  };
  const parse = (text, step) => { try { return JSON.parse(text); } catch { throw new Stop(step, "UNEXPECTED_RESPONSE", "A Cloudflare command did not answer with the expected JSON."); } };
  const buckets = async (step = "PRECHECK") => {
    const response = await get(`/accounts/${accountId}/r2/buckets?per_page=1000`);
    const list = response.body?.result?.buckets ?? response.body?.result;
    if (response.status !== 200 || response.body?.success !== true || !Array.isArray(list) || list.length >= 1000 || list.some((bucket) => typeof bucket?.name !== "string")) throw new Stop(step, "UNEXPECTED_RESPONSE", "The R2 bucket list was not in the expected shape (or too long to verify).");
    return list.map((bucket) => ({ name: bucket.name, created: typeof bucket.creation_date === "string" ? bucket.creation_date : null })).sort((x, y) => x.name.localeCompare(y.name));
  };
  return {
    buckets,
    async rows(sql, step = "PRECHECK") {
      const result = run(["d1", "execute", manifest.target.d1.binding, "--remote", "--json", "--command", sql]);
      if (result.status !== 0) throw new Stop(step, "D1_UNREACHABLE", "A read-only query against production D1 failed.");
      const body = parse(result.stdout, step);
      if (!Array.isArray(body) || body[0]?.success !== true || !Array.isArray(body[0].results)) throw new Stop(step, "UNEXPECTED_RESPONSE", "D1 answered a read in an unexpected shape.");
      return body[0].results;
    },
    async bucket(name, step = "PRECHECK") {
      const found = (await buckets(step)).find((bucket) => bucket.name === name);
      return found ? { exists: true, created: found.created } : { exists: false };
    },
    /** Private means: no r2.dev address and no custom domain. Anything else, or anything unreadable, is not private. */
    async isPrivate(name, step = "PRECHECK") {
      const managed = await get(`/accounts/${accountId}/r2/buckets/${name}/domains/managed`);
      const custom = await get(`/accounts/${accountId}/r2/buckets/${name}/domains/custom`);
      if (managed.status !== 200 || typeof managed.body?.result?.enabled !== "boolean" || custom.status !== 200 || !Array.isArray(custom.body?.result?.domains)) throw new Stop(step, "UNEXPECTED_RESPONSE", `Could not read whether ${name} is private.`);
      return managed.body.result.enabled === false && custom.body.result.domains.length === 0;
    },
    exportTo(file) { return run(["d1", "export", manifest.target.d1.binding, "--remote", "--output", file]).status === 0 && fs.existsSync(file); },
    bookmark() {
      const result = run(["d1", "time-travel", "info", manifest.target.d1.binding, "--json"]);
      return result.status === 0 ? (`${result.stdout}`.match(BOOKMARK)?.[0] ?? null) : null;
    },
    createBucket(name) { return run(["r2", "bucket", "create", name]).status === 0; },
    applyMigrations() { return run(["d1", "migrations", "apply", manifest.target.d1.binding, "--remote"]).status === 0; }
  };
}

/** Runs wrangler in `workdir()` (made on first use) with only what it needs: no inherited secrets, no release-controlled files. */
export function wranglerExec({ wranglerBin, workdir, redact }) {
  let cwd;
  return (args) => {
    cwd ??= workdir();
    const keep = ["PATH", "TMPDIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
    const env = { ...Object.fromEntries(keep.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]])), HOME: path.join(cwd, ".home"), CI: "true", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" };
    const result = spawnSync(process.execPath, [wranglerBin, ...args], { cwd, env, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    return { status: result.status ?? 1, stdout: redact(result.stdout ?? ""), stderr: redact(result.stderr ?? "") };
  };
}
export function cloudflareRest({ token }) {
  return async (requestPath) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${requestPath}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
}

/* ---------- The release run ---------- */

async function snapshot(cloud, step) {
  const [migrations, schema, counts] = [await cloud.rows(QUERIES.migrations, step), await cloud.rows(QUERIES.schema, step), await cloud.rows(QUERIES.counts, step)];
  return {
    migrations: migrations.map((row) => row.name),
    schema: Object.fromEntries(schema.map((row) => [`${row.type}:${row.name}`, sha256(row.sql ?? "")])),
    counts: counts[0]
  };
}
const diff = (a, b) => ({ added: Object.keys(b).filter((key) => !(key in a)).sort(), removed: Object.keys(a).filter((key) => !(key in b)).sort(), changed: Object.keys(a).filter((key) => key in b && a[key] !== b[key]).sort() });

/**
 * Runs one release. Always returns a report (never a bare exception); `report.result` is PREFLIGHT_OK, READY_TO_MERGE or
 * STOPPED. Nothing is changed in `preflight` mode, and nothing at all before the preflight has passed.
 */
export async function runRelease({ manifest, releaseDir, expectedSha, mode, confirm, cloud, git, backupDir, backupKey, now = () => new Date() }) {
  const report = { release: manifest.release, expectedSha, mode, startedAt: now().toISOString(), result: "STOPPED", steps: [], operations: [] };
  const step = (name, status, detail = {}) => report.steps.push({ at: now().toISOString(), step: name, status, ...detail });
  let plainDir;
  try {
    if (!MODES.includes(mode)) throw new Stop("PRECHECK", "BAD_MODE", `The mode must be one of ${MODES.join(", ")}.`);
    if (mode === "prepare" && confirm !== `PREPARE ${manifest.release} ${expectedSha}`) throw new Stop("PRECHECK", "NOT_CONFIRMED", `Preparing needs the typed confirmation "PREPARE ${manifest.release} <the full sha>".`);
    // Checked in both modes, so a missing or wrong key shows up in the preflight, long before anything is prepared.
    report.backupKey = backupKeyInfo(backupKey);
    const tree = verifyReleaseTree({ manifest, releaseDir, expectedSha, git });
    step("PRECHECK", "ok", { check: "release tree and backup key", sha: expectedSha, migrationFiles: tree.files.length, backupKeyFingerprint: report.backupKey.fingerprintSha256 });

    /* Read-only preflight against production. */
    const before = await snapshot(cloud, "PRECHECK");
    const pending = manifest.migrations.pending.map((entry) => entry.name);
    const wantApplied = tree.files.filter((name) => !pending.includes(name));
    if (!same(before.migrations, wantApplied)) {
      const missing = wantApplied.filter((name) => !before.migrations.includes(name));
      const extra = before.migrations.filter((name) => !wantApplied.includes(name));
      throw new Stop("PRECHECK", "UNEXPECTED_MIGRATIONS", `Production's applied migrations are not what this release expects. Not applied but expected: [${missing.join(", ")}]. Applied but not expected: [${extra.join(", ")}].`);
    }
    for (const key of manifest.expect.schemaAdded) if (key in before.schema) throw new Stop("PRECHECK", "ALREADY_PRESENT", `${key} already exists in production.`);
    const { existing, create } = manifest.target.r2;
    const listBefore = await cloud.buckets("PRECHECK");
    const namesBefore = listBefore.map((bucket) => bucket.name);
    const createdBefore = {};
    for (const bucket of existing) {
      const found = listBefore.find((entry) => entry.name === bucket.name);
      if (!found) throw new Stop("PRECHECK", "MISSING_BUCKET", `The bucket ${bucket.name} should exist and does not.`);
      if (!found.created) throw new Stop("PRECHECK", "UNEXPECTED_RESPONSE", `The creation date of ${bucket.name} could not be read, so it could not be checked afterwards.`);
      if (!(await cloud.isPrivate(bucket.name))) throw new Stop("PRECHECK", "BUCKET_NOT_PRIVATE", `The bucket ${bucket.name} is not private.`);
      createdBefore[bucket.name] = found.created;
    }
    for (const bucket of create) {
      if (namesBefore.includes(bucket.name)) throw new Stop("PRECHECK", "BUCKET_EXISTS", `The bucket ${bucket.name} already exists; this release creates it, so something already ran. Nothing was changed. Decide by hand what that bucket is before going on.`);
    }
    const listed = (names) => ({ total: names.length, manifestBuckets: names.filter((name) => [...existing, ...create].some((bucket) => bucket.name === name)) });
    report.before = { migrations: before.migrations.length, pendingMigrations: pending, counts: before.counts, buckets: listed(namesBefore) };
    step("PRECHECK", "ok", { check: "production state", appliedMigrations: before.migrations.length, pending, absentBuckets: create.map((bucket) => bucket.name), existingBuckets: existing.map((bucket) => bucket.name) });
    if (mode === "preflight") { report.result = "PREFLIGHT_OK"; return report; }

    /* From here on production changes, but only after a verified private backup and a rollback point. */
    plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ops-"));
    const plainFile = path.join(plainDir, "export.sql");
    if (!cloud.exportTo(plainFile)) throw new Stop("BACKUP", "BACKUP_FAILED", "The D1 export failed. Nothing was changed.");
    const plain = fs.readFileSync(plainFile);
    const text = plain.toString("utf8");
    if (plain.length < 1024 || !/CREATE TABLE\s+["`]?items["`]?/i.test(text) || !/d1_migrations/.test(text)) throw new Stop("BACKUP", "BACKUP_INVALID", "The D1 export is too small or lacks the expected tables. Nothing was changed.");
    const sealed = sealBackup(plain, backupKey);
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = `${manifest.release}-d1-${now().toISOString().replace(/[:.]/g, "-")}.sql.enc`;
    fs.writeFileSync(path.join(backupDir, backupFile), sealed);
    fs.rmSync(plainDir, { recursive: true, force: true });
    plainDir = undefined;
    report.backup = { file: backupFile, encryptedBytes: sealed.length, encryptedSha256: sha256(sealed), plaintextBytes: plain.length, encryption: "AES-256-GCM; the data key is wrapped (RSA-OAEP, SHA-256) to the public key with the fingerprint above", openedWith: "the matching private key, kept offline by Earl" };
    report.operations.push({ at: now().toISOString(), operation: "d1 export (read-only), encrypted to the owner's public key before upload" });
    step("BACKUP", "ok", { file: backupFile, encryptedSha256: report.backup.encryptedSha256 });

    const bookmark = cloud.bookmark();
    if (!bookmark) throw new Stop("BOOKMARK", "BOOKMARK_FAILED", "Could not record a D1 Time Travel bookmark. Nothing was changed.");
    report.rollback = { bookmark, restore: "npx wrangler d1 time-travel restore DB --bookmark=<bookmark> (also discards anything recorded since), or the decrypted backup into an empty database" };
    step("BOOKMARK", "ok", { bookmark });

    const baseline = await snapshot(cloud, "BASELINE");
    if (!same(baseline.migrations, before.migrations) || !same(baseline.schema, before.schema)) throw new Stop("BASELINE", "STATE_MOVED", "Production's schema or migrations changed during the preflight. Nothing was changed; run again.");
    report.baseline = { counts: baseline.counts };
    step("BASELINE", "ok", { counts: baseline.counts });

    for (const bucket of create) {
      report.operations.push({ at: now().toISOString(), operation: `r2 bucket create ${bucket.name}` });
      if (!cloud.createBucket(bucket.name)) throw new Stop("CREATE_BUCKET", "CREATE_FAILED", `Creating ${bucket.name} failed; check whether the bucket now exists before running again.`);
      step("CREATE_BUCKET", "ok", { bucket: bucket.name });
      const made = await cloud.bucket(bucket.name, "VERIFY_BUCKET");
      if (!made.exists) throw new Stop("VERIFY_BUCKET", "BUCKET_MISSING_AFTER_CREATE", `${bucket.name} was not found after it was created. No migration was applied.`);
      if (!(await cloud.isPrivate(bucket.name, "VERIFY_BUCKET"))) throw new Stop("VERIFY_BUCKET", "BUCKET_NOT_PRIVATE", `${bucket.name} is not private. No migration was applied; the bucket exists and needs a look.`);
      step("VERIFY_BUCKET", "ok", { bucket: bucket.name, private: true });
    }

    report.operations.push({ at: now().toISOString(), operation: `d1 migrations apply (exactly ${pending.join(", ")})` });
    if (!cloud.applyMigrations()) throw new Stop("APPLY_MIGRATIONS", "APPLY_FAILED", `Applying ${pending.join(", ")} failed and may have partly run. Check the schema before anything else; the rollback bookmark is in this report.`);
    // wrangler also exits 0 when it had nothing to apply or the prompt was declined: the migration must be on record.
    const recorded = (await cloud.rows(QUERIES.migrations, "APPLY_MIGRATIONS")).map((row) => row.name);
    if (!pending.every((name) => recorded.includes(name))) throw new Stop("APPLY_MIGRATIONS", "APPLY_NOT_RECORDED", `wrangler reported success but ${pending.join(", ")} is not recorded as applied. Nothing was migrated by this run.`);
    step("APPLY_MIGRATIONS", "ok", { applied: pending });

    /* Read-only reconciliation. */
    const after = await snapshot(cloud, "RECONCILE");
    const problems = [];
    if (!same(after.migrations, [...before.migrations, ...pending])) problems.push(`applied migrations are [${after.migrations.slice(-3).join(", ")}], expected the old list plus ${pending.join(", ")}`);
    const schema = diff(baseline.schema, after.schema);
    if (!same(schema.added, [...manifest.expect.schemaAdded].sort()) || schema.removed.length || schema.changed.length) problems.push(`schema difference is +[${schema.added}] -[${schema.removed}] ~[${schema.changed}], expected only +[${manifest.expect.schemaAdded}]`);
    for (const key of manifest.expect.unchanged) if (after.counts[key] !== baseline.counts[key]) problems.push(`${key} changed from ${baseline.counts[key]} to ${after.counts[key]}`);
    for (const [table, expected] of Object.entries(manifest.expect.tableRowsAfter)) {
      const [row] = await cloud.rows(QUERIES.rows(table), "RECONCILE");
      if (row?.n !== expected) problems.push(`${table} has ${row?.n} rows, expected ${expected}`);
    }
    const listAfter = await cloud.buckets("RECONCILE");
    const namesAfter = listAfter.map((bucket) => bucket.name);
    if (!same(namesAfter, [...namesBefore, ...create.map((bucket) => bucket.name)].sort((x, y) => x.localeCompare(y)))) problems.push(`the bucket list differs by more than the new bucket (${listAfter.length} buckets now, ${namesBefore.length} before)`);
    for (const bucket of existing) {
      const current = listAfter.find((entry) => entry.name === bucket.name);
      if (!current) problems.push(`${bucket.name} no longer exists`);
      else if (current.created !== createdBefore[bucket.name]) problems.push(`${bucket.name} was created at a different time than before (it was replaced)`);
    }
    for (const bucket of create) if (!(await cloud.isPrivate(bucket.name, "RECONCILE"))) problems.push(`${bucket.name} is not private`);
    report.after = { migrations: after.migrations.length, counts: after.counts, schemaAdded: schema.added, buckets: listed(namesAfter) };
    if (problems.length) {
      step("RECONCILE", "mismatch", { problems });
      throw new Stop("RECONCILE", "RECONCILE_MISMATCH", `After the change production does not match the manifest: ${problems.join("; ")}. The migration is applied; use the rollback bookmark if it is not acceptable.`);
    }
    step("RECONCILE", "ok", { counts: after.counts, schemaAdded: schema.added });
    report.result = "READY_TO_MERGE";
    return report;
  } catch (error) {
    const stop = error instanceof Stop ? error : new Stop("UNEXPECTED", "UNEXPECTED_ERROR", `Unexpected error: ${error?.message ?? error}`);
    step(stop.step, "stopped", { code: stop.code, message: stop.message });
    report.stopped = { step: stop.step, code: stop.code, message: stop.message, changedProduction: report.operations.some((op) => /bucket create|migrations apply/.test(op.operation)) };
    return report;
  } finally {
    if (plainDir) fs.rmSync(plainDir, { recursive: true, force: true });
    report.finishedAt = now().toISOString();
  }
}

export function reportMarkdown(report) {
  const lines = [`# Production operation: ${report.release} (${report.mode})`, "", `- Result: **${report.result}**`, `- Commit: \`${report.expectedSha}\``, `- Started: ${report.startedAt}; finished: ${report.finishedAt}`];
  if (report.stopped) lines.push(`- Stopped at **${report.stopped.step}** (${report.stopped.code}): ${report.stopped.message}`, `- Production changed before the stop: ${report.stopped.changedProduction ? "**yes**" : "no"}`);
  if (report.backupKey) lines.push(`- Backup key: RSA ${report.backupKey.rsaBits}, fingerprint \`${report.backupKey.fingerprintSha256}\` (must match the key Earl holds)`);
  if (report.rollback) lines.push(`- Rollback bookmark: \`${report.rollback.bookmark}\``);
  if (report.backup) lines.push(`- Private backup: \`${report.backup.file}\` (encrypted, ${report.backup.encryptedBytes} bytes, sha256 \`${report.backup.encryptedSha256}\`)`);
  lines.push("", "| Step | Status | Evidence |", "|---|---|---|", ...report.steps.map((entry) => `| ${entry.step} | ${entry.status} | ${JSON.stringify(Object.fromEntries(Object.entries(entry).filter(([key]) => !["at", "step", "status"].includes(key))))} |`));
  if (report.operations.length) lines.push("", "Operations performed:", ...report.operations.map((entry) => `- ${entry.at} ${entry.operation}`));
  return `${lines.join("\n")}\n`;
}

/* ---------- Command line ---------- */

function cli() {
  const { positionals, values: args } = parseArgs({ allowPositionals: true, options: {
    release: { type: "string" }, "expected-sha": { type: "string" }, "release-dir": { type: "string" }, "ops-dir": { type: "string" },
    mode: { type: "string" }, confirm: { type: "string" }, out: { type: "string" }, in: { type: "string" }, file: { type: "string" }, key: { type: "string" }
  } });
  if (positionals[0] === "decrypt") {
    fs.writeFileSync(args.file, openBackup(fs.readFileSync(args.in), fs.readFileSync(args.key, "utf8")));
    console.log(`Decrypted to ${args.file}. It holds production data: keep it private and delete it when done.`);
    return;
  }
  const secrets = [process.env.CLOUDFLARE_API_TOKEN].filter(Boolean);
  const redact = (text) => secrets.reduce((out, secret) => out.split(secret).join("***"), String(text));
  const opsDir = path.resolve(args["ops-dir"] ?? ".");
  const releaseDir = path.resolve(args["release-dir"] ?? ".");
  const out = path.resolve(args.out ?? "ops-out");
  fs.mkdirSync(out, { recursive: true });
  const finish = (report) => {
    // Written redacted too: the files are uploaded.
    fs.writeFileSync(path.join(out, "report.json"), redact(`${JSON.stringify(report, null, 2)}\n`));
    fs.writeFileSync(path.join(out, "report.md"), redact(reportMarkdown(report)));
    console.log(redact(reportMarkdown(report)));
    process.exitCode = ["PREFLIGHT_OK", "READY_TO_MERGE"].includes(report.result) ? 0 : 1;
  };
  const early = (code, message) => finish({ release: args.release, expectedSha: args["expected-sha"], mode: args.mode, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), result: "STOPPED", steps: [], operations: [], stopped: { step: "PRECHECK", code, message, changedProduction: false } });
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  if (!process.env.CLOUDFLARE_API_TOKEN || !/^[0-9a-f]{32}$/.test(accountId)) return early("NO_CREDENTIALS", "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not set in the production environment. Nothing was contacted.");
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF !== "refs/heads/main") return early("NOT_MAIN", "Production operations run only from main. (This check is defence in depth: the real control is the environment's deployment-branch rule.)");
  if (args.mode === "prepare" && process.env.GITHUB_ACTIONS !== "true" && process.env.OPS_ALLOW_LOCAL !== "1") return early("NOT_IN_GITHUB", "Preparing production runs from the GitHub workflow, not from a PC.");
  let manifest;
  try { manifest = loadManifest(path.join(opsDir, "ops", "releases", `${args.release}.json`), args.release); } catch (error) { return early(error.code ?? "BAD_MANIFEST", error.message); }
  const git = (gitArgs, test = false) => {
    const result = spawnSync("git", ["-C", releaseDir, ...gitArgs], { encoding: "utf8" });
    if (test) return result.status === 0 ? "ok" : "no";
    if (result.status !== 0) throw new Error(`git ${gitArgs[0]} failed`);
    return (result.stdout ?? "").trim();
  };
  const mayChange = args.mode === "prepare";
  const exec = wranglerExec({ wranglerBin: path.join(opsDir, "node_modules", "wrangler", "bin", "wrangler.js"), workdir: () => prepareWorkdir({ manifest, releaseDir }), redact });
  const cloud = createCloud({ exec, rest: cloudflareRest({ token: process.env.CLOUDFLARE_API_TOKEN }), manifest, accountId, mayChange });
  runRelease({ manifest, releaseDir, expectedSha: args["expected-sha"], mode: args.mode, confirm: args.confirm, cloud, git, backupDir: path.join(out, "backup"), backupKey: process.env.OPS_BACKUP_PUBLIC_KEY }).then(finish);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
