import { expect, test, type Page } from "@playwright/test";

/*
 * One tab and segmented-control style (V1.15): the views of a list, the sections of a profile, the sub-navigation, and the two kinds
 * of segmented control are quiet when inactive and take the product's accent only when chosen. The staff app is light only, so
 * contrast is checked for the one theme. The controls are laid out on the real stylesheet.
 */

const MARKUP = `<main style="display:grid;grid-template-columns:minmax(0,1fr);gap:16px;padding:16px;max-width:420px">
  <div class="views" role="group" aria-label="Views"><button class="view-tab" aria-pressed="true" id="v-on">Open <span class="view-tab__count">4</span></button><button class="view-tab" aria-pressed="false" id="v-off">Returned <span class="view-tab__count">12</span></button></div>
  <div class="tabs" role="tablist" aria-label="Sections"><button role="tab" aria-selected="true" id="t-on">Official ID</button><button role="tab" aria-selected="false" id="t-off">Usage</button></div>
  <nav class="subnav"><a class="subnav__link" href="#a" aria-current="page" id="s-on">System</a><a class="subnav__link" href="#b" id="s-off">Catalog</a></nav>
  <fieldset class="segmented segmented--2"><legend class="visually-hidden">Purpose</legend><label id="g-on"><input type="radio" name="p" checked>Individual</label><label id="g-off"><input type="radio" name="p">USC use</label></fieldset>
  <div class="sort-toggle" role="group" aria-label="Period"><button aria-pressed="true" id="w-on">Today</button><button aria-pressed="false" id="w-off">Week</button></div>
  <div class="segmented ck-tabs" role="tablist" aria-label="Show"><button type="button" role="tab" aria-selected="true" id="b-on">To check <span class="view-tab__count">8</span></button><button type="button" role="tab" aria-selected="false" id="b-off">Checked <span class="view-tab__count">3</span></button></div>
</main>`;

async function lay(page: Page) {
  await page.goto("/staff");
  await page.setViewportSize({ width: 390, height: 700 });
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css?direct"><link rel="stylesheet" href="/src/catalogue.css?direct"><style>*,*::before,*::after{transition:none!important}</style></head><body>${MARKUP}</body></html>`);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#v-on")!).borderBottomWidth === "2px");
}

/** WCAG contrast of an element's text against the first opaque background found going up from `behind` (default: itself). */
const contrast = (page: Page, text: string, behind = text) => page.evaluate(([textSelector, behindSelector]) => {
  const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number) as [number, number, number, number?];
  const backgroundOf = (element: Element | null): [number, number, number] => {
    for (let node = element; node; node = node.parentElement) { const [r, g, b, a = 1] = parse(getComputedStyle(node).backgroundColor); if (a > 0.99) return [r, g, b]; }
    return [255, 255, 255];
  };
  const luminance = ([r, g, b]: number[]) => { const [x, y, z] = [r, g, b].map((channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x! + 0.7152 * y! + 0.0722 * z!; };
  const [r, g, b] = parse(getComputedStyle(document.querySelector(textSelector!)!).color);
  const [high, low] = [luminance([r, g, b]), luminance(backgroundOf(document.querySelector(behindSelector!)))].sort((a, b) => b - a);
  return (high! + 0.05) / (low! + 0.05);
}, [text, behind]);

test("the tab styles share one look: neutral when inactive, the accent only when chosen", async ({ page }) => {
  await lay(page);
  const look = (selector: string) => page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, underline: style.borderBottomColor, underlineWidth: style.borderBottomWidth, size: style.fontSize, weight: style.fontWeight, padding: style.padding };
  });
  const [views, tabs, subnav] = await Promise.all([look("#v-on"), look("#t-on"), look("#s-on")]);
  expect(tabs).toEqual(views);
  expect(subnav).toEqual(views);
  const [viewsOff, tabsOff, subnavOff] = await Promise.all([look("#v-off"), look("#t-off"), look("#s-off")]);
  expect(tabsOff).toEqual(viewsOff);
  expect(subnavOff).toEqual(viewsOff);
  // Only the chosen one has the accent, in its text and its underline; the others have neither.
  expect(views.color).toBe(views.underline);
  expect(views.underlineWidth).toBe("2px");
  expect(viewsOff.underline).toBe("rgba(0, 0, 0, 0)");
  expect(viewsOff.color).not.toBe(views.color);
  // Counts are smaller than their label.
  expect(await page.locator("#v-on .view-tab__count").evaluate((count) => parseFloat(getComputedStyle(count).fontSize))).toBeLessThan(parseFloat(views.size));
});

