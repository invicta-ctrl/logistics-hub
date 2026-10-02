// @ts-nocheck: exercises a plain .mjs tool against a fake Cloudflare.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as ops from "../scripts/ops/production-release.mjs";

/*
 * Cloud Operations (docs/specs/accepted/2026-10-02-cloud-operations-amendment.md): the release script against a fake Cloudflare.
 * The fake's D1 is a real SQLite with the real migrations, so the schema, count and migration checks run on real SQL; R2 and
 * Time Travel are simulated. One contract test at the end runs the real wrangler against a throwaway local D1.
 */

const manifest = JSON.parse(fs.readFileSync("ops/releases/v1.2.json", "utf8"));
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const PASSPHRASE = "correct-horse-battery-staple-passphrase";
const PII = "PII-MARKER-Juan-Dela-Cruz-20-1234-567";
const BOOKMARK = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";
const fixture0020 = fs.readFileSync("tests/fixtures/ops/0020_item_media.sql", "utf8");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const BASE_MIGRATIONS = () => fs.readdirSync("migrations").filter((name) => name < "0020").sort();
const WRANGLER = `{
  // The Worker and the only resources a release may touch.
  "name": "logistics-hub",
  "d1_databases": [{ "binding": "DB", "database_name": "logistics-hub", "database_id": "3ffd8edf-a176-4f63-8b7c-5215d11c98d8", "migrations_dir": "migrations" }],
  "r2_buckets": [
    { "binding": "EVIDENCE", "bucket_name": "logistics-hub-evidence" },
    { "binding": "CATALOG_MEDIA", "bucket_name": "logistics-hub-catalog-media" },
  ],
}`;

const cleanups: string[] = [];
const temp = (prefix: string) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); cleanups.push(dir); return dir; };
afterEach(() => { while (cleanups.length) fs.rmSync(cleanups.pop()!, { recursive: true, force: true }); });

/** A release checkout in a throwaway git repo: base commit on origin/main, the release commit on the release branch. */
function makeRelease({ wrangler = WRANGLER, pending = fixture0020, onBranch = true, dirty = false, withPending = true } = {}) {
  const dir = temp("lh-release-");
  const git = (args, test = false) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    return test ? (result.status === 0 ? "ok" : "no") : (result.stdout ?? "").trim();
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "ops@example.test"]);
  git(["config", "user.name", "Ops Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "base"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  fs.mkdirSync(path.join(dir, "migrations"));
  for (const name of BASE_MIGRATIONS()) fs.copyFileSync(path.join("migrations", name), path.join(dir, "migrations", name));
  if (withPending) fs.writeFileSync(path.join(dir, "migrations", "0020_item_media.sql"), pending);
  fs.writeFileSync(path.join(dir, "wrangler.jsonc"), wrangler);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "release"]);
  const sha = git(["rev-parse", "HEAD"]);
  if (onBranch) git(["update-ref", `refs/remotes/origin/${manifest.branch}`, "HEAD"]);
  if (dirty) fs.writeFileSync(path.join(dir, "stray.txt"), "uncommitted");
  return { dir, sha, git };
}

