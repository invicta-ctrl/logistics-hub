import { expect, test } from "@playwright/test";

const catalog = { revision: 1, categories: ["FURNITURE"], items: [
  { id: "ITM-0005", name: "Folding Table", category: "FURNITURE", unit: "piece", available: 3, audience: "STUDENTS_AND_USC_STAFF", maxPerLoan: 2, loanDays: 3 },
  { id: "ITM-0080", name: "Cork Board", category: "FURNITURE", unit: "piece", available: 0, audience: "USC_STAFF_ONLY", maxPerLoan: null, loanDays: null }
] };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify(catalog) }));
});

test("landing shows the mark, live snapshot, and the Part 1 destinations only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Logistics that keeps the work moving." })).toBeVisible();
  const mark = page.locator(".masthead__brand img");
  const box = (await mark.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(70);
  expect(Math.abs(box.width / box.height - 183 / 163)).toBeLessThan(0.02);
  await expect(page.locator("#snapshot-body")).toContainText("1");
  await expect(page.getByText("Not yet available", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Explore the Lending Hub/ })).toHaveAttribute("href", "/lending");
});

test("Lending Hub searches, filters availability, and shows terms", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "Lending Hub" })).toBeVisible();
  await expect(page.getByText("3 pieces available")).toBeVisible();
  await expect(page.getByText("Up to 2 per loan · 3-day loan · Students & USC staff")).toBeVisible();
  await expect(page.getByText("None on the shelf right now")).toBeVisible();
  await page.getByLabel("Available now").check();
  await expect(page.getByText("Cork Board")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search the Lending Hub" }).fill("missing");
  await expect(page.getByRole("heading", { name: "Nothing matches those filters" })).toBeVisible();
});

test("Lending Hub explains an empty, fail-closed catalog", async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 1, items: [], categories: [] }) }));
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "No items are open for borrowing yet" })).toBeVisible();
});

test("Lending Hub reports a recoverable loading failure", async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "We couldn't load the Lending Hub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again now" })).toBeVisible();
});

test("staff login is a real form with validation", async ({ page }) => {
  await page.goto("/staff");
  await expect(page.getByRole("textbox", { name: "Username" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your username and password.")).toBeVisible();
});

test("public routes fit every required viewport class", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 700 }, { width: 375, height: 700 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/", "/lending", "/staff", "/no-such-page"]) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} at ${viewport.width}`).toBeTruthy();
    }
  }
});
