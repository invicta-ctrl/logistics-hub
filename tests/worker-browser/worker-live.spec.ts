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
  await expect(page.locator("#quantity")).toContainText("7 blocks on hand");
  await expect(page.locator("#panel-overview")).toContainText("legacy snapshot reported 8 blocks, but the migrated movement ledger derives 7");
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
  await page.getByRole("tab", { name: "Review & edit" }).click();
  await page.getByLabel("Who may borrow").selectOption("STUDENTS_AND_USC_STAFF");
  await page.getByLabel("Details reviewed and verified").check();
  await expect(page.getByText("Will appear on the public Lending Hub.")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();

  await expect(visitor.getByText("Bluetooth Microphone")).toBeVisible({ timeout: 25_000 });
  await expect(visitor.getByText("1 piece · last one")).toBeVisible();

  await expect(page.getByRole("tab", { name: "Edit details" })).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Listed on the Lending Hub" })).toBeVisible();
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

test.describe("owner administration", () => {
  async function signInAs(page: Page, user: string, pass: string) {
    await page.goto("/staff");
    await page.getByRole("textbox", { name: "Username" }).fill(user);
    await page.getByLabel("Password", { exact: true }).fill(pass);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  test("owner creates a staff account; the new user must choose a password; staff cannot administer", async ({ page, browser }) => {
    await signInAs(page, process.env.E2E_OWNER_USERNAME!, process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("link", { name: "Administration" }).click();
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await page.getByRole("button", { name: "New account" }).click();
    await page.getByLabel("Display name").fill("Maria Santos");
    await page.getByLabel("Username").fill("msantos");
    await page.getByRole("button", { name: "Create account" }).click();
    const temporary = (await page.locator(".secret code").textContent())!;
    expect(temporary).toMatch(/^[\w]{5}(-[\w]{5}){3}$/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("cell", { name: /Maria Santos/ })).toBeVisible();

    const staff = await (await browser.newContext()).newPage();
    await signInAs(staff, "msantos", temporary);
    await expect(staff.getByText("Choose your own password to continue.")).toBeVisible();
    await expect(staff.getByRole("link", { name: "Inventory" })).toHaveCount(0);
    expect((await staff.request.get("/api/staff/inventory")).status()).toBe(403);
    await staff.getByLabel("Current password").fill(temporary);
    await staff.getByLabel("New password", { exact: true }).fill("maria chose this one");
    await staff.getByLabel("Repeat new password").fill("maria chose this one");
    await staff.getByRole("button", { name: "Change password" }).click();
    await expect(staff.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(staff.getByRole("link", { name: "Administration" })).toHaveCount(0);
    expect((await staff.request.get("/api/staff/admin/accounts")).status()).toBe(403);
    await staff.goto("/staff/admin");
    await expect(staff).toHaveURL(/\/staff\/inventory$/);
  });

  test("owner issues a recovery key that resets the owner password exactly once", async ({ page, baseURL }) => {
    await signInAs(page, process.env.E2E_OWNER_USERNAME!, process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("link", { name: "My account" }).first().click();
    await page.getByRole("button", { name: /recovery key/ }).first().click();
    const key = (await page.locator(".secret code").textContent())!;
    expect(key).toMatch(/^LHR1\./);
    const recover = (newPassword: string) => page.request.post("/api/recovery/owner", { headers: { origin: baseURL! }, data: { recoveryKey: key, newPassword } });
    const first = await recover("recovered owner pass");
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({ username: process.env.E2E_OWNER_USERNAME });
    expect((await recover("second attempt pass!")).status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(/\/staff$/);
    await signInAs(page, process.env.E2E_OWNER_USERNAME!, "recovered owner pass");
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  });
});

test("migrated review: fill the gaps, mark reviewed, and move to the next record", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /^Needs review/ }).click();
  await expect(page).toHaveURL(/view=review/);
  const reviewedBefore = Number((await page.locator("#review-meter strong").textContent())!.replace(/\D/g, ""));
  const first = (await page.locator("tbody .row-link").first().textContent())!;
  const second = (await page.locator("tbody .row-link").nth(1).textContent())!;
  await page.locator("tbody .row-link").first().click();
  await page.getByRole("button", { name: "Review details" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Storage location").fill("E2E shelf  A");
  await sheet.getByLabel("Other names").fill("e2e alias, E2E ALIAS");
  await sheet.getByLabel("Type", { exact: true }).selectOption("Consumable");
  await page.getByRole("button", { name: /Mark reviewed & next/ }).click();
  await expect(page.getByText(`${first} reviewed. Opening the next record.`)).toBeVisible();
  await expect(page.getByRole("dialog", { name: second })).toBeVisible();
  await expect(page.locator("#review-meter")).toContainText(`${reviewedBefore + 1} of 397 records reviewed`);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^All items/ }).click();
  await page.getByRole("searchbox", { name: "Search inventory" }).fill("e2e alias");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search inventory" }).fill("");
  await page.getByLabel("Location", { exact: true }).selectOption("E2E shelf A");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.locator("tbody .row-link").first().click();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history li").first()).toContainText("Review completed");
  await expect(page.locator("#history li").first()).toContainText("Location Not set → E2E shelf A");
  await expect(page.locator("#history")).not.toContainText("{");
});

test("create, warn on a duplicate name, then deactivate without deleting", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New item" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill("detergent bar");
  await expect(page.getByText("ITM-0001 already uses this name.")).toBeVisible();
  await sheet.getByLabel("Name", { exact: true }).fill("E2E Extension Cord");
  await sheet.getByLabel("Category", { exact: true }).fill("office equipment and supplies");
  await sheet.getByLabel("Unit", { exact: true }).fill("piece");
  await sheet.getByLabel("Who may borrow").selectOption("STUDENTS_AND_USC_STAFF");
  await sheet.getByLabel("Type", { exact: true }).selectOption("Consumable");
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Only Loanable items can be offered for lending.");
  await sheet.getByLabel("Type", { exact: true }).selectOption("Loanable");
  await sheet.getByLabel("Opening quantity").fill("3");
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page.getByText(/Item ITM-\d+ created\./)).toBeVisible();
  await expect(page.locator("#quantity")).toContainText("3 pieces on hand");
  await expect(page.locator(".sheet__kicker")).toContainText("Office Equipment and Supplies");

  await page.getByRole("tab", { name: "Edit details" }).click();
  await sheet.getByLabel("Status", { exact: true }).selectOption("INACTIVE");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Inactive/ }).click();
  await expect(page.getByRole("button", { name: "E2E Extension Cord" })).toBeVisible();
});

test("staff workspace fits a 320 px phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await signIn(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.locator("tbody .row-link").first().click();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
