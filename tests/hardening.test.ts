// Accepted amendment docs/specs/accepted/2026-10-03-review-hardening-amendment.md: regressions for the review's findings,
// run on the real migrated schema. Concurrency is two requests started together; the D1 stand-in, like D1, runs each
// batch as one transaction, so the requests interleave exactly at their awaits.
import { describe, expect, it } from "vitest";
import { recoverOwner, revokeRecoveryKey, rotateRecoveryKey, updateAccount, type Account } from "../src/accounts";
import { verifyPassword } from "../src/session";
import { eraseOldDetails, retentionPreview } from "../src/retention";
import { createLoan } from "../src/loans";
import { InputError } from "../src/inventory";
import { recentActivity } from "../src/stock";
import { memoryR2, migratedD1 } from "./d1-sqlite";
import { REFERENCE_RECENT_ACTIVITY, syntheticLedger } from "./stock-activity-reference";

type Sqlite = ReturnType<typeof migratedD1>["sqlite"];
const owner = (id: string): Account => ({ accountId: id, sessionId: `S-${id}-self`, username: id, displayName: id, role: "OWNER", mustChangePassword: false });
const count = (sqlite: Sqlite, sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;

/** Runs `rival` to completion just before the next D1 batch starts: a deterministic "someone else got there first". */
function beforeNextBatch(d1: D1Database, rival: () => Promise<unknown>) {
  const real = d1.batch.bind(d1);
  let armed = true;
  (d1 as unknown as { batch: D1Database["batch"] }).batch = (async (statements: D1PreparedStatement[]) => {
    if (armed) { armed = false; await rival(); }
    return real(statements);
  }) as D1Database["batch"];
}

function seedAccounts(sqlite: Sqlite, accounts: Array<[string, string]>) {
  for (const [id, role] of accounts) {
    sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role, active) VALUES(?, ?, ?, 'x', ?, 1)").run(id, `user-${id.toLowerCase()}`, id, role);
    sqlite.prepare("INSERT INTO staff_sessions(id, expires_at, account_id) VALUES(?, 9999999999999, ?)").run(`S-${id}`, id);
  }
}

