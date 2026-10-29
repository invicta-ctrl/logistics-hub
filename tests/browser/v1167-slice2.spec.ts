import { expect, test, type Page } from "@playwright/test";

/*
 * V1.16.7, workspace depth slice 2 (docs/specs/accepted/2026-10-29-workspace-depth.md §4) on fictional data with the API mocked:
 * a loan's thumbnail and its sheet, with and without a photo; Self-Service's one Overview and Show all records, page by page; Activity's
 * one-line entries opening in place, one at a time and from the keyboard; and the links that lead to Activity, filtered.
 */

const session = { authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const TODAY = new Date().toISOString().slice(0, 10);
const IMAGE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const loanBase = { itemId: "ITM-0002", itemName: "Sample stapler", unit: "piece", quantity: 1, purpose: "INDIVIDUAL", reason: null, returnBy: TODAY, returnNote: null, createdBy: "Staff One", closedAt: null, closedBy: null };
const withPhoto = { ...loanBase, id: "LN-PHOTO", borrowerName: "Ana Reyes", studentId: "20-1234-567", status: "OUT", hasPhoto: 1, createdAt: "2026-10-28T01:00:00.000Z" };
const noThumb = { ...loanBase, id: "LN-NOTHUMB", borrowerName: "Ben Cruz", studentId: "20-7654-321", status: "OUT", hasPhoto: 1, createdAt: "2026-10-27T01:00:00.000Z" };
const removed = { ...loanBase, id: "LN-REMOVED", borrowerName: "[removed]", studentId: "[removed]", status: "RETURNED", hasPhoto: 0, createdAt: "2024-01-02T01:00:00.000Z", closedAt: "2024-01-05T01:00:00.000Z", closedBy: "Staff One", returnBy: null };

async function common(page: Page): Promise<void> {
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: session }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/attention", (route) => route.fulfill({ headers: { etag: '"a"' }, json: { revision: 1, entries: [], groups: [], needsAction: 0, bySource: {} } }));
}

async function loansPage(page: Page): Promise<{ saved: string[]; trailAsked: string[] }> {
  await common(page);
  const saved: string[] = [];
  const trailAsked: string[] = [];
  await page.route("**/api/staff/loans", (route) => route.fulfill({ headers: { etag: '"l1"' }, json: { revision: 1, today: TODAY, open: [withPhoto, noThumb], closed: [removed], borrowers: [], items: [], totals: [], known: [] } }));
  await page.route("**/api/staff/loans/*/thumb", (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[4]!;
    if (route.request().method() === "PUT") { saved.push(id); return route.fulfill({ status: 204 }); }
    return id === "LN-PHOTO" ? route.fulfill({ contentType: "image/png", body: IMAGE }) : route.fulfill({ status: 404, json: { error: "Thumbnail not found." } });
  });
  await page.route("**/api/staff/loans/*/photo", (route) => route.fulfill({ contentType: "image/png", body: IMAGE }));
  await page.route("**/api/staff/activity?*", (route) => {
    trailAsked.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { events: [{ id: "mov:M-1", correlationId: "LN-NOTHUMB", at: "2026-10-27T01:00:00.000Z", source: "LOAN", type: "LOAN_OUT", title: "Lent", summary: "Staff One lent 1 piece of Sample stapler to Ben Cruz.",
      actor: "Staff One", actorId: "ACC-1", itemId: "ITM-0002", itemName: "Sample stapler", unit: "piece", quantity: 1, change: -1, stockChanged: true, before: 1, after: 0, reason: null, note: null, fields: [], attention: false }], nextCursor: null } });
  });
  return { saved, trailAsked };
}

