import { expect, test } from "@playwright/test";

const catalog = { revision: 1, categories: ["FURNITURE", "SCHOOL SUPPLIES"], items: [
  { id: "ITM-0005", name: "Folding Table", category: "FURNITURE", unit: "piece", available: 3, audience: "STUDENTS_AND_USC_STAFF" },
  { id: "ITM-0080", name: "Cork Board", category: "FURNITURE", unit: "piece", available: 0, audience: "USC_STAFF_ONLY" },
  { id: "ITM-0262", name: "Scissors", category: "SCHOOL SUPPLIES", unit: "piece", available: 10, audience: "STUDENTS_AND_USC_STAFF" }
] };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify(catalog) }));
});

test("landing shows the undistorted DOL mark beside the HAU·USC crest, and only Part 1 destinations", async ({ page }) => {
  let catalogRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/public/catalog")) catalogRequests += 1; });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Borrow equipment from the USC Department of Logistics" })).toBeVisible();
  const box = (await page.locator(".site-header__brand .mark").boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(40);
  await expect(page.locator(".site-header__brand .crest")).toBeVisible();
  await expect(page.getByRole("img", { name: "Siglawang: Yabong ng Pamana, Youth Development Day 2026" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Department of Logistics home" })).toHaveAttribute("href", "/");
  const facebook = page.getByRole("contentinfo").getByRole("link", { name: "Student Council on Facebook (opens in a new tab)" });
  await expect(facebook).toHaveAttribute("href", "https://www.facebook.com/holyangeluniversitysc");
  await expect(facebook).toHaveAttribute("target", "_blank");
  expect(Math.abs(box.width / box.height - 183 / 163)).toBeLessThan(0.02);
  // Availability lives only in the Lending Hub; the landing page does not poll the catalog.
  await expect(page.locator(".shelf")).toHaveCount(0);
  expect(catalogRequests).toBe(0);
  await expect(page.getByRole("link", { name: /Browse the Lending Hub/ })).toHaveAttribute("href", "/lending");
});

test("Lending Hub groups by category, filters, and keeps filters in the URL", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "Lending Hub", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Department of Logistics home" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("heading", { name: /Furniture/, level: 2 })).toBeVisible();
  await expect(page.getByText("3 pieces available")).toBeVisible();
  // Rows name only the exception: who may not borrow, never loan periods or the usual audience.
  await expect(page.locator(".catalogue__row", { hasText: "Folding Table" }).locator(".catalogue__meta")).toHaveCount(0);
  await expect(page.locator(".catalogue__row", { hasText: "Cork Board" }).locator(".catalogue__meta")).toHaveText("USC staff only");
  await expect(page.getByText(/per loan|day loan/)).toHaveCount(0);
  await expect(page.getByText("All out", { exact: true })).toBeVisible();
  await page.getByLabel("Available now").check();
  await expect(page.getByText("Cork Board")).toHaveCount(0);
  await expect(page).toHaveURL(/available=1/);
  await page.getByRole("searchbox", { name: "Search the Lending Hub" }).fill("missing");
  await expect(page.getByRole("heading", { name: "Nothing matches those filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("Cork Board")).toBeVisible();
});

test("a shared Lending Hub link restores its filters, and / focuses search", async ({ page }) => {
  await page.goto("/lending?q=sciss");
  await expect(page.getByRole("searchbox", { name: "Search the Lending Hub" })).toHaveValue("sciss");
  await expect(page.getByText("Folding Table")).toHaveCount(0);
  await expect(page.getByText("Scissors")).toBeVisible();
  await page.locator("body").click();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search the Lending Hub" })).toBeFocused();
});

test("Lending Hub explains an empty, fail-closed catalog", async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 1, items: [], categories: [] }) }));
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "No items are open for borrowing yet" })).toBeVisible();
});

test("Lending Hub reports a recoverable loading failure", async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "We couldn't load the Lending Hub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again now" })).toBeVisible();
});

