import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/*
 * V1.16.7, workspace depth slice 2 (spec §4): a loan photo's thumbnail (saved once by a staff browser, kept beside the photo and
 * deleted with it), one loan's trail in Activity, and every Self-Service record page by page.
 */

const origin = "https://hub.example.test";
const PASSWORD = "correct horse battery";
const DAY = 24 * 60 * 60_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let objects: ReturnType<typeof memoryR2>["objects"];
let cookies: Record<"owner" | "staff", string>;
let sequence = 0;

const call = (who: keyof typeof cookies, path: string, init: { method?: string; body?: BodyInit; type?: string; from?: string } = {}) =>
  worker.fetch(new Request(`${origin}${path}`, { method: init.method ?? "GET", body: init.body, headers: { origin: init.from ?? origin, cookie: cookies[who], "content-type": init.type ?? "application/json" } }), env);

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  const r2 = memoryR2();
  objects = r2.objects;
  env = { DB: database.d1, EVIDENCE: r2.bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  cookies = { owner: "", staff: "" };
  for (const [who, role] of [["owner", "OWNER"], ["staff", "STAFF"]] as const) {
    sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(?, ?, ?, ?, ?)").run(`ACC-${who}`, who, who === "owner" ? "Owner" : "Staff One", await hashPassword(PASSWORD), role);
    const login = await worker.fetch(new Request(`${origin}/api/staff/login`, { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": who }, body: JSON.stringify({ username: who, password: PASSWORD }) }), env);
    cookies[who] = login.headers.get("set-cookie")!.split(";")[0]!;
  }
});

/** A loan of one ITM-0001 piece with its photo in R2, closed `closedDaysAgo` days ago (or still out). */
function loan(id: string, { out = false, closedDaysAgo = 10, photo = true } = {}) {
  const movement = `MOV-${id}`;
  sqlite.prepare("INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status, related_entity_type, related_entity_id) VALUES(?, ?, 'LOAN_OUT', 'OUT', 'ITM-0001', 1, 'piece', -1, 'POSTED', 'LOAN', ?)").run(movement, ago(closedDaysAgo + 3), id);
  const key = photo ? `loans/${id}` : "";
  if (photo) objects.set(key, { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
  sqlite.prepare(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, status, movement_id, created_at, created_by, closed_at, closed_by)
    VALUES(?, 'ITM-0001', 1, 'INDIVIDUAL', ?, ?, ?, ?, ?, ?, 'ACC-staff', ?, ?)`)
    .run(id, `Borrower ${id}`, `20-${String(++sequence).padStart(4, "0")}-001`, key, out ? "OUT" : "RETURNED", movement, ago(closedDaysAgo + 3), out ? null : ago(closedDaysAgo), out ? null : "ACC-staff");
  return id;
}

const putThumb = (id: string, bytes: Uint8Array = JPEG, who: keyof typeof cookies = "staff", type = "image/jpeg") =>
  call(who, `/api/staff/loans/${id}/thumb`, { method: "PUT", body: bytes, type });

describe("a loan photo's thumbnail", () => {
  it("is saved once by staff, beside the photo, and served privately; a second save keeps the first", async () => {
    loan("LN-A");
    expect((await call("staff", "/api/staff/loans/LN-A/thumb")).status).toBe(404);
    expect((await putThumb("LN-A")).status).toBe(204);
    expect(objects.get("loans/LN-A.thumb")?.bytes).toEqual(JPEG);
    const served = await call("staff", "/api/staff/loans/LN-A/thumb");
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG);
    // The full photo stays uncached, as before.
    expect((await call("staff", "/api/staff/loans/LN-A/photo")).headers.get("cache-control")).toBe("private, no-store");
    const other = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 9, 9]);
    expect((await putThumb("LN-A", other)).status).toBe(204);
    expect(objects.get("loans/LN-A.thumb")?.bytes).toEqual(JPEG);
  });

  it("refuses what is not a small JPEG, a loan without a photo, an unknown loan, another origin and a signed-out caller", async () => {
    loan("LN-A");
    loan("LN-GONE", { photo: false });
    expect((await putThumb("LN-A", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).status).toBe(415);
    expect((await putThumb("LN-A", JPEG, "staff", "image/png")).status).toBe(415);
    const large = new Uint8Array(60_000);
    large.set([0xff, 0xd8, 0xff]);
    expect((await putThumb("LN-A", large)).status).toBe(413);
    expect((await putThumb("LN-GONE")).status).toBe(409);
    expect((await putThumb("LN-NONE")).status).toBe(404);
    expect((await call("staff", "/api/staff/loans/LN-A/thumb", { method: "PUT", body: JPEG, type: "image/jpeg", from: "https://elsewhere.example" })).status).toBe(403);
    const signedOut = await worker.fetch(new Request(`${origin}/api/staff/loans/LN-A/thumb`, { method: "PUT", body: JPEG, headers: { origin, "content-type": "image/jpeg" } }), env);
    expect(signedOut.status).toBe(401);
    expect(objects.has("loans/LN-A.thumb")).toBe(false);
  });

  it("is deleted with its photo when the borrower's details are removed", async () => {
    loan("LN-OLD", { closedDaysAgo: 800 });
    expect((await putThumb("LN-OLD")).status).toBe(204);
    expect(objects.has("loans/LN-OLD.thumb")).toBe(true);
    const erased = await (await call("owner", "/api/staff/admin/retention", { method: "POST" })).json() as { loans: number; photos: number };
    expect(erased).toMatchObject({ loans: 1, photos: 1 });
    expect(objects.has("loans/LN-OLD")).toBe(false);
    expect(objects.has("loans/LN-OLD.thumb")).toBe(false);
    expect((await call("staff", "/api/staff/loans/LN-OLD/thumb")).status).toBe(404);
    expect((await putThumb("LN-OLD")).status).toBe(409);
  });
});

describe("one loan's trail in Activity", () => {
  it("keeps only the entries of the loan asked for, and refuses a malformed loan", async () => {
    loan("LN-A", { out: true });
    loan("LN-B", { out: true });
    const page = await (await call("staff", "/api/staff/activity?item=ITM-0001&loan=LN-A")).json() as { events: Array<{ correlationId: string }> };
    expect(page.events.length).toBeGreaterThan(0);
    expect(page.events.every((event) => event.correlationId === "LN-A")).toBe(true);
    expect((await call("staff", "/api/staff/activity?loan=nope")).status).toBe(400);
  });
});

describe("every Self-Service record, page by page", () => {
  function record(id: string, receivedDaysAgo: number) {
    const at = ago(receivedDaysAgo);
    sqlite.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, device_time, sent_at, occurred_at, received_at, applied)
      VALUES(?, 'dev', ?, 'TAKE', 'ITM-0001', 1, 'Person', '20-9999-999', ?, ?, ?, ?, 1)`).run(id, ++sequence, at, at, at, at);
  }

  it("walks back past the last 7 days, newest first, with nothing missed or repeated", async () => {
    const ids = Array.from({ length: 60 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    ids.forEach((id, index) => record(id, index));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const answer = await call("staff", `/api/staff/self-service/records${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`);
      expect(answer.headers.get("cache-control")).toBe("private, no-store");
      const page = await answer.json() as { records: Array<{ id: string; receivedAt: string }>; nextCursor: string | null };
      seen.push(...page.records.map((entry) => entry.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 5);
    expect(pages).toBe(2);
    expect(seen).toEqual(ids);
    expect((await call("staff", "/api/staff/self-service/records?cursor=garbage")).status).toBe(400);
  });
});
