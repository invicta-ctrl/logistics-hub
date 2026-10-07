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
// where the public thumbnail route exists), locations (V1.4: the Locations page and its sheets, the place picker, Items by place,
// the Where is it? dialog with its picture, missing picture and report flow, and the same on a phone in Self-Service, with
// places drawn here and a typed location left without a place; runs only where /staff/locations exists), shell (the staff top/bottom bar and its menus at 320-1440 px, short screens,
// 125/150% zoom and large text, with measured checks; works on any ref) and staff-directory (V1.3: the directory with a
// large department and partial profiles, a profile's five sections, the 3D USC ID card (tile lean, flight out of the tile,
// tilt with glare and foil, the turn) front, back and zoomed, and the
// owner's import with its preflight; runs only where the directory exists) and catalogue (V1.5: a long cataloguing session on one shelf
// with loanable, consumable, gradually used and review-later items; the start page, suggestion, photo preview, possible-match and
// review-later states, a save that failed offline and was retried, the finish summary, and Select mode with its dialog; runs only
// where /staff/catalogue exists) and catalog-pwa (V1.6: offline cataloguing on an Android phone and tablet, an iPhone's Safari tab and a
// computer, with the service worker on and the connection really cut; runs only where the catalogue snapshot exists) and location-audit (V1.7: a
// dozen-item shelf checked on a phone, paused, resumed and continued offline, a stock conflict, the summary and the review on a computer;
// runs only where checks of a place exist) and self-service-v19 (V1.9: Self-Service 2.0 on a phone, tablet and computer: home, search, a group, the item page, the borrow/take/use forms, identity, photo, the check, the receipt, My activity, return, the help tip, offline, and a 600-item catalog; runs only where the item page exists) and kits (V1.8: the kit list, a Ready and an incomplete kit, a template, the check and its summary; runs only where /api/staff/kits exists). Its pictures, including the obviously fake
// V1.10 (attention: the bell and nav numbers, the inbox with mixed conditions at three sizes, a filtered view, a group opened, marking a return reviewed, a loan focused from a link, an Unclassified item's suggestion, and the calm empty state; runs only where /staff/attention exists)
// V1.12 (home: the operations home for staff and for an owner at three sizes with a busy hub, a cataloguing session and a paused place check to continue, quick actions by role, the insights (borrowed, used, short, reports, kits, corrections, completeness), a calm hub, insights that failed, and the timings of Home's reads; runs only where /api/staff/home exists)
// V1.11 (search: global search over 500+ items with places, kits, links and a fictional Staff Directory, for an administrator and for staff at three sizes:
// empty, mixed, item-heavy, place, kit, a link's reason, a shortcut, an ID, long names, a long group shown in full, no matches, people (and their absence
// for staff), the keyboard, opening a result, loading, a session that has ended, and an item's Linked items card; runs only where /api/staff/search exists)
// V1.13 (Administration: scripts/admin-evidence.mjs; its five sections at three sizes, System healthy and degraded, confirmations and impact text; runs only where /api/staff/admin/system exists)
// sample ID cards, are drawn here in the browser and written only to a throwaway folder, so no image file enters the
// repository and no real ID is ever used.
//
// Screenshots are JPEG so they are small enough to commit; inspect them before you do.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { chromium, devices } from "@playwright/test";
import { adminScenes } from "./admin-evidence.mjs";
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
  // Windows needs a shell to find npm.cmd, but a shell splits an absolute path with a space in it (C:\Program Files\nodejs\node.exe).
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" && !path.isAbsolute(command) });
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
  if (pages.includes("public-photos") || pages.includes("self-service-v19")) runD1("UPDATE items SET status = 'ACTIVE', needs_review = 0, item_type = CASE WHEN rowid % 4 = 0 THEN 'Consumable' ELSE 'Loanable' END, lending_audience = CASE WHEN rowid % 5 = 0 THEN 'USC_STAFF_ONLY' ELSE 'STUDENTS_AND_USC_STAFF' END WHERE id IN (SELECT id FROM items ORDER BY name COLLATE NOCASE LIMIT 24)", { persistTo: state });
  for (const [role, username, name] of ACCOUNTS) runD1(createAccountSql(username, name, password, role), { persistTo: state });
  if (pages.includes("staff-directory")) runD1(directoryRecordsSql(), { persistTo: state });
  // locations: items the phone is offered, two look-alike places the migration would have kept apart, and typed locations with no place yet.
  if (pages.includes("locations") && fs.existsSync(path.join(dir, "migrations", "0024_locations.sql"))) runD1(locationRecordsSql(), { persistTo: state });
  if ((pages.includes("attention") || pages.includes("home")) && fs.existsSync(path.join(dir, "src", "attention.ts"))) runD1(attentionRecordsSql(), { persistTo: state });
  if (pages.includes("home") && fs.existsSync(path.join(dir, "src", "home.ts"))) runD1(homeRecordsSql(), { persistTo: state });
  if (pages.includes("search") && fs.existsSync(path.join(dir, "src", "search-palette.ts"))) runD1(searchRecordsSql(), { persistTo: state });
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
    // Windows may hold the database files a moment after the Worker is killed; a leftover folder must not hide the run's own error.
    try { fs.rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); } catch (error) { console.warn(`evidence cleanup skipped for ${state}: ${error.message}`); }
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
  // Signed in is the staff bar; the page after sign-in differs by version (Items, then Home).
  await page.waitForSelector(".app-bar");
  return { context, page };
}

/** A fresh context at `viewport` that is already signed in (the login is limited to 5 a minute, so scenes share one). */
async function resume(browser, state, [width, height, scale]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: "reduce", storageState: state });
  return { context, page: await context.newPage() };
}

