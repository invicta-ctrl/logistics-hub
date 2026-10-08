import { expect, test, type Page } from "@playwright/test";
import { identify } from "../self-service-browser";

/*
 * V1.15 perceived performance (mobile/perceived-performance amendment): a page's optional parts fail on their own and never block
 * what people came to do. On the real Worker at phone width, every picture (item photos, thumbnails, ID scans) and the optional
 * panels (Home's insights, the bell's summary) are made to fail. Staff still open Home, find an item, lend it and add stock, and a
 * person on the Lending Hub and Self-Service still sees the item, with its icon in place of the photo, and takes it.
 */

const signIn = async (page: Page) => {
  await page.goto("/staff");
  const origin = new URL(page.url()).origin;
  let signedIn = false;
  for (const secret of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
    signedIn ||= (await page.request.post("/api/staff/login", { headers: { origin }, data: { username: process.env.E2E_OWNER_USERNAME, password: secret } })).ok();
  }
  expect(signedIn).toBe(true);
};

/** Pictures that failed to load and show as a broken-image mark. */
const brokenPictures = (page: Page) => page.evaluate(() => [...document.images].filter((img) => img.getClientRects().length && img.complete && img.naturalWidth === 0).map((img) => img.getAttribute("src")));

test("with every photo and optional panel failing, staff and students still do their work", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const name = `Optional check lamp ${Date.now() % 100000}`;
  const created = await page.request.post("/api/staff/items", { headers: { origin: baseURL! }, data: {
    name, aliases: "", category: "Miscellaneous", itemType: "Loanable", unit: "piece", status: "ACTIVE", locationId: null,
    reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: "", openingQuantity: 5
  } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };

  // The item has a real photo, which the server holds.
  await page.goto(`/staff/items?item=${id}`);
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 400;
    const draw = canvas.getContext("2d")!; draw.fillStyle = "#45685a"; draw.fillRect(0, 0, 600, 400);
    return canvas.toDataURL("image/jpeg").split(",")[1]!;
  });
  const panel = page.locator("#photo-panel");
  await panel.locator("input[type=file]").setInputFiles({ name: "lamp.jpg", mimeType: "image/jpeg", buffer: Buffer.from(image, "base64") });
  await panel.getByRole("button", { name: "Save photo" }).click();
  await expect(panel.locator("[data-tile] .item-visual--loaded img")).toBeVisible();

  // From here every picture and every optional panel fails. The failures are counted, so the test cannot pass by never meeting one.
  const refused: string[] = [];
  const count = (target: Page) => target.on("response", (response) => { if (response.status() === 503 && /\/media\/|home\/insights|attention\/summary/.test(response.url())) refused.push(new URL(response.url()).pathname); });
  count(page);
  const failing = ["**/api/staff/media/**", "**/api/public/media/**", "**/api/staff/home/insights*", "**/api/staff/attention/summary*", "**/api/staff/admin/directory/*/id/*"];
  for (const pattern of failing) await page.context().route(pattern, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable." }) }));

  // Staff: Home opens with what needs a person, the item is found in the list, and lending and stock still work.
  await page.goto("/staff/home");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.locator("#main-content").getByRole("heading", { name: "Needs attention", level: 2 })).toBeVisible();
  await expect(page.locator("#main-content").getByRole("link", { name: "Open Attention" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Items", exact: true }).first().click();
  await page.getByRole("searchbox").first().fill(name);
  const row = page.locator("#main-content").getByRole("button", { name }).first();
  await expect(row).toBeVisible();
  // A failed picture reads as complete a moment before its error event lets the shared handler (ui.ts) swap in the icon, so wait
  // for it to settle, as the profile check below does; a picture that is never swapped still fails.
  await expect.poll(() => brokenPictures(page), { message: "the list shows no broken picture" }).toEqual([]);
  await row.click();
  await expect(page.locator("#photo-panel [data-tile]")).toBeVisible();
  await expect.poll(() => brokenPictures(page), { message: "the profile shows no broken picture" }).toEqual([]);
  await page.getByRole("tab", { name: "Loan" }).click();
  const form = page.locator("#loan-form");
  await form.getByLabel("Borrower's full name").fill("Optional Borrower");
  await form.getByLabel(/Student ID number/).fill("12345678");
  await form.locator("input[type=file]").setInputFiles("public/brand/ydd-2026-banner.jpg");
  await expect(form.getByRole("img", { name: "Photo to attach" })).toBeVisible();
  await form.locator("button[type=submit]").click();
  await expect(page.locator("#toasts .toast--ok")).toContainText(`Lent 1 piece of ${name} to Optional Borrower.`);
  await page.goto("/staff/stock");
  await page.getByRole("button", { name: "Update stock" }).click();
  const sheet = page.getByRole("dialog", { name: "Update stock" });
  await sheet.getByLabel("Item", { exact: true }).fill(`${name} · ${id}`);
  await sheet.getByLabel("Quantity on hand").fill("+2");
  await sheet.getByRole("radio", { name: "New stock received" }).check();
  await sheet.getByRole("button", { name: "Add 2" }).click();
  await expect(page.locator("#toasts .toast--ok").last()).toContainText("4 → 6");

  // Students: the Lending Hub and Self-Service show the item with its icon, and a Borrow goes through.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL });
  for (const pattern of failing) await phone.route(pattern, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable." }) }));
  const student = await phone.newPage();
  count(student);
  await student.goto("/lending");
  await student.getByRole("searchbox").first().fill(name).catch(() => undefined);
  await expect(student.getByText(name).first()).toBeVisible();
  expect(await brokenPictures(student), "the Lending Hub shows no broken picture").toEqual([]);
  await student.goto(`/self-service?do=borrow&item=${id}`);
  const borrow = student.getByRole("dialog", { name });
  await expect(borrow).toBeVisible();
  expect(await brokenPictures(student), "Self-Service shows no broken picture").toEqual([]);
  await identify(borrow, "Optional Student");
  await borrow.getByLabel("Tomorrow").check();
  await borrow.getByRole("button", { name: "Review and borrow" }).click();
  await borrow.getByRole("button", { name: "Confirm borrow" }).click();
  await expect(student.getByRole("dialog", { name: /Saved on this phone|Borrowed/ })).toBeVisible();
  await expect(student.getByRole("dialog", { name: "Borrowed" })).toBeVisible({ timeout: 20_000 });
  await phone.close();
  expect(refused.filter((path) => path.includes("/api/staff/media/")).length, "staff pictures were refused").toBeGreaterThan(0);
  expect(refused.filter((path) => path.includes("/api/public/media/")).length, "student pictures were refused").toBeGreaterThan(0);
});
