import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/* Open-unit tracking (Part 5B, A12): every invariant in plan section 4.7, through the Worker. */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let cookie: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const staff = (path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(await hashPassword("correct horse battery"));
  const login = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "staff.one", password: "correct horse battery" }) });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

const base = { category: "SUPPLIES", status: "ACTIVE", storageLocation: "Shelf B", reorderThreshold: 0, needsReview: false, notes: null, lendingAudience: "NOT_AVAILABLE_FOR_LENDING" };
async function paper(onHandQuantity = 8, consumptionMode = "OPEN_UNIT"): Promise<string> {
  const response = await staff("/api/staff/items", "POST", { ...base, name: "A4 Bond Paper", unit: "ream", itemType: "Consumable", consumptionMode, openingQuantity: onHandQuantity });
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}
const onHand = (id: string) => (sqlite.prepare("SELECT on_hand AS onHand FROM inventory_balances WHERE id = ?").get(id) as { onHand: number }).onHand;
const openCount = (id: string) => (sqlite.prepare("SELECT COUNT(*) AS n FROM open_units WHERE item_id = ? AND closed_at IS NULL").get(id) as { n: number }).n;
const movements = (id: string) => (sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE item_id = ?").get(id) as { n: number }).n;
const unitAction = (id: string, body: Record<string, unknown>) => staff(`/api/staff/items/${id}/open-units`, "POST", body);
async function open(id: string, key: string = crypto.randomUUID()): Promise<string> {
  const response = await unitAction(id, { action: "open", key });
  expect(response.status).toBe(200);
  const { openUnits } = await response.json() as { openUnits: Array<{ id: string }> };
  return openUnits.at(-1)!.id;
}
const detail = async (id: string) => await (await staff(`/api/staff/items/${id}`)).json() as { item: Record<string, unknown>; openUnits: Array<Record<string, unknown>>; usesRecorded: number; unitsEmptied: number };
const edit = async (id: string, changes: Record<string, unknown>) => {
  const { item } = await detail(id);
  return staff(`/api/staff/items/${id}`, "PATCH", { ...base, name: item.name, unit: item.unit, itemType: item.itemType, consumptionMode: item.consumptionMode, updatedAt: item.updatedAt, ...changes });
};
const movement = (id: string, body: Record<string, unknown>) => staff(`/api/staff/items/${id}/movements`, "POST", { key: crypto.randomUUID(), ...body });
/** Runs `other` just before the next database batch, as if it happened at the same moment. */
function meanwhile(other: () => Promise<unknown>) {
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = (async (statements: D1PreparedStatement[]) => {
    env.DB.batch = batch;
    await other();
    return batch(statements);
  }) as D1Database["batch"];
}

describe("consumption mode", () => {
  it("defaults every item, old and new, to Whole unit and stores Open only for a Consumable", async () => {
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM items WHERE consumption_mode <> 'WHOLE_UNIT'").get()).toEqual({ n: 0 });
    const whole = await paper(3, "WHOLE_UNIT");
    expect((await detail(whole)).item.consumptionMode).toBe("WHOLE_UNIT");
    expect((await edit(whole, { consumptionMode: "OPEN_UNIT" })).status).toBe(200);
    expect((await detail(whole)).item.consumptionMode).toBe("OPEN_UNIT");
    const loanable = await staff("/api/staff/items", "POST", { ...base, name: "Stapler", unit: "piece", itemType: "Loanable", consumptionMode: "OPEN_UNIT", openingQuantity: 1 });
    const { id } = await loanable.json() as { id: string };
    expect((await detail(id)).item.consumptionMode).toBe("WHOLE_UNIT");
    expect((await edit(whole, { consumptionMode: "SOMETIMES" })).status).toBe(400);
  });

  it("refuses to open a unit of a whole-unit or inactive item", async () => {
    const whole = await paper(3, "WHOLE_UNIT");
    expect((await unitAction(whole, { action: "open", key: crypto.randomUUID() })).status).toBe(409);
    expect(openCount(whole)).toBe(0);
  });
});

describe("open, use, condition", () => {
  it("never change stock, are attributable, and survive retries and double taps", async () => {
    const id = await paper(8);
    const key = crypto.randomUUID();
    const unit = await open(id, key);
    await open(id, key);
    expect(openCount(id)).toBe(1);
    const useKey = crypto.randomUUID();
    for (let tap = 0; tap < 2; tap += 1) expect((await unitAction(id, { action: "use", unitId: unit, key: useKey })).status).toBe(200);
    expect((await unitAction(id, { action: "condition", unitId: unit, condition: "LOW" })).status).toBe(200);
    expect((await unitAction(id, { action: "condition", unitId: unit, condition: "LOW" })).status).toBe(200);
    expect((await unitAction(id, { action: "condition", unitId: unit, condition: "QUARTER" })).status).toBe(400);
    expect(onHand(id)).toBe(8);
    expect(movements(id)).toBe(1);
    const audit = sqlite.prepare("SELECT action, actor_user_id AS actor FROM audit_log WHERE entity_id = ? AND action LIKE 'UNIT_%' ORDER BY rowid").all(id);
    expect(audit).toEqual([{ action: "UNIT_OPENED", actor: "ACC-1" }, { action: "UNIT_USED", actor: "ACC-1" }, { action: "UNIT_CONDITION", actor: "ACC-1" }]);
    const shown = await detail(id);
    expect(shown.openUnits).toEqual([expect.objectContaining({ id: unit, openedBy: "Staff One", condition: "LOW" })]);
    expect(shown.usesRecorded).toBe(1);
    expect(shown.unitsEmptied).toBe(0);
  });

  it("allows another open unit (noting the one already open) but never more than on hand", async () => {
    const id = await paper(2);
    await open(id);
    await open(id);
    const third = await unitAction(id, { action: "open", key: crypto.randomUUID() });
    expect(third.status).toBe(409);
    expect((await third.json() as { error: string }).error).toBe("All 2 on hand are already open.");
    expect(openCount(id)).toBe(2);
    expect(sqlite.prepare("SELECT json_extract(details_json, '$.alreadyOpen') AS n FROM audit_log WHERE action = 'UNIT_OPENED' ORDER BY rowid").all()).toEqual([{ n: 0 }, { n: 1 }]);
  });

  it("lets the database refuse an open that a concurrent stock-out made impossible", async () => {
    const id = await paper(1);
    meanwhile(() => movement(id, { kind: "OUT", quantity: 1, reason: "CONSUMED" }));
    expect((await unitAction(id, { action: "open", key: crypto.randomUUID() })).status).toBe(409);
    expect(openCount(id)).toBe(0);
  });
});

describe("mark empty", () => {
  it("deducts exactly one through the movement ledger, once, however often it is sent", async () => {
    const id = await paper(8);
    const unit = await open(id);
    const first = await unitAction(id, { action: "empty", unitId: unit });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ onHand: 7, openUnits: [] });
    expect((await unitAction(id, { action: "empty", unitId: unit })).status).toBe(200);
    expect(onHand(id)).toBe(7);
    expect(sqlite.prepare("SELECT movement_type AS type, signed_quantity AS change, related_entity_type AS related, actor_user_id AS actor FROM inventory_movements WHERE item_id = ? AND related_entity_type = 'OPEN_UNIT'").all(id))
      .toEqual([{ type: "STOCK_OUT", change: -1, related: "OPEN_UNIT", actor: "ACC-1" }]);
    expect((await detail(id)).unitsEmptied).toBe(1);
    // A closed unit takes no further actions.
    expect((await unitAction(id, { action: "use", unitId: unit, key: crypto.randomUUID() })).status).toBe(409);
    expect((await unitAction(id, { action: "correct", unitId: unit })).status).toBe(409);
  });

  it("refuses a use, a condition or a correction that lands just after someone else closed the unit, and records none of them", async () => {
    const id = await paper(3);
    for (const body of [{ action: "use", key: crypto.randomUUID() }, { action: "condition", condition: "LOW" }, { action: "correct" }]) {
      const unit = await open(id);
      meanwhile(() => unitAction(id, { action: "empty", unitId: unit }));
      const late = await unitAction(id, { ...body, unitId: unit });
      expect(late.status, body.action).toBe(409);
      expect((await late.json() as { error: string }).error).toBe("That unit is no longer open. Refresh to see the latest.");
    }
    expect(sqlite.prepare("SELECT action FROM audit_log WHERE entity_id = ? AND action IN ('UNIT_USED', 'UNIT_CONDITION', 'UNIT_CORRECTED')").all(id)).toEqual([]);
    expect(onHand(id)).toBe(0);
  });

  it("produces one deduction when two staff mark the same unit empty at once", async () => {
    const id = await paper(1);
    const unit = await open(id);
    let other: Response | undefined;
    meanwhile(async () => { other = await unitAction(id, { action: "empty", unitId: unit }); });
    const mine = await unitAction(id, { action: "empty", unitId: unit });
    expect([mine.status, other!.status]).toEqual([200, 200]);
    expect(onHand(id)).toBe(0);
    expect(movements(id)).toBe(2);
  });
});

