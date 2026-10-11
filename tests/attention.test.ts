import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { officeDay } from "../src/loans";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/* V1.10 Attention: every reason is derived from the records that already exist, clears when its cause is fixed, never changes a record by itself, and stays quiet for everything else. */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let one: string;
let two: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (cookie: string, path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, any>>(response: Response | Promise<Response>) => (await (await response).json()) as T;

type Entry = { key: string; reason: string; source: string; urgency: "NOW" | "SOON" | "LATER"; title: string; why: string; since: string | null; href: string; action: string; review?: { loanId: string } };
type Inbox = { today: string; groups: Array<{ reason: string; source: string; label: string; total: number; byUrgency: { NOW: number; SOON: number; LATER: number } }>; entries: Entry[] };
type Summary = { needsAction: number; bySource: Record<string, number> };
const inbox = (cookie = one) => json<Inbox>(as(cookie, "/api/staff/attention"));
const summary = (cookie = one) => json<Summary>(as(cookie, "/api/staff/attention/summary"));
/** The entries of one reason about the item with this name (the seeded catalog has many others). */
const entriesFor = async (reason: string, title: string) => (await inbox()).entries.filter((entry) => entry.reason === reason && entry.title.toLowerCase().includes(title.toLowerCase()));
const total = async (reason: string) => (await inbox()).groups.find((group) => group.reason === reason)!.total;

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret", SELF_SERVICE: "open" } as unknown as Env;
  const hash = await hashPassword("correct horse battery");
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(hash);
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-2', 'staff.two', 'Staff Two', ?)").run(hash);
  one = await signIn("staff.one");
  two = await signIn("staff.two");
});

