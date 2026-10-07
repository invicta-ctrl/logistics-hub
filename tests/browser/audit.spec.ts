import { expect, test, type Page, type Route } from "@playwright/test";

/* V1.7 checking a place, on fictional data with a small stateful server behind the API: what is sent, offline, the review, and access. */

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const AUDIT = "LA-00000000-0000-4000-8000-000000000001";
const place = (id: string, name: string, parentId: string | null, directions: string | null = null) => ({ id, name, parentId, directions, visibility: "STAFF_ONLY", active: true, updatedAt: "2026-10-04T00:00:00.000Z", photo: null, itemCount: 0, openReports: 0 });
const PLACES = [place("LOC-0001", "Store room", null), place("LOC-0002", "Shelf B", "LOC-0001", "Back wall, second shelf."), place("LOC-0003", "Cabinet 2", "LOC-0001")];
const item = (id: string, name: string, onHand: number, locationId = "LOC-0002") => ({ id, name, aliases: null, category: "OFFICE SUPPLIES", itemType: "Consumable", consumptionMode: "WHOLE_UNIT", unit: "piece", stockArea: "Inventory", status: "ACTIVE", model: null, serialNumber: null, locationId, photoHash: null, onHand });
const ITEMS = [item("ITM-0001", "Masking tape", 12), item("ITM-0002", "White glue", 3), item("ITM-0003", "Extension cord", 2), item("ITM-0004", "Double-sided tape", 8), item("ITM-0005", "Extension reel", 1, "LOC-0003")];

type Observation = { id: string; itemId?: string; outcome: string; expectedOnHand?: number; counted?: number; note?: string };
function serve(page: Page) {
  const state = { started: false, finished: false, observations: [] as Observation[], received: 0, resolutions: [] as Array<Record<string, unknown>>, offline: false, stockMoved: false };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const info = () => ({ id: AUDIT, locationId: "LOC-0002", place: "Store room › Shelf B", status: state.finished ? "FINISHED" : "OPEN", expectedAtStart: 4, placeNote: null, startedAt: "2026-10-04T01:00:00.000Z", finishedAt: state.finished ? "2026-10-04T01:30:00.000Z" : null, owner: "Staff Sample", mine: true });
  const latest = (id: string) => [...state.observations].reverse().find((entry) => entry.itemId === id) ?? null;
  const detail = () => {
    const items = ITEMS.filter((entry) => entry.locationId === "LOC-0002").map((entry) => {
      const seen = latest(entry.id);
      return { id: entry.id, name: entry.name, unit: "piece", locationId: "LOC-0002", place: "Store room › Shelf B", onHand: entry.onHand, onLoan: 0, observation: seen ? { id: seen.id, outcome: seen.outcome, counted: seen.counted ?? null, note: seen.note ?? null } : null };
    });
    const extras = state.observations.filter((entry) => !entry.itemId || entry.itemId === "ITM-0005").map((entry) => ({ id: entry.id, itemId: entry.itemId ?? null, outcome: entry.outcome, counted: entry.counted ?? null, note: entry.note ?? null, name: entry.itemId ? "Extension reel" : entry.note }));
    return { audit: info(), place: { directions: "Back wall, second shelf.", mediaId: null, mediaWidth: null, mediaHeight: null }, items, extras, checked: items.filter((entry) => entry.observation).length };
  };
  const ready = (async () => {
    await page.route("**/api/staff/session", (route) => json(route, session));
    await page.route("**/api/staff/catalogue/snapshot", (route) => json(route, { revision: 1, items: ITEMS, categories: ["OFFICE SUPPLIES"], units: ["piece"], places: PLACES.map(({ id, name, parentId, active, directions }) => ({ id, name, parentId, active, directions })) }));
    await page.route("**/api/staff/catalogue", (route) => json(route, { session: null, others: [], reviewLater: { total: 0, items: [] } }));
    await page.route("**/api/staff/catalogue/offline", (route) => json(route, { signedIn: true, lease: null, account: { id: session.id, displayName: session.displayName, username: session.username, role: session.role, access: session.access } }));
    await page.route("**/api/staff/audits", async (route) => {
      if (route.request().method() === "POST") { state.started = true; await json(route, { id: AUDIT, resumed: false }, 201); return; }
      const mine = state.started && !state.finished ? [{ ...info(), startedBy: undefined }] : [];
      await json(route, { mine, others: [], finished: state.finished ? [info()] : [] });
    });
    await page.route(`**/api/staff/audits/${AUDIT}`, (route) => route.request().method() === "PATCH" ? json(route, { status: "OPEN", placeNote: null }) : json(route, detail()));
    await page.route(`**/api/staff/audits/${AUDIT}/observations`, async (route) => {
      state.received += 1;
      const body = route.request().postDataJSON() as Observation;
      const known = state.observations.some((entry) => entry.id === body.id);
      if (!known) state.observations.push(body);
      await json(route, { id: body.id, replayed: known }, known ? 200 : 201);
    });
    await page.route(`**/api/staff/audits/${AUDIT}/finish`, async (route) => { state.finished = true; await json(route, { finishedAt: "2026-10-04T01:30:00.000Z" }); });
    await page.route(`**/api/staff/audits/${AUDIT}/review`, (route) => json(route, { discrepancies: state.observations.filter((entry) => entry.outcome !== "CONFIRMED").map((entry) => ({
      id: entry.id, itemId: entry.itemId ?? null, outcome: entry.outcome, expectedOnHand: entry.expectedOnHand ?? null, counted: entry.counted ?? null, note: entry.note ?? null,
      name: ITEMS.find((each) => each.id === entry.itemId)?.name ?? null, unit: "piece", recordedPlace: entry.itemId === "ITM-0005" ? "Store room › Cabinet 2" : "Store room › Shelf B", seenPlace: "Store room › Shelf B",
      onHandNow: entry.itemId === "ITM-0002" && state.stockMoved ? 2 : ITEMS.find((each) => each.id === entry.itemId)?.onHand ?? 0, changedSince: entry.itemId === "ITM-0002" && state.stockMoved,
      resolution: (state.resolutions.find((each) => each.observation === entry.id)?.action as string | undefined) ?? null, resolutionNote: null, resolvedBy: null })) }));
    await page.route("**/api/staff/audits/observations/*/resolve", async (route) => {
      const observation = route.request().url().split("/").at(-2)!;
      state.resolutions.push({ observation, ...(route.request().postDataJSON() as Record<string, unknown>) });
      await json(route, { action: "POSTED_COUNT", replayed: false });
    });
    // Registered last, so it runs first (Playwright runs routes in reverse order): no connection reaches any of the above.
    await page.route("**/api/**", (route) => state.offline ? route.abort("internetdisconnected") : route.fallback());
  })();
  return { state, ready };
}

