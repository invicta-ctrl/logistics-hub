import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const schema = fs.readFileSync(new URL("migrations/0001_core.sql", root), "utf8");
const seed = fs.readFileSync(new URL("migrations/0002_inventory_seed.sql", root), "utf8");

describe("D1 migration arithmetic", () => {
  it("preserves every seed row and derives balances from posted movements only", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(schema);
    db.exec(seed);
    expect(db.prepare("SELECT COUNT(*) AS total FROM items").get()).toMatchObject({ total: 397 });
    expect(() => db.exec("INSERT INTO items SELECT * FROM items WHERE id = 'ITM-0001' ")).toThrow();
    expect(db.prepare("SELECT on_hand, migration_delta FROM inventory_balances WHERE id = 'ITM-0001'").get()).toMatchObject({ on_hand: 7, migration_delta: -1 });
    db.exec("INSERT INTO inventory_movements(id,created_at,movement_type,direction,item_id,quantity,unit,signed_quantity,status) VALUES('TEST-UNPOSTED','2026-09-28T00:00:00+08:00','ADJUST','IN','ITM-0001',5,'block',5,'PENDING')");
    expect(db.prepare("SELECT on_hand FROM inventory_balances WHERE id = 'ITM-0001'").get()).toMatchObject({ on_hand: 7 });
    db.exec("INSERT INTO inventory_movements(id,created_at,movement_type,direction,item_id,quantity,unit,signed_quantity,status) VALUES('TEST-POSTED','2026-09-28T00:00:00+08:00','ADJUST','IN','ITM-0001',5,'block',5,'POSTED')");
    expect(db.prepare("SELECT on_hand FROM inventory_balances WHERE id = 'ITM-0001'").get()).toMatchObject({ on_hand: 12 });
    db.close();
  });
});
