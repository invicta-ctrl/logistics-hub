import { expect, test, type Page } from "@playwright/test";

/*
 * V1.11 against a real Worker and D1: global search finds a catalog item and opens it, a link made on its record is found from the
 * other item at the next search, and a staff account is never sent the Staff Directory. Links made here are removed at the end.
 */

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;

async function signIn(page: Page): Promise<void> {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
}

// The owner administration tests in worker-live replace the owner's password with a recovery key; either one may be current.
async function signInOwner(page: Page, origin: string): Promise<void> {
  let signedIn = false;
  for (const secret of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
    signedIn ||= (await page.request.post("/api/staff/login", { headers: { origin }, data: { username: process.env.E2E_OWNER_USERNAME, password: secret } })).ok();
  }
  expect(signedIn).toBe(true);
  await page.goto("/staff");
  await expect(page.locator("tbody tr").first()).toBeVisible();
}

const field = (page: Page) => page.getByRole("combobox", { name: "Search the Hub" });

test("search opens an item, and a link made on its record is found from the other item", async ({ page }) => {
  await signIn(page);
  const directoryCalls: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/staff/admin/directory")) directoryCalls.push(request.url()); });

  await page.keyboard.press("Control+k");
  await field(page).fill("bond paper a4");
  const bond = page.getByRole("option", { name: /^Bond Paper - A4, item/ });
  await expect(bond).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/staff\/items\?item=ITM-0135$/);
  const sheet = page.getByRole("dialog", { name: "Bond Paper - A4" });
  await expect(sheet.getByRole("heading", { name: "Linked items" })).toBeVisible();
  // The record's focus survives its content loading, so the keyboard starts inside the sheet.
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("dialog.sheet")))).toBe(true);

  // Link it: used with a stapler.
  await sheet.getByRole("button", { name: "Link an item" }).click();
  await sheet.getByLabel("This item is").selectOption({ label: "Used with…" });
  await sheet.getByLabel("…the other item").fill("stapler");
  const pick = sheet.locator("[data-link-pick]").first();
  const otherId = (await pick.getAttribute("data-link-pick"))!;
  const otherName = (await pick.locator(".item-links__name").textContent())!.trim();
  await pick.click();
  await sheet.getByRole("button", { name: `Link to ${otherName}` }).click();
  await expect(sheet.locator(".item-links__row")).toContainText(otherName);
  await expect(sheet.locator(".item-links__row")).toContainText("Used with");

  // The next search, from the other item's name, brings the paper along and says why.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.keyboard.press("Control+k");
  await field(page).fill(otherName);
  await expect(page.getByRole("option", { name: new RegExp(`^Bond Paper - A4, item, Used with ${otherName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })).toBeVisible();
  expect(directoryCalls).toEqual([]);

  // Remove it again from the other end.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.goto(`/staff/items?item=${otherId}`);
  const other = page.getByRole("dialog", { name: otherName });
  await other.getByRole("button", { name: "Remove the link: Used with Bond Paper - A4" }).click();
  await expect(other.locator(".item-links__row")).toHaveCount(0);
});

test("an administrator finds people by name; a staff account is refused by the Worker", async ({ page, browser, baseURL }) => {
  await signInOwner(page, baseURL!);
  await page.keyboard.press("Control+k");
  await field(page).fill("zzzz nobody");
  await expect(page.getByText("No matches for “zzzz nobody”")).toBeVisible();
  const answer = await page.request.get("/api/staff/admin/directory/search?q=a");
  expect(answer.status()).toBe(200);
  expect(answer.headers()["cache-control"]).toBe("private, no-store");

  const staff = await browser.newPage();
  await signIn(staff);
  expect((await staff.request.get("/api/staff/admin/directory/search?q=a")).status()).toBe(403);
  await staff.close();
});
