import { expect, test, type Page } from "@playwright/test";

/*
 * V1.16.4 WP3 (accepted specification §4.3, §4.4) on fictional data with the API mocked: the item sheet's next step, Stock settings,
 * Add to restock and Add to kit; a Stock in that closes the restock entry; history a page at a time; the Stock views and Pantry's
 * columns; and the sheet's pictures, which fetch no full-size picture before View larger.
 */

const session = { authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const VERSION = "2026-10-03T00:00:00.000Z";
const listed = { id: "ITM-0001", name: "Sample marker", aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING",
  onHand: 0, reorderThreshold: 3, locationId: "LOC-1", legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null as string | null, lastCountedAt: "2026-10-01T00:00:00.000Z", reorderStatus: null as string | null,
  onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null as string | null, visualType: null, iconKey: null, updatedAt: VERSION, model: null, serialNumber: null, countNeeded: false };
const extras = { notes: null, listingGaps: [], photo: null as Record<string, unknown> | null, photoCleanup: { cleanable: true, canEnable: false, cleanupReason: "" }, location: "Cabinet 1", legacyReportedAvailable: null, migratedOnHand: 0,
  migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null };
const movement = (n: number, at: string, after: number) => ({ id: `MOV-${n}`, createdAt: at, sortAt: at, movementType: "STOCK_IN", signedQuantity: 1, status: "POSTED", notes: `Delivery ${n}`, reason: "DELIVERY",
  related: null, actor: "Staff One", afterQuantity: after, borrower: null, purpose: null });
type Reorder = { id: string; status: string; desiredQuantity: number | null; updatedAt: string };

function fresh(over: Partial<typeof listed> = {}, reorder: Reorder | null = null) {
  return {
    item: { ...listed, ...extras, ...over }, reorder, historyNext: null as { at: string; id: string } | null, movements: [] as unknown[],
    sent: { settings: [] as Array<Record<string, unknown>>, details: [] as Array<Record<string, unknown>>, movements: [] as Array<Record<string, unknown>>, reorders: [] as unknown[], kits: [] as Array<Record<string, unknown>>, history: [] as string[] }
  };
}
type State = ReturnType<typeof fresh>;

async function staffPages(page: Page, state: State, stock: Record<string, unknown> = {}): Promise<void> {
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: session }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: `"r${state.sent.movements.length}"` }, json: { revision: 1, items: [{ ...listed, ...pick(state) }], categories: ["SUPPLIES"],
    locations: [{ id: "LOC-1", name: "Cabinet 1", parentId: null, active: true }], units: ["piece"] } }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, locations: [{ id: "LOC-1", name: "Cabinet 1", parentId: null, active: true }] } }));
  await page.route("**/api/staff/stock", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [{ ...listed, ...pick(state) }], locations: [], reorders: [], activity: [], ...stock } }));
  await page.route("**/api/staff/home", (route) => route.fulfill({ headers: { etag: '"h"' }, json: { catalogue: null, checks: [] } }));
  await page.route("**/api/staff/attention", (route) => route.fulfill({ headers: { etag: '"a"' }, json: { revision: 1, entries: [], groups: [], needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/items/ITM-0001", async (route) => {
    if (route.request().method() === "PATCH") {
      state.sent.details.push(route.request().postDataJSON());
      state.item.updatedAt = "2026-10-03T00:00:02.000Z";
      return route.fulfill({ json: { changed: 1, updatedAt: state.item.updatedAt } });
    }
    return route.fulfill({ json: { item: state.item, movements: state.movements, loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0, kits: [], reorder: state.reorder, historyNext: state.historyNext } });
  });
  await page.route("**/api/staff/items/ITM-0001/settings", async (route) => {
    const body = route.request().postDataJSON();
    state.sent.settings.push(body);
    if (body.updatedAt !== state.item.updatedAt) return route.fulfill({ status: 409, json: { error: "Someone else changed this item. Reload to see the latest." } });
    state.item = { ...state.item, status: body.status, reorderThreshold: body.reorderThreshold, stockArea: body.stockArea, expiresOn: body.expiresOn || null, updatedAt: "2026-10-03T00:00:01.000Z" };
    return route.fulfill({ json: { changed: 1, updatedAt: state.item.updatedAt } });
  });
  await page.route("**/api/staff/items/ITM-0001/movements", async (route) => {
    const body = route.request().postDataJSON();
    state.sent.movements.push(body);
    state.item.onHand += body.kind === "IN" ? body.quantity : -body.quantity;
    if (body.reorderId) state.reorder = null;
    return route.fulfill({ json: { onHand: state.item.onHand, change: body.quantity } });
  });
  await page.route("**/api/staff/reorders", async (route) => {
    state.sent.reorders.push(route.request().postDataJSON());
    state.reorder = { id: "RO-0001", status: "NEEDS_RESTOCK", desiredQuantity: 5, updatedAt: VERSION };
    return route.fulfill({ status: 201, json: { id: "RO-0001" } });
  });
  await page.route("**/api/staff/items/ITM-0001/history*", async (route) => {
    state.sent.history.push(new URL(route.request().url()).searchParams.get("before") ?? "");
    return route.fulfill({ json: { movements: [movement(1, "2026-10-01T00:00:00.000Z", 1)], events: [], next: null } });
  });
  await page.route("**/api/staff/kits", (route) => route.fulfill({ json: { kits: [{ id: "KIT-0001", name: "Craft kit", active: true }, { id: "KIT-0002", name: "Retired kit", active: false }], templates: [] } }));
  await page.route("**/api/staff/kits/KIT-0001", async (route) => {
    if (route.request().method() === "PATCH") {
      state.sent.kits.push(route.request().postDataJSON());
      return route.fulfill({ json: { changed: 1, updatedAt: "2026-10-03T00:00:05.000Z" } });
    }
    return route.fulfill({ json: { kit: { id: "KIT-0001", name: "Craft kit", description: "Glue and paper", locationId: null, active: true, updatedAt: "2026-10-02T00:00:00.000Z" },
      components: [{ itemId: "ITM-0009", required: 4 }], checks: [], lastCheck: null } });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}
const pick = ({ item, reorder }: State) => ({ onHand: item.onHand, status: item.status, reorderThreshold: item.reorderThreshold, stockArea: item.stockArea, expiresOn: item.expiresOn, updatedAt: item.updatedAt, reorderStatus: reorder?.status ?? null });
const sheetOf = (page: Page) => page.getByRole("dialog", { name: "Sample marker" });

test("the sheet leads with the item's next step, and a Stock in offers to close its restock entry", async ({ page }) => {
  const state = fresh({}, { id: "RO-0001", status: "NEEDS_RESTOCK", desiredQuantity: 5, updatedAt: VERSION });
  await staffPages(page, state);
  await page.goto("/staff/items?item=ITM-0001");
  const sheet = sheetOf(page);
  const next = sheet.locator(".profile__next").getByRole("button");
  await expect(next).toHaveText("Stock in");
  // One tag per axis: its availability and its restock entry.
  await expect(sheet.locator(".profile .tags .tag")).toHaveText(["Out of stock", "Restock requested"]);

  // Typed by hand with the box cleared, a Stock in leaves the entry open.
  const quantity = sheet.getByLabel("Quantity on hand");
  await quantity.fill("2");
  const closer = sheet.getByRole("checkbox", { name: "Close its requested restock with this stock in" });
  await expect(closer).toBeChecked();
  await closer.uncheck();
  await sheet.getByRole("radio", { name: "New stock received" }).check();
  await sheet.getByRole("button", { name: "Add 2" }).click();
  await expect.poll(() => state.sent.movements.length).toBe(1);
  expect(state.sent.movements[0]).toMatchObject({ kind: "IN", quantity: 2, reorderId: null });

  // The next step brings the restock's quantity, with the box ticked: one write closes the entry.
  await expect(sheet.locator(".profile__next").getByRole("button")).toHaveText("Stock in");
  await sheet.locator(".profile__next").getByRole("button").click();
  await expect(quantity).toBeFocused();
  await expect(quantity).toHaveValue("7");
  await expect(closer).toBeChecked();
  await sheet.getByRole("button", { name: "Add 5" }).click();
  await expect.poll(() => state.sent.movements.length).toBe(2);
  expect(state.sent.movements[1]).toMatchObject({ kind: "IN", quantity: 5, reason: "DELIVERY", reorderId: "RO-0001" });
  await expect(sheet.locator("#restock-state").getByRole("button", { name: "Add to restock" })).toBeVisible();
  await expect(closer).toBeHidden();
});

test("Stock settings save on their own, ask before an unsaved change is lost, and leave the edit form on the new version", async ({ page }) => {
  const state = fresh({ onHand: 4 });
  await staffPages(page, state);
  await page.goto("/staff/items?item=ITM-0001");
  const sheet = sheetOf(page);
  const settings = sheet.locator("#settings-form");
  const save = settings.getByRole("button", { name: "Save settings" });
  await expect(settings.getByLabel("Status")).toHaveValue("ACTIVE");
  await expect(settings.getByLabel("Status").locator("option")).toHaveText(["Active", "Active, needs a count", "Inactive"]);
  await expect(save).toBeHidden();
  await expect(settings.getByLabel(/Earliest expiry/)).toBeHidden();

  await settings.getByLabel("Reorder level").fill("5");
  await expect(save).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByRole("alertdialog", { name: "Discard your changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(settings.getByLabel("Reorder level")).toHaveValue("5");

  await settings.getByLabel("Stock area").selectOption("Pantry");
  await settings.getByLabel(/Earliest expiry/).fill("2026-12-01");
  await save.click();
  await expect(page.getByText("Stock settings saved.")).toBeVisible();
  expect(state.sent.settings).toEqual([{ status: "ACTIVE", reorderThreshold: 5, stockArea: "Pantry", expiresOn: "2026-12-01", updatedAt: VERSION }]);
  await expect(save).toBeHidden();
  // The Save button goes once saved; focus stays in the form rather than falling to the page.
  await expect(settings.getByLabel("Reorder level")).toBeFocused();

  // The edit form sends the version the settings left, and none of the settings' own fields.
  await sheet.getByRole("tab", { name: "Edit details" }).click();
  await page.locator("#f-name").fill("Sample marker, fine tip");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => state.sent.details.length).toBe(1);
  expect(state.sent.details[0]).toMatchObject({ updatedAt: "2026-10-03T00:00:01.000Z", status: "ACTIVE", reorderThreshold: 5 });
  expect(state.sent.details[0]).not.toHaveProperty("stockArea");
  expect(state.sent.details[0]).not.toHaveProperty("expiresOn");
});

test("someone who moves to another field while Stock settings save keeps their place", async ({ page }) => {
  const state = fresh({ onHand: 4 });
  await staffPages(page, state);
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/staff/items/ITM-0001/settings", async (route) => { await held; await route.fallback(); });
  await page.goto("/staff/items?item=ITM-0001");
  const settings = sheetOf(page).locator("#settings-form");
  await settings.getByLabel("Reorder level").fill("6");
  await settings.getByRole("button", { name: "Save settings" }).click();
  await settings.getByLabel("Stock area").focus();
  release();
  await expect(page.getByText("Stock settings saved.")).toBeVisible();
  await expect(settings.getByLabel("Stock area")).toBeFocused();
});

test("a stale Stock settings save is refused and offers the latest details", async ({ page }) => {
  const state = fresh({ onHand: 4 });
  await staffPages(page, state);
  await page.goto("/staff/items?item=ITM-0001");
  const settings = sheetOf(page).locator("#settings-form");
  await expect(settings).toBeVisible();
  state.item.updatedAt = "2026-10-04T00:00:00.000Z";
  await settings.getByLabel("Reorder level").fill("-1");
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings.getByRole("alert")).toHaveText("The reorder level can't be negative.");
  await expect(settings.getByLabel("Reorder level")).toBeFocused();
  expect(state.sent.settings).toHaveLength(0);
  await settings.getByLabel("Reorder level").fill("2");
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings.getByRole("alert")).toContainText("Someone else changed this item.");
  await settings.getByRole("button", { name: "Load the latest details" }).click();
  await expect(settings.getByLabel("Reorder level")).toHaveValue("3");
  await expect(page.getByRole("alertdialog", { name: "Discard your changes?" })).toHaveCount(0);
});

test("Add to restock and Add to kit work from the item's sheet", async ({ page }) => {
  const state = fresh({ onHand: 4 });
  await staffPages(page, state);
  await page.goto("/staff/items?item=ITM-0001");
  const sheet = sheetOf(page);
  await sheet.locator("#restock-state").getByRole("button", { name: "Add to restock" }).click();
  await expect(page.getByText("Sample marker added to the restock list.")).toBeVisible();
  expect(state.sent.reorders).toEqual([{ itemId: "ITM-0001" }]);
  await expect(sheet.locator("#restock-state")).toContainText("Restock requested");
  await expect(sheet.locator("#restock-state").getByRole("link", { name: "Restock list" })).toBeFocused();

  const opener = sheet.locator(".stock-settings__links").getByRole("button", { name: "Add to kit" });
  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  const adder = sheet.locator("#kit-adder");
  // Only kits in use are offered.
  await expect(adder.getByLabel("Kit").locator("option")).toHaveText(["Craft kit"]);
  await adder.getByLabel("Needed").fill("0");
  await adder.getByRole("button", { name: "Add to kit" }).click();
  await expect(adder.getByRole("alert")).toHaveText("The quantity needed must be at least 1.");
  expect(state.sent.kits).toHaveLength(0);
  await adder.getByLabel("Needed").fill("2");
  await adder.getByRole("button", { name: "Add to kit" }).click();
  await expect(page.getByText("Sample marker added to Craft kit.")).toBeVisible();
  // The kit's whole list goes back under its version, the item added once at the end.
  expect(state.sent.kits).toEqual([{ name: "Craft kit", description: "Glue and paper", locationId: null, active: true, updatedAt: "2026-10-02T00:00:00.000Z",
    components: [{ itemId: "ITM-0009", required: 4 }, { itemId: "ITM-0001", required: 2 }] }]);
  await expect(adder).toBeHidden();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
});

test("History shows a page and brings the older one on request", async ({ page }) => {
  const state = fresh({ onHand: 3 });
  state.movements = [movement(3, "2026-10-03T00:00:00.000Z", 3), movement(2, "2026-10-02T00:00:00.000Z", 2)];
  state.historyNext = { at: "2026-10-02T00:00:00.000Z", id: "MOV-2" };
  await staffPages(page, state);
  await page.goto("/staff/items?item=ITM-0001");
  const sheet = sheetOf(page);
  await sheet.getByRole("tab", { name: "History" }).click();
  await expect(sheet.locator("#history .history__item")).toHaveCount(2);
  await sheet.getByRole("button", { name: "Show older history" }).click();
  await expect(sheet.locator("#history .history__item")).toHaveCount(3);
  await expect(sheet.locator("#history .history__note")).toHaveText(["Delivery 3", "Delivery 2", "Delivery 1"]);
  expect(state.sent.history).toEqual(["2026-10-02T00:00:00.000Z,MOV-2"]);
  await expect(sheet.getByRole("button", { name: "Show older history" })).toHaveCount(0);
});

test("Stock opens on Low & out of stock, and Pantry shows minimum, shortage, 30 days of use and expiry", async ({ page }) => {
  const state = fresh({ onHand: 1, stockArea: "Pantry", expiresOn: "2099-01-01" });
  await staffPages(page, state, { used: { "ITM-0001": 5 } });
  await page.goto("/staff/stock");
  const views = page.locator("#stock-views").getByRole("button");
  await expect(views).toHaveText([/^Low & out of stock/, /^Restock/, /^Movements/, /^Pantry/]);
  await expect(views.first()).toHaveAttribute("aria-pressed", "true");
  await page.locator("#stock-views").getByRole("button", { name: /^Pantry/ }).click();
  const table = page.locator("table.data-table--pantry");
  await expect(table.locator("thead th")).toHaveText(["Item", "On hand", "Minimum", "Shortage", "Used, 30 days", "Expiry", "Actions"]);
  const row = table.locator("tr[data-key=ITM-0001]");
  await expect(row.locator(".col-level")).toContainText("3");
  await expect(row.locator(".col-short")).toContainText("2 short");
  await expect(row.locator(".col-used")).toContainText("5");
  await row.getByRole("button", { name: "More actions for Sample marker" }).click();
  await expect(row.getByRole("button", { name: "Count", exact: true })).toBeVisible();
});

test.describe("the sheet's pictures (§4.4)", () => {
  const PHOTO = "00000000-0000-4000-8000-0000000000e1";
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="#e8e3dd"/><rect x="60" y="40" width="40" height="80" rx="4" fill="#4b2a86"/></svg>';

  async function withPicture(page: Page, detailAnswer: "ok" | "broken" | "gone"): Promise<string[]> {
    const asked: string[] = [];
    const state = fresh({ onHand: 4, photoId: PHOTO });
    state.item.photo = { id: PHOTO, width: 160, height: 160, cutout: true, cutoutThumb: true, cleanable: true };
    await staffPages(page, state);
    await page.route("**/api/staff/media/**", (route) => {
      const url = new URL(route.request().url());
      asked.push(url.pathname);
      if (detailAnswer !== "ok" && url.pathname.endsWith("/detail")) return route.fulfill({ status: 404, body: "" });
      if (detailAnswer === "gone" && url.pathname.endsWith("/thumb")) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ contentType: "image/svg+xml", body: svg });
    });
    return asked;
  }

  test("the item sheet stands the cut-out's detail picture on its pedestal and fetches the full picture only for View larger", async ({ page }) => {
    const asked = await withPicture(page, "ok");
    await page.goto("/staff/items?item=ITM-0001");
    const panel = sheetOf(page).locator("#photo-panel");
    const pedestal = panel.locator(".pedestal img");
    await expect(pedestal).toHaveAttribute("src", new RegExp(`^/api/staff/media/${PHOTO}/detail\\?v=2&p=`));
    await expect(panel.locator(".pedestal__item")).toHaveClass(/is-seated/);
    expect(asked.filter((path) => /\/(display|cutout)$/.test(path))).toEqual([]);
    await panel.locator("[data-photo-menu]").click();
    await panel.getByRole("menuitem", { name: "View larger", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /^Photo of Sample marker/ })).toBeVisible();
    await expect.poll(() => asked.some((path) => /\/(display|cutout)$/.test(path))).toBe(true);
  });

  test("a detail picture that will not load falls back to the thumbnail", async ({ page }) => {
    await withPicture(page, "broken");
    await page.goto("/staff/items?item=ITM-0001");
    const panel = sheetOf(page).locator("#photo-panel");
    await expect(panel.locator(".pedestal img")).toHaveAttribute("src", new RegExp(`^/api/staff/media/${PHOTO}/thumb\\?v=2`));
    await expect(panel.locator(".pedestal__item")).toHaveClass(/is-seated/);
  });

  test("when the thumbnail fails too, the tile shows the item's icon instead of a broken picture", async ({ page }) => {
    await withPicture(page, "gone");
    await page.goto("/staff/items?item=ITM-0001");
    const panel = sheetOf(page).locator("#photo-panel");
    await expect(panel.locator("[data-tile] .item-visual .item-icon")).toBeVisible();
    await expect(panel.locator("[data-tile] img")).toHaveCount(0);
    await expect(panel.locator(".photo-tile--pedestal")).toHaveCount(0);
    // The picture's menu still opens from the tile.
    await panel.locator("[data-photo-menu]").click();
    await expect(panel.getByRole("menuitem", { name: "View larger", exact: true })).toBeVisible();
  });

  test("on a phone an item without a photo shows a small icon chip, and its stock and next step stay in view", async ({ page }) => {
    await staffPages(page, fresh());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff/items?item=ITM-0001");
    const sheet = sheetOf(page);
    const chip = sheet.locator(".photo-tile--chip");
    await expect(chip).toBeVisible();
    const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const box = (await chip.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(4 * rem + 0.5);
    expect(box.height).toBeLessThanOrEqual(4 * rem + 0.5);
    await expect(sheet.locator(".profile__stock")).toBeInViewport();
    await expect(sheet.locator(".profile__next")).toBeInViewport();
  });
});