/** Reviewed supplies a phone is offered, two look-alike places (as the migration leaves typed spellings) and typed locations that have no place yet. */
function locationRecordsSql() {
  return [
    "UPDATE items SET status = 'ACTIVE', needs_review = 0, item_type = 'Consumable' WHERE id IN (SELECT id FROM items ORDER BY name COLLATE NOCASE LIMIT 16)",
    "INSERT INTO locations(id, name, created_at, updated_at, imported_from) VALUES('LOC-9001', 'Supply Closet', '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z', 'ITEM_STORAGE_LOCATION'), ('LOC-9002', 'supply closet', '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z', 'ITEM_STORAGE_LOCATION')",
    "UPDATE items SET location_id = 'LOC-9001', storage_location = 'Supply Closet' WHERE id IN (SELECT id FROM items ORDER BY name COLLATE NOCASE LIMIT 3)",
    "UPDATE items SET location_id = 'LOC-9002', storage_location = 'supply closet' WHERE id IN (SELECT id FROM items ORDER BY name COLLATE NOCASE LIMIT 2 OFFSET 3)",
    "UPDATE items SET storage_location = 'Back room shelf 4' WHERE id IN (SELECT id FROM items ORDER BY name COLLATE NOCASE LIMIT 2 OFFSET 5)"
  ].join("; ");
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
  const inventory = await (await page.request.get(`${url}/api/staff/inventory`)).json();
  const existing = new Map(inventory.items.map((item) => [item.id, item.photoId]));
  for (const [index, id] of ids.entries()) {
    const picture = art[index % art.length];
    const response = await page.request.put(`${url}/api/staff/items/${id}/photo`, { headers: { origin: url }, multipart: {
      display: { name: "display.jpg", mimeType: "image/jpeg", buffer: Buffer.from(picture.display, "base64") },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: Buffer.from(picture.thumb, "base64") }, expected: existing.get(id) ?? "" } });
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
    await page.waitForSelector("img.thumb, .thumb [data-item-photo]");
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

/** Places and the Where is it? flow, as staff and then as a phone, at desktop, tablet and phone widths. */
async function locationScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const first = await signIn(browser, url, "owner.demo", SIZES.desktop);
  if (!(await first.page.request.get(`${url}/api/staff/locations`)).ok()) {
    console.log("locations: this ref has no locations, skipped");
    await first.context.close();
    return {};
  }
  const state = await first.context.storageState();
  const art = await first.page.evaluate(drawPhotos);
  const api = async (method, route, body) => {
    const response = await first.page.request.fetch(`${url}${route}`, { method, headers: { origin: url, "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok()) throw new Error(`${method} ${route} failed: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const place = async (name, parentId, directions, visibility) => (await api("POST", "/api/staff/locations", { name, parentId, directions, visibility })).id;
  const office = await place("Office", null, "Second floor, past the stairs.", "SELF_SERVICE");
  const storage = await place("Storage Area", office, "Through the door behind the front desk.", "SELF_SERVICE");
  const cabinet = await place("Cabinet 1", storage, "Grey cabinet on the left wall, next to the printer.", "SELF_SERVICE");
  const shelf = await place("Shelf 2", cabinet, "Second shelf from the top.", "SELF_SERVICE");
  const garage = await place("Garage", null, "Behind the building. Ask at the desk for the key.", "STAFF_ONLY");
  const rack = await place("Rack A", garage, null, "STAFF_ONLY");
  const plain = await place("Display Case", storage, "By the window.", "SELF_SERVICE");
  const form = new FormData();
  const picture = art[0];
  const put = (id, image) => first.page.request.put(`${url}/api/staff/locations/${id}/photo`, { headers: { origin: url }, multipart: {
    display: { name: "display.jpg", mimeType: "image/jpeg", buffer: Buffer.from(image.display, "base64") },
    thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: Buffer.from(image.thumb, "base64") }, expected: "" } });
  void form;
  await put(cabinet, picture);
  await put(storage, art[1]);
  const items = (await (await first.page.request.get(`${url}/api/staff/inventory`)).json()).items;
  const named = items.filter((item) => !item.locationId && !item.legacyLocation && item.itemType === "Consumable");
  const [onShelf, inCase, inRack, withReport] = [named[0], named[1], named[2], named[3]];
  const patchItem = async (item, locationId) => {
    const current = (await (await first.page.request.get(`${url}/api/staff/items/${item.id}`)).json()).item;
    await api("PATCH", `/api/staff/items/${item.id}`, { ...current, locationId, updatedAt: current.updatedAt });
  };
  for (const [item, where] of [[onShelf, shelf], [inCase, plain], [inRack, rack], [withReport, shelf]]) await patchItem(item, where);
  for (const extra of named.slice(4, 9)) await patchItem(extra, [cabinet, shelf, storage, plain][named.indexOf(extra) % 4]);
  await api("POST", `/api/staff/items/${withReport.id}/location-report`, { id: crypto.randomUUID(), kind: "LOCATION_WRONG", note: "Shelf 2 was empty this morning." });
  await first.context.close();

  const timings = {};
  for (const [size, viewport] of Object.entries(SIZES)) {
    const { context, page } = await resume(browser, state, viewport);
    const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(250); };
    await page.goto(`${url}/staff/locations`);
    await page.waitForSelector(".place-row");
    await settle();
    await shot(page, `locations-tree-${size}`);
    await page.goto(`${url}/staff/locations?place=${cabinet}`);
    await page.waitForSelector("dialog[open] #place-form");
    await settle();
    await shot(page, `locations-edit-${size}`);
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    await page.goto(`${url}/staff/locations?place=${plain}`);
    await page.waitForSelector("dialog[open] #place-form");
    await settle();
    await shot(page, `locations-edit-nopicture-${size}`);
    await page.goto(`${url}/staff/locations`);
    await page.waitForSelector(".place-row");
    await page.getByRole("button", { name: "New place" }).first().click();
    await page.waitForSelector("dialog[open] #place-form");
    await shot(page, `locations-create-${size}`);
    await page.goto(`${url}/staff/items`);
    await page.waitForSelector("tbody tr");
    await settle();
    await shot(page, `items-places-${size}`);
    await page.goto(`${url}/staff/items?location=${storage}`);
    await page.waitForSelector("tbody tr");
    await settle();
    await shot(page, `items-by-place-${size}`);
    await page.goto(`${url}/staff/items?view=unplaced`);
    await page.waitForSelector("tbody tr");
    await shot(page, `items-needs-place-${size}`);
    await page.goto(`${url}/staff/items?item=${onShelf.id}`);
    await page.waitForSelector("dialog[open] .tabs");
    await settle();
    await shot(page, `item-profile-place-${size}`);
    await page.getByRole("tab", { name: /Edit details/ }).click();
    await page.locator("#f-locationId").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "New place" }).click();
    await shot(page, `item-place-picker-${size}`);
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("button", { name: "Where is it?" }).click();
    await page.waitForSelector("dialog.where .where__figure img");
    await settle();
    await shot(page, `where-${size}`);
    await page.locator("dialog.where [data-zoom]").click();
    await page.waitForSelector("dialog.viewer[open] img");
    await page.waitForTimeout(400);
    await shot(page, `where-zoom-${size}`);
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog.viewer", { state: "detached" });
    await page.getByRole("button", { name: "I can’t find it" }).click();
    await shot(page, `where-report-${size}`);
    await page.getByRole("button", { name: "Send report" }).click();
    await page.waitForSelector(".where__done");
    await shot(page, `where-sent-${size}`);
    await page.locator("dialog.where").getByRole("button", { name: "Close" }).click();
    await page.goto(`${url}/staff/items?item=${inRack.id}`);
    await page.waitForSelector("dialog[open] .tabs");
    await page.getByRole("button", { name: "Where is it?" }).click();
    await page.waitForSelector("dialog.where .where__missing");
    await settle();
    await shot(page, `where-missing-picture-${size}`);
    await page.goto(`${url}/staff/items?item=${withReport.id}`);
    await page.waitForSelector("dialog[open] #reports-card");
    await settle();
    await shot(page, `item-report-${size}`);
    await context.close();
  }
  // The phone, signed out: Self-Service shows the route only for shared places.
  for (const [size, viewport] of Object.entries(SIZES)) {
    const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: viewport[2], reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${url}/self-service?do=take&item=${inCase.id}`);
    await page.waitForSelector("dialog[open] .ss-where");
    await page.waitForLoadState("networkidle");
    await shot(page, `selfservice-sheet-${size}`);
    await page.getByRole("button", { name: "Where is it?" }).click();
    await page.waitForSelector("dialog.where .where__step");
    await page.waitForTimeout(300);
    await shot(page, `selfservice-where-${size}`);
    await page.getByRole("button", { name: "Location looks wrong" }).click();
    await shot(page, `selfservice-report-${size}`);
    await page.locator("dialog.where").getByRole("button", { name: "Cancel" }).click();
    await page.locator("dialog.where").getByRole("button", { name: "Close" }).click();
    await page.goto(`${url}/self-service?do=take&item=${inRack.id}`);
    await page.waitForSelector("dialog[open] .ss-where");
    await page.getByRole("button", { name: "Where is it?" }).click();
    await page.waitForSelector("dialog.where");
    await page.waitForTimeout(300);
    await shot(page, `selfservice-where-private-${size}`);
    await context.close();
  }
  return timings;
}

/** Independent visual foundation: real app states, synthetic artwork and a deliberately unmatched demo item. */
async function catalogVisualScenes(browser, url, dir) {
  const first = await signIn(browser, url, "owner.demo", SIZES.desktop);
  await first.page.goto(`${url}/staff/items?item=ITM-0262`);
  await first.page.waitForSelector("#photo-panel");
  if (!await first.page.locator("#item-visual-control").count()) { await first.context.close(); return { skipped: "baseline has no icon controls" }; }
  const state = await first.context.storageState();
  const art = await first.page.evaluate(drawPhotos);
  const made = await first.page.request.post(`${url}/api/staff/items`, { headers: { origin: url }, data: {
    name: "Unmapped demo object", aliases: "", category: "Other", itemType: "NEEDS_REVIEW", unit: "piece", status: "ACTIVE", locationId: null,
    reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: true, notes: "", openingQuantity: 0
  } });
  if (!made.ok()) throw new Error("Could not create generic visual demo");
  const generic = (await made.json()).id;
  await seedPhotos(first.page, url, ["ITM-0262"], art);
  await first.context.close();
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  for (const [size, viewport] of Object.entries(SIZES).filter(([name]) => name !== "tablet")) {
    const { context, page } = await resume(browser, state, viewport);
    await page.goto(`${url}/staff/items?item=${generic}`);
    await page.waitForSelector("#item-visual-control");
    await shot(page, `visual-generic-${size}`);
    await page.goto(`${url}/staff/items?item=ITM-0262`);
    const controls = page.locator("#item-visual-control");
    await controls.waitFor();
    await controls.getByRole("button", { name: "System Icon", exact: true }).click();
    await page.waitForSelector("#photo-panel [data-tile] .item-icon", { state: "visible" });
    await shot(page, `visual-icon-profile-${size}`);
    await controls.getByRole("button", { name: "Choose another icon" }).click();
    await page.getByRole("searchbox", { name: "Find a system icon" }).fill("cleaning");
    await shot(page, `visual-picker-${size}`);
    await controls.getByRole("button", { name: "Choose another icon" }).click();
    // Dark mode belongs to Self-Service; staff pages intentionally have no theme switch.
    const phoneCatalog = await (await page.request.get(`${url}/api/self-service/catalog`)).json();
    const offered = phoneCatalog.items[0];
    if (offered) {
      await page.route("**/api/public/media/*/thumb", (route) => route.abort());
      await page.goto(`${url}/self-service?do=${offered.action.toLowerCase()}&item=${offered.id}`);
      await page.waitForSelector("dialog[open] .ss-item-photo .item-icon", { state: "visible" });
      await page.evaluate(() => { document.body.dataset.theme = "dark"; });
      await shot(page, `visual-selfservice-dark-${size}`);
      await page.goto(`${url}/staff/items?item=ITM-0262`);
      await controls.waitFor();
    }
    let releaseImage;
    const blocked = new Promise((resolve) => { releaseImage = resolve; });
    await page.route("**/api/staff/media/*/thumb", async (route) => { await blocked; await route.abort(); });
    await controls.getByRole("button", { name: "Real Photo", exact: true }).click();
    await page.waitForSelector("#photo-panel [data-item-photo]");
    await shot(page, `visual-photo-loading-${size}`);
    releaseImage();
    await page.waitForFunction(() => document.querySelectorAll("#photo-panel [data-item-photo]").length === 0);
    await shot(page, `visual-photo-error-${size}`);
    await context.setOffline(true);
    await shot(page, `visual-offline-fallback-${size}`);
    await context.close();
  }
  return { genericItem: generic, states: "icon, picker, dark, loading, error, offline; desktop and phone" };
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

/* ---------- Self-Service 2.0 (V1.9), a public phone, no sign-in ---------- */

/** A stand-in camera photo, drawn here: a table-like shape on a floor, so the preview has something to show. */
const drawCameraPhoto = async (page) => page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 720; canvas.height = 960;
  const g = canvas.getContext("2d");
  const wall = g.createLinearGradient(0, 0, 0, 960);
  wall.addColorStop(0, "#d9d2c3"); wall.addColorStop(0.6, "#bdb4a1"); wall.addColorStop(0.6, "#8a7b66"); wall.addColorStop(1, "#6f6252");
  g.fillStyle = wall; g.fillRect(0, 0, 720, 960);
  g.fillStyle = "#3b2f25"; g.fillRect(150, 520, 420, 40);
  g.fillRect(180, 560, 24, 200); g.fillRect(516, 560, 24, 200);
  g.fillStyle = "#7a1419"; g.fillRect(250, 430, 220, 90);
  g.fillStyle = "#e8c9a0"; g.beginPath(); g.arc(360, 250, 90, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#2c3e50"; g.fillRect(270, 340, 180, 150);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], "photo.jpg", { type: "image/jpeg" }));
  const input = document.querySelector("#ss-photo");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});

async function selfServiceScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const probe = await browser.newContext();
  const catalog = await (await probe.request.get(`${url}/api/self-service/catalog`)).json();
  await probe.close();
  const withAction = (action) => catalog.items.find((item) => item.action === action);
  const borrow = withAction("BORROW"), take = withAction("TAKE"), use = withAction("USE");
  if (!borrow || !take) { console.log("self-service-v19: this ref's catalog has no borrow and take items, skipped"); return {}; }
  const timings = {};
  const sizes = { ...SIZES, narrow: [320, 640, 2] };
  // A ref from before this slice has no item page: its home and list are captured as the "before" and the rest is skipped.
  const older = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const olderPage = await older.newPage();
  await olderPage.goto(`${url}/self-service`);
  await olderPage.waitForLoadState("networkidle");
  const hasItemPages = await olderPage.locator(".ss-card").count();
  if (!hasItemPages) {
    await shot(olderPage, "ss-home-phone");
    await olderPage.goto(`${url}/self-service?do=get`);
    await olderPage.waitForLoadState("networkidle");
    await shot(olderPage, "ss-list-phone");
    await older.close();
    console.log("self-service-v19: this ref has no item pages, captured its home and list only");
    return {};
  }
  await older.close();
  const open = async (viewport, extra = {}) => {
    const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: viewport[2], reducedMotion: "reduce", ...extra });
    const page = await context.newPage();
    return { context, page };
  };
  for (const [size, viewport] of Object.entries(sizes)) {
    const { context, page } = await open(viewport);
    // Sync is held back so a confirmed record waits on the phone, which is what the receipt and My activity then show.
    await page.route("**/api/self-service/sync", (route) => route.abort());
    let start = Date.now();
    await page.goto(`${url}/self-service`);
    await page.waitForSelector(".ss-card");
    await page.waitForLoadState("networkidle");
    timings[size] = { homeMs: Date.now() - start, homeCards: await page.locator(".ss-card").count() };
    await shot(page, `ss-home-${size}`);
    // The same home on the light theme.
    await page.getByRole("button", { name: /theme/ }).click();
    await page.waitForTimeout(400);
    await shot(page, `ss-home-light-${size}`);
    await page.getByRole("button", { name: /theme/ }).click();
    await page.waitForTimeout(400);
    // Search, and the group list.
    await page.getByRole("searchbox", { name: "Search everything" }).fill(borrow.name.split(" ")[0]);
    await shot(page, `ss-search-${size}`);
    await page.getByRole("searchbox", { name: "Search everything" }).fill("");
    const seeAll = page.getByRole("link", { name: /^See all/ }).first();
    if (await seeAll.count()) { await seeAll.click(); await page.waitForSelector(".ss-row"); await shot(page, `ss-group-${size}`); }
    // The item pages: one to borrow, one to take.
    await page.goto(`${url}/self-service?do=item&item=${borrow.id}`);
    await page.waitForSelector(".ss-item");
    await page.waitForLoadState("networkidle");
    await shot(page, `ss-item-borrow-${size}`);
    await page.goto(`${url}/self-service?do=item&item=${take.id}`);
    await page.waitForSelector(".ss-item");
    await shot(page, `ss-item-take-${size}`);
    // Where is it?
    const where = page.getByRole("button", { name: "Where is it?" });
    if (await where.count()) { await where.click(); await page.waitForSelector("dialog[open]"); await shot(page, `ss-where-${size}`); await page.keyboard.press("Escape"); }
    // Borrow: who you are, the first problem in words, the photo, the check, the receipt.
    await page.goto(`${url}/self-service?do=borrow&item=${borrow.id}`);
    await page.waitForSelector("dialog[open] form");
    await page.waitForLoadState("networkidle");
    await shot(page, `ss-borrow-form-${size}`);
    const sheet = page.getByRole("dialog").first();
    await sheet.getByRole("button", { name: "Review and borrow" }).click();
    await shot(page, `ss-borrow-problem-${size}`);
    await sheet.getByLabel("Your full name").fill("Maria Santos");
    await sheet.getByLabel("Student ID number").fill("20-1234-567");
    await drawCameraPhoto(page);
    await page.waitForSelector("img[alt='Photo to attach']");
    await page.locator(".ss-photo, #ss-photo").first().scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, `ss-borrow-photo-${size}`);
    await sheet.getByRole("button", { name: "Review and borrow" }).click();
    await page.waitForSelector(".ss-summary");
    await shot(page, `ss-confirm-${size}`);
    await sheet.getByRole("button", { name: "Confirm borrow" }).click();
    await page.waitForSelector(".ss-receipt__ref");
    await shot(page, `ss-receipt-${size}`);
    await page.getByRole("button", { name: "Done" }).click();
    // My activity: on loan, waiting, and the person remembered on this phone.
    await page.getByRole("link", { name: /^My activity/ }).click();
    await page.waitForSelector(".ss-loan");
    await shot(page, `ss-activity-${size}`);
    // Return it.
    await page.locator(".ss-loan").first().getByRole("link", { name: /^Return/ }).click();
    await page.waitForSelector("dialog[open] form");
    await drawCameraPhoto(page);
    await page.waitForSelector("img[alt='Photo to attach']");
    await shot(page, `ss-return-form-${size}`);
    await page.keyboard.press("Escape");
    // Take and use, now that the phone knows who this is.
    await page.goto(`${url}/self-service?do=take&item=${take.id}`);
    await page.waitForSelector("dialog[open] form");
    await shot(page, `ss-take-form-${size}`);
    if (use) {
      await page.goto(`${url}/self-service?do=use&item=${use.id}`);
      await page.waitForSelector("dialog[open] form");
      await shot(page, `ss-use-form-${size}`);
    }
    // The help tip, opened by keyboard.
    await page.goto(`${url}/self-service?do=borrow&item=${borrow.id}`);
    await page.waitForSelector("dialog[open] .help__trigger", { state: "attached" });
    await page.locator("dialog[open] .help__trigger:visible").first().focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForSelector(".help__note");
    await shot(page, `ss-help-${size}`);
    await context.close();
  }

  // Offline: a phone that saved the catalog keeps browsing and recording; what waits is said on every page.
  {
    const { context, page } = await open(SIZES.phone, { serviceWorkers: "allow" });
    await page.goto(`${url}/self-service`);
    await page.waitForSelector(".ss-card");
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.goto(`${url}/self-service?do=item&item=${take.id}`).catch(() => {});
    await page.waitForSelector(".ss-item", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    timings.offlineHeadingColour = await page.evaluate(() => getComputedStyle(document.querySelector(".ss-item h1") ?? document.body).color + " on " + getComputedStyle(document.body).backgroundColor);
    await shot(page, "ss-offline-item-phone");
    await context.close();
  }

  // 600 items: the home draws the same small page, and a group opens as a light list.
  {
    const items = Array.from({ length: 600 }, (_, index) => ({ id: `ITM-${String(index + 1).padStart(4, "0")}`, name: `${["Chair", "Marker", "Biscuit"][index % 3]} ${index + 1}`, aliases: null, category: ["FURNITURE", "SCHOOL SUPPLIES", "PANTRY"][index % 3], unit: "piece", area: index % 3 === 2 ? "Pantry" : "Inventory", action: index % 3 === 0 ? "BORROW" : "TAKE", available: 10, location: "Storage › Shelf B", locationId: null, audience: null }));
    const { context, page } = await open(SIZES.phone);
    await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 9, items, places: [] }) }));
    let start = Date.now();
    await page.goto(`${url}/self-service`);
    await page.waitForSelector(".ss-card");
    timings.catalog600 = { homeMs: Date.now() - start, homeCards: await page.locator(".ss-card").count() };
    await shot(page, "ss-600-home-phone");
    start = Date.now();
    await page.getByRole("link", { name: /^See all/ }).first().click();
    await page.waitForSelector(".ss-row");
    timings.catalog600.groupMs = Date.now() - start;
    timings.catalog600.groupRows = await page.locator(".ss-row").count();
    await shot(page, "ss-600-group-phone");
    await context.close();
  }
  return timings;
}

/* ---------- Staff Directory (V1.3), fictional people only ---------- */

/** Fictional people: a large Department of Logistics, officers, partial profiles (a surname only, no position), one inactive. */
const SAMPLE_PEOPLE = [
  ["Ana Marie Santos", "DoL", "Director for Logistics", true, "20-1111-222"], ["Sam Cruz", "DoL", "Inventory committee head", false, null], ["Ben Lim", "DoL", "Materials committee", false, null], ["Carla Reyes", "DoL", "Inventory committee", false, null],
  ["Dino Garcia", "DoL", "Food committee", false, null], ["Ella Tan", "DoL", "Materials committee", false, null], ["Felix Ramos", "DoL", null, false, null], ["Gina Cruz", "DoL", "Inventory committee", false, null],
  ["Hugo Navarro", "DoL", "Materials committee", false, null], ["Iris Bautista", "DoL", null, false, null], ["Jun Mercado", "DoL", "Food committee", false, null], ["Kara Villanueva", "DoL", "Materials committee", false, null],
  ["Leo Aquino", "DoL", "Inventory committee", false, null], ["Mia Soriano", "DoL", "Materials committee", false, null], ["Nico Pascual", "DoL", null, false, null],
  ["Olivia Domingo", "OfP", "President", true, null], ["Paolo Rivera", "OVP", "Vice President", true, null], ["Quinn Morales", "SEC", "Secretary-General", true, null],
  ["Rosa Velasco", "DoF", "Director for Finance", true, null], ["Sam Ilagan", "DCES", "Director for Community Extension Services", true, null], ["Tess Manalo", "DPC", "Director for Public Communications", true, null],
  ["Ugo Salazar", "DHR", "Director for Human Resources", true, null], ["Vera Ocampo", "DBR", "Director for Business Relations", true, null], ["Wes Fajardo", "DBR", null, false, null]
];
/** Sample scans for the import, as the Drive archive lays them out, with one of each problem the preflight reports. */
const SAMPLE_SCANS = [
  ["[DEM] Official ID", "Alcantara", "DEM", ["front", "back"]], ["[DEM] Official ID", "Belmonte", "DEM", ["front", "back"]], ["[DEM] Official ID", "Concepcion", "DEM", ["front", "back"]],
  ["OFFICERS", "Delos Reyes", "DEM", ["front", "back"]], ["[DoL] Official ID", "Santos", "DoL", ["front", "back"]], ["[DoL] Official ID", "Estrada", "DoL", ["front"]],
  ["[DoL] Official ID", "Fernandez", "DoL", ["back"]], ["[DHR] Official ID", "Guevarra", "DHX", ["front", "back"]], ["[DHR] Official ID", "Hidalgo", "DHR", ["front", "back"]]
];
const sq = (value) => value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;

/** Loans and phone takes for two fictional people, written as the app writes them, so Usage and Loans have something to read. */
function directoryRecordsSql() {
  const rows = [];
  const at = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const items = ["(SELECT id FROM items ORDER BY id LIMIT 1 OFFSET 3)", "(SELECT id FROM items ORDER BY id LIMIT 1 OFFSET 40)", "(SELECT id FROM items ORDER BY id LIMIT 1 OFFSET 120)", "(SELECT id FROM items ORDER BY id LIMIT 1 OFFSET 200)"];
  const loan = (n, name, studentId, item, days, open) => {
    rows.push(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, related_entity_type, related_entity_id, actor_user_id, status)
      SELECT 'MOV-EV${n}', ${sq(at(days))}, 'LOAN_OUT', 'OUT', id, 2, unit, -2, 'LOAN', 'LN-EV${n}', (SELECT id FROM staff_accounts WHERE username = 'staff.demo'), 'POSTED' FROM items WHERE id = ${item};`);
    rows.push(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, reason, photo_key, movement_id, created_at, created_by, status, closed_at, closed_by)
      SELECT 'LN-EV${n}', id, 2, ${studentId ? "'INDIVIDUAL'" : "'USC'"}, ${sq(name)}, ${sq(studentId)}, ${studentId ? "NULL" : "'Stage setup for the general assembly'"}, 'loans/none', 'MOV-EV${n}', ${sq(at(days))},
        (SELECT id FROM staff_accounts WHERE username = 'staff.demo'), ${open ? "'OUT', NULL, NULL" : `'RETURNED', ${sq(at(days - 2))}, (SELECT id FROM staff_accounts WHERE username = 'staff.demo')`} FROM items WHERE id = ${item};`);
  };
  const take = (n, name, studentId, item, quantity, days) => {
    const event = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    rows.push(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, purpose, device_time, sent_at, occurred_at, received_at, movement_id, applied)
      VALUES('${event}', 'evidence', ${n}, 'TAKE', ${item}, ${quantity}, ${sq(name)}, ${sq(studentId)}, 'INDIVIDUAL', ${sq(at(days))}, ${sq(at(days))}, ${sq(at(days))}, ${sq(at(days))}, 'MOV-EV${n}', 1);`);
    rows.push(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, related_entity_type, related_entity_id, actor_user_id, reason, status)
      SELECT 'MOV-EV${n}', ${sq(at(days))}, 'STOCK_OUT', 'OUT', id, ${quantity}, unit, -${quantity}, 'SELF_SERVICE', '${event}', 'SELF_SERVICE', 'CONSUMED', 'POSTED' FROM items WHERE id = ${item};`);
  };
  loan(1, "Ana Marie Santos", "20-1111-222", items[0], 3, true);
  loan(2, "Ana Marie Santos", null, items[1], 40, false);
  loan(3, "Ana Marie Santos", "20-1111-222", items[2], 90, false);
  loan(4, "Ben Lim", null, items[1], 12, true);
  for (let n = 5; n < 13; n++) take(n, "Ana Marie Santos", "20-1111-222", items[n % 4], 1 + (n % 3), n * 9);
  return rows.join("\n");
}

/** Obviously fake ID cards: "SAMPLE" everywhere, a plain silhouette (no face), invented numbers. PNG, as the archive's scans are. */
function drawIdCards(people) {
  const card = (name, department, side) => {
    const [width, height] = [1600, 1010];
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d");
    c.fillStyle = "#f7f3ea";
    c.fillRect(0, 0, width, height);
    c.fillStyle = "#7a1419";
    c.fillRect(0, 0, width, 170);
    c.fillStyle = "#e8b93c";
    c.fillRect(0, 170, width, 14);
    c.fillStyle = "#fff";
    c.font = "600 54px sans-serif";
    c.fillText("SAMPLE STUDENT COUNCIL", 60, 82);
    c.font = "32px sans-serif";
    c.fillText("Not a real card · for screenshots only", 60, 134);
    if (side === "front") {
      c.fillStyle = "#d9d2c5";
      c.fillRect(70, 250, 380, 470);
      c.fillStyle = "#b8ad9b";
      c.beginPath(); c.arc(260, 420, 105, 0, 7); c.fill();
      c.beginPath(); c.ellipse(260, 690, 170, 140, 0, Math.PI, 0); c.fill();
      c.fillStyle = "#1c1917";
      c.font = "600 76px sans-serif";
      c.fillText(name.toUpperCase(), 510, 340);
      c.font = "40px sans-serif";
      c.fillStyle = "#57514a";
      c.fillText(department, 510, 410);
      c.fillText("ID NO.  SAMPLE-0000-000", 510, 480);
      c.fillText("Valid  AY 2026–2027 (sample)", 510, 540);
    } else {
      c.fillStyle = "#2b2622";
      c.fillRect(0, 240, width, 150);
      c.fillStyle = "#fff";
      c.fillRect(80, 450, 820, 120);
      c.fillStyle = "#57514a";
      c.font = "34px sans-serif";
      c.fillText("Signature (sample)", 90, 610);
      c.fillText("If found, this sample card belongs to no one.", 80, 700);
      c.fillText("It was drawn for Logistics Hub screenshots.", 80, 750);
      for (let x = 1000; x < 1520; x += 14) { c.fillStyle = "#1c1917"; c.fillRect(x, 460, (x * 7) % 3 + 4, 220); }
    }
    c.save();
    c.translate(width / 2, height / 2 + 80);
    c.rotate(-0.32);
    c.fillStyle = "rgb(122 20 25 / 13%)";
    c.font = "700 220px sans-serif";
    c.textAlign = "center";
    c.fillText("SAMPLE", 0, 60);
    c.restore();
    return canvas.toDataURL("image/png").split(",")[1];
  };
  return people.map(([name, department]) => ({ front: card(name, department, "front"), back: card(name, department, "back") }));
}

async function directoryScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const first = await signIn(browser, url, "owner.demo", SIZES.desktop);
  if ((await first.page.request.get(`${url}/api/staff/admin/directory`)).status() !== 200) {
    console.log("staff-directory: this ref has no Staff Directory, skipped");
    await first.context.close();
    return {};
  }
  const state = await first.context.storageState();
  const post = (path, data) => first.page.request.fetch(`${url}${path}`, { method: "POST", headers: { origin: url }, data });
  const ids = {};
  for (const [name, department, position, officer, studentId] of SAMPLE_PEOPLE) {
    const response = await post("/api/staff/admin/directory", { name, department, position, officer, studentId });
    ids[name] = (await response.json()).id;
  }
  const accounts = (await (await first.page.request.get(`${url}/api/staff/admin/directory/accounts`)).json()).accounts;
  await first.page.request.fetch(`${url}/api/staff/admin/directory/${ids["Sam Cruz"]}/account`, { method: "PUT", headers: { origin: url }, data: { accountId: accounts.find((account) => account.username === "staff.demo").id } });
  const wes = await (await first.page.request.get(`${url}/api/staff/admin/directory/${ids["Wes Fajardo"]}`)).json();
  await first.page.request.fetch(`${url}/api/staff/admin/directory/${ids["Wes Fajardo"]}`, { method: "PATCH", headers: { origin: url }, data: { active: false, updatedAt: wes.person.updatedAt } });

  // The sample archive, written to a throwaway folder only.
  const archive = path.join(root, ".wrangler", "evidence-ids", "Official IDs");
  fs.rmSync(path.dirname(archive), { recursive: true, force: true });
  const art = await first.page.evaluate(drawIdCards, SAMPLE_SCANS.map(([folder, name, code]) => [name, code === "DEM" ? "Department of Events Management" : code === "DoL" ? "Department of Logistics" : "Department of Human Resources"]));
  for (const [index, [folder, name, code, sides]] of SAMPLE_SCANS.entries()) {
    fs.mkdirSync(path.join(archive, folder), { recursive: true });
    for (const side of sides) fs.writeFileSync(path.join(archive, folder, `${name.replace(" ", "_")}_${side === "front" ? "Front" : "Back"}_${code}.png`), Buffer.from(art[index][side], "base64"));
  }
  fs.writeFileSync(path.join(archive, "desktop.ini"), "");
  await first.context.close();
  const timings = {};

  for (const [size, viewport] of Object.entries(SIZES)) {
    const { context, page } = await resume(browser, state, viewport);
    if (size === "desktop") {
      // The owner's import: the preflight report, then the result.
      await page.goto(`${url}/staff/admin/directory`);
      await page.waitForSelector(".dir-card, .person-row");
      await page.getByRole("button", { name: "Import ID scans" }).click();
      await page.locator("#import-folder").setInputFiles(archive);
      await page.waitForSelector("[data-run]");
      await page.locator("dialog[open] .sheet__body").evaluate((body) => body.scrollTo(0, 0));
      await shot(page, "directory-import-preflight-desktop");
      await page.locator("[data-run]").scrollIntoViewIfNeeded();
      await shot(page, "directory-import-ready-desktop");
      const start = Date.now();
      await page.locator("[data-run]").click();
      await page.waitForSelector(".import [data-close]");
      timings.importAllPairsMs = Date.now() - start;
      await shot(page, "directory-import-done-desktop");
      await page.getByRole("button", { name: "Done" }).click();
      const people = (await (await page.request.get(`${url}/api/staff/admin/directory`)).json()).people;
      ids.Belmonte = people.find((person) => person.name === "Belmonte").id;
      const belmonte = people.find((person) => person.name === "Belmonte");
      await page.request.fetch(`${url}/api/staff/admin/directory/${belmonte.id}`, { method: "PATCH", headers: { origin: url }, data: { name: "Bea Belmonte", position: "Director for Events Management", officer: true, updatedAt: belmonte.updatedAt } });
      ids.Hidalgo = people.find((person) => person.name === "Hidalgo").id;
    }
    await page.goto(`${url}/staff/admin/directory`);
    await page.waitForSelector(".dir-card, .person-row");
    await shot(page, `directory-list-${size}`);
    await page.goto(`${url}/staff/admin/directory?dept=DoL`);
    await page.waitForSelector(".dir-card, .person-row");
    await shot(page, `directory-department-${size}`);
    await page.goto(`${url}/staff/admin/directory?q=director`);
    await page.waitForSelector(".dir-card, .person-row");
    await shot(page, `directory-search-${size}`);
    // A card on the wall (its uploaded front), pressed: it opens on the profile, both sides of the ID, and turns to the
    // details (the wall is new in this branch; a base before it lists people in rows).
    await page.goto(`${url}/staff/admin/directory?dept=DEM`);
    await page.waitForSelector(".dir-card, .person-row");
    if (await page.locator(".dir-card").count()) {
    await page.waitForFunction(() => [...document.querySelectorAll("img[data-thumb]")].every((image) => image.complete));
    await shot(page, `directory-wall-ids-${size}`);
    await page.locator(`.dir-card[data-person="${ids.Belmonte}"]`).click();
    await page.waitForSelector("dialog.id-viewer[open]");
    // A base whose card opens on the details and turns to Front and Back has nothing new to show here.
    if (await page.locator('dialog.id-viewer [data-view="profile"]').count()) {
      await page.waitForSelector("dialog.id-viewer :is(.id-card__scan, .id-card__pair):not(.is-loading) img[data-face=front]");
      await page.waitForTimeout(150);
      await shot(page, `directory-card-profile-${size}`);
      // This branch's ID turns over; a base before it showed both sides at once.
      if (await page.locator("dialog.id-viewer [data-flip]").count()) {
        await page.keyboard.press("f");
        await page.waitForSelector("dialog.id-viewer .id-card__face:not([aria-hidden=true]) img[data-face=back]");
        await page.waitForTimeout(150);
        await shot(page, `directory-card-turned-${size}`);
      }
      await page.keyboard.press("d");
      await page.waitForSelector("dialog.id-viewer .person-card--details [data-out] :is(ul, span)");
      await page.waitForTimeout(150);
      await shot(page, `directory-card-details-${size}`);
    }
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog.id-viewer", { state: "detached" });
    }
    await page.goto(`${url}/staff/admin/directory?person=${ids.Belmonte}`);
    await page.waitForSelector(".summary-list");
    await shot(page, `directory-profile-${size}`);
    await page.goto(`${url}/staff/admin/directory?person=${ids.Belmonte}&tab=id`);
    await page.waitForSelector(".id-tile img[src]");
    await shot(page, `directory-id-${size}`);
    // The evidence runs with reduced motion for steady pictures; the 3D card is the motion, so it is shown with motion on.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    if (size === "desktop") {
      // A tile leans toward the mouse under a glare and a light foil.
      const tile = await page.locator("[data-open=front]").boundingBox();
      await page.mouse.move(tile.x + tile.width * 0.85, tile.y + tile.height * 0.2, { steps: 6 });
      await page.waitForTimeout(350);
      await shot(page, `directory-id-tile-hover-${size}`);
    }
    const flying = () => document.getAnimations().some((animation) => animation.effect?.target?.matches?.("[data-flight]"));
    let start = Date.now();
    await page.locator("[data-open=front]").click();
    await page.waitForSelector("dialog.id-viewer[open] img[data-face=front][src]");
    // This branch's card turns between Profile and Details; a base before it, between Front and Back.
    const views = await page.locator('dialog.id-viewer [data-view="details"]').count() ? { turn: "d", back: "p", turned: "details" } : { turn: "b", back: "f", turned: "back" };
    timings[`viewerOpenMs_${size}`] = Date.now() - start;
    // The card's flight out of its tile, frozen at fixed moments (every running animation paused together, so frames are exact).
    await page.waitForFunction(flying);
    for (const at of [120, 240, 400]) {
      await page.evaluate((time) => { for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; } }, at);
      await shot(page, `directory-viewer-flight-${at}-${size}`);
    }
    await page.evaluate(() => { for (const animation of document.getAnimations()) animation.play(); });
    await page.waitForFunction(() => !document.getAnimations().some((animation) => animation.effect?.target?.matches?.("[data-flight]")));
    timings[`viewerLandedMs_${size}`] = Date.now() - start;
    // The sweep of light passes, and the card rests flat and unlit.
    await page.waitForTimeout(2400);
    await shot(page, `directory-viewer-front-${size}`);
    const card = await page.locator("[data-flight]").boundingBox();
    await page.mouse.move(card.x + card.width * 0.85, card.y + card.height * 0.8, { steps: 8 });
    await page.waitForTimeout(700);
    await shot(page, `directory-viewer-tilt-${size}`);
    await page.mouse.move(card.x + card.width / 2, card.y - 24);
    start = Date.now();
    await page.keyboard.press(views.turn);
    // A screenshot takes 100-200 ms itself, so this lands mid-turn.
    await page.waitForTimeout(40);
    await shot(page, `directory-viewer-turning-${size}`);
    // Settled: on its back and level within about a degree.
    await page.waitForFunction(() => { const pose = new DOMMatrixReadOnly(getComputedStyle(document.querySelector("[data-card]")).transform); return Math.abs(pose.m11 + 1) < 0.0002 && Math.abs(pose.m13) < 0.02 && Math.abs(pose.m23) < 0.02; }, null, { timeout: 10000 });
    timings[`turnSettledMs_${size}`] = Date.now() - start;
    await shot(page, `directory-viewer-${views.turned}-${size}`);
    await page.keyboard.press(views.back);
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await page.waitForTimeout(300);
    await shot(page, `directory-viewer-zoomed-${size}`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog.id-viewer"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${url}/staff/admin/directory?person=${ids["Ana Marie Santos"]}&tab=usage`);
    await page.waitForSelector("[data-usage] .stat-strip, [data-usage] .empty");
    await shot(page, `directory-usage-${size}`);
    await page.goto(`${url}/staff/admin/directory?person=${ids["Ana Marie Santos"]}&tab=loans`);
    await page.waitForSelector(".loan-list, #panel-loans .muted");
    await shot(page, `directory-loans-${size}`);
    await page.goto(`${url}/staff/admin/directory?person=${ids["Sam Cruz"]}&tab=activity`);
    await page.waitForSelector("[data-events] .history__item, [data-events] .history__empty:not(:empty)");
    await page.waitForLoadState("networkidle");
    await shot(page, `directory-activity-${size}`);
    await page.goto(`${url}/staff/admin/directory?person=${ids.Hidalgo}`);
    await page.waitForSelector(".summary-list");
    await shot(page, `directory-partial-profile-${size}`);
    await page.goto(`${url}/staff/admin/directory?person=${ids["Felix Ramos"]}&tab=id`);
    await page.waitForSelector("#panel-id .empty");
    await shot(page, `directory-missing-id-${size}`);
    await context.close();
  }
  fs.rmSync(path.dirname(archive), { recursive: true, force: true });
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

