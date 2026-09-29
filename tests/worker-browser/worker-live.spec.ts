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
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("7");
  await expect(page.locator("#stock-form")).toContainText("blocks on hand");
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
  await page.getByLabel("Shown to").selectOption("STUDENTS_AND_USC_STAFF");
  await page.getByLabel("Details reviewed and verified").check();
  await expect(page.getByText("Will appear on the public Lending Hub.")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();

  await expect(visitor.getByText("Bluetooth Microphone")).toBeVisible({ timeout: 25_000 });
  await expect(visitor.getByText("1 piece · last one")).toBeVisible();

  await expect(page.getByRole("tab", { name: "Edit details" })).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Listed on the Lending Hub" })).toBeVisible();
  // The figure itself is the editor; a change needs a reason before it saves.
  const total = page.getByLabel("Quantity on hand");
  await expect(total).toHaveValue("1");
  await total.fill("5");
  await expect(page.locator("#stock-change")).toContainText("+4 1 → 5");
  await page.getByRole("button", { name: "Add 4" }).click();
  await expect(page.locator("#stock-form").getByRole("alert")).toHaveText("Choose a reason.");
  await page.getByRole("radio", { name: "New stock received" }).check();
  await page.getByRole("button", { name: "Add 4" }).click();
  await expect(page.getByText("Bluetooth Microphone: 1 → 5 pieces (new stock received).")).toBeVisible();
  await expect(total).toHaveValue("5");
  await total.fill("-9");
  await expect(page.locator("#stock-change")).toContainText("Only 5 on hand; it cannot go below 0.");
  await total.press("Escape");
  await expect(total).toHaveValue("5");

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
  await sheet.getByLabel("Shown to").selectOption("STUDENTS_AND_USC_STAFF");
  await expect(sheet.getByLabel("Type", { exact: true }).locator("option")).toHaveText(["Loanable", "Consumable"]);
  await sheet.getByLabel("Type", { exact: true }).selectOption("Consumable");
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Only Loanable items can be offered for lending.");
  await sheet.getByLabel("Type", { exact: true }).selectOption("Loanable");
  await sheet.getByLabel("Opening quantity").fill("3");
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page.getByText(/Item ITM-\d+ created\./)).toBeVisible();
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("3");
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

