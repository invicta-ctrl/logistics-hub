import { expect, test, type Page } from "@playwright/test";

/*
 * V1.16.4 WP6 (accepted specification §4.7, acceptance 7) on fictional data with the API mocked: each surface the release names asks
 * before any way out while it holds an edit, and never once the edit is typed back. Keep editing keeps values, focus and address;
 * Forward asks as Back does; the Return dialog closes when the page moves; a live refresh keeps a typed review note; sign-out asks
 * before it ends the session; and the phone's borrower sheet asks in the app's own words, not the browser's.
 */

const VERSION = "2026-10-03T00:00:00.000Z";
const staff = { authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const owner = { ...staff, id: "ACC-owner", username: "owner.sample", displayName: "Owner Sample", role: "OWNER", access: "OWNER", recovery: { configured: true, createdAt: null } };
const item = { id: "ITM-0001", name: "Sample tripod", aliases: null, category: "EQUIPMENT", itemType: "Loanable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "STUDENTS_AND_USC_STAFF",
  onHand: 5, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: true, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null,
  onLoan: 1, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: VERSION, model: null, serialNumber: null, countNeeded: false };
const extras = { notes: null, listingGaps: [], photo: null, photoCleanup: { cleanable: true, canEnable: false, cleanupReason: "" }, location: null, legacyReportedAvailable: null, migratedOnHand: 0,
  migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null };
const loan = { id: "LN-0001", itemId: "ITM-0001", itemName: "Sample tripod", unit: "piece", quantity: 1, purpose: "INDIVIDUAL", borrowerName: "Ana Cruz", studentId: "20000100", reason: null, returnBy: null,
  status: "OUT", returnNote: null, createdAt: "2026-10-02T00:00:00.000Z", closedAt: null, createdBy: "Staff One", closedBy: null, hasPhoto: 0 };
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** The staff pages every test here passes through, as `session` sees them. */
async function staffPages(page: Page, session: Record<string, unknown> = staff): Promise<{ logouts: number }> {
  const seen = { logouts: 0 };
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: session }));
  await page.route("**/api/staff/logout", (route) => { seen.logouts += 1; return route.fulfill({ json: {} }); });
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], categories: ["EQUIPMENT"], locations: [], units: ["piece"] } }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, locations: [] } }));
  await page.route("**/api/staff/stock", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], locations: [], reorders: [], activity: [] } }));
  await page.route("**/api/staff/home", (route) => route.fulfill({ headers: { etag: '"h"' }, json: { catalogue: null, checks: [] } }));
  await page.route("**/api/staff/attention", (route) => route.fulfill({ headers: { etag: '"a"' }, json: { revision: 1, entries: [], groups: [], needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/loans", (route) => route.fulfill({ json: { today: "2026-10-03", open: [loan], closed: [], borrowers: [], items: [], totals: [], known: [] } }));
  await page.route("**/api/staff/loans/*/photo", (route) => route.fulfill({ contentType: "image/png", body: PIXEL }));
  await page.route("**/api/staff/items/ITM-0001", (route) => route.fulfill({ json: { item: { ...item, ...extras }, movements: [], loans: [loan], openUnits: [], reports: [], events: [], usesRecorded: 0,
    unitsEmptied: 0, kits: [], reorder: null, historyNext: null } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  return seen;
}

const question = (page: Page) => page.getByRole("alertdialog", { name: "Discard your changes?" });
const rail = (page: Page, name: string) => page.locator(".app-nav").getByRole("link", { name, exact: true });

test("Items: a form typed back to what it was closes at once; the Lend form asks and Keep editing keeps it", async ({ page }) => {
  await staffPages(page);
  await page.goto("/staff/items?item=ITM-0001&tab=details");
  const sheet = page.getByRole("dialog", { name: "Sample tripod" });
  const name = page.locator("#f-name");
  await name.fill("Sample tripod, tall");
  await name.fill("Sample tripod");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);

  await page.goto("/staff/items?item=ITM-0001");
  await sheet.getByRole("tab", { name: "Loan" }).click();
  const borrower = sheet.getByLabel("Borrower's full name");
  await borrower.fill("Juan Dela Cruz");
  await page.keyboard.press("Escape");
  await expect(question(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(borrower).toHaveValue("Juan Dela Cruz");
  await expect(borrower).toBeFocused();
  await expect(page).toHaveURL(/item=ITM-0001/);
  await borrower.fill("");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);
});

test("the Return dialog asks while it holds a choice, and closes with its page when Back is taken", async ({ page }) => {
  await staffPages(page);
  await page.goto("/staff/stock");
  await rail(page, "Items").click();
  await page.getByRole("button", { name: "Sample tripod" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Sample tripod" });
  await sheet.getByRole("tab", { name: "Loan" }).click();
  await sheet.getByRole("button", { name: "Return", exact: true }).click();
  const giveBack = page.locator("dialog.dialog[open]");
  await expect(giveBack).toContainText("How did it come back?");
  await giveBack.getByRole("radio", { name: "Damaged" }).check();

  const before = page.url();
  await page.goBack();
  await expect(question(page)).toBeVisible();
  await expect.poll(() => page.url()).toBe(before);
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(giveBack.getByRole("radio", { name: "Damaged" })).toBeChecked();

  // Chosen back to how it opened, the dialog holds nothing: Back leaves the page and the dialog goes with it, without asking.
  await giveBack.getByRole("radio", { name: "Returned in good condition" }).check();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
  await expect(page.locator("dialog.dialog[open]")).toHaveCount(0);
  await expect(sheet).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);
});

test("Forward asks as Back does, on a page form; Keep editing keeps the address and what was typed", async ({ page }) => {
  await staffPages(page);
  await page.goto("/staff/account");
  await rail(page, "Items").click();
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "My account", level: 1 })).toBeVisible();
  const display = page.locator("#name");
  await display.fill("Staff One Reyes");

  await page.goForward();
  await expect(question(page)).toBeVisible();
  await expect.poll(() => page.url()).toMatch(/\/staff\/account$/);
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(display).toHaveValue("Staff One Reyes");
  await expect(page).toHaveURL(/\/staff\/account$/);

  await page.goForward();
  await expect(question(page)).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("heading", { name: "Items", level: 1 })).toBeVisible();
});

test("Administration's account sheet and My account ask only while edited; sign-out asks before it ends the session", async ({ page }) => {
  const seen = await staffPages(page, owner);
  await page.route("**/api/staff/admin/accounts", (route) => route.fulfill({ json: { accounts: [] } }));
  await page.goto("/staff/admin/staff");
  await page.getByRole("button", { name: "New account" }).click();
  const sheet = page.getByRole("dialog", { name: "Create an account" });
  const name = sheet.locator("#c-name");
  await name.fill("Ana Santos");
  await page.keyboard.press("Escape");
  await expect(question(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(name).toHaveValue("Ana Santos");
  await expect(name).toBeFocused();
  await name.fill("");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);

  await page.goto("/staff/account");
  await page.locator("#current").fill("half typed");
  await rail(page, "Items").dispatchEvent("click");
  await expect(question(page)).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/staff\/account$/);

  // Sign-out asks first; Keep editing leaves the session as it was.
  await page.locator("#staff-logout").dispatchEvent("click");
  await expect(question(page)).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.locator("#current")).toHaveValue("half typed");
  expect(seen.logouts).toBe(0);
  await page.locator("#staff-logout").dispatchEvent("click");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  expect(seen.logouts).toBe(1);
});

test("Administration's other names and the Staff Directory's editor ask while edited, and not once typed back", async ({ page }) => {
  await staffPages(page, owner);
  await page.route("**/api/staff/admin/catalog", (route) => route.fulfill({ json: { active: 10, unclassified: 4, captured: 0, capturedClassified: 0 } }));
  await page.route("**/api/staff/admin/catalog/proposals", (route) => route.fulfill({ json: { proposals: [], window: 200, metrics: [] } }));
  await page.route("**/api/staff/admin/catalog/aliases**", (route) => route.fulfill({ json: { items: [{ id: "ITM-0001", name: "Sample tripod", category: "EQUIPMENT", aliases: "stand", updatedAt: VERSION }], more: false } }));
  await page.route("**/api/staff/catalogue", (route) => route.fulfill({ json: { session: null, others: [], reviewLater: { total: 0, items: [] } } }));
  await page.route("**/api/staff/admin/directory**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/accounts")) return route.fulfill({ json: { accounts: [] } });
    if (path.endsWith("/derived")) return route.fulfill({ json: { missing: [] } });
    return route.fulfill({ json: { people: [] } });
  });

  await page.goto("/staff/admin/catalog");
  await page.getByRole("button", { name: "Edit other names of Sample tripod" }).click();
  const names = page.locator("#names-input");
  await names.fill("stand, tripod stand");
  await page.keyboard.press("Escape");
  await expect(question(page)).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await names.fill("stand");
  await page.keyboard.press("Escape");
  await expect(page.locator("#names-form")).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);

  await page.goto("/staff/admin/directory");
  await page.getByRole("button", { name: "Add person" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add a person" });
  await sheet.locator("#p-name").fill("Ana Marie Santos");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(question(page)).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: "Add person" }).first().click();
  await sheet.locator("#p-name").fill("Ana");
  await sheet.locator("#p-name").fill("");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);
});

