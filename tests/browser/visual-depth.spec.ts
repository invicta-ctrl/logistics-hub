import { expect, test, type Page } from "@playwright/test";

/* Visual depth on fictional data with the API mocked: the item panel attached to the row that opened it, and the loan time track. */

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const item = (index: number) => ({ id: `ITM-${String(index).padStart(5, "0")}`, name: `Sample item ${index}`, aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", onHand: 10, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null });
const items = Array.from({ length: 60 }, (_, at) => item(at + 1));

async function openItems(page: Page, width: number, height: number) {
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 0, bySource: {} }) }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items, categories: ["SUPPLIES"], locations: [], units: ["piece"] }) }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 1, locations: [] }) }));
  await page.route("**/api/staff/items/ITM-*", (route) => {
    const found = items.find((entry) => route.request().url().includes(`/items/${entry.id}`))!;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ item: { ...found, notes: null, listingGaps: [], photo: null, location: null, legacyReportedAvailable: null, migratedOnHand: 0, migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null }, movements: [], loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0 }) });
  });
  await page.setViewportSize({ width, height });
  await page.goto("/staff/items");
  await expect(page.locator(".data-table--items tbody tr").first()).toBeVisible();
}

const panel = (page: Page) => page.locator("dialog.sheet[open]");
const origin = (page: Page) => panel(page).evaluate((dialog) => ({ attached: dialog.hasAttribute("data-origin"), y: parseFloat(dialog.style.getPropertyValue("--origin-y")), notch: getComputedStyle(dialog, "::before").content }));

test.describe("Attached item panel", () => {
  test("an item opened from its row is attached to it on a computer, and lets go when the page scrolls or the panel closes", async ({ page }) => {
    await openItems(page, 1440, 900);
    const row = page.locator('tr[data-key="ITM-00003"]');
    await row.locator(".row-link").click();
    await expect(panel(page).locator(".profile")).toBeVisible();
    await expect(row).toHaveClass(/is-open/);
    const box = (await row.boundingBox())!;
    const attached = await origin(page);
    expect(attached.attached).toBe(true);
    expect(Math.abs(attached.y - (box.y + box.height / 2))).toBeLessThanOrEqual(1);
    expect(attached.notch).toBe('""');

    // The row moves when the page behind scrolls, so the notch goes rather than point at the wrong row.
    await page.evaluate(() => window.scrollBy(0, 240));
    await expect.poll(async () => (await origin(page)).attached).toBe(false);
    expect((await origin(page)).notch).toBe("none");

    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator("dialog.sheet[data-origin]")).toHaveCount(0);
  });

  test("a phone's bottom sheet is never attached", async ({ page }) => {
    await openItems(page, 390, 844);
    await page.locator('tr[data-key="ITM-00002"] .row-link').click();
    await expect(panel(page).locator(".profile")).toBeVisible();
    expect((await origin(page)).attached).toBe(false);
  });

  test("only a caller that names its origin attaches, and only while that origin shows beside the panel", async ({ page }) => {
    await openItems(page, 1440, 900);
    const result = await page.evaluate(async () => {
      const modulePath = "/src/ui.ts";
      const { sheet } = await import(modulePath);
      const control = (left: number) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Opener";
        Object.assign(button.style, { position: "fixed", left: `${left}px`, top: "300px", width: "200px", height: "40px", zIndex: "5" });
        document.body.append(button);
        return button;
      };
      const attempt = async (open: (target: ReturnType<typeof sheet>) => void) => {
        const dialog = document.createElement("dialog");
        dialog.className = "sheet";
        document.body.append(dialog);
        const target = sheet(dialog);
        open(target);
        const seen = { attached: dialog.hasAttribute("data-origin"), x: dialog.style.getPropertyValue("--origin-x"), y: dialog.style.getPropertyValue("--origin-y") };
        const closed = new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true }));
        dialog.close();
        await closed;
        const released = !dialog.hasAttribute("data-origin");
        dialog.remove();
        return { ...seen, released };
      };
      const beside = control(24);
      const under = control(1200);
      // Every other sheet opens with no origin: a focused control does not attach it.
      const focused = await attempt((target) => { beside.focus(); target.open(); });
      const named = await attempt((target) => target.open(beside));
      const covered = await attempt((target) => target.open(under));
      return { focused, named, covered };
    });
    expect(result.focused.attached).toBe(false);
    expect(result.named).toEqual({ attached: true, x: "124px", y: "320px", released: true });
    expect(result.covered.attached).toBe(false);
  });
});

test.describe("Loan time track", () => {
  const manila = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });
  const day = (offset: number) => manila.format(new Date(Date.now() + offset * 86_400_000));
  const loan = (id: string, lentAgo: number, due: number | null) => ({ id, itemId: "ITM-0001", itemName: "Tripod", unit: "piece", quantity: 1, purpose: "USC", borrowerName: `Sample Borrower ${id}`, studentId: null, reason: "Event", returnBy: due === null ? null : day(due), status: "OUT", returnNote: null, createdAt: `${day(-lentAgo)}T04:00:00.000Z`, closedAt: null, createdBy: "Staff Sample", closedBy: null, hasPhoto: 0 });
  const open = [loan("LN-1", 10, -5), loan("LN-2", 4, 4), loan("LN-3", 2, 0), loan("LN-4", 3, null), loan("LN-5", 0, 0)];

  test("an open loan's track is drawn from its own lent, due and today dates, and only says what the row already says", async ({ page }) => {
    await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
    await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 0, bySource: {} }) }));
    await page.route("**/api/staff/inventory", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items: [], categories: [], locations: [], units: [] }) }));
    await page.route("**/api/staff/loans", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, today: day(0), open, closed: [], borrowers: [], items: [], totals: [], known: [] }) }));
    await page.goto("/staff/loans");
    const track = (id: string) => page.locator(`[data-key="${id}"] .loan-track`);
    const geometry = (id: string) => track(id).evaluate((svg) => ({
      late: svg.classList.contains("loan-track--late"),
      hidden: svg.getAttribute("aria-hidden"),
      used: svg.querySelector(".loan-track__used")!.getAttribute("x2"),
      due: svg.querySelector(".loan-track__due")!.getAttribute("x1"),
      overrun: svg.querySelector(".loan-track__late")?.getAttribute("x1") ?? null
    }));

    // Lent 10 days ago, due 5 days ago: half the rail is the loan period, the rest is late.
    await expect(page.locator('[data-key="LN-1"]')).toContainText("Overdue · due");
    expect(await geometry("LN-1")).toEqual({ late: true, hidden: "true", used: "50", due: "50", overrun: "50" });
    // Lent 4 days ago, due in 4 days: halfway through, the due tick at the end.
    expect(await geometry("LN-2")).toEqual({ late: false, hidden: "true", used: "50", due: "100", overrun: null });
    // Due today: the whole period is used, nothing is late yet.
    await expect(page.locator('[data-key="LN-3"]')).toContainText("Due today");
    expect(await geometry("LN-3")).toEqual({ late: false, hidden: "true", used: "100", due: "100", overrun: null });
    // No due date, or lent and due today: nothing to draw, and nothing is drawn.
    await expect(page.locator('[data-key="LN-4"]')).toBeVisible();
    await expect(track("LN-4")).toHaveCount(0);
    await expect(track("LN-5")).toHaveCount(0);
  });
});
