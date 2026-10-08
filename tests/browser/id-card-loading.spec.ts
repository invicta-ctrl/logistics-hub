import { expect, test, type Page } from "@playwright/test";

/*
 * USC ID scans while they load (V1.15): each side loads lazily and in order, a scan that cannot be opened says why and offers
 * "Try again" (on the tile and on the large card), a stalled scan or card ends in a message, and a tap on a card is
 * acknowledged at once. The API is mocked; a scan is a single pixel.
 */

const ID = "PER-00000000-0000-4000-8000-000000000001";
const person = { id: ID, name: "Ana Santos", department: "DoL", position: "Materials committee", officer: false, studentId: null, active: true, sourceKey: null, createdAt: "2026-10-01T02:00:00.000Z", updatedAt: "2026-10-01T02:00:00.000Z", hasId: true, account: null };
const card = { mediaId: "00000000-0000-4000-8000-00000000abcd", front: { width: 856, height: 540 }, back: { width: 856, height: 540 }, sourceFront: "Santos_Front_DoL.png", sourceBack: "Santos_Back_DoL.png", createdAt: "2026-10-01T02:00:00.000Z", createdBy: "Owner Sample" };
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const json = (body: unknown) => ({ contentType: "application/json", body: JSON.stringify(body) });

type Scans = { asked: string[]; fail: Set<string>; stall: Set<string> };
async function mock(page: Page): Promise<Scans> {
  const scans: Scans = { asked: [], fail: new Set(), stall: new Set() };
  await page.route("**/api/staff/session", (route) => route.fulfill(json({ authenticated: true, id: "ACC-owner", username: "owner.sample", displayName: "Owner Sample", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false, directory: null })));
  await page.route("**/api/staff/admin/directory**", async (route) => {
    const url = new URL(route.request().url());
    const scan = /\/id\/(front|back)$/.exec(url.pathname)?.[1];
    if (scan) {
      scans.asked.push(scan);
      if (scans.stall.has(scan)) return new Promise<void>(() => undefined);
      if (scans.fail.has(scan)) return route.fulfill({ status: 503, ...json({ error: "unavailable" }) });
      return route.fulfill({ contentType: "image/png", headers: { "cache-control": "no-store" }, body: pixel });
    }
    if (/\/id\/(thumb|face)$/.test(url.pathname)) return route.fulfill({ contentType: "image/png", body: pixel });
    const body = url.pathname === "/api/staff/admin/directory" ? { people: [person] } : url.pathname.endsWith("/accounts") ? { accounts: [] } : url.pathname.endsWith("/access") ? { account: null, suggestedUsername: "ana.santos" } : url.pathname.endsWith("/derived") ? { missing: [] } : { person, card, history: [] };
    return route.fulfill(json(body));
  });
  return scans;
}

const idTab = `/staff/admin/directory?person=${ID}&tab=id`;
const front = (page: Page) => page.getByRole("button", { name: "Open the front of the USC ID large" });
const back = (page: Page) => page.getByRole("button", { name: "Open the back of the USC ID large" });