test("staff sign-in validates fields and can reveal the password", async ({ page }) => {
  await page.goto("/staff");
  const background = await page.locator(".auth").evaluate((element) => getComputedStyle(element, "::before").backgroundImage);
  expect(background).toContain("/brand/hau-campus-dusk.webp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter your username and password.");
  await expect(page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Password", { exact: true }).fill("secret-value");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
});

test("loan due labels derive overdue from an open loan's return date", async ({ page }) => {
  await page.goto("/");
  const labels = await page.evaluate(async () => {
    const modulePath = "/src/loan-form.ts";
    const { dueTag, isOverdue } = await import(modulePath);
    const today = "2026-09-29";
    const optional = { status: "OUT", returnBy: null };
    const overdue = { status: "OUT", returnBy: "2026-09-28" };
    const closed = { status: "RETURNED", returnBy: "2026-09-28" };
    return {
      optional: dueTag(optional, today).toString(),
      overdue: dueTag(overdue, today).toString(),
      today: dueTag({ status: "OUT", returnBy: today }, today).toString(),
      closed: dueTag(closed, today).toString(),
      isOverdue: isOverdue(overdue, today),
      closedOverdue: isOverdue(closed, today),
    };
  });
  expect(labels.optional).toBe("");
  expect(labels.overdue).toContain("Overdue");
  expect(labels.today).toContain("Due today");
  expect(labels.closed).toBe("");
  expect(labels.isOverdue).toBe(true);
  expect(labels.closedOverdue).toBe(false);
});

const selfServiceCatalog = { revision: 3, serverTime: "2026-09-30T01:00:00.000Z", categories: ["PANTRY", "SCHOOL SUPPLIES"], items: [
  { id: "ITM-0043", name: "Bottled Water", aliases: null, category: "PANTRY", unit: "piece", action: "TAKE", available: 18, location: "Pantry shelf", audience: null },
  { id: "ITM-0262", name: "Scissors", aliases: "Gunting", category: "SCHOOL SUPPLIES", unit: "piece", action: "BORROW", available: 0, location: "Cabinet B", audience: "STUDENTS_AND_USC_STAFF" },
  { id: "ITM-0300", name: "A4 Bond Paper", aliases: null, category: "SCHOOL SUPPLIES", unit: "ream", action: "USE", available: 8, location: "Office cabinet", audience: null }
] };

test("self-service: the item decides Borrow, Take or Use, and a use asks no amount and saves on the phone", async ({ page }) => {
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r3"' }, body: JSON.stringify(selfServiceCatalog) }));
  // Kept offline, so the record waits on the phone.
  await page.route("**/api/self-service/sync", (route) => route.abort());
  await page.goto("/self-service?do=get");
  for (const [name, action] of [["Bottled Water", "Take"], ["Scissors", "Borrow"], ["A4 Bond Paper", "Use"]]) {
    await expect(page.locator(".ss-row", { hasText: name }).locator(".ss-row__sub")).toContainText(action);
  }
  // An old "take" link to an open-unit item still opens Use: the phone never offers the person a choice.
  await page.goto("/self-service?do=take&item=ITM-0300");
  const sheet = page.getByRole("dialog", { name: "A4 Bond Paper" });
  await expect(sheet).toContainText("Use · School Supplies");
  await expect(sheet.getByLabel("How many?")).toHaveCount(0);
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  await sheet.getByLabel("Your name").fill("Ana Reyes");
  await sheet.getByRole("button", { name: "Record use" }).click();
  const receipt = page.getByRole("dialog", { name: "Use recorded" });
  await expect(receipt).toContainText("Saved on this phone");
  await expect(receipt.getByRole("button", { name: "Use something else" })).toBeVisible();
  await receipt.getByRole("button", { name: "Done" }).click();
  // The estimate is unchanged: a use takes nothing off the shelf.
  await page.goto("/self-service?do=get");
  await expect(page.locator(".ss-row", { hasText: "A4 Bond Paper" }).first()).toContainText("1 waiting to sync");
  await expect(page.locator(".ss-row", { hasText: "A4 Bond Paper" }).first()).toContainText("8 left");
});

test("self-service fits phones, tablets and desktops, with every screen and sheet inside the viewport", async ({ page }) => {
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r3"' }, body: JSON.stringify(selfServiceCatalog) }));
  for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 667 }, { width: 412, height: 915 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/self-service", "/self-service?do=take", "/self-service?do=borrow&item=ITM-0262", "/self-service?do=return", "/self-service?do=activity", "/self-service?do=install"]) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      if (route.includes("item=")) await expect(page.getByRole("dialog", { name: "Scissors" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} at ${viewport.width}`).toBeTruthy();
    }
  }
  // A borrow the records say is out explains itself instead of hiding the item.
  await page.goto("/self-service?do=borrow&item=ITM-0262");
  await expect(page.getByRole("dialog", { name: "Scissors" })).toContainText("The records show none left.");
});

