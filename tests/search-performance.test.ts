import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migratedD1 } from "./d1-sqlite";
import { prepare, searchCatalog } from "../src/search";
import { searchIndex } from "../src/search-index";
import { findPeople } from "../src/staff-directory";

/**
 * V1.11 performance evidence for global search, on the real catalog the migrations seed plus deterministic synthetic items, places,
 * kits and links up to each tier (fictional names, no randomness). It measures what the Worker reads and sends for the index, what
 * preparing it costs the browser once, what one keystroke's ranking costs, and the administrator's people search on the Worker.
 * `npm test` runs the 500 and 5,000 item tiers with generous budgets; SEARCH_PERF=1 adds 10,000 and SEARCH_PERF_OUT=<file> writes
 * the table. Local node:sqlite and V8 only, not D1 or a phone.
 */

const TIERS = process.env.SEARCH_PERF ? [500, 5_000, 10_000] : [500, 5_000];
const NOUNS = ["Marker", "Tape", "Folder", "Cable", "Extension Cord", "Banner", "Lanyard", "Battery", "Glue", "Scissors", "Stapler", "Envelope", "Tarpaulin", "Projector", "Speaker", "Clipboard", "Paint", "Brush", "Rope", "Gloves"];
const ADJECTIVES = ["Blue", "Red", "Large", "Small", "Heavy-duty", "Clear", "Black", "White", "Spare", "Event", "Outdoor", "Long"];
const QUERIES = ["tape", "blue marker", "ext cord", "cabinet 3", "sample kit 12", "itm-0135", "battery aa", "red", "projector event", "zzqx", "glue gun", "shelf b", "g", "heavy duty rope", "lanyard"];

function seedTier(target: number) {
  const { sqlite, d1 } = migratedD1();
  const now = "2026-10-07T00:00:00.000Z";
  const existing = Number((sqlite.prepare("SELECT count(*) AS n FROM items").get() as { n: number }).n);
  const places = Math.max(12, Math.round(target / 20));
  sqlite.exec("BEGIN");
  const place = sqlite.prepare("INSERT INTO locations(id, name, parent_id, active, created_at, updated_at) VALUES(?, ?, ?, 1, ?, ?)");
  // Rooms, cabinets in them, shelves in those: the depth the real tree has.
  for (let n = 0; n < places; n += 1) {
    const level = n % 3;
    place.run(`LOC-${7000 + n}`, level === 0 ? `Sample Room ${n / 3 + 1}` : level === 1 ? `Cabinet ${Math.floor(n / 3) + 1}` : `Shelf ${String.fromCharCode(65 + (n % 26))}`, level === 0 ? null : `LOC-${7000 + n - 1}`, now, now);
  }
  const item = sqlite.prepare("INSERT INTO items(id, name, aliases, category, item_type, unit, location_id) VALUES(?, ?, ?, 'Office Equipment and Supplies', 'CONSUMABLE', 'piece', ?)");
  for (let n = existing; n < target; n += 1) {
    const name = `${ADJECTIVES[n % ADJECTIVES.length]} ${NOUNS[(n * 7) % NOUNS.length]} ${n}`;
    item.run(`ITM-${String(n + 1).padStart(4, "0")}`, name, n % 9 === 0 ? `sample ${NOUNS[n % NOUNS.length]!.toLowerCase()}` : null, `LOC-${7000 + (n % places)}`);
  }
  const ids = (sqlite.prepare("SELECT id FROM items ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
  const kit = sqlite.prepare("INSERT INTO kits(id, name, location_id, active, created_at, updated_at) VALUES(?, ?, ?, 1, ?, ?)");
  const component = sqlite.prepare("INSERT INTO kit_components(kit_id, item_id, required, position) VALUES(?, ?, 1, ?)");
  for (let n = 0; n < Math.round(target / 25); n += 1) {
    kit.run(`KIT-${7000 + n}`, `Sample Kit ${n}`, `LOC-${7000 + ((n * 3) % places)}`, now, now);
    for (let position = 0; position < 6; position += 1) component.run(`KIT-${7000 + n}`, ids[(n * 6 + position * 13) % ids.length]!, position);
  }
  const link = sqlite.prepare("INSERT OR IGNORE INTO item_relationships(item_id, related_id, kind, created_at) VALUES(?, ?, 'USED_WITH', ?)");
  for (let n = 0; n < Math.round(target / 10); n += 1) link.run(ids[(n * 11) % ids.length]!, ids[(n * 11 + 5) % ids.length]!, now);
  sqlite.exec("COMMIT");
  return { sqlite, d1 };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * 0.95))]!;
