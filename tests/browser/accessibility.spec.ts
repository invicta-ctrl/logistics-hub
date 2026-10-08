import { expect, test, type Page } from "@playwright/test";

// The basics assistive technology and large text depend on, checked on every page a visitor can open without signing in.
// Added in Part 6.5 from a rendered baseline; no accessibility dependency is used (decision D6).
const ROUTES = ["/", "/lending", "/staff", "/self-service"];
// 305: what a 320 px window leaves beside a desktop scrollbar (WCAG reflow: 1280 px at 400% zoom on Windows). Playwright hides
// scrollbars, so the page is given that width directly.
const WIDTHS = [305, 320, 390, 768, 1366];

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
      if (url.pathname.endsWith("/derived")) return json({ missing: [] });
      if (url.pathname.endsWith("/access")) return json({ account: null, suggestedUsername: "ana.santos" });
      if (url.pathname.endsWith("/usage")) return json({ usage: [{ id: "MOV-1", at: "2026-09-30T02:00:00.000Z", itemId: "ITM-0001", itemName: "Sample Item", category: "SCHOOL SUPPLIES", stockArea: "Inventory", unit: "piece", quantity: 2, kind: "TAKE", purpose: "INDIVIDUAL", phone: 1 }], truncated: false });
      if (url.pathname.endsWith("/loans")) return json({ loans: [] });
      if (url.pathname.endsWith("/activity")) return json({ linked: false, events: [], nextCursor: null });
      if (/\/id\/(front|back|thumb|face)$/.test(url.pathname)) return route.fulfill({ contentType: "image/png", body: pixel });
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

  test("a year of usage is drawn 100 rows at a time; the totals count every row, and a phone use reads Used", async ({ page }) => {
    const rows = Array.from({ length: 230 }, (_, index) => ({ id: `MOV-${index}`, at: new Date(Date.UTC(2026, 8, 30, 2) - index * 3_600_000).toISOString(), itemId: "ITM-0001",
      itemName: `Sample Item ${index}`, category: "SCHOOL SUPPLIES", stockArea: "Inventory", unit: "piece", quantity: 1, kind: index === 0 ? "USE" : "TAKE", purpose: "INDIVIDUAL", phone: 1 }));
    await page.route("**/api/staff/admin/directory/*/usage**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ usage: rows, truncated: false }) }));
    await page.goto(`/staff/admin/directory?person=${ID}&tab=usage`);
    const table = page.getByRole("table", { name: "What left stock for Ana Marie Santos" });
    await expect(table.locator("tbody tr")).toHaveCount(100);
    await expect(table.locator("tbody tr").first()).toContainText("Used (phone)");
    await expect(page.locator(".stat").first()).toContainText("229 phone takes, 1 use");
    await page.getByRole("button", { name: /Show 100 more/ }).click();
    await expect(table.locator("tbody tr")).toHaveCount(200);
    await expect(table.locator("tbody .row-link").nth(100)).toBeFocused();
    await page.getByRole("button", { name: /Show 30 more/ }).click();
    await expect(table.locator("tbody tr")).toHaveCount(230);
    await expect(page.getByRole("button", { name: /more/ })).toHaveCount(0);
    // A new filter starts from the first page again.
    await page.getByLabel("Item").fill("Sample Item 1");
    await expect(table.locator("tbody tr")).toHaveCount(100);
  });

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

/* ---------- Administration sections (V1.13), signed in as an owner, on fictional data ---------- */

test.describe("Administration", () => {
  const json = (body: unknown) => ({ contentType: "application/json", body: JSON.stringify(body) });
  const accounts = [
    { id: "ACC-owner", username: "owner.sample", displayName: "Owner Sample", role: "OWNER", access: "OWNER", active: true, lastLoginAt: "2026-10-07T01:00:00.000Z", sessions: 1, directory: null },
    { id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DOL_STAFF", active: true, lastLoginAt: null, sessions: 0, directory: null }
  ];
  const status = {
    checkedAt: "2026-10-07T02:00:00.000Z",
    build: { version: "0123456789ab", commit: null, builtAt: "2026-10-07T01:00:00.000Z", migrations: ["0001_init.sql"] },
    database: { ok: true, ms: 4, migrations: { applied: 1, latest: "0001_init.sql", latestAppliedAt: "2026-10-07T01:30:00.000Z", pending: [] } },
    storage: [{ id: "EVIDENCE", label: "Loan photos", holds: "Photos taken when something is lent.", ok: true, ms: 3 }, { id: "CATALOG_MEDIA", label: "Catalog pictures", holds: "Item and place pictures.", ok: false, ms: 2000 }],
    selfService: "open"
  };
  const SECTIONS = ["/staff/admin", "/staff/admin/self-service", "/staff/admin/catalog", "/staff/admin/staff", "/staff/admin/accountability"];

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/staff/session", (route) => route.fulfill(json({ authenticated: true, id: "ACC-owner", username: "owner.sample", displayName: "Owner Sample", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false, directory: null })));
    await page.route("**/api/staff/admin/system", (route) => route.fulfill(json(status)));
    await page.route("**/api/staff/admin/accounts", (route) => route.fulfill(json({ accounts })));
    await page.route("**/api/staff/admin/activity", (route) => route.fulfill(json({ events: [] })));
    await page.route("**/api/staff/admin/retention", (route) => route.fulfill(json({ loans: 0, phoneRecords: 0, photos: 0 })));
    await page.route("**/api/staff/admin/catalog", (route) => route.fulfill(json({ active: 10, unclassified: 4, captured: 0, capturedClassified: 0 })));
    await page.route("**/api/staff/admin/catalog/aliases**", (route) => route.fulfill(json({ items: [{ id: "ITM-0001", name: "Sample Item", category: "SCHOOL SUPPLIES", aliases: "sample, test item", updatedAt: "2026-10-01T02:00:00.000Z" }], more: false })));
  });

  for (const address of SECTIONS) {
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

  test("the sections are one navigation with the current one marked, and a confirmation sheet names its title and focuses the safe choice", async ({ page }) => {
    await page.goto("/staff/admin/self-service");
    const nav = page.getByRole("navigation", { name: "Administration" });
    await expect(nav.getByRole("link")).toHaveText(["System", "Self-Service", "Catalog", "Staff", "Accountability"]);
    await expect(nav.locator("[aria-current]")).toHaveText("Self-Service");
    await page.getByRole("button", { name: "Close for maintenance" }).click();
    const dialog = page.getByRole("dialog", { name: "Close Self-Service for maintenance?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
