import { expect, test, type Page } from "@playwright/test";

// The basics assistive technology and large text depend on, checked on every page a visitor can open without signing in.
// Added in Part 6.5 from a rendered baseline; no accessibility dependency is used (decision D6).
const ROUTES = ["/", "/lending", "/staff", "/self-service"];
const WIDTHS = [320, 390, 768, 1366];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, categories: [], items: [] }) }));
  await page.route("**/api/staff/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Your staff session has ended. Please sign in again." }) }));
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ maintenance: true }) }));
});

const sidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const route of ROUTES) {
  test(`${route}: one heading, labelled fields, named controls, no sideways scroll`, async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);
      await expect(page.locator("main h1")).toHaveCount(1);
      const problems = await page.evaluate(() => {
        const unlabelled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((field) =>
          !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby") && !field.closest("label") && !(field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)));
        const unnamed = [...document.querySelectorAll("button, a[href]")].filter((control) =>
          !(control.textContent ?? "").trim() && !control.getAttribute("aria-label") && !control.getAttribute("title"));
        return { unlabelled: unlabelled.length, unnamed: unnamed.length };
      });
      expect(problems, `${route} at ${width}px`).toEqual({ unlabelled: 0, unnamed: 0 });
      expect(await sidewaysScroll(page), `${route} at ${width}px`).toBe(0);
    }
  });

  test(`${route}: the first Tab on a fresh load reaches the skip link`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("main h1")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  });

  test(`${route}: large text (200%) still fits at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(route);
    await expect(page.locator("main h1")).toHaveCount(1);
    await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
    expect(await sidewaysScroll(page)).toBe(0);
  });
}

test("a page shown in a frame leaves focus with the page around it", async ({ page }) => {
  await page.goto("/staff");
  await expect(page.locator("main h1")).toHaveCount(1);
  await page.evaluate(() => new Promise<void>((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = "/self-service";
    frame.addEventListener("load", () => resolve());
    document.body.append(frame);
  }));
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("main h1")).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("moving between pages inside the app still moves focus to the new page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Lending Hub" }).first().click();
  await expect(page.getByRole("heading", { name: "Lending Hub", level: 1 })).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
});

/* ---------- Staff Directory (V1.3), signed in as an owner, on fictional data ---------- */

test.describe("Staff Directory", () => {
  const ID = "PER-00000000-0000-4000-8000-000000000001";
  const person = (id: string, name: string, department: string, extra = {}) => ({ id, name, department, position: "Materials committee", officer: false, studentId: null, active: true, sourceKey: null,
    createdAt: "2026-10-01T02:00:00.000Z", updatedAt: "2026-10-01T02:00:00.000Z", hasId: false, account: null, ...extra });
  const people = [person(ID, "Ana Marie Santos", "DoL", { officer: true, position: "Director for Logistics", hasId: true, studentId: "20-1111-222" }),
    ...Array.from({ length: 14 }, (_, index) => person(`PER-00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, `Sample Person ${index + 1}`, ["DoL", "DEM", "DCES", "OfP"][index % 4]!))];
  const card = { mediaId: "00000000-0000-4000-8000-00000000abcd", front: { width: 856, height: 540 }, back: { width: 856, height: 540 }, sourceFront: "Santos_Front_DoL.png", sourceBack: "Santos_Back_DoL.png", createdAt: "2026-10-01T02:00:00.000Z", createdBy: "Owner Sample" };
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, id: "ACC-owner", username: "owner.sample", displayName: "Owner Sample", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false, directory: null }) }));
    await page.route("**/api/staff/admin/directory**", (route) => {
      const url = new URL(route.request().url());
      const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/api/staff/admin/directory") return json({ people });
      if (url.pathname.endsWith("/accounts")) return json({ accounts: [] });
      if (url.pathname.endsWith("/access")) return json({ account: null, suggestedUsername: "ana.santos" });
      if (url.pathname.endsWith("/usage")) return json({ usage: [{ id: "MOV-1", at: "2026-09-30T02:00:00.000Z", itemId: "ITM-0001", itemName: "Sample Item", category: "SCHOOL SUPPLIES", stockArea: "Inventory", unit: "piece", quantity: 2, kind: "TAKE", purpose: "INDIVIDUAL", phone: 1, matchedBy: "STUDENT_ID" }], truncated: false });
      if (url.pathname.endsWith("/loans")) return json({ loans: [] });
      if (url.pathname.endsWith("/activity")) return json({ linked: false, events: [], nextCursor: null });
      if (/\/id\/(front|back)$/.test(url.pathname)) return route.fulfill({ contentType: "image/png", body: pixel });
      return json({ person: people[0], card, history: [] });
    });
  });

  for (const address of ["/staff/admin/directory", `/staff/admin/directory?person=${ID}`, `/staff/admin/directory?person=${ID}&tab=id`, `/staff/admin/directory?person=${ID}&tab=usage`]) {
    test(`${address}: one heading, labelled fields, named controls, no sideways scroll, and room for 200% text`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(address);
        await expect(page.locator("main h1")).toHaveCount(1);
        await page.waitForLoadState("networkidle");
        const problems = await page.evaluate(() => {
          const unlabelled = [...document.querySelectorAll("main input:not([type=hidden]), main select, main textarea")].filter((field) =>
            !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby") && !field.closest("label") && !(field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)));
          const unnamed = [...document.querySelectorAll("main button, main a[href]")].filter((control) => !(control.textContent ?? "").trim() && !control.getAttribute("aria-label") && !control.getAttribute("title"));
          return { unlabelled: unlabelled.length, unnamed: unnamed.length };
        });
        expect(problems, `${address} at ${width}px`).toEqual({ unlabelled: 0, unnamed: 0 });
        expect(await sidewaysScroll(page), `${address} at ${width}px`).toBe(0);
      }
      await page.setViewportSize({ width: 320, height: 800 });
      await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
      expect(await sidewaysScroll(page), `${address} at 200%`).toBe(0);
    });
  }

  test("profile tabs follow the APG pattern: arrows move, Enter opens, the URL remembers", async ({ page }) => {
    await page.goto(`/staff/admin/directory?person=${ID}`);
    await page.getByRole("tab", { name: "Profile" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "USC ID" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "USC ID" })).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=id/);
    await expect(page.getByRole("tabpanel", { name: "USC ID" })).toBeVisible();
  });
});