test("self-service closed for maintenance: every address sends people to DOL staff, keeps waiting records, and reopens", async ({ page }) => {
  let closed = false;
  await page.route("**/api/self-service/catalog", (route) => closed
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Self-Service is under maintenance.", maintenance: true }) })
    : route.fulfill({ contentType: "application/json", headers: { etag: '"r3"' }, body: JSON.stringify(selfServiceCatalog) }));
  await page.route("**/api/self-service/sync", (route) => route.abort());
  // A use recorded before the office closed Self-Service waits on the phone.
  await page.goto("/self-service?do=use&item=ITM-0300");
  await page.getByRole("dialog", { name: "A4 Bond Paper" }).getByLabel("Your name").fill("Ana Reyes");
  await page.getByRole("button", { name: "Record use" }).click();
  await page.getByRole("dialog", { name: "Use recorded" }).getByRole("button", { name: "Done" }).click();
  closed = true;
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/self-service", "/self-service?do=take&item=ITM-0043", "/self-service?do=activity"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Self-Service is under maintenance");
      await expect(page.getByRole("heading", { name: "Ask DOL staff in person" })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".ss-tile")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} at ${viewport.width}`).toBeTruthy();
    }
  }
  await expect(page.locator("#main-content")).toContainText("1 record is still saved on this phone");
  await expect(page.getByRole("link", { name: "See what's available to borrow" })).toHaveAttribute("href", "/lending");
  closed = false;
  await page.goto("/self-service");
  await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
});

test("administration tests a closed Self-Service in its own panel: records are tests, and it stays closed everywhere else", async ({ page }) => {
  const session = { authenticated: true, id: "ACC-1", username: "owner.one", displayName: "Owner One", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: true };
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/admin/accounts", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ accounts: [] }) }));
  await page.route("**/api/staff/admin/activity", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ events: [] }) }));
  // Like the Worker: open only to a test request (which it also checks belongs to an administrator).
  await page.route("**/api/self-service/catalog", (route) => route.request().headers()["x-self-service-test"] === "1"
    ? route.fulfill({ contentType: "application/json", headers: { etag: '"r3"' }, body: JSON.stringify(selfServiceCatalog) })
    : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Self-Service is under maintenance.", maintenance: true }) }));
  const sent: Array<{ test: string | undefined; body: string }> = [];
  await page.route("**/api/self-service/sync", (route) => {
    const body = route.request().postData() ?? "";
    sent.push({ test: route.request().headers()["x-self-service-test"], body });
    const id = /"v":1,"id":"([^"]+)"/.exec(body)![1];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 4, results: [{ id, outcome: "review", message: "Test saved. It waits for staff and changes nothing." }] }) });
  });
  await page.goto("/staff/admin");
  const panel = page.frameLocator("iframe.ss-trial__frame");
  await expect(panel.getByText("Test mode.")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "What do you need?" })).toBeVisible();
  await panel.getByRole("link", { name: /Get an item/ }).click();
  await panel.locator(".ss-row", { hasText: "Bottled Water" }).first().click();
  const sheet = panel.getByRole("dialog", { name: "Bottled Water" });
  await sheet.getByLabel("Your name").fill("Owner One");
  await sheet.getByRole("button", { name: "Take 1 piece" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.test).toBe("1");
  expect(sent[0]!.body).toContain('"test":true');
  await expect(panel.getByRole("link", { name: /1 needs review/ })).toBeVisible();
  // Once staff accept it, the panel learns so on its next check and no longer waits.
  const takeId = /"v":1,"id":"([^"]+)"/.exec(sent[0]!.body)![1];
  await page.route("**/api/self-service/decisions?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [{ id: takeId, outcome: "accepted" }] }) }));
  await page.reload();
  await panel.getByRole("link", { name: /Synced/ }).click();
  await expect(panel.locator(".ss-event", { hasText: "Bottled Water" })).toContainText("Accepted by Logistics staff.");
  // Outside the panel, Self-Service is still closed, even in this browser.
  await page.goto("/self-service");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Self-Service is under maintenance");
  await expect(page.getByText("Test mode.")).toHaveCount(0);
  // Open again, Administration has no test panel.
  session.selfServiceClosed = false;
  await page.goto("/staff/admin");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  await expect(page.locator("iframe.ss-trial__frame")).toHaveCount(0);
});

test("administration: the owner switches Self-Service and removes old personal details after seeing what is due; an administrator has no retention section", async ({ page }) => {
  const session = { authenticated: true, id: "ACC-1", username: "owner.one", displayName: "Owner One", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false };
  const reply = (body: unknown) => ({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/staff/session", (route) => route.fulfill(reply(session)));
  await page.route("**/api/staff/admin/accounts", (route) => route.fulfill(reply({ accounts: [] })));
  await page.route("**/api/staff/admin/activity", (route) => route.fulfill(reply({ events: [] })));
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ status: 503, ...reply({ maintenance: true }) }));
  let due = { loans: 2, phoneRecords: 1, photos: 3 };
  let erased = 0;
  await page.route("**/api/staff/admin/retention", (route) => {
    if (route.request().method() === "GET") return route.fulfill(reply(due));
    erased += 1;
    const batch = { ...due, more: false };
    due = { loans: 0, phoneRecords: 0, photos: 0 };
    return route.fulfill(reply(batch));
  });
  const changes: string[] = [];
  await page.route("**/api/staff/admin/self-service", (route) => {
    const { state } = route.request().postDataJSON() as { state: string };
    changes.push(state);
    session.selfServiceClosed = state === "paused";
    return route.fulfill(reply({ state }));
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/staff/admin");
  const retention = page.getByRole("region", { name: "Old personal details" });
  await expect(retention.getByText("Ready to remove: 2 loans, 1 phone record and 3 photos.")).toBeVisible();
  await retention.getByRole("button", { name: "Remove old personal details" }).click();
  await expect(retention.getByText("Nothing is old enough to remove yet.")).toBeVisible();
  await expect(retention.getByRole("button", { name: "Remove old personal details" })).toBeDisabled();
  expect(erased).toBe(1);
  const switcher = page.getByRole("region", { name: "Self-Service on phones" });
  await expect(switcher.getByText("Open", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test Self-Service" })).toHaveCount(0);
  await switcher.getByRole("button", { name: "Close for maintenance" }).click();
  await expect(switcher.getByText("Closed for maintenance")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test Self-Service" })).toBeVisible();
  await switcher.getByRole("button", { name: "Reopen Self-Service" }).click();
  await expect(switcher.getByText("Open", { exact: true })).toBeVisible();
  expect(changes).toEqual(["paused", "open"]);
  // An administrator can switch Self-Service but has no retention section (the owner alone removes details).
  session.role = "ADMIN";
  await page.reload();
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Self-Service on phones" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Old personal details" })).toHaveCount(0);
});

test("self-service starts dark over the campus photo, switches to light, and remembers the choice on this phone", async ({ page }) => {
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r3"' }, body: JSON.stringify(selfServiceCatalog) }));
  await page.goto("/self-service");
  await expect(page.locator(".ss-photo")).toBeVisible();
  const toggle = page.getByRole("button", { name: "Dark theme" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await toggle.click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
  // The photograph belongs to home only.
  await page.goto("/self-service?do=take");
  await expect(page.locator(".ss-photo")).toBeHidden();
  await page.goto("/lending");
  await expect(page.locator("body")).not.toHaveAttribute("data-theme");
});

test("public routes fit every required viewport class", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 700 }, { width: 375, height: 700 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/", "/lending", "/staff", "/no-such-page"]) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} at ${viewport.width}`).toBeTruthy();
    }
  }
});

