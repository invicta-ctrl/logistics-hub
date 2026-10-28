import { expect, test, type Page } from "@playwright/test";

/*
 * Home and Attention (LH-IP02-S01; V1.16.4 §4.1) on fictional data with the API mocked. Home is four groups: what needs attention, three
 * entries a reason with the way to the rest; what can wait, as its reasons; your own next actions; and Insights, closed until asked for
 * and able to fail without holding anything up. Attention is the queue, with the record document and its place in history.
 */

const session = (role: "OWNER" | "STAFF") => ({ authenticated: true, id: `ACC-${role}`, username: `${role.toLowerCase()}.sample`, displayName: `${role === "OWNER" ? "Owner" : "Staff"} Sample`, role, access: "DoL", hub: true, mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false, directory: null });

type Group = { reason: string; source: string; label: string; total: number; byUrgency: { NOW: number; SOON: number; LATER: number } };
const group = (reason: string, source: string, label: string, now: number, soon: number, later = 0): Group => ({ reason, source, label, total: now + soon + later, byUrgency: { NOW: now, SOON: soon, LATER: later } });
const BUSY: Group[] = [
  group("LOAN_OVERDUE", "Loans", "Overdue loans", 3, 0), group("RETURN_PROBLEM", "Loans", "Damaged or lost returns", 0, 1), group("STOCK_OUT", "Stock", "Out of stock", 2, 4, 6),
  group("STOCK_LOW", "Stock", "Low stock", 0, 5), group("KIT_REPLENISH", "Kits", "Kits to replenish", 0, 2), group("CLASSIFY", "Catalog", "Items to classify", 0, 0, 12), group("NO_PLACE", "Catalog", "Items without a place", 0, 0, 3),
  group("FINDING", "Locations", "Check findings to settle", 0, 0), group("PHONE_RECORD", "Self-Service", "Phone records to check", 0, 0)
];
const summaryOf = (groups: Group[]) => {
  const bySource: Record<string, number> = { Loans: 0, Stock: 0, Locations: 0, Kits: 0, Catalog: 0, "Self-Service": 0 };
  for (const entry of groups) bySource[entry.source]! += entry.byUrgency.NOW + entry.byUrgency.SOON;
  return { needsAction: Object.values(bySource).reduce((sum, count) => sum + count, 0), bySource, groups };
};
/** One fictional entry for every count in the groups, so the queue lists exactly what the numbers say. */
const entriesOf = (groups: Group[]) => groups.flatMap((entry) => (["NOW", "SOON", "LATER"] as const).flatMap((urgency) => Array.from({ length: entry.byUrgency[urgency] }, (_, index) => ({
  key: `${entry.reason}:${urgency}-${index + 1}`, reason: entry.reason, source: entry.source, urgency, title: `${entry.label} ${urgency.toLowerCase()} ${index + 1}`, why: `Sample reason for ${entry.label.toLowerCase()}.`,
  since: null, href: `/staff/items?item=ITM-${entry.reason}-${index + 1}`, action: "Open the item" }))));
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const INSIGHTS = {
  asOf: new Date().toISOString(),
  cards: [
    { id: "borrowed", title: "What equipment is borrowed most?", window: "Last 90 days", rule: "Items lent at least twice.", rows: [{ name: "Projector - portable", href: "/staff/items?item=ITM-0001", evidence: "Lent 9 times; the latest on 3 Oct." }, { name: "Extension cord", href: "/staff/items?item=ITM-0002", evidence: "Lent 4 times; the latest on 28 Sep." }] },
    { id: "short", title: "What keeps running short?", window: "Last 90 days", rule: "Items with a restock requested at least twice.", advisory: true, rows: [{ name: "Bond paper A4", href: "/staff/items?item=ITM-0003", evidence: "A restock was requested 3 times; the latest on 1 Oct. The reorder level is 5." }] },
    { id: "reports", title: "Where do people keep failing to find things?", window: "Last 90 days", rule: "Places with at least two reports.", rows: [{ name: "Sample Office › Cabinet 1", href: "/staff/locations?place=LOC-2", evidence: "4 reports about 3 items: 3 could not find it, 1 said the place looks wrong." }] }
  ],
  completeness: { id: "completeness", title: "How complete is the catalog?", window: "Today", rule: "Active items only.", rows: [
    { name: "Sorted into how they are used", have: 468, of: 480, gap: 12, href: "/staff/attention?reason=CLASSIFY", gapText: "to classify" },
    { name: "Sorted items with a place", have: 465, of: 468, gap: 3, href: "/staff/attention?reason=NO_PLACE", gapText: "without a place" }] }
};
const NOTHING = { asOf: new Date().toISOString(), cards: [], completeness: { ...INSIGHTS.completeness, rows: INSIGHTS.completeness.rows.map((row) => ({ ...row, have: row.of, gap: 0 })) } };
const NO_WORK = { catalogue: null, checks: [] };
const WORK = {
  catalogue: { id: "CS-00000000-0000-4000-8000-000000000001", place: "Sample Office › Cabinet 1", saved: 14, startedAt: daysAgo(1), updatedAt: daysAgo(0) },
  checks: [{ id: "LA-00000000-0000-4000-9000-000000000001", place: "Storeroom", status: "PAUSED", expected: 38, startedAt: daysAgo(3), updatedAt: daysAgo(2) }]
};

