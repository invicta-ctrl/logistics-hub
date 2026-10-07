import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { networkOf } from "../src/self-service";
import { memoryR2, migratedD1 } from "./d1-sqlite";

const origin = "https://hub.example.test";
const MINUTE = 60_000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let photos: ReturnType<typeof memoryR2>["objects"];
let cookie: string;

type Result = { id: string; outcome: string; message?: string; duplicate?: boolean };

/** Migration 0018 seeds Self-Service closed, as on production; most tests need it open. */
const selfService = (state: "open" | "paused") => sqlite.prepare("UPDATE system_settings SET value = ? WHERE key = 'self_service'").run(state);

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const staff = (path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

// A phone sync sweeps stale rows on a 2% random draw, and that sweep is one more database batch, which moved the "fail the
// second batch" injection below onto the wrong statement about one run in fifty. The draw is pinned so every run takes one path.
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const database = migratedD1();
  sqlite = database.sqlite;
  const r2 = memoryR2();
  photos = r2.objects;
  env = { DB: database.d1, EVIDENCE: r2.bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  selfService("open");
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(await hashPassword("correct horse battery"));
  const login = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "staff.one", password: "correct horse battery" }) });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

/** An item that has been on the shelf since yesterday, so simulated offline events happen after it existed. */
async function item(fields: Record<string, unknown>, quantity: number): Promise<string> {
  const base = { category: "SUPPLIES", unit: "piece", status: "ACTIVE", reorderThreshold: 0, needsReview: false, notes: "private staff note" };
  const response = await staff("/api/staff/items", "POST", { ...base, ...fields, openingQuantity: 0 });
  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };
  sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
    VALUES(?, ?, 'OPENING_BALANCE', 'IN', ?, ?, 'piece', ?, 'POSTED')`).run(`MOV-${crypto.randomUUID()}`, new Date(Date.now() - 24 * 60 * MINUTE).toISOString(), id, quantity, quantity);
  return id;
}
const consumable = (name: string, quantity: number, extra = {}) => item({ name, itemType: "Consumable", lendingAudience: "NOT_AVAILABLE_FOR_LENDING", ...extra }, quantity);
const loanable = (name: string, quantity: number, extra = {}) => item({ name, itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF", ...extra }, quantity);

/** One simulated phone: its own device id and local sequence. */
function phone() {
  const deviceId = crypto.randomUUID();
  let seq = 0;
  const event = (type: string, itemId: string, fields: Record<string, unknown> = {}, minutesAgo = 0) => ({
    v: 1, id: crypto.randomUUID(), seq: ++seq, type, itemId, quantity: 1, occurredAt: new Date(Date.now() - minutesAgo * MINUTE).toISOString(),
    catalogRevision: 1, person: { name: "Juan Dela Cruz", studentId: "20-1234-567" }, ...fields
  });
  return {
    deviceId,
    take: (itemId: string, quantity: number, minutesAgo = 0) => event("TAKE", itemId, { quantity }, minutesAgo),
    /** A record from a phone that holds the identity rule (version 2): name, an 8-digit Student ID and a photo on every action. */
    current: (type: "TAKE" | "USE" | "BORROW" | "RETURN", itemId: string, fields: Record<string, unknown> = {}, minutesAgo = 0) =>
      event(type, itemId, { v: 2, person: { name: "Maria Santos", studentId: "21000115" }, ...(type === "TAKE" ? { quantity: 1 } : {}), ...(type === "BORROW" ? { purpose: "INDIVIDUAL" } : {}), ...(type === "RETURN" ? { loanEventId: null, outcome: "RETURNED" } : {}), ...fields }, minutesAgo),
    borrow: (itemId: string, minutesAgo = 0, fields: Record<string, unknown> = {}) => event("BORROW", itemId, { purpose: "INDIVIDUAL", ...fields }, minutesAgo),
    giveBack: (itemId: string, loanEventId: string | null, minutesAgo = 0, fields: Record<string, unknown> = {}) => event("RETURN", itemId, { loanEventId, outcome: "RETURNED", ...fields }, minutesAgo),
    sync: async (events: Array<Record<string, unknown>>, options: { photoFor?: string[]; photo?: Uint8Array<ArrayBuffer>; origin?: string; sentAt?: string; headers?: Record<string, string> } = {}) => {
      const form = new FormData();
      form.set("batch", JSON.stringify({ deviceId, sentAt: options.sentAt ?? new Date().toISOString(), events }));
      const withPhoto = options.photoFor ?? events.filter((entry) => entry.type === "BORROW" || entry.type === "RETURN" || entry.v === 2).map((entry) => entry.id as string);
      for (const id of withPhoto) form.set(`photo:${id}`, new File([options.photo ?? JPEG], "photo.jpg", { type: "image/jpeg" }));
      // Serialised like a browser would, so the Worker sees a real Content-Length.
      const request = new Request(`${origin}/api/self-service/sync`, { method: "POST", headers: { origin: options.origin ?? origin }, body: form });
      const body = await request.arrayBuffer();
      return call("/api/self-service/sync", { method: "POST", headers: { ...options.headers, origin: options.origin ?? origin, "content-type": request.headers.get("content-type")!, "content-length": String(body.byteLength) }, body });
    }
  };
}

async function results(response: Response): Promise<Result[]> {
  expect(response.status).toBe(200);
  return (await response.json() as { results: Result[] }).results;
}
const onHand = (id: string) => (sqlite.prepare("SELECT on_hand AS onHand FROM inventory_balances WHERE id = ?").get(id) as { onHand: number }).onHand;
const stored = (id: string) => sqlite.prepare("SELECT * FROM self_service_events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
const loan = (eventId: string) => sqlite.prepare("SELECT * FROM loans WHERE id = ?").get(`LN-SS-${eventId}`) as Record<string, unknown> | undefined;
const review = async () => await (await staff("/api/staff/self-service")).json() as { open: Array<Record<string, unknown>>; stockIssues: Array<Record<string, unknown>>; candidates: Array<{ id: string }> };
const resolve = (id: string, body: Record<string, unknown>) => staff(`/api/staff/self-service/${id}/resolve`, "POST", body);
/** Runs `other` (another staff member, another phone) just before the next database batch, as if it happened at the same moment. */
function meanwhile(other: () => Promise<unknown>, skip = 0) {
  const batch = env.DB.batch.bind(env.DB);
  let calls = 0;
  env.DB.batch = (async (statements: D1PreparedStatement[]) => {
    if (calls++ < skip) return batch(statements);
    env.DB.batch = batch;
    await other();
    return batch(statements);
  }) as D1Database["batch"];
}
async function count(itemId: string, observed: number) {
  const response = await staff(`/api/staff/items/${itemId}/movements`, "POST", { kind: "COUNT", quantity: observed, expectedOnHand: onHand(itemId), note: "Shelf count", key: crypto.randomUUID() });
  expect(response.status).toBe(200);
}

describe("self-service catalog", () => {
  it("offers eligible items by type with a minimal DTO, and fails closed", async () => {
    const water = await consumable("Bottled Water", 20);
    const scissors = await loanable("Scissors", 5, { aliases: "Gunting" });
    await consumable("Unreviewed Snack", 3, { needsReview: true });
    await loanable("Unlisted Projector", 1, { lendingAudience: "NOT_AVAILABLE_FOR_LENDING" });
    const response = await call("/api/self-service/catalog");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { items: Array<Record<string, unknown>>; places: unknown[]; revision: number };
    expect(body.places).toEqual([]);
    expect(body.items).toEqual([
      { id: water, name: "Bottled Water", iconKey: "bottle", aliases: null, category: "SUPPLIES", unit: "piece", area: "Inventory", action: "TAKE", available: 20, location: null, locationId: null, audience: null, photo: null },
      { id: scissors, name: "Scissors", iconKey: "scissors", aliases: "Gunting", category: "SUPPLIES", unit: "piece", area: "Inventory", action: "BORROW", available: 5, location: null, locationId: null, audience: "STUDENTS_AND_USC_STAFF", photo: null }
    ]);
    expect(JSON.stringify(body)).not.toContain("private staff note");
    const etag = response.headers.get("etag")!;
    expect((await call("/api/self-service/catalog", { headers: { "if-none-match": etag } })).status).toBe(304);
  });

  it("closes for maintenance: phones are told so and nothing new is recorded until it reopens", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    const take = a.take(water, 2);
    selfService("paused");
    for (const response of [await call("/api/self-service/catalog"), await a.sync([take])]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ maintenance: true });
    }
    expect(stored(take.id)).toBeUndefined();
    expect(onHand(water)).toBe(20);
    expect((await call("/api/self-service/sync", { method: "POST", headers: { origin: "https://evil.example" }, body: "x" })).status).toBe(403);
    selfService("open");
    expect(await results(await a.sync([take]))).toEqual([{ id: take.id, outcome: "accepted" }]);
    expect(onHand(water)).toBe(18);
  });

  it("opens only to an administrator testing it, and holds every test record for staff without changing anything", async () => {
    const water = await consumable("Bottled Water", 20);
    const scissors = await loanable("Scissors", 5);
    sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES('ACC-2', 'admin.one', 'Admin One', ?, 'ADMIN')").run(await hashPassword("correct horse battery"));
    const login = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "admin.one", password: "correct horse battery" }) });
    const admin = { "x-self-service-test": "1", cookie: login.headers.get("set-cookie")!.split(";")[0]! };
    selfService("paused");
    expect((await (await staff("/api/staff/session")).json() as { selfServiceClosed: boolean }).selfServiceClosed).toBe(true);
    // The header alone, or a staff member without administration, still meets a closed Self-Service.
    for (const headers of [{ "x-self-service-test": "1" }, { "x-self-service-test": "1", cookie }, { cookie: admin.cookie }] as Array<Record<string, string>>) {
      expect((await call("/api/self-service/catalog", { headers })).status).toBe(503);
    }
    expect((await call("/api/self-service/catalog", { headers: admin })).status).toBe(200);
    const a = phone();
    const take = { ...a.take(water, 2), test: true };
    const borrow = { ...a.borrow(scissors, 0, { person: { name: "Ana Reyes", studentId: "20-1234-567" } }), test: true };
    const giveBack = { ...a.giveBack(scissors, borrow.id), test: true };
    expect((await a.sync([take], { headers: { "x-self-service-test": "1", cookie } })).status).toBe(503);
    expect((await results(await a.sync([take, borrow, giveBack], { headers: admin }))).map((result) => result.outcome)).toEqual(["review", "review", "review"]);
    expect([onHand(water), onHand(scissors), loan(borrow.id)]).toEqual([20, 5, undefined]);
    expect((await review()).open.map((entry) => entry.review)).toEqual(["TEST", "TEST", "TEST"]);
    // Refusals are tested too: an invalid record is still refused.
    expect((await results(await a.sync([{ ...a.take(water, 99), test: true }], { headers: admin })))[0]!.outcome).toBe("rejected");
    // A test record that reaches an open Self-Service later (from any page) is still only held.
    selfService("open");
    const late = { ...a.take(water, 1), test: true };
    expect((await results(await a.sync([late])))[0]!.outcome).toBe("review");
    expect(onHand(water)).toBe(20);
    // Staff decide: applied, a test take changes stock like any held take; dismissed, nothing changes.
    expect((await resolve(take.id, { action: "apply" })).status).toBe(200);
    expect((await resolve(late.id, { action: "dismiss" })).status).toBe(200);
    expect(onHand(water)).toBe(18);
    // The phone learns those decisions by its own record ids, and only the decision; undecided records are left out.
    const decisions = await call(`/api/self-service/decisions?ids=${[take.id, late.id, borrow.id, crypto.randomUUID()].join(",")}`);
    expect((await decisions.json() as { results: Array<{ id: string }> }).results.sort((a, b) => Number(a.id === late.id) - Number(b.id === late.id)))
      .toEqual([{ id: take.id, outcome: "accepted" }, { id: late.id, outcome: "dismissed" }]);
    for (const ids of ["", "not-an-id", Array.from({ length: 51 }, () => crypto.randomUUID()).join(",")]) {
      expect((await call(`/api/self-service/decisions?ids=${ids}`)).status).toBe(400);
    }
  });

  it("is closed and reopened by an administrator from Administration, and audited once per real change", async () => {
    sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES('ACC-2', 'admin.one', 'Admin One', ?, 'ADMIN')").run(await hashPassword("correct horse battery"));
    const login = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "admin.one", password: "correct horse battery" }) });
    const admin = login.headers.get("set-cookie")!.split(";")[0]!;
    const change = (who: string, body: unknown, headers: Record<string, string> = {}) =>
      call("/api/staff/admin/self-service", { method: "PATCH", headers: { origin, cookie: who, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await change(cookie, { state: "paused" })).status).toBe(403);
    expect((await change(admin, { state: "paused" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await change(admin, { state: "maybe" })).status).toBe(400);
    expect((await call("/api/self-service/catalog")).status).toBe(200);
    expect(await (await change(admin, { state: "paused" })).json()).toEqual({ state: "paused" });
    expect((await call("/api/self-service/catalog")).status).toBe(503);
    expect((await (await staff("/api/staff/session")).json() as { selfServiceClosed: boolean }).selfServiceClosed).toBe(true);
    // The same value again changes nothing and writes no second entry.
    await change(admin, { state: "paused" });
    expect(await (await change(admin, { state: "open" })).json()).toEqual({ state: "open" });
    expect((await call("/api/self-service/catalog")).status).toBe(200);
    const entries = sqlite.prepare("SELECT actor_user_id AS actor, entity_type AS entity, details_json AS details FROM audit_log WHERE action = 'SETTING_CHANGED' ORDER BY created_at, rowid").all() as Array<{ actor: string; entity: string; details: string }>;
    expect(entries.map((entry) => [entry.actor, entry.entity, JSON.parse(entry.details)])).toEqual([
      ["ACC-2", "SETTING", { setting: "self_service", from: "open", to: "paused" }],
      ["ACC-2", "SETTING", { setting: "self_service", from: "paused", to: "open" }]
    ]);
    const asAdmin = (path: string) => call(path, { headers: { cookie: admin } });
    expect((await (await asAdmin("/api/staff/admin/activity")).json() as { events: Array<{ action: string }> }).events.filter((event) => event.action === "SETTING_CHANGED")).toHaveLength(2);
    expect((await (await asAdmin("/api/staff/activity?type=SETTING_CHANGED")).json() as { events: Array<{ summary: string }> }).events.map((event) => event.summary))
      .toEqual(["Admin One reopened Self-Service.", "Admin One closed Self-Service for maintenance."]);
    // Staff do not see account or setting events in Activity.
    expect((await (await staff("/api/staff/activity?type=SETTING_CHANGED")).json() as { events: unknown[] }).events).toEqual([]);
  });
});

describe("Take", () => {
  it("records a take as a movement, and a replayed event never counts twice", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    const take = a.take(water, 2);
    expect(await results(await a.sync([take]))).toEqual([{ id: take.id, outcome: "accepted" }]);
    expect(await results(await a.sync([take]))).toEqual([{ id: take.id, outcome: "accepted", duplicate: true }]);
    expect(onHand(water)).toBe(18);
    const movements = sqlite.prepare("SELECT movement_type, reason, signed_quantity, actor_user_id, related_entity_type FROM inventory_movements WHERE related_entity_id = ?").all(take.id);
    expect(movements).toEqual([{ movement_type: "STOCK_OUT", reason: "CONSUMED", signed_quantity: -2, actor_user_id: "SELF_SERVICE", related_entity_type: "SELF_SERVICE" }]);
  });

  it("keeps every phone's takes, whatever order they arrive in: 20 − 2 − 1 − 3 = 14", async () => {
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const order of orders) {
      const water = await consumable(`Bottled Water ${order.join("")}`, 20);
      const phones = [phone(), phone(), phone()];
      const takes = [phones[0]!.take(water, 2, 50), phones[1]!.take(water, 1, 40), phones[2]!.take(water, 3, 30)];
      for (const index of order) expect((await results(await phones[index]!.sync([takes[index]!])))[0]!.outcome).toBe("accepted");
      expect(onHand(water)).toBe(14);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE item_id = ? AND related_entity_type = 'SELF_SERVICE'").get(water)).toEqual({ n: 3 });
    }
  });

  it("never loses a late take that overdraws stock: it is recorded and the item asks for a count", async () => {
    const water = await consumable("Bottled Water", 3);
    const [a, b] = [phone(), phone()];
    await a.sync([a.take(water, 2, 30)]);
    expect((await results(await b.sync([b.take(water, 2, 20)])))[0]!.outcome).toBe("accepted");
    expect(onHand(water)).toBe(-1);
    expect((await review()).stockIssues).toEqual([expect.objectContaining({ itemId: water, lowest: -1, onHand: -1 })]);
    // Staff stock outs keep their strict guard; a count clears the issue.
    expect((await staff(`/api/staff/items/${water}/movements`, "POST", { kind: "OUT", quantity: 1, reason: "CONSUMED", key: crypto.randomUUID() })).status).toBe(409);
    await count(water, 0);
    expect((await review()).stockIssues).toEqual([]);
  });

  it("holds more than an hour's self-service volume of one item for staff", async () => {
    const water = await consumable("Bottled Water", 100);
    const a = phone();
    expect((await results(await a.sync([a.take(water, 30)])))[0]!.outcome).toBe("accepted");
    const extra = a.take(water, 1);
    expect(await results(await a.sync([extra]))).toEqual([{ id: extra.id, outcome: "review", message: "Saved for staff to confirm: a lot of this item was recorded in the last hour." }]);
    expect(stored(extra.id)).toMatchObject({ applied: 0, review: "VOLUME" });
    expect(onHand(water)).toBe(70);
    expect((await resolve(extra.id, { action: "apply", note: "Sports fest" })).status).toBe(200);
    expect(onHand(water)).toBe(69);
    expect(stored(extra.id)).toMatchObject({ applied: 1, resolved_by: "ACC-1" });
  });

  it("treats a later physical count as having seen an earlier take, and flags a take right beside a count", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    const early = a.take(water, 2, 60);
    await count(water, 18);
    expect(await results(await a.sync([early]))).toEqual([{ id: early.id, outcome: "accepted" }]);
    expect(onHand(water)).toBe(18);
    expect(sqlite.prepare("SELECT status FROM inventory_movements WHERE related_entity_id = ?").get(early.id)).toEqual({ status: "SUPERSEDED" });
    const beside = a.take(water, 1, 3);
    expect((await results(await a.sync([beside])))[0]).toMatchObject({ outcome: "review" });
    expect(stored(beside.id)).toMatchObject({ review: "COUNT_OVERLAP" });
    expect(onHand(water)).toBe(17);
  });

  it("refuses an ineligible take while the person is there, and holds a late one without applying it", async () => {
    const toner = await consumable("Toner", 5, { needsReview: true });
    const a = phone();
    const live = a.take(toner, 1);
    expect(await results(await a.sync([live]))).toEqual([{ id: live.id, outcome: "rejected", message: "This item is not available for self-service right now. Please ask Logistics staff." }]);
    expect(stored(live.id)).toBeUndefined();
    // Claiming an earlier time never unlocks a staff-only item: the record waits for staff.
    const late = a.take(toner, 1, 45);
    expect((await results(await a.sync([late])))[0]!.outcome).toBe("review");
    expect(stored(late.id)).toMatchObject({ applied: 0, review: "NOT_ELIGIBLE" });
    expect(onHand(toner)).toBe(5);
    expect((await resolve(late.id, { action: "dismiss", note: "Not taken" })).status).toBe(200);
    expect(onHand(toner)).toBe(5);
  });
});

describe("Use (open-unit Consumables)", () => {
  it("is offered instead of Take, records who used it, and never changes stock, however often it is replayed", async () => {
    const paper = await consumable("A4 Bond Paper", 8, { consumptionMode: "OPEN_UNIT" });
    const water = await consumable("Bottled Water", 5);
    const catalog = await (await call("/api/self-service/catalog")).json() as { items: Array<{ id: string; action: string }> };
    expect(catalog.items.map((entry) => [entry.id, entry.action])).toEqual([[paper, "USE"], [water, "TAKE"]]);
    const device = phone();
    const use = { ...device.take(paper, 1), type: "USE" };
    expect(await results(await device.sync([use]))).toEqual([{ id: use.id, outcome: "accepted" }]);
    expect(await results(await device.sync([use]))).toEqual([{ id: use.id, outcome: "accepted", duplicate: true }]);
    expect(onHand(paper)).toBe(8);
    expect(stored(use.id)).toMatchObject({ event_type: "USE", quantity: 1, applied: 1, movement_id: null, review: null, student_id: "20-1234-567" });
    // No amount is ever asked or accepted.
    const amount = { ...device.take(paper, 2), type: "USE" };
    expect(await results(await device.sync([amount]))).toEqual([{ id: amount.id, outcome: "rejected", message: "A use has no amount." }]);
  });

  it("routes by the item, never the person: a take of an open-unit item is refused live and held late, a use of a whole-unit item likewise", async () => {
    const paper = await consumable("A4 Bond Paper", 8, { consumptionMode: "OPEN_UNIT" });
    const water = await consumable("Bottled Water", 5);
    const device = phone();
    const [take, use] = [device.take(paper, 1), { ...device.take(water, 1), type: "USE" }];
    expect((await results(await device.sync([take, use]))).map((result) => result.outcome)).toEqual(["rejected", "rejected"]);
    const [lateTake, lateUse] = [device.take(paper, 1, 60), { ...device.take(water, 1, 60), type: "USE" }];
    expect((await results(await device.sync([lateTake, lateUse]))).map((result) => result.outcome)).toEqual(["review", "review"]);
    expect([onHand(paper), onHand(water)]).toEqual([8, 5]);
    // Applying a held use only accepts the record.
    expect((await resolve(lateUse.id, { action: "apply" })).status).toBe(200);
    expect(stored(lateUse.id)).toMatchObject({ applied: 1, movement_id: null });
    expect(onHand(water)).toBe(5);
  });
});

describe("Borrow and Return", () => {
  it("a borrow saved but whose answer was lost keeps its photo, and the phone's resend is recognised (R5)", async () => {
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    const borrow = a.borrow(scissors, 5);
    // The batch that lends (movement, loan, audit, phone record, revision) commits, then the connection drops before the Worker hears back.
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = (async (statements: D1PreparedStatement[]) => {
      if (statements.length < 3) return batch(statements);
      env.DB.batch = batch;
      await batch(statements);
      throw new Error("network lost");
    }) as D1Database["batch"];
    await a.sync([borrow]);
    expect(loan(borrow.id)).toMatchObject({ status: "OUT" });
    const key = loan(borrow.id)!.photo_key as string;
    expect(photos.has(key)).toBe(true);
    // The phone resends; nothing new is lent and the photo stays.
    expect(await results(await a.sync([borrow]))).toEqual([{ id: borrow.id, outcome: "accepted", duplicate: true }]);
    expect(onHand(scissors)).toBe(4);
    expect(photos.has(key)).toBe(true);
  });

  it("lends offline with the Part 4 rules and a photo in R2 that only staff can open", async () => {
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    // "Return by today", judged on the Manila calendar of the day it was borrowed.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() - 30 * MINUTE));
    const borrow = a.borrow(scissors, 30, { returnBy: today });
    expect(await results(await a.sync([borrow]))).toEqual([{ id: borrow.id, outcome: "accepted" }]);
    expect(loan(borrow.id)).toMatchObject({ status: "OUT", purpose: "INDIVIDUAL", student_id: "20-1234-567", created_by: "SELF_SERVICE" });
    expect([...photos.keys()]).toEqual([expect.stringMatching(new RegExp(`^loans/LN-SS-${borrow.id}-[0-9a-f]{8}$`))]);
    expect((await call(`/api/staff/loans/LN-SS-${borrow.id}/photo`)).status).toBe(401);
    const photo = await staff(`/api/staff/loans/LN-SS-${borrow.id}/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("cache-control")).toBe("private, no-store");
    const overview = await (await staff("/api/staff/loans")).json() as { open: Array<{ id: string; createdBy: string }> };
    expect(overview.open).toEqual([expect.objectContaining({ id: `LN-SS-${borrow.id}`, createdBy: "Self-Service" })]);
    expect(onHand(scissors)).toBe(4);
  });

  it("applies the Part 4 identity rules: Individual needs a student ID, USC use a reason; USC-only items refuse individual use", async () => {
    const scissors = await loanable("Scissors", 5);
    const projector = await loanable("Projector", 1, { lendingAudience: "USC_STAFF_ONLY" });
    const a = phone();
    const noId = a.borrow(scissors, 0, { person: { name: "Ana" } });
    const noReason = a.borrow(scissors, 0, { purpose: "USC", person: { name: "Ana" } });
    const individual = a.borrow(projector);
    const usc = a.borrow(projector, 0, { purpose: "USC", reason: "Stage setup for the general assembly", person: { name: "Ana" } });
    expect((await results(await a.sync([noId, noReason, individual, usc]))).map((result) => [result.outcome, result.message])).toEqual([
      ["rejected", "Student ID number is required."],
      ["rejected", "Specific reason is required."],
      ["rejected", "This item is lent for USC use only."],
      ["accepted", undefined]
    ]);
  });

  it("holds a return with its photo until staff confirm it, and only then updates stock", async () => {
    const scissors = await loanable("Scissors", 1);
    const [a, b] = [phone(), phone()];
    const aBorrow = a.borrow(scissors, 60);
    const aReturn = a.giveBack(scissors, aBorrow.id, 30);
    const bBorrow = b.borrow(scissors, 25);
    const bReturn = b.giveBack(scissors, bBorrow.id, 5);
    expect((await results(await b.sync([bBorrow, bReturn]))).map((result) => result.outcome)).toEqual(["accepted", "review"]);
    expect((await results(await a.sync([aBorrow, aReturn]))).map((result) => result.outcome)).toEqual(["accepted", "review"]);
    // Nothing came back yet: both loans are out, and no stock moved for either return.
    expect([loan(aBorrow.id)!.status, loan(bBorrow.id)!.status, onHand(scissors)]).toEqual(["OUT", "OUT", -1]);
    expect(stored(aReturn.id)).toMatchObject({ applied: 0, review: "RETURN_CHECK", loan_id: `LN-SS-${aBorrow.id}` });
    expect(String(stored(aReturn.id)!.photo_key)).toMatch(/^returns\//);
    const queue = await review();
    expect(queue.open.map((entry) => entry.review)).toEqual(["RETURN_CHECK", "RETURN_CHECK"]);
    // Staff confirm the photos: each loan closes and the quantity goes back on the shelf.
    for (const [returned, borrow] of [[aReturn, aBorrow], [bReturn, bBorrow]] as const) {
      expect((await resolve(returned.id, { action: "match", loanId: `LN-SS-${borrow.id}` })).status).toBe(200);
    }
    expect([loan(aBorrow.id)!.status, loan(bBorrow.id)!.status, onHand(scissors)]).toEqual(["RETURNED", "RETURNED", 1]);
    expect(loan(aBorrow.id)).toMatchObject({ closed_by: "SELF_SERVICE" });
    expect(stored(aReturn.id)).toMatchObject({ applied: 1, resolved_by: expect.any(String) });
    expect(stored(aReturn.id)!.photo_key).toBeTruthy();
    expect((await review()).open).toEqual([]);
  });

  it("refuses a return without a usable photo, and leaves the loan out when staff say it was not returned", async () => {
    const scissors = await loanable("Scissors", 2);
    const p = phone();
    const borrow = p.borrow(scissors, 20);
    const noPhoto = p.giveBack(scissors, borrow.id, 5);
    await p.sync([borrow]);
    const missing = await results(await p.sync([noPhoto], { photoFor: [] }));
    expect(missing[0]).toMatchObject({ outcome: "rejected" });
    expect(missing[0]!.message).toContain("photo");
    expect(stored(noPhoto.id)).toBeUndefined();
    const withPhoto = p.giveBack(scissors, borrow.id, 4);
    expect((await results(await p.sync([withPhoto])))[0]!.outcome).toBe("review");
    expect((await resolve(withPhoto.id, { action: "dismiss", note: "The photo shows a different item." })).status).toBe(200);
    expect([loan(borrow.id)!.status, onHand(scissors)]).toEqual(["OUT", 1]);
    expect(stored(withPhoto.id)).toMatchObject({ applied: 0, resolution_note: "The photo shows a different item." });
  });

  it("allows overlapping loans that fit, and flags only an impossible overlap", async () => {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    expect((await results(await a.sync([a.borrow(scissors, 30)])))[0]!.outcome).toBe("accepted");
    expect((await results(await b.sync([b.borrow(scissors, 20)])))[0]!.outcome).toBe("accepted");
    expect((await review()).stockIssues).toEqual([]);
    const tape = await loanable("Tape Gun", 1);
    const [c, d] = [phone(), phone()];
    await c.sync([c.borrow(tape, 30)]);
    const second = d.borrow(tape, 20);
    expect((await results(await d.sync([second])))[0]!.outcome).toBe("accepted");
    expect(loan(second.id)).toMatchObject({ status: "OUT" });
    expect((await review()).stockIssues).toEqual([expect.objectContaining({ itemId: tape, lowest: -1, openLoans: 2 })]);
  });

  it("keeps damaged and lost items off the shelf and needs a note for them", async () => {
    const scissors = await loanable("Scissors", 2);
    const a = phone();
    const [one, two] = [a.borrow(scissors, 40), a.borrow(scissors, 39)];
    await a.sync([one, two]);
    const noNote = a.giveBack(scissors, one.id, 10, { outcome: "DAMAGED" });
    const damaged = a.giveBack(scissors, one.id, 9, { outcome: "DAMAGED", note: "Blade bent" });
    const lost = a.giveBack(scissors, two.id, 8, { outcome: "LOST", note: "Left at the gym" });
    expect((await results(await a.sync([noNote, damaged, lost]))).map((result) => [result.outcome, result.outcome === "rejected" ? result.message : undefined])).toEqual([["rejected", "The damage is required."], ["review", undefined], ["review", undefined]]);
    for (const [returned, borrow] of [[damaged, one], [lost, two]] as const) expect((await resolve(returned.id, { action: "match", loanId: `LN-SS-${borrow.id}` })).status).toBe(200);
    expect([loan(one.id)!.status, loan(two.id)!.status, onHand(scissors)]).toEqual(["DAMAGED", "LOST", 0]);
  });

  it("refuses any return that is not for a borrow made on this phone, storing nothing", async () => {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    const borrow = a.borrow(scissors, 60);
    await a.sync([borrow]);
    // The loan's own name and student ID, and a stranger's: neither can return it without the link.
    const sameDetails = b.giveBack(scissors, null, 10);
    const stranger = b.giveBack(scissors, null, 9, { person: { name: "Someone Else", studentId: "99-9999-999" } });
    const answers = await results(await b.sync([sameDetails, stranger]));
    expect(answers.map((result) => result.outcome)).toEqual(["rejected", "rejected"]);
    expect(answers[0]!.message).toContain("Return anything else at the Logistics desk");
    expect(loan(borrow.id)).toMatchObject({ status: "OUT" });
    expect([stored(sameDetails.id), stored(stranger.id)]).toEqual([undefined, undefined]);
    expect(onHand(scissors)).toBe(4);
  });

  it("refuses a return linked to a borrow this phone did not make, or to a borrow that was refused", async () => {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    const borrow = a.borrow(scissors, 60, { person: { name: "Maria", studentId: "21-0000-001" } });
    await a.sync([borrow]);
    const forged = b.giveBack(scissors, borrow.id, 5, { person: { name: "Mallory", studentId: "21-0000-002" } });
    const refusal = { outcome: "rejected", message: "The borrow this return belongs to was not recorded. Please see Logistics staff." };
    expect(await results(await b.sync([forged]))).toEqual([{ id: forged.id, ...refusal }]);
    expect(loan(borrow.id)).toMatchObject({ status: "OUT" });
    expect(stored(forged.id)).toBeUndefined();
    // A borrow refused earlier in the same batch takes its return with it.
    const noId = b.borrow(scissors, 2, { person: { name: "Ana" } });
    const itsReturn = b.giveBack(scissors, noId.id, 1);
    expect((await results(await b.sync([noId, itsReturn]))).map((result) => result.outcome)).toEqual(["rejected", "rejected"]);
    expect(stored(itsReturn.id)).toBeUndefined();
  });

  it("lets staff confirm a return against an open loan, closing it when the return happened", async () => {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    const borrow = a.borrow(scissors, 60, { person: { name: "Maria Santos", studentId: "21-0000-001" } });
    await a.sync([borrow]);
    const unmatched = a.giveBack(scissors, borrow.id, 15);
    await a.sync([unmatched]);
    const queue = await review();
    expect(queue.open.map((entry) => [entry.id, entry.review])).toEqual([[unmatched.id, "RETURN_CHECK"]]);
    expect(queue.candidates.map((entry) => entry.id)).toEqual([`LN-SS-${borrow.id}`]);
    expect((await call(`/api/staff/self-service/${unmatched.id}/resolve`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    const resolved = await resolve(unmatched.id, { action: "match", loanId: `LN-SS-${borrow.id}`, note: "Same person" });
    expect(resolved.status).toBe(200);
    expect(loan(borrow.id)).toMatchObject({ status: "RETURNED", closed_at: stored(unmatched.id)!.occurred_at });
    expect(stored(unmatched.id)).toMatchObject({ applied: 1, resolved_by: "ACC-1", resolution_note: "Same person" });
    expect(onHand(scissors)).toBe(5);
  });

  it("stops a batch at the first transient failure so a return is never processed before its borrow", async () => {
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    const borrow = a.borrow(scissors, 20);
    const giveBack = a.giveBack(scissors, borrow.id, 10);
    const put = env.EVIDENCE.put;
    env.EVIDENCE.put = async () => { throw new Error("R2 unavailable"); };
    expect((await results(await a.sync([borrow, giveBack]))).map((result) => result.outcome)).toEqual(["retry", "retry"]);
    expect([stored(borrow.id), stored(giveBack.id), loan(borrow.id)]).toEqual([undefined, undefined, undefined]);
    env.EVIDENCE.put = put;
    expect((await results(await a.sync([borrow, giveBack]))).map((result) => result.outcome)).toEqual(["accepted", "review"]);
    expect(photos.size).toBe(2);
  });

  it("refuses a borrow without a valid photo, keeps a held borrow's photo for staff, and deletes it when dismissed", async () => {
    const scissors = await loanable("Scissors", 5);
    const drill = await loanable("Drill", 1, { lendingAudience: "NOT_AVAILABLE_FOR_LENDING" });
    const a = phone();
    const late = a.borrow(scissors, 30);
    expect((await results(await a.sync([late], { photoFor: [] })))[0]).toMatchObject({ outcome: "rejected", message: "A photo is required. Take the photo again and borrow once more." });
    const held = a.borrow(drill, 30);
    expect((await results(await a.sync([held])))[0]!.outcome).toBe("review");
    expect(stored(held.id)).toMatchObject({ applied: 0, review: "NOT_ELIGIBLE" });
    expect((await staff(`/api/staff/self-service/${held.id}/photo`)).status).toBe(200);
    expect((await call(`/api/staff/self-service/${held.id}/photo`)).status).toBe(401);
    expect(photos.size).toBe(1);
    expect((await resolve(held.id, { action: "dismiss" })).status).toBe(200);
    expect(photos.size).toBe(0);
    expect(onHand(drill)).toBe(1);
  });
});

describe("business time and counts", () => {
  it("accepts a return-by date of the day it was borrowed, even when it syncs the next day", async () => {
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    const borrowDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() - 26 * 60 * MINUTE));
    const borrow = a.borrow(scissors, 26 * 60, { returnBy: borrowDay });
    expect(await results(await a.sync([borrow]))).toEqual([{ id: borrow.id, outcome: "accepted" }]);
    expect(loan(borrow.id)).toMatchObject({ return_by: borrowDay });
  });

  it("holds a borrow recorded more than 30 days ago instead of refusing its return-by date", async () => {
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    const borrow = a.borrow(scissors, 40 * 24 * 60, { returnBy: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() - 39 * 24 * 60 * MINUTE)) });
    expect((await results(await a.sync([borrow])))[0]).toMatchObject({ outcome: "review", message: "Saved for staff to confirm: your phone's clock looked wrong." });
    expect(stored(borrow.id)).toMatchObject({ review: "CLOCK", applied: 0, photo_key: expect.stringMatching(/^loans\//) });
  });

  it("lets a later count supersede a borrow and a return it already saw", async () => {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    const borrowed = b.borrow(scissors, 50);
    await b.sync([borrowed]);
    // Recorded offline before a count: one borrowed, the other one brought back. The count finds 3.
    const early = a.borrow(scissors, 60);
    const returned = b.giveBack(scissors, borrowed.id, 40);
    await count(scissors, 3);
    expect((await results(await a.sync([early])))[0]!.outcome).toBe("accepted");
    expect((await results(await b.sync([returned])))[0]!.outcome).toBe("review");
    expect((await resolve(returned.id, { action: "match", loanId: `LN-SS-${borrowed.id}` })).status).toBe(200);
    expect([loan(early.id)!.status, loan(borrowed.id)!.status, onHand(scissors)]).toEqual(["OUT", "RETURNED", 3]);
    const status = (loanId: string, type: string) => (sqlite.prepare("SELECT status FROM inventory_movements WHERE related_entity_id = ? AND movement_type = ?").get(`LN-SS-${loanId}`, type) as { status: string }).status;
    expect([status(early.id, "LOAN_OUT"), status(borrowed.id, "LOAN_OUT"), status(borrowed.id, "LOAN_RETURN")]).toEqual(["SUPERSEDED", "POSTED", "SUPERSEDED"]);
  });

  it("asks for a count when a late take just before a count leaves the shelf below zero", async () => {
    const water = await consumable("Bottled Water", 2);
    await count(water, 1);
    const a = phone();
    const late = a.take(water, 2, 3);
    expect((await results(await a.sync([late])))[0]).toMatchObject({ outcome: "review" });
    expect(onHand(water)).toBe(-1);
    expect((await review()).stockIssues).toEqual([expect.objectContaining({ itemId: water, lowest: -1 })]);
  });
});

describe("staff review", () => {
  async function unmatchedReturn() {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    const [first, second] = [a.borrow(scissors, 60), a.borrow(scissors, 59)];
    await a.sync([first, second]);
    const unmatched = a.giveBack(scissors, first.id, 15);
    await a.sync([unmatched]);
    return { scissors, first: `LN-SS-${first.id}`, second: `LN-SS-${second.id}`, unmatched: unmatched.id };
  }
  const loanStatus = (id: string) => (sqlite.prepare("SELECT status FROM loans WHERE id = ?").get(id) as { status: string }).status;

  it("closes only one loan when two staff match the same return at once", async () => {
    const { scissors, first, second, unmatched } = await unmatchedReturn();
    meanwhile(() => resolve(unmatched, { action: "match", loanId: first }));
    const late = await resolve(unmatched, { action: "match", loanId: second });
    expect(late.status).toBe(409);
    expect([loanStatus(first), loanStatus(second), onHand(scissors)]).toEqual(["RETURNED", "OUT", 4]);
    expect(stored(unmatched)).toMatchObject({ applied: 1, loan_id: first });
  });

  it("does not record a match when the loan was closed at the desk a moment earlier", async () => {
    const { first, unmatched } = await unmatchedReturn();
    meanwhile(() => staff(`/api/staff/loans/${first}/return`, "POST", { outcome: "LOST", note: "Reported lost at the desk" }));
    expect((await resolve(unmatched, { action: "match", loanId: first })).status).toBe(409);
    expect(loanStatus(first)).toBe("LOST");
    expect(stored(unmatched)).toMatchObject({ applied: 0, resolved_at: null });
  });

  it("never applies a dismissed borrow, and never deletes an applied borrow's photo", async () => {
    const drill = await loanable("Drill", 2, { lendingAudience: "NOT_AVAILABLE_FOR_LENDING" });
    const a = phone();
    const [one, two] = [a.borrow(drill, 30), a.borrow(drill, 29)];
    await a.sync([one, two]);
    meanwhile(() => resolve(one.id, { action: "dismiss" }));
    expect((await resolve(one.id, { action: "apply" })).status).toBe(409);
    expect([loan(one.id), onHand(drill)]).toEqual([undefined, 2]);
    meanwhile(() => resolve(two.id, { action: "apply" }));
    expect((await resolve(two.id, { action: "dismiss" })).status).toBe(409);
    expect(loan(two.id)).toMatchObject({ status: "OUT" });
    expect(photos.has(loan(two.id)!.photo_key as string)).toBe(true);
    // The database itself keeps a resolution final.
    expect(() => sqlite.prepare("UPDATE self_service_events SET resolution_note = 'changed' WHERE id = ?").run(two.id)).toThrow(/self_service_event_resolved/);
  });

  it("keeps a borrow's photo when an unexpected error holds it, so staff can still apply it", async () => {
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    const borrow = a.borrow(scissors, 10);
    // The lookup batch passes; the loan batch fails once.
    meanwhile(async () => { throw new Error("D1 overloaded"); }, 1);
    expect((await results(await a.sync([borrow])))[0]).toMatchObject({ outcome: "review", message: "Saved for staff to check." });
    expect(stored(borrow.id)).toMatchObject({ review: "ERROR", applied: 0, photo_key: expect.stringMatching(/^loans\//) });
    expect(photos.size).toBe(1);
    expect((await resolve(borrow.id, { action: "apply" })).status).toBe(200);
    expect(loan(borrow.id)).toMatchObject({ status: "OUT", photo_key: stored(borrow.id)!.photo_key });
  });

  it("refuses to apply a held borrow that has no photo", async () => {
    const drill = await loanable("Drill", 1, { lendingAudience: "NOT_AVAILABLE_FOR_LENDING" });
    const a = phone();
    const borrow = a.borrow(drill, 30);
    await a.sync([borrow]);
    sqlite.prepare("UPDATE self_service_events SET photo_key = NULL WHERE id = ?").run(borrow.id);
    expect((await resolve(borrow.id, { action: "apply" })).status).toBe(400);
    expect(loan(borrow.id)).toBeUndefined();
  });
});

describe("self-service security", () => {
  it("rejects cross-origin, malformed and oversized sync requests", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    expect((await a.sync([a.take(water, 1)], { origin: "https://evil.example" })).status).toBe(403);
    expect((await a.sync([])).status).toBe(400);
    expect((await a.sync(Array.from({ length: 6 }, () => a.take(water, 1)))).status).toBe(400);
    const bad = [
      { ...a.take(water, 1), id: "not-a-uuid" },
      { ...a.take(water, 0) },
      { ...a.take(water, 51) },
      { ...a.take(water, 1), quantity: 1.5 },
      { ...a.take(water, 1), type: "DELETE" },
      { ...a.take(water, 1), itemId: "ITM-9999" },
      { ...a.take(water, 1), v: 2 },
      { ...a.take(water, 1), person: { name: "  " } }
    ];
    const outcomes = [...await results(await a.sync(bad.slice(0, 4))), ...await results(await a.sync(bad.slice(4)))];
    expect(outcomes.map((result) => result.outcome)).toEqual(Array(8).fill("rejected"));
    expect(onHand(water)).toBe(20);
    const sync = (headers: Record<string, string>) => call("/api/self-service/sync", { method: "POST", headers: { origin, ...headers }, body: "x" });
    expect((await sync({})).status).toBe(411);
    expect((await sync({ "content-length": String(13 * 1024 * 1024) })).status).toBe(413);
    const scissors = await loanable("Scissors", 5);
    const huge = new Uint8Array(2 * 1024 * 1024 + 1);
    huge.set(JPEG);
    const borrow = a.borrow(scissors);
    expect((await results(await a.sync([borrow], { photo: huge })))[0]).toMatchObject({ outcome: "rejected", message: "The photo is too large. Take it again and borrow once more." });
    expect(photos.size).toBe(0);
  });

  it("stores hostile text as plain text, and holds a record whose clock cannot be trusted", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    const hostile = { ...a.take(water, 1), person: { name: "<img src=x onerror=alert(1)>\u0000\u202e Bob" }, occurredAt: "2099-01-01T00:00:00.000Z" };
    expect((await results(await a.sync([hostile])))[0]).toMatchObject({ outcome: "review", message: "Saved for staff to confirm: your phone's clock looked wrong." });
    expect(stored(hostile.id)).toMatchObject({ person_name: "<img src=x onerror=alert(1)> Bob", review: "CLOCK", applied: 0 });
    expect(onHand(water)).toBe(20);
  });

  it("corrects a wrong phone clock by the send time on the same clock", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    // The phone runs 3 hours slow: it recorded the take 40 minutes before it sent it.
    const slow = (ms: number) => new Date(ms - 3 * 60 * MINUTE).toISOString();
    const take = { ...a.take(water, 1), occurredAt: slow(Date.now() - 40 * MINUTE) };
    await a.sync([take], { sentAt: slow(Date.now()) });
    const row = stored(take.id)!;
    expect(Math.abs(Date.parse(row.received_at as string) - Date.parse(row.occurred_at as string) - 40 * MINUTE)).toBeLessThan(2000);
    expect(row.review).toBeNull();
  });

  it("limits how many records one network can leave for staff in a day", async () => {
    const scissors = await loanable("Scissors", 5);
    const drill = await loanable("Drill", 5, { lendingAudience: "NOT_AVAILABLE_FOR_LENDING" });
    for (let round = 0; round < 15; round += 1) {
      const a = phone();
      expect((await results(await a.sync(Array.from({ length: 4 }, () => a.borrow(drill, 30))))).every((result) => result.outcome === "review")).toBe(true);
    }
    const a = phone();
    expect((await results(await a.sync([a.borrow(drill, 30)])))[0]).toMatchObject({ outcome: "rejected", message: "Too many records from this network need a staff check today. Please see Logistics staff." });
  });

  it("groups IPv6 addresses by their /64 network", () => {
    const from = (address: string) => networkOf(new Request(origin, { headers: { "CF-Connecting-IP": address } }));
    expect(from("2001:db8:85a3::8a2e:370:7334")).toBe("2001:0db8:85a3:0000::/64");
    expect(from("2001:DB8:85A3:0:1::1")).toBe("2001:0db8:85a3:0000::/64");
    expect(from("::1")).toBe("0000:0000:0000:0000::/64");
    expect(from("203.0.113.9")).toBe("203.0.113.9");
  });

  it("rate-limits one phone and keeps the review API staff-only", async () => {
    const water = await consumable("Bottled Water", 500);
    const a = phone();
    for (let round = 0; round < 20; round += 1) expect((await a.sync(Array.from({ length: 5 }, () => a.take(water, 1)))).status).toBe(200);
    expect((await a.sync([a.take(water, 1)])).status).toBe(429);
    expect((await call("/api/staff/self-service")).status).toBe(401);
  });
});

describe("Self-Service identity (record version 2)", () => {
  it("holds every new record to a name, an exactly eight-digit Student ID and a photo, whatever the phone checked", async () => {
    const water = await consumable("Bottled Water", 50);
    const paper = await consumable("A4 Bond Paper", 8, { consumptionMode: "OPEN_UNIT" });
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    const bad = ["1234567", "123456789", "12-345678", "ABC12345", "12A45678", "1234 5678", "２１０００１１５"];
    for (const studentId of bad) {
      const events = [a.current("TAKE", water, { person: { name: "Maria Santos", studentId } }), a.current("USE", paper, { person: { name: "Maria Santos", studentId } }), a.current("BORROW", scissors, { person: { name: "Maria Santos", studentId } })];
      const sent = await results(await a.sync(events));
      expect(sent.map((result) => result.outcome), studentId).toEqual(["rejected", "rejected", "rejected"]);
      expect(sent.map((result) => result.message), studentId).toEqual(Array(3).fill("Student ID number must be exactly 8 digits."));
    }
    // A missing ID or name is refused the same way; nothing was recorded.
    const missing = [a.current("TAKE", water, { person: { name: "Maria Santos" } }), a.current("TAKE", water, { person: { studentId: "21000115" } }), a.current("BORROW", scissors, { purpose: "USC", person: { name: "Maria Santos" } })];
    expect((await results(await a.sync(missing))).map((result) => result.outcome)).toEqual(["rejected", "rejected", "rejected"]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM self_service_events").get()).toEqual({ n: 0 });
    expect(onHand(water)).toBe(50);
    expect(photos.size).toBe(0);
  });

  it("records a Take, a Use and a Borrow with the Student ID and a private photo, and replays them without a second copy", async () => {
    const water = await consumable("Bottled Water", 50);
    const paper = await consumable("A4 Bond Paper", 8, { consumptionMode: "OPEN_UNIT" });
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    const take = a.current("TAKE", water, { quantity: 2 });
    const use = a.current("USE", paper);
    const borrow = a.current("BORROW", scissors);
    expect((await results(await a.sync([take, use, borrow]))).map((result) => result.outcome)).toEqual(["accepted", "accepted", "accepted"]);
    expect([take, use, borrow].map((entry) => stored(entry.id)!.student_id)).toEqual(["21000115", "21000115", "21000115"]);
    expect(onHand(water)).toBe(48);
    expect(onHand(paper)).toBe(8);
    expect(onHand(scissors)).toBe(4);
    const keys = [take, use].map((entry) => stored(entry.id)!.photo_key as string);
    expect(keys).toEqual([expect.stringMatching(new RegExp(`^phone/${take.id}-[0-9a-f]{8}$`)), expect.stringMatching(new RegExp(`^phone/${use.id}-[0-9a-f]{8}$`))]);
    expect(keys.every((key) => photos.has(key))).toBe(true);
    expect(photos.size).toBe(3);
    // Staff can open the photo; the open Self-Service pages cannot.
    expect((await call(`/api/staff/self-service/${take.id}/photo`)).status).toBe(401);
    const opened = await staff(`/api/staff/self-service/${take.id}/photo`);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("cache-control")).toBe("private, no-store");
    // The phone resends the same batch: nothing is applied or stored a second time.
    expect((await results(await a.sync([take, use, borrow]))).map((result) => result.duplicate)).toEqual([true, true, true]);
    expect(onHand(water)).toBe(48);
    expect(photos.size).toBe(3);
  });

  it("refuses a Take, a Use or a Borrow that arrives without its photo, and a return without one is never closed", async () => {
    const water = await consumable("Bottled Water", 50);
    const paper = await consumable("A4 Bond Paper", 8, { consumptionMode: "OPEN_UNIT" });
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    const events = [a.current("TAKE", water), a.current("USE", paper), a.current("BORROW", scissors)];
    const sent = await results(await a.sync(events, { photoFor: [] }));
    expect(sent.map((result) => result.outcome)).toEqual(["rejected", "rejected", "rejected"]);
    expect(sent.every((result) => /photo/i.test(result.message ?? ""))).toBe(true);
    expect(onHand(water)).toBe(50);
    expect(onHand(scissors)).toBe(5);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM self_service_events").get()).toEqual({ n: 0 });
  });

  it("still accepts what an older phone saved before the rule, without a photo for a Take, and keeps the wider ID pattern for it", async () => {
    const water = await consumable("Bottled Water", 50);
    const a = phone();
    const old = a.take(water, 1);
    const odd = { ...a.take(water, 1), person: { name: "Juan Dela Cruz", studentId: "20-1234-567" } };
    expect((await results(await a.sync([old, odd]))).map((result) => result.outcome)).toEqual(["accepted", "accepted"]);
    expect(stored(old.id)).toMatchObject({ student_id: "20-1234-567", photo_key: null });
    expect(onHand(water)).toBe(48);
    expect(photos.size).toBe(0);
    // The wider pattern still refuses what is not an ID at all.
    const garbage = { ...a.take(water, 1), person: { name: "Juan Dela Cruz", studentId: "not an id!" } };
    expect((await results(await a.sync([garbage])))[0]).toMatchObject({ outcome: "rejected" });
  });

  it("notes when the rule began with the first record saved under it, once, so Attention asks only about records after it", async () => {
    const water = await consumable("Bottled Water", 50);
    const a = phone();
    const marker = () => (sqlite.prepare("SELECT value FROM system_settings WHERE key = 'identity_rule_from'").get() as { value: string } | undefined)?.value;
    const flagged = async () => ((await (await staff("/api/staff/attention")).json()) as { entries: Array<{ reason: string; why: string }> }).entries.filter((entry) => entry.reason === "IDENTITY_REVIEW");
    // A record an older phone saved before the rule changes nothing: there is no rule yet to hold it to.
    const early = { ...a.take(water, 1), person: { name: "Juan" } };
    expect((await results(await a.sync([early])))[0]!.outcome).toBe("accepted");
    expect(marker()).toBeUndefined();
    expect(await flagged()).toEqual([]);
    const first = a.current("TAKE", water);
    await a.sync([first]);
    const began = stored(first.id)!.received_at as string;
    expect(marker()).toBe(began);
    await a.sync([a.current("TAKE", water)]);
    expect(marker()).toBe(began);
    // From then on an older phone's record without the identity is asked about; a new one is not.
    const late = { ...a.take(water, 1), person: { name: "Juan" } };
    expect((await results(await a.sync([late])))[0]!.outcome).toBe("accepted");
    expect((await flagged()).map((entry) => entry.why)).toEqual(["Juan gave no student ID number."]);
  });
});

