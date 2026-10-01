import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { closeStatements, lendStatements } from "../src/loans";
import { migratedD1 } from "./d1-sqlite";

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let staffCookie: string;
let adminCookie: string;

type Event = {
  id: string; correlationId: string; at: string | null; source: string; type: string; summary: string; actor: string; itemId: string | null; change: number; stockChanged: boolean;
  before: number | null; after: number | null; reason: string | null; note: string | null; fields: string[]; attention: boolean;
};
type Feed = { events: Event[]; nextCursor: string | null };

const call = (path: string, cookie: string | undefined, headers: Record<string, string> = {}) => worker.fetch(new Request(`${origin}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } }), env);
const feed = async (query = "", cookie: string | undefined = staffCookie): Promise<Feed> => {
  const response = await call(`/api/staff/activity${query ? `?${query}` : ""}`, cookie);
  expect(response.status).toBe(200);
  return response.json();
};
const types = (result: Feed) => result.events.map((event) => event.type);

async function signIn(username: string): Promise<string> {
  const login = await worker.fetch(new Request(`${origin}/api/staff/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username, password: "correct horse battery" }) }), env);
  return login.headers.get("set-cookie")!.split(";")[0]!;
}

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: {} as R2Bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  // The migrations carry the imported catalog history; these tests want a ledger of only what they write.
  sqlite.exec("DROP TRIGGER inventory_movements_no_delete; DELETE FROM inventory_movements; DELETE FROM audit_log");
  const hash = await hashPassword("correct horse battery");
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES('ACC-1', 'staff.one', 'Staff One', ?, 'STAFF')").run(hash);
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES('ACC-2', 'admin.one', 'Admin One', ?, 'ADMIN')").run(hash);
  staffCookie = await signIn("staff.one");
  adminCookie = await signIn("admin.one");
  item("ITM-T", "Folding Table", "Loanable", { stock_area: "Inventory", storage_location: "Shelf A" });
  item("ITM-R", "Rice 5kg", "Consumable", { stock_area: "Pantry", storage_location: "Pantry B" });
});

