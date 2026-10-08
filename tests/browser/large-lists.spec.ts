import { expect, test, type Page, type TestInfo } from "@playwright/test";

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


type LayoutMetrics = {
  name: string;
  viewport: number;
  containerWidth: number;
  isCard: boolean;
  actionInside: boolean;
  pageOverflow: number;
  headerPosition: string;
  headerTop: number | null;
  headerAtAppBar: boolean;
  itemIdVisible: boolean;
  idColumnVisible: boolean;
};

const stockItem = { ...item(1), name: "Replacement toner cartridge", onHand: 0, reorderThreshold: 3, countNeeded: true };

async function openStock(page: Page) {
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 1, bySource: { Stock: 1 } }) }));
  await page.route("**/api/staff/stock", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items: [stockItem], locations: [], reorders: [], activity: [] }) }));
}

async function captureLayout(page: Page, testInfo: TestInfo, name: string, viewport: number, table: string, containerWidth?: number): Promise<LayoutMetrics> {
  await page.setViewportSize({ width: viewport, height: 900 });
  await page.goto(table === "items" ? "/staff/items" : "/staff/stock");
  const dataTable = page.locator(table === "items" ? ".data-table--items" : "#stock-results .data-table").first();
  await expect(dataTable.locator("tbody tr").first()).toBeVisible();
  if (containerWidth) await dataTable.evaluate((element, width) => {
    const wrap = element.closest<HTMLElement>(".data-table-wrap")!;
    wrap.style.width = `${width}px`;
    wrap.style.maxWidth = "none";
  }, containerWidth);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
  if (table === "items") await dataTable.locator("tbody tr").nth(10).scrollIntoViewIfNeeded();
  return dataTable.evaluate((element, { name, viewport, containerWidth }) => {
    const wrap = element.closest<HTMLElement>(".data-table-wrap")!;
    const wrapRect = wrap.getBoundingClientRect();
    const actionButtons = [...element.querySelectorAll<HTMLElement>(".col-actions button")];
    const actionInside = actionButtons.length > 0 && actionButtons.every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left >= wrapRect.left && rect.right <= wrapRect.right && rect.top >= wrapRect.top && rect.bottom <= wrapRect.bottom;
    });
    const header = element.querySelector<HTMLElement>("thead");
    const headerCell = element.querySelector<HTMLElement>("thead th");
    const headerTop = headerCell ? Math.round(headerCell.getBoundingClientRect().top) : null;
    const appBarBottom = document.querySelector<HTMLElement>(".app-bar")?.getBoundingClientRect().bottom ?? null;
    const itemId = element.querySelector<HTMLElement>(".cell-id");
    const idColumn = element.querySelector<HTMLElement>("tbody .col-id");
    return {
      name,
      viewport,
      containerWidth: wrapRect.width,
      isCard: getComputedStyle(element).display === "block" && header ? getComputedStyle(header).display === "none" : false,
      actionInside,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headerPosition: headerCell ? getComputedStyle(headerCell).position : "missing",
      headerTop,
      headerAtAppBar: headerTop !== null && appBarBottom !== null && Math.abs(headerTop - appBarBottom) <= 1,
      itemIdVisible: Boolean(itemId && getComputedStyle(itemId).display !== "none" && itemId.getBoundingClientRect().width > 0),
      idColumnVisible: Boolean(idColumn && getComputedStyle(idColumn).display !== "none" && idColumn.getBoundingClientRect().width > 0)
    };
  }, { name, viewport, containerWidth: containerWidth ?? 0 });
}

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


test.describe("Responsive data tables", () => {
  test("keeps Stock actions visible and adapts from the table container", async ({ page }, testInfo) => {
    await open(page, 300);
    const metrics: LayoutMetrics[] = [];
    for (const viewport of [320, 390, 768, 1024, 1440]) metrics.push(await captureLayout(page, testInfo, `items-${viewport}`, viewport, "items"));
    for (const width of [620, 700, 1000]) metrics.push(await captureLayout(page, testInfo, `items-container-${width}`, 1440, "items", width));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/staff/items");
    const constrainedItems = page.locator(".data-table--items");
    await expect(constrainedItems.locator("tbody tr").first()).toBeVisible();
    await page.locator("#select-toggle").click();
    await page.addStyleTag({ content: ".data-table-wrap:has(.data-table--items) { width: 620px; max-width: none; }" });
    await expect(constrainedItems).toHaveCSS("display", "block");
    expect(await constrainedItems.evaluate((element) => Math.round(element.closest<HTMLElement>(".data-table-wrap")!.getBoundingClientRect().width))).toBe(620);
    const selection = constrainedItems.locator("tbody .select-box").first();
    await expect(selection).toBeVisible();
    await selection.check();
    await expect(selection).toBeFocused();
    await expect(constrainedItems).toHaveCSS("display", "block");
    expect(await constrainedItems.evaluate((element) => Math.round(element.closest<HTMLElement>(".data-table-wrap")!.getBoundingClientRect().width))).toBe(620);
    expect(await selection.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const wrap = element.closest<HTMLElement>(".data-table-wrap")!.getBoundingClientRect();
      return rect.left >= wrap.left && rect.right <= wrap.right && rect.top >= wrap.top && rect.bottom <= wrap.bottom;
    })).toBe(true);
    await page.unrouteAll();
    await openStock(page);
    for (const viewport of [320, 390, 768, 1024, 1440]) metrics.push(await captureLayout(page, testInfo, `stock-${viewport}`, viewport, "stock"));
    console.log(`UX1_LAYOUT_METRICS ${JSON.stringify(metrics)}`);
    await testInfo.attach("ux1-layout-metrics.json", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });

    const byName = new Map(metrics.map((metric) => [metric.name, metric]));
    expect(byName.get("items-container-620")?.isCard).toBe(true);
    expect(byName.get("items-container-700")?.isCard).toBe(true);
    expect(byName.get("items-container-1000")?.isCard).toBe(false);
    expect(byName.get("items-container-620")?.itemIdVisible).toBe(true);
    expect(byName.get("items-container-700")?.itemIdVisible).toBe(true);
    expect(byName.get("items-container-1000")?.idColumnVisible).toBe(true);
    for (const viewport of [320, 390, 768, 1024, 1440]) {
      const stock = byName.get(`stock-${viewport}`)!;
      expect(stock.actionInside).toBe(true);
      expect(stock.pageOverflow).toBe(0);
    }
    expect(byName.get("items-container-1000")?.headerPosition).toBe("sticky");
    expect(byName.get("items-container-1000")?.headerAtAppBar).toBe(true);
  });
});
