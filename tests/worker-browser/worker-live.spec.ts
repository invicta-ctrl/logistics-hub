import { expect, test } from "@playwright/test";
import fs from "node:fs";

const devVars = Object.fromEntries(fs.readFileSync(".dev.vars", "utf8").trim().split(/\r?\n/).map((line) => line.split("=")));

test("local Worker serves migrated catalog data with fail-closed lending", async ({ page, request }) => {
  const response = await request.get("/api/public/catalog");
  expect(response.ok()).toBeTruthy();
  const catalog = await response.json() as { items: Array<Record<string, unknown>> };
  expect(catalog.items).toHaveLength(397);
  expect(catalog.items.every((item) => item.availableToBorrow === false && item.lendingAvailability === "unavailable")).toBeTruthy();
  expect(catalog.items.every((item) => !("needsReview" in item) && !("lendingAudience" in item) && !("onHand" in item))).toBeTruthy();
  await page.goto("/lending");
  await expect(page.getByText("Lending availability unconfirmed").first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search the catalog" }).fill("Detergent Bar");
  await expect(page.getByText("Detergent Bar")).toBeVisible();
  await page.getByLabel("Category").selectOption("CLEANING SUPPLIES & EQUIPMENT");
  await expect(page.getByText("Detergent Bar")).toBeVisible();
});

test("local Worker redirects an unauthenticated staff shell request", async ({ page }) => {
  await page.goto("/staff/home/private-operation");
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole("heading", { name: "Staff Login" })).toBeVisible();
});

test("local development auth enters and revokes the staff session", async ({ page }) => {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(devVars.DEV_STAFF_USERNAME);
  await page.getByLabel("Password").fill(devVars.DEV_STAFF_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Logistics." })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Staff Login" })).toBeVisible();
});
