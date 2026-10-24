import { expect, test, type Page } from "@playwright/test";

/*
 * The staff shell every staff page shares (V1.16 MA2): where a session that cannot use the workspace is sent, and the account
 * menu with the keyboard, on phones, and in a browser without the Popover API. These pin today's behaviour before the shell
 * moves out of the Items screen's module.
 */

const owner = { authenticated: true, id: "ACC-owner", username: "owner.one", displayName: "Owner One", role: "OWNER", access: "OWNER", hub: true, mustChangePassword: false, recovery: { configured: true, createdAt: "2026-10-01T00:00:00.000Z" }, selfServiceReviews: 0, selfServiceClosed: false, directory: null };

const answer = (page: Page, session: Record<string, unknown>) =>
  page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));

test.describe("a session that cannot use the workspace", () => {
  test("a required password change opens My account first, with no sections", async ({ page }) => {
    await answer(page, { ...owner, role: "ADMIN", access: "ADMIN", mustChangePassword: true });
    await page.goto("/staff/items");
    await expect(page).toHaveURL(/\/staff\/account$/);
    await expect(page.getByRole("alert").filter({ hasText: "Choose your own password to continue." })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
    await expect(page.locator("[data-palette]")).toHaveCount(0);
  });

  test("a sign-in without access to the hub goes to My account", async ({ page }) => {
    await answer(page, { ...owner, role: "STAFF", access: "DEM", hub: false, recovery: null });
    await page.goto("/staff/stock");
    await expect(page).toHaveURL(/\/staff\/account$/);
    await expect(page.locator(".callout")).toContainText("Your sign-in is set up as DEM Staff.");
    await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
  });

  test("a signed-out visitor is sent to sign in", async ({ page }) => {
    await page.route("**/api/staff/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Sign in required." }) }));
    await page.goto("/staff/home");
    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
  });

  test("without a connection the page says staff tools need one and offers Self-Service", async ({ page }) => {
    await page.route("**/api/staff/session", (route) => route.abort("internetdisconnected"));
    await page.goto("/staff/loans");
    await expect(page.getByRole("heading", { level: 1, name: "Staff tools need a connection" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/staff/loans");
    await expect(page.getByRole("link", { name: "Open Self-Service" })).toHaveAttribute("href", "/self-service");
    await expect(page.locator("#main-content")).toHaveCount(1);
  });

  test("any other failure says the workspace is unavailable, in the server's words", async ({ page }) => {
    await page.route("**/api/staff/session", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The service is temporarily unavailable." }) }));
    await page.goto("/staff/activity");
    await expect(page.getByRole("heading", { level: 1, name: "The staff workspace is unavailable" })).toBeVisible();
    await expect(page.locator("#main-content")).toContainText("The service is temporarily unavailable.");
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/staff/items");
  });
});

test.describe("the account menu", () => {
  test.beforeEach(async ({ page }) => { await answer(page, owner); });

  test("opens and closes from the keyboard, and Escape gives focus back to the avatar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/staff/account");
    const avatar = page.getByRole("button", { name: /^Account:/ });
    const more = page.locator(".app-nav__more");
    const menu = page.locator("#staff-menu");
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
    await avatar.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    // Both openers say the one menu is open.
    await expect(avatar).toHaveAttribute("aria-expanded", "true");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("link", { name: "My account" })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Tab");
    expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(avatar).toBeFocused();
    // A choice closes the menu at once, here for the page already shown.
    await avatar.click();
    await menu.getByRole("link", { name: "My account" }).click();
    await expect(menu).toBeHidden();
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
    await expect(page).toHaveURL(/\/staff\/account$/);
  });

  test("on a phone, More opens the same menu with every section beyond Home", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff/account");
    const more = page.getByRole("button", { name: "More" });
    const menu = page.locator("#staff-menu");
    await more.click();
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const sections = menu.getByRole("list", { name: "More sections" });
    await expect(sections.getByRole("link")).toHaveText(["Items", "Stock", "Locations", "Kits", "Loans", "Self-Service", "Activity", "Administration"]);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toBeFocused();
  });

  test("without the Popover API the avatar and More simply show and hide it, and a choice closes it", async ({ page }) => {
    // An older browser (iOS before 17): no showPopover, and the popover attributes do nothing. The shell finds its openers by
    // that attribute as it draws; only afterwards are the attributes dropped, as such a browser would ignore them.
    await page.addInitScript(() => {
      delete (HTMLElement.prototype as { showPopover?: unknown }).showPopover;
      new MutationObserver(() => {
        document.querySelectorAll("[popover]").forEach((element) => element.removeAttribute("popover"));
        document.querySelectorAll("[popovertarget]").forEach((element) => element.removeAttribute("popovertarget"));
      }).observe(document, { subtree: true, childList: true });
    });
    // Its transitions are written against :popover-open, which such a browser drops; reduced motion drops them here.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff/account");
    const more = page.getByRole("button", { name: "More" });
    const avatar = page.getByRole("button", { name: /^Account:/ });
    const menu = page.locator("#staff-menu");
    await expect(menu).not.toHaveAttribute("popover");
    await expect(menu).toBeHidden();
    await more.click();
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(avatar).toHaveAttribute("aria-expanded", "true");
    await more.click();
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await avatar.click();
    await expect(menu).toBeVisible();
    await menu.getByRole("link", { name: "My account" }).click();
    await expect(menu).toBeHidden();
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
  });
});