/** V1.5: a realistic cataloguing session on one shelf, driven through the real screens against the real Worker and D1. */
async function catalogueScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const first = await signIn(browser, url, "owner.demo", SIZES.desktop);
  if ((await first.page.request.get(`${url}/api/staff/catalogue`)).status() === 404) {
    console.log("catalogue: this ref has no Catalogue, skipped");
    await first.context.close();
    return {};
  }
  const state = await first.context.storageState();
  const art = await first.page.evaluate(drawPhotos);
  const api = async (method, route, body) => {
    const response = await first.page.request.fetch(`${url}${route}`, { method, headers: { origin: url, "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok()) throw new Error(`${method} ${route} failed: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const office = (await api("POST", "/api/staff/locations", { name: "Office", parentId: null })).id;
  const cabinet = (await api("POST", "/api/staff/locations", { name: "Cabinet 1", parentId: office })).id;
  const shelf = (await api("POST", "/api/staff/locations", { name: "Shelf 2", parentId: cabinet })).id;
  const items = (await (await first.page.request.get(`${url}/api/staff/inventory`)).json()).items;
  const consumable = items.find((item) => item.itemType === "Consumable" && /\s/.test(item.name) && item.status === "ACTIVE");
  const loanable = items.find((item) => item.itemType === "Loanable" && item.status === "ACTIVE");
  const picture = path.join(fs.mkdtempSync(path.join(root, ".wrangler", "evidence-art-")), "shelf.jpg");
  fs.writeFileSync(picture, Buffer.from(art[3].display, "base64"));
  // A long morning already behind: 36 items of every kind on this shelf, made through the real endpoint.
  const started = await api("POST", "/api/staff/catalogue/sessions", { locationId: shelf });
  const kinds = [["BORROW", "Projector", "EQUIPMENT", "piece"], ["CONSUME", "Marker", "OFFICE SUPPLIES", "piece"], ["GRADUAL", "Bond paper", "PAPER", "ream"], ["REVIEW_LATER", "Unlabelled box", "", ""]];
  for (let index = 0; index < 36; index++) {
    const [behaviour, base, category, unit] = kinds[index % 4];
    await api("POST", `/api/staff/catalogue/sessions/${started.id}/captures`, { id: crypto.randomUUID(), behaviour, name: `${base} ${index + 1}`, category, unit, quantity: 1 + (index % 6), locationId: shelf });
  }
  await first.context.close();

  const timings = {};
  for (const [size, viewport] of Object.entries(SIZES)) {
    const { context, page } = await resume(browser, state, viewport);
    const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(250); };
    await page.goto(`${url}/staff/catalogue`);
    await page.getByRole("heading", { name: "Your session is open" }).waitFor();
    await settle();
    await shot(page, `catalogue-start-${size}`);
    await page.goto(`${url}/staff/catalogue?session=${started.id}`);
    await page.waitForSelector("#cat-form");
    await settle();
    await shot(page, `catalogue-session-${size}`);
    const name = page.getByLabel("Name", { exact: true });
    // A suggestion, explained, nothing chosen yet.
    await name.fill(consumable.name.split(/\s+/).slice(0, 2).join(" "));
    await page.waitForTimeout(200);
    await shot(page, `catalogue-suggestion-${size}`);
    await page.getByRole("button", { name: "Use these" }).click();
    await page.locator("#cat-file").setInputFiles(picture);
    await page.waitForSelector("#cat-photo img");
    await page.getByRole("button", { name: "One more" }).click();
    await shot(page, `catalogue-photo-${size}`);
    // The possible-match card, shown by the first press of Save.
    await name.fill(loanable.name);
    await page.locator(".cat-choice", { hasText: "Borrow" }).first().click();
    await page.getByLabel("Category").fill(loanable.category);
    await page.getByLabel("Counted in").fill(loanable.unit);
    await page.getByRole("button", { name: /^Save & next/ }).click();
    await page.waitForSelector(".cat-dup__card.is-armed");
    await shot(page, `catalogue-duplicate-${size}`);
    // Start the next item from a clean form (the photo above would otherwise look like the one just saved elsewhere).
    await page.reload();
    await page.waitForSelector("#cat-form");
    // Not sure: kept and counted, the rest can wait.
    await name.fill(`Grey cable bag ${size}`);
    await page.locator(".cat-choice", { hasText: "Not sure" }).click();
    await page.getByLabel("Category").fill("");
    await page.getByLabel("Counted in").fill("");
    await shot(page, `catalogue-reviewlater-${size}`);
    await page.getByRole("button", { name: /^Save & next/ }).click();
    await page.getByText("All saved").waitFor();
    // A save that fails offline, then goes through.
    await context.setOffline(true);
    await name.fill(`Label printer ${size}`);
    await page.locator(".cat-choice", { hasText: "Borrow" }).first().click();
    await page.getByLabel("Category").fill("EQUIPMENT");
    await page.getByLabel("Counted in").fill("piece");
    await page.getByRole("button", { name: /^Save & next/ }).click();
    await page.getByText("Not saved yet").first().waitFor();
    await shot(page, `catalogue-unsaved-${size}`);
    await page.locator("#cat-list").scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector("#cat-recent-title").scrollIntoView());
    await shot(page, `catalogue-unsaved-list-${size}`);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByText("All saved").waitFor();
    await settle();
    await page.evaluate(() => document.querySelector("#cat-recent-title").scrollIntoView());
    await shot(page, `catalogue-retried-${size}`);
    await context.close();
  }
  // Select mode in Items, and the dialog that shows what a change touches.
  for (const [size, viewport] of Object.entries(SIZES)) {
    const { context, page } = await resume(browser, state, viewport);
    await page.goto(`${url}/staff/items`);
    await page.waitForSelector("tbody tr");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const boxes = page.locator(".select-box[data-select]");
    for (let index = 0; index < 5; index++) await boxes.nth(index).check();
    await page.waitForTimeout(200);
    await shot(page, `catalogue-select-${size}`);
    await page.getByRole("button", { name: "Move to…" }).click();
    await page.getByLabel("Move them to").selectOption(shelf);
    await page.waitForTimeout(250);
    await shot(page, `catalogue-bulk-${size}`);
    await context.close();
  }
  // Finishing, as a person sees it.
  const { context, page } = await resume(browser, state, SIZES.phone);
  await page.goto(`${url}/staff/catalogue?session=${started.id}`);
  await page.waitForSelector("#cat-form");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("heading", { name: "Cataloguing finished" }).waitFor();
  await page.waitForFunction(() => document.querySelector("#rev-go") && !document.querySelector("#rev-go").hidden);
  await shot(page, "catalogue-finished-phone");
  await context.close();
  fs.rmSync(path.dirname(picture), { recursive: true, force: true });
  return timings;
}

/**
 * V1.6 Catalog PWA on the production build with its service worker: the Catalogue's "Offline cataloguing on this device" card off,
 * getting ready and ready; install steps on an Android phone, an iPhone (Safari tab) and a computer; the Catalogue reopened offline;
 * an offline session with items not saved yet; finishing offline; a signed-out device on its lease; a device without offline access;
 * and everything sent once the connection is back. Devices are Chromium with each device's screen, touch and user agent.
 */
async function catalogPwaScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const first = await signIn(browser, url, "staff.demo", SIZES.desktop);
  if ((await first.page.request.get(`${url}/api/staff/catalogue/snapshot`)).status() === 404) {
    console.log("catalog-pwa: this ref has no offline Catalogue, skipped");
    await first.context.close();
    return {};
  }
  const state = await first.context.storageState();
  const art = await first.page.evaluate(drawPhotos);
  const post = async (route, body) => (await first.page.request.post(`${url}${route}`, { headers: { origin: url }, data: body })).json();
  const store = (await post("/api/staff/locations", { name: "Store room", parentId: null })).id;
  const shelf = (await post("/api/staff/locations", { name: "Shelf B", parentId: store })).id;
  await first.context.close();
  // One picture per device: the same one twice would rightly be flagged as looking like the item already saved with it.
  const folder = fs.mkdtempSync(path.join(root, ".wrangler", "evidence-art-"));
  const pictures = [2, 4].map((index) => { const file = path.join(folder, `shelf-${index}.jpg`); fs.writeFileSync(file, Buffer.from(art[index].display, "base64")); return file; });
  const { defaultBrowserType: _android, ...pixel } = devices["Pixel 7"];
  const { defaultBrowserType: _tablet, ...tablet } = devices["Galaxy Tab S4"];
  const { defaultBrowserType: _ios, ...iphone } = devices["iPhone 15"];
  const open = async (device) => {
    const context = await browser.newContext({ ...device, reducedMotion: "reduce", storageState: state });
    return { context, page: await context.newPage() };
  };
  const card = (page) => page.locator(".cat-device");
  const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => undefined); await page.waitForTimeout(300); };
  const save = async (page, name, how, category, unit, picture = null) => {
    await page.getByLabel("Name", { exact: true }).fill(name);
    if (picture) { await page.locator("#cat-file").setInputFiles(picture); await page.waitForSelector("#cat-photo img"); }
    await page.locator(".cat-choice", { hasText: how }).first().click();
    if (category) await page.getByLabel("Category").fill(category);
    if (unit) await page.getByLabel("Counted in").fill(unit);
    await page.getByRole("button", { name: /^Save & next/ }).click();
    // Drawn pictures can look alike to the photo hint: as a person would, say "a different one".
    if (await page.locator(".cat-dup__card.is-armed").count()) await page.getByRole("button", { name: /^Save as a separate item/ }).click();
    await page.getByLabel("Name", { exact: true }).and(page.locator(":focus")).waitFor();
  };
  const timings = {};

  // A computer: the card off, with the install steps open.
  {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`${url}/staff/catalogue`);
    await card(page).locator("summary").click();
    await settle(page);
    await card(page).scrollIntoViewIfNeeded();
    await shot(page, "catalog-off-desktop");
    await context.close();
  }
  // An iPhone in a Safari tab: offline cataloguing is turned on in the Home Screen app.
  {
    const { context, page } = await open(iphone);
    await page.goto(`${url}/staff/catalogue`);
    await settle(page);
    await card(page).scrollIntoViewIfNeeded();
    await shot(page, "catalog-iphone-safari");
    await context.close();
  }
  // An Android tablet: turned on, ready, then a whole offline session.
  {
    const { context, page } = await open(tablet);
    await page.goto(`${url}/staff/catalogue`);
    await page.getByRole("button", { name: "Turn on offline cataloguing" }).click();
    const started = Date.now();
    await page.locator(".cat-ready--ok").waitFor({ timeout: 60_000 });
    timings.readyAfterTurnOnMs = Date.now() - started;
    await settle(page);
    await shot(page, "catalog-ready-tablet");
    await context.setOffline(true);
    let reopened = Date.now();
    await page.reload();
    await page.getByText("You're offline.", { exact: true }).waitFor();
    timings.reopenOfflineMs = Date.now() - reopened;
    await settle(page);
    await shot(page, "catalog-offline-start-tablet");
    await page.getByLabel("Place", { exact: true }).selectOption(shelf);
    await page.getByRole("button", { name: /^Start cataloguing/ }).click();
    await page.waitForSelector("#cat-form");
    await save(page, "Extension reel 10 m", "Borrow", "EQUIPMENT", "piece", pictures[0]);
    await save(page, "Cable ties (pack)", "Take", "OFFICE SUPPLIES", "pack");
    await page.getByLabel("Name", { exact: true }).fill("Whiteboard");
    await page.waitForTimeout(200);
    await shot(page, "catalog-offline-session-tablet");
    await page.getByLabel("Name", { exact: true }).fill("");
    // Back online: everything goes.
    await context.setOffline(false);
    reopened = Date.now();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.locator("#cat-sync", { hasText: "All saved" }).waitFor({ timeout: 60_000 });
    timings.sendTwoAfterReconnectMs = Date.now() - reopened;
    await settle(page);
    await page.evaluate(() => document.querySelector("#cat-recent-title").scrollIntoView());
    await shot(page, "catalog-sent-tablet");
    await context.close();
  }
  // An Android phone: ready, an offline session finished offline, signed out on the lease, and offline after turning it off.
  {
    const { context, page } = await open(pixel);
    await page.goto(`${url}/staff/catalogue`);
    await settle(page);
    await card(page).scrollIntoViewIfNeeded();
    await shot(page, "catalog-off-phone");
    await page.getByRole("button", { name: "Turn on offline cataloguing" }).click();
    await page.locator(".cat-ready").first().waitFor();
    await card(page).scrollIntoViewIfNeeded();
    await shot(page, "catalog-getting-ready-phone");
    await page.locator(".cat-ready--ok").waitFor({ timeout: 60_000 });
    await card(page).scrollIntoViewIfNeeded();
    await shot(page, "catalog-ready-phone");
    await context.setOffline(true);
    await page.reload();
    await page.getByText("You're offline.", { exact: true }).waitFor();
    await settle(page);
    await shot(page, "catalog-offline-start-phone");
    await page.getByLabel("Place", { exact: true }).selectOption(shelf);
    await page.getByRole("button", { name: /^Start cataloguing/ }).click();
    await page.waitForSelector("#cat-form");
    await save(page, "Folding table", "Borrow", "FURNITURE", "piece", pictures[1]);
    await save(page, "Masking tape", "Use gradually", "OFFICE SUPPLIES", "roll");
    await save(page, "Unmarked crate", "Not sure", "", "");
    await page.getByText("3 waiting to send").waitFor();
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "catalog-offline-session-phone");
    await page.evaluate(() => document.querySelector("#cat-recent-title").scrollIntoView());
    await shot(page, "catalog-offline-list-phone");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Finish" }).click();
    await page.getByRole("heading", { name: "Cataloguing finished" }).waitFor();
    await shot(page, "catalog-finished-offline-phone");
    await page.goto(`${url}/staff/catalogue`).catch(() => undefined);
    await page.getByText("You're offline.", { exact: true }).waitFor();
    await settle(page);
    await shot(page, "catalog-offline-waiting-phone");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.locator(".cat-held").waitFor({ state: "detached", timeout: 60_000 });
    // Signed out: the lease still catalogues.
    await context.clearCookies({ name: "lh_staff_session" });
    await page.reload();
    await page.getByText("You're signed out.", { exact: true }).waitFor();
    await settle(page);
    await shot(page, "catalog-signed-out-phone");
    // Turned off, then offline: this device can no longer catalogue without a connection.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Turn off" }).click();
    await page.getByText("Offline cataloguing is off on this device.").waitFor();
    await context.setOffline(true);
    await page.reload();
    await page.getByRole("heading", { name: "The Catalogue needs a connection here" }).waitFor();
    await shot(page, "catalog-closed-phone");
    await context.close();
  }
  fs.rmSync(folder, { recursive: true, force: true });
  return timings;
}

