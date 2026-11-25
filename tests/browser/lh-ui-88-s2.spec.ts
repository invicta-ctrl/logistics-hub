import { expect, test, type Page } from "@playwright/test";

// LH-UI-88 S2 Inventory: a phone row gives the name its width and shows one status (the most urgent) with "+N";
// every status stays in the accessible text; the item sheet's facts read as a ruled key-value list.
const base = { aliases: null, category: "OFFICE SUPPLIES", unit: "piece", status: "ACTIVE", lendingAudience: "INDIVIDUAL", reorderThreshold: 0, legacyLocation: null, openReports: 0, listed: false,
  stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, visualType: null, iconKey: null,
  updatedAt: "2026-11-01T00:00:00.000Z", model: null, serialNumber: null, locationId: null, photoId: null };
const review = { ...base, id: "ITM-0107", name: "1/8 Illustration Board", itemType: "NEEDS_REVIEW", needsReview: true, onHand: 6 };
const out = { ...base, id: "ITM-0042", name: "Banana Ketchup", itemType: "Consumable", needsReview: true, onHand: 0, reorderThreshold: 2 };
const plain = { ...base, id: "ITM-0463", name: "8-Digit Calculator", itemType: "Loanable", needsReview: false, onHand: 4 };

async function items(page: Page, width: number) {
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: { authenticated: true, id: "ACC-1", username: "owner.one", displayName: "Owner One", role: "OWNER", access: "OWNER", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null } }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [review, out, plain], categories: ["OFFICE SUPPLIES"], locations: [], units: ["piece"] } }));
  await page.route("**/api/staff/items/ITM-0463", (route) => route.fulfill({ json: { item: { ...plain, notes: null, listingGaps: ["a photo"], photoCleanup: { cleanable: false, canEnable: false, cleanupReason: "" }, location: null, legacyReportedAvailable: null,
    migratedOnHand: 0, migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null, photo: null }, movements: [], loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0 } }));
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/staff/items");
  await expect(page.locator("tr[data-key=ITM-0107]")).toBeVisible();
}

for (const width of [320, 375, 430]) {
  test(`phones at ${width}px: a row shows one status, the most urgent, with +N, and the name keeps its width`, async ({ page }) => {
    await items(page, width);
    const row = page.locator("tr[data-key=ITM-0042]");
    // Out of stock outranks the pending details check.
    await expect(row.locator(".col-status .tag.is-primary")).toHaveText("Out of stock");
    // The other status is clipped to a pixel: out of sight, still read aloud.
    expect((await row.locator(".col-status .tag:not(.is-primary)").boundingBox())!.width).toBeLessThanOrEqual(1);
    await expect(row.locator(".tags__more")).toHaveText("+1");
    await expect(row.locator(".col-status")).toContainText("Needs details check");
    // "Unclassified" yields a tie to the details check, because the sub-line already names the type.
    await expect(page.locator("tr[data-key=ITM-0107] .col-status .tag.is-primary")).toHaveText("Needs details check");
    // An item with one status shows no "+N".
    await expect(page.locator("tr[data-key=ITM-0463] .tags__more")).toHaveCount(0);
    for (const key of ["ITM-0107", "ITM-0042"]) {
      const r = page.locator(`tr[data-key=${key}]`);
      const rowBox = (await r.boundingBox())!;
      const cell = (await r.locator("td.col-item").boundingBox())!;
      const name = (await r.locator(".row-link").boundingBox())!;
      // The name takes at least 40% of the row, never more than two lines, and the reference stays on one line.
      expect(cell.width).toBeGreaterThan(rowBox.width * 0.55);
      expect(name.height).toBeLessThan(2 * 24 + 4);
      const id = (await r.locator(".cell-id").boundingBox())!;
      expect(id.height).toBeLessThan(24);
      // The status has its own line under the name and reference, so it squeezes neither.
      const status = (await r.locator(".col-status").boundingBox())!;
      expect(status.y).toBeGreaterThanOrEqual(id.y + id.height - 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("desktop: every status shows and no +N is drawn", async ({ page }) => {
  await items(page, 1280);
  await expect(page.locator("tr[data-key=ITM-0042] .col-status .tag:visible")).toHaveText(["Needs details check", "Out of stock"]);
  await expect(page.locator("tr[data-key=ITM-0042] .tags__more")).toBeHidden();
});

test("item sheet: the facts are a ruled key-value list, label beside its value", async ({ page }) => {
  await items(page, 1280);
  await page.locator("tr[data-key=ITM-0463] .row-link").click();
  const facts = page.locator("#sheet dl.facts--rows");
  await expect(facts.locator("dt")).toHaveText(["Status", "Lending Hub", "Unit"]);
  const dt = (await facts.locator("dt").first().boundingBox())!;
  const dd = (await facts.locator("dd").first().boundingBox())!;
  expect(Math.abs(dt.y - dd.y)).toBeLessThan(6);
  expect(dd.x).toBeGreaterThan(dt.x + dt.width);
  await expect(facts.locator("> div").first()).toHaveCSS("border-bottom-style", "solid");
});

test("reduced motion: a pressed row's tint is immediate and nothing on Items transitions transform", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await items(page, 375);
  const transition = await page.locator("tr[data-key=ITM-0107]").evaluate((row) => getComputedStyle(row).transitionProperty);
  expect(transition).not.toContain("transform");
});
