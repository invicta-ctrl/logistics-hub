import { expect, test, type Page } from "@playwright/test";

/*
 * V1.16.4 WP4 (accepted specification §4.2) on fictional data with the API mocked: the Items page's work to do is one wrapping line and
 * what it shows is a choice inside Filters, with every old `?view=` address still opening its list; and Items is the parent of Stock's
 * three views, Locations and Kits, with the rail marking the one shown as Stock changes its view in place.
 */

const session = { authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const base = { aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "STUDENTS_AND_USC_STAFF",
  onHand: 10, reorderThreshold: 0, locationId: "LOC-1", legacyLocation: null as string | null, openReports: 0, listed: true, stockArea: "Inventory", expiresOn: null, lastCountedAt: null,
  reorderStatus: null, onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z",
  model: null, serialNumber: null, countNeeded: false };
const ITEMS = [
  { ...base, id: "ITM-0001", name: "Sample review", needsReview: true },
  { ...base, id: "ITM-0002", name: "Sample unlisted", listed: false },
  { ...base, id: "ITM-0003", name: "Sample unplaced", locationId: null, legacyLocation: "Old shelf" },
  { ...base, id: "ITM-0004", name: "Sample lent", itemType: "Loanable", onHand: 0, onLoan: 1 },
  { ...base, id: "ITM-0005", name: "Sample empty", onHand: 0 },
  { ...base, id: "ITM-0006", name: "Sample retired", status: "INACTIVE" }
];

async function staffPages(page: Page): Promise<void> {
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: session }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: ITEMS, categories: ["SUPPLIES"],
    locations: [{ id: "LOC-1", name: "Cabinet 1", parentId: null, active: true }], units: ["piece"] } }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, locations: [{ id: "LOC-1", name: "Cabinet 1", parentId: null, active: true }] } }));
  await page.route("**/api/staff/stock", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: ITEMS, locations: [], reorders: [], activity: [] } }));
  await page.route("**/api/staff/home", (route) => route.fulfill({ headers: { etag: '"h"' }, json: { catalogue: null, checks: [] } }));
  await page.route("**/api/staff/attention", (route) => route.fulfill({ headers: { etag: '"a"' }, json: { revision: 1, entries: [], groups: [], needsAction: 0, bySource: {} } }));
}

const rows = (page: Page) => page.locator(".data-table--items tbody tr");

