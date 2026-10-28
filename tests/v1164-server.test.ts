import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/worker";
import { isExpiring, stockState } from "../src/catalog-policy";
import { balanceOf, InputError, migratedOnHandOf, onHandOf, recordMovement } from "../src/inventory";
import { officeDay } from "../src/loans";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/*
 * V1.16.4 WP2 (§4.8, §5): one item's balance read through its own ledger rows and equal to the whole-ledger view; the sequential
 * D1/R2 calls of the busiest staff routes within their budgets, as the Worker itself reports them in Server-Timing; cheaper
 * revalidation (Activity's change probe, insights' ETag, thumbnails answered from a HEAD); and the Attention contract: each entry's
 * urgency basis, Needs count and Expiring soon, and All on loan leaving Out. The seeded catalog (migrated items with migrated
 * ledgers and old-sheet figures) is part of every comparison.
 */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let media: ReturnType<typeof memoryR2>;
let one: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (cookie: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, any>>(response: Response | Promise<Response>) => (await (await response).json()) as T;

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  media = memoryR2();
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: media.bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" } as unknown as Env;
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(await hashPassword("correct horse battery"));
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": "ip-one" }, body: JSON.stringify({ username: "staff.one", password: "correct horse battery" }) });
  one = response.headers.get("set-cookie")!.split(";")[0]!;
  shelf = (await json<{ id: string }>(as(one, "/api/staff/locations", "POST", { name: "WP2 shelf", parentId: null }))).id;
});
afterEach(() => { vi.restoreAllMocks(); });

let shelf: string;
const base = { category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
async function item(name: string, quantity: number, fields: Record<string, unknown> = {}): Promise<string> {
  const response = await as(one, "/api/staff/items", "POST", { ...base, name: `A-${name}`, openingQuantity: quantity, locationId: shelf, ...fields });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await json<{ id: string }>(response)).id;
}
let keys = 0;
const key = () => `wp2-key-${String(++keys).padStart(6, "0")}`;
const move = (id: string, body: Record<string, unknown>) => as(one, `/api/staff/items/${id}/movements`, "POST", { key: key(), ...body });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
function lend(itemId: string, quantity = 1) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ purpose: "INDIVIDUAL", quantity: String(quantity), key: crypto.randomUUID(), studentId: "20231234", borrowerName: "Ana Cruz", returnBy: officeDay(new Date(Date.now() + 86_400_000)) })) form.set(name, value);
  form.set("photo", new File([JPEG as BlobPart], "borrower.jpg", { type: "image/jpeg" }));
  return call(`/api/staff/items/${itemId}/loans`, { method: "POST", headers: { origin, cookie: one }, body: form });
}

/** The calls the Worker says this request waited through: D1 and R2 together (Server-Timing, src/measure.ts). */
function callsOf(response: Response): number {
  const timing = response.headers.get("server-timing") ?? "";
  return [...timing.matchAll(/desc="(\d+) calls"/g)].reduce((sum, match) => sum + Number(match[1]), 0);
}

