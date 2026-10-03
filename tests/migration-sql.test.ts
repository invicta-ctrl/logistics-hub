import { describe, expect, it } from "vitest";
import { migratedD1 } from "./d1-sqlite";

describe("D1 migration arithmetic", () => {
  it("preserves every seed row and derives balances from posted movements only", () => {
    const { sqlite: db } = migratedD1();
    expect(db.prepare("SELECT COUNT(*) AS total FROM items").get()).toMatchObject({ total: 397 });
    expect(() => db.exec("INSERT INTO items SELECT * FROM items WHERE id = 'ITM-0001' ")).toThrow();
    expect(db.prepare("SELECT on_hand, migration_delta FROM inventory_balances WHERE id = 'ITM-0001'").get()).toMatchObject({ on_hand: 7, migration_delta: -1 });
    expect(db.prepare("SELECT COUNT(*) AS total FROM inventory_balances WHERE migration_delta <> 0").get()).toMatchObject({ total: 1 });
    db.exec("INSERT INTO inventory_movements(id,created_at,movement_type,direction,item_id,quantity,unit,signed_quantity,status) VALUES('TEST-UNPOSTED','2026-09-28T00:00:00+08:00','ADJUST','IN','ITM-0001',5,'block',5,'PENDING')");
    expect(db.prepare("SELECT on_hand FROM inventory_balances WHERE id = 'ITM-0001'").get()).toMatchObject({ on_hand: 7 });
    db.exec("INSERT INTO inventory_movements(id,created_at,movement_type,direction,item_id,quantity,unit,signed_quantity,status) VALUES('TEST-POSTED','2026-09-28T00:00:00+08:00','ADJUST','IN','ITM-0001',5,'block',5,'POSTED')");
    expect(db.prepare("SELECT on_hand, migrated_on_hand, migration_delta FROM inventory_balances WHERE id = 'ITM-0001'").get()).toMatchObject({ on_hand: 12, migrated_on_hand: 7, migration_delta: -1 });
    expect(db.prepare("SELECT COUNT(*) AS total FROM inventory_balances WHERE migration_delta <> 0").get()).toMatchObject({ total: 1 });
    db.close();
  });
});

describe("0011 role migration on a database that is already in use", () => {
  it("keeps accounts, upgrades the role constraint, and satisfies foreign keys", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const fs = await import("node:fs");
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const apply = (file: string) => { db.exec("BEGIN"); db.exec(fs.readFileSync(`migrations/${file}`, "utf8")); db.exec("COMMIT"); };
    const files = fs.readdirSync("migrations").sort();
    files.filter((file) => file < "0011").forEach(apply);
    db.exec("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'existing', 'Existing', 'hash')");
    db.exec("INSERT INTO staff_sessions(id, expires_at, account_id) VALUES('S-1', 9999999999999, 'ACC-1')");
    files.filter((file) => file >= "0011").forEach(apply);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("SELECT username, role, must_change_password FROM staff_accounts").all()).toEqual([{ username: "existing", role: "STAFF", must_change_password: 0 }]);
    expect(() => db.exec("UPDATE staff_accounts SET role = 'OWNER'")).not.toThrow();
    db.close();
  });
});

describe("0017 open units on a database that is already in use", () => {
  it("keeps every phone record, quantity and classification, and only adds the Use type", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const fs = await import("node:fs");
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const apply = (file: string) => { db.exec("BEGIN"); db.exec(fs.readFileSync(`migrations/${file}`, "utf8")); db.exec("COMMIT"); };
    const files = fs.readdirSync("migrations").sort();
    files.filter((file) => file < "0017").forEach(apply);
    db.exec(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, device_time, sent_at, occurred_at, received_at, applied, review, resolved_at, resolved_by)
      VALUES('E-1', 'D-1', 1, 'TAKE', 'ITM-0001', 2, 'Juan', '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z', 0, 'VOLUME', '2026-09-30T01:00:00Z', 'ACC-1')`);
    const before = db.prepare("SELECT id, on_hand FROM inventory_balances ORDER BY id").all();
    const types = db.prepare("SELECT item_type, COUNT(*) AS n FROM items GROUP BY item_type ORDER BY item_type").all();
    files.filter((file) => file >= "0017").forEach(apply);
    expect(db.prepare("SELECT id, on_hand FROM inventory_balances ORDER BY id").all()).toEqual(before);
    expect(db.prepare("SELECT item_type, COUNT(*) AS n FROM items GROUP BY item_type ORDER BY item_type").all()).toEqual(types);
    expect(db.prepare("SELECT DISTINCT consumption_mode AS mode FROM items").all()).toEqual([{ mode: "WHOLE_UNIT" }]);
    expect(db.prepare("SELECT id, quantity, review, resolved_by FROM self_service_events").all()).toEqual([{ id: "E-1", quantity: 2, review: "VOLUME", resolved_by: "ACC-1" }]);
    expect(() => db.exec("UPDATE self_service_events SET note = 'x'")).toThrow(/self_service_event_resolved/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'self_service_events' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name))
      .toEqual(["idx_activity_phone", "idx_activity_resolved", "idx_self_service_events_item", "idx_self_service_events_loan", "idx_self_service_events_open", "idx_self_service_events_received"]);
    expect(() => db.exec(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, device_time, sent_at, occurred_at, received_at, applied)
      VALUES('E-2', 'D-1', 2, 'USE', 'ITM-0001', 1, 'Juan', 'x', 'x', 'x', 'x', 1)`)).not.toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});

