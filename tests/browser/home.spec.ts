import { expect, test, type Page } from "@playwright/test";

/*
 * Home and Attention as one workspace (LH-IP02-S01) on fictional data with the API mocked: what needs a person (the bell's own
 * numbers), the reasons that filter the queue in place, the record document and its place in history, your unfinished work, and
 * insights that can fail without holding anything up.
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
  const asked = { queue: 0, insights: 0 };
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session(role)) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(summaryOf(groups)) }));
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

test.describe("Home", () => {
  test("shows what needs a person with the bell's numbers, most urgent first, and each reason filters the queue in place", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    // 3 overdue + 1 return + (2 + 4) out + 5 low + 2 kits: the routine ones (12 to classify, 3 without a place) are not counted.
    await expect(page.locator(".app-bell")).toContainText("17 things need attention");
    await expect(page.locator("#home-lede")).toContainText("17 things to act on today or this week.");
    await expect(page.locator("#attn-count")).toHaveText("17 to act on");
    const reasons = page.locator("#attn-reasons .attn-reason");
    await expect(reasons.locator(".attn-reason__label")).toHaveText(["Overdue loans", "Out of stock", "Damaged or lost returns", "Low stock", "Kits to replenish", "Items to classify", "Items without a place"]);
    await expect(reasons.locator(".attn-reason__count")).toHaveText(["3", "6", "1", "5", "2", "12", "3"]);
    // Home opens on today and this week: routine work waits behind its own reasons.
    await expect(page.getByRole("heading", { name: "Items to classify" })).toHaveCount(0);

    // A reason shows exactly the set its count describes, without leaving Home.
    await page.locator("#attn-reasons").getByRole("button", { name: /^Out of stock/ }).click();
    await expect(page).toHaveURL(/\/staff\/home\?reason=STOCK_OUT$/);
    await expect(page.locator("#attn-only")).toContainText("Showing only Out of stock.");
    await expect(page.locator("#attn-count")).toHaveText("6 to act on");
    await expect(page.getByRole("heading", { level: 4, name: "Overdue loans" })).toHaveCount(0);
    await expect(page.locator("#attn-reasons").getByRole("button", { name: /^Out of stock/ })).toHaveAttribute("aria-pressed", "true");
    // A routine reason shows its work for when there is time.
    await page.locator("#attn-reasons").getByRole("button", { name: /^Items without a place/ }).click();
    await expect(page).toHaveURL(/urgency=LATER/);
    await expect(page.locator("#attn-count")).toHaveText("3 when there is time");
    await page.getByRole("button", { name: "Show everything" }).click();
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page).toHaveURL(/\/staff\/home$/);
    await expect(page.locator("#attn-count")).toHaveText("17 to act on");
    expect(await sideways(page)).toBe(0);
  });

  test("is calm when nothing needs a person", async ({ page }) => {
    await setup(page, { groups: BUSY.map((entry) => ({ ...entry, total: 0, byUrgency: { NOW: 0, SOON: 0, LATER: 0 } })) });
    await page.goto("/staff/home");
    await expect(page.getByRole("heading", { name: "Nothing needs a person right now" })).toBeVisible();
    await expect(page.locator(".attn-row")).toHaveCount(0);
    await expect(page.locator("#attn-reasons")).toBeHidden();
    await expect(page.locator(".app-bell")).not.toContainText("attention");
    await expect(page.locator("#home-lede")).toContainText("Nothing needs a person right now.");
  });

  test("Home and Attention are one workspace: one poll, Home current on both, and the bell opening everything", async ({ page }) => {
    const asked = await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await expect(page.locator(".attn-row").first()).toBeVisible();
    await expect(sections(page).getByRole("link", { name: /^Home/ })).toHaveAttribute("aria-current", "page");
    await page.locator(".app-bell").click();
    await expect(page).toHaveURL(/\/staff\/attention$/);
    await expect(page.getByRole("heading", { level: 1, name: "Attention" })).toBeVisible();
    await expect(sections(page).getByRole("link", { name: /^Home/ })).toHaveAttribute("aria-current", "page");
    // Attention opens on everything, routine work included.
    await expect(page.getByRole("heading", { level: 4, name: "Items to classify" })).toBeVisible();
    await expect(page.locator("#attn-count")).toHaveText("17 to act on · 21 when there is time");
    await expect(page.locator("#ws-today")).toBeVisible();
    // Each entry asked for its queue once; neither left a poll behind.
    expect(asked.queue).toBe(2);
  });

  test("offers to continue open physical checks while cataloguing stays in Quick Catalog", async ({ page }) => {
    await setup(page, { work: { catalogue: WORK.catalogue, checks: [] } });
    await page.goto("/staff/home");
    await expect(page.getByRole("heading", { level: 2, name: "Needs attention" })).toBeVisible();
    await expect(page.locator("#home-continue")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Continue" })).toHaveCount(0);

    const other = await page.context().newPage();
    await setup(other, { work: WORK });
    await other.goto("/staff/home");
    const resume = other.locator("#home-continue .home-row");
    await expect(resume).toHaveCount(1);
    await expect(resume.first()).toHaveAttribute("href", "/staff/catalogue?audit=LA-00000000-0000-4000-9000-000000000001");
    await expect(resume.first()).toContainText("Paused · 38 items expected");
  });

  test("shows each insight with its evidence, its window and rule one press away, and says plainly when advice is only advice", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
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
    const complete = page.getByRole("article", { name: "How complete is the catalog?" });
    await expect(complete).toContainText("468 of 480");
    await expect(complete.getByRole("link", { name: "12 to classify" })).toHaveAttribute("href", "/staff/attention?reason=CLASSIFY");
    expect(await sideways(page)).toBe(0);
  });

  test("says so, and keeps working, when nothing repeats", async ({ page }) => {
    await setup(page, { insights: NOTHING });
    await page.goto("/staff/home");
    await expect(page.getByText("Nothing is repeating enough to show.")).toBeVisible();
    await expect(page.getByRole("article", { name: "How complete is the catalog?" })).toContainText("all done");
  });

  test("a failing insight query leaves everything else working, and can be tried again", async ({ page }) => {
    const asked = await setup(page, { insightsStatus: 500 });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await expect(page.locator("#home-insights")).toContainText("Insights could not be loaded.");
    // The queue is untouched, and so is the navigation.
    await expect(page.locator("#attn-count")).toHaveText("17 to act on");
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
      await asked;
      await expect(page.locator("#attn-count")).toHaveText("17 to act on");
      await sections(page).getByRole("link", { name: /^Loans/ }).click();
      await expect(page).toHaveURL(/\/staff\/loans$/);
      const reply = page.waitForResponse((response) => response.url().endsWith("/api/staff/home/insights") && response.status() === 401);
      release();
      await (await reply).finished();
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/staff\/loans$/);
      await page.route("**/api/staff/home/insights", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(INSIGHTS) }));
      await page.getByRole("link", { name: /Logistics Hub/ }).first().click();
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

  for (const [name, width, height] of [["phone", 390, 844], ["narrow phone", 320, 640], ["tablet", 768, 1024]] as const) {
    test(`fits a ${name} with no sideways scroll, in the order queue, continue, insights`, async ({ page }) => {
      await setup(page, { work: WORK });
      await page.setViewportSize({ width, height });
      await page.goto("/staff/home");
      await expect(page.getByRole("article", { name: "What equipment is borrowed most?" })).toBeVisible();
      await expect(page.locator("#home-continue")).toBeVisible();
      expect(await sideways(page)).toBe(0);
      const tops = await page.evaluate(() => ["#attn-results", "#home-continue", "#home-insights"].map((selector) => document.querySelector(selector)!.getBoundingClientRect().top));
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
    });
  }
});