const row = (page: Page, name: string) => page.locator(".ck-row", { hasText: name });
async function startCheck(page: Page) {
  await page.goto("/staff/catalogue");
  await page.getByLabel("Place to check").selectOption("LOC-0002");
  await page.getByRole("button", { name: /Start checking/ }).click();
  await expect(page.locator(".ck-progress__count")).toContainText("0 / 4 checked");
}

test("each answer is sent as staff gave it, progress counts it, and anything not on the list is kept as a finding", async ({ page }) => {
  const server = serve(page);
  await server.ready;
  await startCheck(page);
  await expect(page.getByRole("heading", { level: 1, name: "Store room › Shelf B" })).toBeVisible();
  await row(page, "Masking tape").getByRole("button", { name: /^Here/ }).click();
  await row(page, "White glue").getByRole("button", { name: /^Count differs/ }).click();
  await page.getByLabel("How many are here?").fill("2");
  await page.getByRole("button", { name: "Save count" }).click();
  await row(page, "Extension cord").getByRole("button", { name: /^Can.t find/ }).click();
  await row(page, "Double-sided tape").getByRole("button", { name: /^Record looks wrong/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Say what looks wrong")).toBeVisible();
  await page.getByLabel(/Record looks wrong\?/).fill("These are foam squares.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".ck-progress__count")).toContainText("4 / 4 checked");
  await expect(page.locator(".ck-progress__count")).toContainText("3 findings");
  await page.getByRole("button", { name: /Found something not on the list/ }).click();
  await page.getByLabel("Search the catalog").fill("reel");
  await page.locator(".ck-result").first().click();
  await page.getByRole("button", { name: "Save as found here" }).click();
  await page.getByRole("button", { name: /Found something not on the list/ }).click();
  await page.locator(".ck-unlisted summary").click();
  await page.getByLabel("What is it?").fill("Label printer");
  await page.getByRole("button", { name: "Save as not in the catalog" }).click();
  await expect.poll(() => server.state.observations.length).toBe(6);
  expect(server.state.observations.map(({ itemId, outcome, expectedOnHand, counted, note }) => ({ itemId, outcome, expectedOnHand, counted, note }))).toEqual([
    { itemId: "ITM-0001", outcome: "CONFIRMED", expectedOnHand: 12, counted: undefined, note: undefined },
    { itemId: "ITM-0002", outcome: "MISMATCH", expectedOnHand: 3, counted: 2, note: undefined },
    { itemId: "ITM-0003", outcome: "CANT_FIND", expectedOnHand: 2, counted: undefined, note: undefined },
    { itemId: "ITM-0004", outcome: "NEEDS_REVIEW", expectedOnHand: undefined, counted: undefined, note: "These are foam squares." },
    { itemId: "ITM-0005", outcome: "FOUND_HERE", expectedOnHand: 1, counted: 1, note: undefined },
    { itemId: undefined, outcome: "UNLISTED", expectedOnHand: undefined, counted: undefined, note: "Label printer" }
  ]);
  // Each saved once: the sheet's buttons never send twice however often it is opened.
  expect(server.state.received).toBe(6);
  await page.getByRole("tab", { name: /^Findings/ }).click();
  await expect(page.locator(".ck-list").last()).toContainText("Label printer");
});

test("a browser that cannot keep marks says so, keeps working, and loses nothing while the page stays", async ({ page }) => {
  const server = serve(page);
  await server.ready;
  await startCheck(page);
  await expect(page.getByRole("heading", { level: 1, name: "Store room › Shelf B" })).toBeVisible();
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException("full", "QuotaExceededError"); };
    Object.defineProperty(IDBTransaction.prototype, "error", { configurable: true, get: () => new DOMException("full", "QuotaExceededError") });
  });
  await row(page, "White glue").getByRole("button", { name: /^Here/ }).click();
  await expect(page.locator(".ck-progress__count")).toContainText("1 / 4 checked");
  await expect(page.getByText(/cannot keep unsent marks/)).toBeVisible();
});


