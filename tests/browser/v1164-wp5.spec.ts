import { expect, test, type Page, type Route } from "@playwright/test";

/*
 * V1.16.4 WP5 (accepted specification §4.5, §4.6, D1, D3, R5) on fictional data with the API mocked: the desk's Lend form keeps the
 * phone's order and words, its Student ID field tidies without cutting, a quantity is read as typed and never sent when it is not a
 * whole number, a USC-only item is held to USC use, and one request key lives until the server answers.
 */

const session = { authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const VERSION = "2026-10-03T00:00:00.000Z";
const PHOTO = "public/brand/ydd-2026-banner.jpg";
const listed = { id: "ITM-0001", name: "Sample tripod", aliases: null, category: "EQUIPMENT", itemType: "Loanable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "STUDENTS_AND_USC_STAFF",
  onHand: 5, reorderThreshold: 0, locationId: "LOC-1", legacyLocation: null, openReports: 0, listed: true, stockArea: "Inventory", expiresOn: null, lastCountedAt: "2026-10-01T00:00:00.000Z", reorderStatus: null,
  onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: VERSION, model: null, serialNumber: null, countNeeded: false };
const extras = { notes: null, listingGaps: [], photo: null, photoCleanup: { cleanable: true, canEnable: false, cleanupReason: "" }, location: "Cabinet 1", legacyReportedAvailable: null, migratedOnHand: 0,
  migrationDelta: null, legacySourceSheet: null, legacySourceRow: null, verificationNote: null, importedFrom: null };

type Sent = Record<string, string>;
/** The text fields of a multipart Lend, as the Worker would read them. */
function fieldsOf(route: Route): Sent {
  const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
  return Object.fromEntries([...body.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)].map((match) => [match[1]!, match[2]!]));
}

async function desk(page: Page, over: Partial<typeof listed>, answer: (sent: Sent, index: number) => Parameters<Route["fulfill"]>[0] | "abort"): Promise<Sent[]> {
  const sent: Sent[] = [];
  const item = { ...listed, ...over };
  await page.route("**/api/staff/session", (route) => route.fulfill({ json: session }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ json: { needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], categories: ["EQUIPMENT"],
    locations: [{ id: "LOC-1", name: "Cabinet 1", parentId: null, active: true }], units: ["piece"] } }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, locations: [{ id: "LOC-1", name: "Cabinet 1", parentId: null, active: true }] } }));
  await page.route("**/api/staff/stock", (route) => route.fulfill({ headers: { etag: '"r1"' }, json: { revision: 1, items: [item], locations: [], reorders: [], activity: [] } }));
  await page.route("**/api/staff/home", (route) => route.fulfill({ headers: { etag: '"h"' }, json: { catalogue: null, checks: [] } }));
  await page.route("**/api/staff/attention", (route) => route.fulfill({ headers: { etag: '"a"' }, json: { revision: 1, entries: [], groups: [], needsAction: 0, bySource: {} } }));
  await page.route("**/api/staff/loans", (route) => route.fulfill({ json: { today: "2026-10-03", open: [], closed: [], borrowers: [], items: [], totals: [], known: [{ studentId: "20000100", name: "Ana Cruz" }] } }));
  await page.route("**/api/staff/items/ITM-0001", (route) => route.fulfill({ json: { item: { ...item, ...extras }, movements: [], loans: [], openUnits: [], reports: [], events: [], usesRecorded: 0, unitsEmptied: 0, kits: [], reorder: null, historyNext: null } }));
  await page.route("**/api/staff/items/ITM-0001/loans", async (route) => {
    sent.push(fieldsOf(route));
    const reply = answer(sent.at(-1)!, sent.length - 1);
    return reply === "abort" ? route.abort("internetdisconnected") : route.fulfill(reply);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/items?item=ITM-0001");
  await page.getByRole("tab", { name: "Loan" }).click();
  await expect(page.locator("#loan-form")).toBeVisible();
  return sent;
}

const saved = (_: Sent, index: number) => ({ status: 201, json: { id: `LN-${index}`, onHand: 4 } });

test("the desk form asks in the phone's order and words, and its Student ID field tidies without cutting", async ({ page }) => {
  const sent = await desk(page, {}, saved);
  const form = page.locator("#loan-form");
  // Purpose, name, Student ID, reason, quantity: the same order as the phone (§4.5).
  expect(await form.locator("input[name], textarea[name]").evaluateAll((fields) => [...new Set(fields.map((field) => (field as HTMLInputElement).name))])).toEqual(
    ["purpose", "borrowerName", "studentId", "reason", "quantity", "returnBy", "photo"]);
  const id = form.getByLabel("Student ID number");
  await expect(id).toHaveAttribute("inputmode", "numeric");
  await expect(id).toHaveAttribute("type", "text");
  await id.pressSequentially("21-0001 15");
  await expect(id).toHaveValue("21000115");
  // A ninth digit stays, and the field says at once why it cannot be used.
  await id.pressSequentially("9");
  await expect(id).toHaveValue("210001159");
  await expect(form.locator("#loan-studentId-hint")).toHaveText("A Student ID has exactly 8 digits.");
  await form.getByLabel("Borrower's full name").fill("Juan Dela Cruz");
  await form.getByRole("button", { name: /^Lend/ }).click();
  await expect(form.getByRole("alert")).toHaveText("A Student ID has exactly 8 digits.");
  await expect(id).toBeFocused();
  await id.fill("");
  await page.keyboard.insertText("21-000115");
  await expect(id).toHaveValue("21000115");
  await expect(form.locator("#loan-studentId-hint")).toHaveText("8 digits");
  // USC use needs the Student ID as Individual use does (D1).
  await form.getByRole("radio", { name: "USC use" }).check();
  await id.fill("");
  await form.getByRole("button", { name: /^Lend/ }).click();
  await expect(form.getByRole("alert")).toHaveText("Enter the Student ID number.");
  // A returning borrower's name comes from the server's known list.
  await form.getByLabel("Borrower's full name").fill("");
  await id.pressSequentially("20000100");
  await expect(form.getByLabel("Borrower's full name")).toHaveValue("Ana Cruz");
  await form.getByRole("button", { name: /^Lend/ }).click();
  await expect(form.getByRole("alert")).toHaveText("Enter the specific USC reason.");
  expect(sent).toHaveLength(0);
});

test("a quantity that is not a whole number is named and never sent; the stepper stays on the shelf", async ({ page }) => {
  const sent = await desk(page, {}, saved);
  const form = page.locator("#loan-form");
  await form.getByLabel("Borrower's full name").fill("Juan Dela Cruz");
  await form.getByLabel("Student ID number").fill("21000115");
  await form.locator("input[type=file]").setInputFiles(PHOTO);
  await expect(form.getByRole("img", { name: "Photo to attach" })).toBeVisible();
  const quantity = form.getByLabel("Quantity");
  for (const [typed, message] of [["1e3", "Write the quantity out in full, like 1000."], ["2.5", "The quantity must be a whole number."], ["1,000", "Leave out commas and spaces in the quantity."],
    ["", "Enter the quantity."], ["0", "The quantity must be at least 1."]] as const) {
    await quantity.fill(typed);
    await form.getByRole("button", { name: /^Lend/ }).click();
    await expect(form.getByRole("alert"), typed).toHaveText(message);
    await expect(quantity).toHaveAttribute("aria-invalid", "true");
  }
  await quantity.fill("9");
  await form.getByRole("button", { name: /^Lend/ }).click();
  await expect(form.getByRole("alert")).toHaveText("Only 5 pieces on the shelf.");
  expect(sent).toHaveLength(0);
  // The stepper may stop at the shelf; a typed figure was never clamped.
  await form.getByRole("button", { name: "One more" }).click();
  await expect(quantity).toHaveValue("5");
  await form.getByRole("button", { name: "Lend 5 pieces" }).click();
  await expect(page.getByText("Lent 5 pieces of Sample tripod to Juan Dela Cruz.")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ purpose: "INDIVIDUAL", studentId: "21000115", quantity: "5" });
});