function item(id: string, name: string, itemType: string, extra: Record<string, string> = {}) {
  sqlite.prepare("INSERT INTO items(id, name, category, item_type, unit, stock_area, storage_location, aliases) VALUES(?, ?, 'SUPPLIES', ?, 'piece', ?, ?, ?)")
    .run(id, name, itemType, extra.stock_area ?? "Inventory", extra.storage_location ?? null, extra.aliases ?? null);
}
let counter = 0;
function movement(itemId: string, type: string, signed: number, at: string, fields: { status?: string; actor?: string | null; notes?: string; reason?: string; id?: string; imported?: string; related?: string; relatedId?: string } = {}) {
  const id = fields.id ?? `MOV-${++counter}`;
  sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, notes, reason, status, imported_from, related_entity_type, related_entity_id)
    VALUES(?, ?, ?, ?, ?, ?, 'piece', ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, at, type, signed >= 0 ? "IN" : "OUT", itemId, Math.abs(signed), signed, fields.actor === undefined ? "ACC-1" : fields.actor, fields.notes ?? null, fields.reason ?? null, fields.status ?? "POSTED", fields.imported ?? null, fields.related ?? null, fields.relatedId ?? null);
  return id;
}
function audit(id: string, at: string, action: string, entityType: string, entityId: string | null, details: string | null, actor: string | null = "ACC-1") {
  sqlite.prepare("INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json) VALUES(?, ?, ?, ?, ?, ?, ?)").run(id, at, actor, action, entityType, entityId, details);
}
function phone(id: string, itemId: string, type: string, occurredAt: string, fields: Record<string, unknown> = {}) {
  const row = { applied: 1, review: null, resolved_at: null, resolved_by: null, resolution_note: null, return_outcome: null, loan_id: null, note: null, reason: null, ...fields };
  sqlite.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, purpose, reason, return_outcome, note, photo_key, device_time, sent_at, occurred_at, received_at,
      client_tag, loan_id, applied, review, resolved_at, resolved_by, resolution_note) VALUES(?, 'DEVICE-SECRET-1', 1, ?, ?, 1, 'Juan Dela Cruz', '20-1234-567', 'INDIVIDUAL', ?, ?, ?, 'held/photo-secret.jpg', ?, ?, ?, ?, 'nettag99', ?, ?, ?, ?, ?, ?)`)
    .run(id, type, itemId, row.reason, row.return_outcome, row.note, occurredAt, occurredAt, occurredAt, occurredAt, row.loan_id, row.applied, row.review, row.resolved_at, row.resolved_by, row.resolution_note);
}
const lend = (loanId: string, itemId: string, quantity: number, at: string, actorId = "ACC-1", who: { reason?: string; studentId?: string } = {}) => env.DB.batch(lendStatements(env.DB, {
  id: loanId, itemId, details: { purpose: "USC", borrowerName: "Maria Borrower", studentId: who.studentId ?? null, reason: who.reason ?? "Orientation booth", quantity, returnBy: null }, photoKey: `loans/${loanId}`, movementId: `MOV-${loanId}`, key: `key-${loanId}`, actorId, at
}));
const close = (loanId: string, itemId: string, quantity: number, outcome: "RETURNED" | "DAMAGED" | "LOST", at: string, note = "Returned with a scratch") => env.DB.batch(closeStatements(env.DB, {
  loanId, itemId, quantity, outcome, note, actorId: "ACC-1", at, movementId: `MOV-R-${loanId}`
}));

describe("activity read model", () => {
  it("tells a loan's whole life once, with the movement owning the quantity", async () => {
    movement("ITM-T", "STOCK_IN", 10, "2026-09-30T01:00:00.000Z");
    await lend("LN-A", "ITM-T", 2, "2026-09-30T02:00:00.000Z");
    await close("LN-A", "ITM-T", 2, "RETURNED", "2026-09-30T03:00:00.000Z");
    await lend("LN-B", "ITM-T", 1, "2026-09-30T04:00:00.000Z");
    await close("LN-B", "ITM-T", 1, "DAMAGED", "2026-09-30T05:00:00.000Z");

    const { events } = await feed();
    // No LOAN_CREATED and no good LOAN_CLOSED audit entry: the movements already say it. The damaged closing has no movement, so it stays with no change.
    expect(events.map((event) => [event.type, event.change])).toEqual([["LOAN_DAMAGED", 0], ["LOAN_OUT", -1], ["LOAN_RETURN", 2], ["LOAN_OUT", -2], ["STOCK_IN", 10]]);
    expect(events.map((event) => event.after)).toEqual([null, 9, 10, 8, 10]);
    expect(events[2]).toMatchObject({ before: 8, after: 10, stockChanged: true, source: "LOAN", correlationId: "LN-A" });
    expect(events[0]).toMatchObject({ source: "LOAN", correlationId: "LN-B", stockChanged: false });
    expect(events[1]!.summary).toBe("Staff One lent 1 piece of Folding Table for USC use.");
    expect(events[3]!.summary).toBe("Staff One lent 2 pieces of Folding Table for USC use.");
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    expect(events.every((event) => /^(mov|audit|phone|resolve):/.test(event.id))).toBe(true);
  });

  it("counts only POSTED movements and keeps a superseded one as evidence with no change", async () => {
    movement("ITM-R", "STOCK_IN", 5, "2026-09-30T01:00:00.000Z");
    movement("ITM-R", "STOCK_OUT", -3, "2026-09-30T02:00:00.000Z", { status: "SUPERSEDED", actor: "SELF_SERVICE" });
    movement("ITM-R", "COUNT_ADJUSTMENT", 0, "2026-09-30T03:00:00.000Z", { notes: "Shelf check" });
    const { events } = await feed();
    expect(events.map((event) => [event.type, event.change, event.before, event.after])).toEqual([["COUNT_ADJUSTMENT", 0, 5, 5], ["STOCK_OUT", 0, null, null], ["STOCK_IN", 5, 0, 5]]);
    expect(events[1]).toMatchObject({ actor: "Self-service", source: "MOVEMENT", stockChanged: false });
    expect(events[1]!.summary).toContain("a later count already covers it");
    expect(types(await feed("changed=yes"))).toEqual(["STOCK_IN"]);
    expect(types(await feed("changed=no"))).toEqual(["COUNT_ADJUSTMENT", "STOCK_OUT"]);
    expect((await feed("q=Shelf%20check")).events.map((event) => event.type)).toEqual(["COUNT_ADJUSTMENT"]);
    // The one legacy ISSUE movement reads as itself, and its type can be chosen.
    movement("ITM-R", "ISSUE", -1, "2026-09-29T00:00:00.000Z", { actor: null });
    expect((await feed("type=ISSUE")).events.map((event) => [event.title, event.summary])).toEqual([["Issued (legacy system)", "1 piece of Rice 5kg was issued in the legacy system."]]);
  });

  it("orders by the real instant across Z and +08:00, and reads dates as Manila days", async () => {
    // As text "…T10:00:00+08:00" sorts after "…T03:00:00Z", but it is 02:00Z: the Z row is newer.
    movement("ITM-R", "STOCK_IN", 1, "2026-09-30T10:00:00+08:00", { id: "MOV-EARLIER" });
    movement("ITM-R", "STOCK_IN", 1, "2026-09-30T03:00:00Z", { id: "MOV-LATER" });
    movement("ITM-R", "STOCK_IN", 1, "2026-09-30T17:30:00.000Z", { id: "MOV-NEXTDAY" });
    expect((await feed()).events.map((event) => event.id)).toEqual(["mov:MOV-NEXTDAY", "mov:MOV-LATER", "mov:MOV-EARLIER"]);
    expect((await feed()).events[2]!.at).toBe("2026-09-30T02:00:00.000Z");
    // 17:30Z on the 30th is 01:30 on October 1st in Manila.
    expect((await feed("from=2026-10-01")).events.map((event) => event.id)).toEqual(["mov:MOV-NEXTDAY"]);
    expect((await feed("to=2026-09-30")).events.map((event) => event.id)).toEqual(["mov:MOV-LATER", "mov:MOV-EARLIER"]);
    expect((await feed("from=2026-10-01&to=2026-10-01")).events).toHaveLength(1);
    expect((await feed("from=2026-10-02")).events).toHaveLength(0);
  });

  it("shows a stored timestamp that is not a date as unknown, oldest, and pages past it", async () => {
    movement("ITM-R", "STOCK_IN", 1, "not a time", { id: "MOV-BAD" });
    movement("ITM-R", "STOCK_IN", 1, "2460000", { id: "MOV-NUMBER" });
    movement("ITM-R", "STOCK_IN", 1, "2026-09-30T03:00:00Z", { id: "MOV-OK" });
    const first = await feed("limit=2");
    expect(first.events.map((event) => event.id)).toEqual(["mov:MOV-OK", "mov:MOV-NUMBER"]);
    expect(first.events[1]!.at).toBeNull();
    const second = await feed(`limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.events.map((event) => event.id)).toEqual(["mov:MOV-BAD"]);
    expect(second.nextCursor).toBeNull();
    expect((await feed("from=2000-01-01")).events.map((event) => event.id)).toEqual(["mov:MOV-OK"]);
  });

  it("pages deterministically through equal times across every source, with no repeat and no gap", async () => {
    const at = "2026-09-30T04:00:00.000Z";
    for (let i = 0; i < 4; i += 1) movement("ITM-R", "STOCK_IN", 1, at, { id: `MOV-${i}` });
    for (let i = 0; i < 3; i += 1) audit(`AUD-${i}`, at, "ITEM_UPDATED", "ITEM", "ITM-R", '{"status":{"from":"ACTIVE","to":"VERIFY"}}');
    for (let i = 0; i < 3; i += 1) phone(`PH-${i}`, "ITM-R", "RETURN", at);
    for (let i = 0; i < 2; i += 1) phone(`RS-${i}`, "ITM-R", "RETURN", "2026-09-29T00:00:00Z", { review: "UNMATCHED_RETURN", resolved_at: at, resolved_by: "ACC-1" });
    const everything = await feed("limit=100");
    expect(everything.events).toHaveLength(14);
    for (const size of [1, 2, 3, 5]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 30; guard += 1) {
        const page: Feed = await feed(`limit=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        seen.push(...page.events.map((event) => event.id));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(seen, `page size ${size}`).toEqual(everything.events.map((event) => event.id));
    }
  });

  it("applies every filter before pages are cut, so a rare match is found however deep it is", async () => {
    for (let i = 0; i < 40; i += 1) movement("ITM-R", "STOCK_IN", 1, `2026-09-30T05:${String(i).padStart(2, "0")}:00.000Z`);
    movement("ITM-T", "STOCK_OUT", -1, "2026-09-01T00:00:00.000Z", { id: "MOV-RARE", actor: "ACC-2", notes: "100%_done" });
    expect((await feed("limit=5&item=ITM-T")).events.map((event) => event.id)).toEqual(["mov:MOV-RARE"]);
    expect((await feed("limit=5&actor=ACC-2")).events).toHaveLength(1);
    expect((await feed("limit=5&q=admin")).events).toHaveLength(1);
    expect((await feed("limit=5&stockArea=Inventory")).events).toHaveLength(1);
    expect((await feed("limit=5&location=shelf%20a")).events).toHaveLength(1);
    expect((await feed("limit=5&type=STOCK_OUT&source=MOVEMENT")).events).toHaveLength(1);
    // "%" and "_" are plain characters in a search, never wildcards.
    expect((await feed("limit=5&q=100%25_done")).events).toHaveLength(1);
    expect((await feed("limit=5&q=%25")).events).toHaveLength(1);
    expect((await feed("limit=5&q=_")).events).toHaveLength(1);
    expect((await feed("limit=5&q=xx")).events).toHaveLength(0);
    expect((await feed("limit=5&q=ITM-T")).events).toHaveLength(1);
  });

  it("rejects malformed input and keeps unknown parameters harmless", async () => {
    for (const query of ["from=2026-02-30", "from=2026-13-01", "from=yesterday", "from=2026-10-02&to=2026-10-01", "limit=0", "limit=101", "limit=abc", "limit=5&limit=6", "cursor=garbage",
      "cursor=2026-13-99T00:00:00.000Z|mov:X", "cursor=2026-09-30T00:00:00.000Z|bogus:X", "source=ELSE", "type=NOPE", "item=x", "item=ITM-1&item=ITM-2", "actor=someone", "changed=maybe", "attention=0",
      "stockArea=Garage", `q=${"a".repeat(81)}`, "q=a%00b", "location=" + "b".repeat(81)]) {
      const response = await call(`/api/staff/activity?${query}`, staffCookie);
      expect(response.status, query).toBe(400);
      expect(Object.keys(await response.json() as object)).toEqual(["error"]);
    }
    expect((await call("/api/staff/activity?ignored=1&q=", staffCookie)).status).toBe(200);
    expect((await call("/api/staff/activity", undefined)).status).toBe(401);
    expect((await call("/api/staff/activity", "lh_staff_session=forged")).status).toBe(401);
    expect((await worker.fetch(new Request(`${origin}/api/staff/activity`, { method: "POST", headers: { origin, cookie: staffCookie } }), env)).status).toBe(405);
  });

  it("hides account and recovery events from STAFF before search and paging, and shows them to ADMIN", async () => {
    movement("ITM-R", "STOCK_IN", 1, "2026-09-01T00:00:00.000Z");
    for (let i = 0; i < 6; i += 1) audit(`AUD-A${i}`, `2026-09-30T00:0${i}:00.000Z`, i % 2 ? "ACCOUNT_CREATED" : "OWNER_RECOVERY_USED", i % 2 ? "ACCOUNT" : "RECOVERY", "ACC-9", '{"username":"hidden.person","role":"ADMIN","keyId":"KEY-1"}', "ACC-2");
    const staffView = await feed("limit=2");
    expect(staffView.events.map((event) => event.type)).toEqual(["STOCK_IN"]);
    for (const query of ["source=ACCOUNT", "type=ACCOUNT_CREATED", "type=OWNER_RECOVERY_USED", "q=hidden.person", "q=Admin%20One", "actor=ACC-2"]) expect((await feed(query)).events, query).toEqual([]);
    const adminView = await feed("limit=3", adminCookie);
    expect(adminView.events.map((event) => event.type)).toEqual(["ACCOUNT_CREATED", "OWNER_RECOVERY_USED", "ACCOUNT_CREATED"]);
    expect(adminView.events[0]).toMatchObject({ source: "ACCOUNT", summary: "Admin One created account for hidden.person." === "" ? "" : expect.stringContaining("hidden.person") });
    expect((await feed("source=ACCOUNT", adminCookie)).events).toHaveLength(6);
    // The Owner Console's first-owner setup reads as itself, not as a raw code.
    audit("AUD-BOOT", "2026-09-29T00:00:00.000Z", "OWNER_BOOTSTRAPPED", "ACCOUNT", "ACC-2", '{"username":"admin.one"}', "ACC-2");
    expect((await feed("type=OWNER_BOOTSTRAPPED", adminCookie)).events.map((event) => [event.title, event.summary])).toEqual([["First owner set up", "Admin One was set up as the first owner from the Owner Console."]]);
    expect(JSON.stringify(adminView)).not.toContain("KEY-1");
  });

  it("shows typed reasons and notes as written, from the writers' own lifecycle, and never outputs or searches structured identity, photo keys or network data", async () => {
    movement("ITM-T", "STOCK_IN", 5, "2026-09-30T01:00:00.000Z");
    await lend("LN-P", "ITM-T", 1, "2026-09-30T02:00:00.000Z");
    await close("LN-P", "ITM-T", 1, "RETURNED", "2026-09-30T03:00:00.000Z");
    await lend("LN-D", "ITM-T", 1, "2026-09-30T04:00:00.000Z");
    await close("LN-D", "ITM-T", 1, "DAMAGED", "2026-09-30T05:00:00.000Z", "Leg cracked in transit");
    await lend("LN-L", "ITM-T", 1, "2026-09-30T06:00:00.000Z");
    await close("LN-L", "ITM-T", 1, "LOST", "2026-09-30T07:00:00.000Z", "Left at the venue");
    phone("PH-1", "ITM-T", "RETURN", "2026-09-30T08:00:00.000Z", { applied: 0, review: "RETURN_CHECK", loan_id: "LN-P", note: "Box was wet", reason: "class project" });
    const all = await feed("limit=100", adminCookie);
    const body = JSON.stringify(all);
    for (const secret of ["Maria Borrower", "Juan", "Dela Cruz", "20-1234-567", "photo-secret", "loans/LN-", "nettag99", "DEVICE-SECRET", "password", "details", "student"]) expect(body, secret).not.toContain(secret);
    for (const query of ["q=Borrower", "q=Juan", "q=Dela%20Cruz", "q=20-1234", "q=photo-secret", "q=loans%2FLN", "q=nettag99"]) {
      expect((await feed(query, adminCookie)).events, query).toEqual([]);
      expect((await feed(query)).events, query).toEqual([]);
    }
    const byId = Object.fromEntries(all.events.map((event) => [event.id, event]));
    expect(byId["mov:MOV-LN-P"]).toMatchObject({ reason: "Orientation booth", note: null });
    expect(byId["mov:MOV-R-LN-P"]).toMatchObject({ note: "Returned with a scratch" });
    expect(byId["phone:PH-1"]).toMatchObject({ note: "class project · Box was wet" });
    // A damaged or lost closing has no movement; its one audit entry carries the loan's own return note, and no loan's life repeats an entry.
    const closing = (type: string) => all.events.filter((event) => event.type === type);
    expect(closing("LOAN_DAMAGED").map((event) => [event.correlationId, event.note])).toEqual([["LN-D", "Leg cracked in transit"]]);
    expect(closing("LOAN_LOST").map((event) => [event.correlationId, event.note])).toEqual([["LN-L", "Left at the venue"]]);
    for (const [loan, count] of [["LN-P", 3], ["LN-D", 2], ["LN-L", 2]] as const) expect(all.events.filter((event) => event.correlationId === loan).length, loan).toBe(count);
    expect(all.events).toHaveLength(8);
    for (const [query, ids] of [["q=Orientation", ["mov:MOV-LN-L", "mov:MOV-LN-D", "mov:MOV-LN-P"]], ["q=scratch", ["mov:MOV-R-LN-P"]], ["q=class%20project", ["phone:PH-1"]], ["q=wet", ["phone:PH-1"]]] as const) {
      for (const cookie of [staffCookie, adminCookie]) expect((await feed(query, cookie)).events.map((event) => event.id), query).toEqual(ids);
    }
    for (const [query, type, loan] of [["q=cracked", "LOAN_DAMAGED", "LN-D"], ["q=venue", "LOAN_LOST", "LN-L"]] as const) {
      for (const cookie of [staffCookie, adminCookie]) expect((await feed(query, cookie)).events.map((event) => [event.type, event.correlationId]), query).toEqual([[type, loan]]);
    }
    for (const event of all.events) expect(Object.keys(event).sort()).toEqual(["actor", "actorId", "after", "at", "attention", "before", "change", "correlationId", "fields", "id", "itemId", "itemName", "note", "quantity", "reason", "source", "stockChanged", "summary", "title", "type", "unit"]);
  });

  it("keeps a typed note as written for STAFF, ADMIN and OWNER, in the feed and in the search, while the structured name and ID match nothing", async () => {
    sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES('ACC-3', 'owner.one', 'Owner One', ?, 'OWNER')").run(await hashPassword("correct horse battery"));
    const ownerCookie = await signIn("owner.one");
    movement("ITM-T", "STOCK_IN", 9, "2026-09-30T01:00:00.000Z", { notes: "Counted with MARIA present" });
    await lend("LN-N", "ITM-T", 1, "2026-09-30T02:00:00.000Z", "ACC-1", { reason: "Booth for Maria", studentId: "20-9999-111" });
    await close("LN-N", "ITM-T", 1, "RETURNED", "2026-09-30T03:00:00.000Z", "Maria brought it back");
    phone("PH-R", "ITM-T", "RETURN", "2026-09-30T04:00:00.000Z", { applied: 0, review: "RETURN_CHECK", resolved_at: "2026-09-30T05:00:00.000Z", resolved_by: "ACC-1", resolution_note: "Juan confirmed it" });
    for (const cookie of [staffCookie, adminCookie, ownerCookie]) {
      const { events } = await feed("limit=100", cookie);
      const byId = Object.fromEntries(events.map((event) => [event.id, event]));
      expect(byId["mov:MOV-LN-N"]!.reason).toBe("Booth for Maria");
      expect(byId["mov:MOV-R-LN-N"]!.note).toBe("Maria brought it back");
      expect(byId["resolve:PH-R"]!.note).toBe("Juan confirmed it");
      expect(events.find((event) => event.note === "Counted with MARIA present")).toBeTruthy();
      expect((await feed("q=maria%20brought", cookie)).events.map((event) => event.id)).toEqual(["mov:MOV-R-LN-N"]);
      expect((await feed("q=confirmed", cookie)).events.map((event) => event.id)).toEqual(["resolve:PH-R"]);
      // Only the structured fields hold these; nothing typed repeats them.
      for (const query of ["q=Borrower", "q=20-9999", "q=Dela", "q=20-1234"]) expect((await feed(query, cookie)).events, query).toEqual([]);
    }
  });

  it("applies the search before the limit over the visible text, and moves the tag for a note but not for a structured identity", async () => {
    movement("ITM-T", "STOCK_IN", 9, "2026-09-30T01:00:00.000Z");
    await lend("LN-Q", "ITM-T", 1, "2026-09-30T02:00:00.000Z", "ACC-1", { reason: "Kiosk needle" });
    await lend("LN-Z", "ITM-T", 1, "2026-09-30T03:00:00.000Z");
    await lend("LN-Y", "ITM-T", 1, "2026-09-30T04:00:00.000Z");
    await close("LN-Y", "ITM-T", 1, "DAMAGED", "2026-09-30T05:00:00.000Z", "Dented needle");
    // The newer rows do not match; the older ones are still found at a limit of 1, and their cursor leads to the next match.
    const first = await feed("q=needle&limit=1");
    expect(first.events.map((event) => [event.type, event.correlationId])).toEqual([["LOAN_DAMAGED", "LN-Y"]]);
    expect((await feed(`q=needle&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).events.map((event) => event.id)).toEqual(["mov:MOV-LN-Q"]);
    const tag = async (match?: string) => {
      const response = await call("/api/staff/activity?q=needle", staffCookie, match ? { "If-None-Match": match } : {});
      return { status: response.status, etag: response.headers.get("etag")! };
    };
    const before = await tag();
    sqlite.prepare("UPDATE loans SET borrower_name = 'Somebody Else', student_id = '20-0000-000' WHERE id = 'LN-Q'").run();
    expect((await tag(before.etag)).status).toBe(304);
    sqlite.prepare("UPDATE loans SET reason = 'Kiosk needle, second table' WHERE id = 'LN-Q'").run();
    expect((await tag(before.etag)).status).toBe(200);
  });

  it("shows held and return phone records as their own entries, flags what needs a person, and records who resolved it", async () => {
    movement("ITM-R", "STOCK_IN", 5, "2026-09-30T01:00:00.000Z");
    // A plain applied take is only its movement; the phone record would just repeat it.
    movement("ITM-R", "STOCK_OUT", -1, "2026-09-30T02:00:00.000Z", { actor: "SELF_SERVICE", id: "MOV-TAKE" });
    phone("PH-TAKE", "ITM-R", "TAKE", "2026-09-30T02:00:00.000Z");
    // Applied but flagged: within minutes of a count.
    movement("ITM-R", "STOCK_OUT", -1, "2026-09-30T02:30:00.000Z", { actor: "SELF_SERVICE", id: "MOV-OVERLAP", related: "SELF_SERVICE" });
    phone("PH-OVERLAP", "ITM-R", "TAKE", "2026-09-30T02:30:00.000Z", { review: "COUNT_OVERLAP" });
    // Held: nothing changed yet.
    phone("PH-HELD", "ITM-R", "RETURN", "2026-09-30T03:00:00.000Z", { applied: 0, review: "UNMATCHED_RETURN", return_outcome: "RETURNED" });
    // Held, then resolved by staff.
    phone("PH-DONE", "ITM-R", "RETURN", "2026-09-30T03:30:00.000Z", { applied: 0, review: "RETURN_CHECK", resolved_at: "2026-09-30T06:00:00.000Z", resolved_by: "ACC-1", resolution_note: "Checked the photo" });

    const { events } = await feed();
    expect(events.map((event) => event.id)).toEqual(["resolve:PH-DONE", "phone:PH-DONE", "phone:PH-HELD", "phone:PH-OVERLAP", "mov:MOV-OVERLAP", "mov:MOV-TAKE", "mov:" + events.at(-1)!.id.slice(4)]);
    const byId = Object.fromEntries(events.map((event) => [event.id, event]));
    expect(byId["phone:PH-HELD"]).toMatchObject({ type: "PHONE_RETURN", source: "PHONE", actor: "Self-service", attention: true, stockChanged: false, change: 0 });
    expect(byId["phone:PH-HELD"]!.summary).toContain("held for staff");
    expect(byId["phone:PH-HELD"]!.reason).toContain("could not be matched");
    expect(byId["phone:PH-OVERLAP"]!.reason).toContain("physical count");
    expect(byId["phone:PH-OVERLAP"]!.summary).toContain("recorded");
    expect(byId["mov:MOV-OVERLAP"]).toMatchObject({ change: -1, source: "PHONE", actor: "Self-service" });
    expect(byId["resolve:PH-DONE"]).toMatchObject({ type: "REVIEW_RESOLVED", actor: "Staff One", note: "Checked the photo", attention: false });
    expect(byId["phone:PH-DONE"]!.attention).toBe(false);
    // "Needs attention" leads with the records a person has to act on.
    expect((await feed("attention=1")).events.map((event) => event.id)).toEqual(["phone:PH-HELD", "phone:PH-OVERLAP"]);
    expect((await feed("source=PHONE&type=REVIEW_RESOLVED")).events.map((event) => event.id)).toEqual(["resolve:PH-DONE"]);
  });

  it("says what staff decided on a held phone record: applied, confirmed, dismissed or only checked", async () => {
    const by = (minute: number) => ({ resolved_at: `2026-09-30T06:0${minute}:00.000Z`, resolved_by: "ACC-1" });
    phone("PH-A", "ITM-R", "TAKE", "2026-09-30T01:00:00.000Z", { applied: 1, review: "VOLUME", ...by(0) });
    phone("PH-C", "ITM-T", "RETURN", "2026-09-30T02:00:00.000Z", { applied: 1, review: "RETURN_CHECK", ...by(1) });
    phone("PH-D", "ITM-T", "RETURN", "2026-09-30T03:00:00.000Z", { applied: 0, review: "RETURN_CHECK", ...by(2) });
    phone("PH-K", "ITM-R", "TAKE", "2026-09-30T04:00:00.000Z", { applied: 1, review: "COUNT_OVERLAP", ...by(3) });
    expect((await feed("type=REVIEW_RESOLVED")).events.map((event) => [event.id, event.summary])).toEqual([
      ["resolve:PH-K", "Staff One marked a phone take of 1 piece of Rice 5kg as checked; it had already been recorded."],
      ["resolve:PH-D", "Staff One dismissed a phone return of 1 piece of Folding Table; nothing changed."],
      ["resolve:PH-C", "Staff One confirmed a phone return of 1 piece of Folding Table; the loan is closed."],
      ["resolve:PH-A", "Staff One applied a phone take of 1 piece of Rice 5kg that was held for staff."]
    ]);
  });

  it("tells open-unit work apart: opens, uses and conditions change nothing, an emptied unit is exactly -1", async () => {
    sqlite.exec("UPDATE items SET unit = 'ream', consumption_mode = 'OPEN_UNIT' WHERE id = 'ITM-R'");
    movement("ITM-R", "STOCK_IN", 8, "2026-09-30T00:00:00.000Z");
    audit("AU-1", "2026-09-30T01:00:00.000Z", "UNIT_OPENED", "ITEM", "ITM-R", JSON.stringify({ unitId: "OU-1", alreadyOpen: 0 }));
    audit("AU-2", "2026-09-30T01:10:00.000Z", "UNIT_OPENED", "ITEM", "ITM-R", JSON.stringify({ unitId: "OU-2", alreadyOpen: 1 }));
    audit("AU-3", "2026-09-30T01:20:00.000Z", "UNIT_USED", "ITEM", "ITM-R", JSON.stringify({ unitId: "OU-1" }));
    audit("AU-4", "2026-09-30T01:30:00.000Z", "UNIT_CONDITION", "ITEM", "ITM-R", JSON.stringify({ unitId: "OU-1", condition: { from: null, to: "LOW" } }));
    phone("PH-USE", "ITM-R", "USE", "2026-09-30T01:40:00.000Z", { applied: 1 });
    movement("ITM-R", "STOCK_OUT", -1, "2026-09-30T01:50:00.000Z", { id: "MOV-EMPTY", related: "OPEN_UNIT", relatedId: "OU-1", reason: "CONSUMED" });
    audit("AU-5", "2026-09-30T02:00:00.000Z", "UNIT_CORRECTED", "ITEM", "ITM-R", JSON.stringify({ unitId: "OU-2" }));
    audit("AU-6", "2026-09-30T02:10:00.000Z", "UNIT_RECONCILED", "ITEM", "ITM-R", JSON.stringify({ closed: 2, counted: 3 }));
    const result = await feed("item=ITM-R");
    expect(result.events.map((event) => [event.type, event.source, event.change, event.summary])).toEqual([
      ["UNIT_RECONCILED", "MOVEMENT", 0, "Staff One's count closed 2 open reams of Rice 5kg no longer on the shelf."],
      ["UNIT_CORRECTED", "MOVEMENT", 0, "Staff One closed an open ream of Rice 5kg that was not really open; stock did not change."],
      ["UNIT_EMPTIED", "MOVEMENT", -1, "Staff One marked an open ream of Rice 5kg empty: 7 reams on hand."],
      ["PHONE_USE", "PHONE", 0, "A phone use of Rice 5kg was recorded; stock did not change."],
      ["UNIT_CONDITION", "MOVEMENT", 0, "Staff One marked an open ream of Rice 5kg as low; stock did not change."],
      ["UNIT_USED", "MOVEMENT", 0, "Staff One recorded a use of an open ream of Rice 5kg; stock did not change."],
      ["UNIT_OPENED", "MOVEMENT", 0, "Staff One opened another ream of Rice 5kg (1 already open); stock did not change."],
      ["UNIT_OPENED", "MOVEMENT", 0, "Staff One opened a ream of Rice 5kg; stock did not change."],
      ["STOCK_IN", "MOVEMENT", 8, "Staff One received 8 reams of Rice 5kg."]
    ]);
    // Uses recorded and units used up are separate entry types, so each filters (and exports) on its own.
    expect(types(await feed("type=UNIT_EMPTIED"))).toEqual(["UNIT_EMPTIED"]);
    expect(types(await feed("source=MOVEMENT&changed=no"))).toEqual(["UNIT_RECONCILED", "UNIT_CORRECTED", "UNIT_CONDITION", "UNIT_USED", "UNIT_OPENED", "UNIT_OPENED"]);
    expect(types(await feed("source=PHONE"))).toEqual(["PHONE_USE"]);
  });

  it("flags an item whose balance went below zero, across every item and any age, and clears when a count fixes it", async () => {
    movement("ITM-R", "STOCK_IN", 5, "2026-06-01T00:00:00.000Z");
    movement("ITM-R", "STOCK_OUT", -8, "2026-06-02T00:00:00.000Z", { id: "MOV-SHORT" });
    movement("ITM-T", "STOCK_IN", 5, "2026-06-01T00:00:00.000Z");
    const flagged = await feed("attention=1");
    expect(flagged.events.map((event) => [event.itemId, event.attention])).toEqual([["ITM-R", true], ["ITM-R", true]]);
    const normal = await feed();
    expect(normal.events.filter((event) => event.attention).map((event) => event.itemId)).toEqual(["ITM-R", "ITM-R"]);
    expect(normal.events.find((event) => event.id === "mov:MOV-SHORT")).toMatchObject({ after: -3, change: -8 });
    // A physical count after the gap starts the balance again.
    movement("ITM-R", "COUNT_ADJUSTMENT", 3, "2026-06-03T00:00:00.000Z");
    expect((await feed("attention=1")).events).toEqual([]);
  });

  it("keeps a loan closing whose outcome is unknown, once, searchable and pageable, and drops only a confirmed good return", async () => {
    const closing = (id: string, minute: number, details: string | null) => audit(id, `2026-09-30T02:${String(minute).padStart(2, "0")}:00.000Z`, "LOAN_CLOSED", "ITEM", "ITM-T", details);
    closing("AUD-BAD", 1, "{not json");
    closing("AUD-NONE", 2, null);
    closing("AUD-MISSING", 3, '{"loanId":"LN-X","quantity":1}');
    closing("AUD-NULL", 4, '{"loanId":"LN-X","outcome":null,"quantity":1}');
    closing("AUD-UNKNOWN", 5, '{"loanId":"LN-X","outcome":"MISPLACED","quantity":1}');
    closing("AUD-GOOD", 6, '{"loanId":"LN-X","outcome":"RETURNED","quantity":1}');
    closing("AUD-DAMAGED", 7, '{"loanId":"LN-X","outcome":"DAMAGED","quantity":1}');
    closing("AUD-LOST", 8, '{"loanId":"LN-X","outcome":"LOST","quantity":1}');
    const unknown = ["audit:AUD-UNKNOWN", "audit:AUD-NULL", "audit:AUD-MISSING", "audit:AUD-NONE", "audit:AUD-BAD"];
    for (const cookie of [staffCookie, adminCookie]) {
      const { events } = await feed("limit=100", cookie);
      expect(events.map((event) => event.id), "good return suppressed, everything else once").toEqual(["audit:AUD-LOST", "audit:AUD-DAMAGED", ...unknown]);
      expect(events.filter((event) => event.type === "LOAN_CLOSED").map((event) => event.id)).toEqual(unknown);
      expect((await feed("q=folding&limit=100", cookie)).events.map((event) => event.id)).toEqual(["audit:AUD-LOST", "audit:AUD-DAMAGED", ...unknown]);
    }
    // One per page: no entry is skipped or repeated across the cursor, and the tag is stable for the same page.
    const seen: string[] = [];
    for (let cursor = "", page = 0; page < 10; page += 1) {
      const result = await feed(`limit=1${cursor}`);
      seen.push(...result.events.map((event) => event.id));
      if (!result.nextCursor) break;
      cursor = `&cursor=${encodeURIComponent(result.nextCursor)}`;
    }
    expect(seen).toEqual(["audit:AUD-LOST", "audit:AUD-DAMAGED", ...unknown]);
    const first = await call("/api/staff/activity?limit=100", staffCookie);
    expect((await call("/api/staff/activity?limit=100", staffCookie, { "If-None-Match": first.headers.get("etag")! })).status).toBe(304);
  });

  it("describes catalog changes by field names only, and survives malformed audit details", async () => {
    audit("AUD-1", "2026-09-30T01:00:00.000Z", "ITEM_UPDATED", "ITEM", "ITM-R", '{"notes":{"from":"old secret","to":"new secret"},"storageLocation":{"from":"A","to":"B"},"password":{"from":"x","to":"y"}}');
    audit("AUD-2", "2026-09-30T02:00:00.000Z", "ITEM_UPDATED", "ITEM", "ITM-R", "{not json");
    audit("AUD-3", "2026-09-30T03:00:00.000Z", "ITEM_CREATED", "ITEM", "ITM-GONE", null, null);
    const { events } = await feed();
    expect(events.map((event) => event.id)).toEqual(["audit:AUD-3", "audit:AUD-2", "audit:AUD-1"]);
    expect(events[2]).toMatchObject({ source: "CATALOG", fields: ["notes", "location"], summary: "Staff One edited Rice 5kg: notes, location." });
    expect(JSON.stringify(events)).not.toMatch(/old secret|new secret|password/);
    expect(events[0]).toMatchObject({ actor: "System", itemId: null, itemName: null });
    expect(events[1]!.fields).toEqual([]);
  });

  it("walks the ordering indexes for a page, a date range and a later page, never scanning a whole table to sort", async () => {
    for (let i = 0; i < 60; i += 1) movement("ITM-R", "STOCK_IN", 1, `2026-09-30T05:${String(i).padStart(2, "0")}:00.000Z`);
    const plans: string[] = [];
    const real = sqlite.prepare.bind(sqlite);
    (sqlite as { prepare: unknown }).prepare = (sql: string) => {
      const statement = real(sql);
      const all = statement.all.bind(statement);
      statement.all = (...args: never[]) => { if (/^\s*WITH/.test(sql)) plans.push(real(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((row) => String(row.detail)).join("\n")); return all(...args); };
      return statement;
    };
    const first = await feed("limit=5", adminCookie);
    await feed(`limit=5&from=2026-09-30&to=2026-10-01&cursor=${encodeURIComponent(first.nextCursor!)}`, adminCookie);
    await feed("limit=5");
    expect(plans).toHaveLength(3);
    for (const plan of plans) {
      expect(plan).toMatch(/SCAN m USING INDEX idx_activity_movements|SEARCH m USING INDEX idx_activity_movements/);
      expect(plan).toMatch(/idx_activity_phone/);
      expect(plan).toMatch(/idx_activity_resolved/);
      expect(plan).not.toMatch(/SCAN (m|a|e)\s*$/m);
    }
    expect(plans[0]).toMatch(/SCAN a USING INDEX idx_activity_audit$/m);
    expect(plans[2]).toMatch(/idx_activity_audit_item/);
  });

  describe("refresh validator", () => {
    const tag = async (query = "", cookie = staffCookie, match?: string) => {
      const response = await call(`/api/staff/activity${query ? `?${query}` : ""}`, cookie, match ? { "If-None-Match": match } : {});
      return { status: response.status, etag: response.headers.get("etag")! };
    };

    it("is a digest of what this reader would see: steady when nothing changed, 304 on a match, different after any visible change", async () => {
      movement("ITM-R", "STOCK_IN", 1, "2026-09-30T03:00:00.000Z");
      const first = await tag();
      expect(first.status).toBe(200);
      expect(first.etag).toMatch(/^"a[0-9a-f]{24}"$/);
      expect((await tag("", staffCookie, first.etag)).status).toBe(304);
      expect((await tag("", staffCookie, `W/${first.etag}`)).status).toBe(304);
      // Backdated and same-time entries are invisible to a counter but change what the page shows.
      movement("ITM-R", "STOCK_IN", 1, "2026-09-01T00:00:00.000Z");
      const backdated = await tag("", staffCookie, first.etag);
      expect(backdated.status).toBe(200);
      const sameTime = (movement("ITM-R", "STOCK_IN", 1, "2026-09-30T03:00:00.000Z"), await tag("", staffCookie, backdated.etag));
      expect(sameTime.status).toBe(200);
      // A rename of the actor is in the text, so it is a change too.
      sqlite.prepare("UPDATE staff_accounts SET display_name = 'Renamed Person' WHERE id = 'ACC-1'").run();
      const renamed = await tag("", staffCookie, sameTime.etag);
      expect(renamed.status).toBe(200);
      // A different question gets a different tag even over the same rows.
      expect((await tag("limit=10")).etag).not.toBe(renamed.etag);
      expect((await tag("source=MOVEMENT")).etag).not.toBe(renamed.etag);
    });

    it("does not move for hidden security events (STAFF) but does for ADMIN", async () => {
      movement("ITM-R", "STOCK_IN", 1, "2026-09-30T03:00:00.000Z");
      const staffBefore = await tag();
      const adminBefore = await tag("", adminCookie);
      audit("AUD-H", "2026-09-30T04:00:00.000Z", "PASSWORD_RESET", "ACCOUNT", "ACC-1", '{"username":"staff.one"}', "ACC-2");
      expect((await tag("", staffCookie, staffBefore.etag)).status).toBe(304);
      expect((await tag("", adminCookie, adminBefore.etag)).status).toBe(200);
      expect(staffBefore.etag).not.toBe(adminBefore.etag);
    });

    it("leaves the other validators alone", async () => {
      const inventory = await call("/api/staff/inventory", staffCookie);
      expect(inventory.headers.get("etag")).toMatch(/^"r\d+"$/);
    });
  });
});

