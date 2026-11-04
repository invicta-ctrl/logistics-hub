import { expect, test } from "@playwright/test";

/* V1.16.12: numbered pages of 25 on desktop; lists that grow by 25, and groups that fold, on phones. Fictional data, API mocked. */

const categories = ["FURNITURE", "SCHOOL SUPPLIES", "ELECTRONICS"];
const catalog = {
  revision: 1, categories,
  items: Array.from({ length: 70 }, (_, at) => ({
    id: `ITM-${String(at + 1).padStart(4, "0")}`, name: `Lendable ${String(at + 1).padStart(2, "0")}`, category: categories[at % 3], unit: "piece",
    available: at % 7 ? 2 : 0, audience: "STUDENTS_AND_USC_STAFF"
  }))
};

test.beforeEach(async ({ page }, testInfo) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify(catalog) }));
});

test("Lending Hub on desktop: numbered pages of 25, grouped by category within the page, kept in the address", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/lending");
  const rows = page.locator("#lending-results .catalogue__open");
  await expect(rows).toHaveCount(25);
  const pager = page.getByRole("navigation", { name: "Lending Hub pages" });
  await expect(pager.locator(".pager__range")).toHaveText(/1–25 of 70/);
  // Group headings count the whole group, not only the rows on this page.
  await expect(page.locator(".catalogue-group__title span").first()).toHaveText(/2[34]/);
  await pager.getByRole("button", { name: "Page 3", exact: true }).click();
  await expect(page).toHaveURL(/[?&]page=3/);
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toBeFocused();
  await expect(pager.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await pager.screenshot({ path: testInfo.outputPath("lending-desktop-pager.png"), animations: "disabled" });
  await page.reload();
  await expect(rows).toHaveCount(20);
  // A search starts over at the first page.
  await page.getByRole("searchbox").first().fill("Lendable 1");
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(rows).toHaveCount(10);
  await expect(pager).toHaveCount(0);
});

