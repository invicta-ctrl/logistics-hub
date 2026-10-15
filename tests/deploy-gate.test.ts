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

  it("uses the workflow's release-relative wrangler path from the release child directory", () => {
    const workflow = fs.readFileSync(".github/workflows/deploy.yml", "utf8");
    const workflowWrangler = workflow.match(/deploy-gate\.mjs --release-dir release --wrangler (\S+)/)?.[1];
    expect(workflowWrangler).toBe("node_modules/wrangler/bin/wrangler.js");

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lh-gate-ci-layout-"));
    dirs.push(workspace);
    const gateDir = path.join(workspace, "ops", "scripts", "ops");
    fs.mkdirSync(gateDir, { recursive: true });
    for (const name of ["deploy-gate.mjs", "production-release.mjs"]) {
      fs.copyFileSync(path.join("scripts", "ops", name), path.join(gateDir, name));
    }
    const releaseDir = path.join(workspace, "release");
    const wranglerDir = path.join(releaseDir, "node_modules", "wrangler", "bin");
    fs.mkdirSync(path.join(releaseDir, "migrations"), { recursive: true });
    fs.mkdirSync(wranglerDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, "migrations", "0001_a.sql"), "SELECT 1;");
    const argsFile = path.join(releaseDir, "args.json");
    fs.writeFileSync(path.join(wranglerDir, "wrangler.js"), `require("fs").writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(answer(["0001_a.sql"]))});`);
    const run = (wrangler: string) => spawnSync(process.execPath, [path.join(gateDir, "deploy-gate.mjs"), "--release-dir", "release", "--wrangler", wrangler], {
      cwd: workspace, encoding: "utf8",
    });

    // This is the pre-fix workflow argument. It becomes release/release/... after the gate enters release.
    expect(run("release/node_modules/wrangler/bin/wrangler.js").status).toBe(1);
    const corrected = run(workflowWrangler!);
    expect(corrected.status, corrected.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(argsFile, "utf8"))).toEqual(["d1", "execute", "DB", "--remote", "--json", "--command", QUERIES.migrations]);
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

