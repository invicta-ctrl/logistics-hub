import { expect, test, type Page, type TestInfo } from "@playwright/test";

/* V1.14: the items table draws a page of rows at a time, so a bigger catalog does not mean a bigger page. Fictional data, API mocked. */

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const item = (index: number) => ({ id: `ITM-${String(index).padStart(5, "0")}`, name: `Sample item ${index}`, aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", onHand: 10, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null });

async function open(page: Page, count: number, fixture?: Array<ReturnType<typeof item>>) {
  const items = fixture ?? Array.from({ length: count }, (_, at) => item(at + 1));
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
  moreInside: boolean;
  pageOverflow: number;
  headerPosition: string;
  headerTop: number | null;
  headerAtAppBar: boolean;
  itemIdVisible: boolean;
  idColumnVisible: boolean;
};

const stockItem = { ...item(1), name: "Replacement toner cartridge", onHand: 0, reorderThreshold: 3, countNeeded: true, stockArea: "Pantry" };
const stockReorder = { id: "REO-00001", itemId: stockItem.id, itemName: stockItem.name, unit: stockItem.unit, status: "NEEDS_RESTOCK", desiredQuantity: 3, note: null, updatedAt: "2026-10-08T00:00:00.000Z", closedAt: null, updatedBy: null };

async function openStock(page: Page, items = [stockItem], reorders = [stockReorder]) {
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 1, bySource: { Stock: 1 } }) }));
  await page.route("**/api/staff/stock", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items, locations: [], reorders, activity: [] }) }));
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
    const actionButtons = [...element.querySelectorAll<HTMLElement>(".col-actions > .row-actions > .button")];
    const actionInside = actionButtons.length > 0 && actionButtons.every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left >= wrapRect.left && rect.right <= wrapRect.right && rect.top >= wrapRect.top && rect.bottom <= wrapRect.bottom;
    });
    const moreButtons = [...element.querySelectorAll<HTMLElement>(".row-menu__trigger")];
    const moreInside = moreButtons.length > 0 && moreButtons.every((button) => {
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
      moreInside,
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


test("formats stock quantities and keeps Items sorting calm", async ({ page }) => {
  const formatted = { ...item(1), onHand: 1_500 };
  const inactive = { ...item(2), status: "INACTIVE" };
  await open(page, 2, [formatted, inactive]);
  await page.goto("/staff/items");
  await expect(page.locator(`[data-qty="${formatted.id}"]`)).toHaveText("1,500");
  const categorySort = page.getByRole("button", { name: "Category" });
  await expect(categorySort.locator(".icon")).toHaveCSS("opacity", "0");
  await categorySort.hover();
  await expect(categorySort.locator(".icon")).toHaveCSS("opacity", "0.45");
  await categorySort.focus();
  await expect(categorySort.locator(".icon")).toHaveCSS("opacity", "0.45");
  const onHandSort = page.getByRole("button", { name: "On hand" });
  await onHandSort.click();
  await expect(page).toHaveURL(/sort=onHand-desc/);
  await expect(page.locator('th:has([data-sort="onHand"])')).toHaveAttribute("aria-sort", "descending");
  await expect(onHandSort.locator(".icon")).toHaveCSS("opacity", "1");

  const zeroLevel = { ...stockItem, id: "ITM-00002", name: "Zero threshold stock", onHand: 0, reorderThreshold: 0, stockArea: "Inventory" };
  const largeStock = { ...stockItem, onHand: 1_500, reorderThreshold: 2_000 };
  const presentReorder = { ...stockReorder, desiredQuantity: 2_500 };
  const missingReorder = { ...stockReorder, id: "REO-00002", itemId: "ITM-MISSING", itemName: "Archived binder", desiredQuantity: 2_500 };
  await page.unrouteAll();
  await openStock(page, [largeStock, zeroLevel], [presentReorder, missingReorder]);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/staff/stock");
  await expect(page.locator(`tr[data-key="${largeStock.id}"] .col-qty`)).toContainText("1,500");
  await expect(page.locator(`tr[data-key="${largeStock.id}"] .col-level`)).toContainText("Reorder level: 2,000");
  await expect(page.locator(`tr[data-key="${zeroLevel.id}"] .col-level`)).toContainText("Reorder level: Not set");
  await page.getByRole("button", { name: /Restock list/ }).click();
  await expect(page.locator('tr[data-key="REO-00001"] .col-qty')).toContainText("1,500");
  await expect(page.getByLabel(`Restock quantity for ${largeStock.name}`)).toHaveValue("2500");
  await expect(page.getByLabel(`Restock quantity for ${largeStock.name}`)).toHaveCSS("text-align", "right");
  await expect(page.locator('tr[data-key="REO-00002"] .col-qty')).toHaveText("Not available");
});

test("keeps live quantity animation grouped, including reduced motion", async ({ page }) => {
  await open(page, 1, [{ ...item(1), onHand: 1_000 }]);
  await page.goto("/staff/items");
  const quantity = page.locator('[data-qty="ITM-00001"]');
  await quantity.evaluate(async (element) => {
    const modulePath = "/src/ui.ts";
    const { animateNumber } = await import(modulePath);
    animateNumber(element, 1_500, 1_000);
  });
  await expect(quantity).toHaveText("1,500");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await quantity.evaluate(async (element) => {
    const modulePath = "/src/ui.ts";
    const { animateNumber } = await import(modulePath);
    animateNumber(element, 2_500, 1_500);
  });
  await expect(quantity).toHaveText("2,500");
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
      expect(stock.moreInside).toBe(true);
      expect(stock.pageOverflow).toBe(0);
    }
    expect(byName.get("items-container-1000")?.headerPosition).toBe("sticky");
    expect(byName.get("items-container-1000")?.headerAtAppBar).toBe(true);
  });
});

