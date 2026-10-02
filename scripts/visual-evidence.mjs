// Renders the real staff app for a Road-to-V2 visual review: builds the current tree (and, with
// --base <git ref>, that ref in a throwaway worktree), runs each against its own throwaway local
// Worker + D1 seeded by the migrations and two fictional demo accounts, then saves desktop / tablet /
// phone screenshots and median timings. Nothing touches the preview database or production.
//
//   npm run evidence -- --out docs/visual-research/v1.2 [--base main] [--pages items,stock]
//
// Besides /staff/<name> pages, --pages understands two scenes: item-profile (an item's open profile; works on any
// ref, so before and after compare) and item-photos (item photos: list, profile, viewer, upload preview, missing
// photo, and list weight/loading with 300 photos; runs only where the item photo panel exists). Its pictures are
// drawn here in the browser, so no image file enters the repository.
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

/** A fresh context at `viewport` that is already signed in (the login is limited to 5 a minute, so scenes share one). */
async function resume(browser, state, [width, height, scale]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: "reduce", storageState: state });
  return { context, page: await context.newPage() };
}

/** Eight fictional product shots (box, bottle, roll; landscape and portrait), drawn on canvases: full-size and thumbnail JPEGs. */
function drawPhotos() {
  const draw = (width, height, hue, shape, edge) => {
    const scale = edge / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const c = canvas.getContext("2d");
    c.scale(scale, scale);
    const backdrop = c.createLinearGradient(0, 0, 0, height);
    backdrop.addColorStop(0, `hsl(${hue} 18% 95%)`);
    backdrop.addColorStop(1, `hsl(${hue} 16% 82%)`);
    c.fillStyle = backdrop;
    c.fillRect(0, 0, width, height);
    c.fillStyle = "rgb(0 0 0 / 14%)";
    c.beginPath();
    c.ellipse(width / 2, height * 0.79, width * 0.27, height * 0.04, 0, 0, 7);
    c.fill();
    c.fillStyle = `hsl(${hue} 60% 44%)`;
    if (shape === 0) {
      c.fillRect(width * 0.3, height * 0.38, width * 0.4, height * 0.4);
      c.fillStyle = `hsl(${hue} 60% 58%)`;
      c.beginPath(); c.moveTo(width * 0.3, height * 0.38); c.lineTo(width * 0.38, height * 0.3); c.lineTo(width * 0.78, height * 0.3); c.lineTo(width * 0.7, height * 0.38); c.fill();
      c.fillStyle = "rgb(255 255 255 / 85%)"; c.fillRect(width * 0.36, height * 0.5, width * 0.28, height * 0.1);
    } else if (shape === 1) {
      c.beginPath(); c.roundRect(width * 0.38, height * 0.36, width * 0.24, height * 0.42, width * 0.04); c.fill();
      c.fillRect(width * 0.45, height * 0.26, width * 0.1, height * 0.1);
      c.fillStyle = `hsl(${hue} 30% 22%)`; c.fillRect(width * 0.43, height * 0.22, width * 0.14, height * 0.05);
      c.fillStyle = "rgb(255 255 255 / 85%)"; c.fillRect(width * 0.4, height * 0.5, width * 0.2, height * 0.12);
    } else {
      c.beginPath(); c.ellipse(width / 2, height * 0.6, width * 0.22, height * 0.18, 0, 0, 7); c.fill();
      c.fillStyle = `hsl(${hue} 18% 90%)`;
      c.beginPath(); c.ellipse(width / 2, height * 0.6, width * 0.09, height * 0.07, 0, 0, 7); c.fill();
    }
    return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
  };
  return Array.from({ length: 8 }, (_, index) => {
    const portrait = index % 3 === 2;
    const [width, height] = portrait ? [960, 1280] : [1280, 960];
    return { display: draw(width, height, (index * 47) % 360, index % 3, 1280), thumb: draw(width, height, (index * 47) % 360, index % 3, 320) };
  });
}

/** Gives items photos through the real endpoint, as signed in as the owner. */
async function seedPhotos(page, url, ids, art) {
  for (const [index, id] of ids.entries()) {
    const picture = art[index % art.length];
    const response = await page.request.put(`${url}/api/staff/items/${id}/photo`, { headers: { origin: url }, multipart: {
      display: { name: "display.jpg", mimeType: "image/jpeg", buffer: Buffer.from(picture.display, "base64") },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: Buffer.from(picture.thumb, "base64") }, expected: "" } });
    if (!response.ok()) throw new Error(`seeding a photo for ${id} failed: ${response.status()}`);
  }
}