test("Kits and Locations count a form typed back to what it was as clean", async ({ page }) => {
  await staffPages(page);
  await page.route("**/api/staff/kit-recent", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/staff/kits", (route) => route.fulfill({ json: { revision: 1, kits: [{ id: "KIT-0001", name: "Craft kit", description: null, locationId: null, active: true, updatedAt: VERSION }], templates: [] } }));
  await page.route("**/api/staff/kits/KIT-0001", (route) => route.fulfill({ json: { kit: { id: "KIT-0001", name: "Craft kit", description: "Glue and paper", locationId: null, active: true, updatedAt: VERSION },
    components: [], checks: [], lastCheck: null } }));

  await page.goto("/staff/kits?kit=KIT-0001");
  await page.getByRole("button", { name: "Edit kit" }).click();
  const kitName = page.locator("#k-name");
  await kitName.fill("Craft kit B");
  await kitName.fill("Craft kit");
  await page.keyboard.press("Escape");
  await expect(kitName).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);

  await page.goto("/staff/kits?kit=KIT-0001");
  await page.getByRole("button", { name: "Edit kit" }).click();
  await kitName.fill("Craft kit B");
  await page.keyboard.press("Escape");
  await expect(question(page)).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(kitName).toHaveCount(0);

  await page.goto("/staff/locations");
  await page.locator("#new-place").click();
  const place = page.locator("#p-name");
  await place.fill("Cabinet 9");
  await page.keyboard.press("Escape");
  await expect(question(page)).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await place.fill("");
  await page.keyboard.press("Escape");
  await expect(place).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);
});