async function signIn(username: string): Promise<string> {
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${username}` }, body: JSON.stringify({ username, password: "correct horse battery" }) });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function place(name: string): Promise<string> {
  const response = await as(one, "/api/staff/locations", "POST", { name, parentId: null });
  expect(response.status).toBe(201);
  return (await json<{ id: string }>(response)).id;
}
const base = { category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
/** Test items sort ahead of the seeded catalog ("A-"), so a bounded list always shows them. */
async function item(name: string, quantity: number, fields: Record<string, unknown> = {}): Promise<string> {
  const response = await as(one, "/api/staff/items", "POST", { ...base, name: `A-${name}`, openingQuantity: quantity, locationId: shelf, ...fields });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await json<{ id: string }>(response)).id;
}
let shelf: string;
beforeEach(async () => { shelf = await place("Attention shelf"); });

let moveKey = 0;
const move = async (id: string, body: Record<string, unknown>) => {
  const response = await as(one, `/api/staff/items/${id}/movements`, "POST", { key: `attention-move-${String(++moveKey).padStart(6, "0")}`, ...body });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
};
const onHand = (id: string) => (sqlite.prepare("SELECT on_hand FROM inventory_balances WHERE id = ?").get(id) as { on_hand: number }).on_hand;
const movements = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements").get() as { n: number }).n;
let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
function lend(itemId: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ purpose: "INDIVIDUAL", quantity: "1", key: crypto.randomUUID(), studentId: "TEST-0001", ...fields })) form.set(key, value);
  form.set("photo", new File([JPEG as BlobPart], "borrower.jpg", { type: "image/jpeg" }));
  return call(`/api/staff/items/${itemId}/loans`, { method: "POST", headers: { origin, cookie: one }, body: form });
}
async function loan(name: string, fields: Record<string, string> = {}): Promise<{ id: string; itemId: string }> {
  const itemId = await item(name, 5, { itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF" });
  const tomorrow = officeDay(new Date(Date.now() + 86_400_000));
  const response = await lend(itemId, { borrowerName: "Ana Cruz", returnBy: tomorrow, ...fields });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return { id: (await json<{ id: string }>(response)).id, itemId };
}
const close = (id: string, body: Record<string, unknown>) => as(one, `/api/staff/loans/${id}/return`, "POST", body);
const officeDaysAgo = (count: number) => {
  const date = new Date(`${officeDay()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
};

describe("who may read it", () => {
  it("needs a staff sign-in for every route, and only Logistics staff pass", async () => {
    for (const [path, method] of [["/api/staff/attention", "GET"], ["/api/staff/attention/summary", "GET"], ["/api/staff/loans/LN-1/review", "POST"]] as const) {
      expect((await call(path, { method, headers: { origin } })).status, path).toBe(401);
    }
    sqlite.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES('account_access:ACC-2', 'DEM', '2026-10-03T00:00:00.000Z')").run();
    for (const path of ["/api/staff/attention", "/api/staff/attention/summary"]) expect((await as(await signIn("staff.two"), path)).status, path).toBe(403);
    expect((await as(two, "/api/staff/loans/LN-1/review", "POST")).status).toBe(403);
    expect((await as(one, "/api/staff/attention", "POST", {})).status).toBe(405);
  });

  it("refuses a cross-site review", async () => {
    const { id } = await loan("Cross tripod");
    await close(id, { outcome: "DAMAGED", note: "Broke" });
    const response = await call(`/api/staff/loans/${id}/review`, { method: "POST", headers: { origin: "https://evil.example", cookie: one } });
    expect(response.status).toBe(403);
    expect((await entriesFor("RETURN_PROBLEM", "Cross tripod"))).toHaveLength(1);
  });
});

describe("loans", () => {
  it("asks about an overdue loan, says who and how late, and stops when it is returned", async () => {
    const { id } = await loan("Overdue table", { borrowerName: "Ben Reyes", quantity: "2" });
    expect(await entriesFor("LOAN_OVERDUE", "Overdue table")).toEqual([]);
    sqlite.prepare("UPDATE loans SET return_by = ? WHERE id = ?").run(officeDaysAgo(3), id);
    const [entry] = await entriesFor("LOAN_OVERDUE", "Overdue table");
    expect(entry).toMatchObject({ title: "A-Overdue Table × 2", source: "Loans", urgency: "NOW", href: `/staff/loans?loan=${id}`, action: "Open the loan" });
    expect(entry!.why).toContain("Ben Reyes");
    expect(entry!.why).toContain("3 days ago");
    expect((await close(id, { outcome: "RETURNED" })).status).toBe(200);
    expect(await entriesFor("LOAN_OVERDUE", "Overdue table")).toEqual([]);
  });

  it("does not name a borrower whose record was erased", async () => {
    const { id } = await loan("Erased table");
    sqlite.prepare("UPDATE loans SET return_by = '2000-01-01', borrower_name = '[removed]' WHERE id = ?").run(id);
    const [entry] = await entriesFor("LOAN_OVERDUE", "Erased table");
    expect(entry!.why).toContain("record was removed");
  });

  it("marks a damaged or lost return for review, keeps the loan and stock as they are, and clears once a person reviews it", async () => {
    const damaged = await loan("Damaged tripod");
    const lost = await loan("Lost tripod");
    await close(damaged.id, { outcome: "DAMAGED", note: "Leg snapped" });
    await close(lost.id, { outcome: "LOST", note: "Not returned" });
    const stockBefore = [onHand(damaged.itemId), onHand(lost.itemId)];
    const [entry] = await entriesFor("RETURN_PROBLEM", "Damaged tripod");
    expect(entry).toMatchObject({ source: "Loans", urgency: "SOON", review: { loanId: damaged.id }, action: "Open the loan" });
    expect(entry!.why).toContain("damaged");
    expect((await entriesFor("RETURN_PROBLEM", "Lost tripod"))[0]!.why).toContain("lost");

    const moves = movements();
    const reviewed = await as(one, `/api/staff/loans/${damaged.id}/review`, "POST");
    expect(reviewed.status).toBe(200);
    expect(await entriesFor("RETURN_PROBLEM", "Damaged tripod")).toEqual([]);
    expect(await entriesFor("RETURN_PROBLEM", "Lost tripod")).toHaveLength(1);
    // The review is the only thing written: no movement, no change to the loan or the stock.
    expect(movements()).toBe(moves);
    expect([onHand(damaged.itemId), onHand(lost.itemId)]).toEqual(stockBefore);
    expect(sqlite.prepare("SELECT status FROM loans WHERE id = ?").get(damaged.id)).toEqual({ status: "DAMAGED" });
    // Once only, by whom: a second review answers without a second entry.
    expect((await as(two, `/api/staff/loans/${damaged.id}/review`, "POST")).status).toBe(200);
    expect(sqlite.prepare("SELECT COUNT(*) AS n, MIN(actor_user_id) AS actor FROM audit_log WHERE action = 'LOAN_REVIEWED'").get()).toEqual({ n: 1, actor: "ACC-1" });
    const feed = await json<{ events: Array<{ type: string; summary: string }> }>(as(one, "/api/staff/activity?limit=20"));
    expect(feed.events.find((event) => event.type === "LOAN_REVIEWED")?.summary).toBe("Staff One reviewed the damaged return of A-Damaged Tripod.");
  });

  it("reviews only a damaged or lost return, and only one that exists", async () => {
    const { id } = await loan("Good tripod");
    expect((await as(one, `/api/staff/loans/${id}/review`, "POST")).status).toBe(409);
    await close(id, { outcome: "RETURNED" });
    expect((await as(one, `/api/staff/loans/${id}/review`, "POST")).status).toBe(409);
    expect((await as(one, "/api/staff/loans/LN-missing/review", "POST")).status).toBe(404);
    expect((await as(one, "/api/staff/loans/not-a-loan/review", "POST")).status).toBe(404);
  });

  it("leaves a problem return older than sixty days to the loan history", async () => {
    const { id } = await loan("Old tripod");
    await close(id, { outcome: "DAMAGED", note: "Old break" });
    expect(await entriesFor("RETURN_PROBLEM", "Old tripod")).toHaveLength(1);
    sqlite.prepare("UPDATE loans SET closed_at = ? WHERE id = ?").run(new Date(Date.now() - 61 * 86_400_000).toISOString(), id);
    expect(await entriesFor("RETURN_PROBLEM", "Old tripod")).toEqual([]);
  });
});

describe("stock", () => {
  it("calls an item low at its level and out at none, asks less once a restock is requested, and clears when stock returns", async () => {
    const id = await item("Marker", 3, { reorderThreshold: 5 });
    let [entry] = await entriesFor("STOCK_LOW", "Marker");
    expect(entry).toMatchObject({ urgency: "SOON", source: "Stock", href: `/staff/items?item=${id}` });
    expect(entry!.why).toBe("3 left; staff keep at least 5.");
    expect(await entriesFor("STOCK_OUT", "Marker")).toEqual([]);

    await move(id, { kind: "OUT", quantity: 3, reason: "CONSUMED" });
    expect(onHand(id)).toBe(0);
    expect(await entriesFor("STOCK_LOW", "Marker")).toEqual([]);
    [entry] = await entriesFor("STOCK_OUT", "Marker");
    expect(entry).toMatchObject({ urgency: "NOW", why: "None left, and staff keep at least 5." });

    const opened = await as(one, "/api/staff/reorders", "POST", { itemId: id });
    expect(opened.status).toBe(201);
    [entry] = await entriesFor("STOCK_OUT", "Marker");
    expect(entry).toMatchObject({ urgency: "LATER", why: "None left. A restock is already requested." });

    await move(id, { kind: "IN", quantity: 20, reason: "DELIVERY" });
    expect(await entriesFor("STOCK_OUT", "Marker")).toEqual([]);
    expect(await entriesFor("STOCK_LOW", "Marker")).toEqual([]);
  });

  it("is quiet for an item with no reorder level until it is out, and ignores a retired item", async () => {
    await item("Plenty", 4);
    const gone = await item("Gone", 0, { reorderThreshold: 3 });
    expect(await entriesFor("STOCK_LOW", "Plenty")).toEqual([]);
    expect(await entriesFor("STOCK_OUT", "Plenty")).toEqual([]);
    expect((await entriesFor("STOCK_OUT", "Gone"))[0]!.urgency).toBe("NOW");
    const detail = (await json<{ item: Record<string, unknown> }>(as(one, `/api/staff/items/${gone}`))).item;
    expect((await as(one, `/api/staff/items/${gone}`, "PATCH", { ...detail, status: "INACTIVE" })).status).toBe(200);
    expect(await entriesFor("STOCK_OUT", "Gone")).toEqual([]);
    const free = await item("Free", 0);
    expect((await entriesFor("STOCK_OUT", "Free"))[0]!).toMatchObject({ urgency: "SOON", why: "None left.", href: `/staff/items?item=${free}` });
  });
});

describe("checks and reports", () => {
  const requestId = () => uuid();
  const auditId = () => `LA-00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`;
  async function finding(name: string, outcome: Record<string, unknown>) {
    const room = await place(`Room of ${name}`);
    const id = await item(name, 4, { locationId: room });
    const check = (await json<{ id: string }>(as(one, "/api/staff/audits", "POST", { locationId: room, id: auditId() }))).id;
    const seen = await as(one, `/api/staff/audits/${check}/observations`, "POST", { id: requestId(), observedAt: new Date().toISOString(), itemId: id, ...outcome });
    expect(seen.status, JSON.stringify(await seen.clone().json())).toBeLessThan(300);
    return { id, room, check };
  }
  const finish = (check: string) => as(one, `/api/staff/audits/${check}/finish`, "POST");
  const observationOf = (check: string) => (sqlite.prepare("SELECT id FROM location_audit_observations WHERE audit_id = ? ORDER BY rowid DESC LIMIT 1").get(check) as { id: string }).id;

  it("waits for a check to finish, links to its review, and clears when the finding is settled", async () => {
    const { check } = await finding("Missing stapler", { outcome: "CANT_FIND", expectedOnHand: 4 });
    expect(await entriesFor("FINDING", "Missing stapler")).toEqual([]);
    expect((await finish(check)).status).toBe(200);
    const [entry] = await entriesFor("FINDING", "Missing stapler");
    expect(entry).toMatchObject({ source: "Locations", urgency: "SOON", href: `/staff/catalogue?audit=${check}`, action: "Settle the finding" });
    expect(entry!.why).toContain("Could not be found");
    const settled = await as(one, `/api/staff/audits/observations/${observationOf(check)}/resolve`, "POST", { action: "NO_CHANGE", note: "It is in the other room" });
    expect(settled.status, JSON.stringify(await settled.clone().json())).toBe(200);
    expect(await entriesFor("FINDING", "Missing stapler")).toEqual([]);
  });

  it("clears a finding when a later count or a later look at the same item supersedes it", async () => {
    const { id, check } = await finding("Counted glue", { outcome: "MISMATCH", expectedOnHand: 4, counted: 2 });
    await finish(check);
    expect(await entriesFor("FINDING", "Counted glue")).toHaveLength(1);
    await move(id, { kind: "COUNT", quantity: 2, expectedOnHand: 4, note: "Recounted the shelf" });
    expect(await entriesFor("FINDING", "Counted glue")).toEqual([]);
  });

  it("reports a record flagged as looking wrong with the reason, and clears once the record is edited", async () => {
    const { id, check } = await finding("Odd label", { outcome: "NEEDS_REVIEW", note: "Name has a typo" });
    await finish(check);
    const [entry] = await entriesFor("RECORD_WRONG", "Odd label");
    expect(entry).toMatchObject({ source: "Catalog", urgency: "LATER", href: `/staff/items?item=${id}&tab=details`, action: "Fix the record" });
    expect(entry!.why).toContain("Name has a typo");
    expect(await entriesFor("FINDING", "Odd label")).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const detail = (await json<{ item: Record<string, unknown> }>(as(one, `/api/staff/items/${id}`))).item;
    expect((await as(one, `/api/staff/items/${id}`, "PATCH", { ...detail, name: "Odd label (fixed)" })).status).toBe(200);
    expect(await entriesFor("RECORD_WRONG", "Odd label")).toEqual([]);
  });

  it("asks only about an item reported more than once, and clears when the reports are resolved", async () => {
    const id = await item("Lost scissors", 2);
    const report = (kind: string) => as(one, `/api/staff/items/${id}/location-report`, "POST", { id: uuid(), kind, note: "Looked everywhere" });
    expect((await report("CANT_FIND")).status).toBe(201);
    expect(await entriesFor("REPEATED_REPORT", "Lost scissors")).toEqual([]);
    expect((await report("LOCATION_WRONG")).status).toBe(201);
    const [entry] = await entriesFor("REPEATED_REPORT", "Lost scissors");
    expect(entry).toMatchObject({ source: "Locations", urgency: "SOON", href: `/staff/items?item=${id}` });
    expect(entry!.why).toContain("Reported 2 times");
    expect(entry!.why).toContain("1 could not find it, 1 said the place looks wrong");
    const open = sqlite.prepare("SELECT id FROM location_reports WHERE item_id = ? AND resolved_at IS NULL").all(id) as Array<{ id: string }>;
    expect((await as(one, `/api/staff/location-reports/${open[0]!.id}/resolve`, "POST", { note: "Found it" })).status).toBe(200);
    expect(await entriesFor("REPEATED_REPORT", "Lost scissors")).toEqual([]);
  });
});

describe("kits", () => {
  it("shows a kit that is short, says what holds it back, and clears once it is restocked", async () => {
    const thread = await item("Kit thread", 10);
    const needles = await item("Kit needles", 1);
    const response = await as(one, "/api/staff/kits", "POST", { name: "Mending kit", description: null, locationId: null, components: [{ itemId: thread, required: 4 }, { itemId: needles, required: 3 }] });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    const kit = (await json<{ id: string }>(response)).id;
    const [entry] = await entriesFor("KIT_REPLENISH", "Mending kit");
    expect(entry).toMatchObject({ source: "Kits", urgency: "SOON", href: `/staff/kits?kit=${kit}`, action: "Open the kit", since: null });
    expect(entry!.why).toContain("Kit Needles");
    expect(entry!.why).not.toContain("Kit Thread");
    await move(needles, { kind: "IN", quantity: 5, reason: "DELIVERY" });
    expect(await entriesFor("KIT_REPLENISH", "Mending kit")).toEqual([]);
  });

  it("does not ask about a kit that is retired", async () => {
    const needles = await item("Retired needles", 0);
    const response = await as(one, "/api/staff/kits", "POST", { name: "Retired kit", description: null, locationId: null, components: [{ itemId: needles, required: 3 }] });
    const kit = (await json<{ id: string }>(response)).id;
    expect(await entriesFor("KIT_REPLENISH", "Retired kit")).toHaveLength(1);
    const detail = await json<{ kit: Record<string, unknown> }>(as(one, `/api/staff/kits/${kit}`));
    const updated = await as(one, `/api/staff/kits/${kit}`, "PATCH", { name: "Retired kit", description: null, locationId: null, active: false, updatedAt: detail.kit.updatedAt, components: [{ itemId: needles, required: 3 }] });
    expect(updated.status, JSON.stringify(await updated.clone().json())).toBe(200);
    expect(await entriesFor("KIT_REPLENISH", "Retired kit")).toEqual([]);
  });
});

describe("catalog completeness", () => {
  it("asks to classify an Unclassified item and to place an item with no place, and clears each when it is done", async () => {
    const unclassified = await item("Mystery box", 1, { itemType: "NEEDS_REVIEW", needsReview: true });
    const placeless = await item("Wandering cable", 1, { locationId: null });
    const [classify] = await entriesFor("CLASSIFY", "Mystery box");
    expect(classify).toMatchObject({ source: "Catalog", urgency: "LATER", href: `/staff/items?item=${unclassified}&tab=details`, action: "Classify it" });
    expect(await entriesFor("NO_PLACE", "Mystery box")).toEqual([]);
    const [located] = await entriesFor("NO_PLACE", "Wandering cable");
    expect(located).toMatchObject({ href: `/staff/items?item=${placeless}&tab=details`, action: "Choose a place" });

    const detail = (await json<{ item: Record<string, unknown> }>(as(one, `/api/staff/items/${unclassified}`))).item;
    expect((await as(one, `/api/staff/items/${unclassified}`, "PATCH", { ...detail, itemType: "Consumable", needsReview: false })).status).toBe(200);
    expect(await entriesFor("CLASSIFY", "Mystery box")).toEqual([]);
    const other = (await json<{ item: Record<string, unknown> }>(as(one, `/api/staff/items/${placeless}`))).item;
    expect((await as(one, `/api/staff/items/${placeless}`, "PATCH", { ...other, locationId: shelf })).status).toBe(200);
    expect(await entriesFor("NO_PLACE", "Wandering cable")).toEqual([]);
  });

  it("is bounded: a large backlog lists the oldest hundred and still counts them all", async () => {
    const statement = sqlite.prepare("INSERT INTO items(id, name, category, item_type, unit, status, needs_review) VALUES(?, ?, 'SUPPLIES', 'NEEDS_REVIEW', 'piece', 'ACTIVE', 1)");
    for (let at = 0; at < 250; at += 1) statement.run(`ITM-BULK-${String(at).padStart(4, "0")}`, `Bulk ${String(at).padStart(4, "0")}`);
    const all = await inbox();
    expect(all.entries.filter((entry) => entry.reason === "CLASSIFY")).toHaveLength(100);
    expect(all.groups.find((group) => group.reason === "CLASSIFY")!.total).toBeGreaterThanOrEqual(250);
  });
});

describe("Self-Service", () => {
  const phone = (id: string, review: string | null) => sqlite.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, device_time, sent_at, occurred_at, received_at, applied, review)
    VALUES(?, 'dev-1', ?, 'TAKE', ?, 1, 'Pat', '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z', ?, 0, ?)`);

  it("lists a held phone record, escalates it after a day, and clears when staff decide", async () => {
    const id = await item("Phone water", 5);
    const fresh = new Date().toISOString();
    phone("fresh", "ERROR").run(uuid(), 1, id, fresh, "ERROR");
    const held = uuid();
    phone("old", "USC_ONLY").run(held, 2, id, new Date(Date.now() - 2 * 86_400_000).toISOString(), "USC_ONLY");
    const entries = await entriesFor("PHONE_RECORD", "Phone take of A-Phone water");
    expect(entries.map((entry) => entry.urgency).sort()).toEqual(["NOW", "SOON"]);
    expect(entries.every((entry) => entry.href === "/staff/self-service" && entry.source === "Self-Service")).toBe(true);
    expect(entries.find((entry) => entry.urgency === "NOW")!.why).toBe("An individual borrow of an item lent for USC use only.");
    sqlite.prepare("UPDATE self_service_events SET resolved_at = ?, resolved_by = 'ACC-1' WHERE id = ?").run(fresh, held);
    expect(await entriesFor("PHONE_RECORD", "Phone take of A-Phone water")).toHaveLength(1);
  });

  it("counts the same records the staff shell badge counts", async () => {
    const id = await item("Badge item", 5);
    phone("a", "ERROR").run(uuid(), 3, id, new Date().toISOString(), "ERROR");
    sqlite.prepare(`INSERT INTO location_reports(id, item_id, kind, source, client_tag, created_at, reporter_name) VALUES(?, ?, 'CANT_FIND', 'SELF_SERVICE', 'tag', ?, 'Pat')`).run(uuid(), id, new Date().toISOString());
    const session = await json<{ selfServiceReviews: number }>(as(one, "/api/staff/session"));
    const entries = (await inbox()).entries.filter((entry) => entry.source === "Self-Service" && entry.title.includes("Badge Item"));
    expect(session.selfServiceReviews).toBe(2);
    expect(entries.map((entry) => entry.reason).sort()).toEqual(["PHONE_RECORD", "PHONE_REPORT"]);
    expect(entries.find((entry) => entry.reason === "PHONE_REPORT")!.why).toBe("Someone using Self-Service could not find it.");
  });
});

describe("the inbox as a whole", () => {
  it("counts in the summary exactly the entries that are not routine, by source", async () => {
    await item("Counted low", 1, { reorderThreshold: 4 });
    await item("Counted out", 0, { reorderThreshold: 2 });
    await item("Counted routine", 1, { itemType: "NEEDS_REVIEW", needsReview: true });
    await loan("Counted loan");
    const all = await inbox();
    const urgent = all.entries.filter((entry) => entry.urgency !== "LATER");
    const stats = await summary();
    expect(stats.needsAction).toBe(urgent.length);
    for (const [source, count] of Object.entries(stats.bySource)) expect(urgent.filter((entry) => entry.source === source).length, source).toBe(count);
    expect(urgent.some((entry) => entry.title === "A-Counted routine")).toBe(false);
    // The groups carry the true totals by urgency, which are what the page shows next to the bell: they add up to the total and to the summary.
    for (const group of all.groups) expect(group.byUrgency.NOW + group.byUrgency.SOON + group.byUrgency.LATER, group.reason).toBe(group.total);
    expect(all.groups.reduce((sum, group) => sum + group.byUrgency.NOW + group.byUrgency.SOON, 0)).toBe(stats.needsAction);
  });

  it("reads and never writes: opening it changes no record", async () => {
    await loan("Quiet loan");
    const tables = ["items", "loans", "inventory_movements", "audit_log", "location_reports", "self_service_events", "catalog_revision"];
    const snapshot = () => tables.map((table) => (sqlite.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(rowid), 0) AS sum FROM ${table}`).get() as { n: number; sum: number }));
    const before = snapshot();
    const revision = sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get();
    await inbox();
    await summary();
    expect(snapshot()).toEqual(before);
    expect(sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get()).toEqual(revision);
  });

  it("gives every entry a stable key, a reason a person can read, and a way to the next step", async () => {
    await item("Keyed out", 0, { reorderThreshold: 1 });
    const { entries } = await inbox();
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.title, entry.key).not.toBe("");
      expect(entry.why, entry.key).not.toMatch(/undefined|null|\[object/);
      expect(entry.href, entry.key).toMatch(/^\/staff\//);
      expect(entry.action, entry.key).not.toBe("");
    }
  });
});

