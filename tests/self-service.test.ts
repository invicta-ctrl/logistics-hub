import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

const origin = "https://hub.example.test";
const MINUTE = 60_000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let photos: ReturnType<typeof memoryR2>["objects"];
let cookie: string;

type Result = { id: string; outcome: string; message?: string; duplicate?: boolean };

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const staff = (path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  const r2 = memoryR2();
  photos = r2.objects;
  env = { DB: database.d1, EVIDENCE: r2.bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(await hashPassword("correct horse battery"));
  const login = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "staff.one", password: "correct horse battery" }) });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

/** An item that has been on the shelf since yesterday, so simulated offline events happen after it existed. */
async function item(fields: Record<string, unknown>, quantity: number): Promise<string> {
  const base = { category: "SUPPLIES", unit: "piece", status: "ACTIVE", storageLocation: "Shelf B", reorderThreshold: 0, needsReview: false, notes: "private staff note", selfService: true };
  const response = await staff("/api/staff/items", "POST", { ...base, ...fields, openingQuantity: 0 });
  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };
  sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status)
    VALUES(?, ?, 'OPENING_BALANCE', 'IN', ?, ?, 'piece', ?, 'POSTED')`).run(`MOV-${crypto.randomUUID()}`, new Date(Date.now() - 24 * 60 * MINUTE).toISOString(), id, quantity, quantity);
  return id;
}
const consumable = (name: string, quantity: number, extra = {}) => item({ name, itemType: "Consumable", lendingAudience: "NOT_AVAILABLE_FOR_LENDING", ...extra }, quantity);
const loanable = (name: string, quantity: number, extra = {}) => item({ name, itemType: "Loanable", lendingAudience: "STUDENTS_AND_USC_STAFF", ...extra }, quantity);

/** One simulated phone: its own device id and local sequence. */
function phone() {
  const deviceId = crypto.randomUUID();
  let seq = 0;
  const event = (type: string, itemId: string, fields: Record<string, unknown> = {}, minutesAgo = 0) => ({
    v: 1, id: crypto.randomUUID(), seq: ++seq, type, itemId, quantity: 1, occurredAt: new Date(Date.now() - minutesAgo * MINUTE).toISOString(),
    catalogRevision: 1, person: { name: "Juan Dela Cruz", studentId: "20-1234-567" }, ...fields
  });
  return {
    deviceId,
    take: (itemId: string, quantity: number, minutesAgo = 0) => event("TAKE", itemId, { quantity }, minutesAgo),
    borrow: (itemId: string, minutesAgo = 0, fields: Record<string, unknown> = {}) => event("BORROW", itemId, { purpose: "INDIVIDUAL", ...fields }, minutesAgo),
    giveBack: (itemId: string, loanEventId: string | null, minutesAgo = 0, fields: Record<string, unknown> = {}) => event("RETURN", itemId, { loanEventId, outcome: "RETURNED", ...fields }, minutesAgo),
    sync: async (events: Array<Record<string, unknown>>, options: { photoFor?: string[]; origin?: string; sentAt?: string } = {}) => {
      const form = new FormData();
      form.set("batch", JSON.stringify({ deviceId, sentAt: options.sentAt ?? new Date().toISOString(), events }));
      const withPhoto = options.photoFor ?? events.filter((entry) => entry.type === "BORROW").map((entry) => entry.id as string);
      for (const id of withPhoto) form.set(`photo:${id}`, new File([JPEG], "photo.jpg", { type: "image/jpeg" }));
      // Serialised like a browser would, so the Worker sees a real Content-Length.
      const request = new Request(`${origin}/api/self-service/sync`, { method: "POST", headers: { origin: options.origin ?? origin }, body: form });
      const body = await request.arrayBuffer();
      return call("/api/self-service/sync", { method: "POST", headers: { origin: options.origin ?? origin, "content-type": request.headers.get("content-type")!, "content-length": String(body.byteLength) }, body });
    }
  };
}

async function results(response: Response): Promise<Result[]> {
  expect(response.status).toBe(200);
  return (await response.json() as { results: Result[] }).results;
}
const onHand = (id: string) => (sqlite.prepare("SELECT on_hand AS onHand FROM inventory_balances WHERE id = ?").get(id) as { onHand: number }).onHand;
const stored = (id: string) => sqlite.prepare("SELECT * FROM self_service_events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
const loan = (eventId: string) => sqlite.prepare("SELECT * FROM loans WHERE id = ?").get(`LN-SS-${eventId}`) as Record<string, unknown> | undefined;
const review = async () => await (await staff("/api/staff/self-service")).json() as { open: Array<Record<string, unknown>>; stockIssues: Array<Record<string, unknown>>; candidates: Array<{ id: string }> };
const resolve = (id: string, body: Record<string, unknown>) => staff(`/api/staff/self-service/${id}/resolve`, "POST", body);
async function count(itemId: string, observed: number) {
  const response = await staff(`/api/staff/items/${itemId}/movements`, "POST", { kind: "COUNT", quantity: observed, expectedOnHand: onHand(itemId), note: "Shelf count", key: crypto.randomUUID() });
  expect(response.status).toBe(200);
}

describe("self-service catalog", () => {
  it("offers only opted-in, eligible items with a minimal DTO, and fails closed", async () => {
    const water = await consumable("Bottled Water", 20);
    const scissors = await loanable("Scissors", 5, { aliases: "Gunting" });
    await consumable("Staff-only Toner", 3, { selfService: false });
    await consumable("Unreviewed Snack", 3, { needsReview: true });
    await loanable("Unlisted Projector", 1, { lendingAudience: "NOT_AVAILABLE_FOR_LENDING" });
    const response = await call("/api/self-service/catalog");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { items: Array<Record<string, unknown>>; serverTime: string; revision: number };
    expect(body.items).toEqual([
      { id: water, name: "Bottled Water", aliases: null, category: "SUPPLIES", unit: "piece", action: "TAKE", available: 20, location: "Shelf B", audience: null },
      { id: scissors, name: "Scissors", aliases: "Gunting", category: "SUPPLIES", unit: "piece", action: "BORROW", available: 5, location: "Shelf B", audience: "STUDENTS_AND_USC_STAFF" }
    ]);
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
    expect(JSON.stringify(body)).not.toContain("private staff note");
    const etag = response.headers.get("etag")!;
    expect((await call("/api/self-service/catalog", { headers: { "if-none-match": etag } })).status).toBe(304);
  });

  it("migrates every existing item to staff-only", () => {
    expect(sqlite.prepare("SELECT COUNT(*) AS total FROM items WHERE self_service = 1").get()).toEqual({ total: 0 });
  });
});

describe("Take", () => {
  it("records a take as a movement, and a replayed event never counts twice", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    const take = a.take(water, 2);
    expect(await results(await a.sync([take]))).toEqual([{ id: take.id, outcome: "accepted" }]);
    expect(await results(await a.sync([take]))).toEqual([{ id: take.id, outcome: "accepted", duplicate: true }]);
    expect(onHand(water)).toBe(18);
    const movements = sqlite.prepare("SELECT movement_type, reason, signed_quantity, actor_user_id, related_entity_type FROM inventory_movements WHERE related_entity_id = ?").all(take.id);
    expect(movements).toEqual([{ movement_type: "STOCK_OUT", reason: "CONSUMED", signed_quantity: -2, actor_user_id: "SELF_SERVICE", related_entity_type: "SELF_SERVICE" }]);
  });

  it("keeps every phone's takes, whatever order they arrive in: 20 − 2 − 1 − 3 = 14", async () => {
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const order of orders) {
      const water = await consumable(`Bottled Water ${order.join("")}`, 20);
      const phones = [phone(), phone(), phone()];
      const takes = [phones[0]!.take(water, 2, 50), phones[1]!.take(water, 1, 40), phones[2]!.take(water, 3, 30)];
      for (const index of order) expect((await results(await phones[index]!.sync([takes[index]!])))[0]!.outcome).toBe("accepted");
      expect(onHand(water)).toBe(14);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE item_id = ? AND related_entity_type = 'SELF_SERVICE'").get(water)).toEqual({ n: 3 });
    }
  });

  it("never loses a late take that overdraws stock: it is recorded and the item asks for a count", async () => {
    const water = await consumable("Bottled Water", 3);
    const [a, b] = [phone(), phone()];
    await a.sync([a.take(water, 2, 30)]);
    expect((await results(await b.sync([b.take(water, 2, 20)])))[0]!.outcome).toBe("accepted");
    expect(onHand(water)).toBe(-1);
    expect((await review()).stockIssues).toEqual([expect.objectContaining({ itemId: water, lowest: -1, onHand: -1 })]);
    // Staff stock outs keep their strict guard; a count clears the issue.
    expect((await staff(`/api/staff/items/${water}/movements`, "POST", { kind: "OUT", quantity: 1, reason: "CONSUMED", key: crypto.randomUUID() })).status).toBe(409);
    await count(water, 0);
    expect((await review()).stockIssues).toEqual([]);
  });

  it("holds more than an hour's self-service volume of one item for staff", async () => {
    const water = await consumable("Bottled Water", 100);
    const a = phone();
    expect((await results(await a.sync([a.take(water, 30)])))[0]!.outcome).toBe("accepted");
    const extra = a.take(water, 1);
    expect(await results(await a.sync([extra]))).toEqual([{ id: extra.id, outcome: "review", message: "Saved for staff to confirm: a lot of this item was recorded in the last hour." }]);
    expect(stored(extra.id)).toMatchObject({ applied: 0, review: "VOLUME" });
    expect(onHand(water)).toBe(70);
    expect((await resolve(extra.id, { action: "apply", note: "Sports fest" })).status).toBe(200);
    expect(onHand(water)).toBe(69);
    expect(stored(extra.id)).toMatchObject({ applied: 1, resolved_by: "ACC-1" });
  });

  it("treats a later physical count as having seen an earlier take, and flags a take right beside a count", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    const early = a.take(water, 2, 60);
    await count(water, 18);
    expect(await results(await a.sync([early]))).toEqual([{ id: early.id, outcome: "accepted" }]);
    expect(onHand(water)).toBe(18);
    expect(sqlite.prepare("SELECT status FROM inventory_movements WHERE related_entity_id = ?").get(early.id)).toEqual({ status: "SUPERSEDED" });
    const beside = a.take(water, 1, 3);
    expect((await results(await a.sync([beside])))[0]).toMatchObject({ outcome: "review" });
    expect(stored(beside.id)).toMatchObject({ review: "COUNT_OVERLAP" });
    expect(onHand(water)).toBe(17);
  });

  it("refuses an ineligible take while the person is there, and holds a late one without applying it", async () => {
    const toner = await consumable("Toner", 5, { selfService: false });
    const a = phone();
    const live = a.take(toner, 1);
    expect(await results(await a.sync([live]))).toEqual([{ id: live.id, outcome: "rejected", message: "This item is not available for self-service right now. Please ask Logistics staff." }]);
    expect(stored(live.id)).toBeUndefined();
    // Claiming an earlier time never unlocks a staff-only item: the record waits for staff.
    const late = a.take(toner, 1, 45);
    expect((await results(await a.sync([late])))[0]!.outcome).toBe("review");
    expect(stored(late.id)).toMatchObject({ applied: 0, review: "NOT_ELIGIBLE" });
    expect(onHand(toner)).toBe(5);
    expect((await resolve(late.id, { action: "dismiss", note: "Not taken" })).status).toBe(200);
    expect(onHand(toner)).toBe(5);
  });
});

describe("Borrow and Return", () => {
  it("lends offline with the Part 4 rules and a photo in R2 that only staff can open", async () => {
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    // "Return by today", judged on the Manila calendar of the day it was borrowed.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() - 30 * MINUTE));
    const borrow = a.borrow(scissors, 30, { returnBy: today });
    expect(await results(await a.sync([borrow]))).toEqual([{ id: borrow.id, outcome: "accepted" }]);
    expect(loan(borrow.id)).toMatchObject({ status: "OUT", purpose: "INDIVIDUAL", student_id: "20-1234-567", created_by: "SELF_SERVICE" });
    expect([...photos.keys()]).toEqual([expect.stringMatching(new RegExp(`^loans/LN-SS-${borrow.id}-[0-9a-f]{8}$`))]);
    expect((await call(`/api/staff/loans/LN-SS-${borrow.id}/photo`)).status).toBe(401);
    const photo = await staff(`/api/staff/loans/LN-SS-${borrow.id}/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("cache-control")).toBe("private, no-store");
    const overview = await (await staff("/api/staff/loans")).json() as { open: Array<{ id: string; createdBy: string }> };
    expect(overview.open).toEqual([expect.objectContaining({ id: `LN-SS-${borrow.id}`, createdBy: "Self-service" })]);
    expect(onHand(scissors)).toBe(4);
  });

  it("applies the Part 4 identity rules: Individual needs a student ID, USC use a reason; USC-only items refuse individual use", async () => {
    const scissors = await loanable("Scissors", 5);
    const projector = await loanable("Projector", 1, { lendingAudience: "USC_STAFF_ONLY" });
    const a = phone();
    const noId = a.borrow(scissors, 0, { person: { name: "Ana" } });
    const noReason = a.borrow(scissors, 0, { purpose: "USC", person: { name: "Ana" } });
    const individual = a.borrow(projector);
    const usc = a.borrow(projector, 0, { purpose: "USC", reason: "Stage setup for the general assembly", person: { name: "Ana" } });
    expect((await results(await a.sync([noId, noReason, individual, usc]))).map((result) => [result.outcome, result.message])).toEqual([
      ["rejected", "Student ID number is required."],
      ["rejected", "Specific reason is required."],
      ["rejected", "This item is lent for USC use only."],
      ["accepted", undefined]
    ]);
  });

  it("returns a loan from the same phone, in business order even when another phone syncs first", async () => {
    const scissors = await loanable("Scissors", 1);
    const [a, b] = [phone(), phone()];
    const aBorrow = a.borrow(scissors, 60);
    const aReturn = a.giveBack(scissors, aBorrow.id, 30);
    const bBorrow = b.borrow(scissors, 25);
    const bReturn = b.giveBack(scissors, bBorrow.id, 5);
    expect((await results(await b.sync([bBorrow, bReturn]))).map((result) => result.outcome)).toEqual(["accepted", "accepted"]);
    expect((await results(await a.sync([aBorrow, aReturn]))).map((result) => result.outcome)).toEqual(["accepted", "accepted"]);
    expect(onHand(scissors)).toBe(1);
    expect(loan(aBorrow.id)).toMatchObject({ status: "RETURNED", closed_by: "SELF_SERVICE" });
    expect(loan(bBorrow.id)).toMatchObject({ status: "RETURNED" });
    const detail = await (await staff(`/api/staff/items/${scissors}`)).json() as { movements: Array<{ movementType: string; afterQuantity: number; borrower: string; actor: string }> };
    // Newest first, by when it happened (not by when it synced), with before/after rebuilt in that order.
    expect(detail.movements.slice(0, 4).map((movement) => [movement.movementType, movement.afterQuantity])).toEqual([["LOAN_RETURN", 1], ["LOAN_OUT", 0], ["LOAN_RETURN", 1], ["LOAN_OUT", 0]]);
    expect(detail.movements[0]).toMatchObject({ borrower: "Juan Dela Cruz", actor: "Self-service" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM self_service_events WHERE review IS NOT NULL").get()).toEqual({ n: 0 });
    expect((await review()).stockIssues).toEqual([]);
  });

  it("allows overlapping loans that fit, and flags only an impossible overlap", async () => {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    expect((await results(await a.sync([a.borrow(scissors, 30)])))[0]!.outcome).toBe("accepted");
    expect((await results(await b.sync([b.borrow(scissors, 20)])))[0]!.outcome).toBe("accepted");
    expect((await review()).stockIssues).toEqual([]);
    const tape = await loanable("Tape Gun", 1);
    const [c, d] = [phone(), phone()];
    await c.sync([c.borrow(tape, 30)]);
    const second = d.borrow(tape, 20);
    expect((await results(await d.sync([second])))[0]!.outcome).toBe("accepted");
    expect(loan(second.id)).toMatchObject({ status: "OUT" });
    expect((await review()).stockIssues).toEqual([expect.objectContaining({ itemId: tape, lowest: -1, openLoans: 2 })]);
  });

  it("keeps damaged and lost items off the shelf and needs a note for them", async () => {
    const scissors = await loanable("Scissors", 2);
    const a = phone();
    const [one, two] = [a.borrow(scissors, 40), a.borrow(scissors, 39)];
    await a.sync([one, two]);
    const noNote = a.giveBack(scissors, one.id, 10, { outcome: "DAMAGED" });
    const damaged = a.giveBack(scissors, one.id, 9, { outcome: "DAMAGED", note: "Blade bent" });
    const lost = a.giveBack(scissors, two.id, 8, { outcome: "LOST", note: "Left at the gym" });
    expect((await results(await a.sync([noNote, damaged, lost]))).map((result) => [result.outcome, result.message])).toEqual([["rejected", "The damage is required."], ["accepted", undefined], ["accepted", undefined]]);
    expect([loan(one.id)!.status, loan(two.id)!.status, onHand(scissors)]).toEqual(["DAMAGED", "LOST", 0]);
  });

  it("matches a return from another phone only when it is clearly one loan, without revealing which", async () => {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    const borrow = a.borrow(scissors, 60);
    await a.sync([borrow]);
    const matched = b.giveBack(scissors, null, 10);
    const stranger = b.giveBack(scissors, null, 9, { person: { name: "Someone Else", studentId: "99-9999-999" } });
    const matchedResult = (await results(await b.sync([matched])))[0]!;
    const strangerResult = (await results(await b.sync([stranger])))[0]!;
    expect(matchedResult).toEqual({ id: matched.id, outcome: "accepted" });
    expect(strangerResult).toEqual({ id: stranger.id, outcome: "accepted", message: "Return recorded. Logistics will match it to the loan." });
    expect(loan(borrow.id)).toMatchObject({ status: "RETURNED" });
    expect(stored(stranger.id)).toMatchObject({ applied: 0, review: "UNMATCHED_RETURN" });
    expect(onHand(scissors)).toBe(5);
  });

  it("never lets a linked return from another phone close someone else's loan", async () => {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    const borrow = a.borrow(scissors, 60, { person: { name: "Maria", studentId: "21-0000-001" } });
    await a.sync([borrow]);
    const forged = b.giveBack(scissors, borrow.id, 5, { person: { name: "Mallory", studentId: "21-0000-002" } });
    await b.sync([forged]);
    expect(loan(borrow.id)).toMatchObject({ status: "OUT" });
    expect(stored(forged.id)).toMatchObject({ review: "UNMATCHED_RETURN", applied: 0 });
  });

  it("lets staff match an unmatched return to an open loan, closing it when the return happened", async () => {
    const scissors = await loanable("Scissors", 5);
    const [a, b] = [phone(), phone()];
    const borrow = a.borrow(scissors, 60, { person: { name: "Maria Santos", studentId: "21-0000-001" } });
    await a.sync([borrow]);
    const unmatched = b.giveBack(scissors, null, 15, { person: { name: "M. Santos" } });
    await b.sync([unmatched]);
    const queue = await review();
    expect(queue.open.map((entry) => [entry.id, entry.review])).toEqual([[unmatched.id, "UNMATCHED_RETURN"]]);
    expect(queue.candidates.map((entry) => entry.id)).toEqual([`LN-SS-${borrow.id}`]);
    expect((await call(`/api/staff/self-service/${unmatched.id}/resolve`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    const resolved = await resolve(unmatched.id, { action: "match", loanId: `LN-SS-${borrow.id}`, note: "Same person" });
    expect(resolved.status).toBe(200);
    expect(loan(borrow.id)).toMatchObject({ status: "RETURNED", closed_at: stored(unmatched.id)!.occurred_at });
    expect(stored(unmatched.id)).toMatchObject({ applied: 1, resolved_by: "ACC-1", resolution_note: "Same person" });
    expect(onHand(scissors)).toBe(5);
  });

  it("stops a batch at the first transient failure so a return is never processed before its borrow", async () => {
    const scissors = await loanable("Scissors", 5);
    const a = phone();
    const borrow = a.borrow(scissors, 20);
    const giveBack = a.giveBack(scissors, borrow.id, 10);
    const put = env.EVIDENCE.put;
    env.EVIDENCE.put = async () => { throw new Error("R2 unavailable"); };
    expect((await results(await a.sync([borrow, giveBack]))).map((result) => result.outcome)).toEqual(["retry", "retry"]);
    expect([stored(borrow.id), stored(giveBack.id), loan(borrow.id)]).toEqual([undefined, undefined, undefined]);
    env.EVIDENCE.put = put;
    expect((await results(await a.sync([borrow, giveBack]))).map((result) => result.outcome)).toEqual(["accepted", "accepted"]);
    expect(photos.size).toBe(1);
  });

  it("refuses a borrow without a valid photo, keeps a held borrow's photo for staff, and deletes it when dismissed", async () => {
    const scissors = await loanable("Scissors", 5);
    const drill = await loanable("Drill", 1, { selfService: false });
    const a = phone();
    const late = a.borrow(scissors, 30);
    expect((await results(await a.sync([late], { photoFor: [] })))[0]).toMatchObject({ outcome: "rejected", message: "A photo is required. Take the photo again and borrow once more." });
    const held = a.borrow(drill, 30);
    expect((await results(await a.sync([held])))[0]!.outcome).toBe("review");
    expect(stored(held.id)).toMatchObject({ applied: 0, review: "NOT_ELIGIBLE" });
    expect((await staff(`/api/staff/self-service/${held.id}/photo`)).status).toBe(200);
    expect((await call(`/api/staff/self-service/${held.id}/photo`)).status).toBe(401);
    expect(photos.size).toBe(1);
    expect((await resolve(held.id, { action: "dismiss" })).status).toBe(200);
    expect(photos.size).toBe(0);
    expect(onHand(drill)).toBe(1);
  });
});

describe("self-service security", () => {
  it("rejects cross-origin, malformed and oversized sync requests", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    expect((await a.sync([a.take(water, 1)], { origin: "https://evil.example" })).status).toBe(403);
    expect((await a.sync([])).status).toBe(400);
    expect((await a.sync(Array.from({ length: 6 }, () => a.take(water, 1)))).status).toBe(400);
    const bad = [
      { ...a.take(water, 1), id: "not-a-uuid" },
      { ...a.take(water, 0) },
      { ...a.take(water, 51) },
      { ...a.take(water, 1), quantity: 1.5 },
      { ...a.take(water, 1), type: "DELETE" },
      { ...a.take(water, 1), itemId: "ITM-9999" },
      { ...a.take(water, 1), v: 2 },
      { ...a.take(water, 1), person: { name: "  " } }
    ];
    const outcomes = [...await results(await a.sync(bad.slice(0, 4))), ...await results(await a.sync(bad.slice(4)))];
    expect(outcomes.map((result) => result.outcome)).toEqual(Array(8).fill("rejected"));
    expect(onHand(water)).toBe(20);
  });

  it("stores hostile text as plain text, and holds a record whose clock cannot be trusted", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    const hostile = { ...a.take(water, 1), person: { name: "<img src=x onerror=alert(1)>\u0000\u202e Bob" }, occurredAt: "2099-01-01T00:00:00.000Z" };
    expect((await results(await a.sync([hostile])))[0]).toMatchObject({ outcome: "review", message: "Saved for staff to confirm: your phone's clock looked wrong." });
    expect(stored(hostile.id)).toMatchObject({ person_name: "<img src=x onerror=alert(1)> Bob", review: "CLOCK", applied: 0 });
    expect(onHand(water)).toBe(20);
  });

  it("corrects a wrong phone clock by the send time on the same clock", async () => {
    const water = await consumable("Bottled Water", 20);
    const a = phone();
    // The phone runs 3 hours slow: it recorded the take 40 minutes before it sent it.
    const slow = (ms: number) => new Date(ms - 3 * 60 * MINUTE).toISOString();
    const take = { ...a.take(water, 1), occurredAt: slow(Date.now() - 40 * MINUTE) };
    await a.sync([take], { sentAt: slow(Date.now()) });
    const row = stored(take.id)!;
    expect(Math.abs(Date.parse(row.received_at as string) - Date.parse(row.occurred_at as string) - 40 * MINUTE)).toBeLessThan(2000);
    expect(row.review).toBeNull();
  });

  it("rate-limits one phone and keeps the review API staff-only", async () => {
    const water = await consumable("Bottled Water", 500);
    const a = phone();
    for (let round = 0; round < 20; round += 1) expect((await a.sync(Array.from({ length: 5 }, () => a.take(water, 1)))).status).toBe(200);
    expect((await a.sync([a.take(water, 1)])).status).toBe(429);
    expect((await call("/api/staff/self-service")).status).toBe(401);
  });
});
