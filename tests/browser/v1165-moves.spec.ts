import { expect, test, type Page } from "@playwright/test";

/*
 * V1.16.5: leaving a page while its reads are still on the way. In production each read takes a few hundred milliseconds, so moving
 * between Administration's tabs left reads that answered into a page already gone, and each raised "Something went wrong" (Earl,
 * 2026-10-29). Moving between pages also redrew the bar and faded the whole page in from nothing, which read as a flicker.
 */

const owner = { authenticated: true, id: "ACC-owner", username: "owner.one", displayName: "Owner One", role: "OWNER", access: "OWNER", hub: true, mustChangePassword: false, recovery: { configured: true, createdAt: "2026-10-01T00:00:00.000Z" }, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const item = { id: "ITM-0001", name: "Sample marker", aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING",
  onHand: 4, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0,
  consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null };

async function common(page: Page): Promise<void> {
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: owner }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], categories: ["SUPPLIES"], locations: [], units: ["piece"] } }));
}

/** Answers Administration's Catalog section at once, so it draws as it does in production. */
async function catalogAnswers(page: Page): Promise<void> {
  await page.route("**/api/staff/admin/catalog", (route) => route.fulfill({ json: { active: 1, unclassified: 0, captured: 0, capturedClassified: 0 } }));
  await page.route("**/api/staff/admin/catalog/aliases**", (route) => route.fulfill({ json: { items: [], more: false } }));
  await page.route("**/api/staff/admin/catalog/proposals", (route) => route.fulfill({ json: { proposals: [], metrics: [] } }));
  await page.route("**/api/staff/catalogue", (route) => route.fulfill({ json: { session: null } }));
}

test("reads that answer after their page was left draw nothing and raise no error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await common(page);
  // Every Administration read is held until the person has moved on to Items, then answered.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/staff\/(admin\/|catalogue$)/, async (route) => {
    await held;
    await route.fulfill({ json: {} }).catch(() => undefined);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/admin/catalog");
  const tabs = page.getByRole("navigation", { name: "Administration" });
  await tabs.getByRole("link", { name: "Staff", exact: true }).click();
  await tabs.getByRole("link", { name: "Accountability", exact: true }).click();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "All items" }).click();
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
  release();
  await page.waitForTimeout(1_000);
  await expect(page.locator(".toast")).toHaveCount(0);
  expect(errors).toEqual([]);
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
});

test("between Administration's tabs the title and tabs stay while the next section loads", async ({ page }) => {
  await common(page);
  await catalogAnswers(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/staff/admin/accounts", async (route) => {
    await held;
    await route.fulfill({ json: { accounts: [] } });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/admin/catalog");
  await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
  // Watches every change to the page: the title must never go, not even for the frame in which the next section's code loads.
  await page.evaluate(() => {
    const main = document.querySelector("#main-content")!;
    const state = window as unknown as { titleLost: boolean };
    state.titleLost = false;
    new MutationObserver(() => {
      if (document.querySelector("#main-content .page-header h1")?.textContent !== "Administration" || !document.querySelector("#main-content > .subnav")) state.titleLost = true;
    }).observe(main, { childList: true, subtree: true });
  });
  const staff = page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Staff", exact: true });
  await staff.click();
  await expect(staff).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  release();
  await expect(page.locator("#accounts .skeleton-row")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { titleLost: boolean }).titleLost)).toBe(false);
});

test("moving between pages keeps the bar, the rail and the page area, and moves only the current marks", async ({ page }) => {
  await common(page);
  await catalogAnswers(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/admin/catalog");
  await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
  await page.evaluate(() => {
    const state = window as unknown as { bar: Element | null; main: Element | null };
    state.bar = document.querySelector(".app-bar");
    state.main = document.querySelector("#main-content");
  });
  const sections = page.getByRole("navigation", { name: "Sections" });
  await sections.getByRole("link", { name: "All items" }).click();
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => {
    const state = window as unknown as { bar: Element | null; main: Element | null };
    return state.bar === document.querySelector(".app-bar") && state.main === document.querySelector("#main-content");
  })).toBe(true);
  await expect(sections.getByRole("link", { name: "All items" })).toHaveAttribute("aria-current", "page");
  await expect(sections.getByRole("link", { name: "Items", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(sections.getByRole("link", { name: "Administration" })).not.toHaveAttribute("aria-current", /.+/);
  await expect(page.locator("#main-content")).not.toHaveAttribute("aria-busy", "true");
});

/** Moves within the app as a link would, from outside the page area. */
async function go(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    const link = document.createElement("a");
    link.href = to;
    link.dataset.route = "";
    document.body.append(link);
    link.click();
    link.remove();
  }, path);
}

