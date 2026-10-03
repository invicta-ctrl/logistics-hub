import { expect, test } from "@playwright/test";

// R6 (accepted amendment 2026-10-03-review-hardening): a live view never goes back to older data, and a refresh asked for
// while one is on its way still happens. Exercised through the Lending Hub, the public page that polls with live().
const catalog = (name: string, revision: number) => ({ revision, categories: ["FURNITURE"], items: [
  { id: "ITM-0005", name, category: "FURNITURE", unit: "piece", available: 3, audience: "STUDENTS_AND_USC_STAFF" }
] });

test("a slow older answer arriving after a newer one never replaces it, and the refresh asked for meanwhile still runs", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/public/catalog", async (route) => {
    requests += 1;
    if (requests === 1) {
      await held; // the first answer is slow and older
      return route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify(catalog("Old Table", 1)) });
    }
    return route.fulfill({ contentType: "application/json", headers: { etag: '"r2"' }, body: JSON.stringify(catalog("New Table", 2)) });
  });
  await page.goto("/lending");
  await expect.poll(() => requests).toBe(1);
  // Coming back to the tab asks for a refresh while the first request is still out.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(200);
  release();
  await expect(page.locator(".catalogue__row", { hasText: "New Table" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator(".catalogue__row", { hasText: "Old Table" })).toHaveCount(0);
  await expect(page.locator(".catalogue__row", { hasText: "New Table" })).toBeVisible();
});

test("leaving the page stops its polling: an answer that arrives afterwards changes nothing and no new request starts", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/public/catalog", async (route) => {
    requests += 1;
    if (requests === 2) await held;
    return route.fulfill({ contentType: "application/json", headers: { etag: `"r${requests}"` }, body: JSON.stringify(catalog(`Table ${requests}`, requests)) });
  });
  await page.goto("/lending");
  await expect(page.locator(".catalogue__row", { hasText: "Table 1" })).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => requests).toBe(2);
  // Leave for the landing page while the second request is out, then let it answer.
  await page.getByRole("link", { name: "Department of Logistics home" }).first().click();
  await expect(page.locator(".catalogue__row")).toHaveCount(0);
  release();
  await page.waitForTimeout(500);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(300);
  expect(requests).toBe(2);
});
