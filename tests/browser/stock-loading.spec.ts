import { expect, test } from "@playwright/test";

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };

// A phone user can open the stock form and choose an item before its first answer arrives.
test("Stock resolves an item entered while its initial data is loading without saving a movement", async ({ page }) => {
  const item = { id: "ITM-00001", name: "Sample toner cartridge", aliases: null, category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", onHand: 5, reorderThreshold: 0, locationId: null, stockArea: "Inventory", expiresOn: null, reorderStatus: null, countNeeded: false, consumptionMode: "WHOLE_UNIT", openUnits: 0, openCondition: null };
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 0, bySource: {} }) }));
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let stockRequests = 0;
  let movementWrites = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/movements") && request.method() !== "GET") movementWrites += 1;
  });
  await page.route("**/api/staff/stock", async (route) => {
    stockRequests += 1;
    await held;
    await route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify({ revision: 1, items: [item], locations: [], reorders: [], activity: [] }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.goto("/staff/stock");
    await expect.poll(() => stockRequests).toBe(1);
    await page.getByRole("button", { name: "Update stock" }).click();
    const panel = page.getByRole("dialog", { name: "Update stock" });
    const choice = panel.getByLabel("Item", { exact: true });
    const quantity = panel.getByLabel("Quantity on hand");
    await choice.fill(`${item.name} · ${item.id}`);
    await expect(quantity).toBeDisabled();
    release();
    await expect(quantity).toBeEnabled();
    await expect(quantity).toHaveValue("5");
    await expect(choice).toHaveValue(`${item.name} · ${item.id}`);
    await expect(panel.locator(".record-card__meta")).toContainText("5 pieces on hand");
    expect(movementWrites).toBe(0);
    await expect(panel.locator("#receipts li")).toHaveCount(0);
  } finally {
    release();
  }
});
