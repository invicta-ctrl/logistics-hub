import { expect, test } from "@playwright/test";
for (const width of [390, 768, 1440]) {
  test(`public landing reviewed baseline ${width}`, async ({ page }) => {
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({reducedMotion:"reduce",colorScheme:"light"});
    await page.goto("/");
    await expect(page.locator("main h1")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`landing-${width}.png`,{animations:"disabled"});
  });
}
