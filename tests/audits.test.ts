import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/* V1.7 Physical inventory by location: checking a place, what an observation may and may not change, and the review that settles it. */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let one: string;
let two: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (cookie: string, path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, unknown>>(response: Response | Promise<Response>) => (await (await response).json()) as T;

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
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

async function place(name: string, parentId: string | null = null): Promise<string> {
  const response = await as(one, "/api/staff/locations", "POST", { name, parentId });
  expect(response.status).toBe(201);
  return (await json<{ id: string }>(response)).id;
}
const base = { category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
async function item(name: string, locationId: string, quantity = 5, fields: Record<string, unknown> = {}): Promise<string> {
  const response = await as(one, "/api/staff/items", "POST", { ...base, name, locationId, openingQuantity: quantity, ...fields });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await json<{ id: string }>(response)).id;
}
const onHand = (id: string) => (sqlite.prepare("SELECT on_hand FROM inventory_balances WHERE id = ?").get(id) as { on_hand: number }).on_hand;
const movementsOf = (id: string) => (sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE item_id = ?").get(id) as { n: number }).n;
const locationOf = (id: string) => (sqlite.prepare("SELECT location_id AS id FROM items WHERE id = ?").get(id) as { id: string | null }).id;

let counter = 0;
const requestId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const auditId = () => `LA-00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`;

async function start(cookie: string, locationId: string, id?: string): Promise<string> {
  const response = await as(cookie, "/api/staff/audits", "POST", { locationId, ...(id ? { id } : {}) });
  expect([200, 201], JSON.stringify(await response.clone().json())).toContain(response.status);
  return (await json<{ id: string }>(response)).id;
}
const observe = (cookie: string, audit: string, body: Record<string, unknown>) => as(cookie, `/api/staff/audits/${audit}/observations`, "POST", { id: requestId(), observedAt: new Date().toISOString(), ...body });
const detail = (cookie: string, audit: string) => json<{ audit: { status: string; mine: boolean; expectedAtStart: number }; items: Array<{ id: string; onHand: number; observation: { outcome: string } | null }>; extras: Array<{ outcome: string; name: string }>; checked: number }>(as(cookie, `/api/staff/audits/${audit}`));
const review = (cookie: string, audit: string) => json<{ discrepancies: Array<{ id: string; itemId: string | null; outcome: string; changedSince: boolean; resolution: string | null }> }>(as(cookie, `/api/staff/audits/${audit}/review`));
const resolve = (cookie: string, observation: string, body: Record<string, unknown>) => as(cookie, `/api/staff/audits/observations/${observation}/resolve`, "POST", body);
const finish = (cookie: string, audit: string) => as(cookie, `/api/staff/audits/${audit}/finish`, "POST");

describe("starting a check", () => {
  it("expects every active item at the place and the places inside it, and is audited", async () => {
    const room = await place("Audit room");
    const shelf = await place("Shelf A", room);
    await item("Tape", room);
    await item("Glue", shelf);
    await item("Old stapler", shelf, 1, { status: "INACTIVE" });
    await item("Elsewhere", await place("Other room"));
    const id = await start(one, room);
    const shown = await detail(one, id);
    expect(shown.audit).toMatchObject({ status: "OPEN", mine: true, expectedAtStart: 2 });
    expect(shown.items.map((entry) => entry.id)).toHaveLength(2);
    expect(shown.checked).toBe(0);
    expect(sqlite.prepare("SELECT action, entity_type AS type FROM audit_log WHERE entity_id = ?").all(id)).toEqual([{ action: "AUDIT_STARTED", type: "AUDIT" }]);
  });

  it("resumes the person's own open check of a place, refuses a second person, and allows one per place", async () => {
    const room = await place("Audit room");
    const id = await start(one, room);
    const again = await as(one, "/api/staff/audits", "POST", { locationId: room });
    expect(again.status).toBe(200);
    expect(await json(again)).toEqual({ id, resumed: true });
    const theirs = await as(two, "/api/staff/audits", "POST", { locationId: room });
    expect(theirs.status).toBe(409);
    expect((await json<{ error: string }>(theirs)).error).toContain("Staff One is already checking this place");
    // Another place is free.
    expect(await start(two, await place("Store"))).toMatch(/^LA-/);
  });

  it("starts under the id a device proposed offline, and never lets another person reuse it", async () => {
    const room = await place("Audit room");
    const proposed = auditId();
    expect(await start(one, room, proposed)).toBe(proposed);
    await finish(one, proposed);
    const reused = await as(two, "/api/staff/audits", "POST", { locationId: await place("Store"), id: proposed });
    expect(reused.status).toBe(409);
  });
});

describe("observing", () => {
  it("records each outcome as seen and never changes stock, a place or an item", async () => {
    const room = await place("Audit room");
    const other = await place("Other room");
    const tape = await item("Tape", room, 5);
    const glue = await item("Glue", room, 3);
    const pens = await item("Pens", room, 10);
    const label = await item("Labels", room, 2);
    const stray = await item("Stray scissors", other, 1);
    const id = await start(one, room);
    const before = [tape, glue, pens, label, stray].map((each) => [onHand(each), movementsOf(each), locationOf(each)]);
    expect((await observe(one, id, { itemId: tape, outcome: "CONFIRMED", expectedOnHand: 5 })).status).toBe(201);
    expect((await observe(one, id, { itemId: glue, outcome: "MISMATCH", expectedOnHand: 3, counted: 1 })).status).toBe(201);
    expect((await observe(one, id, { itemId: pens, outcome: "CANT_FIND", expectedOnHand: 10 })).status).toBe(201);
    expect((await observe(one, id, { itemId: label, outcome: "NEEDS_REVIEW", note: "It is a box of labels, not single labels" })).status).toBe(201);
    expect((await observe(one, id, { itemId: stray, outcome: "FOUND_HERE", expectedOnHand: 1, counted: 1 })).status).toBe(201);
    expect((await observe(one, id, { outcome: "UNLISTED", note: "Blue extension reel" })).status).toBe(201);
    expect([tape, glue, pens, label, stray].map((each) => [onHand(each), movementsOf(each), locationOf(each)])).toEqual(before);
    const shown = await detail(one, id);
    expect(shown.checked).toBe(4);
    expect(shown.extras.map((entry) => [entry.outcome, entry.name]).sort()).toEqual([["FOUND_HERE", "Stray scissors"], ["UNLISTED", "Blue extension reel"]]);
    expect((await finish(one, id)).status).toBe(200);
    expect([tape, glue, pens, label, stray].map((each) => [onHand(each), movementsOf(each), locationOf(each)])).toEqual(before);
  });

  it("keeps a resent observation once, and a second look as a new record whose outcome counts", async () => {
    const room = await place("Audit room");
    const tape = await item("Tape", room, 5);
    const id = await start(one, room);
    const body = { id: requestId(), itemId: tape, outcome: "CANT_FIND", expectedOnHand: 5, observedAt: new Date().toISOString() };
    expect((await as(one, `/api/staff/audits/${id}/observations`, "POST", body)).status).toBe(201);
    const repeat = await as(one, `/api/staff/audits/${id}/observations`, "POST", body);
    expect(repeat.status).toBe(200);
    expect(await json(repeat)).toEqual({ id: body.id, replayed: true });
    await observe(one, id, { itemId: tape, outcome: "CONFIRMED", expectedOnHand: 5 });
    expect((await detail(one, id)).items[0]!.observation!.outcome).toBe("CONFIRMED");
    expect(sqlite.prepare("SELECT outcome FROM location_audit_observations WHERE audit_id = ? ORDER BY rowid").all(id)).toEqual([{ outcome: "CANT_FIND" }, { outcome: "CONFIRMED" }]);
  });

  it("refuses what does not make sense, and anyone but the person checking", async () => {
    const room = await place("Audit room");
    const tape = await item("Tape", room, 5);
    const id = await start(one, room);
    expect((await observe(one, id, { itemId: tape, outcome: "MISMATCH", expectedOnHand: 5, counted: 5 })).status).toBe(400);
    expect((await observe(one, id, { outcome: "UNLISTED" })).status).toBe(400);
    expect((await observe(one, id, { itemId: tape, outcome: "CONFIRMED" })).status).toBe(400);
    expect((await observe(one, id, { itemId: tape, outcome: "SOMETHING" })).status).toBe(400);
    expect((await observe(one, id, { itemId: "ITM-NOPE", outcome: "CONFIRMED", expectedOnHand: 1 })).status).toBe(404);
    expect((await observe(two, id, { itemId: tape, outcome: "CONFIRMED", expectedOnHand: 5 })).status).toBe(403);
  });

  it("pauses and resumes; seeing something resumes a paused check; a finished one takes nothing more", async () => {
    const room = await place("Audit room");
    const tape = await item("Tape", room, 5);
    const id = await start(one, room);
    expect((await as(one, `/api/staff/audits/${id}`, "PATCH", { status: "PAUSED" })).status).toBe(200);
    expect((await detail(one, id)).audit.status).toBe("PAUSED");
    await observe(one, id, { itemId: tape, outcome: "CONFIRMED", expectedOnHand: 5 });
    expect((await detail(one, id)).audit.status).toBe("OPEN");
    expect((await as(one, `/api/staff/audits/${id}`, "PATCH", { placeNote: "The picture shows the old cabinet." })).status).toBe(200);
    expect((await finish(one, id)).status).toBe(200);
    expect((await observe(one, id, { itemId: tape, outcome: "CONFIRMED", expectedOnHand: 5 })).status).toBe(409);
    expect((await as(one, `/api/staff/audits/${id}`, "PATCH", { status: "OPEN" })).status).toBe(409);
    const actions = (sqlite.prepare("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY rowid").all(id) as Array<{ action: string }>).map((row) => row.action);
    expect(actions).toEqual(["AUDIT_STARTED", "AUDIT_PAUSED", "AUDIT_FINISHED"]);
  });
});

describe("the review", () => {
  async function finished(setup: (id: string, items: Record<string, string>) => Promise<void>) {
    const room = await place("Audit room");
    const items = { tape: await item("Tape", room, 5), glue: await item("Glue", room, 3), pens: await item("Pens", room, 10), stray: await item("Stray", await place("Other room"), 2) };
    const id = await start(one, room);
    await setup(id, items);
    await finish(one, id);
    return { id, room, items, found: (await review(one, id)).discrepancies };
  }

  it("is only for a finished check, and lists each item's latest discrepancy", async () => {
    const room = await place("Audit room");
    const tape = await item("Tape", room, 5);
    const id = await start(one, room);
    await observe(one, id, { itemId: tape, outcome: "MISMATCH", expectedOnHand: 5, counted: 4 });
    const [open] = (await review(one, id)).discrepancies;
    expect((await resolve(one, open!.id, { action: "POSTED_COUNT" })).status).toBe(409);
    await finish(one, id);
    expect((await review(one, id)).discrepancies.map((entry) => [entry.outcome, entry.changedSince])).toEqual([["MISMATCH", false]]);
  });

  it("posts a count through the ledger's count movement, once, and keeps the observation as seen", async () => {
    const { items, found } = await finished(async (id, { glue }) => { await observe(one, id, { itemId: glue, outcome: "MISMATCH", expectedOnHand: 3, counted: 1 }); });
    const response = await resolve(one, found[0]!.id, { action: "POSTED_COUNT" });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(onHand(items.glue)).toBe(1);
    const movement = sqlite.prepare("SELECT movement_type AS type, signed_quantity AS change, idempotency_key AS key FROM inventory_movements WHERE item_id = ? ORDER BY rowid DESC LIMIT 1").get(items.glue);
    expect(movement).toEqual({ type: "COUNT_ADJUSTMENT", change: -2, key: `audit-${found[0]!.id}` });
    expect((await resolve(one, found[0]!.id, { action: "POSTED_COUNT" })).status).toBe(200);
    expect(onHand(items.glue)).toBe(1);
    expect(movementsOf(items.glue)).toBe(2);
    expect(sqlite.prepare("SELECT counted FROM location_audit_observations WHERE id = ?").get(found[0]!.id)).toEqual({ counted: 1 });
    expect(sqlite.prepare("SELECT action, movement_id IS NOT NULL AS linked FROM location_audit_resolutions WHERE observation_id = ?").get(found[0]!.id)).toEqual({ action: "POSTED_COUNT", linked: 1 });
  });

  it("never posts a count that stock moved past: it asks for a fresh count, which then posts against the figure shown now", async () => {
    const { items, found } = await finished(async (id, { glue }) => { await observe(one, id, { itemId: glue, outcome: "MISMATCH", expectedOnHand: 3, counted: 1 }); });
    // Someone takes one out after the count arrived.
    expect((await as(one, `/api/staff/items/${items.glue}/movements`, "POST", { kind: "OUT", quantity: 1, reason: "ISSUED", key: crypto.randomUUID() })).status).toBe(200);
    const audit = (sqlite.prepare("SELECT audit_id AS id FROM location_audit_observations WHERE id = ?").get(found[0]!.id) as { id: string }).id;
    expect((await review(one, audit)).discrepancies[0]!.changedSince).toBe(true);
    const refused = await resolve(one, found[0]!.id, { action: "POSTED_COUNT" });
    expect(refused.status).toBe(409);
    expect((await json<{ error: string }>(refused)).error).toContain("Count it again");
    expect(onHand(items.glue)).toBe(2);
    expect((await resolve(one, found[0]!.id, { action: "POSTED_COUNT", counted: 0, expectedOnHand: 1 })).status).toBe(409);
    expect((await resolve(one, found[0]!.id, { action: "POSTED_COUNT", counted: 0, expectedOnHand: 2 })).status).toBe(200);
    expect(onHand(items.glue)).toBe(0);
  });

  it("flags a count made against figures that were already stale when it arrived (offline while stock moved)", async () => {
    const { items, found } = await finished(async (id, { tape }) => {
      expect((await as(one, `/api/staff/items/${tape}/movements`, "POST", { kind: "OUT", quantity: 2, reason: "ISSUED", key: crypto.randomUUID() })).status).toBe(200);
      await observe(one, id, { itemId: tape, outcome: "MISMATCH", expectedOnHand: 5, counted: 4 });
    });
    expect(found[0]!.changedSince).toBe(true);
    expect((await resolve(one, found[0]!.id, { action: "POSTED_COUNT" })).status).toBe(409);
    expect(onHand(items.tape)).toBe(3);
  });

  it("moves something found here to where it was seen, reports what could not be found, and records a reasoned no-change", async () => {
    const { room, items, found } = await finished(async (id, { stray, pens, tape }) => {
      await observe(one, id, { itemId: stray, outcome: "FOUND_HERE", expectedOnHand: 2, counted: 2 });
      await observe(one, id, { itemId: pens, outcome: "CANT_FIND", expectedOnHand: 10 });
      await observe(one, id, { itemId: tape, outcome: "NEEDS_REVIEW", note: "Looks like a different size" });
    });
    const by = (outcome: string) => found.find((entry) => entry.outcome === outcome)!;
    // A few found here say nothing about the item's stock elsewhere: no count is posted from it.
    expect((await resolve(one, by("FOUND_HERE").id, { action: "POSTED_COUNT" })).status).toBe(400);
    expect((await resolve(one, by("FOUND_HERE").id, { action: "MOVED_HERE" })).status).toBe(200);
    expect(locationOf(items.stray)).toBe(room);
    // The finding still says where the item was recorded when it was seen, not where it is now.
    const audit = (sqlite.prepare("SELECT audit_id AS id FROM location_audit_observations WHERE id = ?").get(by("FOUND_HERE").id) as { id: string }).id;
    expect((await json<{ discrepancies: Array<{ outcome: string; recordedPlace: string | null; seenPlace: string | null }> }>(as(one, `/api/staff/audits/${audit}/review`))).discrepancies.find((entry) => entry.outcome === "FOUND_HERE"))
      .toMatchObject({ recordedPlace: "Other room", seenPlace: "Audit room" });
    expect((await resolve(one, by("CANT_FIND").id, { action: "REPORTED" })).status).toBe(200);
    expect(sqlite.prepare("SELECT kind, item_id AS item FROM location_reports WHERE id = ?").get(by("CANT_FIND").id)).toEqual({ kind: "CANT_FIND", item: items.pens });
    expect(onHand(items.pens)).toBe(10);
    expect((await resolve(one, by("NEEDS_REVIEW").id, { action: "NO_CHANGE" })).status).toBe(400);
    expect((await resolve(one, by("NEEDS_REVIEW").id, { action: "NO_CHANGE", note: "Checked: same item, new packaging." })).status).toBe(200);
    expect((await resolve(one, by("NEEDS_REVIEW").id, { action: "POSTED_COUNT" })).status).toBe(409);
  });

  it("needs a full sign-in to settle anything", async () => {
    const { found } = await finished(async (id, { glue }) => { await observe(one, id, { itemId: glue, outcome: "MISMATCH", expectedOnHand: 3, counted: 1 }); });
    const lease = (await as(one, "/api/staff/catalogue/offline", "POST")).headers.get("set-cookie")!.split(";")[0]!;
    expect((await resolve(lease, found[0]!.id, { action: "POSTED_COUNT" })).status).toBe(401);
  });
});

describe("on a device's offline access", () => {
  it("checks its own places, offline-started ids and all, and reads nothing of anyone else's", async () => {
    const lease = (await as(one, "/api/staff/catalogue/offline", "POST")).headers.get("set-cookie")!.split(";")[0]!;
    const room = await place("Audit room");
    const tape = await item("Tape", room, 5);
    const proposed = auditId();
    expect(await start(lease, room, proposed)).toBe(proposed);
    expect((await observe(lease, proposed, { itemId: tape, outcome: "CONFIRMED", expectedOnHand: 5 })).status).toBe(201);
    expect((await as(lease, `/api/staff/audits/${proposed}`, "PATCH", { status: "PAUSED" })).status).toBe(200);
    expect((await finish(lease, proposed)).status).toBe(200);
    const theirs = await start(two, await place("Store"));
    expect((await as(lease, `/api/staff/audits/${theirs}`)).status).toBe(403);
    expect(await json(as(lease, "/api/staff/audits"))).toMatchObject({ others: [], finished: [] });
    expect((await as(lease, `/api/staff/audits/${proposed}/review`)).status).toBe(401);
  });
});

describe("the record is kept by the database", () => {
  it("refuses changing or removing an observation, a resolution or a check, and observing into a finished one", async () => {
    const room = await place("Audit room");
    const tape = await item("Tape", room, 5);
    const id = await start(one, room);
    await observe(one, id, { itemId: tape, outcome: "MISMATCH", expectedOnHand: 5, counted: 4 });
    expect(() => sqlite.prepare("UPDATE location_audit_observations SET counted = 5").run()).toThrow(/location_audit_observation_final/);
    expect(() => sqlite.prepare("DELETE FROM location_audit_observations").run()).toThrow(/location_audit_observation_final/);
    expect(() => sqlite.prepare("DELETE FROM location_audits").run()).toThrow(/location_audit_kept/);
    await finish(one, id);
    expect(() => sqlite.prepare("UPDATE location_audits SET status = 'OPEN', finished_at = NULL, finished_by = NULL").run()).toThrow(/location_audit_finished/);
    expect(() => sqlite.prepare(`INSERT INTO location_audit_observations(id, audit_id, item_id, outcome, expected_on_hand, counted, observed_by, observed_at, received_at)
      VALUES('00000000-0000-4000-8000-999999999999', ?, ?, 'CONFIRMED', 5, 5, 'ACC-1', 'x', 'x')`).run(id, tape)).toThrow(/location_audit_finished/);
    const [found] = (await review(one, id)).discrepancies;
    await resolve(one, found!.id, { action: "NO_CHANGE", note: "Recounted later." });
    expect(() => sqlite.prepare("UPDATE location_audit_resolutions SET note = 'x'").run()).toThrow(/location_audit_resolution_final/);
    expect(() => sqlite.prepare("DELETE FROM location_audit_resolutions").run()).toThrow(/location_audit_resolution_final/);
  });
});

describe("freshness, derived from the record", () => {
  it("says when an item was last seen at its place, and shows a discrepancy until something settles it", async () => {
    const room = await place("Audit room");
    const tape = await item("Tape", room, 5);
    const glue = await item("Glue", room, 3);
    const fresh = async (id: string) => (await json<{ freshness: { lastVerifiedAt: string | null; openDiscrepancy: { outcome: string } | null } }>(as(one, `/api/staff/items/${id}`))).freshness;
    expect(await fresh(tape)).toEqual({ lastVerifiedAt: null, lastCountedAt: null, openDiscrepancy: null });
    const id = await start(one, room);
    await observe(one, id, { itemId: tape, outcome: "CONFIRMED", expectedOnHand: 5 });
    await observe(one, id, { itemId: glue, outcome: "CANT_FIND", expectedOnHand: 3 });
    expect((await fresh(tape)).lastVerifiedAt).not.toBeNull();
    // Open only once the check is finished: until then it may still be found.
    expect((await fresh(glue)).openDiscrepancy).toBeNull();
    await finish(one, id);
    expect((await fresh(glue)).openDiscrepancy).toMatchObject({ outcome: "CANT_FIND" });
    // A later count settles it, and the observation stays as evidence.
    await new Promise((done) => setTimeout(done, 5));
    expect((await as(one, `/api/staff/items/${glue}/movements`, "POST", { kind: "COUNT", quantity: 3, expectedOnHand: 3, note: "Found behind the box", key: crypto.randomUUID() })).status).toBe(200);
    expect((await fresh(glue)).openDiscrepancy).toBeNull();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM location_audit_observations WHERE item_id = ?").get(glue)).toEqual({ n: 1 });
  });
});

describe("at realistic scale", () => {
  it("opens a check of a place holding 600 items quickly", async () => {
    const room = await place("Big store");
    const insert = sqlite.prepare("INSERT INTO items(id, name, category, item_type, unit, status, location_id) VALUES(?, ?, 'SUPPLIES', 'Consumable', 'piece', 'ACTIVE', ?)");
    for (let index = 0; index < 600; index += 1) insert.run(`ITM-BULK${String(index).padStart(4, "0")}`, `Bulk item ${index}`, room);
    const id = await start(one, room);
    const startedAt = performance.now();
    const shown = await detail(one, id);
    const elapsed = performance.now() - startedAt;
    expect(shown.items).toHaveLength(600);
    expect(elapsed).toBeLessThan(1500);
  });
});
