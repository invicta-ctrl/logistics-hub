import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { PROBE_LIMIT_MS } from "../src/system-status";
import { memoryR2, migratedD1 } from "./d1-sqlite";

const origin = "https://hub.example.test";
const PASSWORD = "correct horse battery";
const VERSION = "0123456789ab";
const COMMIT = "a".repeat(40);
const PRODUCT = { version: "V1.15", sourceCommit: "b".repeat(40), changes: ["Items open directly for entry.", "Selected photos fit item screens."] };
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let buildRecord: unknown;

function migrationFiles(): string[] {
  return fs.readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
}

async function seed(id: string, username: string, role: string) {
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(?, ?, ?, ?, ?)").run(id, username, username, await hashPassword(PASSWORD), role);
}

/** What wrangler keeps: one row per applied migration. The test database applies the files directly, so it has none of its own. */
function recordMigrations(names: string[]) {
  sqlite.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  names.forEach((name, index) => sqlite.prepare("INSERT INTO d1_migrations(name, applied_at) VALUES(?, ?)").run(name, `2026-10-0${1 + (index % 7)} 09:30:00`));
}

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  buildRecord = { version: VERSION, commit: COMMIT, builtAt: "2026-10-07T08:00:00.000Z", migrations: migrationFiles(), product: PRODUCT };
  env = {
    DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket,
    ASSETS: { fetch: async (request: Request) => new URL(request.url).pathname === "/build.json" && buildRecord !== undefined ? Response.json(buildRecord) : new Response("<html></html>") } as unknown as Fetcher,
    SESSION_SECRET: "test-secret"
  };
  await seed("ACC-owner", "owner", "OWNER");
  await seed("ACC-admin", "admin", "ADMIN");
  await seed("ACC-staff", "staff", "STAFF");
});

afterEach(() => { vi.restoreAllMocks(); });

function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", origin);
  headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  return worker.fetch(new Request(`${origin}${path}`, { ...init, headers }), env);
}