/**
 * V1.7 checking a place: a realistic shelf of a dozen items, checked on a phone (here, a different count, not found, a record that looks
 * wrong, something found that belongs elsewhere, and something not in the catalog), paused and resumed, continued offline and sent on
 * reconnecting; stock moved by someone else after a count (the conflict); then the summary and the review, settled on a computer.
 */
/** V1.8: the kit list and profile, a Ready and an incomplete kit, a template, the check flow and its summary; phone, tablet and computer. */
async function kitScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const first = await signIn(browser, url, "staff.demo", SIZES.desktop);
  if ((await first.page.request.get(`${url}/api/staff/kits`)).status() === 404) {
    console.log("kits: this ref has no kits, skipped");
    await first.context.close();
    return {};
  }
  const state = await first.context.storageState();
  const call = async (method, route, data) => (await first.page.request.fetch(`${url}${route}`, { method, headers: { origin: url }, data })).json();
  const store = (await call("POST", "/api/staff/locations", { name: "Store room", parentId: null })).id;
  const base = { category: "SCHOOL SUPPLIES", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
  const make = async (name, extra) => (await call("POST", "/api/staff/items", { ...base, name, itemType: "Consumable", ...extra })).id;
  const thread = await make("Sewing thread", { openingQuantity: 10 });
  const needles = await make("Sewing needles", { openingQuantity: 1 });
  const chalk = await make("Tailor's chalk", { consumptionMode: "OPEN_UNIT", openingQuantity: 4 });
  const scissors = await make("Fabric scissors", { itemType: "Loanable", lendingAudience: "USC_STAFF_ONLY", openingQuantity: 2 });
  const bandage = await make("Bandages", { category: "MEDICAL SUPPLIES", openingQuantity: 40 });
  const gloves = await make("Gloves", { category: "MEDICAL SUPPLIES", unit: "pair", openingQuantity: 20 });
  const parts = (...list) => list.map(([itemId, required]) => ({ itemId, required }));
  const sewing = (await call("POST", "/api/staff/kits", { name: "Sewing kit", description: "Mending for costumes and banners.", locationId: store, components: parts([thread, 4], [needles, 2], [chalk, 1], [scissors, 1]) })).id;
  const aid = (await call("POST", "/api/staff/kits", { name: "First-aid kit", description: "Event medical bag.", locationId: store, components: parts([bandage, 20], [gloves, 10]) })).id;
  await call("POST", "/api/staff/kit-templates", { name: "Event first-aid", description: "Bandages and gloves for an event.", components: parts([bandage, 20], [gloves, 10]) });
  await first.context.close();
  const timings = {};

  for (const [size, viewport] of Object.entries(SIZES)) {
    const { context, page } = await resume(browser, state, viewport);
    const sheet = page.locator("dialog[open]");
    await page.goto(`${url}/staff/kits`);
    await page.waitForSelector(".kit-row");
    await shot(page, `kits-list-${size}`);
    await page.goto(`${url}/staff/kits?kit=${aid}`);
    await sheet.waitFor();
    await shot(page, `kit-ready-${size}`);
    await page.goto(`${url}/staff/kits?kit=${sewing}`);
    await sheet.waitFor();
    await shot(page, `kit-incomplete-${size}`);
    if (size !== "tablet") {
      const start = Date.now();
      await sheet.getByRole("button", { name: "Check kit" }).click();
      await sheet.locator(".kit-check-row").first().waitFor();
      timings[`checkOpens-${size}`] = Date.now() - start;
      await sheet.locator(".kit-check-row", { hasText: "Sewing thread" }).getByRole("button", { name: "All there" }).click();
      await sheet.locator(".kit-check-row", { hasText: "Sewing needles" }).getByRole("button", { name: "Running low" }).click();
      await shot(page, `kit-check-${size}`);
      await sheet.locator(".kit-check-row", { hasText: "Fabric scissors" }).getByRole("button", { name: "Damaged" }).click();
      await sheet.locator(".kit-check-row", { hasText: "Fabric scissors" }).getByLabel("Note about Fabric scissors").fill("Loose screw");
      page.once("dialog", (dialog) => void dialog.accept());
      await sheet.getByRole("button", { name: "Finish check" }).click();
      await sheet.getByText("Stock was not changed by this check.").waitFor();
      await shot(page, `kit-summary-${size}`);
    }
    if (size === "desktop") {
      await page.goto(`${url}/staff/kits`);
      await page.getByRole("button", { name: "New kit" }).first().click();
      await sheet.getByLabel("Name", { exact: true }).fill("Spare first-aid kit");
      await sheet.getByLabel("Start from").selectOption({ index: 1 });
      await shot(page, "kit-new-from-template-desktop");
      await page.goto(`${url}/staff/kits`);
      await page.locator(".kit-list--templates [data-template]").first().click();
      await sheet.waitFor();
      await shot(page, "kit-template-desktop");
    }
    await context.close();
  }
  return timings;
}