describe("R1: the last active Owner", () => {
  const races: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["disable each other", { active: false }, { active: false }],
    ["demote each other", { role: "ADMIN" }, { role: "ADMIN" }],
    ["one demotes while the other disables", { role: "STAFF" }, { active: false }]
  ];
  for (const [name, first, second] of races) {
    it(`two Owners who ${name} at once: one wins, the other is refused and changes nothing`, async () => {
      const { d1, sqlite } = migratedD1();
      seedAccounts(sqlite, [["O1", "OWNER"], ["O2", "OWNER"]]);
      const results = await Promise.allSettled([updateAccount(d1, owner("O1"), "O2", first), updateAccount(d1, owner("O2"), "O1", second)]);
      expect(count(sqlite, "SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'OWNER' AND active = 1")).toBe(1);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(InputError);
      expect(lost.reason).toMatchObject({ status: 409 });
      // Only the winner's change is audited, and only the changed account's sessions ended.
      expect(count(sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ACCOUNT_UPDATED'")).toBe(1);
      const survivor = sqlite.prepare("SELECT id FROM staff_accounts WHERE role = 'OWNER' AND active = 1").get() as { id: string };
      expect(count(sqlite, `SELECT COUNT(*) AS n FROM staff_sessions WHERE account_id = '${survivor.id}' AND revoked_at IS NULL`)).toBe(1);
    });
  }

  it("the database itself refuses to remove the last active Owner, by update or delete", () => {
    const { sqlite } = migratedD1();
    seedAccounts(sqlite, [["O1", "OWNER"], ["A1", "ADMIN"]]);
    expect(() => sqlite.exec("UPDATE staff_accounts SET active = 0 WHERE id = 'O1'")).toThrow(/last_active_owner/);
    expect(() => sqlite.exec("UPDATE staff_accounts SET role = 'ADMIN' WHERE id = 'O1'")).toThrow(/last_active_owner/);
    expect(() => sqlite.exec("DELETE FROM staff_sessions WHERE account_id = 'O1'; DELETE FROM staff_accounts WHERE id = 'O1'")).toThrow(/last_active_owner/);
    // Everything else about the Owner, and every other account, still changes freely.
    sqlite.exec("UPDATE staff_accounts SET display_name = 'Renamed', password_hash = 'y' WHERE id = 'O1'");
    sqlite.exec("UPDATE staff_accounts SET active = 0 WHERE id = 'A1'");
  });

  it("bootstrapping still works: with no Owner yet, accounts are created and changed, and the first Owner can be added", () => {
    const { sqlite } = migratedD1();
    seedAccounts(sqlite, [["S1", "STAFF"]]);
    sqlite.exec("UPDATE staff_accounts SET active = 0 WHERE id = 'S1'");
    sqlite.exec("UPDATE staff_accounts SET role = 'OWNER', active = 1 WHERE id = 'S1'");
    seedAccounts(sqlite, [["O2", "OWNER"]]);
    // With two Owners, one may step down.
    sqlite.exec("UPDATE staff_accounts SET active = 0 WHERE id = 'S1'");
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'OWNER' AND active = 1")).toBe(1);
  });
});

describe("R2: a recovery key works once", () => {
  const passwordOf = (sqlite: Sqlite, id: string) => (sqlite.prepare("SELECT password_hash AS hash FROM staff_accounts WHERE id = ?").get(id) as { hash: string }).hash;
  const used = (sqlite: Sqlite) => count(sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'OWNER_RECOVERY_USED'");

  it("used twice at once: exactly one wins, only its password works, the other changes nothing", async () => {
    const { d1, sqlite } = migratedD1();
    seedAccounts(sqlite, [["O1", "OWNER"]]);
    const { recoveryKey } = await rotateRecoveryKey(d1, owner("O1"));
    const results = await Promise.allSettled([recoverOwner(d1, { recoveryKey, newPassword: "first pass 12345" }), recoverOwner(d1, { recoveryKey, newPassword: "second pass 45678" })]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 401 });
    expect(used(sqlite)).toBe(1);
    const winner = results[0]!.status === "fulfilled" ? "first pass 12345" : "second pass 45678";
    const loser = winner === "first pass 12345" ? "second pass 45678" : "first pass 12345";
    expect(await verifyPassword(winner, passwordOf(sqlite, "O1"))).toBe(true);
    expect(await verifyPassword(loser, passwordOf(sqlite, "O1"))).toBe(false);
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM owner_recovery_keys WHERE revoked_at IS NULL")).toBe(0);
  });

  const rivals: Array<[string, (d1: D1Database, sqlite: Sqlite) => Promise<unknown>]> = [
    ["the owner issued a new key", (d1) => rotateRecoveryKey(d1, owner("O1"))],
    ["the owner revoked the key", (d1) => revokeRecoveryKey(d1, owner("O1"))],
    ["another owner demoted this one", (d1) => updateAccount(d1, owner("O2"), "O1", { role: "ADMIN" })]
  ];
  for (const [name, rival] of rivals) {
    it(`refused, changing nothing, when ${name} just before it was used`, async () => {
      const { d1, sqlite } = migratedD1();
      seedAccounts(sqlite, [["O1", "OWNER"], ["O2", "OWNER"]]);
      const { recoveryKey } = await rotateRecoveryKey(d1, owner("O1"));
      const before = passwordOf(sqlite, "O1");
      beforeNextBatch(d1, () => rival(d1, sqlite));
      await expect(recoverOwner(d1, { recoveryKey, newPassword: "late pass 789012" })).rejects.toMatchObject({ status: 401 });
      expect(passwordOf(sqlite, "O1")).toBe(before);
      expect(used(sqlite)).toBe(0);
      // The rival's own effects stand; this recovery added nothing (the seeded session of O1 is untouched unless the rival ended it).
      if (name.includes("demoted")) expect(count(sqlite, "SELECT COUNT(*) AS n FROM staff_accounts WHERE id = 'O1' AND role = 'ADMIN'")).toBe(1);
      else expect(count(sqlite, "SELECT COUNT(*) AS n FROM staff_sessions WHERE account_id = 'O1' AND revoked_at IS NULL")).toBe(1);
    });
  }
});

describe("R3 and R4: retention erases each record once and never deletes evidence another record keeps", () => {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
  let sequence = 0;
  function loan(sqlite: Sqlite, objects: Map<string, unknown>, id: string, { closedDaysAgo = 800 as number | null, key = `loans/${id}` } = {}) {
    sqlite.prepare("INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status) VALUES(?, ?, 'OPENING_BALANCE', 'IN', 'ITM-0001', 1, 'piece', 1, 'POSTED')").run(`MOV-${id}`, ago(900));
    sqlite.prepare(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, status, movement_id, created_at, created_by, closed_at, closed_by)
      VALUES(?, 'ITM-0001', 1, 'INDIVIDUAL', 'Juan', '20-0001-001', ?, ?, ?, ?, 'X', ?, ?)`)
      .run(id, key, closedDaysAgo === null ? "OUT" : "RETURNED", `MOV-${id}`, ago(900), closedDaysAgo === null ? null : ago(closedDaysAgo), closedDaysAgo === null ? null : "X");
    objects.set(key, { bytes: new Uint8Array([1]) });
  }
  function phone(sqlite: Sqlite, objects: Map<string, unknown>, id: string, { receivedDaysAgo = 400, key = `held/${id}` as string | null, loanId = null as string | null } = {}) {
    const at = ago(receivedDaysAgo);
    sqlite.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, photo_key, device_time, sent_at, occurred_at, received_at, applied, loan_id)
      VALUES(?, 'dev', ?, 'BORROW', 'ITM-0001', 1, 'Juan', '20-0001-001', ?, ?, ?, ?, ?, 1, ?)`).run(id, ++sequence, key, at, at, at, at, loanId);
    if (key) objects.set(key, { bytes: new Uint8Array([1]) });
  }
  const audited = (sqlite: Sqlite) => (sqlite.prepare("SELECT details_json AS d FROM audit_log WHERE action = 'RETENTION_ERASED'").all() as Array<{ d: string }>)
    .map((row) => JSON.parse(row.d) as { loans: number; phoneRecords: number; photos: number })
    .reduce((sum, row) => ({ loans: sum.loans + row.loans, phoneRecords: sum.phoneRecords + row.phoneRecords, photos: sum.photos + row.photos }), { loans: 0, phoneRecords: 0, photos: 0 });
  const actor = { accountId: "ACC-owner", sessionId: "S", username: "owner", displayName: "Owner", role: "OWNER" as const, mustChangePassword: false };
  async function runUntilDone(d1: D1Database, bucket: R2Bucket) { for (let guard = 0; guard < 20; guard++) if (!(await eraseOldDetails(d1, bucket, actor)).more) return; throw new Error("did not finish"); }

  // [the loan's state, closed days ago, is the phone record due, is the loan due]. A phone record tied to a loan still out is
  // never due (the accepted rule); the shared photo goes only when neither record keeps it.
  const shared: Array<[string, number | null, boolean, boolean]> = [
    ["still out", null, false, false],
    ["closed 100 days ago", 100, true, false],
    ["closed 800 days ago (also due)", 800, true, true]
  ];
  for (const [name, closed, phoneDue, loanDue] of shared) {
    const kept = !loanDue;
    it(`a phone borrow sharing its photo with a loan ${name}: the photo is ${kept ? "kept for the loan" : "deleted once, with both records erased"}`, async () => {
      const { d1, sqlite } = migratedD1();
      const { bucket, objects } = memoryR2();
      const key = "loans/LN-SS-E1-abcd1234";
      loan(sqlite, objects, "LN-SS-E1", { closedDaysAgo: closed, key });
      phone(sqlite, objects, "E1", { key, loanId: "LN-SS-E1" });
      const preview = await retentionPreview(d1);
      expect(preview).toEqual({ loans: loanDue ? 1 : 0, phoneRecords: phoneDue ? 1 : 0, photos: kept ? 0 : 1 });
      await runUntilDone(d1, bucket);
      expect(objects.has(key)).toBe(kept);
      expect((sqlite.prepare("SELECT photo_key AS k FROM loans WHERE id = 'LN-SS-E1'").get() as { k: string }).k).toBe(loanDue ? "" : key);
      expect(sqlite.prepare("SELECT photo_key AS k, person_name AS n FROM self_service_events WHERE id = 'E1'").get()).toEqual(phoneDue ? { k: null, n: "[removed]" } : { k: key, n: "Juan" });
      expect(audited(sqlite)).toEqual({ loans: loanDue ? 1 : 0, phoneRecords: phoneDue ? 1 : 0, photos: preview.photos });
    });
  }

  it("a photo already missing from R2 is no obstacle", async () => {
    const { d1, sqlite } = migratedD1();
    const { bucket, objects } = memoryR2();
    loan(sqlite, objects, "LN-1");
    objects.delete("loans/LN-1");
    await runUntilDone(d1, bucket);
    expect((sqlite.prepare("SELECT photo_key AS k FROM loans WHERE id = 'LN-1'").get() as { k: string }).k).toBe("");
  });

  it("two erasures at once over 100 loans: every record erased once, every photo deleted, counted exactly once", async () => {
    const { d1, sqlite } = migratedD1();
    const { bucket, objects } = memoryR2();
    for (let index = 0; index < 100; index++) loan(sqlite, objects, `LN-${String(index).padStart(3, "0")}`);
    await Promise.all([runUntilDone(d1, bucket), runUntilDone(d1, bucket)]);
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM loans WHERE photo_key <> '' OR borrower_name <> '[removed]'")).toBe(0);
    expect(objects.size).toBe(0);
    expect(audited(sqlite)).toEqual({ loans: 100, phoneRecords: 0, photos: 100 });
  });

  it("an object that cannot be deleted stops the run before any record changes; a retry finishes it", async () => {
    const { d1, sqlite } = migratedD1();
    const { bucket, objects } = memoryR2();
    for (const id of ["LN-1", "LN-2", "LN-3"]) loan(sqlite, objects, id);
    const real = bucket.delete.bind(bucket);
    let failOnce = true;
    (bucket as unknown as { delete: R2Bucket["delete"] }).delete = (async (key: string) => { if (key === "loans/LN-2" && failOnce) { failOnce = false; throw new Error("R2 unavailable"); } return real(key); }) as R2Bucket["delete"];
    await expect(eraseOldDetails(d1, bucket, actor)).rejects.toThrow(/R2 unavailable/);
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM loans WHERE borrower_name = '[removed]'")).toBe(0);
    await runUntilDone(d1, bucket);
    expect(objects.size).toBe(0);
    expect(audited(sqlite)).toEqual({ loans: 3, phoneRecords: 0, photos: 3 });
  });

  it("a database failure after the photos went leaves the records due; a retry clears them and counts them once", async () => {
    const { d1, sqlite } = migratedD1();
    const { bucket, objects } = memoryR2();
    for (const id of ["LN-1", "LN-2"]) loan(sqlite, objects, id);
    const real = d1.batch.bind(d1);
    let calls = 0;
    (d1 as unknown as { batch: D1Database["batch"] }).batch = (async (statements: D1PreparedStatement[]) => { calls += 1; if (calls === 2) throw new Error("D1 unavailable"); return real(statements); }) as D1Database["batch"];
    await expect(eraseOldDetails(d1, bucket, actor)).rejects.toThrow(/D1 unavailable/);
    expect(objects.size).toBe(0);
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM loans WHERE photo_key <> ''")).toBe(2);
    await runUntilDone(d1, bucket);
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM loans WHERE photo_key <> '' OR borrower_name <> '[removed]'")).toBe(0);
    expect(audited(sqlite)).toEqual({ loans: 2, phoneRecords: 0, photos: 2 });
  });
});