/** A fake Cloudflare account: real SQLite for D1, a map for R2, and switches for every way a run can go wrong. */
function makeWorld(options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const files = BASE_MIGRATIONS();
  for (const name of files) db.exec(fs.readFileSync(path.join("migrations", name), "utf8"));
  db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  const applied = files.filter((name) => !(options.unapplied ?? []).includes(name));
  for (const name of [...applied, ...(options.extraApplied ?? [])]) db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name);
  const buckets = new Map([["logistics-hub-evidence", { name: "logistics-hub-evidence", creation_date: "2026-09-29T15:17:28.423Z", object_count: 12 }]]);
  for (const name of options.buckets ?? []) buckets.set(name, { name, creation_date: "2026-10-02T00:00:00.000Z", object_count: 0 });
  if (options.noEvidence) buckets.delete("logistics-hub-evidence");
  const publicManaged = new Set(options.publicManaged ?? []);
  const world = { db, buckets, log: [], calls: 0, exportText: "" };
  const result = (status, stdout = "", stderr = "") => ({ status, stdout, stderr });
  world.exec = (args) => {
    world.calls += 1;
    const [a, b, c, d] = args;
    if (a === "d1" && b === "execute") {
      if (options.d1Down) return result(1, "", "network error");
      return result(0, JSON.stringify([{ results: db.prepare(args[6]).all(), success: true, meta: { duration: 0 } }]));
    }
    if (a === "d1" && b === "export") {
      world.log.push("export");
      if (options.exportFails) return result(1, "", "export failed");
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").all().map((row) => `${row.sql};`).join("\n");
      world.exportText = options.exportTiny ? "-- tiny" : options.exportShort ? "CREATE TABLE items(id);\n-- d1_migrations\n" : `${schema}\nINSERT INTO loans VALUES('${PII}');\n`;
      fs.writeFileSync(args[5], world.exportText);
      options.onExport?.(db);
      return result(0);
    }
    if (a === "d1" && b === "time-travel") {
      world.log.push("bookmark");
      return options.bookmarkFails ? result(1, "", "no bookmark") : result(0, JSON.stringify({ bookmark: BOOKMARK, timestamp: "2026-10-02T00:00:00.000Z" }));
    }
    if (a === "d1" && b === "migrations") {
      world.log.push("apply");
      if (options.applyFails) return result(1, "", "migration failed");
      db.exec(fixture0020);
      db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run("0020_item_media.sql");
      options.afterApply?.(db, world);
      return result(0);
    }
    if (a === "r2" && b === "bucket" && c === "info") {
      const bucket = buckets.get(d);
      return bucket ? result(0, JSON.stringify(bucket)) : result(1, "", "A request to the Cloudflare API failed. The specified bucket does not exist. [code: 10006]");
    }
    if (a === "r2" && b === "bucket" && c === "create") {
      world.log.push(`create:${d}`);
      if (options.createFails) return result(1, "", "create failed");
      buckets.set(d, { name: d, creation_date: "2026-10-02T12:00:00.000Z", object_count: 0 });
      if (options.createdPublic) publicManaged.add(d);
      return result(0);
    }
    return result(1, "", "unexpected command");
  };
  world.rest = async (requestPath) => {
    if (options.badList && requestPath.includes("per_page")) return { status: 200, body: { success: true, result: "nope" } };
    if (requestPath.includes("per_page")) return { status: 200, body: { success: true, result: { buckets: [...buckets.keys()].map((name) => ({ name })) } } };
    const name = requestPath.split("/")[5];
    if (requestPath.endsWith("/managed")) return { status: 200, body: { success: true, result: { enabled: publicManaged.has(name) } } };
    return { status: 200, body: { success: true, result: { domains: [] } } };
  };
  return world;
}

/** Runs the release against a world; returns the report, the world and the release. */
async function run({ mode = "prepare", world = makeWorld(), release = makeRelease(), expectedSha, confirm, passphrase = PASSPHRASE, mayChange } = {}) {
  const sha = expectedSha ?? release.sha;
  const backupDir = path.join(temp("lh-backup-"), "backup");
  const cloud = ops.createCloud({ exec: world.exec, rest: world.rest, manifest, accountId: ACCOUNT, mayChange: mayChange ?? mode === "prepare" });
  const report = await ops.runRelease({ manifest, releaseDir: release.dir, expectedSha: sha, mode, confirm: confirm ?? (mode === "prepare" ? `PREPARE v1.2 ${sha}` : undefined), cloud, git: release.git, backupDir, passphrase });
  return { report, world, release, backupDir };
}
const stopped = (report) => `${report.stopped?.step}/${report.stopped?.code}`;