async function locationAuditScenes(browser, url, dir) {
  const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80 });
  const first = await signIn(browser, url, "staff.demo", SIZES.desktop);
  if ((await first.page.request.get(`${url}/api/staff/audits`)).status() === 404) {
    console.log("location-audit: this ref has no checks of a place, skipped");
    await first.context.close();
    return {};
  }
  const state = await first.context.storageState();
  const post = async (route, body) => (await first.page.request.post(`${url}${route}`, { headers: { origin: url }, data: body })).json();
  const store = (await post("/api/staff/locations", { name: "Store room", parentId: null })).id;
  const shelf = (await post("/api/staff/locations", { name: "Shelf B", parentId: store, directions: "Back wall, second metal shelf from the door. Top row is tape and glue; bottom row is cables." })).id;
  const cabinet = (await post("/api/staff/locations", { name: "Cabinet 2", parentId: store })).id;
  const base = { category: "OFFICE SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
  const stock = [["Masking tape 1 in", 12, "roll"], ["Packing tape clear", 6, "roll"], ["Glue stick", 20, "piece"], ["White glue 500 ml", 3, "bottle"], ["Cable ties 200 mm", 4, "pack"],
    ["Extension cord 5 m", 2, "piece"], ["HDMI cable 3 m", 3, "piece"], ["Duct tape silver", 5, "roll"], ["Double-sided tape", 8, "roll"], ["Stapler wires No. 35", 10, "box"], ["Scissors large", 4, "piece"], ["Cutter knife", 6, "piece"]];
  const ids = {};
  for (const [name, quantity, unit] of stock) ids[name] = (await post("/api/staff/items", { ...base, name, unit, locationId: shelf, openingQuantity: quantity })).id;
  ids.stray = (await post("/api/staff/items", { ...base, name: "Extension reel 10 m", itemType: "Loanable", locationId: cabinet, openingQuantity: 1 })).id;
  await first.context.close();
  const { defaultBrowserType: _android, ...pixel } = devices["Pixel 7"];
  const { defaultBrowserType: _tablet, ...tablet } = devices["Galaxy Tab S4"];
  const open = async (device) => {
    const context = await browser.newContext({ ...device, reducedMotion: "reduce", storageState: state });
    return { context, page: await context.newPage() };
  };
  const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => undefined); await page.waitForTimeout(300); };
  const row = (page, name) => page.locator(".ck-row", { hasText: name });
  const timings = {};

  // A phone: offline cataloguing on (a check may go offline), then a check of Shelf B.
  const { context, page } = await open(pixel);
  await page.goto(`${url}/staff/catalogue`);
  await page.getByRole("button", { name: "Turn on offline cataloguing" }).click();
  await page.locator(".cat-ready--ok").waitFor({ timeout: 60_000 });
  await page.locator(".ck-home").scrollIntoViewIfNeeded();
  await settle(page);
  await shot(page, "check-home-phone");
  await page.getByLabel("Place to check").selectOption(shelf);
  let started = Date.now();
  await page.getByRole("button", { name: /Start checking/ }).click();
  await page.locator(".ck-row").first().waitFor();
  timings.startToListMs = Date.now() - started;
  await settle(page);
  await shot(page, "check-start-phone");
  for (const name of ["Masking tape 1 in", "Packing tape clear", "Glue stick", "Cable ties 200 mm"]) await row(page, name).getByRole("button", { name: /^Here/ }).click();
  await row(page, "White glue 500 ml").getByRole("button", { name: /^Count differs/ }).click();
  await page.locator("#ck-count-" + ids["White glue 500 ml"]).fill("2");
  await settle(page);
  await shot(page, "check-mismatch-phone");
  await page.getByRole("button", { name: "Save count" }).click();
  await row(page, "Extension cord 5 m").getByRole("button", { name: /^Can.t find/ }).click();
  await row(page, "Double-sided tape").getByRole("button", { name: /^Record looks wrong/ }).click();
  await page.locator("#ck-why-" + ids["Double-sided tape"]).fill("These are foam mounting squares, not tape rolls.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle(page);
  await shot(page, "check-progress-phone");
  // Paused, then resumed from the home screen.
  await page.getByRole("button", { name: "Pause" }).click();
  await page.locator(".ck-mine__row").waitFor();
  await page.locator(".ck-home").scrollIntoViewIfNeeded();
  await settle(page);
  await shot(page, "check-paused-phone");
  await page.locator(".ck-mine__row").click();
  await page.locator(".ck-row").first().waitFor();
  // Offline: keep going, and find two things that are not on the list.
  await context.setOffline(true);
  started = Date.now();
  await page.reload();
  await page.locator(".ck-note", { hasText: "Offline." }).waitFor();
  timings.reopenOfflineMs = Date.now() - started;
  for (const name of ["HDMI cable 3 m", "Duct tape silver", "Stapler wires No. 35"]) await row(page, name).getByRole("button", { name: /^Here/ }).click();
  await page.getByRole("button", { name: /Found something not on the list/ }).click();
  await page.getByLabel("Search the catalog").fill("reel");
  await page.locator(".ck-result").first().click();
  await settle(page);
  await shot(page, "check-found-phone");
  await page.getByRole("button", { name: "Save as found here" }).click();
  await page.getByRole("button", { name: /Found something not on the list/ }).click();
  await page.locator(".ck-unlisted summary").click();
  await page.getByLabel("What is it?").fill("Blue label printer (no tag)");
  await page.getByRole("button", { name: "Save as not in the catalog" }).click();
  await page.getByRole("tab", { name: /^To check/ }).click();
  await settle(page);
  await shot(page, "check-offline-phone");
  // Back online: what waited is sent once.
  started = Date.now();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.locator(".ck-progress .live-status").waitFor({ state: "detached", timeout: 60_000 });
  timings.sendAfterReconnectMs = Date.now() - started;
  await context.close();

  // A tablet, mid-check.
  {
    const { context, page } = await open(tablet);
    await page.goto(`${url}/staff/catalogue`);
    await page.locator(".ck-mine__row").click();
    await page.locator(".ck-row").first().waitFor();
    await settle(page);
    await shot(page, "check-progress-tablet");
    await context.close();
  }

  // Someone takes a glue bottle out after it was counted: the review asks for a fresh count instead of posting the old one.
  const second = await signIn(browser, url, "staff.demo", SIZES.desktop);
  await second.page.request.post(`${url}/api/staff/items/${ids["White glue 500 ml"]}/movements`, { headers: { origin: url }, data: { kind: "OUT", quantity: 1, reason: "ISSUED", key: crypto.randomUUID() } });
  await second.context.close();
  {
    const { context, page } = await open(pixel);
    await page.goto(`${url}/staff/catalogue`);
    await page.locator(".ck-mine__row").click();
    await page.locator(".ck-row").first().waitFor();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Finish check" }).click();
    await page.locator(".ck-stats").waitFor();
    await settle(page);
    await shot(page, "check-summary-phone");
    await page.locator(".ck-finding", { hasText: "White glue" }).scrollIntoViewIfNeeded();
    await shot(page, "check-conflict-phone");
    await context.close();
  }
  // The review on a computer: post a count, move what was found here, and leave a reasoned no-change.
  {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`${url}/staff/catalogue`);
    await page.locator(".ck-finished summary").click();
    await page.locator(".ck-finished a").first().click();
    await page.locator(".ck-stats").waitFor();
    await settle(page);
    await shot(page, "check-review-desktop");
    await page.locator(".ck-finding", { hasText: "Extension reel" }).getByRole("button", { name: "Move it here" }).click();
    await page.locator(".ck-finding.is-settled", { hasText: "Extension reel" }).waitFor();
    const glue = page.locator(".ck-finding", { hasText: "White glue" });
    await glue.locator("[data-fresh-count]").fill("1");
    await glue.getByRole("button", { name: "Post this count" }).click();
    await page.locator(".ck-finding.is-settled", { hasText: "White glue" }).waitFor();
    await settle(page);
    await shot(page, "check-settled-desktop");
    await context.close();
  }
  return timings;
}


