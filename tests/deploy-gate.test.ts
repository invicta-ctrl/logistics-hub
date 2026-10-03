// @ts-nocheck: exercises a plain .mjs tool against a fake wrangler.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appliedMigrations, pendingMigrations, treeMigrations } from "../scripts/ops/deploy-gate.mjs";
import { QUERIES } from "../scripts/ops/production-release.mjs";

/*
 * R9 (docs/specs/accepted/2026-10-03-review-hardening-amendment.md, H8): a deploy never ships ahead of production's schema.
 * The gate asks production one fixed read-only question and refuses on any pending migration or any unreadable answer.
 */
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function release(names: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-gate-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "migrations"));
  for (const name of names) fs.writeFileSync(path.join(dir, "migrations", name), "SELECT 1;");
  fs.writeFileSync(path.join(dir, "migrations", "README.md"), "not a migration");
  return dir;
}

/** A stand-in wrangler that records its arguments and answers with `stdout` and `status`. */
function fakeWrangler(dir: string, stdout: string, status = 0) {
  const file = path.join(dir, "fake-wrangler.cjs");
  fs.writeFileSync(file, `require("fs").writeFileSync(${JSON.stringify(path.join(dir, "args.json"))}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(stdout)}); process.exit(${status});`);
  return file;
}
const answer = (names: string[]) => JSON.stringify([{ success: true, results: names.map((name) => ({ name })) }]);
const gate = (dir: string, wrangler: string) => spawnSync(process.execPath, ["scripts/ops/deploy-gate.mjs", "--release-dir", dir, "--wrangler", wrangler], { encoding: "utf8" });

describe("R9: the deploy gate", () => {
  it("lists the release's migrations in order and finds the ones production lacks", () => {
    const dir = release(["0002_b.sql", "0001_a.sql", "0003_c.sql"]);
    expect(treeMigrations(dir)).toEqual(["0001_a.sql", "0002_b.sql", "0003_c.sql"]);
    expect(pendingMigrations(treeMigrations(dir), ["0001_a.sql"])).toEqual(["0002_b.sql", "0003_c.sql"]);
    // Production ahead of an older release is fine: old code survives a newer schema.
    expect(pendingMigrations(["0001_a.sql"], ["0001_a.sql", "0002_b.sql"])).toEqual([]);
  });

  it("reads only a well-formed answer", () => {
    expect(appliedMigrations(answer(["0001_a.sql"]))).toEqual(["0001_a.sql"]);
    for (const bad of ["", "not json", "[]", JSON.stringify([{ success: false, results: [] }]), JSON.stringify([{ success: true, results: [{ id: 1 }] }])]) expect(appliedMigrations(bad)).toBeNull();
  });

  it("passes only when production has applied every migration, asking one fixed read-only question", () => {
    const dir = release(["0001_a.sql", "0002_b.sql"]);
    const ok = gate(dir, fakeWrangler(dir, answer(["0001_a.sql", "0002_b.sql"])));
    expect(ok.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "args.json"), "utf8"))).toEqual(["d1", "execute", "DB", "--remote", "--json", "--command", QUERIES.migrations]);
    const behind = gate(dir, fakeWrangler(dir, answer(["0001_a.sql"])));
    expect(behind.status).toBe(1);
    expect(behind.stderr).toContain("0002_b.sql");
  });

  it("refuses when production cannot be read", () => {
    const dir = release(["0001_a.sql"]);
    expect(gate(dir, fakeWrangler(dir, answer(["0001_a.sql"]), 1)).status).toBe(1);
    expect(gate(dir, fakeWrangler(dir, "Authentication error")).status).toBe(1);
  });
});