describe("a prepared release", () => {
  it("backs up privately, records a rollback point, creates the private bucket, applies exactly 0020 and reports READY_TO_MERGE", async () => {
    const tmpBefore = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("lh-ops-"));
    const { report, world, backupDir } = await run();
    expect(report.result).toBe("READY_TO_MERGE");
    expect(world.log).toEqual(["export", "bookmark", "create:logistics-hub-catalog-media", "apply"]);
    expect(report.steps.map((entry) => entry.step)).toEqual(["PRECHECK", "PRECHECK", "BACKUP", "BOOKMARK", "BASELINE", "CREATE_BUCKET", "VERIFY_BUCKET", "APPLY_MIGRATIONS", "RECONCILE"]);
    expect(report.rollback.bookmark).toBe(BOOKMARK);
    expect(report.after.schemaAdded).toEqual(manifest.expect.schemaAdded);
    expect(report.after.counts).toEqual(report.baseline.counts);
    expect(report.after.migrations).toBe(report.before.migrations + 1);
    expect(report.stopped).toBeUndefined();
    // The backup is ciphertext that decrypts to the export; the plaintext is gone and never reaches the report.
    const [file] = fs.readdirSync(backupDir);
    const sealed = fs.readFileSync(path.join(backupDir, file));
    expect(file).toMatch(/^v1\.2-d1-.*\.sql\.enc$/);
    expect(sealed.includes(Buffer.from(PII))).toBe(false);
    expect(ops.decryptBackup(sealed, PASSPHRASE).toString()).toBe(world.exportText);
    expect(report.backup).toMatchObject({ file, encryptedSha256: sha256(sealed), decryptsToExport: true });
    expect(JSON.stringify(report)).not.toContain(PII);
    expect(JSON.stringify(report)).not.toContain(PASSPHRASE);
    expect(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("lh-ops-"))).toEqual(tmpBefore);
    expect(ops.reportMarkdown(report)).toContain("READY_TO_MERGE");
    // The new table exists, empty; the old data is where it was.
    expect(world.db.prepare("SELECT COUNT(*) AS n FROM item_media").get().n).toBe(0);
    expect(world.buckets.has("logistics-hub-catalog-media")).toBe(true);
  });

  it("changes nothing in preflight mode, and the adapter refuses every change then", async () => {
    const { report, world } = await run({ mode: "preflight" });
    expect(report.result).toBe("PREFLIGHT_OK");
    expect(world.log).toEqual([]);
    const cloud = ops.createCloud({ exec: world.exec, rest: world.rest, manifest, accountId: ACCOUNT, mayChange: false });
    expect(() => cloud.createBucket("logistics-hub-catalog-media")).toThrow(/Refused/);
    expect(() => cloud.applyMigrations()).toThrow(/Refused/);
  });
});

