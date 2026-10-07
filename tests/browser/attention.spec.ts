import { expect, test, type Page } from "@playwright/test";

/* V1.10 on fictional data with the API mocked: the bell and nav numbers, the Attention inbox, and the suggestion on an Unclassified item. */

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };

type Entry = { key: string; reason: string; source: string; urgency: "NOW" | "SOON" | "LATER"; title: string; why: string; since: string | null; href: string; action: string; review?: { loanId: string } };
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const overdue = (index: number): Entry => ({ key: `LOAN_OVERDUE:LN-${index}`, reason: "LOAN_OVERDUE", source: "Loans", urgency: "NOW", title: `Projector ${index}`, why: `Sample Borrower ${index} was due to return it, ${index + 2} days ago.`, since: daysAgo(index + 2).slice(0, 10), href: `/staff/loans?loan=LN-${index}`, action: "Open the loan" });
const damaged: Entry = { key: "RETURN_PROBLEM:LN-9", reason: "RETURN_PROBLEM", source: "Loans", urgency: "NOW", title: "Tripod", why: "Returned damaged by Sample Borrower: a leg is bent.", since: daysAgo(3), href: "/staff/loans?view=history&loan=LN-9", action: "Open the loan", review: { loanId: "LN-9" } };
const out: Entry = { key: "STOCK_OUT:ITM-0001", reason: "STOCK_OUT", source: "Stock", urgency: "NOW", title: "Sample Item 1", why: "None left.", since: null, href: "/staff/items?item=ITM-0001", action: "Open the item" };
const kit: Entry = { key: "KIT:KIT-1", reason: "KIT_REPLENISH", source: "Kits", urgency: "SOON", title: "Sewing Kit", why: "Thread is low.", since: null, href: "/staff/kits?kit=KIT-1", action: "Open the kit" };
const unclassified: Entry = { key: "CLASSIFY:ITM-0900", reason: "CLASSIFY", source: "Catalog", urgency: "LATER", title: "Whiteboard marker blue", why: "Not yet sorted into how it is used.", since: daysAgo(40), href: "/staff/items?item=ITM-0900&tab=details", action: "Classify it" };

const GROUP_LABELS: Record<string, [string, string]> = {
  LOAN_OVERDUE: ["Loans", "Overdue loans"], RETURN_PROBLEM: ["Loans", "Damaged or lost returns"], STOCK_OUT: ["Stock", "Out of stock"], KIT_REPLENISH: ["Kits", "Kits to replenish"], CLASSIFY: ["Catalog", "Items not yet sorted"]
};

function answer(entries: Entry[], totals: Record<string, number> = {}) {
  const reasons = Object.keys(GROUP_LABELS);
  return {
    today: new Date().toISOString().slice(0, 10),
    groups: reasons.map((reason) => ({ reason, source: GROUP_LABELS[reason]![0], label: GROUP_LABELS[reason]![1], total: totals[reason] ?? entries.filter((entry) => entry.reason === reason).length })),
    entries
  };
}
const summaryOf = (entries: Entry[]) => {
  const live = entries.filter((entry) => entry.urgency !== "LATER");
  const bySource: Record<string, number> = { Loans: 0, Stock: 0, Locations: 0, Kits: 0, Catalog: 0, "Self-Service": 0 };
  for (const entry of live) bySource[entry.source]! += 1;
  return { needsAction: live.length, bySource };
};

