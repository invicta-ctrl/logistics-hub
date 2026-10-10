import { expect, test } from "@playwright/test";

/* Real local Worker and D1, owner switch off: no provider traffic is required for this release proof. */
test("review offers respect the owner switch and manual captures still save once", async ({ page, baseURL, browser }) => {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(process.env.E2E_OWNER_USERNAME!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  const headers = { origin: baseURL! };
  expect((await page.request.patch("/api/staff/admin/assist", { headers, data: { on: false } })).status()).toBe(200);
  const locationId = (await (await page.request.post("/api/staff/locations", { headers, data: { name: "E2E AI review shelf", parentId: null } })).json()).id;
  const active = (await (await page.request.post("/api/staff/catalogue/sessions", { headers, data: { locationId } })).json()).id;
  const path = `/api/staff/catalogue/sessions/${active}/ai-offer`;
  const request = { draftId: crypto.randomUUID(), revision: 1, name: "Whiteboar" };
  const anonymous = await browser.newContext({ baseURL });
  expect((await anonymous.request.post(path, { headers, data: request })).status()).toBe(401);
  await anonymous.close();
  expect((await page.request.post(path, { headers: { origin: "https://other.example" }, data: request })).status()).toBe(403);
  const offer = await (await page.request.post(path, { headers, data: request })).json();
  expect(offer).toMatchObject({ proposal: null, reason: "SWITCHED_OFF" });
  expect((await (await page.request.post(path, { headers, data: request })).json()).id).toBe(offer.id);
  await page.goto(`/staff/catalogue?session=${active}`);
  await page.getByLabel("Name", { exact: true }).fill("AI review manual capture");
  await page.locator(".cat-choice", { hasText: "Borrow" }).click();
  await page.getByLabel("Category").fill("EQUIPMENT");
  await page.getByLabel("Counted in").fill("piece");
  await page.locator("#cat-save").click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect.poll(async () => ((await (await page.request.get("/api/staff/inventory")).json()).items as { name: string }[]).filter((item) => item.name === "AI review manual capture").length).toBe(1);
  const proposals = await page.request.get("/api/staff/admin/catalog/proposals");
  expect(proposals.status()).toBe(200);
  expect(await proposals.json()).toMatchObject({ proposals: [], window: 200 });
  await page.request.post(`/api/staff/catalogue/sessions/${active}/finish`, { headers });
});
