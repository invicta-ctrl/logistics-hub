import { expect, test, type Page } from "@playwright/test";

/*
 * V1.16.7, workspace depth slice 3 (docs/specs/accepted/2026-10-29-workspace-depth-slice3-direction.md), on fictional data with the API
 * mocked: every Administration section in the same bands, one confirmation sheet that closes only once the Worker says yes, a section
 * bar that stays put on a phone, and a rail of plates with one lit plate that travels and groups that fold.
 */

const reply = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const status = (assistOn: boolean) => ({
  checkedAt: "2026-10-29T03:00:00.000Z",
  build: { version: "test-build", commit: null, builtAt: "2026-10-29T01:00:00.000Z", migrations: [], product: { version: "V1.16.7", sourceCommit: "abc", changes: ["One change."] } },
  database: { ok: true, ms: 12, migrations: { applied: 1, latest: "0001_init.sql", latestAppliedAt: null, pending: [] } },
  storage: [{ id: "EVIDENCE", label: "Loan photos", holds: "Photos taken when something is lent.", ok: true, ms: 9 }],
  selfService: "open",
  assist: { on: assistOn, available: true, neuronsToday: 120, band: "NORMAL", stopAt: 9500 },
  cleanup: { on: false, available: true, sentThisMonth: 0, monthlyCap: 500 }
});

async function admin(page: Page, options: { closed?: boolean } = {}) {
  const session = { authenticated: true, id: "ACC-1", username: "owner.one", displayName: "Owner One", role: "OWNER", access: "OWNER", hub: true, mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: options.closed ?? false, directory: null };
  await page.route("**/api/staff/session", (route) => route.fulfill(reply(session)));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill(reply({ needsAction: 0, bySource: {} })));
  await page.route("**/api/staff/admin/activity", (route) => route.fulfill(reply({ events: [] })));
  await page.route("**/api/staff/admin/accounts", (route) => route.fulfill(reply({ accounts: [
    { id: "ACC-1", username: "owner.one", displayName: "Owner One", role: "OWNER", access: "OWNER", active: true, mustChangePassword: false, createdAt: "2026-01-01T00:00:00.000Z", lastLoginAt: null, openSessions: 1 },
    { id: "ACC-2", username: "staff.two", displayName: "Staff Two", role: "STAFF", access: "DoL", active: true, mustChangePassword: true, createdAt: "2026-01-01T00:00:00.000Z", lastLoginAt: null, openSessions: 0 }
  ] })));
  await page.route("**/api/staff/admin/retention", (route) => route.fulfill(reply({ loans: 2, phoneRecords: 0, photos: 2 })));
  await page.route("**/api/staff/admin/catalog", (route) => route.fulfill(reply({ active: 10, unclassified: 3, captured: 0, capturedClassified: 0 })));
  await page.route("**/api/staff/admin/catalog/aliases*", (route) => route.fulfill(reply({ items: [], more: false })));
  await page.route("**/api/staff/admin/catalog/proposals", (route) => route.fulfill(reply({ proposals: [], metrics: [] })));
  await page.route("**/api/staff/catalogue", (route) => route.fulfill(reply({ session: null })));
  return session;
}

test("every section opens with its verdict in words, and what waits for a decision has its own button", async ({ page }) => {
  await admin(page);
  let assistOn = true;
  await page.route("**/api/staff/admin/system", (route) => route.fulfill(reply(status(assistOn))));
  await page.goto("/staff/admin");
  await expect(page.locator(".verdict--ok")).toContainText("Everything checked is working.");
  await expect(page.locator(".decision-row")).toHaveCount(0);
  // Each setting is one row ending in a Change button, never a bare link.
  for (const row of await page.locator(".setting-row").all()) await expect(row.locator(".setting-row__action > a.text-link")).toHaveCount(0);

  await page.locator(".admin-tabs a[href='/staff/admin/catalog']").click();
  await expect(page.locator(".verdict--warn")).toContainText("3 active items are not classified yet.");
  await expect(page.locator(".decision-row")).toContainText("3 unclassified items");
  await expect(page.locator(".decision-row").getByRole("link", { name: "Show them in Items" })).toHaveClass(/button/);
  // The heading stays put: moving between sections redraws the bands only.
  await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();

  await page.locator(".admin-tabs a[href='/staff/admin/accountability']").click();
  await expect(page.locator(".verdict--warn")).toContainText("Old personal details are ready to remove.");
  await expect(page.locator(".decision-row").getByRole("button", { name: "Remove" })).toBeVisible();

  await page.locator(".admin-tabs a[href='/staff/admin/staff']").click();
  await expect(page.locator(".verdict--warn")).toContainText("2 accounts, all active.");
  await expect(page.locator(".verdict--warn")).toContainText("One person must still set a password");
  void assistOn;
});

