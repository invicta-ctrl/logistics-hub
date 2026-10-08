import { expect, test, type Page } from "@playwright/test";

/*
 * V1.15 perceived performance (mobile/perceived-performance amendment): every durable staff write is acknowledged the moment it is
 * pressed and claims success only once the server has committed it. On the real Worker at phone width, the request of each write is
 * held on its way: the control reacts at once, nothing says "saved", "lent" or "closed", and the record on the server is unchanged.
 * When the request is let through, the confirmation appears and the record has changed.
 */

const PHOTO = "public/brand/ydd-2026-banner.jpg";

async function signIn(page: Page) {
  await page.goto("/staff");
  const origin = new URL(page.url()).origin;
  let signedIn = false;
  for (const secret of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
    signedIn ||= (await page.request.post("/api/staff/login", { headers: { origin }, data: { username: process.env.E2E_OWNER_USERNAME, password: secret } })).ok();
  }
  expect(signedIn).toBe(true);
}

async function makeItem(page: Page, baseURL: string, body: Record<string, unknown>) {
  const response = await page.request.post("/api/staff/items", { headers: { origin: baseURL }, data: {
    aliases: "", category: "Miscellaneous", unit: "piece", status: "ACTIVE", locationId: null, reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: "", openingQuantity: 5, ...body
  } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { id: string }).id;
}
const detail = async (page: Page, id: string) => (await (await page.request.get(`/api/staff/items/${id}`)).json()).item as { onHand: number; notes: string | null; status: string };

/** Holds the writes `match` accepts on their way to the server until `release()`; everything else passes. */
async function holdWrites(page: Page, match: (url: URL, method: string) => boolean) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held = 0;
  await page.route("**/api/staff/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET" && match(new URL(request.url()), request.method())) { held += 1; await gate; }
    await route.continue();
  });
  return { release, held: () => held };
}
const noSuccess = async (page: Page) => { await page.waitForTimeout(600); await expect(page.locator("#toasts .toast")).toHaveCount(0); };