test("offline, what is marked waits on the device, survives a reload, and is sent once when the connection is back", async ({ page }) => {
  const server = serve(page);
  await server.ready;
  await startCheck(page);
  await page.context().setOffline(true);
  server.state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await row(page, "Masking tape").getByRole("button", { name: /^Here/ }).click();
  await row(page, "Extension cord").getByRole("button", { name: /^Can.t find/ }).click();
  await expect(page.locator(".ck-progress .live-status")).toHaveText("2 waiting to send");
  await expect(page.locator(".cg-pill")).toHaveText("Offline");
  expect(server.state.observations).toHaveLength(0);
  await page.context().setOffline(false);
  server.state.offline = false;
  await page.reload();
  await expect(page.locator(".ck-progress__count")).toContainText("2 / 4 checked");
  await expect.poll(() => server.state.observations.length, { timeout: 15_000 }).toBe(2);
  await expect(page.locator(".ck-progress .live-status")).toHaveCount(0);
  expect(new Set(server.state.observations.map((entry) => entry.id)).size).toBe(2);
});

test("the review asks for a fresh count when stock moved, and needs a reason to leave a finding as it is", async ({ page }) => {
  const server = serve(page);
  await server.ready;
  await startCheck(page);
  await row(page, "White glue").getByRole("button", { name: /^Count differs/ }).click();
  await page.getByLabel("How many are here?").fill("2");
  await page.getByRole("button", { name: "Save count" }).click();
  await row(page, "Extension cord").getByRole("button", { name: /^Can.t find/ }).click();
  await expect.poll(() => server.state.observations.length).toBe(2);
  server.state.stockMoved = true;
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Finish check" }).click();
  await expect(page.locator(".ck-stats")).toContainText("Not checked");
  const glue = page.locator(".ck-finding", { hasText: "White glue" });
  await expect(glue).toContainText("Stock changed since this was counted.");
  await expect(glue.getByRole("button", { name: /^Post count/ })).toHaveCount(0);
  await glue.getByLabel("How many are there now?").fill("1");
  await glue.getByRole("button", { name: "Post this count" }).click();
  await expect.poll(() => server.state.resolutions.length).toBe(1);
  expect(server.state.resolutions[0]).toMatchObject({ action: "POSTED_COUNT", counted: 1, expectedOnHand: 2 });
  const cord = page.locator(".ck-finding", { hasText: "Extension cord" });
  await cord.locator("summary").click();
  await cord.getByRole("button", { name: "No change" }).click();
  await expect(page.getByText("Say why it stays as it is.")).toBeVisible();
  expect(server.state.resolutions).toHaveLength(1);
});

test("every state of a check: one heading, labelled fields, named controls, and 200% text fits at 320 px", async ({ page }) => {
  const server = serve(page);
  await server.ready;
  await page.setViewportSize({ width: 320, height: 800 });
  const check = async (state: string) => {
    await expect(page.locator("main h1")).toHaveCount(1);
    const problems = await page.evaluate(() => ({
      unlabelled: [...document.querySelectorAll("main input:not([type=hidden]), main select, main textarea, dialog[open] input, dialog[open] textarea")].filter((field) =>
        !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby") && !field.closest("label") && !(field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`))).length,
      unnamed: [...document.querySelectorAll("main button, main a[href], main summary")].filter((control) => !(control.textContent ?? "").trim() && !control.getAttribute("aria-label")).length
    }));
    expect(problems, state).toEqual({ unlabelled: 0, unnamed: 0 });
    await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
    const wide = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5 && getComputedStyle(element).position !== "fixed" && !element.closest(".visually-hidden")).slice(0, 8).map((element) => `${element.tagName}.${element.className}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${state}: ${wide.join(", ")}`).toBe(0);
    await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
  };
  await page.goto("/staff/catalogue");
  await expect(page.locator(".ck-home")).toBeVisible();
  await check("home");
  await page.getByLabel("Place to check").selectOption("LOC-0002");
  await page.getByRole("button", { name: /Start checking/ }).click();
  await expect(page.locator(".ck-row").first()).toBeVisible();
  await check("checking");
  await row(page, "White glue").getByRole("button", { name: /^Count differs/ }).click();
  await check("a count open");
  await page.getByLabel("How many are here?").fill("2");
  await page.getByRole("button", { name: "Save count" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Finish check" }).click();
  await expect(page.locator(".ck-stats")).toBeVisible();
  await check("summary and review");
});