test("a USC-only item is held to USC use at the desk (D3)", async ({ page }) => {
  await desk(page, { lendingAudience: "USC_STAFF_ONLY" }, saved);
  const form = page.locator("#loan-form");
  await expect(form.getByRole("radio", { name: "Individual use" })).toBeDisabled();
  await expect(form.getByRole("radio", { name: "USC use" })).toBeChecked();
  await expect(form.getByText("Lent for USC use only.")).toBeVisible();
  await expect(form.getByLabel("Specific reason")).toBeVisible();
});

test("one request key lives until the server answers: a lost answer re-sends it, and a replayed loan says it was already saved (R5)", async ({ page }) => {
  const sent = await desk(page, {}, (body, index) => index === 0 ? "abort" : index === 1 ? { status: 201, json: { id: "LN-0", onHand: 4, replayed: true } }
    : index === 2 ? { status: 409, json: { error: "Only 0 on hand; cannot lend 1." } } : saved(body, index));
  const form = page.locator("#loan-form");
  const fill = async (name: string) => {
    await form.getByLabel("Borrower's full name").fill(name);
    await form.getByLabel("Student ID number").fill("21000115");
    await form.locator("input[type=file]").setInputFiles(PHOTO);
    await expect(form.getByRole("img", { name: "Photo to attach" })).toBeVisible();
  };
  await fill("Juan Dela Cruz");
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(form.getByRole("alert")).toContainText("you appear to be offline");
  // Typing and a new photo do not make a new request: the Lend that may have been saved is the one sent again.
  await form.getByLabel("Borrower's full name").fill("Juan Dela Cruz Jr");
  await form.locator("input[type=file]").setInputFiles(PHOTO);
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(page.getByText("This loan of Sample tripod was already saved.")).toBeVisible();
  expect(sent[1]!.key).toBe(sent[0]!.key);
  // An answered refusal ends that request; the next Lend is a new one.
  await fill("Maria Santos");
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(form.getByRole("alert")).toContainText("cannot lend");
  await form.getByRole("button", { name: "Lend 1 piece" }).click();
  await expect(page.getByText("Lent 1 piece of Sample tripod to Maria Santos.")).toBeVisible();
  expect(new Set(sent.map((body) => body.key)).size).toBe(3);
  expect(sent[3]!.key).not.toBe(sent[2]!.key);
});