async function mock(page: Page, initial: Entry[]) {
  const state = { entries: initial, reviewed: [] as string[] };
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(summaryOf(state.entries)) }));
  await page.route("**/api/staff/attention", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(answer(state.entries, { LOAN_OVERDUE: state.entries.filter((entry) => entry.reason === "LOAN_OVERDUE").length + (state.entries.length >= 100 ? 40 : 0) })) }));
  await page.route("**/api/staff/loans/*/review", (route) => {
    const id = route.request().url().split("/").at(-2)!;
    state.reviewed.push(id);
    state.entries = state.entries.filter((entry) => entry.review?.loanId !== id);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ reviewed: true }) });
  });
  return state;
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("Attention inbox", () => {
  test("the bell and the Loans and Stock numbers count what needs a person, and the inbox groups it by how soon", async ({ page }) => {
    await mock(page, [overdue(1), overdue(2), damaged, out, kit, unclassified]);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/attention");
    await expect(page.getByRole("heading", { level: 1, name: "Attention" })).toBeVisible();
    // 3 loans (2 overdue + 1 return), 1 stock, 1 kit; the Unclassified item is routine, so it is listed but not counted.
    await expect(page.locator(".app-bell")).toContainText("5 things need attention");
    await expect(page.getByRole("link", { name: /^Loans.*3 need attention/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Stock.*1 needs attention/ })).toBeVisible();
    await expect(page.locator(".attn-band__title")).toHaveText(["Today", "This week", "When there is time"]);
    await expect(page.getByRole("heading", { level: 2, name: "Overdue loans" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Items not yet sorted" })).toBeVisible();
    // Each entry names its reason and goes straight to where the next step is made.
    await expect(page.getByRole("link", { name: /Open the loan/ }).first()).toHaveAttribute("href", /\/staff\/loans\?loan=LN-1/);
    await expect(page.getByRole("link", { name: "Classify it" })).toHaveAttribute("href", "/staff/items?item=ITM-0900&tab=details");
    expect(await sideways(page)).toBe(0);
  });

  test("marking a damaged return reviewed clears it and lowers the numbers", async ({ page }) => {
    const state = await mock(page, [damaged, out]);
    await page.goto("/staff/attention");
    await expect(page.locator(".app-bell")).toContainText("2 things need attention");
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(page.getByText("Tripod")).toHaveCount(0);
    expect(state.reviewed).toEqual(["LN-9"]);
    await expect(page.locator(".app-bell")).toContainText("1 thing needs attention");
  });

  test("filters narrow by source, how soon and age, are kept in the address, and clear again", async ({ page }) => {
    await mock(page, [overdue(1), out, kit, unclassified]);
    await page.goto("/staff/attention");
    await expect(page.locator("#attn-count")).toHaveText("4 entries");
    await page.getByLabel("From").selectOption("Stock");
    await expect(page.locator("#attn-count")).toHaveText("1 entry");
    await expect(page).toHaveURL(/source=Stock/);
    await page.getByLabel("From").selectOption("");
    await page.getByLabel("Age").selectOption("30");
    await expect(page.getByRole("link", { name: "Classify it" })).toBeVisible();
    await expect(page.getByText("Sewing Kit")).toHaveCount(0);
    await page.getByLabel("How soon").selectOption("NOW");
    await expect(page.getByRole("heading", { name: "Nothing matches these filters" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page.locator("#attn-count")).toHaveText("4 entries");
    // A shared link keeps its filters.
    await page.goto("/staff/attention?source=Kits");
    await expect(page.getByLabel("From")).toHaveValue("Kits");
    await expect(page.locator("#attn-count")).toHaveText("1 entry");
  });

  test("a long group shows five, opens to all, and says when only the oldest are listed", async ({ page }) => {
    await mock(page, Array.from({ length: 100 }, (_, index) => overdue(index)));
    await page.goto("/staff/attention");
    const list = page.locator(".attn-list").first();
    await expect(list.locator(".attn-row")).toHaveCount(5);
    const more = page.getByRole("button", { name: "Show all 100" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(list.locator(".attn-row")).toHaveCount(100);
    await expect(page.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Showing the oldest 100 of 140.")).toBeVisible();
  });

  test("nothing to do shows a calm empty state and no numbers", async ({ page }) => {
    await mock(page, []);
    await page.goto("/staff/attention");
    await expect(page.getByRole("heading", { name: "Nothing needs attention" })).toBeVisible();
    await expect(page.locator(".app-bell .nav-badge")).toHaveCount(0);
  });

  for (const [width, text] of [[320, ""], [320, "200%"], [390, ""], [768, ""], [1366, ""]] as const) {
    test(`at ${width}px${text ? ` with ${text} text` : ""} the inbox fits, every control is named, and nothing scrolls sideways`, async ({ page }) => {
      await mock(page, [overdue(1), overdue(2), damaged, out, kit, unclassified]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/staff/attention");
      await expect(page.locator(".attn-row").first()).toBeVisible();
      if (text) await page.evaluate((size) => document.documentElement.style.setProperty("font-size", size, "important"), text);
      expect(await sideways(page)).toBe(0);
      const problems = await page.evaluate(() => ({
        unnamed: [...document.querySelectorAll("button, a[href]")].filter((control) => !(control.textContent ?? "").trim() && !control.getAttribute("aria-label")).length,
        unlabelled: [...document.querySelectorAll("select")].filter((field) => !(field.id && document.querySelector(`label[for="${field.id}"]`))).length,
        headings: document.querySelectorAll("main h1").length
      }));
      expect(problems).toEqual({ unnamed: 0, unlabelled: 0, headings: 1 });
    });
  }
});

test.describe("Unclassified item", () => {
  const known = (index: number, name: string) => ({ id: `ITM-${String(index).padStart(4, "0")}`, name, aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", onHand: 10, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null });
  const target = { ...known(900, "Whiteboard marker blue"), category: "UNSORTED", itemType: "NEEDS_REVIEW", needsReview: true };
  const items = [known(1, "Whiteboard marker black"), known(2, "Whiteboard marker red"), known(3, "Whiteboard marker green"), known(4, "Whiteboard marker purple"), target];

  test("the details tab opens from Attention and shows the top suggestion with its confidence and reason, and nothing changes until it is used", async ({ page }) => {
    await mock(page, [unclassified]);
    await page.route("**/api/staff/inventory", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items, categories: ["SUPPLIES"], locations: [], units: ["piece"] }) }));
    await page.route("**/api/staff/locations", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 1, locations: [] }) }));
    await page.route("**/api/staff/items/ITM-0900", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ item: { ...target, notes: null, listingGaps: [], photo: null, location: null, legacyReportedAvailable: null, migratedOnHand: 0, migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null }, movements: [], loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0 }) }));
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/staff/attention");
    await page.getByRole("link", { name: "Classify it" }).first().click();
    const hint = page.locator("#classify-hint");
    await expect(hint).toContainText("Suggested: Take");
    await expect(hint).toContainText("Like");
    await expect(page.getByLabel("Borrow or take")).toHaveValue("NEEDS_REVIEW");
    await hint.getByRole("button", { name: "Use suggestion" }).click();
    await expect(page.getByLabel("Borrow or take")).toHaveValue("Consumable");
    await expect(page.locator("#f-category")).toHaveValue("SUPPLIES");
  });
});

