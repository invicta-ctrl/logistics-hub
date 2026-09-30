import { expect, test } from "@playwright/test";

const catalog = { revision: 1, categories: ["FURNITURE", "SCHOOL SUPPLIES"], items: [
  { id: "ITM-0005", name: "Folding Table", category: "FURNITURE", unit: "piece", available: 3, audience: "STUDENTS_AND_USC_STAFF" },
  { id: "ITM-0080", name: "Cork Board", category: "FURNITURE", unit: "piece", available: 0, audience: "USC_STAFF_ONLY" },
  { id: "ITM-0262", name: "Scissors", category: "SCHOOL SUPPLIES", unit: "piece", available: 10, audience: "STUDENTS_AND_USC_STAFF" }
] };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r1"' }, body: JSON.stringify(catalog) }));
});

test("landing shows the undistorted DOL mark beside the HAU·USC crest, and only Part 1 destinations", async ({ page }) => {
  let catalogRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/public/catalog")) catalogRequests += 1; });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Borrow equipment from the USC Department of Logistics" })).toBeVisible();
  const box = (await page.locator(".site-header__brand .mark").boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(40);
  await expect(page.locator(".site-header__brand .crest")).toBeVisible();
  await expect(page.getByRole("link", { name: "Department of Logistics home" })).toHaveAttribute("href", "/");
  const facebook = page.getByRole("contentinfo").getByRole("link", { name: "Student Council on Facebook (opens in a new tab)" });
  await expect(facebook).toHaveAttribute("href", "https://www.facebook.com/holyangeluniversitysc");
  await expect(facebook).toHaveAttribute("target", "_blank");
  expect(Math.abs(box.width / box.height - 183 / 163)).toBeLessThan(0.02);
  // Availability lives only in the Lending Hub; the landing page does not poll the catalog.
  await expect(page.locator(".shelf")).toHaveCount(0);
  expect(catalogRequests).toBe(0);
  await expect(page.getByRole("link", { name: /Browse the Lending Hub/ })).toHaveAttribute("href", "/lending");
});

test("Lending Hub groups by category, filters, and keeps filters in the URL", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "Lending Hub", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Department of Logistics home" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("heading", { name: /Furniture/, level: 2 })).toBeVisible();
  await expect(page.getByText("3 pieces available")).toBeVisible();
  // Loan period and maximum per loan are no longer item settings; the row states only who may borrow.
  await expect(page.locator(".catalogue__row", { hasText: "Folding Table" }).locator(".catalogue__meta")).toHaveText("Students & USC staff");
  await expect(page.getByText(/per loan|day loan/)).toHaveCount(0);
  await expect(page.getByText("All out right now")).toBeVisible();
  await page.getByLabel("Available now").check();
  await expect(page.getByText("Cork Board")).toHaveCount(0);
  await expect(page).toHaveURL(/available=1/);
  await page.getByRole("searchbox", { name: "Search the Lending Hub" }).fill("missing");
  await expect(page.getByRole("heading", { name: "Nothing matches those filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("Cork Board")).toBeVisible();
});

test("a shared Lending Hub link restores its filters, and / focuses search", async ({ page }) => {
  await page.goto("/lending?q=sciss");
  await expect(page.getByRole("searchbox", { name: "Search the Lending Hub" })).toHaveValue("sciss");
  await expect(page.getByText("Folding Table")).toHaveCount(0);
  await expect(page.getByText("Scissors")).toBeVisible();
  await page.locator("body").click();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search the Lending Hub" })).toBeFocused();
});

test("Lending Hub explains an empty, fail-closed catalog", async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 1, items: [], categories: [] }) }));
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "No items are open for borrowing yet" })).toBeVisible();
});

test("Lending Hub reports a recoverable loading failure", async ({ page }) => {
  await page.route("**/api/public/catalog", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.goto("/lending");
  await expect(page.getByRole("heading", { name: "We couldn't load the Lending Hub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again now" })).toBeVisible();
});

test("staff sign-in validates fields and can reveal the password", async ({ page }) => {
  await page.goto("/staff");
  const background = await page.locator(".auth").evaluate((element) => getComputedStyle(element, "::before").backgroundImage);
  expect(background).toContain("/brand/hau-campus-dusk.webp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter your username and password.");
  await expect(page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Password", { exact: true }).fill("secret-value");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
});

test("loan due labels derive overdue from an open loan's return date", async ({ page }) => {
  await page.goto("/");
  const labels = await page.evaluate(async () => {
    const modulePath = "/src/loan-form.ts";
    const { dueTag, isOverdue } = await import(modulePath);
    const today = "2026-09-29";
    const optional = { status: "OUT", returnBy: null };
    const overdue = { status: "OUT", returnBy: "2026-09-28" };
    const closed = { status: "RETURNED", returnBy: "2026-09-28" };
    return {
      optional: dueTag(optional, today).toString(),
      overdue: dueTag(overdue, today).toString(),
      today: dueTag({ status: "OUT", returnBy: today }, today).toString(),
      closed: dueTag(closed, today).toString(),
      isOverdue: isOverdue(overdue, today),
      closedOverdue: isOverdue(closed, today),
    };
  });
  expect(labels.optional).toBe("");
  expect(labels.overdue).toContain("Overdue");
  expect(labels.today).toContain("Due today");
  expect(labels.closed).toBe("");
  expect(labels.isOverdue).toBe(true);
  expect(labels.closedOverdue).toBe(false);
});

const selfServiceCatalog = { revision: 3, serverTime: "2026-09-30T01:00:00.000Z", categories: ["PANTRY", "SCHOOL SUPPLIES"], items: [
  { id: "ITM-0043", name: "Bottled Water", aliases: null, category: "PANTRY", unit: "piece", action: "TAKE", available: 18, location: "Pantry shelf", audience: null },
  { id: "ITM-0262", name: "Scissors", aliases: "Gunting", category: "SCHOOL SUPPLIES", unit: "piece", action: "BORROW", available: 0, location: "Cabinet B", audience: "STUDENTS_AND_USC_STAFF" }
] };

test("self-service fits phones, tablets and desktops, with every screen and sheet inside the viewport", async ({ page }) => {
  await page.route("**/api/self-service/catalog", (route) => route.fulfill({ contentType: "application/json", headers: { etag: '"r3"' }, body: JSON.stringify(selfServiceCatalog) }));
  for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 667 }, { width: 412, height: 915 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/self-service", "/self-service?do=take", "/self-service?do=borrow&item=ITM-0262", "/self-service?do=return", "/self-service?do=activity", "/self-service?do=install"]) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      if (route.includes("item=")) await expect(page.getByRole("dialog", { name: "Scissors" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} at ${viewport.width}`).toBeTruthy();
    }
  }
  // A borrow the records say is out explains itself instead of hiding the item.
  await page.goto("/self-service?do=borrow&item=ITM-0262");
  await expect(page.getByRole("dialog", { name: "Scissors" })).toContainText("The records show none left.");
});

test("public routes fit every required viewport class", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 700 }, { width: 375, height: 700 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/", "/lending", "/staff", "/no-such-page"]) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} at ${viewport.width}`).toBeTruthy();
    }
  }
});
