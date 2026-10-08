import { type BrowserContext, expect, test, type Page } from "@playwright/test";

/*
 * The Staff Directory as a wall of cards (Earl, 2026-10-03: the card is what you press). A card opens on the person's details
 * without fetching a scan, turns to the front of their ID (fetching it then), and its links leave for the profile sections.
 * The API is mocked with fictional people.
 */

const id = (n: number) => `PER-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (n: number, name: string, department: string, extra = {}) => ({ id: id(n), name, department, position: "Executive Staff", officer: false, studentId: null, active: true, sourceKey: null,
  createdAt: "2026-10-01T02:00:00.000Z", updatedAt: "2026-10-01T02:00:00.000Z", hasId: false, account: null, ...extra });
const people = [
  person(1, "Ana Marie Santos", "DoL", { position: "Director for Logistics", officer: true, hasId: true, studentId: "20-1111-222" }),
  person(2, "Bea Cruz Reyes", "DoL"), person(3, "Carlo Dizon", "DEM"), person(4, "Gio Tan", "DoL", { active: false })
];
const card = { mediaId: "00000000-0000-4000-8000-00000000abcd", front: { width: 856, height: 540 }, back: { width: 856, height: 540 }, sourceFront: "Santos_Front_DoL.png", sourceBack: "Santos_Back_DoL.png", createdAt: "2026-10-01T02:00:00.000Z", createdBy: "Owner Sample" };
const loan = { id: "LN-1", itemId: "ITM-1", itemName: "Extension cord", unit: "piece", quantity: 2, purpose: "USC", borrowerName: "Ana Marie Santos", studentId: null, reason: null, returnBy: "2026-10-06", status: "OUT", returnNote: null, createdAt: "2026-10-01T02:00:00.000Z", closedAt: null, createdBy: null, closedBy: null };
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** Mocks one page, or a whole browser context so a tab the test opens is answered too (it never reaches a real server). */
async function mock(page: Page | BrowserContext) {
  const scans: string[] = [];
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, id: "ACC-owner", username: "owner.sample", displayName: "Owner Sample", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false, directory: null }) }));
  await page.route("**/api/staff/admin/directory**", (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    const side = url.pathname.match(/\/id\/(front|back|thumb|face)$/)?.[1];
    if (side) { scans.push(side); return route.fulfill({ contentType: "image/png", body: pixel }); }
    if (url.pathname === "/api/staff/admin/directory") return json({ people });
    if (url.pathname.endsWith("/accounts")) return json({ accounts: [] });
    if (url.pathname.endsWith("/derived")) return json({ missing: [] });
    if (url.pathname.endsWith("/access")) return json({ account: null, suggestedUsername: "ana.santos" });
    if (url.pathname.endsWith("/loans")) return json({ loans: url.pathname.includes(id(1)) ? [loan] : [] });
    if (url.pathname.endsWith("/usage")) return json({ usage: [], truncated: false });
    const who = people.find((entry) => url.pathname.includes(entry.id))!;
    return json({ person: who, card: who.hasId ? card : null, history: [] });
  });
  return scans;
}

test("the wall shows each uploaded ID front; a card opens on the ID, turns over at a tap, and switches to the details", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scans = await mock(page);
  await page.goto("/staff/admin/directory");
  const logistics = page.getByRole("region", { name: "Department of Logistics" });
  await expect(logistics.getByRole("link")).toHaveCount(2);
  // A person with an ID on file shows its front (the thumbnail); without one, the drawn card. The wall opens no full scan.
  await expect(page.locator(`a[data-person="${id(1)}"] img[data-thumb]`)).toHaveAttribute("src", `/api/staff/admin/directory/${id(1)}/id/thumb`);
  await expect(page.locator(`a[data-person="${id(2)}"] img[data-thumb]`)).toHaveCount(0);
  await expect.poll(() => scans.filter((kind) => kind === "front" || kind === "back")).toEqual([]);
  await page.getByRole("button", { name: /^Inactive/ }).click();
  await expect(page.getByRole("link", { name: /Gio Tan/ })).toContainText("Inactive");
  await page.getByRole("button", { name: /^Everyone/ }).click();

  await page.getByRole("link", { name: /Ana Marie Santos/ }).click();
  const viewer = page.getByRole("dialog", { name: "USC ID of Ana Marie Santos" });
  await expect(viewer.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-pressed", "true");
  // One card: its front up, its back underneath (loaded, out of reach until turned over).
  await expect(viewer.getByRole("img", { name: "Front of Ana Marie Santos's USC ID" })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Back of Ana Marie Santos's USC ID" })).toBeHidden();
  await expect.poll(() => scans.filter((kind) => kind === "front" || kind === "back").sort()).toEqual(["back", "front"]);
  await expect(viewer.getByRole("group", { name: "Zoom" })).toBeVisible();
  await page.keyboard.press("f");
  await expect(viewer.getByRole("img", { name: "Back of Ana Marie Santos's USC ID" })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Front of Ana Marie Santos's USC ID" })).toBeHidden();
  // A tap on the card turns it back over; so does the Turn over button.
  const box = (await page.locator("[data-flight]").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(viewer.getByRole("img", { name: "Front of Ana Marie Santos's USC ID" })).toBeVisible();
  await viewer.getByRole("button", { name: "Turn over to the back" }).click();
  await expect(viewer.getByRole("img", { name: "Back of Ana Marie Santos's USC ID" })).toBeVisible();
  // The details are on the face underneath: out of reach of Tab and assistive technology until turned to.
  await expect(viewer.getByRole("heading", { name: "Ana Marie Santos" })).toBeHidden();

  await page.keyboard.press("d");
  await expect(viewer.getByRole("button", { name: "Details" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("heading", { name: "Ana Marie Santos" })).toBeVisible();
  await expect(viewer).toContainText("20-1111-222");
  await expect(viewer.getByRole("region", { name: "On loan now" })).toContainText("2 × Extension cord");
  // Their photo, cut from the ID, is the profile picture.
  await expect(viewer.locator("img[data-face-pic]")).toHaveAttribute("src", `/api/staff/admin/directory/${id(1)}/id/face`);
  // Zoom is for the ID only.
  await expect(viewer.getByRole("group", { name: "Zoom" })).toBeHidden();
  // Back to the profile: the ID, on the side it was left.
  await page.keyboard.press("p");
  await expect(viewer.getByRole("heading", { name: "Ana Marie Santos" })).toBeHidden();
  await expect(viewer.getByRole("img", { name: "Back of Ana Marie Santos's USC ID" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Ana Marie Santos/ })).toBeFocused();
});

test("a person whose thumbnail is not made yet shows the drawn card; the owner makes the missing pictures in one step", async ({ page }) => {
  await mock(page);
  const made: string[] = [];
  await page.route("**/api/staff/admin/directory/derived", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ missing: made.length ? [] : [{ id: id(1), mediaId: card.mediaId }] }) }));
  await page.route(`**/api/staff/admin/directory/${id(1)}/id/derived`, (route) => { made.push(route.request().method()); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ mediaId: card.mediaId }) }); });
  await page.route(`**/api/staff/admin/directory/${id(1)}/id/thumb`, (route) => made.length ? route.fulfill({ contentType: "image/png", body: pixel }) : route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.goto("/staff/admin/directory");
  const tile = page.locator(`a[data-person="${id(1)}"]`);
  await expect(tile.locator("img[data-thumb]")).toHaveCount(0);
  await expect(tile).toContainText("Ana Marie Santos");
  await page.getByRole("button", { name: "Make them now" }).click();
  await expect(page.getByRole("button", { name: "Make them now" })).toHaveCount(0);
  expect(made).toEqual(["PUT"]);
  await expect(tile.locator("img[data-thumb]")).toHaveCount(1);
});

test("a card's section link closes it and opens that section; Back returns to the wall", async ({ page }) => {
  await mock(page);
  await page.goto("/staff/admin/directory");
  await page.getByRole("link", { name: /Bea Cruz Reyes/ }).click();
  const viewer = page.getByRole("dialog", { name: "USC ID of Bea Cruz Reyes" });
  // No USC ID on file: the card has no sides to turn to.
  await expect(viewer.getByRole("group", { name: "View" })).toBeHidden();
  await viewer.getByRole("link", { name: "Usage" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`person=${id(2)}&tab=usage`));
  await expect(page.getByRole("tab", { name: "Usage" })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page).toHaveURL(/\/staff\/admin\/directory$/);
  await expect(page.getByRole("link", { name: /Bea Cruz Reyes/ })).toBeVisible();
});

test("a modifier press follows the card's link to the profile, and the profile's own card opens on the ID", async ({ page, context }) => {
  // The new tab is mocked too. Unmocked, its API calls reached the preview server, which has no API, so it showed "The staff
  // workspace is unavailable" and the test proved only the address; now it proves the profile opens there.
  await mock(context);
  await page.goto("/staff/admin/directory");
  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: /Ana Marie Santos/ }).click({ modifiers: ["ControlOrMeta"] })]);
  // A new tab loads the whole application cold, so it gets longer than the default 5 s (it timed out once in CI under load).
  await expect(tab).toHaveURL(new RegExp(`person=${id(1)}`), { timeout: 15_000 });
  await expect(tab.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(tab).toHaveURL(new RegExp(`person=${id(1)}`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(`/staff/admin/directory?person=${id(1)}`);
  await page.getByRole("button", { name: "Open Ana Marie Santos's card" }).click();
  const viewer = page.getByRole("dialog", { name: "USC ID of Ana Marie Santos" });
  await expect(viewer.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("img", { name: "Front of Ana Marie Santos's USC ID" })).toBeVisible();
});

test("a profile without a sign-in makes one in a step and shows its password once; a linked one shows how it is used", async ({ page }) => {
  await mock(page);
  let made: unknown = null;
  await page.route(`**/api/staff/admin/directory/${id(2)}/account/new`, async (route) => {
    made = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ accountId: "ACC-new", username: "bea.reyes", generatedPassword: "sample one-time pass 1" }) });
  });
  await page.route(`**/api/staff/admin/directory/${id(2)}/access`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ account: null, suggestedUsername: "bea.reyes" }) }));
  await page.goto(`/staff/admin/directory?person=${id(2)}`);
  const access = page.getByRole("region", { name: "Sign-in and access" });
  await expect(access.getByLabel("Username")).toHaveValue("bea.reyes");
  // Roles by department: DoL Staff (the Logistics Hub) first, then every other department's staff, Officer and, for an owner, Owner.
  await expect(access.getByLabel("Role").locator("option")).toHaveText(["DoL Staff", "OfP Staff", "OVP Staff", "SEC Staff", "DoF Staff", "DEM Staff", "DCES Staff", "DPC Staff", "DHR Staff", "DBR Staff", "Officer", "Owner"]);
  // Bea is in the Department of Logistics, so DoL Staff is chosen for her.
  await expect(access.getByLabel("Role")).toHaveValue("DoL");
  await access.getByRole("button", { name: "Create sign-in" }).click();
  await expect(access.locator(".secret code")).toHaveText("sample one-time pass 1");
  expect(made).toEqual({ username: "bea.reyes", access: "DoL" });
  // The other way in stays out of sight once a sign-in was made.
  await expect(access.getByText("Or link a sign-in they already have")).toBeHidden();

  const hour = (n: number) => new Date(Date.parse("2026-10-03T10:00:00Z") - n * 3_600_000).toISOString();
  await page.route(`**/api/staff/admin/directory/${id(1)}/access`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ self: false, manageable: true,
    account: { id: "ACC-1", username: "ana.santos", displayName: "Ana Santos", role: "STAFF", access: "DoL", active: true, mustChangePassword: false, createdAt: hour(400), lastLoginAt: hour(1), openSessions: 2, failedAttempts: 4 },
    signIns: [{ at: hour(1), until: hour(-7), state: "OPEN" }, { at: hour(30), until: hour(26), state: "ENDED" }],
    events: [{ at: hour(400), action: "ACCOUNT_CREATED", actor: "Owner Sample", details: { username: "ana.santos", role: "STAFF" } }] }) }));
  let reset = false;
  await page.route("**/api/staff/admin/accounts/ACC-1/password", (route) => { reset = true; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ generatedPassword: "sample one-time pass 2" }) }); });
  await page.goto(`/staff/admin/directory?person=${id(1)}`);
  await expect(access.getByText("On 2 devices")).toBeVisible();
  await expect(access.getByText("4 failed sign-ins in the last 15 minutes")).toBeVisible();
  await expect(access.locator(".access-log").first()).toContainText("signed in now");
  await expect(access.locator(".access-log").last()).toContainText("Owner Sample created ana.santos (DoL Staff)");
  page.once("dialog", (dialog) => dialog.accept());
  await access.getByRole("button", { name: "Reset password" }).click();
  await expect(access.locator(".secret code")).toHaveText("sample one-time pass 2");
  expect(reset).toBe(true);
});

test("a sign-in for another department's staff opens their account only, with no Logistics Hub sections", async ({ page }) => {
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, id: "ACC-dem", username: "dem.sample", displayName: "Dem Sample", role: "STAFF", access: "DEM", hub: false, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null }) }));
  await page.goto("/staff/items");
  await expect(page).toHaveURL(/\/staff\/account$/);
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();
  await expect(page.getByText("Your sign-in is set up as DEM Staff.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Items" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await page.goto("/staff/admin/directory");
  await expect(page).toHaveURL(/\/staff\/account$/);
});

test("an address whose person is not a directory id opens the wall and asks the API for nothing else", async ({ page }) => {
  await mock(page);
  const asked: string[] = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/")) asked.push(url.pathname); });
  for (const forged of ["..", "../../items", "PER-1/../../../items"]) {
    asked.length = 0;
    await page.goto(`/staff/admin/directory?person=${encodeURIComponent(forged)}`);
    await expect(page.getByRole("link", { name: /Ana Marie Santos/ })).toBeVisible();
    // Only the wall's own reads; before the check, ".." fetched /api/staff/admin/ and the others a profile that is no one's.
    expect(asked.filter((path) => !["/api/staff/session", "/api/staff/attention/summary", "/api/staff/admin/directory", "/api/staff/admin/directory/derived"].includes(path) && !/^\/api\/staff\/admin\/directory\/PER-[0-9a-f-]+\/id\/thumb$/.test(path))).toEqual([]);
  }
});