test("a loan shows its photo's thumbnail, opens to all its details, and a loan without one saves it from the photo", async ({ page }) => {
  const { saved, trailAsked } = await loansPage(page);
  await page.goto("/staff/loans");
  const shown = page.locator("[data-key=LN-PHOTO] .loan-thumb img");
  await expect(shown).toBeVisible();
  expect(await shown.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  // No thumbnail yet: the camera stands in, and no "Photo" link is left on the row.
  const missing = page.locator("[data-key=LN-NOTHUMB]");
  await expect(missing.locator(".loan-thumb .icon")).toBeVisible();
  await expect(missing.locator(".loan-thumb img")).toHaveCount(0);
  await expect(page.locator(".loan-row__photo")).toHaveCount(0);

  await missing.getByRole("button", { name: /Open the loan to Ben Cruz/ }).click();
  const sheet = page.getByRole("dialog", { name: "Ben Cruz" });
  await expect(sheet.locator(".loan-sheet__photo img")).toBeVisible();
  for (const term of ["Borrower", "Use", "Item", "Quantity", "Lent", "Due", "Status"]) await expect(sheet.locator("dt", { hasText: term })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Sample stapler" })).toHaveAttribute("href", "/staff/items?item=ITM-0002");
  await expect(sheet.locator("#loan-trail")).toContainText("Staff One lent 1 piece of Sample stapler to Ben Cruz.");
  expect(trailAsked.some((query) => query.includes("loan=LN-NOTHUMB") && query.includes("item=ITM-0002"))).toBe(true);
  await expect.poll(() => saved).toEqual(["LN-NOTHUMB"]);
  // Return is offered in the sheet while the loan is out, and leads to the same Return dialog as the row.
  await sheet.getByRole("button", { name: "Return" }).click();
  await expect(page.getByRole("dialog", { name: "Sample stapler" })).toBeVisible();
});

test("a loan whose photo was removed says so, and offers no Return once closed", async ({ page }) => {
  await loansPage(page);
  await page.goto("/staff/loans?view=history");
  const row = page.locator("[data-key=LN-REMOVED]");
  await expect(row.locator(".loan-thumb img")).toHaveCount(0);
  await row.getByRole("button", { name: /Open the loan to/ }).click();
  const sheet = page.getByRole("dialog", { name: "[removed]" });
  await expect(sheet.locator(".loan-sheet__nophoto")).toContainText("The photo was removed");
  await expect(sheet.locator(".loan-sheet__photo")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Return" })).toHaveCount(0);
  await expect(sheet.locator("dt", { hasText: "Closed" })).toBeVisible();
});

const entry = (index: number, daysAgo: number) => {
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, type: "TAKE", itemId: "ITM-0001", itemName: index % 2 ? "Sample marker" : "Sample tape", unit: "piece", quantity: 1, personName: `Person ${index}`, studentId: null, purpose: null, reason: null,
    returnOutcome: null, note: null, returnBy: null, occurredAt: at, receivedAt: at, deviceTime: at, loanId: null, applied: 1, review: null, hasPhoto: 0, resolvedAt: null, resolutionNote: null, resolvedBy: null, device: "abc123", network: null };
};

test("Self-Service is one Overview: attention first, the last 7 days, then every record page by page, searched as shown", async ({ page }) => {
  await common(page);
  const issue = { itemId: "ITM-0001", itemName: "Sample marker", unit: "piece", lowest: -1, since: "2026-10-28T01:00:00.000Z", onHand: 0, openLoans: 0 };
  await page.route("**/api/staff/self-service", (route) => route.fulfill({ headers: { etag: '"s1"' }, json: { revision: 1, open: [], stockIssues: [issue], recent: [entry(1, 1), entry(2, 2)], candidates: [], locationReports: [], enabledItems: 3 } }));
  const cursors: Array<string | null> = [];
  await page.route("**/api/staff/self-service/records*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    return route.fulfill({ json: cursor ? { records: [entry(30, 40)], nextCursor: null } : { records: [entry(1, 1), entry(2, 2), entry(20, 20)], nextCursor: "c1" } });
  });
  await page.goto("/staff/self-service?view=activity");
  // The two old tabs are one; old links land on it.
  await expect(page.getByRole("button", { name: /^Overview/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Needs attention|Last 7 days/ })).toHaveCount(0);
  const attention = page.locator(".ss-overview__attention");
  const records = page.locator(".ss-overview__records");
  await expect(attention).toContainText("Below zero");
  expect(await attention.evaluate((one, two) => Boolean(one.compareDocumentPosition(two!) & Node.DOCUMENT_POSITION_FOLLOWING), await records.elementHandle())).toBe(true);
  await expect(records.getByRole("heading", { name: "Last 7 days" })).toBeVisible();
  await expect(records.locator("tbody tr")).toHaveCount(2);
  await expect(records.getByRole("link", { name: /Self-Service in Activity/ })).toHaveAttribute("href", "/staff/activity?source=PHONE");

  await page.getByRole("button", { name: "Show all records" }).click();
  await expect(records.getByRole("heading", { name: "All records" })).toBeVisible();
  await expect(records.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Load older records" }).click();
  await expect(records.locator("tbody tr")).toHaveCount(4);
  await expect(page.getByText("That is every record.")).toBeVisible();
  expect(cursors).toEqual([null, "c1"]);
  // Search covers what is shown, older pages included, and keeps the caret as the list redraws.
  const find = page.getByLabel("Find a record");
  await find.fill("Person 30");
  await expect(records.locator("tbody tr")).toHaveCount(1);
  await expect(find).toBeFocused();
});

const activityEntry = (index: number, extra: Record<string, unknown> = {}) => ({ id: `mov:M-${index}`, correlationId: `MOV-${index}`, at: "2026-10-28T03:00:00.000Z", source: "MOVEMENT", type: "STOCK_IN", title: "Stock in",
  summary: `Staff One added ${index} pieces of Sample marker to the shelf by the window in the second cabinet.`, actor: "Staff One", actorId: "ACC-1", itemId: "ITM-0001", itemName: "Sample marker", unit: "piece", quantity: index,
  change: index, stockChanged: true, before: 1, after: 1 + index, reason: "Delivery", note: "Box was dented", fields: [], attention: false, ...extra });

test("Activity shows one line per entry, which opens in place to its detail, one at a time, from the keyboard too", async ({ page }) => {
  await common(page);
  const events = [activityEntry(1), activityEntry(2, { correlationId: "LN-7", source: "LOAN", type: "LOAN_OUT" }), activityEntry(3)];
  await page.route("**/api/staff/activity*", (route) => route.fulfill({ json: { events, nextCursor: null } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/activity");
  const rows = page.locator(".activity-row--fold");
  await expect(rows).toHaveCount(3);
  // One line each: the summary is not wrapped.
  for (const row of await rows.all()) {
    const line = row.locator(".activity-row__line");
    expect(await line.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("nowrap");
  }
  const first = rows.nth(0).locator("[data-fold]");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(rows.nth(0).locator(".activity-row__detail")).toBeHidden();
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const detail = rows.nth(0).locator(".activity-row__detail");
  await expect(detail).toBeVisible();
  for (const text of ["When", "By", "Source", "Stock", "Item", "Reason", "Note"]) await expect(detail.locator("dt", { hasText: text })).toBeVisible();
  await expect(detail).toContainText("1 → 2 pieces");
  await expect(detail.getByRole("link", { name: "Sample marker" })).toHaveAttribute("href", "/staff/items?item=ITM-0001");

  // Opening the second closes the first; it links to its loan.
  const second = rows.nth(1).locator("[data-fold]");
  await second.focus();
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(rows.nth(1).getByRole("link", { name: "LN-7" })).toHaveAttribute("href", "/staff/loans?loan=LN-7");
  await page.keyboard.press("Space");
  await expect(second).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".activity-row__detail:visible")).toHaveCount(0);
});

test("the item sheet's activity link and Self-Service's lead to Activity, filtered", async ({ page }) => {
  await common(page);
  const asked: string[] = [];
  await page.route("**/api/staff/activity*", (route) => { asked.push(new URL(route.request().url()).search); return route.fulfill({ json: { events: [], nextCursor: null } }); });
  await page.goto("/staff/activity?source=PHONE");
  await expect(page.locator("[data-source=PHONE]")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => asked.some((query) => query.includes("source=PHONE"))).toBe(true);
  await page.goto("/staff/activity?item=ITM-0001");
  await expect(page.getByRole("button", { name: /Remove filter: Item/ })).toBeVisible();
  await expect.poll(() => asked.some((query) => query.includes("item=ITM-0001"))).toBe(true);
});
