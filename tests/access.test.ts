import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

const origin = "https://hub.example.test";
const PASSWORD = "correct horse battery";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];

async function seed(id: string, username: string, role: string, active = 1) {
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role, active) VALUES(?, ?, ?, ?, ?, ?)").run(id, username, username, await hashPassword(PASSWORD), role, active);
}

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  await seed("ACC-owner", "owner", "OWNER");
  await seed("ACC-admin", "admin", "ADMIN");
  await seed("ACC-staff", "staff", "STAFF");
});

function call(path: string, init: RequestInit & { cookie?: string; ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", headers.get("origin") ?? origin);
  headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.ip) headers.set("cf-connecting-ip", init.ip);
  return worker.fetch(new Request(`${origin}${path}`, { ...init, headers }), env);
}

async function signIn(username: string, password = PASSWORD) {
  const response = await call("/api/staff/login", { method: "POST", body: JSON.stringify({ username, password }), ip: `ip-${username}-${Math.random()}` });
  return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", body: await response.json() as Record<string, unknown> };
}

const as = (cookie: string, path: string, method = "GET", body?: unknown) => call(path, { method, cookie, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
const alive = async (cookie: string) => (await as(cookie, "/api/staff/session")).status === 200;

describe("role enforcement", () => {
  it("keeps STAFF out of administration entirely", async () => {
    const { cookie } = await signIn("staff");
    for (const [path, method] of [["/api/staff/admin/accounts", "GET"], ["/api/staff/admin/accounts", "POST"], ["/api/staff/admin/activity", "GET"], ["/api/staff/admin/self-service", "PATCH"], ["/api/staff/admin/accounts/ACC-admin", "PATCH"], ["/api/staff/admin/accounts/ACC-admin/password", "POST"]]) {
      expect((await as(cookie, path, method, {})).status, `${method} ${path}`).toBe(403);
    }
    expect((await as(cookie, "/api/staff/me/recovery-key", "POST")).status).toBe(403);
  });

  it("lets ADMIN manage STAFF but never OWNER, other admins, or promotion", async () => {
    const { cookie } = await signIn("admin");
    const created = await as(cookie, "/api/staff/admin/accounts", "POST", { username: "newstaff", displayName: "New Staff", role: "STAFF", generate: true });
    expect(created.status).toBe(201);
    expect((await created.json() as { generatedPassword: string }).generatedPassword).toMatch(/^[\w]{5}(-[\w]{5}){3}$/);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-staff", "PATCH", { displayName: "Renamed Staff" })).status).toBe(200);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-staff/password", "POST", { generate: true })).status).toBe(200);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-owner", "PATCH", { displayName: "Hijack" })).status).toBe(403);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-owner/password", "POST", { generate: true })).status).toBe(403);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-owner", "PATCH", { active: false })).status).toBe(403);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-staff", "PATCH", { role: "OWNER" })).status).toBe(403);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-staff", "PATCH", { role: "ADMIN" })).status).toBe(403);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-admin", "PATCH", { role: "OWNER" })).status).toBe(403);
    expect((await as(cookie, "/api/staff/admin/accounts", "POST", { username: "sneaky", displayName: "Sneaky", role: "OWNER", generate: true })).status).toBe(403);
    expect(sqlite.prepare("SELECT role FROM staff_accounts WHERE id = 'ACC-owner'").get()).toEqual({ role: "OWNER" });
  });

  it("lets OWNER manage STAFF and ADMIN, including roles", async () => {
    const { cookie } = await signIn("owner");
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-staff", "PATCH", { role: "ADMIN" })).status).toBe(200);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-admin", "PATCH", { role: "STAFF", displayName: "Former Admin" })).status).toBe(200);
    expect((await as(cookie, "/api/staff/admin/accounts", "POST", { username: "second.owner", displayName: "Second", role: "OWNER", password: "another long password" })).status).toBe(201);
    expect(sqlite.prepare("SELECT username, role FROM staff_accounts ORDER BY username").all()).toEqual([
      { username: "admin", role: "STAFF" }, { username: "owner", role: "OWNER" }, { username: "second.owner", role: "OWNER" }, { username: "staff", role: "ADMIN" }
    ]);
  });

  it("never lets the last active OWNER be disabled or demoted", async () => {
    const { cookie } = await signIn("owner");
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-owner", "PATCH", { active: false })).status).toBe(409);
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-owner", "PATCH", { role: "ADMIN" })).status).toBe(409);
    expect(await alive(cookie)).toBe(true);
    // There is no delete endpoint at all.
    expect((await as(cookie, "/api/staff/admin/accounts/ACC-owner", "DELETE")).status).toBe(405);
  });

  it("blocks sign-in for disabled accounts", async () => {
    const { cookie } = await signIn("owner");
    await as(cookie, "/api/staff/admin/accounts/ACC-staff", "PATCH", { active: false });
    expect((await signIn("staff")).status).toBe(401);
  });

  it("serves the administration page only to ADMIN and OWNER", async () => {
    const staffPage = await as((await signIn("staff")).cookie, "/staff/admin");
    expect(staffPage.status).toBe(302);
    expect(staffPage.headers.get("location")).toBe(`${origin}/staff/inventory`);
    expect((await as((await signIn("admin")).cookie, "/staff/admin")).status).toBe(200);
  });
});

