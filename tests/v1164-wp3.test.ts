import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/*
 * V1.16.4 WP3 (§4.3, §4.4): an item's history read a page at a time with no gap or repeat and with each movement's balance taken
 * from the whole ledger; the sheet's Stock settings written alone, under the item's version; its open restock entry in the detail
 * and closed by a Stock in; Pantry's 30 days of use under an hourly validator; and each kit component naming its one cause.
 */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let one: string;
let shelf: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (cookie: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, any>>(response: Response | Promise<Response>) => (await (await response).json()) as T;

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" } as unknown as Env;
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(await hashPassword("correct horse battery"));
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": "ip-one" }, body: JSON.stringify({ username: "staff.one", password: "correct horse battery" }) });
  one = response.headers.get("set-cookie")!.split(";")[0]!;
  shelf = (await json<{ id: string }>(as(one, "/api/staff/locations", "POST", { name: "WP3 shelf", parentId: null }))).id;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const base = { category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
async function item(name: string, quantity: number, fields: Record<string, unknown> = {}): Promise<string> {
  const response = await as(one, "/api/staff/items", "POST", { ...base, name: `A-${name}`, openingQuantity: quantity, locationId: shelf, ...fields });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await json<{ id: string }>(response)).id;
}
let keys = 0;
const key = () => `wp3-key-${String(++keys).padStart(6, "0")}`;
const move = (id: string, body: Record<string, unknown>) => as(one, `/api/staff/items/${id}/movements`, "POST", { key: key(), ...body });
const detailOf = (id: string) => json(as(one, `/api/staff/items/${id}`));
function callsOf(response: Response): number {
  const timing = response.headers.get("server-timing") ?? "";
  return [...timing.matchAll(/desc="(\d+) calls"/g)].reduce((sum, match) => sum + Number(match[1]), 0);
}

type Row = { id: string; sortAt: string; afterQuantity?: number };
type Page = { movements: Row[]; events: Row[]; next: { at: string; id: string } | null };
const newestFirst = (a: Row, b: Row) => a.sortAt === b.sortAt ? (a.id < b.id ? 1 : -1) : a.sortAt < b.sortAt ? 1 : -1;

describe("an item's history, a page at a time (§4.3)", () => {
  /** 70 movements over three instants (ties broken by id) and 60 events, so each stream runs past a page and the pages cut through ties. */
  async function busyItem(): Promise<string> {
    const id = await item("History", 0);
    const stamps = ["2026-09-01T08:00:00.000Z", "2026-09-02T08:00:00.000Z", "2026-09-03T08:00:00.000Z"];
    const insert = sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
      VALUES(?, ?, 'STOCK_IN', 'IN', ?, 1, 'piece', 1, 'POSTED')`);
    for (let n = 0; n < 70; n += 1) insert.run(`MOV-H${String(n).padStart(3, "0")}`, stamps[Math.floor(n / 24)]!, id);
    const audit = sqlite.prepare(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json) VALUES(?, ?, 'ACC-1', 'ITEM_UPDATED', 'ITEM', ?, '{}')`);
    for (let n = 0; n < 60; n += 1) audit.run(`AUD-H${String(n).padStart(3, "0")}`, stamps[n % 3]!, id);
    return id;
  }

  it("follows the pages to the end with nothing missed or repeated, newest first", async () => {
    const id = await busyItem();
    const first = await detailOf(id);
    expect(first.movements.length).toBeLessThanOrEqual(50);
    expect(first.events.length).toBeLessThanOrEqual(50);
    expect(first.historyNext).not.toBeNull();
    const pages: Page[] = [{ movements: first.movements, events: first.events, next: first.historyNext }];
    while (pages.at(-1)!.next) {
      const { at, id: last } = pages.at(-1)!.next!;
      const response = await as(one, `/api/staff/items/${id}/history?before=${encodeURIComponent(`${at},${last}`)}`);
      expect(response.status).toBe(200);
      pages.push(await json<Page>(response));
      expect(pages.length).toBeLessThan(10);
    }
    const movements = pages.flatMap((page) => page.movements);
    const events = pages.flatMap((page) => page.events);
    const stored = (table: string, where: string) => (sqlite.prepare(`SELECT id FROM ${table} WHERE ${where} = ?`).all(id) as Array<{ id: string }>).map((row) => row.id).sort();
    expect(movements.map((row) => row.id).sort()).toEqual(stored("inventory_movements", "item_id"));
    expect(events.map((row) => row.id).sort()).toEqual(stored("audit_log", "entity_type = 'ITEM' AND entity_id"));
    // Each page is newest first, and wholly older than the page before it, across both streams.
    for (const [index, page] of pages.entries()) {
      for (const stream of [page.movements, page.events]) expect(stream.map((row) => row.id)).toEqual([...stream].sort(newestFirst).map((row) => row.id));
      const rows = [...page.movements, ...page.events];
      if (index === 0) continue;
      const edge = pages[index - 1]!.next!;
      for (const row of rows) expect(row.sortAt < edge.at || (row.sortAt === edge.at && row.id < edge.id)).toBe(true);
    }
  });

  it("gives each movement on a later page its balance from the whole ledger", async () => {
    const id = await busyItem();
    const first = await detailOf(id);
    const older = await json<Page>(as(one, `/api/staff/items/${id}/history?before=${encodeURIComponent(`${first.historyNext.at},${first.historyNext.id}`)}`));
    const ledger = new Map((sqlite.prepare(`SELECT id, SUM(signed_quantity) OVER (ORDER BY julianday(created_at), rowid) AS after FROM inventory_movements WHERE item_id = ?`).all(id) as Array<{ id: string; after: number }>)
      .map((row) => [row.id, row.after]));
    expect(older.movements.length).toBeGreaterThan(0);
    for (const row of [...first.movements, ...older.movements] as Row[]) expect(row.afterQuantity, row.id).toBe(ledger.get(row.id));
    expect(first.movements[0].afterQuantity).toBe(first.item.onHand);
  });

  it("refuses a page marker it did not make, and answers a page within the detail's budget", async () => {
    const id = await busyItem();
    for (const before of ["", "yesterday,MOV-1", "2026-09-01T08:00:00.000Z", "2026-09-01T08:00:00.000Z,MOV' OR 1=1", "2026-13-45T99:00:00.000Z,MOV-1"]) {
      const response = await as(one, `/api/staff/items/${id}/history?before=${encodeURIComponent(before)}`);
      expect(response.status, before).toBe(400);
      expect((await json(response)).error).toBe("That page marker is not valid. Reload the item.");
    }
    const response = await as(one, `/api/staff/items/${id}/history?before=${encodeURIComponent("2026-09-02T08:00:00.000Z,MOV-H030")}`);
    expect(response.status).toBe(200);
    expect(callsOf(response)).toBeLessThanOrEqual(3);
    expect((await call(`/api/staff/items/${id}/history?before=x`)).status).toBe(401);
  });
});