describe("it refuses before touching Cloudflare", () => {
  it("without the typed confirmation, or with a weak backup passphrase", async () => {
    for (const confirm of ["", "PREPARE v1.2", `prepare v1.2 ${"a".repeat(40)}`, `PREPARE v1.1 ${makeRelease().sha}`]) {
      const result = await run({ confirm: confirm || "nope" });
      expect(stopped(result.report), confirm).toBe("PRECHECK/NOT_CONFIRMED");
      expect(result.world.calls).toBe(0);
    }
    const weak = await run({ passphrase: "short" });
    expect(stopped(weak.report)).toBe("PRECHECK/WEAK_PASSPHRASE");
    expect(weak.world.calls).toBe(0);
    expect((await run({ passphrase: null })).report.stopped.code).toBe("WEAK_PASSPHRASE");
  });

  it("on the wrong, malformed, unreachable or uncommitted commit", async () => {
    const wrong = await run({ expectedSha: "a".repeat(40) });
    expect(stopped(wrong.report)).toBe("PRECHECK/WRONG_SHA");
    expect(wrong.world.calls).toBe(0);
    for (const bad of ["abc123", "A".repeat(40), "main", `${makeRelease().sha}x`]) expect((await run({ expectedSha: bad, confirm: `PREPARE v1.2 ${bad}` })).report.stopped.code, bad).toBe("BAD_SHA");
    const elsewhere = await run({ release: makeRelease({ onBranch: false }) });
    expect(stopped(elsewhere.report)).toBe("PRECHECK/SHA_NOT_ON_RELEASE");
    expect(elsewhere.world.calls).toBe(0);
    const dirty = await run({ release: makeRelease({ dirty: true }) });
    expect(stopped(dirty.report)).toBe("PRECHECK/DIRTY_TREE");
  });

  it("when wrangler.jsonc names any other resource", async () => {
    const cases = {
      "another database": WRANGLER.replace("3ffd8edf-a176-4f63-8b7c-5215d11c98d8", "00000000-0000-0000-0000-000000000000"),
      "another worker": WRANGLER.replace('"logistics-hub",\n', '"hau-usc-logistics-production",\n'),
      "the old production bucket": WRANGLER.replace("logistics-hub-evidence", "hau-usc-logistics-production"),
      "the old staging bucket": WRANGLER.replace("logistics-hub-catalog-media", "hau-usc-logistics-staging"),
      "an extra bucket": WRANGLER.replace('{ "binding": "CATALOG_MEDIA"', '{ "binding": "OTHER", "bucket_name": "someone-elses-bucket" },\n    { "binding": "CATALOG_MEDIA"'),
      "a missing binding": WRANGLER.replace(/\s*\{ "binding": "CATALOG_MEDIA"[^}]*\},/, ""),
      "a renamed binding": WRANGLER.replace('"binding": "DB"', '"binding": "DATABASE"')
    };
    // Even a comment that names an old resource is refused: nothing about a release may mention them.
    cases["a comment naming the old staging resources"] = WRANGLER.replace("// The Worker", "// was hau-usc-logistics-staging\n  // The Worker");
    for (const [name, wrangler] of Object.entries(cases)) {
      const result = await run({ release: makeRelease({ wrangler }) });
      expect(stopped(result.report), name).toBe("PRECHECK/WRONG_RESOURCE");
      expect(result.world.calls, name).toBe(0);
    }
  });

  it("when the pending migration is not the file the manifest pins, or is missing", async () => {
    const changed = await run({ release: makeRelease({ pending: `${fixture0020}\n-- a late edit\n` }) });
    expect(stopped(changed.report)).toBe("PRECHECK/MIGRATION_FILE");
    expect(changed.world.calls).toBe(0);
    expect((await run({ release: makeRelease({ withPending: false }) })).report.stopped.code).toBe("MIGRATION_FILE");
  });

  it("only ever allows the manifest's own commands", () => {
    const allow = (args, change = true) => ops.allowed(args, manifest, change);
    expect(allow(["r2", "bucket", "create", "logistics-hub-catalog-media"])).toBe(true);
    expect(allow(["r2", "bucket", "create", "logistics-hub-catalog-media"], false)).toBe(false);
    for (const args of [
      ["r2", "bucket", "create", "logistics-hub-evidence"],
      ["r2", "bucket", "create", "hau-usc-logistics-production"],
      ["r2", "bucket", "delete", "logistics-hub-evidence"],
      ["r2", "bucket", "info", "some-other-bucket", "--json"],
      ["d1", "execute", "DB", "--remote", "--json", "--command", "DELETE FROM items"],
      ["d1", "execute", "DB", "--remote", "--json", "--command", `${ops.QUERIES.counts}; DROP TABLE items`],
      ["d1", "execute", "OTHER_DB", "--remote", "--json", "--command", ops.QUERIES.counts],
      ["d1", "execute", "DB", "--local", "--json", "--command", ops.QUERIES.counts],
      ["d1", "migrations", "apply", "OTHER", "--remote"],
      ["d1", "time-travel", "restore", "DB", "--bookmark=x"],
      ["d1", "delete", "logistics-hub"],
      ["kv", "namespace", "list"],
      ["deploy"]
    ]) expect(allow(args), args.join(" ")).toBe(false);
    expect(ops.allowedPath(`/accounts/${ACCOUNT}/r2/buckets?per_page=100`, ACCOUNT)).toBe(true);
    expect(ops.allowedPath(`/accounts/${ACCOUNT}/r2/buckets/logistics-hub-catalog-media/domains/managed`, ACCOUNT)).toBe(true);
    for (const bad of [`/accounts/${"f".repeat(32)}/r2/buckets?per_page=100`, `/accounts/${ACCOUNT}/workers/scripts`, `/accounts/${ACCOUNT}/r2/buckets/x/objects`, `/accounts/${ACCOUNT}/d1/database`]) expect(ops.allowedPath(bad, ACCOUNT), bad).toBe(false);
  });
});

