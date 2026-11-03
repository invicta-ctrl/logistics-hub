import { describe, expect, it } from "vitest";
// @ts-expect-error a plain script with no types
import { checkRestore, referencedKeys } from "../scripts/verify-restore.mjs";
import fs from "node:fs";
import { migratedD1 } from "./d1-sqlite";

/* V1.14 recovery rehearsal: the check that runs on a restored database, shown to pass on a sound one and to name each kind of damage. */

const migrations = fs.readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
const MEDIA = "11111111-1111-4111-8111-111111111111";

function hub() {
  const { sqlite } = migratedD1();
  // The runner records migrations the way D1 does.
  sqlite.exec("CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  for (const name of migrations) sqlite.prepare("INSERT OR IGNORE INTO d1_migrations(name) VALUES (?)").run(name);
  sqlite.exec(`INSERT INTO items(id, name, category, stock_area, item_type, unit, status, reorder_threshold, lending_audience, needs_review, updated_at)
    VALUES('ITM-1', 'Tape', 'SUPPLIES', 'Inventory', 'Consumable', 'piece', 'ACTIVE', 0, 'NOT_AVAILABLE_FOR_LENDING', 0, '2026-01-01T00:00:00.000Z')`);
  sqlite.exec(`INSERT INTO item_media(item_id, media_id, width, height, created_at) VALUES('ITM-1', '${MEDIA}', 800, 600, '2026-01-01T00:00:00.000Z')`);
  return sqlite;
}

function photoLoan(sqlite: ReturnType<typeof hub>, id: string, status: "OUT" | "RETURNED") {
  const movement = `MOV-${id}`;
  sqlite.prepare("INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status) VALUES(?, '2020-01-01', 'LOAN_OUT', 'OUT', 'ITM-1', 1, 'piece', -1, 'POSTED')").run(movement);
  sqlite.prepare("INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, reason, photo_key, status, movement_id, created_at, created_by, closed_at) VALUES(?, 'ITM-1', 1, 'USC', 'Example', 'Example', ?, ?, ?, '2020-01-01', 'ACC-1', ?)")
    .run(id, `loans/${id}`, status, movement, status === "OUT" ? null : "2020-01-01");
}

describe("restore check", () => {
  it("does not name an erased photo, and accepts a card's small images", () => {
    const sqlite = hub();
    const card = "33333333-3333-4333-8333-333333333333";
    sqlite.exec("PRAGMA foreign_keys = OFF");
    sqlite.exec(`INSERT INTO staff_directory(id, full_name, department, officer, active, created_at, updated_at) VALUES('PER-1', 'Person One', 'ARTS', 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
    sqlite.exec(`INSERT INTO staff_id_cards(person_id, media_id, front_width, front_height, back_width, back_height, created_at) VALUES('PER-1', '${card}', 100, 100, 100, 100, '2026-01-01T00:00:00.000Z')`);
    sqlite.exec(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, status) VALUES('M1', '2026-01-01T00:00:00.000Z', 'LOAN_OUT', 'OUT', 'ITM-1', 1, 'piece', 0, 'POSTED')`);
    // A loan whose photo retention erased leaves '' behind.
    sqlite.exec(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, reason, photo_key, status, movement_id, created_at, created_by) VALUES('LN-000001', 'ITM-1', 1, 'USC', 'x', 'r', '', 'OUT', 'M1', '2026-01-01T00:00:00.000Z', 'ACC-1')`);
    const stored = new Set([`items/${MEDIA}/display`, `items/${MEDIA}/thumb`, `ids/${card}/front`, `ids/${card}/back`, `ids/${card}/thumb`, `ids/${card}/face`]);
    expect(referencedKeys(sqlite).has("")).toBe(false);
    expect(checkRestore(sqlite, { migrations, stored })).toEqual([]);
  });

  it("passes on a sound database whose media all exist", () => {
    const sqlite = hub();
    const stored = new Set([`items/${MEDIA}/display`, `items/${MEDIA}/thumb`]);
    expect(referencedKeys(sqlite)).toEqual(stored);
    expect(checkRestore(sqlite, { migrations, stored })).toEqual([]);
  });

  it("names a missing migration, a missing object and an orphan object", () => {
    const sqlite = hub();
    sqlite.prepare("DELETE FROM d1_migrations WHERE name = ?").run(migrations.at(-1));
    const problems = checkRestore(sqlite, { migrations, stored: new Set([`items/${MEDIA}/display`, "items/22222222-2222-4222-8222-222222222222/thumb"]) });
    expect(problems.join("\n")).toContain(`lacks: ${migrations.at(-1)}`);
    expect(problems.join("\n")).toMatch(/1 object\(s\) the database names are not in R2 \(first: items\/1111.*thumb\)/);
    expect(problems.join("\n")).toMatch(/1 object\(s\) in R2 that no row names \(first: items\/2222/);
  });

  it("recognizes the completed retention marker as D1-governed R2 evidence", () => {
    const sqlite = hub();
    const marker = "loans/LN-ERASED.thumb";
    sqlite.prepare("INSERT INTO retention_photo_cleanup(photo_key, queued_at, completed_at) VALUES ('loans/LN-ERASED', ?, ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    const stored = new Set([`items/${MEDIA}/display`, `items/${MEDIA}/thumb`, marker]);
    expect(referencedKeys(sqlite).has(marker)).toBe(true);
    expect(checkRestore(sqlite, { migrations, stored })).toEqual([]);
  });

  it.each(["loan", "phone"])("rejects a completed cleanup still referenced by a %s record", (kind) => {
    const sqlite = hub();
    const key = "loans/LN-CONFLICT";
    if (kind === "loan") {
      photoLoan(sqlite, "LN-CONFLICT", "OUT");
    } else {
      sqlite.prepare("INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, photo_key, device_time, sent_at, occurred_at, received_at, applied) VALUES ('SS-CONFLICT', 'dev', 1, 'TAKE', 'ITM-1', 1, 'Example', ?, '2020-01-01', '2020-01-01', '2020-01-01', '2020-01-01', 1)").run(key);
    }
    sqlite.prepare("INSERT INTO retention_photo_cleanup(photo_key, queued_at, completed_at) VALUES (?, ?, ?)").run(key, "2026-01-01", "2026-01-02");
    const stored = new Set([`items/${MEDIA}/display`, `items/${MEDIA}/thumb`, key, `${key}.thumb`]);
    expect(checkRestore(sqlite, { migrations, stored })).toContain("1 completed retention photo cleanup key(s) still referenced by loan or phone records");
  });

  it("reports the missing migration without querying the absent cleanup table", () => {
    const sqlite = hub();
    sqlite.exec("DROP TABLE retention_photo_cleanup");
    sqlite.prepare("DELETE FROM d1_migrations WHERE name = '0031_retention_photo_cleanup.sql'").run();
    expect(checkRestore(sqlite, { migrations }).join("\\n")).toContain("lacks: 0031_retention_photo_cleanup.sql");
  });

  it("blocks restore readiness for recoverable pending cleanup at each R2 stage", () => {
    const sqlite = hub();
    photoLoan(sqlite, "LN-PENDING", "RETURNED");
    sqlite.prepare("INSERT INTO retention_photo_cleanup(photo_key, queued_at) VALUES (?, ?)").run("loans/LN-PENDING", "2026-01-01T00:00:00.000Z");
    const base = [`items/${MEDIA}/display`, `items/${MEDIA}/thumb`];
    for (const extra of [[], ["loans/LN-PENDING"], ["loans/LN-PENDING.thumb"], ["loans/LN-PENDING", "loans/LN-PENDING.thumb"]]) {
      expect(checkRestore(sqlite, { migrations, stored: new Set([...base, ...extra]) })).toEqual([
        "1 pending retention photo cleanup job(s); drain and recheck before enabling traffic",
      ]);
    }
  });

  it("blocks pending cleanup after record clearing, then passes when cleanup completes", () => {
    const sqlite = hub();
    sqlite.prepare("INSERT INTO retention_photo_cleanup(photo_key, queued_at) VALUES (?, ?)").run("loans/LN-PENDING", "2026-01-01T00:00:00.000Z");
    const base = [`items/${MEDIA}/display`, `items/${MEDIA}/thumb`];
    const stored = new Set([...base, "loans/LN-PENDING", "loans/LN-PENDING.thumb"]);
    expect(checkRestore(sqlite, { migrations, stored })).toEqual([
      "1 pending retention photo cleanup job(s); drain and recheck before enabling traffic",
    ]);

    sqlite.prepare("UPDATE retention_photo_cleanup SET completed_at = ? WHERE photo_key = ?").run("2026-01-02T00:00:00.000Z", "loans/LN-PENDING");
    expect(checkRestore(sqlite, { migrations, stored: new Set([...base, "loans/LN-PENDING.thumb"]) })).toEqual([]);
  });

  it("still reports a missing original with no pending cleanup", () => {
    const sqlite = hub();
    photoLoan(sqlite, "LN-ACTIVE", "OUT");
    const stored = new Set([`items/${MEDIA}/display`, `items/${MEDIA}/thumb`]);
    expect(checkRestore(sqlite, { migrations, stored }).join("\n")).toContain("object(s) the database names are not in R2 (first: loans/LN-ACTIVE)");
  });

  it("still reports a missing completed marker or a surviving completed original", () => {
    const sqlite = hub();
    sqlite.prepare("INSERT INTO retention_photo_cleanup(photo_key, queued_at, completed_at) VALUES (?, ?, ?)").run("loans/LN-ERASED", "2026-01-01", "2026-01-02");
    const base = [`items/${MEDIA}/display`, `items/${MEDIA}/thumb`];
    expect(checkRestore(sqlite, { migrations, stored: new Set(base) }).join("\n")).toContain("object(s) the database names are not in R2 (first: loans/LN-ERASED.thumb)");
    expect(checkRestore(sqlite, { migrations, stored: new Set([...base, "loans/LN-ERASED", "loans/LN-ERASED.thumb"]) }).join("\n")).toContain("object(s) in R2 that no row names (first: loans/LN-ERASED)");
  });

  it("names a row that points at nothing", () => {
    const sqlite = hub();
    sqlite.exec("PRAGMA foreign_keys = OFF");
    sqlite.exec("DELETE FROM items");
    expect(checkRestore(sqlite, { migrations }).join("\n")).toMatch(/point at a row that is not there/);
  });
});
