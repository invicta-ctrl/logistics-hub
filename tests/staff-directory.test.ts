import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";
// @ts-expect-error: a plain .mjs tool without types.
import * as ops from "../scripts/ops/production-release.mjs";

/* V1.3 Staff Directory through the Worker: who may do what, the private ID bucket, import idempotency, audit, and record matching. Fictional people only. */

const origin = "https://hub.example.test";
const PASSWORD = "correct horse battery";
let env: Env;
let sqlite: DatabaseSync;
let ids: ReturnType<typeof memoryR2>;
let catalog: ReturnType<typeof memoryR2>;
let evidence: ReturnType<typeof memoryR2>;
const cookies: Record<string, string> = {};

const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
/** A minimal browser-style JPEG of the given size (header-valid; the scan data is a stub). */
function jpeg(width = 1000, height = 630): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segment(0xdb, [0, ...Array(64).fill(1)]), ...segment(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    ...segment(0xc4, [0, ...Array(16).fill(0)]), ...segment(0xda, [3, 1, 0, 2, 0, 3, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9]);
}

async function seed(id: string, username: string, role: string) {
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(?, ?, ?, ?, ?)").run(id, username, `${username} name`, await hashPassword(PASSWORD), role);
  const response = await worker.fetch(new Request(`${origin}/api/staff/login`, { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${username}` }, body: JSON.stringify({ username, password: PASSWORD }) }), env);
  cookies[role] = response.headers.get("set-cookie")!.split(";")[0]!;
}

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  [ids, catalog, evidence] = [memoryR2(), memoryR2(), memoryR2()];
  env = { DB: database.d1, EVIDENCE: evidence.bucket, CATALOG_MEDIA: catalog.bucket, STAFF_IDS: ids.bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  await seed("ACC-owner", "owner", "OWNER");
  await seed("ACC-admin", "admin", "ADMIN");
  await seed("ACC-staff", "staff", "STAFF");
});

/** As a browser sends it: a form upload is encoded first so it carries its Content-Length, which the Worker requires. */
async function call(role: keyof typeof cookies | null, path: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = { origin };
  if (role) headers.cookie = cookies[role]!;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    const encoded = new Response(body);
    payload = await encoded.arrayBuffer();
    headers["content-type"] = encoded.headers.get("content-type")!;
    headers["content-length"] = String(payload.byteLength);
  } else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  return worker.fetch(new Request(`${origin}${path}`, { method, headers, body: payload }), env);
}
const json = async (response: Response) => await response.json() as Record<string, any>;

function pairForm(identity: string, department: string, options: { officer?: boolean; front?: Uint8Array; back?: Uint8Array } = {}) {
  const form = new FormData();
  form.set("identity", identity);
  form.set("department", department);
  form.set("officer", options.officer ? "1" : "0");
  form.set("sourceFront", `[${department}] Official ID/${identity}_Front_${department}.png`);
  form.set("sourceBack", `[${department}] Official ID/${identity}_Back_${department}.png`);
  form.set("front", new File([(options.front ?? jpeg()) as BlobPart], "front.jpg", { type: "image/jpeg" }));
  form.set("back", new File([(options.back ?? jpeg(1000, 640)) as BlobPart], "back.jpg", { type: "image/jpeg" }));
  return form;
}

async function addPerson(body: Record<string, unknown>, role = "ADMIN") {
  const response = await call(role, "/api/staff/admin/directory", "POST", body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await json(response)).id as string;
}

describe("who may use the Staff Directory", () => {
  it("is closed to the signed out and to STAFF, on every route", async () => {
    const person = await addPerson({ name: "Ana Santos", department: "DoL" });
    const routes: Array<[string, string]> = [["/api/staff/admin/directory", "GET"], ["/api/staff/admin/directory", "POST"], ["/api/staff/admin/directory/accounts", "GET"], ["/api/staff/admin/directory/import", "POST"],
      [`/api/staff/admin/directory/${person}`, "GET"], [`/api/staff/admin/directory/${person}`, "PATCH"], [`/api/staff/admin/directory/${person}/account`, "PUT"], [`/api/staff/admin/directory/${person}/usage`, "GET"],
      [`/api/staff/admin/directory/${person}/loans`, "GET"], [`/api/staff/admin/directory/${person}/activity`, "GET"], [`/api/staff/admin/directory/${person}/id`, "PUT"], [`/api/staff/admin/directory/${person}/id/front`, "GET"]];
    for (const [path, method] of routes) {
      expect((await call(null, path, method, method === "GET" ? undefined : {})).status, `signed out ${method} ${path}`).toBe(401);
      expect((await call("STAFF", path, method, method === "GET" ? undefined : {})).status, `STAFF ${method} ${path}`).toBe(403);
    }
    // The page itself is behind the same gate.
    const page = await worker.fetch(new Request(`${origin}/staff/admin/directory`, { headers: { cookie: cookies.STAFF! } }), env);
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe(`${origin}/staff/items`);
  });

  it("lets ADMIN keep profiles and open ID scans, but only the OWNER import, add, replace or remove scans", async () => {
    expect((await call("ADMIN", "/api/staff/admin/directory/import", "POST", pairForm("Reyes", "DEM"))).status).toBe(403);
    const imported = await json(await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("Reyes", "DEM")));
    const person = imported.id as string;
    expect((await call("ADMIN", `/api/staff/admin/directory/${person}`)).status).toBe(200);
    expect((await call("ADMIN", `/api/staff/admin/directory/${person}/id/front`)).status).toBe(200);
    const { card } = await json(await call("ADMIN", `/api/staff/admin/directory/${person}`));
    const replace = pairForm("Reyes", "DEM");
    replace.set("expected", card.mediaId);
    expect((await call("ADMIN", `/api/staff/admin/directory/${person}/id`, "PUT", replace)).status).toBe(403);
    expect((await call("ADMIN", `/api/staff/admin/directory/${person}/id?expected=${card.mediaId}`, "DELETE")).status).toBe(403);
    expect((await call("OWNER", `/api/staff/admin/directory/${person}/id?expected=${card.mediaId}`, "DELETE")).status).toBe(200);
  });
});

describe("importing official ID scans", () => {
  it("stores a pair only in the staff-ID bucket, under a random id, and adds the person with officer status beside their department", async () => {
    const response = await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("Garcia", "DoL", { officer: true }));
    expect(response.status).toBe(200);
    const { id, status } = await json(response);
    expect(status).toBe("imported");
    expect([...ids.objects.keys()].sort()).toEqual([expect.stringMatching(/^ids\/[0-9a-f-]{36}\/back$/), expect.stringMatching(/^ids\/[0-9a-f-]{36}\/front$/)]);
    expect(catalog.objects.size + evidence.objects.size).toBe(0);
    const detail = await json(await call("OWNER", `/api/staff/admin/directory/${id}`));
    expect(detail.person).toMatchObject({ name: "Garcia", department: "DoL", officer: true, active: true, hasId: true, sourceKey: "garcia|DoL", account: null });
    expect(detail.card).toMatchObject({ front: { width: 1000, height: 630 }, back: { width: 1000, height: 640 }, sourceFront: "[DoL] Official ID/Garcia_Front_DoL.png" });
    expect(detail.history.map((entry: { action: string }) => entry.action)).toEqual(["STAFF_ID_IMPORTED"]);
  });

  it("changes nothing when the same archive is imported again, however the name is spelled", async () => {
    const first = await json(await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("Dela Cruz", "DPC")));
    const again = await json(await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("DELA_CRUZ", "dpc")));
    expect(again).toEqual({ id: first.id, status: "exists" });
    expect(ids.objects.size).toBe(2);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_directory").get()).toEqual({ n: 1 });
    // The same surname in another department is another person.
    expect((await json(await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("Dela Cruz", "DoF")))).status).toBe("imported");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_directory").get()).toEqual({ n: 2 });
  });

  it("refuses anything that is not a browser JPEG or not one of our departments, and leaves nothing behind", async () => {
    const png = pairForm("Lim", "OfP", { front: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0]) });
    expect((await call("OWNER", "/api/staff/admin/directory/import", "POST", png)).status).toBe(400);
    expect((await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("Lim", "XYZ"))).status).toBe(400);
    expect((await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("Lim", "OfP", { back: jpeg(2400, 1500) }))).status).toBe(400);
    expect(ids.objects.size).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_directory").get()).toEqual({ n: 0 });
  });

  it("refuses an upload without a length, and leaves no half-stored card when R2 fails on the second side", async () => {
    const unsized = await worker.fetch(new Request(`${origin}/api/staff/admin/directory/import`, { method: "POST", headers: { origin, cookie: cookies.OWNER! }, body: pairForm("Tan", "DHR") }), env);
    expect(unsized.status).toBe(411);
    const put = env.STAFF_IDS.put.bind(env.STAFF_IDS);
    let puts = 0;
    env.STAFF_IDS.put = (async (...args: Parameters<R2Bucket["put"]>) => { if (++puts === 2) throw new Error("R2 unavailable"); return put(...args); }) as R2Bucket["put"];
    expect((await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("Tan", "DHR"))).status).toBe(500);
    env.STAFF_IDS.put = put;
    expect(ids.objects.size).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_directory").get()).toEqual({ n: 0 });
  });

  it("removes the stored scans again when the database write fails", async () => {
    const original = env.DB.batch.bind(env.DB);
    env.DB.batch = (async () => { throw new Error("D1 unavailable"); }) as typeof env.DB.batch;
    expect((await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("Tan", "DHR"))).status).toBe(500);
    env.DB.batch = original;
    expect(ids.objects.size).toBe(0);
  });

  it("gives scans to the entry that already holds the import's key and has none, keeping the profile people typed", async () => {
    const { id } = await json(await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("Mendoza", "DCES")));
    const { person, card } = await json(await call("OWNER", `/api/staff/admin/directory/${id}`));
    expect((await call("ADMIN", `/api/staff/admin/directory/${id}`, "PATCH", { name: "Maria Luz Mendoza", position: "Executive Staff", studentId: "20-5555-111", updatedAt: person.updatedAt })).status).toBe(200);
    expect((await call("OWNER", `/api/staff/admin/directory/${id}/id?expected=${card.mediaId}`, "DELETE")).status).toBe(200);
    expect(await json(await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm("MENDOZA", "dces")))).toEqual({ id, status: "imported" });
    const detail = await json(await call("OWNER", `/api/staff/admin/directory/${id}`));
    expect(detail.person).toMatchObject({ name: "Maria Luz Mendoza", department: "DCES", position: "Executive Staff", studentId: "20-5555-111", hasId: true, sourceKey: "mendoza|DCES" });
    expect(detail.card.mediaId).not.toBe(card.mediaId);
    expect([...ids.objects.keys()].every((key) => key.startsWith(`ids/${detail.card.mediaId}/`))).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_directory").get()).toEqual({ n: 1 });
  });
});

describe("viewing, replacing and removing scans", () => {
  async function imported(identity = "Ramos", department = "DBR") {
    const { id } = await json(await call("OWNER", "/api/staff/admin/directory/import", "POST", pairForm(identity, department)));
    const { card } = await json(await call("OWNER", `/api/staff/admin/directory/${id}`));
    return { id: id as string, mediaId: card.mediaId as string };
  }

  it("streams each side privately, never cached, and logs one view per viewer and card in ten minutes", async () => {
    const { id } = await imported();
    const front = await call("ADMIN", `/api/staff/admin/directory/${id}/id/front`);
    expect(front.status).toBe(200);
    expect(front.headers.get("content-type")).toBe("image/jpeg");
    expect(front.headers.get("cache-control")).toBe("private, no-store");
    expect(front.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect((await call("ADMIN", `/api/staff/admin/directory/${id}/id/back`)).status).toBe(200);
    expect((await call("ADMIN", `/api/staff/admin/directory/${id}/id/front`)).status).toBe(200);
    expect((await call("OWNER", `/api/staff/admin/directory/${id}/id/front`)).status).toBe(200);
    const views = sqlite.prepare("SELECT actor_user_id AS actor FROM audit_log WHERE action = 'STAFF_ID_VIEWED' ORDER BY actor").all();
    expect(views).toEqual([{ actor: "ACC-admin" }, { actor: "ACC-owner" }]);
    expect((await call("ADMIN", `/api/staff/admin/directory/${id}/id/side`)).status).toBe(404);
  });

  it("cannot be reached through any catalog, public or evidence route", async () => {
    const { mediaId } = await imported();
    for (const path of [`/api/public/media/${mediaId}/thumb`, `/api/staff/media/${mediaId}/display`, `/api/staff/media/${mediaId}/thumb`, `/api/staff/media/${mediaId}/front`]) {
      for (const role of [null, "STAFF", "OWNER"] as const) expect((await call(role, path)).status, `${role} ${path}`).not.toBe(200);
    }
    const catalogs = await Promise.all(["/api/public/catalog", "/api/self-service/catalog"].map(async (path) => await (await call(null, path)).text()));
    for (const text of catalogs) { expect(text).not.toContain(mediaId); expect(text).not.toContain("Ramos"); }
    const inventory = await (await call("STAFF", "/api/staff/inventory")).text();
    expect(inventory).not.toContain(mediaId);
  });

  it("replaces a card only from the version the owner saw, and removes the old files", async () => {
    const { id, mediaId } = await imported();
    const stale = pairForm("Ramos", "DBR");
    expect((await call("OWNER", `/api/staff/admin/directory/${id}/id`, "PUT", stale)).status).toBe(409);
    const form = pairForm("Ramos", "DBR");
    form.set("expected", mediaId);
    const { mediaId: next } = await json(await call("OWNER", `/api/staff/admin/directory/${id}/id`, "PUT", form));
    expect(next).not.toBe(mediaId);
    expect([...ids.objects.keys()].every((key) => key.startsWith(`ids/${next}/`))).toBe(true);
    expect((await call("OWNER", `/api/staff/admin/directory/${id}/id?expected=${mediaId}`, "DELETE")).status).toBe(409);
    expect((await call("OWNER", `/api/staff/admin/directory/${id}/id?expected=${next}`, "DELETE")).status).toBe(200);
    expect(ids.objects.size).toBe(0);
    expect((await call("OWNER", `/api/staff/admin/directory/${id}/id/front`)).status).toBe(404);
    expect(sqlite.prepare("SELECT action FROM audit_log WHERE entity_type = 'STAFF' ORDER BY rowid").all().map((row) => row.action)).toEqual(["STAFF_ID_IMPORTED", "STAFF_ID_REPLACED", "STAFF_ID_REMOVED"]);
  });
});

describe("profiles and account links", () => {
  it("edits only from the loaded version, keeps student IDs unique, and logs field names but never values", async () => {
    const id = await addPerson({ name: "Ana Santos", department: "DoL", position: "Materials committee", studentId: "20-1111-222" });
    await addPerson({ name: "Ben Lim", department: "DoF" });
    const { person } = await json(await call("ADMIN", `/api/staff/admin/directory/${id}`));
    expect(person).toMatchObject({ name: "Ana Santos", department: "DoL", position: "Materials committee", studentId: "20-1111-222", officer: false });
    const saved = await call("ADMIN", `/api/staff/admin/directory/${id}`, "PATCH", { name: "Ana Marie Santos", officer: true, studentId: "20-9999-000", updatedAt: person.updatedAt });
    expect(saved.status).toBe(200);
    expect((await call("ADMIN", `/api/staff/admin/directory/${id}`, "PATCH", { position: "Director", updatedAt: person.updatedAt })).status).toBe(409);
    const other = (await json(await call("ADMIN", "/api/staff/admin/directory"))).people.find((entry: { name: string }) => entry.name === "Ben Lim");
    expect((await call("ADMIN", `/api/staff/admin/directory/${other.id}`, "PATCH", { studentId: "20-9999-000", updatedAt: other.updatedAt })).status).toBe(409);
    expect((await call("ADMIN", "/api/staff/admin/directory", "POST", { name: "No Department" })).status).toBe(400);
    const log = sqlite.prepare("SELECT details_json AS details FROM audit_log WHERE action = 'STAFF_PROFILE_UPDATED'").get() as { details: string };
    expect(JSON.parse(log.details)).toEqual({ name: "Ana Marie Santos", department: "DoL", fields: ["name", "officer", "studentId"] });
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM audit_log").all())).not.toMatch(/20-9999-000|20-1111-222/);
  });

  it("links a person to one sign-in explicitly, within the linker's own authority, and says so in the session", async () => {
    const ana = await addPerson({ name: "Ana Santos", department: "DoL" });
    const ben = await addPerson({ name: "Ben Lim", department: "DoF" });
    expect((await call("ADMIN", `/api/staff/admin/directory/${ana}/account`, "PUT", { accountId: "ACC-owner" })).status).toBe(403);
    expect((await json(await call("ADMIN", "/api/staff/admin/directory/accounts"))).accounts.map((row: { id: string }) => row.id).sort()).toEqual(["ACC-admin", "ACC-staff"]);
    expect((await call("ADMIN", `/api/staff/admin/directory/${ana}/account`, "PUT", { accountId: "ACC-staff" })).status).toBe(200);
    expect((await call("ADMIN", `/api/staff/admin/directory/${ben}/account`, "PUT", { accountId: "ACC-staff" })).status).toBe(409);
    expect((await call("OWNER", `/api/staff/admin/directory/${ana}/account`, "PUT", { accountId: "ACC-admin" })).status).toBe(409);
    expect((await json(await call("STAFF", "/api/staff/session"))).directory).toEqual({ name: "Ana Santos", department: "DoL", position: null });
    expect((await json(await call("ADMIN", "/api/staff/session"))).directory).toBeNull();
    expect((await call("OWNER", `/api/staff/admin/directory/${ben}/account`, "PUT", { accountId: "ACC-owner" })).status).toBe(200);
    expect((await call("ADMIN", `/api/staff/admin/directory/${ben}/account`, "DELETE")).status).toBe(403);
    // Ben is now the owner's verified identity: an administrator may not rename or deactivate him either.
    const linked = (await json(await call("OWNER", `/api/staff/admin/directory/${ben}`))).person;
    expect((await call("ADMIN", `/api/staff/admin/directory/${ben}`, "PATCH", { name: "Someone Else", updatedAt: linked.updatedAt })).status).toBe(403);
    expect((await call("OWNER", `/api/staff/admin/directory/${ben}`, "PATCH", { position: "Treasurer", updatedAt: linked.updatedAt })).status).toBe(200);
    expect((await call("ADMIN", `/api/staff/admin/directory/${ana}/account`, "DELETE")).status).toBe(200);
    expect((await json(await call("STAFF", "/api/staff/session"))).directory).toBeNull();
    const actions = sqlite.prepare("SELECT action, details_json AS details FROM audit_log WHERE entity_type = 'STAFF' AND action LIKE '%LINKED' ORDER BY rowid").all();
    expect(actions.map((row) => [row.action, JSON.parse(String(row.details)).username])).toEqual([["STAFF_ACCOUNT_LINKED", "staff"], ["STAFF_ACCOUNT_LINKED", "owner"], ["STAFF_ACCOUNT_UNLINKED", "staff"]]);
  });
});

describe("making a sign-in from a profile, and watching how it is used", () => {
  const login = (username: string, password: string, ip = "ip-test") => worker.fetch(new Request(`${origin}/api/staff/login`, { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ username, password }) }), env);

  it("creates a sign-in named after the person, links it in the same step, and shows the password once", async () => {
    const ana = await addPerson({ name: "Ána Marie Santos", department: "DoL" });
    const before = await json(await call("ADMIN", `/api/staff/admin/directory/${ana}/access`));
    expect(before).toEqual({ account: null, suggestedUsername: "ana.santos" });
    // An administrator may make staff sign-ins only.
    expect((await call("ADMIN", `/api/staff/admin/directory/${ana}/account/new`, "POST", { username: "ana.santos", role: "ADMIN" })).status).toBe(403);
    expect((await call("STAFF", `/api/staff/admin/directory/${ana}/account/new`, "POST", { username: "ana.santos" })).status).toBe(403);
    const made = await call("ADMIN", `/api/staff/admin/directory/${ana}/account/new`, "POST", { username: "ana.santos" });
    expect(made.status).toBe(201);
    const { accountId, username, generatedPassword } = await json(made);
    expect(username).toBe("ana.santos");
    expect(generatedPassword).toMatch(/^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){3}$/);
    const account = sqlite.prepare("SELECT display_name AS name, role, must_change_password AS mustChange, password_hash AS hash FROM staff_accounts WHERE id = ?").get(accountId) as Record<string, unknown>;
    expect(account).toMatchObject({ name: "Ána Marie Santos", role: "STAFF", mustChange: 1 });
    expect(String(account.hash)).not.toContain(generatedPassword);
    const { person } = await json(await call("ADMIN", `/api/staff/admin/directory/${ana}`));
    expect(person.account).toMatchObject({ id: accountId, username: "ana.santos", role: "STAFF", active: true, lastLoginAt: null });
    // A second sign-in for the same person is refused, and the next suggestion avoids the taken name.
    expect((await call("ADMIN", `/api/staff/admin/directory/${ana}/account/new`, "POST", { username: "ana.santos2" })).status).toBe(409);
    const twin = await addPerson({ name: "Ana Santos", department: "DEM" });
    expect((await json(await call("ADMIN", `/api/staff/admin/directory/${twin}/access`))).suggestedUsername).toBe("ana.santos2");
    expect((await call("ADMIN", `/api/staff/admin/directory/${twin}/account/new`, "POST", { username: "ana.santos" })).status).toBe(409);
    const audits = sqlite.prepare("SELECT action, entity_id AS entity, details_json AS details FROM audit_log WHERE action IN ('ACCOUNT_CREATED', 'STAFF_ACCOUNT_LINKED') ORDER BY rowid").all();
    expect(audits.map((row) => [row.action, row.entity, JSON.parse(String(row.details)).username])).toEqual([["ACCOUNT_CREATED", accountId, "ana.santos"], ["STAFF_ACCOUNT_LINKED", ana, "ana.santos"]]);
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM audit_log").all())).not.toContain(generatedPassword);
    // The password works once, and must then be replaced.
    expect(await json(await login("ana.santos", generatedPassword))).toEqual({ ok: true, mustChangePassword: true });
  });

  it("shows sign-ins, failed attempts and changes to whoever manages the account, and only the summary to others", async () => {
    const ana = await addPerson({ name: "Ana Santos", department: "DoL" });
    const { generatedPassword } = await json(await call("OWNER", `/api/staff/admin/directory/${ana}/account/new`, "POST", { username: "ana.santos", role: "ADMIN" }));
    expect((await login("ana.santos", generatedPassword, "ip-1")).status).toBe(200);
    expect((await login("ana.santos", generatedPassword, "ip-2")).status).toBe(200);
    const accountId = (sqlite.prepare("SELECT id FROM staff_accounts WHERE username = 'ana.santos'").get() as { id: string }).id;
    expect((await call("OWNER", `/api/staff/admin/accounts/${accountId}/sessions/revoke`, "POST")).status).toBe(200);
    expect((await login("ana.santos", generatedPassword, "ip-3")).status).toBe(200);
    expect((await login("ana.santos", "wrong password!!", "ip-4")).status).toBe(401);
    expect((await login("ana.santos", "wrong password!!", "ip-5")).status).toBe(401);
    const owner = await json(await call("OWNER", `/api/staff/admin/directory/${ana}/access`));
    expect(owner).toMatchObject({ self: false, manageable: true, account: { username: "ana.santos", role: "ADMIN", active: true, openSessions: 1, failedAttempts: 2, mustChangePassword: true } });
    expect(owner.account.lastLoginAt).toEqual(expect.any(String));
    expect(owner.signIns.map((entry: { state: string }) => entry.state).sort()).toEqual(["ENDED", "ENDED", "OPEN"]);
    expect(owner.signIns.every((entry: Record<string, unknown>) => Object.keys(entry).sort().join() === "at,state,until" && String(entry.at).endsWith("Z"))).toBe(true);
    expect(owner.events.map((event: { action: string }) => event.action)).toEqual(["SESSIONS_REVOKED", "ACCOUNT_CREATED"]);
    // Another administrator sees what Administration → Accounts already lists, not the history of an account they cannot manage.
    const admin = await json(await call("ADMIN", `/api/staff/admin/directory/${ana}/access`));
    expect(admin).toMatchObject({ self: false, manageable: false, signIns: null, events: null, account: { username: "ana.santos", openSessions: 1 } });
    expect(admin.account).not.toHaveProperty("failedAttempts");
    expect(JSON.stringify(owner)).not.toMatch(/"id":"[0-9a-f]{8}-/);
  });
});

describe("usage, loans and activity come from the existing records", () => {
  const item = () => sqlite.prepare("SELECT id, unit FROM items ORDER BY id LIMIT 1").get() as { id: string; unit: string };
  let movement = 0;
  function loan(name: string, studentId: string | null, at = "2026-09-10T02:00:00.000Z") {
    const { id, unit } = item();
    const mov = `MOV-T${++movement}`;
    sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, related_entity_type, related_entity_id, actor_user_id, status)
      VALUES(?, ?, 'LOAN_OUT', 'OUT', ?, 1, ?, -1, 'LOAN', ?, 'ACC-staff', 'POSTED')`).run(mov, at, id, unit, `LN-${mov}`);
    sqlite.prepare(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, reason, photo_key, movement_id, created_at, created_by)
      VALUES(?, ?, 1, ?, ?, ?, ?, 'loans/x', ?, ?, 'ACC-staff')`).run(`LN-${mov}`, id, studentId ? "INDIVIDUAL" : "USC", name, studentId, studentId ? null : "Event setup", mov, at);
  }
  function take(name: string, studentId: string | null, at = "2026-09-12T02:00:00.000Z") {
    const { id, unit } = item();
    const mov = `MOV-T${++movement}`;
    const event = `00000000-0000-4000-8000-${String(movement).padStart(12, "0")}`;
    sqlite.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, purpose, device_time, sent_at, occurred_at, received_at, movement_id, applied)
      VALUES(?, 'dev', ?, 'TAKE', ?, 2, ?, ?, 'INDIVIDUAL', ?, ?, ?, ?, ?, 1)`).run(event, movement, id, name, studentId, at, at, at, at, mov);
    sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, related_entity_type, related_entity_id, actor_user_id, reason, status)
      VALUES(?, ?, 'STOCK_OUT', 'OUT', ?, 2, ?, -2, 'SELF_SERVICE', ?, 'SELF_SERVICE', 'CONSUMED', 'POSTED')`).run(mov, at, id, unit, event);
  }

  it("matches by student ID when both have one, otherwise by the exact full name, and never by surname alone", async () => {
    const ana = await addPerson({ name: "Ana Santos", department: "DoL", studentId: "20-1111-222" });
    const surname = await addPerson({ name: "Santos", department: "DEM" });
    loan("Ana Santos", "20-1111-222");          // student ID
    loan("A. Santos", "20-1111-222");           // student ID despite another spelling
    loan("ana santos", null);                    // exact name, no ID on the record
    loan("Ana Santos", "20-5555-666");          // same name, someone else's ID
    loan("Santos", null);                        // surname only
    take("Ana Santos", "20-1111-222");
    take("Ben Lim", null);
    const loans = (await json(await call("ADMIN", `/api/staff/admin/directory/${ana}/loans`))).loans as Array<{ borrowerName: string; studentId: string | null }>;
    expect(loans.map((entry) => [entry.borrowerName, entry.studentId]).sort()).toEqual([["A. Santos", "20-1111-222"], ["Ana Santos", "20-1111-222"], ["ana santos", null]]);
    const usage = (await json(await call("ADMIN", `/api/staff/admin/directory/${ana}/usage`))).usage as Array<{ kind: string; matchedBy: string; quantity: number }>;
    expect(usage.map((row) => `${row.kind}:${row.matchedBy}:${row.quantity}`).sort()).toEqual(["LOAN:NAME:1", "LOAN:STUDENT_ID:1", "LOAN:STUDENT_ID:1", "TAKE:STUDENT_ID:2"]);
    expect((await json(await call("ADMIN", `/api/staff/admin/directory/${surname}/loans`))).loans).toEqual([]);
    // Office days: a take on the 12th (Manila) is inside 12–12 and outside 13–20.
    expect((await json(await call("ADMIN", `/api/staff/admin/directory/${ana}/usage?from=2026-09-12&to=2026-09-12`))).usage).toHaveLength(1);
    expect((await json(await call("ADMIN", `/api/staff/admin/directory/${ana}/usage?from=2026-09-13&to=2026-09-20`))).usage).toHaveLength(0);
    expect((await call("ADMIN", `/api/staff/admin/directory/${ana}/usage?from=2026-09-20&to=2026-09-13`)).status).toBe(400);
  });

  it("shows a linked person's own Activity, and puts directory events in Activity for administrators only", async () => {
    const ana = await addPerson({ name: "Ana Santos", department: "DoL" });
    expect(await json(await call("ADMIN", `/api/staff/admin/directory/${ana}/activity`))).toEqual({ linked: false, events: [], nextCursor: null });
    await call("ADMIN", `/api/staff/admin/directory/${ana}/account`, "PUT", { accountId: "ACC-staff" });
    loan("Someone", "20-0000-001");
    const mine = await json(await call("ADMIN", `/api/staff/admin/directory/${ana}/activity`));
    expect(mine.linked).toBe(true);
    expect(mine.events.every((event: { actorId: string }) => event.actorId === "ACC-staff")).toBe(true);
    expect(mine.events.length).toBeGreaterThan(0);
    expect((await call("ADMIN", `/api/staff/admin/directory/${ana}/activity?cursor=bad`)).status).toBe(400);
    const admin = await json(await call("ADMIN", "/api/staff/activity?source=DIRECTORY"));
    expect(admin.events.map((event: { summary: string }) => event.summary)).toEqual(["admin name linked Ana Santos (DoL) to the sign-in staff.", "admin name added Ana Santos (DoL) to the Staff Directory."]);
    expect((await call("STAFF", "/api/staff/activity?source=DIRECTORY")).status).toBe(200);
    expect((await json(await call("STAFF", "/api/staff/activity?source=DIRECTORY"))).events).toEqual([]);
    expect(JSON.stringify(await json(await call("STAFF", "/api/staff/activity")))).not.toContain("Ana Santos");
  });
});

describe("V1.3 release manifest (Cloud Operations lane)", () => {
  const manifest = JSON.parse(fs.readFileSync("ops/releases/v1.3.json", "utf8"));
  const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");

  it("pins 0021 by hash and names exactly the buckets wrangler.jsonc binds", () => {
    const [pending] = manifest.migrations.pending;
    expect(pending.name).toBe("0021_staff_directory.sql");
    expect(createHash("sha256").update(fs.readFileSync(`migrations/${pending.name}`)).digest("hex")).toBe(pending.sha256);
    const bound = [...wrangler.matchAll(/"binding": "([A-Z_]+)", "bucket_name": "([a-z0-9-]+)"/g)].map((match) => ({ binding: match[1], name: match[2] }));
    expect([...manifest.target.r2.existing, ...manifest.target.r2.create]).toEqual(bound);
    expect(manifest.target.r2.create).toEqual([{ binding: "STAFF_IDS", name: "logistics-hub-staff-ids" }]);
  });

  it("passes the lane's own release-tree check with this branch's wrangler.jsonc and migrations", () => {
    expect(ops.loadManifest("ops/releases/v1.3.json", "v1.3").release).toBe("v1.3");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-v13-"));
    try {
      fs.copyFileSync("wrangler.jsonc", path.join(dir, "wrangler.jsonc"));
      fs.cpSync("migrations", path.join(dir, "migrations"), { recursive: true });
      const sha = "a".repeat(40);
      const git = (args: string[]) => args[0] === "rev-parse" ? sha : args[0] === "status" ? "" : "ok";
      expect(ops.verifyReleaseTree({ manifest, releaseDir: dir, expectedSha: sha, git }).branch).toBe("road-to-v2/v1.3-staff-directory");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("adds exactly the schema objects it declares, on a database migrated through 0020, and they start empty", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const file of fs.readdirSync("migrations").filter((name) => name < "0021").sort()) db.exec(fs.readFileSync(`migrations/${file}`, "utf8"));
    const schema = () => new Map((db.prepare("SELECT type, name, sql FROM sqlite_master").all() as Array<{ type: string; name: string; sql: string | null }>).map((row) => [`${row.type}:${row.name}`, row.sql]));
    const before = schema();
    db.exec(fs.readFileSync("migrations/0021_staff_directory.sql", "utf8"));
    const after = schema();
    expect([...after.keys()].filter((key) => !before.has(key)).sort()).toEqual([...manifest.expect.schemaAdded].sort());
    for (const [key, sql] of before) expect(after.get(key), key).toBe(sql);
    for (const [table, rows] of Object.entries(manifest.expect.tableRowsAfter)) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: rows });
  });
});
