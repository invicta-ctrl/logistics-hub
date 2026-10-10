import { expect, test, type Page } from "@playwright/test";

/*
 * V1.15 interaction sweep (mobile/perceived-performance amendment, requirement 5): on the real Worker, as the owner, at a phone and a
 * desktop width, every page's own views, tabs, disclosures, filters, "Show more" buttons and in-page links are used once. Each must
 * do what it says (a view or tab becomes the selected one, a disclosure opens, a filter takes its value, a link arrives where it
 * points, more rows appear) without a script error, a failed request or sideways scroll. The section links, search, bell and
 * account menu are proved by tests/browser/shell.spec.ts; writes and their confirmations by each section's own suite.
 */

const ROUTES = ["/staff/home", "/staff/items", "/staff/stock", "/staff/loans", "/staff/self-service", "/staff/activity", "/staff/attention",
  "/staff/kits", "/staff/locations", "/staff/account", "/staff/admin", "/staff/admin/self-service", "/staff/admin/catalog",
  "/staff/admin/staff", "/staff/admin/directory", "/staff/admin/accountability"];

// The owner administration tests in worker-live replace the owner's password with a recovery key; either one may be current.
async function signIn(page: Page) {
  await page.goto("/staff");
  const origin = new URL(page.url()).origin;
  let signedIn = false;
  for (const secret of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
    signedIn ||= (await page.request.post("/api/staff/login", { headers: { origin }, data: { username: process.env.E2E_OWNER_USERNAME, password: secret } })).ok();
  }
  expect(signedIn).toBe(true);
  await page.goto("/staff/home");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
}

const settle = (page: Page) => page.waitForLoadState("networkidle").catch(() => undefined);
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Visible controls of one kind inside the page (not the bar, not a closed dialog), as stable selectors to come back to. */
const controls = (page: Page, selector: string) => page.evaluate((query) => [...document.querySelectorAll<HTMLElement>(`#main-content ${query}`)]
  .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && !element.closest("dialog:not([open]), [hidden]"); })
  .map((element, index) => { element.dataset.sweep = `${query}-${index}`; return element.dataset.sweep; }), selector);

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`every page's own controls work at ${width} px`, async ({ page }) => {
    test.setTimeout(300_000);
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`script error: ${error.message}`));
    page.on("response", (response) => { if (response.url().includes("/api/") && response.status() >= 500) problems.push(`${response.status()} ${response.url()}`); });
    await page.setViewportSize({ width, height });
    await signIn(page);
    let used = 0;
    for (const route of ROUTES) {
      const open = async () => { await page.goto(route); await settle(page); await expect(page.locator("main h1")).toHaveCount(1); };
      await open();

      // Views (pressed buttons) and tabs: each becomes the selected one. A view strip is redrawn on every press, so each control is
      // found again by its words (its count left out, since counts can change).
      for (const [kind, state] of [["button[aria-pressed]", "aria-pressed"], ["[role=tab]", "aria-selected"]] as const) {
        const names = await page.evaluate((query) => [...new Set([...document.querySelectorAll<HTMLElement>(`#main-content ${query}`)]
          .filter((element) => element.getBoundingClientRect().width > 0 && !element.closest("dialog:not([open]), [hidden]"))
          .map((element) => element.innerText.split("\n")[0]!.replace(/\s*\d[\d,]*$/, "").trim()).filter(Boolean))], kind);
        for (const name of names) {
          const control = page.locator(`#main-content ${kind}`, { hasText: name }).first();
          if (!await control.isVisible() || await control.isDisabled()) continue;
          await control.click();
          await expect(page.locator(`#main-content ${kind}[${state}="true"]`, { hasText: name }).first(), `${route}: ${name}`).toBeVisible();
          used++;
        }
      }
      await open();
      // Disclosures open.
      for (const id of await controls(page, "details > summary")) {
        const control = page.locator(`[data-sweep="${id}"]`);
        await control.click();
        await expect(control.locator(".."), `${route} ${id}`).toHaveAttribute("open", "");
        used++;
      }
      // Filters take each value they offer (the second option, which is never the "All" default).
      for (const id of await controls(page, "select")) {
        const control = page.locator(`[data-sweep="${id}"]`);
        const values = await control.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
        if (values.length < 2) continue;
        await control.selectOption(values[1]!);
        await expect(control, `${route} ${id}`).toHaveValue(values[1]!);
        await settle(page);
        used++;
      }
      await open();
      // "Show more" adds rows.
      for (const id of await controls(page, "button[data-more], button[data-usage-more], .table-more button")) {
        const control = page.locator(`[data-sweep="${id}"]`);
        const rows = await page.locator("#main-content tbody tr, #main-content li").count();
        await control.click();
        await expect.poll(() => page.locator("#main-content tbody tr, #main-content li").count(), `${route} ${id}`).toBeGreaterThan(rows);
        used++;
        break;
      }
      // In-page links to another part of the Hub arrive there.
      const links = await page.evaluate(() => [...new Set([...document.querySelectorAll<HTMLAnchorElement>("#main-content a[data-route][href^='/staff']")]
        .filter((link) => { const box = link.getBoundingClientRect(); return box.width > 0 && box.height > 0 && !link.closest("tbody, .history, .activity-feed, #activity-feed"); })
        .map((link) => link.getAttribute("href")!))]);
      for (const href of links.slice(0, 8)) {
        await open();
        await page.locator(`#main-content a[data-route][href="${href}"]`).first().click();
        const destination = new URL(href, page.url());
        const focusedLoan = destination.pathname === "/staff/loans" ? destination.searchParams.get("loan") : null;
        if (focusedLoan) {
          // Loans consumes this one-time handover after highlighting the exact record.
          await expect(page.locator(`[data-key="${focusedLoan}"].is-focus`), `${route} → loan ${focusedLoan}`).toBeVisible();
          destination.searchParams.delete("loan");
        }
        await expect(page, `${route} → ${href}`).toHaveURL(destination.href);
        await expect(page.locator("main h1")).toHaveCount(1);
        used++;
      }
      await open();
      expect(await sideways(page), `${route} at ${width} px`).toBe(0);
    }
    expect(problems).toEqual([]);
    expect(used).toBeGreaterThan(40);
  });
}
