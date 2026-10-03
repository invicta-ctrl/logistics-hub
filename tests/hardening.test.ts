// Accepted amendment docs/specs/accepted/2026-10-03-review-hardening-amendment.md: regressions for the review's findings,
// run on the real migrated schema. Concurrency is two requests started together; the D1 stand-in, like D1, runs each
// batch as one transaction, so the requests interleave exactly at their awaits.
import { describe, expect, it } from "vitest";
import { updateAccount, type Account } from "../src/accounts";
import { InputError } from "../src/inventory";
import { migratedD1 } from "./d1-sqlite";

type Sqlite = ReturnType<typeof migratedD1>["sqlite"];
const owner = (id: string): Account => ({ accountId: id, sessionId: `S-${id}-self`, username: id, displayName: id, role: "OWNER", mustChangePassword: false });
const count = (sqlite: Sqlite, sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;

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