describe("sessions end on security-sensitive changes", () => {
  it("revokes sessions after a password reset, username change, role change or disable", async () => {
    const owner = (await signIn("owner")).cookie;
    for (const change of [
      (id: string) => as(owner, `/api/staff/admin/accounts/${id}/password`, "POST", { password: "a brand new password" }),
      (id: string) => as(owner, `/api/staff/admin/accounts/${id}`, "PATCH", { username: `renamed-${Math.random().toString(36).slice(2, 7)}` }),
      (id: string) => as(owner, `/api/staff/admin/accounts/${id}`, "PATCH", { role: "ADMIN" }),
      (id: string) => as(owner, `/api/staff/admin/accounts/${id}`, "PATCH", { active: false })
    ]) {
      sqlite.exec("DELETE FROM staff_accounts WHERE id = 'ACC-temp'");
      await seed("ACC-temp", `temp${Math.random().toString(36).slice(2, 7)}`, "STAFF");
      const username = (sqlite.prepare("SELECT username FROM staff_accounts WHERE id = 'ACC-temp'").get() as { username: string }).username;
      const victim = (await signIn(username)).cookie;
      expect(await alive(victim)).toBe(true);
      expect((await change("ACC-temp")).status).toBe(200);
      expect(await alive(victim)).toBe(false);
      sqlite.exec("DELETE FROM staff_sessions WHERE account_id = 'ACC-temp'");
    }
  });

  it("makes a reset password work once and forces a new one before anything else", async () => {
    const owner = (await signIn("owner")).cookie;
    const reset = await as(owner, "/api/staff/admin/accounts/ACC-staff/password", "POST", { generate: true });
    const { generatedPassword } = await reset.json() as { generatedPassword: string };
    expect((await signIn("staff")).status).toBe(401);
    const first = await signIn("staff", generatedPassword);
    expect(first.body).toMatchObject({ ok: true, mustChangePassword: true });
    const blocked = await as(first.cookie, "/api/staff/inventory");
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
    expect((await as(first.cookie, "/api/staff/me/password", "POST", { currentPassword: generatedPassword, newPassword: "my own new password" })).status).toBe(200);
    expect((await as(first.cookie, "/api/staff/inventory")).status).toBe(200);
  });
});

describe("my account", () => {
  it("changes my own password, keeps this session and ends the others", async () => {
    const here = (await signIn("staff")).cookie;
    const elsewhere = (await signIn("staff")).cookie;
    expect((await as(here, "/api/staff/me/password", "POST", { currentPassword: "wrong password!!", newPassword: "another password here" })).status).toBe(400);
    expect((await as(here, "/api/staff/me/password", "POST", { currentPassword: PASSWORD, newPassword: "another password here" })).status).toBe(200);
    expect(await alive(here)).toBe(true);
    expect(await alive(elsewhere)).toBe(false);
    expect((await signIn("staff", "another password here")).status).toBe(200);
  });

  it("changes my own username and ends my other sessions", async () => {
    const here = (await signIn("staff")).cookie;
    const elsewhere = (await signIn("staff")).cookie;
    expect((await as(here, "/api/staff/me", "PATCH", { username: "staff.renamed" })).status).toBe(200);
    expect(await alive(here)).toBe(true);
    expect(await alive(elsewhere)).toBe(false);
    expect((await signIn("staff.renamed")).status).toBe(200);
  });
});

