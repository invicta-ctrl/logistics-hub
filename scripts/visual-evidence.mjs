// Renders the real staff app for a Road-to-V2 visual review: builds the current tree (and, with
// --base <git ref>, that ref in a throwaway worktree), runs each against its own throwaway local
// Worker + D1 seeded by the migrations and two fictional demo accounts, then saves desktop / tablet /
// phone screenshots and median timings. Nothing touches the preview database or production.
//
//   npm run evidence -- --out docs/visual-research/v1.2 [--base main] [--pages items,stock]
//
// Screenshots are JPEG so they are small enough to commit; inspect them before you do.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { createAccountSql, runD1, wrangler } from "./staff-account.mjs";

const { values: args } = parseArgs({ options: { out: { type: "string" }, base: { type: "string" }, pages: { type: "string" } } });
const root = process.cwd();
const out = path.resolve(args.out ?? ".wrangler/evidence");
const pages = (args.pages ?? "items,stock,loans,self-service,activity,admin,account").split(",");
const SIZES = { desktop: [1440, 900, 1], tablet: [768, 1024, 2], phone: [390, 844, 2] };
const ACCOUNTS = [["OWNER", "owner.demo", "Alex Reyes"], ["STAFF", "staff.demo", "Sam Cruz"]];
const password = randomBytes(18).toString("base64url");
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed in ${cwd}`);
}

/** Builds `dir`, seeds a fresh database for it and serves it; returns the URL and a stop function. */
async function serve(dir, port) {
  run("npm", ["run", "build"], dir);
  const state = path.join(root, ".wrangler", `evidence-${port}`);
  fs.rmSync(state, { recursive: true, force: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, ".env"), `SESSION_SECRET=${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
  run(process.execPath, [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", state], dir);
  runD1("UPDATE system_settings SET value = 'open' WHERE key = 'self_service'", { persistTo: state });
  for (const [role, username, name] of ACCOUNTS) runD1(createAccountSql(username, name, password, role), { persistTo: state });
  const child = spawn(process.execPath, [wrangler, "dev", "--local", "--port", String(port), "--inspector-port", String(port + 1), "--persist-to", state, "--env-file", path.join(state, ".env")], { cwd: dir, stdio: "ignore", detached: process.platform !== "win32" });
  const url = `http://127.0.0.1:${port}`;
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not listening yet */ }
    if (tries > 120) throw new Error(`the Worker at ${url} did not start`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const stop = () => {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else try { process.kill(-child.pid); } catch { /* already gone */ }
    fs.rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  };
  return { url, stop };
}

async function signIn(browser, url, username, [width, height, scale]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${url}/staff`);
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector("tbody tr");
  return { context, page };
}

async function capture(url, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  try {
    for (const [size, viewport] of Object.entries(SIZES)) {
      for (const [role, username] of ACCOUNTS) {
        if (role === "STAFF" && size !== "phone") continue;
        const { context, page } = await signIn(browser, url, username, viewport);
        for (const name of pages) {
          if (role === "STAFF" && name === "admin") continue;
          await page.goto(`${url}/staff/${name}`);
          await page.waitForLoadState("networkidle");
          await shot(page, `${role.toLowerCase()}-${size}-${name}`);
        }
        // The account menu; on phones it is the More sheet.
        const opener = size === "phone" ? page.getByRole("button", { name: "More" }) : page.getByRole("button", { name: /^Account:/ });
        if (await opener.count()) { await opener.click(); await shot(page, `${role.toLowerCase()}-${size}-menu`); }
        await context.close();
      }
    }
    // Median of seven: a cold load to the first item row, and an Items → Stock switch after a short hover.
    const { context, page } = await signIn(browser, url, "owner.demo", SIZES.desktop);
    const cold = [], swap = [];
    for (let run = 0; run < 7; run++) {
      await (await context.newCDPSession(page)).send("Network.clearBrowserCache");
      let start = Date.now();
      await page.goto(`${url}/staff`);
      await page.waitForSelector("tbody tr");
      cold.push(Date.now() - start);
      const link = page.locator('a[href="/staff/stock"]').first();
      await link.hover();
      await page.waitForTimeout(150);
      start = Date.now();
      await link.click();
      await page.waitForFunction(() => document.querySelector("#main-content h1")?.textContent?.startsWith("Stock"));
      swap.push(Date.now() - start);
    }
    const timings = { coldLoadToFirstRowMs: median(cold), sectionSwitchMs: median(swap) };
    fs.writeFileSync(path.join(dir, "timings.json"), `${JSON.stringify(timings, null, 2)}\n`);
    await context.close();
    return timings;
  } finally {
    await browser.close();
  }
}

const port = 20_000 + (randomBytes(2).readUInt16BE(0) % 20_000);
const targets = [["after", root]];
let worktree = "";
if (args.base) {
  worktree = path.join(root, ".wrangler", "evidence-base");
  fs.rmSync(worktree, { recursive: true, force: true });
  spawnSync("git", ["worktree", "prune"], { cwd: root });
  run("git", ["worktree", "add", "--detach", worktree, args.base], root);
  fs.symlinkSync(path.join(root, "node_modules"), path.join(worktree, "node_modules"), "junction");
  targets.unshift(["before", worktree]);
}
try {
  for (const [label, dir] of targets) {
    const server = await serve(dir, port + (label === "before" ? 2 : 0));
    try {
      console.log(label, JSON.stringify(await capture(server.url, path.join(out, args.base ? label : ""))));
    } finally {
      server.stop();
    }
  }
} finally {
  if (worktree) run("git", ["worktree", "remove", "--force", worktree], root);
}
console.log(`Screenshots and timings in ${path.relative(root, out) || "."}`);
