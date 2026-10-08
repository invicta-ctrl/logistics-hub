import { expect, test, type Page } from "@playwright/test";

/*
 * V1.15 wording sweep (identity/semantic amendment §B and §I): on the real Worker, every public and staff page is read as a person
 * reads it, at phone width, and holds no exposed enum name (ACTIVE, RETURN_CHECK), no Title Case label, and no claim that anyone's
 * Student ID is "verified". Text is read from the page's own text nodes and its accessible attributes, so a label set in capitals by
 * CSS is judged by what the source wrote.
 */

const PUBLIC = ["/", "/lending", "/self-service", "/self-service?do=get", "/self-service?do=return", "/self-service?do=activity", "/self-service?do=install", "/staff"];
const STAFF = ["/staff/home", "/staff/items", "/staff/stock", "/staff/loans", "/staff/self-service", "/staff/activity", "/staff/attention",
  "/staff/catalogue", "/staff/kits", "/staff/locations", "/staff/account", "/staff/admin", "/staff/admin/self-service", "/staff/admin/catalog",
  "/staff/admin/staff", "/staff/admin/directory", "/staff/admin/accountability"];

/** Acronyms and file types that are written in capitals on purpose. */
const ACRONYMS = new Set(["USC", "PWA", "CSV", "JPEG", "JPG", "PNG", "HEIC", "WEBP", "PDF", "QR", "OK", "ID", "IDS", "URL", "SKU", "AM", "PM", "HTML", "NFC", "PIN", "GPS", "UTC", "ISO", "HTTP", "HTTPS", "JSON", "HAU", "ITM", "DOL"]);
/** Names of things that are capitalised wherever they appear. */
const PROPER = /\b(Logistics (Hub|Catalog|Catalogue)|Lending Hub|Staff Directory|Holy Angel University|Angeles City|Student Council|Department of Logistics|DoL Staff|Open Attention|Self-Service|Angelite|Cloudflare)\b/g;

type Seen = { where: string; text: string };

const read = (page: Page): Promise<Seen[]> => page.evaluate(() => {
  const out: { where: string; text: string }[] = [];
  const shown = (element: Element | null) => { for (let node = element; node; node = node.parentElement) { const tag = node.tagName; if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || (tag === "DIALOG" && !(node as HTMLDialogElement).open) || node.hasAttribute("hidden")) return false; } return true; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
    const parent = node.parentElement;
    if (text && shown(parent) && parent!.getClientRects().length) out.push({ where: `<${parent!.tagName.toLowerCase()}${parent!.className && typeof parent!.className === "string" ? `.${parent!.className.split(" ")[0]}` : ""}>`, text });
  }
  for (const element of document.querySelectorAll("[aria-label],[placeholder],[title],[alt]")) {
    if (!shown(element)) continue;
    for (const attribute of ["aria-label", "placeholder", "title", "alt"]) { const value = element.getAttribute(attribute)?.trim(); if (value) out.push({ where: `[${attribute}]`, text: value }); }
  }
  return out;
});

function problems(seen: Seen[]) {
  const found: string[] = [];
  for (const { where, text } of seen) {
    // What people typed or the catalog holds (names, references, times) is data, not interface wording.
    if (/row-link|cell-id|account__name|live-status|attn-row__title|hint-row__says|cell-strong|visually-hidden|\[alt\]/.test(where) || /^(Updated|Saved|Last) /.test(text)) continue;
    for (const word of text.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? []) found.push(`${where}: enum name ${word} in “${text}”`);
    // A reference such as SS-ABCD-EFGH and a column of initials are not words.
    for (const word of text.replace(/\bSS-[A-Z0-9-]+\b/g, "").match(/\b[A-Z]{3,}\b/g) ?? []) if (!ACRONYMS.has(word)) found.push(`${where}: capitals ${word} in “${text}”`);
    if (/\bverified\b|\bverification\b|\bverify (the |your )?(student|id)/i.test(text)) found.push(`${where}: “verified” wording in “${text}”`);
    // A short label whose every word starts with a capital letter: Title Case.
    for (const part of text.split("·")) {
      const words = part.replace(PROPER, "").replace(/[^A-Za-z' -]/g, " ").split(/\s+/).filter((word) => word.length > 1 && !ACRONYMS.has(word));
      if (!/\d/.test(part) && words.length >= 2 && words.length <= 5 && part.length <= 40 && words.every((word) => /^[A-Z]/.test(word))) found.push(`${where}: Title Case “${text}”`);
    }
  }
  return found;
}

async function signIn(page: Page) {
  await page.goto("/staff");
  const origin = new URL(page.url()).origin;
  let signedIn = false;
  for (const secret of [process.env.E2E_OWNER_PASSWORD!, "recovered owner pass"]) {
    signedIn ||= (await page.request.post("/api/staff/login", { headers: { origin }, data: { username: process.env.E2E_OWNER_USERNAME, password: secret } })).ok();
  }
  expect(signedIn).toBe(true);
}

test("no page shows an enum name, Title Case label or “verified” claim at phone width", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const found = new Map<string, string>();
  const visit = async (route: string) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.locator("main, #app").first().waitFor();
    for (const message of problems(await read(page))) if (!found.has(message)) found.set(message, route);
  };
  for (const route of PUBLIC) await visit(route);
  await signIn(page);
  const ids: string[] = [];
  for (const body of [
    { name: "Wording check projector", itemType: "Loanable", status: "ACTIVE" },
    { name: "Wording check old tape", itemType: "Consumable", status: "VERIFY" },
    { name: "Wording check pencils", itemType: "Consumable", status: "ACTIVE" },
    { name: "Wording check paint", itemType: "Consumable", status: "ACTIVE", consumptionMode: "OPEN_UNIT" },
    { name: "Wording check unsorted", itemType: "NEEDS_REVIEW", status: "ACTIVE", lendingAudience: "NOT_AVAILABLE_FOR_LENDING" }
  ]) {
    const response = await page.request.post("/api/staff/items", { headers: { origin: baseURL! }, data: {
      aliases: "", category: "Miscellaneous", unit: "piece", locationId: null, reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: "", openingQuantity: 3, ...body
    } });
    expect(response.status(), await response.text()).toBe(201);
    ids.push((await response.json()).id);
  }
  for (const route of [...STAFF, ...ids.map((id) => `/staff/items?item=${id}`)]) await visit(route);
  // One item of each way of getting something: its page and the form that asks who is borrowing, taking or using it.
  const { items } = await (await page.request.get("/api/self-service/catalog")).json() as { items: { id: string; name: string; action: string }[] };
  for (const action of ["BORROW", "TAKE", "USE"]) {
    const item = items.find((candidate) => candidate.name.startsWith("Wording check") && candidate.action === action);
    expect(item, `a ${action} item to read`).toBeTruthy();
    await visit(`/self-service?do=item&item=${item!.id}`);
    await visit(`/self-service?do=${action.toLowerCase()}&item=${item!.id}`);
  }
  const unique = [...found].map(([message, route]) => `${route} ${message}`);
  if (unique.length) console.log(`WORDING\n${unique.join("\n")}`);
  expect(unique, "wording problems").toEqual([]);
});
