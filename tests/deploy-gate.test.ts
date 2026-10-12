// @ts-nocheck: exercises a plain .mjs tool against a fake wrangler.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appliedMigrations, codeqlState, pendingMigrations, treeMigrations } from "../scripts/ops/deploy-gate.mjs";
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

describe("V116-QH03: exact-source security qualification before provider access", () => {
  const sha = "1".repeat(40);
  const repo = "invicta-ctrl/logistics-hub";
  const run = (extra = {}) => ({ id: 1, event: "push", path: ".github/workflows/codeql.yml", head_sha: sha,
    head_branch: "main", head_repository: { full_name: repo }, status: "completed", conclusion: "success", ...extra });
  const check = (extra = {}) => ({ id: 1, name: "CodeQL", head_sha: sha, app: { id: 57789, slug: "github-advanced-security" },
    status: "completed", conclusion: "success", ...extra });

  it("requires both the main push analysis and its exact-SHA combined CodeQL result", () => {
    expect(codeqlState([run()], [check()], sha, repo)).toBe("success");
    for (const extra of [{ head_sha: "2".repeat(40) }, { head_branch: "slice/test" }, { event: "workflow_dispatch" },
      { path: ".github/workflows/ci.yml" }, { head_repository: { full_name: "other/repo" } }]) {
      expect(codeqlState([run(extra)], [check()], sha, repo)).toBe("pending");
    }
    for (const extra of [{ head_sha: "2".repeat(40) }, { name: "analyze (javascript-typescript)" },
      { app: { id: 15368, slug: "github-actions" } }]) {
      expect(codeqlState([run()], [check(extra)], sha, repo)).toBe("pending");
    }
    expect(codeqlState([run()], [], sha, repo)).toBe("pending");
  });

  it("fails closed on unqualified or newer incomplete results despite an earlier success", () => {
    for (const conclusion of ["failure", "cancelled", "skipped", "neutral", "timed_out", null]) {
      expect(codeqlState([run()], [check({ conclusion })], sha, repo)).toBe("failed");
      expect(codeqlState([run({ conclusion })], [check()], sha, repo)).toBe("failed");
    }
    expect(codeqlState([run()], [check(), check({ id: 2, conclusion: "failure" })], sha, repo)).toBe("failed");
    expect(codeqlState([run()], [check(), check({ id: 2, status: "in_progress", conclusion: null })], sha, repo)).toBe("pending");
    expect(codeqlState([run(), run({ id: 2, status: "queued", conclusion: null })], [check()], sha, repo)).toBe("pending");
    expect(() => codeqlState(null, [], sha, repo)).toThrow("Unreadable");
  });

  it("keeps manual qualification's skipped jobs away from required regression-check names", () => {
    const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    for (const job of ["checks", "worker-e2e"]) {
      const section = workflow.slice(workflow.indexOf(`\n  ${job}:`));
      expect(section).toContain(`if: github.event_name != 'workflow_dispatch'\n    name: \${{ github.event_name == 'workflow_dispatch' && 'qualification-no-${job}' || '${job}' }}`);
    }
  });

  it.skipIf(process.platform === "win32")("executes the actual Ubuntu workflow gate and never reaches a provider command after denial", () => {
    const workflow = fs.readFileSync(".github/workflows/deploy.yml", "utf8");
    const securityStep = workflow.match(/      - name: Require this source's CodeQL analysis and combined security check\n([\s\S]+?)(?=\n      - )/)?.[1];
    expect(securityStep).toBeTruthy();
    expect(securityStep).not.toContain("CLOUDFLARE_");
    expect(securityStep).not.toContain("override_ci");
    expect(workflow.indexOf(securityStep!)).toBeLessThan(workflow.indexOf("      - name: Refuse while production lacks a migration"));
    const command = securityStep!.match(/        run: (.+)/)?.[1];
    expect(command).toBeTruthy();
    const checkoutStep = workflow.match(/      - name: Check out the commit to deploy\n([\s\S]+?)(?=\n      - )/)?.[1];
    const checkoutSource = checkoutStep?.match(/          ref: (.+)/)?.[1];
    expect(checkoutSource).toBe("${{ steps.pick.outputs.sha }}");
    const buildStep = workflow.match(/      - name: Build\n([\s\S]+?)(?=\n      - )/)?.[1];
    expect(buildStep).toContain(`RELEASE_SHA: ${checkoutSource}`);
    const buildCommand = buildStep?.match(/        run: (.+)/)?.[1];
    expect(buildCommand).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-security-gate-"));
    dirs.push(dir);
    fs.symlinkSync(process.cwd(), path.join(dir, "ops"), "dir");
    fs.writeFileSync(path.join(dir, "gh"), `#!/usr/bin/env node
const fs = require("fs");
fs.appendFileSync("requests.jsonl", JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.FAKE_READ_ERROR) process.exit(1);
process.stdout.write(process.argv[3].includes("/actions/workflows/") ? process.env.FAKE_RUNS : process.env.FAKE_CHECKS);
`, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, "provider.cjs"), 'require("fs").writeFileSync("provider-called", "yes");');
    fs.writeFileSync(path.join(dir, "npm"), `#!/usr/bin/env node
require("fs").writeFileSync("build-source", process.env.GITHUB_SHA);
`, { mode: 0o700 });
    const built = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", buildCommand!], {
      cwd: dir, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GITHUB_SHA: "2".repeat(40), RELEASE_SHA: sha },
    });
    expect(built.status, built.stderr).toBe(0);
    expect(fs.readFileSync(path.join(dir, "build-source"), "utf8")).toBe(sha);
    const exercise = (result, readError = "") => spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", `${command}\nnode provider.cjs`], {
      cwd: dir, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, SHA: sha, REPO: repo, GH_TOKEN: "test-only",
        FAKE_RUNS: JSON.stringify({ total_count: 1, workflow_runs: [run()] }), FAKE_CHECKS: JSON.stringify({ total_count: 1, check_runs: [result] }), FAKE_READ_ERROR: readError },
    });
    const refused = exercise(check({ conclusion: "failure" }));
    expect(refused.status, refused.stderr).not.toBe(0);
    expect(refused.stderr).toContain("did not qualify this exact source");
    expect(fs.existsSync(path.join(dir, "provider-called"))).toBe(false);
    expect(exercise(check(), "denied").status).not.toBe(0);
    expect(fs.existsSync(path.join(dir, "provider-called"))).toBe(false);
    const allowed = exercise(check());
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(fs.readFileSync(path.join(dir, "provider-called"), "utf8")).toBe("yes");
    const requests = fs.readFileSync(path.join(dir, "requests.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    for (const args of requests) {
      expect(args[0]).toBe("api");
      expect(args[1]).toContain(sha);
      expect(args[1]).toMatch(/^repos\/invicta-ctrl\/logistics-hub\/(actions\/workflows\/codeql\.yml\/runs|commits\/[0-9a-f]{40}\/check-runs)\?/);
    }
  });
});
