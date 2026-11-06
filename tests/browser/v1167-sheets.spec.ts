import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * V1.16.7 (docs/specs/accepted/2026-10-29-workspace-depth.md §3) on fictional data with the API mocked: the item sheet's stage holds
 * only its picture, at 375 and 1440 px, with and without a photo; Overview is the profile and Edit details holds Stock settings; Low &
 * out of stock shows each item's picture; and a place's sheet takes the item sheet's layout, its items opening the same item sheet as
 * All items. No list or sheet here asks for a display-size picture.
 */

const session = { authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const VERSION = "2026-10-03T00:00:00.000Z";
const PHOTO = "00000000-0000-4000-8000-0000000000a7";
const base = { aliases: null, category: "SUPPLIES", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", reorderThreshold: 3, legacyLocation: null, openReports: 0, listed: false,
  stockArea: "Inventory", expiresOn: null, lastCountedAt: "2026-10-01T00:00:00.000Z", reorderStatus: null, onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, visualType: null, iconKey: null,
  updatedAt: VERSION, model: null as string | null, serialNumber: null as string | null, countNeeded: false };
const marker = { ...base, id: "ITM-0001", name: "Sample marker", itemType: "Consumable", onHand: 0, locationId: "LOC-1", photoId: PHOTO, model: "M-2", serialNumber: "S-77" };
const stapler = { ...base, id: "ITM-0002", name: "Sample stapler", itemType: "Loanable", onHand: 1, locationId: "LOC-1", photoId: null as string | null, reorderThreshold: 2 };
const LISTED = [marker, stapler];
const extras = { notes: null, listingGaps: ["Choose who it is shown to"], photoCleanup: { cleanable: true, canEnable: false, cleanupReason: "" }, location: "Cabinet 1", legacyReportedAvailable: null, migratedOnHand: 0,
  migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null };
// A tall photo (3:4), so a stage that cropped it would be caught.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="300" height="400" fill="#f4f1ec"/><rect x="100" y="40" width="100" height="320" rx="8" fill="#4b2a86"/></svg>';

async function staffPages(page: Page, over: { stapler?: Partial<typeof stapler> } = {}): Promise<string[]> {
  const asked: string[] = [];
  const items = LISTED.map((entry) => entry.id === stapler.id ? { ...entry, ...over.stapler } : entry);
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: session }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/attention", (route) => route.fulfill({ headers: { etag: '"a"' }, json: { revision: 1, entries: [], groups: [], needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/home", (route) => route.fulfill({ headers: { etag: '"h"' }, json: { catalogue: null, checks: [] } }));
  const places = [{ id: "LOC-1", name: "Cabinet 1", parentId: null, active: true }];
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items, categories: ["SUPPLIES"], locations: places, units: ["piece"] } }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ headers: { etag: '"l1"' }, json: { revision: 1, locations: [{ ...places[0], directions: "Grey cabinet by the window.", visibility: "STAFF_ONLY", updatedAt: VERSION,
    photo: null, itemCount: 2, openReports: 0, lastCheckedAt: null }] } }));
  await page.route("**/api/staff/stock", (route) => route.fulfill({ headers: { etag: '"s1"' }, json: { revision: 1, items, locations: places, reorders: [], activity: [] } }));
  for (const entry of items) {
    await page.route(`**/api/staff/items/${entry.id}`, (route) => route.fulfill({ json: { item: { ...entry, ...extras, photo: entry.photoId ? { id: entry.photoId, width: 300, height: 400, detail: true, cleanable: true } : null },
      movements: [], loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0, kits: [], reorder: null, historyNext: null } }));
  }
  await page.route("**/api/staff/media/**", (route) => { asked.push(new URL(route.request().url()).pathname); return route.fulfill({ contentType: "image/svg+xml", body: SVG }); });
  return asked;
}
const sheetOf = (page: Page, name = "Sample marker") => page.getByRole("dialog", { name });
// The stage, its tile and what stands on it, measured in one frame once the picture has settled in: it enters slightly scaled down
// (object-settle), so a box read during the entrance is smaller than the stage it stands in.
const measure = (tile: Locator, inner: string) => tile.evaluate(async (element, selector) => {
  const plate = element.closest("#photo-panel")!;
  await Promise.all(plate.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => null)));
  const rect = (target: Element | null) => { const r = target!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  return { plate: rect(plate), box: rect(element), inner: rect(element.querySelector(selector)) };
}, inner);

