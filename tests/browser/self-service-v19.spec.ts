import { expect, test, type Page } from "@playwright/test";

/*
 * V1.9 Self-Service 2.0: browse by group, the item's page, who you are, the check before sending, the receipt's
 * reference, My activity, the shared help tip, and a catalog of 600 items. The server is faked; nothing is sent
 * (sync is refused), so every record waits on the phone, which is what the receipt and My activity then show.
 */

const catalog = (items: unknown[]) => ({ revision: 7, items, places: [] });
const small = [
  { id: "ITM-0001", name: "Folding Table", aliases: "Mesa", category: "EQUIPMENT", unit: "piece", area: "Inventory", action: "BORROW", available: 4, location: "Office › Storage › Shelf B", locationId: null, audience: "STUDENTS_AND_USC_STAFF" },
  { id: "ITM-0002", name: "Bottled Water", aliases: null, category: "PANTRY", unit: "piece", area: "Pantry", action: "TAKE", available: 18, location: "Pantry shelf", locationId: null, audience: null },
  { id: "ITM-0003", name: "A4 Bond Paper", aliases: null, category: "SCHOOL SUPPLIES", unit: "ream", area: "Inventory", action: "USE", available: 8, location: "Office cabinet", locationId: null, audience: null }
];
const many = Array.from({ length: 600 }, (_, index) => ({
  id: `ITM-${String(index + 1).padStart(4, "0")}`, name: `${index % 3 === 0 ? "Chair" : index % 3 === 1 ? "Marker" : "Biscuit"} ${index + 1}`, aliases: null, category: index % 3 === 0 ? "FURNITURE" : index % 3 === 1 ? "SCHOOL SUPPLIES" : "PANTRY",
  unit: "piece", area: index % 3 === 2 ? "Pantry" : "Inventory", action: index % 3 === 0 ? "BORROW" : "TAKE", available: 10, location: null, locationId: null, audience: index % 3 === 0 ? "STUDENTS_AND_USC_STAFF" : null
}));

async function serve(page: Page, items: unknown[]) {
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r7"' }, body: JSON.stringify(catalog(items)) }));
  await page.route("**/api/self-service/sync", (route) => route.abort());
}

/** A camera photo, made in the page, handed to the file input as a person would. */
async function attachPhoto(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 640;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#7a1419";
    context.fillRect(0, 0, 480, 640);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/jpeg", 0.8));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const input = document.querySelector<HTMLInputElement>("#ss-photo")!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByAltText("Photo to attach")).toBeVisible();
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("home leads with search, then a few items from each group, and the rest are one tap away", async ({ page }) => {
  await serve(page, small);
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/self-service");
    await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search everything" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toContainText(["Equipment", "Supplies", "Pantry"]);
    await expect(page.getByRole("link", { name: /^Return/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^My activity/ })).toBeVisible();
    // Each card says only the name, how many, and how it is used and where.
    const table = page.locator(".ss-card", { hasText: "Folding Table" });
    await expect(table).toContainText("4 available");
    await expect(table).toContainText("Borrow · Storage › Shelf B");
    expect(await noSideways(page), `no sideways scroll at ${width}`).toBe(0);
  }
  // Three items: no group has more than a preview, so no "See all".
  await expect(page.getByRole("link", { name: /See all/ })).toHaveCount(0);
  // Search replaces the groups while something is typed, and finds by another name.
  await page.getByRole("searchbox", { name: "Search everything" }).fill("mesa");
  await expect(page.locator(".ss-results .ss-row")).toHaveCount(1);
  await expect(page.locator(".ss-groups")).toBeHidden();
  await page.getByRole("searchbox", { name: "Search everything" }).fill("zzz");
  await expect(page.locator(".ss-results")).toContainText("Nothing matches");
  await page.getByRole("searchbox", { name: "Search everything" }).fill("");
  await expect(page.locator(".ss-groups")).toBeVisible();
});

