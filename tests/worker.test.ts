import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { migratedD1 } from "./d1-sqlite";
import { stockState } from "../src/catalog-policy";

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(await hashPassword("correct horse battery"));
});

function call(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`${origin}${path}`, init), env);
}

async function signIn(): Promise<string> {
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "staff.one", password: "correct horse battery" }) });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}

function staff(cookie: string, path: string, method = "GET", body?: unknown) {
  return call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function publicItems() {
  return (await (await call("/api/public/catalog")).json() as { items: Array<Record<string, unknown>> }).items;
}

const loanable = { name: "Folding Table", category: "FURNITURE", itemType: "Loanable", unit: "piece", status: "ACTIVE", storageLocation: "Office shelf A", reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", defaultLoanDays: 3, maximumLoanQty: 2, needsReview: false, notes: null };

describe("public Lending Hub", () => {
  it("fails closed: migrated records awaiting review are never published", async () => {
    expect(await publicItems()).toEqual([]);
  });

  it("publishes only reviewed Loanable items, with a safe DTO", async () => {
    const cookie = await signIn();
    const created = await (await staff(cookie, "/api/staff/items", "POST", { ...loanable, openingQuantity: 4 })).json() as { id: string };
    await staff(cookie, "/api/staff/items", "POST", { ...loanable, name: "Unreviewed Speaker", needsReview: true, openingQuantity: 2 });
    const items = await publicItems();
    expect(items).toEqual([{ id: created.id, name: "Folding Table", category: "FURNITURE", unit: "piece", available: 4, audience: "STUDENTS_AND_USC_STAFF", maxPerLoan: 2, loanDays: 3 }]);
  });

  it("answers 304 until an inventory write changes the revision", async () => {
    const first = await call("/api/public/catalog");
    const etag = first.headers.get("etag")!;
    expect((await call("/api/public/catalog", { headers: { "if-none-match": etag } })).status).toBe(304);
    const cookie = await signIn();
    await staff(cookie, "/api/staff/items/ITM-0005/movements", "POST", { kind: "IN", quantity: 1, key: "revision-test-key" });
    const changed = await call("/api/public/catalog", { headers: { "if-none-match": etag } });
    expect(changed.status).toBe(200);
    await staff(cookie, "/api/staff/items/ITM-0005/movements", "POST", { kind: "IN", quantity: 1, key: "revision-test-key" });
    expect((await call("/api/public/catalog", { headers: { "if-none-match": changed.headers.get("etag")! } })).status).toBe(304);
  });
});

describe("staff boundary", () => {
  it("rejects every staff API and page without a session", async () => {
    const before = sqlite.prepare("SELECT COUNT(*) AS total FROM inventory_movements").get();
    for (const [path, method] of [["/api/staff/session", "GET"], ["/api/staff/inventory", "GET"], ["/api/staff/items/ITM-0001", "GET"], ["/api/staff/items/ITM-0001", "PATCH"], ["/api/staff/items/ITM-0001/movements", "POST"], ["/api/staff/items", "POST"]]) {
      const response = await call(path, { method, headers: { origin, "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify({ kind: "IN", quantity: 50, key: "attack-key-000" }) });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(sqlite.prepare("SELECT COUNT(*) AS total FROM inventory_movements").get()).toEqual(before);
    const page = await call("/staff/inventory");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe(`${origin}/staff`);
  });

  it("rejects cross-origin mutations even with a valid session cookie", async () => {
    const cookie = await signIn();
    const response = await call("/api/staff/items/ITM-0001/movements", { method: "POST", headers: { origin: "https://evil.example", cookie, "content-type": "application/json" }, body: JSON.stringify({ kind: "IN", quantity: 5, key: "cross-origin-key" }) });
    expect(response.status).toBe(403);
  });

  it("rejects wrong credentials, then signs in and revokes on logout", async () => {
    const wrong = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "staff.one", password: "wrong password here" }) });
    expect(wrong.status).toBe(401);
    const cookie = await signIn();
    expect(await (await staff(cookie, "/api/staff/session")).json()).toMatchObject({ authenticated: true, displayName: "Staff One" });
    expect((await staff(cookie, "/api/staff/logout", "POST")).status).toBe(200);
    expect((await staff(cookie, "/api/staff/session")).status).toBe(401);
  });

  it("sends a signed-in visit to the login page straight to the workspace", async () => {
    const cookie = await signIn();
    const response = await call("/staff", { headers: { cookie } });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${origin}/staff/inventory`);
    expect((await call("/staff")).status).toBe(200);
  });

  it("ends sessions for disabled accounts", async () => {
    const cookie = await signIn();
    sqlite.exec("UPDATE staff_accounts SET active = 0");
    expect((await staff(cookie, "/api/staff/inventory")).status).toBe(401);
  });
});

describe("movement-derived inventory", () => {
  it("preserves the ITM-0001 reconciliation discrepancy", async () => {
    const cookie = await signIn();
    const detail = await (await staff(cookie, "/api/staff/items/ITM-0001")).json() as { item: Record<string, unknown> };
    expect(detail.item).toMatchObject({ onHand: 7, legacyReportedAvailable: 8, migratedOnHand: 7, migrationDelta: -1 });
    // Later staff movements change on-hand but never the migration evidence.
    await staff(cookie, "/api/staff/items/ITM-0001/movements", "POST", { kind: "IN", quantity: 5, key: "evidence-stable-key" });
    await staff(cookie, "/api/staff/items/ITM-0002/movements", "POST", { kind: "IN", quantity: 5, key: "evidence-other-key" });
    expect((await (await staff(cookie, "/api/staff/items/ITM-0001")).json() as { item: object }).item).toMatchObject({ onHand: 12, migrationDelta: -1 });
    expect((await (await staff(cookie, "/api/staff/items/ITM-0002")).json() as { item: object }).item).toMatchObject({ migrationDelta: 0 });
  });

  it("records stock in, guarded stock out, and count adjustments as appended movements", async () => {
    const cookie = await signIn();
    const move = (body: object) => staff(cookie, "/api/staff/items/ITM-0001/movements", "POST", body);
    expect(await (await move({ kind: "IN", quantity: 3, key: "stock-in-key-1" })).json()).toMatchObject({ onHand: 10 });
    expect(await (await move({ kind: "IN", quantity: 3, key: "stock-in-key-1" })).json()).toMatchObject({ onHand: 10 });
    expect((await move({ kind: "OUT", quantity: 11, key: "stock-out-key-1" })).status).toBe(409);
    expect(await (await move({ kind: "OUT", quantity: 4, key: "stock-out-key-2" })).json()).toMatchObject({ onHand: 6 });
    expect((await move({ kind: "COUNT", quantity: 5, key: "count-key-1" })).status).toBe(400);
    expect(await (await move({ kind: "COUNT", quantity: 5, key: "count-key-2", note: "Shelf count" })).json()).toMatchObject({ onHand: 5 });
    const rows = sqlite.prepare("SELECT movement_type, signed_quantity, actor_user_id FROM inventory_movements WHERE item_id = 'ITM-0001' ORDER BY rowid").all();
    expect(rows.slice(2)).toEqual([
      { movement_type: "STOCK_IN", signed_quantity: 3, actor_user_id: "ACC-1" },
      { movement_type: "STOCK_OUT", signed_quantity: -4, actor_user_id: "ACC-1" },
      { movement_type: "COUNT_ADJUSTMENT", signed_quantity: -1, actor_user_id: "ACC-1" }
    ]);
    expect(() => sqlite.exec("UPDATE inventory_movements SET signed_quantity = 100")).toThrow(/append-only/);
    expect(() => sqlite.exec("DELETE FROM inventory_movements")).toThrow(/append-only/);
  });

  it("validates metadata edits and audits the change", async () => {
    const cookie = await signIn();
    const current = (await (await staff(cookie, "/api/staff/items/ITM-0001")).json() as { item: typeof loanable }).item;
    expect((await staff(cookie, "/api/staff/items/ITM-0001", "PATCH", { ...current, lendingAudience: "USC_STAFF_ONLY" })).status).toBe(400);
    expect(await (await staff(cookie, "/api/staff/items/ITM-0001", "PATCH", { ...current, storageLocation: "Cabinet 2" })).json()).toMatchObject({ changed: 1 });
    expect(sqlite.prepare("SELECT action, entity_id, actor_user_id FROM audit_log").all()).toEqual([{ action: "ITEM_UPDATED", entity_id: "ITM-0001", actor_user_id: "ACC-1" }]);
  });
});

describe("catalog management", () => {
  type Detail = { item: Record<string, unknown> & { updatedAt: string | null }; events: Array<{ action: string; actor: string; details: Record<string, unknown> }> };
  const detail = async (cookie: string, id: string) => await (await staff(cookie, `/api/staff/items/${id}`)).json() as Detail;

  it("refuses a stale edit instead of silently overwriting another change", async () => {
    const cookie = await signIn();
    const loaded = (await detail(cookie, "ITM-0003")).item;
    expect((await staff(cookie, "/api/staff/items/ITM-0003", "PATCH", { ...loaded, storageLocation: "Cabinet 1" })).status).toBe(200);
    const stale = await staff(cookie, "/api/staff/items/ITM-0003", "PATCH", { ...loaded, notes: "Written from an old form" });
    expect(stale.status).toBe(409);
    expect((await staff(cookie, "/api/staff/items/ITM-0003", "PATCH", { ...loaded, updatedAt: undefined })).status).toBe(400);
    expect((await detail(cookie, "ITM-0003")).item).toMatchObject({ storageLocation: "Cabinet 1", notes: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS total FROM audit_log").get()).toEqual({ total: 1 });
  });

  it("normalizes aliases and reuses existing category and location spellings", async () => {
    const cookie = await signIn();
    const first = (await detail(cookie, "ITM-0004")).item;
    await staff(cookie, "/api/staff/items/ITM-0004", "PATCH", { ...first, storageLocation: "Supply  Room  B" });
    const created = await (await staff(cookie, "/api/staff/items", "POST", { ...loanable, name: "Wireless Mic", aliases: "mic, Microphone ; MIC, wireless mic", category: "school   supplies", storageLocation: "supply room b" })).json() as { id: string };
    expect((await detail(cookie, created.id)).item).toMatchObject({ aliases: "mic, Microphone", category: "SCHOOL SUPPLIES", storageLocation: "Supply Room B" });
    const inventory = await (await staff(cookie, "/api/staff/inventory")).json() as { locations: string[]; categories: string[] };
    expect(inventory.locations).toEqual(["Supply Room B"]);
    expect(inventory.categories.filter((value) => value.toLowerCase() === "school supplies")).toEqual(["SCHOOL SUPPLIES"]);
  });

  it("explains every listing gap and records review, lending and deactivation in history", async () => {
    const cookie = await signIn();
    const before = (await detail(cookie, "ITM-0005")).item;
    expect(before.listed).toBe(false);
    expect(before.listingGaps).toEqual(expect.arrayContaining(["Choose who may borrow it", "Mark the details reviewed"]));
    const reviewed = { ...before, itemType: "Loanable", lendingAudience: "USC_STAFF_ONLY", needsReview: false };
    await staff(cookie, "/api/staff/items/ITM-0005", "PATCH", reviewed);
    const listed = (await detail(cookie, "ITM-0005")).item;
    expect(listed).toMatchObject({ listed: true, listingGaps: [] });
    await staff(cookie, "/api/staff/items/ITM-0005", "PATCH", { ...listed, status: "INACTIVE" });
    const after = await detail(cookie, "ITM-0005");
    expect(after.item).toMatchObject({ listed: false, listingGaps: ["Set the status to Active"] });
    expect(after.events.map((event) => [event.action, event.actor, Object.keys(event.details).sort()])).toEqual([
      ["ITEM_UPDATED", "Staff One", ["status"]],
      ["ITEM_UPDATED", "Staff One", expect.arrayContaining(["lendingAudience", "needsReview"])]
    ]);
    expect(sqlite.prepare("SELECT COUNT(*) AS total FROM items WHERE id = 'ITM-0005'").get()).toEqual({ total: 1 });
  });

  it("lets every staff role manage the catalog but keeps administration server-gated", async () => {
    const cookie = await signIn();
    expect((await staff(cookie, "/api/staff/admin/accounts")).status).toBe(403);
    expect((await staff(cookie, "/api/staff/items", "POST", { ...loanable, openingQuantity: 1 })).status).toBe(201);
  });
});

describe("routing", () => {
  it("does not route unknown or unsupported API calls into the static application", async () => {
    expect((await call("/api/no-request-workflow")).status).toBe(404);
    expect((await call("/api/public/catalog", { method: "POST" })).status).toBe(405);
  });
});

describe("Part 3 — stock and pantry", () => {
  type StockItem = { id: string; onHand: number; reorderThreshold: number; status: string; stockArea: string | null; expiresOn: string | null; countNeeded: boolean; lastCountedAt: string | null; reorderStatus: string | null };
  type Reorder = { id: string; itemId: string; status: string; desiredQuantity: number | null; updatedAt: string; note: string | null };
  type Activity = { itemId: string; movementType: string; change: number; afterQuantity: number; reason: string | null; notes: string | null; actor: string | null };
  type Stock = { items: StockItem[]; reorders: Reorder[]; activity: Activity[] };
  const stock = async (cookie: string) => await (await staff(cookie, "/api/staff/stock")).json() as Stock;
  const move = (cookie: string, id: string, body: Record<string, unknown>) => staff(cookie, `/api/staff/items/${id}/movements`, "POST", { key: crypto.randomUUID(), ...body });

  it("records stock in, stock out and counts with reasons, and reports before and after", async () => {
    const cookie = await signIn();
    const start = (await stock(cookie)).items.find((item) => item.id === "ITM-0005")!.onHand;
    expect(await (await move(cookie, "ITM-0005", { kind: "IN", quantity: 4, reason: "DELIVERY", note: "Supplier drop-off" })).json()).toEqual({ onHand: start + 4, change: 4 });
    expect((await move(cookie, "ITM-0005", { kind: "OUT", quantity: 2, reason: "OTHER" })).status).toBe(400);
    expect((await move(cookie, "ITM-0005", { kind: "OUT", quantity: 2, reason: "SOLD" })).status).toBe(400);
    expect(await (await move(cookie, "ITM-0005", { kind: "OUT", quantity: 2, reason: "DAMAGED" })).json()).toEqual({ onHand: start + 2, change: -2 });
    // A count that matches is recorded as an observation (a 0 adjustment), not refused.
    expect(await (await move(cookie, "ITM-0005", { kind: "COUNT", quantity: start + 2, note: "Shelf count" })).json()).toEqual({ onHand: start + 2, change: 0 });
    expect(await (await move(cookie, "ITM-0005", { kind: "COUNT", quantity: 1, note: "Shelf count" })).json()).toEqual({ onHand: 1, change: 1 - (start + 2) });
    const { activity } = await stock(cookie);
    expect(activity.slice(0, 4).map((entry) => [entry.movementType, entry.change, entry.afterQuantity, entry.reason, entry.actor])).toEqual([
      ["COUNT_ADJUSTMENT", 1 - (start + 2), 1, null, "Staff One"],
      ["COUNT_ADJUSTMENT", 0, start + 2, null, "Staff One"],
      ["STOCK_OUT", -2, start + 2, "DAMAGED", "Staff One"],
      ["STOCK_IN", 4, start + 4, "DELIVERY", "Staff One"]
    ]);
    // Migrated opening balances are not staff activity.
    expect(activity.every((entry) => entry.actor === "Staff One")).toBe(true);
    expect(() => sqlite.exec("UPDATE inventory_movements SET reason = 'OTHER'")).toThrow(/append-only/);
  });

  it("never lets stock go negative and counts a retried request once", async () => {
    const cookie = await signIn();
    const onHand = (await stock(cookie)).items.find((item) => item.id === "ITM-0003")!.onHand;
    const refused = await move(cookie, "ITM-0003", { kind: "OUT", quantity: onHand + 1, reason: "ISSUED" });
    expect(refused.status).toBe(409);
    expect((await refused.json() as { error: string }).error).toBe(`Only ${onHand} on hand; cannot remove ${onHand + 1}.`);
    const body = { kind: "IN", quantity: 2, reason: "RETURNED", key: "retry-stock-key-01" };
    await staff(cookie, "/api/staff/items/ITM-0003/movements", "POST", body);
    expect(await (await staff(cookie, "/api/staff/items/ITM-0003/movements", "POST", body)).json()).toEqual({ onHand: onHand + 2, change: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS total FROM inventory_movements WHERE idempotency_key = 'retry-stock-key-01'").get()).toEqual({ total: 1 });
    expect((await staff(cookie, "/api/staff/items/ITM-0004/movements", "POST", body)).status).toBe(409);
  });

  it("calls an item low only against its reorder level, and asks for counts where the legacy quantity is doubtful", async () => {
    const cookie = await signIn();
    const find = async (id: string) => (await stock(cookie)).items.find((item) => item.id === id)!;
    expect(stockState(await find("ITM-0003"))).toBe("OK");
    const detail = (await (await staff(cookie, "/api/staff/items/ITM-0003")).json() as { item: Record<string, unknown> }).item;
    await staff(cookie, "/api/staff/items/ITM-0003", "PATCH", { ...detail, reorderThreshold: 50 });
    expect(stockState(await find("ITM-0003"))).toBe("LOW");
    expect(await find("ITM-0001")).toMatchObject({ countNeeded: true, lastCountedAt: null });
    await move(cookie, "ITM-0001", { kind: "COUNT", quantity: 7, note: "Physical count" });
    expect(await find("ITM-0001")).toMatchObject({ countNeeded: false, onHand: 7 });
    // The count confirms the shelf; the migration evidence itself is never rewritten.
    expect((await (await staff(cookie, "/api/staff/items/ITM-0001")).json() as { item: object }).item).toMatchObject({ migrationDelta: -1 });
  });

  it("runs the restock list: one open entry, plan, receive through a Stock in, dismiss", async () => {
    const cookie = await signIn();
    const opened = await staff(cookie, "/api/staff/reorders", "POST", { itemId: "ITM-0004", desiredQuantity: 10, note: "For the general assembly" });
    expect(opened.status).toBe(201);
    const { id } = await opened.json() as { id: string };
    expect((await staff(cookie, "/api/staff/reorders", "POST", { itemId: "ITM-0004" })).status).toBe(409);
    let entry = (await stock(cookie)).reorders.find((row) => row.id === id)!;
    expect(entry).toMatchObject({ status: "NEEDS_RESTOCK", desiredQuantity: 10 });
    expect((await stock(cookie)).items.find((item) => item.id === "ITM-0004")!.reorderStatus).toBe("NEEDS_RESTOCK");
    expect((await staff(cookie, `/api/staff/reorders/${id}`, "PATCH", { status: "PLANNED", updatedAt: "stale" })).status).toBe(409);
    expect((await staff(cookie, `/api/staff/reorders/${id}`, "PATCH", { status: "RESTOCKED", updatedAt: entry.updatedAt })).status).toBe(400);
    expect(await (await staff(cookie, `/api/staff/reorders/${id}`, "PATCH", { status: "PLANNED", updatedAt: entry.updatedAt })).json()).toEqual({ changed: 1 });
    expect((await move(cookie, "ITM-0004", { kind: "OUT", quantity: 1, reason: "ISSUED", reorderId: id })).status).toBe(400);
    const receive = { kind: "IN", quantity: 10, reason: "DELIVERY", reorderId: id, key: "receive-restock-01" };
    const before = (await stock(cookie)).items.find((item) => item.id === "ITM-0004")!.onHand;
    expect(await (await staff(cookie, "/api/staff/items/ITM-0004/movements", "POST", receive)).json()).toEqual({ onHand: before + 10, change: 10 });
    expect(await (await staff(cookie, "/api/staff/items/ITM-0004/movements", "POST", receive)).json()).toEqual({ onHand: before + 10, change: 10 });
    entry = (await stock(cookie)).reorders.find((row) => row.id === id)!;
    expect(entry.status).toBe("RESTOCKED");
    expect(sqlite.prepare("SELECT COUNT(*) AS total FROM reorders r JOIN inventory_movements m ON m.id = r.movement_id WHERE r.id = ?").get(id)).toEqual({ total: 1 });
    expect((await staff(cookie, `/api/staff/reorders/${id}`, "PATCH", { status: "PLANNED", updatedAt: entry.updatedAt })).status).toBe(409);
    expect((await move(cookie, "ITM-0004", { kind: "IN", quantity: 1, reason: "DELIVERY", reorderId: id })).status).toBe(409);

    const second = await (await staff(cookie, "/api/staff/reorders", "POST", { itemId: "ITM-0004" })).json() as { id: string };
    const fresh = (await stock(cookie)).reorders.find((row) => row.id === second.id)!;
    await staff(cookie, `/api/staff/reorders/${second.id}`, "PATCH", { status: "DISMISSED", note: "Enough on hand", updatedAt: fresh.updatedAt });
    expect((await stock(cookie)).reorders.find((row) => row.id === second.id)).toMatchObject({ status: "DISMISSED", note: "Enough on hand" });
    const history = (await (await staff(cookie, "/api/staff/items/ITM-0004")).json() as { events: Array<{ action: string }> }).events.map((event) => event.action);
    expect(history).toEqual(["REORDER_UPDATED", "REORDER_OPENED", "REORDER_RESTOCKED", "REORDER_UPDATED", "REORDER_OPENED"]);
    expect((await staff(cookie, "/api/staff/reorders", "POST", { itemId: "ITM-9999" })).status).toBe(404);
  });

  it("treats pantry as the catalog's stock area and keeps expiry optional and valid", async () => {
    const cookie = await signIn();
    expect((await stock(cookie)).items.filter((item) => item.stockArea === "Pantry")).toHaveLength(10);
    const detail = (await (await staff(cookie, "/api/staff/items/ITM-0041")).json() as { item: Record<string, unknown> }).item;
    expect((await staff(cookie, "/api/staff/items/ITM-0041", "PATCH", { ...detail, expiresOn: "2026-02-30" })).status).toBe(400);
    expect((await staff(cookie, "/api/staff/items/ITM-0041", "PATCH", { ...detail, expiresOn: "2026-10-15" })).status).toBe(200);
    expect((await stock(cookie)).items.find((item) => item.id === "ITM-0041")).toMatchObject({ stockArea: "Pantry", expiresOn: "2026-10-15" });
    const created = await (await staff(cookie, "/api/staff/items", "POST", { ...loanable, name: "Paper Plates", itemType: "Consumable", lendingAudience: "NOT_AVAILABLE_FOR_LENDING", openingQuantity: 3 })).json() as { id: string };
    expect((await stock(cookie)).items.find((item) => item.id === created.id)).toMatchObject({ stockArea: "Inventory", expiresOn: null });
  });

  it("serves the stock workspace as one revisioned, staff-only payload", async () => {
    expect((await call("/api/staff/stock")).status).toBe(401);
    expect((await call("/api/staff/reorders", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    const cookie = await signIn();
    const first = await staff(cookie, "/api/staff/stock");
    const etag = first.headers.get("etag")!;
    expect((await call("/api/staff/stock", { headers: { cookie, "if-none-match": etag } })).status).toBe(304);
    const crossSite = await call("/api/staff/reorders", { method: "POST", headers: { origin: "https://evil.example", cookie, "content-type": "application/json" }, body: JSON.stringify({ itemId: "ITM-0005" }) });
    expect(crossSite.status).toBe(403);
    await staff(cookie, "/api/staff/reorders", "POST", { itemId: "ITM-0005" });
    expect((await call("/api/staff/stock", { headers: { cookie, "if-none-match": etag } })).status).toBe(200);
  });
});
