import { expect, test, type Page } from "@playwright/test";

/*
 * V1.15 phone usability (mobile/perceived-performance amendment): on a touch phone, every control on every page is big enough to hit.
 */

const STAFF = ["/staff/home", "/staff/items", "/staff/stock", "/staff/loans", "/staff/self-service", "/staff/activity", "/staff/attention",
  "/staff/catalogue", "/staff/kits", "/staff/locations", "/staff/account", "/staff/admin", "/staff/admin/self-service", "/staff/admin/catalog",
  "/staff/admin/staff", "/staff/admin/directory", "/staff/admin/accountability"];
const PUBLIC = ["/", "/lending", "/self-service", "/self-service?do=get", "/self-service?do=activity", "/self-service?do=install"];

/** Controls a finger has to hit that are smaller than `edge` CSS px on either side (inline links inside a sentence are exempt). */
const small = (page: Page, edge: number) => page.evaluate((limit) => {
  const found: string[] = [];
  const hidden = (element: Element) => { for (let node: Element | null = element; node; node = node.parentElement) { const style = getComputedStyle(node); if (style.display === "none" || style.visibility === "hidden" || node.hasAttribute("hidden") || (node.tagName === "DIALOG" && !(node as HTMLDialogElement).open)) return true; } return false; };
  const controls = document.querySelectorAll<HTMLElement>("a[href], button, select, textarea, summary, [role=tab], [role=button], [role=switch], input:not([type=hidden]):not([type=file])");
  for (const control of controls) {
    if (hidden(control)) continue;
    let target: HTMLElement = control;
    if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) target = (control.closest("label") ?? control) as HTMLElement;
    // A row that opens as a whole is the target; its name is the keyboard's way in.
    const row = target.closest("tr, .loan-row, .person-card");
    if (row && getComputedStyle(row).cursor === "pointer") target = row as HTMLElement;
    const style = getComputedStyle(target);
    if (style.display === "inline" && target.tagName === "A") continue;
    if (/visually-hidden|sr-only|skip-link/.test(String(target.className))) continue;
    const box = target.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    // A pseudo-element that stretches the control (an invisible, larger hit area) counts as part of it.
    let [width, height] = [box.width, box.height];
    for (const part of ["::before", "::after"]) {
      const pseudo = getComputedStyle(target, part);
      if (pseudo.content !== "none" && pseudo.position === "absolute") { width = Math.max(width, parseFloat(pseudo.width) || 0); height = Math.max(height, parseFloat(pseudo.height) || 0); }
    }
    if (Math.min(width, height) < limit) {
      const within = target.parentElement ? `${target.parentElement.tagName.toLowerCase()}.${String(target.parentElement.className).split(" ")[0]}` : "";
      found.push(`${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ""}.${String(target.className).split(" ")[0]} in ${within} “${(target.innerText || target.getAttribute("aria-label") || "").trim().slice(0, 28)}” ${Math.round(width)}×${Math.round(height)}`);
    }
  }
  return found;
}, edge);

test("touch targets on every page", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  const found = new Map<string, string>();
  const visit = async (route: string) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.locator("main, #app").first().waitFor();
    // One line for each kind of control and size on a page, with how many there are.
    const counts = new Map<string, number>();
    for (const line of await small(page, 44)) { const kind = line.replace(/ “[^”]*”/, ""); counts.set(kind, (counts.get(kind) ?? 0) + 1); }
    for (const [kind, count] of counts) { const line = `${kind}${count > 1 ? ` ×${count}` : ""}`; if (!found.has(`${route} ${line}`)) found.set(`${route} ${line}`, route); }
  };
  for (const route of PUBLIC) await visit(route);
  await page.goto("/staff");
  const origin = new URL(page.url()).origin;
  let signedIn = false;
  for (const secret of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
    signedIn ||= (await page.request.post("/api/staff/login", { headers: { origin }, data: { username: process.env.E2E_OWNER_USERNAME, password: secret } })).ok();
  }
  expect(signedIn).toBe(true);
  for (const route of [...STAFF, "/staff/items?item=ITM-0135"]) await visit(route);
  const lines = [...found.keys()];
  if (lines.length) console.log(`SMALL\n${lines.join("\n")}`);
  expect(lines).toEqual([]);
  await context.close();
});