test("activity: a live refresh also refreshes the older pages on screen, so an entry that stopped matching leaves", async ({ page }) => {
  const entry = (id: string, minute: number) => ({ id: `phone:${id}`, correlationId: id, at: `2026-10-01T02:${String(minute).padStart(2, "0")}:00.000Z`, source: "PHONE", type: "PHONE_RETURN",
    summary: `A phone return of 1 piece of Item ${id} was held for staff.`, actor: "Self-Service", actorId: "SELF_SERVICE", itemId: `ITM-${id}`, itemName: `Item ${id}`, unit: "piece",
    change: 0, stockChanged: false, before: null, after: null, reason: null, note: null, attention: true });
  let version = 1;
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, id: "ACC-1", username: "staff.one", displayName: "Staff One", role: "STAFF", mustChangePassword: false, recovery: null, selfServiceReviews: 0 }) }));
  await page.route("**/api/staff/activity?*", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("attention")).toBe("1");
    // The older page loses D once staff resolve it: it no longer needs attention.
    const body = url.searchParams.get("cursor") ? { events: version === 1 ? [entry("C", 3), entry("D", 2)] : [entry("C", 3)], nextCursor: null } : { events: [entry("A", 5), entry("B", 4)], nextCursor: "2026-10-01T02:04:00.000Z|phone:B" };
    return route.fulfill({ contentType: "application/json", headers: { etag: `"v${version}"` }, body: JSON.stringify(body) });
  });
  await page.goto("/staff/activity?attention=1");
  await expect(page.locator(".activity-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.locator(".activity-row")).toHaveCount(4);
  version = 2;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".activity-row")).toHaveCount(3);
  await expect(page.locator(".activity-row", { hasText: "Item D" })).toHaveCount(0);
  await expect(page.locator("#activity-count")).toHaveText("3 entries");
});

