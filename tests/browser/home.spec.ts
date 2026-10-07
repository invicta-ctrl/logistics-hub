import { expect, test, type Page } from "@playwright/test";

/* V1.12 Home on fictional data with the API mocked: what needs a person (the bell's own numbers), your unfinished work, quick actions by role, and insights that can fail without holding anything up. */

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
  const asked = { summary: 0, insights: 0 };
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session(role)) }));
  await page.route("**/api/staff/attention/summary", (route) => { asked.summary += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify(summaryOf(groups)) }); });
  await page.route("**/api/staff/home", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(work) }));
  await page.route("**/api/staff/home/insights", (route) => {
    asked.insights += 1;
    return insightsStatus === 200 ? route.fulfill({ contentType: "application/json", body: JSON.stringify(insights) }) : route.fulfill({ status: insightsStatus, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong." }) });
  });
  await page.route("**/api/staff/search", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, places: [], items: [], kits: [], links: [] }) }));
  return asked;
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("Home", () => {
  test("shows what needs a person with the bell's numbers, most urgent first, each opening exactly that kind in Attention", async ({ page }) => {
    const asked = await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    // 3 overdue + 1 return + (2 + 4) out + 5 low + 2 kits: the routine ones (12 to classify, 3 without a place) are not counted.
    await expect(page.locator(".app-bell")).toContainText("17 things need attention");
    await expect(page.locator("#home-lede")).toContainText("17 things to act on today or this week.");
    const rows = page.locator("#home-attention .home-row");
    await expect(rows.locator(".home-row__title")).toHaveText(["Overdue loans", "Out of stock", "Damaged or lost returns", "Low stock", "Kits to replenish"]);
    await expect(rows.locator(".home-row__count")).toHaveText(["3", "6", "1", "5", "2"]);
    await expect(rows.nth(1)).toContainText("2 today · 4 this week · 6 when there is time");
    await expect(rows.first()).toHaveAttribute("href", "/staff/attention?reason=LOAN_OVERDUE");
    // Routine work is one calm line, not a row.
    await expect(page.locator(".home-routine")).toContainText("Items to classify 12");
    await expect(page.getByRole("link", { name: /Items without a place/ })).toHaveAttribute("href", "/staff/attention?reason=NO_PLACE");
    // The bar and Home share one request, so the count can never differ.
    expect(asked.summary).toBeLessThanOrEqual(2);
    expect(await sideways(page)).toBe(0);
  });

  test("is calm when nothing needs a person", async ({ page }) => {
    await setup(page, { groups: BUSY.map((entry) => ({ ...entry, total: 0, byUrgency: { NOW: 0, SOON: 0, LATER: 0 } })) });
    await page.goto("/staff/home");
    await expect(page.getByText("Nothing needs a person right now").first()).toBeVisible();
    await expect(page.locator("#home-attention .home-row")).toHaveCount(0);
    await expect(page.locator(".app-bell")).not.toContainText("attention");
    await expect(page.locator("#home-lede")).toContainText("Nothing needs a person right now.");
  });

  test("offers to continue only work that is really open, with a link straight back into it", async ({ page }) => {
    await setup(page);
    await page.goto("/staff/home");
    await expect(page.getByRole("heading", { level: 2, name: "Needs attention" })).toBeVisible();
    await expect(page.locator("#home-continue")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Continue" })).toHaveCount(0);

    const other = await page.context().newPage();
    await setup(other, { work: WORK });
    await other.goto("/staff/home");
    const resume = other.locator("#home-continue .home-row");
    await expect(resume).toHaveCount(2);
    await expect(resume.first()).toHaveAttribute("href", "/staff/catalogue?session=CS-00000000-0000-4000-8000-000000000001");
    await expect(resume.first()).toContainText("Cataloguing at Sample Office › Cabinet 1");
    await expect(resume.first()).toContainText("14 items added");
    await expect(resume.nth(1)).toHaveAttribute("href", "/staff/catalogue?audit=LA-00000000-0000-4000-9000-000000000001");
    await expect(resume.nth(1)).toContainText("Paused · 38 items expected");
  });

  test("gives administrators the two Administration pages and staff only the working ones", async ({ page }) => {
    await setup(page, { role: "STAFF" });
    await page.goto("/staff/home");
    const titles = page.locator(".home-side .home-row__title");
    await expect(titles).toHaveText(["Add items", "Lend or return", "Stock in or out", "Find a place", "Check a kit"]);
    const admin = await page.context().newPage();
    await setup(admin, { role: "OWNER" });
    await admin.goto("/staff/home");
    await expect(admin.locator(".home-side .home-row__title")).toHaveText(["Add items", "Lend or return", "Stock in or out", "Find a place", "Check a kit", "Staff Directory", "Accounts and settings"]);
  });

  test("shows each insight with its window, rule and evidence, and says plainly when advice is only advice", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    const borrowed = page.getByRole("article", { name: "What equipment is borrowed most?" });
    await expect(borrowed).toContainText("Last 90 days · Items lent at least twice.");
    await expect(borrowed.getByRole("link", { name: "Projector - portable" })).toHaveAttribute("href", "/staff/items?item=ITM-0001");
    await expect(borrowed).toContainText("Lent 9 times; the latest on 3 Oct.");
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
    await page.goto("/staff/home");
    await expect(page.locator("#home-insights")).toContainText("Insights could not be loaded.");
    // The rest of Home is untouched, and so is the navigation.
    await expect(page.locator("#home-attention .home-row")).toHaveCount(5);
    await page.route("**/api/staff/home/insights", (route) => { asked.insights += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify(INSIGHTS) }); });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("article", { name: "What equipment is borrowed most?" })).toBeVisible();
    expect(asked.insights).toBe(2);
    await page.getByRole("link", { name: /^Lend or return/ }).click();
    await expect(page).toHaveURL(/\/staff\/loans$/);
  });

  test("the search box opens the same search as the bar", async ({ page }) => {
    await setup(page, { role: "OWNER" });
    await page.goto("/staff/home");
    await page.getByRole("button", { name: /^Search items, places and kits/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the logo and the menu come back here, and an unknown staff address lands here", async ({ page }) => {
    await setup(page);
    await page.goto("/staff/stock");
    await page.getByRole("link", { name: /Logistics Hub/ }).first().click();
    await expect(page).toHaveURL(/\/staff\/home$/);
    await expect(page.getByRole("link", { name: /Logistics Hub/ }).first()).toHaveAttribute("aria-current", "page");
    await page.goto("/staff/nowhere");
    await expect(page).toHaveURL(/\/staff\/home$/);
  });

  for (const [name, width, height] of [["phone", 390, 844], ["narrow phone", 320, 640], ["tablet", 768, 1024]] as const) {
    test(`fits a ${name} with no sideways scroll, in the order attention, continue, quick actions, insights`, async ({ page }) => {
      await setup(page, { work: WORK });
      await page.setViewportSize({ width, height });
      await page.goto("/staff/home");
      await expect(page.getByRole("article", { name: "What equipment is borrowed most?" })).toBeVisible();
      expect(await sideways(page)).toBe(0);
      const tops = await page.evaluate(() => ["#home-attention", "#home-continue", ".home-side", "#home-insights"].map((selector) => document.querySelector(selector)!.getBoundingClientRect().top));
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
    });
  }
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
        loose: [...document.querySelectorAll("main .home-row")].filter((row) => !row.closest("li")).length
      }));
      expect(problems, `${width}px`).toEqual({ unnamed: 0, loose: 0 });
      expect(await sideways(page), `${width}px`).toBe(0);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
    expect(await sideways(page)).toBe(0);
  });

  test("the keyboard reaches search, then each row in reading order, and a row opens with Enter", async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/home");
    await expect(page.locator("#home-attention .home-row")).toHaveCount(5);
    await page.locator("#home-search").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Open Attention" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#home-attention .home-row").first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/staff\/attention\?reason=LOAN_OVERDUE/);
  });
});

test.describe("Attention, from Home", () => {
  const entry = (reason: string, source: string, title: string) => ({ key: `${reason}:${title}`, reason, source, urgency: "NOW", title, why: "Why.", since: null, href: "/staff/items", action: "Open" });
  test("opens one kind alone, says so, and lifts it with Show everything", async ({ page }) => {
    await setup(page);
    await page.route("**/api/staff/attention", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ today: "2026-10-07", groups: BUSY, entries: [entry("LOAN_OVERDUE", "Loans", "Projector"), entry("STOCK_OUT", "Stock", "Tape"), entry("CLASSIFY", "Catalog", "Marker")] }) }));
    await page.goto("/staff/attention?reason=STOCK_OUT");
    await expect(page.locator("#attn-only")).toContainText("Showing only Out of stock.");
    await expect(page.getByRole("heading", { level: 2, name: "Out of stock" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Overdue loans" })).toHaveCount(0);
    await page.getByRole("button", { name: "Show everything" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Overdue loans" })).toBeVisible();
    await expect(page.locator("#attn-only")).toBeHidden();
    await expect(page).not.toHaveURL(/reason=/);
  });
});