describe("0018 system settings", () => {
  it("seeds Self-Service closed, so the deploy that reads it cannot reopen a paused production", () => {
    const { sqlite } = migratedD1();
    expect(sqlite.prepare("SELECT key, value FROM system_settings").all()).toEqual([{ key: "self_service", value: "paused" }]);
    expect(() => sqlite.exec("UPDATE system_settings SET value = 'maybe' WHERE key = 'self_service'")).toThrow(/CHECK/);
  });
});

describe("0019 retention erasure", () => {
  const insert = (id: string, resolved: boolean) => `INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, student_id, photo_key, device_time, sent_at, occurred_at, received_at, applied, review, resolved_at, resolved_by)
    VALUES('${id}', 'D-1', 1, 'TAKE', 'ITM-0001', 2, 'Juan', '20-1234-567', 'held/${id}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 'VOLUME', ${resolved ? "'2026-01-02T00:00:00Z', 'ACC-1'" : "NULL, NULL"})`;

  it("lets a resolved phone record change in exactly one way: its identity replaced by the erased marker", () => {
    const { sqlite: db } = migratedD1();
    db.exec(insert("E-RESOLVED", true));
    for (const change of ["note = 'x'", "quantity = 3", "person_name = 'Someone else'", "resolved_by = 'ACC-2'", "applied = 1", "person_name = '[removed]'", "person_name = '[removed]', student_id = NULL", "student_id = NULL, photo_key = NULL"]) {
      expect(() => db.exec(`UPDATE self_service_events SET ${change} WHERE id = 'E-RESOLVED'`), change).toThrow(/self_service_event_resolved/);
    }
    // Identity erased together with another change is still refused.
    expect(() => db.exec("UPDATE self_service_events SET person_name = '[removed]', student_id = NULL, photo_key = NULL, note = 'x' WHERE id = 'E-RESOLVED'")).toThrow(/self_service_event_resolved/);
    db.exec("UPDATE self_service_events SET person_name = '[removed]', student_id = NULL, photo_key = NULL WHERE id = 'E-RESOLVED'");
    expect(db.prepare("SELECT person_name, student_id, photo_key, note, quantity FROM self_service_events WHERE id = 'E-RESOLVED'").get()).toMatchObject({ person_name: "[removed]", student_id: null, photo_key: null, quantity: 2 });
    // Erasing again is allowed (a retry); a record not yet resolved stays editable as before.
    db.exec("UPDATE self_service_events SET person_name = '[removed]', student_id = NULL, photo_key = NULL WHERE id = 'E-RESOLVED'");
    db.exec(insert("E-WAITING", false));
    db.exec("UPDATE self_service_events SET note = 'edited' WHERE id = 'E-WAITING'");
  });
});

describe("0022 append-only audit log", () => {
  it("keeps every entry as written: new entries are added, none can be changed or removed", () => {
    const { sqlite: db } = migratedD1();
    const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log").get();
    db.exec(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json) VALUES('AUD-T', '2026-10-03T00:00:00Z', NULL, 'SETTING_CHANGED', 'SETTING', 'self_service', '{}')`);
    expect(() => db.exec("UPDATE audit_log SET details_json = '{\"x\":1}' WHERE id = 'AUD-T'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM audit_log WHERE id = 'AUD-T'")).toThrow(/append-only/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()).toEqual({ n: (before as { n: number }).n + 1 });
  });
});

describe("append-only tables", () => {
  it("are never written with OR REPLACE, which SQLite lets past their delete triggers", async () => {
    const fs = await import("node:fs");
    const writers = [...fs.readdirSync("src").map((file) => `src/${file}`), ...fs.readdirSync("scripts").filter((file) => file.endsWith(".mjs")).map((file) => `scripts/${file}`)];
    const offenders = writers.filter((file) => /OR\s+REPLACE\s+INTO\s+(audit_log|inventory_movements)\b/i.test(fs.readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
