import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { suggest } from "../src/catalogue-suggest";
import { type Known, hamming, possibleDuplicates, words } from "../src/duplicates";
import { memoryR2, migratedD1 } from "./d1-sqlite";
import { jpeg } from "./jpeg";
// @ts-expect-error: a plain .mjs tool
import * as ops from "../scripts/ops/production-release.mjs";

/* V1.5 Rapid Catalogue: the duplicate and suggestion rules, then sessions, captures and bulk edits through the Worker. */

const known = (fields: Partial<Known> & { id: string; name: string }): Known => ({ aliases: null, category: "SUPPLIES", model: null, serialNumber: null, photoHash: null, status: "ACTIVE", ...fields });

describe("possible duplicates", () => {
  const catalog = [
    known({ id: "ITM-1", name: "Whiteboard Marker (Black)", aliases: "dry-erase marker" }),
    known({ id: "ITM-2", name: "Stapler", model: "HD-45", serialNumber: "SN-0042" }),
    known({ id: "ITM-3", name: "Extension Cord", category: "ELECTRICAL", model: "EC 5M" }),
    known({ id: "ITM-4", name: "Gaffer Tape", photoHash: "ffff0000ffff0000" })
  ];
  it("reads words without case, punctuation or plurals", () => {
    expect(words("  Whiteboard-MARKERS, (Black) ")).toEqual(["whiteboard", "marker", "black"]);
  });
  it("finds the same name in any order or spelling, and an alias", () => {
    expect(possibleDuplicates({ name: "black whiteboard marker" }, catalog)).toEqual([{ id: "ITM-1", reason: "Same name", strong: true }]);
    expect(possibleDuplicates({ name: "Dry-erase markers" }, catalog)[0]).toMatchObject({ id: "ITM-1", strong: true });
  });
  it("finds a serial number however it is written, and a model in the same category only", () => {
    expect(possibleDuplicates({ name: "Something else", serialNumber: "sn 0042" }, catalog)).toEqual([{ id: "ITM-2", reason: "Same serial number", strong: true }]);
    expect(possibleDuplicates({ name: "Power strip", model: "ec-5m", category: "electrical" }, catalog)[0]).toMatchObject({ id: "ITM-3", reason: "Same model in the same category", strong: false });
    expect(possibleDuplicates({ name: "Power strip", model: "ec-5m", category: "OFFICE" }, catalog)).toEqual([]);
  });
  it("finds a photo that looks the same, but not a different one", () => {
    expect(hamming("ffff0000ffff0000", "ffff0000ffff0001")).toBe(1);
    expect(possibleDuplicates({ name: "Tape", photoHash: "ffff0000ffff0003" }, catalog)[0]).toMatchObject({ id: "ITM-4", strong: false });
    expect(possibleDuplicates({ name: "Tape", photoHash: "0000ffff0000ffff" }, catalog)).toEqual([]);
  });
  it("warns about an almost identical name but not about one shared word", () => {
    expect(possibleDuplicates({ name: "Whiteboard Marker" }, catalog)[0]).toMatchObject({ id: "ITM-1", reason: "Almost the same name" });
    expect(possibleDuplicates({ name: "Whiteboard" }, catalog)).toEqual([]);
  });
  it("does not call two different serial numbers a duplicate", () => {
    expect(possibleDuplicates({ name: "Stapler", serialNumber: "SN-0043" }, catalog)).toEqual([]);
    expect(possibleDuplicates({ name: "Stapler" }, catalog)[0]).toMatchObject({ id: "ITM-2", reason: "Same name" });
  });
  it("leaves out the item being edited", () => {
    expect(possibleDuplicates({ name: "Stapler" }, catalog, "ITM-2")).toEqual([]);
  });
});

describe("at 600 items", () => {
  const many = Array.from({ length: 600 }, (_, index) => known({ id: `ITM-${index + 1}`, name: `Sample ${["Marker", "Stapler", "Paper", "Cord", "Tape"][index % 5]} ${index}`, model: index % 3 ? null : `M${index}`, serialNumber: index % 7 ? null : `SN${index}`, photoHash: (index * 2654435761 % 2 ** 32).toString(16).padStart(16, "0") }));
  it("judges possible matches and suggestions for every keystroke in a few milliseconds", () => {
    const catalog = many.map((item) => ({ name: item.name, category: item.category, itemType: "Consumable", consumptionMode: "WHOLE_UNIT", unit: "piece", stockArea: "Inventory", status: "ACTIVE", needsReview: false }));
    const started = performance.now();
    for (let run = 0; run < 100; run += 1) {
      possibleDuplicates({ name: `Sample Marker ${run}`, category: "SUPPLIES", model: "M3", serialNumber: "SN9", photoHash: "00000000ffffffff" }, many);
      suggest(`sample mar${run}`, catalog, []);
    }
    expect((performance.now() - started) / 100).toBeLessThan(10);
  });
});

describe("suggestions", () => {
  const item = (fields: Partial<Parameters<typeof suggest>[1][number]> & { name: string }) => ({ category: "SUPPLIES", itemType: "Consumable", consumptionMode: "WHOLE_UNIT", unit: "piece", stockArea: "Inventory", status: "ACTIVE", needsReview: false, ...fields });
  const catalog = [
    item({ name: "Whiteboard Marker Black", category: "OFFICE SUPPLIES", unit: "piece" }),
    item({ name: "Whiteboard Marker Blue", category: "OFFICE SUPPLIES", unit: "piece" }),
    item({ name: "Bond Paper A4", category: "PAPER", unit: "ream", consumptionMode: "OPEN_UNIT" }),
    item({ name: "Extension Cord", category: "ELECTRICAL", itemType: "Loanable", unit: "piece" }),
    item({ name: "Mystery thing", category: "UNSORTED", itemType: "NEEDS_REVIEW" })
  ];
  it("explains a suggestion by the items it is like", () => {
    const result = suggest("whiteboard mar", catalog, []);
    expect(result.category).toEqual({ value: "OFFICE SUPPLIES", why: "Like “Whiteboard Marker Black” and 1 more", tier: "WEAK", basis: "CATALOG" });
    expect(result.behaviour?.value).toBe("CONSUME");
    expect(result.unit?.value).toBe("piece");
  });
  it("knows a loanable and a gradually used consumable", () => {
    expect(suggest("extension cord 5m", catalog, []).behaviour?.value).toBe("BORROW");
    expect(suggest("bond paper", catalog, []).behaviour?.value).toBe("GRADUAL");
  });
  it("suggests nothing for a name like nothing, and never from an unclassified record", () => {
    expect(suggest("zebra", catalog, [])).toEqual({});
    expect(suggest("mystery", catalog, [])).toEqual({});
  });
  it("falls back on what this session just did", () => {
    const recent = [item({ name: "A", category: "TOOLS", itemType: "Loanable" }), item({ name: "B", category: "TOOLS", itemType: "Loanable" })];
    expect(suggest("zebra", catalog, recent)).toMatchObject({ category: { value: "TOOLS", why: "Same as your last two items" }, behaviour: { value: "BORROW" } });
    expect(suggest("zebra", catalog, recent.slice(0, 1)).behaviour).toBeUndefined();
  });
});

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let media: ReturnType<typeof memoryR2>;
let cookie: string;
let otherCookie: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (who: string, path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie: who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const staff = (path: string, method = "GET", body?: unknown) => as(cookie, path, method, body);

afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const database = migratedD1();
  sqlite = database.sqlite;
  media = memoryR2();
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: media.bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  sqlite.prepare("UPDATE system_settings SET value = 'open' WHERE key = 'self_service'").run();
  const hash = await hashPassword("correct horse battery");
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(hash);
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-2', 'staff.two', 'Staff Two', ?)").run(hash);
  cookie = await signIn("staff.one");
  otherCookie = await signIn("staff.two");
});