describe("Stock settings (§4.3)", () => {
  it("writes the four settings alone, under the item's version, and leaves every other field as it was", async () => {
    const id = await item("Settings", 4, { notes: "Top shelf", category: "Office supplies" });
    const before = (await detailOf(id)).item;
    const saved = await as(one, `/api/staff/items/${id}/settings`, "PATCH", { status: "VERIFY", reorderThreshold: 6, stockArea: "Pantry", expiresOn: "2026-12-01", name: "Renamed", notes: "Changed", updatedAt: before.updatedAt });
    expect(saved.status).toBe(200);
    const result = await json(saved);
    expect(result.changed).toBe(4);
    const after = (await detailOf(id)).item;
    expect(after).toMatchObject({ status: "VERIFY", reorderThreshold: 6, stockArea: "Pantry", expiresOn: "2026-12-01", name: before.name, notes: "Top shelf", category: before.category, updatedAt: result.updatedAt });
    // The old version is now stale: another person's form is refused, not merged.
    expect((await as(one, `/api/staff/items/${id}/settings`, "PATCH", { status: "ACTIVE", reorderThreshold: 6, stockArea: "Pantry", expiresOn: null, updatedAt: before.updatedAt })).status).toBe(409);
    expect((await as(one, `/api/staff/items/${id}/settings`, "PATCH", { status: "ACTIVE", reorderThreshold: -1, stockArea: "Pantry", expiresOn: null, updatedAt: after.updatedAt })).status).toBe(400);
    expect((await as(one, `/api/staff/items/${id}/settings`, "PATCH", { status: "GONE", reorderThreshold: 1, stockArea: "Pantry", expiresOn: null, updatedAt: after.updatedAt })).status).toBe(400);
    expect((await as(one, `/api/staff/items/${id}/settings`, "PATCH", { status: "ACTIVE", reorderThreshold: 1, stockArea: "Pantry", expiresOn: "31/12/2026", updatedAt: after.updatedAt })).status).toBe(400);
    expect((await call(`/api/staff/items/${id}/settings`, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    const unchanged = await json(as(one, `/api/staff/items/${id}/settings`, "PATCH", { status: "VERIFY", reorderThreshold: 6, stockArea: "Pantry", expiresOn: "2026-12-01", updatedAt: after.updatedAt }));
    expect(unchanged.changed).toBe(0);
  });
});

describe("the restock entry on an item (§4.3)", () => {
  it("shows the open entry in the detail, and a Stock in that names it closes it with one movement", async () => {
    const id = await item("Restock", 0);
    expect((await detailOf(id)).reorder).toBeNull();
    const entry = await json<{ id: string }>(as(one, "/api/staff/reorders", "POST", { itemId: id }));
    expect((await detailOf(id)).reorder).toMatchObject({ id: entry.id, status: "NEEDS_RESTOCK" });
    expect((await move(id, { kind: "IN", quantity: 5, reason: "DELIVERY", reorderId: entry.id })).status).toBe(200);
    const after = await detailOf(id);
    expect(after.reorder).toBeNull();
    expect(after.item.onHand).toBe(5);
    expect(sqlite.prepare("SELECT status, (SELECT COUNT(*) FROM inventory_movements m WHERE m.id = r.movement_id) AS movements FROM reorders r WHERE r.id = ?").get(entry.id)).toEqual({ status: "RESTOCKED", movements: 1 });
    expect(after.events.filter((event: { action: string }) => event.action === "REORDER_RESTOCKED")).toHaveLength(1);
  });
});

describe("Pantry's use in the last 30 days (§4.3)", () => {
  it("sums posted Stock outs of Pantry items in the window, and the answer's validator turns with the hour", async () => {
    // Ten minutes into the next hour, so the session made just now is still current.
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 3_600_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(hour + 600_000);
    const rice = await item("Rice", 20, { stockArea: "Pantry" });
    const paper = await item("Paper", 20);
    expect((await move(rice, { kind: "OUT", quantity: 3, reason: "CONSUMED" })).status).toBe(200);
    expect((await move(rice, { kind: "OUT", quantity: 2, reason: "CONSUMED" })).status).toBe(200);
    expect((await move(rice, { kind: "IN", quantity: 4, reason: "DELIVERY" })).status).toBe(200);
    expect((await move(paper, { kind: "OUT", quantity: 1, reason: "CONSUMED" })).status).toBe(200);
    // Older than the window, and imported from the old sheet: neither counts.
    sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
      VALUES('MOV-OLD-USE', ?, 'STOCK_OUT', 'OUT', ?, 7, 'piece', -7, 'POSTED')`).run(new Date(hour - 30 * 86_400_000 - 1).toISOString(), rice);
    sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status, imported_from)
      VALUES('MOV-IMPORTED-USE', ?, 'STOCK_OUT', 'OUT', ?, 9, 'piece', -9, 'POSTED', 'sheet')`).run(new Date(hour - 86_400_000).toISOString(), rice);
    const first = await as(one, "/api/staff/stock");
    const stock = await json<{ used: Record<string, number> }>(first.clone());
    expect(stock.used[rice]).toBe(5);
    expect(stock.used[paper]).toBeUndefined();
    const etag = first.headers.get("etag")!;
    expect((await as(one, "/api/staff/stock", "GET", undefined, { "if-none-match": etag })).status).toBe(304);
    vi.setSystemTime(hour + 3_600_000);
    const next = await as(one, "/api/staff/stock", "GET", undefined, { "if-none-match": etag });
    expect(next.status).toBe(200);
    expect(next.headers.get("etag")).not.toBe(etag);
  });
});

describe("kit components (§4.3)", () => {
  it("name their one cause in the kit's detail", async () => {
    const thread = await item("Thread", 10);
    const glue = await item("Glue", 10);
    const kit = await json<{ id: string }>(as(one, "/api/staff/kits", "POST", { name: "Labelled kit", components: [{ itemId: thread, required: 1 }, { itemId: glue, required: 1 }] }));
    const glueNow = (await detailOf(glue)).item;
    expect((await as(one, `/api/staff/items/${glue}/settings`, "PATCH", { status: "INACTIVE", reorderThreshold: 0, stockArea: "Inventory", expiresOn: null, updatedAt: glueNow.updatedAt })).status).toBe(200);
    const parts = (await json<{ components: Array<{ itemId: string; state: string; label: string }> }>(as(one, `/api/staff/kits/${kit.id}`))).components;
    expect(parts.find((part) => part.itemId === thread)).toMatchObject({ state: "OK", label: "Ready" });
    expect(parts.find((part) => part.itemId === glue)).toMatchObject({ state: "REVIEW", label: "Inactive" });
  });
});
