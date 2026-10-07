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

describe("restore check", () => {
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
    expect(problems.join("\n")).toMatch(/lacks: 0030/);
    expect(problems.join("\n")).toMatch(/1 object\(s\) the database names are not in R2 \(first: items\/1111.*thumb\)/);
    expect(problems.join("\n")).toMatch(/1 object\(s\) in R2 that no row names \(first: items\/2222/);
  });

  it("names a row that points at nothing", () => {
    const sqlite = hub();
    sqlite.exec("PRAGMA foreign_keys = OFF");
    sqlite.exec("DELETE FROM items");
    expect(checkRestore(sqlite, { migrations }).join("\n")).toMatch(/point at a row that is not there/);
  });
});
