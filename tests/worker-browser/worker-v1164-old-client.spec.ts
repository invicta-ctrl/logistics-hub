import { expect, test, type Page } from "@playwright/test";

/*
 * V1.16.4 §5: a tab still running V1.16.3, against the V1.16.4 Worker. The old client's built files are served by this Worker
 * (E2E_ASSETS, see playwright.worker.config.ts); the ordinary run serves this build's own client and skips this file. Built from
 * 416e468 as the release record says. Home, Items, Stock, Loans and Activity throw nothing, every number the old client shows is
 * the Worker's own figure, and a reason the old client never knew (Needs count, Expiring soon) is shown under the Worker's label.
 */

test.skip(!process.env.E2E_ASSETS, "Serves another build's client: set E2E_ASSETS to its built files");

const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? "8792"}`;
const officeDay = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + offset * 86_400_000));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
type Group = { reason: string; label: string; total: number; byUrgency: Record<"NOW" | "SOON" | "LATER", number> };

let page: Page;
const errors: string[] = [];
const seeded: Record<"lent" | "count" | "expiring", string> = { lent: "", count: "", expiring: "" };
const onHand = async (id: string) => ((await (await page.request.get(`/api/staff/items/${id}`)).json()) as { item: { onHand: number } }).item.onHand;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(process.env.E2E_USERNAME!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  // The page is the old client: V1.16.4 names its build in every page's head, V1.16.3 did not.
  expect(await page.locator('meta[name="build"]').count()).toBe(0);

  const place = await page.request.post("/api/staff/locations", { headers: { origin: BASE }, data: { name: "Compat shelf", parentId: null } });
  expect(place.status(), await place.text()).toBe(201);
  const { id: locationId } = await place.json() as { id: string };
  const create = async (name: string, quantity: number, fields: Record<string, unknown>) => {
    const response = await page.request.post("/api/staff/items", { headers: { origin: BASE }, data: { category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE",
      reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null, name, openingQuantity: quantity, locationId, ...fields } });
    expect(response.status(), await response.text()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  seeded.lent = await create("Compat lent", 1, { itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF" });
  seeded.count = await create("Compat count", 2, { status: "VERIFY" });
  // Within V1.16.4's 30 days and outside V1.16.3's 14: the reason is new to the old client.
  seeded.expiring = await create("Compat expiring", 3, { stockArea: "Pantry", expiresOn: officeDay(20) });
  const loan = await page.request.post(`/api/staff/items/${seeded.lent}/loans`, { headers: { origin: BASE }, multipart: { purpose: "INDIVIDUAL", quantity: "1", key: crypto.randomUUID(),
    studentId: "20231234", borrowerName: "Ana Cruz", returnBy: officeDay(1), photo: { name: "borrower.jpg", mimeType: "image/jpeg", buffer: JPEG } } });
  expect(loan.status(), await loan.text()).toBe(201);
});

test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "thrown in the old client").toEqual([]); });

test("Home and Attention show the Worker's reasons, labels and counts, new reasons under the Worker's own label", async () => {
  const groups = async () => ((await (await page.request.get("/api/staff/attention")).json()) as { groups: Group[] }).groups;
  const shown = () => page.locator("#attn-reasons .attn-reason").evaluateAll((buttons) => buttons.map((button) => ({
    reason: (button as HTMLElement).dataset.reason, label: button.querySelector(".attn-reason__label")!.textContent, count: button.querySelector(".attn-reason__count")!.textContent })));
  const byReason = <T extends { reason?: string }>(list: T[]) => [...list].sort((a, b) => a.reason!.localeCompare(b.reason!));

  await page.goto("/staff/home");
  await expect(page.locator("#attn-reasons .attn-reason").first()).toBeVisible();
  const now = await groups();
  expect(now.map((group) => group.reason)).toEqual(expect.arrayContaining(["NEEDS_COUNT", "EXPIRING"]));
  const toAct = (group: Group) => group.byUrgency.NOW + group.byUrgency.SOON;
  expect(byReason(await shown())).toEqual(byReason(now.filter((group) => group.total > 0)
    .map((group) => ({ reason: group.reason, label: group.label, count: (toAct(group) || group.byUrgency.LATER).toLocaleString() }))));
  const act = now.reduce((sum, group) => sum + toAct(group), 0);
  await expect(page.locator("#home-lede")).toContainText(act ? `${act.toLocaleString()} thing` : "Nothing needs a person");

  await page.goto("/staff/attention");
  await expect(page.locator("#attn-reasons .attn-reason").first()).toBeVisible();
  expect(byReason(await shown())).toEqual(byReason((await groups()).filter((group) => group.total > 0)
    .map((group) => ({ reason: group.reason, label: group.label, count: group.total.toLocaleString() }))));
  for (const reason of ["NEEDS_COUNT", "EXPIRING"]) {
    const group = now.find((candidate) => candidate.reason === reason)!;
    await expect(page.locator(`#attn-${reason}`)).toHaveText(group.label);
  }
  // Out is the Worker's list: the item whose only unit is on loan is not in it.
  await expect(page.locator('section[aria-labelledby="attn-STOCK_OUT"]').getByText("Compat lent")).toHaveCount(0);
});

test("Items shows each item's on-hand as the Worker counts it", async () => {
  await page.goto("/staff/items?q=Compat");
  for (const id of Object.values(seeded)) {
    await expect(page.locator(`[data-qty="${id}"]`)).toHaveAttribute("data-quantity", String(await onHand(id)));
  }
});

test("Stock lists on hand as the Worker counts it, and each count it shows is the rows it lists", async () => {
  await page.goto("/staff/stock");
  const rows = page.locator("tbody tr[data-key]");
  await expect(page.locator('.chip[data-focus="all"]')).toBeVisible();
  for (const id of [seeded.count, seeded.lent]) await expect(page.locator(`tr[data-key="${id}"] .col-qty`)).toContainText(String(await onHand(id)));
  for (const focus of await page.locator(".chip[data-focus]").evaluateAll((chips) => chips.map((chip) => (chip as HTMLElement).dataset.focus!))) {
    const chip = page.locator(`.chip[data-focus="${focus}"]`);
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const count = Number(await chip.locator(".chip__count").textContent());
    if (count) await expect(rows).toHaveCount(count);
    else await expect(rows).toHaveCount(0);
  }
});

test("Loans counts the loans and the units out as the Worker does", async () => {
  const { open } = await (await page.request.get("/api/staff/loans")).json() as { open: Array<{ quantity: number; itemName?: string }> };
  await page.goto("/staff/loans");
  const units = open.reduce((sum, loan) => sum + loan.quantity, 0);
  await expect(page.locator("#loans-summary")).toContainText(`${open.length} loan${open.length === 1 ? "" : "s"} out · ${units} item${units === 1 ? "" : "s"}`);
  await expect(page.locator('.view-tab[data-view="out"] .view-tab__count')).toHaveText(String(open.length));
  await expect(page.getByText("Compat lent").first()).toBeVisible();
});

test("Activity lists what happened, the loan included", async () => {
  await page.goto("/staff/activity");
  await expect(page.getByText("Compat lent").first()).toBeVisible();
  await expect(page.getByText("Compat expiring").first()).toBeVisible();
});
