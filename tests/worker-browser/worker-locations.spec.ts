import { expect, test, type Page } from "@playwright/test";

/*
 * V1.4 against a real Worker and D1: places are made, described and photographed; an item is kept on a shelf; "Where is it?"
 * shows the route to staff and, when staff share it, to a phone; the two reports tell staff without changing anything.
 * It runs after worker-live.spec.ts (file order), so the items it adds never reach the earlier tests.
 */

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;
const banner = "public/brand/ydd-2026-banner.jpg";

async function signIn(page: Page) {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await page.goto("/staff/items");
  await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
}

type Place = { id: string; name: string; parentId: string | null; directions: string | null; visibility: string; active: boolean; updatedAt: string; photo: { id: string } | null; itemCount: number; openReports: number };
const places = async (page: Page) => (await (await page.request.get("/api/staff/locations")).json() as { locations: Place[] }).locations;
const byName = async (page: Page, name: string) => (await places(page)).find((place) => place.name === name)!;

/** Escape closes the open sheet; its exit animation finishes before anything else is opened, as it does for a person. */
async function closeSheet(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

/**
 * The confirmation an action produces. Toasts already on screen are marked first, so one still fading from an earlier
 * action never counts, however long the save takes (counting them raced the fade on a slow machine).
 */
async function expectNewToast(page: Page, text: string, act: () => Promise<void>) {
  await page.locator("#toasts .toast").evaluateAll((toasts) => { for (const toast of toasts) toast.setAttribute("data-seen", ""); });
  await act();
  await expect(page.locator("#toasts .toast:not([data-seen])", { hasText: text })).toHaveCount(1);
}

/** Adds a place through the sheet; the sheet then stays open on the new place, ready for directions. */
async function addPlace(page: Page, name: string, inside: string | null, options: { directions?: string; shared?: boolean } = {}) {
  await page.getByRole("button", { name: "New place" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add a place" });
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  if (inside) await sheet.getByLabel("Inside", { exact: true }).selectOption({ label: inside });
  await expectNewToast(page, "Place added.", () => sheet.getByRole("button", { name: "Add place" }).click());
  const edit = page.getByRole("dialog", { name });
  await expect(edit).toBeVisible();
  if (options.directions || options.shared) {
    if (options.directions) await edit.getByRole("textbox", { name: /^Directions/ }).fill(options.directions);
    if (options.shared) await edit.getByRole("radio", { name: /Shown in Self-Service/ }).check();
    // The confirmation comes after the sheet is redrawn from the saved place.
    await expectNewToast(page, "Changes saved.", () => edit.getByRole("button", { name: "Save changes" }).click());
  }
  return edit;
}

test.describe.serial("smart locations", () => {
  test("places: build a tree, describe and photograph it, and combine nothing by accident", async ({ page }) => {
    await signIn(page);
    await page.getByRole("link", { name: "Locations" }).click();
    await expect(page.getByRole("heading", { name: "Locations", level: 1 })).toBeVisible();

    await addPlace(page, "Storage Area", null, { directions: "Through the door behind the front desk.", shared: true });
    await closeSheet(page);
    await addPlace(page, "Cabinet 1", "Storage Area", { directions: "Grey cabinet on the left wall.", shared: true });
    // The picture of a place: added with a preview, shown in its row, shared by whatever is kept inside.
    const cabinet = page.getByRole("dialog", { name: "Cabinet 1" });
    await cabinet.locator("input[type=file]:not([capture])").setInputFiles(banner);
    await expect(cabinet.getByRole("img", { name: "Preview of the new picture of Cabinet 1" })).toBeVisible();
    await cabinet.getByRole("button", { name: "Save picture" }).click();
    await expect(page.getByText("Picture saved.")).toBeVisible();
    await expect(cabinet.getByRole("button", { name: "View picture of Cabinet 1" })).toBeVisible();
    await closeSheet(page);
    await addPlace(page, "Shelf 2", "Storage Area › Cabinet 1", { directions: "Second shelf from the top." });
    await closeSheet(page);

    // A staff-only place, a refused loop and a refused near-duplicate name, each said in words.
    await page.getByRole("button", { name: "New place" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a place" });
    await dialog.getByLabel("Name", { exact: true }).fill("cabinet 1");
    await dialog.getByLabel("Inside", { exact: true }).selectOption({ label: "Storage Area" });
    await dialog.getByRole("button", { name: "Add place" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Storage Area already has a place called Cabinet 1");
    // The unsaved name is not lost silently: closing asks first, and the answer here is to discard it.
    page.once("dialog", (confirm) => { expect(confirm.message()).toContain("Discard"); void confirm.accept(); });
    await closeSheet(page);
    await page.getByRole("button", { name: /^Storage Area/ }).first().click();
    const storage = page.getByRole("dialog", { name: "Storage Area" });
    await expect(storage.getByLabel("Inside", { exact: true })).not.toContainText("Cabinet 1");

    const stored = await places(page);
    expect(stored.map((place) => place.name)).toEqual(expect.arrayContaining(["Cabinet 1", "Shelf 2", "Storage Area"]));
    expect(stored.find((place) => place.name === "Cabinet 1")!.photo).not.toBeNull();
    expect(stored.filter((place) => place.visibility === "SELF_SERVICE").map((place) => place.name).sort()).toEqual(["Cabinet 1", "Storage Area"]);
    await closeSheet(page);
    await expect(page.locator(".place-row", { hasText: "Shelf 2" })).toBeVisible();
    await expect(page.locator(".place-row", { hasText: "Cabinet 1" }).locator("img")).toBeVisible();
  });

  test("an item is kept on a shelf, found by place and path, and reported without anything changing", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "New item" }).click();
    const form = page.getByRole("dialog", { name: "Add an item" });
    await form.getByLabel("Name", { exact: true }).fill("E2E Stapler");
    await form.getByLabel("Category").fill("Office supplies");
    await form.getByLabel("Borrow or take").selectOption("Consumable");
    await form.getByLabel("Unit").fill("piece");
    await form.getByRole("combobox", { name: /^Place/ }).selectOption({ label: "Storage Area › Cabinet 1 › Shelf 2" });
    await expect(form.locator("#place-preview")).toContainText("Storage Area › Cabinet 1 › Shelf 2");
    await form.getByLabel("Opening quantity").fill("6");
    await form.getByLabel("Shown to").selectOption("NOT_AVAILABLE_FOR_LENDING");
    await form.getByRole("button", { name: "Create item" }).click();
    await expect(page.getByText(/Item ITM-\d+ created\./)).toBeVisible();
    const item = page.getByRole("dialog", { name: "E2E Stapler" });
    await expect(item.locator(".profile__meta--place")).toContainText("Storage Area › Cabinet 1 › Shelf 2");
    await closeSheet(page);

    // The list shows the leaf with the places around it; a place stands for everything inside it; search reads the path.
    const row = page.locator("tr", { hasText: "E2E Stapler" });
    await expect(row.locator(".place-leaf")).toHaveText("Shelf 2");
    await expect(row.locator(".col-location .cell-sub")).toHaveText("Storage Area › Cabinet 1");
    await page.getByLabel("Place", { exact: true }).selectOption({ label: "Storage Area" }).catch(async () => { await page.getByRole("button", { name: "Filters" }).click(); await page.getByLabel("Place", { exact: true }).selectOption({ label: "Storage Area" }); });
    await expect(page).toHaveURL(/location=LOC-/);
    await expect(row).toBeVisible();
    await page.getByLabel("Place", { exact: true }).selectOption("__none");
    await expect(row).toHaveCount(0);
    await page.getByLabel("Place", { exact: true }).selectOption("");
    await page.getByRole("searchbox", { name: "Search items" }).fill("cabinet 1");
    await expect(row).toBeVisible();
    // The list draws 100 rows at a time and the stapler sorts after the first 100, so it is found by name. (Clearing the
    // search instead only passed while the click beat the search's redraw.)
    await page.getByRole("searchbox", { name: "Search items" }).fill("E2E Stapler");
    await expect(page.locator("#inventory-count")).toHaveText(/^1 of \d+ items$/);

    // Where is it? shows the route, directions and the nearest picture; a report says nothing is changed and changes nothing.
    const before = await (await page.request.get("/api/staff/inventory")).json() as { items: Array<{ id: string; name: string; onHand: number; locationId: string | null }> };
    const stapler = before.items.find((entry) => entry.name === "E2E Stapler")!;
    await row.getByRole("button", { name: "E2E Stapler" }).click();
    await item.getByRole("button", { name: "Where is it?" }).click();
    const where = page.getByRole("dialog", { name: "E2E Stapler" }).last();
    await expect(where.locator(".where__step")).toHaveText([/Storage Area/, /Cabinet 1/, /Shelf 2/]);
    await expect(where).toContainText("Second shelf from the top.");
    await expect(where).toContainText("Grey cabinet on the left wall.");
    await expect(where.getByRole("img", { name: "Picture of Cabinet 1" })).toBeVisible();
    await where.getByRole("button", { name: "Enlarge the picture of Cabinet 1" }).click();
    await expect(page.getByRole("dialog", { name: "Picture of Cabinet 1" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Picture of Cabinet 1" })).toHaveCount(0);
    await where.getByRole("button", { name: "Location looks wrong" }).click();
    await where.getByLabel("Note").fill("It is on shelf 3 now.");
    await where.getByRole("button", { name: "Send report" }).click();
    await expect(where.getByRole("status")).toContainText("Nothing was changed");
    await where.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("dialog.where")).toHaveCount(0);

    await expect(item.locator("#reports-card")).toContainText("Someone reported where this is");
    await expect(item.locator("#reports-card")).toContainText("Location looks wrong");
    await expect(item.locator("#reports-card")).toContainText("It is on shelf 3 now.");
    const after = await (await page.request.get("/api/staff/inventory")).json() as typeof before;
    expect(after.items.find((entry) => entry.id === stapler.id)).toMatchObject({ onHand: stapler.onHand, locationId: stapler.locationId });
    await closeSheet(page);
    await expect(page.getByRole("button", { name: /Location reports\s*1/ })).toBeVisible();
    await expect(row).toContainText("Location reported");

    // The report is resolved by a person, with a note, and leaves the view.
    await page.getByRole("button", { name: /Location reports/ }).click();
    await row.getByRole("button", { name: "E2E Stapler" }).click();
    await item.getByRole("button", { name: "Resolve", exact: true }).click();
    await item.locator("#reports-card").getByLabel("Note").fill("Moved back to shelf 2.");
    await item.getByRole("button", { name: "Resolve report" }).click();
    await expect(page.getByText("Report resolved.")).toBeVisible();
    await expect(item.locator("#reports-card")).toBeEmpty();
    await item.getByRole("tab", { name: "History" }).click();
    await expect(item.locator("#history")).toContainText("Reported: Location looks wrong");
    await expect(item.locator("#history")).toContainText("It is on shelf 3 now.");
    await expect(item.locator("#history")).toContainText("Report resolved: Location looks wrong");
    await expect(item.locator("#history")).toContainText("Moved back to shelf 2.");
  });

  test("a phone sees the route only for a shared place, and its report tells staff and changes nothing", async ({ page, browser, baseURL }) => {
    await signIn(page);
    const inventory = async () => (await (await page.request.get("/api/staff/inventory")).json() as { items: Array<{ id: string; name: string; onHand: number; locationId: string | null }> });
    const stapler = (await inventory()).items.find((entry) => entry.name === "E2E Stapler")!;
    const share = async (name: string, visibility: "SELF_SERVICE" | "STAFF_ONLY") => {
      const place = await byName(page, name);
      const response = await page.request.patch(`/api/staff/locations/${place.id}`, { headers: { origin: baseURL! }, data: { name: place.name, parentId: place.parentId, directions: place.directions, visibility, active: place.active, updatedAt: place.updatedAt } });
      expect(response.status()).toBe(200);
    };
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    // A page shows the catalog as it was when it opened, so a changed place is read by opening the item from the list once the list has it.
    const reopen = async (route: string | null) => {
      await phone.goto("/self-service?do=get");
      const row = phone.locator(".ss-row", { hasText: "E2E Stapler" });
      if (route) await expect(row).toContainText(route); else await expect(row).not.toContainText("Storage Area");
      await row.click();
    };
    await phone.goto(`/self-service?do=item&item=${stapler.id}`);
    const sheet = phone.locator(".ss-item");
    // Shelf 2 was never shared: the phone is pointed to the desk, and can still say it could not find the item.
    await expect(sheet.locator(".ss-where")).toContainText("Ask DoL staff where this is kept.");
    await sheet.getByRole("button", { name: "Where is it?" }).click();
    const desk = phone.getByRole("dialog", { name: "E2E Stapler" }).last();
    await expect(desk).toContainText("DoL staff keep this one at the office");
    await expect(desk.getByRole("button", { name: "Location looks wrong" })).toHaveCount(0);
    await expect(desk.getByRole("button", { name: "I can’t find it" })).toBeVisible();
    await desk.getByRole("button", { name: "Close" }).click();
    await expect(phone.locator("dialog.where")).toHaveCount(0);

    // Sharing the whole route shows it: names, directions and the nearest picture, over the public picture address.
    await share("Shelf 2", "SELF_SERVICE");
    await reopen("Cabinet 1 › Shelf 2");
    await expect(sheet.locator(".ss-where")).toContainText("Storage Area › Cabinet 1 › Shelf 2");
    await sheet.getByRole("button", { name: "Where is it?" }).click();
    const where = phone.getByRole("dialog", { name: "E2E Stapler" }).last();
    await expect(where.locator(".where__step")).toHaveCount(3);
    await expect(where).toContainText("Second shelf from the top.");
    const picture = where.getByRole("img", { name: "Picture of Cabinet 1" });
    await expect(picture).toBeVisible();
    await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

    // A phone's report has no note, names who sent it, says nothing is changed, and reaches staff as an attention signal.
    await where.getByRole("button", { name: "I can’t find it" }).click();
    await expect(where.getByLabel("Note")).toHaveCount(0);
    await where.getByLabel("Your name").fill("E2E Sam");
    await where.getByRole("button", { name: "Send report" }).click();
    await expect(where.getByRole("status")).toContainText("Reported. Thank you.");
    const detail = await (await page.request.get(`/api/staff/items/${stapler.id}`)).json() as { reports: Array<{ kind: string; source: string; reportedBy: string | null; resolvedAt: string | null }> };
    expect(detail.reports.filter((report) => !report.resolvedAt)).toMatchObject([{ kind: "CANT_FIND", source: "SELF_SERVICE", reportedBy: "E2E Sam" }]);
    // Staff find it where they already look for what phones need from them: Self-Service, Needs attention.
    await page.goto("/staff/self-service");
    const card = page.locator(".review-card--report", { hasText: "E2E Stapler" });
    await expect(card).toContainText("I can’t find it");
    await expect(card).toContainText("E2E Sam");
    await card.getByLabel("Note").fill("Back on its shelf.");
    await card.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByText("Report resolved.")).toBeVisible();
    await expect(page.locator(".review-card--report", { hasText: "E2E Stapler" })).toHaveCount(0);
    expect((await inventory()).items.find((entry) => entry.id === stapler.id)).toMatchObject({ onHand: stapler.onHand, locationId: stapler.locationId });

    // Withdrawing the top place hides the route again, and its picture address stops answering.
    const cabinet = await byName(page, "Cabinet 1");
    const pictureUrl = `/api/public/location-media/${cabinet.photo!.id}/display`;
    expect((await phone.request.get(pictureUrl)).status()).toBe(200);
    await share("Storage Area", "STAFF_ONLY");
    expect((await phone.request.get(pictureUrl)).status()).toBe(404);
    await where.getByRole("button", { name: "Close" }).click();
    await expect(phone.locator("dialog.where")).toHaveCount(0);
    await reopen(null);
    await expect(sheet.locator(".ss-where")).toContainText("Ask DoL staff where this is kept.");
  });
});