/** Mixed conditions for the Attention inbox: overdue loans, a damaged return, low and out stock, a check finding, a repeated report, a phone record and a phone report, all on fictional people. */
function attentionRecordsSql() {
  const rows = [];
  const at = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const day = (days) => at(days).slice(0, 10);
  const item = (offset) => `(SELECT id FROM items WHERE item_type = 'Loanable' AND status = 'ACTIVE' ORDER BY id LIMIT 1 OFFSET ${offset})`;
  const staff = "(SELECT id FROM staff_accounts WHERE username = 'staff.demo')";
  const loan = (n, name, itemSql, days, status, due, note) => {
    rows.push(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, related_entity_type, related_entity_id, actor_user_id, status)
      SELECT 'MOV-AT${n}', ${sq(at(days))}, 'LOAN_OUT', 'OUT', id, 1, unit, -1, 'LOAN', 'LN-AT${n}', ${staff}, 'POSTED' FROM items WHERE id = ${itemSql};`);
    rows.push(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, reason, photo_key, return_by, movement_id, created_at, created_by, status, return_note, closed_at, closed_by)
      SELECT 'LN-AT${n}', id, 1, 'INDIVIDUAL', ${sq(name)}, '20-1111-22${n}', NULL, 'loans/none', ${due ? sq(day(due)) : "NULL"}, 'MOV-AT${n}', ${sq(at(days))}, ${staff}, ${sq(status)}, ${sq(note ?? null)},
        ${status === "OUT" ? "NULL, NULL" : `${sq(at(3))}, ${staff}`} FROM items WHERE id = ${itemSql};`);
  };
  loan(1, "Ana Marie Santos", item(2), 20, "OUT", 9);
  loan(2, "Ben Lim", item(5), 14, "OUT", 4);
  loan(3, "Carla Reyes", item(9), 8, "OUT", 1);
  loan(4, "Dan Cruz", item(12), 6, "OUT", -3);
  loan(5, "Ella Tan", item(15), 10, "DAMAGED", 6, "The left leg is bent.");
  loan(6, "Felix Go", item(18), 12, "LOST", 8, "Could not be found after the event.");
  // Stock: three items below their level, one gone.
  rows.push(`UPDATE items SET reorder_threshold = 100000 WHERE id IN (SELECT id FROM items WHERE item_type = 'Consumable' AND status = 'ACTIVE' ORDER BY id LIMIT 3 OFFSET 4);`);
  rows.push(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, reason, status)
    SELECT 'MOV-ATOUT', ${sq(at(1))}, 'STOCK_OUT', 'OUT', b.id, b.on_hand, b.unit, -b.on_hand, ${staff}, 'CONSUMED', 'POSTED' FROM inventory_balances b
    WHERE b.id = (SELECT id FROM items WHERE item_type = 'Consumable' AND status = 'ACTIVE' AND reorder_threshold = 0 ORDER BY id LIMIT 1 OFFSET 30) AND b.on_hand > 0;`);
  // A place checked three weeks ago, with two findings still to settle.
  const audit = `LA-${"0".repeat(35)}1`;
  rows.push(`INSERT INTO locations(id, name, visibility, active, created_at, updated_at) VALUES('LOC-0900', 'Store room', 'STAFF_ONLY', 1, ${sq(at(60))}, ${sq(at(60))});`);
  rows.push(`INSERT INTO location_audits(id, location_id, started_by, status, expected_at_start, started_at, updated_at) VALUES('${audit}', 'LOC-0900', ${staff}, 'OPEN', 12, ${sq(at(21))}, ${sq(at(21))});`);
  rows.push(`INSERT INTO location_audit_observations(id, audit_id, item_id, outcome, expected_on_hand, counted, on_hand_at_receipt, observed_by, observed_at, received_at)
    SELECT '${"0".repeat(35)}1', '${audit}', id, 'CANT_FIND', 3, NULL, 3, ${staff}, ${sq(at(21))}, ${sq(at(21))} FROM items WHERE id = (SELECT id FROM items ORDER BY id LIMIT 1 OFFSET 60);`);
  rows.push(`INSERT INTO location_audit_observations(id, audit_id, item_id, outcome, expected_on_hand, counted, on_hand_at_receipt, observed_by, observed_at, received_at)
    SELECT '${"0".repeat(35)}2', '${audit}', id, 'MISMATCH', 8, 5, 8, ${staff}, ${sq(at(21))}, ${sq(at(21))} FROM items WHERE id = (SELECT id FROM items ORDER BY id LIMIT 1 OFFSET 61);`);
  rows.push(`UPDATE location_audits SET status = 'FINISHED', finished_at = ${sq(at(21))}, finished_by = ${staff} WHERE id = '${audit}';`);
  // One item reported twice by staff, and one phone report.
  for (const [n, kind] of [[1, "CANT_FIND"], [2, "LOCATION_WRONG"]]) {
    rows.push(`INSERT INTO location_reports(id, item_id, kind, source, reported_by, created_at) SELECT '${"0".repeat(35)}${n}', id, '${kind}', 'STAFF', ${staff}, ${sq(at(4 - n))} FROM items WHERE id = (SELECT id FROM items ORDER BY id LIMIT 1 OFFSET 80);`);
  }
  rows.push(`INSERT INTO location_reports(id, item_id, kind, source, client_tag, created_at) SELECT '${"0".repeat(35)}3', id, 'CANT_FIND', 'SELF_SERVICE', 'evidence', ${sq(at(1))} FROM items WHERE id = (SELECT id FROM items ORDER BY id LIMIT 1 OFFSET 90);`);
  rows.push(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, purpose, device_time, sent_at, occurred_at, received_at, applied, review)
    SELECT '00000000-0000-4000-8000-0000000a0001', 'evidence', 1, 'TAKE', id, 2, 'Gabe Ong', '20-1111-229', 'INDIVIDUAL', ${sq(at(2))}, ${sq(at(2))}, ${sq(at(2))}, ${sq(at(2))}, 0, 'STOCK_SHORT' FROM items WHERE id = (SELECT id FROM items ORDER BY id LIMIT 1 OFFSET 100);`);
  // An Unclassified item whose name resembles two confirmed ones, so its Details show a suggestion with its reason.
  rows.push(`INSERT INTO items(id, name, category, stock_area, item_type, unit, status, needs_review, updated_at) VALUES('ITM-EV01', 'Bond Paper - Short', 'UNSORTED', 'Inventory', 'NEEDS_REVIEW', 'ream', 'ACTIVE', 1, ${sq(at(30))});`);
  return rows.join("\n");
}