test.describe("The record document", () => {
  test("opens beside the queue with what the entry carries, its source link, and one history entry that Back closes", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await page.getByRole("button", { name: /^Overdue loans now 1/ }).click();
    await expect(page).toHaveURL(/\/staff\/home\?entry=LOAN_OVERDUE%3ANOW-1$/);
    const doc = page.locator("#attn-doc");
    await expect(doc.getByRole("heading", { level: 2, name: "Overdue loans now 1" })).toBeVisible();
    await expect(doc).toContainText("Today · Overdue loans");
    await expect(doc).toContainText("Sample reason for overdue loans.");
    await expect(doc.getByRole("link", { name: /Open the item/ })).toHaveAttribute("href", "/staff/items?item=ITM-LOAN_OVERDUE-1");
    await expect(page.locator("#ws-today")).toBeHidden();
    await expect(page.locator(".attn-row.is-selected")).toHaveCount(1);
    // Next moves the selection and replaces the history entry, so one Back still closes the document.
    await doc.getByRole("button", { name: "Next entry" }).click();
    await expect(page).toHaveURL(/entry=LOAN_OVERDUE%3ANOW-2$/);
    await expect(doc.getByRole("heading", { level: 2, name: "Overdue loans now 2" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/staff\/home$/);
    await expect(doc).toBeHidden();
    await expect(page.locator("#ws-today")).toBeVisible();
  });

  test("the queue is one tab stop: arrows move, Enter opens, moving moves the selection, and Escape closes and returns focus", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
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
    await expect(page).toHaveURL(/\/staff\/home$/);
    await expect(rows.nth(1)).toBeFocused();
  });

  test("on a phone it opens as a sheet that Back and Close both put away", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff/home");
    await page.getByRole("button", { name: /^Overdue loans now 1/ }).click();
    const sheet = page.getByRole("dialog", { name: "Overdue loans now 1" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: /Open the item/ })).toBeVisible();
    expect(await sideways(page)).toBe(0);
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/staff\/home$/);
    await page.getByRole("button", { name: /^Low stock soon 1/ }).click();
    await page.getByRole("dialog", { name: "Low stock soon 1" }).getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/staff\/home$/);
  });

  test("a link to an entry opens it, and one that no longer exists is let go quietly", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/attention?entry=STOCK_OUT%3ALATER-2");
    await expect(page.locator("#attn-doc").getByRole("heading", { level: 2, name: "Out of stock later 2" })).toBeVisible();
    await page.goto("/staff/home?entry=LOAN_OVERDUE%3ANOW-404");
    await expect(page.locator("#attn-count")).toHaveText("17 to act on");
    await expect(page).toHaveURL(/\/staff\/home$/);
    await expect(page.locator("#attn-doc")).toBeHidden();
  });
});

test.describe("Home accessibility", () => {
  test("one heading, named controls and links, a list for every set of rows, no sideways scroll and room for 200% text", async ({ page }) => {
    await setup(page, { work: WORK, role: "OWNER" });
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/staff/home");
      await expect(page.getByRole("article", { name: "What equipment is borrowed most?" })).toBeVisible();
      await expect(page.locator("main h1")).toHaveCount(1);
      const problems = await page.evaluate(() => ({
        unnamed: [...document.querySelectorAll("main button, main a[href]")].filter((control) => !(control.textContent ?? "").trim() && !control.getAttribute("aria-label")).length,
        loose: [...document.querySelectorAll("main .home-row, main .attn-row")].filter((row) => !row.closest("li")).length
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