describe("R5: a loan's photo survives an answer that never arrived", () => {
  function setup() {
    const { d1, sqlite } = migratedD1();
    const { bucket, objects } = memoryR2();
    sqlite.exec("UPDATE items SET item_type = 'Loanable', status = 'ACTIVE' WHERE id = 'ITM-0001'");
    const form = () => {
      const data = new FormData();
      for (const [name, value] of Object.entries({ key: "request-key-1234", purpose: "INDIVIDUAL", borrowerName: "Juan Cruz", studentId: "20-1234-567", quantity: "1" })) data.set(name, value);
      data.set("photo", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], "p.jpg", { type: "image/jpeg" }));
      return data;
    };
    const fail = (mode: "after-commit" | "before-commit", alsoUnreadable = false) => {
      const real = d1.batch.bind(d1);
      const realPrepare = d1.prepare.bind(d1);
      (d1 as unknown as { batch: D1Database["batch"] }).batch = (async (statements: D1PreparedStatement[]) => {
        (d1 as unknown as { batch: D1Database["batch"] }).batch = real;
        if (mode === "after-commit") await real(statements);
        // While D1 is unreachable, the follow-up check cannot be answered either.
        if (alsoUnreadable) (d1 as unknown as { prepare: unknown }).prepare = () => { throw new Error("network lost"); };
        throw new Error("network lost");
      }) as D1Database["batch"];
      return () => { (d1 as unknown as { prepare: unknown }).prepare = realPrepare; };
    };
    const movements = () => count(sqlite, "SELECT COUNT(*) AS n FROM inventory_movements WHERE movement_type = 'LOAN_OUT'");
    return { d1, sqlite, bucket, objects, form, fail, movements };
  }

  it("saved, answer lost: the loan stands with its photo, and a retry returns the same loan with no second movement", async () => {
    const { d1, sqlite, bucket, objects, form, fail, movements } = setup();
    fail("after-commit");
    const first = await createLoan(d1, bucket, { accountId: "O1" }, "ITM-0001", form());
    const stored = sqlite.prepare("SELECT id, photo_key AS k FROM loans").get() as { id: string; k: string };
    expect(first.id).toBe(stored.id);
    expect(objects.has(stored.k)).toBe(true);
    expect((await createLoan(d1, bucket, { accountId: "O1" }, "ITM-0001", form())).id).toBe(stored.id);
    expect(movements()).toBe(1);
  });

  it("rolled back: the unused photo is removed and the error stands", async () => {
    const { d1, bucket, objects, form, fail, movements } = setup();
    fail("before-commit");
    await expect(createLoan(d1, bucket, { accountId: "O1" }, "ITM-0001", form())).rejects.toThrow(/network lost/);
    expect(objects.size).toBe(0);
    expect(movements()).toBe(0);
  });

  it("outcome unknown: the photo is kept and the error stands; once D1 answers, a retry returns the saved loan", async () => {
    const { d1, sqlite, bucket, objects, form, fail, movements } = setup();
    const restore = fail("after-commit", true);
    await expect(createLoan(d1, bucket, { accountId: "O1" }, "ITM-0001", form())).rejects.toThrow(/network lost/);
    restore();
    const stored = sqlite.prepare("SELECT id, photo_key AS k FROM loans").get() as { id: string; k: string };
    expect(objects.has(stored.k)).toBe(true);
    expect((await createLoan(d1, bucket, { accountId: "O1" }, "ITM-0001", form())).id).toBe(stored.id);
    expect(movements()).toBe(1);
  });
});

