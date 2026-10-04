import { expect, test, type Page, type Route } from "@playwright/test";

/* V1.5 Rapid Catalogue on fictional data with a small stateful server behind the API: sessions, captures, photos and bulk edits. */

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const SESSION_ID = "CS-00000000-0000-4000-8000-000000000001";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const place = (id: string, name: string, parentId: string | null) => ({ id, name, parentId, directions: null, visibility: "STAFF_ONLY", active: true, updatedAt: "2026-10-03T00:00:00.000Z", photo: null, itemCount: 0, openReports: 0 });
const PLACES = [place("LOC-0001", "Office", null), place("LOC-0002", "Cabinet 1", "LOC-0001"), place("LOC-0003", "Shelf 2", "LOC-0002"), place("LOC-0004", "Shelf 3", "LOC-0002")];

type Item = Record<string, unknown> & { id: string; name: string };
const base = (id: string, name: string, extra: Record<string, unknown> = {}): Item => ({
  id, name, aliases: null, category: "OFFICE SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", onHand: 12,
  reorderThreshold: 0, locationId: "LOC-0004", legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0,
  consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, photoHash: null, countNeeded: false, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null, ...extra
});

type Server = ReturnType<typeof serve>;
function serve(page: Page, options: { items?: Item[]; active?: boolean } = {}) {
  const state = {
    items: options.items ?? [base("ITM-0001", "Whiteboard Marker Black"), base("ITM-0002", "Stapler", { itemType: "Loanable", category: "EQUIPMENT", onHand: 3 }), base("ITM-0003", "Bond Paper A4", { category: "PAPER", unit: "ream", consumptionMode: "OPEN_UNIT" })],
    started: Boolean(options.active), placeId: "LOC-0003",
    captures: [] as Array<Record<string, unknown>>,
    photos: [] as Array<{ item: string; hash: string | null }>,
    bulk: [] as Array<{ action: string; value?: string; count: number }>,
    /** "drop": the request never arrives; "lose": the server saves it but the answer is lost; "photo": the first photo upload fails. */
    fail: "" as "" | "drop" | "lose" | "photo",
    finished: false
  };
  const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
  const info = () => ({ id: SESSION_ID, locationId: state.placeId, place: PLACES.find((entry) => entry.id === state.placeId) ? (state.placeId === "LOC-0003" ? "Office › Cabinet 1 › Shelf 2" : "Office › Cabinet 1 › Shelf 3") : null, status: state.finished ? "FINISHED" : "ACTIVE", startedAt: "2026-10-04T01:00:00.000Z", finishedAt: state.finished ? "2026-10-04T02:00:00.000Z" : null, saved: state.captures.length, reviewLater: state.captures.filter((entry) => entry.behaviour === "REVIEW_LATER").length, owner: "Staff Sample", mine: true });
  const detail = () => ({ session: info(), counts: state.captures.reduce<Record<string, number>>((out, entry) => ({ ...out, [String(entry.behaviour)]: (out[String(entry.behaviour)] ?? 0) + 1 }), {}),
    recent: [...state.captures].reverse().map((entry) => ({ captureId: entry.id, behaviour: entry.behaviour, capturedAt: "2026-10-04T01:05:00.000Z", itemId: entry.itemId, name: entry.name, category: entry.category || "UNSORTED", itemType: entry.behaviour === "BORROW" ? "Loanable" : entry.behaviour === "REVIEW_LATER" ? "NEEDS_REVIEW" : "Consumable", consumptionMode: entry.behaviour === "GRADUAL" ? "OPEN_UNIT" : "WHOLE_UNIT", unit: entry.unit || "piece", stockArea: "Inventory", onHand: entry.quantity, place: "Office › Cabinet 1 › Shelf 2", photoId: null })) });

  const ready = (async () => {
    await page.route("**/api/staff/session", (route) => json(route, session));
    await page.route("**/api/staff/inventory", (route) => json(route, { revision: 1, items: state.items, categories: ["EQUIPMENT", "OFFICE SUPPLIES", "PAPER"], units: ["piece", "ream"], locations: PLACES }, 200, { etag: `"r${state.items.length}"` }));
    await page.route("**/api/staff/catalogue/snapshot", (route) => route.request().headers()["if-none-match"] === `"r${state.items.length}"` ? route.fulfill({ status: 304 })
      : json(route, { revision: state.items.length, items: state.items, categories: ["EQUIPMENT", "OFFICE SUPPLIES", "PAPER"], units: ["piece", "ream"], places: PLACES.map(({ id, name, parentId, active }) => ({ id, name, parentId, active })) }, 200, { etag: `"r${state.items.length}"` }));
    await page.route("**/api/staff/locations", (route) => json(route, { revision: 1, locations: PLACES }, 200, { etag: '"r1"' }));
    await page.route("**/api/staff/catalogue", (route) => json(route, { session: state.started && !state.finished ? info() : null, others: [], reviewLater: { total: state.captures.filter((entry) => entry.behaviour === "REVIEW_LATER").length, items: state.captures.filter((entry) => entry.behaviour === "REVIEW_LATER").map((entry) => ({ id: entry.itemId, name: entry.name, capturedAt: "2026-10-04T01:05:00.000Z", place: "Office › Cabinet 1 › Shelf 2", photoId: null, onHand: entry.quantity, unit: "piece" })) } }));
    await page.route("**/api/staff/catalogue/sessions", async (route) => { state.started = true; await json(route, { id: SESSION_ID, resumed: false }, 201); });
    await page.route(`**/api/staff/catalogue/sessions/${SESSION_ID}`, async (route) => {
      if (route.request().method() === "PATCH") { state.placeId = (route.request().postDataJSON() as { locationId: string }).locationId; await json(route, { locationId: state.placeId }); } else await json(route, detail());
    });
    await page.route(`**/api/staff/catalogue/sessions/${SESSION_ID}/finish`, async (route) => { state.finished = true; await json(route, { saved: state.captures.length, reviewLater: 0 }); });
    await page.route(`**/api/staff/catalogue/sessions/${SESSION_ID}/unreviewed`, (route) => json(route, { items: state.captures.filter((entry) => entry.behaviour !== "REVIEW_LATER").map((entry) => ({ id: entry.itemId, updatedAt: "2026-10-04T01:05:00.000Z" })) }));
    await page.route(`**/api/staff/catalogue/sessions/${SESSION_ID}/captures`, async (route) => {
      if (state.fail === "drop") { await route.abort("connectionrefused"); return; }
      const body = route.request().postDataJSON() as Record<string, unknown> & { id: string; name: string; acknowledged: string[] };
      const earlier = state.captures.find((entry) => entry.id === body.id);
      if (earlier) { await json(route, { id: earlier.itemId, captureId: body.id, replayed: true }); return; }
      const twin = state.items.find((entry) => entry.name.toLowerCase() === body.name.toLowerCase() && !body.acknowledged.includes(entry.id));
      if (twin) { await json(route, { error: "This may already be in the catalog.", duplicates: [{ id: twin.id, reason: "Same name", strong: true }] }, 409); return; }
      const id = `ITM-${String(1000 + state.captures.length)}`;
      state.captures.push({ ...body, itemId: id });
      state.items.push(base(id, body.name, { category: body.category || "UNSORTED", unit: body.unit || "piece", needsReview: true }));
      if (state.fail === "lose") { state.fail = ""; await route.abort("connectionreset"); return; }
      await json(route, { id, captureId: body.id, replayed: false }, 201);
    });
    await page.route("**/api/staff/items/ITM-*/photo", async (route) => {
      if (state.fail === "photo") { state.fail = ""; await route.abort("connectionrefused"); return; }
      const hash = /name="hash"\r\n\r\n([0-9a-f]{16})/.exec(route.request().postDataBuffer()?.toString("latin1") ?? "")?.[1] ?? null;
      state.photos.push({ item: /items\/(ITM-\d+)\/photo/.exec(route.request().url())![1]!, hash });
      await json(route, { photo: { id: "00000000-0000-4000-8000-0000000000aa", width: 1, height: 1 } });
    });
    await page.route("**/api/staff/items/bulk", async (route) => {
      const body = route.request().postDataJSON() as { action: string; value?: string; items: Array<{ id: string }> };
      state.bulk.push({ action: body.action, value: body.value, count: body.items.length });
      for (const entry of body.items) { const found = state.items.find((each) => each.id === entry.id); if (found && body.action === "MOVE") found.locationId = body.value; if (found && body.action === "REVIEWED") found.needsReview = false; }
      await json(route, { applied: body.items.length, unchanged: 0, skipped: [] });
    });
    await page.route("**/api/staff/media/**", (route) => route.fulfill({ contentType: "image/png", body: PNG }));
  })();
  return { state, ready };
}