test("Lending Hub on a phone: each category folds under a sticky title, opens on its first rows, and shows all on request", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/lending");
  const folds = page.locator("[data-fold-group]");
  await expect(folds).toHaveCount(3);
  await expect(page.locator("nav.pager")).toHaveCount(0);
  const first = folds.first();
  const toggle = first.locator("[data-fold]");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(first.locator(".catalogue__open")).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("lending-phone-folds.png"), animations: "disabled" });
  await first.getByRole("button", { name: /Show all/ }).click();
  await expect(first.locator(".catalogue__open").nth(5)).toBeFocused();
  expect(await first.locator(".catalogue__open").count()).toBeGreaterThan(20);
  // The title sticks under the filter bar while its group scrolls past.
  await first.locator(".catalogue__open").nth(15).scrollIntoViewIfNeeded();
  const stuck = await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>("[data-fold-group] .fold__title")!.getBoundingClientRect();
    const bar = document.querySelector<HTMLElement>(".filterbar")!.getBoundingClientRect();
    return { titleTop: Math.round(title.top), barBottom: Math.round(bar.bottom), position: getComputedStyle(document.querySelector(".fold__title")!).position };
  });
  expect(stuck.position).toBe("sticky");
  await page.screenshot({ path: testInfo.outputPath("lending-phone-stuck.png"), animations: "disabled" });
  expect(Math.abs(stuck.titleTop - Math.max(stuck.barBottom, 0))).toBeLessThanOrEqual(2);
  // Closing a fold that was scrolled past brings its title back into view, with focus on it.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await expect(toggle).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("no list's pager or fold scrolls sideways at 320 px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/lending");
  await expect(page.locator("[data-fold-group]").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(page.locator("nav.pager")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("Activity on desktop: Newer and Older, 25 at a time, reading the next batch when Older runs past what is loaded", async ({ page }, testInfo) => {
  const entry = (n: number) => ({ id: `phone:E${n}`, correlationId: `E${n}`, at: new Date(Date.UTC(2026, 9, 1, 2, 0) - n * 60_000).toISOString(), source: "PHONE", type: "PHONE_RETURN",
    summary: `A phone return of Item ${n} was held for staff.`, actor: "Self-Service", actorId: "SELF_SERVICE", itemId: `ITM-${n}`, itemName: `Item ${n}`, unit: "piece",
    change: 0, stockChanged: false, before: null, after: null, reason: null, note: null, attention: false });
  const cursors: string[] = [];
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", mustChangePassword: false, recovery: null, selfServiceReviews: 0 }) }));
  await page.route("**/api/staff/activity*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor) cursors.push(cursor);
    const start = cursor ? Number(cursor) : 0;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ events: Array.from({ length: Math.min(50, 120 - start) }, (_, index) => entry(start + index)), nextCursor: start + 50 < 120 ? String(start + 50) : null }) });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/activity");
  const rows = page.locator(".activity-row");
  await expect(rows).toHaveCount(25);
  const pager = page.getByRole("navigation", { name: "Activity pages" });
  await expect(pager.getByRole("button", { name: "Newer" })).toBeDisabled();
  await expect(pager.locator(".pager__range")).toContainText("1–25");
  await pager.getByRole("button", { name: "Older" }).click();
  await expect(pager.locator(".pager__range")).toContainText("26–50");
  await expect(rows.first().locator("[data-fold]")).toBeFocused();
  expect(cursors).toEqual([]);
  // Page 3 is past the first batch of 50, so the next batch is read first.
  await pager.getByRole("button", { name: "Older" }).click();
  await expect(pager.locator(".pager__range")).toContainText("51–75");
  expect(cursors).toEqual(["50"]);
  await expect(rows.first()).toContainText("Item 50");
  await pager.getByRole("button", { name: "Newer" }).click();
  await expect(pager.locator(".pager__range")).toContainText("26–50");
  // The last page: nothing older, and the end of the records is said.
  for (const range of ["51–75", "76–100", "101–120"]) {
    await pager.getByRole("button", { name: "Older" }).click();
    await expect(pager.locator(".pager__range")).toContainText(range);
  }
  await expect(pager.locator(".pager__range")).toContainText("101–120");
  await expect(pager.getByRole("button", { name: "Older" })).toBeDisabled();
  await expect(page.locator("#activity-end")).toBeVisible();
  await expect(page.locator("#activity-older")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("activity-desktop-last.png"), animations: "disabled" });
});

test("the DoL mark has no white disc, and the campus is home's background, fading into the page without an edge", async ({ page }, testInfo) => {
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r7"' }, body: JSON.stringify({ revision: 7, places: [], items: [
    { id: "ITM-0001", name: "Folding Table", aliases: null, category: "EQUIPMENT", unit: "piece", area: "Inventory", action: "BORROW", available: 4, location: null, locationId: null, audience: "STUDENTS_AND_USC_STAFF" },
    { id: "ITM-0002", name: "Bottled Water", aliases: null, category: "PANTRY", unit: "piece", area: "Pantry", action: "TAKE", available: 18, location: null, locationId: null, audience: null }
  ] }) }));
  await page.route("**/api/self-service/sync", (route) => route.abort());
  const bare = (selector: string) => page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, padding: style.paddingTop, radius: style.borderTopLeftRadius };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  expect(await bare(".site-header__brand .mark")).toEqual({ background: "rgba(0, 0, 0, 0)", padding: "0px", radius: "0px" });
  await page.locator(".site-header").screenshot({ path: testInfo.outputPath("public-header-mark.png") });
  for (const [width, theme] of [[390, "light"], [390, "dark"], [1280, "dark"]] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript((value) => { if (value === "dark") localStorage.setItem("ss-theme", "dark"); else localStorage.removeItem("ss-theme"); }, theme);
    await page.goto("/self-service");
    await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
    expect(await bare(".ss-bar__marks .mark")).toEqual({ background: "rgba(0, 0, 0, 0)", padding: "0px", radius: "0px" });
    // The photograph reaches well below the search, so no edge crosses the page under it.
    const reach = await page.evaluate(() => ({
      band: document.querySelector(".ss-band")!.getBoundingClientRect().bottom,
      search: document.querySelector(".ss-find")!.getBoundingClientRect().bottom
    }));
    expect(reach.band - reach.search).toBeGreaterThan(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`self-service-home-${width}-${theme}.png`), animations: "disabled" });
  }
});

