import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/* V1.12 Operations home: what a person can resume is theirs alone, insights state their window and evidence and never write, and the bell, Home and the inbox share one set of numbers. */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let one: string;
let two: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (cookie: string, path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, any>>(response: Response | Promise<Response>) => (await (await response).json()) as T;

type Card = { id: string; title: string; window: string; rule: string; rows: Array<{ name: string; href: string; evidence: string }>; advisory?: true };
type Insights = { asOf: string; cards: Card[]; completeness: { rows: Array<{ name: string; have: number; of: number; gap: number; href: string }> } };
type Resumable = { catalogue: { id: string; place: string | null; saved: number } | null; checks: Array<{ id: string; place: string | null; status: string; expected: number }> };
const insights = () => json<Insights>(as(one, "/api/staff/home/insights"));
const card = async (id: string) => (await insights()).cards.find((entry) => entry.id === id);
const resumable = (cookie = one) => json<Resumable>(as(cookie, "/api/staff/home"));

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret", SELF_SERVICE: "open" } as unknown as Env;
  const hash = await hashPassword("correct horse battery");
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(hash);
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-2', 'staff.two', 'Staff Two', ?)").run(hash);
  one = await signIn("staff.one");
  two = await signIn("staff.two");
  shelf = await place("Home shelf");
});