const bar = (page: Page) => page.locator("#cat-sync");
const name = (page: Page) => page.getByLabel("Name", { exact: true });
const pick = (page: Page, text: string) => page.locator(".cat-choice", { hasText: text }).first();
const rows = (page: Page) => page.locator("#cat-list .cat-row");

async function begin(page: Page, server: Server) {
  page.on("pageerror", (error) => console.log("PAGEERROR", error.message, error.stack?.split("\n").slice(0, 3).join(" | ")));
  page.on("console", (message) => { if (message.type() === "error") console.log("CONSOLE", message.text()); });
  await server.ready;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/staff/catalogue?session=${SESSION_ID}`);
  await expect(name(page)).toBeFocused();
}

test.describe("starting and resuming", () => {
  test("a place is chosen once, and an open session resumes from the Catalogue page", async ({ page }) => {
    const server = serve(page);
    await server.ready;
    await page.goto("/staff/catalogue");
    await page.getByLabel("Place", { exact: true }).selectOption("LOC-0003");
    await page.getByRole("button", { name: /^Start cataloguing/ }).click();
    await expect(page).toHaveURL(/session=CS-/);
    await expect(page.locator("#cat-place-name")).toHaveText("Office › Cabinet 1 › Shelf 2");
    await page.goto("/staff/catalogue");
    await expect(page.getByRole("heading", { name: "Your session is open" })).toBeVisible();
    await page.getByRole("link", { name: /Resume cataloguing/ }).click();
    await expect(name(page)).toBeFocused();
  });

  test("the Items page offers the Catalogue", async ({ page }) => {
    const server = serve(page);
    await server.ready;
    await page.goto("/staff/items");
    await page.getByRole("link", { name: "Catalogue" }).click();
    await expect(page.getByRole("heading", { name: "Catalogue", level: 1 })).toBeVisible();
  });
});

test.describe("capturing a mixed shelf", () => {
  test("each item is its own decision: suggestions are offered, explained, and never chosen for you", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    await name(page).fill("whiteboard marker blue");
    // A look-alike suggests, and says why, but nothing is selected.
    await expect(pick(page, "Consume")).toHaveClass(/is-suggested/);
    await expect(page.locator("#cat-why")).toContainText("Like “Whiteboard Marker Black”");
    await expect(page.locator(".cat-choice[aria-pressed=true]")).toHaveCount(0);
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(page.locator("#cat-alert")).toContainText("Choose how it is used");
    expect(server.state.captures).toHaveLength(0);
    // One tap takes the suggestions; the person still presses Save.
    await page.getByRole("button", { name: "Use these" }).click();
    await expect(pick(page, "Consume")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Category")).toHaveValue("OFFICE SUPPLIES");
    await expect(page.getByLabel("Counted in")).toHaveValue("piece");
    await page.getByRole("button", { name: "One more" }).click();
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(name(page)).toBeFocused();
    await expect(name(page)).toHaveValue("");
    await expect(rows(page).first()).toContainText("whiteboard marker blue");
    await expect(rows(page).first()).toContainText("2 pieces");
    await expect(rows(page).first().getByText("Saved", { exact: true })).toBeVisible();
    expect(server.state.captures[0]).toMatchObject({ behaviour: "CONSUME", quantity: 2, locationId: "LOC-0003", category: "OFFICE SUPPLIES", unit: "piece" });

    // A loanable on the same shelf, chosen with the keyboard (Alt + 1 to 4).
    await name(page).fill("Extension cord 5 m");
    await page.getByLabel("Category").fill("ELECTRICAL");
    await page.getByLabel("Counted in").fill("piece");
    await page.getByLabel("Counted in").blur();
    await page.keyboard.press("Alt+1");
    await expect(pick(page, "Borrow & return")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Control+Enter");
    await expect(rows(page)).toHaveCount(2);

    // Not sure: kept and counted, category and unit can wait.
    await name(page).fill("Black box with cables");
    await pick(page, "Not sure").click();
    await expect(page.getByText("optional for now").first()).toBeVisible();
    await page.getByRole("button", { name: "One more" }).click();
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).first().getByText("Review later", { exact: true })).toBeVisible();
    await expect.poll(() => server.state.captures.map((entry) => entry.behaviour)).toEqual(["CONSUME", "BORROW", "REVIEW_LATER"]);
    expect(server.state.captures[2]).toMatchObject({ category: "", unit: "", quantity: 2 });
    await expect(page.locator("#cat-count")).toHaveText("3 items");
    await expect(bar(page)).toHaveText("All saved");
  });

  test("a possible duplicate is shown first, and only a second press saves it as a separate item", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    await name(page).fill("stapler");
    await expect(page.getByRole("group", { name: "Possible matches" })).toContainText("Stapler");
    await expect(page.getByRole("link", { name: /Open Stapler/ })).toHaveAttribute("href", "/staff/items?item=ITM-0002");
    await pick(page, "Borrow").click();
    await page.getByLabel("Category").fill("EQUIPMENT");
    await page.getByLabel("Counted in").fill("piece");
    await page.getByRole("button", { name: "Save & next" }).click();
    expect(server.state.captures).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Save as a separate item" })).toBeFocused();
    await page.getByRole("button", { name: "Save as a separate item" }).click();
    await expect(rows(page).first().getByText("Saved", { exact: true })).toBeVisible();
    expect(server.state.captures[0]).toMatchObject({ name: "stapler", acknowledged: ["ITM-0002"] });
  });

  test("an item saved a moment ago is noticed as a possible match before the server's list has caught up", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    await name(page).fill("Paper trimmer");
    await pick(page, "Borrow").click();
    await page.getByLabel("Category").fill("EQUIPMENT");
    await page.getByLabel("Counted in").fill("piece");
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(rows(page).first().getByText("Saved", { exact: true })).toBeVisible();
    await name(page).fill("paper trimmer");
    await expect(page.getByRole("group", { name: "Possible matches" })).toContainText("Paper trimmer");
  });

  test("tapping a category or unit chip fills exactly that value, spaces and all", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    await name(page).fill("Pencil case");
    await page.locator("#cat-category-chips .cat-chip", { hasText: "Office Supplies" }).click();
    await expect(page.getByLabel("Category")).toHaveValue("OFFICE SUPPLIES");
    await page.locator("#cat-unit-chips .cat-chip", { hasText: "ream" }).click();
    await expect(page.getByLabel("Counted in")).toHaveValue("ream");
    await pick(page, "Consume").click();
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(rows(page).first().getByText("Saved", { exact: true })).toBeVisible();
    expect(server.state.captures[0]).toMatchObject({ category: "OFFICE SUPPLIES", unit: "ream" });
  });

  test("Save pressed twice quickly queues the item once", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    await name(page).fill("Stamp pad");
    await pick(page, "Consume").click();
    await page.getByLabel("Category").fill("OFFICE SUPPLIES");
    await page.getByLabel("Counted in").fill("piece");
    await page.evaluate(() => { const form = document.querySelector("#cat-form")!; form.dispatchEvent(new Event("submit", { cancelable: true })); form.dispatchEvent(new Event("submit", { cancelable: true })); });
    await expect(rows(page).first().getByText("Saved", { exact: true })).toBeVisible();
    expect(server.state.captures).toHaveLength(1);
  });

  test("Enter moves to the next field instead of saving", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    await name(page).fill("Tape");
    await name(page).press("Enter");
    await expect(page.locator(".cat-choice").first()).toBeFocused();
    expect(server.state.captures).toHaveLength(0);
  });
});

test.describe("saving survives a dropped connection", () => {
  test("a record that could not be sent is shown as unsaved, kept through a reload, and sent once when the connection is back", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    server.state.fail = "drop";
    await name(page).fill("Label printer");
    await pick(page, "Borrow").click();
    await page.getByLabel("Category").fill("EQUIPMENT");
    await page.getByLabel("Counted in").fill("piece");
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(rows(page).first()).toContainText("Not saved yet");
    await expect(bar(page)).toContainText("1 waiting to send");
    expect(server.state.captures).toHaveLength(0);
    // The page is reloaded while offline: the item is still there, waiting.
    await page.reload();
    await expect(rows(page).first()).toContainText("Label printer");
    await expect(rows(page).first()).toContainText("Not saved yet");
    server.state.fail = "";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(rows(page).first().getByText("Saved", { exact: true })).toBeVisible();
    await expect(bar(page)).toHaveText("All saved");
    expect(server.state.captures).toHaveLength(1);
    // And it is gone from the device once the server has it all.
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).not.toContainText("Not saved");
  });

  test("a save whose answer was lost is retried without making a second item", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    server.state.fail = "lose";
    await name(page).fill("Hole punch");
    await pick(page, "Consume").click();
    await page.getByLabel("Category").fill("OFFICE SUPPLIES");
    await page.getByLabel("Counted in").fill("piece");
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(rows(page).first()).toContainText("Not saved yet");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(rows(page).first().getByText("Saved", { exact: true })).toBeVisible();
    expect(server.state.captures).toHaveLength(1);
    expect(server.state.items.filter((entry) => entry.name === "Hole punch")).toHaveLength(1);
  });

  test("a photo is sent after the record; if it fails it is kept and retried", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    server.state.fail = "photo";
    await page.locator("#cat-file").setInputFiles({ name: "shelf.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("#cat-photo img")).toBeVisible();
    await name(page).fill("Desk lamp");
    await pick(page, "Borrow").click();
    await page.getByLabel("Category").fill("FURNITURE");
    await page.getByLabel("Counted in").fill("piece");
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(rows(page).first()).toContainText("photo to send");
    expect(server.state.captures).toHaveLength(1);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(rows(page).first().getByText("Saved", { exact: true })).toBeVisible();
    expect(server.state.photos).toHaveLength(1);
    expect(server.state.photos[0]!.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

test.describe("when the sign-in ends or the session is gone", () => {
  test("an ended sign-in stops sending instead of asking again and again", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    let asked = 0;
    await page.route(`**/api/staff/catalogue/sessions/${SESSION_ID}/captures`, (route) => { asked += 1; return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Your staff session has ended. Please sign in again." }) }); });
    await name(page).fill("Ruler");
    await pick(page, "Consume").click();
    await page.getByLabel("Category").fill("OFFICE SUPPLIES");
    await page.getByLabel("Counted in").fill("piece");
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(page).toHaveURL(/\/staff\?expired=1/);
    await page.waitForTimeout(1500);
    expect(asked).toBe(1);
  });

  test("an item held for a session finished on another device is saved once, in a new session, when it can be sent (V1.6)", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    server.state.fail = "drop";
    await name(page).fill("Whiteboard eraser");
    await pick(page, "Consume").click();
    await page.getByLabel("Category").fill("OFFICE SUPPLIES");
    await page.getByLabel("Counted in").fill("piece");
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(rows(page).first()).toContainText("Not saved yet");
    // Meanwhile the session is finished elsewhere: the server refuses captures into it, and starting again makes a new one.
    server.state.finished = true;
    const NEXT = "CS-00000000-0000-4000-8000-000000000002";
    const started: Array<Record<string, unknown>> = [];
    const saved: Array<Record<string, unknown>> = [];
    await page.route(`**/api/staff/catalogue/sessions/${SESSION_ID}/captures`, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "That cataloguing session is finished. Start a new one to keep adding items." }) }));
    await page.route("**/api/staff/catalogue/sessions", (route) => { started.push(route.request().postDataJSON() as Record<string, unknown>); return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: NEXT, resumed: false }) }); });
    await page.route(`**/api/staff/catalogue/sessions/${NEXT}/captures`, (route) => { saved.push(route.request().postDataJSON() as Record<string, unknown>); return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "ITM-2000", captureId: "x", replayed: false }) }); });
    await page.goto("/staff/catalogue");
    await expect(page.locator(".cat-held")).toContainText("Whiteboard eraser");
    server.state.fail = "";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".cat-held")).toHaveCount(0);
    // The new session was proposed under the finished one's id; the server answered with a new one, and the item went there once.
    expect(started).toEqual([{ id: SESSION_ID, locationId: "LOC-0003" }]);
    expect(saved.map((body) => body.name)).toEqual(["Whiteboard eraser"]);
    await page.reload();
    await expect(page.locator(".cat-held")).toHaveCount(0);
  });
});

test.describe("finishing", () => {
  test("finishing shows how it went and offers the one step that makes classified items official", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    for (const [title, behaviour] of [["Glue stick", "Consume"], ["Sealed mystery", "Not sure"]] as const) {
      await name(page).fill(title);
      await pick(page, behaviour).click();
      if (behaviour !== "Not sure") { await page.getByLabel("Category").fill("OFFICE SUPPLIES"); await page.getByLabel("Counted in").fill("piece"); }
      await page.getByRole("button", { name: "Save & next" }).click();
      await expect(rows(page).first().getByText(behaviour === "Not sure" ? "Review later" : "Saved", { exact: true })).toBeVisible();
    }
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Cataloguing finished" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "2 items saved" })).toBeVisible();
    await expect(page.getByText("1 item still needs a decision")).toBeVisible();
    await page.getByRole("button", { name: "Mark 1 item reviewed" }).click();
    await expect(page.locator("#rev-text")).toContainText("1 item marked reviewed");
    expect(server.state.bulk).toEqual([{ action: "REVIEWED", value: undefined, count: 1 }]);
  });
});

test.describe("layout", () => {
  for (const width of [320, 390, 768, 1366]) {
    test(`the capture screen at ${width} px has no sideways scroll and large targets`, async ({ page }) => {
      const server = serve(page, { active: true });
      await server.ready;
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/staff/catalogue?session=${SESSION_ID}`);
      await expect(name(page)).toBeVisible();
      const wide = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5 && getComputedStyle(element).position !== "fixed" && !element.closest(".visually-hidden, .app-bar, .menu")).slice(0, 6).map((element) => `${element.tagName}.${element.className}#${element.id}`));
      expect(wide, "elements wider than the screen").toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      for (const control of [pick(page, "Consume"), page.getByRole("button", { name: "Save & next" }), page.getByRole("button", { name: "One more" })]) {
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

/* ---------- Bulk edits in Items ---------- */

const MANY = Array.from({ length: 600 }, (_, index) => base(`ITM-${String(index + 1).padStart(4, "0")}`, `Sample Item ${index + 1}`, { locationId: "LOC-0004", category: index % 2 ? "PAPER" : "EQUIPMENT" }));

test.describe("bulk edits", () => {
  test("select mode: shift extends a range, the dialog shows what changes, and 600 items go in pieces of 50", async ({ page }) => {
    const server = serve(page, { items: structuredClone(MANY) });
    await server.ready;
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/items");
    await expect(page.locator("#inventory-count")).toHaveText("600 items");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Sample Item 1", exact: true }).check();
    await page.getByRole("checkbox", { name: "Select Sample Item 5", exact: true }).click({ modifiers: ["Shift"] });
    await expect(page.locator("#bulk-bar")).toContainText("5 selected");
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.locator("#bulk-bar")).toBeHidden();
    // Ticking all 600 draws every row again; the click handler is synchronous, so the clock around it is the cost.
    const spent = await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>("#select-all")!;
      const started = performance.now();
      box.click();
      return performance.now() - started;
    });
    console.log(`select all 600 rows: ${spent.toFixed(0)} ms`);
    expect(spent).toBeLessThan(600);
    await expect(page.locator("#bulk-bar")).toContainText("600 selected");
    await page.getByRole("button", { name: "Move to…" }).click();
    const dialog = page.locator("#bulk-sheet");
    await expect(dialog.getByRole("button", { name: /Move 0 items/ })).toBeDisabled();
    await dialog.getByLabel("Move them to").selectOption("LOC-0003");
    await expect(dialog.locator("#bulk-preview")).toContainText("600 items will change to Office › Cabinet 1 › Shelf 2");
    await expect(dialog.locator("#bulk-preview")).toContainText("Quantities are not changed");
    await dialog.getByRole("button", { name: "Move 600 items" }).click();
    await expect(page.locator("#bulk-bar")).toBeHidden();
    expect(server.state.bulk).toHaveLength(12);
    expect(server.state.bulk.every((piece) => piece.action === "MOVE" && piece.value === "LOC-0003" && piece.count === 50)).toBe(true);
  });

  test("mark reviewed explains what it skips", async ({ page }) => {
    const server = serve(page, { items: [base("ITM-0001", "Mystery box", { itemType: "NEEDS_REVIEW", needsReview: true }), base("ITM-0002", "Stapler", { needsReview: true })] });
    await server.ready;
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/staff/items");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("checkbox", { name: /Select all/ }).check();
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    const dialog = page.locator("#bulk-sheet");
    await expect(dialog.locator("#bulk-preview")).toContainText("1 item will change");
    await expect(dialog.locator("#bulk-preview")).toContainText("1 item will be skipped until it is classified");
  });
});

