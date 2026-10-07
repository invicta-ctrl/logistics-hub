// V1.13 evidence scenes (Administration): each of the five sections at three sizes, System healthy and degraded and with an unreadable
// build record and a failed read, the Self-Service switch and its confirmation, Catalog with names, hints and the AI panel, the
// Staff section with its role-change impact, and Accountability for an owner and an administrator. Called by visual-evidence.mjs,
// which hands over its own helpers. The healthy System page is read from the real local Worker; the degraded states are drawn by the
// same page with the answer altered only for the picture (the demo database cannot be broken on purpose).
import path from "node:path";

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function adminScenes(browser, url, dir, { SIZES, signIn, resume, median }) {
  const shot = (page, name, options = {}) => page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 80, ...options });
  const first = await signIn(browser, url, "owner.demo", SIZES.desktop);
  if ((await first.page.request.get(`${url}/api/staff/admin/system`)).status() === 404) {
    console.log("admin: this ref has no Administration sections, skipped");
    await first.context.close();
    return {};
  }
  const state = await first.context.storageState();
  const real = await (await first.page.request.get(`${url}/api/staff/admin/system`)).json();
  const accounts = await (await first.page.request.get(`${url}/api/staff/admin/accounts`)).json();
  await first.context.close();
  const timings = {};

  // The server's own timings for the System report: it runs every check, so this is the worst case an owner waits for.
  const { context: timed, page: timer } = await resume(browser, state, SIZES.desktop);
  const api = [];
  for (let run = 0; run < 7; run++) {
    const started = Date.now();
    await timer.request.get(`${url}/api/staff/admin/system`);
    api.push(Date.now() - started);
  }
  timings.systemApiMedianMs = median(api);
  const render = [];
  for (let run = 0; run < 5; run++) {
    const started = Date.now();
    await timer.goto(`${url}/staff/admin`);
    await timer.waitForSelector(".status-row");
    render.push(Date.now() - started);
  }
  timings.systemPageToStatusMs = median(render);
  await timed.close();

  const degraded = {
    ...real,
    database: { ...real.database, migrations: { ...real.database.migrations, pending: ["0031_example_pending.sql"], latest: real.database.migrations?.latest ?? "0030_item_relationships.sql" } },
    storage: real.storage.map((bucket, index) => index === 1 ? { ...bucket, ok: false, ms: 2000 } : bucket),
    selfService: "paused"
  };
  const unknownBuild = { ...real, build: null, database: { ...real.database, migrations: { ...real.database.migrations, pending: null } } };

  for (const [size, viewport] of Object.entries(SIZES)) {
    const { context, page } = await resume(browser, state, viewport);
    const open = async (route, ready) => { await page.goto(`${url}${route}`); await page.waitForSelector(ready); await page.waitForLoadState("networkidle"); };

    // System: healthy (real), then the altered answers.
    await open("/staff/admin", ".status-row");
    await shot(page, `admin-system-${size}`);
    await shot(page, `admin-system-full-${size}`, { fullPage: true });
    for (const [name, body, status] of [["degraded", degraded, 200], ["unknown-build", unknownBuild, 200], ["failed", { error: "The service is temporarily unavailable." }, 500]]) {
      const view = await resume(browser, state, viewport);
      await view.page.route("**/api/staff/admin/system", (route) => route.fulfill(json(body, status)));
      await view.page.goto(`${url}/staff/admin`);
      await view.page.waitForSelector(name === "failed" ? ".empty" : ".status-row");
      await shot(view.page, `admin-system-${name}-${size}`, { fullPage: name !== "failed" });
      await view.context.close();
    }

    // Self-Service: the switch, what it changes, and its confirmation (not confirmed: nothing is changed on the demo database).
    await open("/staff/admin/self-service", "#ss-toggle");
    await shot(page, `admin-self-service-${size}`, { fullPage: true });
    await page.locator("#ss-toggle").click();
    await page.waitForSelector("dialog[open] [data-confirm]");
    await shot(page, `admin-self-service-confirm-${size}`);
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog[open]", { state: "detached" });

    // Catalog: classification, other names (a search, an edit), the hints table and the AI panel.
    await open("/staff/admin/catalog", ".stat-strip");
    await page.waitForSelector(".alias-row, #names .empty");
    await shot(page, `admin-catalog-${size}`);
    await shot(page, `admin-catalog-full-${size}`, { fullPage: true });
    await page.fill("#names-search", "paper");
    await page.waitForSelector(".alias-row");
    await shot(page, `admin-catalog-search-${size}`);
    await page.locator("[data-edit]").first().click();
    await page.waitForSelector("#names-input");
    await shot(page, `admin-catalog-edit-${size}`);
    await page.keyboard.press("Escape");
    await page.fill("#names-search", "zzzz-no-such-item");
    await page.waitForSelector("#names .empty");
    await shot(page, `admin-catalog-nomatch-${size}`);

    // Staff: accounts, the role guide, a person's role change with its impact, and the disable confirmation.
    await open("/staff/admin/staff", "#accounts table");
    await shot(page, `admin-staff-${size}`, { fullPage: true });
    const other = accounts.accounts.find((account) => account.role === "STAFF");
    if (other) {
      await page.locator(`[data-manage="${other.id}"]`).click();
      await page.waitForSelector("#m-role");
      await page.selectOption("#m-role", "OWNER");
      await page.waitForSelector("#m-impact:not([hidden])");
      await shot(page, `admin-staff-role-impact-${size}`);
      await page.locator("#profile-form button[type=submit]").click();
      await page.waitForSelector("dialog[open] [data-confirm]");
      await shot(page, `admin-staff-role-confirm-${size}`);
    }

    // Accountability: an owner sees what is due and the removal's confirmation; an administrator is told it is the owner's.
    await open("/staff/admin/accountability", "#ret-status");
    await page.waitForFunction(() => document.querySelector("#ret-status")?.textContent !== "Checking…");
    await shot(page, `admin-accountability-${size}`, { fullPage: true });
    const admin = await resume(browser, state, viewport);
    await admin.page.route("**/api/staff/session", async (route) => { const response = await route.fetch(); route.fulfill({ response, json: { ...(await response.json()), role: "ADMIN", access: "ADMIN" } }); });
    await admin.page.goto(`${url}/staff/admin/accountability`);
    await admin.page.waitForSelector("#activity");
    await shot(admin.page, `admin-accountability-administrator-${size}`, { fullPage: true });
    await admin.context.close();
    await context.close();
  }
  return timings;
}
