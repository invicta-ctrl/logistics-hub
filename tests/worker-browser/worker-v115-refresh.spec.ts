import { expect, test, type Page } from "@playwright/test";

/*
 * V1.15 perceived performance (mobile/perceived-performance amendment): once a staff page has drawn real content, a background
 * refresh never swaps it for a loader or an error. On the real Worker at phone width, each page that keeps itself current is
 * loaded, then its refresh is held out for a while, failed, and answered with changed data. In every case the words on the page stay
 * (apart from the "Updated" line), no skeleton or busy region appears, and a change arrives in place.
 */

const PAGES: [name: string, route: string, api: RegExp][] = [
  ["Home", "/staff/home", /\/api\/staff\/home$/],
  ["Items", "/staff/items", /\/api\/staff\/inventory$/],
  ["Stock", "/staff/stock", /\/api\/staff\/stock$/],
  ["Loans", "/staff/loans", /\/api\/staff\/loans$/],
  ["Activity", "/staff/activity", /\/api\/staff\/activity$/],
  ["Attention", "/staff/attention", /\/api\/staff\/attention$/],
  ["Locations", "/staff/locations", /\/api\/staff\/locations$/],
  ["Kits", "/staff/kits", /\/api\/staff\/kits$/],
  ["Self-Service", "/staff/self-service", /\/api\/staff\/self-service$/]
];

async function signIn(page: Page) {
  await page.goto("/staff");
  const origin = new URL(page.url()).origin;
  let signedIn = false;
  for (const secret of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
    signedIn ||= (await page.request.post("/api/staff/login", { headers: { origin }, data: { username: process.env.E2E_OWNER_USERNAME, password: secret } })).ok();
  }
  expect(signedIn).toBe(true);
}

/** The words of the page's main area as lines, without the freshness line (it is meant to change). */
const words = (page: Page) => page.evaluate(() => {
  const main = document.querySelector("#main-content")!.cloneNode(true) as HTMLElement;
  main.querySelectorAll(".live-status, [data-live-status], time").forEach((element) => element.remove());
  return main.innerText.split("\n").map((line) => line.trim()).filter(Boolean);
});

/** Starts counting every loader or busy region that appears in the main area. */
const watchLoaders = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __loaders: string[] };
  w.__loaders = [];
  const main = document.querySelector("#main-content")!;
  const note = (element: Element) => w.__loaders.push(`${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}`);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && (record.target as Element).getAttribute("aria-busy") === "true") note(record.target as Element);
      for (const added of record.addedNodes) {
        if (!(added instanceof Element)) continue;
        if (added.matches(".skeleton, [aria-busy='true']")) note(added);
        added.querySelectorAll(".skeleton, [aria-busy='true']").forEach(note);
      }
    }
  }).observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy"] });
});
const loaders = (page: Page) => page.evaluate(() => (window as unknown as { __loaders: string[] }).__loaders);

/** Asks the page to check for fresh data now, as it does on returning to the tab. */
const refresh = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

test.describe("a background refresh keeps what the page shows", () => {
  for (const [name, route, api] of PAGES) {
    test(`${name}: held, failed and recovered refreshes leave the page's content in place`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page);
      await page.goto(route);
      await expect(page.locator("main h1")).toHaveCount(1);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(page.locator("#main-content .skeleton, #main-content [aria-busy='true']")).toHaveCount(0);
      const before = await words(page);
      expect(before.length, "the page has something to keep").toBeGreaterThan(2);
      await watchLoaders(page);
      // The watcher itself is alive: a loader dropped into the page is seen.
      await page.evaluate(() => { const probe = document.createElement("div"); probe.className = "skeleton"; document.querySelector("#main-content")!.append(probe); setTimeout(() => probe.remove(), 50); });
      await expect.poll(() => loaders(page)).toEqual(["div.skeleton"]);
      await page.evaluate(() => { (window as unknown as { __loaders: string[] }).__loaders.length = 0; });

      let mode: "pass" | "hold" | "fail" = "pass";
      let release: () => void = () => undefined;
      let held = 0;
      await page.route((url) => api.test(url.pathname), async (handler) => {
        if (mode === "fail") return handler.abort("connectionreset");
        if (mode === "hold") { held += 1; await new Promise<void>((resolve) => { release = resolve; }); }
        return handler.continue();
      });
      const stays = async (when: string) => {
        const now = await words(page);
        expect(now.filter((line) => !before.includes(line)), `${name} ${when}: nothing new replaced the content`).toEqual([]);
        expect(before.filter((line) => !now.includes(line)), `${name} ${when}: nothing was taken away`).toEqual([]);
        expect(await loaders(page), `${name} ${when}: no loader appeared`).toEqual([]);
      };

      // Held: the check is out for a while and the page is as it was.
      mode = "hold";
      await refresh(page);
      await expect.poll(() => held, { message: "the refresh was sent" }).toBeGreaterThan(0);
      await page.waitForTimeout(600);
      await stays("while the refresh is out");
      release();
      mode = "pass";
      await page.waitForTimeout(400);
      await stays("after it answers unchanged");

      // Failed: the connection drops. The page keeps its content and says it is offline only in its freshness line.
      mode = "fail";
      await refresh(page);
      await page.waitForTimeout(600);
      await stays("when the refresh fails");
      if (await page.locator(".live-status").count()) await expect(page.locator(".live-status")).toHaveAttribute("data-state", "offline");
      mode = "pass";

      // The connection returns: the next check is answered and the page is still the same page.
      await refresh(page);
      await page.waitForTimeout(600);
      await stays("when the connection returns");
    });
  }

  test("Items: a change made elsewhere arrives in place, with the old rows kept and no loader", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto("/staff/items");
    await expect(page.locator("main h1")).toHaveCount(1);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const first = await page.locator("#main-content .row-link").first().innerText();
    await watchLoaders(page);
    const name = `Refresh check ${Date.now() % 100000}`;
    const created = await page.request.post("/api/staff/items", { headers: { origin: baseURL! }, data: {
      name, aliases: "", category: "Miscellaneous", itemType: "Loanable", unit: "piece", status: "ACTIVE", locationId: null,
      reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: "", openingQuantity: 1
    } });
    expect(created.status()).toBe(201);
    await refresh(page);
    await page.getByRole("searchbox").first().fill(name).catch(() => undefined);
    await expect(page.locator("#main-content").getByText(name).first()).toBeVisible();
    await page.getByRole("searchbox").first().fill("").catch(() => undefined);
    await expect(page.locator("#main-content .row-link").first()).toContainText(first.split("\n")[0]!.trim());
    expect(await loaders(page), "no loader appeared while the new row arrived").toEqual([]);
  });
});