test("the segmented controls show a solid accent fill on the chosen segment, whether they are made of radios or buttons", async ({ page }) => {
  await lay(page);
  const wash = (selector: string) => page.locator(selector).evaluate((element) => { const style = getComputedStyle(element); return { background: style.backgroundColor, color: style.color, ring: style.boxShadow }; });
  const chosen = await Promise.all(["#g-on", "#w-on", "#b-on"].map(wash));
  const others = await Promise.all(["#g-off", "#w-off", "#b-off"].map(wash));
  for (const segment of chosen) { expect(segment).toEqual(chosen[0]); expect(segment.ring).toBe("none"); expect(segment.background).toBe("rgb(122, 20, 25)"); }
  for (const segment of others) { expect(segment.background).toBe("rgba(0, 0, 0, 0)"); expect(segment.ring).toBe("none"); expect(segment.color).not.toBe(chosen[0]!.color); }
});

test("every state of a tab or segment reads at 4.5:1 or better on the app's one light theme", async ({ page }) => {
  await lay(page);
  for (const id of ["#v-on", "#v-off", "#t-on", "#t-off", "#s-on", "#s-off", "#g-on", "#g-off", "#w-on", "#w-off", "#b-on", "#b-off"]) {
    expect(await contrast(page, id), id).toBeGreaterThanOrEqual(4.5);
  }
  // A count reads on its own chip, and the chosen underline is a visible (3:1) mark against the page.
  for (const id of ["#v-on", "#v-off", "#b-on", "#b-off"]) expect(await contrast(page, `${id} .view-tab__count`), `${id} count`).toBeGreaterThanOrEqual(4.5);
  await page.locator("#v-off").hover();
  expect(await contrast(page, "#v-off"), "hovered tab").toBeGreaterThanOrEqual(4.5);
  expect(await page.locator("#v-on").evaluate((element) => getComputedStyle(element).borderBottomColor)).toBe("rgb(122, 20, 25)");
});

test("a keyboard ring shows inside a focused tab and around a focused segment", async ({ page }) => {
  await lay(page);
  await page.keyboard.press("Tab");
  await expect(page.locator("#v-on")).toBeFocused();
  const ring = await page.locator("#v-on").evaluate((element) => { const style = getComputedStyle(element); return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, offset: parseFloat(style.outlineOffset) }; });
  expect(ring.style).toBe("solid");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  // Drawn inside, so the strip's scrolling can never clip it.
  expect(ring.offset).toBeLessThan(0);
  await page.locator("#b-on").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator("#b-on")).toBeFocused();
  expect(await page.locator("#b-on").evaluate((element) => getComputedStyle(element).boxShadow)).toMatch(/rgba?\(168, 122, 18/);
});

