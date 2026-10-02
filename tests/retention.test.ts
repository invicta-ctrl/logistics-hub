import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

const origin = "https://hub.example.test";
const PASSWORD = "correct horse battery";
const DAY = 24 * 60 * 60_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let photos: ReturnType<typeof memoryR2>["objects"];
let cookies: Record<"owner" | "admin" | "staff", string>;
let sequence = 0;

const call = (who: keyof typeof cookies, path: string, method = "GET") =>
  worker.fetch(new Request(`${origin}${path}`, { method, headers: { origin, cookie: cookies[who], "content-type": "application/json" } }), env);

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  const r2 = memoryR2();
  photos = r2.objects;
  env = { DB: database.d1, EVIDENCE: r2.bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  cookies = { owner: "", admin: "", staff: "" };
  for (const [who, role] of [["owner", "OWNER"], ["admin", "ADMIN"], ["staff", "STAFF"]] as const) {
    sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(?, ?, ?, ?, ?)").run(`ACC-${who}`, who, `${who[0]!.toUpperCase()}${who.slice(1)}`, await hashPassword(PASSWORD), role);
    const login = await worker.fetch(new Request(`${origin}/api/staff/login`, { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": who }, body: JSON.stringify({ username: who, password: PASSWORD }) }), env);
    cookies[who] = login.headers.get("set-cookie")!.split(";")[0]!;
  }
});

/** A loan of one ITM-0001 piece; its photo is stored in R2 unless said otherwise. */
function loan(id: string, fields: { status?: "OUT" | "RETURNED" | "DAMAGED" | "LOST"; closedDaysAgo?: number; purpose?: "INDIVIDUAL" | "USC"; studentId?: string | null; name?: string; photo?: boolean } = {}) {
  const { status = "RETURNED", closedDaysAgo = 800, purpose = "INDIVIDUAL", studentId = purpose === "USC" ? null : `20-${String(++sequence).padStart(4, "0")}-001`, name = `Borrower ${id}`, photo = true } = fields;
  const movement = `MOV-${id}`;
  sqlite.prepare("INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status) VALUES(?, ?, 'OPENING_BALANCE', 'IN', 'ITM-0001', 1, 'piece', 1, 'POSTED')").run(movement, ago(900));
  const key = photo ? `loans/${id}` : "";
  if (photo) photos.set(key, { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
  sqlite.prepare(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, reason, photo_key, status, movement_id, return_note, created_at, created_by, closed_at, closed_by)
    VALUES(?, 'ITM-0001', 1, ?, ?, ?, ?, ?, ?, ?, 'Cracked screen', ?, 'ACC-staff', ?, ?)`)
    .run(id, purpose, name, studentId, purpose === "USC" ? "Booth setup" : null, key, status, movement, ago(status === "OUT" ? 900 : closedDaysAgo + 3), status === "OUT" ? null : ago(closedDaysAgo), status === "OUT" ? null : "ACC-staff");
  return id;
}

/** A phone record. `resolved` makes it a staff-decided held record; `held` leaves it waiting. */
function phone(id: string, fields: { receivedDaysAgo?: number; held?: boolean; resolved?: boolean; loanId?: string; photo?: boolean; name?: string } = {}) {
  const { receivedDaysAgo = 400, held = false, resolved = false, loanId = null, photo = false, name = `Person ${id}` } = fields;
  const key = photo ? `held/${id}` : null;
  if (key) photos.set(key, { bytes: new Uint8Array([9]), contentType: "image/jpeg" });
  const at = ago(receivedDaysAgo);
  sqlite.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, reason, note, photo_key, device_time, sent_at, occurred_at, received_at, loan_id, applied, review, resolved_at, resolved_by)
    VALUES(?, 'dev', ?, 'TAKE', 'ITM-0001', 2, ?, '20-9999-999', 'Used for the booth', 'typed note', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ++sequence, name, key, at, at, at, at, loanId, held && !resolved ? 0 : resolved ? 0 : 1, held || resolved ? "VOLUME" : null, resolved ? at : null, resolved ? "ACC-staff" : null);
  return id;
}

const row = (table: string, id: string) => sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown>;
const onHand = () => sqlite.prepare("SELECT on_hand FROM inventory_balances WHERE id = 'ITM-0001'").get();
const run = async (who: keyof typeof cookies = "owner") => (await call(who, "/api/staff/admin/retention", "POST")).json() as Promise<{ loans: number; phoneRecords: number; photos: number; more: boolean }>;

describe("retention: erasing who a settled record was", () => {
  it("is for the owner only, and a dry run changes nothing", async () => {
    loan("LN-A");
    for (const who of ["admin", "staff"] as const) {
      expect((await call(who, "/api/staff/admin/retention")).status).toBe(403);
      expect((await call(who, "/api/staff/admin/retention", "POST")).status).toBe(403);
    }
    expect((await call("owner", "/api/staff/admin/retention", "PUT")).status).toBe(405);
    expect(await (await call("owner", "/api/staff/admin/retention")).json()).toEqual({ loans: 1, phoneRecords: 0, photos: 1 });
    expect(row("loans", "LN-A")).toMatchObject({ borrower_name: "Borrower LN-A", photo_key: "loans/LN-A" });
    expect(photos.has("loans/LN-A")).toBe(true);
  });

  it("erases only what is old and settled, keeps the record and the stock, and deletes the photos", async () => {
    loan("LN-OLD");
    loan("LN-USC", { purpose: "USC", closedDaysAgo: 731, status: "DAMAGED" });
    loan("LN-NEW", { closedDaysAgo: 100 });
    loan("LN-OUT", { status: "OUT" });
    phone("E-TAKE", { receivedDaysAgo: 400 });
    phone("E-DISMISSED", { receivedDaysAgo: 500, resolved: true, photo: true });
    phone("E-HELD", { receivedDaysAgo: 500, held: true, photo: true });
    phone("E-OUTLOAN", { receivedDaysAgo: 500, loanId: "LN-OUT" });
    phone("E-RECENT", { receivedDaysAgo: 100 });
    const stock = { onHand: onHand(), movements: sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements").get(), loans: sqlite.prepare("SELECT COUNT(*) AS n FROM loans").get() };
    const kept = { loan: row("loans", "LN-OLD"), event: row("self_service_events", "E-DISMISSED") };

    expect(await (await call("owner", "/api/staff/admin/retention")).json()).toEqual({ loans: 2, phoneRecords: 2, photos: 3 });
    expect(await run()).toEqual({ loans: 2, phoneRecords: 2, photos: 3, more: false });

    for (const id of ["LN-OLD", "LN-USC"]) expect(row("loans", id)).toMatchObject({ borrower_name: "[removed]", photo_key: "", return_note: "Cracked screen" });
    expect(row("loans", "LN-OLD").student_id).toBe("[removed]");
    expect(row("loans", "LN-USC").student_id).toBeNull();
    expect(row("loans", "LN-USC").reason).toBe("Booth setup");
    for (const id of ["E-TAKE", "E-DISMISSED"]) expect(row("self_service_events", id)).toMatchObject({ person_name: "[removed]", student_id: null, photo_key: null, reason: "Used for the booth", note: "typed note", quantity: 2 });
    // Only the identity changed: every other column of an erased record is as before.
    const same = (before: Record<string, unknown>, after: Record<string, unknown>, except: string[]) => Object.keys(before).filter((key) => !except.includes(key)).every((key) => before[key] === after[key]);
    expect(same(kept.loan, row("loans", "LN-OLD"), ["borrower_name", "student_id", "photo_key"])).toBe(true);
    expect(same(kept.event, row("self_service_events", "E-DISMISSED"), ["person_name", "student_id", "photo_key"])).toBe(true);
    // Not due: too recent, still out, waiting for staff, or tied to a loan still out.
    expect(row("loans", "LN-NEW")).toMatchObject({ borrower_name: "Borrower LN-NEW", photo_key: "loans/LN-NEW" });
    expect(row("loans", "LN-OUT")).toMatchObject({ borrower_name: "Borrower LN-OUT", photo_key: "loans/LN-OUT" });
    for (const id of ["E-HELD", "E-OUTLOAN", "E-RECENT"]) expect(row("self_service_events", id).person_name).toBe(`Person ${id}`);
    expect([...photos.keys()].sort()).toEqual(["held/E-HELD", "loans/LN-NEW", "loans/LN-OUT"]);
    // Stock, movements and loans are untouched; a second run finds nothing and writes nothing more.
    expect({ onHand: onHand(), movements: sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements").get(), loans: sqlite.prepare("SELECT COUNT(*) AS n FROM loans").get() }).toEqual(stock);
    expect(await run()).toEqual({ loans: 0, phoneRecords: 0, photos: 0, more: false });
    expect(sqlite.prepare("SELECT details_json AS details FROM audit_log WHERE action = 'RETENTION_ERASED'").all().map((entry) => JSON.parse(String(entry.details)))).toEqual([{ loans: 2, phoneRecords: 2, photos: 3 }]);
    // It reads as a sentence in Activity for the owner and administrators, and not at all for staff.
    const sentence = async (who: keyof typeof cookies) => (await (await call(who, "/api/staff/activity?type=RETENTION_ERASED")).json() as { events: Array<{ summary: string }> }).events.map((event) => event.summary);
    expect(await sentence("owner")).toEqual(["Owner removed names, student IDs and photos from 2 old loans and 2 old phone records."]);
    expect(await sentence("staff")).toEqual([]);
  });

  it("works through a backlog in bounded requests", async () => {
    for (let n = 0; n < 120; n += 1) loan(`LN-${n}`, { photo: false });
    expect(await run()).toMatchObject({ loans: 50, more: true });
    expect(await run()).toMatchObject({ loans: 50, more: true });
    expect(await run()).toMatchObject({ loans: 20, more: false });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM loans WHERE borrower_name = '[removed]'").get()).toEqual({ n: 120 });
  });

  it("leaves erased loans out of borrower statistics and suggestions, and has no photo to show for them", async () => {
    loan("LN-ERASED-1");
    loan("LN-ERASED-2");
    loan("LN-KEPT", { closedDaysAgo: 100, name: "Maria Santos", studentId: "20-1111-111" });
    await run();
    const overview = await (await call("staff", "/api/staff/loans")).json() as { closed: Array<{ id: string; borrowerName: string; hasPhoto: number }>; known: Array<{ name: string }>; borrowers: Array<{ name: string }>; totals: Array<{ period: string; loans: number; borrowers: number }> };
    expect(overview.known.map((entry) => entry.name)).toEqual(["Maria Santos"]);
    // The ranking lists a borrower once per period; erased loans are not in it at all.
    expect([...new Set(overview.borrowers.map((entry) => entry.name))]).toEqual(["Maria Santos"]);
    expect(overview.totals.find((total) => total.period === "all")).toMatchObject({ loans: 3, borrowers: 1 });
    expect(overview.closed.map((entry) => [entry.id, entry.borrowerName, entry.hasPhoto]).sort()).toEqual([["LN-ERASED-1", "[removed]", 0], ["LN-ERASED-2", "[removed]", 0], ["LN-KEPT", "Maria Santos", 1]]);
    expect((await call("staff", "/api/staff/loans/LN-ERASED-1/photo")).status).toBe(404);
    expect((await call("staff", "/api/staff/loans/LN-KEPT/photo")).status).toBe(200);
  });
});