describe("open units never exceed on-hand", () => {
  it("refuses a stock-out that would eat into the open units, and says what to do", async () => {
    const id = await paper(2);
    await open(id);
    expect((await movement(id, { kind: "OUT", quantity: 1, reason: "CONSUMED" })).status).toBe(200);
    const refused = await movement(id, { kind: "OUT", quantity: 1, reason: "CONSUMED" });
    expect(refused.status).toBe(409);
    expect((await refused.json() as { error: string }).error).toContain("Mark an open unit empty instead");
    expect(onHand(id)).toBe(1);
  });

  it("treats a count as observed outer units, and needs an explicit reconciliation to go below the open units", async () => {
    const id = await paper(5);
    const older = await open(id);
    const newer = await open(id);
    // 3 sealed + 1 open, say: any count at or above the open units is just a count.
    expect((await movement(id, { kind: "COUNT", quantity: 4, expectedOnHand: 5, note: "Shelf count" })).status).toBe(200);
    const refused = await movement(id, { kind: "COUNT", quantity: 1, expectedOnHand: 4, note: "Shelf count" });
    expect(refused.status).toBe(409);
    expect((await refused.json() as { error: string }).error).toBe("2 units are open, more than the 1 you counted. Close the extra open units with this count, or correct them first.");
    expect([onHand(id), openCount(id)]).toEqual([4, 2]);
    const key = crypto.randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await movement(id, { kind: "COUNT", quantity: 1, expectedOnHand: 4, note: "Shelf count", reconcileOpen: true, key })).status).toBe(200);
    }
    expect([onHand(id), openCount(id)]).toEqual([1, 1]);
    // The oldest unit is the one the count closed, linked to the count's movement; history is untouched.
    const closed = sqlite.prepare("SELECT o.id, o.close_kind AS kind, m.movement_type AS type FROM open_units o JOIN inventory_movements m ON m.id = o.movement_id WHERE o.closed_at IS NOT NULL").all();
    expect(closed).toEqual([{ id: older, kind: "COUNTED", type: "COUNT_ADJUSTMENT" }]);
    expect(openCount(id) && (sqlite.prepare("SELECT id FROM open_units WHERE closed_at IS NULL").get() as { id: string }).id).toBe(newer);
    expect(sqlite.prepare("SELECT json_extract(details_json, '$.closed') AS closed FROM audit_log WHERE action = 'UNIT_RECONCILED'").all()).toEqual([{ closed: 1 }]);
    // A count to zero closes the last one too, but only when asked.
    expect((await movement(id, { kind: "COUNT", quantity: 0, expectedOnHand: 1, note: "Gone" })).status).toBe(409);
    expect((await movement(id, { kind: "COUNT", quantity: 0, expectedOnHand: 1, note: "Gone", reconcileOpen: true })).status).toBe(200);
    expect([onHand(id), openCount(id)]).toEqual([0, 0]);
  });

  it("refuses a held phone take that would leave fewer units than are open", async () => {
    const id = await paper(1);
    await open(id);
    sqlite.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, device_time, sent_at, occurred_at, received_at, applied, review)
      VALUES('8d2c7d2e-0000-4000-8000-000000000001', 'device', 1, 'TAKE', ?, 1, 'Juan', ?2, ?2, ?2, ?2, 0, 'NOT_ELIGIBLE')`).run(id, new Date().toISOString());
    const response = await staff("/api/staff/self-service/8d2c7d2e-0000-4000-8000-000000000001/resolve", "POST", { action: "apply" });
    expect(response.status).toBe(409);
    expect(onHand(id)).toBe(1);
    expect(sqlite.prepare("SELECT resolved_at AS resolved FROM self_service_events").get()).toEqual({ resolved: null });
  });
});

describe("unsafe changes while units are open", () => {
  it("blocks Whole unit, Loanable and Inactive until the open units are closed, and never deletes one", async () => {
    const id = await paper(3);
    const unit = await open(id);
    for (const change of [{ consumptionMode: "WHOLE_UNIT" }, { itemType: "Loanable" }, { status: "INACTIVE" }]) {
      const response = await edit(id, change);
      expect(response.status).toBe(409);
      expect((await response.json() as { error: string }).error).toContain("This item has open units");
    }
    expect(() => sqlite.prepare("DELETE FROM open_units").run()).toThrow(/open_unit_kept/);
    expect((await unitAction(id, { action: "correct", unitId: unit })).status).toBe(200);
    expect(onHand(id)).toBe(3);
    expect((await edit(id, { consumptionMode: "WHOLE_UNIT" })).status).toBe(200);
  });

  it("shows a stored inconsistency as it is, and records that a correction cleared it", async () => {
    const id = await paper(1);
    const unit = await open(id);
    // A fault the database would now refuse, written around its guard.
    sqlite.exec("DROP TRIGGER movements_within_open_units");
    sqlite.prepare("INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status) VALUES('MOV-FAULT', ?, 'STOCK_OUT', 'OUT', ?, 1, 'ream', -1, 'POSTED')").run(new Date().toISOString(), id);
    const listed = (await (await staff("/api/staff/inventory")).json() as { items: Array<Record<string, unknown>> }).items.find((entry) => entry.id === id)!;
    expect([listed.onHand, listed.openUnits]).toEqual([0, 1]);
    expect((await unitAction(id, { action: "correct", unitId: unit })).status).toBe(200);
    expect(sqlite.prepare("SELECT json_extract(details_json, '$.resolvedDiscrepancy') AS resolved FROM audit_log WHERE action = 'UNIT_CORRECTED'").get()).toEqual({ resolved: 1 });
  });
});

describe("boundaries", () => {
  it("keeps open-unit actions staff-only and out of every public answer", async () => {
    const id = await paper(4);
    const unit = await open(id);
    expect((await call(`/api/staff/items/${id}/open-units`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ action: "empty", unitId: unit }) })).status).toBe(401);
    expect((await call(`/api/staff/items/${id}/open-units`, { method: "POST", headers: { origin: "https://evil.example", cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "empty", unitId: unit }) })).status).toBe(403);
    await edit(id, { lendingAudience: "STUDENTS_AND_USC_STAFF" });
    const answers = await Promise.all(["/api/public/catalog", "/api/self-service/catalog"].map(async (path) => await (await call(path)).text()));
    expect(answers[0]).toContain("A4 Bond Paper");
    for (const text of answers) expect(text).not.toMatch(/open_?units?|OU-|condition|consumption/i);
    expect(onHand(id)).toBe(4);
  });
});
