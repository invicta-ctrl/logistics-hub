import { expect, test, type Page } from "@playwright/test";

/* Staff theme and ornament removal (HAU-UI-MEDIA-THEME-001) on fictional data with the API mocked. */

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };
const item = (index: number) => ({ id: `ITM-${String(index).padStart(5, "0")}`, name: `Sample item ${index}`, aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", needsReview: false, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", onHand: 10, reorderThreshold: 0, locationId: null, legacyLocation: null, openReports: 0, listed: false, stockArea: "Inventory", expiresOn: null, lastCountedAt: null, reorderStatus: null, onLoan: 0, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null, photoId: null, visualType: null, iconKey: null, updatedAt: "2026-10-03T00:00:00.000Z", model: null, serialNumber: null });
async function openStaff(page: Page, options: { items?: unknown[]; path?: string } = {}) {
  const items = options.items ?? [item(1), item(2)];
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 0, bySource: {} }) }));
  await page.route("**/api/staff/inventory", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items, categories: ["SUPPLIES"], locations: [], units: ["piece"] }) }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 1, locations: [] }) }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(options.path ?? "/staff/items");
  await expect(page.locator(".app-bar")).toBeVisible();
}

const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("hub-theme"));
async function choose(page: Page, choice: "light" | "dark" | "system") {
  if (!(await page.locator("#staff-menu").evaluate((menu) => menu.matches(":popover-open")))) await page.locator("button.account").click();
  await page.locator(`[data-theme-choice="${choice}"]`).click();
}

test.describe("Staff theme", () => {
  test("is Light until a person chooses, and the choice shows as pressed", async ({ page }) => {
    await openStaff(page);
    expect(await theme(page)).toBeNull();
    await page.locator("button.account").click();
    await expect(page.locator('[data-theme-choice="light"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-theme-choice="dark"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-theme-choice="dark"]')).toHaveText("Dark");
  });

  test("Dark is chosen by hand, kept on this device, applied before the app draws, and read back after a reload", async ({ page }) => {
    await page.addInitScript(() => {
      const seen: string[] = [];
      Object.assign(window, { __seen: seen });
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "attributes" && record.attributeName === "data-theme" && !seen.includes("theme")) seen.push("theme");
          if (record.type === "childList" && (record.target as Element).id === "app" && !seen.includes("app")) seen.push("app");
        }
      }).observe(document, { subtree: true, attributes: true, childList: true });
    });
    await openStaff(page);
    await choose(page, "dark");
    await expect.poll(() => theme(page)).toBe("dark");
    expect(await stored(page)).toBe("dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 6, 9)");
    expect(await page.evaluate(() => document.querySelector('meta[name="color-scheme"]')!.getAttribute("content"))).toBe("dark");
    await page.reload();
    await expect(page.locator(".app-bar")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen.slice(0, 2))).toEqual(["theme", "app"]);
    await choose(page, "light");
    await expect.poll(() => theme(page)).toBeNull();
    expect(await stored(page)).toBe("light");
  });

  test("System follows the device and changes with it", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openStaff(page);
    await choose(page, "system");
    await expect.poll(() => theme(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => theme(page)).toBeNull();
  });

  test("never reaches the public pages or Self-Service", async ({ page }) => {
    await openStaff(page);
    await choose(page, "dark");
    await expect.poll(() => theme(page)).toBe("dark");
    await page.evaluate(async () => { const path = "/src/ui.ts"; (await import(path)).navigate("/lending"); });
    await expect(page).toHaveURL(/\/lending$/);
    expect(await theme(page)).toBeNull();
    await page.goto("/");
    expect(await theme(page)).toBeNull();
    await page.goto("/self-service");
    expect(await theme(page)).toBeNull();
    expect(await page.evaluate(() => document.querySelector('meta[name="color-scheme"]')!.getAttribute("content"))).toBe("light");
  });

  test("switching writes nothing, and is instant when reduced motion is asked for, and works with storage blocked", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error("blocked"); };
      Storage.prototype.setItem = () => { throw new Error("blocked"); };
    });
    await openStaff(page);
    expect(await theme(page)).toBeNull();
    const writes: string[] = [];
    page.on("request", (request) => { if (request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`); });
    await choose(page, "dark");
    expect(await theme(page)).toBe("dark");
    expect(writes).toEqual([]);
  });
});

test.describe("Ornaments", () => {
  test("an empty list is a quiet plate: no grid, no corner marks, in Light and in Dark", async ({ page }) => {
    await openStaff(page, { items: [] });
    const empty = page.locator(".empty").first();
    await expect(empty).toBeVisible();
    for (const mode of ["light", "dark"] as const) {
      await choose(page, mode);
      await expect.poll(() => theme(page)).toBe(mode === "dark" ? "dark" : null);
      const layers = await empty.evaluate((element) => ["::before", "::after"].map((pseudo) => getComputedStyle(element, pseudo).content));
      expect(layers.every((content) => content === "none" || content === "normal")).toBe(true);
    }
  });

  test("the shared stylesheet carries no drafting grid or crop-mark tokens", async ({ page }) => {
    await openStaff(page);
    const tokens = await page.evaluate(() => ["--grid-line", "--tick", "--drafting-focus"].map((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()));
    expect(tokens).toEqual(["", "", ""]);
  });
});

test.describe("Dark in the places that stay light", () => {
  test("a photo tile outside the item profile keeps readable ink on its stone, in Dark", async ({ page }) => {
    await openStaff(page);
    await choose(page, "dark");
    await expect.poll(() => theme(page)).toBe("dark");
    const ratios = await page.evaluate(() => {
      const parse = (value: string) => value.match(/[\d.]+/g)!.map(Number);
      const lum = ([r, g, b]: number[]) => [r, g, b].map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, at) => sum + v * [.2126, .7152, .0722][at]!, 0);
      const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
      const host = document.createElement("div");
      host.innerHTML = '<div class="photo-tile photo-tile--busy" role="status">Preparing the photo…</div><div class="photo-tile"><span class="item-visual"><svg class="item-icon" width="24" height="24"></svg></span></div>';
      document.body.append(host);
      const busy = host.children[0] as HTMLElement;
      const icon = host.querySelector(".item-visual") as HTMLElement;
      const stone = parse(getComputedStyle(busy).backgroundColor);
      return { text: ratio(parse(getComputedStyle(busy).color), stone), icon: ratio(parse(getComputedStyle(icon).color), stone) };
    });
    expect(ratios.text).toBeGreaterThanOrEqual(4.5);
    expect(ratios.icon).toBeGreaterThanOrEqual(3);
  });

  test("printing in Dark uses dark ink on white paper", async ({ page }) => {
    await openStaff(page);
    await choose(page, "dark");
    await expect.poll(() => theme(page)).toBe("dark");
    await page.emulateMedia({ media: "print" });
    const printed = await page.evaluate(() => ({ text: getComputedStyle(document.body).color, paper: getComputedStyle(document.documentElement).colorScheme }));
    expect(printed.text).toBe("rgb(28, 25, 23)");
    expect(printed.paper).toBe("light");
  });
});