test("a page's listeners on the page area leave with it, so visits do not stack them", async ({ page }) => {
  // Counts the click listeners on <main> that are still live: added, not removed and not aborted.
  await page.addInitScript(() => {
    const live: Array<{ target: EventTarget; listener: unknown; signal?: AbortSignal }> = [];
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type: string, listener: unknown, options?: unknown) {
      if (type === "click" && (this as Element).id === "main-content") live.push({ target: this, listener, signal: (options as AddEventListenerOptions | undefined)?.signal });
      return add.call(this, type, listener as EventListener, options as AddEventListenerOptions);
    };
    EventTarget.prototype.removeEventListener = function (type: string, listener: unknown, options?: unknown) {
      if (type === "click" && (this as Element).id === "main-content") { const at = live.findIndex((entry) => entry.target === this && entry.listener === listener); if (at >= 0) live.splice(at, 1); }
      return remove.call(this, type, listener as EventListener, options as EventListenerOptions);
    };
    (window as unknown as { mainClicks: () => number }).mainClicks = () => live.filter((entry) => entry.target === document.querySelector("#main-content") && !entry.signal?.aborted).length;
  });
  await common(page);
  await page.route("**/api/staff/activity?**", (route) => route.fulfill({ json: { events: [], nextCursor: null } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/items");
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
  for (const path of ["/staff/activity", "/staff/items", "/staff/activity", "/staff/items", "/staff/account", "/staff/items", "/staff/account"]) {
    await go(page, path);
    await expect(page.locator("#main-content")).not.toHaveAttribute("aria-busy", "true");
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  await expect(page.getByRole("heading", { name: "My account", level: 1 })).toBeVisible();
  // My account's copy buttons, and nothing left from the two Activity visits or the first My account visit.
  expect(await page.evaluate(() => (window as unknown as { mainClicks: () => number }).mainClicks())).toBe(1);
});

test("between tabs, the section being left keeps no lede or buttons that still work", async ({ page }) => {
  await common(page);
  await page.route("**/api/staff/admin/accounts", (route) => route.fulfill({ json: { accounts: [] } }));
  await page.route(/\/api\/staff\/admin\/(activity|retention)$/, (route) => route.fulfill({ json: { events: [], loans: 0, phoneRecords: 0, photos: 0 } }));
  // Accountability's code is held: until it arrives, only the page left behind is on screen.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/src\/admin-accountability\.ts/, async (route) => {
    await held;
    await route.continue();
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/admin/staff");
  const create = page.getByRole("button", { name: "New account" });
  await expect(create).toBeVisible();
  const accountability = page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Accountability", exact: true });
  await accountability.click();
  await expect(accountability).toHaveAttribute("aria-current", "page");
  // While Accountability loads, Staff's button and lede are neither shown nor usable, and the title has not moved.
  await expect(create).toBeHidden();
  expect(await page.locator(".page-header__actions").evaluate((actions) => (actions as HTMLElement).inert)).toBe(true);
  await expect(page.getByText("Owners manage every account and role.", { exact: false })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
  release();
  await expect(page.getByText("What is kept about who borrowed or took something", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "New account" })).toHaveCount(0);
});

test("a move that keeps the bar closes the account menu, Back included", async ({ page }) => {
  await common(page);
  await catalogAnswers(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/admin/catalog");
  await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "All items" }).click();
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
  const opener = page.locator("button.account");
  await opener.click();
  await expect(page.locator("#staff-menu")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
  await expect(page.locator("#staff-menu")).toBeHidden();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
});

test("a page left while it was still asking who is signed in draws nothing over the next page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], categories: ["SUPPLIES"], locations: [], units: ["piece"] } }));
  await page.route("**/api/staff/admin/accounts", (route) => route.fulfill({ json: { accounts: [] } }));
  // The first session read (Administration's, on a cold load) is held until Items has drawn; later ones answer at once.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let asked = 0;
  await page.route("**/api/staff/session", async (route) => {
    asked += 1;
    if (asked === 1) await held;
    await route.fulfill({ json: owner }).catch(() => undefined);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/admin/staff");
  await expect.poll(() => asked).toBeGreaterThan(0);
  await go(page, "/staff/items");
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
  release();
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveCount(0);
  expect(errors).toEqual([]);
});