test("moving between staff pages is instant: the rail and the next page's shape show at once, before its session and data answer (Earl, 2026-10-24)", async ({ page }) => {
  const session = { authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
  const item = { id: "ITM-0001", name: "Sample marker", aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING",
    onHand: 4, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0,
    consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null };
  let sessionReads = 0;
  let releaseStock: () => void = () => {};
  const stockHeld = new Promise<void>((resolve) => { releaseStock = resolve; });
  await page.route("**/api/staff/session", async (route) => {
    sessionReads += 1;
    // After the first page, the server is slow to say who is signed in; the next page must not wait for it.
    if (sessionReads > 1) await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ json: session });
  });
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], categories: ["SUPPLIES"], locations: [], units: ["piece"] } }));
  await page.route("**/api/staff/stock", async (route) => {
    await stockHeld;
    await route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], locations: [], reorders: [], activity: [] } });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/items");
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
  // Load Stock's code first, as pointing at its link does, so the measurement is the move itself.
  await page.getByRole("link", { name: "Stock" }).hover();
  await page.waitForTimeout(300);

  const started = Date.now();
  await page.getByRole("link", { name: "Stock" }).click();
  // The page and rail switch at once, with the skeleton standing in while the data is held back.
  await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible({ timeout: 1_000 });
  expect(Date.now() - started).toBeLessThan(1_000);
  await expect(page.getByRole("link", { name: "Stock" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toHaveCount(0);
  await expect(page.locator("#stock-results[aria-busy=true]")).toBeVisible();
  releaseStock();
  await expect(page.locator("#stock-results")).not.toHaveAttribute("aria-busy", "true");
});

test("an item sheet's link to its activity keeps the item filter: the sheet closed on the way out leaves the next page's address alone", async ({ page }) => {
  const session = { authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
  const item = { id: "ITM-0001", name: "Sample marker", aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING",
    onHand: 4, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0,
    consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null };
  const asked: string[] = [];
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: session }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], categories: ["SUPPLIES"], locations: [], units: ["piece"] } }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ json: { revision: 1, locations: [] } }));
  await page.route("**/api/staff/items/ITM-0001", (route) => route.fulfill({ json: { item: { ...item, notes: null, listingGaps: [], photo: null, location: null, legacyReportedAvailable: null, migratedOnHand: 0, migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null }, movements: [], loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0 } }));
  await page.route("**/api/staff/activity*", (route) => { asked.push(new URL(route.request().url()).search); return route.fulfill({ headers: { etag: '"a"' }, json: { events: [], nextCursor: null } }); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/items?item=ITM-0001");
  await expect(page.getByRole("dialog", { name: "Sample marker" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByRole("link", { name: /All activity for this item/ }).click();
  await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Sample marker" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/staff\/activity\?item=ITM-0001$/);
  await expect(page.getByRole("button", { name: /^Remove filter: Item:/ })).toBeVisible();
  expect(asked.every((search) => search.includes("item=ITM-0001"))).toBe(true);
  // The address stays the activity page's: nothing of the item page rewrites it afterwards.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/staff\/activity\?item=ITM-0001$/);
});
