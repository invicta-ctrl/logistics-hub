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
  await expect(page.getByText(/Will appear on the public Lending Hub/)).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();

  await expect(visitor.getByText("Bluetooth Microphone")).toBeVisible({ timeout: 25_000 });
  await expect(visitor.locator(".catalogue__row", { hasText: "Bluetooth Microphone" }).locator(".avail")).toHaveText("1 left");

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
  // Other suites may add items; the meter counts every record.
  const total = Number(/of ([\d,]+) records/.exec((await page.locator("#review-meter").textContent())!)![1]!.replace(/,/g, ""));
  const first = (await page.locator("tbody .row-link").first().textContent())!;
  const second = (await page.locator("tbody .row-link").nth(1).textContent())!;
  await page.locator("tbody .row-link").first().click();
  await page.getByRole("button", { name: "Review details" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Storage location").fill("E2E shelf  A");
  await sheet.getByLabel("Other names").fill("e2e alias, E2E ALIAS");
  await sheet.getByLabel("Borrow or consume").selectOption("Consume (Consumable)");
  // Choosing it lists the item, so staff do not set the audience separately.
  await expect(sheet.getByLabel("Shown to")).toHaveValue("STUDENTS_AND_USC_STAFF");
  await page.getByRole("button", { name: /Mark reviewed & next/ }).click();
  await expect(page.getByText(`${first} reviewed. Opening the next record.`)).toBeVisible();
  await expect(page.getByRole("dialog", { name: second })).toBeVisible();
  await expect(page.locator("#review-meter")).toContainText(`${reviewedBefore + 1} of ${total} records reviewed`);
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
  await expect(sheet.getByLabel("Shown to")).toHaveValue("STUDENTS_AND_USC_STAFF");
  await expect(sheet.getByLabel("Borrow or consume").locator("option")).toHaveText(["Borrow (Loanable)", "Consume (Consumable)"]);
  await sheet.getByLabel("Borrow or consume").selectOption("Borrow (Loanable)");
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

test("activity: one list of who did what, filters kept in the URL, older pages, and no borrower identity in search", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
  // Staff never get account and security entries; that source is not even offered.
  await expect(page.getByRole("button", { name: "Accounts & exports" })).toHaveCount(0);
  await expect(page.locator("#activity-count")).toHaveText("50 entries shown, older ones below");
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.locator("#activity-count")).toHaveText("100 entries shown, older ones below");
  await expect(page.getByRole("button", { name: "Load older" })).toBeFocused();

  // The lending test's damaged return shows with its typed note, and its USC reason is searchable.
  const search = page.getByRole("searchbox", { name: "Search activity" });
  await search.fill("blade bent");
  await expect(page).toHaveURL(/q=blade\+bent/);
  await expect(page.locator(".activity-row")).toHaveCount(1);
  await expect(page.locator(".activity-row")).toContainText("closed a loan of Scissors as damaged");
  await expect(page.locator(".activity-row")).toContainText("Note: One blade bent");
  await search.fill("Banner cutting");
  await expect(page.locator(".activity-row").first()).toContainText("lent 1 piece of Scissors for USC use");
  // The structured borrower name and student ID are never searched.
  for (const identity of ["Test Borrower One", "TEST-0001"]) {
    await search.fill(identity);
    await expect(page.getByRole("heading", { name: "Nothing matches" })).toBeVisible();
  }

  await search.fill("");
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.locator(".activity-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Loans", exact: true }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByLabel("Type").selectOption("LOAN_OUT");
  await sheet.getByRole("button", { name: "Show results" }).click();
  await expect(page).toHaveURL(/source=LOAN&type=LOAN_OUT/);
  // Every entry is a loan going out (phones lend too); the two Scissors loans are among them.
  const lent = async () => {
    await expect(page.locator(".activity-row", { hasText: "lent 1 piece of Scissors for USC use" })).toHaveCount(1);
    await expect(page.locator(".activity-row", { hasText: "lent 2 pieces of Scissors to an individual" })).toHaveCount(1);
    await expect(page.locator(".activity-row").filter({ hasNotText: / lent \d+ \S+ of / })).toHaveCount(0);
  };
  await lent();
  await expect(page.getByRole("button", { name: "Remove filter: Type: Lent" })).toBeVisible();
  // A shared link restores the same question.
  await page.reload();
  await lent();
  await page.getByRole("button", { name: "Remove filter: Type: Lent" }).click();
  await expect(page).toHaveURL(/\/staff\/activity\?source=LOAN$/);

  // An entry opens its item; the item's history leads back to its activity.
  await page.locator(".activity-row__summary").first().click();
  await expect(page.getByRole("dialog", { name: "Scissors" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByRole("link", { name: /All activity for this item/ }).click();
  await expect(page).toHaveURL(/item=ITM-0262/);
  await expect(page.getByRole("button", { name: "Remove filter: Item: Scissors" })).toBeVisible();

  for (const width of [320, 375, 390, 768, 1024, 1366, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `activity at ${width}`).toBeTruthy();
    // The root clips sideways overflow, so also check that the bar's account and sign out stay on screen.
    expect(await page.evaluate(() => document.querySelector(".app-bar__end")!.getBoundingClientRect().right <= window.innerWidth), `app bar at ${width}`).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("dialog", { name: "Filters" }).getByLabel("Type")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeHidden();
});

test("activity export: the filtered list as a safe CSV file, audited for the owner to see", async ({ page, browser, baseURL }) => {
  await signIn(page);
  await page.goto("/staff/activity?q=blade+bent");
  await expect(page.locator(".activity-row")).toHaveCount(1);
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  expect(file.suggestedFilename()).toMatch(/^logistics-activity-\d{8}-\d{4}\.csv$/);
  const bytes = await (await import("node:fs/promises")).readFile((await file.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString("utf8").slice(1);
  const lines = text.split("\r\n");
  expect(lines[0]).toBe('"Time (Manila)","Activity","Description","Actor","Source","Item ID","Item","Unit","Change","Before","After","Reason","Note","Reference","Entry ID"');
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain('"Returned damaged","E2E Staff closed a loan of Scissors as damaged; nothing went back to stock.","E2E Staff","Loans","ITM-0262","Scissors"');
  // The page shows the typed damage note; the file leaves it blank (owner decision B(ii)), and never holds the borrower.
  for (const secret of ["One blade bent", "Test Borrower One", "TEST-0001"]) expect(text).not.toContain(secret);
  await expect(page.getByText("Exported 1 entry.")).toBeVisible();

  const owner = await (await browser.newContext()).newPage();
  // The owner administration tests above replace the owner's password with a recovery key; either one may be current.
  let signedIn = false;
  for (const password of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
    signedIn ||= (await owner.request.post("/api/staff/login", { headers: { origin: baseURL! }, data: { username: process.env.E2E_OWNER_USERNAME, password } })).ok();
  }
  expect(signedIn).toBe(true);
  await owner.goto("/staff/activity");
  await owner.getByRole("button", { name: "Accounts & exports" }).click();
  await expect(owner.locator(".activity-row", { hasText: "E2E Staff exported 1 activity entry to a file, filtered by search." })).toHaveCount(1);
  await expect(owner.locator("#activity-results")).not.toContainText("blade");
  // The owner's bar has the most sections (Administration too); it still fits from phone to desktop.
  for (const width of [320, 390, 768, 1024, 1180, 1281, 1366]) {
    await owner.setViewportSize({ width, height: 800 });
    expect(await owner.evaluate(() => document.querySelector(".app-bar__end")!.getBoundingClientRect().right <= window.innerWidth), `owner app bar at ${width}`).toBeTruthy();
  }
});

test("open units: opt in, open, use, mark low, open another, mark empty, close by a count, and read it all in History and Activity", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New item" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill("E2E Copy Paper");
  await sheet.getByLabel("Category", { exact: true }).fill("school supplies");
  await sheet.getByLabel("Unit", { exact: true }).fill("ream");
  await expect(sheet.getByLabel("How is this item normally used?")).toBeHidden();
  await sheet.getByLabel("Borrow or consume").selectOption("Consume (Consumable)");
  await sheet.getByLabel("Shown to").selectOption("NOT_AVAILABLE_FOR_LENDING");
  // Every item starts as Whole unit; staff opt in.
  await expect(sheet.getByLabel("How is this item normally used?")).toHaveValue("WHOLE_UNIT");
  await sheet.getByLabel("How is this item normally used?").selectOption("OPEN_UNIT");
  await sheet.getByLabel("Opening quantity").fill("8");
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("8");

  const units = sheet.locator("#open-units");
  await expect(units).toContainText("8 reams on hand · 8 sealed · 0 open");
  await units.getByRole("button", { name: "Open a ream" }).click();
  await expect(page.getByText("E2E Copy Paper: ream opened. Stock unchanged.")).toBeVisible();
  await expect(units).toContainText("7 sealed · 1 open");
  await units.getByRole("button", { name: "Record use" }).click();
  await expect(page.getByText("Use recorded for E2E Copy Paper. Stock unchanged.")).toBeVisible();
  await units.getByRole("button", { name: "Low", exact: true }).click();
  await expect(units.getByRole("button", { name: "Low", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.locator("#quantity-context")).toContainText("7 sealed · 1 open · Low");
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("8");

  // Changing how it is used is refused while a unit is open.
  await page.getByRole("tab", { name: "Edit details" }).click();
  await sheet.getByLabel("How is this item normally used?").selectOption("WHOLE_UNIT");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet.locator("#details-alert")).toContainText("This item has open units");
  await sheet.getByLabel("How is this item normally used?").selectOption("OPEN_UNIT");
  await page.getByRole("tab", { name: "Overview" }).click();

  // A second unit is allowed, after a warning.
  await units.getByRole("button", { name: "Open another ream" }).click();
  await expect(units).toContainText("1 ream is already open. Use the existing ream when possible.");
  await units.getByRole("button", { name: "Open another", exact: true }).click();
  await expect(units).toContainText("6 sealed · 2 open");

  // Mark empty: an inline confirmation, then exactly one ream off.
  await units.locator(".open-unit").first().getByRole("button", { name: "Mark empty" }).click();
  await expect(units.locator(".inline-confirm")).toContainText("This will reduce on-hand stock from 8 to 7 reams.");
  await expect(units.locator(".inline-confirm").getByRole("button", { name: "Mark empty" })).toBeFocused();
  await units.locator(".inline-confirm").getByRole("button", { name: "Mark empty" }).click();
  await expect(page.getByText("Marked empty. 7 reams on hand.")).toBeVisible();
  await expect(page.getByLabel("Quantity on hand")).toHaveValue("7");
  await expect(units).toContainText("6 sealed · 1 open");

  // A count below the open units must close them in the same save.
  await page.getByLabel("Quantity on hand").fill("0");
  await sheet.getByRole("radio", { name: "Physical count" }).check();
  await sheet.getByRole("button", { name: "Save count of 0" }).click();
  await expect(sheet.locator("#stock-form").getByRole("alert")).toContainText("Tick the box");
  await sheet.getByLabel(/Also close 1 open ream/).check();
  await sheet.getByRole("button", { name: "Save count of 0" }).click();
  await expect(page.getByText("E2E Copy Paper: 7 → 0 reams (physical count).")).toBeVisible();
  await expect(units).toContainText("0 reams on hand · 0 sealed · 0 open");
  await expect(units.getByRole("button", { name: "Open a ream" })).toBeDisabled();

  await page.getByRole("tab", { name: "History" }).click();
  const history = sheet.locator("#history");
  for (const line of ["Count closed 1 open unit", "Open unit marked empty", "Another unit opened (1 already open)", "Open unit marked low", "Use recorded", "Unit opened"]) {
    await expect(history).toContainText(line);
  }
  const id = (await page.locator(".sheet__kicker .mono").textContent())!;
  await page.goto(`/staff/activity?item=${id}`);
  const rows = page.locator(".activity-row");
  await expect(rows).toHaveCount(9);
  await expect(rows.nth(1)).toContainText("E2E Staff's count closed 1 open ream of E2E Copy Paper no longer on the shelf.");
  await expect(rows.nth(2)).toContainText("E2E Staff marked an open ream of E2E Copy Paper empty: 7 reams on hand.");
  await expect(rows.nth(2)).toContainText("8 → 7 reams");
  // Opening, using and marking a condition are recorded and change nothing.
  for (const index of [3, 4, 5, 6]) await expect(rows.nth(index)).toContainText("stock did not change");

  // One-hand phone width: nothing scrolls sideways in the open sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/staff/inventory?item=${id}`);
  await expect(sheet.locator("#open-units")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("open units: the review view suggests whole-unit Consumables by their unit word and changes nothing", async ({ page }) => {
  await signIn(page);
  await page.goto("/staff/inventory?view=gradual");
  await expect(page.getByRole("button", { name: /^Used gradually\?/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Nothing changes here", { exact: false })).toBeVisible();
  const units = await page.locator("tbody .qty-unit").allTextContents();
  expect(units.length).toBeGreaterThan(0);
  for (const unit of units) expect(unit).toMatch(/^(reams?|box(es)?|bottles?|jars?|rolls?|packs?|cans?|tubs?|pouch(es)?|containers?)$/);
  // Already opened and used gradually (the test above), so not suggested again.
  await expect(page.locator("tbody")).not.toContainText("E2E Copy Paper");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
