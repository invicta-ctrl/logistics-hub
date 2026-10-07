import { expect, test } from "@playwright/test";

/* V1.14: an open page that keeps finding nothing new asks less often, and asks at the normal pace again as soon as something changes. */

const session = { authenticated: true, id: "ACC-staff", username: "staff.sample", displayName: "Staff Sample", role: "STAFF", access: "DoL", hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null };

test("an open Items page slows its checks while nothing changes, and returns to the normal pace on a change", async ({ page }) => {
  let revision = 1;
  const asked: number[] = [];
  await page.route("**/api/staff/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/staff/attention/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ needsAction: 0, bySource: {} }) }));
  await page.route("**/api/staff/locations", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 1, locations: [] }) }));
  await page.route("**/api/staff/inventory", (route) => {
    asked.push(Date.now());
    const etag = `"r${revision}"`;
    if (route.request().headers()["if-none-match"] === etag) return route.fulfill({ status: 304, headers: { etag } });
    return route.fulfill({ contentType: "application/json", headers: { etag }, body: JSON.stringify({ revision, items: [], categories: [], locations: [], units: [] }) });
  });
  await page.clock.install();
  // Time moves in whole seconds with a moment of real time between, so each answer lands before the next check is due.
  const pass = async (milliseconds: number) => { for (let spent = 0; spent < milliseconds; spent += 1000) { await page.clock.runFor(1000); await page.waitForTimeout(8); } };
  await page.goto("/staff/items");
  await expect.poll(() => asked.length).toBe(1);

  // The first minute runs at the normal pace: a check every 10 seconds.
  await pass(60_000);
  const firstMinute = asked.length - 1;
  expect(firstMinute).toBeGreaterThanOrEqual(5);
  expect(firstMinute).toBeLessThanOrEqual(7);

  // Five more minutes of nothing new: about one check every 30 seconds, not every 10.
  const before = asked.length;
  await pass(300_000);
  const quiet = asked.length - before;
  expect(quiet).toBeGreaterThanOrEqual(8);
  expect(quiet).toBeLessThanOrEqual(11);

  // A change is noticed within one slow step, and the normal pace comes back.
  revision = 2;
  await pass(31_000);
  const after = asked.length;
  await pass(60_000);
  expect(asked.length - after).toBeGreaterThanOrEqual(5);
});