async function attentionScenes(browser, url, dir) {
  const shot = (page, name, options = {}) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80, ...options });
  const first = await signIn(browser, url, "staff.demo", SIZES.desktop);
  if ((await first.page.request.get(`${url}/api/staff/attention`)).status() === 404) {
    console.log("attention: this ref has no Attention, skipped");
    await first.context.close();
    return {};
  }
  const state = await first.context.storageState();
  const read = async (route) => (await first.page.request.get(`${url}${route}`)).json();
  const inbox = await read("/api/staff/attention");
  const summary = await read("/api/staff/attention/summary");
  const classify = inbox.entries.find((entry) => entry.reason === "CLASSIFY" && entry.title === "Bond Paper - Short")?.href ?? inbox.entries.find((entry) => entry.reason === "CLASSIFY")?.href;
  await first.context.close();
  const timings = { entries: inbox.entries.length, needsAction: summary.needsAction, groups: inbox.groups.filter((group) => group.total).length };

  // The calm state is drawn by the same page, with the answer emptied only for this picture (the demo database cannot be cleared).
  const empty = async (page) => {
    await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 0, bySource: {} }) }));
    await page.route("**/api/staff/attention", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ today: new Date().toISOString().slice(0, 10), groups: [], entries: [] }) }));
  };

  for (const [size, viewport] of Object.entries(SIZES)) {
    const { context, page } = await resume(browser, state, viewport);
    const started = Date.now();
    await page.goto(`${url}/staff/attention`);
    await page.waitForSelector(".attn-row");
    timings[`inboxFirstRowMs-${size}`] = Date.now() - started;
    await page.waitForSelector(".app-bell .nav-badge");
    await shot(page, `attention-inbox-${size}`);
    await shot(page, `attention-inbox-full-${size}`, { fullPage: true });
    await page.goto(`${url}/staff/attention?source=Loans`);
    await page.waitForSelector(".attn-row");
    await shot(page, `attention-filtered-${size}`);
    if (size === "phone") {
      await page.getByRole("button", { name: /^Filters/ }).click();
      await shot(page, "attention-filters-open-phone");
    }
    if (size !== "tablet") {
      await page.goto(`${url}/staff/attention`);
      await page.waitForSelector(".attn-row");
      const more = page.locator(".attn-more").first();
      if (await more.count()) { await more.click(); await shot(page, `attention-group-open-${size}`); }
      await page.goto(`${url}/staff/attention`);
      await page.waitForSelector(".attn-row");
      const waiting = await page.locator("[data-review]").count();
      await page.getByRole("button", { name: "Mark reviewed" }).first().click();
      await page.waitForFunction((count) => document.querySelectorAll("[data-review]").length < count, waiting);
      await shot(page, `attention-after-review-${size}`);
      const loanLink = page.locator('a.attn-row__main[href*="/staff/loans?loan="]').first();
      if (await loanLink.count()) {
        await loanLink.click();
        await page.waitForSelector(".loan-row.is-focus");
        await shot(page, `attention-loan-focus-${size}`);
      }
      if (classify) {
        await page.goto(`${url}${classify}`);
        await page.waitForSelector("#classify-hint .classify-hint__line, #classify-hint p");
        await page.locator("#classify-hint").scrollIntoViewIfNeeded();
        await shot(page, `attention-classify-${size}`);
      }
      const blank = await resume(browser, state, viewport);
      await empty(blank.page);
      await blank.page.goto(`${url}/staff/attention`);
      await blank.page.waitForSelector(".empty");
      await shot(blank.page, `attention-empty-${size}`);
      await blank.context.close();
    }
    await context.close();
  }
  return timings;
}

/**
 * V1.11 global search over a realistic store: the seeded catalog plus a hundred and ten archive boxes (over 500 items), nested places,
 * kits (one with a long name), item links of every kind, and sixty-four fictional Staff Directory people with sample numbers.
 */
function searchRecordsSql() {
  const at = "2026-10-06T00:00:00.000Z";
  const rows = [];
  const place = (id, name, parent, active = 1) => rows.push(`INSERT INTO locations(id, name, parent_id, active, created_at, updated_at) VALUES('${id}', ${sq(name)}, ${parent ? `'${parent}'` : "NULL"}, ${active}, '${at}', '${at}');`);
  place("LOC-9101", "Logistics Office", null);
  place("LOC-9102", "Cabinet 1", "LOC-9101");
  place("LOC-9103", "Shelf A", "LOC-9102");
  place("LOC-9104", "Shelf B", "LOC-9102");
  place("LOC-9105", "Cabinet 2", "LOC-9101");
  place("LOC-9106", "Storage Room", null);
  place("LOC-9107", "First-aid Shelf", "LOC-9106");
  place("LOC-9108", "Old Event Bins", "LOC-9106", 0);
  place("LOC-9109", "General Assembly Hall Backstage Storage Cabinet (Left, top shelves)", "LOC-9106");
  place("LOC-9110", "Archive Room", null);
  const put = (where, location) => rows.push(`UPDATE items SET location_id = '${location}' WHERE ${where};`);
  put("name LIKE '%tape%' OR name LIKE '%glue%'", "LOC-9103");
  put("name LIKE '%stapl%' OR name LIKE '%ballpen%' OR name LIKE '%marker%'", "LOC-9104");
  put("name LIKE '%folder%'", "LOC-9105");
  put("id IN ('ITM-0058','ITM-0061','ITM-0062','ITM-0063','ITM-0064','ITM-0065','ITM-0066','ITM-0067')", "LOC-9107");
  put("id IN ('ITM-0100','ITM-0103')", "LOC-9106");
  // Realistic volume: numbered archive boxes, as a council keeps its records, so the catalog passes 500 items.
  const files = ["Minutes", "Receipts", "Liquidation Reports", "Event Files", "Election Records"];
  for (let n = 1; n <= 110; n++) {
    rows.push(`INSERT INTO items(id, name, aliases, category, item_type, unit, location_id) VALUES('ITM-${String(900 + n).padStart(4, "0")}', 'Archive Box ${String(n).padStart(3, "0")} - ${files[n % 5]} ${2016 + (n % 10)}', 'records box', 'OTHERS', 'Loanable', 'box', 'LOC-9110');`);
  }
  rows.push(`INSERT INTO items(id, name, aliases, category, item_type, unit, location_id) VALUES('ITM-0900', 'General Assembly Heavy-duty Extension Cord with Surge Protector - 4 gang, 10 metre, orange', 'power strip; extension wire', 'OFFICE EQUIPMENT AND SUPPLIES', 'Loanable', 'piece', 'LOC-9109');`);
  const kit = (id, name, location, items) => {
    rows.push(`INSERT INTO kits(id, name, location_id, active, created_at, updated_at) VALUES('${id}', ${sq(name)}, '${location}', 1, '${at}', '${at}');`);
    items.forEach((item, position) => rows.push(`INSERT INTO kit_components(kit_id, item_id, required, position) VALUES('${id}', '${item}', 2, ${position});`));
  };
  kit("KIT-9001", "Event First-aid Kit", "LOC-9107", ["ITM-0058", "ITM-0061", "ITM-0066", "ITM-0064"]);
  kit("KIT-9002", "Arts & Crafts Kit", "LOC-9103", ["ITM-0205", "ITM-0308", "ITM-0263", "ITM-0216"]);
  kit("KIT-9003", "Costume Repair Kit", "LOC-9106", ["ITM-0103", "ITM-0100"]);
  kit("KIT-9004", "General Assembly Registration Table Kit - pens, markers and folders", "LOC-9109", ["ITM-0127", "ITM-0242", "ITM-0165", "ITM-0900"]);
  const link = (from, to, kind) => rows.push(`INSERT INTO item_relationships(item_id, related_id, kind, created_at) VALUES('${from}', '${to}', '${kind}', '${at}');`);
  link("ITM-0204", "ITM-0205", "USED_WITH");
  link("ITM-0292", "ITM-0205", "ALTERNATIVE");
  link("ITM-0285", "ITM-0289", "USED_WITH");
  link("ITM-0287", "ITM-0290", "USED_WITH");
  link("ITM-0286", "ITM-0288", "USED_WITH");
  link("ITM-0285", "ITM-0286", "REPLACEMENT");
  link("ITM-0100", "ITM-0103", "CONTENTS");
  link("ITM-0062", "ITM-0066", "ALTERNATIVE");
  const first = ["Maria", "Jose", "Andrea", "Paolo", "Bea", "Carlo", "Dana", "Enzo", "Faye", "Gino", "Hana", "Ivan", "Jia", "Kiko", "Lara", "Migs"];
  const last = ["Santos", "Dela Cruz", "Villanueva", "Reyes"];
  const departments = ["DoL", "DEM", "DoF", "DPC", "DHR", "DCES", "OfP", "SEC"];
  const positions = ["Logistics Head", "Events Officer", "Finance Officer", "Member", null, "Committee Head", "Secretary"];
  let n = 1;
  for (const given of first) for (const family of last) {
    rows.push(`INSERT INTO staff_directory(id, full_name, department, position, officer, student_id, active, created_at, updated_at) VALUES('PER-00000000-0000-4000-8000-${String(n).padStart(12, "0")}', ${sq(`${given} ${family}`)}, '${departments[n % departments.length]}', ${sq(positions[n % positions.length])}, ${n % 5 === 0 ? 1 : 0}, '00-SAMPLE-${String(n).padStart(3, "0")}', ${n % 11 === 0 ? 0 : 1}, '${at}', '${at}');`);
    n++;
  }
  rows.push("UPDATE catalog_revision SET value = value + 1 WHERE id = 1;");
  return rows.join("\n");
}

async function searchScenes(browser, url, dir) {
  const shot = (page, name, options = {}) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80, ...options });
  const owner = await signIn(browser, url, "owner.demo", SIZES.desktop);
  if ((await owner.page.request.get(`${url}/api/staff/search`)).status() === 404) {
    console.log("search: this ref has no global search, skipped");
    await owner.context.close();
    return {};
  }
  const states = { OWNER: await owner.context.storageState() };
  await owner.context.close();
  const staff = await signIn(browser, url, "staff.demo", SIZES.desktop);
  states.STAFF = await staff.context.storageState();
  await staff.context.close();

  // Phones are touch screens here (no hover), as the keyboard hints are for keyboards only.
  const enter = async (state, size) => {
    const [width, height, scale] = SIZES[size];
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: "reduce", storageState: state, hasTouch: size === "phone", isMobile: size === "phone" });
    return { context, page: await context.newPage() };
  };
  const open = async (page, size) => {
    if (size === "desktop") await page.keyboard.press("Control+k");
    else await page.locator(".app-search").click();
    await page.locator("dialog.palette[open]").waitFor();
  };
  // A result count is announced once the answer is complete (for an administrator, once the directory has answered too).
  const ask = async (page, query) => {
    await page.evaluate(() => { document.querySelector("#palette-status").textContent = ""; });
    await page.locator("#palette-input").fill(query);
    if (query.trim().length >= 2) await page.waitForFunction(() => document.querySelector("#palette-status")?.textContent);
    await page.waitForTimeout(150);
  };
  const scenes = [
    ["mixed", "sewing"], ["items", "tape"], ["place", "cabinet"], ["kit", "first aid"], ["relation", "stapler big"], ["shortcut", "overdue"],
    ["id", "KIT-9001"], ["long-names", "general assembly"], ["volume", "archive box"], ["none", "zzqx"], ["people", "santos"]
  ];
  const timings = { directoryCallsByStaff: 0 };

  for (const [role, state] of Object.entries(states)) {
    for (const [size, viewport] of Object.entries(SIZES)) {
      if (role === "STAFF" && size === "tablet") continue;
      const who = role.toLowerCase();
      const { context, page } = await enter(state, size);
      if (role === "STAFF") page.on("request", (request) => { if (request.url().includes("/api/staff/admin/directory")) timings.directoryCallsByStaff++; });
      await page.goto(`${url}/staff/items`);
      await page.waitForSelector("tbody tr");
      await shot(page, `search-${who}-bar-${size}`);
      await open(page, size);
      await page.waitForLoadState("networkidle");
      await shot(page, `search-${who}-empty-${size}`);
      for (const [name, query] of scenes) {
        if (role === "STAFF" && !["mixed", "people", "relation"].includes(name)) continue;
        if (size === "tablet" && !["mixed", "long-names", "people", "none"].includes(name)) continue;
        await ask(page, query);
        await shot(page, `search-${who}-${name}-${size}`);
        if (name === "volume" && size !== "tablet") {
          await page.locator("#palette-more-items").click();
          await page.waitForTimeout(150);
          await page.locator(".palette__capped").scrollIntoViewIfNeeded().catch(() => {});
          await shot(page, `search-${who}-volume-all-${size}`);
          await page.locator("#palette-input").focus();
        }
      }
      if (role === "OWNER") {
        await ask(page, "tape");
        if (size === "phone") await page.locator("[id^='palette-item-']").nth(2).tap();
        else {
          await page.keyboard.press("ArrowDown");
          await page.keyboard.press("ArrowDown");
          await page.waitForTimeout(150);
          timings[`keyboardActive-${size}`] = await page.locator("#palette-input").getAttribute("aria-activedescendant");
          await shot(page, `search-owner-keyboard-${size}`);
          await page.keyboard.press("Enter");
        }
        await page.locator("dialog[open]:not(.palette)").waitFor();
        await page.waitForTimeout(300);
        timings[`focusAfterOpen-${size}`] = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 40));
        await shot(page, `search-owner-opened-${size}`);
      }
      await context.close();
    }
  }

  // Loading (the index still on its way) and a session that has ended, each with the answer held back only for this picture.
  for (const size of ["desktop", "phone"]) {
    const { context, page } = await enter(states.OWNER, size);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/staff/search", async (route) => { await held; await route.continue(); });
    await page.goto(`${url}/staff/items`);
    await page.waitForSelector("tbody tr");
    await open(page, size);
    await page.locator("#palette-input").fill("tape");
    await page.locator(".palette__loading").waitFor();
    await shot(page, `search-owner-loading-${size}`);
    release();
    await page.locator("#palette-item-ITM-0216, [id^='palette-item-']").first().waitFor();
    await context.close();
    const ended = await enter(states.OWNER, size);
    await ended.page.route("**/api/staff/search", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Sign in again." }) }));
    await ended.page.goto(`${url}/staff/items`);
    await ended.page.waitForSelector("tbody tr");
    await open(ended.page, size);
    await ended.page.locator("#palette-input").fill("tape");
    await ended.page.locator(".palette__error").waitFor();
    await shot(ended.page, `search-owner-session-ended-${size}`);
    await ended.context.close();
  }

  // Relationship discovery: an item's Linked items card, and adding a link from it.
  for (const size of ["desktop", "phone"]) {
    const { context, page } = await enter(states.STAFF, size);
    await page.goto(`${url}/staff/items?item=ITM-0285`);
    await page.waitForSelector("#links-title");
    const card = page.locator(".item-links");
    await card.scrollIntoViewIfNeeded();
    await shot(page, `search-links-${size}`);
    await page.getByRole("button", { name: "Link an item" }).click();
    await page.locator("#link-kind").selectOption({ index: 1 });
    await page.locator("#link-find").fill("staples small");
    await page.locator("[data-link-pick]").first().waitFor();
    await page.locator("[data-link-pick]").first().click();
    await card.scrollIntoViewIfNeeded();
    await shot(page, `search-links-form-${size}`);
    await context.close();
  }

  // Timings at 508 items: the first search after sign-in (the palette's code and the index both fetched) and a later one (a 304).
  const first = [], again = [];
  let indexBytes = 0;
  for (let run = 0; run < 5; run++) {
    const { context, page } = await resume(browser, states.OWNER, SIZES.desktop);
    page.on("response", async (response) => { if (response.url().endsWith("/api/staff/search") && response.status() === 200) indexBytes = (await response.body()).length; });
    await page.goto(`${url}/staff/items`);
    await page.waitForSelector("tbody tr");
    await page.waitForLoadState("networkidle");
    let start = Date.now();
    await page.keyboard.press("Control+k");
    await page.locator("#palette-input").fill("tape");
    await page.locator("[id^='palette-item-']").first().waitFor();
    first.push(Date.now() - start);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1_200);
    start = Date.now();
    await page.keyboard.press("Control+k");
    await page.locator("#palette-input").fill("glue");
    await page.locator("[id^='palette-item-']").first().waitFor();
    again.push(Date.now() - start);
    await context.close();
  }
  const counted = await (await browser.newContext({ storageState: states.OWNER })).request.get(`${url}/api/staff/search`);
  const index = await counted.json();
  Object.assign(timings, {
    items: index.items.length, places: index.places.length, kits: index.kits.length, links: index.links?.length ?? 0,
    indexBytes, indexGzipBytes: gzipSync(Buffer.from(JSON.stringify(index))).length,
    firstSearchMs: median(first), laterSearchMs: median(again)
  });
  return timings;
}