test("on a touch screen the clear and reveal buttons stay laid over their field, and a gold tag stays a quiet label", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 700 } });
  const page = await context.newPage();
  await page.goto("/staff");
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css?direct"></head><body><main>
    <label class="search-field"><input id="s" type="search" value="abc"><button class="search-field__clear" id="clear" aria-label="Clear">x</button></label>
    <div class="input-group"><input id="p" type="password"><button class="input-group__button" id="reveal" aria-label="Show">o</button></div>
    <span class="tag tag--gold" id="gold">Officer</span> <span class="tag tag--ok" id="ok">Saved</span></main></body></html>`);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#clear")!).position !== "static");
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  for (const id of ["#clear", "#reveal"]) expect(await page.locator(id).evaluate((element) => getComputedStyle(element).position), id).toBe("absolute");
  // The control sits inside its field's box (it did not drop into the flow beside or under it).
  const [field, clear] = await Promise.all([page.locator("#s").boundingBox(), page.locator("#clear").boundingBox()]);
  expect(clear!.x + clear!.width).toBeLessThanOrEqual(field!.x + field!.width + 1);
  // Gold marks identity and planning (Officer, Admin, Planned): no pill, no warning glyph. A toned status is a pill.
  expect(await page.locator("#gold").evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
  expect(await page.locator("#ok").evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("1px");
  await context.close();
});

/*
 * Real taps on the real pages (a touch screen, not a mouse): the search clear button on the Lending Hub and the password reveal on staff
 * sign-in. Each control is drawn small and carries an invisible 44 px press area (S1 hit slop). A tap inside that area must act exactly
 * once; a tap just beyond it must fall through to the field and act on nothing else.
 */
const TARGET = 44;
const lendingCatalog = { revision: 1, categories: ["FURNITURE"], items: [
  { id: "ITM-0005", name: "Folding Table", category: "FURNITURE", unit: "piece", available: 3, audience: "STUDENTS_AND_USC_STAFF" },
  { id: "ITM-0262", name: "Scissors", category: "FURNITURE", unit: "piece", available: 10, audience: "STUDENTS_AND_USC_STAFF" }
] };

test("touch: tapping the Lending Hub's clear button clears the search once, inside its 44 px press area and not beyond it", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify(lendingCatalog) }));
  await page.goto("/lending");
  const search = page.getByRole("searchbox", { name: "Search the Lending Hub" });
  const clear = page.locator("#clear-search");
  await expect(page.getByRole("button", { name: "Folding Table" })).toBeVisible();
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await clear.evaluate((element) => { (window as unknown as { clears: number }).clears = 0; element.addEventListener("click", () => { (window as unknown as { clears: number }).clears += 1; }); });
  const clears = () => page.evaluate(() => (window as unknown as { clears: number }).clears);
  const type = async () => { await search.fill("scis"); await expect(clear).toBeVisible(); return (await clear.boundingBox())!; };

  // The drawn button is smaller than the touch target, and the field still holds it.
  let box = await type();
  await expect(clear).toHaveAccessibleName("Clear search");
  expect(box.width).toBeLessThan(TARGET);
  // 1. The centre of the button.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(clear).toBeHidden();
  expect(await clears()).toBe(1);
  // 2. A point just outside the drawn button but inside its press area.
  box = await type();
  const slop = (TARGET - box.width) / 2;
  // The press area is exact: the button owns a point 1 px inside it, on every side, and the field owns a point 1 px beyond it. (Chromium also
  // snaps a finger a few pixels toward a nearby button on its own, so a tap alone cannot prove where the area ends.)
  const owner = (x: number, y: number) => page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.closest("button, input")?.id ?? null, [x, y]);
  const middle = box.y + box.height / 2;
  expect(await owner(box.x - (slop - 1), middle)).toBe("clear-search");
  expect(await owner(box.x + box.width + (slop - 1), middle)).toBe("clear-search");
  expect(await owner(box.x + box.width / 2, box.y - (slop - 1))).toBe("clear-search");
  expect(await owner(box.x + box.width / 2, box.y + box.height + (slop - 1))).toBe("clear-search");
  expect(await owner(box.x - (slop + 1), middle)).toBe("lending-search");
  await page.touchscreen.tap(box.x - (slop - 1), box.y + box.height / 2);
  await expect(search).toHaveValue("");
  expect(await clears()).toBe(2);
  // 3. A point beyond the press area lands on the field: nothing is cleared, the button is not pressed, and the field is focused for typing.
  box = await type();
  await search.evaluate((element) => (element as HTMLInputElement).blur());
  await page.touchscreen.tap(box.x - (slop + 5), box.y + box.height / 2);
  await expect(search).toHaveValue("scis");
  await expect(search).toBeFocused();
  expect(await clears()).toBe(2);
  // The list followed the field each time: the typed word filters, the cleared field shows everything.
  await expect(page.getByRole("button", { name: "Scissors" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Folding Table" })).toHaveCount(0);
  await context.close();
});

test("touch: tapping the password reveal toggles it once, inside its 44 px press area and not beyond it, and keeps what was typed", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await page.goto("/staff");
  const password = page.getByLabel("Password", { exact: true });
  const reveal = page.locator("#toggle-password");
  await expect(reveal).toBeVisible();
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await password.fill("sample-value-1");
  await reveal.evaluate((element) => { (window as unknown as { reveals: number }).reveals = 0; element.addEventListener("click", () => { (window as unknown as { reveals: number }).reveals += 1; }); });
  const reveals = () => page.evaluate(() => (window as unknown as { reveals: number }).reveals);
  const box = (await reveal.boundingBox())!;
  expect(box.width).toBeLessThan(TARGET);
  const slop = (TARGET - box.width) / 2;
  const y = box.y + box.height / 2;
  // The press area is exact: the button owns a point 1 px inside it on every side, and the field owns a point 1 px beyond it.
  const owner = (x: number, py: number) => page.evaluate(([px, qy]) => document.elementFromPoint(px!, qy!)?.closest("button, input")?.id ?? null, [x, py]);
  expect(await owner(box.x - (slop - 1), y)).toBe("toggle-password");
  expect(await owner(box.x + box.width + (slop - 1), y)).toBe("toggle-password");
  expect(await owner(box.x + box.width / 2, box.y - (slop - 1))).toBe("toggle-password");
  expect(await owner(box.x + box.width / 2, box.y + box.height + (slop - 1))).toBe("toggle-password");
  expect(await owner(box.x - (slop + 1), y)).toBe("password");
  // 1. The centre: the password shows, the control says so, the typed text is untouched.
  await page.touchscreen.tap(box.x + box.width / 2, y);
  await expect(password).toHaveAttribute("type", "text");
  await expect(reveal).toHaveAttribute("aria-pressed", "true");
  await expect(reveal).toHaveAccessibleName("Hide password");
  await expect(password).toHaveValue("sample-value-1");
  expect(await reveals()).toBe(1);
  // 2. Just outside the drawn button but inside its press area: it toggles back, once.
  await page.touchscreen.tap(box.x - (slop - 1), y);
  await expect(password).toHaveAttribute("type", "password");
  await expect(reveal).toHaveAccessibleName("Show password");
  expect(await reveals()).toBe(2);
  // 3. Beyond the press area the tap belongs to the field: nothing toggles and the field takes focus.
  await password.evaluate((element) => (element as HTMLInputElement).blur());
  await page.touchscreen.tap(box.x - (slop + 5), y);
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toBeFocused();
  expect(await reveals()).toBe(2);
  await expect(password).toHaveValue("sample-value-1");
  await context.close();
});

test("the caret is the brand colour on light fields and the light text colour in the public hero's search", async ({ page }) => {
  await page.goto("/staff");
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css?direct"></head><body>
    <label><input id="plain" type="text"></label>
    <section class="hero"><div class="hero__field"><input id="find-q" type="search"></div></section></body></html>`);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#plain")!).caretColor === "rgb(122, 20, 25)");
  // Brand maroon on the maroon band would be 1.2:1; the hero's field takes the light ink its text already uses.
  expect(await page.locator("#find-q").evaluate((element) => getComputedStyle(element).caretColor)).toBe("rgb(251, 246, 238)");
});