test.describe("a durable write is acknowledged at once and confirmed only after the commit", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
  });

  test("stock: adding stock", async ({ page, baseURL }) => {
    const id = await makeItem(page, baseURL!, { name: `Held stock ${Date.now() % 100000}`, itemType: "Consumable" });
    const name = (await (await page.request.get(`/api/staff/items/${id}`)).json()).item.name as string;
    await page.goto("/staff/stock");
    // On a phone the form is in a sheet.
    await page.getByRole("button", { name: "Update stock" }).click();
    const panel = page.getByRole("dialog", { name: "Update stock" });
    await panel.getByLabel("Item", { exact: true }).fill(`${name} · ${id}`);
    await panel.getByLabel("Quantity on hand").fill("+3");
    await panel.getByRole("radio", { name: "New stock received" }).check();
    const hold = await holdWrites(page, (url) => url.pathname.endsWith("/movements"));
    const add = panel.getByRole("button", { name: "Add 3" });
    await add.click();
    await expect(add, "the button reacts at once").toBeDisabled({ timeout: 400 });
    await expect.poll(hold.held).toBe(1);
    await noSuccess(page);
    expect((await detail(page, id)).onHand, "nothing is saved yet").toBe(5);
    hold.release();
    await expect(page.locator("#toasts .toast--ok")).toContainText("5 → 8");
    expect((await detail(page, id)).onHand).toBe(8);
  });

  test("items: saving a change to an item's details", async ({ page, baseURL }) => {
    const id = await makeItem(page, baseURL!, { name: `Held save ${Date.now() % 100000}`, itemType: "Loanable" });
    await page.goto(`/staff/items?item=${id}`);
    await page.getByRole("tab", { name: "Edit details" }).click();
    await page.getByLabel(/^Internal notes/).fill("Kept on the second shelf");
    const hold = await holdWrites(page, (url, method) => url.pathname === `/api/staff/items/${id}` && method !== "GET");
    const save = page.getByRole("button", { name: "Save changes" });
    await save.click();
    await expect(save, "the button reacts at once").toBeDisabled({ timeout: 400 });
    await expect.poll(hold.held).toBe(1);
    await noSuccess(page);
    await expect(page.getByText("Changes saved.")).toHaveCount(0);
    expect((await detail(page, id)).notes ?? "", "nothing is saved yet").not.toContain("second shelf");
    hold.release();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    expect((await detail(page, id)).notes).toContain("second shelf");
  });

  test("loans: lending an item, then taking it back", async ({ page, baseURL }) => {
    const name = `Held loan ${Date.now() % 100000}`;
    const id = await makeItem(page, baseURL!, { name, itemType: "Loanable" });
    await page.goto(`/staff/items?item=${id}`);
    await page.getByRole("tab", { name: "Loan" }).click();
    const form = page.locator("#loan-form");
    await form.getByLabel("Borrower's full name").fill("Held Borrower");
    await form.getByLabel(/Student ID number/).fill("12345678");
    await form.locator("input[type=file]").setInputFiles(PHOTO);
    await expect(form.getByRole("img", { name: "Photo to attach" })).toBeVisible();
    const hold = await holdWrites(page, (url) => url.pathname.endsWith("/loans"));
    // Found by what it is, since its words change to "Saving…" the moment it is pressed.
    const lend = form.locator("button[type=submit]");
    await lend.click();
    await expect(lend, "the button reacts at once").toBeDisabled({ timeout: 400 });
    await expect(lend).toHaveText("Saving…");
    await expect.poll(hold.held).toBe(1);
    await noSuccess(page);
    expect((await detail(page, id)).onHand, "nothing is lent yet").toBe(5);
    hold.release();
    await expect(page.locator("#toasts .toast--ok")).toContainText(`Lent 1 piece of ${name} to Held Borrower.`);
    expect((await detail(page, id)).onHand).toBe(4);

    // Taking it back is held in the same way.
    await page.goto("/staff/loans");
    const row = page.locator(".loan-row", { hasText: "Held Borrower" });
    await row.getByRole("button", { name: "Return" }).click();
    const dialog = page.getByRole("dialog", { name });
    const giveBack = await holdWrites(page, (url) => url.pathname.endsWith("/return"));
    const done = dialog.locator("button[type=submit]");
    await done.click();
    await expect(done, "the button reacts at once").toBeDisabled({ timeout: 400 });
    await expect.poll(giveBack.held).toBe(1);
    await noSuccess(page);
    expect((await detail(page, id)).onHand, "nothing is back yet").toBe(4);
    giveBack.release();
    await expect(page.locator("#toasts .toast--ok")).toContainText(`${name} returned by Held Borrower.`);
    expect((await detail(page, id)).onHand).toBe(5);
  });

  test("accounts: creating a staff account shows no password until it exists", async ({ page }) => {
    const user = `held${Date.now() % 100000}`;
    await page.goto("/staff/admin/staff");
    await page.getByRole("button", { name: "New account" }).click();
    await page.getByLabel("Display name").fill("Held Person");
    await page.getByLabel("Username").fill(user);
    const hold = await holdWrites(page, (url, method) => url.pathname === "/api/staff/admin/accounts" && method === "POST");
    const create = page.getByRole("button", { name: "Create account" });
    await create.click();
    await expect(create, "the button reacts at once").toBeDisabled({ timeout: 400 });
    await expect.poll(hold.held).toBe(1);
    await page.waitForTimeout(600);
    await expect(page.locator(".secret code"), "no password is shown for an account that does not exist yet").toHaveCount(0);
    const listed = async () => ((await (await page.request.get("/api/staff/admin/accounts")).json()).accounts as { username: string }[]).some((account) => account.username === user);
    expect(await listed(), "the account does not exist yet").toBe(false);
    hold.release();
    await expect(page.locator(".secret code")).toBeVisible();
    expect(await listed()).toBe(true);
  });

  test("people: adding someone to the Staff Directory", async ({ page }) => {
    const name = `Held Person ${Date.now() % 100000}`;
    const listed = async () => ((await (await page.request.get("/api/staff/admin/directory")).json()).people as { name: string }[]).some((person) => person.name === name);
    await page.goto("/staff/admin/directory");
    await page.getByRole("button", { name: "Add person" }).first().click();
    await page.getByLabel("Full name").fill(name);
    await page.getByRole("combobox", { name: "Department", exact: true }).selectOption("DoL");
    const hold = await holdWrites(page, (url, method) => url.pathname === "/api/staff/admin/directory" && method === "POST");
    const add = page.getByRole("button", { name: "Add person" }).last();
    await add.click();
    await expect(add, "the button reacts at once").toBeDisabled({ timeout: 400 });
    await expect.poll(hold.held).toBe(1);
    await noSuccess(page);
    expect(await listed(), "the person is not in the directory yet").toBe(false);
    hold.release();
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    expect(await listed()).toBe(true);
  });

  test("settings: closing Self-Service says closed only once it is", async ({ page, baseURL }) => {
    const state = async () => (await (await page.request.get("/api/staff/session")).json()).selfServiceClosed as boolean;
    try {
      await page.goto("/staff/admin/self-service");
      await page.getByRole("button", { name: "Close for maintenance" }).click();
      const hold = await holdWrites(page, (url, method) => url.pathname === "/api/staff/admin/self-service" && method === "PATCH");
      const confirm = page.getByRole("dialog", { name: "Close Self-Service for maintenance?" }).getByRole("button", { name: "Close for maintenance" });
      await confirm.click();
      // The dialog is gone, so the page's own button shows that the change is under way.
      await expect(page.locator("#ss-toggle"), "the switch reacts at once").toBeDisabled({ timeout: 400 });
      await expect(page.locator("#ss-toggle")).toHaveAttribute("aria-busy", "true");
      await expect.poll(hold.held).toBe(1);
      await noSuccess(page);
      expect(await state(), "Self-Service is still open").toBe(false);
      hold.release();
      await expect(page.locator("#toasts .toast--ok")).toContainText("Self-Service is closed for maintenance.");
      expect(await state()).toBe(true);
    } finally {
      await page.unroute("**/api/staff/**");
      await page.request.patch("/api/staff/admin/self-service", { headers: { origin: baseURL! }, data: { state: "open" } });
    }
  });
});
