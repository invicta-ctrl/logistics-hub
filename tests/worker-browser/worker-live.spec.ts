import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;

async function signIn(page: Page) {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
}

test("public Lending Hub fails closed on freshly migrated data", async ({ page, request }) => {
  const catalog = await (await request.get("/api/public/catalog")).json() as { items: unknown[] };
  expect(catalog.items).toEqual([]);
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "No items are open for borrowing yet" })).toBeVisible();
});

test("staff pages and every staff write reject anonymous and cross-site callers", async ({ page, request, baseURL }) => {
  await page.goto("/staff/items");
  await expect(page).toHaveURL(/\/staff$/);
  const write = { data: { kind: "IN", quantity: 50, key: "anonymous-attempt" }, headers: { origin: baseURL! } };
  expect((await request.post("/api/staff/items/ITM-0072/movements", write)).status()).toBe(401);
  expect((await request.patch("/api/staff/items/ITM-0072", { data: {}, headers: { origin: baseURL! } })).status()).toBe(401);
  expect((await request.post("/api/staff/items", { data: {}, headers: { origin: baseURL! } })).status()).toBe(401);
  await signIn(page);
  const crossSite = await page.request.post("/api/staff/items/ITM-0072/movements", { data: { kind: "IN", quantity: 50, key: "cross-site-attempt" }, headers: { origin: "https://evil.example" } });
  expect(crossSite.status()).toBe(403);
  await expect(page.getByRole("button", { name: "Bluetooth Microphone" })).toBeVisible();
});

test("preserves the ITM-0001 reconciliation evidence", async ({ page }) => {
  await signIn(page);
  await page.getByRole("searchbox", { name: "Search items" }).fill("ITM-0001");
  await page.getByRole("button", { name: "Detergent Bar" }).click();
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("7");
  await expect(page.locator("#stock-form")).toContainText("blocks on hand");
  await expect(page.locator("#panel-overview")).toContainText("legacy snapshot reported 8 blocks, but the migrated movement ledger derives 7");
  await expect(page).toHaveURL(/item=ITM-0001/);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Detergent Bar" })).toBeVisible();
});

test("staff publish and stock changes reach an open public page live", async ({ page, browser }) => {
  test.setTimeout(90_000); // waits on real 15-second public polling cycles
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/lending");
  await expect(visitor.getByRole("heading", { name: "No items are open for borrowing yet" })).toBeVisible();

  await signIn(page);
  await page.getByRole("searchbox", { name: "Search items" }).fill("Bluetooth Microphone");
  await page.getByRole("button", { name: "Bluetooth Microphone" }).click();
  await page.getByRole("tab", { name: "Review & edit" }).click();
  await page.getByLabel("Shown to").selectOption("STUDENTS_AND_USC_STAFF");
  await page.getByLabel("Details reviewed and verified").check();
  await expect(page.getByText(/Will appear on the public Lending Hub/)).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();

  await expect(visitor.getByText("Bluetooth Microphone")).toBeVisible({ timeout: 25_000 });
  await expect(visitor.locator(".catalogue__row", { hasText: "Bluetooth Microphone" }).locator(".avail")).toHaveText("1 left");

  await expect(page.getByRole("tab", { name: "Edit details" })).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Listed on the Lending Hub" })).toBeVisible();
  // The figure itself is the editor; a change needs a reason before it saves.
  const total = page.getByLabel("Quantity on hand");
  await expect(total).toHaveValue("1");
  await total.fill("5");
  await expect(page.locator("#stock-change")).toContainText("+4 1 → 5");
  await page.getByRole("button", { name: "Add 4" }).click();
  await expect(page.locator("#stock-form").getByRole("alert")).toHaveText("Choose a reason.");
  await page.getByRole("radio", { name: "New stock received" }).check();
  await page.getByRole("button", { name: "Add 4" }).click();
  await expect(page.getByText("Bluetooth Microphone: 1 → 5 pieces (new stock received).")).toBeVisible();
  await expect(total).toHaveValue("5");
  await total.fill("-9");
  await expect(page.locator("#stock-change")).toContainText("Only 5 on hand; it cannot go below 0.");
  await total.press("Escape");
  await expect(total).toHaveValue("5");

  await expect(visitor.getByText("5 pieces available")).toBeVisible({ timeout: 25_000 });
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history li").first()).toContainText("Stock in");
  await expect(page.locator("#history li").first()).toContainText("E2E Staff");
});

test("sign out revokes the session", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
  expect((await page.request.get("/api/staff/session")).status()).toBe(401);
  await page.goto("/staff/items");
  await expect(page).toHaveURL(/\/staff$/);
});

test("inventory sorts by on-hand quantity and remembers it in the URL", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "On hand" }).click();
  await expect(page.getByRole("columnheader", { name: "On hand" })).toHaveAttribute("aria-sort", "descending");
  await expect(page).toHaveURL(/sort=onHand-desc/);
  const quantities = await page.locator("tbody .qty").evaluateAll((cells) => cells.slice(0, 5).map((cell) => Number(cell.textContent)));
  expect(quantities).toEqual([...quantities].sort((a, b) => b - a));
});