test("the stage holds only the picture; Overview is the profile; Edit details holds Stock settings after the item's fields", async ({ page }) => {
  await staffPages(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/staff/items?item=ITM-0001");
  const sheet = sheetOf(page);
  const stage = sheet.locator("#photo-panel");
  await expect(stage.locator(".photo-tile")).toBeVisible();
  // Nothing but the picture and its controls: no count, next step, tags or place on the stage.
  await expect(stage.locator(".profile__next, .tags, .profile__meta, #profile-info")).toHaveCount(0);

  const overview = sheet.locator("#panel-overview");
  await expect(overview.getByLabel("Quantity on hand")).toBeVisible();
  await expect(overview.locator("#profile-info .profile__next").getByRole("button")).toHaveText("Stock in");
  await expect(overview.locator("#profile-info .tags .tag")).toHaveText(["Out of stock"]);
  await expect(overview.locator("#profile-info")).toContainText("Consumable · Supplies");
  await expect(overview.locator("#profile-info .profile__meta--place")).toContainText("Cabinet 1");
  await expect(overview.getByRole("button", { name: "Where is it?" })).toBeVisible();
  const facts = overview.locator("dl.facts dt");
  await expect(facts).toHaveText(["Status", "Lending Hub", "Unit", "Model", "Serial number"]);
  await expect(overview.locator("dl.facts")).toContainText("Not listed");
  await expect(overview.locator("details.advanced-details > summary")).toHaveText("Availability & record");
  await expect(overview.locator("#settings-form, #restock-state, [data-add-kit]")).toHaveCount(0);

  await sheet.getByRole("tab", { name: "Edit details" }).click();
  const details = sheet.locator("#panel-details");
  await expect(details.locator("#settings-form")).toBeVisible();
  await expect(details.locator("#settings-form").getByLabel("Reorder level")).toHaveValue("3");
  await expect(details.locator("#settings-form").getByLabel("Stock area")).toBeVisible();
  await expect(details.locator("#settings-form").getByLabel("Status")).toBeVisible();
  await expect(details.locator("#restock-state").getByRole("button", { name: "Add to restock" })).toBeVisible();
  await expect(details.getByRole("button", { name: "Add to kit" })).toBeVisible();
  // Its own group, after the item's fields and their Save, never inside the item form.
  expect(await details.evaluate((panel) => {
    const form = panel.querySelector("#details-form")!;
    const settings = panel.querySelector(".stock-settings")!;
    return !form.contains(settings) && Boolean(form.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  // The item form's Save bar does not cover the group's heading.
  await details.locator(".stock-settings").scrollIntoViewIfNeeded();
  const bar = (await details.locator("#details-form .form-actions").boundingBox())!;
  const heading = (await details.locator("#settings-title").boundingBox())!;
  expect(heading.y).toBeGreaterThanOrEqual(bar.y + bar.height);
});

for (const width of [375, 1440]) {
  test(`at ${width}px a photo fills the stage at the stage's proportions, whole and uncropped, from the detail picture only`, async ({ page }) => {
    const asked = await staffPages(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/staff/items?item=ITM-0001");
    const stage = sheetOf(page).locator("#photo-panel");
    const tile = stage.locator(".photo-tile");
    const photo = tile.locator("img.item-visual__photo");
    await expect(tile.locator(".item-visual--loaded")).toBeVisible();
    const { plate, box, inner: image } = await measure(tile, "img.item-visual__photo");
    // The stage spans the plate (less its frame) at 16:10, on a phone and on a desktop.
    expect(box.width).toBeGreaterThan(plate.width - 20);
    expect(Math.abs(box.height - box.width * 10 / 16)).toBeLessThan(2);
    // The photo's box is the whole stage, and it is contained, never cropped; the same picture, blurred, fills the stage around it.
    expect(Math.abs(image.width - box.width)).toBeLessThan(2);
    expect(Math.abs(image.height - box.height)).toBeLessThan(2);
    await expect(photo).toHaveCSS("object-fit", "contain");
    await expect(tile.locator(".photo-tile__ambient")).toHaveAttribute("src", new RegExp(`^/api/staff/media/${PHOTO}/detail`));
    // LH-UI-88: the blurred halo is gone; the picture stands on the flat stage, so the ambient copy takes no room and paints nothing.
    await expect(tile.locator(".photo-tile__ambient")).toHaveCSS("display", "none");
    await expect(tile.locator(".photo-tile__ambient")).toHaveAttribute("aria-hidden", "true");
    expect(asked.filter((path) => /\/display$/.test(path))).toEqual([]);
    // The photo's menu still opens from the stage.
    await stage.locator("[data-photo-menu]").click();
    await expect(stage.getByRole("menuitem", { name: "View larger" })).toBeVisible();
  });

  test(`at ${width}px an item without a photo stands centred on the stage with Add photo`, async ({ page }) => {
    await staffPages(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/staff/items?item=ITM-0002");
    const sheet = sheetOf(page, "Sample stapler");
    const tile = sheet.getByRole("button", { name: /^Add photo or choose an icon for Sample stapler/ });
    await expect(tile).toContainText("Add photo");
    const { plate, box, inner: icon } = await measure(tile, ".item-icon");
    expect(box.width).toBeGreaterThan(plate.width - 20);
    expect(Math.abs(box.height - box.width * 10 / 16)).toBeLessThan(2);
    // Centred, and at stage size: far larger than the 4 rem chip it replaces.
    expect(Math.abs(icon.x + icon.width / 2 - (box.x + box.width / 2))).toBeLessThan(2);
    expect(icon.height).toBeGreaterThan(box.height * 0.4);
    await tile.click();
    await expect(sheet.getByRole("menuitem", { name: "Add photo" })).toBeVisible();
  });
}

test("a photo that cannot load leaves the item's icon on the stage, with no broken picture behind it", async ({ page }) => {
  await staffPages(page);
  await page.route("**/api/staff/media/**", (route) => route.abort());
  await page.goto("/staff/items?item=ITM-0001");
  const tile = sheetOf(page).locator("#photo-panel .photo-tile");
  await expect(tile.locator(".item-icon")).toBeVisible();
  // Neither the photo nor its blurred copy that fills the stage is left behind.
  await expect(tile.locator("img")).toHaveCount(0);
});

test("an inactive item's Loan tab sends staff to Stock settings in Edit details", async ({ page }) => {
  await staffPages(page, { stapler: { status: "INACTIVE" } });
  await page.goto("/staff/items?item=ITM-0002");
  const sheet = sheetOf(page, "Sample stapler");
  await sheet.getByRole("tab", { name: "Loan" }).click();
  await expect(sheet.locator("#panel-loan .callout")).toContainText("Set its status to Active in Stock settings, under Edit details, first.");
  await sheet.locator("#panel-loan").getByRole("button", { name: "Stock settings" }).click();
  await expect(sheet.getByRole("tab", { name: "Edit details" })).toHaveAttribute("aria-selected", "true");
  await expect(sheet.locator("#settings-form").getByLabel("Status")).toBeFocused();
});

test("Low & out of stock shows each item's picture, the same thumbnail as All items", async ({ page }) => {
  const asked = await staffPages(page);
  await page.goto("/staff/items");
  const listed = page.locator("tr[data-key=ITM-0001] .thumb img");
  await expect(listed).toBeVisible();
  const allItems = await listed.getAttribute("src");
  await page.goto("/staff/stock");
  const marked = page.locator("tr[data-key=ITM-0001]");
  await expect(marked.locator(".thumb img")).toBeVisible();
  expect(await marked.locator(".thumb img").getAttribute("src")).toBe(allItems);
  // Without a photo, its icon in the same place.
  const plain = page.locator("tr[data-key=ITM-0002]");
  await expect(plain.locator(".thumb .item-icon")).toBeVisible();
  await expect(plain.locator(".thumb img")).toHaveCount(0);
  // The picture sits beside the name, never over it.
  const thumb = (await marked.locator(".thumb").boundingBox())!;
  const name = (await marked.locator(".row-link").boundingBox())!;
  expect(thumb.x + thumb.width).toBeLessThanOrEqual(name.x);
  expect(asked.filter((path) => /\/(display|detail)$/.test(path))).toEqual([]);
});

test("a place opens on the item sheet's layout, and an item kept there opens the same sheet as in All items", async ({ page }) => {
  await staffPages(page);
  let filtered: string | null = null;
  await page.route("**/api/staff/activity?*", (route) => {
    filtered = new URL(route.request().url()).searchParams.get("location");
    return route.fulfill({ json: { events: [{ id: "M-1", correlationId: "MV-1", at: "2026-10-02T01:00:00.000Z", source: "MOVEMENT", type: "STOCK_IN", title: "Stock in", summary: "Staff One added 2 pieces of Sample marker.",
      actor: "Staff One", actorId: "ACC-1", itemId: "ITM-0001", itemName: "Sample marker", unit: "piece", quantity: 2, change: 2, stockChanged: true, before: 0, after: 2, reason: null, note: null, fields: [], attention: false }], nextCursor: null } });
  });
  // The item sheet as All items draws it.
  await page.goto("/staff/items?item=ITM-0002");
  const fromItems = sheetOf(page, "Sample stapler");
  await expect(fromItems.locator("#photo-panel")).toBeVisible();
  const tabs = await fromItems.getByRole("tab").allTextContents();
  await fromItems.getByRole("button", { name: "Close" }).first().click();

  await page.goto("/staff/locations?place=LOC-1");
  const placeSheet = page.getByRole("dialog", { name: "Cabinet 1" });
  // The stage, then Overview, Edit details and History, as an item's sheet.
  await expect(placeSheet.locator("#place-photo.theater")).toBeVisible();
  await expect(placeSheet.getByRole("tab")).toHaveText(["Overview", "Edit details", "History"]);
  const overview = placeSheet.locator("#place-panel-overview");
  await expect(overview).toContainText("Cabinet 1");
  await expect(overview).toContainText("Not checked yet");
  await expect(overview.getByRole("button", { name: "Check this place" })).toBeVisible();
  await expect(overview.locator(".kept-row")).toHaveText([/Sample marker/, /Sample stapler/]);
  await expect(overview.locator(".kept-row").first().locator(".thumb img")).toBeVisible();
  await expect(placeSheet.getByLabel("Name", { exact: true })).toBeHidden();

  await placeSheet.getByRole("tab", { name: "Edit details" }).click();
  await expect(placeSheet.getByLabel("Name", { exact: true })).toHaveValue("Cabinet 1");
  await expect(placeSheet.getByRole("textbox", { name: /Directions/ })).toHaveValue("Grey cabinet by the window.");
  await expect(placeSheet.getByRole("radio", { name: /Staff only/ })).toBeChecked();

  await placeSheet.getByRole("tab", { name: "History" }).click();
  await expect(placeSheet.locator("#place-history")).toContainText("Staff One added 2 pieces of Sample marker.");
  expect(filtered).toBe("Cabinet 1");
  await expect(placeSheet.getByRole("link", { name: /All activity here/ })).toHaveAttribute("href", "/staff/activity?location=Cabinet%201");

  // An item kept here opens its own sheet in All items: the same sheet, the same tabs.
  await placeSheet.getByRole("tab", { name: "Overview" }).click();
  await placeSheet.locator(".kept-row", { hasText: "Sample stapler" }).click();
  await expect(page).toHaveURL(/\/staff\/items\?item=ITM-0002/);
  const fromPlace = sheetOf(page, "Sample stapler");
  await expect(fromPlace.locator("#photo-panel")).toBeVisible();
  expect(await fromPlace.getByRole("tab").allTextContents()).toEqual(tabs);
});

test("a place's tab stays put when its details are saved", async ({ page }) => {
  await staffPages(page);
  await page.route("**/api/staff/locations/LOC-1", (route) => route.fulfill({ json: { changed: 1 } }));
  await page.goto("/staff/locations?place=LOC-1");
  const placeSheet = page.getByRole("dialog", { name: "Cabinet 1" });
  await placeSheet.getByRole("tab", { name: "Edit details" }).click();
  await placeSheet.getByRole("textbox", { name: /Directions/ }).fill("Grey cabinet by the door.");
  await placeSheet.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(placeSheet.getByRole("tab", { name: "Edit details" })).toHaveAttribute("aria-selected", "true");
  await expect(placeSheet.getByLabel("Name", { exact: true })).toBeVisible();
});

test("a place just added opens on Edit details, ready for its directions", async ({ page }) => {
  await staffPages(page);
  const shelf = { id: "LOC-2", name: "Shelf 2", parentId: null, active: true, directions: "", visibility: "STAFF_ONLY", updatedAt: VERSION, photo: null, itemCount: 0, openReports: 0, lastCheckedAt: null };
  const cabinet = { id: "LOC-1", name: "Cabinet 1", parentId: null, active: true, directions: "Grey cabinet by the window.", visibility: "STAFF_ONLY", updatedAt: VERSION, photo: null, itemCount: 2, openReports: 0, lastCheckedAt: null };
  let added = false;
  await page.route("**/api/staff/locations", (route) => {
    if (route.request().method() === "POST") { added = true; return route.fulfill({ status: 201, json: { id: shelf.id } }); }
    return route.fulfill({ headers: { etag: `"l${added ? 2 : 1}"` }, json: { revision: added ? 2 : 1, locations: added ? [cabinet, shelf] : [cabinet] } });
  });
  await page.goto("/staff/locations");
  await page.getByRole("button", { name: "New place" }).first().click();
  const form = page.getByRole("dialog", { name: "Add a place" });
  await form.getByLabel("Name", { exact: true }).fill("Shelf 2");
  await form.getByRole("button", { name: "Add place" }).click();
  await expect(page.getByText("Place added. Add directions or a picture next.")).toBeVisible();
  const placeSheet = page.getByRole("dialog", { name: "Shelf 2" });
  await expect(placeSheet.getByRole("tab", { name: "Edit details" })).toHaveAttribute("aria-selected", "true");
  await expect(placeSheet.getByRole("textbox", { name: /Directions/ })).toBeVisible();
  // Its picture's controls are on the stage, on every tab.
  await expect(placeSheet.locator("#place-photo").getByRole("button", { name: /Add picture/ })).toBeVisible();
  // Opened again, it opens on its Overview.
  await placeSheet.getByRole("button", { name: "Close" }).first().click();
  // The closed sheet leaves first, so the row's click opens a new one rather than landing mid-close (a CI-load race).
  await expect(placeSheet).toHaveCount(0);
  await page.getByRole("button", { name: /^Shelf 2/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Shelf 2" }).getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
});
