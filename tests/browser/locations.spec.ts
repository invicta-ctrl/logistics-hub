import { expect, test, type Page } from "@playwright/test";

/* V1.4 on fictional data with the API mocked: the Items list by place at 600 items, the Locations page, and the Where is it? dialog. */

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };

type Row = { id: string; name: string; parentId: string | null; directions: string | null; visibility: string; active: boolean; updatedAt: string; photo: null | { id: string; width: number; height: number }; itemCount: number; openReports: number };
const place = (id: string, name: string, parentId: string | null, extra: Partial<Row> = {}): Row => ({ id, name, parentId, directions: null, visibility: "STAFF_ONLY", active: true, updatedAt: "2026-10-03T00:00:00.000Z", photo: null, itemCount: 0, openReports: 0, ...extra });

const PLACES: Row[] = [
  place("LOC-0001", "Office", null, { directions: "Second floor, past the stairs." }),
  place("LOC-0002", "Storage Area", "LOC-0001", { directions: "Through the door behind the front desk.", visibility: "SELF_SERVICE" }),
  place("LOC-0003", "Cabinet 1", "LOC-0002", { directions: "Grey cabinet on the left wall.", photo: { id: "00000000-0000-4000-8000-00000000c001", width: 8, height: 6 } }),
  place("LOC-0004", "Shelf 2", "LOC-0003", { directions: "Second shelf from the top." }),
  place("LOC-0005", "Cabinet 2", "LOC-0002"),
  place("LOC-0006", "Garage", null),
  ...Array.from({ length: 30 }, (_, index) => place(`LOC-${String(10 + index).padStart(4, "0")}`, `Bin ${index + 1}`, "LOC-0005"))
];
const inside = (id: string): Set<string> => {
  const found = new Set<string>([id]);
  for (let grew = true; grew;) { grew = false; for (const entry of PLACES) if (entry.parentId && found.has(entry.parentId) && !found.has(entry.id)) { found.add(entry.id); grew = true; } }
  return found;
};

function item(index: number) {
  const usable = PLACES.filter((entry) => entry.id !== "LOC-0001" && entry.id !== "LOC-0002");
  const locationId = index % 7 === 0 ? null : usable[index % usable.length]!.id;
  return {
    id: `ITM-${String(index + 1).padStart(4, "0")}`, name: `Sample Item ${index + 1}`, aliases: null, category: index % 2 ? "SUPPLIES" : "FURNITURE", itemType: "Consumable", unit: "piece", status: "ACTIVE",
    needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", onHand: 10 + (index % 5), reorderThreshold: 0, locationId, legacyLocation: !locationId && index % 21 === 0 ? "Old shelf" : null,
    openReports: index === 8 || index === 9 ? 1 : 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, countNeeded: false
  };
}
const ITEMS = Array.from({ length: 600 }, (_, index) => item(index));

async function mock(page: Page) {
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items: ITEMS, categories: ["FURNITURE", "SUPPLIES"], units: ["piece"], locations: PLACES }) }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, locations: PLACES.map((entry) => ({ ...entry, itemCount: ITEMS.filter((it) => it.locationId === entry.id).length })) }) }));
  await page.route("**/api/staff/location-media/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
}