describe("one item's balance (§4.8.2)", () => {
  it("equals the whole-ledger view for every item, superseded and migrated rows included", async () => {
    const id = await item("Ledger", 7);
    expect((await move(id, { kind: "OUT", quantity: 2, reason: "CONSUMED" })).status).toBe(200);
    sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
      VALUES('MOV-SUPERSEDED', '2026-09-01T00:00:00.000Z', 'STOCK_OUT', 'OUT', ?, 3, 'piece', -3, 'SUPERSEDED')`).run(id);
    const rows = sqlite.prepare(`SELECT i.id, b.on_hand AS viewOnHand, b.migrated_on_hand AS viewMigrated, ${onHandOf("i.id")} AS onHand, ${migratedOnHandOf("i.id")} AS migrated
      FROM items i JOIN inventory_balances b ON b.id = i.id`).all() as Array<Record<string, number>>;
    expect(rows.length).toBeGreaterThan(300);
    expect(rows.some((row) => row.viewMigrated !== 0)).toBe(true);
    for (const row of rows) expect([row.id, row.onHand, row.migrated]).toEqual([row.id, row.viewOnHand, row.viewMigrated]);
    const single = sqlite.prepare(`SELECT b.on_hand AS onHand, b.migrated_on_hand AS migrated FROM items i LEFT JOIN ${balanceOf("?1")} b ON b.id = i.id WHERE i.id = ?1`);
    for (const row of rows) expect(single.get(row.id) as object).toEqual({ onHand: row.viewOnHand, migrated: row.viewMigrated });
    expect((await json(as(one, `/api/staff/items/${id}`))).item.onHand).toBe(5);
  });

  it("never sums the whole ledger to answer about one item: detail, a movement, a loan, a kit (EXPLAIN guard)", async () => {
    const id = await item("Planned", 4, { itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF" });
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO kits(id, name, active, created_at, updated_at) VALUES('KIT-0001', 'WP2 kit', 1, ?, ?)").run(now, now);
    sqlite.prepare("INSERT INTO kit_components(kit_id, item_id, required, position) VALUES('KIT-0001', ?, 1, 0)").run(id);
    const seen: string[] = [];
    const real = env.DB;
    env = { ...env, DB: { prepare: (sql: string) => { seen.push(sql); return real.prepare(sql); }, batch: (statements: D1PreparedStatement[]) => real.batch(statements) } as unknown as D1Database };
    const reorder = await json<{ id: string }>(as(one, "/api/staff/reorders", "POST", { itemId: id }));
    seen.length = 0;
    expect((await as(one, `/api/staff/items/${id}`)).status).toBe(200);
    expect((await move(id, { kind: "IN", quantity: 1, reason: "DELIVERY", reorderId: reorder.id })).status).toBe(200);
    expect((await move(id, { kind: "COUNT", quantity: 5, note: "Counted", expectedOnHand: 5 })).status).toBe(200);
    expect((await lend(id)).status).toBe(201);
    expect((await as(one, "/api/staff/kits/KIT-0001")).status).toBe(200);
    expect(seen.length).toBeGreaterThan(10);
    for (const sql of seen) {
      const plan = (sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map((row) => row.detail).join("\n");
      expect(plan, sql).not.toMatch(/inventory_balances/);
    }
  });
});

/** Hold both receipt preflights after they have read the open entry. */
function concurrentReceiptDb(real: D1Database) {
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const d1 = {
    prepare: (sql: string) => real.prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const result = await real.batch(statements);
      if (result.length === 2 && Object.hasOwn(result[1]?.results?.[0] ?? {}, "open")) {
        if (++arrived === 2) release();
        await barrier;
      }
      return result;
    }
  } as unknown as D1Database;
  return { d1, preflights: () => arrived };
}

describe("concurrent restock receipts (§4.3)", () => {
  it("allows only one distinct request to consume the same open entry", async () => {
    const id = await item("Receipt race", 4);
    const reorder = await json<{ id: string }>(as(one, "/api/staff/reorders", "POST", { itemId: id }));
    const revision = (sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get() as { value: number }).value;
    const real = env.DB;
    const { d1, preflights } = concurrentReceiptDb(real);
    const bodies = ["race-receipt-one", "race-receipt-two"].map((requestKey) => ({
      kind: "IN", quantity: 2, reason: "DELIVERY", reorderId: reorder.id, key: requestKey
    }));
    const results = await Promise.allSettled(bodies.map((body) => recordMovement(d1, { accountId: "ACC-1" }, id, body)));
    expect(preflights()).toBe(2);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(InputError);
    expect(loser.reason).toMatchObject({ status: 409 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE idempotency_key IN (?, ?)").get(bodies[0]!.key, bodies[1]!.key)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT on_hand AS onHand FROM inventory_balances WHERE id = ?").get(id)).toEqual({ onHand: 6 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REORDER_RESTOCKED' AND entity_id = ?").get(id)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get()).toEqual({ value: revision + 1 });
    const written = sqlite.prepare(`SELECT r.status, m.idempotency_key AS requestKey FROM reorders r JOIN inventory_movements m ON m.id = r.movement_id WHERE r.id = ?`).get(reorder.id) as { status: string; requestKey: string };
    expect(written.status).toBe("RESTOCKED");
    const winner = bodies.find((body) => body.key === written.requestKey)!;
    expect(await recordMovement(real, { accountId: "ACC-1" }, id, winner)).toEqual({ onHand: 6, change: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REORDER_RESTOCKED' AND entity_id = ?").get(id)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get()).toEqual({ value: revision + 1 });
  });

  it("accepts concurrent retries with the same key once", async () => {
    const id = await item("Receipt retry", 4);
    const reorder = await json<{ id: string }>(as(one, "/api/staff/reorders", "POST", { itemId: id }));
    const revision = (sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get() as { value: number }).value;
    const { d1, preflights } = concurrentReceiptDb(env.DB);
    const body = { kind: "IN", quantity: 2, reason: "DELIVERY", reorderId: reorder.id, key: "receipt-same-key" };
    const results = await Promise.all([recordMovement(d1, { accountId: "ACC-1" }, id, body), recordMovement(d1, { accountId: "ACC-1" }, id, body)]);
    expect(preflights()).toBe(2);
    expect(results).toEqual([{ onHand: 6, change: 2 }, { onHand: 6, change: 2 }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE idempotency_key = ?").get(body.key)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM reorders r JOIN inventory_movements m ON m.id = r.movement_id WHERE r.id = ? AND r.status = 'RESTOCKED'").get(reorder.id)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REORDER_RESTOCKED' AND entity_id = ?").get(id)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get()).toEqual({ value: revision + 1 });
  });

  it("leaves the entry open when a stale movement is refused", async () => {
    const id = await item("Stale receipt", 4);
    const reorder = await json<{ id: string }>(as(one, "/api/staff/reorders", "POST", { itemId: id }));
    const revision = (sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get() as { value: number }).value;
    const response = await as(one, `/api/staff/items/${id}/movements`, "POST", {
      kind: "IN", quantity: 2, reason: "DELIVERY", reorderId: reorder.id, expectedOnHand: 3, key: "stale-receipt-key"
    });
    expect(response.status).toBe(409);
    expect(sqlite.prepare("SELECT status, movement_id AS movementId FROM reorders WHERE id = ?").get(reorder.id)).toEqual({ status: "NEEDS_RESTOCK", movementId: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE idempotency_key = ?").get("stale-receipt-key")).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REORDER_RESTOCKED' AND entity_id = ?").get(id)).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get()).toEqual({ value: revision });
  });

  it("rejects a reused key that belongs to a different movement without closing an open entry", async () => {
    const id = await item("Reused receipt key", 4);
    const actor = { accountId: "ACC-1" };
    const requestKey = "receipt-other-movement";
    await recordMovement(env.DB, actor, id, { kind: "IN", quantity: 2, reason: "DELIVERY", key: requestKey });
    const reorder = await json<{ id: string }>(as(one, "/api/staff/reorders", "POST", { itemId: id }));
    const revision = (sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get() as { value: number }).value;
    await expect(recordMovement(env.DB, actor, id, { kind: "IN", quantity: 2, reason: "DELIVERY", reorderId: reorder.id, key: requestKey }))
      .rejects.toMatchObject({ status: 409 });
    expect(sqlite.prepare("SELECT status, movement_id AS movementId FROM reorders WHERE id = ?").get(reorder.id)).toEqual({ status: "NEEDS_RESTOCK", movementId: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE idempotency_key = ?").get(requestKey)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REORDER_RESTOCKED' AND entity_id = ?").get(id)).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get()).toEqual({ value: revision });
  });
});

describe("sequential calls (§4.8.1)", () => {
  it("keeps item detail within 3, the inventory within 3 (2 unchanged), a movement within 4 and the session within 2", async () => {
    const id = await item("Budget", 3);
    const mediaId = "0b8c1f6e-3d2a-4c5b-9e7f-1a2b3c4d5e6f";
    sqlite.prepare("INSERT INTO item_media(item_id, media_id, width, height, created_at) VALUES(?, ?, 100, 100, ?)").run(id, mediaId, new Date().toISOString());
    await media.bucket.put(`items/${mediaId}/thumb`, JPEG);
    const detail = await as(one, `/api/staff/items/${id}`);
    expect(detail.status).toBe(200);
    expect(callsOf(detail)).toBeLessThanOrEqual(3);
    const inventory = await as(one, "/api/staff/inventory");
    expect(callsOf(inventory)).toBeLessThanOrEqual(3);
    const unchanged = await as(one, "/api/staff/inventory", "GET", undefined, { "If-None-Match": inventory.headers.get("etag")! });
    expect(unchanged.status).toBe(304);
    expect(callsOf(unchanged)).toBeLessThanOrEqual(2);
    const reorder = await json<{ id: string }>(as(one, "/api/staff/reorders", "POST", { itemId: id }));
    for (const body of [{ kind: "OUT", quantity: 1, reason: "CONSUMED" }, { kind: "IN", quantity: 2, reason: "DELIVERY", reorderId: reorder.id }]) {
      const written = await move(id, body);
      expect(written.status).toBe(200);
      expect(callsOf(written)).toBeLessThanOrEqual(4);
    }
    expect(sqlite.prepare("SELECT status FROM reorders WHERE id = ?").get(reorder.id)).toEqual({ status: "RESTOCKED" });
    expect(callsOf(await as(one, "/api/staff/session"))).toBeLessThanOrEqual(2);
  });

  it("still refuses a merged item's movement, now from the movement's own first call", async () => {
    const source = await item("Merged source", 0);
    const target = await item("Merged target", 0);
    // The merge itself is covered elsewhere (merge tests); its record is written here the way the Worker writes it.
    sqlite.prepare("INSERT INTO audit_log(id, created_at, action, entity_type, entity_id, details_json) VALUES(?, ?, 'ITEM_MERGED', 'ITEM', ?, ?)")
      .run(`IM-${source}`, new Date().toISOString(), source, JSON.stringify({ targetId: target }));
    const refused = await move(source, { kind: "IN", quantity: 1, reason: "DELIVERY" });
    expect(refused.status).toBe(409);
    expect((await json(refused)).error).toContain("was merged into");
  });

  it("states what each staff request cost, once, without ids", async () => {
    const lines: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => { lines.push(line); });
    const id = await item("Logged", 2);
    lines.length = 0;
    const written = await move(id, { kind: "OUT", quantity: 1, reason: "CONSUMED" });
    expect(written.headers.get("server-timing")).toMatch(/^d1;dur=\d+;desc="\d+ calls", r2;dur=\d+;desc="\d+ calls", total;dur=\d+$/);
    expect(lines).toEqual([expect.objectContaining({ event: "staff_request", route: "/api/staff/items/:id/movements", method: "POST", status: 200, d1Calls: expect.any(Number), bytes: expect.any(Number) })]);
    expect(JSON.stringify(lines)).not.toContain(id);
    lines.length = 0;
    const read = await as(one, "/api/staff/inventory");
    await as(one, "/api/staff/inventory", "GET", undefined, { "If-None-Match": read.headers.get("etag")! });
    // The body that was sent is logged; the 304 that followed is not.
    expect(lines).toHaveLength(1);
  });
});

describe("cheaper revalidation (§4.8.3, §4.8.4)", () => {
  it("answers an unchanged Activity page from its change probe, and still accepts a V1.16.3 tag", async () => {
    await item("Activity", 1);
    const first = await as(one, "/api/staff/activity");
    const etag = first.headers.get("etag")!;
    const again = await as(one, "/api/staff/activity", "GET", undefined, { "If-None-Match": etag });
    expect(again.status).toBe(304);
    // The session and the probe; the page query never ran.
    expect(callsOf(again)).toBe(2);
    const older = await as(one, "/api/staff/activity", "GET", undefined, { "If-None-Match": etag.replace(/-[0-9a-f]{12}"$/, '"') });
    expect(older.status).toBe(304);
    await item("Activity two", 1);
    expect((await as(one, "/api/staff/activity", "GET", undefined, { "If-None-Match": etag })).status).toBe(200);
  });

  it("gives insights a validator of the revision and the hour", async () => {
    const first = await as(one, "/api/staff/home/insights");
    expect(first.headers.get("etag")).toMatch(/^"r\d+-\d{4}-\d{2}-\d{2}T\d{2}"$/);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect((await as(one, "/api/staff/home/insights", "GET", undefined, { "If-None-Match": first.headers.get("etag")! })).status).toBe(304);
  });

  it("answers a thumbnail's revalidation from a HEAD, and lets only a versioned address be kept", async () => {
    const mediaId = "0b8c1f6e-3d2a-4c5b-9e7f-1a2b3c4d5e6f";
    await media.bucket.put(`items/${mediaId}/thumb`, JPEG);
    const gets = vi.spyOn(media.bucket, "get");
    const plain = await as(one, `/api/staff/media/${mediaId}/thumb?v=2`);
    expect(plain.status).toBe(200);
    expect(plain.headers.get("cache-control")).toBe("private, no-cache");
    const versioned = await as(one, `/api/staff/media/${mediaId}/thumb?v=2&p=2026-10-25T00%3A00%3A00.000Z`);
    expect(versioned.headers.get("cache-control")).toBe("private, max-age=86400");
    // The item sheet's larger picture follows the same rule; an empty version names nothing, so it is not one.
    await media.bucket.put(`items/${mediaId}/detail`, JPEG);
    const cacheOf = async (address: string) => (await as(one, address)).headers.get("cache-control");
    expect(await cacheOf(`/api/staff/media/${mediaId}/detail?v=2`)).toBe("private, no-cache");
    expect(await cacheOf(`/api/staff/media/${mediaId}/detail?v=2&r=3`)).toBe("private, no-cache");
    expect(await cacheOf(`/api/staff/media/${mediaId}/detail?v=2&p=2026-10-25T00%3A00%3A00.000Z`)).toBe("private, max-age=86400");
    expect(await cacheOf(`/api/staff/media/${mediaId}/thumb?v=2&p=`)).toBe("private, no-cache");
    expect(await cacheOf(`/api/staff/media/${mediaId}/detail?v=2&p=`)).toBe("private, no-cache");
    gets.mockClear();
    const unchanged = await as(one, `/api/staff/media/${mediaId}/thumb?v=2`, "GET", undefined, { "If-None-Match": plain.headers.get("etag")! });
    expect(unchanged.status).toBe(304);
    expect(gets).not.toHaveBeenCalled();
    // Public thumbnails keep revalidating, so unlisting still works.
    expect((await call(`/api/public/media/${mediaId}/thumb`)).status).toBe(404);
  });
});

type Entry = { key: string; reason: string; urgency: string; basis: string; title: string; why: string };
type Inbox = { groups: Array<{ reason: string; total: number; byUrgency: Record<string, number> }>; entries: Entry[] };
const inbox = () => json<Inbox>(as(one, "/api/staff/attention"));
// Names are stored title-cased (formatItemName), so they are compared without case.
const entriesFor = async (reason: string, name: string) => (await inbox()).entries.filter((entry) => entry.reason === reason && entry.title.toLowerCase() === `a-${name}`.toLowerCase());

describe("the Attention contract (§5)", () => {
  it("gives every entry the basis of its urgency", async () => {
    await item("Basis out", 0, { reorderThreshold: 2 });
    const { entries } = await inbox();
    expect(entries.length).toBeGreaterThan(5);
    for (const entry of entries) expect(typeof entry.basis === "string" && entry.basis.length > 3, entry.key).toBe(true);
    expect(await entriesFor("STOCK_OUT", "Basis out")).toEqual([expect.objectContaining({ urgency: "NOW", basis: "Out of stock with a reorder level set" })]);
  });

  it("calls none on hand with units on loan All on loan, not Out; a shortage stays Out and says by how much", async () => {
    const lent = await item("All lent", 1, { itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF", reorderThreshold: 1 });
    expect((await lend(lent)).status).toBe(201);
    expect(await entriesFor("STOCK_OUT", "All lent")).toEqual([]);
    const listed = (await json<{ items: Array<{ id: string; onHand: number; onLoan: number; reorderThreshold: number; status: string }> }>(as(one, "/api/staff/inventory"))).items.find((entry) => entry.id === lent)!;
    expect(stockState(listed)).toBe("ON_LOAN");
    const short = await item("Short", 0);
    sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
      VALUES('MOV-SHORT', ?, 'STOCK_OUT', 'OUT', ?, 2, 'piece', -2, 'POSTED')`).run(new Date().toISOString(), short);
    expect(await entriesFor("STOCK_OUT", "Short")).toEqual([expect.objectContaining({ why: "None left, and 2 more went out than the record held." })]);
    const empty = await item("Empty loanable", 0, { itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF" });
    expect(await entriesFor("STOCK_OUT", "Empty loanable")).toHaveLength(1);
    expect(empty).toBeTruthy();
  });

  it("lists Needs count until the item is counted here", async () => {
    const doubtful = await item("Doubtful", 4, { status: "VERIFY" });
    expect(await entriesFor("NEEDS_COUNT", "Doubtful")).toEqual([expect.objectContaining({ urgency: "LATER", basis: "Figure not confirmed; nothing known to be short" })]);
    expect((await move(doubtful, { kind: "COUNT", quantity: 4, note: "Counted", expectedOnHand: 4 })).status).toBe(200);
    expect(await entriesFor("NEEDS_COUNT", "Doubtful")).toEqual([]);
  });

  it("lists Expiring soon by its stated urgency, only for Pantry items with something on hand", async () => {
    const today = officeDay();
    const day = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const pantry = { stockArea: "Pantry" };
    await item("Gone off", 2, { ...pantry, expiresOn: day(-1) });
    await item("This week", 2, { ...pantry, expiresOn: day(3) });
    await item("This month", 2, { ...pantry, expiresOn: day(20) });
    await item("Later on", 2, { ...pantry, expiresOn: day(40) });
    await item("Nothing left", 0, { ...pantry, expiresOn: day(3) });
    await item("Not pantry", 2, { expiresOn: day(3) });
    const expiring = (await inbox()).entries.filter((entry) => entry.reason === "EXPIRING" && entry.title.startsWith("A-"));
    expect(expiring.map((entry) => [entry.title.toLowerCase(), entry.urgency])).toEqual([["a-gone off", "NOW"], ["a-this week", "SOON"], ["a-this month", "LATER"]]);
    expect(expiring.map((entry) => entry.basis)).toEqual([expect.stringMatching(/^Expired on /), "Expires in 3 days", "Expires in 20 days"]);
  });

  it("counts each stock reason exactly as Stock does from the inventory list", async () => {
    const today = officeDay();
    await item("Parity out", 0, { reorderThreshold: 3 });
    await item("Parity low", 2, { reorderThreshold: 3 });
    await item("Parity count", 1, { status: "VERIFY" });
    await item("Parity expiring", 1, { stockArea: "Pantry", expiresOn: today });
    const lent = await item("Parity lent", 1, { itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF" });
    expect((await lend(lent)).status).toBe(201);
    const { items } = await json<{ items: Array<{ onHand: number; onLoan: number; reorderThreshold: number; status: string; stockArea: string | null; expiresOn: string | null; countNeeded: boolean }> }>(as(one, "/api/staff/inventory"));
    const active = items.filter((entry) => entry.status !== "INACTIVE");
    const stock = {
      STOCK_OUT: active.filter((entry) => stockState(entry) === "OUT").length,
      STOCK_LOW: active.filter((entry) => stockState(entry) === "LOW").length,
      NEEDS_COUNT: items.filter((entry) => entry.countNeeded).length,
      EXPIRING: items.filter((entry) => isExpiring(entry, today)).length
    };
    const { groups } = await inbox();
    const totals = Object.fromEntries(Object.keys(stock).map((reason) => [reason, groups.find((group) => group.reason === reason)!.total]));
    expect(totals).toEqual(stock);
    expect(Object.values(stock).every((count) => count > 0)).toBe(true);
  });
});