/** Repeating patterns for the insights, and unfinished work for staff.demo to continue; it builds on attentionRecordsSql (the Store room and its loans). */
function homeRecordsSql() {
  const rows = [];
  const at = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const staff = "(SELECT id FROM staff_accounts WHERE username = 'staff.demo')";
  const supply = (offset) => `(SELECT i.id FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.item_type = 'Consumable' AND i.status = 'ACTIVE' AND b.on_hand >= 20 ORDER BY i.id LIMIT 1 OFFSET ${offset})`;
  // Three supplies taken out again and again in the last month.
  [[0, 6, 3], [1, 4, 2], [2, 3, 2]].forEach(([offset, times, quantity]) => {
    for (let k = 0; k < times; k++) rows.push(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, reason, status)
      SELECT 'MOV-HM${offset}${k}', ${sq(at(1 + k * 4))}, 'STOCK_OUT', 'OUT', id, ${quantity}, unit, -${quantity}, ${staff}, 'CONSUMED', 'POSTED' FROM items WHERE id = ${supply(offset)};`);
  });
  // A projector lent four times in two months, a second item three times.
  [[25, 4], [28, 3]].forEach(([offset, times]) => {
    for (let k = 0; k < times; k++) {
      const id = `LN-HM${offset}${k}`;
      rows.push(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, status)
        SELECT 'MOV-${id}', ${sq(at(5 + k * 15))}, 'LOAN_OUT', 'OUT', id, 1, unit, 0, ${staff}, 'POSTED' FROM items WHERE id = (SELECT id FROM items WHERE item_type = 'Loanable' AND status = 'ACTIVE' ORDER BY id LIMIT 1 OFFSET ${offset});`);
      rows.push(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, return_by, movement_id, created_at, created_by, status, closed_at, closed_by)
        SELECT '${id}', id, 1, 'INDIVIDUAL', 'Evidence Borrower', '20-1111-3${k}0', 'loans/none', ${sq(at(2 + k * 15).slice(0, 10))}, 'MOV-${id}', ${sq(at(5 + k * 15))}, ${staff}, 'RETURNED', ${sq(at(4 + k * 15))}, ${staff}
        FROM items WHERE id = (SELECT id FROM items WHERE item_type = 'Loanable' AND status = 'ACTIVE' ORDER BY id LIMIT 1 OFFSET ${offset});`);
    }
  });
  // Restocked twice in three months.
  [[50, "RESTOCKED"], [12, "NEEDS_RESTOCK"]].forEach(([days, status], k) => rows.push(`INSERT INTO reorders(id, item_id, status, created_at, updated_at, created_by) SELECT 'RO-HM${k}', id, '${status}', ${sq(at(days))}, ${sq(at(days))}, ${staff} FROM items WHERE id = ${supply(3)};`));
  // The Store room keeps being reported.
  [[1, "CANT_FIND", 140], [2, "CANT_FIND", 141], [3, "LOCATION_WRONG", 142]].forEach(([n, kind, offset]) => rows.push(`INSERT INTO location_reports(id, item_id, location_id, kind, source, reported_by, created_at)
    SELECT '${"1".repeat(35)}${n}', id, 'LOC-0900', '${kind}', 'STAFF', ${staff}, ${sq(at(8 + n))} FROM items WHERE id = (SELECT id FROM items ORDER BY id LIMIT 1 OFFSET ${offset});`));
  // A kit found short twice.
  rows.push(`INSERT INTO kits(id, name, location_id, active, created_at, updated_at) VALUES('KIT-0900', 'Sewing kit', 'LOC-0900', 1, ${sq(at(80))}, ${sq(at(80))});`);
  [10, 30].forEach((days, k) => {
    rows.push(`INSERT INTO kit_checks(id, kit_id, checked_by, checked_at, ok_count, flagged_count, unchecked_count) VALUES('KC-${String(k + 1).padStart(36, "0")}', 'KIT-0900', ${staff}, ${sq(at(days))}, 0, 1, 0);`);
    rows.push(`INSERT INTO kit_check_observations(check_id, item_id, outcome, required, on_hand) SELECT 'KC-${String(k + 1).padStart(36, "0")}', id, 'LOW', 4, 1 FROM items WHERE id = ${supply(4)};`);
  });
  // An item whose use was changed three times.
  [20, 14, 6].forEach((days, k) => rows.push(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
    SELECT 'AU-HM${k}', ${sq(at(days))}, ${staff}, 'ITEM_UPDATED', 'ITEM', id, '{"itemType":{"from":"${k % 2 ? "Consumable" : "Loanable"}","to":"${k % 2 ? "Loanable" : "Consumable"}"}}' FROM items WHERE id = ${supply(5)};`));
  // staff.demo has a cataloguing session to continue (three items added) and a paused check of another place.
  rows.push(`INSERT INTO catalogue_sessions(id, started_by, location_id, status, started_at, updated_at) VALUES('CS-${"0".repeat(35)}1', ${staff}, 'LOC-0900', 'ACTIVE', ${sq(at(1))}, ${sq(at(0))});`);
  [210, 211, 212].forEach((offset, k) => rows.push(`INSERT INTO catalogue_captures(id, session_id, item_id, location_id, behaviour, created_at)
    SELECT '${"2".repeat(35)}${k}', 'CS-${"0".repeat(35)}1', id, 'LOC-0900', 'CONSUME', ${sq(at(0))} FROM items WHERE id = (SELECT id FROM items ORDER BY id LIMIT 1 OFFSET ${offset});`));
  rows.push(`INSERT INTO locations(id, name, visibility, active, created_at, updated_at) VALUES('LOC-0901', 'Supply cabinet', 'STAFF_ONLY', 1, ${sq(at(60))}, ${sq(at(60))});`);
  rows.push(`INSERT INTO location_audits(id, location_id, started_by, status, expected_at_start, started_at, updated_at) VALUES('LA-${"0".repeat(35)}2', 'LOC-0901', ${staff}, 'PAUSED', 38, ${sq(at(3))}, ${sq(at(2))});`);
  return rows.join("\n");
}

async function homeScenes(browser, url, dir) {
  const shot = (page, name, options = {}) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80, ...options });
  const timings = {};
  for (const [size, viewport] of Object.entries(SIZES)) {
    for (const [label, username] of [["staff", "staff.demo"], ["owner", "owner.demo"]]) {
      if (label === "owner" && size === "tablet") continue;
      const { context, page } = await signIn(browser, url, username, viewport);
      if ((await page.request.get(`${url}/api/staff/home`)).status() === 404) {
        console.log("home: this ref has no Home, skipped");
        await context.close();
        return {};
      }
      const started = Date.now();
      await page.goto(`${url}/staff/home`);
      await page.waitForSelector("#home-attention .home-row");
      timings[`${label}-attentionMs-${size}`] = Date.now() - started;
      await page.waitForSelector("#home-insights .home-card");
      timings[`${label}-insightsMs-${size}`] = Date.now() - started;
      await shot(page, `home-${label}-${size}`);
      await shot(page, `home-${label}-full-${size}`, { fullPage: true });
      if (label === "staff") {
        // The same page with the answers changed only for these pictures: a calm hub, and insights that failed.
        const calm = await context.newPage();
        await calm.setViewportSize({ width: viewport[0], height: viewport[1] });
        await calm.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 0, bySource: {}, groups: [] }) }));
        await calm.route("**/api/staff/home", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ catalogue: null, checks: [] }) }));
        await calm.goto(`${url}/staff/home`);
        await calm.waitForSelector(".home-clear");
        await calm.waitForSelector("#home-insights .home-card");
        await shot(calm, `home-calm-${size}`, { fullPage: true });
        const failed = await context.newPage();
        await failed.setViewportSize({ width: viewport[0], height: viewport[1] });
        await failed.route("**/api/staff/home/insights", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong." }) }));
        await failed.goto(`${url}/staff/home`);
        await failed.waitForSelector(".home-failed");
        await shot(failed, `home-insights-failed-${size}`, { fullPage: true });
        // A reason's own page in Attention.
        if (size !== "tablet") {
          await page.goto(`${url}/staff/attention?reason=LOAN_OVERDUE`);
          await page.waitForSelector(".attn-row");
          await shot(page, `home-attention-reason-${size}`);
        }
      }
      await context.close();
    }
  }
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
          if (name === "item-photos" || name === "attention" || name === "public-photos" || name === "self-service-v19" || name === "shell" || name === "staff-directory" || name === "locations" || name === "catalogue" || name === "catalog-visuals" || name === "catalog-pwa" || name === "location-audit" || name === "kits" || name === "search" || name === "admin-control" || name === "home") continue;
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
      await page.goto(`${url}/staff/items`);
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
    if (pages.includes("self-service-v19")) Object.assign(timings, { selfServiceV19: await selfServiceScenes(browser, url, dir) });
    if (pages.includes("locations")) Object.assign(timings, { locations: await locationScenes(browser, url, dir) });
    if (pages.includes("catalogue")) Object.assign(timings, { catalogue: await catalogueScenes(browser, url, dir) });
    if (pages.includes("catalog-visuals")) Object.assign(timings, { catalogVisuals: await catalogVisualScenes(browser, url, dir) });
    if (pages.includes("catalog-pwa")) Object.assign(timings, { catalogPwa: await catalogPwaScenes(browser, url, dir) });
    if (pages.includes("location-audit")) Object.assign(timings, { locationAudit: await locationAuditScenes(browser, url, dir) });
    if (pages.includes("kits")) Object.assign(timings, { kits: await kitScenes(browser, url, dir) });
    if (pages.includes("attention")) Object.assign(timings, { attention: await attentionScenes(browser, url, dir) });
    if (pages.includes("home")) Object.assign(timings, { home: await homeScenes(browser, url, dir) });
    if (pages.includes("search")) Object.assign(timings, { search: await searchScenes(browser, url, dir) });
    if (pages.includes("admin-control")) Object.assign(timings, { adminControl: await adminScenes(browser, url, dir, { SIZES, signIn, resume, median }) });
    if (pages.includes("shell")) Object.assign(timings, { shell: await shellScenes(browser, url, dir) });
    if (pages.includes("staff-directory")) Object.assign(timings, { staffDirectory: await directoryScenes(browser, url, dir) });
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
