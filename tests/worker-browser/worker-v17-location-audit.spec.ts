import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";

/*
 * V1.7 against a real Worker, D1 and the production build (service worker on). A phone checks a shelf: Here, a different count, not
 * found; pauses and resumes; carries on offline (and finds something recorded elsewhere, and something not in the catalog); sends it all
 * once on reconnecting, also when every answer is lost. Nothing seen changes stock. Someone moves stock after a count; the review refuses
 * the stale count, posts a fresh one through the ledger and moves what was found here. Every name starts with "E2E V17".
 */

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? "8792"}`;

type Detail = { audit: { id: string; status: string }; items: Array<{ id: string; name: string; observation: { outcome: string } | null }>; extras: Array<{ outcome: string; name: string | null }>; checked: number };
type Movement = { movementType: string; signedQuantity: number; notes: string | null };

let context: BrowserContext;
let page: Page;
let shelf = "";
const ids: Record<string, string> = {};

async function phone(browser: Browser) {
  const made = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
  return { context: made, page: await made.newPage() };
}

const api = (target: Page) => ({
  get: async <T>(path: string) => (await (await target.request.get(path)).json()) as T,
  post: async <T>(path: string, data: unknown) => (await (await target.request.post(path, { headers: { origin: BASE }, data })).json()) as T
});
const onHand = async (target: Page, id: string) => ((await api(target).get<{ item: { onHand: number } }>(`/api/staff/items/${id}`)).item.onHand);
const movements = async (target: Page, id: string) => (await api(target).get<{ movements: Movement[] }>(`/api/staff/items/${id}`)).movements;
const held = (from: Page) => from.evaluate(() => new Promise<number>((resolve, reject) => {
  const request = indexedDB.open("logistics-hub-catalogue");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const all = request.result.transaction("observations").objectStore("observations").count();
    all.onsuccess = () => resolve(all.result);
    all.onerror = () => reject(all.error);
  };
}));
const row = (target: Page, name: string) => target.locator(".ck-row", { hasText: name });
const checkId = (target: Page) => new URL(target.url()).searchParams.get("audit")!;

test.describe.serial("checking a place", () => {
  test.beforeAll(async ({ browser }) => {
    ({ context, page } = await phone(browser));
    await page.goto(`/staff?next=${encodeURIComponent("/staff/catalogue")}`);
    await page.getByRole("textbox", { name: "Username" }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Add items", level: 1 })).toBeVisible();
    const { post } = api(page);
    const room = (await post<{ id: string }>("/api/staff/locations", { name: "E2E V17 Store", parentId: null })).id;
    shelf = (await post<{ id: string }>("/api/staff/locations", { name: "E2E V17 Shelf", parentId: room, directions: "Second shelf from the door." })).id;
    const cabinet = (await post<{ id: string }>("/api/staff/locations", { name: "E2E V17 Cabinet", parentId: room })).id;
    const base = { category: "E2E V17 SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
    for (const [name, quantity] of [["E2E V17 Tape", 6], ["E2E V17 Glue", 3], ["E2E V17 Cord", 2], ["E2E V17 Pens", 10], ["E2E V17 Ties", 4]] as const) {
      ids[name] = (await post<{ id: string }>("/api/staff/items", { ...base, name, locationId: shelf, openingQuantity: quantity })).id;
    }
    ids["E2E V17 Reel"] = (await post<{ id: string }>("/api/staff/items", { ...base, name: "E2E V17 Reel", locationId: cabinet, openingQuantity: 1 })).id;
  });
  test.afterAll(async () => { await context.close(); });

  test("a check runs online, paused and offline alike, and nothing seen changes stock until the review", async () => {
    const before = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([name, id]) => [name, [await onHand(page, id), (await movements(page, id)).length]])));
    await page.goto("/staff/catalogue");
    await page.getByRole("button", { name: "Turn on offline cataloguing" }).click();
    await expect(page.locator(".cat-ready--ok")).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Place to check").selectOption(shelf);
    await page.getByRole("button", { name: /Start checking/ }).click();
    await expect(page.locator(".ck-progress__count")).toContainText("0 / 5 checked");
    await row(page, "E2E V17 Tape").getByRole("button", { name: /^Here/ }).click();
    await row(page, "E2E V17 Glue").getByRole("button", { name: /^Count differs/ }).click();
    await page.locator(`#ck-count-${ids["E2E V17 Glue"]}`).fill("2");
    await page.getByRole("button", { name: "Save count" }).click();
    await row(page, "E2E V17 Cord").getByRole("button", { name: /^Can.t find/ }).click();
    await expect(page.locator(".ck-progress__count")).toContainText("3 / 5 checked");
    // Paused, then resumed from the Catalog's home.
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.locator(".ck-mine__row")).toContainText("Paused");
    await page.locator(".ck-mine__row").click();
    await expect(page.locator(".ck-progress__count")).toContainText("3 / 5 checked");
    const id = checkId(page);

    // Offline: the check reopens from the device, and keeps what is marked there.
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator(".ck-note", { hasText: "Offline." })).toBeVisible();
    await row(page, "E2E V17 Pens").getByRole("button", { name: /^Here/ }).click();
    await page.getByRole("button", { name: /Found something not on the list/ }).click();
    await page.getByLabel("Search the catalog").fill("E2E V17 Reel");
    await page.locator(".ck-result").first().click();
    await page.getByRole("button", { name: "Save as found here" }).click();
    await page.getByRole("button", { name: /Found something not on the list/ }).click();
    await page.locator(".ck-unlisted summary").click();
    await page.getByLabel("What is it?").fill("E2E V17 blue label printer");
    await page.getByRole("button", { name: "Save as not in the catalog" }).click();
    await expect(page.locator(".ck-progress .live-status")).toHaveText("3 waiting to send");
    expect(await held(page)).toBe(3);
    await page.reload();
    await expect(page.locator(".ck-progress__count")).toContainText("4 / 5 checked");

    // Back online: sent once each.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".ck-progress .live-status")).toHaveCount(0, { timeout: 30_000 });
    expect(await held(page)).toBe(0);
    const detail = await api(page).get<Detail>(`/api/staff/audits/${id}`);
    expect(detail.checked).toBe(4);
    expect(detail.extras.map((extra) => [extra.outcome, extra.name]).sort()).toEqual([["FOUND_HERE", "E2E V17 Reel"], ["UNLISTED", "E2E V17 blue label printer"]]);
    // Nothing seen has changed stock, a movement or a place.
    for (const [name, id2] of Object.entries(ids)) expect([await onHand(page, id2), (await movements(page, id2)).length], name).toEqual(before[name]);
  });

  test("a resend whose answers were all lost is kept once", async () => {
    const id = checkId(page);
    // The server receives each observation, but the device never hears back, and sends it again.
    let lost = 0;
    await page.route("**/api/staff/audits/*/observations", async (route) => { await route.fetch(); lost += 1; await route.abort("internetdisconnected"); });
    await row(page, "E2E V17 Ties").getByRole("button", { name: /^Here/ }).click();
    await expect.poll(() => lost).toBeGreaterThan(0);
    await page.unroute("**/api/staff/audits/*/observations");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => held(page), { timeout: 30_000 }).toBe(0);
    const detail = await api(page).get<Detail>(`/api/staff/audits/${id}`);
    expect(detail.checked).toBe(5);
    expect(detail.items.filter((item) => item.name === "E2E V17 Ties").map((item) => item.observation?.outcome)).toEqual(["CONFIRMED"]);
  });

  test("the review refuses a count that stock moved past, posts a fresh one through the ledger, and moves what was found here", async () => {
    const id = checkId(page);
    // Someone takes a glue bottle out after it was counted.
    await api(page).post(`/api/staff/items/${ids["E2E V17 Glue"]}/movements`, { kind: "OUT", quantity: 1, reason: "ISSUED", key: crypto.randomUUID() });
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Finish check" }).click();
    await expect(page.locator(".ck-stats")).toBeVisible();
    const glue = page.locator(".ck-finding", { hasText: "E2E V17 Glue" });
    await expect(glue).toContainText("Stock changed since this was counted.");
    await expect(glue.getByRole("button", { name: /^Post count/ })).toHaveCount(0);
    await glue.locator("[data-fresh-count]").fill("1");
    await glue.getByRole("button", { name: "Post this count" }).click();
    await expect(page.locator(".ck-finding.is-settled", { hasText: "E2E V17 Glue" })).toContainText("Count posted");
    expect(await onHand(page, ids["E2E V17 Glue"]!)).toBe(1);
    const count = (await movements(page, ids["E2E V17 Glue"]!)).find((movement) => movement.movementType === "COUNT_ADJUSTMENT")!;
    expect(count).toMatchObject({ movementType: "COUNT_ADJUSTMENT", signedQuantity: -1 });
    expect(count.notes).toContain("E2E V17 Store › E2E V17 Shelf");
    await page.locator(".ck-finding", { hasText: "E2E V17 Reel" }).getByRole("button", { name: "Move it here" }).click();
    await expect(page.locator(".ck-finding.is-settled", { hasText: "E2E V17 Reel" })).toContainText("Moved here");
    expect((await api(page).get<{ item: { locationId: string } }>(`/api/staff/items/${ids["E2E V17 Reel"]}`)).item.locationId).toBe(shelf);
    // The cord could not be found: reported, stock untouched.
    await page.locator(".ck-finding", { hasText: "E2E V17 Cord" }).getByRole("button", { name: "Report its location" }).click();
    await expect(page.locator(".ck-finding.is-settled", { hasText: "E2E V17 Cord" })).toContainText("Reported");
    expect(await onHand(page, ids["E2E V17 Cord"]!)).toBe(2);
    expect((await api(page).get<Detail>(`/api/staff/audits/${id}`)).audit.status).toBe("FINISHED");
  });
});