/*
 * LH-UI-88 S1 review R3: five defects a read-only review of the exact diff found, each pinned on the real stylesheets. The cascade checks
 * are made on injected markup, so they need no session; the busy-width check drives the real `working()` helper.
 */
const sheets = `<link rel="stylesheet" href="/src/styles.css?direct"><link rel="stylesheet" href="/src/self-service.css?direct">`;
async function plain(page: Page, body: string, theme?: "dark") {
  await page.goto("/staff");
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">${sheets}</head><body style="margin:0;padding:24px;background:var(--surface)">${body}</body></html>`);
  if (theme) await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".button, .card, .tag, .segmented")!).borderTopWidth !== "" && getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)");
}
/** WCAG contrast of an element's label against its own fill, the fill blended over the page surface if it is translucent. */
const ratio = (page: Page, selector: string) => page.evaluate((target) => {
  const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number) as [number, number, number, number?];
  const element = document.querySelector(target)!;
  const style = getComputedStyle(element);
  const [sr, sg, sb] = parse(getComputedStyle(document.body).backgroundColor);
  const [br, bg, bb, ba = 1] = parse(style.backgroundColor);
  const fill = [br * ba + sr * (1 - ba), bg * ba + sg * (1 - ba), bb * ba + sb * (1 - ba)];
  const [tr, tg, tb, ta = 1] = parse(style.color);
  const ink = [tr * ta + fill[0] * (1 - ta), tg * ta + fill[1] * (1 - ta), tb * ta + fill[2] * (1 - ta)];
  const lum = ([r, g, b]: number[]) => 0.2126 * ((r / 255) ** 2.2) + 0.7152 * ((g / 255) ** 2.2) + 0.0722 * ((b / 255) ** 2.2);
  const [hi, lo] = [lum(ink), lum(fill)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}, selector);