/* Public item photos (docs/specs/accepted/2026-10-03-public-item-photos-amendment.md): thumbnails in both lists and the Self-Service sheet. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const thumbsServed = async (page: import("@playwright/test").Page) => {
  await page.route("**/api/public/media/*/thumb", (route) => route.fulfill({ contentType: "image/png", headers: { "cache-control": "public, max-age=3600" }, body: PIXEL }));
};
const nameLeft = (page: import("@playwright/test").Page, selector: string) => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));

test("a failed public photo reveals the bundled icon without changing its frame", async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...catalog, items: catalog.items.map((item) => ({ ...item, photo: "00000000-0000-4000-8000-000000000000" })) }) }));
  await page.route("**/api/public/media/*/thumb", (route) => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lending");
  await expect(page.locator(".item-thumb").first()).toBeVisible();
  await expect(page.locator(".item-thumb img")).toHaveCount(0);
  await expect(page.locator(".item-thumb .item-icon").first()).toBeVisible();
  const frame = await page.locator(".item-thumb").first().boundingBox();
  expect(frame?.width).toBe(48); expect(frame?.height).toBe(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the Lending Hub shows an item's photo, keeps names aligned with and without one, and fits a 320 px phone", async ({ page }) => {
  await thumbsServed(page);
  const photos = { ...catalog, items: catalog.items.map((item, index) => ({ ...item, photo: index === 1 ? null : `00000000-0000-4000-8000-00000000000${index}` })) };
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r2"' }, body: JSON.stringify(photos) }));
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/lending");
    await expect(page.locator(".catalogue--photos .item-thumb [data-item-photo]")).toHaveCount(2);
    await expect(page.locator(".item-thumb").first()).toBeVisible();
    expect(new Set(await nameLeft(page, ".catalogue__name")).size, `names line up at ${width}`).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways scroll at ${width}`).toBeTruthy();
  }
  // Without photos every item still has its bundled system icon and the same reserved frame.
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r3"' }, body: JSON.stringify(catalog) }));
  await page.goto("/lending");
  await expect(page.locator(".catalogue__row").first()).toBeVisible();
  await expect(page.locator(".item-thumb .item-icon")).toHaveCount(catalog.items.length);
  await expect(page.locator(".item-thumb [data-item-photo]")).toHaveCount(0);
  await expect(page.locator(".catalogue--photos").first()).toBeVisible();
});

test("self-service shows an item's photo in the list and the sheet, and the home screen's campus picture stays off the other screens", async ({ page }) => {
  await thumbsServed(page);
  const withPhotos = { ...selfServiceCatalog, items: selfServiceCatalog.items.map((item, index) => ({ ...item, photo: index === 1 ? null : `00000000-0000-4000-8000-00000000000${index}` })) };
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r4"' }, body: JSON.stringify(withPhotos) }));
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/self-service?do=get");
    await expect(page.locator(".ss-list--photos .item-thumb [data-item-photo]")).toHaveCount(2);
    expect(new Set(await nameLeft(page, ".ss-row__name")).size, `names line up at ${width}`).toBe(1);
    // The decorative campus picture belongs to the home screen only (a class this feature once collided with).
    expect(await page.locator(".ss-photo").evaluate((node) => getComputedStyle(node).display), `campus picture hidden at ${width}`).toBe("none");
    await page.goto("/self-service?do=take&item=ITM-0043");
    await expect(page.getByRole("dialog", { name: "Bottled Water" })).toBeVisible();
    await expect(page.locator(".ss-item-photo")).toBeVisible();
    await expect(page.locator(".ss-item-photo")).toHaveCSS("display", "grid");
    expect(await page.locator(".ss-photo").evaluate((node) => getComputedStyle(node).display)).toBe("none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways scroll at ${width}`).toBeTruthy();
    // An item without a photo shows the icon in the same frame.
    await page.goto("/self-service?do=borrow&item=ITM-0262");
    await expect(page.getByRole("dialog", { name: "Scissors" })).toBeVisible();
    await expect(page.locator(".ss-item-photo .item-icon")).toBeVisible();
    await expect(page.locator(".ss-item-photo img")).toHaveCount(0);
  }
});
