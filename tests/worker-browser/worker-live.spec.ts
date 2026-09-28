import { expect, test, type Page } from "@playwright/test";

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;

async function signIn(page: Page) {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
}

test("public Lending Hub fails closed on freshly migrated data", async ({ page, request }) => {
  const catalog = await (await request.get("/api/public/catalog")).json() as { items: unknown[] };
  expect(catalog.items).toEqual([]);
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "No items are open for borrowing yet" })).toBeVisible();
});

test("staff pages and every staff write reject anonymous and cross-site callers", async ({ page, request, baseURL }) => {
  await page.goto("/staff/inventory");
  await expect(page).toHaveURL(/\/staff$/);
  const write = { data: { kind: "IN", quantity: 50, key: "anonymous-attempt" }, headers: { origin: baseURL! } };
  expect((await request.post("/api/staff/items/ITM-0072/movements", write)).status()).toBe(401);
  expect((await request.patch("/api/staff/items/ITM-0072", { data: {}, headers: { origin: baseURL! } })).status()).toBe(401);
  expect((await request.post("/api/staff/items", { data: {}, headers: { origin: baseURL! } })).status()).toBe(401);
  await signIn(page);
  const crossSite = await page.request.post("/api/staff/items/ITM-0072/movements", { data: { kind: "IN", quantity: 50, key: "cross-site-attempt" }, headers: { origin: "https://evil.example" } });
  expect(crossSite.status()).toBe(403);
  await expect(page.getByRole("button", { name: "Bluetooth Microphone" })).toBeVisible();
});

test("preserves the ITM-0001 reconciliation evidence", async ({ page }) => {
  await signIn(page);
  await page.getByRole("searchbox", { name: "Search inventory" }).fill("ITM-0001");
  await page.getByRole("button", { name: "Detergent Bar" }).click();
  await expect(page.locator("#onhand")).toContainText("7 blocks on hand");
  await expect(page.locator("#onhand")).toContainText("legacy snapshot reported 8 blocks");
});

test("staff publish and stock changes reach an open public page live", async ({ page, browser }) => {
  test.setTimeout(90_000); // waits on real 15-second public polling cycles
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/lending");
  await expect(visitor.getByRole("heading", { name: "No items are open for borrowing yet" })).toBeVisible();

  await signIn(page);
  await page.getByRole("searchbox", { name: "Search inventory" }).fill("Bluetooth Microphone");
  await page.getByRole("button", { name: "Bluetooth Microphone" }).click();
  await page.getByRole("tab", { name: "Details & lending" }).click();
  await page.getByLabel("Who may borrow").selectOption("STUDENTS_AND_USC_STAFF");
  await page.getByLabel("Details reviewed and verified").check();
  await expect(page.getByText("Will appear on the public Lending Hub.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await expect(visitor.getByText("Bluetooth Microphone")).toBeVisible({ timeout: 25_000 });
  await expect(visitor.getByText("1 piece available")).toBeVisible();

  await page.getByRole("tab", { name: "Stock" }).click();
  await page.getByText("Stock in", { exact: true }).click();
  await page.getByLabel("Quantity to add").fill("4");
  await expect(page.getByText("On hand after: 5 pieces")).toBeVisible();
  await page.getByRole("button", { name: "Record stock in" }).click();
  await expect(page.getByText("Recorded. On hand is now 5 pieces.")).toBeVisible();
  await page.getByText("Stock out", { exact: true }).click();
  await page.getByLabel("Quantity to remove").fill("9");
  await page.getByRole("button", { name: "Record stock out" }).click();
  await expect(page.getByText("Only 5 on hand; cannot remove 9.")).toBeVisible();

  await expect(visitor.getByText("5 pieces available")).toBeVisible({ timeout: 25_000 });
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history li").first()).toContainText("Stock in");
  await expect(page.locator("#history li").first()).toContainText("E2E Staff");
});

test("sign out revokes the session", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Staff login" })).toBeVisible();
  expect((await page.request.get("/api/staff/session")).status()).toBe(401);
  await page.goto("/staff/inventory");
  await expect(page).toHaveURL(/\/staff$/);
});