test.describe("owner administration", () => {
  async function signInAs(page: Page, user: string, pass: string) {
    await page.goto("/staff");
    await page.getByRole("textbox", { name: "Username" }).fill(user);
    await page.getByLabel("Password", { exact: true }).fill(pass);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  test("owner creates a staff account; the new user must choose a password; staff cannot administer", async ({ page, browser }) => {
    await signInAs(page, process.env.E2E_OWNER_USERNAME!, process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("link", { name: "Administration" }).click();
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await page.getByRole("button", { name: "New account" }).click();
    await page.getByLabel("Display name").fill("Maria Santos");
    await page.getByLabel("Username").fill("msantos");
    await page.getByRole("button", { name: "Create account" }).click();
    const temporary = (await page.locator(".secret code").textContent())!;
    expect(temporary).toMatch(/^[\w]{5}(-[\w]{5}){3}$/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("cell", { name: /Maria Santos/ })).toBeVisible();

    const staff = await (await browser.newContext()).newPage();
    await signInAs(staff, "msantos", temporary);
    await expect(staff.getByText("Choose your own password to continue.")).toBeVisible();
    await expect(staff.getByRole("link", { name: "Items" })).toHaveCount(0);
    expect((await staff.request.get("/api/staff/inventory")).status()).toBe(403);
    await staff.getByLabel("Current password").fill(temporary);
    await staff.getByLabel("New password", { exact: true }).fill("maria chose this one");
    await staff.getByLabel("Repeat new password").fill("maria chose this one");
    await staff.getByRole("button", { name: "Change password" }).click();
    await expect(staff.getByRole("heading", { name: "Items" })).toBeVisible();
    await expect(staff.getByRole("link", { name: "Administration" })).toHaveCount(0);
    expect((await staff.request.get("/api/staff/admin/accounts")).status()).toBe(403);
    await staff.goto("/staff/admin");
    await expect(staff).toHaveURL(/\/staff\/items$/);
  });

  test("owner closes and reopens Self-Service from Administration, and phones see it at once", async ({ page, request }) => {
    await signInAs(page, process.env.E2E_OWNER_USERNAME!, process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("link", { name: "Administration" }).click();
    // The owner's retention check answers from the real database: a fresh one has nothing due.
    await expect(page.getByRole("region", { name: "Old personal details" }).getByText("Nothing is old enough to remove yet.")).toBeVisible();
    const section = page.getByRole("region", { name: "Self-Service on phones" });
    await expect(section.getByText("Open", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Test Self-Service" })).toHaveCount(0);
    expect((await request.get("/api/self-service/catalog")).status()).toBe(200);
    page.once("dialog", (dialog) => dialog.accept());
    await section.getByRole("button", { name: "Close for maintenance" }).click();
    await expect(section.getByText("Closed for maintenance")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Test Self-Service" })).toBeVisible();
    expect((await request.get("/api/self-service/catalog")).status()).toBe(503);
    page.once("dialog", (dialog) => dialog.accept());
    await section.getByRole("button", { name: "Reopen Self-Service" }).click();
    await expect(section.getByText("Open", { exact: true })).toBeVisible();
    expect((await request.get("/api/self-service/catalog")).status()).toBe(200);
    await expect(page.locator("#activity")).toContainText("closed Self-Service for maintenance");
    await expect(page.locator("#activity")).toContainText("reopened Self-Service");
  });

  test("owner imports a sample ID pair; the scans stay private, audited and out of every cache", async ({ page, browser }) => {
    // The live Worker sends the real Content-Security-Policy, which drops inline style attributes: nothing may rely on one.
    const violations: string[] = [];
    page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
    await signInAs(page, process.env.E2E_OWNER_USERNAME!, process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("link", { name: "Administration" }).click();
    await page.getByRole("link", { name: "Staff Directory" }).click();
    await expect(page.getByRole("heading", { name: "Staff Directory" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The directory is empty" })).toBeVisible();
    // A fictional card drawn on a canvas: no real ID is ever used in tests. Portrait, so its shape must reach the page.
    const sample = (side: string) => page.evaluate((text) => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 540, height: 856 });
      const c = canvas.getContext("2d")!;
      c.fillStyle = "#f7f3ea"; c.fillRect(0, 0, 540, 856);
      c.fillStyle = "#7a1419"; c.fillRect(0, 0, 540, 90);
      c.fillStyle = "#1c1917"; c.font = "48px sans-serif"; c.fillText(`SAMPLE ${text}`, 40, 300);
      return canvas.toDataURL("image/png").split(",")[1]!;
    }, side);
    await page.getByRole("button", { name: "Import ID scans" }).click();
    await page.locator("#import-files").setInputFiles([
      { name: "Rivera_Front_DoL.png", mimeType: "image/png", buffer: Buffer.from(await sample("FRONT"), "base64") },
      { name: "Rivera_Back_DoL.png", mimeType: "image/png", buffer: Buffer.from(await sample("BACK"), "base64") },
      { name: "Lone_Front_DoL.png", mimeType: "image/png", buffer: Buffer.from(await sample("LONE"), "base64") }
    ]);
    await expect(page.getByText("Ready to import (1)")).toBeVisible();
    await expect(page.getByText("Lone (DoL) has a front but no back.")).toBeVisible();
    await page.getByRole("button", { name: "Import 1 pair" }).click();
    await expect(page.getByText("Finished: 1 pair imported.")).toBeVisible();
    // The import made the wall's thumbnail of the front in the browser: the wall shows it, privately and never cached.
    const thumb = page.waitForResponse((response) => /\/id\/thumb$/.test(response.url()));
    await page.getByRole("button", { name: "Done" }).click();
    expect((await thumb).status()).toBe(200);
    expect((await thumb).headers()["cache-control"]).toBe("private, no-store");
    // Rivera's card opens on the profile, both sides of the ID together; Details holds the rest, and Full profile goes there.
    await page.getByRole("link", { name: /Rivera/ }).click();
    const opened = page.getByRole("dialog", { name: "USC ID of Rivera" });
    await expect(opened.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-pressed", "true");
    await expect(opened.getByRole("img", { name: "Back of Rivera's USC ID" })).toBeVisible();
    await page.keyboard.press("d");
    await expect(opened.getByRole("heading", { name: "Rivera" })).toBeVisible();
    await opened.getByRole("link", { name: "Full profile" }).click();
    await expect(opened).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Rivera", level: 1 })).toBeVisible();
    const scan = page.waitForResponse((response) => /\/id\/front$/.test(response.url()));
    await page.getByRole("tab", { name: "USC ID" }).click();
    const response = await scan;
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const tile = (await page.getByRole("button", { name: "Open the front of the USC ID large" }).boundingBox())!;
    expect(tile.height / tile.width).toBeCloseTo(856 / 540, 1);
    await page.getByRole("button", { name: "Open the front of the USC ID large" }).click();
    const viewer = page.getByRole("dialog", { name: "USC ID of Rivera" });
    await expect(viewer.getByRole("img", { name: "Front of Rivera's USC ID" })).toBeVisible();
    await page.keyboard.press("d");
    await expect(viewer.getByRole("button", { name: "Details" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    // Closing gives back the viewer's own history entry; reload only once that navigation has finished.
    await page.waitForFunction(() => !window.history.state?.viewer && new URLSearchParams(window.location.search).get("tab") === "id");
    await page.reload();
    await expect(page.locator(".access-log")).toContainText("E2E Owner");
    expect(violations).toEqual([]);
    // Nothing of the directory is kept by the service worker, and the bucket has no public address.
    const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))).flat());
    expect(cached.filter((url) => url.includes("/api/"))).toEqual([]);
    const staff = await (await browser.newContext()).newPage();
    expect((await staff.request.get(response.url())).status()).toBe(401);
    await signInAs(staff, username, password);
    await expect(staff.getByRole("heading", { name: "Items" })).toBeVisible();
    expect((await staff.request.get(response.url())).status()).toBe(403);
    await staff.goto("/staff/admin/directory");
    await expect(staff).toHaveURL(/\/staff\/items$/);
  });

  test("owner makes a sign-in from a directory profile and watches it being used", async ({ page, browser }) => {
    await signInAs(page, process.env.E2E_OWNER_USERNAME!, process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("link", { name: "Administration" }).click();
    await page.getByRole("link", { name: "Staff Directory" }).click();
    await page.getByRole("button", { name: "Add person" }).first().click();
    await page.getByLabel("Full name").fill("Lia Ventura");
    await page.getByRole("combobox", { name: "Department", exact: true }).selectOption("DoL");
    await page.getByRole("button", { name: "Add person" }).last().click();
    await expect(page.getByRole("heading", { name: "Lia Ventura", level: 1 })).toBeVisible();
    const access = page.getByRole("region", { name: "Sign-in and access" });
    await expect(access.getByLabel("Username")).toHaveValue("lia.ventura");
    await access.getByRole("button", { name: "Create sign-in" }).click();
    const temporary = (await access.locator(".secret code").textContent())!;
    expect(temporary).toMatch(/^[\w]{5}(-[\w]{5}){3}$/);
    await access.getByRole("button", { name: "Done" }).click();
    await expect(access.getByText("Never", { exact: true })).toBeVisible();
    await expect(page.locator(".person-head .tags")).toContainText("Signs in as lia.ventura");

    const lia = await (await browser.newContext()).newPage();
    await signInAs(lia, "lia.ventura", temporary);
    await expect(lia.getByText("Choose your own password to continue.")).toBeVisible();

    await page.reload();
    await expect(access.getByText("On 1 device")).toBeVisible();
    await expect(access.locator(".access-log").first()).toContainText("signed in now");
    page.once("dialog", (dialog) => dialog.accept());
    await access.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(access.getByText("Nowhere")).toBeVisible();
    await expect(access.locator(".access-log").last()).toContainText("signed lia.ventura out everywhere");
    expect((await lia.request.get("/api/staff/session")).status()).toBe(401);
  });

  test("owner issues a recovery key that resets the owner password exactly once", async ({ page, baseURL }) => {
    await signInAs(page, process.env.E2E_OWNER_USERNAME!, process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("link", { name: "My account" }).click();
    await page.getByRole("button", { name: /recovery key/ }).first().click();
    const key = (await page.locator(".secret code").textContent())!;
    expect(key).toMatch(/^LHR1\./);
    const recover = (newPassword: string) => page.request.post("/api/recovery/owner", { headers: { origin: baseURL! }, data: { recoveryKey: key, newPassword } });
    const first = await recover("recovered owner pass");
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({ username: process.env.E2E_OWNER_USERNAME });
    expect((await recover("second attempt pass!")).status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(/\/staff$/);
    await signInAs(page, process.env.E2E_OWNER_USERNAME!, "recovered owner pass");
    await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
  });
});

test("migrated review: fill the gaps, mark reviewed, and move to the next record", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /^Needs review/ }).click();
  await expect(page).toHaveURL(/view=review/);
  const reviewedBefore = Number((await page.locator("#review-meter strong").textContent())!.replace(/\D/g, ""));
  // Other suites may add items; the meter counts every record.
  const total = Number(/of ([\d,]+) records/.exec((await page.locator("#review-meter").textContent())!)![1]!.replace(/,/g, ""));
  const first = (await page.locator("tbody .row-link").first().textContent())!;
  const second = (await page.locator("tbody .row-link").nth(1).textContent())!;
  await page.locator("tbody .row-link").first().click();
  await page.getByRole("button", { name: "Review details" }).click();
  const sheet = page.getByRole("dialog");
  // Staff choose a place instead of typing one; a place that does not exist yet is made on the spot.
  await sheet.getByRole("button", { name: "New place" }).click();
  await sheet.getByLabel("Name of the new place").fill("E2E shelf  A");
  await sheet.getByRole("button", { name: "Add place" }).click();
  await expect(page.getByText("Place added.")).toBeVisible();
  await expect(sheet.getByRole("combobox", { name: /^Place/ })).toHaveValue(/^LOC-\d{4}$/);
  await sheet.getByLabel("Other names").fill("e2e alias, E2E ALIAS");
  await sheet.getByLabel("Borrow or consume").selectOption("Consume (Consumable)");
  // Choosing it lists the item, so staff do not set the audience separately.
  await expect(sheet.getByLabel("Shown to")).toHaveValue("STUDENTS_AND_USC_STAFF");
  await page.getByRole("button", { name: /Mark reviewed & next/ }).click();
  await expect(page.getByText(`${first} reviewed. Opening the next record.`)).toBeVisible();
  await expect(page.getByRole("dialog", { name: second })).toBeVisible();
  await expect(page.locator("#review-meter")).toContainText(`${reviewedBefore + 1} of ${total} records reviewed`);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^All items/ }).click();
  await page.getByRole("searchbox", { name: "Search items" }).fill("e2e alias");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search items" }).fill("");
  await page.getByLabel("Place", { exact: true }).selectOption({ label: "E2E shelf A" });
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.locator("tbody .row-link").first().click();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history li").first()).toContainText("Review completed");
  await expect(page.locator("#history li").first()).toContainText("Place Not set → E2E shelf A");
  await expect(page.locator("#history")).not.toContainText("{");
});

test("create, warn on a duplicate name, then deactivate without deleting", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New item" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill("detergent bar");
  await expect(page.getByText("ITM-0001 already uses this name.")).toBeVisible();
  await sheet.getByLabel("Name", { exact: true }).fill("E2E Extension Cord");
  await sheet.getByLabel("Category", { exact: true }).fill("office equipment and supplies");
  await sheet.getByLabel("Unit", { exact: true }).fill("piece");
  await expect(sheet.getByLabel("Shown to")).toHaveValue("STUDENTS_AND_USC_STAFF");
  await expect(sheet.getByLabel("Borrow or consume").locator("option")).toHaveText(["Borrow (Loanable)", "Consume (Consumable)"]);
  await sheet.getByLabel("Borrow or consume").selectOption("Borrow (Loanable)");
  await sheet.getByLabel("Opening quantity").fill("3");
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page.getByText(/Item ITM-\d+ created\./)).toBeVisible();
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("3");
  await expect(page.locator(".profile__meta").first()).toContainText("Office Equipment and Supplies");

  await page.getByRole("tab", { name: "Edit details" }).click();
  await sheet.getByLabel("Status", { exact: true }).selectOption("INACTIVE");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Inactive/ }).click();
  await expect(page.getByRole("button", { name: "E2E Extension Cord" })).toBeVisible();
});

/** The account button and every shown section link lie inside the viewport (the root clips sideways overflow). */
const onScreen = () => [...document.querySelectorAll(".account, .app-nav__link")].every((element) => {
  const box = element.getBoundingClientRect();
  return box.width === 0 || (box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight);
});

test("phones get the daily sections in a bottom bar and the rest under More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page);
  const sections = page.getByRole("navigation", { name: "Sections" });
  for (const name of ["Items", "Stock", "Loans", "Self-Service"]) await expect(sections.getByRole("link", { name })).toBeVisible();
  await expect(sections.getByRole("link", { name: "Activity" })).toBeHidden();
  const bar = (await sections.boundingBox())!;
  expect(bar.y + bar.height).toBeCloseTo(800, 0);
  expect(bar.height).toBeGreaterThanOrEqual(44);
  const more = sections.getByRole("button", { name: "More" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const menu = page.locator("#staff-menu");
  await expect(menu.getByRole("link", { name: "My account" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await menu.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.locator("#staff-menu")).toBeHidden();
  // Choosing the page already shown still closes the menu.
  await more.click();
  await menu.getByRole("link", { name: "Activity" }).click();
  await expect(menu).toBeHidden();
  // The last control on the page scrolls clear of the bottom bar when it takes focus (WCAG 2.4.11).
  await expect(page.locator(".activity-row").first()).toBeVisible();
  const last = await page.locator("#main-content").locator("button:visible, a:visible").last().elementHandle();
  await last!.focus();
  const box = (await last!.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(800 - bar.height);
  // On desktop every section is in the top bar and More is gone.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sections.getByRole("link", { name: "Activity" })).toBeVisible();
  await expect(more).toBeHidden();
});

test("staff workspace fits a 320 px phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await signIn(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  // The item-name button in each row is at least 24 px tall (WCAG 2.2 target size minimum).
  expect((await page.locator("tbody .row-link").first().boundingBox())!.height).toBeGreaterThanOrEqual(24);
  // At 200% text the account button, every section and the page's primary action stay reachable on screen.
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(onScreen)).toBeTruthy();
  expect(await page.evaluate(() => document.querySelector("#new-item")!.getBoundingClientRect().right <= window.innerWidth)).toBeTruthy();
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.locator("tbody .row-link").first().click();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("stock workspace: record a delivery, restock and receive, then read it in activity", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Stock" }).click();
  await expect(page.getByRole("heading", { name: "Stock", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Needs attention/ })).toBeVisible();

  const panel = page.locator("#record-panel");
  await panel.getByLabel("Item", { exact: true }).fill("Bond Paper - A4 · ITM-0135");
  await expect(panel.locator("#record-card")).toContainText("0 reams on hand");
  await panel.getByLabel("Quantity on hand").fill("+12");
  await expect(panel.locator("#record-change")).toContainText("+12 0 → 12");
  await panel.getByRole("button", { name: "Add 12" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Choose a reason.");
  await panel.getByRole("radio", { name: "New stock received" }).check();
  await panel.getByRole("button", { name: "Add 12" }).click();
  await expect(page.getByText("Bond Paper - A4: 0 → 12 reams (new stock received).")).toBeVisible();
  await expect(panel.locator("#receipts")).toContainText("+12 Bond Paper - A4");
  await expect(panel.getByLabel("Item", { exact: true })).toBeFocused();

  const ketchup = page.locator("tr", { hasText: "Banana Ketchup" });
  await ketchup.getByRole("button", { name: "Add to restock" }).click();
  await expect(page.getByText("Banana Ketchup added to the restock list.")).toBeVisible();
  await page.getByRole("button", { name: /^Restock list/ }).click();
  const entry = page.locator("tr", { hasText: "Banana Ketchup" });
  await entry.getByRole("button", { name: "Mark planned" }).click();
  await expect(entry.getByText("Planned", { exact: true })).toBeVisible();
  await entry.getByRole("button", { name: "Receive" }).click();
  await expect(panel.getByText("Receiving the restock of Banana Ketchup.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "New stock received" })).toBeHidden();
  await panel.getByLabel("Quantity on hand").fill("6");
  await expect(panel.getByRole("radio", { name: "New stock received" })).toBeChecked();
  await panel.getByRole("button", { name: "Add 6" }).click();
  await expect(page.getByText("Banana Ketchup: 0 → 6 bottles (new stock received).")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Restock list 0/ })).toBeVisible();
  await expect(page.getByText("Closed in the last two weeks")).toBeVisible();

  await page.getByRole("button", { name: /^Activity/ }).click();
  const latest = page.locator(".activity-row").first();
  await expect(latest).toContainText("+6");
  await expect(latest).toContainText("Banana Ketchup · Stock in · New stock received");
  await expect(latest).toContainText("0 → 6 bottles · E2E Staff");
});

test("counting records the observed quantity, and pantry lists the catalog's pantry items", async ({ page }) => {
  await signIn(page);
  await page.goto("/staff/stock?show=count");
  const flour = page.locator("tr", { hasText: "All Purpose Flour" });
  await flour.getByRole("button", { name: "Count" }).click();
  const panel = page.locator("#record-panel");
  await expect(panel.getByRole("radio", { name: "Physical count" })).toBeChecked();
  await expect(panel.getByRole("button", { name: "Confirm count" })).toBeVisible();
  await panel.getByLabel("Quantity on hand").fill("18");
  await expect(panel.getByRole("radio", { name: "Physical count" })).toBeChecked();
  await expect(panel.locator("#record-change")).toContainText("→ 18");
  await panel.getByRole("button", { name: "Save count of 18" }).click();
  await expect(page.getByText(/All Purpose Flour: \d+ → 18 kilos \(physical count\)\./)).toBeVisible();
  await expect(page.locator("tr", { hasText: "All Purpose Flour" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Pantry/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.locator("tr", { hasText: "All Purpose Flour" })).toContainText("18 kilos");
  await page.getByRole("button", { name: /^Activity/ }).click();
  await expect(page.locator(".activity-row").first()).toContainText("Count correction");
});

test("stock workspace on a 320 px phone records through a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await signIn(page);
  await page.goto("/staff/stock");
  await expect(page.getByRole("heading", { name: "Stock", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole("button", { name: "Update stock" }).click();
  const sheet = page.getByRole("dialog", { name: "Update stock" });
  await expect(sheet.getByLabel("Item", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("lend for individual and USC use with a photo, return one damaged, and read the dashboard", async ({ page }) => {
  const photo = "public/brand/ydd-2026-banner.jpg";
  await signIn(page);
  await page.goto("/staff/items?item=ITM-0262");
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("10");
  await page.getByRole("tab", { name: "Loan" }).click();
  const form = page.locator("#loan-form");
  await form.getByLabel("Borrower's full name").fill("Test Borrower One");
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(form.getByRole("alert")).toHaveText("Enter the borrower's student ID number.");
  await form.getByLabel(/Student ID number/).fill("test-0001");
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(form.getByRole("alert")).toHaveText("Add a photo of the hand-over.");
  await form.locator("input[type=file]").setInputFiles(photo);
  await expect(form.getByRole("img", { name: "Photo to attach" })).toBeVisible();
  await form.getByRole("button", { name: "One more" }).click();
  await form.getByRole("button", { name: "Lend 2 pieces" }).click();
  await expect(page.getByText("Lent 2 pieces of Scissors to Test Borrower One.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Loan · 1 out" })).toBeVisible();

  await form.getByRole("radio", { name: "USC use" }).check();
  await form.getByLabel("Name of the person using it").fill("Test Officer");
  await form.locator("input[type=file]").setInputFiles(photo);
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(form.getByRole("alert")).toHaveText("Give the specific reason for USC use.");
  await form.getByLabel("Specific reason").fill("Banner cutting for the general assembly");
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(page.getByText("Lent 1 piece of Scissors to Test Officer.")).toBeVisible();
  await expect(page.locator("#item-loans")).toContainText("Test Borrower One");
  await expect(page.locator("#item-loans")).toContainText("TEST-0001");
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("7");
  await expect(page.locator("#quantity-context")).toContainText("3 more on loan");
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history li").first()).toContainText("Lent out · Test Officer");
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Loans" }).click();
  await expect(page.getByRole("heading", { name: "Loans", level: 1 })).toBeVisible();
  await expect(page.locator("#loans-summary")).toContainText("2 loans out · 3 items");
  const row = page.locator(".loan-row", { hasText: "Test Borrower One" });
  await row.getByRole("button", { name: "Return" }).click();
  const dialog = page.getByRole("dialog", { name: "Scissors" });
  await expect(dialog.getByRole("img", { name: /Photo taken when it was lent/ })).toBeVisible();
  await dialog.getByRole("radio", { name: "Damaged" }).check();
  await dialog.getByRole("button", { name: "Mark damaged" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Describe the damage.");
  await dialog.getByLabel(/What happened/).fill("One blade bent");
  await dialog.getByRole("button", { name: "Mark damaged" }).click();
  await expect(page.getByText("Scissors marked damaged.")).toBeVisible();
  await expect(page.locator("#loans-summary")).toContainText("1 loan out · 1 item");

  await page.getByRole("button", { name: /^Borrowers/ }).click();
  await expect(page.getByRole("heading", { name: "Individual use" })).toBeVisible();
  const individual = page.locator(".leaderboard", { has: page.getByRole("heading", { name: "Individual use" }) });
  await expect(individual).toContainText("Test Borrower One");
  await expect(individual).toContainText("1 damaged or lost");
  const usc = page.locator(".leaderboard", { has: page.getByRole("heading", { name: "USC use" }) });
  await expect(usc).toContainText("Test Officer");
  await expect(usc).toContainText("1 out now");
  await page.getByRole("button", { name: /^Returned/ }).click();
  await expect(page.locator(".loan-row").first()).toContainText("One blade bent");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("activity: one list of who did what, filters kept in the URL, older pages, and no borrower identity in search", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
  // Staff never get account and security entries; that source is not even offered.
  await expect(page.getByRole("button", { name: "Accounts & exports" })).toHaveCount(0);
  await expect(page.locator("#activity-count")).toHaveText("50 entries shown, older ones below");
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.locator("#activity-count")).toHaveText("100 entries shown, older ones below");
  await expect(page.getByRole("button", { name: "Load older" })).toBeFocused();

  // The lending test's damaged return shows with its typed note, and its USC reason is searchable.
  const search = page.getByRole("searchbox", { name: "Search activity" });
  await search.fill("blade bent");
  await expect(page).toHaveURL(/q=blade\+bent/);
  await expect(page.locator(".activity-row")).toHaveCount(1);
  await expect(page.locator(".activity-row")).toContainText("closed a loan of Scissors as damaged");
  await expect(page.locator(".activity-row")).toContainText("Note: One blade bent");
  await search.fill("Banner cutting");
  await expect(page.locator(".activity-row").first()).toContainText("lent 1 piece of Scissors for USC use");
  // The structured borrower name and student ID are never searched.
  for (const identity of ["Test Borrower One", "TEST-0001"]) {
    await search.fill(identity);
    await expect(page.getByRole("heading", { name: "Nothing matches" })).toBeVisible();
  }

  await search.fill("");
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.locator(".activity-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Loans", exact: true }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByLabel("Type").selectOption("LOAN_OUT");
  await sheet.getByRole("button", { name: "Show results" }).click();
  await expect(page).toHaveURL(/source=LOAN&type=LOAN_OUT/);
  // Every entry is a loan going out (phones lend too); the two Scissors loans are among them.
  const lent = async () => {
    await expect(page.locator(".activity-row", { hasText: "lent 1 piece of Scissors for USC use" })).toHaveCount(1);
    await expect(page.locator(".activity-row", { hasText: "lent 2 pieces of Scissors to an individual" })).toHaveCount(1);
    await expect(page.locator(".activity-row").filter({ hasNotText: / lent \d+ \S+ of / })).toHaveCount(0);
  };
  await lent();
  await expect(page.getByRole("button", { name: "Remove filter: Type: Lent" })).toBeVisible();
  // A shared link restores the same question.
  await page.reload();
  await lent();
  await page.getByRole("button", { name: "Remove filter: Type: Lent" }).click();
  await expect(page).toHaveURL(/\/staff\/activity\?source=LOAN$/);

  // An entry opens its item; the item's history leads back to its activity.
  await page.locator(".activity-row__summary").first().click();
  await expect(page.getByRole("dialog", { name: "Scissors" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByRole("link", { name: /All activity for this item/ }).click();
  await expect(page).toHaveURL(/item=ITM-0262/);
  await expect(page.getByRole("button", { name: "Remove filter: Item: Scissors" })).toBeVisible();

  for (const width of [320, 375, 390, 768, 1024, 1366, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `activity at ${width}`).toBeTruthy();
    // The root clips sideways overflow, so also check that the account button and every section stay on screen.
    expect(await page.evaluate(onScreen), `app bar at ${width}`).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("dialog", { name: "Filters" }).getByLabel("Type")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeHidden();
});

test("activity export: the filtered list as a safe CSV file, audited for the owner to see", async ({ page, browser, baseURL }) => {
  await signIn(page);
  await page.goto("/staff/activity?q=blade+bent");
  await expect(page.locator(".activity-row")).toHaveCount(1);
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  expect(file.suggestedFilename()).toMatch(/^logistics-activity-\d{8}-\d{4}\.csv$/);
  const bytes = await (await import("node:fs/promises")).readFile((await file.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString("utf8").slice(1);
  const lines = text.split("\r\n");
  expect(lines[0]).toBe('"Time (Manila)","Activity","Description","Actor","Source","Item ID","Item","Unit","Change","Before","After","Reason","Note","Reference","Entry ID"');
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain('"Returned damaged","E2E Staff closed a loan of Scissors as damaged; nothing went back to stock.","E2E Staff","Loans","ITM-0262","Scissors"');
  // The page shows the typed damage note; the file leaves it blank (owner decision B(ii)), and never holds the borrower.
  for (const secret of ["One blade bent", "Test Borrower One", "TEST-0001"]) expect(text).not.toContain(secret);
  await expect(page.getByText("Exported 1 entry.")).toBeVisible();

  const owner = await (await browser.newContext()).newPage();
  // The owner administration tests above replace the owner's password with a recovery key; either one may be current.
  let signedIn = false;
  for (const password of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
    signedIn ||= (await owner.request.post("/api/staff/login", { headers: { origin: baseURL! }, data: { username: process.env.E2E_OWNER_USERNAME, password } })).ok();
  }
  expect(signedIn).toBe(true);
  await owner.goto("/staff/activity");
  await owner.getByRole("button", { name: "Accounts & exports" }).click();
  await expect(owner.locator(".activity-row", { hasText: "E2E Staff exported 1 activity entry to a file, filtered by search." })).toHaveCount(1);
  await expect(owner.locator("#activity-results")).not.toContainText("blade");
  // The owner's bar has the most sections (Administration too); it still fits from phone to desktop.
  for (const width of [320, 390, 768, 1024, 1180, 1281, 1366]) {
    await owner.setViewportSize({ width, height: 800 });
    expect(await owner.evaluate(onScreen), `owner app bar at ${width}`).toBeTruthy();
  }
});

test("open units: opt in, open, use, mark low, open another, mark empty, close by a count, and read it all in History and Activity", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New item" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill("E2E Copy Paper");
  await sheet.getByLabel("Category", { exact: true }).fill("school supplies");
  await sheet.getByLabel("Unit", { exact: true }).fill("ream");
  await expect(sheet.getByLabel("How is this item normally used?")).toBeHidden();
  await sheet.getByLabel("Borrow or consume").selectOption("Consume (Consumable)");
  await sheet.getByLabel("Shown to").selectOption("NOT_AVAILABLE_FOR_LENDING");
  // Every item starts as Whole unit; staff opt in.
  await expect(sheet.getByLabel("How is this item normally used?")).toHaveValue("WHOLE_UNIT");
  await sheet.getByLabel("How is this item normally used?").selectOption("OPEN_UNIT");
  await sheet.getByLabel("Opening quantity").fill("8");
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("8");

  const units = sheet.locator("#open-units");
  await expect(units).toContainText("8 reams on hand · 8 sealed · 0 open");
  await units.getByRole("button", { name: "Open a ream" }).click();
  await expect(page.getByText("E2E Copy Paper: ream opened. Stock unchanged.")).toBeVisible();
  await expect(units).toContainText("7 sealed · 1 open");
  await units.getByRole("button", { name: "Record use" }).click();
  await expect(page.getByText("Use recorded for E2E Copy Paper. Stock unchanged.")).toBeVisible();
  await units.getByRole("button", { name: "Low", exact: true }).click();
  await expect(units.getByRole("button", { name: "Low", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.locator("#quantity-context")).toContainText("7 sealed · 1 open · Low");
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("8");

  // Changing how it is used is refused while a unit is open.
  await page.getByRole("tab", { name: "Edit details" }).click();
  await sheet.getByLabel("How is this item normally used?").selectOption("WHOLE_UNIT");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet.locator("#details-alert")).toContainText("This item has open units");
  await sheet.getByLabel("How is this item normally used?").selectOption("OPEN_UNIT");
  await page.getByRole("tab", { name: "Overview" }).click();

  // A second unit is allowed, after a warning.
  await units.getByRole("button", { name: "Open another ream" }).click();
  await expect(units).toContainText("1 ream is already open. Use the existing ream when possible.");
  await units.getByRole("button", { name: "Open another", exact: true }).click();
  await expect(units).toContainText("6 sealed · 2 open");

  // Mark empty: an inline confirmation, then exactly one ream off.
  await units.locator(".open-unit").first().getByRole("button", { name: "Mark empty" }).click();
  await expect(units.locator(".inline-confirm")).toContainText("This will reduce on-hand stock from 8 to 7 reams.");
  await expect(units.locator(".inline-confirm").getByRole("button", { name: "Mark empty" })).toBeFocused();
  await units.locator(".inline-confirm").getByRole("button", { name: "Mark empty" }).click();
  await expect(page.getByText("Marked empty. 7 reams on hand.")).toBeVisible();
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("7");
  await expect(units).toContainText("6 sealed · 1 open");

  // A count below the open units must close them in the same save.
  await page.getByLabel("Quantity on hand").fill("0");
  await sheet.getByRole("radio", { name: "Physical count" }).check();
  await sheet.getByRole("button", { name: "Save count of 0" }).click();
  await expect(sheet.locator("#stock-form").getByRole("alert")).toContainText("Tick the box");
  await sheet.getByLabel(/Also close 1 open ream/).check();
  await sheet.getByRole("button", { name: "Save count of 0" }).click();
  await expect(page.getByText("E2E Copy Paper: 7 → 0 reams (physical count).")).toBeVisible();
  await expect(units).toContainText("0 reams on hand · 0 sealed · 0 open");
  await expect(units.getByRole("button", { name: "Open a ream" })).toBeDisabled();

  await page.getByRole("tab", { name: "History" }).click();
  const history = sheet.locator("#history");
  for (const line of ["Count closed 1 open unit", "Open unit marked empty", "Another unit opened (1 already open)", "Open unit marked low", "Use recorded", "Unit opened"]) {
    await expect(history).toContainText(line);
  }
  const id = (await page.locator(".sheet__kicker .mono").textContent())!;
  await page.goto(`/staff/activity?item=${id}`);
  const rows = page.locator(".activity-row");
  await expect(rows).toHaveCount(9);
  await expect(rows.nth(1)).toContainText("E2E Staff's count closed 1 open ream of E2E Copy Paper no longer on the shelf.");
  await expect(rows.nth(2)).toContainText("E2E Staff marked an open ream of E2E Copy Paper empty: 7 reams on hand.");
  await expect(rows.nth(2)).toContainText("8 → 7 reams");
  // Opening, using and marking a condition are recorded and change nothing.
  for (const index of [3, 4, 5, 6]) await expect(rows.nth(index)).toContainText("stock did not change");

  // One-hand phone width: nothing scrolls sideways in the open sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/staff/items?item=${id}`);
  await expect(sheet.locator("#open-units")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("open units: the review view suggests whole-unit Consumables by their unit word and changes nothing", async ({ page }) => {
  await signIn(page);
  await page.goto("/staff/items?view=gradual");
  await expect(page.getByRole("button", { name: /^Used gradually\?/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Nothing changes here", { exact: false })).toBeVisible();
  const units = await page.locator("tbody .qty-unit").allTextContents();
  expect(units.length).toBeGreaterThan(0);
  for (const unit of units) expect(unit).toMatch(/^(reams?|box(es)?|bottles?|jars?|rolls?|packs?|cans?|tubs?|pouch(es)?|containers?)$/);
  // Already opened and used gradually (the test above), so not suggested again.
  await expect(page.locator("tbody")).not.toContainText("E2E Copy Paper");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

/** The committed banner with an EXIF block that says "rotate 90°" and carries a location string, as a phone camera would. */
function phonePhoto(orientation: number): Buffer {
  const banner = fs.readFileSync("public/brand/ydd-2026-banner.jpg");
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from("Exif\0\0"), tiff, Buffer.from("GPSLatitude=14.5995;GPSLongitude=120.9842")]);
  return Buffer.concat([banner.subarray(0, 2), Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body, banner.subarray(2)]);
}

test("item photos: add with a preview, view large, replace, remove, with the list and history following", async ({ page }) => {
  // Counts how often the page asks the browser for a view transition (the thumbnail growing into the viewer).
  await page.addInitScript(() => {
    (window as unknown as { transitions: number }).transitions = 0;
    const start = document.startViewTransition?.bind(document);
    if (start) document.startViewTransition = ((update: () => void) => { (window as unknown as { transitions: number }).transitions += 1; return start(update); }) as typeof document.startViewTransition;
  });
  const transitions = () => page.evaluate(() => (window as unknown as { transitions: number }).transitions);
  const measure = (url: string) => page.evaluate(async (target) => {
    const response = await fetch(target);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    return { width: bitmap.width, height: bitmap.height, bytes: blob.size, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"), text: await blob.text() };
  }, url);
  const detail = async () => (await (await page.request.get("/api/staff/items/ITM-0262")).json() as { item: { photo: { id: string; width: number; height: number } | null } }).item.photo;

  await signIn(page);
  await page.goto("/staff/items?item=ITM-0262");
  const sheet = page.getByRole("dialog", { name: "Scissors" });
  const panel = sheet.locator("#photo-panel");
  await expect(panel.getByRole("button", { name: "Add photo" })).toBeVisible();
  await expect(sheet.locator(".profile__stock")).toContainText("on hand");

  // Something that is not a picture is refused in words, and nothing is shown or saved.
  await panel.locator("input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await expect(panel.getByRole("alert")).toContainText("could not be read");
  await expect(panel.getByRole("button", { name: "Add photo" })).toBeVisible();
  expect(await detail()).toBeNull();

  // A photo taken sideways: the preview comes first, and Cancel saves nothing.
  await panel.locator("input[type=file]").setInputFiles({ name: "camera.jpg", mimeType: "image/jpeg", buffer: phonePhoto(6) });
  await expect(panel.getByRole("img", { name: "Preview of the new photo of Scissors" })).toBeVisible();
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByRole("button", { name: "Add photo" })).toBeVisible();
  expect(await detail()).toBeNull();
  await panel.locator("input[type=file]").setInputFiles({ name: "camera.jpg", mimeType: "image/jpeg", buffer: phonePhoto(6) });
  await panel.getByRole("button", { name: "Save photo" }).click();
  await expect(page.getByText("Photo saved.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "View photo of Scissors" })).toBeVisible();

  // Stored upright (960x356 landscape turned to portrait), small, clean and cached for a day; the original is never uploaded.
  const photo = (await detail())!;
  expect(photo.height).toBeGreaterThan(photo.width);
  expect(photo).toMatchObject({ width: 356, height: 960 });
  const display = await measure(`/api/staff/media/${photo.id}/display`);
  const thumb = await measure(`/api/staff/media/${photo.id}/thumb`);
  expect(display).toMatchObject({ width: 356, height: 960, type: "image/jpeg", cache: "private, max-age=86400" });
  expect(thumb).toMatchObject({ height: 320, type: "image/jpeg" });
  expect(thumb.bytes).toBeLessThan(display.bytes);
  expect(display.bytes).toBeLessThan(200_000);
  for (const stored of [display.text, thumb.text]) expect(stored).not.toMatch(/Exif|GPS|14\.5995/);

  // The viewer: opens over the profile with a view transition, closes with Escape, with Back, and with its button.
  const viewer = page.getByRole("dialog", { name: "Photo of Scissors" });
  const history = () => page.evaluate(() => window.history.length);
  // Closing the viewer hands its history entry back a moment later; a person never acts inside that moment, a test must wait for it.
  const settled = () => expect.poll(() => page.evaluate(() => !window.history.state?.viewer)).toBe(true);
  const before = await history();
  await panel.getByRole("button", { name: "View photo of Scissors" }).click();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Photo of Scissors" })).toBeVisible();
  expect(await viewer.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(356);
  expect(await transitions()).toBeGreaterThan(0);
  expect(await history()).toBe(before + 1);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect(panel.getByRole("button", { name: "View photo of Scissors" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => Boolean(window.history.state?.viewer))).toBe(false);
  await panel.getByRole("button", { name: "View photo of Scissors" }).click();
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toBeHidden();
  // Back closed only the viewer: the same page, with the same item open and not reloaded.
  await expect(page).toHaveURL(/\/staff\/items\?item=ITM-0262$/);
  await expect(sheet).toBeVisible();
  await expect(panel.getByRole("button", { name: "View photo of Scissors" })).toBeFocused();
  await panel.getByRole("button", { name: "View photo of Scissors" }).click();
  await viewer.getByRole("button", { name: "Close photo" }).click();
  await expect(viewer).toBeHidden();
  await settled();
  // With reduced motion the viewer opens at once, with no transition.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const count = await transitions();
  await panel.getByRole("button", { name: "View photo of Scissors" }).click();
  await expect(viewer).toBeVisible();
  expect(await transitions()).toBe(count);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await settled();
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // The list shows the small variant, only for rows near the screen, and the thumbnail opens the viewer too.
  await sheet.getByRole("button", { name: "Close" }).click();
  const row = page.locator('tr[data-key="ITM-0262"]');
  await expect(row.locator("img.thumb")).toHaveAttribute("src", `/api/staff/media/${photo.id}/thumb`);
  await expect(row.locator("img.thumb")).toHaveAttribute("loading", "lazy");
  await expect(row.locator("img.thumb")).toHaveCSS("width", "40px");
  // Decorative beside the name (the same photo opens from the profile), so screen readers hear the name once.
  expect(await row.locator("img.thumb").getAttribute("alt")).toBe("");
  await row.locator("img.thumb").click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await settled();
  await expect(page.locator("tr[data-key] .col-item--bare").first()).toBeVisible();
  expect(await page.locator("tr[data-key] img.thumb").count()).toBe(1);

  // Replace: a new photo takes the place, and the old address stops working.
  await row.getByRole("button", { name: "Scissors" }).click();
  await expect(panel.getByRole("button", { name: "Change photo" })).toBeVisible();
  // Opening the picker and walking away from it must leave the profile open (the picker's own cancel must not close the sheet).
  await panel.getByRole("button", { name: "Change photo" }).click();
  await page.waitForTimeout(500);
  await expect(sheet).toBeVisible();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), panel.getByRole("button", { name: "Change photo" }).click()]);
  await chooser.setFiles({ name: "upright.jpg", mimeType: "image/jpeg", buffer: phonePhoto(1) });
  await expect(panel.getByRole("img", { name: /Preview of the new photo/ })).toBeVisible();
  await panel.getByRole("button", { name: "Save photo" }).click();
  await expect(page.getByText("Photo saved.")).toBeVisible();
  const replaced = (await detail())!;
  expect(replaced.id).not.toBe(photo.id);
  expect(replaced.width).toBeGreaterThan(replaced.height);
  expect((await page.request.get(`/api/staff/media/${photo.id}/thumb`)).status()).toBe(404);
  await expect(row.locator("img.thumb")).toHaveAttribute("src", `/api/staff/media/${replaced.id}/thumb`);

  // Remove asks first; Keep changes nothing.
  await panel.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(panel.getByRole("group", { name: "Confirm" })).toContainText("Remove this photo?");
  await panel.getByRole("button", { name: "Keep" }).click();
  expect(await detail()).not.toBeNull();
  await panel.getByRole("button", { name: "Remove", exact: true }).click();
  await panel.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByText("Photo removed.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Add photo" })).toBeVisible();
  expect(await detail()).toBeNull();
  expect((await page.request.get(`/api/staff/media/${replaced.id}/display`)).status()).toBe(404);
  await expect(row.locator(".col-item--bare")).toBeVisible();

  // History and Activity read it as sentences.
  await sheet.getByRole("tab", { name: "History" }).click();
  const titles = await sheet.locator(".history__title").allTextContents();
  expect(titles.slice(0, 3)).toEqual(["Photo removed", "Photo replaced", "Photo added"]);
  await page.goto("/staff/activity?item=ITM-0262");
  await expect(page.locator(".activity-row").first()).toContainText("E2E Staff removed the photo of Scissors.");
  await expect(page.locator(".activity-row").nth(2)).toContainText("E2E Staff added a photo to Scissors.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("item photos: a photo someone else added meanwhile is never overwritten, and the profile shows theirs", async ({ page, baseURL }) => {
  await signIn(page);
  await page.goto("/staff/items?item=ITM-0263");
  const sheet = page.getByRole("dialog", { name: "Scotch Tape" });
  const panel = sheet.locator("#photo-panel");
  await expect(panel.getByRole("button", { name: "Add photo" })).toBeVisible();
  await panel.locator("input[type=file]").setInputFiles({ name: "mine.jpg", mimeType: "image/jpeg", buffer: phonePhoto(1) });
  await expect(panel.getByRole("img", { name: /Preview of the new photo/ })).toBeVisible();
  // Meanwhile a colleague adds one through the same endpoint.
  const small = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    canvas.getContext("2d")!.fillRect(0, 0, 64, 48);
    return canvas.toDataURL("image/jpeg").split(",")[1]!;
  });
  const theirs = await page.request.put("/api/staff/items/ITM-0263/photo", { headers: { origin: baseURL! }, multipart: {
    display: { name: "display.jpg", mimeType: "image/jpeg", buffer: Buffer.from(small, "base64") },
    thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: Buffer.from(small, "base64") }, expected: "" } });
  expect(theirs.status()).toBe(200);
  const theirId = (await theirs.json() as { photo: { id: string } }).photo.id;
  await panel.getByRole("button", { name: "Save photo" }).click();
  await expect(page.getByText(/Someone else changed this photo/)).toBeVisible();
  // Their photo is shown, mine is gone, and nothing of mine was stored.
  await expect(panel.getByRole("button", { name: "View photo of Scotch Tape" })).toBeVisible();
  await expect(panel.getByRole("img", { name: /Preview of the new photo/ })).toHaveCount(0);
  const item = await (await page.request.get("/api/staff/items/ITM-0263")).json() as { item: { photo: { id: string } } };
  expect(item.item.photo.id).toBe(theirId);
  await expect(panel.getByRole("button", { name: "Change photo" })).toBeVisible();

  // A 320 px phone, with the photo: every control is named, and nothing scrolls sideways.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.reload();
  await expect(panel.getByRole("button", { name: "View photo of Scotch Tape" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  const unnamed = await sheet.locator("button, input, [role=tab]").evaluateAll((controls) => controls.filter((control) => !(control.getAttribute("aria-label") || control.textContent?.trim() || (control as HTMLInputElement).labels?.length)).length);
  expect(unnamed).toBe(0);
});

test("item photos: an open profile follows a photo someone else changed, so its viewer never opens a removed file", async ({ page, baseURL }) => {
  test.setTimeout(60_000); // waits on a real 10-second refresh
  await signIn(page);
  await page.goto("/staff/items?item=ITM-0263");
  const sheet = page.getByRole("dialog", { name: "Scotch Tape" });
  const shown = sheet.locator("#photo-panel [data-view] img");
  await expect(shown).toBeVisible();
  const current = (await (await page.request.get("/api/staff/items/ITM-0263")).json() as { item: { photo: { id: string } } }).item.photo.id;
  const small = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    canvas.getContext("2d")!.fillRect(0, 0, 64, 48);
    return canvas.toDataURL("image/jpeg").split(",")[1]!;
  });
  const bytes = Buffer.from(small, "base64");
  const replaced = await page.request.put("/api/staff/items/ITM-0263/photo", { headers: { origin: baseURL! }, multipart: {
    display: { name: "display.jpg", mimeType: "image/jpeg", buffer: bytes }, thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: bytes }, expected: current } });
  const next = (await replaced.json() as { photo: { id: string } }).photo.id;
  await expect(shown).toHaveAttribute("src", `/api/staff/media/${next}/thumb`, { timeout: 30_000 });
  await sheet.locator("#photo-panel [data-view]").click();
  const viewer = page.getByRole("dialog", { name: "Photo of Scotch Tape" });
  await expect(viewer).toBeVisible();
  expect(await viewer.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(64);
});
