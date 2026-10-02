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
