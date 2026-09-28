import { expect, test } from "@playwright/test";

const catalog = { items: [{ id: "ITM-0199", name: "Folding Table", category: "Equipment", itemType: "EQUIPMENT", unit: "piece", lendingAvailability: "unavailable", availableToBorrow: false }], categories: ["Equipment"] };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public/catalog**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(query === "missing" ? { items: [], categories: ["Equipment"] } : catalog) });
  });
});

test("landing provides only the Part 1 public destinations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Logistics that keeps the work moving." })).toBeVisible();
  await expect(page.getByText("Currently unavailable")).toBeVisible();
  await expect(page.getByRole("link", { name: /Explore Lending Hub/ })).toHaveAttribute("href", "/lending");
});

test("lending presents real-catalog-shaped disabled records and filtering", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "Lending Hub" })).toBeVisible();
  await expect(page.getByText("Folding Table")).toBeVisible();
  await expect(page.getByText("Lending availability unconfirmed")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search the catalog" }).fill("missing");
  await expect(page.getByRole("heading", { name: "No catalog records match those filters." })).toBeVisible();
});

test("staff login remains a real form and does not expose a staff shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/staff");
  await expect(page.getByRole("textbox", { name: "Username" })).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByText("Staff workspace")).toHaveCount(0);
});

test("public routes retain usable layouts across required viewport classes", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 700 }, { width: 375, height: 700 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/", "/lending", "/staff"]) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    }
  }
});

test("lending reports a recoverable loading failure", async ({ page }) => {
  await page.route("**/api/public/catalog**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "We could not load the catalog." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
