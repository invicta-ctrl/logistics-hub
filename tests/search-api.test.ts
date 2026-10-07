import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { MAX_LINKS } from "../src/relation-policy";
import { MAX_PEOPLE } from "../src/search";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/*
 * V1.11 global search, server side: who may read the search index and the Staff Directory's people, what those answers carry and
 * never carry, and the explicit item links (migration 0030). Every privacy check reads the response itself, not the UI.
 */

const origin = "https://hub.example.test";
const PASSWORD = "correct horse battery";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
const cookies: Record<string, string> = {};

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (who: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method, headers: { origin, cookie: who, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, any>>(response: Response | Promise<Response>) => (await (await response).json()) as T;

async function seed(id: string, username: string, role: string) {
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(?, ?, ?, ?, ?)").run(id, username, username, await hashPassword(PASSWORD), role);
}
async function signIn(username: string): Promise<string> {
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${username}` }, body: JSON.stringify({ username, password: PASSWORD }) });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

/** A directory person whose private fields must never reach search: a student ID, a linked sign-in, an ID card. */
function person(id: string, name: string, department: string, position: string | null, active = 1, studentId: string | null = null) {
  sqlite.prepare(`INSERT INTO staff_directory(id, full_name, department, position, officer, student_id, active, account_id, created_at, updated_at)
    VALUES(?, ?, ?, ?, 0, ?, ?, NULL, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run(id, name, department, position, studentId, active);
}
const PER = (n: number) => `PER-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  await seed("ACC-owner", "owner", "OWNER");
  await seed("ACC-admin", "admin", "ADMIN");
  await seed("ACC-staff", "staff", "STAFF");
  await seed("ACC-dem", "dem", "STAFF");
  // Another department's member: signs in to their own account only (Earl, 2026-10-03).
  sqlite.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES('account_access:ACC-dem', 'DEM', '2026-10-03T00:00:00.000Z')").run();
  for (const name of ["owner", "admin", "staff", "dem"]) cookies[name] = await signIn(name);
  person(PER(1), "Maria Clara Santos", "DoL", "Logistics Head", 1, "2023-00123");
  person(PER(2), "Jose Rizal Cruz", "DEM", "Events Officer", 1, "2022-00456");
  person(PER(3), "Andres Bonifacio", "DoF", null, 0, "2021-00789");
});

describe("who may read global search", () => {
  it("refuses everything to anyone not signed in", async () => {
    for (const [path, method] of [["/api/staff/search", "GET"], ["/api/staff/admin/directory/search?q=maria", "GET"], ["/api/staff/items/ITM-0001/links", "POST"], ["/api/staff/items/ITM-0001/links/ITM-0002", "DELETE"]] as const) {
      const response = await as("", path, method, method === "GET" ? undefined : { itemId: "ITM-0002", kind: "USED_WITH" });
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(await response.text()).not.toMatch(/Maria|Glue|ITM-0002"/);
    }
  });

  it("refuses another department's member before reading anything", async () => {
    for (const path of ["/api/staff/search", "/api/staff/admin/directory/search?q=maria"]) {
      const response = await as(cookies.dem!, path);
      expect(response.status, path).toBe(403);
      const body = await response.text();
      expect(body).toContain("NO_HUB_ACCESS");
      expect(body).not.toMatch(/Maria|Santos|items|people/);
    }
    expect((await as(cookies.dem!, "/api/staff/items/ITM-0001/links", "POST", { itemId: "ITM-0002", kind: "USED_WITH" })).status).toBe(403);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM item_relationships").get()).toEqual({ n: 0 });
  });

  it("gives Logistics staff the catalog index but never the Staff Directory's people", async () => {
    expect((await as(cookies.staff!, "/api/staff/search")).status).toBe(200);
    const people = await as(cookies.staff!, "/api/staff/admin/directory/search?q=maria");
    expect(people.status).toBe(403);
    const body = await people.text();
    expect(body).not.toMatch(/Maria|Santos|PER-|2023-00123|Logistics Head/);
  });

  it("gives administrators and the owner the directory's people, ranked in the Worker", async () => {
    for (const who of ["admin", "owner"]) {
      const response = await as(cookies[who]!, "/api/staff/admin/directory/search?q=maria");
      expect(response.status, who).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect((await json(response)).people.map((each: { name: string }) => each.name)).toEqual(["Maria Clara Santos"]);
    }
  });

  it("is never reachable on an offline cataloguing lease, which is for cataloguing only", async () => {
    const response = await as(cookies.staff!, "/api/staff/catalogue/offline", "POST");
    expect(response.status).toBe(200);
    const lease = response.headers.get("set-cookie")!.split(";")[0]!;
    expect((await as(lease, "/api/staff/search")).status).toBe(401);
    expect((await as(lease, "/api/staff/admin/directory/search?q=maria")).status).toBe(401);
  });

  it("adds nothing to the public catalog or Self-Service", async () => {
    await as(cookies.staff!, "/api/staff/items/ITM-0001/links", "POST", { itemId: "ITM-0002", kind: "USED_WITH" });
    for (const path of ["/api/public/catalog", "/api/self-service/catalog"]) {
      const response = await call(path);
      const body = await response.text();
      expect(body, path).not.toMatch(/Maria|Santos|2023-00123|USED_WITH|"links"/);
    }
    expect((await call("/api/staff/search")).status).toBe(401);
  });
});

describe("the search index", () => {
  it("carries the catalog's searchable fields and nothing else", async () => {
    const response = await as(cookies.staff!, "/api/staff/search");
    const index = await json(response);
    expect(Object.keys(index).sort()).toEqual(["items", "kits", "links", "places", "revision"]);
    expect(index.items.length).toBe(397);
    // An allowlist, not a blocklist: any new column must be added here on purpose.
    for (const item of index.items) expect(Object.keys(item).sort()).toEqual(["aliases", "category", "iconKey", "id", "itemType", "name", "photoId", "placeId", "status", "visualType"]);
    const body = JSON.stringify(index);
    for (const secret of ["Maria", "Santos", "2023-00123", "PER-", "notes", "onHand", "borrower", "studentId", "password", "evidence"]) expect(body, secret).not.toContain(secret);
  });

  it("is sent once per catalog revision and refreshed when a link changes it", async () => {
    const first = await as(cookies.staff!, "/api/staff/search");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"r\d+"$/);
    expect((await as(cookies.staff!, "/api/staff/search", "GET", undefined, { "if-none-match": etag })).status).toBe(304);
    expect((await as(cookies.staff!, "/api/staff/items/ITM-0001/links", "POST", { itemId: "ITM-0002", kind: "USED_WITH" })).status).toBe(201);
    const after = await as(cookies.staff!, "/api/staff/search", "GET", undefined, { "if-none-match": etag });
    expect(after.status).toBe(200);
    expect((await json(after)).links).toEqual([{ from: "ITM-0001", to: "ITM-0002", kind: "USED_WITH" }]);
  });

  it("lists each kit's items and every place, inactive ones included and marked", async () => {
    const place = await json(as(cookies.staff!, "/api/staff/locations", "POST", { name: "Cabinet 7", parentId: null }));
    const kit = await as(cookies.staff!, "/api/staff/kits", "POST", { name: "Sewing Kit", description: null, locationId: place.id, components: [{ itemId: "ITM-0001", required: 1 }, { itemId: "ITM-0002", required: 2 }] });
    expect(kit.status).toBe(201);
    const index = await json(as(cookies.staff!, "/api/staff/search"));
    expect(index.kits).toEqual([{ id: (await json(kit)).id, name: "Sewing Kit", placeId: place.id, active: true, items: ["ITM-0001", "ITM-0002"] }]);
    expect(index.places).toContainEqual({ id: place.id, name: "Cabinet 7", parentId: null, active: true });
  });
});

describe("people search", () => {
  it("answers only what recognises a person: never a student ID, sign-in or ID card", async () => {
    sqlite.prepare("INSERT INTO staff_id_cards(person_id, media_id, front_width, front_height, back_width, back_height, created_at, created_by) VALUES(?, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 10, 10, 10, 10, '2026-10-01T00:00:00Z', 'ACC-owner')").run(PER(1));
    sqlite.prepare("UPDATE staff_directory SET account_id = 'ACC-staff' WHERE id = ?").run(PER(1));
    const response = await as(cookies.owner!, "/api/staff/admin/directory/search?q=santos");
    const { people } = await json(response);
    expect(people).toHaveLength(1);
    expect(Object.keys(people[0]).sort()).toEqual(["active", "department", "id", "name", "officer", "position", "score", "why"]);
    const body = JSON.stringify(people);
    for (const secret of ["2023-00123", "ACC-staff", "staff", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "studentId", "account", "hasId"]) expect(body, secret).not.toContain(secret);
  });

  it("finds by name, position or department, says why, and keeps former members last", async () => {
    const find = async (q: string) => (await json(as(cookies.admin!, `/api/staff/admin/directory/search?q=${encodeURIComponent(q)}`))).people as Array<{ name: string; why: { by: string; text: string } | null; active: boolean }>;
    expect((await find("jose")).map((each) => each.name)).toEqual(["Jose Rizal Cruz"]);
    expect(await find("events officer")).toMatchObject([{ name: "Jose Rizal Cruz", why: { by: "position", text: "Events Officer" } }]);
    expect(await find("finance")).toMatchObject([{ name: "Andres Bonifacio", why: { by: "department", text: "Department of Finance" }, active: false }]);
    expect(await find("dol")).toMatchObject([{ name: "Maria Clara Santos", why: { by: "department" } }]);
    expect(await find("m")).toEqual([]);
    expect(await find("nobody here")).toEqual([]);
  });

  it("returns a handful, never the directory", async () => {
    for (let n = 10; n < 40; n += 1) person(PER(n), `Juan Dela Cruz ${n}`, "DoL", null);
    const { people } = await json(as(cookies.admin!, "/api/staff/admin/directory/search?q=juan"));
    expect(people).toHaveLength(MAX_PEOPLE);
  });
});

describe("item links", () => {
  const link = (from: string, body: Record<string, unknown>, who = cookies.staff!) => as(who, `/api/staff/items/${from}/links`, "POST", body);
  const detail = (id: string) => json(as(cookies.staff!, `/api/staff/items/${id}`));

  it("reads from each end of the link, on both items' records", async () => {
    expect((await link("ITM-0001", { itemId: "ITM-0002", kind: "REPLACEMENT" })).status).toBe(201);
    expect((await link("ITM-0003", { itemId: "ITM-0004", kind: "CONTENTS", side: "to" })).status).toBe(201);
    const names = Object.fromEntries((sqlite.prepare("SELECT id, name FROM items WHERE id IN ('ITM-0001','ITM-0002','ITM-0003','ITM-0004')").all() as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
    expect((await detail("ITM-0001")).links).toMatchObject([{ id: "ITM-0002", name: names["ITM-0002"], kind: "REPLACEMENT", side: "from", words: "Replaced by", createdBy: "staff" }]);
    expect((await detail("ITM-0002")).links).toMatchObject([{ id: "ITM-0001", kind: "REPLACEMENT", side: "to", words: "Replaces" }]);
    // "ITM-0003 goes in ITM-0004": ITM-0004 is the container.
    expect(sqlite.prepare("SELECT item_id, related_id FROM item_relationships WHERE kind = 'CONTENTS'").get()).toEqual({ item_id: "ITM-0004", related_id: "ITM-0003" });
    expect((await detail("ITM-0003")).links).toMatchObject([{ id: "ITM-0004", words: "Goes in" }]);
    expect((await detail("ITM-0004")).links).toMatchObject([{ id: "ITM-0003", words: "Holds" }]);
  });

  it("links a pair once, whichever end, and refuses a link to itself or to nothing", async () => {
    expect((await link("ITM-0001", { itemId: "ITM-0002", kind: "USED_WITH" })).status).toBe(201);
    for (const [from, body] of [["ITM-0001", { itemId: "ITM-0002", kind: "ALTERNATIVE" }], ["ITM-0002", { itemId: "ITM-0001", kind: "USED_WITH" }]] as const) {
      const response = await link(from, body);
      expect(response.status).toBe(409);
      expect((await json(response)).error).toMatch(/already linked/);
    }
    expect((await link("ITM-0001", { itemId: "ITM-0001", kind: "USED_WITH" })).status).toBe(400);
    expect((await link("ITM-0001", { itemId: "ITM-9999", kind: "USED_WITH" })).status).toBe(404);
    expect((await link("ITM-9999", { itemId: "ITM-0001", kind: "USED_WITH" })).status).toBe(404);
    expect((await link("ITM-0001", { itemId: "ITM-0003", kind: "SIMILAR" })).status).toBe(400);
    expect((await link("ITM-0001", { itemId: "ITM-0003", kind: "USED_WITH", side: "sideways" })).status).toBe(400);
    expect((await link("ITM-0001", { itemId: "not an id", kind: "USED_WITH" })).status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM item_relationships").get()).toEqual({ n: 1 });
    expect(() => sqlite.prepare("INSERT INTO item_relationships VALUES('ITM-0002','ITM-0001','ALTERNATIVE','x',NULL)").run()).toThrow(/UNIQUE/);
    expect(() => sqlite.prepare("INSERT INTO item_relationships VALUES('ITM-0005','ITM-0005','ALTERNATIVE','x',NULL)").run()).toThrow(/CHECK/);
  });

  it(`stops at ${MAX_LINKS} links an item, from either end`, async () => {
    for (let n = 2; n < 2 + MAX_LINKS; n += 1) expect((await link("ITM-0001", { itemId: `ITM-${String(n).padStart(4, "0")}`, kind: "USED_WITH" })).status).toBe(201);
    const over = await link("ITM-0100", { itemId: "ITM-0001", kind: "ALTERNATIVE" });
    expect(over.status).toBe(409);
    expect((await json(over)).error).toMatch(`up to ${MAX_LINKS} links`);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM item_relationships").get()).toEqual({ n: MAX_LINKS });
  });

  it("removes a link from either end, audited on the item it was changed from", async () => {
    await link("ITM-0001", { itemId: "ITM-0002", kind: "USED_WITH" });
    expect((await as(cookies.staff!, "/api/staff/items/ITM-0003/links/ITM-0001", "DELETE")).status).toBe(404);
    const removed = await as(cookies.admin!, "/api/staff/items/ITM-0002/links/ITM-0001", "DELETE");
    expect(removed.status).toBe(200);
    expect((await json(removed)).links).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM item_relationships").get()).toEqual({ n: 0 });
    const audits = sqlite.prepare("SELECT action, entity_id AS entityId, actor_user_id AS actor, details_json AS details FROM audit_log WHERE action LIKE 'ITEM_%LINKED' ORDER BY rowid").all() as Array<{ action: string; entityId: string; actor: string; details: string }>;
    expect(audits.map(({ action, entityId, actor }) => ({ action, entityId, actor }))).toEqual([
      { action: "ITEM_LINKED", entityId: "ITM-0001", actor: "ACC-staff" },
      { action: "ITEM_UNLINKED", entityId: "ITM-0002", actor: "ACC-admin" }
    ]);
    expect(JSON.parse(audits[1]!.details)).toMatchObject({ otherId: "ITM-0001", kind: "USED_WITH", side: "to", words: "Used with" });
    const { events } = await json(as(cookies.admin!, "/api/staff/activity?source=CATALOG"));
    const sentences = events.map((event: { summary: string }) => event.summary).filter((summary: string) => /link/.test(summary));
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toMatch(/^admin removed the link .+: Used with .+\.$/);
    expect(sentences[1]).toMatch(/^staff linked .+: Used with .+\.$/);
  });

  it("changes nothing about either item: no stock, place or record edit", async () => {
    const before = sqlite.prepare("SELECT i.*, b.on_hand FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.id IN ('ITM-0001', 'ITM-0002') ORDER BY i.id").all();
    const movements = sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements").get();
    await link("ITM-0001", { itemId: "ITM-0002", kind: "CONTENTS" });
    await as(cookies.staff!, "/api/staff/items/ITM-0001/links/ITM-0002", "DELETE");
    expect(sqlite.prepare("SELECT i.*, b.on_hand FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.id IN ('ITM-0001', 'ITM-0002') ORDER BY i.id").all()).toEqual(before);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements").get()).toEqual(movements);
  });

  it("answers unknown methods and paths the Worker's usual way", async () => {
    expect((await as(cookies.staff!, "/api/staff/items/ITM-0001/links", "GET")).status).toBe(405);
    expect((await as(cookies.staff!, "/api/staff/items/ITM-0001/links/ITM-0002", "PATCH", {})).status).toBe(405);
    expect((await as(cookies.staff!, "/api/staff/search", "POST", {})).status).toBe(405);
    expect((await as(cookies.admin!, "/api/staff/admin/directory/search", "POST", {})).status).toBe(405);
  });
});

describe("migration 0030 and its release manifest", async () => {
  const fs = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const { DatabaseSync } = await import("node:sqlite");
  const ops = await import("../scripts/ops/production-release.mjs");
  const manifest = JSON.parse(fs.readFileSync("ops/releases/v1.11.json", "utf8")) as { migrations: { pending: Array<{ name: string; sha256: string }> }; expect: { schemaAdded: string[]; schemaChanged: string[]; tableRowsAfter: Record<string, number> } };
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");

  it("adds exactly what the manifest says to a database in production's state, and changes no row", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const apply = (file: string) => { db.exec("BEGIN"); db.exec(fs.readFileSync(`migrations/${file}`, "utf8")); db.exec("COMMIT"); };
    fs.readdirSync("migrations").sort().filter((file) => file < "0030").forEach(apply);
    const schema = () => Object.fromEntries((db.prepare("SELECT type, name, sql FROM sqlite_master").all() as Array<{ type: string; name: string; sql: string | null }>).map((row) => [`${row.type}:${row.name}`, sha(row.sql ?? "")]));
    const counts = () => db.prepare("SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM inventory_movements) AS movements, (SELECT COALESCE(SUM(on_hand), 0) FROM inventory_balances) AS onHand, (SELECT COUNT(*) FROM loans) AS loans, (SELECT COUNT(*) FROM audit_log) AS audit, (SELECT COUNT(*) FROM kits) AS kits").get();
    const items = db.prepare("SELECT * FROM items ORDER BY id").all();
    const before = schema();
    const figures = counts();
    apply("0030_item_relationships.sql");
    const after = schema();
    expect(Object.keys(after).filter((key) => !(key in before)).sort()).toEqual([...manifest.expect.schemaAdded].sort());
    expect(Object.keys(before).filter((key) => key in after && before[key] !== after[key])).toEqual(manifest.expect.schemaChanged);
    expect(Object.keys(before).filter((key) => !(key in after))).toEqual([]);
    expect(counts()).toEqual(figures);
    expect(db.prepare("SELECT * FROM items ORDER BY id").all()).toEqual(items);
    for (const [table, rows] of Object.entries(manifest.expect.tableRowsAfter)) expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(rows);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("is a manifest the Cloud Operations lane accepts, pinning the file it will apply", () => {
    expect(() => ops.loadManifest("ops/releases/v1.11.json", "v1.11")).not.toThrow();
    expect(manifest.migrations.pending).toEqual([{ name: "0030_item_relationships.sql", sha256: sha(fs.readFileSync("migrations/0030_item_relationships.sql", "utf8")) }]);
  });
});
