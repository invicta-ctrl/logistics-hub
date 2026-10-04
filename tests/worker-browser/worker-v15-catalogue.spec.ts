import { expect, test, type Page } from "@playwright/test";

/*
 * V1.5 against a real Worker and D1: a cataloguing session on a shelf (a loanable with a photo, a consumable, an item saved
 * while the connection is down, a possible duplicate saved as a separate item, and one that waits for review), then finishing
 * and signing off. It runs after the earlier worker specs (file order); every name starts with "E2E" so nothing else meets them.
 */

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;
const banner = "public/brand/ydd-2026-banner.jpg";

async function signIn(page: Page) {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
}

type Row = { id: string; name: string; needsReview: boolean; itemType: string; onHand: number; locationId: string | null; photoId: string | null; category: string };
const inventory = async (page: Page) => (await (await page.request.get("/api/staff/inventory")).json() as { items: Row[] }).items;
const named = async (page: Page, text: string) => (await inventory(page)).filter((item) => item.name === text);

async function capture(page: Page, options: { name: string; how: string; category?: string; unit?: string; more?: number; photo?: boolean }) {
  await page.getByLabel("Name", { exact: true }).fill(options.name);
  if (options.photo) {
    await page.locator("#cat-file").setInputFiles(banner);
    await expect(page.locator("#cat-photo img")).toBeVisible();
  }
  await page.locator(".cat-choice", { hasText: options.how }).first().click();
  if (options.category) await page.getByLabel("Category").fill(options.category);
  if (options.unit) await page.getByLabel("Counted in").fill(options.unit);
  for (let tap = 0; tap < (options.more ?? 0); tap += 1) await page.getByRole("button", { name: "One more" }).click();
  await page.getByRole("button", { name: /^Save/ }).first().click();
}

