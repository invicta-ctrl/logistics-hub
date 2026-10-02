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