test("a catalog of 600 items draws the same small home, and a group opens as a light list", async ({ page }) => {
  await serve(page, many);
  await page.goto("/self-service");
  await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
  // Four per group, three groups: the page does not grow with the catalog.
  await expect(page.locator(".ss-card")).toHaveCount(12);
  await expect(page.getByRole("link", { name: "See all 200 in Equipment" })).toBeVisible();
  await page.getByRole("link", { name: "See all 200 in Equipment" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Equipment" })).toBeVisible();
  await expect(page.locator(".ss-row")).toHaveCount(200);
  expect(await page.locator(".ss-list--photos li").first().evaluate((node) => getComputedStyle(node).contentVisibility)).toBe("auto");
  // The group's chips move between groups without leaving the list.
  await page.getByRole("link", { name: "Pantry", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pantry" })).toBeFocused();
  await expect(page.locator(".ss-row")).toHaveCount(200);
  await page.getByRole("link", { name: "All", exact: true }).click();
  await expect(page.locator(".ss-row")).toHaveCount(600);
  // Finding one among 600 is immediate.
  await page.getByRole("searchbox", { name: "Search" }).fill("chair 301");
  await expect(page.locator(".ss-row")).toHaveCount(1);
  const timing = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>("[data-search]")!;
    const start = performance.now();
    input.value = "marker";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    return performance.now() - start;
  });
  expect(timing).toBeLessThan(750);
});

test("a first borrow: the item's page, who you are, a photo, the check, then a receipt with a reference and what is on loan", async ({ page }) => {
  await serve(page, small);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/self-service");
  await page.locator(".ss-card", { hasText: "Folding Table" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Folding Table" })).toBeVisible();
  await expect(page.locator(".ss-item__how")).toContainText("bring it back");
  await expect(page.locator(".ss-where")).toContainText("Office › Storage › Shelf B");
  await expect(page.getByRole("link", { name: "Take", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Borrow", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Folding Table" });
  // Nobody is remembered yet: the fields show, and remembering is a visible choice.
  await expect(sheet.getByLabel("Remember me on this phone")).toBeChecked();
  // The first problem is said in words and the field to fix it is focused. Nothing is sent or saved.
  await sheet.getByRole("button", { name: "Review and borrow" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Please enter a name.");
  await expect(sheet.getByLabel("Your full name")).toBeFocused();
  await sheet.getByLabel("Your full name").fill("Maria Santos");
  await sheet.getByRole("button", { name: "Review and borrow" }).click();
  await expect(sheet.getByRole("alert")).toContainText("student ID number is needed");
  await sheet.getByLabel("Student ID number").fill("20-1234-567");
  await sheet.getByRole("button", { name: "Review and borrow" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Take a photo holding the item.");
  await attachPhoto(page);
  await sheet.getByLabel("Tomorrow").check();
  await sheet.getByRole("button", { name: "Review and borrow" }).click();
  // The check shows what will be sent; nothing is saved until it is confirmed, and Enter in a field only gets here.
  const summary = sheet.locator(".ss-summary");
  await expect(sheet.getByRole("heading", { name: "Check before you send" })).toBeFocused();
  await expect(summary).toContainText("1 × Folding Table");
  await expect(summary).toContainText("Maria Santos · ID 20-1234-567");
  await expect(summary).toContainText("Individual use");
  await expect(summary).toContainText("Tomorrow");
  await expect(summary.getByRole("img", { name: "The photo you are sending" })).toBeVisible();
  expect(await page.evaluate(() => new Promise<number>((resolve) => { const open = indexedDB.open("logistics-hub"); open.onsuccess = () => { const count = open.result.transaction("events").objectStore("events").count(); count.onsuccess = () => resolve(count.result); }; }))).toBe(0);
  await sheet.getByRole("button", { name: "Confirm borrow" }).click();
  const receipt = page.getByRole("dialog", { name: "Borrowed" });
  await expect(receipt.locator(".ss-receipt__ref strong")).toHaveText(/^SS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  await expect(receipt).toContainText("Maria Santos · ID 20-1234-567");
  await expect(receipt).toContainText("Return it by Tomorrow");
  await expect(receipt).toContainText("Saved on this phone");
  const reference = (await receipt.locator(".ss-receipt__ref strong").textContent())!;
  await receipt.getByRole("button", { name: "Done" }).click();

  // My activity: what is on loan first, what waits second, the reference on every record.
  await page.getByRole("link", { name: /^My activity/ }).click();
  await expect(page.getByRole("heading", { name: "On loan now" })).toBeVisible();
  const loan = page.locator(".ss-loan", { hasText: "Folding Table" });
  await expect(loan).toContainText("Return by Tomorrow");
  await expect(loan.getByRole("link", { name: /^Return/ })).toBeVisible();
  await expect(page.locator(".ss-waiting")).toContainText("1 waiting to send");
  await expect(page.locator(".ss-waiting")).toContainText(reference);
  expect(await noSideways(page)).toBe(0);

  // Returning it: the loan is known, a photo is needed, and the check comes before the record is saved.
  await loan.getByRole("link", { name: /^Return/ }).click();
  const back = page.getByRole("dialog", { name: /Return Folding Table/ });
  await back.getByRole("button", { name: "Review and return" }).click();
  await expect(back.getByRole("alert")).toContainText("Take a photo of the item you are returning.");
  await attachPhoto(page);
  await back.getByRole("radio", { name: "Damaged" }).check();
  await back.getByRole("button", { name: "Review and return" }).click();
  await expect(back.getByRole("alert")).toContainText("Say what's damaged.");
  await back.getByLabel("What's damaged?").fill("Leg is loose");
  await back.getByRole("button", { name: "Review and return" }).click();
  await expect(back.locator(".ss-summary")).toContainText("Damaged: Leg is loose");
  await back.getByRole("button", { name: "Confirm return" }).click();
  await expect(page.getByRole("dialog", { name: "Damaged return sent" })).toBeVisible();
});

test("a remembered person shows as a card with Not you? Change, a different person is not remembered, and forgetting is in My activity", async ({ page }) => {
  await serve(page, small);
  await page.goto("/self-service?do=take&item=ITM-0002");
  let sheet = page.getByRole("dialog", { name: "Bottled Water" });
  await sheet.getByLabel("Your name").fill("Maria Santos");
  await sheet.getByRole("button", { name: "Review and take" }).click();
  await sheet.getByRole("button", { name: "Confirm take" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/^Good (morning|afternoon|evening), Maria\.$/)).toBeVisible();

  // Next time: a card, no typing.
  await page.goto("/self-service?do=take&item=ITM-0002");
  sheet = page.getByRole("dialog", { name: "Bottled Water" });
  await expect(sheet.locator(".ss-who")).toContainText("Maria Santos");
  await expect(sheet.getByLabel("Your name")).toBeHidden();
  // Not you? The fields come back; this person is not remembered when they say so.
  await sheet.getByRole("button", { name: "Not you? Change" }).click();
  await expect(sheet.getByLabel("Your name")).toBeFocused();
  await sheet.getByLabel("Your name").fill("Pedro Reyes");
  await sheet.getByLabel("Remember me on this phone").uncheck();
  await sheet.getByRole("button", { name: "Review and take" }).click();
  await expect(sheet.locator(".ss-summary")).toContainText("Pedro Reyes");
  await sheet.getByRole("button", { name: "Confirm take" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/, Maria\.$/)).toBeVisible();

  // Forgetting is one visible button; the next form starts empty.
  await page.getByRole("link", { name: /^My activity/ }).click();
  await page.getByText("This phone", { exact: true }).click();
  await expect(page.locator(".ss-more")).toContainText("Remembered here: Maria Santos");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Forget me on this phone" }).click();
  await expect(page.locator(".ss-more")).toContainText("Nobody is remembered on this phone");
  await page.goto("/self-service?do=take&item=ITM-0002");
  await expect(page.getByRole("dialog", { name: "Bottled Water" }).getByLabel("Your name")).toHaveValue("");
});

test("a USC-only item asks for a reason and no student ID, and a remembered name is enough", async ({ page }) => {
  await serve(page, [{ ...small[0], audience: "USC_STAFF_ONLY" }]);
  await page.goto("/self-service?do=borrow&item=ITM-0001");
  const sheet = page.getByRole("dialog", { name: "Folding Table" });
  await expect(sheet.getByLabel("Student ID number")).not.toHaveAttribute("required", "");
  await sheet.getByLabel("Name of the person using it").fill("Jose Ramos");
  await sheet.getByRole("button", { name: "Review and borrow" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Say what it's for.");
  await sheet.getByLabel("Specific reason").fill("Stage setup");
  await attachPhoto(page);
  await sheet.getByRole("button", { name: "Review and borrow" }).click();
  await expect(sheet.locator(".ss-summary")).toContainText("USC use: Stage setup");
});

test.describe("contextual help", () => {
  const open = async (page: Page) => {
    await serve(page, small);
    await page.goto("/self-service?do=borrow&item=ITM-0001");
    return page.getByRole("dialog", { name: "Folding Table" });
  };

  test("opens on hover after a short delay, stays while the pointer is on it, and closes on leaving", async ({ page }) => {
    const sheet = await open(page);
    const trigger = sheet.getByRole("button", { name: "About the photo" });
    // Settle the sheet's scroll first: a note closes when its sheet scrolls, on purpose.
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await trigger.hover();
    await expect(sheet.locator(".help__note")).toContainText("Only Logistics staff can see it");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await sheet.locator(".help__note").hover();
    await page.waitForTimeout(500);
    await expect(sheet.locator(".help__note")).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(sheet.locator(".help__note")).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("opens on keyboard focus, is announced as a status, closes with Escape and leaves focus on its button, and a second Escape closes the sheet", async ({ page }) => {
    const sheet = await open(page);
    const trigger = sheet.getByRole("button", { name: "About the photo" });
    await trigger.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();
    await expect(sheet.locator(".help__note")).toBeVisible();
    // The note sits inside a status region, so a screen reader says it when it opens.
    await expect(sheet.locator("[role=status]", { has: page.locator(".help__note") })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(sheet.locator(".help__note")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(sheet.locator(".help__note")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Folding Table" })).toHaveCount(0);
  });

  test("opens and closes on tap, closes on a tap elsewhere, and its target is at least 24 by 24 CSS pixels with 44 around it", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const sheet = await open(page);
    const trigger = sheet.getByRole("button", { name: "About the student ID" });
    const box = (await trigger.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    const hit = await trigger.evaluate((node) => { const ring = getComputedStyle(node, "::before"); return [parseFloat(ring.width), parseFloat(ring.height)]; });
    expect(hit[0]).toBeGreaterThanOrEqual(44);
    expect(hit[1]).toBeGreaterThanOrEqual(44);
    await trigger.click();
    const note = sheet.locator(".help__note");
    await expect(note).toContainText("Individual borrowing needs your ID");
    // The note stays inside the screen, even from a field near the edge.
    const place = (await note.boundingBox())!;
    expect(place.x).toBeGreaterThanOrEqual(0);
    expect(place.x + place.width).toBeLessThanOrEqual(320);
    await trigger.click();
    await expect(note).toHaveCount(0);
    await trigger.click();
    await sheet.getByRole("heading", { name: "Folding Table" }).click();
    await expect(note).toHaveCount(0);
  });

  test("only one note is open at a time", async ({ page }) => {
    const sheet = await open(page);
    // A tall screen keeps both in view: scrolling a sheet closes an open note on purpose.
    await page.setViewportSize({ width: 820, height: 1600 });
    await page.waitForTimeout(150);
    await sheet.getByRole("button", { name: "About the student ID" }).click();
    await expect(sheet.locator(".help__note")).toContainText("Individual borrowing");
    await sheet.getByRole("button", { name: "About the photo" }).click();
    await expect(sheet.locator(".help__note")).toHaveCount(1);
    await expect(sheet.locator(".help__note")).toContainText("Only Logistics staff can see it");
  });
});

test("an offline phone keeps browsing from what it saved, and an item gone from the catalog says so on its page", async ({ page, context }) => {
  await serve(page, small);
  await page.goto("/self-service");
  await expect(page.locator(".ss-card")).toHaveCount(3);
  await context.setOffline(true);
  await page.getByRole("link", { name: /^Return/ }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.locator(".ss-card", { hasText: "Bottled Water" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bottled Water" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Take", exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.goto("/self-service?do=item&item=ITM-9999");
  await expect(page.getByText("This item isn't offered in Self-Service right now.")).toBeVisible();
});
