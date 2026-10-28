import { expect, test, type Page } from "@playwright/test";

/*
 * V1.16.4 foundations (accepted specification §4.7, §4.8): the one unsaved-edit guard, kept answers between page moves, polling that
 * backs off while it fails, the build-change reload, and a sign-out in one tab reaching the others.
 */

const session = { authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const item = { id: "ITM-0001", name: "Sample marker", aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING",
  onHand: 4, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0,
  consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null };
const detail = { item: { ...item, notes: null, listingGaps: [], photo: null, location: null, legacyReportedAvailable: null, migratedOnHand: 0, migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null }, movements: [], loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0 };

async function staffPages(page: Page, options: { session?: Record<string, unknown> } = {}): Promise<{ inventoryAsks: Array<string | undefined> }> {
  const inventoryAsks: Array<string | undefined> = [];
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: options.session ?? session }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/inventory", (route) => {
    const asked = route.request().headers()["if-none-match"];
    inventoryAsks.push(asked);
    if (asked === '"r1"') return route.fulfill({ status: 304, headers: { etag: '"r1"' } });
    return route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], categories: ["SUPPLIES"], locations: [], units: ["piece"] } });
  });
  await page.route("**/api/staff/locations", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, locations: [] } }));
  await page.route("**/api/staff/stock", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], locations: [], reorders: [], activity: [] } }));
  await page.route("**/api/staff/items/ITM-0001", (route) => route.fulfill({ json: detail }));
  await page.route("**/api/staff/home", (route) => route.fulfill({ headers: { etag: '"h"' }, json: { catalogue: null, checks: [] } }));
  await page.route("**/api/staff/attention", (route) => route.fulfill({ headers: { etag: '"a"' }, json: { revision: 1, entries: [], groups: [], needsAction: 0, bySource: {} } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  return { inventoryAsks };
}

const question = (page: Page) => page.getByRole("alertdialog", { name: "Discard your changes?" });

test.describe("unsaved edits (§4.7)", () => {
  test("an untouched sheet closes at once; an edited one asks, Keep editing changes nothing, Discard closes it", async ({ page }) => {
    await staffPages(page);
    await page.goto("/staff/items?item=ITM-0001");
    const sheet = page.getByRole("dialog", { name: "Sample marker" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(question(page)).toHaveCount(0);

    await page.goto("/staff/items?item=ITM-0001&tab=details");
    const name = page.locator("#f-name");
    await name.fill("Sample Marker, Fine Tip");
    await page.keyboard.press("Escape");
    await expect(question(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
    // Escape on the question is Keep editing too.
    await page.keyboard.press("Escape");
    await expect(question(page)).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await expect(name).toHaveValue("Sample Marker, Fine Tip");
    await expect(name).toBeFocused();
    await expect(page).toHaveURL(/item=ITM-0001/);

    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(question(page)).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(question(page)).toHaveCount(0);
  });

  test("a rail link and Back both ask first; Keep editing keeps the address, Discard goes", async ({ page }) => {
    await staffPages(page);
    await page.goto("/staff/stock");
    await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
    await page.locator(".app-nav").getByRole("link", { name: "Items", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Sample marker" }).first().click();
    const sheet = page.getByRole("dialog", { name: "Sample marker" });
    await sheet.getByRole("tab", { name: /Edit details/ }).click();
    await page.locator("#f-name").fill("Changed Name");

    // A rail link.
    await page.locator(".app-nav").getByRole("link", { name: "Low & out of stock" }).dispatchEvent("click");
    await expect(question(page)).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(/\/staff\/items/);
    await expect(page.locator("#f-name")).toHaveValue("Changed Name");

    // Back: the address is put back while it asks.
    const before = page.url();
    await page.goBack();
    await expect(question(page)).toBeVisible();
    await expect.poll(() => page.url()).toBe(before);
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.locator("#f-name")).toHaveValue("Changed Name");
    await expect(page).toHaveURL(before);

    await page.goBack();
    await expect(question(page)).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
    await expect(question(page)).toHaveCount(0);
  });

  test("closing the tab warns only while something is unsaved", async ({ page }) => {
    await staffPages(page);
    await page.goto("/staff/items?item=ITM-0001&tab=details");
    await expect(page.locator("#f-name")).toBeVisible();
    const warnings: string[] = [];
    page.on("dialog", (dialog) => { warnings.push(dialog.type()); void dialog.accept(); });
    // Untouched: no warning (a real click first, as browsers require an interaction before warning).
    await page.locator("#f-name").click();
    await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
    const quiet = await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    expect(quiet).toBe(false);
    await page.locator("#f-name").fill("Changed");
    await expect.poll(() => page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    expect(warnings).toEqual([]);
  });

  test("an ended session while something is unsaved asks first: Stay keeps the text, Go to sign in leaves", async ({ page }) => {
    await staffPages(page);
    await page.goto("/staff/items?item=ITM-0001&tab=details");
    await page.locator("#f-name").fill("Typed Before The Session Ended");
    await page.route("**/api/staff/items/ITM-0001", (route) => route.fulfill({ status: 401, json: { error: "Your staff session has ended. Please sign in again." } }));
    await page.getByRole("dialog", { name: "Sample marker" }).getByRole("button", { name: "Save changes" }).click();
    const ended = page.getByRole("alertdialog", { name: "Your session ended" });
    await expect(ended).toBeVisible();
    await expect(ended).toContainText("Your changes are not saved.");
    await page.getByRole("button", { name: "Stay" }).click();
    await expect(page.locator("#f-name")).toHaveValue("Typed Before The Session Ended");
    await expect(page).toHaveURL(/\/staff\/items/);
  });
});

test.describe("kept answers and polling (§4.8)", () => {
  test("coming back to Items draws the kept list at once and only asks whether it changed", async ({ page }) => {
    const { inventoryAsks } = await staffPages(page);
    await page.goto("/staff/items");
    await expect(page.getByRole("button", { name: "Sample marker" }).first()).toBeVisible();
    await page.locator(".app-nav").getByRole("link", { name: "Low & out of stock" }).click();
    await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
    // Hold the check back: the kept list must show without it.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/staff/inventory", async (route) => {
      inventoryAsks.push(route.request().headers()["if-none-match"]);
      await held;
      await route.fulfill({ status: 304, headers: { etag: '"r1"' } });
    });
    await page.locator(".app-nav").getByRole("link", { name: "Items", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sample marker" }).first()).toBeVisible({ timeout: 1_500 });
    await expect(page.locator("#live-status")).toHaveText(/^Showing data from /);
    release();
    await expect(page.locator("#live-status")).not.toHaveText(/^Showing data from /);
    expect(inventoryAsks.at(-1)).toBe('"r1"');
  });

  test("a failing poll backs off instead of asking every ten seconds, and comes back at once when the connection does", async ({ page }) => {
    await staffPages(page);
    const asked: number[] = [];
    let failing = false;
    await page.route("**/api/staff/inventory", (route) => {
      asked.push(Date.now());
      if (failing) return route.fulfill({ status: 503, json: { error: "The service is temporarily unavailable." } });
      return route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], categories: ["SUPPLIES"], locations: [], units: ["piece"] } });
    });
    await page.clock.install();
    const pass = async (milliseconds: number) => { for (let spent = 0; spent < milliseconds; spent += 1000) { await page.clock.runFor(1000); await page.waitForTimeout(8); } };
    await page.goto("/staff/items");
    await expect.poll(() => asked.length).toBe(1);
    failing = true;
    await pass(10_000);
    await expect(page.locator("#live-status")).toHaveText("Not updating, retrying");
    // Ten failing minutes at a fixed 10-second pace would be 60 checks; doubling to five minutes is a handful.
    const before = asked.length;
    await pass(600_000);
    expect(asked.length - before).toBeLessThanOrEqual(7);
    expect(asked.length - before).toBeGreaterThanOrEqual(3);
    failing = false;
    const now = asked.length;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => asked.length).toBeGreaterThan(now);
    await expect(page.locator("#live-status")).not.toHaveText("Not updating, retrying");
  });
});

test.describe("other tabs and releases (§4.8)", () => {
  test("signing out in one tab sends the other to sign in", async ({ context }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    for (const page of [first, second]) await staffPages(page);
    await first.route("**/api/staff/logout", (route) => route.fulfill({ json: { ok: true } }));
    await first.goto("/staff/items");
    await second.goto("/staff/stock");
    await expect(second.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
    await first.getByRole("button", { name: /Account:/ }).click();
    await first.getByRole("button", { name: "Sign out" }).click();
    await expect(first).toHaveURL(/\/staff$/);
    await expect(second).toHaveURL(/\/staff\?expired=1$/);
  });

  test("a tab on an older release loads the page afresh at its next move, once", async ({ page }) => {
    await staffPages(page, { session: { ...session, build: "newer" } });
    // The page names the build it came from, as a built page does.
    await page.addInitScript(() => {
      document.addEventListener("readystatechange", () => {
        if (document.readyState !== "interactive" || document.querySelector('meta[name="build"]')) return;
        const meta = document.createElement("meta");
        meta.name = "build";
        meta.content = sessionStorage.getItem("test-build") ?? "older";
        document.head.append(meta);
      });
    });
    await page.goto("/staff/items");
    await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
    await page.evaluate(() => { (window as Window & { marker?: boolean }).marker = true; });
    await page.locator(".app-nav").getByRole("link", { name: "Low & out of stock" }).click();
    await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
    // A fresh load: what the old page set is gone.
    expect(await page.evaluate(() => (window as Window & { marker?: boolean }).marker)).toBeUndefined();
    await expect(page).toHaveURL(/\/staff\/stock$/);
    // Still "older" after reloading (a mixed deploy): the next move does not reload again.
    await page.evaluate(() => { (window as Window & { marker?: boolean }).marker = true; });
    await page.locator(".app-nav").getByRole("link", { name: "Items", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
    expect(await page.evaluate(() => (window as Window & { marker?: boolean }).marker)).toBe(true);
  });
});