/*
 * V1.15 Identity needs review: a phone record whose person cannot be told from the record alone. Only records received since
 * the identity rule began are asked about; a person's decision is audited, written once, and never rewrites what was submitted.
 */
describe("Identity needs review", () => {
  const REASON = "IDENTITY_REVIEW";
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const rule = (at: string) => sqlite.prepare("INSERT OR REPLACE INTO system_settings(key, value, updated_at) VALUES('identity_rule_from', ?, ?)").run(at, at);
  let target: string;
  let seq = 0;
  /** A phone record as the Worker stores it; only the person fields and when it arrived vary. */
  const record = (name: string, studentId: string | null, fields: { at?: string; review?: string | null; type?: string } = {}) => {
    const id = uuid();
    const at = fields.at ?? ago(5);
    sqlite.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, device_time, sent_at, occurred_at, received_at, applied, review)
      VALUES(?, 'dev-1', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?)`).run(id, ++seq, fields.type ?? "TAKE", target, name, studentId, at, at, at, at, fields.review ?? null);
    return id;
  };
  const listed = async () => (await inbox()).entries.filter((entry) => entry.reason === REASON);
  const decide = (id: string, body: unknown, cookie = one) => as(cookie, `/api/staff/self-service/${id}/identity`, "POST", body);
  const person = (name: string, studentId: string | null) => sqlite.prepare("INSERT INTO staff_directory(id, full_name, department, student_id, created_at, updated_at) VALUES(?, ?, 'USC', ?, ?, ?)").run(`PER-${uuid()}`, name, studentId, ago(1000), ago(1000));

  beforeEach(async () => { target = await item("Identity item", 5); });

  it("asks about nothing before the identity rule has begun, and about older records never", async () => {
    record("Juan", null);
    expect(await listed()).toEqual([]);
    rule(ago(60));
    expect(await listed()).toHaveLength(1);
    record("Pat", null, { at: ago(120) });
    expect(await listed()).toHaveLength(1);
  });

  it("lists a missing, malformed or incomplete identity with the reason in words, and leaves a complete one alone", async () => {
    rule(ago(60));
    person("Juan Dela Cruz", "12345678");
    record("Ana Reyes", "21000115");
    record("Juan", "99999999");
    record("Ben Lim", null);
    record("Cora Diaz", "20-1234-567");
    record("Maria Santos", "12345678");
    record("Juan Cruz", "12345678");
    record("Dela Cruz Juan", "12345678");
    const why = (await listed()).map((entry) => entry.why).sort();
    expect(why).toEqual([
      "Ben Lim gave no student ID number.",
      "Cora Diaz gave a student ID number that is not 8 digits.",
      'The name "Juan" has no last name, so it cannot be told from other people.',
      `The student ID number belongs to Juan Dela Cruz in the Staff Directory, but the name given was "Maria Santos".`
    ].sort());
    const [first] = await listed();
    expect(first).toMatchObject({ source: "Self-Service", urgency: "SOON", href: "/staff/self-service", action: "Open Self-Service", identity: { eventId: expect.any(String) } });
  });

  it("raises a directory ID given with only a first name, so the usage still links but the name is reviewed", async () => {
    rule(ago(60));
    person("Juan Dela Cruz", "12345678");
    record("Juan", "12345678");
    expect((await listed()).map((entry) => entry.why)).toEqual(['The name "Juan" has no last name, so it cannot be told from other people.']);
  });

  it("leaves out tests, erased records and anything past the review window", async () => {
    rule(ago(60 * 24 * 90));
    record("Juan", null, { review: "TEST" });
    record("[removed]", null);
    record("Pat", null, { at: ago(61 * 24 * 60) });
    expect(await listed()).toEqual([]);
  });

  it("confirms or ignores once, audits who and what, keeps what was submitted, and raises nothing twice", async () => {
    rule(ago(60));
    const confirmed = record("Juan", null);
    const ignored = record("Maria", "123");
    expect(await total(REASON)).toBe(2);
    const before = sqlite.prepare("SELECT * FROM self_service_events WHERE id = ?").get(confirmed);
    const revision = () => (sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get() as { value: number }).value;
    const start = revision();
    expect((await decide(confirmed, { outcome: "CONFIRMED", note: "  Known student  " })).status).toBe(200);
    expect(revision()).toBe(start + 1);
    expect((await decide(ignored, { outcome: "IGNORED" }, two)).status).toBe(200);
    expect(await listed()).toEqual([]);
    expect(await total(REASON)).toBe(0);
    // A second decision answers with the first: no second audit row and no second revision.
    expect((await decide(confirmed, { outcome: "IGNORED" }, two)).status).toBe(200);
    expect(revision()).toBe(start + 2);
    const audits = sqlite.prepare("SELECT actor_user_id AS actor, entity_type AS entity, entity_id AS item, details_json AS details FROM audit_log WHERE action = 'IDENTITY_REVIEWED' ORDER BY created_at, rowid").all() as Array<{ actor: string; entity: string; item: string; details: string }>;
    expect(audits.map((audit) => [audit.actor, audit.entity, audit.item, JSON.parse(audit.details)])).toEqual([
      ["ACC-1", "ITEM", target, { eventId: confirmed, type: "TAKE", outcome: "CONFIRMED", note: "Known student" }],
      ["ACC-2", "ITEM", target, { eventId: ignored, type: "TAKE", outcome: "IGNORED" }]
    ]);
    // The record itself is exactly as the phone sent it.
    expect(sqlite.prepare("SELECT * FROM self_service_events WHERE id = ?").get(confirmed)).toEqual(before);
    const feed = await json<{ events: Array<{ type: string; summary: string }> }>(as(one, "/api/staff/activity?limit=20&source=PHONE"));
    expect(feed.events.map((event) => event.summary).sort()).toEqual([
      "Staff One confirmed the identity on a phone take of A-Identity Item.",
      "Staff Two ignored the identity on a phone take of A-Identity Item."
    ]);
  });

  it("refuses a decision that is not one, a record that does not need it, an unknown record, and a request from another site or nobody", async () => {
    rule(ago(60));
    const open = record("Juan", null);
    const fine = record("Ana Reyes", "21000115");
    expect((await decide(open, { outcome: "DELETE" })).status).toBe(400);
    expect((await decide(open, {})).status).toBe(400);
    expect((await decide(fine, { outcome: "CONFIRMED" })).status).toBe(409);
    expect((await decide(uuid(), { outcome: "CONFIRMED" })).status).toBe(404);
    expect((await decide("not-an-id-not-an-id-not-an-id-not-an", { outcome: "CONFIRMED" })).status).toBe(404);
    expect((await call(`/api/staff/self-service/${open}/identity`, { method: "POST", headers: { origin: "https://evil.example", cookie: one, "content-type": "application/json" }, body: JSON.stringify({ outcome: "CONFIRMED" }) })).status).toBe(403);
    expect((await call(`/api/staff/self-service/${open}/identity`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ outcome: "CONFIRMED" }) })).status).toBe(401);
    expect(await listed()).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'IDENTITY_REVIEWED'").get()).toEqual({ n: 0 });
  });

  it("counts toward Attention's bell but not the Self-Service badge, which counts what that page can settle", async () => {
    rule(ago(60));
    record("Juan", null);
    record("Pat Lee", null, { review: "ERROR" });
    const stats = await summary();
    const session = await json<{ selfServiceReviews: number }>(as(one, "/api/staff/session"));
    expect(session.selfServiceReviews).toBe(1);
    const group = (await inbox()).groups.find((entry) => entry.reason === REASON)!;
    expect([group.total, group.byUrgency.SOON]).toEqual([2, 2]);
    expect(stats.bySource["Self-Service"]).toBeGreaterThanOrEqual(2);
  });
});
