import { expect, test, type Page } from "@playwright/test";

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;

async function signIn(page: Page) {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
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
  await expect(page.locator(".summary__primary")).toContainText("7 blocks");
  await expect(page.locator("#summary")).toContainText("legacy snapshot reported 8 blocks, but the migrated movement ledger derives 7");
  await expect(page).toHaveURL(/item=ITM-0001/);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Detergent Bar" })).toBeVisible();
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
  await expect(page.getByText("Changes saved.")).toBeVisible();

  await expect(visitor.getByText("Bluetooth Microphone")).toBeVisible({ timeout: 25_000 });
  await expect(visitor.getByText("1 piece · last one")).toBeVisible();

  await page.getByRole("tab", { name: "Stock" }).click();
  await page.getByRole("radio", { name: "Stock in" }).check();
  await page.getByLabel("Quantity to add").fill("4");
  await expect(page.locator("#stock-preview")).toHaveText("1 → 5 pieces");
  await page.getByRole("button", { name: "Record stock in" }).click();
  await expect(page.getByText("Stock in recorded. Bluetooth Microphone now has 5 pieces.")).toBeVisible();
  await page.getByRole("radio", { name: "Stock out" }).check();
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
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
  expect((await page.request.get("/api/staff/session")).status()).toBe(401);
  await page.goto("/staff/inventory");
  await expect(page).toHaveURL(/\/staff$/);
});

test("inventory sorts by on-hand quantity and remembers it in the URL", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "On hand" }).click();
  await expect(page.getByRole("columnheader", { name: "On hand" })).toHaveAttribute("aria-sort", "descending");
  await expect(page).toHaveURL(/sort=onHand-desc/);
  const quantities = await page.locator("tbody .qty").evaluateAll((cells) => cells.slice(0, 5).map((cell) => Number(cell.textContent)));
  expect(quantities).toEqual([...quantities].sort((a, b) => b - a));
});
