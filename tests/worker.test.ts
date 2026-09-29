import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";
import { stockState } from "../src/catalog-policy";

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let photos: ReturnType<typeof memoryR2>["objects"];

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  const r2 = memoryR2();
  photos = r2.objects;
  env = { DB: database.d1, EVIDENCE: r2.bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
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

const loanable = { name: "Folding Table", category: "FURNITURE", itemType: "Loanable", unit: "piece", status: "ACTIVE", storageLocation: "Office shelf A", reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: null };

describe("public Lending Hub", () => {
  it("fails closed: migrated records awaiting review are never published", async () => {
    expect(await publicItems()).toEqual([]);
  });

  it("publishes only reviewed Loanable items, with a safe DTO", async () => {
    const cookie = await signIn();
    const created = await (await staff(cookie, "/api/staff/items", "POST", { ...loanable, openingQuantity: 4 })).json() as { id: string };
    await staff(cookie, "/api/staff/items", "POST", { ...loanable, name: "Unreviewed Speaker", needsReview: true, openingQuantity: 2 });
    const items = await publicItems();
    expect(items).toEqual([{ id: created.id, name: "Folding Table", category: "FURNITURE", unit: "piece", available: 4, audience: "STUDENTS_AND_USC_STAFF" }]);
  });

  it("answers 304 until an inventory write changes the revision", async () => {
    const first = await call("/api/public/catalog");
    const etag = first.headers.get("etag")!;
    expect((await call("/api/public/catalog", { headers: { "if-none-match": etag } })).status).toBe(304);
    const cookie = await signIn();
    await staff(cookie, "/api/staff/items/ITM-0005/movements", "POST", { kind: "IN", quantity: 1, reason: "DELIVERY", key: "revision-test-key" });
    const changed = await call("/api/public/catalog", { headers: { "if-none-match": etag } });
    expect(changed.status).toBe(200);
    await staff(cookie, "/api/staff/items/ITM-0005/movements", "POST", { kind: "IN", quantity: 1, reason: "DELIVERY", key: "revision-test-key" });
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
    await staff(cookie, "/api/staff/items/ITM-0001/movements", "POST", { kind: "IN", quantity: 5, reason: "DELIVERY", key: "evidence-stable-key" });
    await staff(cookie, "/api/staff/items/ITM-0002/movements", "POST", { kind: "IN", quantity: 5, reason: "DELIVERY", key: "evidence-other-key" });
    expect((await (await staff(cookie, "/api/staff/items/ITM-0001")).json() as { item: object }).item).toMatchObject({ onHand: 12, migrationDelta: -1 });
    expect((await (await staff(cookie, "/api/staff/items/ITM-0002")).json() as { item: object }).item).toMatchObject({ migrationDelta: 0 });
  });

  it("records stock in, guarded stock out, and count adjustments as appended movements", async () => {
    const cookie = await signIn();
    const move = (body: object) => staff(cookie, "/api/staff/items/ITM-0001/movements", "POST", body);
    expect(await (await move({ kind: "IN", quantity: 3, reason: "DELIVERY", key: "stock-in-key-1" })).json()).toMatchObject({ onHand: 10 });
    expect(await (await move({ kind: "IN", quantity: 3, reason: "DELIVERY", key: "stock-in-key-1" })).json()).toMatchObject({ onHand: 10 });
    expect((await move({ kind: "OUT", quantity: 11, reason: "ISSUED", key: "stock-out-key-1" })).status).toBe(409);
    expect(await (await move({ kind: "OUT", quantity: 4, reason: "ISSUED", key: "stock-out-key-2" })).json()).toMatchObject({ onHand: 6 });
    expect((await move({ kind: "COUNT", quantity: 5, expectedOnHand: 6, key: "count-key-1" })).status).toBe(400);
    expect(await (await move({ kind: "COUNT", quantity: 5, expectedOnHand: 6, key: "count-key-2", note: "Shelf count" })).json()).toMatchObject({ onHand: 5 });
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
    expect(sqlite.prepare("SELECT action, entity_id, actor_user_id FROM audit_log WHERE actor_user_id IS NOT NULL").all()).toEqual([{ action: "ITEM_UPDATED", entity_id: "ITM-0001", actor_user_id: "ACC-1" }]);
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
    expect(sqlite.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE actor_user_id IS NOT NULL").get()).toEqual({ total: 1 });
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
    expect(await (await move(cookie, "ITM-0005", { kind: "COUNT", quantity: start + 2, expectedOnHand: start + 2, note: "Shelf count" })).json()).toEqual({ onHand: start + 2, change: 0 });
    expect(await (await move(cookie, "ITM-0005", { kind: "COUNT", quantity: 1, expectedOnHand: start + 2, note: "Shelf count" })).json()).toEqual({ onHand: 1, change: 1 - (start + 2) });
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
    await move(cookie, "ITM-0001", { kind: "COUNT", quantity: 7, expectedOnHand: 7, note: "Physical count" });
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

describe("Part 4 — two item types, quantity edits and internal lending", () => {
  type Loan = { id: string; itemId: string; quantity: number; purpose: string; borrowerName: string; studentId: string | null; reason: string | null; returnBy: string | null; status: string; returnNote: string | null; createdBy: string | null; closedBy: string | null };
  type Overview = {
    open: Loan[]; closed: Loan[]; known: Array<{ name: string; studentId: string }>;
    borrowers: Array<{ period: string; purpose: string; name: string; studentId: string | null; loans: number; units: number; outNow: number; problems: number }>;
    items: Array<{ period: string; itemId: string; loans: number; units: number }>;
    totals: Array<{ period: string; purpose: string; loans: number; units: number; borrowers: number; problems: number }>;
  };
  // Bytes are what count: a JPEG starts FF D8 FF whatever the browser calls it.
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
  const onHand = (id: string) => (sqlite.prepare("SELECT on_hand AS onHand FROM inventory_balances WHERE id = ?").get(id) as { onHand: number }).onHand;
  const overview = async (cookie: string) => await (await staff(cookie, "/api/staff/loans")).json() as Overview;
  async function lendable(cookie: string, quantity = 5) {
    return (await (await staff(cookie, "/api/staff/items", "POST", { ...loanable, name: `Tripod ${crypto.randomUUID().slice(0, 6)}`, openingQuantity: quantity })).json() as { id: string }).id;
  }
  function lend(cookie: string, itemId: string, fields: Record<string, string>, photo: Uint8Array | null = JPEG) {
    const form = new FormData();
    for (const [key, value] of Object.entries({ purpose: "INDIVIDUAL", quantity: "1", key: crypto.randomUUID(), ...fields })) form.set(key, value);
    if (photo) form.set("photo", new File([photo as BlobPart], "borrower.jpg", { type: "text/plain" }));
    return call(`/api/staff/items/${itemId}/loans`, { method: "POST", headers: { origin, cookie }, body: form });
  }
  const close = (cookie: string, id: string, body: Record<string, unknown>) => staff(cookie, `/api/staff/loans/${id}/return`, "POST", body);

  it("reclassifies every Saleable record as Consumable, with the change in each item's history", async () => {
    expect(sqlite.prepare("SELECT COUNT(*) AS total FROM items WHERE item_type NOT IN ('Loanable', 'Consumable', 'NEEDS_REVIEW')").get()).toEqual({ total: 0 });
    const audited = sqlite.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'ITEM_UPDATED' AND actor_user_id IS NULL AND details_json LIKE '%Saleable%'").get() as { total: number };
    expect(audited.total).toBe(112);
    const cookie = await signIn();
    expect((await staff(cookie, "/api/staff/items", "POST", { ...loanable, itemType: "Saleable", lendingAudience: "NOT_AVAILABLE_FOR_LENDING" })).status).toBe(400);
  });

  it("reuses an existing spelling for a typed category or unit", async () => {
    const cookie = await signIn();
    const created = await (await staff(cookie, "/api/staff/items", "POST", { ...loanable, name: "Bench", category: "school supplies", unit: "PIECE" })).json() as { id: string };
    expect(sqlite.prepare("SELECT category, unit FROM items WHERE id = ?").get(created.id)).toEqual({ category: "SCHOOL SUPPLIES", unit: "piece" });
  });

  it("saves a quantity edit only against the figure the editor showed", async () => {
    const cookie = await signIn();
    const shown = onHand("ITM-0005");
    expect((await staff(cookie, "/api/staff/items/ITM-0005/movements", "POST", { kind: "IN", quantity: 2, expectedOnHand: shown, key: crypto.randomUUID() })).status).toBe(400);
    expect((await staff(cookie, "/api/staff/items/ITM-0005/movements", "POST", { kind: "COUNT", quantity: shown + 2, note: "Shelf count", key: crypto.randomUUID() })).status).toBe(400);
    const staleCount = await staff(cookie, "/api/staff/items/ITM-0005/movements", "POST", { kind: "COUNT", quantity: shown + 2, note: "Shelf count", expectedOnHand: shown + 1, key: crypto.randomUUID() });
    expect(staleCount.status).toBe(409);
    expect(onHand("ITM-0005")).toBe(shown);
    const stale = await staff(cookie, "/api/staff/items/ITM-0005/movements", "POST", { kind: "IN", quantity: 2, reason: "DELIVERY", expectedOnHand: shown + 1, key: crypto.randomUUID() });
    expect(stale.status).toBe(409);
    expect((await stale.json() as { error: string }).error).toMatch(/Someone else just changed this item/);
    expect(await (await staff(cookie, "/api/staff/items/ITM-0005/movements", "POST", { kind: "OUT", quantity: 1, reason: "CONSUMED", expectedOnHand: shown, key: crypto.randomUUID() })).json()).toEqual({ onHand: shown - 1, change: -1 });
  });

  it("accepts an optional return date and rejects one already past in Manila", async () => {
    const cookie = await signIn();
    const itemId = await lendable(cookie, 3);
    const future = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + 2 * 86_400_000));
    expect((await lend(cookie, itemId, { borrowerName: "No Due Date", studentId: "TEST-0001" })).status).toBe(201);
    expect((await lend(cookie, itemId, { borrowerName: "Due Later", studentId: "TEST-0002", returnBy: future })).status).toBe(201);
    expect((await lend(cookie, itemId, { borrowerName: "Past Due", studentId: "TEST-0003", returnBy: "2000-01-01" })).status).toBe(400);
    const loans = (await overview(cookie)).open.filter((loan) => loan.itemId === itemId);
    expect(loans.map((loan) => [loan.borrowerName, loan.returnBy])).toEqual([["No Due Date", null], ["Due Later", future]]);
    expect(onHand(itemId)).toBe(1);
    expect(photos.size).toBe(2);
  });

  it("lends for individual use with a student ID and photo, takes it off the shelf, and never double-lends a retry", async () => {
    const cookie = await signIn();
    const itemId = await lendable(cookie, 5);
    expect((await lend(cookie, itemId, { borrowerName: "Test Borrower" })).status).toBe(400);
    expect((await lend(cookie, itemId, { borrowerName: "Test Borrower", studentId: "TEST-0001" }, null)).status).toBe(400);
    expect((await lend(cookie, itemId, { borrowerName: "Test Borrower", studentId: "TEST-0001" }, new TextEncoder().encode("not an image"))).status).toBe(400);
    const request = { borrowerName: "Test Borrower", studentId: "test-0001", quantity: "2", key: "loan-retry-key-01" };
    const first = await lend(cookie, itemId, request);
    expect(first.status).toBe(201);
    const { id } = await first.json() as { id: string };
    expect(await (await lend(cookie, itemId, request)).json()).toEqual({ id, onHand: 3 });
    expect(onHand(itemId)).toBe(3);
    expect(sqlite.prepare("SELECT movement_type AS type, signed_quantity AS change, related_entity_id AS loan FROM inventory_movements WHERE item_id = ? AND movement_type = 'LOAN_OUT'").all(itemId)).toEqual([{ type: "LOAN_OUT", change: -2, loan: id }]);
    expect([...photos.keys()]).toEqual([`loans/${id}`]);
    expect(photos.get(`loans/${id}`)!.contentType).toBe("image/jpeg");
    const loan = (await overview(cookie)).open.find((entry) => entry.id === id)!;
    expect(loan).toMatchObject({ itemId, quantity: 2, purpose: "INDIVIDUAL", borrowerName: "Test Borrower", studentId: "TEST-0001", status: "OUT", createdBy: "Staff One" });
    const refused = await lend(cookie, itemId, { borrowerName: "Test Borrower", studentId: "TEST-0001", quantity: "4" });
    expect(refused.status).toBe(409);
    expect((await refused.json() as { error: string }).error).toBe("Only 3 on hand; cannot lend 4.");
    expect(photos.size).toBe(1);
  });

  it("lends for USC use with a reason, and lends only active Loanable items", async () => {
    const cookie = await signIn();
    const itemId = await lendable(cookie, 2);
    expect((await lend(cookie, itemId, { purpose: "USC", borrowerName: "Test Officer" })).status).toBe(400);
    expect((await lend(cookie, itemId, { purpose: "USC", borrowerName: "Test Officer", reason: "General assembly stage setup" })).status).toBe(201);
    const consumable = await (await staff(cookie, "/api/staff/items", "POST", { ...loanable, name: "Masking Tape", itemType: "Consumable", lendingAudience: "NOT_AVAILABLE_FOR_LENDING", openingQuantity: 5 })).json() as { id: string };
    const refused = await lend(cookie, consumable.id, { borrowerName: "Test Borrower", studentId: "TEST-0001" });
    expect(refused.status).toBe(400);
    expect(photos.size).toBe(1);
  });

  it("returns a loan to the shelf, keeps damaged and lost items off it, and closes each loan once", async () => {
    const cookie = await signIn();
    const itemId = await lendable(cookie, 3);
    const ids = [];
    for (const name of ["Test Borrower A", "Test Borrower B", "Test Borrower C"]) {
      ids.push((await (await lend(cookie, itemId, { borrowerName: name, studentId: `TEST-${ids.length}` })).json() as { id: string }).id);
    }
    expect(onHand(itemId)).toBe(0);
    expect((await close(cookie, ids[0]!, { outcome: "RETURNED" })).status).toBe(200);
    expect((await close(cookie, ids[0]!, { outcome: "RETURNED" })).status).toBe(200);
    expect(onHand(itemId)).toBe(1);
    expect((await close(cookie, ids[0]!, { outcome: "LOST", note: "Changed mind" })).status).toBe(409);
    expect((await close(cookie, ids[1]!, { outcome: "DAMAGED" })).status).toBe(400);
    expect((await close(cookie, ids[1]!, { outcome: "DAMAGED", note: "Cracked leg" })).status).toBe(200);
    expect((await close(cookie, ids[2]!, { outcome: "LOST", note: "Not returned after the event" })).status).toBe(200);
    expect(onHand(itemId)).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS total FROM inventory_movements WHERE item_id = ? AND movement_type = 'LOAN_RETURN'").get(itemId)).toEqual({ total: 1 });
    const { open, closed } = await overview(cookie);
    expect(open.filter((loan) => loan.itemId === itemId)).toEqual([]);
    expect(closed.filter((loan) => loan.itemId === itemId).map((loan) => [loan.status, loan.returnNote, loan.closedBy]).sort()).toEqual([
      ["DAMAGED", "Cracked leg", "Staff One"], ["LOST", "Not returned after the event", "Staff One"], ["RETURNED", null, "Staff One"]
    ]);
    const detail = await (await staff(cookie, `/api/staff/items/${itemId}`)).json() as { loans: Loan[]; movements: Array<{ movementType: string; borrower: string | null }>; events: Array<{ action: string }> };
    expect(detail.loans).toHaveLength(3);
    expect(detail.movements.filter((movement) => movement.movementType.startsWith("LOAN")).map((movement) => movement.borrower)).toEqual(["Test Borrower A", "Test Borrower C", "Test Borrower B", "Test Borrower A"]);
    expect(detail.events.filter((event) => event.action.startsWith("LOAN")).map((event) => event.action)).toEqual(["LOAN_CLOSED", "LOAN_CLOSED", "LOAN_CLOSED", "LOAN_CREATED", "LOAN_CREATED", "LOAN_CREATED"]);
  });

  it("ranks borrowers separately for individual and USC use, per period", async () => {
    const cookie = await signIn();
    const itemId = await lendable(cookie, 20);
    for (let index = 0; index < 3; index += 1) await lend(cookie, itemId, { borrowerName: "Test Frequent", studentId: "TEST-0100" });
    await lend(cookie, itemId, { borrowerName: "Test Once", studentId: "TEST-0200", quantity: "4" });
    for (let index = 0; index < 2; index += 1) await lend(cookie, itemId, { purpose: "USC", borrowerName: "Test Officer", reason: "Event setup" });
    const { borrowers, totals, items, known } = await overview(cookie);
    const ranked = (period: string, purpose: string) => borrowers.filter((row) => row.period === period && row.purpose === purpose).map((row) => [row.name, row.loans, row.units]);
    expect(ranked("30d", "INDIVIDUAL")).toEqual([["Test Frequent", 3, 3], ["Test Once", 1, 4]]);
    expect(ranked("all", "USC")).toEqual([["Test Officer", 2, 2]]);
    expect(totals.filter((row) => row.period === "30d").map((row) => [row.purpose, row.loans, row.units, row.borrowers]).sort()).toEqual([["INDIVIDUAL", 4, 7, 2], ["USC", 2, 2, 1]]);
    expect(items.find((row) => row.period === "all" && row.itemId === itemId)).toMatchObject({ loans: 6, units: 9 });
    expect(known.map((row) => row.studentId).sort()).toEqual(["TEST-0100", "TEST-0200"]);
  });

  it("keeps loans and photos staff-only, same-origin and revisioned", async () => {
    const cookie = await signIn();
    const itemId = await lendable(cookie, 2);
    const { id } = await (await lend(cookie, itemId, { borrowerName: "Test Borrower", studentId: "TEST-0001" })).json() as { id: string };
    for (const path of ["/api/staff/loans", `/api/staff/loans/${id}/photo`]) expect((await call(path)).status).toBe(401);
    const photo = await call(`/api/staff/loans/${id}/photo`, { headers: { cookie } });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(photo.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);
    expect((await call("/api/staff/loans/LN-missing/photo", { headers: { cookie } })).status).toBe(404);
    const form = new FormData();
    form.set("purpose", "INDIVIDUAL");
    const crossSite = await call(`/api/staff/items/${itemId}/loans`, { method: "POST", headers: { origin: "https://evil.example", cookie }, body: form });
    expect(crossSite.status).toBe(403);
    const etag = (await staff(cookie, "/api/staff/loans")).headers.get("etag")!;
    expect((await call("/api/staff/loans", { headers: { cookie, "if-none-match": etag } })).status).toBe(304);
    await close(cookie, id, { outcome: "RETURNED" });
    expect((await call("/api/staff/loans", { headers: { cookie, "if-none-match": etag } })).status).toBe(200);
  });
});
