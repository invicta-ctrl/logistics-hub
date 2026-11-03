// V1.16.7 durable retention: deterministic D1/R2 failure and commit-order regressions.
// This stand-in models R2 atomic If-None-Match:* at the moment the PUT commits.
import { describe, expect, it } from "vitest";
// Errors are asserted by their public status without assuming an internal exception class.
import { loanThumb, saveLoanThumb } from "../src/loans";
import { eraseOldDetails } from "../src/retention";
import { memoryR2, migratedD1 } from "./d1-sqlite";
import type { Account } from "../src/accounts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const owner: Account = { accountId: "OWNER1", sessionId: "session", username: "owner", displayName: "Owner", role: "OWNER", mustChangePassword: false };
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const thumbRequest = () => new Request("https://hub.test/thumb", { method: "PUT", headers: { "content-type": "image/jpeg" }, body: JPEG });

function fixture(id = "LN-TEST", closedDaysAgo = 800) {
  const { d1, sqlite } = migratedD1();
  const { bucket, objects } = memoryR2();
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES (?, 'owner', 'Owner', 'x', 'OWNER')").run(owner.accountId);
  sqlite.prepare("INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status) VALUES (?, ?, 'OPENING_BALANCE', 'IN', 'ITM-0001', 1, 'piece', 1, 'POSTED')").run(`MOV-${id}`, ago(900));
  sqlite.prepare("INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, status, movement_id, created_at, created_by, closed_at, closed_by) VALUES (?, 'ITM-0001', 1, 'INDIVIDUAL', 'Borrower', '20-0001-001', ?, 'RETURNED', ?, ?, ?, ?, ?)").run(id, `loans/${id}`, `MOV-${id}`, ago(900), owner.accountId, ago(closedDaysAgo), owner.accountId);
  objects.set(`loans/${id}`, { bytes: JPEG, contentType: "image/jpeg" });
  const key = `loans/${id}`;
  const auditCount = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'RETENTION_ERASED'").get() as { n: number }).n;
  const state = () => sqlite.prepare("SELECT photo_key AS photoKey FROM loans WHERE id = ?").get(id) as { photoKey: string };
  const queue = () => sqlite.prepare("SELECT completed_at AS completedAt FROM retention_photo_cleanup WHERE photo_key = ?").get(key) as { completedAt: string | null } | undefined;
  return { d1, sqlite, bucket, objects, id, key, auditCount, state, queue };
}

