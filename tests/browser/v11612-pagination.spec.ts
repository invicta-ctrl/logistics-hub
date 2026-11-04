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
