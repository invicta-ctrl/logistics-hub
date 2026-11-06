import { expect, test } from "@playwright/test";

/**
 * The landing page's water (LH-UI-88 S1, added at Earl's word on 2026-11-06): decoration that must never block the page, must be
 * completely still under reduced motion, and must clean up after itself when the router leaves the page.
 */

const catalog = { revision: 1, categories: [], items: [] };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify(catalog) }));
  // Count what the water does: WebGL contexts it asks for, and the pointer listeners it adds and removes on the window.
  await page.addInitScript(() => {
    const spy = { contexts: 0, pointer: 0 };
    (window as unknown as { spy: typeof spy }).spy = spy;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === "webgl" || kind === "webgl2") spy.contexts += 1;
      return (getContext as (...args: unknown[]) => unknown).call(this, kind, ...rest) as never;
    } as typeof HTMLCanvasElement.prototype.getContext;
    // The water refuses a software renderer (headless Chromium has only one). These tests present a GPU name, except the one about that
    // refusal, which sets `softwareOnly` before the page loads.
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (this: WebGLRenderingContext, parameter: number) {
      if (parameter === 0x9246) return (window as unknown as { softwareOnly?: boolean }).softwareOnly ? "Google SwiftShader" : "Test GPU";
      return getParameter.call(this, parameter);
    } as typeof WebGLRenderingContext.prototype.getParameter;
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: unknown[]) => { if (type === "pointermove") spy.pointer += 1; return (add as (...args: unknown[]) => void)(type, ...rest); }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: unknown[]) => { if (type === "pointermove") spy.pointer -= 1; return (remove as (...args: unknown[]) => void)(type, ...rest); }) as typeof window.removeEventListener;
  });
});

const spy = (page: import("@playwright/test").Page) => page.evaluate(() => ({ ...(window as unknown as { spy: { contexts: number; pointer: number } }).spy }));

test("the landing page has its water layer, grain and campus photograph, and nothing overflows", async ({ page }) => {
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".hero .water-layer canvas")).toHaveCount(1);
    await expect(page.locator(".water-layer")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".landing-grain")).toHaveAttribute("aria-hidden", "true");
    await page.locator(".campus img").scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator(".campus img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // The grain and the water never take a click or a tap from the page.
    expect(await page.locator(".landing-grain").evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
    expect(await page.locator(".water-layer").evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
  }
});

test("the water and grain belong to the landing page alone", async ({ page }) => {
  await page.goto("/lending");
  await expect(page.locator(".site-header")).toBeVisible();
  await expect(page.locator(".water-layer, .landing-grain, .campus")).toHaveCount(0);
});

test("with reduced motion the water never starts: no WebGL, no pointer tracking, the still image only", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Borrow equipment from the USC Department of Logistics" })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await spy(page)).toEqual({ contexts: 0, pointer: 0 });
  expect(await page.locator(".water-layer canvas").evaluate((canvas) => canvas.classList.contains("ready"))).toBe(false);
  expect(await page.locator(".water-layer").evaluate((layer) => getComputedStyle(layer).backgroundImage)).toContain("water-still.webp");
  await page.mouse.move(400, 200);
  await page.mouse.move(700, 260);
  expect(await spy(page)).toEqual({ contexts: 0, pointer: 0 });
});

test("the water runs on a normal screen, stops when reduced motion is turned on, and cleans up when the page is left", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".water-layer canvas.ready")).toHaveCount(1, { timeout: 10_000 });
  expect(await spy(page)).toEqual({ contexts: 1, pointer: 1 });
  await expect.poll(() => page.locator(".water-layer canvas").evaluate((canvas) => getComputedStyle(canvas).opacity)).toBe("1");
  // Turning reduced motion on while the page is open stops tracking and hides the canvas, leaving the still image.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await spy(page)).pointer).toBe(0);
  await expect.poll(() => page.locator(".water-layer canvas").evaluate((canvas) => getComputedStyle(canvas).opacity)).toBe("0");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(async () => (await spy(page)).pointer).toBe(1);
  // Leaving the page (a router navigation, not a reload) removes every listener the water added.
  await page.getByRole("link", { name: /Browse the Lending Hub/ }).first().click();
  await expect(page).toHaveURL(/\/lending$/);
  await expect(page.locator(".water-layer")).toHaveCount(0);
  await expect.poll(async () => (await spy(page)).pointer).toBe(0);
  // Coming back builds one fresh water, not two.
  await page.getByRole("link", { name: "Department of Logistics HAU University Student Council home" }).click();
  await expect(page.locator(".water-layer canvas.ready")).toHaveCount(1, { timeout: 10_000 });
  expect((await spy(page)).pointer).toBe(1);
});

test("the water pauses while the hero is scrolled away and starts again when it returns", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto("/");
  await expect(page.locator(".water-layer canvas.ready")).toHaveCount(1, { timeout: 10_000 });
  expect((await spy(page)).pointer).toBe(1);
  await page.locator(".campus").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => (await spy(page)).pointer).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await spy(page)).pointer).toBe(1);
});

test("a browser that can only draw WebGL in software is refused: no drawing, no pointer tracking, the still image stays", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { softwareOnly: boolean }).softwareOnly = true; });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Borrow equipment from the USC Department of Logistics" })).toBeVisible();
  await page.waitForTimeout(800);
  expect((await spy(page)).contexts).toBe(1);
  expect(await page.locator(".water-layer canvas").evaluate((canvas) => canvas.classList.contains("ready"))).toBe(false);
  expect((await spy(page)).pointer).toBe(0);
  expect(await page.locator(".water-layer").evaluate((layer) => getComputedStyle(layer).backgroundImage)).toContain("water-still.webp");
});

test("with forced colours the hidden water does no work, and it stops when forced colours are switched on", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Borrow equipment from the USC Department of Logistics" })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await spy(page)).toEqual({ contexts: 0, pointer: 0 });
  expect(await page.locator(".water-layer").evaluate((layer) => getComputedStyle(layer).display)).toBe("none");
  // Switching forced colours on while the water is already running stops its pointer tracking too.
  await page.emulateMedia({ forcedColors: "none" });
  await expect.poll(async () => (await spy(page)).pointer).toBe(1);
  await page.emulateMedia({ forcedColors: "active" });
  await expect.poll(async () => (await spy(page)).pointer).toBe(0);
});

test("the hero eyebrow stays in the light text colour so it reads over the moving water", async ({ page }) => {
  await page.goto("/");
  const colours = await page.locator(".hero__eyebrow").evaluate((eyebrow) => ({ eyebrow: getComputedStyle(eyebrow).color, title: getComputedStyle(document.querySelector(".hero h1") as Element).color }));
  expect(colours.eyebrow).toBe(colours.title);
});

test("if WebGL is unavailable the page is complete and the still image stays", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === "webgl" || kind === "webgl2") return null as never;
      return (getContext as (...args: unknown[]) => unknown).call(this, kind, ...rest) as never;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Borrow equipment from the USC Department of Logistics" })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await page.locator(".water-layer canvas").evaluate((canvas) => canvas.classList.contains("ready"))).toBe(false);
  expect((await spy(page)).pointer).toBe(0);
  await page.getByRole("searchbox", { name: "Equipment name" }).fill("table");
  await page.getByRole("button", { name: "Search the Lending Hub" }).click();
  await expect(page).toHaveURL(/\/lending\?q=table$/);
});
