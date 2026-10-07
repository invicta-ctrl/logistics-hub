import { expect, test, type Page } from "@playwright/test";

/* V1.14: the items table draws a page of rows at a time, so a bigger catalog does not mean a bigger page. Fictional data, API mocked. */

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const item = (index: number) => ({ id: `ITM-${String(index).padStart(5, "0")}`, name: `Sample item ${index}`, aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", onHand: 10, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null });

async function open(page: Page, count: number) {
  const items = Array.from({ length: count }, (_, at) => item(at + 1));
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 0, bySource: {} }) }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items, categories: ["SUPPLIES"], locations: [], units: ["piece"] }) }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 1, locations: [] }) }));
  await page.setViewportSize({ width: 1280, height: 900 });
}
const rows = (page: Page) => page.locator(".data-table--items tbody tr").count();

test.describe("Items table", () => {
  test("draws the same page of rows whether the catalog has 300 items or 6,000", async ({ page }) => {
    await open(page, 300);
    await page.goto("/staff/items");
    await expect(page.locator(".data-table--items tbody tr").first()).toBeVisible();
    const small = await rows(page);
    await page.unrouteAll();
    await open(page, 6000);
    await page.goto("/staff/items");
    await expect(page.locator("#inventory-count")).toContainText("6,000");
    const large = await rows(page);
    expect(small).toBe(100);
    expect(large).toBe(100);
    const nodes = await page.evaluate(() => document.querySelectorAll("*").length);
    expect(nodes).toBeLessThan(3000);
  });

  test("shows more on request, puts focus on the first new row, and starts over when the question changes", async ({ page }) => {
    await open(page, 450);
    await page.goto("/staff/items");
    const more = page.getByRole("button", { name: /Show 100 more/ });
    await expect(more).toContainText("100 of 450 shown");
    await more.click();
    expect(await rows(page)).toBe(200);
    await expect(page.locator(".data-table--items tbody tr:nth-child(101) .row-link")).toBeFocused();
    await page.getByRole("button", { name: /Show 100 more/ }).click();
    await page.getByRole("button", { name: /Show 100 more/ }).click();
    await expect(page.getByRole("button", { name: /Show 50 more/ })).toBeVisible();
    await page.getByRole("button", { name: /Show 50 more/ }).click();
    expect(await rows(page)).toBe(450);
    await expect(page.locator("[data-more]")).toHaveCount(0);
    // Searching searches everything, not only what is drawn, and a new question starts at the first page again.
    await page.getByRole("searchbox").first().fill("Sample item 449");
    await expect(page.locator(".data-table--items tbody tr")).toHaveCount(1);
    await page.getByRole("searchbox").first().fill("");
    await expect(page.locator(".data-table--items tbody tr")).toHaveCount(100);
  });

  test("keeps a deep-linked item drawn even when it falls beyond the first page", async ({ page }) => {
    await open(page, 450);
    const target = item(420);
    await page.route("**/api/staff/items/ITM-00420", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ item: { ...target, notes: null, listingGaps: [], photo: null, location: null, legacyReportedAvailable: null, migratedOnHand: 0, migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null }, movements: [], loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0 }) }));
    await page.goto("/staff/items?item=ITM-00420");
    await expect(page.locator('tr[data-key="ITM-00420"]')).toHaveCount(1);
    expect(await rows(page)).toBeGreaterThanOrEqual(100);
  });
});