/** Items list cold load, as a staff member sees it: time to rows, picture requests and bytes, layout shift, and after scrolling the whole list. */
async function listLoad(browser, url, state, viewport) {
  const runs = [];
  for (let run = 0; run < 5; run++) {
    const { context, page } = await resume(browser, state, viewport);
    await page.addInitScript(() => {
      window.__shift = 0;
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value; }).observe({ type: "layout-shift", buffered: true });
    });
    let requests = 0, bytes = 0;
    page.on("response", async (response) => { if (response.url().includes("/api/staff/media/")) { requests++; bytes += Number(response.headers()["content-length"] ?? (await response.body().catch(() => "")).length); } });
    await (await context.newCDPSession(page)).send("Network.clearBrowserCache");
    const start = Date.now();
    await page.goto(`${url}/staff/items`);
    await page.waitForSelector("tbody tr");
    const rowsMs = Date.now() - start;
    await page.waitForLoadState("networkidle");
    const atLoad = { requests, bytes };
    for (let y = 0; y < 60; y++) { await page.evaluate(() => window.scrollBy(0, 1200)); await page.waitForTimeout(40); }
    await page.waitForLoadState("networkidle");
    runs.push({ rowsMs, requestsAtLoad: atLoad.requests, kbAtLoad: Math.round(atLoad.bytes / 1024), requestsAfterScroll: requests, kbAfterScroll: Math.round(bytes / 1024), shift: Number((await page.evaluate(() => window.__shift)).toFixed(4)) });
    await context.close();
  }
  const pick = (key) => median(runs.map((entry) => entry[key]));
  return { rowsMs: pick("rowsMs"), requestsAtLoad: pick("requestsAtLoad"), kbAtLoad: pick("kbAtLoad"), requestsAfterScroll: pick("requestsAfterScroll"), kbAfterScroll: pick("kbAfterScroll"), layoutShift: pick("shift") };
}

async function photoScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const first = await signIn(browser, url, "owner.demo", SIZES.desktop);
  await first.page.goto(`${url}/staff/items?item=ITM-0262`);
  await first.page.waitForSelector("dialog[open] .tabs");
  if (!(await first.page.locator("#photo-panel").count())) {
    console.log("item-photos: this ref has no item photos, skipped");
    await first.context.close();
    return {};
  }
  const state = await first.context.storageState();
  const art = await first.page.evaluate(drawPhotos);
  const inventory = await (await first.page.request.get(`${url}/api/staff/inventory`)).json();
  const scissors = "ITM-0262", tape = "ITM-0263";
  // The first screen of the list: every third item has no photo.
  const shown = inventory.items.slice(0, 14).map((item) => item.id);
  const timings = { withoutPhotos: await listLoad(browser, url, state, SIZES.desktop) };
  await seedPhotos(first.page, url, [...new Set([scissors, ...shown.filter((_, index) => index % 3 !== 2)])], art);
  await first.context.close();
  for (const [size, viewport] of Object.entries(SIZES)) {
    const { context, page } = await resume(browser, state, viewport);
    await page.goto(`${url}/staff/items`);
    await page.waitForSelector("img.thumb");
    await page.waitForLoadState("networkidle");
    await shot(page, `photos-list-${size}`);
    await page.goto(`${url}/staff/items?item=${scissors}`);
    await page.waitForSelector(".photo-tile img");
    await page.waitForLoadState("networkidle");
    await shot(page, `photos-profile-${size}`);
    await page.locator(".photo-tile[data-view]").click();
    await page.waitForSelector("dialog.viewer[open] img");
    await page.waitForTimeout(400);
    await shot(page, `photos-viewer-${size}`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !window.history.state?.viewer);
    await page.goto(`${url}/staff/items?item=${tape}`);
    await page.waitForSelector("#photo-panel .photo-tile--add");
    await shot(page, `photos-missing-${size}`);
    await page.locator("#photo-panel input[type=file]").setInputFiles({ name: "tape.jpg", mimeType: "image/jpeg", buffer: Buffer.from(art[2].display, "base64") });
    await page.waitForSelector("#photo-panel .photo-tile--preview img");
    await shot(page, `photos-upload-${size}`);
    await context.close();
  }
  // 300 items with a photo: the weight and loading of the whole list.
  const owner = await resume(browser, state, SIZES.desktop);
  const current = await (await owner.page.request.get(`${url}/api/staff/inventory`)).json();
  await seedPhotos(owner.page, url, current.items.filter((item) => !item.photoId && item.id !== tape).map((item) => item.id).filter((_, index) => index % 2 === 0).slice(0, 300 - shown.length), art);
  await owner.context.close();
  timings.with300Photos = await listLoad(browser, url, state, SIZES.desktop);
  return timings;
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
          if (name === "item-photos") continue;
          await page.goto(name === "item-profile" ? `${url}/staff/items?item=ITM-0262` : `${url}/staff/${name}`);
          if (name === "item-profile") await page.waitForSelector("dialog[open] .tabs");
          await page.waitForLoadState("networkidle");
          await shot(page, `${role.toLowerCase()}-${size}-${name}`);
        }
        // The account menu (from a page with nothing modal open); on phones it is the More sheet.
        await page.goto(`${url}/staff/items`);
        await page.waitForSelector("tbody tr");
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
    if (pages.includes("item-photos")) Object.assign(timings, { itemPhotos: await photoScenes(browser, url, dir) });
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
