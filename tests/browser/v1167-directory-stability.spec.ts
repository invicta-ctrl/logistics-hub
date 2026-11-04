import { expect, test } from "@playwright/test";

test("the Staff Directory remains stable and interactive after loading", async ({ page }) => {
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: { authenticated: true, id: "ACC-owner", username: "owner.sample", displayName: "Owner Sample", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false, directory: null } }));
  const person = { id: "PER-00000000-0000-4000-8000-000000000001", name: "Ana Sample", department: "DoL", position: null, officer: false, studentId: null, active: true, sourceKey: null, createdAt: "2026-10-01T02:00:00.000Z", updatedAt: "2026-10-01T02:00:00.000Z", hasId: false, account: null };
  await page.route("**/api/staff/admin/directory**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/derived")) return route.fulfill({ json: { missing: [] } });
    if (path.endsWith("/loans")) return route.fulfill({ json: { loans: [] } });
    if (path.endsWith("/directory")) return route.fulfill({ json: { people: [person] } });
    return route.fulfill({ json: { person, card: null, history: [] } });
  });
  await page.goto("/staff/admin/directory");
  const card = page.getByRole("link", { name: /Ana Sample/ });
  await expect(card).toBeVisible();
  await page.waitForTimeout(1000);
  // A missing admin stylesheet put the marker in the bar's flex flow: each ResizeObserver callback then grew the bar by 1 px.
  const heights = await page.evaluate(async () => {
    const bar = document.querySelector<HTMLElement>(".admin-tabs")!;
    const values: number[] = [];
    for (let i = 0; i < 60; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      values.push(bar.getBoundingClientRect().height);
    }
    return values;
  });
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  await expect(page.locator(".admin-tabs__marker")).toHaveCSS("position", "absolute");
  await card.click();
  await expect(page.getByRole("dialog", { name: "USC ID of Ana Sample" })).toBeVisible();
});