async function cookieOf(username: string) {
  const response = await call("/api/staff/login", { method: "POST", body: JSON.stringify({ username, password: PASSWORD }), headers: { "cf-connecting-ip": `ip-${username}` } });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

const as = (cookie: string, path: string, method = "GET", body?: unknown) => call(path, { method, cookie, body: body === undefined ? undefined : JSON.stringify(body) });

type Status = {
  build: { version: string; commit: string | null; builtAt: string; migrations: string[]; product: { version: string; sourceCommit: string; changes: string[] } | null } | null;
  database: { ok: boolean; migrations: { applied: number; latest: string | null; latestAppliedAt: string | null; pending: string[] | null } | null };
  storage: Array<{ id: string; ok: boolean }>;
  selfService: string | null;
};

describe("Administration > System", () => {
  it("is for administrators and owners only, and the build's record is not public", async () => {
    const staff = await cookieOf("staff");
    for (const path of ["/api/staff/admin/system", "/api/staff/admin/catalog", "/api/staff/admin/catalog/aliases"]) expect((await as(staff, path)).status, path).toBe(403);
    expect((await as(staff, "/api/staff/admin/catalog/aliases/ITM-0001", "PATCH", { aliases: "x", updatedAt: null })).status).toBe(403);
    expect((await call("/api/staff/admin/system")).status).toBe(401);
    expect((await call("/build.json")).status).toBe(404);
    expect((await as(await cookieOf("admin"), "/api/staff/admin/system")).status).toBe(200);
  });

  it("reports the build, the migration level and every check as read, and says nothing is pending when the database is current", async () => {
    const files = migrationFiles();
    recordMigrations(files);
    const response = await as(await cookieOf("admin"), "/api/staff/admin/system");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const status = await response.json() as Status;
    expect(status.build).toEqual({ version: VERSION, commit: COMMIT, builtAt: "2026-10-07T08:00:00.000Z", migrations: files, product: PRODUCT });
    expect(status.database.ok).toBe(true);
    expect(status.database.migrations).toMatchObject({ applied: files.length, latest: files.at(-1), pending: [] });
    expect(status.database.migrations!.latestAppliedAt).toMatch(/^2026-10-0\dT09:30:00Z$/);
    expect(status.storage.map((bucket) => [bucket.id, bucket.ok])).toEqual([["EVIDENCE", true], ["CATALOG_MEDIA", true], ["STAFF_IDS", true]]);
    expect(status.selfService).toBe("paused");
  });

  it("names the migrations this version carries that the database has not applied", async () => {
    const files = migrationFiles();
    recordMigrations(files.slice(0, -2));
    const status = await (await as(await cookieOf("owner"), "/api/staff/admin/system")).json() as Status;
    expect(status.database.migrations!.pending).toEqual(files.slice(-2));
    expect(status.database.migrations!.latest).toBe(files.at(-3));
  });

  it("never invents a version: a build without a usable record is reported as unknown, and so is a missing commit", async () => {
    recordMigrations(migrationFiles());
    const admin = await cookieOf("admin");
    buildRecord = undefined;
    const unknown = await (await as(admin, "/api/staff/admin/system")).json() as Status;
    expect(unknown.build).toBeNull();
    expect(unknown.database.migrations!.pending).toBeNull();
    buildRecord = { version: "not-a-version", commit: COMMIT, builtAt: "2026-10-07T08:00:00.000Z", migrations: [] };
    expect((await (await as(admin, "/api/staff/admin/system")).json() as Status).build).toBeNull();
    buildRecord = { version: VERSION, commit: "HEAD", builtAt: "2026-10-07T08:00:00.000Z", migrations: [], product: PRODUCT };
    expect((await (await as(admin, "/api/staff/admin/system")).json() as Status).build).toMatchObject({ version: VERSION, commit: null, product: null });
  });

  it("keeps known build facts when release metadata is missing or malformed", async () => {
    recordMigrations(migrationFiles());
    const admin = await cookieOf("admin");
    const known = { version: VERSION, commit: COMMIT, builtAt: "2026-10-07T08:00:00.000Z", migrations: migrationFiles() };
    for (const product of [undefined, null, { ...PRODUCT, version: "V1.016" }, { ...PRODUCT, version: "V1.16.0" }, { ...PRODUCT, version: "V1.16.1.2" }, { ...PRODUCT, sourceCommit: "HEAD" }, { ...PRODUCT, changes: ["<script>not plain notes</script>", "Other note"] }, { ...PRODUCT, changes: ["Only one note"] }, { ...PRODUCT, changes: Array(6).fill("Too many notes") }]) {
      buildRecord = { ...known, product };
      const status = await (await as(admin, "/api/staff/admin/system")).json() as Status;
      expect(status.build).toMatchObject({ version: VERSION, commit: COMMIT, product: null });
      expect(status.database.migrations!.pending).toEqual([]);
    }
  });

  it("reports the current artifact on refresh and restores the original identity on rollback", async () => {
    recordMigrations(migrationFiles());
    const admin = await cookieOf("admin");
    const original = structuredClone(buildRecord);
    const read = async () => ((await (await as(admin, "/api/staff/admin/system")).json()) as Status).build;
    expect((await read())!.product).toEqual(PRODUCT);
    buildRecord = { ...(original as object), commit: "c".repeat(40), product: { ...PRODUCT, version: "V1.15.1", sourceCommit: "d".repeat(40), changes: ["A separately verified correction.", "Its accompanying verified improvement."] } };
    expect(await read()).toMatchObject({ commit: "c".repeat(40), product: { version: "V1.15.1" } });
    buildRecord = original;
    expect(await read()).toMatchObject({ commit: COMMIT, product: PRODUCT });
  });

  it.runIf(fs.existsSync("dist/build.json"))("the normal build carries the governed release source without exposing a second metadata asset", () => {
    const release = JSON.parse(fs.readFileSync("product-release.json", "utf8")) as { version: string; sourceCommit: string; record: string; changes: string[] };
    const artifact = JSON.parse(fs.readFileSync("dist/build.json", "utf8")) as { product: unknown };
    expect(artifact.product).toEqual(release);
    expect(release.version).toBe("V1.15");
    expect(fs.readFileSync(release.record, "utf8")).toContain(release.sourceCommit);
    expect(fs.existsSync("dist/product-release.json")).toBe(false);
  });

  it("reports an unreadable migration table as unknown, not as a failed database", async () => {
    const status = await (await as(await cookieOf("admin"), "/api/staff/admin/system")).json() as Status;
    expect(status.database.ok).toBe(true);
    expect(status.database.migrations).toBeNull();
  });

  it("a failing bucket is reported as not answering, with none of its error text, and the page still answers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    env.CATALOG_MEDIA = { get: async () => { throw new Error("secret-account-id-1234 exploded"); } } as unknown as R2Bucket;
    const response = await as(await cookieOf("admin"), "/api/staff/admin/system");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("secret-account-id");
    const status = JSON.parse(text) as Status;
    expect(status.storage.map((bucket) => [bucket.id, bucket.ok])).toEqual([["EVIDENCE", true], ["CATALOG_MEDIA", false], ["STAFF_IDS", true]]);
  });

  it("a check that never answers is cut off at the limit instead of holding the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = await cookieOf("admin");
    env.STAFF_IDS = { get: () => new Promise(() => undefined) } as unknown as R2Bucket;
    const started = Date.now();
    const status = await (await as(admin, "/api/staff/admin/system")).json() as Status;
    expect(Date.now() - started).toBeLessThan(PROBE_LIMIT_MS + 1_500);
    expect(status.storage.find((bucket) => bucket.id === "STAFF_IDS")!.ok).toBe(false);
    expect(status.storage.find((bucket) => bucket.id === "EVIDENCE")!.ok).toBe(true);
  }, 10_000);

  it("reads Self-Service's state from the setting", async () => {
    const owner = await cookieOf("owner");
    await as(owner, "/api/staff/admin/self-service", "PATCH", { state: "open" });
    expect((await (await as(owner, "/api/staff/admin/system")).json() as Status).selfService).toBe("open");
  });
});

