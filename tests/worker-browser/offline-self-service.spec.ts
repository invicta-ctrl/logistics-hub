import { expect, test, devices, type Browser, type Page } from "@playwright/test";
import { attachPhoto, identify } from "../self-service-browser";
import { selfServiceReference } from "../../src/catalog-policy";

/*
 * Part 4.5 end to end, on the real Worker + D1 and the production build (service worker on):
 * a phone opens Self-Service online, goes offline, records a take, a borrow with a photo and a
 * return across a reload, then syncs exactly once when the network is back. Two more phones
 * show that every offline take counts, whatever order they sync in.
 */

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;
const WATER = "ITM-0043";
const COTTON = "ITM-0063";
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? "8792"}`;

type Item = { name: string; aliases: string | null; category: string; itemType: string; unit: string; status: string; locationId: string | null;
  reorderThreshold: number; lendingAudience: string; needsReview: boolean; notes: string | null; onHand: number; updatedAt: string | null };

let staff: Page;
let original: Record<string, Item> = {};
/** An open-unit item this suite creates; it is made inactive again afterwards. */
let paper: string | null = null;

async function signIn(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await page.goto("/staff/items");
  await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
  return page;
}

const item = async (id: string) => (await (await staff.request.get(`/api/staff/items/${id}`)).json() as { item: Item }).item;

async function setItem(id: string, changes: Partial<Item>): Promise<void> {
  const current = await item(id);
  const { name, aliases, category, itemType, unit, status, locationId, reorderThreshold, lendingAudience, needsReview, notes } = current;
  const response = await staff.request.patch(`/api/staff/items/${id}`, {
    data: { name, aliases, category, itemType, unit, status, locationId, reorderThreshold, lendingAudience, needsReview, notes, ...changes, updatedAt: current.updatedAt },
    headers: { origin: BASE }
  });
  expect(response.status()).toBe(200);
}

/** A phone is its own browser context: its own IndexedDB, caches and service worker. */
async function phone(browser: Browser) {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
  const page = await context.newPage();
  await page.goto("/self-service");
  // Exact: "Getting ready for offline use…" must not count.
  await expect(page.getByText("Ready for offline use", { exact: true })).toBeVisible({ timeout: 30_000 });
  return { context, page };
}

/** What the phone's own storage holds, straight from IndexedDB. */
async function localState(page: Page) {
  return page.evaluate(() => new Promise<{ states: string[]; photos: number }>((resolve, reject) => {
    const request = indexedDB.open("logistics-hub");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(["events", "photos"]);
      const events = transaction.objectStore("events").getAll();
      const photos = transaction.objectStore("photos").count();
      transaction.oncomplete = () => resolve({ states: (events.result as Array<{ seq: number; state: string }>).sort((a, b) => a.seq - b.seq).map((event) => event.state), photos: photos.result });
    };
  }));
}

/** As if the server's answers had been lost on the way back: every record waits to be sent again. */
async function forgetAnswers(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("logistics-hub");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("events", "readwrite");
      const events = transaction.objectStore("events");
      const all = events.getAll();
      all.onsuccess = () => { for (const event of all.result) events.put({ ...event, state: "pending", attempts: 0, nextAttemptAt: 0 }); };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
  }));
}

/** From home: search for the item, open its page, and start its one action. Works from the phone's own catalog, so it works offline. */
async function openItem(page: Page, name: string, action: "Take" | "Borrow" | "Use"): Promise<void> {
  await page.getByRole("searchbox", { name: "Search everything" }).fill(name);
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await page.getByRole("link", { name: action, exact: true }).click();
}

/** A remembered person shows as a card; the fields are one tap away. Everyone gives a full name, an 8-digit ID and a photo. */
async function asSomeone(page: Page, person: string): Promise<void> {
  const change = page.getByRole("button", { name: "Not you? Change" });
  if (await change.isVisible()) await change.click();
  await identify(page, person);
}

async function take(page: Page, name: string, count: number, person: string): Promise<void> {
  await openItem(page, name, "Take");
  for (let step = 1; step < count; step += 1) await page.getByRole("button", { name: "One more" }).click();
  await asSomeone(page, person);
  await page.getByRole("button", { name: "Review and take" }).click();
  await page.getByRole("button", { name: "Confirm take" }).click();
  // Offline it is "saved"; online it becomes "Taken" once Logistics has it. Either way the receipt is up.
  await expect(page.locator(".ss-receipt")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
}

test.describe.serial("offline self-service", () => {
  test.beforeAll(async ({ browser }) => {
    staff = await signIn(browser);
    original = { [WATER]: await item(WATER), [COTTON]: await item(COTTON) };
    await setItem(WATER, { itemType: "Consumable", status: "ACTIVE", needsReview: false });
    await setItem(COTTON, { status: "ACTIVE", needsReview: false, lendingAudience: "STUDENTS_AND_USC_STAFF" });
  });

  test.afterAll(async () => {
    // Leave the migrated catalog as other tests expect it: nothing public or offered.
    for (const [id, before] of Object.entries(original)) {
      await setItem(id, { itemType: before.itemType, status: before.status, needsReview: true, lendingAudience: before.lendingAudience });
    }
    if (paper) await setItem(paper, { status: "INACTIVE" });
    await staff.close();
  });

  test("is an installable app with an offline shell, and never caches the API", async ({ request }) => {
    expect(await (await request.get("/self-service")).text()).toContain('rel="manifest" href="/manifest.webmanifest"');
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
    // Its own path (V1.6): the staff Catalog app is scoped to /staff beside it, and two apps on one site must not overlap.
    expect(await manifest.json()).toMatchObject({ id: "/self-service", name: "Logistics Hub", start_url: "/self-service", display: "standalone", scope: "/self-service" });
    const worker = await request.get("/sw.js");
    expect(worker.headers()["cache-control"]).toBe("no-cache");
    expect(await worker.text()).toContain("logistics-shell-");
    const catalog = await request.get("/api/self-service/catalog");
    expect(catalog.headers()["cache-control"]).toBe("no-store");
    const body = await catalog.json() as { items: Array<Record<string, unknown>> };
    // Offered by type alone: a reviewed Consumable is taken, a listed Loanable borrowed.
    expect(body.items.find((entry) => entry.id === WATER)).toMatchObject({ action: "TAKE" });
    expect(body.items.find((entry) => entry.id === COTTON)).toMatchObject({ action: "BORROW" });
    expect(body.items.every((entry) => entry.action === "TAKE" || entry.action === "BORROW")).toBe(true);
    expect(Object.keys(body.items[0]!).sort()).toEqual(["action", "aliases", "area", "audience", "available", "category", "iconKey", "id", "location", "locationId", "name", "photo", "unit"]);
  });

  test("public pages load fresh from the network, while Self-Service opens from the phone's cache", async ({ browser }) => {
    const { context, page } = await phone(browser);
    const fromNetwork: string[] = [];
    context.on("request", (request) => { if (request.serviceWorker()) fromNetwork.push(new URL(request.url()).pathname); });
    await page.goto("/");
    await page.goto("/lending");
    await page.goto("/self-service");
    expect(fromNetwork.filter((path) => ["/", "/lending", "/self-service"].includes(path))).toEqual(["/", "/lending"]);
    await context.close();
  });

  test("works offline: take, borrow with a photo, reload, return; syncs exactly once when back online", async ({ browser }) => {
    const waterBefore = (await item(WATER)).onHand;
    const cottonBefore = (await item(COTTON)).onHand;
    const { context, page } = await phone(browser);

    await context.setOffline(true);
    await take(page, "Bottled Water", 2, "Juan Dela Cruz");
    await expect(page.getByRole("link", { name: /Offline · 1 waiting/ })).toBeVisible();

    await openItem(page, "Cotton - roll", "Borrow");
    // The phone remembered who took the water, so the borrow only asks for its photo.
    await expect(page.locator(".ss-who")).toContainText("Juan Dela Cruz");
    await expect(page.locator(".ss-who")).toContainText("ID 21000115");
    await attachPhoto(page);
    await page.getByRole("button", { name: "Review and borrow" }).click();
    await expect(page.locator(".ss-summary")).toContainText("21000115");
    await expect(page.locator(".ss-summary img")).toBeVisible();
    await page.getByRole("button", { name: "Confirm borrow" }).click();
    await expect(page.getByText("Saved on this phone. It will send when you're back online.")).toBeVisible();
    await expect(page.locator(".ss-receipt__ref strong")).toHaveText(/^SS-/);
    await page.getByRole("button", { name: "Done" }).click();

    // The app opens from its own cache without a network, with everything still waiting.
    await page.reload();
    await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Offline · 2 waiting/ })).toBeVisible();
    expect(await localState(page)).toEqual({ states: ["pending", "pending"], photos: 2 });

    await page.getByRole("link", { name: /^Return/ }).click();
    await page.getByRole("link", { name: /Cotton - roll/ }).first().click();
    await page.getByRole("button", { name: "Review and return" }).click();
    await expect(page.getByText("Take a photo of the item you are returning.")).toBeVisible();
    await attachPhoto(page);
    await page.getByRole("button", { name: "Review and return" }).click();
    await page.getByRole("button", { name: "Confirm return" }).click();
    // Offline, nothing has been sent: the receipt says the return is saved on the phone.
    await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    expect((await localState(page)).states).toEqual(["pending", "pending", "pending"]);
    expect((await item(WATER)).onHand).toBe(waterBefore);
    // Staff tools are never saved on a phone: offline they say so instead of showing a blank page.
    await page.goto("/staff");
    await expect(page.getByRole("heading", { name: "This page needs a connection" })).toBeVisible();
    await page.getByRole("link", { name: "Open Self-Service" }).click();
    await expect(page.getByRole("link", { name: /Offline · 3 waiting/ })).toBeVisible();

    // Cache deletion leaves saved actions intact; fresh offline navigation needs the cached shell.
    await page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
    expect(await localState(page)).toEqual({ states: ["pending", "pending", "pending"], photos: 3 });

    await context.setOffline(false);
    // The take and the borrow apply; the return (with its photo) waits for DoL staff.
    await expect(page.getByRole("link", { name: /1 needs review/ })).toBeVisible({ timeout: 20_000 });
    expect(await localState(page)).toEqual({ states: ["synced", "synced", "review"], photos: 0 });
    expect((await item(WATER)).onHand).toBe(waterBefore - 2);
    expect((await item(COTTON)).onHand).toBe(cottonBefore - 1);
    const waiting = await (await staff.request.get("/api/staff/loans")).json() as { open: Array<{ itemId: string }> };
    expect(waiting.open.filter((entry) => entry.itemId === COTTON)).toHaveLength(1);

    // Staff look at the photo and confirm it is back: only then does the loan close and stock return.
    await staff.goto("/staff/self-service");
    await expect(staff.getByRole("img", { name: /Photo sent with the return of Cotton - roll/ })).toBeVisible();
    await staff.getByRole("button", { name: /Confirm returned/ }).click();
    await expect(staff.getByText("Confirmed: the loan is closed.")).toBeVisible();
    expect((await item(COTTON)).onHand).toBe(cottonBefore);

    const loans = await (await staff.request.get("/api/staff/loans")).json() as { closed: Array<{ id: string; itemId: string; status: string; createdBy: string; studentId: string }> };
    const loan = loans.closed.find((entry) => entry.itemId === COTTON && entry.createdBy === "Self-Service");
    expect(loan).toMatchObject({ status: "RETURNED", studentId: "21000115" });
    const photo = await staff.request.get(`/api/staff/loans/${loan!.id}/photo`);
    expect(photo.status()).toBe(200);
    expect(photo.headers()["content-type"]).toBe("image/jpeg");
    expect((await page.request.get(`/api/staff/loans/${loan!.id}/photo`)).status()).toBe(401);

    // Sending everything again (the answers were lost) changes nothing: the server is idempotent.
    await forgetAnswers(page);
    await page.reload();
    await expect(page.getByRole("link", { name: /1 needs review/ })).toBeVisible({ timeout: 20_000 });
    expect((await localState(page)).states).toEqual(["synced", "synced", "review"]);
    expect((await item(WATER)).onHand).toBe(waterBefore - 2);
    expect((await item(COTTON)).onHand).toBe(cottonBefore);
    const after = await (await staff.request.get("/api/staff/loans")).json() as { open: Array<{ itemId: string }>; closed: Array<{ itemId: string; createdBy: string }> };
    expect(after.open.filter((entry) => entry.itemId === COTTON)).toEqual([]);
    expect(after.closed.filter((entry) => entry.itemId === COTTON && entry.createdBy === "Self-Service")).toHaveLength(1);
    await context.close();
  });

  test("two phones offline: every take counts, whatever order they sync", async ({ browser }) => {
    const before = (await item(WATER)).onHand;
    const [a, b] = [await phone(browser), await phone(browser)];
    await a.context.setOffline(true);
    await b.context.setOffline(true);
    await take(a.page, "Bottled Water", 1, "Ana Reyes");
    await take(b.page, "Bottled Water", 3, "Ben Cruz");
    await b.context.setOffline(false);
    await expect(b.page.getByRole("link", { name: /Synced/ })).toBeVisible({ timeout: 20_000 });
    await a.context.setOffline(false);
    await expect(a.page.getByRole("link", { name: /Synced/ })).toBeVisible({ timeout: 20_000 });
    expect((await item(WATER)).onHand).toBe(before - 4);
    await a.context.close();
    await b.context.close();
  });

  test("an open-unit item is used, never taken: offline, double-tapped and replayed, stock never moves", async ({ browser }) => {
    const created = await staff.request.post("/api/staff/items", { headers: { origin: BASE }, data: {
      name: "E2E Printer Paper", category: "SCHOOL SUPPLIES", itemType: "Consumable", consumptionMode: "OPEN_UNIT", unit: "ream", status: "ACTIVE", locationId: null,
      reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null, openingQuantity: 5
    } });
    expect(created.status()).toBe(201);
    paper = (await created.json() as { id: string }).id;
    const { context, page } = await phone(browser);
    await context.setOffline(true);
    await page.getByRole("searchbox", { name: "Search everything" }).fill("E2E Printer Paper");
    await expect(page.getByRole("link", { name: /E2E Printer Paper/ })).toContainText("Use");
    await openItem(page, "E2E Printer Paper", "Use");
    await expect(page.getByLabel("How many?")).toHaveCount(0);
    await asSomeone(page, "Ana Reyes");
    await page.getByRole("button", { name: "Review and use" }).click();
    await page.getByRole("button", { name: "Confirm use" }).dblclick();
    await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    expect(await localState(page)).toEqual({ states: ["pending"], photos: 1 });

    await context.setOffline(false);
    await expect(page.getByRole("link", { name: /Synced/ })).toBeVisible({ timeout: 20_000 });
    const uses = async () => (await (await staff.request.get(`/api/staff/activity?item=${paper}&type=PHONE_USE`)).json() as { events: Array<{ summary: string; change: number }> }).events;
    expect(await uses()).toEqual([expect.objectContaining({ summary: "A phone use of E2E Printer Paper was recorded; stock did not change.", change: 0 })]);
    // The answer was lost and everything is sent again: still one use, still 5 reams.
    await forgetAnswers(page);
    await page.reload();
    await expect(page.getByRole("link", { name: /Synced/ })).toBeVisible({ timeout: 20_000 });
    expect(await uses()).toHaveLength(1);
    expect((await item(paper)).onHand).toBe(5);
    await context.close();
  });

  test("staff see phone activity and can print the one QR poster", async () => {
    await staff.goto("/staff/self-service?view=activity");
    await expect(staff.getByRole("heading", { name: "Self-Service" })).toBeVisible();
    await expect(staff.locator("#ss-results")).toContainText("Juan Dela Cruz");
    await expect(staff.locator("#ss-results")).toContainText("Cotton - roll");
    // A person reads the reference from their receipt; staff find the record by typing it, in any case and with or without the dash.
    const week = await (await staff.request.get("/api/staff/self-service")).json() as { recent: Array<{ id: string; type: string; itemId: string }> };
    const borrow = week.recent.find((entry) => entry.type === "BORROW" && entry.itemId === COTTON)!;
    const reference = selfServiceReference(borrow.id);
    await staff.getByLabel("Find a record").fill(reference.toLowerCase().replace("-", " "));
    await expect(staff.locator("#ss-results tbody tr")).toHaveCount(1);
    await expect(staff.locator("#ss-results")).toContainText(reference);
    await expect(staff.locator("#ss-results").getByRole("link", { name: /^Photo/ })).toBeVisible();
    await staff.getByLabel("Find a record").fill("");
    await staff.getByRole("button", { name: "QR code & poster" }).click();
    await expect(staff.getByRole("img", { name: "QR code that opens logistics.hausc.org/self-service" })).toBeVisible();
    await expect(staff.getByText("logistics.hausc.org/self-service", { exact: true })).toBeVisible();
  });
});