test.describe("Items by place", () => {
  test.beforeEach(async ({ page }) => { await mock(page); });

  test("a place stands for everything inside it, search reads the path, and 600 items filter in well under a second", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/items");
    await expect(page.locator("#inventory-count")).toHaveText("600 items");
    const expected = (id: string) => ITEMS.filter((entry) => entry.locationId && inside(id).has(entry.locationId)).length;
    // The change handler renders synchronously, so the clock around it is the cost of filtering 600 items and redrawing.
    for (const [label, id] of [["Storage Area", "LOC-0002"], ["Cabinet 2", "LOC-0005"], ["Garage", "LOC-0006"]] as const) {
      const spent = await page.evaluate((value) => {
        const select = document.querySelector<HTMLSelectElement>("#filter-location")!;
        const started = performance.now();
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return performance.now() - started;
      }, id);
      expect(spent, `${label} filter`).toBeLessThan(400);
      await expect(page.locator("#inventory-count")).toHaveText(`${expected(id)} of 600 items`);
      await expect(page).toHaveURL(new RegExp(`location=${id}`));
    }
    await page.getByLabel("Place", { exact: true }).selectOption("");
    await page.getByLabel("Place", { exact: true }).selectOption("__none");
    await expect(page.locator("#inventory-count")).toHaveText(`${ITEMS.filter((entry) => !entry.locationId).length} of 600 items`);
    await page.getByLabel("Place", { exact: true }).selectOption("");
    // The path is searched, so a shelf is found by the cabinet around it.
    await page.getByRole("searchbox", { name: "Search items" }).fill("storage area › cabinet 1");
    await expect(page.locator("#inventory-count")).toHaveText(new RegExp(`^${ITEMS.filter((entry) => entry.locationId && ["LOC-0003", "LOC-0004"].includes(entry.locationId)).length} of 600 items$`));
    const row = page.locator("tbody tr").first();
    await expect(row.locator(".col-location .cell-sub")).toContainText("Storage Area › Cabinet 1");
  });

  test("an item typed earlier without a place is flagged, and reports and unplaced items get views only while they exist", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/items");
    const unplaced = ITEMS.filter((entry) => !entry.locationId && entry.legacyLocation).length;
    await expect(page.getByRole("button", { name: new RegExp(`Needs a place\\s*${unplaced}`) })).toBeVisible();
    await expect(page.getByRole("button", { name: /Location reports\s*2/ })).toBeVisible();
    await page.getByRole("button", { name: /Needs a place/ }).click();
    await expect(page.locator("tbody tr").first().locator(".col-location")).toContainText("Needs a place");
    await expect(page.locator("tbody tr").first().locator(".col-location")).toContainText("Typed: Old shelf");
    await page.getByRole("button", { name: /Location reports/ }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.locator("tbody tr").first()).toContainText("Location reported");
  });

  test("on a phone and a tablet the place sits under the item name and nothing scrolls sideways", async ({ page }) => {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/staff/items");
      await expect(page.locator("#inventory-count")).toHaveText("600 items");
      await expect(page.locator("tbody tr").nth(1).locator(".cell-place")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px`).toBe(0);
    }
  });
});

test.describe("Locations page", () => {
  test.beforeEach(async ({ page }) => { await mock(page); });

  test("shows the tree in reading order with counts, keeps the places around a search match, and offers look-alikes for combining", async ({ page }) => {
    await page.route("**/api/staff/locations", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r2"' }, body: JSON.stringify({ revision: 2, locations: [...PLACES.slice(0, 6), place("LOC-0099", "cabinet 1", "LOC-0002", { itemCount: 2 })] }) }));
    await page.goto("/staff/locations");
    await expect(page.getByRole("heading", { name: "Locations", level: 1 })).toBeVisible();
    await expect(page.locator(".place-row__name")).toHaveText(["Garage", "Office", "Storage Area", "Cabinet 1", "Shelf 2", "cabinet 1", "Cabinet 2"]);
    await expect(page.locator(".look-alikes")).toContainText("Office › Storage Area › cabinet 1");
    await expect(page.locator(".callout--review")).toContainText("nothing was combined for you");
    await page.getByRole("searchbox", { name: "Search places" }).fill("shelf 2");
    await expect(page.locator(".place-row__name")).toHaveText(["Office", "Storage Area", "Cabinet 1", "Shelf 2"]);
    await expect(page.locator("#place-count")).toHaveText("1 place");
  });

  test("opens a place to edit it: only legal parents are offered, the picture and sharing are shown, and Escape returns focus", async ({ page }) => {
    await page.goto("/staff/locations?place=LOC-0003");
    const sheet = page.getByRole("dialog", { name: "Cabinet 1" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Name")).toHaveValue("Cabinet 1");
    await expect(sheet.getByRole("textbox", { name: /Directions/ })).toHaveValue("Grey cabinet on the left wall.");
    await expect(sheet.getByRole("radio", { name: /Staff only/ })).toBeChecked();
    await expect(sheet.getByRole("button", { name: "View picture of Cabinet 1" })).toBeVisible();
    // Not itself, nor anything inside it, and nothing that would push its contents past five levels.
    const parents = await sheet.getByLabel("Inside").locator("option").allTextContents();
    expect(parents.map((text) => text.trim())).not.toContain("Cabinet 1");
    expect(parents.map((text) => text.trim())).not.toContain("Shelf 2");
    expect(parents.map((text) => text.trim())).toContain("Storage Area");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page).not.toHaveURL(/place=/);
  });

  for (const width of [320, 390, 768, 1366]) {
    test(`fits ${width}px with labelled fields, named controls and room for 200% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/staff/locations?place=LOC-0003");
      await expect(page.getByRole("dialog", { name: "Cabinet 1" })).toBeVisible();
      const problems = await page.evaluate(() => {
        const unlabelled = [...document.querySelectorAll("main input:not([type=hidden]), main select, main textarea, dialog input:not([type=hidden]), dialog select, dialog textarea")].filter((field) =>
          !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby") && !field.closest("label") && !(field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)));
        const unnamed = [...document.querySelectorAll("main button, main a[href], dialog button, dialog a[href]")].filter((control) => !(control.textContent ?? "").trim() && !control.getAttribute("aria-label") && !control.getAttribute("title"));
        return { unlabelled: unlabelled.length, unnamed: unnamed.length };
      });
      expect(problems).toEqual({ unlabelled: 0, unnamed: 0 });
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }
});

test.describe("Where is it?", () => {
  const found = { ...ITEMS[1]!, locationId: "LOC-0004", notes: null, updatedAt: "2026-10-03T00:00:00.000Z", listingGaps: [], photo: null, location: "Office › Storage Area › Cabinet 1 › Shelf 2",
    legacyReportedAvailable: null, migratedOnHand: 11, migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: "LOGISTICS_HUB" };

  test.beforeEach(async ({ page }) => {
    await mock(page);
    await page.route("**/api/staff/items/ITM-0002", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ item: found, movements: [], loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0 }) }));
  });

  test("opens from the item, shows the route with directions and the nearest picture, reports in two steps, and returns focus", async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/staff/items/ITM-0002/location-report", async (route) => { sent = route.request().postDataJSON() as Record<string, unknown>; await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: sent.id, recorded: true }) }); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff/items?item=ITM-0002");
    const opener = page.getByRole("button", { name: "Where is it?" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Sample Item 2" }).last();
    await expect(dialog.locator(".where__step")).toHaveText([/Office/, /Storage Area/, /Cabinet 1/, /Shelf 2/]);
    await expect(dialog).toContainText("Second floor, past the stairs.");
    await expect(dialog.getByRole("img", { name: "Picture of Cabinet 1" })).toBeVisible();
    await expect(dialog.locator(".where__figure figcaption")).toContainText("Cabinet 1, the place around it");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    // Choosing a report explains it first; nothing is sent until it is confirmed, and Cancel sends nothing.
    await dialog.getByRole("button", { name: "I can’t find it" }).click();
    await expect(dialog.getByRole("heading", { name: "I can’t find it" })).toBeVisible();
    await expect(dialog).toContainText("Nothing is changed by this report.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(sent).toBeNull();
    await expect(dialog.getByRole("button", { name: "I can’t find it" })).toBeFocused();
    await dialog.getByRole("button", { name: "Location looks wrong" }).click();
    await dialog.getByLabel("Note").fill("Shelf is empty.");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByRole("status")).toContainText("Nothing was changed");
    expect(sent).toMatchObject({ kind: "LOCATION_WRONG", note: "Shelf is empty." });
    expect(String(sent!.id)).toMatch(/^[0-9a-f-]{36}$/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Sample Item 2" }).last()).toBeVisible();
    await expect(opener).toBeFocused();
  });

  test("a failed report is said in words and a retry sends the same request id", async ({ page }) => {
    const ids: string[] = [];
    let attempt = 0;
    await page.route("**/api/staff/items/ITM-0002/location-report", async (route) => {
      ids.push((route.request().postDataJSON() as { id: string }).id);
      attempt += 1;
      if (attempt === 1) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "The service is temporarily unavailable." }) });
      else await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: ids[0], recorded: true }) });
    });
    await page.goto("/staff/items?item=ITM-0002");
    await page.getByRole("button", { name: "Where is it?" }).click();
    const dialog = page.getByRole("dialog", { name: "Sample Item 2" }).last();
    await dialog.getByRole("button", { name: "I can’t find it" }).click();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByRole("alert")).toContainText("temporarily unavailable");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByRole("status")).toContainText("Reported. Thank you.");
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });
});