describe("V1.16.7 durable thumbnail erasure", () => {
  it("creates a JPEG once and serves it with no-store even for a legacy photo", async () => {
    const f = fixture("LN-SAVE", 10);
    expect((await saveLoanThumb(f.d1, f.bucket, f.id, thumbRequest())).status).toBe(204);
    const different = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 9]);
    expect((await saveLoanThumb(f.d1, f.bucket, f.id, new Request("https://hub.test/thumb", { method: "PUT", headers: { "content-type": "image/jpeg" }, body: different }))).status).toBe(204);
    const result = await loanThumb(f.d1, f.bucket, f.id);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(JPEG);
  });

  it("retention wins first: delayed conditional JPEG cannot resurrect an erased photo", async () => {
    const f = fixture("LN-LATE");
    const realPut = f.bucket.put.bind(f.bucket);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    (f.bucket as unknown as { put: R2Bucket["put"] }).put = (async (key: string, body: unknown, options?: unknown) => {
      if (key.endsWith(".thumb") && (options as { onlyIf?: Headers } | undefined)?.onlyIf) { entered(); await waiting; }
      return (realPut as (...args: unknown[]) => Promise<unknown>)(key, body, options);
    }) as R2Bucket["put"];
    const delayedSave = saveLoanThumb(f.d1, f.bucket, f.id, thumbRequest());
    await ready;
    const done = await eraseOldDetails(f.d1, f.bucket, owner);
    expect(done).toMatchObject({ loans: 1, photos: 1 });
    release();
    await expect(delayedSave).rejects.toMatchObject({ status: 409 });
    expect(f.objects.has(f.key)).toBe(false);
    expect(f.objects.get(`${f.key}.thumb`)).toMatchObject({ bytes: new Uint8Array(), customMetadata: { retentionErased: "1" } });
    await expect(loanThumb(f.d1, f.bucket, f.id)).rejects.toMatchObject({ status: 404 });
    expect(f.state().photoKey).toBe("");
    expect(f.queue()?.completedAt).toBeTruthy();
  });

  it("JPEG wins first: retention overwrites the sensitive bytes and blocks future saves", async () => {
    const f = fixture("LN-FIRST");
    await saveLoanThumb(f.d1, f.bucket, f.id, thumbRequest());
    await eraseOldDetails(f.d1, f.bucket, owner);
    expect(f.objects.get(`${f.key}.thumb`)?.bytes).toHaveLength(0);
    expect(f.objects.get(`${f.key}.thumb`)?.customMetadata?.retentionErased).toBe("1");
    await expect(saveLoanThumb(f.d1, f.bucket, f.id, thumbRequest())).rejects.toMatchObject({ status: 409 });
    expect(f.auditCount()).toBe(1);
  });

  it("a tombstone refuses a late save even while the D1 reference is still due", async () => {
    const f = fixture("LN-MARKED");
    const realDelete = f.bucket.delete.bind(f.bucket);
    let fail = true;
    (f.bucket as unknown as { delete: R2Bucket["delete"] }).delete = (async (key: string) => {
      if (key === f.key && fail) { fail = false; throw new Error("original delete failed"); }
      return realDelete(key);
    }) as R2Bucket["delete"];
    await expect(eraseOldDetails(f.d1, f.bucket, owner)).rejects.toThrow(/original delete failed/);
    expect(f.state().photoKey).toBe(f.key);
    expect(f.queue()?.completedAt).toBeNull();
    await expect(saveLoanThumb(f.d1, f.bucket, f.id, thumbRequest())).rejects.toMatchObject({ status: 409 });
    await eraseOldDetails(f.d1, f.bucket, owner);
    expect(f.state().photoKey).toBe("");
    expect(f.queue()?.completedAt).toBeTruthy();
  });

  it("R2 marker failure leaves the original and identity due; retry completes", async () => {
    const f = fixture("LN-R2FAIL");
    const realPut = f.bucket.put.bind(f.bucket);
    let fail = true;
    (f.bucket as unknown as { put: R2Bucket["put"] }).put = (async (key: string, body: unknown, options?: unknown) => {
      if (key === `${f.key}.thumb` && fail) { fail = false; throw new Error("marker failed"); }
      return (realPut as (...args: unknown[]) => Promise<unknown>)(key, body, options);
    }) as R2Bucket["put"];
    await expect(eraseOldDetails(f.d1, f.bucket, owner)).rejects.toThrow(/marker failed/);
    expect(f.objects.has(f.key)).toBe(true);
    expect(f.state().photoKey).toBe(f.key);
    expect(f.auditCount()).toBe(0);
    expect(f.queue()?.completedAt).toBeNull();
    await eraseOldDetails(f.d1, f.bucket, owner);
    expect(f.state().photoKey).toBe("");
    expect(f.auditCount()).toBe(1);
  });

  it("D1 final-batch failure leaves retryable journal and due record after R2 cleanup", async () => {
    const f = fixture("LN-D1FAIL");
    const realBatch = f.d1.batch.bind(f.d1);
    let calls = 0;
    (f.d1 as unknown as { batch: D1Database["batch"] }).batch = (async (statements: D1PreparedStatement[]) => {
      if (++calls === 3) throw new Error("D1 unavailable at finalize");
      return realBatch(statements);
    }) as D1Database["batch"];
    await expect(eraseOldDetails(f.d1, f.bucket, owner)).rejects.toThrow(/D1 unavailable/);
    expect(f.objects.has(f.key)).toBe(false);
    expect(f.objects.get(`${f.key}.thumb`)?.bytes).toHaveLength(0);
    expect(f.state().photoKey).toBe(f.key);
    expect(f.queue()?.completedAt).toBeNull();
    expect(f.auditCount()).toBe(0);
    await eraseOldDetails(f.d1, f.bucket, owner);
    expect(f.state().photoKey).toBe("");
    expect(f.queue()?.completedAt).toBeTruthy();
    expect(f.auditCount()).toBe(1);
  });

  it("preserves a photo still held by a non-due phone event", async () => {
    const f = fixture("LN-SHARED");
    const at = ago(10);
    f.sqlite.prepare("INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, photo_key, device_time, sent_at, occurred_at, received_at, applied, loan_id) VALUES ('SS1','dev',1,'BORROW','ITM-0001',1,'Borrower','20-0001-001',?,?,?,?,?,1,?)").run(f.key, at, at, at, at, f.id);
    await eraseOldDetails(f.d1, f.bucket, owner);
    expect(f.objects.has(f.key)).toBe(true);
    expect(f.objects.has(`${f.key}.thumb`)).toBe(false);
    expect(f.queue()).toBeUndefined();
    expect(f.state().photoKey).toBe("");
    expect(f.auditCount()).toBe(1);
  });

  it("a pending-only journal stays visible and is drained after all identities are already cleared", async () => {
    const f = fixture("LN-PENDING");
    f.sqlite.prepare("UPDATE loans SET photo_key = '', borrower_name = '[removed]', student_id = '[removed]' WHERE id = ?").run(f.id);
    f.sqlite.prepare("INSERT INTO retention_photo_cleanup(photo_key, queued_at) VALUES (?, ?)").run(f.key, ago(1));
    const { retentionPreview } = await import("../src/retention");
    expect(await retentionPreview(f.d1)).toEqual({ loans: 0, phoneRecords: 0, photos: 1 });
    const outcome = await eraseOldDetails(f.d1, f.bucket, owner);
    expect(outcome).toEqual({ loans: 0, phoneRecords: 0, photos: 0, more: false });
    expect(f.objects.has(f.key)).toBe(false);
    expect(f.objects.get(`${f.key}.thumb`)?.customMetadata?.retentionErased).toBe("1");
    expect(f.queue()?.completedAt).toBeTruthy();
    expect(f.auditCount()).toBe(0);
  });

  it("two simultaneous conditional creates preserve exactly one thumbnail payload", async () => {
    const f = fixture("LN-DOUBLE", 10);
    const alternate = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 9, 8]);
    const second = new Request("https://hub.test/thumb", { method: "PUT", headers: { "content-type": "image/jpeg" }, body: alternate });
    const results = await Promise.all([saveLoanThumb(f.d1, f.bucket, f.id, thumbRequest()), saveLoanThumb(f.d1, f.bucket, f.id, second)]);
    expect(results.map((result) => result.status)).toEqual([204, 204]);
    expect(f.objects.get(`${f.key}.thumb`)?.bytes).toEqual(JPEG);
  });

  it("unexpected thumbnail metadata fails closed", async () => {
    const f = fixture("LN-UNKNOWN", 10);
    f.objects.set(`${f.key}.thumb`, { bytes: JPEG, contentType: "image/jpeg", customMetadata: { unexpected: "value" } });
    await expect(saveLoanThumb(f.d1, f.bucket, f.id, thumbRequest())).rejects.toMatchObject({ status: 409 });
    await expect(loanThumb(f.d1, f.bucket, f.id)).rejects.toMatchObject({ status: 404 });
  });

  it("D1 journal failure prevents every R2 operation and preserves due identities", async () => {
    const f = fixture("LN-JOURNAL");
    const realBatch = f.d1.batch.bind(f.d1);
    let calls = 0;
    (f.d1 as unknown as { batch: D1Database["batch"] }).batch = (async (statements: D1PreparedStatement[]) => {
      if (++calls === 2) throw new Error("journal unavailable");
      return realBatch(statements);
    }) as D1Database["batch"];
    await expect(eraseOldDetails(f.d1, f.bucket, owner)).rejects.toThrow(/journal unavailable/);
    expect(f.queue()).toBeUndefined();
    expect(f.state().photoKey).toBe(f.key);
    expect(f.objects.has(f.key)).toBe(true);
    expect(f.objects.has(`${f.key}.thumb`)).toBe(false);
    await eraseOldDetails(f.d1, f.bucket, owner);
    expect(f.queue()?.completedAt).toBeTruthy();
  });

  it("the D1 journal blocks later reuse of a queued key", async () => {
    const f = fixture("LN-QUEUED");
    const realPut = f.bucket.put.bind(f.bucket);
    (f.bucket as unknown as { put: R2Bucket["put"] }).put = (async () => { throw new Error("R2 offline"); }) as R2Bucket["put"];
    await expect(eraseOldDetails(f.d1, f.bucket, owner)).rejects.toThrow(/R2 offline/);
    expect(f.queue()?.completedAt).toBeNull();
    expect(() => f.sqlite.prepare("UPDATE loans SET photo_key = ? WHERE id = ?").run("", f.id)).not.toThrow();
    expect(() => f.sqlite.prepare("UPDATE loans SET photo_key = ? WHERE id = ?").run(f.key, f.id)).toThrow(/photo_retention_queued/);
    const at = ago(5);
    f.sqlite.prepare("INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, device_time, sent_at, occurred_at, received_at, applied) VALUES ('SS-LATE','dev',1,'TAKE','ITM-0001',1,'Borrower',?,?,?,?,1)").run(at, at, at, at);
    expect(() => f.sqlite.prepare("UPDATE self_service_events SET photo_key = ? WHERE id = 'SS-LATE'").run(f.key)).toThrow(/photo_retention_queued/);
    (f.bucket as unknown as { put: R2Bucket["put"] }).put = realPut;
  });
});