test("a pressed primary and secondary button keep a readable label in the light and the dark Staff theme", async ({ page }) => {
  const buttons = `<p><button class="button button--primary" id="p">Save changes</button> <button class="button button--secondary" id="s">Cancel</button></p>`;
  for (const theme of [undefined, "dark"] as const) {
    await plain(page, buttons, theme);
    for (const id of ["#p", "#s"]) {
      const box = (await page.locator(id).boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(350); // let the colour transition finish before measuring
      expect(await ratio(page, id), `${theme ?? "light"} pressed ${id}`).toBeGreaterThanOrEqual(4.5);
      await page.mouse.move(0, 0); // release elsewhere, so nothing is clicked
      await page.mouse.up();
    }
  }
});

test("Self-Service keeps its own secondary button colours when hovered or pressed", async ({ page }) => {
  await plain(page, `<div class="is-self-service" style="padding:16px"><button class="button button--secondary" id="r">Return</button></div>`);
  const read = () => page.locator("#r").evaluate((element) => { const style = getComputedStyle(element); return { color: style.color, background: style.backgroundColor }; });
  await page.waitForTimeout(350); // a freshly drawn button is still settling into its colours
  const rest = await read();
  const box = (await page.locator("#r").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350); // let the colour transition finish before measuring
  expect((await read()).color).toBe(rest.color);
  await page.mouse.down();
  await page.waitForTimeout(350);
  const pressed = await read();
  expect(pressed.color).toBe(rest.color);
  expect(pressed.background).not.toBe("rgb(231, 192, 196)"); // the staff pressed fill
  await page.mouse.move(0, 0);
  await page.mouse.up();
});

test("a toned card inside Advanced details keeps its tone, and a plain one is still flattened", async ({ page }) => {
  await plain(page, `<div class="advanced-details__body"><section class="card card--ok" id="ok"><p>Listed on the Lending Hub</p></section><section class="card" id="group"><p>A group</p></section></div>`);
  const look = (id: string) => page.locator(id).evaluate((element) => { const style = getComputedStyle(element); return { border: style.borderTopWidth, background: style.backgroundColor, padding: style.paddingTop }; });
  expect(await look("#ok")).toEqual({ border: "1px", background: "rgb(232, 244, 237)", padding: "16px" });
  expect(await look("#group")).toEqual({ border: "0px", background: "rgba(0, 0, 0, 0)", padding: "0px" });
});

test("forced colours: the status glyph and the chosen segment stay visible", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await plain(page, `<p><span class="tag tag--ok" id="tag">Ready</span></p>
    <fieldset class="segmented segmented--2"><legend class="visually-hidden">Purpose</legend><label id="on"><input type="radio" name="p" checked>Individual</label><label id="off"><input type="radio" name="p">USC use</label></fieldset>`);
  const glyph = await page.locator("#tag").evaluate((element) => ({ glyph: getComputedStyle(element, "::before").backgroundColor, page: getComputedStyle(document.body).backgroundColor }));
  expect(glyph.glyph).not.toBe(glyph.page);
  const fills = await page.evaluate(() => [...document.querySelectorAll("#on, #off")].map((element) => getComputedStyle(element).backgroundColor));
  expect(fills[0]).not.toBe(fills[1]);
});