type Setup = { role?: "OWNER" | "STAFF"; groups?: Group[]; work?: unknown; insights?: unknown; insightsStatus?: number };
async function setup(page: Page, { role = "STAFF", groups = BUSY, work = NO_WORK, insights = INSIGHTS, insightsStatus = 200 }: Setup = {}) {
  const asked = { queue: 0, insights: 0, summary: 0 };
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session(role)) }));
  await page.route("**/api/staff/attention/summary", (route) => { asked.summary += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify(summaryOf(groups)) }); });
  await page.route("**/api/staff/attention", (route) => { asked.queue += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ today: "2026-10-23", groups, entries: entriesOf(groups) }) }); });
  await page.route("**/api/staff/home", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(work) }));
  await page.route("**/api/staff/home/insights", (route) => {
    asked.insights += 1;
    return insightsStatus === 200 ? route.fulfill({ contentType: "application/json", body: JSON.stringify(insights) }) : route.fulfill({ status: insightsStatus, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong." }) });
  });
  await page.route("**/api/staff/search", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, places: [], items: [], kits: [], links: [] }) }));
  return asked;
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const sections = (page: Page) => page.getByRole("navigation", { name: "Sections" });
/** Opens Insights, which asks for nothing until it is opened. */
const openInsights = (page: Page) => page.locator("#home-insights-box > summary").click();

