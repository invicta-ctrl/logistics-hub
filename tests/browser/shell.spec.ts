import { expect, test, type Page } from "@playwright/test";

// The staff shell's icons and labels at the widths, zooms and text sizes staff use (rendered review: docs/visual-research/icons.md).
const session = { authenticated: true, id: "ACC-1", username: "owner.one", displayName: "Owner One", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 3, selfServiceClosed: false };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
});

/** What a person would see as broken: a cut-off label, a squashed icon, sections over each other, a nameless or announced icon, content off the screen. */
const problems = (page: Page) => page.evaluate(() => {
  const shown = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 1 && box.height > 1; };
  const links = [...document.querySelectorAll(".app-nav__link")].filter(shown).map((link) => link.getBoundingClientRect());
  return {
    // The laid-out text, not the box: an ellipsis hides overflow that scrollWidth does not always report.
    cutOff: [...document.querySelectorAll(".app-nav__text, .menu__item")].filter(shown).filter((element) => {
      const box = element.getBoundingClientRect();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const lines: DOMRect[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement!.closest(".visually-hidden")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        lines.push(...range.getClientRects());
      }
      return element.scrollWidth > element.clientWidth + 1 || lines.some((line) => line.width > 0 && (line.left < box.left - 0.5 || line.right > box.right + 0.5));
    }).map((element) => element.textContent?.trim()),
    squashed: [...document.querySelectorAll("svg.icon")].filter(shown).filter((svg) => { const box = svg.getBoundingClientRect(); return Math.abs(box.width - box.height) > 0.5; }).length,
    overlapping: links.slice(1).filter((box, index) => box.left < links[index]!.right - 0.5 && box.top < links[index]!.bottom && box.bottom > links[index]!.top).length,
    // Neighbouring bar labels keep visible space between their text, so "Items Stock" never reads as one word.
    crowded: (() => {
      const texts = [...document.querySelectorAll(".app-nav__text")].filter(shown).map((text) => {
        const range = document.createRange();
        range.selectNodeContents(text.firstChild!);
        const lines = [...range.getClientRects()];
        const box = text.getBoundingClientRect(); // what an ellipsis leaves visible
        return { left: Math.max(box.left, Math.min(...lines.map((line) => line.left))), right: Math.min(box.right, Math.max(...lines.map((line) => line.right))), top: lines[0]!.top };
      });
      return texts.slice(1).filter((text, index) => Math.abs(text.top - texts[index]!.top) < 2 && text.left - texts[index]!.right < 6).length;
    })(),
    announced: [...document.querySelectorAll("svg.icon")].filter((svg) => svg.getAttribute("aria-hidden") !== "true").length,
    unnamed: [...document.querySelectorAll("button, a[href]")].filter((control) => !(control.textContent ?? "").trim() && !control.getAttribute("aria-label")).length,
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // The page clips sideways overflow (overflow-x: clip), so content pushed off a narrow screen never scrolls: count it.
    offscreen: [...document.querySelectorAll("main *")].filter(shown).filter((element) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX)) return false; // a scroller of its own, like the view tabs
      }
      return element.getBoundingClientRect().right > window.innerWidth + 1;
    }).map((element) => element.className || element.tagName)
  };
});
const clean = { cutOff: [], squashed: 0, overlapping: 0, crowded: 0, announced: 0, unnamed: 0, sideways: 0, offscreen: [] };

for (const [width, text] of [[320, ""], [320, "150%"], [375, ""], [414, ""], [375, "150%"], [768, ""], [1024, "150%"], [1440, ""]] as const) {
  test(`staff shell at ${width}px${text ? ` with ${text} text` : ""}: every label in full, square icons, named controls, both menus`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/staff/account");
    await expect(page.locator(".app-bar .account")).toBeVisible();
    if (text) await page.evaluate((size) => document.documentElement.style.setProperty("font-size", size, "important"), text);
    expect(await problems(page), "bar").toEqual(clean);
    const phone = await page.locator(".app-nav__more").isVisible();
    await page.getByRole("button", { name: phone ? "More" : /^Account:/ }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    expect(await problems(page), "menu").toEqual(clean);
    // Every section stays reachable from this layout: in the bar, or in the menu that just opened.
    for (const name of ["Items", "Stock", "Loans", "Self-Service", "Activity", "Administration", "My account", "Public Lending Hub"]) {
      expect(await page.getByRole("link", { name: new RegExp(`^${name}`) }).filter({ visible: true }).count(), name).toBeGreaterThan(0);
    }
  });
}

test("with 200% text on a 320 px phone every section stays on screen, named in full, and More opens the menu", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/staff/account");
  await expect(page.locator(".app-bar .account")).toBeVisible();
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
  // Five labels cannot fit side by side at this size: a label may shorten with an ellipsis, but nothing else may break.
  const { cutOff, ...rest } = await problems(page);
  expect(rest).toEqual({ squashed: 0, overlapping: 0, crowded: 0, announced: 0, unnamed: 0, sideways: 0, offscreen: [] });
  expect(cutOff.length).toBeLessThanOrEqual(5);
  for (const link of await page.locator(".app-nav__link").filter({ visible: true }).all()) {
    const box = (await link.boundingBox())!;
    expect(box.x >= 0 && box.x + box.width <= 320 && box.y + box.height <= 640, await link.innerText()).toBe(true);
  }
  for (const name of ["Items", "Stock", "Loans", "Self-Service"]) await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
});