test("a cataloguing session on a shelf: mixed items, a dropped connection, a duplicate, review later, then sign-off", async ({ page }) => {
  await signIn(page);
  const made = await page.request.post("/api/staff/locations", { headers: { origin: new URL(page.url()).origin }, data: { name: "E2E Cabinet", parentId: null } });
  const cabinet = (await made.json() as { id: string }).id;
  const shelf = (await (await page.request.post("/api/staff/locations", { headers: { origin: new URL(page.url()).origin }, data: { name: "E2E Shelf", parentId: cabinet } })).json() as { id: string }).id;

  await page.goto("/staff/catalogue");
  await page.getByLabel("Place", { exact: true }).selectOption(shelf);
  await page.getByRole("button", { name: /^Start cataloguing/ }).click();
  await expect(page.locator("#cat-place-name")).toHaveText("E2E Cabinet › E2E Shelf");
  const rows = page.locator("#cat-list .cat-row");

  await capture(page, { name: "E2E Hammer", how: "Borrow", category: "E2E TOOLS", unit: "piece", more: 1, photo: true });
  await expect(rows.first().getByText("Saved", { exact: true })).toBeVisible();
  await capture(page, { name: "E2E Gloves", how: "Consume", category: "E2E TOOLS", unit: "pair", more: 4 });
  await expect(rows).toHaveCount(2);
  await expect(page.locator("#cat-sync")).toHaveText("All saved");

  // The connection drops: the item is shown as unsaved, then sent once when it returns.
  await page.context().setOffline(true);
  await capture(page, { name: "E2E Duct tape", how: "Consume", category: "E2E TOOLS", unit: "roll" });
  await expect(rows.first()).toContainText("Not saved yet");
  await expect(page.locator("#cat-sync")).toContainText("waiting to send");
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(rows.first().getByText("Saved", { exact: true })).toBeVisible();
  expect(await named(page, "E2E Duct tape")).toHaveLength(1);

  // A look-alike is shown first; the second press makes a separate item.
  await page.getByLabel("Name", { exact: true }).fill("e2e hammer");
  await expect(page.getByRole("group", { name: "Possible matches" })).toContainText("E2E Hammer");
  await page.locator(".cat-choice", { hasText: "Borrow" }).first().click();
  await page.getByLabel("Category").fill("E2E TOOLS");
  await page.getByLabel("Counted in").fill("piece");
  await page.getByRole("button", { name: "Save & next" }).click();
  expect(await named(page, "e2e hammer")).toHaveLength(0);
  await page.getByRole("button", { name: "Save as a separate item" }).click();
  await expect(rows.first().getByText("Saved", { exact: true })).toBeVisible();
  expect(await named(page, "e2e hammer")).toHaveLength(1);

  await capture(page, { name: "E2E Mystery crate", how: "Not sure", more: 2 });
  await expect(rows.first().getByText("Review later", { exact: true })).toBeVisible();

  // A reload keeps the session; it resumes with everything in it.
  await page.reload();
  await expect(page.locator("#cat-count")).toHaveText("5 items");
  await expect(page.locator("#cat-place-name")).toHaveText("E2E Cabinet › E2E Shelf");

  const items = await inventory(page);
  const hammer = items.find((item) => item.name === "E2E Hammer")!;
  expect(hammer).toMatchObject({ itemType: "Loanable", onHand: 2, locationId: shelf, needsReview: true, category: "E2E TOOLS" });
  expect(hammer.photoId).not.toBeNull();
  expect(items.find((item) => item.name === "E2E Gloves")).toMatchObject({ itemType: "Consumable", onHand: 5 });
  expect(items.find((item) => item.name === "E2E Mystery crate")).toMatchObject({ itemType: "NEEDS_REVIEW", onHand: 3, needsReview: true, category: "UNSORTED" });
  // Nothing from the shelf is public yet, the unclassified crate least of all.
  const publicCatalog = JSON.stringify(await (await page.request.get("/api/public/catalog")).json());
  const phoneCatalog = JSON.stringify(await (await page.request.get("/api/self-service/catalog")).json());
  for (const text of ["E2E Hammer", "E2E Gloves", "E2E Mystery"]) { expect(publicCatalog).not.toContain(text); expect(phoneCatalog).not.toContain(text); }

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Cataloguing finished" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "5 items saved" })).toBeVisible();
  await page.getByRole("button", { name: /^Mark 4 items reviewed/ }).click();
  await expect(page.locator("#rev-text")).toContainText("4 items marked reviewed");
  const after = await inventory(page);
  expect(after.filter((item) => item.name.toLowerCase().startsWith("e2e") && item.itemType !== "NEEDS_REVIEW").every((item) => !item.needsReview)).toBe(true);
  expect(after.find((item) => item.name === "E2E Mystery crate")!.needsReview).toBe(true);
  // Reviewed consumables now reach the phone; the unclassified crate still does not.
  expect(JSON.stringify(await (await page.request.get("/api/self-service/catalog")).json())).toContain("E2E Gloves");
  expect(JSON.stringify(await (await page.request.get("/api/self-service/catalog")).json())).not.toContain("E2E Mystery");
  await page.goto("/staff/catalogue");
  await expect(page.getByRole("heading", { name: "Start cataloguing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Review later/ })).toContainText("1");
});

test("select mode changes places for many items and says what it skipped", async ({ page }) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  const target = (await (await page.request.post("/api/staff/locations", { headers: { origin }, data: { name: "E2E Bulk Bay", parentId: null } })).json() as { id: string }).id;
  await page.goto("/staff/items");
  await page.getByRole("searchbox", { name: "Search items" }).fill("E2E");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: /Select all/ }).check();
  await page.getByRole("button", { name: "Move to…" }).click();
  const dialog = page.locator("#bulk-sheet");
  await dialog.getByLabel("Move them to").selectOption(target);
  await expect(dialog.locator("#bulk-preview")).toContainText("will change to E2E Bulk Bay");
  await dialog.getByRole("button", { name: /^Move \d+ items?/ }).click();
  await expect(page.getByText(/items? changed/)).toBeVisible();
  const moved = (await inventory(page)).filter((item) => item.name.toLowerCase().startsWith("e2e") && item.locationId === target);
  expect(moved.length).toBeGreaterThan(3);
  // The quantities are what they were.
  expect(moved.find((item) => item.name === "E2E Gloves")!.onHand).toBe(5);
});