test.describe("Home", () => {
  test("is four groups: what needs attention, three a reason with its true total; what can wait, as its reasons; next actions; insights", async ({ page }) => {
    const asked = await setup(page, { work: WORK });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.locator(".home-reason").first()).toBeVisible();
    await expect(page.locator("main h2")).toHaveText(["Needs attention", "When there is time", "Next actions", "Insights"]);
    // 3 overdue + 1 return + (2 + 4) out + 5 low + 2 kits: the routine ones (6 out, 12 to classify, 3 without a place) are not counted.
    await expect(page.locator(".app-bell")).toContainText("17 things need attention");
    await expect(page.locator("#home-lede")).toContainText("17 things to act on.");
    // Reasons with something for now lead; within that, the server's order.
    await expect(page.locator(".home-reason h3")).toHaveText(["Overdue loans", "Out of stock", "Damaged or lost returns", "Low stock", "Kits to replenish"]);
    const out = page.getByRole("region", { name: "Out of stock" });
    await expect(out.locator(".home-row")).toHaveCount(3);
    await expect(out.locator(".home-row__title")).toHaveText(["Out of stock now 1", "Out of stock now 2", "Out of stock soon 1"]);
    await expect(out.locator(".home-row").first()).toHaveAttribute("href", "/staff/items?item=ITM-STOCK_OUT-1");
    await expect(out.locator(".home-row").first()).toContainText("Sample reason for out of stock.");
    await expect(out.locator(".home-row").first()).toContainText("Open the item");
    // "View all" names the reason's true total, routine entries included, and opens the queue on that reason.
    await expect(out.getByRole("link", { name: "View all 12 out of stock" })).toHaveAttribute("href", "/staff/attention?reason=STOCK_OUT");
    await expect(page.getByRole("region", { name: "Damaged or lost returns" }).locator(".home-row")).toHaveCount(1);
    // No invented time bucket.
    await expect(page.locator("main")).not.toContainText("Today");
    await expect(page.locator("main")).not.toContainText("This week");
    const later = page.getByRole("list", { name: "When there is time" }).getByRole("link");
    await expect(later.locator(".home-later__label")).toHaveText(["Out of stock", "Items to classify", "Items without a place"]);
    await expect(later.locator(".home-later__count")).toHaveText(["6", "12", "3"]);
    await expect(later.nth(1)).toHaveAttribute("href", "/staff/attention?reason=CLASSIFY&urgency=LATER");
    expect(await sideways(page)).toBe(0);
    // One queue poll, and Home never asks for the summary or Insights on its own.
    expect(asked).toEqual({ queue: 1, insights: 0, summary: 0 });

    await out.getByRole("link", { name: "View all 12 out of stock" }).click();
    await expect(page).toHaveURL(/\/staff\/attention\?reason=STOCK_OUT$/);
    await expect(page.locator("#attn-only")).toContainText("Showing only Out of stock.");
    await page.goBack();
    await page.getByRole("list", { name: "When there is time" }).getByRole("link", { name: /^Items without a place/ }).click();
    await expect(page).toHaveURL(/\/staff\/attention\?reason=NO_PLACE&urgency=LATER$/);
    await expect(page.locator("#attn-count")).toHaveText("3 when there is time");
  });

  test("is calm when nothing needs a person", async ({ page }) => {
    await setup(page, { groups: BUSY.map((entry) => ({ ...entry, total: 0, byUrgency: { NOW: 0, SOON: 0, LATER: 0 } })) });
    await page.goto("/staff/home");
    await expect(page.getByRole("heading", { name: "Nothing needs a person right now" })).toBeVisible();
    await expect(page.locator(".home-row")).toHaveCount(0);
    await expect(page.locator("#home-later")).toBeHidden();
    await expect(page.locator("#home-continue")).toBeHidden();
    await expect(page.locator(".app-bell")).not.toContainText("attention");
    await expect(page.locator("#home-lede")).toContainText("Nothing needs a person right now.");
  });

  test("Home and Attention each poll the queue once and take the bar's numbers from it: no summary request, Home current on both", async ({ page }) => {
    const asked = await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await expect(page.locator(".home-row").first()).toBeVisible();
    await expect(sections(page).getByRole("link", { name: /^Home/ })).toHaveAttribute("aria-current", "page");
    // 6 out and 5 low to act on: the same NOW and SOON stock reasons as the bell's Stock source.
    await expect(sections(page).getByRole("link", { name: /^Low & out of stock/ })).toContainText("11 need attention");
    await page.locator(".app-bell").click();
    await expect(page).toHaveURL(/\/staff\/attention$/);
    await expect(page.getByRole("heading", { level: 1, name: "Attention" })).toBeVisible();
    await expect(sections(page).getByRole("link", { name: /^Home/ })).toHaveAttribute("aria-current", "page");
    // Attention opens on everything, routine work included.
    await expect(page.getByRole("heading", { level: 4, name: "Items to classify" })).toBeVisible();
    await expect(page.locator("#attn-count")).toHaveText("17 to act on · 21 when there is time");
    await expect(page.locator("#ws-today")).toBeVisible();
    await expect(page.locator(".app-bell")).toContainText("17 things need attention");
    expect(asked).toEqual({ queue: 2, insights: 0, summary: 0 });
  });

  test("next actions resume open physical checks in Locations, while cataloguing stays in Quick Catalog", async ({ page }) => {
    await setup(page, { work: { catalogue: WORK.catalogue, checks: [] } });
    await page.goto("/staff/home");
    await expect(page.getByRole("heading", { level: 2, name: "Needs attention" })).toBeVisible();
    await expect(page.locator(".home-row").first()).toBeVisible();
    await expect(page.locator("#home-continue")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Next actions" })).toBeHidden();

    const other = await page.context().newPage();
    await setup(other, { work: WORK });
    await other.goto("/staff/home");
    const resume = other.locator("#home-continue .home-row");
    await expect(resume).toHaveCount(1);
    await expect(resume.first()).toHaveAttribute("href", "/staff/locations?check=LA-00000000-0000-4000-9000-000000000001");
    await expect(resume.first()).toContainText("Paused · 38 items expected");
  });

  test("Insights ask for nothing until opened, then show each insight with its evidence and its window and rule one press away", async ({ page }) => {
    const asked = await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await expect(page.locator(".home-row").first()).toBeVisible();
    await expect(page.locator("#home-insights-box")).not.toHaveAttribute("open");
    await expect(page.getByRole("article", { name: "What equipment is borrowed most?" })).toBeHidden();
    expect(asked.insights).toBe(0);
    await openInsights(page);
    const borrowed = page.getByRole("article", { name: "What equipment is borrowed most?" });
    await expect(borrowed.getByRole("link", { name: "Projector - portable" })).toHaveAttribute("href", "/staff/items?item=ITM-0001");
    await expect(borrowed).toContainText("Lent 9 times; the latest on 3 Oct.");
    await expect(borrowed.getByText("Last 90 days · Items lent at least twice.")).toBeHidden();
    await borrowed.getByRole("button", { name: "About this insight" }).click();
    await expect(borrowed.getByRole("button", { name: "About this insight" })).toHaveAttribute("aria-expanded", "true");
    await expect(borrowed.getByText("Last 90 days · Items lent at least twice.")).toBeVisible();
    await expect(page.locator("#home-insights-asof")).toHaveText(/^Updated /);
    await expect(borrowed).not.toContainText("Advice only");
    await expect(page.getByRole("article", { name: "What keeps running short?" })).toContainText("Advice only. Nothing is ordered or changed from here.");
    // The catalog-completeness card duplicated the queue's own counts, so it is gone.
    await expect(page.getByRole("article", { name: "How complete is the catalog?" })).toHaveCount(0);
    // Closing and opening again asks nothing more.
    await openInsights(page);
    await openInsights(page);
    expect(asked.insights).toBe(1);
    expect(await sideways(page)).toBe(0);
  });

  test("says so, and keeps working, when nothing repeats", async ({ page }) => {
    await setup(page, { insights: NOTHING });
    await page.goto("/staff/home");
    await openInsights(page);
    await expect(page.getByText("Nothing is repeating enough to show.")).toBeVisible();
  });

  test("a failing insight query stays inside Insights, leaves everything else working, and can be tried again", async ({ page }) => {
    const asked = await setup(page, { insightsStatus: 500 });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await openInsights(page);
    await expect(page.locator("#home-insights")).toContainText("Insights could not be loaded.");
    // What needs attention is untouched, and so is the navigation.
    await expect(page.locator(".home-reason h3").first()).toHaveText("Overdue loans");
    await page.route("**/api/staff/home/insights", (route) => { asked.insights += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify(INSIGHTS) }); });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("article", { name: "What equipment is borrowed most?" })).toBeVisible();
    expect(asked.insights).toBe(2);
    await sections(page).getByRole("link", { name: /^Loans/ }).click();
    await expect(page).toHaveURL(/\/staff\/loans$/);
  });

  test("opened as /staff/home/ it still says when insights fail, and shows them when tried again", async ({ page }) => {
    const asked = await setup(page, { insightsStatus: 500 });
    await page.goto("/staff/home/");
    await openInsights(page);
    await expect(page.locator("#home-insights")).toContainText("Insights could not be loaded.");
    await page.route("**/api/staff/home/insights", (route) => { asked.insights += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify(INSIGHTS) }); });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("article", { name: "What equipment is borrowed most?" })).toBeVisible();
    await expect(page.locator("#home-insights")).not.toHaveAttribute("aria-busy");
    expect(asked.insights).toBe(2);
  });

  test("a held optional insight does not block navigation or expire a newer screen", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const asked = new Promise<void>((resolve) => { started = resolve; });
    await page.route("**/api/staff/home/insights", async (route) => {
      started(); await held;
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Old session expired." }) });
    });
    try {
      await page.goto("/staff/home");
      await openInsights(page);
      await asked;
      await expect(page.locator(".home-reason h3").first()).toHaveText("Overdue loans");
      await sections(page).getByRole("link", { name: /^Loans/ }).click();
      await expect(page).toHaveURL(/\/staff\/loans$/);
      const reply = page.waitForResponse((response) => response.url().endsWith("/api/staff/home/insights") && response.status() === 401);
      release();
      await (await reply).finished();
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/staff\/loans$/);
      await page.route("**/api/staff/home/insights", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(INSIGHTS) }));
      await page.getByRole("link", { name: /Logistics Hub/ }).first().click();
      await openInsights(page);
      await expect(page.getByRole("article", { name: "What equipment is borrowed most?" })).toBeVisible();
    } finally { release(); }
  });

  test("the logo and the menu come back here, and an unknown staff address lands here", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/stock");
    await page.getByRole("link", { name: /Logistics Hub/ }).first().click();
    await expect(page).toHaveURL(/\/staff\/home$/);
    await expect(sections(page).getByRole("link", { name: /^Home/ })).toHaveAttribute("aria-current", "page");
    await page.goto("/staff/nowhere");
    await expect(page).toHaveURL(/\/staff\/home$/);
  });

  test("an old Home address carrying the queue's keys opens the queue on the same records", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home?reason=STOCK_OUT");
    await expect(page).toHaveURL(/\/staff\/attention\?reason=STOCK_OUT$/);
    await expect(page.locator("#attn-only")).toContainText("Showing only Out of stock.");
    await page.goto("/staff/home?entry=LOAN_OVERDUE%3ANOW-1");
    await expect(page).toHaveURL(/\/staff\/attention\?entry=LOAN_OVERDUE%3ANOW-1$/);
    await expect(page.locator("#attn-doc").getByRole("heading", { level: 2, name: "Overdue loans now 1" })).toBeVisible();
  });

  for (const [name, width, height] of [["phone", 390, 844], ["narrow phone", 320, 640], ["tablet", 768, 1024]] as const) {
    test(`fits a ${name} with no sideways scroll, in the order needs attention, when there is time, next actions, insights`, async ({ page }) => {
      await setup(page, { work: WORK });
      await page.setViewportSize({ width, height });
      await page.goto("/staff/home");
      await expect(page.locator(".home-row").first()).toBeVisible();
      await expect(page.locator("#home-continue")).toBeVisible();
      expect(await sideways(page)).toBe(0);
      const tops = await page.evaluate(() => ["#home-attn", "#home-later", "#home-continue", "#home-insights-box"].map((selector) => document.querySelector(selector)!.getBoundingClientRect().top));
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      // On phones what can wait is one row that scrolls inside itself (kept from V1.16.3); the page never does.
      const row = await page.locator("#home-later-list").evaluate((list) => ({ wraps: getComputedStyle(list).flexWrap, scroll: getComputedStyle(list).overflowX }));
      expect(row).toEqual(width < 761 ? { wraps: "nowrap", scroll: "auto" } : { wraps: "wrap", scroll: "visible" });
    });
  }
});