test.describe("Items: To do and Show (V1.16.4 §4.2)", () => {
  test.beforeEach(async ({ page }) => { await staffPages(page); await page.setViewportSize({ width: 1280, height: 900 }); });

  test("work to do is the tasks that have any; pressing one shows it, pressing it again shows every item", async ({ page }) => {
    await page.goto("/staff/items");
    await expect(rows(page)).toHaveCount(6);
    // No row of view tabs is left.
    await expect(page.locator("#main-content .view-tab")).toHaveCount(0);
    const todo = page.getByRole("group", { name: "To do" });
    // In the one order, and only the tasks with anything to do: no location reports, nothing used gradually.
    await expect(todo.getByRole("button")).toHaveText([/^Needs details check\s*1$/, /^Ready to list\s*1$/, /^Needs a place\s*1$/]);
    const review = todo.getByRole("button", { name: /^Needs details check/ });
    await review.click();
    await expect(page).toHaveURL(/view=review/);
    await expect(review).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText("Sample review");
    await review.click();
    await expect(page).not.toHaveURL(/view=/);
    await expect(rows(page)).toHaveCount(6);
  });

  test("what to show is a choice inside Filters, with its counts, and counts as a filter", async ({ page }) => {
    await page.goto("/staff/items");
    await expect(rows(page)).toHaveCount(6);
    const filters = page.getByRole("button", { name: /^Filters/ });
    await filters.click();
    const show = page.getByRole("combobox", { name: "Show", exact: true });
    await expect(show).toBeFocused();
    await expect(show.locator("option")).toHaveText(["All items (6)", "On Lending Hub (5)", "Low stock (0)", "Out of stock (1)", "All on loan (1)", "Inactive (1)"]);
    await show.selectOption("onloan");
    await expect(page).toHaveURL(/view=onloan/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText("Sample lent");
    await expect(filters).toHaveText(/Filters \(1\)/);
    await show.selectOption("");
    await expect(page).not.toHaveURL(/view=/);
    await expect(rows(page)).toHaveCount(6);
  });

  test("every old view address still opens its list", async ({ page }) => {
    for (const [view, name] of [["review", "Sample review"], ["ready", "Sample unlisted"], ["unplaced", "Sample unplaced"], ["out", "Sample empty"], ["onloan", "Sample lent"], ["inactive", "Sample retired"]] as const) {
      await page.goto(`/staff/items?view=${view}`);
      await expect(rows(page), view).toHaveCount(1);
      await expect(rows(page), view).toContainText(name);
    }
    // A task address presses its task; a show address is the Show choice.
    await page.goto("/staff/items?view=unplaced");
    await expect(page.getByRole("group", { name: "To do" }).getByRole("button", { name: /^Needs a place/ })).toHaveAttribute("aria-pressed", "true");
    await page.goto("/staff/items?view=inactive");
    await expect(page.locator("#filter-show")).toHaveValue("inactive");
    await expect(page.getByRole("button", { name: /^Filters/ })).toHaveText(/Filters \(1\)/);
  });

  test("on a 320 px phone the To do line wraps instead of scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/staff/items");
    const tasks = page.getByRole("group", { name: "To do" }).getByRole("button");
    await expect(tasks).toHaveCount(3);
    const first = (await tasks.first().boundingBox())!;
    const last = (await tasks.last().boundingBox())!;
    expect(last.y).toBeGreaterThan(first.y);
    expect(await page.locator("#todo").evaluate((line) => line.scrollWidth - line.clientWidth)).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});

test.describe("Items as the parent (V1.16.4 §4.2)", () => {
  test.beforeEach(async ({ page }) => { await staffPages(page); await page.setViewportSize({ width: 1366, height: 900 }); });

  test("the rail marks the child shown, follows Stock's view changes in place, and marks Items as the section", async ({ page }) => {
    const sections = page.getByRole("navigation", { name: "Sections" });
    const items = sections.getByRole("link", { name: "Items", exact: true });
    const child = (name: string) => sections.getByRole("list", { name: "Items" }).getByRole("link", { name: new RegExp(`^${name}`) });
    await page.goto("/staff/stock");
    await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
    await expect(sections.getByRole("list", { name: "Items" }).getByRole("link")).toHaveText(["All items", /^Low & out of stock/, "Stock & movements", "Pantry", "Locations", "Kits"]);
    await expect(items).toHaveAttribute("aria-current", "true");
    await expect(child("Low & out of stock")).toHaveAttribute("aria-current", "page");
    const views = page.locator("#stock-views");
    for (const [view, name] of [["Pantry", "Pantry"], ["Movements", "Stock & movements"], ["Restock", "Stock & movements"], ["Low & out of stock", "Low & out of stock"]] as const) {
      await views.getByRole("button", { name: new RegExp(`^${view}`) }).click();
      await expect(child(name), view).toHaveAttribute("aria-current", "page");
      await expect(sections.locator("[data-child][aria-current]"), view).toHaveCount(1);
      await expect(items, view).toHaveAttribute("aria-current", "true");
    }
    // Every child page leads back up to Items, and Items' own page is the All items child.
    await child("Locations").click();
    await expect(page.getByRole("heading", { name: "Locations", level: 1 })).toBeVisible();
    await expect(child("Locations")).toHaveAttribute("aria-current", "page");
    await page.locator("#main-content .page-header__up").getByRole("link", { name: "Items" }).click();
    await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
    await expect(child("All items")).toHaveAttribute("aria-current", "page");
    await expect(items).toHaveAttribute("aria-current", "true");
    // Home is not one of Items' pages.
    await sections.getByRole("link", { name: /^Home/ }).click();
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(items).not.toHaveAttribute("aria-current", /.*/);
    await expect(sections.locator("[data-child][aria-current]")).toHaveCount(0);
  });
});
