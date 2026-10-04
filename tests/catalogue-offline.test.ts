import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";
import { jpeg } from "./jpeg";

/* V1.6 Catalog PWA: the offline cataloguing lease, what it may and may not do, how it ends, and the server side of syncing. */

const origin = "https://hub.example.test";
const WEEK = 7 * 24 * 60 * 60 * 1000;
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let session: string;
let other: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (cookie: string, path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const both = (...cookies: string[]) => cookies.join("; ");
const leaseRows = () => sqlite.prepare("SELECT id, account_id AS accountId, expires_at AS expiresAt, revoked_at AS revokedAt FROM staff_sessions WHERE id GLOB 'CL-*' ORDER BY created_at, id").all() as Array<{ id: string; accountId: string; expiresAt: number; revokedAt: string | null }>;
const actions = () => (sqlite.prepare("SELECT action FROM audit_log WHERE entity_type = 'ACCOUNT' ORDER BY created_at, rowid").all() as Array<{ action: string }>).map((row) => row.action);

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  const hash = await hashPassword("correct horse battery");
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(hash);
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-2', 'staff.two', 'Staff Two', ?)").run(hash);
  session = await signIn("staff.one");
  other = await signIn("staff.two");
});

async function signIn(username: string): Promise<string> {
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${username}` }, body: JSON.stringify({ username, password: "correct horse battery" }) });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

/** Turns offline cataloguing on with `cookies` and answers the lease cookie the device would keep. */
async function turnOn(cookies = session): Promise<string> {
  const response = await as(cookies, "/api/staff/catalogue/offline", "POST");
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function place(name: string): Promise<string> {
  const response = await as(session, "/api/staff/locations", "POST", { name, parentId: null });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

let counter = 0;
const requestId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const sessionId = () => `CS-00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`;
const shot = (locationId: string, fields: Record<string, unknown> = {}) => ({ id: requestId(), behaviour: "CONSUME", name: `Thing ${counter}`, category: "SUPPLIES", unit: "piece", quantity: 3, locationId, ...fields });

function photoForm(expected: string): FormData {
  const form = new FormData();
  form.set("display", new File([jpeg({ width: 40, height: 30 }) as BlobPart], "display.jpg", { type: "image/jpeg" }));
  form.set("thumb", new File([jpeg({ width: 16, height: 12 }) as BlobPart], "thumb.jpg", { type: "image/jpeg" }));
  form.set("expected", expected);
  form.set("hash", "ffff0000ffff0000");
  return form;
}
const putPhoto = (cookie: string, itemId: string, expected = "") => call(`/api/staff/items/${itemId}/photo`, { method: "PUT", headers: { origin, cookie }, body: photoForm(expected) });

describe("turning offline cataloguing on", () => {
  it("issues a week-long lease for this device in its own cookie, audited", async () => {
    const before = Date.now();
    const response = await as(session, "/api/staff/catalogue/offline", "POST");
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie")!;
    expect(header).toMatch(/^lh_catalogue_lease=[^;]+; Path=\/api\/staff\/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure$/);
    const [lease] = leaseRows();
    expect(lease).toMatchObject({ accountId: "ACC-1", revokedAt: null });
    expect(lease!.expiresAt - before).toBeGreaterThanOrEqual(WEEK - 1000);
    expect(((await response.json()) as { lease: { expiresAt: number } }).lease.expiresAt).toBe(lease!.expiresAt);
    expect(actions()).toContain("CATALOGUE_OFFLINE_ON");
    const state = await (await as(both(session, header.split(";")[0]!), "/api/staff/catalogue/offline")).json();
    expect(state).toMatchObject({ signedIn: true, lease: { expiresAt: lease!.expiresAt }, account: { id: "ACC-1", displayName: "Staff One", username: "staff.one", access: "DoL" } });
  });

  it("keeps one lease per device and moves it a full week ahead on each signed-in visit", async () => {
    const lease = await turnOn();
    sqlite.prepare("UPDATE staff_sessions SET expires_at = ? WHERE id GLOB 'CL-*'").run(Date.now() + 60_000);
    await turnOn(both(session, lease));
    expect(leaseRows()).toHaveLength(1);
    expect(leaseRows()[0]!.expiresAt).toBeGreaterThan(Date.now() + WEEK - 5000);
    expect(actions().filter((action) => action === "CATALOGUE_OFFLINE_ON")).toHaveLength(1);
  });

  it("ends a lease another member left on the device when a new member turns it on there", async () => {
    const theirs = await turnOn(other);
    await turnOn(both(session, theirs));
    expect(Object.fromEntries(leaseRows().map((row) => [row.accountId, row.revokedAt === null]))).toEqual({ "ACC-1": true, "ACC-2": false });
    expect((await as(theirs, "/api/staff/catalogue/snapshot")).status).toBe(401);
  });

  it("needs a full sign-in, and is for Logistics staff only", async () => {
    const lease = await turnOn();
    expect((await as(lease, "/api/staff/catalogue/offline", "POST")).status).toBe(401);
    sqlite.prepare("INSERT INTO system_settings(key, value, updated_at, updated_by) VALUES('account_access:ACC-2', 'DEM', '2026-10-04T00:00:00.000Z', 'ACC-1')").run();
    const response = await as(await signIn("staff.two"), "/api/staff/catalogue/offline", "POST");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "NO_HUB_ACCESS" });
  });

  it("signing in ends a lease another member left on the device, and keeps one's own", async () => {
    const login = (cookie: string) => call("/api/staff/login", { method: "POST", headers: { origin, cookie, "content-type": "application/json", "cf-connecting-ip": "ip-shared" }, body: JSON.stringify({ username: "staff.one", password: "correct horse battery" }) });
    const theirs = await turnOn(other);
    const shared = await login(theirs);
    expect(shared.headers.getSetCookie().map((value) => value.split("=")[0])).toEqual(["lh_staff_session", "lh_catalogue_lease"]);
    expect((await as(theirs, "/api/staff/catalogue/snapshot")).status).toBe(401);
    const mine = await turnOn();
    const own = await login(mine);
    expect(own.headers.getSetCookie().map((value) => value.split("=")[0])).toEqual(["lh_staff_session"]);
    expect((await as(mine, "/api/staff/catalogue/snapshot")).status).toBe(200);
  });

  it("reports no lease for a member whose device holds someone else's", async () => {
    const theirs = await turnOn(other);
    expect(await (await as(both(session, theirs), "/api/staff/catalogue/offline")).json()).toMatchObject({ signedIn: true, lease: null, account: { id: "ACC-1" } });
  });
});

describe("a lease on its own", () => {
  it("catalogues: the snapshot, a session, captures, the first photo of its own items, and finishing", async () => {
    const shelf = await place("Shelf 2");
    const lease = await turnOn();
    expect(await (await as(lease, "/api/staff/catalogue/offline")).json()).toMatchObject({ signedIn: false, lease: { expiresAt: expect.any(Number) }, account: { id: "ACC-1" } });
    expect((await as(lease, "/api/staff/catalogue/snapshot")).status).toBe(200);
    // Only this member's own session: who else is cataloguing, and what waits for review, need a sign-in.
    await as(other, "/api/staff/catalogue/sessions", "POST", { locationId: shelf });
    expect(await (await as(lease, "/api/staff/catalogue")).json()).toEqual({ session: null, others: [], reviewLater: { total: 0, items: [] } });
    expect(((await (await as(session, "/api/staff/catalogue")).json()) as { others: unknown[] }).others).toHaveLength(1);
    const started = await as(lease, "/api/staff/catalogue/sessions", "POST", { locationId: shelf });
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };
    expect((await as(lease, `/api/staff/catalogue/sessions/${id}`)).status).toBe(200);
    expect((await as(lease, `/api/staff/catalogue/sessions/${id}`, "PATCH", { locationId: shelf })).status).toBe(200);
    const saved = await as(lease, `/api/staff/catalogue/sessions/${id}/captures`, "POST", shot(shelf));
    expect(saved.status).toBe(201);
    const item = ((await saved.json()) as { id: string }).id;
    expect((await putPhoto(lease, item)).status).toBe(200);
    // A second photo would replace the first: that needs a full sign-in.
    const version = (sqlite.prepare("SELECT updated_at AS v FROM items WHERE id = ?").get(item) as { v: string }).v;
    expect((await putPhoto(lease, item, version)).status).toBe(403);
    expect((await as(lease, `/api/staff/catalogue/sessions/${id}/finish`, "POST")).status).toBe(200);
  });

  it("does nothing else", async () => {
    const shelf = await place("Shelf 2");
    const lease = await turnOn();
    const { id } = (await (await as(session, "/api/staff/catalogue/sessions", "POST", { locationId: shelf })).json()) as { id: string };
    const theirs = ((await (await as(other, "/api/staff/catalogue/sessions", "POST", { locationId: shelf })).json()) as { id: string }).id;
    const item = ((await (await as(other, `/api/staff/catalogue/sessions/${theirs}/captures`, "POST", shot(shelf))).json()) as { id: string }).id;
    expect((await putPhoto(lease, item)).status).toBe(403);
    // Another member's session: any signed-in member may read it, a lease may not.
    expect((await as(session, `/api/staff/catalogue/sessions/${theirs}`)).status).toBe(200);
    expect((await as(lease, `/api/staff/catalogue/sessions/${theirs}`)).status).toBe(403);
    for (const [method, path] of [
      ["GET", "/api/staff/session"], ["GET", "/api/staff/inventory"], ["GET", `/api/staff/items/${item}`], ["POST", "/api/staff/items"],
      ["GET", `/api/staff/catalogue/sessions/${id}/unreviewed`], ["POST", "/api/staff/items/bulk"], ["POST", "/api/staff/locations"], ["GET", "/api/staff/loans"],
      ["GET", "/api/staff/activity"], ["GET", "/api/staff/admin/accounts"], ["PATCH", "/api/staff/me"], ["POST", "/api/staff/me/sessions/revoke"], ["DELETE", `/api/staff/items/${item}/photo`]
    ] as const) expect((await as(lease, path, method, method === "GET" ? undefined : {})).status, `${method} ${path}`).toBe(401);
  });

  it("cannot pass as a session, nor a session as a lease", async () => {
    const lease = await turnOn();
    expect((await as(lease.replace("lh_catalogue_lease=", "lh_staff_session="), "/api/staff/session")).status).toBe(401);
    expect((await as(session.replace("lh_staff_session=", "lh_catalogue_lease="), "/api/staff/catalogue/snapshot")).status).toBe(401);
  });

  it("ends when it expires", async () => {
    const lease = await turnOn();
    sqlite.prepare("UPDATE staff_sessions SET expires_at = ? WHERE id GLOB 'CL-*'").run(Date.now() - 1);
    expect((await as(lease, "/api/staff/catalogue/snapshot")).status).toBe(401);
  });
});

describe("ending a lease", () => {
  const ended = async (lease: string) => (await as(lease, "/api/staff/catalogue/snapshot")).status === 401;

  it("turning it off ends it and clears the cookie, audited", async () => {
    const lease = await turnOn();
    const response = await as(both(session, lease), "/api/staff/catalogue/offline", "DELETE");
    expect(response.headers.get("set-cookie")).toMatch(/^lh_catalogue_lease=; Path=\/api\/staff\/; HttpOnly; SameSite=Strict; Max-Age=0/);
    expect(await ended(lease)).toBe(true);
    expect(actions()).toContain("CATALOGUE_OFFLINE_OFF");
  });

  it("the lease can turn itself off", async () => {
    const lease = await turnOn();
    expect((await as(lease, "/api/staff/catalogue/offline", "DELETE")).status).toBe(200);
    expect(await ended(lease)).toBe(true);
  });

  it("signing out on the device ends both, and clears both cookies", async () => {
    const lease = await turnOn();
    const response = await as(both(session, lease), "/api/staff/logout", "POST");
    expect(response.headers.getSetCookie().map((value) => value.split("=")[0])).toEqual(["lh_staff_session", "lh_catalogue_lease"]);
    expect(await ended(lease)).toBe(true);
    expect((await as(session, "/api/staff/session")).status).toBe(401);
  });

  it("signing out everywhere ends it", async () => {
    const lease = await turnOn();
    await as(session, "/api/staff/me/sessions/revoke", "POST");
    expect(await ended(lease)).toBe(true);
  });

  it("a password change ends it", async () => {
    const lease = await turnOn();
    expect((await as(session, "/api/staff/me/password", "POST", { currentPassword: "correct horse battery", newPassword: "another long passphrase" })).status).toBe(200);
    expect(await ended(lease)).toBe(true);
  });

  it("a reset by an administrator ends it", async () => {
    sqlite.prepare("UPDATE staff_accounts SET role = 'OWNER' WHERE id = 'ACC-2'").run();
    const owner = await signIn("staff.two");
    const lease = await turnOn();
    expect((await as(owner, "/api/staff/admin/accounts/ACC-1/password", "POST", { generate: true })).status).toBe(200);
    expect(await ended(lease)).toBe(true);
  });

  it("deactivation ends it", async () => {
    const lease = await turnOn();
    expect(await ended(lease)).toBe(false);
    sqlite.prepare("UPDATE staff_accounts SET active = 0 WHERE id = 'ACC-1'").run();
    // The row is still there, but no lease of an inactive account is honoured.
    expect(leaseRows()[0]!.revokedAt).toBeNull();
    expect(await ended(lease)).toBe(true);
  });
});

describe("the catalog snapshot", () => {
  it("carries what cataloguing needs and nothing about people, notes or history, revisioned", async () => {
    const shelf = await place("Shelf 2");
    const { id } = (await (await as(session, "/api/staff/catalogue/sessions", "POST", { locationId: shelf })).json()) as { id: string };
    await as(session, `/api/staff/catalogue/sessions/${id}/captures`, "POST", shot(shelf, { name: "Gaffer tape", notes: "Private note", model: "GT-2", serialNumber: "SN-9" }));
    const response = await as(session, "/api/staff/catalogue/snapshot");
    const body = (await response.json()) as { revision: number; items: Array<Record<string, unknown>>; categories: string[]; units: string[]; places: Array<Record<string, unknown>> };
    const tape = body.items.find((item) => item.name === "Gaffer tape")!;
    expect(Object.keys(tape).sort()).toEqual(["aliases", "category", "consumptionMode", "id", "itemType", "locationId", "model", "name", "onHand", "photoHash", "serialNumber", "status", "stockArea", "unit"]);
    expect(tape).toMatchObject({ model: "GT-2", serialNumber: "SN-9", onHand: 3, locationId: shelf });
    expect(JSON.stringify(body)).not.toContain("Private note");
    expect(body.places).toEqual([{ id: shelf, name: "Shelf 2", parentId: null, active: true, directions: null }]);
    expect(body.categories).toContain("SUPPLIES");
    const etag = response.headers.get("etag")!;
    expect((await call("/api/staff/catalogue/snapshot", { headers: { cookie: session, "if-none-match": etag } })).status).toBe(304);
  });
});

describe("sessions and captures from a device that was offline", () => {
  it("starts the session under the id the device proposed, once, however often the start is sent", async () => {
    const shelf = await place("Shelf 2");
    const proposed = sessionId();
    const first = await as(session, "/api/staff/catalogue/sessions", "POST", { id: proposed, locationId: shelf });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ id: proposed, resumed: false });
    expect(await (await as(session, "/api/staff/catalogue/sessions", "POST", { id: proposed, locationId: shelf })).json()).toEqual({ id: proposed, resumed: true });
    expect((await as(session, "/api/staff/catalogue/sessions", "POST", { id: "CS-nope", locationId: shelf })).status).toBe(400);
  });

  it("answers with the session already open, and never takes someone else's id", async () => {
    const shelf = await place("Shelf 2");
    const open = ((await (await as(session, "/api/staff/catalogue/sessions", "POST", { locationId: shelf })).json()) as { id: string }).id;
    expect(await (await as(session, "/api/staff/catalogue/sessions", "POST", { id: sessionId(), locationId: shelf })).json()).toEqual({ id: open, resumed: true });
    expect((await as(other, "/api/staff/catalogue/sessions", "POST", { id: open, locationId: shelf })).status).toBe(409);
  });

  it("starts a new session when the proposed one was finished meanwhile", async () => {
    const shelf = await place("Shelf 2");
    const proposed = sessionId();
    await as(session, "/api/staff/catalogue/sessions", "POST", { id: proposed, locationId: shelf });
    await as(session, `/api/staff/catalogue/sessions/${proposed}/finish`, "POST");
    const again = (await (await as(session, "/api/staff/catalogue/sessions", "POST", { id: proposed, locationId: shelf })).json()) as { id: string; resumed: boolean };
    expect(again.resumed).toBe(false);
    expect(again.id).not.toBe(proposed);
  });

  it("saves a capture re-sent to the person's newer session once, and refuses it in someone else's", async () => {
    const shelf = await place("Shelf 2");
    const first = ((await (await as(session, "/api/staff/catalogue/sessions", "POST", { locationId: shelf })).json()) as { id: string }).id;
    const capture = shot(shelf);
    const saved = (await (await as(session, `/api/staff/catalogue/sessions/${first}/captures`, "POST", capture)).json()) as { id: string };
    await as(session, `/api/staff/catalogue/sessions/${first}/finish`, "POST");
    const second = ((await (await as(session, "/api/staff/catalogue/sessions", "POST", { locationId: shelf })).json()) as { id: string }).id;
    const resent = await as(session, `/api/staff/catalogue/sessions/${second}/captures`, "POST", capture);
    expect(resent.status).toBe(200);
    expect(await resent.json()).toEqual({ id: saved.id, captureId: capture.id, replayed: true });
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM items WHERE name = ?").get(capture.name) as { n: number }).n).toBe(1);
    const theirs = ((await (await as(other, "/api/staff/catalogue/sessions", "POST", { locationId: shelf })).json()) as { id: string }).id;
    expect((await as(other, `/api/staff/catalogue/sessions/${theirs}/captures`, "POST", capture)).status).toBe(409);
  });
});

describe("the Catalogue page", () => {
  it("opens without a session (the page decides, on a lease or offline); every other staff page still needs one", async () => {
    expect((await call("/staff/catalogue")).status).toBe(200);
    expect((await call("/staff/items")).status).toBe(302);
  });
});