test.describe("The record document", () => {
  test("opens beside the queue with what the entry carries, its source link, and one history entry that Back closes", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/attention");
    await page.getByRole("button", { name: /^Overdue loans now 1/ }).click();
    await expect(page).toHaveURL(/\/staff\/attention\?entry=LOAN_OVERDUE%3ANOW-1$/);
    const doc = page.locator("#attn-doc");
    await expect(doc.getByRole("heading", { level: 2, name: "Overdue loans now 1" })).toBeVisible();
    await expect(doc).toContainText("Now · Overdue loans");
    await expect(doc).toContainText("Sample reason for overdue loans.");
    await expect(doc.getByRole("link", { name: /Open the item/ })).toHaveAttribute("href", "/staff/items?item=ITM-LOAN_OVERDUE-1");
    await expect(page.locator("#ws-today")).toBeHidden();
    await expect(page.locator(".attn-row.is-selected")).toHaveCount(1);
    // Next moves the selection and replaces the history entry, so one Back still closes the document.
    await doc.getByRole("button", { name: "Next entry" }).click();
    await expect(page).toHaveURL(/entry=LOAN_OVERDUE%3ANOW-2$/);
    await expect(doc.getByRole("heading", { level: 2, name: "Overdue loans now 2" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/staff\/attention$/);
    await expect(doc).toBeHidden();
    await expect(page.locator("#ws-today")).toBeVisible();
  });

  test("the queue is one tab stop: arrows move, Enter opens, moving moves the selection, and Escape closes and returns focus", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/attention");
    const rows = page.locator(".attn-row__main");
    await expect(rows.first()).toBeVisible();
    expect(await rows.evaluateAll((buttons) => buttons.filter((button) => (button as HTMLElement).tabIndex === 0).length)).toBe(1);
    await rows.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(rows.last()).toBeFocused();
    await page.keyboard.press("Home");
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#attn-doc")).toBeVisible();
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/entry=LOAN_OVERDUE%3ANOW-2$/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#attn-doc")).toBeHidden();
    await expect(page).toHaveURL(/\/staff\/attention$/);
    await expect(rows.nth(1)).toBeFocused();
  });

  test("on a phone it opens as a sheet that Back and Close both put away", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff/attention");
    await page.getByRole("button", { name: /^Overdue loans now 1/ }).click();
    const sheet = page.getByRole("dialog", { name: "Overdue loans now 1" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: /Open the item/ })).toBeVisible();
    expect(await sideways(page)).toBe(0);
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/staff\/attention$/);
    await page.getByRole("button", { name: /^Low stock soon 1/ }).click();
    await page.getByRole("dialog", { name: "Low stock soon 1" }).getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/staff\/attention$/);
  });

  test("a link to an entry opens it, and one that no longer exists is let go quietly", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/attention?entry=STOCK_OUT%3ALATER-2");
    await expect(page.locator("#attn-doc").getByRole("heading", { level: 2, name: "Out of stock later 2" })).toBeVisible();
    await page.goto("/staff/attention?entry=LOAN_OVERDUE%3ANOW-404");
    await expect(page.locator("#attn-count")).toHaveText("17 to act on · 21 when there is time");
    await expect(page).toHaveURL(/\/staff\/attention$/);
    await expect(page.locator("#attn-doc")).toBeHidden();
  });
});

