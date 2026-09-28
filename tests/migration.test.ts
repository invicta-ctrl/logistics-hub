import fs from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const inventory = JSON.parse(fs.readFileSync(new URL("data/migration/inventory.production.json", root), "utf8"));
const schema = fs.readFileSync(new URL("migrations/0001_core.sql", root), "utf8");

describe("migration foundation", () => {
  it("retains 397 unique migrated inventory IDs", () => {
    const ids = inventory.items.map((item: { id: string }) => item.id);
    expect(ids).toHaveLength(397);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defines live quantity using posted movements only", () => {
    expect(schema).toContain("SUM(CASE WHEN m.status='POSTED' THEN m.signed_quantity ELSE 0 END)");
    expect(schema).not.toMatch(/AS available,\s*i\.legacy_reported_available_qty/);
  });
});