describe("activity export (CSV)", () => {
  const COLUMNS = ["Time (Manila)", "Activity", "Description", "Actor", "Source", "Item ID", "Item", "Unit", "Change", "Before", "After", "Reason", "Note", "Reference", "Entry ID"];
  const download = (query = "", cookie: string | undefined = staffCookie, headers: Record<string, string> = { origin }) =>
    worker.fetch(new Request(`${origin}/api/staff/activity/export${query ? `?${query}` : ""}`, { method: "POST", headers: { ...(cookie ? { cookie } : {}), ...headers } }), env);
  /** RFC 4180: quoted fields may hold commas, quotes, CR and LF; rows end with CRLF. */
  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i]!;
      if (quoted) {
        if (char !== '"') field += char;
        else if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 1; }
      else field += char;
    }
    return rows;
  }
  const exported = async (query = "", cookie = staffCookie) => {
    const response = await download(query, cookie);
    expect(response.status, query).toBe(200);
    // Response.text() would drop the byte-order mark; the bytes must carry it for Excel.
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
    const [header, ...rows] = parseCsv(text.slice(1));
    expect(header).toEqual(COLUMNS);
    return { response, text, rows };
  };
  const exportAudits = () => sqlite.prepare("SELECT actor_user_id AS actor, entity_type AS entity, details_json AS details FROM audit_log WHERE action = 'ACTIVITY_EXPORTED' ORDER BY created_at, rowid").all() as Array<{ actor: string; entity: string; details: string }>;

  it("exports exactly the filtered list as a guarded, Excel-ready file, with typed loan and phone text left blank", async () => {
    movement("ITM-T", "STOCK_IN", 5, "2026-09-30T01:00:00.000Z", { id: "MOV-F1", notes: '=HYPERLINK("http://evil.example","open")' });
    movement("ITM-R", "STOCK_IN", 3, "2026-09-30T01:10:00.000Z", { id: "MOV-F2", notes: "+1 bag" });
    movement("ITM-R", "STOCK_OUT", -1, "2026-09-30T01:20:00.000Z", { id: "MOV-F3", reason: "CONSUMED", notes: "-2 short, \"quoted\"\r\nsecond line" });
    movement("ITM-R", "STOCK_OUT", -1, "2026-09-30T01:30:00.000Z", { id: "MOV-F4", reason: "CONSUMED", notes: "@SUM(A1)" });
    movement("ITM-R", "STOCK_OUT", -1, "2026-09-30T01:40:00.000Z", { id: "MOV-F5", reason: "CONSUMED", notes: "\tTabbed" });
    await lend("LN-E", "ITM-T", 1, "2026-09-30T02:00:00.000Z", "ACC-1", { reason: "=cmd|' /C calc'!A0", studentId: "20-5555-123" });
    await close("LN-E", "ITM-T", 1, "DAMAGED", "2026-09-30T03:00:00.000Z", "Cracked by Juan");
    phone("PH-X", "ITM-T", "RETURN", "2026-09-30T04:00:00.000Z", { applied: 0, review: "RETURN_CHECK", loan_id: "LN-E", note: "Left at gym", reason: "class project",
      resolved_at: "2026-09-30T04:30:00.000Z", resolved_by: "ACC-1", resolution_note: "Checked with the borrower" });
    audit("AUD-ACC", "2026-09-30T05:00:00.000Z", "ACCOUNT_CREATED", "ACCOUNT", "ACC-9", '{"username":"new.person","role":"STAFF"}', "ACC-2");

    const { response, text, rows } = await exported();
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="logistics-activity-\d{8}-\d{4}\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-export-truncated")).toBe("0");
    expect(response.headers.get("x-export-rows")).toBe(String(rows.length));
    // The file is the page's own list, in the page's order, with the page's role scope (no account entry for STAFF).
    const page = await feed("limit=100");
    expect(rows.map((row) => row[14])).toEqual(page.events.map((event) => event.id));
    expect(rows.some((row) => row[4] === "Accounts & exports")).toBe(false);
    const byId = Object.fromEntries(rows.map((row) => [row[14], row]));

    // Every text cell that a spreadsheet would run starts with an apostrophe; numbers stay numbers.
    expect(byId["mov:MOV-F1"]![12]).toBe(`'=HYPERLINK("http://evil.example","open")`);
    expect(byId["mov:MOV-F2"]![12]).toBe("'+1 bag");
    expect(byId["mov:MOV-F3"]![12]).toBe("'-2 short, \"quoted\"\r\nsecond line");
    expect(byId["mov:MOV-F4"]![12]).toBe("'@SUM(A1)");
    expect(byId["mov:MOV-F5"]![12]).toBe("'\tTabbed");
    expect(text).toContain(',-1,3,2,"Consumed or used",');
    expect(byId["mov:MOV-F1"]!.slice(0, 11)).toEqual(["2026-09-30 09:00:00", "Stock in", "Staff One received 5 pieces of Folding Table.", "Staff One", "Stock", "ITM-T", "Folding Table", "piece", "5", "0", "5"]);

    // B(ii): the loan's typed reason and the closing, phone and resolution notes are blank; the fixed review reason stays.
    expect(byId["mov:MOV-LN-E"]!.slice(11, 13)).toEqual(["", ""]);
    expect(rows.find((row) => row[1] === "Returned damaged")![12]).toBe("");
    expect(byId["phone:PH-X"]!.slice(11, 13)).toEqual(["A return with a photo, waiting for staff to confirm the item is back before stock is updated", ""]);
    expect(byId["resolve:PH-X"]![12]).toBe("");
    for (const secret of ["cmd|", "Cracked by Juan", "Left at gym", "class project", "Checked with the borrower", "Maria Borrower", "20-5555-123", "Juan", "20-1234-567",
      "photo-secret", "loans/LN-", "DEVICE-SECRET", "nettag99", "password", "details", "new.person"]) expect(text, secret).not.toContain(secret);

    // ADMIN gets the account entry; a filter narrows the file exactly as it narrows the page.
    expect((await exported("", adminCookie)).rows.some((row) => row[1] === "Account created" && row[4] === "Accounts & exports")).toBe(true);
    const narrowed = await exported("q=HYPERLINK&source=MOVEMENT");
    expect(narrowed.rows.map((row) => row[14])).toEqual((await feed("q=HYPERLINK&source=MOVEMENT")).events.map((event) => event.id));
    expect(narrowed.rows).toHaveLength(1);

    // Each export is audited with who, which filters and how many rows; only ADMIN and OWNER see those entries.
    expect(exportAudits().map((row) => [row.actor, row.entity, JSON.parse(row.details)])).toEqual([
      ["ACC-1", "EXPORT", { rows: rows.length, truncated: false, filters: {} }],
      // ADMIN's file also holds the account entry and STAFF's own export entry.
      ["ACC-2", "EXPORT", { rows: rows.length + 2, truncated: false, filters: {} }],
      ["ACC-1", "EXPORT", { rows: 1, truncated: false, filters: { q: "HYPERLINK", source: "MOVEMENT" } }]
    ]);
    expect((await feed("type=ACTIVITY_EXPORTED")).events).toEqual([]);
    const seen = await feed("type=ACTIVITY_EXPORTED", adminCookie);
    expect(seen.events.map((event) => [event.source, event.summary])).toEqual([
      ["ACCOUNT", "Staff One exported 1 activity entry to a file, filtered by search, source."],
      ["ACCOUNT", `Admin One exported ${rows.length + 2} activity entries to a file.`],
      ["ACCOUNT", `Staff One exported ${rows.length} activity entries to a file.`]
    ]);
    expect(JSON.stringify(seen)).not.toContain("HYPERLINK");
  });

  it("caps a file and says so in the file, the headers and the audit entry", async () => {
    sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2001)
      INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, status)
      SELECT 'MOV-CAP-' || i, strftime('%Y-%m-%dT%H:%M:%fZ', '2026-09-01', '+' || i || ' minutes'), 'STOCK_IN', 'IN', 'ITM-R', 1, 'piece', 1, 'ACC-1', 'POSTED' FROM n`);
    const { response, rows } = await exported();
    expect(response.headers.get("x-export-truncated")).toBe("1");
    expect(response.headers.get("x-export-rows")).toBe("2000");
    expect(rows).toHaveLength(2001);
    expect(rows[0]![14]).toBe("mov:MOV-CAP-2001");
    expect(rows[1999]![14]).toBe("mov:MOV-CAP-2");
    // The notice keeps the fixed columns, so a strict importer still reads every row.
    expect(rows[2000]).toEqual(["", "More entries match", "One file holds the newest 2,000 entries. Narrow the filters, for example the dates, to export the rest.", ...Array(12).fill("")]);
    expect(JSON.parse(exportAudits()[0]!.details)).toEqual({ rows: 2000, truncated: true, filters: {} });
  });

  it("refuses cross-site, anonymous and GET callers, rejects a bad filter without counting it, and limits exports per account", async () => {
    expect((await download("", staffCookie, {})).status).toBe(403);
    expect((await download("", staffCookie, { origin: "https://evil.example" })).status).toBe(403);
    expect((await worker.fetch(new Request(`${origin}/api/staff/activity/export`, { method: "POST", headers: { origin } }), env)).status).toBe(401);
    expect((await call("/api/staff/activity/export", staffCookie)).status).toBe(405);
    for (const query of ["from=2026-02-30", "source=ELSE", "limit=0"]) expect((await download(query)).status, query).toBe(400);
    expect(exportAudits()).toEqual([]);
    for (let i = 0; i < 10; i += 1) expect((await download()).status).toBe(200);
    const refused = await download();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("600");
    expect(exportAudits()).toHaveLength(10);
    // The limit is per account.
    expect((await download("", adminCookie)).status).toBe(200);
  });
});
