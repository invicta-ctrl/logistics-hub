import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createItem, parseItemInput, publicCatalog, staffInventory, updateItem } from "../src/inventory";
import { resolveItemIcon } from "../src/item-icons";
import { migratedD1 } from "./d1-sqlite";
import { createHash } from "node:crypto";
import * as ops from "../scripts/ops/production-release.mjs";

const input = (name: string, extra = {}) => parseItemInput({ name, aliases: "", category: "Miscellaneous", unit: "piece", itemType: "Loanable", status: "ACTIVE", locationId: null,
  reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: "", ...extra });

describe("automatic visuals and additive metadata", () => {
  it("pins only the additive visual migration and keeps the existing private buckets", () => {
    const manifest = ops.loadManifest("ops/releases/catalog-visuals.json", "catalog-visuals");
    expect(manifest.branch).toBe("main");
    expect(manifest.target.r2.create).toEqual([]);
    expect(manifest.migrations.pending).toEqual([{ name: "0026_item_visuals.sql", sha256: createHash("sha256").update(fs.readFileSync("migrations/0026_item_visuals.sql")).digest("hex") }]);
    expect(manifest.expect.schemaChanged).toEqual(["table:items"]);
    expect(manifest.expect.schemaAdded).toEqual([]);
  });
  it("adds nullable choices without changing an existing item, movement, location or photo", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const file of fs.readdirSync("migrations").filter((name) => name <= "0025_location_report_reporter.sql").sort()) db.exec(fs.readFileSync(`migrations/${file}`, "utf8"));
      const tables = ["items", "inventory_movements", "locations", "item_media"];
      const before = new Map(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
      db.exec(fs.readFileSync("migrations/0026_item_visuals.sql", "utf8"));
      for (const table of tables) {
        const after = db.prepare(`SELECT * FROM ${table}`).all();
        expect(after.map((row) => {
          if (table !== "items") return row;
          const { visual_type, icon_key, ...truth } = row;
          expect(visual_type).toBeNull(); expect(icon_key).toBeNull();
          return truth;
        })).toEqual(before.get(table));
      }
    } finally { db.close(); }
  });
  it("creates known and unknown items without icon selection and safely supports a creation override", async () => {
    const { d1, sqlite } = migratedD1();
    try {
      sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES ('ACC-VISUAL', 'visual.test', 'Demo Staff', 'test-hash')").run();
      const actor = { accountId: "ACC-VISUAL" };
      const known = await createItem(d1, actor, input("Canon Projector"), 0);
      const unknown = await createItem(d1, actor, input("Unmapped supply", { itemType: "Consumable" }), 0);
      const override = await createItem(d1, actor, input("A4 Paper", { iconKey: "tabler:camera" }), 0);
      const staff = await staffInventory(d1);
      expect(resolveItemIcon(staff.items.find((item) => item.id === known.id)!)).toMatchObject({ key: "device-projector", source: "specific" });
      expect(resolveItemIcon(staff.items.find((item) => item.id === unknown.id)!).key).toBe("package");
      expect(resolveItemIcon(staff.items.find((item) => item.id === override.id)!)).toEqual({ key: "camera", source: "override" });
      const catalog = await publicCatalog(d1);
      expect(catalog.items.find((item) => item.id === known.id)?.iconKey).toBe("device-projector");
      expect(catalog.items.find((item) => item.id === unknown.id)?.iconKey).toBe("package");
      const version = sqlite.prepare("SELECT updated_at AS at FROM items WHERE id = ?").get(override.id)!.at;
      await updateItem(d1, actor, override.id, input("Paper renamed"), version);
      expect(sqlite.prepare("SELECT icon_key FROM items WHERE id = ?").get(override.id)!.icon_key).toBe("tabler:camera");
      expect(() => input("Unsafe", { iconKey: "<script>" })).toThrow(/available system icon/);
    } finally { sqlite.close(); }
  });
});
