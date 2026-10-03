// Renders the real staff app for a Road-to-V2 visual review: builds the current tree (and, with
// --base <git ref>, that ref in a throwaway worktree), runs each against its own throwaway local
// Worker + D1 seeded by the migrations and two fictional demo accounts, then saves desktop / tablet /
// phone screenshots and median timings. Nothing touches the preview database or production.
//
//   npm run evidence -- --out docs/visual-research/v1.2 [--base main] [--pages items,stock]
//
// Besides /staff/<name> pages, --pages understands two scenes: item-profile (an item's open profile; works on any
// ref, so before and after compare) and item-photos (item photos: list, profile, viewer, upload preview, missing
// photo, and list weight/loading with 300 photos; runs only where the item photo panel exists) and public-photos (the
// public Lending Hub and the phone Self-Service with item photos: lists, the item sheet and the narrowest phone; runs only
// where the public thumbnail route exists) and shell (the staff top/bottom bar and its menus at 320-1440 px, short screens,
// 125/150% zoom and large text, with measured checks; works on any ref). Its pictures are drawn here in the browser, so no image file enters the repository.
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
  // public-photos needs items the public lists show: a spread of loanables and supplies, reviewed and active.
  if (pages.includes("public-photos")) runD1("UPDATE items SET status = 'ACTIVE', needs_review = 0, item_type = CASE WHEN rowid % 4 = 0 THEN 'Consumable' ELSE 'Loanable' END, lending_audience = CASE WHEN rowid % 5 = 0 THEN 'USC_STAFF_ONLY' ELSE 'STUDENTS_AND_USC_STAFF' END WHERE id IN (SELECT id FROM items ORDER BY name COLLATE NOCASE LIMIT 24)", { persistTo: state });
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

/** The public Lending Hub and phone Self-Service with item photos: every third item has none, so alignment and the gaps are visible. */
async function publicPhotoScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const first = await signIn(browser, url, "owner.demo", SIZES.desktop);
  const catalog = await (await first.page.request.get(`${url}/api/public/catalog`)).json();
  if (!catalog.items.length || !("photo" in catalog.items[0])) {
    console.log("public-photos: this ref has no public item photos, skipped");
    await first.context.close();
    return {};
  }
  const art = await first.page.evaluate(drawPhotos);
  const ids = catalog.items.slice(0, 18).map((item) => item.id);
  const timings = {};
  /** A signed-out cold load of the Lending Hub: the layout shift and which elements moved. */
  const lendingShift = async (viewport) => {
    const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: viewport[2], reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__shift = 0; window.__moved = [];
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) {
        window.__shift += entry.value;
        for (const source of entry.sources ?? []) window.__moved.push(`${source.node?.nodeName?.toLowerCase()}.${(source.node?.className ?? "").toString().split(" ")[0]}`);
      } }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`${url}/lending`);
    await page.waitForSelector(".catalogue__row");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => ({ shift: Number(window.__shift.toFixed(4)), moved: [...new Set(window.__moved)].slice(0, 8) }));
    await context.close();
    return result;
  };
  timings.shiftBeforePhotos = { desktop: await lendingShift(SIZES.desktop), phone: await lendingShift(SIZES.phone) };
  await seedPhotos(first.page, url, ids.filter((_, index) => index % 3 !== 2), art);
  await first.context.close();
  timings.shiftAfterPhotos = { desktop: await lendingShift(SIZES.desktop), phone: await lendingShift(SIZES.phone) };
  const sheetItem = ids[0];
  const sizes = { ...SIZES, narrow: [320, 640, 2] };
  for (const [size, [width, height, scale]] of Object.entries(sizes)) {
    // Signed out, as the public sees it.
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: "reduce" });
    const page = await context.newPage();
    let thumbs = 0, bytes = 0;
    page.on("response", async (response) => { if (response.url().includes("/api/public/media/")) { thumbs++; bytes += Number(response.headers()["content-length"] ?? 0); } });
    await page.addInitScript(() => {
      window.__shift = 0;
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value; }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`${url}/lending`);
    await page.waitForSelector(".catalogue__row .item-thumb");
    await page.waitForLoadState("networkidle");
    // The list is what changed, so the picture is taken with it in view (the header alone fills a narrow phone).
    await page.locator(".catalogue-group").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -100));
    await shot(page, `public-lending-${size}`);
    timings[size] = { lendingThumbs: thumbs, lendingKb: Math.round(bytes / 1024), lendingLayoutShift: Number((await page.evaluate(() => window.__shift)).toFixed(4)) };
    await page.goto(`${url}/self-service?do=get`);
    await page.waitForSelector(".ss-row .item-thumb");
    await page.waitForLoadState("networkidle");
    await shot(page, `public-selfservice-list-${size}`);
    if (size === "phone") timings.topOfSelfService = await page.evaluate(() => {
      const at = document.elementFromPoint(window.innerWidth / 2, 40);
      return { element: at ? `${at.nodeName.toLowerCase()}.${at.className}` : null, html: at?.outerHTML.slice(0, 220) ?? null, parent: at?.parentElement ? `${at.parentElement.nodeName.toLowerCase()}.${at.parentElement.className}` : null, ssPhotos: document.querySelectorAll(".ss-photo").length, itemPhotos: document.querySelectorAll(".ss-item-photo").length, ghostVisible: getComputedStyle(document.querySelector(".ss-photo")).display };
    });
    await page.goto(`${url}/self-service?do=${(await (await page.request.get(`${url}/api/self-service/catalog`)).json()).items.find((item) => item.id === sheetItem)?.action === "BORROW" ? "borrow" : "take"}&item=${sheetItem}`);
    await page.waitForSelector("dialog[open] .ss-item-photo");
    await page.waitForLoadState("networkidle");
    await shot(page, `public-selfservice-sheet-${size}`);
    await context.close();
  }
  return timings;
}

