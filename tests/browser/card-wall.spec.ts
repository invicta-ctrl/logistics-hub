import { expect, test, type Page } from "@playwright/test";

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

async function mock(page: Page) {
  const scans: string[] = [];
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, id: "ACC-owner", username: "owner.sample", displayName: "Owner Sample", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false, directory: null }) }));
  await page.route("**/api/staff/admin/directory**", (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    const side = url.pathname.match(/\/id\/(front|back)$/)?.[1];
    if (side) { scans.push(side); return route.fulfill({ contentType: "image/png", body: pixel }); }
    if (url.pathname === "/api/staff/admin/directory") return json({ people });
    if (url.pathname.endsWith("/accounts")) return json({ accounts: [] });
    if (url.pathname.endsWith("/access")) return json({ account: null, suggestedUsername: "ana.santos" });
    if (url.pathname.endsWith("/loans")) return json({ loans: url.pathname.includes(id(1)) ? [loan] : [] });
    if (url.pathname.endsWith("/usage")) return json({ usage: [], truncated: false });
    const who = people.find((entry) => url.pathname.includes(entry.id))!;
    return json({ person: who, card: who.hasId ? card : null, history: [] });
  });
  return scans;
}

test("the wall shows a card per person by department; a card opens on the details, then turns to the ID", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scans = await mock(page);
  await page.goto("/staff/admin/directory");
  const logistics = page.getByRole("region", { name: "Department of Logistics" });
  await expect(logistics.getByRole("link")).toHaveCount(2);
  await page.getByRole("button", { name: /^Inactive/ }).click();
  await expect(page.getByRole("link", { name: /Gio Tan/ })).toContainText("Inactive");
  await page.getByRole("button", { name: /^Everyone/ }).click();

  await page.getByRole("link", { name: /Ana Marie Santos/ }).click();
  const viewer = page.getByRole("dialog", { name: "USC ID of Ana Marie Santos" });
  await expect(viewer.getByRole("heading", { name: "Ana Marie Santos" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Details" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer).toContainText("20-1111-222");
  await expect(viewer.getByRole("region", { name: "On loan now" })).toContainText("2 × Extension cord");
  // Opening a card is not opening an ID: nothing is fetched until a side is turned to.
  expect(scans).toEqual([]);
  // Zoom is for the scans only.
  await expect(viewer.getByRole("group", { name: "Zoom" })).toBeHidden();

  await page.keyboard.press("f");
  await expect(viewer.getByRole("img", { name: "Front of Ana Marie Santos's USC ID" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Front" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("group", { name: "Zoom" })).toBeVisible();
  expect(scans).toEqual(["front"]);
  // The details are on the face underneath now: out of reach of Tab and assistive technology.
  await expect(viewer.getByRole("heading", { name: "Ana Marie Santos" })).toBeHidden();
  await page.keyboard.press("d");
  await expect(viewer.getByRole("heading", { name: "Ana Marie Santos" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Ana Marie Santos/ })).toBeFocused();
});

test("a card's section link closes it and opens that section; Back returns to the wall", async ({ page }) => {
  await mock(page);
  await page.goto("/staff/admin/directory");
  await page.getByRole("link", { name: /Bea Cruz Reyes/ }).click();
  const viewer = page.getByRole("dialog", { name: "USC ID of Bea Cruz Reyes" });
  // No USC ID on file: the card has no sides to turn to.
  await expect(viewer.getByRole("group", { name: "Side of the card" })).toBeHidden();
  await viewer.getByRole("link", { name: "Usage" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`person=${id(2)}&tab=usage`));
  await expect(page.getByRole("tab", { name: "Usage" })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page).toHaveURL(/\/staff\/admin\/directory$/);
  await expect(page.getByRole("link", { name: /Bea Cruz Reyes/ })).toBeVisible();
});

test("a modifier press follows the card's link to the profile, and the profile's own card opens on the ID", async ({ page, context }) => {
  await mock(page);
  await page.goto("/staff/admin/directory");
  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: /Ana Marie Santos/ }).click({ modifiers: ["ControlOrMeta"] })]);
  await expect(tab).toHaveURL(new RegExp(`person=${id(1)}`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(`/staff/admin/directory?person=${id(1)}`);
  await page.getByRole("button", { name: "Open Ana Marie Santos's card" }).click();
  const viewer = page.getByRole("dialog", { name: "USC ID of Ana Marie Santos" });
  await expect(viewer.getByRole("button", { name: "Front" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("img", { name: "Front of Ana Marie Santos's USC ID" })).toBeVisible();
});

test("a profile without a sign-in makes one in a step and shows its password once; a linked one shows how it is used", async ({ page }) => {
  await mock(page);
  let made: unknown = null;
  await page.route(`**/api/staff/admin/directory/${id(2)}/account/new`, async (route) => {
    made = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ accountId: "ACC-new", username: "bea.reyes", generatedPassword: "Kp7qR-x2mWd-9HtzB-c4NvY" }) });
  });
  await page.route(`**/api/staff/admin/directory/${id(2)}/access`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ account: null, suggestedUsername: "bea.reyes" }) }));
  await page.goto(`/staff/admin/directory?person=${id(2)}`);
  const access = page.getByRole("region", { name: "Sign-in and access" });
  await expect(access.getByLabel("Username")).toHaveValue("bea.reyes");
  await expect(access.getByLabel("Role").locator("option")).toHaveText(["Staff", "Administrator", "Owner"]);
  await access.getByRole("button", { name: "Create sign-in" }).click();
  await expect(access.locator(".secret code")).toHaveText("Kp7qR-x2mWd-9HtzB-c4NvY");
  expect(made).toEqual({ username: "bea.reyes", role: "STAFF" });
  // The other way in stays out of sight once a sign-in was made.
  await expect(access.getByText("Or link a sign-in they already have")).toBeHidden();

  const hour = (n: number) => new Date(Date.parse("2026-10-03T10:00:00Z") - n * 3_600_000).toISOString();
  await page.route(`**/api/staff/admin/directory/${id(1)}/access`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ self: false, manageable: true,
    account: { id: "ACC-1", username: "ana.santos", displayName: "Ana Santos", role: "STAFF", active: true, mustChangePassword: false, createdAt: hour(400), lastLoginAt: hour(1), openSessions: 2, failedAttempts: 4 },
    signIns: [{ at: hour(1), until: hour(-7), state: "OPEN" }, { at: hour(30), until: hour(26), state: "ENDED" }],
    events: [{ at: hour(400), action: "ACCOUNT_CREATED", actor: "Owner Sample", details: { username: "ana.santos", role: "STAFF" } }] }) }));
  let reset = false;
  await page.route("**/api/staff/admin/accounts/ACC-1/password", (route) => { reset = true; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ generatedPassword: "Zz9aa-Bb8cc-Dd7ee-Ff6gg" }) }); });
  await page.goto(`/staff/admin/directory?person=${id(1)}`);
  await expect(access.getByText("On 2 devices")).toBeVisible();
  await expect(access.getByText("4 failed sign-ins in the last 15 minutes")).toBeVisible();
  await expect(access.locator(".access-log").first()).toContainText("signed in now");
  await expect(access.locator(".access-log").last()).toContainText("Owner Sample created ana.santos (Staff)");
  page.once("dialog", (dialog) => dialog.accept());
  await access.getByRole("button", { name: "Reset password" }).click();
  await expect(access.locator(".secret code")).toHaveText("Zz9aa-Bb8cc-Dd7ee-Ff6gg");
  expect(reset).toBe(true);
});
