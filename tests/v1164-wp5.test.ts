import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/worker";
import { STUDENT_ID_MESSAGES, USC_ONLY_MESSAGE } from "../src/catalog-policy";
import { officeDay } from "../src/loans";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/*
 * V1.16.4 WP5 (§4.5, §4.6, D1–D3, R5) at the Worker: one loan policy for the desk and the phone. Both purposes need an 8-digit
 * Student ID, checked exactly as sent; a USC-only item is never lent for Individual use; a quantity is a whole number as typed,
 * never read through Number(); a retried Lend answers with the loan it made. A refusal writes nothing: no loan, movement, audit
 * row or photo. The Directory takes a new or changed ID only in 8 digits and keeps a stored older one until someone changes it.
 */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let evidence: ReturnType<typeof memoryR2>;
const cookies: Record<string, string> = {};
let shelf: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (role: string, path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie: cookies[role]!, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, any>>(response: Response | Promise<Response>) => (await (await response).json()) as T;

async function seed(id: string, username: string, role: string) {
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(?, ?, ?, ?, ?)").run(id, username, `${username} name`, await hashPassword("correct horse battery"), role);
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${id}` }, body: JSON.stringify({ username, password: "correct horse battery" }) });
  cookies[role] = response.headers.get("set-cookie")!.split(";")[0]!;
}

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  evidence = memoryR2();
  env = { DB: database.d1, EVIDENCE: evidence.bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" } as unknown as Env;
  await seed("ACC-1", "staff.one", "STAFF");
  await seed("ACC-admin", "admin.one", "ADMIN");
  shelf = (await json<{ id: string }>(as("STAFF", "/api/staff/locations", "POST", { name: "WP5 shelf", parentId: null }))).id;
});
afterEach(() => { vi.restoreAllMocks(); });

async function loanable(name: string, quantity: number, lendingAudience = "STUDENTS_AND_USC_STAFF"): Promise<string> {
  const response = await as("STAFF", "/api/staff/items", "POST", { category: "SUPPLIES", itemType: "Loanable", unit: "piece", status: "ACTIVE", reorderThreshold: 0, lendingAudience, needsReview: false, notes: null, name: `WP5 ${name}`, openingQuantity: quantity, locationId: shelf });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await json<{ id: string }>(response)).id;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
function lend(itemId: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  const base = { purpose: "INDIVIDUAL", quantity: "1", key: crypto.randomUUID(), studentId: "20231234", borrowerName: "Ana Cruz", returnBy: officeDay(new Date(Date.now() + 86_400_000)) };
  for (const [name, value] of Object.entries({ ...base, ...fields })) form.set(name, value);
  form.set("photo", new File([JPEG as BlobPart], "borrower.jpg", { type: "image/jpeg" }));
  return call(`/api/staff/items/${itemId}/loans`, { method: "POST", headers: { origin, cookie: cookies.STAFF! }, body: form });
}

/** Everything a Lend can write: loans, their movements, their audit rows and their photos. */
function written() {
  const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
  return {
    loans: count("SELECT COUNT(*) AS n FROM loans"),
    movements: count("SELECT COUNT(*) AS n FROM inventory_movements WHERE movement_type = 'LOAN_OUT'"),
    audit: count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'LOAN_CREATED'"),
    photos: [...evidence.objects.keys()].filter((key) => key.startsWith("loans/")).length
  };
}

async function refused(response: Response) {
  return [response.status, (await response.json() as { error: string }).error];
}

describe("one Student ID rule for both purposes (D1, §4.5)", () => {
  it("needs an 8-digit Student ID for Individual and USC use alike, and keeps leading zeros", async () => {
    const id = await loanable("Tripod", 5);
    const before = written();
    expect(await refused(await lend(id, { studentId: "" }))).toEqual([400, STUDENT_ID_MESSAGES.EMPTY]);
    expect(await refused(await lend(id, { purpose: "USC", reason: "Stage setup", studentId: "" }))).toEqual([400, STUDENT_ID_MESSAGES.EMPTY]);
    expect(written()).toEqual(before);
    expect((await lend(id, { studentId: "00123456" })).status).toBe(201);
    expect((await lend(id, { purpose: "USC", reason: "Stage setup", studentId: "21000115" })).status).toBe(201);
    const ids = sqlite.prepare("SELECT student_id AS id FROM loans ORDER BY created_at").all() as Array<{ id: string }>;
    expect(ids.map((row) => row.id)).toEqual(["00123456", "21000115"]);
  });

  it("checks the ID exactly as sent: the desk tidies it, the Worker never rewrites it", async () => {
    const id = await loanable("Lamp", 5);
    const before = written();
    for (const [studentId, message] of [
      ["21-000115", STUDENT_ID_MESSAGES.NOT_DIGITS], ["2100 0115", STUDENT_ID_MESSAGES.NOT_DIGITS], ["２１０００１１５", STUDENT_ID_MESSAGES.NOT_DIGITS],
      ["TEST-0001", STUDENT_ID_MESSAGES.NOT_DIGITS], ["210001159", STUDENT_ID_MESSAGES.LENGTH], ["2100011", STUDENT_ID_MESSAGES.LENGTH]
    ] as const) {
      expect(await refused(await lend(id, { studentId })), studentId).toEqual([400, message]);
    }
    expect(written()).toEqual(before);
  });

  it("names the first problem in the form's order: name, then Student ID, then reason, then quantity", async () => {
    const id = await loanable("Order", 5);
    expect(await refused(await lend(id, { purpose: "USC", borrowerName: "", studentId: "", reason: "", quantity: "x" }))).toEqual([400, "Enter the borrower's full name."]);
    expect(await refused(await lend(id, { purpose: "USC", studentId: "", reason: "", quantity: "x" }))).toEqual([400, STUDENT_ID_MESSAGES.EMPTY]);
    expect(await refused(await lend(id, { purpose: "USC", reason: "", quantity: "x" }))).toEqual([400, "Enter the specific USC reason."]);
    expect(await refused(await lend(id, { quantity: "x" }))).toEqual([400, "Enter the quantity in digits, like 12."]);
  });
});

describe("a USC-only item at the desk (D3)", () => {
  it("is refused for Individual use, writing nothing, and lent for USC use", async () => {
    const id = await loanable("Sound system", 2, "USC_STAFF_ONLY");
    const before = written();
    expect(await refused(await lend(id))).toEqual([400, USC_ONLY_MESSAGE]);
    expect(written()).toEqual(before);
    expect((await lend(id, { purpose: "USC", reason: "General assembly" })).status).toBe(201);
    expect(written()).toEqual({ loans: before.loans + 1, movements: before.movements + 1, audit: before.audit + 1, photos: before.photos + 1 });
  });
});

describe("the loan quantity as typed (§4.6)", () => {
  it("refuses an exponent, a hex figure, a sign, a decimal, a fraction, a separator, full-width digits, NaN, too large and an empty field, writing nothing", async () => {
    const id = await loanable("Chairs", 2000);
    const before = written();
    const cases: Array<[string, string]> = [
      ["1e3", "Write the quantity out in full, like 1000."], ["0x10", "Enter the quantity in digits, like 12."], ["+5", "Enter the quantity in digits, like 12."],
      ["5.0", "The quantity must be a whole number."], ["2.5", "The quantity must be a whole number."], ["1,000", "Leave out commas and spaces in the quantity."],
      ["", "Enter the quantity."], ["0", "The quantity must be at least 1."], ["-1", "The quantity can't be negative."], ["-2", "The quantity can't be negative."],
      ["１２", "Enter the quantity in digits, like 12."], ["NaN", "Enter the quantity in digits, like 12."], ["100001", "The quantity can be at most 100000."],
      ["999999", "The quantity can be at most 100000."]
    ];
    for (const [quantity, message] of cases) expect(await refused(await lend(id, { quantity })), quantity).toEqual([400, message]);
    expect(written()).toEqual(before);
    expect((await lend(id, { quantity: "12" })).status).toBe(201);
    expect((sqlite.prepare("SELECT quantity FROM loans").get() as { quantity: number }).quantity).toBe(12);
  });
});

describe("a retried Lend (R5)", () => {
  it("answers a replay with the loan it already made, marked as such, and never lends twice", async () => {
    const id = await loanable("Projector", 3);
    const key = "wp5-retry-key-0001";
    const first = await lend(id, { key });
    expect(first.status).toBe(201);
    const { id: loanId } = await first.json() as { id: string };
    const again = await lend(id, { key, quantity: "2", borrowerName: "Someone Else" });
    expect(await again.json()).toEqual({ id: loanId, onHand: 2, replayed: true });
    expect(written()).toMatchObject({ loans: 1, movements: 1, audit: 1, photos: 1 });
  });

  it("makes one loan when the same key arrives twice at once", async () => {
    const id = await loanable("Speaker", 3);
    const key = "wp5-race-key-0001";
    const answers = await Promise.all([lend(id, { key }), lend(id, { key })]);
    const bodies = await Promise.all(answers.map((response) => response.json() as Promise<{ id: string; replayed?: boolean }>));
    expect(answers.map((response) => response.status).sort()).toEqual([201, 201]);
    expect(new Set(bodies.map((body) => body.id)).size).toBe(1);
    expect(bodies.filter((body) => body.replayed)).toHaveLength(1);
    expect(written()).toMatchObject({ loans: 1, movements: 1, audit: 1, photos: 1 });
  });

  it("refuses a key already used for another item", async () => {
    const [one, two] = [await loanable("Mic A", 2), await loanable("Mic B", 2)];
    expect((await lend(one, { key: "wp5-cross-key-0001" })).status).toBe(201);
    expect((await lend(two, { key: "wp5-cross-key-0001" })).status).toBe(409);
    expect(written()).toMatchObject({ loans: 1, movements: 1 });
  });
});

describe("known borrowers", () => {
  it("offers only IDs that meet the rule; an older office-format ID is never suggested", async () => {
    const id = await loanable("Easel", 5);
    expect((await lend(id, { studentId: "20000100", borrowerName: "Ana Cruz" })).status).toBe(201);
    const now = new Date().toISOString();
    sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
      VALUES('MOV-OLD', ?, 'LOAN_OUT', 'OUT', ?, 1, 'piece', -1, 'POSTED')`).run(now, id);
    sqlite.prepare(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, status, movement_id, created_at, created_by)
      VALUES('LN-OLD', ?, 1, 'INDIVIDUAL', 'Ben Lim', '20-1234-567', 'loans/LN-OLD', 'OUT', 'MOV-OLD', ?, 'ACC-1')`).run(id, now);
    const { known } = await json<{ known: Array<{ studentId: string }> }>(as("STAFF", "/api/staff/loans"));
    expect(known.map((row) => row.studentId)).toEqual(["20000100"]);
  });
});

describe("the Directory's Student ID (D2)", () => {
  const add = (studentId: string) => as("ADMIN", "/api/staff/admin/directory", "POST", { name: "Ana Santos", department: "DoL", studentId });

  it("takes a new ID only in 8 digits, in the same words as the loan forms", async () => {
    expect(await refused(await add("20-1111-222"))).toEqual([400, STUDENT_ID_MESSAGES.NOT_DIGITS]);
    expect(await refused(await add("201111222"))).toEqual([400, STUDENT_ID_MESSAGES.LENGTH]);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM staff_directory").get() as { n: number }).n).toBe(0);
    expect((await add("00111122")).status).toBe(201);
    expect((await add("")).status).toBe(201);
    const ids = (sqlite.prepare("SELECT student_id AS id FROM staff_directory ORDER BY student_id").all() as Array<{ id: string | null }>).map((row) => row.id);
    expect(ids).toEqual([null, "00111122"]);
  });

  it("keeps a stored older ID on an edit that leaves it alone, and refuses a change to one that is not 8 digits", async () => {
    const now = new Date().toISOString();
    sqlite.prepare(`INSERT INTO staff_directory(id, full_name, department, officer, student_id, active, created_at, created_by, updated_at, updated_by)
      VALUES('PER-00000000-0000-4000-8000-000000000001', 'Ben Lim', 'DoF', 0, '20-1234-567', 1, ?, 'ACC-admin', ?, 'ACC-admin')`).run(now, now);
    const edit = (body: Record<string, unknown>) => as("ADMIN", "/api/staff/admin/directory/PER-00000000-0000-4000-8000-000000000001", "PATCH", { updatedAt: (sqlite.prepare("SELECT updated_at AS at FROM staff_directory WHERE id = 'PER-00000000-0000-4000-8000-000000000001'").get() as { at: string }).at, ...body });
    expect((await edit({ name: "Ben Lim Jr", studentId: "20-1234-567" })).status).toBe(200);
    expect(sqlite.prepare("SELECT full_name AS name, student_id AS id FROM staff_directory WHERE id = 'PER-00000000-0000-4000-8000-000000000001'").get()).toEqual({ name: "Ben Lim Jr", id: "20-1234-567" });
    expect(await refused(await edit({ studentId: "20-1234-568" }))).toEqual([400, STUDENT_ID_MESSAGES.NOT_DIGITS]);
    expect((await edit({ studentId: "20123456" })).status).toBe(200);
    expect((sqlite.prepare("SELECT student_id AS id FROM staff_directory WHERE id = 'PER-00000000-0000-4000-8000-000000000001'").get() as { id: string }).id).toBe("20123456");
  });
});
