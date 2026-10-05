import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { readComponent, readKit, type ComponentFacts } from "../src/kit-policy";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/* V1.8 Kits and Kit Templates: components of mixed behaviour, state derived from the items' own records, templates, and a check that never touches stock. */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let cookie: string;
let other: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (who: string, path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie: who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, any>>(response: Response | Promise<Response>) => (await (await response).json()) as T;

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  const hash = await hashPassword("correct horse battery");
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(hash);
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-2', 'staff.two', 'Staff Two', ?)").run(hash);
  cookie = await signIn("staff.one");
  other = await signIn("staff.two");
});

async function signIn(username: string): Promise<string> {
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${username}` }, body: JSON.stringify({ username, password: "correct horse battery" }) });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

const base = { category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
async function item(name: string, quantity: number, fields: Record<string, unknown> = {}): Promise<string> {
  const response = await as(cookie, "/api/staff/items", "POST", { ...base, name, openingQuantity: quantity, ...fields });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await json<{ id: string }>(response)).id;
}
const onHand = (id: string) => (sqlite.prepare("SELECT on_hand FROM inventory_balances WHERE id = ?").get(id) as { on_hand: number }).on_hand;
const movements = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements").get() as { n: number }).n;
const stateOf = async (id: string) => json(as(cookie, `/api/staff/kits/${id}`));
let counter = 0;
const checkId = () => `KC-00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

async function sewing() {
  const thread = await item("Thread", 10);
  const needles = await item("Needles (pack)", 3, { itemType: "Consumable" });
  const scissors = await item("Sewing scissors", 2, { itemType: "Loanable", lendingAudience: "USC_STAFF_ONLY" });
  const tape = await item("Measuring tape", 4, { itemType: "Consumable", consumptionMode: "OPEN_UNIT" });
  const response = await as(cookie, "/api/staff/kits", "POST", { name: "Sewing Kit A", description: "For costume repairs", locationId: null,
    components: [{ itemId: thread, required: 4 }, { itemId: needles, required: 2 }, { itemId: scissors, required: 1 }, { itemId: tape, required: 1 }] });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return { id: (await json<{ id: string }>(response)).id, thread, needles, scissors, tape };
}

describe("component and kit state", () => {
  const facts = (over: Partial<ComponentFacts> = {}): ComponentFacts => ({ required: 2, demand: 2, onHand: 5, onLoan: 0, reorderThreshold: 0, itemStatus: "ACTIVE", itemType: "Consumable", openCondition: null, expiresOn: null, seen: null, ...over });
  it("reads each reason in plain words, most serious first", () => {
    expect(readComponent(facts(), "2026-10-05")).toEqual({ state: "OK", reason: null });
    expect(readComponent(facts({ onHand: 1 }), "2026-10-05")).toEqual({ state: "SHORT", reason: "Needs 2, 1 on the shelf." });
    expect(readComponent(facts({ onHand: 0, onLoan: 2 }), "2026-10-05").reason).toBe("Needs 2, 0 on the shelf, 2 on loan.");
    expect(readComponent(facts({ onHand: 3, demand: 4 }), "2026-10-05").reason).toBe("Needs 2 (4 across kits), 3 on the shelf.");
    expect(readComponent(facts({ expiresOn: "2026-10-20" }), "2026-10-05")).toEqual({ state: "EXPIRING", reason: "Expires in 15 days." });
    expect(readComponent(facts({ expiresOn: "2026-10-01" }), "2026-10-05").reason).toBe("Expired.");
    expect(readComponent(facts({ expiresOn: "2027-01-01" }), "2026-10-05").state).toBe("OK");
    expect(readComponent(facts({ onHand: 3, reorderThreshold: 3 }), "2026-10-05").state).toBe("LOW");
    expect(readComponent(facts({ openCondition: "LOW" }), "2026-10-05").state).toBe("LOW");
    expect(readComponent(facts({ seen: "LOW" }), "2026-10-05").state).toBe("LOW");
    expect(readComponent(facts({ seen: "DAMAGED" }), "2026-10-05")).toEqual({ state: "REVIEW", reason: "Damaged at the last check." });
    expect(readComponent(facts({ seen: "MISSING", onHand: 0 }), "2026-10-05").state).toBe("REVIEW");
    expect(readComponent(facts({ itemStatus: "INACTIVE" }), "2026-10-05").state).toBe("REVIEW");
    expect(readComponent(facts({ itemType: "NEEDS_REVIEW" }), "2026-10-05").state).toBe("REVIEW");
  });
  it("a kit needs review before replenishment, and an empty kit is not ready", () => {
    expect(readKit(["OK", "OK"])).toEqual({ state: "READY", ready: 2, total: 2 });
    expect(readKit(["OK", "SHORT", "LOW"]).state).toBe("REPLENISH");
    expect(readKit(["SHORT", "REVIEW"]).state).toBe("REVIEW");
    expect(readKit([]).state).toBe("REVIEW");
  });
});

describe("kits", () => {
  it("makes a kit of mixed items and derives its state from their stock", async () => {
    const { id, needles, scissors } = await sewing();
    const detail = await stateOf(id);
    expect(detail.kit).toMatchObject({ name: "Sewing Kit A", state: "READY", ready: 4, total: 4, active: true });
    expect(detail.components.map((entry: { itemType: string }) => entry.itemType)).toEqual(["Consumable", "Consumable", "Loanable", "Consumable"]);
    // Stock moves through the item's own rules; the kit follows without being told.
    expect((await as(cookie, `/api/staff/items/${needles}/movements`, "POST", { kind: "OUT", quantity: 2, reason: "CONSUMED", key: "k1-out-0001" })).status).toBe(200);
    const after = await stateOf(id);
    expect(after.kit.state).toBe("REPLENISH");
    expect(after.components.find((entry: { itemId: string }) => entry.itemId === needles)).toMatchObject({ state: "SHORT", onHand: 1, reason: "Needs 2, 1 on the shelf." });
    // Lending the scissors to the last unit shows on the loan, not as a stock change in the kit.
    expect(onHand(scissors)).toBe(2);
  });

  it("one pool of stock cannot make two kits ready at once", async () => {
    const glue = await item("Glue", 3);
    const make = (name: string) => as(cookie, "/api/staff/kits", "POST", { name, components: [{ itemId: glue, required: 2 }] });
    const first = (await json<{ id: string }>(make("Craft Kit 1"))).id;
    expect((await stateOf(first)).kit.state).toBe("READY");
    const second = (await json<{ id: string }>(make("Craft Kit 2"))).id;
    const both = await stateOf(second);
    expect(both.kit.state).toBe("REPLENISH");
    expect(both.components[0].reason).toBe("Needs 2 (4 across kits), 3 on the shelf.");
    expect((await stateOf(first)).kit.state).toBe("REPLENISH");
    // A turned-off kit stops asking for stock.
    const detail = await stateOf(second);
    await as(cookie, `/api/staff/kits/${second}`, "PATCH", { name: "Craft Kit 2", description: null, locationId: null, active: false, updatedAt: detail.kit.updatedAt });
    expect((await stateOf(first)).kit.state).toBe("READY");
  });

  it("edits details and replaces the components in one guarded write", async () => {
    const { id, thread, needles } = await sewing();
    const detail = await stateOf(id);
    const edit = { name: "Sewing Kit A", description: "Updated", locationId: null, active: true, updatedAt: detail.kit.updatedAt, components: [{ itemId: thread, required: 6 }, { itemId: needles, required: 1 }] };
    expect((await json(as(cookie, `/api/staff/kits/${id}`, "PATCH", edit))).changed).toBeGreaterThan(0);
    const next = await stateOf(id);
    expect(next.components.map((entry: { itemId: string; required: number }) => [entry.itemId, entry.required])).toEqual([[thread, 6], [needles, 1]]);
    // The version the editor loaded is stale now: nothing is overwritten.
    const stale = await as(other, `/api/staff/kits/${id}`, "PATCH", { ...edit, name: "Other name" });
    expect(stale.status).toBe(409);
    expect((await stateOf(id)).kit.name).toBe("Sewing Kit A");
  });

  it("refuses repeats, bad quantities, unknown items, duplicate names and an inactive place", async () => {
    const glue = await item("Glue", 3);
    const post = (body: Record<string, unknown>) => as(cookie, "/api/staff/kits", "POST", body);
    expect((await post({ name: "A", components: [{ itemId: glue, required: 1 }, { itemId: glue, required: 2 }] })).status).toBe(400);
    expect((await post({ name: "A", components: [{ itemId: glue, required: 0 }] })).status).toBe(400);
    expect((await post({ name: "A", components: [{ itemId: "ITM-9999", required: 1 }] })).status).toBe(400);
    expect((await post({ name: "  " })).status).toBe(400);
    expect((await post({ name: "Unique" })).status).toBe(201);
    expect((await post({ name: "unique" })).status).toBe(409);
    const place = (await json<{ id: string }>(as(cookie, "/api/staff/locations", "POST", { name: "Old shed" }))).id;
    const placed = await json<{ id: string }>(post({ name: "Placed", locationId: place }));
    const kit = await stateOf(placed.id);
    expect(kit.kit.place).toBe("Old shed");
    const inactive = (await json<{ id: string; updatedAt: string }>(as(cookie, "/api/staff/locations", "POST", { name: "Closed" })));
    await as(cookie, `/api/staff/locations/${inactive.id}`, "PATCH", { name: "Closed", parentId: null, directions: "", visibility: "STAFF_ONLY", active: false, updatedAt: inactive.updatedAt });
    expect((await post({ name: "In closed", locationId: inactive.id })).status).toBe(409);
    // A place a kit is kept in cannot be deleted by accident.
    const fresh = await json<{ locations: Array<{ id: string; updatedAt: string }> }>(as(cookie, "/api/staff/inventory"));
    const row = fresh.locations.find((entry) => entry.id === place)!;
    expect((await as(cookie, `/api/staff/locations/${place}?expected=${encodeURIComponent(row.updatedAt)}`, "DELETE")).status).toBe(409);
  });

  it("an item's own record says which kits it is part of", async () => {
    const { id, thread } = await sewing();
    const record = await json<{ kits: Array<{ id: string; name: string; required: number }> }>(as(cookie, `/api/staff/items/${thread}`));
    expect(record.kits).toEqual([{ id, name: "Sewing Kit A", active: true, required: 4 }]);
  });
});

describe("templates", () => {
  it("makes a kit from a template without copying stock, and each kit keeps its own state", async () => {
    const { id, thread } = await sewing();
    const made = await as(cookie, "/api/staff/kit-templates", "POST", { name: "Sewing Kit", description: "Standard sewing kit", fromKitId: id });
    expect(made.status).toBe(201);
    const template = (await json<{ id: string }>(made)).id;
    const before = { movements: movements(), thread: onHand(thread) };
    const copy = await json<{ id: string }>(as(cookie, "/api/staff/kits", "POST", { name: "Sewing Kit B", templateId: template }));
    const detail = await stateOf(copy.id);
    expect(detail.components).toHaveLength(4);
    expect(detail.kit.templateName).toBe("Sewing Kit");
    expect({ movements: movements(), thread: onHand(thread) }).toEqual(before);
    // Editing the template later does not rewrite kits already made from it.
    const info = await json<{ template: { updatedAt: string }; components: Array<{ itemId: string; required: number }> }>(as(cookie, `/api/staff/kit-templates/${template}`));
    expect((await as(cookie, `/api/staff/kit-templates/${template}`, "PATCH", { name: "Sewing Kit", description: null, active: true, updatedAt: info.template.updatedAt, components: [{ itemId: thread, required: 9 }] })).status).toBe(200);
    expect((await stateOf(copy.id)).components).toHaveLength(4);
    const list = await json<{ templates: Array<{ id: string; components: number; kits: number }> }>(as(cookie, "/api/staff/kits"));
    expect(list.templates.find((entry) => entry.id === template)).toMatchObject({ components: 1, kits: 1 });
  });

  it("a turned-off template cannot start a kit, and an empty kit cannot become a template", async () => {
    const { id } = await sewing();
    const empty = (await json<{ id: string }>(as(cookie, "/api/staff/kits", "POST", { name: "Empty" }))).id;
    expect((await as(cookie, "/api/staff/kit-templates", "POST", { name: "Nothing", fromKitId: empty })).status).toBe(400);
    const template = (await json<{ id: string; updatedAt: string }>(as(cookie, "/api/staff/kit-templates", "POST", { name: "T", fromKitId: id })));
    await as(cookie, `/api/staff/kit-templates/${template.id}`, "PATCH", { name: "T", description: null, active: false, updatedAt: template.updatedAt });
    expect((await as(cookie, "/api/staff/kits", "POST", { name: "From off", templateId: template.id })).status).toBe(409);
  });
});

describe("checking a kit", () => {
  it("records what was seen, derives state from it, and never touches stock", async () => {
    const { id, thread, needles, scissors, tape } = await sewing();
    const before = { movements: movements(), on: [thread, needles, scissors, tape].map(onHand) };
    const check = checkId();
    const response = await as(cookie, `/api/staff/kits/${id}/checks`, "POST", { id: check, note: "Quick look", observations: [
      { itemId: thread, outcome: "OK" }, { itemId: needles, outcome: "LOW", note: "Two packs left" }, { itemId: scissors, outcome: "DAMAGED", note: "Loose screw" }] });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ okCount: 1, flaggedCount: 2, uncheckedCount: 1, replayed: false });
    expect({ movements: movements(), on: [thread, needles, scissors, tape].map(onHand) }).toEqual(before);
    const detail = await stateOf(id);
    expect(detail.kit.state).toBe("REVIEW");
    expect(detail.components.find((entry: { itemId: string }) => entry.itemId === scissors)).toMatchObject({ state: "REVIEW", reason: "Damaged at the last check." });
    expect(detail.components.find((entry: { itemId: string }) => entry.itemId === needles)).toMatchObject({ state: "LOW" });
    expect(detail.lastCheck).toMatchObject({ checkedBy: "Staff One", okCount: 1, flaggedCount: 2, uncheckedCount: 1 });
    // A later check that finds it fine clears it.
    await as(other, `/api/staff/kits/${id}/checks`, "POST", { id: checkId(), observations: [{ itemId: scissors, outcome: "OK" }, { itemId: needles, outcome: "OK" }] });
    const cleared = await stateOf(id);
    expect(cleared.components.find((entry: { itemId: string }) => entry.itemId === scissors).state).toBe("OK");
    expect(cleared.checks).toHaveLength(2);
    expect(sqlite.prepare("SELECT action FROM audit_log WHERE entity_type = 'KIT' AND action = 'KIT_CHECKED'").all()).toHaveLength(2);
  });

  it("a resent check is found, not repeated; and what is final stays final", async () => {
    const { id, thread } = await sewing();
    const check = checkId();
    const body = { id: check, observations: [{ itemId: thread, outcome: "OK" }] };
    expect((await as(cookie, `/api/staff/kits/${id}/checks`, "POST", body)).status).toBe(201);
    expect((await as(cookie, `/api/staff/kits/${id}/checks`, "POST", body)).status).toBe(200);
    expect((await as(other, `/api/staff/kits/${id}/checks`, "POST", body)).status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM kit_checks").get()).toEqual({ n: 1 });
    expect(() => sqlite.prepare("UPDATE kit_check_observations SET outcome = 'LOW'").run()).toThrow(/kit_check_final/);
    expect(() => sqlite.prepare("DELETE FROM kit_checks").run()).toThrow(/kit_check_final/);
    expect(() => sqlite.prepare("DELETE FROM kits").run()).toThrow(/kit_kept/);
  });

  it("refuses a check with nothing marked, a stranger's item, a repeat, or a turned-off kit", async () => {
    const { id, thread } = await sewing();
    const stranger = await item("Stapler", 1);
    const check = (observations: unknown[]) => as(cookie, `/api/staff/kits/${id}/checks`, "POST", { id: checkId(), observations });
    expect((await check([])).status).toBe(400);
    expect((await check([{ itemId: stranger, outcome: "OK" }])).status).toBe(409);
    expect((await check([{ itemId: thread, outcome: "OK" }, { itemId: thread, outcome: "LOW" }])).status).toBe(400);
    expect((await check([{ itemId: thread, outcome: "FINE" }])).status).toBe(400);
    const detail = await stateOf(id);
    await as(cookie, `/api/staff/kits/${id}`, "PATCH", { name: "Sewing Kit A", description: null, locationId: null, active: false, updatedAt: detail.kit.updatedAt });
    expect((await check([{ itemId: thread, outcome: "OK" }])).status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM kit_checks").get()).toEqual({ n: 0 });
  });

  it("an expiring component makes a supply kit need replenishment before it is expired", async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const gauze = await item("Gauze", 5, { expiresOn: soon });
    const kit = (await json<{ id: string }>(as(cookie, "/api/staff/kits", "POST", { name: "First aid", components: [{ itemId: gauze, required: 2 }] }))).id;
    const detail = await stateOf(kit);
    expect(detail.kit.state).toBe("REPLENISH");
    expect(detail.components[0]).toMatchObject({ state: "EXPIRING", reason: "Expires in 10 days." });
  });
});

describe("access and history", () => {
  it("is for signed-in staff only, and its changes appear in Activity", async () => {
    expect((await call("/api/staff/kits")).status).toBe(401);
    const { id } = await sewing();
    await as(cookie, `/api/staff/kits/${id}/checks`, "POST", { id: checkId(), observations: [{ itemId: (await stateOf(id)).components[0].itemId, outcome: "OK" }] });
    const feed = await json<{ events: Array<{ summary: string }> }>(as(cookie, "/api/staff/activity?limit=50"));
    const lines = feed.events.map((event) => event.summary);
    expect(lines).toContain("Staff One made the kit Sewing Kit A with 4 components.");
    expect(lines).toContain("Staff One checked the kit Sewing Kit A: 1 all there; stock did not change.");
  });
  it("the Self-Service catalog never shows a kit", async () => {
    await sewing();
    expect(JSON.stringify(await json(call("/api/public/catalog")))).not.toMatch(/Sewing Kit|kit_/i);
  });
});
