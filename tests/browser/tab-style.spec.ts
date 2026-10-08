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

test("the segmented controls show the accent on the chosen segment, whether they are made of radios or buttons", async ({ page }) => {
  await lay(page);
  const wash = (selector: string) => page.locator(selector).evaluate((element) => { const style = getComputedStyle(element); return { background: style.backgroundColor, color: style.color, ring: style.boxShadow }; });
  const chosen = await Promise.all(["#g-on", "#w-on", "#b-on"].map(wash));
  const others = await Promise.all(["#g-off", "#w-off", "#b-off"].map(wash));
  for (const segment of chosen) { expect(segment).toEqual(chosen[0]); expect(segment.ring).toContain("inset"); }
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
  expect(await page.locator("#b-on").evaluate((element) => getComputedStyle(element).boxShadow)).toMatch(/rgba?\(201, 150, 42/);
});