async function signIn(username: string): Promise<string> {
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${username}` }, body: JSON.stringify({ username, password: "correct horse battery" }) });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

let shelf: string;
async function place(name: string): Promise<string> {
  const response = await as(one, "/api/staff/locations", "POST", { name, parentId: null });
  expect(response.status).toBe(201);
  return (await json<{ id: string }>(response)).id;
}
const base = { category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
async function item(name: string, quantity: number, fields: Record<string, unknown> = {}): Promise<string> {
  const response = await as(one, "/api/staff/items", "POST", { ...base, name, openingQuantity: quantity, locationId: shelf, ...fields });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await json<{ id: string }>(response)).id;
}
let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
let moveKey = 0;
const move = async (id: string, body: Record<string, unknown>) => {
  const response = await as(one, `/api/staff/items/${id}/movements`, "POST", { key: `home-move-${String(++moveKey).padStart(6, "0")}`, ...body });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
};
const tableSizes = () => Object.fromEntries(["items", "loans", "inventory_movements", "audit_log", "reorders", "location_reports", "catalogue_sessions", "location_audits", "kit_checks", "catalog_revision"]
  .map((table) => [table, (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]));

describe("who may read it", () => {
  it("needs a staff sign-in, and only Logistics staff pass", async () => {
    for (const path of ["/api/staff/home", "/api/staff/home/insights"]) expect((await call(path, { headers: { origin } })).status, path).toBe(401);
    sqlite.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES('account_access:ACC-2', 'DEM', '2026-10-03T00:00:00.000Z')").run();
    const other = await signIn("staff.two");
    for (const path of ["/api/staff/home", "/api/staff/home/insights"]) expect((await as(other, path)).status, path).toBe(403);
    for (const path of ["/api/staff/home", "/api/staff/home/insights"]) expect((await as(one, path, "POST", {})).status, path).toBe(405);
  });

  it("keeps insights out of shared caches and for a short while in the browser", async () => {
    const response = await as(one, "/api/staff/home/insights");
    expect(response.headers.get("cache-control")).toBe("private, max-age=120");
    expect((await as(one, "/api/staff/home")).headers.get("cache-control")).toBe("no-store");
  });
});

describe("continue", () => {
  it("offers nothing when nothing is open", async () => {
    expect(await resumable()).toEqual({ catalogue: null, checks: [] });
  });

  it("offers this person's own open cataloguing session, and drops it once it is finished", async () => {
    const started = await as(one, "/api/staff/catalogue/sessions", "POST", { locationId: shelf });
    const { id } = await json<{ id: string }>(started);
    expect((await resumable()).catalogue).toMatchObject({ id, place: "Home shelf", saved: 0 });
    // Someone else's open session is not theirs to resume.
    expect((await resumable(two)).catalogue).toBeNull();
    expect((await as(one, `/api/staff/catalogue/sessions/${id}/finish`, "POST")).status).toBe(200);
    expect((await resumable()).catalogue).toBeNull();
  });

  it("offers this person's open and paused checks of a place, never someone else's or a finished one", async () => {
    const room = await place("Check room");
    const other = await place("Other room");
    const audit = (cookie: string, locationId: string) => json<{ id: string }>(as(cookie, "/api/staff/audits", "POST", { locationId, id: `LA-00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}` }));
    const mine = await audit(one, room);
    await audit(two, other);
    expect((await resumable()).checks).toEqual([expect.objectContaining({ id: mine.id, place: "Check room", status: "OPEN", expected: 0 })]);
    expect((await as(one, `/api/staff/audits/${mine.id}`, "PATCH", { status: "PAUSED" })).status).toBe(200);
    expect((await resumable()).checks).toEqual([expect.objectContaining({ id: mine.id, status: "PAUSED" })]);
    expect((await as(one, `/api/staff/audits/${mine.id}/finish`, "POST")).status).toBe(200);
    expect((await resumable()).checks).toEqual([]);
    expect((await resumable(two)).checks).toHaveLength(1);
  });
});

describe("what needs attention", () => {
  it("is the one set of numbers: the groups the bell carries are the inbox's groups, and the bell counts exactly what is Today or This week", async () => {
    const id = await item("Parity chalk", 0, { reorderThreshold: 4 });
    sqlite.prepare("UPDATE items SET item_type = 'NEEDS_REVIEW' WHERE id <> ?").run(id);
    const [summary, inbox] = await Promise.all([json<any>(as(one, "/api/staff/attention/summary")), json<any>(as(one, "/api/staff/attention"))]);
    expect(summary.groups).toEqual(inbox.groups);
    const live = summary.groups.reduce((sum: number, group: any) => sum + group.byUrgency.NOW + group.byUrgency.SOON, 0);
    expect(summary.needsAction).toBe(live);
    expect(Object.values(summary.bySource).reduce((sum: number, count) => sum + (count as number), 0)).toBe(live);
    expect(summary.groups.find((group: any) => group.reason === "STOCK_OUT")!.total).toBeGreaterThan(0);
  });
});

describe("insights", () => {
  it("shows no card when nothing repeats, and always the completeness of the catalog", async () => {
    const result = await insights();
    expect(result.cards).toEqual([]);
    expect(result.completeness.rows.map((row) => row.name)).toEqual(["Sorted into how they are used", "Sorted items with a place"]);
  });

  it("counts a pattern only from the second event, inside its window", async () => {
    const lent = await item("Lent projector", 5, { itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF" });
    const insert = (days: number) => sqlite.prepare(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, status, movement_id, created_at, created_by)
        VALUES(?, ?, 1, 'INDIVIDUAL', 'Pat Borrower', 'TEST-0001', 'k', 'OUT', ?, ?, 'ACC-1')`).run(`LN-${uuid()}`, lent, insertMovement(lent), daysAgo(days));
    insert(3);
    expect(await card("borrowed")).toBeUndefined();
    insert(40);
    const shown = await card("borrowed");
    expect(shown).toMatchObject({ title: "What equipment is borrowed most?", window: "Last 90 days", rule: "Items lent at least twice." });
    expect(shown!.rows).toEqual([expect.objectContaining({ name: "Lent projector", href: `/staff/items?item=${lent}`, evidence: expect.stringContaining("Lent 2 times") })]);
    // A loan from before the window is not evidence.
    const old = await item("Old tripod", 5, { itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF" });
    sqlite.prepare("INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, status, movement_id, created_at, created_by) VALUES(?, ?, 1, 'INDIVIDUAL', 'Pat', 'TEST-0001', 'k', 'OUT', ?, ?, 'ACC-1')").run(`LN-${uuid()}`, old, insertMovement(old), daysAgo(120));
    sqlite.prepare("INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, status, movement_id, created_at, created_by) VALUES(?, ?, 1, 'INDIVIDUAL', 'Pat', 'TEST-0001', 'k', 'OUT', ?, ?, 'ACC-1')").run(`LN-${uuid()}`, old, insertMovement(old), daysAgo(100));
    expect((await card("borrowed"))!.rows.map((row) => row.name)).toEqual(["Lent projector"]);
  });

  /** A movement row for a loan's NOT NULL link; its stock effect does not matter to these counts. */
  function insertMovement(itemId: string): string {
    const id = `MV-${uuid()}`;
    sqlite.prepare("INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status) VALUES(?, ?, 'LOAN_OUT', 'OUT', ?, 0, 'piece', 0, 'POSTED')").run(id, new Date().toISOString(), itemId);
    return id;
  }

  it("ranks consumables by what was taken out in 30 days, with what is left and the reorder level, as advice only", async () => {
    const paper = await item("Fast paper", 100, { unit: "ream", reorderThreshold: 10 });
    const glue = await item("Slow glue", 100);
    const rare = await item("Rare ink", 100);
    await move(paper, { kind: "OUT", quantity: 30, reason: "CONSUMED" });
    await move(paper, { kind: "OUT", quantity: 25, reason: "CONSUMED" });
    await move(glue, { kind: "OUT", quantity: 5, reason: "CONSUMED" });
    await move(glue, { kind: "OUT", quantity: 5, reason: "CONSUMED" });
    await move(rare, { kind: "OUT", quantity: 90, reason: "CONSUMED" });
    const shown = (await card("used"))!;
    expect(shown).toMatchObject({ window: "Last 30 days", advisory: true });
    expect(shown.rows.map((row) => row.name)).toEqual(["Fast paper", "Slow glue"]);
    expect(shown.rows[0]!.evidence).toBe("55 reams taken out, 2 times. 45 left; the reorder level is 10.");
    expect(shown.rows[1]!.evidence).toContain("no reorder level is set");
    // Taken out before the window is not evidence.
    const stale = await item("Stale glue", 100);
    for (const days of [45, 50]) sqlite.prepare("INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status) VALUES(?, ?, 'STOCK_OUT', 'OUT', ?, 9, 'piece', -9, 'POSTED')").run(`MV-${uuid()}`, daysAgo(days), stale);
    expect((await card("used"))!.rows.map((row) => row.name)).toEqual(["Fast paper", "Slow glue"]);
  });

  it("names the items that were restocked more than once, ignoring dismissed requests, as advice only", async () => {
    const tape = await item("Short tape", 1, { reorderThreshold: 3 });
    const pens = await item("Dismissed pens", 1);
    const reorder = (itemId: string, status: string, days: number) => sqlite.prepare("INSERT INTO reorders(id, item_id, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?)").run(`RO-${uuid()}`, itemId, status, daysAgo(days), daysAgo(days));
    reorder(tape, "RESTOCKED", 60); reorder(tape, "NEEDS_RESTOCK", 5);
    reorder(pens, "DISMISSED", 20); reorder(pens, "DISMISSED", 10);
    const shown = (await card("short"))!;
    expect(shown).toMatchObject({ advisory: true, window: "Last 90 days" });
    expect(shown.rows).toEqual([expect.objectContaining({ name: "Short tape", evidence: expect.stringContaining("A restock was requested 2 times") })]);
    expect(shown.rows[0]!.evidence).toContain("The reorder level is 3.");
  });

  it("names the places people keep reporting, with the split of what they said", async () => {
    const room = await place("Noisy cabinet");
    const a = await item("Lost scissors", 1, { locationId: room });
    const b = await item("Lost stapler", 1, { locationId: room });
    const report = (itemId: string, kind: string, days: number) => sqlite.prepare("INSERT INTO location_reports(id, item_id, location_id, kind, source, reported_by, created_at) VALUES(?, ?, ?, ?, 'STAFF', 'ACC-1', ?)").run(uuid(), itemId, room, kind, daysAgo(days));
    report(a, "CANT_FIND", 2);
    expect(await card("reports")).toBeUndefined();
    report(b, "LOCATION_WRONG", 9);
    const shown = (await card("reports"))!;
    expect(shown.rows).toEqual([{ name: "Noisy cabinet", href: `/staff/locations?place=${room}`, evidence: "2 reports about 2 items: 1 could not find it, 1 said the place looks wrong." }]);
  });

  it("names the kits found short in at least two checks", async () => {
    const thread = await item("Kit thread", 10);
    const response = await as(one, "/api/staff/kits", "POST", { name: "Thirsty kit", description: null, locationId: null, components: [{ itemId: thread, required: 2 }] });
    const kit = (await json<{ id: string }>(response)).id;
    const check = (outcome: string) => as(one, `/api/staff/kits/${kit}/checks`, "POST", { id: `KC-${uuid()}`, observations: [{ itemId: thread, outcome }] });
    expect((await check("LOW")).status).toBe(201);
    expect((await check("OK")).status).toBe(201);
    expect(await card("kits")).toBeUndefined();
    expect((await check("MISSING")).status).toBe(201);
    expect((await card("kits"))!.rows).toEqual([expect.objectContaining({ name: "Thirsty kit", href: `/staff/kits?kit=${kit}`, evidence: expect.stringContaining("Short or missing something in 2 of 3 checks") })]);
  });

  it("names the items whose use keeps being changed, and does not count the first sort out of not sure", async () => {
    const id = await item("Wavering marker", 5, { itemType: "NEEDS_REVIEW" });
    const edit = async (fields: Record<string, unknown>) => {
      const current = await json<{ item: Record<string, any> }>(as(one, `/api/staff/items/${id}`));
      const response = await as(one, `/api/staff/items/${id}`, "PATCH", { ...base, name: "Wavering marker", locationId: shelf, ...fields, updatedAt: current.item.updatedAt });
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    };
    await edit({ itemType: "Consumable" });
    expect(await card("corrections")).toBeUndefined();
    await edit({ itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF" });
    expect(await card("corrections")).toBeUndefined();
    await edit({ itemType: "Consumable", lendingAudience: "NOT_AVAILABLE_FOR_LENDING" });
    const shown = (await card("corrections"))!;
    expect(shown.rows).toEqual([expect.objectContaining({ name: "Wavering marker", href: `/staff/items?item=${id}&tab=history`, evidence: expect.stringContaining("Its use was changed 2 times") })]);
    expect(shown.rows[0]!.evidence).toContain("Now: Take.");
  });

  it("counts the catalog's gaps with the same definitions as Attention", async () => {
    const before = await insights();
    const placed = before.completeness.rows[1]!;
    await item("Gap marker", 3, { itemType: "NEEDS_REVIEW" });
    const lost = await item("Gap drawer", 3);
    sqlite.prepare("UPDATE items SET location_id = NULL WHERE id = ?").run(lost);
    const after = await insights();
    expect(after.completeness.rows[0]).toMatchObject({ gap: before.completeness.rows[0]!.gap + 1, of: before.completeness.rows[0]!.of + 2, href: "/staff/attention?reason=CLASSIFY" });
    expect(after.completeness.rows[1]).toMatchObject({ gap: placed.gap + 1, href: "/staff/attention?reason=NO_PLACE" });
    const inbox = await json<any>(as(one, "/api/staff/attention"));
    const total = (reason: string) => inbox.groups.find((group: any) => group.reason === reason).total;
    expect(after.completeness.rows[0]!.gap).toBe(total("CLASSIFY"));
    expect(after.completeness.rows[1]!.gap).toBe(total("NO_PLACE"));
  });

  it("reads and never writes, and carries no borrower, account or reporter name", async () => {
    const lent = await item("Private lens", 5, { itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF" });
    for (const days of [2, 3]) sqlite.prepare("INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, status, movement_id, created_at, created_by) VALUES(?, ?, 1, 'INDIVIDUAL', 'Secret Borrower', 'TEST-0001', 'k', 'OUT', ?, ?, 'ACC-1')").run(`LN-${uuid()}`, lent, insertMovement(lent), daysAgo(days));
    const before = tableSizes();
    const text = JSON.stringify(await insights()) + JSON.stringify(await resumable());
    expect(text).toContain("Private lens");
    for (const secret of ["Secret Borrower", "Staff One", "staff.one", "ACC-1"]) expect(text).not.toContain(secret);
    expect(tableSizes()).toEqual(before);
  });

  it("is bounded: at most five rows a card, however many items repeat", async () => {
    for (let n = 0; n < 8; n += 1) {
      const id = await item(`Busy item ${n}`, 1000);
      await move(id, { kind: "OUT", quantity: 1 + n, reason: "CONSUMED" });
      await move(id, { kind: "OUT", quantity: 1, reason: "CONSUMED" });
    }
    const shown = (await card("used"))!;
    expect(shown.rows).toHaveLength(5);
    expect(shown.rows[0]!.name).toBe("Busy item 7");
  });
});
