import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { attachPhoto, identify } from "../self-service-browser";

/*
 * V1.15 (V2 consolidation) journeys across surfaces, on the real Worker + D1 and the production build. Each V1.x suite
 * proves its own slice; these follow one person's task from one part of the Hub into the next:
 *   a first-time borrower on a phone borrows online, comes back later and returns; the return waits for staff;
 *   staff find it from Home through Attention, settle it in Self-Service, and find the item again with search;
 *   the owner reads Administration > System. Every name starts with "E2E V115".
 * The other V2 journeys (offline PWA, a large shelf, a place check, a kit, the Staff Directory) are run by their own
 * suites; docs/road-to-v2/v1.15-consolidation-plan.md maps each journey to the test that proves it.
 */

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;
const ownerUsername = process.env.E2E_OWNER_USERNAME!;
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? "8792"}`;
const PROJECTOR = "E2E V115 Projector";

let staffContext: BrowserContext;
let staff: Page;
let projector = "";

async function signIn(browser: Browser, user: string, secret: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(user);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  return { context, page };
}

const onHand = async () => (await (await staff.request.get(`/api/staff/items/${projector}`)).json() as { item: { onHand: number } }).item.onHand;

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe.serial("V2 journeys", () => {
  test.beforeAll(async ({ browser }) => {
    ({ context: staffContext, page: staff } = await signIn(browser, username, password));
    const created = await staff.request.post("/api/staff/items", {
      headers: { origin: BASE },
      data: { name: PROJECTOR, category: "E2E V115 EQUIPMENT", itemType: "Loanable", unit: "piece", status: "ACTIVE", reorderThreshold: 0,
        lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: null, openingQuantity: 2 }
    });
    expect(created.status()).toBe(201);
    projector = (await created.json() as { id: string }).id;
  });

  test.afterAll(async () => staffContext.close());

  test("a first-time borrower borrows online, comes back, and returns; staff settle it from Home through Attention", async ({ browser }) => {
    const phone = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
    const page = await phone.newPage();

    // First time: nothing is remembered, the home leads with search, and the item's page offers its one action.
    await page.goto("/self-service");
    await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
    expect(await noSideways(page)).toBe(0);
    await page.getByRole("searchbox", { name: "Search everything" }).fill(PROJECTOR);
    await page.getByRole("link", { name: new RegExp(PROJECTOR) }).first().click();
    await page.getByRole("link", { name: "Borrow", exact: true }).click();
    await identify(page, "Maria Santos", "21000115");
    await page.getByRole("button", { name: "Review and borrow" }).click();
    await page.getByRole("button", { name: "Confirm borrow" }).click();
    await expect(page.locator(".ss-receipt__ref strong")).toHaveText(/^SS-/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect.poll(onHand, { timeout: 20_000 }).toBe(1);

    // Returning: a new visit on the same phone remembers the borrower and what they have.
    await page.reload();
    await page.getByRole("link", { name: /^My activity/ }).click();
    await expect(page.getByText(PROJECTOR).first()).toBeVisible();
    await page.goto("/self-service");
    await page.getByRole("link", { name: /^Return/ }).click();
    await page.getByRole("link", { name: new RegExp(PROJECTOR) }).first().click();
    await attachPhoto(page);
    await page.getByRole("button", { name: "Review and return" }).click();
    await page.getByRole("button", { name: "Confirm return" }).click();
    await expect(page.getByRole("heading", { name: "Return sent" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    // A return with a photo waits for a person: stock stays out until staff confirm.
    await expect(page.getByRole("link", { name: /1 needs review/ })).toBeVisible({ timeout: 20_000 });
    expect(await onHand()).toBe(1);

    // Staff: Home says something needs attention; Attention names the phone return and leads to where it is settled.
    await staff.goto("/staff/home");
    await expect(staff.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await staff.getByRole("link", { name: "Open Attention" }).click();
    await expect(staff).toHaveURL(/\/staff\/attention/);
    const entry = staff.locator("li, article").filter({ hasText: `Phone return of ${PROJECTOR}` }).first();
    await expect(entry).toBeVisible();
    await entry.getByRole("link", { name: "Check the record" }).click();
    await expect(staff).toHaveURL(/\/staff\/self-service/);
    await expect(staff.getByRole("img", { name: new RegExp(`Photo sent with the return of ${PROJECTOR}`) })).toBeVisible();
    await staff.getByRole("button", { name: /Confirm returned/ }).first().click();
    await expect(staff.getByText("Confirmed: the loan is closed.")).toBeVisible();
    expect(await onHand()).toBe(2);

    // Settled: Attention no longer lists it, and the phone hears the decision.
    await staff.goto("/staff/attention");
    await expect(staff.getByText(`Phone return of ${PROJECTOR}`)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("link", { name: /1 needs review/ })).toHaveCount(0, { timeout: 20_000 });
    await phone.close();
  });

  test("search finds the item from anywhere, and its record shows the loan that just closed", async () => {
    await staff.goto("/staff/home");
    await expect(staff.getByRole("heading", { name: "Home" })).toBeVisible();
    await staff.keyboard.press("Control+k");
    const box = staff.getByRole("combobox", { name: /Search/ });
    await expect(box).toBeFocused();
    await box.fill("V115 projector");
    await expect(staff.getByRole("option", { name: new RegExp(PROJECTOR) }).first()).toBeVisible();
    await staff.keyboard.press("Enter");
    await expect(staff).toHaveURL(new RegExp(`item=${projector}`));
    await expect(staff.getByRole("dialog", { name: PROJECTOR })).toBeVisible();
    const { closed } = await (await staff.request.get("/api/staff/loans")).json() as { closed: Array<{ itemId: string; status: string; createdBy: string }> };
    expect(closed.filter((loan) => loan.itemId === projector)).toEqual([expect.objectContaining({ status: "RETURNED", createdBy: "Self-Service" })]);
  });

  test("a record an older phone saved without an ID is asked about in Attention, and staff confirm it there", async ({ browser }) => {
    // The borrow above was the first record saved under the identity rule. A phone still holding the older kind arrives afterwards.
    const created = await staff.request.post("/api/staff/items", {
      headers: { origin: BASE },
      data: { name: "E2E V115 Markers", category: "E2E V115 SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", reorderThreshold: 0,
        lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null, openingQuantity: 5 }
    });
    expect(created.status()).toBe(201);
    const itemId = (await created.json() as { id: string }).id;
    const now = new Date().toISOString();
    const old = await browser.newContext({ baseURL: BASE });
    const sent = await old.request.post("/api/self-service/sync", {
      headers: { origin: BASE },
      multipart: { batch: JSON.stringify({ deviceId: crypto.randomUUID(), sentAt: now, events: [{ v: 1, id: crypto.randomUUID(), seq: 1, type: "TAKE", itemId, quantity: 1, occurredAt: now, catalogRevision: 1, person: { name: "Juan" } }] }) }
    });
    expect(sent.status()).toBe(200);
    expect(((await sent.json()) as { results: Array<{ outcome: string }> }).results.map((result) => result.outcome)).toEqual(["accepted"]);
    await old.close();

    await staff.goto("/staff/attention?reason=IDENTITY_REVIEW");
    const entry = staff.locator("li").filter({ hasText: "Phone take of E2E V115 Markers" });
    await expect(entry).toContainText("Juan gave no student ID number.");
    await entry.getByRole("button", { name: "Confirm identity" }).click();
    await expect(staff.getByText("Identity confirmed.")).toBeVisible();
    await expect(entry).toHaveCount(0);
    // Decided once: the record keeps what the phone sent, and Attention does not ask again after a reload.
    await staff.reload();
    await expect(staff.locator("li").filter({ hasText: "Phone take of E2E V115 Markers" })).toHaveCount(0);
  });

  test("the owner reads Administration > System: everything answers and the migration level is shown", async ({ browser }) => {
    const ownerPassword = process.env.E2E_OWNER_PASSWORD!;
    // worker-live may have replaced the owner's password earlier in the same run.
    let owner: { context: BrowserContext; page: Page };
    try {
      owner = await signIn(browser, ownerUsername, ownerPassword);
    } catch {
      owner = await signIn(browser, ownerUsername, "recovered owner pass");
    }
    const { page } = owner;
    await page.goto("/staff/admin");
    await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "System" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Right now" })).toBeVisible();
    await expect(page.locator("#system-summary")).toBeVisible();
    await expect(page.getByRole("heading", { name: "This version" })).toBeVisible();
    await expect(page.getByText(/0030_item_relationships/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Backups and restore" })).toBeVisible();
    // Staff accounts cannot open it: the Worker sends them back to their own pages.
    await staff.goto("/staff/admin");
    await expect(staff).not.toHaveURL(/\/staff\/admin/);
    await owner.context.close();
  });
});