/**
 * The staff shell across the widths, zooms and text sizes people use: the top or bottom bar, then the account menu (or, on
 * phones, More). Zoom is a narrower CSS viewport at a higher pixel ratio, as a browser zooms; large text raises the root size.
 * Besides pictures it measures what review keeps catching by eye: squashed icons, clipped labels, labels run together, overlap between the sections
 * and the account control, and icon-only controls without a name.
 */
async function shellScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const first = await signIn(browser, url, "owner.demo", SIZES.desktop);
  const state = await first.context.storageState();
  await first.context.close();
  const scenes = [
    ["320", 320, 640, 2], ["375", 375, 667, 2], ["414", 414, 896, 2], ["768", 768, 1024, 2], ["1024", 1024, 768, 1], ["1440", 1440, 900, 1],
    ["short-phone", 667, 375, 2], ["short-laptop", 1280, 560, 1],
    ["zoom125-1440", 1152, 720, 1.25], ["zoom150-1440", 960, 600, 1.5], ["zoom150-768", 512, 683, 3],
    ["text150-320", 320, 640, 2, "150%"], ["text150-375", 375, 667, 2, "150%"], ["text150-1024", 1024, 768, 1, "150%"], ["text200-320", 320, 640, 2, "200%"]
  ];
  const checks = {};
  for (const [name, width, height, scale, text] of scenes) {
    const { context, page } = await resume(browser, state, [width, height, scale]);
    if (text) await page.addInitScript((size) => document.addEventListener("DOMContentLoaded", () => document.documentElement.style.setProperty("font-size", size, "important")), text);
    await page.goto(`${url}/staff/items`);
    await page.waitForSelector("tbody tr");
    await page.waitForLoadState("networkidle");
    await shot(page, `shell-${name}`);
    const measure = () => page.evaluate(() => {
      const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"; };
      const label = (element) => `${element.closest("[class]")?.className.toString().split(" ")[0]}:${(element.closest("a, button")?.textContent ?? "").trim().slice(0, 20)}`;
      const icons = [...document.querySelectorAll("svg.icon")].filter(visible);
      const squashed = icons.filter((svg) => { const box = svg.getBoundingClientRect(); return Math.abs(box.width - box.height) > 0.5; }).map(label);
      const clipped = [...document.querySelectorAll(".app-nav__text, .account__name, .menu__item, .app-bar__title")].filter(visible)
        .filter((element) => element.clientWidth > 1) // visually hidden on purpose
        .filter((element) => {
          // The laid-out text, not the box: an ellipsis hides overflow that scrollWidth does not always report.
          const box = element.getBoundingClientRect();
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const lines = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.parentElement.closest(".visually-hidden")) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            lines.push(...range.getClientRects());
          }
          return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
            || lines.some((line) => line.width > 0 && (line.left < box.left - 0.5 || line.right > box.right + 0.5));
        }).map((element) => `${element.className}:${element.textContent.trim().slice(0, 20)}`);
      const account = document.querySelector(".account")?.getBoundingClientRect();
      const overlaps = account ? [...document.querySelectorAll(".app-nav__link, .app-bar__brand")].filter(visible).filter((element) => {
        const box = element.getBoundingClientRect();
        return box.right > account.left + 0.5 && box.left < account.right - 0.5 && box.bottom > account.top + 0.5 && box.top < account.bottom - 0.5;
      }).map((element) => element.textContent.trim().slice(0, 20)) : ["no account control"];
      const labels = [...document.querySelectorAll(".app-nav__text")].filter(visible).map((text) => {
        const range = document.createRange();
        range.selectNodeContents(text.firstChild);
        const lines = [...range.getClientRects()];
        const box = text.getBoundingClientRect(); // what an ellipsis leaves visible
        return { name: text.firstChild.textContent, left: Math.max(box.left, Math.min(...lines.map((line) => line.left))), right: Math.min(box.right, Math.max(...lines.map((line) => line.right))), top: lines[0].top };
      });
      const crowded = labels.slice(1).filter((text, index) => Math.abs(text.top - labels[index].top) < 2 && text.left - labels[index].right < 6).map((text, index) => `${labels[index].name}|${text.name}`);
      const unnamed = [...document.querySelectorAll("button, a[href]")].filter(visible).filter((control) => !(control.textContent ?? "").trim() && !control.getAttribute("aria-label")).map(label);
      const small = [...document.querySelectorAll(".app-nav__link, .account, .menu__item, .icon-button")].filter(visible)
        .filter((control) => { const box = control.getBoundingClientRect(); return box.width < 24 || box.height < 24; }).map(label);
      return { squashed, clipped, overlaps, crowded, unnamed, under24px: small, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    checks[name] = { bar: await measure() };
    const phone = await page.locator(".app-nav__more").isVisible();
    await (phone ? page.locator(".app-nav__more") : page.locator(".account")).click();
    await page.waitForSelector("#staff-menu:popover-open");
    await shot(page, `shell-${name}-menu`);
    checks[name].menu = await measure();
    await context.close();
  }
  fs.writeFileSync(path.join(dir, "shell-checks.json"), `${JSON.stringify(checks, null, 2)}\n`);
  return Object.fromEntries(Object.entries(checks).map(([name, { bar, menu }]) => [name, [bar, menu].every((entry) => entry.sideways === 0 && ["squashed", "clipped", "overlaps", "crowded", "unnamed", "under24px"].every((key) => !entry[key].length)) ? "clean" : "see shell-checks.json"]));
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
          if (name === "item-photos" || name === "public-photos" || name === "shell") continue;
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
    if (pages.includes("public-photos")) Object.assign(timings, { publicPhotos: await publicPhotoScenes(browser, url, dir) });
    if (pages.includes("shell")) Object.assign(timings, { shell: await shellScenes(browser, url, dir) });
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