test.describe("Home accessibility", () => {
  test("one heading, named controls and links, a list for every set of rows, no sideways scroll and room for 200% text", async ({ page }) => {
    await setup(page, { work: WORK, role: "OWNER" });
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/staff/home");
      await expect(page.locator(".home-row").first()).toBeVisible();
      await openInsights(page);
      await expect(page.getByRole("article", { name: "What equipment is borrowed most?" })).toBeVisible();
      await expect(page.locator("main h1")).toHaveCount(1);
      const problems = await page.evaluate(() => ({
        unnamed: [...document.querySelectorAll("main button, main a[href], main summary")].filter((control) => !(control.textContent ?? "").trim() && !control.getAttribute("aria-label")).length,
        loose: [...document.querySelectorAll("main .home-row, main .home-later")].filter((row) => !row.closest("li")).length
      }));
      expect(problems, `${width}px`).toEqual({ unnamed: 0, loose: 0 });
      expect(await sideways(page), `${width}px`).toBe(0);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
    expect(await sideways(page)).toBe(0);
  });
});

test.describe("Attention, from Home", () => {
  const entry = (reason: string, source: string, title: string) => ({ key: `${reason}:${title}`, reason, source, urgency: "NOW", title, why: "Why.", since: null, href: "/staff/items", action: "Open" });
  test("opens one kind alone, says so, and lifts it with Show everything", async ({ page }) => {
    await setup(page);
    await page.route("**/api/staff/attention", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ today: "2026-10-07", groups: BUSY, entries: [entry("LOAN_OVERDUE", "Loans", "Projector"), entry("STOCK_OUT", "Stock", "Tape"), entry("CLASSIFY", "Catalog", "Marker")] }) }));
    await page.goto("/staff/attention?reason=STOCK_OUT");
    await expect(page.locator("#attn-only")).toContainText("Showing only Out of stock.");
    await expect(page.getByRole("heading", { level: 4, name: "Out of stock" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 4, name: "Overdue loans" })).toHaveCount(0);
    await page.getByRole("button", { name: "Show everything" }).click();
    await expect(page.getByRole("heading", { level: 4, name: "Overdue loans" })).toBeVisible();
    await expect(page.locator("#attn-only")).toBeHidden();
    await expect(page).not.toHaveURL(/reason=/);
  });
});