test("a saving button keeps its width and height, so the buttons beside it do not move", async ({ page }) => {
  await plain(page, `<form id="f" class="form-actions" style="width:420px"><button type="button" class="button button--secondary" id="cancel">Cancel</button><button type="submit" class="button button--primary" id="save">Save changes</button></form>`);
  const measure = () => page.evaluate(() => { const save = document.querySelector("#save")!.getBoundingClientRect(); return { width: save.width, height: save.height, cancel: document.querySelector("#cancel")!.getBoundingClientRect().left }; });
  const before = await measure();
  await page.evaluate(async () => { const module = "/src/ui.ts"; const { working } = await import(/* @vite-ignore */ module); (window as unknown as { done: () => void }).done = working(document.querySelector("#f")!); });
  await expect(page.locator("#save")).toHaveAttribute("aria-busy", "true");
  await page.waitForTimeout(350);
  const during = await measure();
  expect(await page.locator("#save").evaluate((element) => (element as HTMLElement).style.minWidth)).not.toBe("");
  expect(during.width).toBeCloseTo(before.width, 0);
  expect(during.height).toBeCloseTo(before.height, 0);
  expect(during.cancel).toBeCloseTo(before.cancel, 0);
  await page.evaluate(() => (window as unknown as { done: () => void }).done());
  await expect(page.locator("#save")).not.toHaveAttribute("aria-busy", "true");
  expect(await page.locator("#save").evaluate((element) => (element as HTMLElement).style.minWidth)).toBe("");
});

test("a saving button gets back the inline min-width its caller gave it, and a button with none gets none", async ({ page }) => {
  await plain(page, `<form id="f" class="form-actions"><button type="submit" class="button button--secondary" id="own" style="min-width:9rem">Save</button><button type="submit" class="button button--primary" id="plain">Save all</button></form>`);
  await page.evaluate(async () => { const module = "/src/ui.ts"; const { working } = await import(/* @vite-ignore */ module); (window as unknown as { done: () => void }).done = working(document.querySelector("#f")!); });
  await expect(page.locator("#own")).toHaveAttribute("aria-busy", "true");
  // While busy, the held width is at least the caller's own floor.
  expect(await page.locator("#own").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(143.5);
  await page.evaluate(() => (window as unknown as { done: () => void }).done());
  await expect(page.locator("#own")).not.toHaveAttribute("aria-busy", "true");
  expect(await page.locator("#own").evaluate((element) => (element as HTMLElement).style.minWidth)).toBe("9rem");
  expect(await page.locator("#plain").evaluate((element) => (element as HTMLElement).style.minWidth)).toBe("");
});

test("a status pill wraps inside its own box at large text, anywhere it sits, but stays one line in a table", async ({ page }) => {
  await plain(page, `<div id="row" style="width:120px;overflow:hidden"><span class="tag tag--bad" id="pill">Overdue · due 12 Mar 2026</span></div><table class="data-table"><tbody><tr><td><span class="tag tag--ok" id="cell">Needs replenishment</span></td></tr></tbody></table>`);
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
  const fit = await page.evaluate(() => { const row = document.querySelector("#row")!.getBoundingClientRect(); const pill = document.querySelector("#pill")!; const range = document.createRange(); range.selectNodeContents(pill); return { rowRight: row.right, pillRight: pill.getBoundingClientRect().right, textRight: range.getBoundingClientRect().right }; });
  expect(fit.pillRight).toBeLessThanOrEqual(fit.rowRight + 0.5);
  expect(fit.textRight).toBeLessThanOrEqual(fit.rowRight + 0.5);
  expect(await page.locator("#cell").evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("nowrap");
});

test("a small saving button keeps its width too", async ({ page }) => {
  await plain(page, `<form id="f" class="form-actions"><button type="submit" class="button button--sm button--secondary" id="save">Save</button></form>`);
  const width = () => page.locator("#save").evaluate((element) => element.getBoundingClientRect().width);
  const before = await width();
  await page.evaluate(async () => { const module = "/src/ui.ts"; const { working } = await import(/* @vite-ignore */ module); working(document.querySelector("#f")!); });
  await expect(page.locator("#save")).toHaveAttribute("aria-busy", "true");
  await page.waitForTimeout(350);
  expect(await width()).toBeCloseTo(before, 0);
});

test("a toast stays inside the screen when a side inset narrows it", async ({ page }) => {
  await plain(page, `<span class="tag" hidden>.</span><div class="toasts" id="toasts"><div class="toast">Saved</div></div>`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, bottom: 0, left: 44, right: 44 } });
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.locator("#toasts").evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, width: window.innerWidth }; });
  expect(box.left).toBeGreaterThanOrEqual(44 - 0.5);
  expect(box.right).toBeLessThanOrEqual(box.width - 44 + 0.5);
});