describe.skipIf(process.platform === "win32")("V116-QH03: the public run log never carries Wrangler's private output", () => {
  const workflow = () => fs.readFileSync(".github/workflows/deploy.yml", "utf8");
  const sha = "3".repeat(40);
  const version = "0f1e2d3c-4b5a-4978-8a9b-0c1d2e3f4a5b";
  const current = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  // What wrangler prints that a public log must not show: version ids, the account's workers.dev address, who deployed.
  const wranglerSays = ["Uploaded logistics-hub (2.1 sec)", "https://logistics-hub.private-subdomain.workers.dev",
    `Current Version ID: ${current}`, "Author: deployer@example.com"].join("\n");
  const leaks = [current, version, "private-subdomain", "deployer@example.com"];

  /** The named step's `run: |` script, as bash receives it. */
  function script(name: string) {
    const lines = workflow().split("\n");
    const at = lines.indexOf(`      - name: ${name}`);
    expect(at, name).toBeGreaterThan(-1);
    const run = lines.findIndex((line, index) => index > at && line === "        run: |");
    const next = lines.findIndex((line, index) => index > at && line.startsWith("      - "));
    expect(run > at && (next === -1 || run < next), `${name} has a run block`).toBe(true);
    const body = [];
    for (const line of lines.slice(run + 1)) {
      if (line !== "" && !line.startsWith("          ")) break;
      body.push(line.slice(10));
    }
    return body.join("\n");
  }

  /** Runs a step as the Ubuntu runner does, with a stand-in npx that records its arguments and answers like wrangler. */
  function step(name: string, env: Record<string, string>, wrangler = { stdout: wranglerSays, stderr: "", status: 0 }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-public-log-"));
    dirs.push(dir);
    const argsFile = path.join(dir, "args.jsonl");
    fs.writeFileSync(path.join(dir, "npx"), `#!/usr/bin/env node
require("fs").appendFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write(${JSON.stringify(wrangler.stdout)}); process.stderr.write(${JSON.stringify(wrangler.stderr)}); process.exit(${wrangler.status});
`, { mode: 0o700 });
    const summary = path.join(dir, "summary.md");
    const result = spawnSync("bash", ["-e", "-c", script(name)], {
      cwd: dir, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GITHUB_STEP_SUMMARY: summary, ...env },
    });
    const read = (file: string) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    return { status: result.status, log: result.stdout + result.stderr, summary: read(summary),
      args: read(argsFile).split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
  }

  /** A workflow_dispatch event file with this target and confirmation, as the runner provides it. */
  function event(target: string, confirm = `ROLLBACK ${target}`) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-dispatch-"));
    dirs.push(dir);
    const file = path.join(dir, "event.json");
    fs.writeFileSync(file, JSON.stringify({ inputs: { target, reason: "test", confirm } }));
    return file;
  }
  const stepsOf = (job: string) => {
    const text = workflow();
    const start = text.indexOf(`\n  ${job}:\n`);
    const end = text.indexOf("\n  rollback:\n", start + 1);
    return text.slice(start, job === "deploy" ? end : undefined).split("\n      - ").slice(1);
  };

  it("deploys and dry-runs after both gates, showing only a curated status", () => {
    const text = workflow();
    expect(text.indexOf("      - name: Deploy\n")).toBeGreaterThan(text.indexOf("      - name: Refuse while production lacks a migration"));
    const deploy = step("Deploy", { SHA: sha, HOW: "manual", DRY: "false", REASON: "restore the photo fix" });
    expect(deploy.status, deploy.log).toBe(0);
    expect(deploy.args).toEqual([["wrangler", "deploy", "--message", `manual ${sha.slice(0, 12)}: restore the photo fix`]]);
    expect(deploy.summary).toMatch(new RegExp(`^Deployed ${sha} \\(manual\\) at \\S+\\. Reason: restore the photo fix\\n$`));
    expect(deploy.log).toBe(deploy.summary);
    const dry = step("Deploy", { SHA: sha, HOW: "ci", DRY: "true", REASON: "" });
    expect(dry.status, dry.log).toBe(0);
    expect(dry.args).toEqual([["wrangler", "deploy", "--dry-run"]]);
    expect(dry.summary).toBe(`Dry run for ${sha}: every check passed; nothing was uploaded.\n`);
    expect(dry.log).toBe(dry.summary);
    // The Worker version message is still cut to 100 characters.
    expect(step("Deploy", { SHA: sha, HOW: "override", DRY: "false", REASON: "x".repeat(200) }).args[0][3]).toHaveLength(100);
    // The reason is printed on one line, so it cannot start a line the runner would read as a command.
    const injected = step("Deploy", { SHA: sha, HOW: "manual", DRY: "false", REASON: "fix\n::warning::injected\r" });
    expect(injected.status, injected.log).toBe(0);
    expect(injected.log).toMatch(new RegExp(`^Deployed ${sha} \\(manual\\) at \\S+\\. Reason: fix ::warning::injected \\n$`));
  });

  it("fails with Wrangler's own exit code, showing only Cloudflare's error codes", () => {
    const stderr = `✘ [ERROR] A request to the Cloudflare API (/accounts/abc123/workers/scripts/logistics-hub) failed.\n  Authentication error [code: 10000]\n`
      + "You are logged in with an API Token, associated with the email deployer@example.com.\n";
    const failed = step("Deploy", { SHA: sha, HOW: "ci", DRY: "false", REASON: "" }, { stdout: wranglerSays, stderr, status: 7 });
    expect(failed.status).toBe(7);
    expect(failed.log).toBe("::error::wrangler deploy failed with exit 7 and Cloudflare [code: 10000]. Its own output stays off this public log; see docs/DEPLOYMENT.md, CI deploy-gate.\n");
    expect(failed.summary).toBe("");
    // A failure Cloudflare gave no code for (a missing build, a bad config) still keeps Wrangler's exit code.
    const bare = step("Deploy", { SHA: sha, HOW: "ci", DRY: "true", REASON: "" }, { stdout: "", stderr: "✘ [ERROR] The assets directory does not exist.\n", status: 9 });
    expect(bare.status).toBe(9);
    expect(bare.log).toBe("::error::wrangler deploy failed with exit 9. Its own output stays off this public log; see docs/DEPLOYMENT.md, CI deploy-gate.\n");
    const rollback = step("Roll back", { TARGET: version, REASON: "test" }, { stdout: wranglerSays, stderr: "", status: 3 });
    expect(rollback.status).toBe(3);
    expect(rollback.log).toBe("::error::wrangler rollback failed with exit 3. Its own output stays off this public log; see docs/DEPLOYMENT.md, CI deploy-gate.\n");
    expect(rollback.summary).toBe("");
  });

  it("masks the rollback target before any step can show it, and refuses a malformed one unseen", () => {
    expect(workflow()).not.toMatch(/^run-name:/m);
    const steps = stepsOf("rollback");
    expect(steps[0]).toMatch(/^name: Mask the rollback target\n/);
    // No environment (the runner prints it before the script runs) and no expression the runner would expand into the script.
    expect(steps[0]).not.toContain("env:");
    expect(steps[0]).not.toContain("${{");
    for (const shown of steps.join("\n").matchAll(/echo "([^"]*)"/g)) expect(shown[1]).not.toMatch(/\$\{?(TARGET|CONFIRM)/);
    const masked = step("Mask the rollback target", { GITHUB_EVENT_PATH: event(version) });
    expect(masked.status, masked.log).toBe(0);
    expect(masked.log).toBe(`::add-mask::${version}\n`);
    for (const target of ["not-a-version", `${version}\nsecond-line`, sha]) {
      const refused = step("Mask the rollback target", { GITHUB_EVENT_PATH: event(target) });
      expect(refused.status).not.toBe(0);
      expect(refused.log).toBe("::error::target must be a Worker version id.\n");
    }
    // A confirmation that does not match is refused in the same step, unseen: the mask covers only the exact id, not a
    // mistyped copy of it, so no later step reads the confirmation at all.
    expect(workflow()).not.toMatch(/\$\{\{[^}]*inputs\.confirm/);
    for (const confirm of [`ROLLBACK ${version.slice(0, 35)}`, `rollback ${version}`, `ROLLBACK ${version.toUpperCase()}`, ""]) {
      const refused = step("Mask the rollback target", { GITHUB_EVENT_PATH: event(version, confirm) });
      expect(refused.status).not.toBe(0);
      expect(refused.log).toBe(`::add-mask::${version}\n::error::confirm must be exactly ROLLBACK, a space, then the target.\n`);
    }
  });

  it("keeps the dispatch inputs out of workflow- and job-level settings, which every step would show before the mask", () => {
    const text = workflow();
    const headers = [text.slice(0, text.indexOf("\njobs:\n"))];
    for (const job of ["deploy", "rollback"]) {
      const start = text.indexOf(`\n  ${job}:\n`);
      expect(start, job).toBeGreaterThan(-1);
      headers.push(text.slice(start, text.indexOf("\n    steps:\n", start)));
    }
    for (const header of headers) expect(header).not.toMatch(/inputs\.(target|confirm|reason)/);
  });

  it("rolls back with --yes and the reason, keeping every version off the log and summary", () => {
    const rolled = step("Roll back", { TARGET: version, REASON: "photo fix regressed" },
      { stdout: `${wranglerSays}\nWorker Version ${version} has been deployed to 100% of traffic.\n`, stderr: "", status: 0 });
    expect(rolled.status, rolled.log).toBe(0);
    expect(rolled.args).toEqual([["wrangler", "rollback", version, "--message", "photo fix regressed", "--yes"]]);
    expect(rolled.summary).toMatch(/^Rolled back to the requested Worker version at \S+\. Reason: photo fix regressed\n$/);
    expect(rolled.log).toBe(rolled.summary);
    for (const leak of leaks) expect(rolled.summary).not.toContain(leak);
    const injected = step("Roll back", { TARGET: version, REASON: "regressed\n::warning::injected" });
    expect(injected.status, injected.log).toBe(0);
    expect(injected.log).toMatch(/^Rolled back to the requested Worker version at \S+\. Reason: regressed ::warning::injected\n$/);
  });

  it("refuses a deploy target that is not a commit before the step that would show it", () => {
    const steps = stepsOf("deploy");
    expect(steps[0]).toMatch(/^name: Refuse a target that is not a commit before any step shows it\n/);
    // Only a dispatch has inputs: a deploy after CI has none, and must not be refused here.
    expect(steps[0]).toContain("if: github.event_name == 'workflow_dispatch'\n");
    expect(steps[0]).not.toContain("env:");
    expect(steps[0]).not.toContain("${{ inputs");
    expect(steps[1]).toMatch(/^name: Decide which commit\n/);
    const guard = "Refuse a target that is not a commit before any step shows it";
    for (const target of [version, "main", `${sha}\n${version}`]) {
      const refused = step(guard, { GITHUB_EVENT_PATH: event(target, `DEPLOY ${target}`) });
      expect(refused.status).not.toBe(0);
      expect(refused.log).toBe("::error::target must be a full 40-character commit.\n");
    }
    // So is a confirmation that does not match, which could hold a rollback's version id.
    for (const confirm of [`ROLLBACK ${version}`, `DEPLOY ${sha.slice(0, 39)}`, `deploy ${sha}`, ""]) {
      const refused = step(guard, { GITHUB_EVENT_PATH: event(sha, confirm) });
      expect(refused.status).not.toBe(0);
      expect(refused.log).toBe("::error::confirm must be exactly DEPLOY, a space, then the target.\n");
    }
    const allowed = step(guard, { GITHUB_EVENT_PATH: event(sha, `DEPLOY ${sha}`) });
    expect(allowed.status, allowed.log).toBe(0);
    expect(allowed.log).toBe("");
  });
});