test("a change opens one sheet saying now and after, who it reaches and whether it can be undone; it closes only once the Worker said yes", async ({ page }) => {
  await admin(page);
  let assistOn = true;
  let answer: "hold" | "refuse" | "ok" = "refuse";
  let release: () => void = () => undefined;
  await page.route("**/api/staff/admin/system", (route) => route.fulfill(reply(status(assistOn))));
  await page.route("**/api/staff/admin/assist", async (route) => {
    if (answer === "refuse") return route.fulfill(reply({ error: "Only the owner can change this." }, 403));
    await new Promise<void>((resolve) => { release = resolve; });
    assistOn = (route.request().postDataJSON() as { on: boolean }).on;
    return route.fulfill(reply({ on: assistOn }));
  });
  await page.goto("/staff/admin");
  const row = page.locator("[data-setting=assist]");
  await expect(row.locator(".setting-row__value")).toContainText("On");
  await row.getByRole("button", { name: "Change AI suggestions" }).click();
  const sheet = page.getByRole("dialog", { name: "Turn off AI suggestions?" });
  await expect(sheet.locator(".impact-change__now")).toHaveText("On");
  await expect(sheet.locator(".impact-change__after")).toHaveText("Off");
  await expect(sheet.locator(".impact-who li")).toHaveCount(2);
  await expect(sheet.locator(".impact-undo")).toContainText("turn it back on");
  await expect(sheet.getByRole("button", { name: "Cancel" })).toBeFocused();

  // A refusal stays in the sheet with the Worker's reason, and nothing changes on the page.
  await sheet.getByRole("button", { name: "Turn off" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Only the owner can change this.");
  await expect(row.locator(".setting-row__value")).toContainText("On");

  // While the Worker is asked, the button says so and the sheet stays; once it says yes, the sheet closes and the value changes.
  answer = "hold";
  const confirm = sheet.getByRole("button", { name: "Turn off" });
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveAttribute("aria-busy", "true");
  await expect(sheet).toBeVisible();
  await expect(row.locator(".setting-row__value")).toContainText("On");
  release();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator("[data-setting=assist] .setting-row__value")).toContainText("Off");
});

test("on a phone the sections are one fixed bar of five cells that never scrolls sideways, and wraps rather than cuts at large text", async ({ page }) => {
  await admin(page, { closed: true });
  await page.route("**/api/staff/admin/system", (route) => route.fulfill(reply(status(true))));
  await page.route((url) => url.pathname === "/self-service", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>test</title>" }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff/admin/self-service");
  const bar = page.getByRole("navigation", { name: "Administration" });
  const cells = bar.getByRole("link");
  await expect(cells).toHaveCount(5);
  // The short word is shown; the link keeps the section's full name.
  await expect(bar.getByRole("link", { name: /Accountability/ })).toContainText("Records");
  const layout = () => page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".admin-tabs")!;
    const links = [...nav.querySelectorAll<HTMLElement>(".admin-tabs__link")];
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, bar: nav.scrollWidth - nav.clientWidth, rows: new Set(links.map((link) => link.offsetTop)).size, cut: links.filter((link) => link.scrollWidth > link.clientWidth + 1).length, position: getComputedStyle(nav).position };
  });
  expect(await layout()).toEqual({ page: 0, bar: 0, rows: 1, cut: 0, position: "sticky" });
  // The decision is a button; the verdict says closed in words.
  await expect(page.locator(".verdict--warn")).toContainText("Self-Service is closed for maintenance.");
  await expect(page.locator(".decision-row").getByRole("button", { name: "Reopen" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect.poll(async () => (await layout()).rows).toBe(2);
  const large = await layout();
  expect(large.page).toBe(0);
  expect(large.bar).toBe(0);
  expect(large.cut).toBe(0);
  // Two rows would hold a third of the screen: the wrapped bar scrolls with the page.
  expect(large.position).toBe("relative");
});

test("the rail: plates, one lit plate that travels to the new page, and groups that fold, kept on this device", async ({ page }) => {
  await admin(page);
  await page.route("**/api/staff/admin/system", (route) => route.fulfill(reply(status(true))));
  await page.route("**/api/staff/activity*", (route) => route.fulfill(reply({ events: [], nextCursor: null })));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/staff/admin");
  const lit = page.locator(".rail-lit");
  await expect(lit).toHaveCount(1);
  await expect(page.locator(".app-nav__link[aria-current] > .rail-lit")).toHaveCount(1);
  expect(await page.locator(".app-nav__link[aria-current]").first().textContent()).toContain("Administration");
  // The plate is decoration: hidden from assistive technology, while aria-current marks the page.
  await expect(lit).toHaveAttribute("aria-hidden", "true");

  await page.locator(".app-nav a[href='/staff/activity']").click();
  await expect(page).toHaveURL(/\/staff\/activity$/);
  await expect(page.locator(".rail-lit")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.querySelector(".rail-lit")!.parentElement!.textContent!.trim())).toBe("Activity");

  const fold = page.getByRole("button", { name: "Circulation" });
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".app-nav a[href='/staff/loans']")).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Circulation" })).toHaveAttribute("aria-expanded", "false");
  // Opening a page in a folded group opens it again.
  await page.goto("/staff/admin");
  await page.getByRole("button", { name: "Manage" }).click();
  await page.goto("/staff/admin/catalog");
  await expect(page.getByRole("button", { name: "Manage" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Circulation" }).click();
  await expect(page.locator(".app-nav a[href='/staff/loans']")).toBeVisible();
});

test("the two continuous lights rest while the tab is hidden, and reduced motion keeps none of them", async ({ page }) => {
  await admin(page);
  await page.route("**/api/staff/admin/system", (route) => route.fulfill(reply(status(true))));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/staff/admin");
  await expect(page.locator(".tag--live").first()).toBeVisible();
  const glint = () => page.evaluate(() => {
    const live = document.querySelector(".tag--live")!;
    return { light: getComputedStyle(document.querySelector(".rail-lit")!, "::after").animationName, lightState: getComputedStyle(document.querySelector(".rail-lit")!, "::after").animationPlayState, dot: getComputedStyle(live, "::before").animationName, dotState: getComputedStyle(live, "::before").animationPlayState };
  });
  expect(await glint()).toEqual({ light: "rail-glint", lightState: "running", dot: "dot-breathe", dotState: "running" });
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(await glint()).toEqual({ light: "rail-glint", lightState: "paused", dot: "dot-breathe", dotState: "paused" });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".tag--live").first()).toBeVisible();
  const still = await glint();
  expect(still.light).toBe("none");
  expect(still.dot).toBe("none");
});