describe("the read-only preflight stops on any unexpected production state, changing nothing", () => {
  const stopsWith = async (options, code, extra = {}) => {
    const result = await run({ world: makeWorld(options), ...extra });
    expect(stopped(result.report), JSON.stringify(options)).toBe(`PRECHECK/${code}`);
    expect(result.world.log, "nothing may run before the preflight passes").toEqual([]);
    expect(result.report.stopped.changedProduction).toBe(false);
    return result;
  };

  it("on an unexpected pending migration", async () => {
    const missing = await stopsWith({ unapplied: ["0019_retention_erasure.sql"] }, "UNEXPECTED_MIGRATIONS");
    expect(missing.report.stopped.message).toContain("0019_retention_erasure.sql");
    await stopsWith({ unapplied: ["0001_core.sql"] }, "UNEXPECTED_MIGRATIONS");
    await stopsWith({ extraApplied: ["0021_something_else.sql"] }, "UNEXPECTED_MIGRATIONS");
    await stopsWith({ extraApplied: ["0020_item_media.sql"] }, "UNEXPECTED_MIGRATIONS");
  });

  it("when the bucket this release creates already exists", async () => {
    const result = await stopsWith({ buckets: ["logistics-hub-catalog-media"] }, "BUCKET_EXISTS");
    expect(result.report.stopped.message).toContain("already exists");
  });

  it("when a bucket that must exist is missing, or is not private", async () => {
    await stopsWith({ noEvidence: true }, "MISSING_BUCKET");
    await stopsWith({ publicManaged: ["logistics-hub-evidence"] }, "BUCKET_NOT_PRIVATE");
  });

  it("when production cannot be read, or answers in an unexpected shape", async () => {
    await stopsWith({ d1Down: true }, "D1_UNREACHABLE");
    await stopsWith({ badList: true }, "UNEXPECTED_RESPONSE");
  });

  it("when the table this release adds already exists", async () => {
    const world = makeWorld();
    world.db.exec(fixture0020);
    const result = await run({ world });
    expect(stopped(result.report)).toBe("PRECHECK/ALREADY_PRESENT");
    expect(world.log).toEqual([]);
  });
});

describe("it stops before changing anything when it cannot make the backup or the rollback point", () => {
  it("on a failed export", async () => {
    const { report, world } = await run({ world: makeWorld({ exportFails: true }) });
    expect(stopped(report)).toBe("BACKUP/BACKUP_FAILED");
    expect(world.log).toEqual(["export"]);
    expect(report.stopped.changedProduction).toBe(false);
  });

  it("on an export that is empty or lacks the tables", async () => {
    const { report, world, backupDir } = await run({ world: makeWorld({ exportTiny: true }) });
    expect(stopped(report)).toBe("BACKUP/BACKUP_INVALID");
    expect(world.log).toEqual(["export"]);
    expect(fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : []).toEqual([]);
  });

  it("on an export that names the right tables but is implausibly small", async () => {
    const { report, world } = await run({ world: makeWorld({ exportShort: true }) });
    expect(stopped(report)).toBe("BACKUP/BACKUP_INVALID");
    expect(world.log).toEqual(["export"]);
  });

  it("on a failed Time Travel bookmark", async () => {
    const { report, world } = await run({ world: makeWorld({ bookmarkFails: true }) });
    expect(stopped(report)).toBe("BOOKMARK/BOOKMARK_FAILED");
    expect(world.log).toEqual(["export", "bookmark"]);
    expect(report.stopped.changedProduction).toBe(false);
    expect(report.result).toBe("STOPPED");
  });

  it("when production's schema moved while the backup was being made", async () => {
    const { report, world } = await run({ world: makeWorld({ onExport: (db) => db.exec("CREATE TABLE sneaky (id INTEGER)") }) });
    expect(stopped(report)).toBe("BASELINE/STATE_MOVED");
    expect(world.log).toEqual(["export", "bookmark"]);
  });
});

