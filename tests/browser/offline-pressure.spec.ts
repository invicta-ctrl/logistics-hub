import { expect, test } from "@playwright/test";

/* V1.14: a phone with no room left says so, loses nothing, and saves the same record once there is room. */

const item = { id: "ITM-0002", name: "Bottled Water", aliases: null, category: "PANTRY", unit: "piece", area: "Pantry", action: "TAKE", available: 18, location: "Pantry shelf", locationId: null, audience: null };

test("a full phone says it is out of space, keeps what was typed, and saves it once there is room", async ({ page }) => {
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r7"' }, body: JSON.stringify({ revision: 7, items: [item], places: [] }) }));
  await page.route("**/api/self-service/sync", (route) => route.abort());
  await page.goto("/self-service?do=take&item=ITM-0002");
  const sheet = page.getByRole("dialog", { name: "Bottled Water" });
  await sheet.getByLabel(/name/i).first().fill("Maria Santos");
  await sheet.getByRole("button", { name: /^Review/ }).click();
  const confirm = sheet.getByRole("button", { name: /^Confirm/ });
  await expect(confirm).toBeVisible();
  // The device runs out of room just as the record is written: the write fails and the transaction reports a quota error, as browsers do.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    const error = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "error")!;
    (window as unknown as { room: () => void }).room = () => { IDBObjectStore.prototype.put = put; Object.defineProperty(IDBTransaction.prototype, "error", error); };
    IDBObjectStore.prototype.put = function () { throw new DOMException("full", "QuotaExceededError"); };
    Object.defineProperty(IDBTransaction.prototype, "error", { configurable: true, get: () => new DOMException("full", "QuotaExceededError") });
  });
  await confirm.click();
  await expect(sheet.getByRole("alert")).toContainText("out of space");
  await expect(sheet.getByRole("alert")).toContainText("What you typed is still here");
  expect(await page.evaluate(() => new Promise<number>((resolve) => { const open = indexedDB.open("logistics-hub"); open.onsuccess = () => { const count = open.result.transaction("events").objectStore("events").count(); count.onsuccess = () => resolve(count.result); }; }))).toBe(0);
  // Room is made; the same confirm saves it, once.
  await page.evaluate(() => (window as unknown as { room: () => void }).room());
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator(".ss-receipt")).toBeVisible();
  expect(await page.evaluate(() => new Promise<number>((resolve) => { const open = indexedDB.open("logistics-hub"); open.onsuccess = () => { const count = open.result.transaction("events").objectStore("events").count(); count.onsuccess = () => resolve(count.result); }; }))).toBe(1);
});
