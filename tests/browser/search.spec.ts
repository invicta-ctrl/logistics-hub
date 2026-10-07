import { expect, test, type Page, type Request } from "@playwright/test";

/* V1.11 global search on fictional data with the API mocked: the keyboard, the combobox semantics, who sees the Staff Directory, and phones. */

const session = (role: "OWNER" | "STAFF") => ({ authenticated: true, id: `ACC-${role}`, username: `${role.toLowerCase()}.sample`, displayName: `${role === "OWNER" ? "Owner" : "Staff"} Sample`, role, access: "DoL", hub: true, mustChangePassword: false, recovery: { configured: true, createdAt: null }, selfServiceReviews: 0, selfServiceClosed: false, directory: null });

const item = (id: string, name: string, placeId: string | null, fields: Record<string, unknown> = {}) => ({ id, name, aliases: null, category: "Office Equipment and Supplies", itemType: "CONSUMABLE", status: "ACTIVE", placeId, iconKey: null, visualType: null, photoId: null, ...fields });
const index = {
  revision: 7,
  places: [
    { id: "LOC-1", name: "Sample Office", parentId: null, active: true },
    { id: "LOC-2", name: "Cabinet 1", parentId: "LOC-1", active: true },
    { id: "LOC-3", name: "Shelf A", parentId: "LOC-2", active: true }
  ],
  items: [
    item("ITM-0001", "Glue Stick", "LOC-3"),
    item("ITM-0002", "Glue Gun - small", "LOC-3", { aliases: "hot glue gun" }),
    item("ITM-0003", "Stapler - Big", "LOC-3"),
    item("ITM-0004", "Staples - Large", "LOC-3"),
    item("ITM-0005", "Cabinet Lock", "LOC-2"),
    item("ITM-0006", "Masking Tape", "LOC-3"),
    item("ITM-0007", "Scotch Tape", "LOC-3"),
    item("ITM-0008", "Correction Tape", "LOC-3")
  ],
  kits: [{ id: "KIT-1", name: "Crafts Sample Kit", placeId: "LOC-3", active: true, items: ["ITM-0001", "ITM-0006"] }],
  links: [{ from: "ITM-0002", to: "ITM-0001", kind: "USED_WITH" }, { from: "ITM-0003", to: "ITM-0004", kind: "USED_WITH" }]
};
const person = (n: number, name: string, position: string | null) => ({ id: `PER-00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, name, department: "DEM", position, officer: false, active: true, score: 40 - n, why: null });

type Setup = { role?: "OWNER" | "STAFF"; indexStatus?: number };
async function setup(page: Page, { role = "OWNER", indexStatus = 200 }: Setup = {}) {
  const peopleAsked: string[] = [];
  const indexAsked: Request[] = [];
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session(role)) }));
  await page.route("**/api/staff/search", (route) => {
    indexAsked.push(route.request());
    if (indexStatus !== 200) return route.fulfill({ status: indexStatus, contentType: "application/json", body: JSON.stringify({ error: indexStatus === 401 ? "Sign in again." : "Something went wrong." }) });
    return route.fulfill({ contentType: "application/json", headers: { etag: '"r7"' }, body: JSON.stringify(index) });
  });
  await page.route("**/api/staff/admin/directory/search?*", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    peopleAsked.push(query);
    const people = /santos/i.test(query) ? [person(1, "Andrea Santos", "Finance Officer"), person(2, "Bea Santos", null), person(3, "Carlo Santos", "Logistics Head")] : [];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ people, total: /santos/i.test(query) ? 30 : 0 }) });
  });
  await page.goto("/staff/account");
  await expect(page.locator(".app-bar")).toBeVisible();
  return { peopleAsked, indexAsked };
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Search the Hub" });
const field = (page: Page) => page.getByRole("combobox", { name: "Search the Hub" });
const activeOption = (page: Page) => page.evaluate(() => {
  const id = document.querySelector("#palette-input")!.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.getAttribute("aria-label") ?? null : null;
});

test("Ctrl+K opens search with focus in an APG combobox, and the arrows, Enter and Escape behave", async ({ page }) => {
  await setup(page);
  const button = page.getByRole("button", { name: "Search", exact: true });
  await expect(button).toHaveAttribute("aria-keyshortcuts", "Control+K");
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveAttribute("aria-controls", "palette-list");
  await expect(field(page)).toHaveAttribute("aria-autocomplete", "list");
  // Before typing: the pages, as options in a named group.
  await expect(page.getByRole("group", { name: "Go to" }).getByRole("option").first()).toBeVisible();

  await field(page).fill("glue");
  const items = page.getByRole("group", { name: /^Items/ });
  await expect(items.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("group", { name: /^Kits/ }).getByRole("option")).toHaveCount(1);
  await expect(field(page)).toHaveAttribute("aria-expanded", "true");
  // Each option says what it is and why it matched, in its accessible name.
  await expect(items.getByRole("option", { name: "Glue Gun - small, item, Sample Office › Cabinet 1 › Shelf A" })).toBeVisible();
  await expect(page.getByRole("option", { name: /^Crafts Sample Kit, kit, Includes Glue Stick/ })).toBeVisible();

  // The best result is active from the start (Enter opens it); focus stays in the field while the arrows move, wrapping at the ends.
  expect(await activeOption(page)).toMatch(/^Glue Stick, item/);
  await page.keyboard.press("ArrowDown");
  expect(await activeOption(page)).toMatch(/^Glue Gun - small, item/);
  await expect(page.locator("[role=option][aria-selected=true]")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(await activeOption(page)).toMatch(/^Glue Stick, item/);
  await page.keyboard.press("ArrowUp");
  expect(await activeOption(page)).toMatch(/^Crafts Sample Kit, kit/);
  await expect(field(page)).toBeFocused();

  // Escape clears first, then closes, and focus goes back to where it was.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
  await button.focus();
  await page.keyboard.press("Control+k");
  await field(page).fill("stapler big");
  await page.keyboard.press("Escape");
  await expect(field(page)).toHaveValue("");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
  await expect(button).toBeFocused();

  // Enter opens the best result.
  await page.keyboard.press("Control+k");
  await field(page).fill("stapler big");
  await expect(page.getByRole("option", { name: /^Staples - Large, item, Used with Stapler - Big/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
  await expect(page).toHaveURL(/\/staff\/items\?item=ITM-0003$/);
});

test("the same shortcut closes it, a click opens a result, and search never opens over another dialog", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeHidden();

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await field(page).fill("cabinet");
  // A place named what was typed comes before items that only share the word.
  await expect(page.locator(".palette__group").first()).toHaveAttribute("aria-labelledby", "palette-group-places");
  await page.getByRole("option", { name: /^Cabinet 1, place/ }).click();
  await expect(page).toHaveURL(/\/staff\/locations\?place=LOC-2$/);

  await page.goto("/staff/account");
  await page.evaluate(() => { const other = document.createElement("dialog"); other.id = "other"; document.body.append(other); other.showModal(); });
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeHidden();
});

test("an ID opens its record, a fixed word opens its page, and nothing matched says so", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Control+k");
  await field(page).fill("ITM-0007");
  expect(await page.locator("[role=option]").first().getAttribute("aria-label")).toMatch(/^Scotch Tape, item/);
  await field(page).fill("overdue");
  await expect(page.getByRole("group", { name: "Go to" }).getByRole("option").first()).toHaveAttribute("aria-label", /^Overdue loans, go to/);
  await field(page).fill("zzqx");
  await expect(page.getByText("No matches for “zzqx”")).toBeVisible();
  await expect(field(page)).toHaveAttribute("aria-expanded", "false");
  // The count is announced once typing pauses, not per key.
  await field(page).fill("tape");
  await expect(page.locator("#palette-status")).toHaveText("3 items, 1 kit.");
});

test("a result marks the starts of the words typed, with a plural's s, and never the middle of a word", async ({ page }) => {
  await setup(page, { role: "STAFF" });
  await page.keyboard.press("Control+k");
  const marks = (name: string) => page.getByRole("option", { name: new RegExp(`^${name}, item`) }).locator("mark").allTextContents();
  await field(page).fill("staples");
  await expect.poll(() => marks("Staples - Large")).toEqual(["Staples"]);
  await field(page).fill("stap bi");
  await expect.poll(() => marks("Stapler - Big")).toEqual(["Stap", "Bi"]);
  await field(page).fill("glue sticks");
  await expect.poll(() => marks("Glue Stick")).toEqual(["Glue", "Stick"]);
  await field(page).fill("tape");
  await expect.poll(() => marks("Masking Tape")).toEqual(["Tape"]);
});

test("staff search never asks for or shows the Staff Directory; an administrator gets the best few and a way to the rest", async ({ page }) => {
  const staff = await setup(page, { role: "STAFF" });
  await page.keyboard.press("Control+k");
  await expect(page.getByText(/people in the Staff Directory/)).toHaveCount(0);
  await field(page).fill("santos");
  await expect(page.getByText("No matches for “santos”")).toBeVisible();
  await field(page).fill("directory");
  await page.waitForTimeout(500);
  await expect(page.getByRole("option", { name: /Staff Directory/ })).toHaveCount(0);
  expect(staff.peopleAsked).toEqual([]);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const owner = await setup(page, { role: "OWNER" });
  await page.keyboard.press("Control+k");
  await field(page).fill("santos");
  const people = page.getByRole("group", { name: /^Staff Directory/ });
  await expect(people.getByRole("option", { name: /^Andrea Santos, person in the Staff Directory, Finance Officer, DEM/ })).toBeVisible();
  await expect(people.getByRole("option", { name: "See all 30 matching people in the Staff Directory" })).toBeVisible();
  await expect(page.locator("#palette-status")).toHaveText("30 people.");
  // Asked once typing paused, not once per letter.
  expect(owner.peopleAsked).toEqual(["santos"]);
  await people.getByRole("option", { name: /^See all 30/ }).click();
  await expect(page).toHaveURL(/\/staff\/admin\/directory\?q=santos$/);
});

test("typing never asks the Worker, each opening revalidates, and a failure says what to do", async ({ page }) => {
  const { indexAsked } = await setup(page);
  await page.keyboard.press("Control+k");
  for (const query of ["g", "gl", "glue", "glue s", "tape", "cabinet"]) await field(page).fill(query);
  await expect(page.getByRole("option").first()).toBeVisible();
  // Every query above was ranked in the browser from one index.
  expect(indexAsked).toHaveLength(1);
  // The next opening checks again with the revision it holds, so a link made a moment ago is found (a 304 when nothing changed).
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
  await page.waitForTimeout(1_100);
  await page.keyboard.press("Control+k");
  await expect.poll(() => indexAsked.length).toBe(2);
  expect(indexAsked[1]!.headers()["if-none-match"]).toBe('"r7"');

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await setup(page, { indexStatus: 401 });
  await page.keyboard.press("Control+k");
  await field(page).fill("glue");
  await expect(page.getByText("Your session has ended. Sign in again to search.")).toBeVisible();
  // The pages still work without the index.
  await field(page).fill("overdue");
  await expect(page.getByRole("option", { name: /^Overdue loans/ })).toBeVisible();
});

test("phones open search from the top bar, full screen with a way back, and the bottom bar is unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link")).toHaveCount(4);
  const button = page.getByRole("button", { name: "Search", exact: true });
  const box = (await button.boundingBox())!;
  expect(box.y).toBeLessThan(80);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await button.click();
  const dialog = palette(page);
  const panel = (await dialog.boundingBox())!;
  expect(panel.width).toBeCloseTo(390, 0);
  expect(panel.height).toBeCloseTo(844, 0);
  // 16 px or more, so iOS does not zoom into the field.
  expect(await field(page).evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await field(page).fill("tape");
  for (const option of await page.getByRole("option").all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.querySelector(".palette")!.scrollWidth <= window.innerWidth)).toBeTruthy();
  await dialog.getByRole("button", { name: "Close search" }).first().click();
  await expect(dialog).toBeHidden();
});

test("200% text on a 320 px phone keeps every result readable inside the screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await setup(page);
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
  const button = page.getByRole("button", { name: "Search", exact: true });
  const box = (await button.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await button.click();
  await field(page).fill("glue gun small");
  await expect(page.getByRole("option").first()).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll(".palette *")].filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.right > window.innerWidth + 1;
  }).map((element) => element.className));
  expect(overflow).toEqual([]);
});

test("reduced motion: the panel appears without movement", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.keyboard.press("Control+k");
  expect(await palette(page).evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});