describe("it stops, and says so, when a change does not go as expected", () => {
  it("when creating the bucket fails: nothing is migrated", async () => {
    const { report, world } = await run({ world: makeWorld({ createFails: true }) });
    expect(stopped(report)).toBe("CREATE_BUCKET/CREATE_FAILED");
    expect(world.log).not.toContain("apply");
  });

  it("when the new bucket is not private: nothing is migrated, and the report says production changed", async () => {
    const { report, world } = await run({ world: makeWorld({ createdPublic: true }) });
    expect(stopped(report)).toBe("VERIFY_BUCKET/BUCKET_NOT_PRIVATE");
    expect(world.log).toEqual(["export", "bookmark", "create:logistics-hub-catalog-media"]);
    expect(report.stopped.changedProduction).toBe(true);
    expect(report.rollback.bookmark).toBe(BOOKMARK);
  });

  it("when the migration fails: the report carries the rollback point", async () => {
    const { report } = await run({ world: makeWorld({ applyFails: true }) });
    expect(stopped(report)).toBe("APPLY_MIGRATIONS/APPLY_FAILED");
    expect(report.stopped.changedProduction).toBe(true);
    expect(report.rollback.bookmark).toBe(BOOKMARK);
    expect(report.result).toBe("STOPPED");
  });

  const mismatch = async (afterApply, expected) => {
    const { report } = await run({ world: makeWorld({ afterApply }) });
    expect(report.result).toBe("STOPPED");
    expect(stopped(report)).toBe("RECONCILE/RECONCILE_MISMATCH");
    expect(report.stopped.message).toContain(expected);
    expect(report.stopped.changedProduction).toBe(true);
  };
  it("when reconciliation finds data that changed", async () => {
    await mismatch((db) => db.exec("INSERT INTO items(id, name, category, item_type, unit) VALUES('ITM-ZZZZ', 'Stray', 'OTHERS', 'Loanable', 'piece')"), "items changed");
    await mismatch((db) => db.exec("INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status) SELECT 'MOV-X', '2026-10-02T00:00:00Z', 'STOCK_IN', 'IN', id, 1, unit, 1, 'POSTED' FROM items LIMIT 1"), "movements changed");
  });
  it("when reconciliation finds a schema change the manifest does not list", async () => {
    await mismatch((db) => db.exec("CREATE TABLE unexpected_extra (id INTEGER)"), "schema difference");
    await mismatch((db) => db.exec("ALTER TABLE loans ADD COLUMN stray_column TEXT"), "schema difference");
  });
  it("when the new table is not empty", async () => {
    await mismatch((db) => db.exec("INSERT INTO item_media(item_id, media_id, width, height, created_at) SELECT id, '00000000-0000-0000-0000-000000000000', 1, 1, 'x' FROM items LIMIT 1"), "item_media has 1 rows");
  });
  it("when the evidence bucket lost objects, or a bucket appeared that the manifest does not list", async () => {
    await mismatch((_db, world) => { world.buckets.get("logistics-hub-evidence").object_count = 3; }, "fewer objects");
    await mismatch((_db, world) => { world.buckets.set("stray-bucket", { name: "stray-bucket" }); }, "bucket list");
    await mismatch((_db, world) => world.buckets.delete("logistics-hub-evidence"), "logistics-hub-evidence");
  });
});

describe("the private backup", () => {
  it("is encrypted and authenticated", () => {
    const plain = Buffer.from(`CREATE TABLE items(id);\n${PII}\n`);
    const sealed = ops.encryptBackup(plain, PASSPHRASE);
    expect(sealed.includes(Buffer.from(PII))).toBe(false);
    expect(ops.decryptBackup(sealed, PASSPHRASE).equals(plain)).toBe(true);
    expect(ops.encryptBackup(plain, PASSPHRASE).equals(sealed)).toBe(false);
    expect(() => ops.decryptBackup(sealed, `${PASSPHRASE}x`)).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => ops.decryptBackup(tampered, PASSPHRASE)).toThrow();
    expect(() => ops.decryptBackup(Buffer.from("not a backup at all, just text"), PASSPHRASE)).toThrow(/not an encrypted/);
    expect(() => ops.encryptBackup(plain, "short")).toThrow(/at least 24/);
  });
});

