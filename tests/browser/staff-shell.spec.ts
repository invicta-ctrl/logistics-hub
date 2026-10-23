import { expect, test, type Page } from "@playwright/test";

/*
 * The staff shell every staff page shares (V1.16 MA2): where a session that cannot use the workspace is sent, and the account
 * menu with the keyboard, on phones, and in a browser without the Popover API. These pin today's behaviour before the shell
 * moves out of the Items screen's module.
 */

const owner = { authenticated: true, id: "ACC-owner", username: "owner.one", displayName: "Owner One", role: "OWNER", access: "OWNER", hub: true, mustChangePassword: false, recovery: { configured: true, createdAt: "2026-10-01T00:00:00.000Z" }, selfServiceReviews: 0, selfServiceClosed: false, directory: null };

const answer = (page: Page, session: Record<string, unknown>) =>
  page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));

test.describe("a session that cannot use the workspace", () => {
  test("a required password change opens My account first, with no sections", async ({ page }) => {
    await answer(page, { ...owner, role: "ADMIN", access: "ADMIN", mustChangePassword: true });
    await page.goto("/staff/items");
    await expect(page).toHaveURL(/\/staff\/account$/);
    await expect(page.getByRole("alert").filter({ hasText: "Choose your own password to continue." })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
    await expect(page.locator("[data-palette]")).toHaveCount(0);
  });

  test("a sign-in without access to the hub goes to My account", async ({ page }) => {
    await answer(page, { ...owner, role: "STAFF", access: "DEM", hub: false, recovery: null });
    await page.goto("/staff/stock");
    await expect(page).toHaveURL(/\/staff\/account$/);
    await expect(page.locator(".callout")).toContainText("Your sign-in is set up as DEM Staff.");
    await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
  });

  test("a signed-out visitor is sent to sign in", async ({ page }) => {
    await page.route("**/api/staff/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Sign in required." }) }));
    await page.goto("/staff/home");
    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
  });

  test("without a connection the page says staff tools need one and offers Self-Service", async ({ page }) => {
    await page.route("**/api/staff/session", (route) => route.abort("internetdisconnected"));
    await page.goto("/staff/loans");
    await expect(page.getByRole("heading", { level: 1, name: "Staff tools need a connection" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/staff/loans");
    await expect(page.getByRole("link", { name: "Open Self-Service" })).toHaveAttribute("href", "/self-service");
    await expect(page.locator("#main-content")).toHaveCount(1);
  });

  test("any other failure says the workspace is unavailable, in the server's words", async ({ page }) => {
    await page.route("**/api/staff/session", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The service is temporarily unavailable." }) }));
    await page.goto("/staff/activity");
    await expect(page.getByRole("heading", { level: 1, name: "The staff workspace is unavailable" })).toBeVisible();
    await expect(page.locator("#main-content")).toContainText("The service is temporarily unavailable.");
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/staff/items");
  });
});

test.describe("the account menu", () => {
  test.beforeEach(async ({ page }) => { await answer(page, owner); });

  test("opens and closes from the keyboard, and Escape gives focus back to the avatar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/staff/account");
    const avatar = page.getByRole("button", { name: /^Account:/ });
    const more = page.locator(".app-nav__more");
    const menu = page.locator("#staff-menu");
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
    await avatar.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    // Both openers say the one menu is open.
    await expect(avatar).toHaveAttribute("aria-expanded", "true");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("link", { name: "My account" })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Tab");
    expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(avatar).toBeFocused();
    // A choice closes the menu at once, here for the page already shown.
    await avatar.click();
    await menu.getByRole("link", { name: "My account" }).click();
    await expect(menu).toBeHidden();
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
    await expect(page).toHaveURL(/\/staff\/account$/);
  });

  test("on a phone, More opens the same menu with every section beyond Home", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff/account");
    const more = page.getByRole("button", { name: "More" });
    const menu = page.locator("#staff-menu");
    await more.click();
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const sections = menu.getByRole("list", { name: "More sections" });
    await expect(sections.getByRole("link")).toHaveText(["Items", "Stock", "Locations", "Kits", "Loans", "Self-Service", "Activity", "Administration"]);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toBeFocused();
  });

  test("without the Popover API the avatar and More simply show and hide it, and a choice closes it", async ({ page }) => {
    // An older browser (iOS before 17): no showPopover, and the popover attributes do nothing. The shell finds its openers by
    // that attribute as it draws; only afterwards are the attributes dropped, as such a browser would ignore them.
    await page.addInitScript(() => {
      delete (HTMLElement.prototype as { showPopover?: unknown }).showPopover;
      new MutationObserver(() => {
        document.querySelectorAll("[popover]").forEach((element) => element.removeAttribute("popover"));
        document.querySelectorAll("[popovertarget]").forEach((element) => element.removeAttribute("popovertarget"));
      }).observe(document, { subtree: true, childList: true });
    });
    // Its transitions are written against :popover-open, which such a browser drops; reduced motion drops them here.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff/account");
    const more = page.getByRole("button", { name: "More" });
    const avatar = page.getByRole("button", { name: /^Account:/ });
    const menu = page.locator("#staff-menu");
    await expect(menu).not.toHaveAttribute("popover");
    await expect(menu).toBeHidden();
    await more.click();
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(avatar).toHaveAttribute("aria-expanded", "true");
    await more.click();
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await avatar.click();
    await expect(menu).toBeVisible();
    await menu.getByRole("link", { name: "My account" }).click();
    await expect(menu).toBeHidden();
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
  });
});