describe("owner recovery key", () => {
  async function issueKey() {
    const owner = (await signIn("owner")).cookie;
    const response = await as(owner, "/api/staff/me/recovery-key", "POST");
    return { owner, key: (await response.json() as { recoveryKey: string }).recoveryKey };
  }
  const recover = (recoveryKey: string, newPassword = "recovered password 1", ip = `rip-${Math.random()}`) =>
    call("/api/recovery/owner", { method: "POST", ip, body: JSON.stringify({ recoveryKey, newPassword }) });

  it("resets the owner password, reports the username, revokes owner sessions and is single-use", async () => {
    const { owner, key } = await issueKey();
    const response = await recover(key);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: "owner" });
    expect(await alive(owner)).toBe(false);
    expect((await signIn("owner", "recovered password 1")).status).toBe(200);
    expect((await recover(key, "another recovered one")).status).toBe(401);
  });

  it("rejects invalid, rotated and revoked keys", async () => {
    const { owner, key } = await issueKey();
    expect((await recover(`${key.slice(0, -4)}AAAA`)).status).toBe(401);
    expect((await recover("not-a-key")).status).toBe(401);
    const rotated = await as(owner, "/api/staff/me/recovery-key", "POST");
    const next = (await rotated.json() as { recoveryKey: string }).recoveryKey;
    expect((await recover(key)).status).toBe(401);
    expect((await as(owner, "/api/staff/me/recovery-key", "DELETE")).status).toBe(200);
    expect((await recover(next)).status).toBe(401);
  });

  it("ends for good when its owner loses the owner role", async () => {
    const { key } = await issueKey();
    await seed("ACC-owner2", "owner2", "OWNER");
    const other = (await signIn("owner2")).cookie;
    expect((await as(other, "/api/staff/admin/accounts/ACC-owner", "PATCH", { role: "ADMIN" })).status).toBe(200);
    expect((await as(other, "/api/staff/admin/accounts/ACC-owner", "PATCH", { role: "OWNER" })).status).toBe(200);
    expect((await recover(key)).status).toBe(401);
  });

  it("cannot be used for anything but the owner password reset", async () => {
    const { key } = await issueKey();
    for (const [path, method] of [["/api/staff/admin/accounts", "GET"], ["/api/staff/inventory", "GET"], ["/api/staff/items/ITM-0001/movements", "POST"]]) {
      const response = await call(path, { method, headers: { authorization: `Bearer ${key}`, "x-recovery-key": key }, body: method === "POST" ? JSON.stringify({ recoveryKey: key, kind: "IN", quantity: 1, key: "recovery-abuse-1" }) : undefined });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect((await call("/api/recovery/owner", { method: "GET" })).status).toBe(405);
  });

  it("stores only a verifier and never returns or logs secrets", async () => {
    const log = vi.spyOn(console, "error");
    const { owner, key } = await issueKey();
    const secret = key.split(".")[2]!;
    await recover(key, "recovered password 2");
    const rows = JSON.stringify(sqlite.prepare("SELECT * FROM owner_recovery_keys").all());
    expect(rows).not.toContain(secret);
    const audits = JSON.stringify(sqlite.prepare("SELECT action, details_json FROM audit_log").all());
    for (const secretValue of [secret, "recovered password 2", PASSWORD, "pbkdf2-sha256"]) expect(audits).not.toContain(secretValue);
    expect(audits).toContain("OWNER_RECOVERY_USED");
    expect(audits).toContain("RECOVERY_KEY_ROTATED");
    const listed = JSON.stringify(await (await as((await signIn("owner", "recovered password 2")).cookie, "/api/staff/admin/accounts")).json());
    expect(listed).not.toMatch(/password_hash|pbkdf2|passwordHash/);
    expect(log.mock.calls.flat().join(" ")).not.toContain(secret);
    void owner;
    log.mockRestore();
  });

  it("rate limits recovery attempts per client", async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 7; attempt += 1) statuses.push((await recover("LHR1.AAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "whatever password", "same-ip")).status);
    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe("cross-site and throttling", () => {
  it("rejects cross-site account and recovery mutations", async () => {
    const { cookie } = await signIn("owner");
    const evil = { origin: "https://evil.example" };
    expect((await call("/api/staff/admin/accounts", { method: "POST", cookie, headers: evil, body: JSON.stringify({ username: "x-evil", displayName: "x", role: "OWNER", generate: true }) })).status).toBe(403);
    expect((await call("/api/staff/me/password", { method: "POST", cookie, headers: evil, body: "{}" })).status).toBe(403);
    expect((await call("/api/recovery/owner", { method: "POST", headers: evil, body: "{}" })).status).toBe(403);
  });

  it("keeps login rate limiting effective across requests", async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 7; attempt += 1) statuses.push((await call("/api/staff/login", { method: "POST", ip: "brute", body: JSON.stringify({ username: "owner", password: "wrong password" }) })).status);
    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  const wrong = (username: string, network: string) => call("/api/staff/login", { method: "POST", ip: network, body: JSON.stringify({ username, password: "wrong password" }) });

  it("limits guessing at one account from many networks, for that account only", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) expect((await wrong("Owner", `net-${attempt}`)).status).toBe(401);
    const blocked = await wrong("owner", "net-20");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    // Even the right password waits out the window; other accounts and unknown names are not affected.
    expect((await call("/api/staff/login", { method: "POST", ip: "net-fresh", body: JSON.stringify({ username: "owner", password: PASSWORD }) })).status).toBe(429);
    expect((await signIn("admin")).status).toBe(200);
    expect((await wrong("nobody", "net-other")).status).toBe(401);
  });

  it("starts the account's count over after a successful sign-in", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) await wrong("owner", `net-a${attempt}`);
    expect((await signIn("owner")).status).toBe(200);
    for (let attempt = 0; attempt < 20; attempt += 1) expect((await wrong("owner", `net-b${attempt}`)).status).toBe(401);
    expect((await wrong("owner", "net-b20")).status).toBe(429);
  });

  it("sweeps session rows a month past expiry and spent counters at sign-in, and nothing else", async () => {
    const day = 24 * 60 * 60_000;
    const now = Date.now();
    const session = sqlite.prepare("INSERT INTO staff_sessions(id, expires_at, account_id) VALUES(?, ?, 'ACC-staff')");
    session.run("old", now - 31 * day);
    session.run("recently-expired", now - 2 * day);
    session.run("live", now + day);
    sqlite.prepare("INSERT INTO auth_throttle(key, count, reset_at) VALUES('spent', 1, ?), ('running', 1, ?)").run(now - 2 * 60 * 60_000, now + 60_000);
    await signIn("owner");
    expect(sqlite.prepare("SELECT id FROM staff_sessions WHERE id IN ('old', 'recently-expired', 'live') ORDER BY id").all()).toEqual([{ id: "live" }, { id: "recently-expired" }]);
    expect(sqlite.prepare("SELECT key FROM auth_throttle WHERE key IN ('spent', 'running')").all()).toEqual([{ key: "running" }]);
  });

  it("records account changes in the audit log with safe metadata only", async () => {
    const { cookie } = await signIn("owner");
    await as(cookie, "/api/staff/admin/accounts", "POST", { username: "audited", displayName: "Audited", role: "STAFF", password: "a very secret pass 1" });
    const events = await (await as(cookie, "/api/staff/admin/activity")).json() as { events: Array<{ action: string; details: object }> };
    expect(events.events[0]).toMatchObject({ action: "ACCOUNT_CREATED", details: { username: "audited", role: "STAFF" } });
    expect(JSON.stringify(events)).not.toContain("a very secret pass 1");
  });
});
