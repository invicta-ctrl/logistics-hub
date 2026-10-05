import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";

/*
 * V1.8 against a real Worker and D1: a kit of a borrow-and-return item, whole-unit takes and a gradually used item is made, edited and
 * checked on a phone. Its state follows the items' own stock; a check records what staff saw and writes no movement; a template makes a
 * second kit with its own state and copies no stock. Every name starts with "E2E V18".
 */

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? "8792"}`;

let context: BrowserContext;
let page: Page;
const ids: Record<string, string> = {};

const api = (target: Page) => ({
  get: async <T>(path: string) => (await (await target.request.get(path)).json()) as T,
  post: async <T>(path: string, data: unknown) => (await (await target.request.post(path, { headers: { origin: BASE }, data })).json()) as T
});
const ledger = async (target: Page) => {
  const out: Record<string, [number, number]> = {};
  for (const [name, id] of Object.entries(ids)) {
    const { item, movements } = await api(target).get<{ item: { onHand: number }; movements: unknown[] }>(`/api/staff/items/${id}`);
    out[name] = [item.onHand, movements.length];
  }
  return out;
};
async function phone(browser: Browser) {
  const made = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
  return { context: made, page: await made.newPage() };
}
const sheet = (target: Page) => target.locator("dialog[open]");

test.describe.serial("kits", () => {
  test.beforeAll(async ({ browser }) => {
    ({ context, page } = await phone(browser));
    await page.goto("/staff");
    await page.getByRole("textbox", { name: "Username" }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
    const base = { category: "E2E V18 SEWING", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
    const { post } = api(page);
    ids["E2E V18 Thread"] = (await post<{ id: string }>("/api/staff/items", { ...base, name: "E2E V18 Thread", itemType: "Consumable", openingQuantity: 10 })).id;
    ids["E2E V18 Needles"] = (await post<{ id: string }>("/api/staff/items", { ...base, name: "E2E V18 Needles", itemType: "Consumable", openingQuantity: 3 })).id;
    ids["E2E V18 Scissors"] = (await post<{ id: string }>("/api/staff/items", { ...base, name: "E2E V18 Scissors", itemType: "Loanable", lendingAudience: "USC_STAFF_ONLY", openingQuantity: 2 })).id;
    ids["E2E V18 Chalk"] = (await post<{ id: string }>("/api/staff/items", { ...base, name: "E2E V18 Chalk", itemType: "Consumable", consumptionMode: "OPEN_UNIT", openingQuantity: 4 })).id;
  });
  test.afterAll(async () => { await context.close(); });

  test("make a kit of mixed items, and see its state follow their stock", async () => {
    await page.goto("/staff/kits");
    await expect(page.getByRole("heading", { name: "Kits", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "New kit" }).first().click();
    await sheet(page).getByLabel("Name", { exact: true }).fill("E2E V18 Sewing Kit A");
    await sheet(page).getByRole("button", { name: "Make kit" }).click();
    await expect(sheet(page).getByRole("heading", { name: "Edit E2E V18 Sewing Kit A" })).toBeVisible();
    for (const [name, quantity] of [["E2E V18 Thread", "4"], ["E2E V18 Needles", "2"], ["E2E V18 Scissors", "1"], ["E2E V18 Chalk", "1"]] as const) {
      await sheet(page).getByLabel("Add an item").fill(name);
      await sheet(page).getByRole("button", { name: new RegExp(name) }).click();
      await sheet(page).getByLabel(`How many ${name} the kit holds`).fill(quantity);
    }
    await sheet(page).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await expect(sheet(page).getByText("4 of 4 components ready")).toBeVisible();
    await expect(sheet(page).locator(".tag--lg")).toHaveText("Ready");
    // The three behaviours sit in one kit, each named as its own record names it.
    await expect(sheet(page).locator(".kit-part", { hasText: "E2E V18 Scissors" })).toContainText("Borrow & return");
    await expect(sheet(page).locator(".kit-part", { hasText: "E2E V18 Thread" })).toContainText("Take");
    await expect(sheet(page).locator(".kit-part", { hasText: "E2E V18 Chalk" })).toContainText("Use gradually");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    // Stock leaves through the item's own rules; the kit follows.
    const need = ids["E2E V18 Needles"]!;
    const out = await api(page).post<{ onHand: number }>(`/api/staff/items/${need}/movements`, { kind: "OUT", quantity: 2, reason: "CONSUMED", key: crypto.randomUUID() });
    expect(out.onHand).toBe(1);
    await page.reload();
    const row = page.locator(".kit-row", { hasText: "E2E V18 Sewing Kit A" });
    await expect(row).toContainText("Needs replenishment");
    await expect(row).toContainText("3 of 4 ready");
    await row.getByRole("button").first().click();
    await expect(sheet(page).locator(".kit-part", { hasText: "E2E V18 Needles" })).toContainText("Needs 2, 1 on the shelf.");
  });

  test("check the kit: what is seen is recorded, stock is not touched, and a finding names where to fix it", async () => {
    const before = await ledger(page);
    await page.goto("/staff/kits?kit=KIT-0001");
    await sheet(page).getByRole("button", { name: "Check kit" }).click();
    await expect(sheet(page).locator(".kit-progress__count")).toContainText("0 / 4 checked");
    const row = (name: string) => sheet(page).locator(".kit-check-row", { hasText: name });
    await row("E2E V18 Thread").getByRole("button", { name: "All there" }).click();
    await row("E2E V18 Needles").getByRole("button", { name: "Running low" }).click();
    await row("E2E V18 Scissors").getByRole("button", { name: "Damaged" }).click();
    await row("E2E V18 Scissors").getByLabel("Note about E2E V18 Scissors").fill("Loose screw");
    await expect(sheet(page).locator(".kit-progress__count")).toContainText("3 / 4 checked");
    page.once("dialog", (dialog) => void dialog.accept());
    await sheet(page).getByRole("button", { name: "Finish check" }).click();
    await expect(sheet(page).getByRole("heading", { name: "E2E V18 Sewing Kit A: checked" })).toBeVisible();
    await expect(sheet(page).locator(".kit-stats")).toContainText("Not checked1");
    await expect(sheet(page).getByText("Stock was not changed by this check.")).toBeVisible();
    await expect(sheet(page).locator(".kit-part", { hasText: "E2E V18 Scissors" })).toContainText("Loose screw");
    await expect(sheet(page).getByRole("link", { name: "E2E V18 Scissors" })).toHaveAttribute("href", `/staff/items?item=${ids["E2E V18 Scissors"]}`);
    expect(await ledger(page)).toEqual(before);
    await sheet(page).getByRole("button", { name: "Back to the kit" }).click();
    await expect(sheet(page).locator(".tag--lg")).toHaveText("Needs review");
    await expect(sheet(page).locator(".kit-history li")).toHaveCount(1);
  });

  test("a template makes a second kit with its own state, and copies no stock", async () => {
    const before = await ledger(page);
    await page.goto("/staff/kits?kit=KIT-0001");
    await sheet(page).getByRole("button", { name: "Save as template" }).click();
    await sheet(page).getByLabel("Template name").fill("E2E V18 Sewing Kit");
    await sheet(page).getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template saved.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".kit-list--templates")).toContainText("E2E V18 Sewing Kit");
    await page.getByRole("button", { name: "New kit" }).first().click();
    await sheet(page).getByLabel("Name", { exact: true }).fill("E2E V18 Sewing Kit B");
    await sheet(page).getByLabel("Start from").selectOption({ label: "E2E V18 Sewing Kit (4 components)" });
    await sheet(page).getByRole("button", { name: "Make kit" }).click();
    await expect(sheet(page).getByRole("heading", { name: "E2E V18 Sewing Kit B" })).toBeVisible();
    await expect(sheet(page).getByText("Made from the template E2E V18 Sewing Kit.")).toBeVisible();
    await expect(sheet(page).locator(".kit-part")).toHaveCount(4);
    // Same pool of needles, asked for twice: both kits need replenishment; the new one has no check history of its own.
    await expect(sheet(page).locator(".tag--lg")).toHaveText("Needs replenishment");
    await expect(sheet(page).getByText("Not checked yet.")).toBeVisible();
    expect(await ledger(page)).toEqual(before);
    expect((await api(page).get<{ checks: unknown[] }>("/api/staff/kits/KIT-0002")).checks).toHaveLength(0);
  });

  test("an item's record shows its kits, and the page fits a 320 px phone with large text", async () => {
    await page.goto(`/staff/items?item=${ids["E2E V18 Thread"]}`);
    await expect(page.getByRole("dialog").getByRole("link", { name: "E2E V18 Sewing Kit A" })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of ["/staff/kits", "/staff/kits?kit=KIT-0001"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Kits", level: 1 })).toBeVisible();
      await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
      await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
    }
  });
});