/** What a notch and a home indicator take from the screen, as the browser reports them to the page. */
const INSETS = {
  portrait: { size: { width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
  landscape: { size: { width: 844, height: 390 }, insets: { top: 0, bottom: 21, left: 47, right: 47 } }
} as const;

test("unsafe areas: controls stay clear of the notch and the home indicator", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  for (const [turn, { size, insets }] of Object.entries(INSETS)) {
    const context = await browser.newContext({ baseURL, viewport: size, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
    await page.goto("/staff");
    const origin = new URL(page.url()).origin;
    let signedIn = false;
    for (const secret of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
      signedIn ||= (await page.request.post("/api/staff/login", { headers: { origin }, data: { username: process.env.E2E_OWNER_USERNAME, password: secret } })).ok();
    }
    expect(signedIn).toBe(true);
    const found = new Map<string, string>();
    const routes = [...PUBLIC, ...STAFF];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.locator("main, #app").first().waitFor();
      const inside = await page.evaluate(({ insets, width, height }) => {
        const bad: string[] = [];
        for (const control of document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=tab]")) {
          const box = control.getBoundingClientRect();
          if (!box.width || !box.height || getComputedStyle(control).visibility === "hidden" || control.closest("[hidden], dialog:not([open])")) continue;
          if (/skip-link|visually-hidden/.test(String(control.className))) continue;
          // Only what is on screen right now matters; the page below the fold scrolls into the safe part.
          if (box.bottom <= 0 || box.top >= height) continue;
          // A strip that scrolls sideways carries its own items in and out of view; its edge is what is judged.
          let strip = false;
          for (let node = control.parentElement; node && !strip; node = node.parentElement) { const style = getComputedStyle(node); strip = /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth; }
          if (strip) continue;
          const fixedBottom = getComputedStyle(control).position === "fixed" || !!control.closest(".app-nav, .toasts, .bulk-bar");
          // A text link's invisible hit padding (0.5rem each side) may reach past the edge; its words may not.
          const slack = control.matches(".text-link, .row-link") ? 8.5 : 0.5;
          const trouble = box.left < insets.left - slack || box.right > width - insets.right + slack || (fixedBottom && box.bottom > height - insets.bottom + 0.5);
          if (trouble) bad.push(`${control.tagName.toLowerCase()}.${String(control.className).split(" ")[0]} “${(control.innerText || control.getAttribute("aria-label") || "").trim().slice(0, 24)}” L${Math.round(box.left)} R${Math.round(box.right)} B${Math.round(box.bottom)}`);
        }
        return bad;
      }, { insets, width: size.width, height: size.height });
      for (const line of inside) if (!found.has(`${turn} ${line}`)) found.set(`${turn} ${line}`, route);
    }
    const lines = [...found].map(([line, route]) => `${route}  ${line}`);
    if (lines.length) console.log(`UNSAFE ${turn}\n${lines.join("\n")}`);
    expect(lines, `${turn}: nothing sits under the notch or home indicator`).toEqual([]);
    await context.close();
  }
});


/** Opens a sheet or dialog and judges it as a thumb meets it: on screen, not sideways, its way out and its last action reachable. */
async function judge(page: Page, name: string, insets: { top: number; bottom: number; left: number; right: number }) {
  const dialog = page.locator("dialog[open]").last();
  await expect(dialog, `${name} is open`).toBeVisible();
  const size = page.viewportSize()!;
  const box = await dialog.evaluate((element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, sideways: element.scrollWidth - element.clientWidth }; });
  expect(box.left, `${name}: left edge`).toBeGreaterThanOrEqual(0);
  expect(box.right, `${name}: right edge`).toBeLessThanOrEqual(size.width + 0.5);
  expect(box.top, `${name}: top edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.bottom, `${name}: bottom edge`).toBeLessThanOrEqual(size.height + 0.5);
  expect(box.sideways, `${name}: nothing scrolls sideways inside`).toBeLessThanOrEqual(1);
  expect(await dialog.evaluate((element) => element.contains(document.activeElement)), `${name}: focus is inside`).toBe(true);
  // A way out of at least 44 px (a Close or Cancel button, or the sheet's own handle).
  const out = dialog.locator("[data-close], button[aria-label^=Close], button:has-text('Close'), button:has-text('Cancel'), button:has-text('Done')").first();
  expect(await out.count(), `${name}: has a way out`).toBeGreaterThan(0);
  await out.scrollIntoViewIfNeeded();
  const closing = await out.boundingBox();
  expect(Math.min(closing!.width, closing!.height), `${name}: the way out is 44 px or more`).toBeGreaterThanOrEqual(43.5);
  // The last control can be scrolled to, and then sits above the home indicator.
  const last = dialog.locator("button:visible, a[href]:visible, input:visible, select:visible, textarea:visible").last();
  await last.scrollIntoViewIfNeeded();
  const end = await last.boundingBox();
  expect(end!.y + end!.height, `${name}: the last control clears the home indicator`).toBeLessThanOrEqual(size.height - insets.bottom + 0.5);
  expect(end!.y, `${name}: the last control is on screen`).toBeGreaterThanOrEqual(0);
}

const SAFE = { top: 47, bottom: 34, left: 0, right: 0 };

for (const [label, size, zoom] of [["390 px", { width: 390, height: 844 }, "100%"], ["320 px", { width: 320, height: 568 }, "100%"], ["320 px at 200% text", { width: 320, height: 568 }, "200%"]] as const) {
  test(`sheets and dialogs fit a phone: ${label}`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    // Reduced motion, so a sheet is measured where it comes to rest rather than part-way through sliding in.
    const context = await browser.newContext({ baseURL, viewport: size, isMobile: true, hasTouch: true, deviceScaleFactor: 3, reducedMotion: "reduce" });
    const page = await context.newPage();
    await (await context.newCDPSession(page)).send("Emulation.setSafeAreaInsetsOverride", { insets: SAFE });
    await page.addInitScript((fontSize) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = fontSize; }); }, zoom);
    const catalog = await (await page.request.get("/api/self-service/catalog")).json() as { items: { id: string; action: string }[] };
    // Self-Service, signed out: the three forms.
    for (const action of ["TAKE", "BORROW", "USE"]) {
      const item = catalog.items.find((candidate) => candidate.action === action);
      if (!item) continue;
      await page.goto(`/self-service?do=${action.toLowerCase()}&item=${item.id}`);
      await judge(page, `Self-Service ${action.toLowerCase()} form`, SAFE);
    }
    await page.goto("/staff");
    const origin = new URL(page.url()).origin;
    let signedIn = false;
    for (const secret of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
      signedIn ||= (await page.request.post("/api/staff/login", { headers: { origin }, data: { username: process.env.E2E_OWNER_USERNAME, password: secret } })).ok();
    }
    expect(signedIn).toBe(true);
    await page.goto("/staff/stock");
    await page.getByRole("button", { name: "Update stock" }).click();
    await judge(page, "Update stock", SAFE);
    await page.keyboard.press("Escape");
    await page.goto("/staff/items");
    await page.locator("#new-item").click();
    await judge(page, "New item", SAFE);
    await page.keyboard.press("Escape");
    await page.goto("/staff/items?item=ITM-0135");
    await judge(page, "An item", SAFE);
    await page.keyboard.press("Escape");
    await page.goto("/staff/admin/staff");
    await page.getByRole("button", { name: "New account" }).click();
    await judge(page, "New account", SAFE);
    await page.keyboard.press("Escape");
    await page.goto("/staff/admin/directory");
    await page.getByRole("button", { name: "Add person" }).first().click();
    await judge(page, "Add person", SAFE);
    await page.keyboard.press("Escape");
    await page.goto("/staff/home");
    await page.locator("#home-search").click();
    await judge(page, "Search", SAFE);
    await context.close();
  });
}
