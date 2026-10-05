import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";
import { jpeg } from "./jpeg";
// @ts-expect-error: a plain .mjs tool
import * as ops from "../scripts/ops/production-release.mjs";

/* V1.4 smart locations: the migration's reconciliation, the database's own guards, then the Worker routes end to end. */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let media: ReturnType<typeof memoryR2>;
let cookie: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const staff = (path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const anyone = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method, headers: { origin, "content-type": "application/json", ...headers }, body: body === undefined || method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body) });

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
});

async function signIn(username: string): Promise<string> {
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${username}` }, body: JSON.stringify({ username, password: "correct horse battery" }) });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

type Place = { id: string; name: string; parentId: string | null; directions: string | null; visibility: string; active: boolean; updatedAt: string; photo: { id: string; width: number; height: number } | null; itemCount: number; openReports: number };
const places = async () => ((await (await staff("/api/staff/locations")).json()) as { locations: Place[] }).locations;
const place = async (name: string) => (await places()).find((entry) => entry.name === name)!;
async function addPlace(fields: Record<string, unknown>): Promise<string> {
  const response = await staff("/api/staff/locations", "POST", fields);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
const edit = async (id: string, changes: Record<string, unknown>) => {
  const current = (await places()).find((entry) => entry.id === id)!;
  return staff(`/api/staff/locations/${id}`, "PATCH", { name: current.name, parentId: current.parentId, directions: current.directions, visibility: current.visibility, active: current.active, updatedAt: current.updatedAt, ...changes });
};
const item = { name: "Stapler", category: "SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", locationId: null, reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING", needsReview: false, notes: null };
async function addItem(fields: Record<string, unknown> = {}): Promise<string> {
  const response = await staff("/api/staff/items", "POST", { ...item, openingQuantity: 5, ...fields });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
const detail = async (id: string) => await (await staff(`/api/staff/items/${id}`)).json() as { item: Record<string, unknown>; reports: Array<Record<string, unknown>>; events: Array<{ action: string; details: Record<string, { from: unknown; to: unknown }> }> };
const onHand = (id: string) => (sqlite.prepare("SELECT on_hand FROM inventory_balances WHERE id = ?").get(id) as { on_hand: number }).on_hand;
const locationOf = (id: string) => (sqlite.prepare("SELECT location_id AS id FROM items WHERE id = ?").get(id) as { id: string | null }).id;

describe("migration 0024 on a database that is already in use", () => {
  function migrate() {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const apply = (file: string) => { db.exec("BEGIN"); db.exec(fs.readFileSync(`migrations/${file}`, "utf8")); db.exec("COMMIT"); };
    const files = fs.readdirSync("migrations").sort();
    files.filter((file) => file < "0024").forEach(apply);
    // What staff typed over time: a repeat, a different case, stray spaces, a blank, and one place a phone offers.
    const set = db.prepare("UPDATE items SET storage_location = ?, status = ?, needs_review = 0, item_type = ?, lending_audience = ? WHERE id = ?");
    set.run("Office cabinet 2", "ACTIVE", "Consumable", "NOT_AVAILABLE_FOR_LENDING", "ITM-0001");
    set.run("Office cabinet 2", "ACTIVE", "Loanable", "NOT_AVAILABLE_FOR_LENDING", "ITM-0002");
    set.run("office cabinet 2", "ACTIVE", "Loanable", "NOT_AVAILABLE_FOR_LENDING", "ITM-0003");
    set.run("  Shelf A ", "ACTIVE", "Loanable", "STUDENTS_AND_USC_STAFF", "ITM-0004");
    set.run("   ", "ACTIVE", "Loanable", "NOT_AVAILABLE_FOR_LENDING", "ITM-0005");
    set.run("Pantry", "INACTIVE", "Consumable", "NOT_AVAILABLE_FOR_LENDING", "ITM-0006");
    const before = db.prepare("SELECT id, storage_location, updated_at FROM items ORDER BY id").all();
    const balances = db.prepare("SELECT id, on_hand FROM inventory_balances ORDER BY id").all();
    apply("0024_locations.sql");
    return { db, before, balances };
  }

  it("makes one place per distinct typed value, links each item by that exact value and never merges look-alikes", () => {
    const { db } = migrate();
    expect(db.prepare("SELECT name FROM locations ORDER BY id").all()).toEqual([{ name: "Office cabinet 2" }, { name: "office cabinet 2" }, { name: "Pantry" }, { name: "Shelf A" }]);
    const linked = db.prepare("SELECT i.id, l.name FROM items i JOIN locations l ON l.id = i.location_id ORDER BY i.id").all();
    expect(linked).toEqual([{ id: "ITM-0001", name: "Office cabinet 2" }, { id: "ITM-0002", name: "Office cabinet 2" }, { id: "ITM-0003", name: "office cabinet 2" }, { id: "ITM-0004", name: "Shelf A" }, { id: "ITM-0006", name: "Pantry" }]);
    // A blank value and every item that never had one stay without a place.
    expect(db.prepare("SELECT COUNT(*) AS n FROM items WHERE location_id IS NULL").get()).toEqual({ n: 397 - 5 });
    db.close();
  });

  it("keeps every original value, quantity and edit version exactly as it was", () => {
    const { db, before, balances } = migrate();
    expect(db.prepare("SELECT id, storage_location, updated_at FROM items ORDER BY id").all()).toEqual(before);
    expect(db.prepare("SELECT id, on_hand FROM inventory_balances ORDER BY id").all()).toEqual(balances);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("shares with Self-Service only a place whose item a phone is offered today, and writes its evidence to the audit log", () => {
    const { db } = migrate();
    // ITM-0004 is a reviewed, active, listed Loanable; the others are not offered to phones (a Consumable is, but ITM-0001's place also holds a non-offered item).
    expect(db.prepare("SELECT name, visibility FROM locations ORDER BY id").all()).toEqual([
      { name: "Office cabinet 2", visibility: "SELF_SERVICE" }, { name: "office cabinet 2", visibility: "STAFF_ONLY" }, { name: "Pantry", visibility: "STAFF_ONLY" }, { name: "Shelf A", visibility: "SELF_SERVICE" }]);
    const evidence = db.prepare("SELECT action, entity_type, actor_user_id, details_json FROM audit_log WHERE id = 'MIGRATION-0024-LOCATIONS'").get() as { action: string; entity_type: string; actor_user_id: string | null; details_json: string };
    expect(evidence).toMatchObject({ action: "LOCATIONS_RECONCILED", entity_type: "LOCATION", actor_user_id: null });
    expect(JSON.parse(evidence.details_json)).toEqual({ itemsWithStorageLocation: 5, itemsLinked: 5, locationsCreated: 4, sharedWithSelfService: 2, sameNameDifferentCase: 1 });
    db.close();
  });

  it("leaves a database with no typed locations with no places and every item as before", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const file of fs.readdirSync("migrations").sort()) { db.exec("BEGIN"); db.exec(fs.readFileSync(`migrations/${file}`, "utf8")); db.exec("COMMIT"); }
    expect(db.prepare("SELECT COUNT(*) AS n FROM locations").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM items WHERE location_id IS NOT NULL").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe("the database keeps places and reports sound for every writer", () => {
  const insert = (id: string, name: string, parent: string | null = null) =>
    sqlite.prepare("INSERT INTO locations(id, name, parent_id, created_at, updated_at) VALUES(?, ?, ?, 'x', 'x')").run(id, name, parent);

  it("refuses loops, an active place under an inactive one, and deactivating a place that holds active ones", () => {
    insert("LOC-0001", "Office");
    insert("LOC-0002", "Cabinet", "LOC-0001");
    expect(() => sqlite.exec("UPDATE locations SET parent_id = 'LOC-0002' WHERE id = 'LOC-0001'")).toThrow(/location_cycle/);
    expect(() => sqlite.exec("UPDATE locations SET parent_id = 'LOC-0001' WHERE id = 'LOC-0001'")).toThrow();
    expect(() => sqlite.exec("UPDATE locations SET active = 0 WHERE id = 'LOC-0001'")).toThrow(/location_has_active_children/);
    sqlite.exec("UPDATE locations SET active = 0 WHERE id = 'LOC-0002'");
    sqlite.exec("UPDATE locations SET active = 0 WHERE id = 'LOC-0001'");
    expect(() => insert("LOC-0003", "Shelf", "LOC-0001")).toThrow(/location_parent_inactive/);
    expect(() => sqlite.exec("UPDATE locations SET active = 1 WHERE id = 'LOC-0002'")).toThrow(/location_parent_inactive/);
  });

  it("keeps sibling names distinct (exactly) and paths and sharing correct down the tree", () => {
    insert("LOC-0001", "Office");
    insert("LOC-0002", "Cabinet 1", "LOC-0001");
    insert("LOC-0003", "Shelf 2", "LOC-0002");
    expect(() => insert("LOC-0004", "Cabinet 1", "LOC-0001")).toThrow(/UNIQUE/);
    expect(() => insert("LOC-0004", "Office")).toThrow(/UNIQUE/);
    insert("LOC-0004", "cabinet 1", "LOC-0001");
    sqlite.exec("UPDATE locations SET visibility = 'SELF_SERVICE' WHERE id IN ('LOC-0002', 'LOC-0003')");
    expect(sqlite.prepare("SELECT id, path, depth, shown FROM location_paths ORDER BY id").all()).toEqual([
      { id: "LOC-0001", path: "Office", depth: 1, shown: 0 }, { id: "LOC-0002", path: "Office › Cabinet 1", depth: 2, shown: 0 },
      { id: "LOC-0003", path: "Office › Cabinet 1 › Shelf 2", depth: 3, shown: 0 }, { id: "LOC-0004", path: "Office › cabinet 1", depth: 2, shown: 0 }]);
    // One staff-only place above hides everything beneath it; sharing the top makes the shared ones show.
    sqlite.exec("UPDATE locations SET visibility = 'SELF_SERVICE' WHERE id = 'LOC-0001'");
    expect(sqlite.prepare("SELECT id, shown FROM location_paths ORDER BY id").all()).toEqual([{ id: "LOC-0001", shown: 1 }, { id: "LOC-0002", shown: 1 }, { id: "LOC-0003", shown: 1 }, { id: "LOC-0004", shown: 0 }]);
    sqlite.exec("UPDATE locations SET active = 0 WHERE id = 'LOC-0003'");
    expect(sqlite.prepare("SELECT shown FROM location_paths WHERE id = 'LOC-0003'").get()).toEqual({ shown: 0 });
  });

  it("refuses to keep an item in an inactive place", () => {
    insert("LOC-0001", "Office");
    sqlite.exec("UPDATE locations SET active = 0 WHERE id = 'LOC-0001'");
    expect(() => sqlite.exec("UPDATE items SET location_id = 'LOC-0001' WHERE id = 'ITM-0001'")).toThrow(/location_inactive/);
    expect(() => sqlite.prepare("INSERT INTO items(id, name, category, item_type, unit, location_id) VALUES('ITM-X', 'X', 'C', 'Loanable', 'piece', 'LOC-0001')").run()).toThrow(/location_inactive/);
    expect(() => sqlite.exec("UPDATE items SET location_id = 'LOC-9999' WHERE id = 'ITM-0001'")).toThrow();
  });

  it("writes a report once, resolves it once, and never edits or removes one", () => {
    sqlite.prepare("INSERT INTO location_reports(id, item_id, kind, source, reported_by, created_at) VALUES(?, 'ITM-0001', 'CANT_FIND', 'STAFF', 'ACC-1', 'x')").run("a".repeat(36));
    expect(() => sqlite.exec("UPDATE location_reports SET kind = 'LOCATION_WRONG'")).toThrow(/location_report_final/);
    expect(() => sqlite.exec("UPDATE location_reports SET note = 'x'")).toThrow(/location_report_final/);
    expect(() => sqlite.exec("DELETE FROM location_reports")).toThrow(/append-only/);
    sqlite.exec("UPDATE location_reports SET resolved_at = 'y', resolved_by = 'ACC-1'");
    expect(() => sqlite.exec("UPDATE location_reports SET resolution_note = 'later'")).toThrow(/location_report_final/);
    expect(() => sqlite.exec("UPDATE location_reports SET reporter_name = 'Someone'")).toThrow(/location_report_final/);
    // A phone report has no staff reporter; a staff report always has one; a resolution has both halves.
    expect(() => sqlite.prepare("INSERT INTO location_reports(id, item_id, kind, source, created_at) VALUES(?, 'ITM-0001', 'CANT_FIND', 'STAFF', 'x')").run("b".repeat(36))).toThrow(/CHECK/);
    expect(() => sqlite.prepare("INSERT INTO location_reports(id, item_id, kind, source, reported_by, created_at) VALUES(?, 'ITM-0001', 'CANT_FIND', 'SELF_SERVICE', 'ACC-1', 'x')").run("c".repeat(36))).toThrow(/CHECK/);
  });
});

describe("managing places", () => {
  it("creates, nests, renames and lists places with the number of items kept in each", async () => {
    const office = await addPlace({ name: "  Office  " });
    const cabinet = await addPlace({ name: "Cabinet 1", parentId: office, directions: "Left of the door." });
    const shelf = await addPlace({ name: "Shelf 2", parentId: cabinet, visibility: "SELF_SERVICE" });
    const stapler = await addItem({ locationId: shelf });
    expect(await places()).toMatchObject([
      { id: cabinet, name: "Cabinet 1", parentId: office, directions: "Left of the door.", visibility: "STAFF_ONLY", active: true, itemCount: 0 },
      { id: office, name: "Office", parentId: null, directions: null, itemCount: 0 },
      { id: shelf, name: "Shelf 2", parentId: cabinet, visibility: "SELF_SERVICE", itemCount: 1 }]);
    expect((await edit(cabinet, { name: "Cabinet One" })).status).toBe(200);
    expect(sqlite.prepare("SELECT path FROM location_paths WHERE id = ?").get(shelf)).toEqual({ path: "Office › Cabinet One › Shelf 2" });
    // The item reads its place by id, so the new name reaches it without touching the item.
    expect((await detail(stapler)).item).toMatchObject({ locationId: shelf, location: "Office › Cabinet One › Shelf 2", legacyLocation: null });
    expect(sqlite.prepare("SELECT action, entity_type FROM audit_log WHERE entity_type = 'LOCATION' ORDER BY rowid").all()).toEqual([
      { action: "LOCATIONS_RECONCILED", entity_type: "LOCATION" }, { action: "LOCATION_CREATED", entity_type: "LOCATION" }, { action: "LOCATION_CREATED", entity_type: "LOCATION" }, { action: "LOCATION_CREATED", entity_type: "LOCATION" }, { action: "LOCATION_UPDATED", entity_type: "LOCATION" }]);
  });

  it("refuses bad names and parents, near-duplicate siblings, loops and more than five levels, in plain words", async () => {
    const a = await addPlace({ name: "A" });
    const b = await addPlace({ name: "B", parentId: a });
    const c = await addPlace({ name: "C", parentId: b });
    const d = await addPlace({ name: "D", parentId: c });
    const e = await addPlace({ name: "E", parentId: d });
    for (const bad of [{ name: "" }, { name: "x".repeat(121) }, { name: "Cabinet › Shelf" }, { name: "Shelf", parentId: "LOC-9999" }, { name: "Shelf", parentId: "nope" }, { name: "Shelf", visibility: "EVERYONE" }, { name: "Shelf", directions: "x".repeat(601) }]) {
      expect((await staff("/api/staff/locations", "POST", bad)).status, JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
    const deep = await staff("/api/staff/locations", "POST", { name: "F", parentId: e });
    expect(deep.status).toBe(400);
    expect(((await deep.json()) as { error: string }).error).toMatch(/at most 5 levels/);
    const twin = await staff("/api/staff/locations", "POST", { name: "b", parentId: a });
    expect(twin.status).toBe(409);
    expect(((await twin.json()) as { error: string }).error).toMatch(/already has a place called B/);
    expect((await addPlace({ name: "b" })).length).toBeGreaterThan(0);
    expect((await edit(a, { parentId: e })).status).toBe(400);
    expect((await edit(a, { parentId: a })).status).toBe(400);
    // Moving a place with places inside it counts their depth too.
    const top = await addPlace({ name: "Top" });
    expect((await edit(top, { parentId: e })).status).toBe(400);
    const lone = await addPlace({ name: "Lone" });
    expect((await edit(a, { parentId: lone })).status).toBe(400);
  });

  it("keeps look-alike places from reconciliation editable, but refuses to create or rename into one", async () => {
    sqlite.exec("INSERT INTO locations(id, name, created_at, updated_at) VALUES('LOC-0001', 'Cabinet 1', '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z'), ('LOC-0002', 'cabinet 1', '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z')");
    expect((await edit("LOC-0002", { directions: "Second shelf from the top." })).status).toBe(200);
    expect((await edit("LOC-0002", { name: "CABINET 1" })).status).toBe(409);
    expect((await staff("/api/staff/locations", "POST", { name: "CABINET 1" })).status).toBe(409);
  });

  it("answers a stale edit with 409 instead of overwriting, and a no-op edit with nothing changed", async () => {
    const id = await addPlace({ name: "Office" });
    const loaded = await place("Office");
    expect((await edit(id, { directions: "First change." })).status).toBe(200);
    const stale = await staff(`/api/staff/locations/${id}`, "PATCH", { name: "Office", parentId: null, directions: "Second", visibility: "STAFF_ONLY", active: true, updatedAt: loaded.updatedAt });
    expect(stale.status).toBe(409);
    expect((await place("Office")).directions).toBe("First change.");
    expect(await (await edit(id, {})).json()).toMatchObject({ changed: 0 });
    expect((await staff(`/api/staff/locations/${id}`, "PATCH", { name: "Office" })).status).toBe(409);
    expect((await staff("/api/staff/locations/LOC-9999", "PATCH", { name: "x", updatedAt: "x" })).status).toBe(404);
  });

  it("deactivates a place without touching its items, refuses it while places inside are in use, and refuses new items there", async () => {
    const office = await addPlace({ name: "Office" });
    const cabinet = await addPlace({ name: "Cabinet", parentId: office });
    const stapler = await addItem({ locationId: cabinet });
    const refused = await edit(office, { active: false });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/Places inside it are still in use/);
    expect((await edit(cabinet, { active: false })).status).toBe(200);
    expect((await edit(office, { active: false })).status).toBe(200);
    // History and the item keep their place; it just cannot receive more.
    expect(locationOf(stapler)).toBe(cabinet);
    expect((await detail(stapler)).item).toMatchObject({ location: "Office › Cabinet" });
    const move = await staff(`/api/staff/items/${stapler}`, "PATCH", { ...(await detail(stapler)).item, locationId: office });
    expect(move.status).toBe(409);
    expect((await staff("/api/staff/items", "POST", { ...item, openingQuantity: 0, locationId: cabinet })).status).toBe(409);
    expect((await staff("/api/staff/locations", "POST", { name: "Under", parentId: office })).status).toBe(409);
    // Reactivating the child first would put an active place under an inactive one.
    expect((await edit(cabinet, { active: true })).status).toBe(409);
    expect((await edit(office, { active: true })).status).toBe(200);
    expect((await edit(cabinet, { active: true })).status).toBe(200);
  });

  it("moves every item of one place to another with a history entry per item, combining look-alikes only on purpose", async () => {
    const one = await addPlace({ name: "Cabinet 1" });
    const two = await addPlace({ name: "Shelf A" });
    const first = await addItem({ locationId: one });
    const second = await addItem({ name: "Tape", locationId: one });
    const other = await addItem({ name: "Glue", locationId: two });
    const moved = await staff(`/api/staff/locations/${one}/move-items`, "POST", { toLocationId: two });
    expect(await moved.json()).toEqual({ moved: 2 });
    expect([first, second, other].map(locationOf)).toEqual([two, two, two]);
    expect((await detail(first)).events.find((event) => event.action === "ITEM_UPDATED")!.details.storageLocation).toEqual({ from: "Cabinet 1", to: "Shelf A" });
    expect(sqlite.prepare("SELECT action FROM audit_log WHERE entity_type = 'LOCATION' AND action = 'LOCATION_ITEMS_MOVED'").all()).toHaveLength(1);
    expect((await place("Shelf A")).itemCount).toBe(3);
    // Stale open forms of a moved item now fail instead of overwriting.
    expect((await staff(`/api/staff/locations/${one}/move-items`, "POST", { toLocationId: one })).status).toBe(400);
    expect((await staff(`/api/staff/locations/${one}/move-items`, "POST", { toLocationId: "LOC-9999" })).status).toBe(400);
    expect((await staff(`/api/staff/locations/LOC-9999/move-items`, "POST", { toLocationId: two })).status).toBe(404);
    expect(await (await staff(`/api/staff/locations/${one}/move-items`, "POST", { toLocationId: two })).json()).toEqual({ moved: 0 });
  });

  it("deletes a place added by mistake only when nothing is kept in it, nothing is inside it and no record names it", async () => {
    const remove = async (id: string) => staff(`/api/staff/locations/${id}?expected=${encodeURIComponent((await places()).find((entry) => entry.id === id)!.updatedAt)}`, "DELETE");
    const room = await addPlace({ name: "Store room" });
    const shelf = await addPlace({ name: "Shelf A", parentId: room });
    const typo = await addPlace({ name: "Cabinet Row 4" });
    const stapler = await addItem({ locationId: typo });

    const held = await remove(typo);
    expect(held.status).toBe(409);
    expect(((await held.json()) as { error: string }).error).toBe("1 item is kept here. Move it to another place first (Move items, below), then delete it.");
    expect(((await (await remove(room)).json()) as { error: string }).error).toBe("1 place is inside it. Move or delete it first.");
    // A stale form, and a place that does not exist.
    expect((await staff(`/api/staff/locations/${shelf}?expected=2000-01-01T00:00:00.000Z`, "DELETE")).status).toBe(409);
    expect((await staff("/api/staff/locations/LOC-9999?expected=x", "DELETE")).status).toBe(404);

    // Emptied by Move items, the place can go; its item and the item's history are untouched.
    await staff(`/api/staff/locations/${typo}/move-items`, "POST", { toLocationId: shelf });
    expect((await remove(typo)).status).toBe(200);
    expect((await places()).map((entry) => entry.id)).not.toContain(typo);
    expect(locationOf(stapler)).toBe(shelf);
    expect(sqlite.prepare("SELECT details_json AS details FROM audit_log WHERE action = 'LOCATION_DELETED'").get()).toEqual({ details: JSON.stringify({ name: "Cabinet Row 4", path: "Cabinet Row 4", parentId: null }) });
    const feed = (await (await staff("/api/staff/activity?limit=50&source=CATALOG")).json()) as { events: Array<{ summary: string }> };
    expect(feed.events.map((event) => event.summary)).toEqual(expect.arrayContaining(["Staff One added the place Cabinet Row 4.", "Staff One deleted the place Cabinet Row 4."]));

    // A place a record names stays: it can only be turned off.
    const counted = await addPlace({ name: "Shelf B", parentId: room });
    sqlite.prepare("INSERT INTO location_reports(id, item_id, location_id, kind, source, reported_by, created_at) VALUES(?, ?, ?, 'CANT_FIND', 'STAFF', 'ACC-1', ?)")
      .run(crypto.randomUUID(), stapler, counted, new Date().toISOString());
    expect(((await (await remove(counted)).json()) as { error: string }).error).toMatch(/^Past records name this place .*Turn off In use instead/);
    // The database itself refuses if a record arrives between the check and the delete.
    expect(() => sqlite.prepare("DELETE FROM locations WHERE id = ?").run(counted)).toThrow(/FOREIGN KEY/);

    // Its picture goes with it.
    const form = new FormData();
    form.set("display", new File([jpeg({ width: 40, height: 30 }) as BlobPart], "display.jpg", { type: "image/jpeg" }));
    form.set("thumb", new File([jpeg({ width: 16, height: 12 }) as BlobPart], "thumb.jpg", { type: "image/jpeg" }));
    form.set("expected", "");
    expect((await call(`/api/staff/locations/${shelf}/photo`, { method: "PUT", headers: { origin, cookie }, body: form })).status).toBe(200);
    await staff(`/api/staff/locations/${shelf}/move-items`, "POST", { toLocationId: room });
    expect(media.objects.size).toBe(2);
    expect((await remove(shelf)).status).toBe(200);
    expect(media.objects.size).toBe(0);
  });
});

describe("an item's place", () => {
  it("is chosen by id, kept in history in words, and cleared on request; the original typed text is never rewritten", async () => {
    sqlite.exec("UPDATE items SET storage_location = 'Old shelf', status = 'ACTIVE' WHERE id = 'ITM-0001'");
    const before = (await detail("ITM-0001")).item;
    // An item whose typed text has no place yet shows it as the original value, and nothing is invented.
    expect(before).toMatchObject({ locationId: null, location: null, legacyLocation: "Old shelf" });
    const cabinet = await addPlace({ name: "Cabinet 2" });
    expect((await staff("/api/staff/items/ITM-0001", "PATCH", { ...before, locationId: cabinet })).status).toBe(200);
    expect((await detail("ITM-0001")).item).toMatchObject({ locationId: cabinet, location: "Cabinet 2", legacyLocation: null });
    expect(sqlite.prepare("SELECT storage_location FROM items WHERE id = 'ITM-0001'").get()).toEqual({ storage_location: "Old shelf" });
    const events = (await detail("ITM-0001")).events;
    expect(events.find((event) => event.action === "ITEM_UPDATED")!.details).toEqual({ storageLocation: { from: null, to: "Cabinet 2" } });
    await staff("/api/staff/items/ITM-0001", "PATCH", { ...(await detail("ITM-0001")).item, locationId: null });
    expect(locationOf("ITM-0001")).toBeNull();
  });

  it("refuses an unknown place and a malformed one", async () => {
    expect((await staff("/api/staff/items", "POST", { ...item, openingQuantity: 0, locationId: "LOC-9999" })).status).toBe(400);
    expect((await staff("/api/staff/items", "POST", { ...item, openingQuantity: 0, locationId: "Shelf A" })).status).toBe(400);
    expect((await staff("/api/staff/items", "POST", { ...item, openingQuantity: 0, locationId: { id: 1 } })).status).toBe(400);
  });

  it("appears in the inventory answer with the places, so the browser can filter and search with no further request", async () => {
    const cabinet = await addPlace({ name: "Cabinet 2" });
    const id = await addItem({ locationId: cabinet });
    const body = await (await staff("/api/staff/inventory")).json() as { items: Array<{ id: string; locationId: string | null; legacyLocation: string | null; openReports: number }>; locations: Place[] };
    expect(body.items.find((entry) => entry.id === id)).toMatchObject({ locationId: cabinet, legacyLocation: null, openReports: 0 });
    expect(body.locations).toMatchObject([{ id: cabinet, name: "Cabinet 2", itemCount: 1 }]);
    expect(body.items.every((entry) => !("storageLocation" in entry))).toBe(true);
  });

  it("filters Activity by a place's name or path, including everything inside it", async () => {
    const office = await addPlace({ name: "Office" });
    const cabinet = await addPlace({ name: "Cabinet 1", parentId: office });
    const other = await addPlace({ name: "Garage" });
    const inCabinet = await addItem({ name: "Stapler", locationId: cabinet });
    await addItem({ name: "Wrench", locationId: other });
    const ids = async (location: string) => [...new Set(((await (await staff(`/api/staff/activity?location=${encodeURIComponent(location)}&source=CATALOG&limit=50`)).json()) as { events: Array<{ itemId: string | null }> }).events.map((event) => event.itemId))];
    expect(await ids("Office")).toEqual([inCabinet]);
    expect(await ids("office › cabinet 1")).toEqual([inCabinet]);
    expect(await ids("Cabinet 1")).toEqual([]);
    expect(await ids("Of")).toEqual([]);
  });

  it("shows place edits, picture changes, moves and the migration's evidence in the Activity feed", async () => {
    const id = await addPlace({ name: "Cabinet 1" });
    await edit(id, { directions: "By the window." });
    const feed = (await (await staff("/api/staff/activity?limit=50&source=CATALOG")).json()) as { events: Array<{ type: string; summary: string }> };
    expect(feed.events.map((event) => event.summary)).toEqual(expect.arrayContaining(["Staff One added the place Cabinet 1.", "Staff One edited the place Cabinet 1: directions."]));
  });
});

describe("a place's picture", () => {
  const photoForm = (expected: string | null) => {
    const form = new FormData();
    form.set("display", new File([jpeg({ width: 40, height: 30 }) as BlobPart], "display.jpg", { type: "image/jpeg" }));
    form.set("thumb", new File([jpeg({ width: 16, height: 12 }) as BlobPart], "thumb.jpg", { type: "image/jpeg" }));
    form.set("expected", expected ?? "");
    return form;
  };
  const put = (id: string, expected: string | null = null) => call(`/api/staff/locations/${id}/photo`, { method: "PUT", headers: { origin, cookie }, body: photoForm(expected) });
  const keys = () => [...media.objects.keys()].sort();

  it("is stored once for the place, shared by every item kept there, replaced under a new id and removed with its files", async () => {
    const id = await addPlace({ name: "Cabinet 1" });
    const first = await put(id);
    expect(first.status).toBe(200);
    const { photo } = await first.json() as { photo: { id: string; width: number; height: number } };
    expect(keys()).toEqual([`locations/${photo.id}/display`, `locations/${photo.id}/thumb`]);
    expect(await place("Cabinet 1")).toMatchObject({ photo });
    await addItem({ locationId: id });
    expect((await staff(`/api/staff/location-media/${photo.id}/display`)).headers.get("content-type")).toBe("image/jpeg");
    expect((await staff(`/api/staff/location-media/${photo.id}/original`)).status).toBe(404);
    // A replacement needs the picture the client saw, gets a new id, and the old files go after the switch.
    expect((await put(id, null)).status).toBe(409);
    const second = await (await put(id, photo.id)).json() as { photo: { id: string } };
    expect(second.photo.id).not.toBe(photo.id);
    expect(keys()).toEqual([`locations/${second.photo.id}/display`, `locations/${second.photo.id}/thumb`]);
    expect((await call(`/api/staff/locations/${id}/photo?expected=${photo.id}`, { method: "DELETE", headers: { origin, cookie } })).status).toBe(409);
    expect((await call(`/api/staff/locations/${id}/photo?expected=${second.photo.id}`, { method: "DELETE", headers: { origin, cookie } })).status).toBe(200);
    expect(keys()).toEqual([]);
    expect((await place("Cabinet 1")).photo).toBeNull();
    expect(sqlite.prepare("SELECT action FROM audit_log WHERE action LIKE 'LOCATION_PHOTO_%' ORDER BY rowid").all()).toEqual([{ action: "LOCATION_PHOTO_ADDED" }, { action: "LOCATION_PHOTO_REPLACED" }, { action: "LOCATION_PHOTO_REMOVED" }]);
  });

  it("does not make an open edit form of the same place stale", async () => {
    const id = await addPlace({ name: "Cabinet 1" });
    const loaded = await place("Cabinet 1");
    await put(id);
    expect((await staff(`/api/staff/locations/${id}`, "PATCH", { name: "Cabinet 1", parentId: null, directions: "Now with a photo.", visibility: "STAFF_ONLY", active: true, updatedAt: loaded.updatedAt })).status).toBe(200);
  });

  it("refuses something that is not a clean browser JPEG and leaves no object behind", async () => {
    const id = await addPlace({ name: "Cabinet 1" });
    const form = photoForm(null);
    form.set("display", new File([new Uint8Array([1, 2, 3])], "display.jpg", { type: "image/jpeg" }));
    expect((await call(`/api/staff/locations/${id}/photo`, { method: "PUT", headers: { origin, cookie }, body: form })).status).toBe(400);
    expect(keys()).toEqual([]);
    expect((await call(`/api/staff/locations/LOC-9999/photo`, { method: "PUT", headers: { origin, cookie }, body: photoForm(null) })).status).toBe(404);
  });
});

describe("I can’t find it and Location looks wrong", () => {
  const report = (itemId: string, body: Record<string, unknown>) => staff(`/api/staff/items/${itemId}/location-report`, "POST", { id: crypto.randomUUID(), ...body });
  const stateOf = (id: string) => ({ quantity: onHand(id), place: locationOf(id), updatedAt: (sqlite.prepare("SELECT updated_at FROM items WHERE id = ?").get(id) as { updated_at: string | null }).updated_at, movements: sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE item_id = ?").get(id) });

  it("records an auditable attention signal and changes neither stock nor the item's place nor its edit version", async () => {
    const cabinet = await addPlace({ name: "Cabinet 1" });
    const id = await addItem({ locationId: cabinet });
    const before = stateOf(id);
    const made = await report(id, { kind: "CANT_FIND", note: "Looked on both shelves." });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ recorded: true });
    expect((await report(id, { kind: "LOCATION_WRONG" })).status).toBe(201);
    expect(stateOf(id)).toEqual(before);
    const { reports } = await detail(id);
    expect(reports).toHaveLength(2);
    expect(reports.find((entry) => entry.kind === "CANT_FIND")).toMatchObject({ source: "STAFF", note: "Looked on both shelves.", reportedBy: "Staff One", location: "Cabinet 1", resolvedAt: null });
    expect(reports.find((entry) => entry.kind === "LOCATION_WRONG")).toMatchObject({ source: "STAFF", note: null, location: "Cabinet 1", resolvedAt: null });
    expect(sqlite.prepare("SELECT action, actor_user_id, entity_type, entity_id FROM audit_log WHERE action = 'LOCATION_REPORTED' ORDER BY rowid").all()).toEqual([
      { action: "LOCATION_REPORTED", actor_user_id: "ACC-1", entity_type: "ITEM", entity_id: id }, { action: "LOCATION_REPORTED", actor_user_id: "ACC-1", entity_type: "ITEM", entity_id: id }]);
    const inventory = await (await staff("/api/staff/inventory")).json() as { items: Array<{ id: string; openReports: number }>; locations: Place[] };
    expect(inventory.items.find((entry) => entry.id === id)!.openReports).toBe(2);
    expect(inventory.locations.find((entry) => entry.id === cabinet)!.openReports).toBe(2);
  });

  it("is idempotent by request id and validates what it is given", async () => {
    const id = await addItem();
    const key = crypto.randomUUID();
    const send = () => staff(`/api/staff/items/${id}/location-report`, "POST", { id: key, kind: "CANT_FIND" });
    expect(await (await send()).json()).toMatchObject({ recorded: true });
    expect(await (await send()).json()).toMatchObject({ recorded: false });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM location_reports").get()).toEqual({ n: 1 });
    expect((await staff(`/api/staff/items/${id}/location-report`, "POST", { kind: "CANT_FIND" })).status).toBe(400);
    expect((await report(id, { kind: "STOLEN" })).status).toBe(400);
    expect((await report(id, { kind: "CANT_FIND", note: "x".repeat(301) })).status).toBe(400);
    expect((await report("ITM-9999", { kind: "CANT_FIND" })).status).toBe(404);
  });

  it("is resolved once, by a person, with a note, and the item is as it was", async () => {
    const id = await addItem();
    const { id: reportId } = await (await report(id, { kind: "LOCATION_WRONG" })).json() as { id: string };
    const before = stateOf(id);
    const bobCookie = await signIn("staff.two");
    const resolve = (who: string, note?: string) => call(`/api/staff/location-reports/${reportId}/resolve`, { method: "POST", headers: { origin, cookie: who, "content-type": "application/json" }, body: JSON.stringify({ note }) });
    expect((await resolve(bobCookie, "Moved to Shelf B.")).status).toBe(200);
    expect((await resolve(cookie)).status).toBe(409);
    expect(stateOf(id)).toEqual(before);
    expect((await detail(id)).reports).toMatchObject([{ resolvedBy: "Staff Two", resolutionNote: "Moved to Shelf B." }]);
    expect(sqlite.prepare("SELECT action, actor_user_id FROM audit_log WHERE action = 'LOCATION_REPORT_RESOLVED'").all()).toEqual([{ action: "LOCATION_REPORT_RESOLVED", actor_user_id: "ACC-2" }]);
    expect((await staff("/api/staff/location-reports/not-a-report/resolve", "POST", {})).status).toBe(404);
    expect((await staff(`/api/staff/location-reports/${crypto.randomUUID()}/resolve`, "POST", {})).status).toBe(404);
  });

  it("reaches the Activity feed as an item event without claiming any stock change", async () => {
    const id = await addItem({ name: "Tape" });
    await report(id, { kind: "CANT_FIND" });
    const feed = (await (await staff(`/api/staff/activity?item=${id}&type=LOCATION_REPORTED`)).json()) as { events: Array<{ summary: string; stockChanged: boolean; source: string }> };
    expect(feed.events).toMatchObject([{ source: "CATALOG", stockChanged: false, summary: "Staff One reported that Tape could not be found; stock and its place did not change." }]);
  });
});

describe("what Self-Service may show", () => {
  type Catalog = { items: Array<{ id: string; name: string; location: string | null; locationId: string | null }>; places: Array<{ id: string; name: string; parentId: string | null; directions: string | null; photo: unknown }> };
  const catalog = async () => (await (await anyone("/api/self-service/catalog")).json()) as Catalog;

  it("shows directions only for places that are shared, active and under shared places, and sends only the ones items use", async () => {
    const office = await addPlace({ name: "Office", directions: "Second floor.", visibility: "SELF_SERVICE" });
    const cabinet = await addPlace({ name: "Cabinet 1", parentId: office, directions: "Left of the door.", visibility: "SELF_SERVICE" });
    const staffRoom = await addPlace({ name: "Staff room", directions: "Door code is secret.", visibility: "STAFF_ONLY" });
    const hidden = await addPlace({ name: "Locker", parentId: staffRoom, directions: "Bottom row.", visibility: "SELF_SERVICE" });
    await addPlace({ name: "Unused", visibility: "SELF_SERVICE", directions: "Nobody keeps anything here." });
    const water = await addItem({ name: "Water", locationId: cabinet });
    const tape = await addItem({ name: "Tape", locationId: hidden });
    const glue = await addItem({ name: "Glue" });
    const body = await catalog();
    expect(body.items.find((entry) => entry.id === water)).toMatchObject({ location: "Office › Cabinet 1", locationId: cabinet });
    expect(body.items.find((entry) => entry.id === tape)).toMatchObject({ location: null, locationId: null });
    expect(body.items.find((entry) => entry.id === glue)).toMatchObject({ location: null, locationId: null });
    expect(body.places.map((entry) => entry.name).sort()).toEqual(["Cabinet 1", "Office"]);
    expect(JSON.stringify(body)).not.toMatch(/Door code|Bottom row|Staff room|Locker|Nobody keeps/);
    // Withdrawing sharing or deactivating a place takes it back out at once.
    await edit(office, { visibility: "STAFF_ONLY" });
    expect((await catalog()).places).toEqual([]);
  });

  it("serves a shared place's picture only while it is shared and Self-Service is open", async () => {
    const id = await addPlace({ name: "Cabinet 1", visibility: "SELF_SERVICE" });
    const form = new FormData();
    form.set("display", new File([jpeg({ width: 40, height: 30 }) as BlobPart], "display.jpg", { type: "image/jpeg" }));
    form.set("thumb", new File([jpeg({ width: 16, height: 12 }) as BlobPart], "thumb.jpg", { type: "image/jpeg" }));
    form.set("expected", "");
    const { photo } = await (await call(`/api/staff/locations/${id}/photo`, { method: "PUT", headers: { origin, cookie }, body: form })).json() as { photo: { id: string } };
    const fetchPicture = (variant = "display") => anyone(`/api/public/location-media/${photo.id}/${variant}`);
    const shown = await fetchPicture();
    expect(shown.status).toBe(200);
    expect(shown.headers.get("cache-control")).toBe("public, max-age=3600");
    expect((await anyone(`/api/public/location-media/${photo.id}/display`, "GET", undefined, { "if-none-match": shown.headers.get("etag")! })).status).toBe(304);
    expect((await fetchPicture("original")).status).toBe(404);
    expect((await anyone(`/api/public/location-media/${crypto.randomUUID()}/display`)).status).toBe(404);
    expect((await anyone(`/api/public/location-media/${photo.id}/display`, "POST")).status).toBe(405);
    sqlite.prepare("UPDATE system_settings SET value = 'paused' WHERE key = 'self_service'").run();
    expect((await fetchPicture()).status).toBe(404);
    sqlite.prepare("UPDATE system_settings SET value = 'open' WHERE key = 'self_service'").run();
    await edit(id, { visibility: "STAFF_ONLY" });
    expect((await fetchPicture()).status).toBe(404);
    await edit(id, { visibility: "SELF_SERVICE" });
    expect((await fetchPicture()).status).toBe(200);
    await edit(id, { active: false });
    expect((await fetchPicture()).status).toBe(404);
  });

  describe("reports from a phone", () => {
    const phoneReport = (itemId: string, kind = "CANT_FIND", headers: Record<string, string> = { "content-length": "100", "cf-connecting-ip": "203.0.113.7" }, name: string | null = "Maya Cruz") =>
      call("/api/self-service/location-report", { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify({ id: crypto.randomUUID(), itemId, kind, ...name === null ? {} : { name } }) });

    it("records one signal for an item the phone is offered, naming who sent it, with no note and no change to stock or place", async () => {
      const cabinet = await addPlace({ name: "Cabinet 1" });
      const water = await addItem({ name: "Water", locationId: cabinet });
      const before = stateOf(water);
      const response = await phoneReport(water);
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ recorded: true });
      // The same network repeating the same report adds nothing for staff to read.
      expect(await (await phoneReport(water)).json()).toMatchObject({ recorded: false });
      expect((await phoneReport(water, "LOCATION_WRONG")).status).toBe(201);
      expect(stateOf(water)).toEqual(before);
      const rows = sqlite.prepare("SELECT source, reported_by, reporter_name, note, kind, location_id FROM location_reports ORDER BY rowid").all();
      expect(rows).toEqual([{ source: "SELF_SERVICE", reported_by: null, reporter_name: "Maya Cruz", note: null, kind: "CANT_FIND", location_id: cabinet }, { source: "SELF_SERVICE", reported_by: null, reporter_name: "Maya Cruz", note: null, kind: "LOCATION_WRONG", location_id: cabinet }]);
      expect(sqlite.prepare("SELECT actor_user_id FROM audit_log WHERE action = 'LOCATION_REPORTED'").all()).toEqual([{ actor_user_id: "SELF_SERVICE" }, { actor_user_id: "SELF_SERVICE" }]);
      expect((await detail(water)).reports[0]).toMatchObject({ source: "SELF_SERVICE", reportedBy: "Maya Cruz", note: null });
      expect(JSON.parse((sqlite.prepare("SELECT details_json AS details FROM audit_log WHERE action = 'LOCATION_REPORTED' ORDER BY rowid").get() as { details: string }).details)).toMatchObject({ source: "SELF_SERVICE", reporter: "Maya Cruz" });
      function stateOf(id: string) { return { quantity: onHand(id), place: locationOf(id), updatedAt: (sqlite.prepare("SELECT updated_at FROM items WHERE id = ?").get(id) as { updated_at: string | null }).updated_at }; }
    });

    it("asks the phone for a name, and shows its open reports on the Self-Service review page, in the badge count and until staff resolve them", async () => {
      const water = await addItem({ name: "Water" });
      expect((await phoneReport(water, "CANT_FIND", undefined, null)).status).toBe(400);
      expect((await phoneReport(water, "CANT_FIND", undefined, "   ")).status).toBe(400);
      expect((await phoneReport(water, "CANT_FIND", undefined, "x".repeat(121))).status).toBe(400);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM location_reports").get()).toEqual({ n: 0 });
      expect((await phoneReport(water, "CANT_FIND", undefined, "  Maya Cruz  ")).status).toBe(201);
      // A report made before names were asked for stays readable: "no name given".
      sqlite.prepare("INSERT INTO location_reports(id, item_id, kind, source, created_at) VALUES(?, ?, 'LOCATION_WRONG', 'SELF_SERVICE', '2026-10-03T07:00:00.000Z')").run("d".repeat(36), water);
      const review = await (await staff("/api/staff/self-service")).json() as { locationReports: Array<{ itemId: string; itemName: string; kind: string; reporterName: string | null }> };
      expect(review.locationReports).toMatchObject([{ itemId: water, itemName: "Water", kind: "CANT_FIND", reporterName: "Maya Cruz" }, { itemId: water, itemName: "Water", kind: "LOCATION_WRONG", reporterName: null }]);
      const session = await (await staff("/api/staff/session")).json() as { selfServiceReviews: number };
      expect(session.selfServiceReviews).toBe(2);
      // A staff member's own report is not a phone report; resolving removes a report from both.
      expect((await staff(`/api/staff/items/${water}/location-report`, "POST", { id: crypto.randomUUID(), kind: "CANT_FIND" })).status).toBe(201);
      const first = (await (await staff("/api/staff/self-service")).json() as { locationReports: Array<{ id: string }> }).locationReports;
      expect(first).toHaveLength(2);
      expect((await staff(`/api/staff/location-reports/${first[0]!.id}/resolve`, "POST", { note: "Found it" })).status).toBe(200);
      expect((await (await staff("/api/staff/self-service")).json() as { locationReports: unknown[] }).locationReports).toHaveLength(1);
      expect(((await (await staff("/api/staff/session")).json()) as { selfServiceReviews: number }).selfServiceReviews).toBe(1);
    });

    it("refuses an item Self-Service does not offer, a closed Self-Service, a foreign origin, a big or unmeasured body, and floods", async () => {
      const hidden = await addItem({ name: "Unreviewed", needsReview: true });
      const water = await addItem({ name: "Water" });
      expect((await phoneReport(hidden)).status).toBe(404);
      expect((await phoneReport("ITM-9999")).status).toBe(404);
      expect((await phoneReport("not an item")).status).toBe(400);
      expect((await phoneReport(water, "STOLEN")).status).toBe(400);
      expect((await call("/api/self-service/location-report", { method: "POST", headers: { origin: "https://evil.example", "content-length": "10" }, body: "{}" })).status).toBe(403);
      expect((await call("/api/self-service/location-report", { method: "GET" })).status).toBe(405);
      expect((await phoneReport(water, "CANT_FIND", { "content-length": "5000" })).status).toBe(413);
      sqlite.prepare("UPDATE system_settings SET value = 'paused' WHERE key = 'self_service'").run();
      expect((await phoneReport(water)).status).toBe(503);
      sqlite.prepare("UPDATE system_settings SET value = 'open' WHERE key = 'self_service'").run();
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM location_reports").get()).toEqual({ n: 0 });
      let last = 201;
      for (let attempt = 0; attempt < 12; attempt += 1) last = (await phoneReport(water, attempt % 2 ? "CANT_FIND" : "LOCATION_WRONG", { "content-length": "100", "cf-connecting-ip": "198.51.100.9" })).status;
      expect(last).toBe(429);
    });

    it("records nothing from the Administration test panel", async () => {
      const water = await addItem({ name: "Water" });
      const response = await phoneReport(water, "CANT_FIND", { "content-length": "100", "x-self-service-test": "1" });
      expect(await response.json()).toMatchObject({ recorded: false, test: true });
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM location_reports").get()).toEqual({ n: 0 });
    });
  });
});

describe("who may use places", () => {
  it("is for signed-in Logistics staff only", async () => {
    const id = await addPlace({ name: "Cabinet 1" });
    for (const [method, path] of [["GET", "/api/staff/locations"], ["POST", "/api/staff/locations"], ["PATCH", `/api/staff/locations/${id}`], ["PUT", `/api/staff/locations/${id}/photo`], ["DELETE", `/api/staff/locations/${id}/photo`],
      ["POST", `/api/staff/locations/${id}/move-items`], ["GET", `/api/staff/location-media/${crypto.randomUUID()}/display`], ["POST", "/api/staff/items/ITM-0001/location-report"], ["POST", `/api/staff/location-reports/${crypto.randomUUID()}/resolve`]] as const) {
      expect((await anyone(path, method, {})).status, `${method} ${path}`).toBe(401);
    }
    // Staff of another department sign in to their own account only.
    sqlite.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES('account_access:ACC-2', 'DEM', '2026-10-03T00:00:00.000Z')").run();
    const dem = await signIn("staff.two");
    expect((await call("/api/staff/locations", { headers: { cookie: dem } })).status).toBe(403);
    expect((await call("/api/staff/locations", { method: "POST", headers: { origin, cookie: dem, "content-type": "application/json" }, body: JSON.stringify({ name: "Sneaky" }) })).status).toBe(403);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM locations WHERE name = 'Sneaky'").get()).toEqual({ n: 0 });
    // A write also needs the site's own origin.
    expect((await call("/api/staff/locations", { method: "POST", headers: { origin: "https://evil.example", cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Cross site" }) })).status).toBe(403);
  });

  it("answers 304 for the place list until a place or report changes", async () => {
    await addPlace({ name: "Cabinet 1" });
    const first = await staff("/api/staff/locations");
    const etag = first.headers.get("etag")!;
    expect((await call("/api/staff/locations", { headers: { cookie, "if-none-match": etag } })).status).toBe(304);
    await addPlace({ name: "Cabinet 2" });
    expect((await call("/api/staff/locations", { headers: { cookie, "if-none-match": etag } })).status).toBe(200);
  });

  it("caps the number of places so loading all of them stays a small read", async () => {
    const values = Array.from({ length: 500 }, (_, index) => `('LOC-${String(index + 1).padStart(4, "0")}', 'Place ${index}', '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z')`).join(",");
    sqlite.exec(`INSERT INTO locations(id, name, created_at, updated_at) VALUES ${values}`);
    const response = await staff("/api/staff/locations", "POST", { name: "One too many" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/already 500 places/);
  });
});

describe("V1.4 release manifest (Cloud Operations lane)", () => {
  const manifest = JSON.parse(fs.readFileSync("ops/releases/v1.4.json", "utf8"));
  const through0021 = (db: DatabaseSync) => { for (const file of fs.readdirSync("migrations").filter((name) => name <= "0021_staff_directory.sql").sort()) db.exec(fs.readFileSync(`migrations/${file}`, "utf8")); };
  const keys = (db: DatabaseSync) => new Map((db.prepare("SELECT type, name, sql FROM sqlite_master").all() as Array<{ type: string; name: string; sql: string | null }>).map((row) => [`${row.type}:${row.name}`, row.sql]));
  const typed = (db: DatabaseSync) => {
    const set = db.prepare("UPDATE items SET storage_location = ? WHERE id = ?");
    for (const [id, value] of [["ITM-0001", "Office cabinet 2"], ["ITM-0002", "Office cabinet 2"], ["ITM-0003", "office cabinet 2"], ["ITM-0004", "  Shelf A "], ["ITM-0005", "   "]]) set.run(value, id);
  };

  it("pins 0022, 0023 and 0024 by hash, in order, and names exactly the buckets wrangler.jsonc binds (none to create)", () => {
    expect(manifest.migrations.pending.map((entry: { name: string }) => entry.name)).toEqual(["0022_audit_log_append_only.sql", "0023_last_active_owner.sql", "0024_locations.sql"]);
    for (const { name, sha256 } of manifest.migrations.pending) expect(createHash("sha256").update(fs.readFileSync(`migrations/${name}`)).digest("hex"), name).toBe(sha256);
    const bound = [...fs.readFileSync("wrangler.jsonc", "utf8").matchAll(/"binding": "([A-Z_]+)", "bucket_name": "([a-z0-9-]+)"/g)].map((match) => ({ binding: match[1], name: match[2] }));
    expect(manifest.target.r2.existing).toEqual(bound);
    expect(manifest.target.r2.create).toEqual([]);
  });

  it("passes the lane's own release-tree check", () => {
    expect(ops.loadManifest("ops/releases/v1.4.json", "v1.4").release).toBe("v1.4");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-v14-"));
    try {
      fs.copyFileSync("wrangler.jsonc", path.join(dir, "wrangler.jsonc"));
      fs.cpSync("migrations", path.join(dir, "migrations"), { recursive: true, filter: (source) => !source.endsWith(".sql") || path.basename(source) <= "0024_locations.sql" });
      const sha = "a".repeat(40);
      const git = (args: string[]) => args[0] === "rev-parse" ? sha : args[0] === "status" ? "" : "ok";
      expect(ops.verifyReleaseTree({ manifest, releaseDir: dir, expectedSha: sha, git }).branch).toBe("road-to-v2/v1.4-smart-locations");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("adds exactly the schema it declares to a database in production's state, changes only items, and moves no figure", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    through0021(db);
    typed(db);
    const before = keys(db);
    const counts = db.prepare("SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM inventory_movements) AS movements, (SELECT COALESCE(SUM(on_hand), 0) FROM inventory_balances) AS onHand, (SELECT COUNT(*) FROM loans) AS loans, (SELECT COUNT(*) FROM self_service_events) AS phoneEvents").get();
    const found = Object.fromEntries(manifest.expect.derived.map((entry: { label: string; before: string }) => [entry.label, (db.prepare(ops.QUERIES.derived[entry.before]).get() as { n: number }).n]));
    for (const { name } of manifest.migrations.pending) db.exec(fs.readFileSync(`migrations/${name}`, "utf8"));
    const after = keys(db);
    expect([...after.keys()].filter((key) => !before.has(key)).sort()).toEqual([...manifest.expect.schemaAdded].sort());
    expect([...before.keys()].filter((key) => before.get(key) !== after.get(key)).sort()).toEqual(manifest.expect.schemaChanged);
    expect(db.prepare("SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM inventory_movements) AS movements, (SELECT COALESCE(SUM(on_hand), 0) FROM inventory_balances) AS onHand, (SELECT COUNT(*) FROM loans) AS loans, (SELECT COUNT(*) FROM self_service_events) AS phoneEvents").get()).toEqual(counts);
    expect(db.prepare(ops.QUERIES.rows("location_reports")).get()).toEqual({ n: manifest.expect.tableRowsAfter.location_reports });
    // The figures the lane compares: three distinct typed values, four items typed (the blank one has none).
    expect(found).toEqual({ "places made from the distinct typed locations": 3, "items linked to a place (every item with a typed location)": 4 });
    for (const entry of manifest.expect.derived) expect((db.prepare(ops.QUERIES.derived[entry.after]).get() as { n: number }).n, entry.label).toBe(found[entry.label]);
  });

  it("lets the lane run only its fixed read-only queries, and refuses anything else", () => {
    const run = (sql: string) => ops.allowed(["d1", "execute", "DB", "--remote", "--json", "--command", sql], manifest, false);
    for (const query of Object.values(ops.QUERIES.derived)) expect(run(query as string)).toBe(true);
    expect(run("SELECT storage_location FROM items")).toBe(false);
    expect(run("DELETE FROM locations")).toBe(false);
    expect(() => ops.loadManifest("ops/releases/v1.4.json", "v1.3")).toThrow();
  });

  describe("a prepared run against a fake Cloudflare with real SQLite", () => {
    const KEYS = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const BOOKMARK = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";
    const ACCOUNT = "0123456789abcdef0123456789abcdef";

    async function run(options: { afterApply?: (db: DatabaseSync) => void; mode?: "preflight" | "prepare" } = {}) {
      const db = new DatabaseSync(":memory:");
      db.exec("PRAGMA foreign_keys = ON");
      through0021(db);
      typed(db);
      db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE)");
      for (const name of fs.readdirSync("migrations").filter((file) => file <= "0021_staff_directory.sql").sort()) db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name);
      const log: string[] = [];
      const exec = (args: string[]) => {
        const [a, b] = args;
        if (a === "d1" && b === "execute") return { status: 0, stdout: JSON.stringify([{ results: db.prepare(args[6]!).all(), success: true }]), stderr: "" };
        if (a === "d1" && b === "export") { log.push("export"); fs.writeFileSync(args[5]!, `${(db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").all() as Array<{ sql: string }>).map((row) => `${row.sql};`).join("\n")}\n-- d1_migrations\n`); return { status: 0, stdout: "", stderr: "" }; }
        if (a === "d1" && b === "time-travel") { log.push("bookmark"); return { status: 0, stdout: JSON.stringify({ bookmark: BOOKMARK }), stderr: "" }; }
        if (a === "d1" && b === "migrations") {
          log.push("apply");
          for (const { name } of manifest.migrations.pending) { db.exec(fs.readFileSync(`migrations/${name}`, "utf8")); db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name); }
          options.afterApply?.(db);
          return { status: 0, stdout: "", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unexpected command" };
      };
      const buckets = manifest.target.r2.existing.map((bucket: { name: string }) => ({ name: bucket.name, creation_date: "2026-09-29T15:17:28.423Z" }));
      const rest = async (requestPath: string) => requestPath.includes("per_page") ? { status: 200, body: { success: true, result: { buckets } } }
        : requestPath.endsWith("/managed") ? { status: 200, body: { success: true, result: { enabled: false } } } : { status: 200, body: { success: true, result: { domains: [] } } };
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-v14run-"));
      try {
        fs.copyFileSync("wrangler.jsonc", path.join(dir, "wrangler.jsonc"));
        fs.cpSync("migrations", path.join(dir, "migrations"), { recursive: true, filter: (source) => !source.endsWith(".sql") || path.basename(source) <= "0024_locations.sql" });
        const sha = "b".repeat(40);
        const git = (args: string[]) => args[0] === "rev-parse" ? sha : args[0] === "status" ? "" : "ok";
        const mode = options.mode ?? "prepare";
        const cloud = ops.createCloud({ exec, rest, manifest, accountId: ACCOUNT, mayChange: mode === "prepare" });
        const backupDir = path.join(dir, "backup");
        const report = await ops.runRelease({ manifest, releaseDir: dir, expectedSha: sha, mode, confirm: mode === "prepare" ? `PREPARE v1.4 ${sha}` : undefined, cloud, git, backupDir, backupKey: KEYS.publicKey });
        return { report, log, db };
      } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    }

    it("backs up, applies exactly 0022-0024, and reconciles the places against what it found", async () => {
      const { report, log, db } = await run();
      expect(report.result).toBe("READY_TO_MERGE");
      expect(log).toEqual(["export", "bookmark", "apply"]);
      expect(report.baseline.derived).toEqual({ "places made from the distinct typed locations": 3, "items linked to a place (every item with a typed location)": 4 });
      expect(report.after.derived).toEqual(report.baseline.derived);
      expect(report.after.migrations).toBe(report.before.migrations + 3);
      expect(db.prepare("SELECT COUNT(*) AS n FROM locations").get()).toEqual({ n: 3 });
    });

    it("says in the preflight, before anything is changed, how many places it will find", async () => {
      const { report, log } = await run({ mode: "preflight" });
      expect(report.result).toBe("PREFLIGHT_OK");
      expect(log).toEqual([]);
      expect(report.before.derived).toEqual({ "places made from the distinct typed locations": 3, "items linked to a place (every item with a typed location)": 4 });
    });

    it("stops with RECONCILE_MISMATCH when the migration did not link every typed item", async () => {
      const { report } = await run({ afterApply: (db) => { db.exec("UPDATE items SET location_id = NULL WHERE id = 'ITM-0001'"); } });
      expect(report.result).toBe("STOPPED");
      expect(report.stopped.code).toBe("RECONCILE_MISMATCH");
      expect(report.stopped.message).toContain("items linked to a place");
    });
  });
});
