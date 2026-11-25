import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const widths = [390, 768, 1440];
for (const route of ["/", "/lending", "/staff", "/self-service"]) {
  for (const width of widths) {
    test(`axe public ${route} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await expect(page.locator("main h1")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
for (const route of ["/staff/items", "/staff/stock", "/staff/admin/directory"]) {
  test(`axe owner ${route}`, async ({ page }) => {
    await page.goto("/staff");
    await page.getByRole("textbox",{name:"Username"}).fill(process.env.E2E_OWNER_USERNAME!);
    await page.getByLabel("Password",{exact:true}).fill(process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("button",{name:"Sign in"}).click();
    await expect(page.getByRole("heading",{name:"Home"})).toBeVisible();
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({width,height:900});
      const result = await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();
      expect(result.violations, `${route} at ${width}px`).toEqual([]);
    }
  });
}