const ms = (start: number) => performance.now() - start;

describe("search performance", () => {
  const rows: string[] = ["| Items | Index rows read | Index JSON | gzip | Worker build (ms) | Browser prepare (ms) | Keystroke median / p95 (ms) | Results per kind (max) |", "|---:|---:|---:|---:|---:|---:|---:|---:|"];

  for (const tier of TIERS) {
    it(`ranks ${tier} items within budget`, async () => {
      const { sqlite, d1 } = seedTier(tier);
      const counts = sqlite.prepare("SELECT (SELECT count(*) FROM items) + (SELECT count(*) FROM item_media) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM kits) + (SELECT count(*) FROM kit_components) + (SELECT count(*) FROM item_relationships) AS n").get() as { n: number };
      let start = performance.now();
      const index = await searchIndex(d1);
      const built = ms(start);
      expect(index.items.length).toBe(tier);
      const body = JSON.stringify({ revision: 1, ...index });
      const gzip = gzipSync(body).length;

      start = performance.now();
      const prepared = prepare(index);
      const prepareMs = ms(start);
      // Warm the JIT the way a person's first few keys would, then time each query as typed letter by letter.
      for (const query of QUERIES) searchCatalog(prepared, query);
      const keys: number[] = [];
      let most = 0;
      for (const query of QUERIES) {
        for (let length = 1; length <= query.length; length += 1) {
          start = performance.now();
          const found = searchCatalog(prepared, query.slice(0, length));
          keys.push(ms(start));
          most = Math.max(most, found.items.length, found.kits.length, found.places.length);
        }
      }
      rows.push(`| ${tier.toLocaleString("en")} | ${counts.n.toLocaleString("en")} | ${(body.length / 1024).toFixed(0)} KB | ${(gzip / 1024).toFixed(0)} KB | ${built.toFixed(0)} | ${prepareMs.toFixed(0)} | ${median(keys).toFixed(2)} / ${p95(keys).toFixed(2)} | ${most} |`);
      // Budgets well above what a laptop measures, so a slow CI runner never fails on noise but a regression in kind does.
      expect(gzip).toBeLessThan(tier * 60);
      expect(p95(keys)).toBeLessThan(tier <= 500 ? 8 : 40);
      expect(prepareMs).toBeLessThan(tier <= 500 ? 150 : 1_000);
      expect(most).toBeLessThanOrEqual(50);
    });
  }

  it("ranks the Staff Directory on the Worker and answers with a handful", async () => {
    const { sqlite, d1 } = migratedD1();
    const add = sqlite.prepare("INSERT INTO staff_directory(id, full_name, department, position, created_at, updated_at) VALUES(?, ?, 'DEM', ?, '2026-10-07', '2026-10-07')");
    for (let n = 0; n < 600; n += 1) add.run(`PER-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, `Sample Person ${n} ${["Santos", "Reyes", "Cruz", "Bautista"][n % 4]}`, n % 5 === 0 ? "Events Officer" : null);
    const times: number[] = [];
    let answer = { people: [] as unknown[], total: 0 };
    for (let run = 0; run < 9; run += 1) {
      const start = performance.now();
      answer = await findPeople(d1, "santos");
      times.push(ms(start));
    }
    expect(answer.total).toBe(150);
    expect(answer.people).toHaveLength(8);
    expect(JSON.stringify(answer).length).toBeLessThan(2_500);
    rows.push("", `Staff Directory search, 600 people: median ${median(times).toFixed(1)} ms on the Worker, ${JSON.stringify(answer).length} bytes answered (8 of 150 matches).`);
    expect(median(times)).toBeLessThan(100);
  });

  it("keeps search out of the first load: the palette is fetched on first use", () => {
    const shell = readFileSync("src/staff.ts", "utf8");
    expect(shell).not.toMatch(/^import[^;]*from "\.\/search-palette"/m);
    expect(shell).toMatch(/import\("\.\/search-palette"\)/);
    expect(shell).not.toMatch(/^import[^;]*from "\.\/search"/m);
    if (process.env.SEARCH_PERF_OUT) writeFileSync(process.env.SEARCH_PERF_OUT, `${rows.join("\n")}\n`);
    else if (process.env.SEARCH_PERF) console.log(rows.join("\n"));
  });
});