describe("Administration > Catalog", () => {
  const base = { category: "SCHOOL SUPPLIES", itemType: "Consumable", unit: "piece", status: "ACTIVE", locationId: null, reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: null, openingQuantity: 1 };
  async function add(cookie: string, fields: Record<string, unknown>) {
    const response = await as(cookie, "/api/staff/items", "POST", { ...base, ...fields });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    return (await response.json() as { id: string }).id;
  }
  const version = (id: string) => sqlite.prepare("SELECT updated_at AS at FROM items WHERE id = ?").get(id) as { at: string | null };

  it("counts what is classified from the same definition as Attention", async () => {
    const admin = await cookieOf("admin");
    await add(admin, { name: "Stapler", itemType: "Loanable" });
    const before = await (await as(admin, "/api/staff/admin/catalog")).json() as { active: number; unclassified: number };
    const unclassified = { itemType: "NEEDS_REVIEW", needsReview: true, lendingAudience: "NOT_AVAILABLE_FOR_LENDING" };
    await add(admin, { name: "Stapler Test Unit", itemType: "Loanable" });
    await add(admin, { name: "Mystery Box", ...unclassified });
    await add(admin, { name: "Retired Thing", ...unclassified, status: "INACTIVE" });
    const after = await (await as(admin, "/api/staff/admin/catalog")).json() as Record<string, number>;
    // An inactive item counts nowhere, as in Attention's "Items to classify".
    expect(after).toMatchObject({ active: before.active + 2, unclassified: before.unclassified + 1, captured: 0, capturedClassified: 0 });
  });

  it("lists items with other names, finds any item by name, other name or ID, and bounds the answer", async () => {
    const admin = await cookieOf("admin");
    const glue = await add(admin, { name: "Glue Stick Zed", aliases: "zedpaste, pritt zed" });
    await add(admin, { name: "Quokka Marker" });
    const withNames = await (await as(admin, "/api/staff/admin/catalog/aliases")).json() as { items: Array<{ id: string; aliases: string }>; more: boolean };
    expect(withNames.items.map((item) => item.id)).toContain(glue);
    expect(withNames.items.every((item) => item.aliases)).toBe(true);
    const byAlias = await (await as(admin, "/api/staff/admin/catalog/aliases?q=pritt zed")).json() as { items: Array<{ id: string }> };
    expect(byAlias.items.map((item) => item.id)).toEqual([glue]);
    const byName = await (await as(admin, "/api/staff/admin/catalog/aliases?q=quokka")).json() as { items: Array<{ name: string }> };
    expect(byName.items.map((item) => item.name)).toEqual(["Quokka Marker"]);
    expect(((await (await as(admin, `/api/staff/admin/catalog/aliases?q=${encodeURIComponent("%")}`)).json()) as { items: unknown[] }).items).toEqual([]);
    for (let n = 0; n < 52; n += 1) await add(admin, { name: `Zzpad ${String(n).padStart(2, "0")}` });
    const page = await (await as(admin, "/api/staff/admin/catalog/aliases?q=zzpad")).json() as { items: unknown[]; more: boolean };
    expect(page.items).toHaveLength(50);
    expect(page.more).toBe(true);
  });

  it("saves other names as the edit form would, records the change, and refuses a stale edit", async () => {
    const admin = await cookieOf("admin");
    const id = await add(admin, { name: "Glue Stick", aliases: "paste" });
    const revision = () => (sqlite.prepare("SELECT value FROM catalog_revision WHERE id = 1").get() as { value: number }).value;
    const before = revision();
    const loaded = version(id).at;
    const saved = await (await as(admin, `/api/staff/admin/catalog/aliases/${id}`, "PATCH", { aliases: "Paste,  pritt ; glue stick, PASTE", updatedAt: loaded })).json() as { changed: number; aliases: string; updatedAt: string };
    expect(saved).toMatchObject({ changed: 1, aliases: "Paste, pritt" });
    expect(revision()).toBe(before + 1);
    const entry = sqlite.prepare("SELECT action, entity_id AS id, details_json AS details FROM audit_log WHERE action = 'ITEM_UPDATED' AND entity_id = ? ORDER BY rowid DESC").get(id) as { action: string; id: string; details: string };
    expect(JSON.parse(entry.details)).toEqual({ aliases: { from: "paste", to: "Paste, pritt" } });
    // The same answer again changes nothing and writes nothing.
    const again = await (await as(admin, `/api/staff/admin/catalog/aliases/${id}`, "PATCH", { aliases: "Paste, pritt", updatedAt: saved.updatedAt })).json() as { changed: number };
    expect(again.changed).toBe(0);
    expect(revision()).toBe(before + 1);
    // Someone changed it since this editor loaded it.
    const stale = await as(admin, `/api/staff/admin/catalog/aliases/${id}`, "PATCH", { aliases: "x", updatedAt: loaded });
    expect(stale.status).toBe(409);
    expect((sqlite.prepare("SELECT aliases FROM items WHERE id = ?").get(id) as { aliases: string }).aliases).toBe("Paste, pritt");
    // Clearing them is allowed; a name that is too long, or an unknown item, is refused.
    const cleared = await (await as(admin, `/api/staff/admin/catalog/aliases/${id}`, "PATCH", { aliases: "", updatedAt: saved.updatedAt })).json() as { aliases: string | null };
    expect(cleared.aliases).toBeNull();
    expect((await as(admin, `/api/staff/admin/catalog/aliases/${id}`, "PATCH", { aliases: "x".repeat(61), updatedAt: version(id).at })).status).toBe(400);
    expect((await as(admin, "/api/staff/admin/catalog/aliases/ITM-9999", "PATCH", { aliases: "x", updatedAt: null })).status).toBe(404);
  });
});