test("on a phone the back scan is fetched only when its tile is near the screen", async ({ page }) => {
  // The back tile sits below the front one, a few hundred pixels under this short screen.
  await page.setViewportSize({ width: 390, height: 420 });
  const scans = await mock(page);
  await page.goto(idTab);
  await expect(front(page).locator("img")).toHaveAttribute("src", /^data:image\//);
  expect(scans.asked).toEqual(["front"]);
  await back(page).scrollIntoViewIfNeeded();
  await expect(back(page).locator("img")).toHaveAttribute("src", /^data:image\//);
  expect(scans.asked).toEqual(["front", "back"]);
});

test("a tile whose scan cannot be opened says why and loads it when asked again", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const scans = await mock(page);
  scans.fail.add("front");
  await page.goto(idTab);
  const note = page.locator(".id-tile__failed");
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("This scan could not be opened.");
  // The back is unaffected, and nothing about the failure is stored.
  await expect(back(page).locator("img")).toHaveAttribute("src", /^data:image\//);
  scans.fail.delete("front");
  // From the keyboard: the button goes with its note, and focus moves to the tile rather than falling to the page.
  await note.getByRole("button", { name: "Try again" }).press("Enter");
  await expect(front(page).locator("img")).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator(".id-tile__failed")).toHaveCount(0);
  await expect(front(page)).toBeFocused();
  await expect(front(page)).not.toHaveClass(/is-loading/);
});

test("a stalled tile scan ends in a message instead of a spinner", async ({ page }) => {
  // The browser's own abort timer is shortened for the test; the app asks for twenty seconds.
  await page.addInitScript(() => { const original = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = (ms: number) => original(Math.min(ms, 600)); });
  await page.setViewportSize({ width: 1280, height: 800 });
  const scans = await mock(page);
  scans.stall.add("front");
  await page.goto(idTab);
  await expect(front(page)).toHaveClass(/is-loading/);
  await expect(page.locator(".id-tile__failed")).toContainText("This scan is taking too long to open.");
  await expect(front(page)).not.toHaveClass(/is-loading/);
});

test("a stalled tile scan says it took too long on Safari too, whose timed-out fetch rejects with AbortError", async ({ page }) => {
  // WebKit 26 rejects a fetch whose AbortSignal.timeout fired with an AbortError, not Chromium's TimeoutError.
  await page.addInitScript(() => { AbortSignal.timeout = () => { const controller = new AbortController(); setTimeout(() => controller.abort(), 600); return controller.signal; }; });
  await page.setViewportSize({ width: 1280, height: 800 });
  const scans = await mock(page);
  scans.stall.add("front");
  await page.goto(idTab);
  await expect(page.locator(".id-tile__failed")).toContainText("This scan is taking too long to open.");
});

test("the large card shows a failed side with its own Try again, and the back follows the front", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const scans = await mock(page);
  // A person opened from the wall has no scans loaded yet: the viewer asks for the front first, then the back.
  await page.goto("/staff/admin/directory");
  scans.fail.add("front");
  await page.locator(`a.dir-card[data-person="${ID}"]`).click();
  const viewer = page.getByRole("dialog", { name: "USC ID of Ana Santos" });
  const failed = viewer.locator(".id-card__scan.is-failed .id-card__failed");
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("This scan could not be opened.");
  // The back is not requested while the front is not here.
  expect(scans.asked).toEqual(["front"]);
  scans.fail.delete("front");
  await failed.getByRole("button", { name: "Try again" }).press("Enter");
  await expect(viewer.getByRole("img", { name: "Front of Ana Santos's USC ID" })).toBeVisible();
  await expect(failed).toBeHidden();
  // Focus stayed in the viewer when the button was hidden.
  expect(await viewer.evaluate((dialog) => dialog.contains(document.activeElement) && document.activeElement !== dialog)).toBe(true);
  await expect.poll(() => scans.asked).toEqual(["front", "front", "back"]);
  // Pressing the button did not turn the card over.
  await expect(page.locator("[data-card]")).toHaveAttribute("data-side", "front");
});

test("a tap on a wall card is acknowledged while its details load, and a card that never comes ends in a message", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await mock(page);
  await page.goto("/staff/admin/directory");
  await expect(page.locator(`a.dir-card[data-person="${ID}"]`)).toBeVisible();
  // From here the person's details never answer.
  await page.route(`**/api/staff/admin/directory/${ID}`, () => new Promise<void>(() => undefined));
  const tile = page.locator(`a.dir-card[data-person="${ID}"]`);
  await tile.click();
  await expect(tile).toHaveAttribute("aria-busy", "true");
  await page.clock.fastForward(16_000);
  await expect(page.getByText("The card is taking too long to open.")).toBeVisible();
  await expect(tile).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("dialog", { name: "USC ID of Ana Santos" })).toHaveCount(0);
});
