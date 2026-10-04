import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";

/*
 * V1.6 against a real Worker, D1 and R2 and the production build (service worker on). An Android tablet turns offline cataloguing on,
 * goes offline, reopens the Catalogue, gets the same suggestions as online, saves items (one with a photo) across a reload, finishes,
 * starts another session, and sends everything exactly once when the connection is back, also when every answer is lost. Work waiting
 * on the device survives a wiped app cache. Signed out, the device keeps cataloguing on its lease and nothing else. The Catalog and
 * Self-Service install as two apps. Every name starts with "E2E V16".
 */

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? "8792"}`;

type Row = { id: string; name: string; photoId: string | null; onHand: number; needsReview: boolean; itemType: string };
type Held = { id: string; sessionId: string; owner?: string; itemId: string | null; state: string };

let context: BrowserContext;
let page: Page;
let shelf = "";

async function tablet(browser: Browser) {
  const made = await browser.newContext({ ...devices["Galaxy Tab S4"], baseURL: BASE });
  return { context: made, page: await made.newPage() };
}

async function signIn(target: Page): Promise<void> {
  await target.goto(`/staff?next=${encodeURIComponent("/staff/catalogue")}`);
  await target.getByRole("textbox", { name: "Username" }).fill(username);
  await target.getByLabel("Password", { exact: true }).fill(password);
  await target.getByRole("button", { name: "Sign in" }).click();
  await expect(target.getByRole("heading", { name: "Catalogue", level: 1 })).toBeVisible();
}

const named = async (from: Page, name: string) => ((await (await from.request.get("/api/staff/inventory")).json()) as { items: Row[] }).items.filter((item) => item.name === name);

/** What the device holds for cataloguing, straight from IndexedDB. */
const held = (from: Page) => from.evaluate(() => new Promise<Held[]>((resolve, reject) => {
  const request = indexedDB.open("logistics-hub-catalogue");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const all = request.result.transaction("captures").objectStore("captures").getAll();
    all.onsuccess = () => resolve(all.result as Held[]);
    all.onerror = () => reject(all.error);
  };
}));

async function capture(target: Page, options: { name: string; how: string; category?: string; unit?: string; more?: number; photo?: boolean }) {
  await target.getByLabel("Name", { exact: true }).fill(options.name);
  if (options.photo) {
    // A camera photo of its own, made in the page: a shared picture would rightly be flagged as looking like another item's.
    const photo = await target.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext("2d")!;
      // Random blocks of light and dark: the photo's 64-bit hash is effectively random, so it never looks like another item's photo.
      for (let x = 0; x < 16; x += 1) for (let y = 0; y < 12; y += 1) { context.fillStyle = `hsl(0 0% ${Math.floor(Math.random() * 90) + 5}%)`; context.fillRect(x * 40, y * 40, 40, 40); }
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/jpeg", 0.85));
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await target.locator("#cat-file").setInputFiles({ name: "shelf.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo) });
    await expect(target.locator("#cat-photo img")).toBeVisible();
  }
  await target.locator(".cat-choice", { hasText: options.how }).first().click();
  if (options.category) await target.getByLabel("Category").fill(options.category);
  if (options.unit) await target.getByLabel("Counted in").fill(options.unit);
  for (let tap = 0; tap < (options.more ?? 0); tap += 1) await target.getByRole("button", { name: "One more" }).click();
  await target.getByRole("button", { name: /^Save/ }).first().click();
}

const rows = (target: Page) => target.locator("#cat-list .cat-row");

test.describe.serial("the Catalog PWA", () => {
  test.beforeAll(async ({ browser }) => {
    ({ context, page } = await tablet(browser));
    await signIn(page);
    // An open session is per person: one an earlier spec left open for this account would be resumed instead of started.
    const open = ((await (await page.request.get("/api/staff/catalogue")).json()) as { session: { id: string } | null }).session;
    if (open) await page.request.post(`/api/staff/catalogue/sessions/${open.id}/finish`, { headers: { origin: BASE } });
    const post = async (data: Record<string, unknown>) => ((await (await page.request.post("/api/staff/locations", { headers: { origin: BASE }, data })).json()) as { id: string }).id;
    const room = await post({ name: "E2E V16 Store room", parentId: null });
    shelf = await post({ name: "E2E V16 Shelf A", parentId: room });
  });
  test.afterAll(async () => { await context.close(); });

  test("turns on for this device, opens and catalogues offline, and sends everything once when the connection is back", async () => {
    await page.goto("/staff/catalogue");
    await expect(page.getByRole("heading", { name: "Offline cataloguing on this device" })).toBeVisible();
    await page.getByRole("button", { name: "Turn on offline cataloguing" }).click();
    await expect(page.locator(".cat-ready--ok")).toContainText("Ready for offline cataloguing", { timeout: 30_000 });

    // Online: a session, and the suggestion for a name like one already in the catalog.
    await page.getByLabel("Place", { exact: true }).selectOption(shelf);
    await page.getByRole("button", { name: /^Start cataloguing/ }).click();
    await expect(page.locator("#cat-place-name")).toHaveText("E2E V16 Store room › E2E V16 Shelf A");
    const first = new URL(page.url()).searchParams.get("session")!;
    const probe = "Whiteboard";
    await page.getByLabel("Name", { exact: true }).fill(probe);
    await expect(page.locator("#cat-why")).not.toBeEmpty();
    const onlineWhy = await page.locator("#cat-why").innerText();
    await page.getByLabel("Name", { exact: true }).fill("");

    // Offline: the Catalogue opens from what the device saved, and suggests exactly what it suggested online.
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#cat-offline")).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill(probe);
    await expect(page.locator("#cat-why")).toHaveText(onlineWhy);
    await page.getByLabel("Name", { exact: true }).fill("");

    await capture(page, { name: "E2E V16 Ladder", how: "Borrow", category: "E2E V16 TOOLS", unit: "piece", photo: true });
    await capture(page, { name: "E2E V16 Rags", how: "Consume", category: "E2E V16 TOOLS", unit: "pack", more: 2 });
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: "Not saved yet" })).toHaveCount(2);
    await expect(page.locator("#cat-sync")).toHaveText("2 waiting to send");
    await page.reload();
    await expect(rows(page).filter({ hasText: "Not saved yet" })).toHaveCount(2);

    // Finished offline: the server hears once both items are there.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Cataloguing finished" })).toBeVisible();
    await expect(page.getByText("2 items are not saved yet.")).toBeVisible();

    // A new session, started without a connection.
    await page.getByRole("link", { name: "Start another session" }).click();
    await expect(page.getByText("You're offline.", { exact: true })).toBeVisible();
    await page.getByLabel("Place", { exact: true }).selectOption(shelf);
    await page.getByRole("button", { name: /^Start cataloguing/ }).click();
    await expect(page).toHaveURL(/session=CS-/);
    const second = new URL(page.url()).searchParams.get("session")!;
    expect(second).not.toBe(first);
    await capture(page, { name: "E2E V16 Bucket", how: "Not sure" });
    await expect(rows(page).filter({ hasText: "Not saved yet" })).toHaveCount(1);
    expect((await held(page)).map((entry) => entry.state)).toEqual(["waiting", "waiting", "waiting"]);
    // Kept in the page, as the device holds them now: replayed later as if every answer had been lost.
    await page.evaluate(() => new Promise<void>((resolve) => {
      const request = indexedDB.open("logistics-hub-catalogue");
      request.onsuccess = () => {
        const all = request.result.transaction("captures").objectStore("captures").getAll();
        all.onsuccess = () => { (window as unknown as { lost: unknown[] }).lost = all.result; resolve(); };
      };
    }));

    // Back online: everything is sent, once.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await held(page)).length, { timeout: 30_000 }).toBe(0);
    await expect(page.locator("#cat-sync")).toHaveText("All saved");
    const [ladder] = await named(page, "E2E V16 Ladder");
    expect(ladder).toMatchObject({ itemType: "Loanable", needsReview: true, onHand: 1 });
    expect(ladder!.photoId).toBeTruthy();
    expect(await named(page, "E2E V16 Rags")).toHaveLength(1);
    expect((await named(page, "E2E V16 Rags"))[0]!.onHand).toBe(3);
    expect(await named(page, "E2E V16 Bucket")).toHaveLength(1);
    const finished = await (await page.request.get(`/api/staff/catalogue/sessions/${first}`)).json() as { session: { status: string }; counts: Record<string, number> };
    expect(finished).toMatchObject({ session: { status: "FINISHED" }, counts: { BORROW: 1, CONSUME: 1 } });
    // The session started offline was made on the server under the id the device proposed.
    expect(await (await page.request.get(`/api/staff/catalogue/sessions/${second}`)).json()).toMatchObject({ session: { id: second, status: "ACTIVE", saved: 1 } });

    // Every answer lost: the device sends it all again, and nothing changes.
    await page.evaluate(() => new Promise<void>((resolve) => {
      const request = indexedDB.open("logistics-hub-catalogue");
      request.onsuccess = () => {
        const transaction = request.result.transaction("captures", "readwrite");
        for (const entry of (window as unknown as { lost: object[] }).lost) transaction.objectStore("captures").put(entry);
        transaction.oncomplete = () => resolve();
      };
    }));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await held(page)).length, { timeout: 30_000 }).toBe(0);
    for (const name of ["E2E V16 Ladder", "E2E V16 Rags", "E2E V16 Bucket"]) expect(await named(page, name), name).toHaveLength(1);
    expect((await named(page, "E2E V16 Ladder"))[0]!.photoId).toBe(ladder!.photoId);
  });

  test("work waiting on the device survives losing the app's saved files, and the device gets ready again by itself", async () => {
    await context.setOffline(true);
    await page.reload();
    await capture(page, { name: "E2E V16 Mop", how: "Consume", category: "E2E V16 TOOLS", unit: "piece" });
    await expect(rows(page).filter({ hasText: "Not saved yet" })).toHaveCount(1);
    // As an update replacing every saved file would: the queue lives in IndexedDB, which nothing here touches.
    await page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
    await context.setOffline(false);
    await page.reload();
    await expect.poll(async () => (await held(page)).length, { timeout: 30_000 }).toBe(0);
    expect(await named(page, "E2E V16 Mop")).toHaveLength(1);
    await page.goto("/staff/catalogue");
    await expect(page.locator(".cat-ready--ok")).toContainText("Ready for offline cataloguing", { timeout: 30_000 });
  });

  test("signed out, the device keeps cataloguing on its lease, and can do nothing else", async () => {
    await context.clearCookies({ name: "lh_staff_session" });
    await page.goto("/staff/catalogue");
    await expect(page.getByText("You're signed out.", { exact: true })).toBeVisible();
    expect((await page.request.get("/api/staff/inventory")).status()).toBe(401);
    await page.getByRole("link", { name: /^Resume cataloguing/ }).click();
    await capture(page, { name: "E2E V16 Sponge", how: "Consume", category: "E2E V16 TOOLS", unit: "piece" });
    // The bar may still say "All saved" from before this save: wait for the item's own row.
    await expect(rows(page).filter({ hasText: "E2E V16 Sponge" }).getByText("Saved", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#cat-sync")).toHaveText("All saved");
    expect((await held(page)).length).toBe(0);
    // Turning it off ends the lease: the device can no longer catalogue on it.
    await page.goto("/staff/catalogue");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Turn off" }).click();
    await expect(page.getByText("Offline cataloguing is off on this device.")).toBeVisible();
    expect((await page.request.get("/api/staff/catalogue/snapshot")).status()).toBe(401);
    // Signed in again, the item saved on the lease is there.
    await signIn(page);
    expect(await named(page, "E2E V16 Sponge")).toHaveLength(1);
  });

  test("the Catalog installs as its own app beside Self-Service", async () => {
    const cdp = await context.newCDPSession(page);
    const app = async (path: string) => {
      await page.goto(path);
      await page.waitForFunction((href) => document.querySelector('link[rel="manifest"]')?.getAttribute("href") === href, path.startsWith("/staff") ? "/catalogue.webmanifest" : "/manifest.webmanifest");
      const manifest = await cdp.send("Page.getAppManifest") as { url: string; errors: unknown[]; data: string };
      // Chromium's own verdict on whether the page can be installed as an app: empty means it can.
      const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors") as { installabilityErrors: unknown[] };
      return { url: new URL(manifest.url).pathname, errors: manifest.errors, data: JSON.parse(manifest.data) as Record<string, unknown>, installabilityErrors };
    };
    // Two manifests with their own ids are two apps: installing one neither replaces nor changes the other.
    const catalog = await app("/staff/catalogue");
    expect(catalog).toMatchObject({ url: "/catalogue.webmanifest", errors: [], data: { id: "/staff/catalogue", start_url: "/staff/catalogue", scope: "/staff", name: "Logistics Catalog", display: "standalone" }, installabilityErrors: [] });
    const selfService = await app("/self-service");
    expect(selfService).toMatchObject({ url: "/manifest.webmanifest", errors: [], data: { id: "/self-service", start_url: "/self-service", scope: "/self-service" }, installabilityErrors: [] });
  });
});