test.describe("Deep links from Attention", () => {
  const loan = (id: string, status: string) => ({ id, itemId: "ITM-0001", itemName: "Tripod", unit: "piece", quantity: 1, purpose: "USC", borrowerName: "Sample Borrower", studentId: null, reason: "Event", returnBy: "2026-09-01", status, returnNote: status === "OUT" ? null : "a leg is bent", createdAt: "2026-08-20T00:00:00.000Z", closedAt: status === "OUT" ? null : "2026-09-20T00:00:00.000Z", createdBy: "Staff Sample", closedBy: status === "OUT" ? null : "Staff Sample", hasPhoto: 0 });
  const overview = { revision: 1, today: "2026-10-07", open: [loan("LN-1", "OUT"), loan("LN-2", "OUT")], closed: [loan("LN-9", "DAMAGED")], borrowers: [], items: [], totals: [], known: [] };

  test.beforeEach(async ({ page }) => {
    await mock(page, []);
    await page.route("**/api/staff/loans", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify(overview) }));
    await page.route("**/api/staff/inventory", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items: [], categories: [], locations: [], units: [] }) }));
  });

  test("an overdue loan is marked and focused in the list, then the address is tidied", async ({ page }) => {
    await page.goto("/staff/loans?loan=LN-2");
    const row = page.locator('[data-key="LN-2"]');
    await expect(row).toHaveClass(/is-focus/);
    await expect(row).toBeFocused();
    await expect(page).toHaveURL(/\/staff\/loans$/);
  });

  test("a damaged return opens the history with that return marked", async ({ page }) => {
    await page.goto("/staff/loans?view=history&loan=LN-9");
    await expect(page.locator('[data-key="LN-9"]')).toHaveClass(/is-focus/);
  });

  test("a loan that is not in the list says so instead of failing quietly", async ({ page }) => {
    await page.goto("/staff/loans?view=history&loan=LN-404");
    await expect(page.getByText("That loan is not in this list.")).toBeVisible();
  });
});
