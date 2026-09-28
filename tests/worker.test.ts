import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { migratedD1 } from "./d1-sqlite";

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
    expect(detail.item).toMatchObject({ onHand: 7, legacyReportedAvailable: 8, migrationDelta: -1 });
  });

  it("records stock in, guarded stock out, and count adjustments as appended movements", async () => {
    const cookie = await signIn();
    const move = (body: object) => staff(cookie, "/api/staff/items/ITM-0001/movements", "POST", body);
    expect(await (await move({ kind: "IN", quantity: 3, key: "stock-in-key-1" })).json()).toEqual({ onHand: 10 });
    expect(await (await move({ kind: "IN", quantity: 3, key: "stock-in-key-1" })).json()).toEqual({ onHand: 10 });
    expect((await move({ kind: "OUT", quantity: 11, key: "stock-out-key-1" })).status).toBe(409);
    expect(await (await move({ kind: "OUT", quantity: 4, key: "stock-out-key-2" })).json()).toEqual({ onHand: 6 });
    expect((await move({ kind: "COUNT", quantity: 5, key: "count-key-1" })).status).toBe(400);
    expect(await (await move({ kind: "COUNT", quantity: 5, key: "count-key-2", note: "Shelf count" })).json()).toEqual({ onHand: 5 });
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
    expect(await (await staff(cookie, "/api/staff/items/ITM-0001", "PATCH", { ...current, storageLocation: "Cabinet 2" })).json()).toEqual({ changed: 1 });
    expect(sqlite.prepare("SELECT action, entity_id, actor_user_id FROM audit_log").all()).toEqual([{ action: "ITEM_UPDATED", entity_id: "ITM-0001", actor_user_id: "ACC-1" }]);
  });
});

describe("routing", () => {
  it("does not route unknown or unsupported API calls into the static application", async () => {
    expect((await call("/api/no-request-workflow")).status).toBe(404);
    expect((await call("/api/public/catalog", { method: "POST" })).status).toBe(405);
  });
});