test("a live refresh of Self-Service review keeps a typed note, its focus and caret; leaving with it asks", async ({ page }) => {
  await staffPages(page);
  const report = { id: "00000000-0000-4000-8000-0000000000a1", itemId: "ITM-0001", itemName: "Sample tripod", kind: "CANT_FIND", reporterName: "Maya Cruz", createdAt: "2026-10-03T07:39:00.000Z", location: null };
  let offered = 12;
  await page.route("**/api/staff/self-service", (route) => route.fulfill({ headers: { etag: `"s${offered}"` }, json: { revision: offered, open: [], stockIssues: [], recent: [], candidates: [],
    enabledItems: offered, locationReports: [report] } }));
  await page.goto("/staff/self-service");
  const note = page.locator(`#report-note-${report.id}`);
  await note.fill("Found it on shelf B");
  await note.press("ArrowLeft");
  await note.press("ArrowLeft");

  offered = 13;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("#ss-summary")).toContainText("13 items offered");
  await expect(note).toHaveValue("Found it on shelf B");
  await expect(note).toBeFocused();
  expect(await note.evaluate((field: HTMLInputElement) => field.selectionStart)).toBe("Found it on shelf B".length - 2);

  await rail(page, "Items").dispatchEvent("click");
  await expect(question(page)).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/staff\/self-service$/);
  await expect(note).toHaveValue("Found it on shelf B");
});

test("the phone's borrower sheet asks in the app's own words when Back is taken, never the browser's", async ({ page }) => {
  const items = [{ id: "ITM-0001", name: "Folding Table", aliases: null, category: "EQUIPMENT", unit: "piece", area: "Inventory", action: "BORROW", available: 4, location: null, locationId: null, audience: "STUDENTS_AND_USC_STAFF" }];
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ headers: { etag: '"r7"' }, json: { revision: 7, items, places: [] } }));
  await page.route("**/api/self-service/sync", (route) => route.abort());
  const native: string[] = [];
  page.on("dialog", (dialog) => { native.push(dialog.type()); void dialog.dismiss(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/self-service?do=item&item=ITM-0001");
  await page.getByRole("link", { name: /^Borrow/ }).click();
  const sheet = page.getByRole("dialog", { name: "Folding Table" });
  const name = sheet.locator("#ss-name");
  await name.fill("Juan Dela Cruz");

  await page.goBack();
  await expect(question(page)).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(sheet).toBeVisible();
  await expect(name).toHaveValue("Juan Dela Cruz");
  await expect(page).toHaveURL(/do=borrow/);

  await page.goBack();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/do=item&item=ITM-0001$/);
  expect(native).toEqual([]);
});
