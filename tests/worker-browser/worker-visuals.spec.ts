import { expect, test } from "@playwright/test";

test("item visuals: suggestion, keyboard picker, reset, photo preference and failed/offline fallback", async ({ page, context, baseURL }) => {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(process.env.E2E_USERNAME!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await page.goto("/staff/items");
  await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
  const response = await page.request.post("/api/staff/items", { headers: { origin: baseURL! }, data: {
    name: "Canon Projector visual test", aliases: "", category: "Miscellaneous", itemType: "Loanable", unit: "piece", status: "ACTIVE", locationId: null,
    reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: "", openingQuantity: 1
  } });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await page.goto(`/staff/items?item=${id}`);
  const panel = page.locator("#photo-panel");
  const controls = panel.locator("#item-visual-control");
  await expect(controls).toContainText("Projector · automatic");
  await expect(panel.locator("[data-tile] .item-icon")).toBeVisible();
  await controls.getByRole("button", { name: "Choose another icon" }).click();
  await controls.getByRole("searchbox", { name: "Find a system icon" }).fill("camera");
  const choice = controls.getByRole("button", { name: "Camera", exact: true });
  await choice.focus(); await page.keyboard.press("Enter");
  await expect(controls).toContainText("Camera · chosen icon");
  await controls.getByRole("button", { name: "Use suggested icon" }).click();
  await expect(controls).toContainText("Projector · automatic");

  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 400;
    const draw = canvas.getContext("2d")!; draw.fillStyle = "#45685a"; draw.fillRect(0, 0, 600, 400);
    return canvas.toDataURL("image/jpeg").split(",")[1]!;
  });
  await panel.locator("input[type=file]").setInputFiles({ name: "projector.jpg", mimeType: "image/jpeg", buffer: Buffer.from(image, "base64") });
  await panel.getByRole("button", { name: "Save photo" }).click();
  await expect(panel.locator("[data-tile] .item-visual--loaded img")).toBeVisible();
  await expect(controls.getByRole("button", { name: "Real photo", exact: true })).toHaveAttribute("aria-pressed", "true");
  const detail = await (await page.request.get(`/api/staff/items/${id}`)).json();
  const photoId = detail.item.photo.id;
  await page.route(`**/api/staff/media/${photoId}/display`, (route) => route.abort());
  await panel.getByRole("button", { name: "View photo of Canon Projector visual test" }).click();
  await expect(page.locator("dialog.viewer .viewer__fallback .item-icon")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.viewer")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !history.state?.viewer)).toBe(true);
  await controls.getByRole("button", { name: "System icon", exact: true }).click();
  await expect(panel.locator("[data-tile] img")).toHaveCount(0);
  expect((await (await page.request.get(`/api/staff/items/${id}`)).json()).item.photo.id).toBe(photoId);
  expect((await page.request.get(`/api/public/media/${photoId}/thumb`)).status()).toBe(404);
  await page.route(`**/api/staff/media/${photoId}/thumb`, (route) => route.abort());
  await controls.getByRole("button", { name: "Real photo", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Real photo", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect((await page.request.get(`/api/public/media/${photoId}/thumb`)).status()).toBe(200);
  await expect(panel.locator("[data-tile] img")).toHaveCount(0);
  await expect(panel.locator("[data-tile] .item-icon")).toBeVisible();
  await context.setOffline(true);
  await expect(panel.locator("[data-tile] .item-icon")).toBeVisible();
  await context.setOffline(false);
});