test("Stock row menus keep one primary action and restore focus after Escape", async ({ page }) => {
  await openStock(page);
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto("/staff/stock");

  const more = page.getByRole("button", { name: `More actions for ${stockItem.name}` });
  await expect(page.getByRole("button", { name: "Stock in" })).toBeVisible();
  await expect(more).toBeVisible();
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const menu = page.locator(`#attention-actions-${stockItem.id}`);
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
  })).toBe(true);
  await expect(page.getByRole("button", { name: "Add to restock" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("button", { name: /Restock list/ }).click();
  await expect(page.getByRole("button", { name: "Receive" })).toBeVisible();
  const restockMore = page.getByRole("button", { name: `More actions for ${stockItem.name}` });
  await expect(restockMore).toBeVisible();
  await restockMore.click();
  await expect(page.getByRole("button", { name: "Mark planned" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(restockMore).toBeFocused();
  await expect(page.getByLabel(`Restock quantity for ${stockItem.name}`)).toBeVisible();

  await page.getByRole("button", { name: /Pantry/ }).click();
  await expect(page.getByRole("button", { name: "Use" })).toBeVisible();
  const pantryMore = page.getByRole("button", { name: `More actions for ${stockItem.name}` });
  await expect(pantryMore).toBeVisible();
  await pantryMore.click();
  await page.getByRole("button", { name: "Restock", exact: true }).click();
  await expect(page.locator("#record-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(pantryMore).toBeFocused();
});

test("Stock More actions stays reachable without the Popover API and disables a pending action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.addInitScript(() => { delete (HTMLElement.prototype as { showPopover?: unknown }).showPopover; });
  await openStock(page);
  let posts = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/staff/reorders", async (route) => {
    posts += 1;
    await held;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.goto("/staff/stock");
  const more = page.getByRole("button", { name: `More actions for ${stockItem.name}` });
  await more.click();
  const fallbackMenu = page.locator(`#attention-actions-${stockItem.id}`);
  await expect(more).not.toHaveAttribute("popovertarget");
  await expect(more).toHaveAttribute("aria-controls", `attention-actions-${stockItem.id}`);
  await expect(fallbackMenu).not.toHaveAttribute("popover");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const add = page.getByRole("button", { name: "Add to restock" });
  await expect(add).toBeVisible();
  expect(await more.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const row = element.closest<HTMLElement>(".row-actions")!.getBoundingClientRect();
    return rect.left >= row.left && rect.right <= row.right;
  })).toBe(true);
  expect(await fallbackMenu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const row = element.closest<HTMLElement>(".row-actions")!.getBoundingClientRect();
    return rect.left >= row.left && rect.right <= row.right;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press("Tab");
  await expect(add).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  const submit = add.click();
  await expect(add).toBeDisabled();
  release();
  await submit;
  await expect.poll(() => posts).toBe(1);
});
