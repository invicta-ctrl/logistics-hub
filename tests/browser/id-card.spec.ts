import { expect, test, type Page } from "@playwright/test";

/*
 * The USC ID card in 3D (src/card-motion.ts): it flies out of its tile, leans toward the mouse and settles flat when let go,
 * turns over, lies still while zoomed, flies back into its tile, and does none of it under reduced motion. The API is mocked
 * and the scan is a single pixel: only the card's pose matters here, read from its computed 3D matrix.
 */

const ID = "PER-00000000-0000-4000-8000-000000000001";
const person = { id: ID, name: "Ana Santos", department: "DoL", position: "Materials committee", officer: false, studentId: null, active: true, sourceKey: null, createdAt: "2026-10-01T02:00:00.000Z", updatedAt: "2026-10-01T02:00:00.000Z", hasId: true, account: null };
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function mock(page: Page, size = { width: 856, height: 540 }) {
  const card = { mediaId: "00000000-0000-4000-8000-00000000abcd", front: size, back: size, sourceFront: "Santos_Front_DoL.png", sourceBack: "Santos_Back_DoL.png", createdAt: "2026-10-01T02:00:00.000Z", createdBy: "Owner Sample" };
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, id: "ACC-owner", username: "owner.sample", displayName: "Owner Sample", role: "OWNER", mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false, directory: null }) }));
  await page.route("**/api/staff/admin/directory**", (route) => {
    const url = new URL(route.request().url());
    if (/\/id\/(front|back|thumb|face)$/.test(url.pathname)) return route.fulfill({ contentType: "image/png", body: pixel });
    const body = url.pathname === "/api/staff/admin/directory" ? { people: [person] } : url.pathname.endsWith("/accounts") ? { accounts: [] } : url.pathname.endsWith("/access") ? { account: null, suggestedUsername: "ana.santos" } : url.pathname.endsWith("/derived") ? { missing: [] } : { person, card, history: [] };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
}

/** The card's pose. With the pointer at mid-height only the turn about the vertical axis is left: m13 = −sin(angle). */
const pose = (page: Page) => page.locator("[data-card]").evaluate((element) => {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
  return { m11: matrix.m11, m13: matrix.m13, m22: matrix.m22, m23: matrix.m23 };
});
const flat = (side: "front" | "back") => (value: { m11: number; m13: number; m23: number }) =>
  Math.abs(value.m11 - (side === "front" ? 1 : -1)) < 0.002 && Math.abs(value.m13) < 0.01 && Math.abs(value.m23) < 0.01;

async function openFront(page: Page) {
  await page.goto(`/staff/admin/directory?person=${ID}&tab=id`);
  const tile = page.getByRole("button", { name: "Open the front of the USC ID large" });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>("[data-scan]")].every((image) => image.complete && image.naturalWidth > 0));
  await tile.click();
  const viewer = page.getByRole("dialog", { name: "USC ID of Ana Santos" });
  await expect(viewer.getByRole("img", { name: "Front of Ana Santos's USC ID" })).toBeVisible();
  return { tile, viewer };
}

test("the card flies out of its tile, leans toward the mouse, settles flat, turns over, lies still when zoomed, and flies back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mock(page);
  const { tile, viewer } = await openFront(page);
  // It flies: an animation runs on the card's flight box, the tile it left is empty, and both end when it lands.
  expect(await page.locator("[data-flight]").evaluate((element) => element.getAnimations().length)).toBe(1);
  await expect(tile).toHaveClass(/is-away/);
  await expect.poll(() => page.locator("[data-flight]").evaluate((element) => element.getAnimations().length), { timeout: 4000 }).toBe(0);
  await expect(tile).not.toHaveClass(/is-away/);

  const box = (await page.locator("[data-flight]").boundingBox())!;
  const middle = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.9, middle, { steps: 4 });
  await expect.poll(async () => (await pose(page)).m13, { timeout: 3000 }).toBeGreaterThan(0.15);
  await page.mouse.move(box.x + box.width * 0.1, middle, { steps: 4 });
  await expect.poll(async () => (await pose(page)).m13, { timeout: 3000 }).toBeLessThan(-0.15);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.08, { steps: 4 });
  await expect.poll(async () => (await pose(page)).m23, { timeout: 3000 }).toBeLessThan(-0.1);
  // The mouse leaves the card: back to flat, slowly and loosely.
  await page.mouse.move(box.x + box.width / 2, box.y - 30);
  await expect.poll(async () => flat("front")(await pose(page)), { timeout: 8000 }).toBe(true);

  await page.keyboard.press("d");
  await expect(viewer.getByRole("button", { name: "Details" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => flat("back")(await pose(page)), { timeout: 4000 }).toBe(true);
  await page.keyboard.press("p");
  await expect.poll(async () => flat("front")(await pose(page)), { timeout: 4000 }).toBe(true);

  // Zoomed in, the card is for reading: it does not lean.
  await page.keyboard.press("+");
  await page.mouse.move(box.x + box.width * 0.85, middle, { steps: 4 });
  await page.waitForTimeout(400);
  expect(flat("front")(await pose(page))).toBe(true);
  await page.keyboard.press("0");

  // Escape flies it back into its tile, then the viewer is gone and the focus is on the tile again.
  await page.keyboard.press("Escape");
  expect(await page.locator("[data-flight]").evaluate((element) => element.getAnimations().length)).toBe(1);
  await expect(viewer).toHaveCount(0);
  await expect(tile).toBeFocused();
  await expect(tile).not.toHaveClass(/is-away/);
});

test("with reduced motion nothing flies, leans or spins: the card opens flat and turns over at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await mock(page);
  const { tile, viewer } = await openFront(page);
  expect(await page.locator("dialog.id-viewer").evaluate((dialog) => dialog.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(viewer.locator(".id-viewer__hint")).not.toContainText("tilt");
  const box = (await page.locator("[data-flight]").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.1, { steps: 4 });
  await page.waitForTimeout(400);
  expect(flat("front")(await pose(page))).toBe(true);
  // At once: within 120 ms (the app's reduced-motion rule leaves a 0.01 ms transition), where a spring turn is still 50° short.
  await page.evaluate(() => document.querySelector("dialog.id-viewer")!.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true })));
  await expect.poll(async () => flat("back")(await pose(page)), { timeout: 120, intervals: [16] }).toBe(true);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(tile).toBeFocused();
});

test("a portrait card gets a portrait tile and viewer, and a tile leans under the mouse only", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mock(page, { width: 540, height: 856 });
  await page.goto(`/staff/admin/directory?person=${ID}&tab=id`);
  const tile = page.getByRole("button", { name: "Open the front of the USC ID large" });
  const shape = (await tile.boundingBox())!;
  expect(shape.height / shape.width).toBeCloseTo(856 / 540, 1);
  const lean = () => tile.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m13);
  await page.mouse.move(shape.x + shape.width * 0.9, shape.y + shape.height / 2, { steps: 4 });
  await expect.poll(lean).not.toBeCloseTo(0, 2);
  await page.mouse.move(shape.x - 40, shape.y - 40);
  await expect.poll(lean, { timeout: 3000 }).toBeCloseTo(0, 3);
  await tile.click();
  await expect.poll(() => page.locator("[data-flight]").evaluate((element) => element.getAnimations().length), { timeout: 4000 }).toBe(0);
  const card = (await page.locator("[data-flight]").boundingBox())!;
  expect(card.height / card.width).toBeCloseTo(856 / 540, 1);
});