describe("secrets", () => {
  it("are stripped from everything wrangler prints", () => {
    const dir = temp("lh-bin-");
    const fake = path.join(dir, "wrangler.js");
    fs.writeFileSync(fake, 'console.log("token=" + process.env.CLOUDFLARE_API_TOKEN); console.error("pass=" + process.env.OPS_BACKUP_PASSPHRASE);');
    process.env.CLOUDFLARE_API_TOKEN = "tok-dummy-1234";
    process.env.OPS_BACKUP_PASSPHRASE = "pass-dummy-5678";
    try {
      const redact = (text) => ["tok-dummy-1234", "pass-dummy-5678"].reduce((out, secret) => out.split(secret).join("***"), String(text));
      const { stdout, stderr } = ops.wranglerExec({ wranglerBin: fake, cwd: dir, redact })([]);
      expect(stdout).toContain("token=***");
      expect(stderr).toContain("pass=***");
      expect(stdout + stderr).not.toMatch(/dummy-\d{4}/);
    } finally {
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.OPS_BACKUP_PASSPHRASE;
    }
  });

  it("missing credentials stop the command line before any contact, with a report saying exactly that", () => {
    const out = temp("lh-out-");
    const env = { PATH: process.env.PATH, HOME: process.env.HOME };
    const result = spawnSync(process.execPath, ["scripts/ops/production-release.mjs", "--release", "v1.2", "--expected-sha", "a".repeat(40), "--mode", "preflight", "--out", out], { encoding: "utf8", env });
    expect(result.status).toBe(1);
    const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
    expect(report).toMatchObject({ result: "STOPPED", stopped: { code: "NO_CREDENTIALS", changedProduction: false } });
    const local = spawnSync(process.execPath, ["scripts/ops/production-release.mjs", "--release", "v1.2", "--expected-sha", "a".repeat(40), "--mode", "prepare", "--out", out], { encoding: "utf8", env: { ...env, CLOUDFLARE_API_TOKEN: "x", CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
    expect(JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8")).stopped.code).toBe("NOT_IN_GITHUB");
    expect(local.status).toBe(1);
  });
});

describe("the manifest and the workflow", () => {
  it("the V1.2 manifest matches its release record and the pinned migration", () => {
    expect(ops.loadManifest("ops/releases/v1.2.json", "v1.2")).toMatchObject({ release: "v1.2", target: { worker: "logistics-hub", d1: { name: "logistics-hub", binding: "DB" } } });
    expect(manifest.target.r2).toEqual({ existing: [{ binding: "EVIDENCE", name: "logistics-hub-evidence" }], create: [{ binding: "CATALOG_MEDIA", name: "logistics-hub-catalog-media" }] });
    expect(manifest.migrations.pending).toEqual([{ name: "0020_item_media.sql", sha256: sha256(fixture0020) }]);
    if (fs.existsSync("migrations/0020_item_media.sql")) expect(sha256(fs.readFileSync("migrations/0020_item_media.sql"))).toBe(manifest.migrations.pending[0].sha256);
    expect(() => ops.loadManifest("ops/releases/v1.2.json", "v1.3")).toThrow(/does not belong|NO_MANIFEST|no release manifest/);
    expect(() => ops.loadManifest("ops/releases/v1.2.json", "latest")).toThrow(/look like v1.2/);
  });

  it("the schema the manifest says 0020 adds is exactly what 0020 adds (checked on SQLite)", async () => {
    const result = await run({});
    expect(result.report.after.schemaAdded).toEqual([...manifest.expect.schemaAdded].sort());
  });

  const workflow = fs.readFileSync(".github/workflows/production-ops.yml", "utf8");
  it("runs only on manual dispatch, in the production environment, from main, with read-only repository access", () => {
    const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
    expect(triggers).toContain("workflow_dispatch:");
    for (const forbidden of ["push:", "pull_request", "schedule:", "workflow_run", "repository_dispatch", "workflow_call"]) expect(triggers, forbidden).not.toContain(forbidden);
    expect(workflow).toMatch(/environment: production\n/);
    expect(workflow).toMatch(/permissions:\n  contents: read\n/);
    expect(workflow).toContain("github.ref != 'refs/heads/main'");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("takes credentials only from the environment's secrets, into one step, never inline", () => {
    const uses = [...workflow.matchAll(/\$\{\{\s*secrets\.([A-Z_]+)\s*\}\}/g)].map((match) => match[1]).sort();
    expect(uses).toEqual(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "OPS_BACKUP_PASSPHRASE"]);
    const run = workflow.slice(workflow.indexOf("- name: Run the release operation"), workflow.indexOf("- name: Show the report"));
    for (const secret of uses) expect(run).toContain(secret);
    // Inputs reach the shell as environment variables, never interpolated into script text.
    for (const block of workflow.matchAll(/run: [|>]\n((?:\s{10}.*\n)+)/g)) expect(block[1]).not.toMatch(/\$\{\{/);
    expect(workflow).not.toMatch(/echo .*secrets\./);
  });

  it("uploads only the report and the encrypted backup", () => {
    const uploads = workflow.split("      - name:").filter((block) => block.includes("actions/upload-artifact"));
    expect(uploads).toHaveLength(2);
    const paths = uploads.flatMap((block) => block.match(/ops-out\/\S+/g) ?? []).sort();
    expect(paths).toEqual(["ops-out/backup/*.sql.enc", "ops-out/report.json", "ops-out/report.md"]);
  });

  it("is the only workflow that can run production operations, and nothing migrates on a push", () => {
    for (const file of fs.readdirSync(".github/workflows")) {
      const text = fs.readFileSync(path.join(".github/workflows", file), "utf8");
      if (file === "production-ops.yml") continue;
      expect(text, file).not.toMatch(/production-release|migrations apply|CLOUDFLARE_API_TOKEN|environment:\s*production/);
    }
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    for (const [name, command] of Object.entries(pkg.scripts)) if (!/^(ops:release|admin)$/.test(name)) expect(command, name).not.toMatch(/migrations apply DB --remote|production-release/);
  });
});

describe("contract: the real wrangler, against a throwaway local D1", () => {
  it("reads, exports and migrates the way the script parses it", async () => {
    const release = makeRelease();
    fs.appendFileSync(path.join(release.dir, ".git", "info", "exclude"), ".wrangler/\n");
    // A local database in the state production is in: 0001-0019 applied.
    const seed = temp("lh-seed-");
    fs.mkdirSync(path.join(seed, "migrations"));
    for (const name of BASE_MIGRATIONS()) fs.copyFileSync(path.join("migrations", name), path.join(seed, "migrations", name));
    fs.copyFileSync(path.join(release.dir, "wrangler.jsonc"), path.join(seed, "wrangler.jsonc"));
    const wranglerBin = path.resolve("node_modules/wrangler/bin/wrangler.js");
    const env = { ...process.env, CI: "true", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" };
    const seeded = spawnSync(process.execPath, [wranglerBin, "d1", "migrations", "apply", "DB", "--local"], { cwd: seed, encoding: "utf8", env });
    expect(seeded.status, seeded.stderr).toBe(0);
    fs.cpSync(path.join(seed, ".wrangler"), path.join(release.dir, ".wrangler"), { recursive: true });

    const world = makeWorld();
    const local = (args) => spawnSync(process.execPath, [wranglerBin, ...args.map((arg) => (arg === "--remote" ? "--local" : arg))], { cwd: release.dir, encoding: "utf8", env });
    const exec = (args) => (args[0] === "d1" && ["execute", "export", "migrations"].includes(args[1]) ? local(args) : world.exec(args));
    const cloud = ops.createCloud({ exec, rest: world.rest, manifest, accountId: ACCOUNT, mayChange: true });
    const backupDir = path.join(temp("lh-backup-"), "backup");
    const report = await ops.runRelease({ manifest, releaseDir: release.dir, expectedSha: release.sha, mode: "prepare", confirm: `PREPARE v1.2 ${release.sha}`, cloud, git: release.git, backupDir, passphrase: PASSPHRASE });
    expect(report.stopped, JSON.stringify(report.stopped)).toBeUndefined();
    expect(report.result).toBe("READY_TO_MERGE");
    expect(report.after.counts).toEqual(report.baseline.counts);
    expect(report.after.counts.items).toBe(397);
    expect(report.after.schemaAdded).toEqual(manifest.expect.schemaAdded);
    const sealed = fs.readFileSync(path.join(backupDir, fs.readdirSync(backupDir)[0]));
    const text = ops.decryptBackup(sealed, PASSPHRASE).toString();
    expect(text).toMatch(/CREATE TABLE\s+["`]?items/i);
    expect(text).toContain("d1_migrations");
  }, 300_000);
});