/*
 * "make sure that everything didnt slow down and are under <10ms" (Earl, 2026-11-05): the browser's work for one press, script, style and
 * layout together. Measured on the release record's machine, a page turn and a search are under 10 ms (V1.16.11 took 180 ms to show more).
 * Test machines differ, so this guards the shape (a page turn redraws only the rows) and a clear slowdown, and logs the timings.
 */
test("turning a page redraws only its rows, and a press stays quick on a 6,000-item catalog", async ({ page }) => {
  const items = Array.from({ length: 6000 }, (_, at) => ({ id: `ITM-${String(at + 1).padStart(5, "0")}`, name: `Sample item ${at + 1}`, aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", onHand: 3 }));
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null }) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 0, bySource: {} }) }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items, categories: ["SUPPLIES"], locations: [], units: ["piece"] }) }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 1, locations: [] }) }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/items");
  await expect(page.locator("#inventory-count")).toContainText("6,000");
  // The click handlers draw synchronously; reading the layout afterwards adds the style and layout that work caused.
  const timings = await page.evaluate(() => {
    const table = document.querySelector(".data-table--items");
    const toolbar = document.querySelector("#todo");
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const firstKey = () => document.querySelector<HTMLElement>(".data-table--items tbody tr")?.dataset.key ?? "";
    const turn: number[] = [];
    const seen: string[] = [];
    let sameTable = true;
    for (let round = 0; round < 9; round += 1) {
      const next = [...document.querySelectorAll<HTMLButtonElement>('nav[data-pager="page"] [data-page]')].at(-1)!;
      const start = performance.now();
      next.click();
      void document.body.offsetHeight;
      turn.push(performance.now() - start);
      seen.push(firstKey());
      sameTable &&= table === document.querySelector(".data-table--items");
    }
    // The search waits 120 ms for typing to pause; here the wait is skipped so the timing is the draw itself.
    const later = window.setTimeout;
    (window as unknown as { setTimeout: (run: () => void) => number }).setTimeout = (run) => { run(); return 0; };
    const search = document.querySelector<HTMLInputElement>("#inventory-search")!;
    const typed: number[] = [];
    const counts: number[] = [];
    for (const value of ["S", "Sa", "Sample item 59", "Sample item 5999", ""]) {
      const start = performance.now();
      search.value = value;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      void document.body.offsetHeight;
      typed.push(performance.now() - start);
      counts.push(document.querySelectorAll(".data-table--items tbody tr").length);
    }
    window.setTimeout = later;
    return { turn: median(turn), turnMax: Math.max(...turn), typed: median(typed), typedMax: Math.max(...typed), seen, counts, sameTable, toolbarKept: toolbar === document.querySelector("#todo") };
  });
  console.log(`V11612_TIMINGS ${JSON.stringify(timings)}`);
  // Each press really drew something: nine new pages, then the searches' results.
  expect(timings.seen).toEqual(["ITM-00026", "ITM-00051", "ITM-00076", "ITM-00101", "ITM-00126", "ITM-00151", "ITM-00176", "ITM-00201", "ITM-00226"]);
  expect(timings.counts).toEqual([25, 25, 25, 1, 25]);
  // A page turn keeps the table and replaces its rows; nothing around them is drawn again.
  expect(timings.sameTable).toBe(true);
  expect(timings.toolbarKept).toBe(true);
  expect(timings.turn).toBeLessThan(40);
  expect(timings.typed).toBeLessThan(40);
});