describe("R7: Stock activity reads only what its page needs, with the same answer", () => {
  const compare = (sqlite: ReturnType<typeof migratedD1>["sqlite"], d1: D1Database) => async () => {
    const expected = sqlite.prepare(REFERENCE_RECENT_ACTIVITY).all();
    const actual = await recentActivity(d1);
    expect(actual).toEqual(expected);
    return actual.length;
  };
  const ledger = (movements: number, items: number) => {
    const { sqlite, d1 } = migratedD1();
    syntheticLedger(sqlite, movements, items);
    sqlite.prepare("INSERT OR IGNORE INTO staff_accounts(id, username, display_name, password_hash, role) VALUES('ACC-1', 'u.one', 'Person One', 'x', 'STAFF')").run();
    return { sqlite, same: compare(sqlite, d1) };
  };
  const add = (sqlite: ReturnType<typeof migratedD1>["sqlite"], id: string, at: string, item = "PERF-1", imported: string | null = null) =>
    sqlite.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status, imported_from)
      VALUES(?, ?, 'STOCK_IN', 'IN', ?, 2, 'piece', 2, 'POSTED', ?)`).run(id, at, item, imported);

  it("matches the whole-ledger query on an empty ledger, a short one, and a long one", async () => {
    expect(await ledger(0, 3).same()).toBe(0);
    expect(await ledger(40, 3).same()).toBe(38);
    expect(await ledger(2_000, 37).same()).toBe(100);
  });

  it("matches it when many rows share the 100th time, inserted out of id order", async () => {
    const { sqlite, same } = ledger(500, 9);
    for (let k = 0; k < 150; k += 1) add(sqlite, `TIE-${String(999 - k).padStart(3, "0")}`, "2027-01-01T00:00:00.000Z", `PERF-${1 + (k % 9)}`);
    expect(await same()).toBe(100);
  });

  it("matches it when stored times mix offsets, missing milliseconds, a space, non-dates and a bare day number", async () => {
    const { sqlite, same } = ledger(500, 9);
    const odd = ["2027-09-01T10:00:00+08:00", "2027-09-01 02:00:00", "2027-09-01T02:00:00Z", "2027-09-01T02:00:00.000Z", "garbage", "", "2027-13-45T00:00:00Z", "2461700.5", "2027-02-01T00:00:00.000+08:00"];
    odd.forEach((at, k) => { add(sqlite, `ODD-${k}`, at, `PERF-${1 + (k % 9)}`); add(sqlite, `ODD-${k}-again`, at, "PERF-2"); });
    // Imported rows newer than everything still never appear, yet still count in their item's running total.
    add(sqlite, "IMP-1", "2028-01-01T00:00:00.000Z", "PERF-2", "legacy sheet");
    expect(await same()).toBe(100);
    const sparse = ledger(20, 3);
    odd.forEach((at, k) => add(sparse.sqlite, `ODD-${k}`, at, `PERF-${1 + (k % 3)}`));
    expect(await sparse.same()).toBe(19 + odd.length);
  });
});