async function signIn(username: string): Promise<string> {
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${username}` }, body: JSON.stringify({ username, password: "correct horse battery" }) });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function place(name: string, parentId: string | null = null): Promise<string> {
  const response = await staff("/api/staff/locations", "POST", { name, parentId });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
async function begin(locationId: string, who = cookie): Promise<string> {
  const response = await as(who, "/api/staff/catalogue/sessions", "POST", { locationId });
  expect([200, 201]).toContain(response.status);
  return ((await response.json()) as { id: string }).id;
}
let counter = 0;
const requestId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const shot = (locationId: string, fields: Record<string, unknown> = {}) => ({ id: requestId(), behaviour: "CONSUME", name: `Thing ${counter}`, category: "SUPPLIES", unit: "piece", quantity: 3, locationId, ...fields });
const save = (session: string, body: Record<string, unknown>, who = cookie) => as(who, `/api/staff/catalogue/sessions/${session}/captures`, "POST", body);
const row = (id: string) => sqlite.prepare("SELECT * FROM items WHERE id = ?").get(id) as Record<string, unknown>;
const onHand = (id: string) => (sqlite.prepare("SELECT on_hand FROM inventory_balances WHERE id = ?").get(id) as { on_hand: number }).on_hand;
const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("cataloguing sessions", () => {
  it("starts one session per person and resumes it from any device", async () => {
    const shelf = await place("Shelf 2");
    const first = await begin(shelf);
    const again = await as(cookie, "/api/staff/catalogue/sessions", "POST", { locationId: shelf });
    expect(await again.json()).toEqual({ id: first, resumed: true });
    expect(count("catalogue_sessions")).toBe(1);
    const state = await (await staff("/api/staff/catalogue")).json() as { session: { id: string; place: string; saved: number }; others: unknown[] };
    expect(state.session).toMatchObject({ id: first, place: "Shelf 2", saved: 0 });
    expect(state.others).toEqual([]);
    const other = await (await as(otherCookie, "/api/staff/catalogue")).json() as { session: unknown; others: Array<{ owner: string }> };
    expect(other.session).toBeNull();
    expect(other.others.map((entry) => entry.owner)).toEqual(["Staff One"]);
  });
  it("needs a real, active place", async () => {
    expect((await staff("/api/staff/catalogue/sessions", "POST", {})).status).toBe(400);
    expect((await staff("/api/staff/catalogue/sessions", "POST", { locationId: "LOC-9999" })).status).toBe(400);
  });
  it("is the owner's alone to change", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    expect((await save(session, shot(shelf), otherCookie)).status).toBe(403);
    expect((await as(otherCookie, `/api/staff/catalogue/sessions/${session}/finish`, "POST")).status).toBe(403);
    expect((await as(otherCookie, `/api/staff/catalogue/sessions/${session}`)).status).toBe(200);
  });
  it("moves its sticky place and keeps each item's own", async () => {
    const one = await place("Shelf 1");
    const two = await place("Shelf 2");
    const session = await begin(one);
    expect((await save(session, shot(one))).status).toBe(201);
    expect((await staff(`/api/staff/catalogue/sessions/${session}`, "PATCH", { locationId: two })).status).toBe(200);
    expect((await save(session, shot(two))).status).toBe(201);
    const detail = await (await staff(`/api/staff/catalogue/sessions/${session}`)).json() as { session: { place: string; saved: number }; recent: Array<{ place: string }> };
    expect(detail.session).toMatchObject({ place: "Shelf 2", saved: 2 });
    expect(detail.recent.map((entry) => entry.place)).toEqual(["Shelf 2", "Shelf 1"]);
  });
  it("finishes once, audited, and takes no more items", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    await save(session, shot(shelf));
    await save(session, shot(shelf, { behaviour: "REVIEW_LATER", category: "", unit: "" }));
    const done = await (await staff(`/api/staff/catalogue/sessions/${session}/finish`, "POST")).json();
    expect(done).toEqual({ saved: 2, reviewLater: 1 });
    expect((await staff(`/api/staff/catalogue/sessions/${session}/finish`, "POST")).status).toBe(200);
    const late = await save(session, shot(shelf));
    expect(late.status).toBe(409);
    expect(sqlite.prepare("SELECT action FROM audit_log WHERE entity_type = 'CATALOGUE' ORDER BY rowid").all()).toEqual([{ action: "CATALOGUE_STARTED" }, { action: "CATALOGUE_FINISHED" }]);
    expect((await begin(shelf)).startsWith("CS-")).toBe(true);
  });
  it("is protected by the database as well", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    await save(session, shot(shelf));
    expect(() => sqlite.prepare("DELETE FROM catalogue_captures").run()).toThrow(/catalogue_capture_final/);
    expect(() => sqlite.prepare("UPDATE catalogue_captures SET behaviour = 'BORROW'").run()).toThrow(/catalogue_capture_final/);
    expect(() => sqlite.prepare("DELETE FROM catalogue_sessions").run()).toThrow(/catalogue_session_kept/);
    await staff(`/api/staff/catalogue/sessions/${session}/finish`, "POST");
    expect(() => sqlite.prepare("UPDATE catalogue_sessions SET location_id = NULL").run()).toThrow(/catalogue_session_finished/);
    expect(() => sqlite.prepare("INSERT INTO catalogue_sessions(id, started_by, status, started_at, updated_at) VALUES('CS-00000000-0000-4000-8000-000000000001', 'ACC-1', 'ACTIVE', 'x', 'x')").run()).not.toThrow();
    expect(() => sqlite.prepare("INSERT INTO catalogue_sessions(id, started_by, status, started_at, updated_at) VALUES('CS-00000000-0000-4000-8000-000000000002', 'ACC-1', 'ACTIVE', 'x', 'x')").run()).toThrow(/UNIQUE/);
  });
});

describe("capturing an item", () => {
  it("creates the item, its opening count, its audit entry and its capture together", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const response = await save(session, shot(shelf, { name: "Stapler", category: "Office Supplies", behaviour: "BORROW", unit: "piece", quantity: 4, model: "HD-45", serialNumber: "SN-1" }));
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };
    expect(row(id)).toMatchObject({ name: "Stapler", item_type: "Loanable", consumption_mode: "WHOLE_UNIT", location_id: shelf, needs_review: 1, lending_audience: "NOT_AVAILABLE_FOR_LENDING", model: "HD-45", serial_number: "SN-1", status: "ACTIVE" });
    expect(onHand(id)).toBe(4);
    expect(sqlite.prepare("SELECT behaviour, session_id FROM catalogue_captures WHERE item_id = ?").get(id)).toEqual({ behaviour: "BORROW", session_id: session });
    const created = sqlite.prepare("SELECT details_json FROM audit_log WHERE action = 'ITEM_CREATED' AND entity_id = ?").get(id) as { details_json: string };
    expect(JSON.parse(created.details_json)).toMatchObject({ catalogueSession: session, behaviour: "BORROW", storageLocation: "Shelf 2", openingQuantity: 4 });
  });
  it("lets one shelf hold borrowed, consumed and gradually used items", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const made: Record<string, string> = {};
    for (const [behaviour, name] of [["BORROW", "Zephyr projector"], ["CONSUME", "Zephyr pen"], ["GRADUAL", "Zephyr bond paper"], ["REVIEW_LATER", "Zephyr black box"]] as const) {
      made[behaviour] = ((await (await save(session, shot(shelf, { behaviour, name }))).json()) as { id: string }).id;
    }
    expect(row(made.BORROW!)).toMatchObject({ item_type: "Loanable", consumption_mode: "WHOLE_UNIT" });
    expect(row(made.CONSUME!)).toMatchObject({ item_type: "Consumable", consumption_mode: "WHOLE_UNIT" });
    expect(row(made.GRADUAL!)).toMatchObject({ item_type: "Consumable", consumption_mode: "OPEN_UNIT" });
    expect(row(made.REVIEW_LATER!)).toMatchObject({ item_type: "NEEDS_REVIEW", needs_review: 1 });
  });
  it("keeps a review-later record incomplete and out of every public list", async () => {
    const shelf = await place("Shelf 2");
    sqlite.prepare("UPDATE locations SET visibility = 'SELF_SERVICE' WHERE id = ?").run(shelf);
    const session = await begin(shelf);
    const { id } = await (await save(session, shot(shelf, { behaviour: "REVIEW_LATER", name: "Black cable thing", category: "", unit: "", quantity: 7 }))).json() as { id: string };
    expect(row(id)).toMatchObject({ category: "UNSORTED", unit: "piece", item_type: "NEEDS_REVIEW", needs_review: 1, lending_audience: "NOT_AVAILABLE_FOR_LENDING" });
    expect(onHand(id)).toBe(7);
    expect(JSON.stringify(await (await call("/api/public/catalog")).json())).not.toContain("Black cable thing");
    expect(JSON.stringify(await (await call("/api/self-service/catalog")).json())).not.toContain("Black cable thing");
    // Even the most permissive settings cannot publish it while it is unclassified.
    sqlite.prepare("UPDATE items SET lending_audience = 'STUDENTS_AND_USC_STAFF', needs_review = 0 WHERE id = ?").run(id);
    expect(JSON.stringify(await (await call("/api/public/catalog")).json())).not.toContain("Black cable thing");
    expect(JSON.stringify(await (await call("/api/self-service/catalog")).json())).not.toContain("Black cable thing");
    const inventory = await (await staff("/api/staff/inventory")).json() as { categories: string[] };
    expect(inventory.categories).not.toContain("UNSORTED");
    const state = await (await staff("/api/staff/catalogue")).json() as { reviewLater: { total: number; items: Array<{ id: string; place: string }> } };
    expect(state.reviewLater).toMatchObject({ total: 1, items: [{ id, place: "Shelf 2" }] });
  });
  it("keeps a classified capture off Self-Service until someone marks it reviewed", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const { id } = await (await save(session, shot(shelf, { name: "Printer ink" }))).json() as { id: string };
    expect(JSON.stringify(await (await call("/api/self-service/catalog")).json())).not.toContain("Printer ink");
    const version = row(id).updated_at;
    const reviewed = await (await staff("/api/staff/items/bulk", "POST", { action: "REVIEWED", items: [{ id, updatedAt: version }] })).json();
    expect(reviewed).toMatchObject({ applied: 1 });
    expect(JSON.stringify(await (await call("/api/self-service/catalog")).json())).toContain("Printer ink");
  });
  it("needs a category and a unit unless it is review-later, and a place and a quantity always", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const before = count("items");
    expect((await save(session, shot(shelf, { category: "" }))).status).toBe(400);
    expect((await save(session, shot(shelf, { unit: "" }))).status).toBe(400);
    expect((await save(session, shot(shelf, { locationId: undefined }))).status).toBe(400);
    expect((await save(session, shot(shelf, { quantity: -1 }))).status).toBe(400);
    expect((await save(session, shot(shelf, { quantity: 1.5 }))).status).toBe(400);
    expect((await save(session, shot(shelf, { behaviour: "SELL" }))).status).toBe(400);
    expect((await save(session, shot(shelf, { name: "" }))).status).toBe(400);
    expect((await save(session, { ...shot(shelf), id: "nope" })).status).toBe(400);
    expect(count("items")).toBe(before);
  });
  it("is retried safely: the same request never makes a second item", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const body = shot(shelf, { name: "Tape dispenser" });
    const first = await save(session, body);
    const again = await save(session, body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    const [a, b] = [await first.json() as { id: string }, await again.json() as { id: string; replayed: boolean }];
    expect(b).toMatchObject({ id: a.id, replayed: true });
    expect(count("catalogue_captures")).toBe(1);
    expect(onHand(a.id)).toBe(3);
    const both = await Promise.all([save(session, shot(shelf, { name: "Glue" })), save(session, { ...body, id: requestId(), name: "Glue 2" })]);
    expect(both.map((response) => response.status)).toEqual([201, 201]);
  });
  it("returns possible duplicates instead of saving, and saves once they are acknowledged", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const first = await (await save(session, shot(shelf, { name: "Stapler", serialNumber: "SN-42" }))).json() as { id: string };
    const items = count("items");
    const twin = shot(shelf, { name: "stapler" });
    const warning = await save(session, twin);
    expect(warning.status).toBe(409);
    expect(await warning.json()).toMatchObject({ duplicates: [{ id: first.id, reason: "Same name", strong: true }] });
    expect(count("items")).toBe(items);
    expect((await save(session, { ...twin, acknowledged: ["ITM-9999"] })).status).toBe(409);
    const saved = await save(session, { ...twin, acknowledged: [first.id] });
    expect(saved.status).toBe(201);
    const second = await saved.json() as { id: string };
    expect(second.id).not.toBe(first.id);
    expect(JSON.parse(sqlite.prepare("SELECT acknowledged FROM catalogue_captures WHERE item_id = ?").get(second.id)!.acknowledged as string)).toEqual([first.id]);
    expect((await save(session, shot(shelf, { name: "Chair", serialNumber: "sn 42" }))).status).toBe(409);
  });
  it("notices a photo that was already taken", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const { id } = await (await save(session, shot(shelf, { name: "Gaffer tape" }))).json() as { id: string };
    const form = new FormData();
    form.set("display", new File([jpeg({ width: 40, height: 30 }) as BlobPart], "display.jpg", { type: "image/jpeg" }));
    form.set("thumb", new File([jpeg({ width: 16, height: 12 }) as BlobPart], "thumb.jpg", { type: "image/jpeg" }));
    form.set("expected", "");
    form.set("hash", "ffff0000ffff0000");
    expect((await call(`/api/staff/items/${id}/photo`, { method: "PUT", headers: { origin, cookie }, body: form })).status).toBe(200);
    expect(sqlite.prepare("SELECT dhash FROM item_media WHERE item_id = ?").get(id)).toEqual({ dhash: "ffff0000ffff0000" });
    const warning = await save(session, shot(shelf, { name: "Silver roll", photoHash: "ffff0000ffff0001" }));
    expect(await warning.json()).toMatchObject({ duplicates: [{ id, reason: "Its photo looks the same", strong: false }] });
    const bad = new FormData();
    bad.set("display", new File([jpeg({ width: 40, height: 30 }) as BlobPart], "display.jpg"));
    bad.set("thumb", new File([jpeg({ width: 16, height: 12 }) as BlobPart], "thumb.jpg"));
    bad.set("expected", id);
    bad.set("hash", "not-a-hash");
    expect((await call(`/api/staff/items/${id}/photo`, { method: "PUT", headers: { origin, cookie }, body: bad })).status).toBe(400);
  });
  it("shows up in Activity with the session around it", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    await save(session, shot(shelf, { name: "Hole punch" }));
    await staff(`/api/staff/catalogue/sessions/${session}/finish`, "POST");
    const feed = await (await staff("/api/staff/activity?source=CATALOG")).json() as { events: Array<{ type: string; summary: string }> };
    expect(feed.events.map((event) => event.type)).toEqual(expect.arrayContaining(["CATALOGUE_STARTED", "CATALOGUE_FINISHED", "ITEM_CREATED"]));
    expect(feed.events.find((event) => event.type === "ITEM_CREATED")!.summary).toContain("while cataloguing");
    expect(feed.events.find((event) => event.type === "CATALOGUE_STARTED")).toMatchObject({ title: "Cataloguing started" });
    expect(feed.events.find((event) => event.type === "CATALOGUE_FINISHED")).toMatchObject({ title: "Cataloguing finished" });
    expect(feed.events.find((event) => event.type === "CATALOGUE_FINISHED")!.summary).toBe("Staff One finished cataloguing in Shelf 2: 1 items saved.");
  });
  it("lists the session's classified, unreviewed items for sign-off, and nothing else", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const ok = (await (await save(session, shot(shelf, { name: "Zephyr glue" }))).json() as { id: string }).id;
    await save(session, shot(shelf, { name: "Zephyr unknown", behaviour: "REVIEW_LATER", category: "", unit: "" }));
    const done = (await (await save(session, shot(shelf, { name: "Zephyr tape" }))).json() as { id: string }).id;
    sqlite.prepare("UPDATE items SET needs_review = 0 WHERE id = ?").run(done);
    const answer = await (await staff(`/api/staff/catalogue/sessions/${session}/unreviewed`)).json() as { items: Array<{ id: string; updatedAt: string }> };
    expect(answer.items.map((entry) => entry.id)).toEqual([ok]);
    expect(answer.items[0]!.updatedAt).toBe(row(ok).updated_at);
  });
  it("will not mark an item reviewed while its category is still Unsorted", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const { id } = await (await save(session, shot(shelf, { name: "Zephyr mystery", behaviour: "REVIEW_LATER", category: "", unit: "" }))).json() as { id: string };
    const current = (await (await staff(`/api/staff/items/${id}`)).json() as { item: Record<string, unknown> }).item;
    const edit = (changes: Record<string, unknown>) => staff(`/api/staff/items/${id}`, "PATCH", { name: current.name, category: current.category, itemType: "Consumable", unit: "piece", status: "ACTIVE", locationId: shelf, reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null, updatedAt: current.updatedAt, ...changes });
    const refused = await edit({});
    expect(refused.status).toBe(400);
    expect((await refused.json() as { error: string }).error).toContain("Choose a category");
    expect((await edit({ category: "unsorted" })).status).toBe(400);
    expect((await edit({ needsReview: true })).status).toBe(200);
    const fresh = (await (await staff(`/api/staff/items/${id}`)).json() as { item: Record<string, unknown> }).item;
    expect((await staff(`/api/staff/items/${id}`, "PATCH", { name: fresh.name, category: "HARDWARE", itemType: "Consumable", unit: "piece", status: "ACTIVE", locationId: shelf, reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null, updatedAt: fresh.updatedAt })).status).toBe(200);
  });
  it("keeps model and serial number on the item and in its edits", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const { id } = await (await save(session, shot(shelf, { name: "Laptop", model: "X1", serialNumber: "S-9" }))).json() as { id: string };
    const detail = await (await staff(`/api/staff/items/${id}`)).json() as { item: Record<string, unknown> };
    expect(detail.item).toMatchObject({ model: "X1", serialNumber: "S-9" });
    const edit = { name: "Laptop", category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", locationId: shelf, reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: true, notes: null, model: "X2", serialNumber: "", updatedAt: detail.item.updatedAt };
    expect((await staff(`/api/staff/items/${id}`, "PATCH", edit)).status).toBe(200);
    expect(row(id)).toMatchObject({ model: "X2", serial_number: null });
  });
});

describe("bulk edits", () => {
  async function items(shelf: string, names: string[]): Promise<Array<{ id: string; updatedAt: string }>> {
    const session = await begin(shelf);
    const out: Array<{ id: string; updatedAt: string }> = [];
    for (const name of names) {
      const { id } = await (await save(session, shot(shelf, { name }))).json() as { id: string };
      out.push({ id, updatedAt: row(id).updated_at as string });
    }
    return out;
  }
  const bulk = async (body: Record<string, unknown>) => await (await staff("/api/staff/items/bulk", "POST", body)).json() as { applied: number; unchanged: number; skipped: Array<{ id: string; reason: string }> };

  it("moves items to a place, one audit entry each, without touching quantity", async () => {
    const one = await place("Shelf 1");
    const two = await place("Shelf 2");
    const list = await items(one, ["Alpha", "Bravo", "Charlie"]);
    const movements = count("inventory_movements");
    const result = await bulk({ action: "MOVE", value: two, items: list });
    expect(result).toEqual({ applied: 3, unchanged: 0, skipped: [] });
    for (const { id } of list) { expect(row(id).location_id).toBe(two); expect(onHand(id)).toBe(3); }
    expect(count("inventory_movements")).toBe(movements);
    const trail = sqlite.prepare("SELECT details_json FROM audit_log WHERE action = 'ITEM_UPDATED' AND json_extract(details_json, '$.bulk') IS NOT NULL ORDER BY rowid").all() as Array<{ details_json: string }>;
    expect(trail).toHaveLength(3);
    expect(JSON.parse(trail[0]!.details_json)).toMatchObject({ storageLocation: { from: "Shelf 1", to: "Shelf 2" }, bulk: { items: 3 } });
    const feed = await (await staff(`/api/staff/activity?type=ITEM_UPDATED&item=${list[0]!.id}`)).json() as { events: Array<{ summary: string }> };
    expect(feed.events[0]!.summary).toContain("one of 3 edited together");
  });
  it("counts what is already right and skips what someone else changed, naming it", async () => {
    const one = await place("Shelf 1");
    const two = await place("Shelf 2");
    const list = await items(one, ["Alpha", "Bravo", "Charlie"]);
    sqlite.prepare("UPDATE items SET updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?").run(list[1]!.id);
    sqlite.prepare("UPDATE items SET location_id = ? WHERE id = ?").run(two, list[2]!.id);
    const result = await bulk({ action: "MOVE", value: two, items: list });
    expect(result).toMatchObject({ applied: 1, unchanged: 1, skipped: [{ id: list[1]!.id, reason: "Someone else changed it meanwhile." }] });
    expect(row(list[0]!.id).location_id).toBe(two);
    expect(row(list[1]!.id).location_id).toBe(one);
  });
  it("sets a category (reusing the stored spelling) and a stock area", async () => {
    const shelf = await place("Shelf 1");
    const list = await items(shelf, ["Alpha", "Bravo"]);
    expect(await bulk({ action: "CATEGORY", value: "supplies", items: list })).toMatchObject({ applied: 0, unchanged: 2 });
    expect(await bulk({ action: "CATEGORY", value: "Cleaning Things", items: list })).toMatchObject({ applied: 2 });
    const fresh = list.map(({ id }) => ({ id, updatedAt: row(id).updated_at as string }));
    expect(await bulk({ action: "CATEGORY", value: "CLEANING things", items: fresh })).toMatchObject({ unchanged: 2 });
    expect(await bulk({ action: "STOCK_AREA", value: "Pantry", items: fresh })).toMatchObject({ applied: 2 });
    expect(row(list[0]!.id)).toMatchObject({ category: "Cleaning Things", stock_area: "Pantry" });
    expect((await staff("/api/staff/items/bulk", "POST", { action: "STOCK_AREA", value: "Garage", items: fresh })).status).toBe(400);
    expect((await staff("/api/staff/items/bulk", "POST", { action: "CATEGORY", value: "Unsorted", items: fresh })).status).toBe(400);
  });
  it("marks reviewed only what is classified", async () => {
    const shelf = await place("Shelf 1");
    const session = await begin(shelf);
    const good = (await (await save(session, shot(shelf, { name: "Alpha" }))).json() as { id: string }).id;
    const later = (await (await save(session, shot(shelf, { name: "Bravo", behaviour: "REVIEW_LATER", category: "" }))).json() as { id: string }).id;
    const list = [good, later].map((id) => ({ id, updatedAt: row(id).updated_at as string }));
    const result = await bulk({ action: "REVIEWED", items: list });
    expect(result).toMatchObject({ applied: 1, skipped: [{ id: later, reason: "Choose Borrow or Take for it first." }] });
    expect(row(good).needs_review).toBe(0);
    expect(row(later).needs_review).toBe(1);
    sqlite.prepare("UPDATE items SET item_type = 'Consumable' WHERE id = ?").run(later);
    const again = await bulk({ action: "REVIEWED", items: [{ id: later, updatedAt: row(later).updated_at }] });
    expect(again.skipped[0]!.reason).toBe("Choose its category first.");
  });
  it("refuses an inactive place, an empty or oversized selection, and a missing item", async () => {
    const one = await place("Shelf 1");
    const two = await place("Shelf 2");
    const list = await items(one, ["Alpha"]);
    sqlite.prepare("UPDATE locations SET active = 0 WHERE id = ?").run(two);
    expect((await staff("/api/staff/items/bulk", "POST", { action: "MOVE", value: two, items: list })).status).toBe(409);
    expect((await staff("/api/staff/items/bulk", "POST", { action: "MOVE", value: one, items: [] })).status).toBe(400);
    expect((await staff("/api/staff/items/bulk", "POST", { action: "MOVE", value: one, items: Array.from({ length: 51 }, (_, n) => ({ id: `ITM-${n}`, updatedAt: null })) })).status).toBe(400);
    expect((await staff("/api/staff/items/bulk", "POST", { action: "DELETE", items: list })).status).toBe(400);
    expect(await bulk({ action: "MOVE", value: one, items: [{ id: "ITM-9998", updatedAt: null }] })).toMatchObject({ skipped: [{ id: "ITM-9998", reason: "It no longer exists." }] });
  });
  it("is for signed-in Logistics staff only", async () => {
    expect((await call("/api/staff/items/bulk", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await call("/api/staff/catalogue")).status).toBe(401);
    sqlite.prepare("UPDATE staff_accounts SET role = 'STAFF' WHERE id = 'ACC-2'").run();
    sqlite.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES('account_access:ACC-2', 'DEM', '2026-10-03T00:00:00.000Z')").run();
    expect((await as(otherCookie, "/api/staff/catalogue")).status).toBe(403);
    expect((await as(otherCookie, "/api/staff/items/bulk", "POST", { action: "REVIEWED", items: [] })).status).toBe(403);
  });
});

describe("a long session", () => {
  it("keeps saving at the same pace at 500+ items, and its page stays bounded", async () => {
    const shelf = await place("Shelf 2");
    const session = await begin(shelf);
    const times: number[] = [];
    for (let index = 0; index < 520; index += 1) {
      const started = performance.now();
      const response = await save(session, shot(shelf, { name: `Zephyr ${["bolt", "clamp", "hinge", "valve"][index % 4]} lot ${index}`, behaviour: (["BORROW", "CONSUME", "GRADUAL", "REVIEW_LATER"] as const)[index % 4], category: index % 4 === 3 ? "" : "HARDWARE" }));
      times.push(performance.now() - started);
      expect(response.status, `capture ${index}`).toBe(201);
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    expect(median(times.slice(-40))).toBeLessThan(Math.max(60, median(times.slice(0, 40)) * 4));
    const detail = await (await staff(`/api/staff/catalogue/sessions/${session}`)).json() as { session: { saved: number }; counts: Record<string, number>; recent: unknown[] };
    expect(detail.session.saved).toBe(520);
    expect(detail.counts).toEqual({ BORROW: 130, CONSUME: 130, GRADUAL: 130, REVIEW_LATER: 130 });
    expect(detail.recent).toHaveLength(40);
    const state = await (await staff("/api/staff/catalogue")).json() as { reviewLater: { total: number; items: unknown[] } };
    expect(state.reviewLater.total).toBe(130);
    expect(state.reviewLater.items).toHaveLength(100);
    const review = await (await staff(`/api/staff/catalogue/sessions/${session}/unreviewed`)).json() as { items: unknown[] };
    expect(review.items).toHaveLength(390);
  }, 60_000);
});

describe("migration 0027 and its release manifest", () => {
  const manifest = JSON.parse(fs.readFileSync("ops/releases/v1.5.json", "utf8")) as { migrations: { pending: Array<{ name: string; sha256: string }> }; expect: { schemaAdded: string[]; schemaChanged: string[]; tableRowsAfter: Record<string, number> } };
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");

  it("adds exactly what the manifest says to a database in production's state, and changes no row", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const apply = (file: string) => { db.exec("BEGIN"); db.exec(fs.readFileSync(`migrations/${file}`, "utf8")); db.exec("COMMIT"); };
    fs.readdirSync("migrations").sort().filter((file) => file < "0027").forEach(apply);
    const schema = () => Object.fromEntries((db.prepare("SELECT type, name, sql FROM sqlite_master").all() as Array<{ type: string; name: string; sql: string | null }>).map((row) => [`${row.type}:${row.name}`, sha(row.sql ?? "")]));
    const counts = () => db.prepare("SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM inventory_movements) AS movements, (SELECT COALESCE(SUM(on_hand), 0) FROM inventory_balances) AS onHand, (SELECT COUNT(*) FROM loans) AS loans, (SELECT COUNT(*) FROM audit_log) AS audit").get();
    const items = db.prepare("SELECT * FROM items ORDER BY id").all();
    const before = schema();
    const figures = counts();
    apply("0027_catalogue_sessions.sql");
    const after = schema();
    expect(Object.keys(after).filter((key) => !(key in before)).sort()).toEqual([...manifest.expect.schemaAdded].sort());
    expect(Object.keys(before).filter((key) => key in after && before[key] !== after[key]).sort()).toEqual([...manifest.expect.schemaChanged].sort());
    expect(Object.keys(before).filter((key) => !(key in after))).toEqual([]);
    expect(counts()).toEqual(figures);
    // Every existing item is byte-for-byte what it was; the new columns start empty.
    expect((db.prepare("SELECT * FROM items ORDER BY id").all() as Array<Record<string, unknown>>).map(({ model, serial_number, ...rest }) => { expect([model, serial_number]).toEqual([null, null]); return rest; })).toEqual(items);
    for (const [table, rows] of Object.entries(manifest.expect.tableRowsAfter)) expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(rows);
  });

  it("is a manifest the Cloud Operations lane accepts", () => {
    expect(() => ops.loadManifest("ops/releases/v1.5.json", "v1.5")).not.toThrow();
  });

  it("pins the migration file it will apply", () => {
    expect(manifest.migrations.pending).toEqual([{ name: "0027_catalogue_sessions.sql", sha256: sha(fs.readFileSync("migrations/0027_catalogue_sessions.sql", "utf8")) }]);
  });
});

describe("review-only AI offers and correction evidence", () => {
  const draftId = "10000000-0000-4000-8000-000000000001";
  const offerPath = (session: string) => `/api/staff/catalogue/sessions/${session}/ai-offer`;
  const feedbackCount = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'AI_REVIEW_FEEDBACK'").get() as { n: number }).n;
  const seed = () => {
    sqlite.prepare("UPDATE items SET status = 'ARCHIVED'").run();
    sqlite.prepare("INSERT INTO items(id, name, category, item_type, consumption_mode, unit, needs_review) VALUES('ITM-AI-1', 'Stapler', 'TOOLS', 'Loanable', 'WHOLE_UNIT', 'piece', 0), ('ITM-AI-2', 'Staple remover', 'TOOLS', 'Loanable', 'WHOLE_UNIT', 'piece', 0)").run();
    const calls: string[] = [];
    env.AI = { run: async (model: string) => { calls.push(model); return { response: { term: "Stapler" } }; } } as unknown as Ai;
    return calls;
  };
  const ask = async (session: string, revision = 1, name = "Staplr", who = cookie) => {
    const response = await as(who, offerPath(session), "POST", { draftId, revision, name });
    expect(response.status).toBe(200);
    return await response.json() as import("../src/ai-review-types").ReviewOffer;
  };
  const decision = (offer: import("../src/ai-review-types").ReviewOffer, kind = "CORRECT", extra: Record<string, unknown> = {}) => ({ offerId: offer.id, draftId: offer.draftId, revision: offer.revision, decision: kind, correction: "Staple remover", ...extra });
  it("uses current verified names and aliases, no AI for exact matches, and ignores forged candidates", async () => {
    const calls = seed();
    sqlite.prepare("UPDATE items SET aliases = 'Office stapler' WHERE id = 'ITM-AI-1'").run();
    const session = await begin(await place("AI test shelf"));
    expect((await ask(session, 1, "Office stapler")).reason).toBe("EXACT_MATCH");
    expect(calls).toEqual([]);
    sqlite.prepare("UPDATE items SET needs_review = 1 WHERE id = 'ITM-AI-1'").run();
    const response = await staff(offerPath(session), "POST", { draftId, revision: 2, name: "Office stapler", candidates: [{ id: "ITM-AI-1", name: "Office stapler" }], terms: ["Office stapler"] });
    expect((await response.json() as { proposal: unknown }).proposal).toBeNull();
  });
  it("claims one text call per draft revision, including concurrent requests, with actor ownership", async () => {
    const calls = seed();
    const session = await begin(await place("AI test shelf"));
    expect((await as(otherCookie, offerPath(session), "POST", { draftId, revision: 1, name: "Staplr" })).status).toBe(403);
    const first = await ask(session);
    expect(first.proposal).toMatchObject({ kind: "REVIEW_ONLY", field: "term", value: "Stapler" });
    expect((await ask(session)).id).toBe(first.id);
    expect(calls).toHaveLength(1);
    await Promise.all([ask(session, 2), ask(session, 2)]);
    expect(calls).toHaveLength(2);
    await staff(offerPath(session), "POST", { draftId: crypto.randomUUID(), revision: 1, name: "Staplr" });
    await ask(session, 2);
    expect(calls).toHaveLength(3);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM system_settings WHERE key LIKE 'ai_review_offer:%'").get() as { n: number }).n).toBe(1);
  });
  it("saves item and feedback once atomically, keeps corrections unverified until review", async () => {
    seed(); const shelf = await place("AI test shelf"); const session = await begin(shelf); const offer = await ask(session);
    const body = shot(shelf, { name: "Staple remover", category: "TOOLS", behaviour: "BORROW", acknowledged: ["ITM-AI-2"], aiFeedback: decision(offer) });
    const response = await save(session, body); expect(response.status).toBe(201);
    const saved = await response.json() as { id: string };
    expect(feedbackCount()).toBe(1);
    expect((await save(session, body)).status).toBe(200); expect(feedbackCount()).toBe(1);
    const { reviewProposals } = await import("../src/ai-review");
    expect((await reviewProposals(env.DB)).proposals).toEqual([]);
    sqlite.prepare("UPDATE items SET needs_review = 0 WHERE id = ?").run(saved.id);
    expect((await reviewProposals(env.DB)).proposals[0]).toMatchObject({ observed: "staplr", support: 1, actors: 1, target: { name: "Staple remover" } });
  });
  it("rolls feedback back with a refused capture", async () => {
    seed(); const shelf = await place("AI test shelf"); const session = await begin(shelf); const offer = await ask(session);
    sqlite.exec("CREATE TRIGGER refuse_ai_capture BEFORE INSERT ON catalogue_captures BEGIN SELECT RAISE(ABORT, 'test_capture_refused'); END;");
    const items = count("items");
    expect((await save(session, shot(shelf, { aiFeedback: decision(offer, "REJECT") }))).status).toBe(500);
    expect(count("items")).toBe(items); expect(feedbackCount()).toBe(0);
  });
  it("ignores forged, stale, cross-actor and expired feedback while saving manually", async () => {
    seed(); const shelf = await place("AI test shelf"); const session = await begin(shelf); const offer = await ask(session);
    for (const extra of [{ offerId: crypto.randomUUID() }, { draftId: crypto.randomUUID() }, { revision: 99 }]) {
      expect((await save(session, shot(shelf, { aiFeedback: decision(offer, "KEEP", extra) }))).status).toBe(201);
    }
    const secondSession = await begin(shelf, otherCookie);
    expect((await save(secondSession, shot(shelf, { aiFeedback: decision(offer) }), otherCookie)).status).toBe(201);
    const fresh = await ask(session, 2);
    const current = sqlite.prepare("SELECT value FROM system_settings WHERE key = 'ai_review_offer:ACC-1'").get() as { value: string };
    sqlite.prepare("UPDATE system_settings SET value = ? WHERE key = 'ai_review_offer:ACC-1'").run(JSON.stringify({ ...JSON.parse(current.value), expiresAt: 0 }));
    expect((await save(session, shot(shelf, { aiFeedback: decision(fresh) }))).status).toBe(201);
    expect(feedbackCount()).toBe(0);
  });
  it("kept guesses, mismatched corrections and poisoned unreviewed items never vote", async () => {
    seed(); const shelf = await place("AI test shelf"); const session = await begin(shelf);
    for (const kind of ["KEEP", "CORRECT"]) {
      const offer = await ask(session, kind === "KEEP" ? 1 : 2);
      expect((await save(session, shot(shelf, { aiFeedback: decision(offer, kind), name: `${kind} Invented` }))).status).toBe(201);
    }
    sqlite.prepare("UPDATE items SET needs_review = 0").run();
    const { reviewProposals } = await import("../src/ai-review");
    expect((await reviewProposals(env.DB)).proposals).toEqual([]);
  });
  it("admin decisions need independent reviewed outcomes and preserve the first decision", async () => {
    seed(); const shelf = await place("AI test shelf"); const session = await begin(shelf); const other = await begin(shelf, otherCookie);
    for (const [who, targetSession, revision] of [[cookie, session, 1], [cookie, session, 2], [otherCookie, other, 1]] as const) {
      const offer = await ask(targetSession, revision, "Staplr", who);
      const response = await save(targetSession, shot(shelf, { name: "Staple remover", category: "TOOLS", behaviour: "BORROW", acknowledged: (sqlite.prepare("SELECT id FROM items WHERE name = 'Staple remover'").all() as { id: string }[]).map((item) => item.id), aiFeedback: decision(offer) }), who);
      expect(response.status).toBe(201);
      sqlite.prepare("UPDATE items SET needs_review = 0 WHERE id = ?").run((await response.json() as { id: string }).id);
    }
    expect((await staff("/api/staff/admin/catalog/proposals")).status).toBe(403);
    sqlite.prepare("UPDATE staff_accounts SET role = 'ADMIN' WHERE id = 'ACC-1'").run();
    const data = await (await staff("/api/staff/admin/catalog/proposals")).json() as { proposals: import("../src/ai-review-types").KnowledgeProposal[] };
    expect(data.proposals[0]).toMatchObject({ support: 3, actors: 2, conflicts: 0 });
    const id = data.proposals[0]!.id;
    const [first, second] = await Promise.all([staff("/api/staff/admin/catalog/proposals", "POST", { id, decision: "APPROVE" }), staff("/api/staff/admin/catalog/proposals", "POST", { id, decision: "REJECT" })]);
    expect(first.status).toBe(200); expect(await first.json()).toEqual(await second.json());
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'AI_KNOWLEDGE_DECIDED'").get() as { n: number }).n).toBe(1);
  });
});

describe("review routing at the Worker boundary", () => {
  it("abstains when the bounded catalogue window is full, including exact items beyond it", async () => {
    sqlite.prepare("UPDATE items SET status = 'ARCHIVED'").run();
    const insert = sqlite.prepare("INSERT INTO items(id, name, category, item_type, consumption_mode, unit, needs_review) VALUES(?, ?, 'TOOLS', 'Loanable', 'WHOLE_UNIT', 'piece', 0)");
    for (let at = 0; at < 1001; at += 1) insert.run(`ITM-AI-${String(at).padStart(4, "0")}`, `Stapler ${at}`);
    const run = vi.fn(async () => ({ response: { term: "Stapler 0" } })); env.AI = { run } as unknown as Ai;
    const shelf = await place("AI bounded shelf"); const session = await begin(shelf);
    const response = await staff(`/api/staff/catalogue/sessions/${session}/ai-offer`, "POST", { draftId: crypto.randomUUID(), revision: 1, name: "Stapler 1000" });
    expect(await response.json()).toMatchObject({ proposal: null, reason: "UNAVAILABLE" }); expect(run).not.toHaveBeenCalled();
    expect((await save(session, shot(shelf))).status).toBe(201);
  });
  it("discards an offer when the catalogue changes during the model call", async () => {
    sqlite.prepare("UPDATE items SET status = 'ARCHIVED'").run();
    sqlite.prepare("INSERT INTO items(id, name, category, item_type, consumption_mode, unit, needs_review) VALUES('ITM-AI-S', 'Stapler', 'TOOLS', 'Loanable', 'WHOLE_UNIT', 'piece', 0)").run();
    env.AI = { run: async () => { sqlite.prepare("UPDATE catalog_revision SET value = value + 1 WHERE id = 1").run(); return { response: { term: "Stapler" } }; } } as unknown as Ai;
    const shelf = await place("AI stale shelf"); const session = await begin(shelf);
    const response = await staff(`/api/staff/catalogue/sessions/${session}/ai-offer`, "POST", { draftId: crypto.randomUUID(), revision: 1, name: "Staplr" });
    expect(await response.json()).toMatchObject({ proposal: null, label: null, reason: "STALE_CATALOGUE" });
    expect((await save(session, shot(shelf))).status).toBe(201);
  });
  it("uses one reviewed-candidate role, strict replies and minimal facts", async () => {
    sqlite.prepare("UPDATE items SET status = 'ARCHIVED'").run();
    sqlite.prepare("INSERT INTO items(id, name, category, item_type, consumption_mode, unit, needs_review) VALUES('ITM-AI-B', 'Whiteboard Marker Black', 'TOOLS', 'Loanable', 'WHOLE_UNIT', 'piece', 0), ('ITM-AI-C', 'Whiteboard Marker Blue', 'TOOLS', 'Loanable', 'WHOLE_UNIT', 'piece', 0), ('ITM-AI-D', 'Whiteboard Marker Private', 'TOOLS', 'Loanable', 'WHOLE_UNIT', 'piece', 1)").run();
    const calls: { model: string; input: { messages: { content: string }[] } }[] = [];
    env.AI = { run: async (model: string, input: { messages: { content: string }[] }) => { calls.push({ model, input }); return { response: { id: "ITM-AI-C" } }; } } as unknown as Ai;
    const session = await begin(await place("AI boundary shelf"));
    const response = await staff(`/api/staff/catalogue/sessions/${session}/ai-offer`, "POST", { draftId: crypto.randomUUID(), revision: 1, name: "Whiteboard marker", notes: "private notes", serialNumber: "private serial" });
    expect(await response.json()).toMatchObject({ proposal: { role: "CANDIDATE_ARBITRATE", field: "id", value: "ITM-AI-C" }, label: "Whiteboard Marker Blue" });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.input.messages[1]!.content)).toEqual({ name: "Whiteboard marker", candidates: [{ id: "ITM-AI-B", name: "Whiteboard Marker Black" }, { id: "ITM-AI-C", name: "Whiteboard Marker Blue" }] });
  });
  it("asks GLM only a fixed conflict below 6500, and owner-off never calls a provider", async () => {
    sqlite.prepare("UPDATE items SET status = 'ARCHIVED'").run();
    sqlite.prepare("INSERT INTO items(id, name, category, item_type, consumption_mode, unit, needs_review) VALUES('ITM-AI-G', 'Sheet paper', 'PAPER', 'Consumable', 'WHOLE_UNIT', 'piece', 0)").run();
    const calls: unknown[] = [];
    env.AI = { run: async (_model: string, input: { messages: { content: string }[] }) => { calls.push(JSON.parse(input.messages[1]!.content)); return { response: { follow_up: "CHECK_COUNTING_UNIT" } }; } } as unknown as Ai;
    const session = await begin(await place("AI conflict shelf"));
    const path = `/api/staff/catalogue/sessions/${session}/ai-offer`;
    const ask = (revision: number) => staff(path, "POST", { draftId: "10000000-0000-4000-8000-000000000002", revision, name: "pack she" });
    expect(await (await ask(1)).json()).toMatchObject({ proposal: { role: "RARE_SECOND_OPINION", field: "follow_up" } });
    expect(calls).toEqual([{ conflicts: ["UNIT_SPLIT"], allowed: ["CHECK_NAME", "CHECK_CATEGORY", "CHECK_COUNTING_UNIT", "CHECK_BORROW_OR_TAKE", "LOOKS_LIKE_EXISTING_ITEM"] }]);
    sqlite.prepare("INSERT OR REPLACE INTO system_settings(key, value, updated_at) VALUES(?, '6500', ?)").run(`ai_neurons:${new Date().toISOString().slice(0, 10)}`, new Date().toISOString());
    expect(await (await ask(2)).json()).toMatchObject({ proposal: null }); expect(calls).toHaveLength(1);
    sqlite.prepare("INSERT OR REPLACE INTO system_settings(key, value, updated_at) VALUES('ambient_assist', 'off', ?)").run(new Date().toISOString());
    expect(await (await staff(path, "POST", { draftId: crypto.randomUUID(), revision: 1, name: "shee paper" })).json()).toMatchObject({ proposal: null, reason: "SWITCHED_OFF" });
    expect(calls).toHaveLength(1);
  });
});