test("stock workspace: record a delivery, restock and receive, then read it in activity", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Stock & Pantry" }).click();
  await expect(page.getByRole("heading", { name: "Stock & Pantry" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Needs attention/ })).toBeVisible();

  const panel = page.locator("#record-panel");
  await panel.getByLabel("Item", { exact: true }).fill("Bond Paper - A4 · ITM-0135");
  await expect(panel.locator("#record-card")).toContainText("0 reams on hand");
  await panel.getByLabel("Quantity on hand").fill("+12");
  await expect(panel.locator("#record-change")).toContainText("+12 0 → 12");
  await panel.getByRole("button", { name: "Add 12" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Choose a reason.");
  await panel.getByRole("radio", { name: "New stock received" }).check();
  await panel.getByRole("button", { name: "Add 12" }).click();
  await expect(page.getByText("Bond Paper - A4: 0 → 12 reams (new stock received).")).toBeVisible();
  await expect(panel.locator("#receipts")).toContainText("+12 Bond Paper - A4");
  await expect(panel.getByLabel("Item", { exact: true })).toBeFocused();

  const ketchup = page.locator("tr", { hasText: "Banana Ketchup" });
  await ketchup.getByRole("button", { name: "Add to restock" }).click();
  await expect(page.getByText("Banana Ketchup added to the restock list.")).toBeVisible();
  await page.getByRole("button", { name: /^Restock list/ }).click();
  const entry = page.locator("tr", { hasText: "Banana Ketchup" });
  await entry.getByRole("button", { name: "Mark planned" }).click();
  await expect(entry.getByText("Planned", { exact: true })).toBeVisible();
  await entry.getByRole("button", { name: "Receive" }).click();
  await expect(panel.getByText("Receiving the restock of Banana Ketchup.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "New stock received" })).toBeHidden();
  await panel.getByLabel("Quantity on hand").fill("6");
  await expect(panel.getByRole("radio", { name: "New stock received" })).toBeChecked();
  await panel.getByRole("button", { name: "Add 6" }).click();
  await expect(page.getByText("Banana Ketchup: 0 → 6 bottles (new stock received).")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Restock list 0/ })).toBeVisible();
  await expect(page.getByText("Closed in the last two weeks")).toBeVisible();

  await page.getByRole("button", { name: /^Activity/ }).click();
  const latest = page.locator(".activity-row").first();
  await expect(latest).toContainText("+6");
  await expect(latest).toContainText("Banana Ketchup · Stock in · New stock received");
  await expect(latest).toContainText("0 → 6 bottles · E2E Staff");
});

test("counting records the observed quantity, and pantry lists the catalog's pantry items", async ({ page }) => {
  await signIn(page);
  await page.goto("/staff/stock?show=count");
  const flour = page.locator("tr", { hasText: "All Purpose Flour" });
  await flour.getByRole("button", { name: "Count" }).click();
  const panel = page.locator("#record-panel");
  await expect(panel.getByRole("radio", { name: "Physical count" })).toBeChecked();
  await expect(panel.getByRole("button", { name: "Confirm count" })).toBeVisible();
  await panel.getByLabel("Quantity on hand").fill("18");
  await expect(panel.getByRole("radio", { name: "Physical count" })).toBeChecked();
  await expect(panel.locator("#record-change")).toContainText("→ 18");
  await panel.getByRole("button", { name: "Save count of 18" }).click();
  await expect(page.getByText(/All Purpose Flour: \d+ → 18 kilos \(physical count\)\./)).toBeVisible();
  await expect(page.locator("tr", { hasText: "All Purpose Flour" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Pantry/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.locator("tr", { hasText: "All Purpose Flour" })).toContainText("18 kilos");
  await page.getByRole("button", { name: /^Activity/ }).click();
  await expect(page.locator(".activity-row").first()).toContainText("Count correction");
});

test("stock workspace on a 320 px phone records through a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await signIn(page);
  await page.goto("/staff/stock");
  await expect(page.getByRole("heading", { name: "Stock & Pantry" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole("button", { name: "Update stock" }).click();
  const sheet = page.getByRole("dialog", { name: "Update stock" });
  await expect(sheet.getByLabel("Item", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("lend for individual and USC use with a photo, return one damaged, and read the dashboard", async ({ page }) => {
  const photo = "public/brand/ydd-2026-banner.jpg";
  await signIn(page);
  await page.goto("/staff/inventory?item=ITM-0262");
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("10");
  await page.getByRole("tab", { name: "Loan" }).click();
  const form = page.locator("#loan-form");
  await form.getByLabel("Borrower's full name").fill("Test Borrower One");
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(form.getByRole("alert")).toHaveText("Enter the borrower's student ID number.");
  await form.getByLabel(/Student ID number/).fill("test-0001");
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(form.getByRole("alert")).toHaveText("Add a photo of the hand-over.");
  await form.locator("input[type=file]").setInputFiles(photo);
  await expect(form.getByRole("img", { name: "Photo to attach" })).toBeVisible();
  await form.getByRole("button", { name: "One more" }).click();
  await form.getByRole("button", { name: "Lend 2 pieces" }).click();
  await expect(page.getByText("Lent 2 pieces of Scissors to Test Borrower One.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Loan · 1 out" })).toBeVisible();

  await form.getByRole("radio", { name: "USC use" }).check();
  await form.getByLabel("Name of the person using it").fill("Test Officer");
  await form.locator("input[type=file]").setInputFiles(photo);
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(form.getByRole("alert")).toHaveText("Give the specific reason for USC use.");
  await form.getByLabel("Specific reason").fill("Banner cutting for the general assembly");
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(page.getByText("Lent 1 piece of Scissors to Test Officer.")).toBeVisible();
  await expect(page.locator("#item-loans")).toContainText("Test Borrower One");
  await expect(page.locator("#item-loans")).toContainText("TEST-0001");
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("7");
  await expect(page.locator("#quantity-context")).toContainText("3 more on loan");
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history li").first()).toContainText("Lent out · Test Officer");
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Loans" }).click();
  await expect(page.getByRole("heading", { name: "Loans", level: 1 })).toBeVisible();
  await expect(page.locator("#loans-summary")).toContainText("2 loans out · 3 items");
  const row = page.locator(".loan-row", { hasText: "Test Borrower One" });
  await row.getByRole("button", { name: "Return" }).click();
  const dialog = page.getByRole("dialog", { name: "Scissors" });
  await expect(dialog.getByRole("img", { name: /Photo taken when it was lent/ })).toBeVisible();
  await dialog.getByRole("radio", { name: "Damaged" }).check();
  await dialog.getByRole("button", { name: "Mark damaged" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Describe the damage.");
  await dialog.getByLabel(/What happened/).fill("One blade bent");
  await dialog.getByRole("button", { name: "Mark damaged" }).click();
  await expect(page.getByText("Scissors marked damaged.")).toBeVisible();
  await expect(page.locator("#loans-summary")).toContainText("1 loan out · 1 item");

  await page.getByRole("button", { name: /^Borrowers/ }).click();
  await expect(page.getByRole("heading", { name: "Individual use" })).toBeVisible();
  const individual = page.locator(".leaderboard", { has: page.getByRole("heading", { name: "Individual use" }) });
  await expect(individual).toContainText("Test Borrower One");
  await expect(individual).toContainText("1 damaged or lost");
  const usc = page.locator(".leaderboard", { has: page.getByRole("heading", { name: "USC use" }) });
  await expect(usc).toContainText("Test Officer");
  await expect(usc).toContainText("1 out now");
  await page.getByRole("button", { name: /^Returned/ }).click();
  await expect(page.locator(".loan-row").first()).toContainText("One blade bent");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