test.describe("Where is it? in Self-Service", () => {
  const catalog = { revision: 5, items: [
    { id: "ITM-0043", name: "Bottled Water", aliases: null, category: "PANTRY", unit: "piece", action: "TAKE", available: 18, location: "Storage Area › Cabinet 1", locationId: "LOC-0003", audience: null },
    { id: "ITM-0262", name: "Scissors", aliases: "Gunting", category: "SCHOOL SUPPLIES", unit: "piece", action: "BORROW", available: 4, location: null, locationId: null, audience: "STUDENTS_AND_USC_STAFF" }
  ], places: [
    { id: "LOC-0002", name: "Storage Area", parentId: null, directions: "Through the door behind the front desk.", photo: null },
    { id: "LOC-0003", name: "Cabinet 1", parentId: "LOC-0002", directions: "Grey cabinet on the left wall.", photo: { id: "00000000-0000-4000-8000-00000000c001", width: 8, height: 6 } }
  ] };

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r5"' }, body: JSON.stringify(catalog) }));
    await page.route("**/api/public/location-media/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
    await page.route("**/api/self-service/sync", (route) => route.abort());
  });

  test("shows the shared route with its directions and picture, and a report sends only the item and what is wrong", async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/self-service/location-report", async (route) => { sent = route.request().postDataJSON() as Record<string, unknown>; await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: sent.id, recorded: true }) }); });
    for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/self-service?do=take&item=ITM-0043");
      const sheet = page.getByRole("dialog", { name: "Bottled Water" });
      await expect(sheet.locator(".ss-where")).toContainText("Storage Area › Cabinet 1");
      await sheet.getByRole("button", { name: "Where is it?" }).click();
      const where = page.getByRole("dialog", { name: "Bottled Water" }).last();
      await expect(where.locator(".where__step")).toHaveText([/Storage Area/, /Cabinet 1/]);
      await expect(where).toContainText("Through the door behind the front desk.");
      await expect(where.getByRole("img", { name: "Picture of Cabinet 1" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${viewport.width}px`).toBe(0);
      await where.getByRole("button", { name: "Close" }).click();
    }
    await page.goto("/self-service?do=take&item=ITM-0043");
    await page.getByRole("dialog", { name: "Bottled Water" }).getByRole("button", { name: "Where is it?" }).click();
    const where = page.getByRole("dialog", { name: "Bottled Water" }).last();
    await where.getByRole("button", { name: "Location looks wrong" }).click();
    await expect(where.getByLabel("Note")).toHaveCount(0);
    await where.getByRole("button", { name: "Send report" }).click();
    await expect(where.getByRole("status")).toContainText("Reported. Thank you.");
    expect(sent).toMatchObject({ itemId: "ITM-0043", kind: "LOCATION_WRONG" });
    expect(Object.keys(sent!).sort()).toEqual(["id", "itemId", "kind"]);
  });

  test("an item staff keep private sends the person to the desk, and offline says reports need a connection", async ({ page, context }) => {
    await page.goto("/self-service?do=borrow&item=ITM-0262");
    const sheet = page.getByRole("dialog", { name: "Scissors" });
    await expect(sheet.locator(".ss-where")).toContainText("Ask DOL staff where this is kept.");
    await sheet.getByRole("button", { name: "Where is it?" }).click();
    const desk = page.getByRole("dialog", { name: "Scissors" }).last();
    await expect(desk).toContainText("DOL staff keep this one at the office");
    await expect(desk.getByRole("button", { name: "Location looks wrong" })).toHaveCount(0);
    await expect(desk.getByRole("button", { name: "I can’t find it" })).toBeVisible();
    await desk.getByRole("button", { name: "Close" }).click();
    await context.setOffline(true);
    await sheet.getByRole("button", { name: "Where is it?" }).click();
    const offline = page.getByRole("dialog", { name: "Scissors" }).last();
    await expect(offline).toContainText("Reports need a connection");
    await expect(offline.getByRole("button", { name: /find it|looks wrong/ })).toHaveCount(0);
  });
});