test.describe("accessibility", () => {
  for (const width of [320, 390, 1366]) {
    test(`the capture screen at ${width} px: one heading, labelled fields, named controls, 200% text fits`, async ({ page }) => {
      const server = serve(page, { active: true });
      await server.ready;
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/staff/catalogue?session=${SESSION_ID}`);
      await expect(name(page)).toBeVisible();
      await expect(page.locator("main h1")).toHaveCount(1);
      const problems = await page.evaluate(() => {
        const unlabelled = [...document.querySelectorAll("#cat input:not([type=hidden]), #cat select, #cat textarea")].filter((field) =>
          !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby") && !field.closest("label") && !(field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)));
        const unnamed = [...document.querySelectorAll("#cat button, #cat a[href]")].filter((control) => !(control.textContent ?? "").trim() && !control.getAttribute("aria-label") && !control.getAttribute("title"));
        return { unlabelled: unlabelled.map((field) => field.id), unnamed: unnamed.map((control) => control.id || control.className) };
      });
      expect(problems).toEqual({ unlabelled: [], unnamed: [] });
      await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  test("mistakes are announced and reach the field, and the choice is a labelled group of toggle buttons", async ({ page }) => {
    const server = serve(page, { active: true });
    await begin(page, server);
    await expect(page.getByRole("group", { name: "How is it used?" })).toBeVisible();
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Give it a name" })).toBeVisible();
    await expect(name(page)).toBeFocused();
    await expect(name(page)).toHaveAttribute("aria-invalid", "true");
    await name(page).fill("Tape");
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose how it is used" })).toBeVisible();
    await pick(page, "Consume").click();
    await expect(pick(page, "Consume")).toHaveAttribute("aria-pressed", "true");
    await expect(pick(page, "Borrow")).toHaveAttribute("aria-pressed", "false");
  });

  test("Select mode names every checkbox and tells the count to a screen reader", async ({ page }) => {
    const server = serve(page, { items: structuredClone(MANY.slice(0, 20)) });
    await server.ready;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff/items");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Sample Item 2", exact: true }).check();
    await expect(page.locator("#bulk-bar").getByRole("status")).toContainText("1 selected");
    const unnamed = await page.evaluate(() => [...document.querySelectorAll(".select-box")].filter((box) => !box.getAttribute("aria-label")).length);
    expect(unnamed).toBe(0);
  });
});
