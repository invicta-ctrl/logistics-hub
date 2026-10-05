import { BULK_LIMIT, STOCK_AREAS, UNSORTED_CATEGORY } from "./catalog-policy";
import { type Actor, BUMP_REVISION, InputError, audit, guarded, pathsOf, text, usablePlace } from "./inventory";
import { LOCATION_ID } from "./location-tree";

/*
 * Bulk edits of item details (Items → Select). Only metadata: a place, a category, a stock area, "reviewed". Quantity is never
 * touched here (it belongs to movements and counts), and nothing is deleted. Each item is written with the version the browser
 * showed, so an item someone else changed meanwhile is skipped and named, never overwritten; every changed item gets its own
 * audit entry, the same one a single edit writes, so its history reads as it always does.
 */

export const BULK_ACTIONS = ["MOVE", "CATEGORY", "STOCK_AREA", "REVIEWED"] as const;
type BulkAction = typeof BULK_ACTIONS[number];
const ITEM_ID = /^ITM-[A-Za-z0-9-]{1,24}$/;

type Row = { id: string; name: string; itemType: string; category: string; stockArea: string | null; locationId: string | null; needsReview: number; updatedAt: string | null };
export type Skipped = { id: string; name: string; reason: string };

export async function bulkUpdate(db: D1Database, actor: Actor, input: unknown) {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof body.action !== "string" || !(BULK_ACTIONS as readonly string[]).includes(body.action)) throw new InputError(400, "Choose what to change.");
  const action = body.action as BulkAction;
  const list = body.items;
  if (!Array.isArray(list) || !list.length || list.length > BULK_LIMIT) throw new InputError(400, `Select from 1 to ${BULK_LIMIT} items at a time.`);
  const wanted = new Map<string, string | null>();
  for (const entry of list) {
    const { id, updatedAt } = (entry ?? {}) as { id?: unknown; updatedAt?: unknown };
    if (typeof id !== "string" || !ITEM_ID.test(id) || (updatedAt !== null && typeof updatedAt !== "string")) throw new InputError(400, "Reload the items and try again.");
    wanted.set(id, updatedAt as string | null);
  }

  // The new value, checked once for the whole selection.
  let value: string | null = null;
  if (action === "MOVE") {
    if (typeof body.value !== "string" || !LOCATION_ID.test(body.value)) throw new InputError(400, "Choose the place to move them to.");
    await usablePlace(db, body.value);
    value = body.value;
  } else if (action === "CATEGORY") {
    value = text(body, "value", "Category", 100, true)!;
    if (value.toUpperCase() === UNSORTED_CATEGORY) throw new InputError(400, "Choose a real category.");
    // An existing spelling that differs only by letter case is reused, as everywhere else.
    value = await db.prepare("SELECT category FROM items WHERE category = ? COLLATE NOCASE ORDER BY category = ? DESC LIMIT 1").bind(value, value).first<string>("category") ?? value;
  } else if (action === "STOCK_AREA") {
    if (typeof body.value !== "string" || !(STOCK_AREAS as readonly string[]).includes(body.value)) throw new InputError(400, "Choose a stock area.");
    value = body.value;
  }

  const ids = [...wanted.keys()];
  const { results } = await db.prepare(`SELECT id, name, item_type AS itemType, category, stock_area AS stockArea, location_id AS locationId, needs_review AS needsReview, updated_at AS updatedAt
    FROM items WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<Row>();
  const rows = new Map(results.map((row) => [row.id, row]));
  const places = action === "MOVE" ? await pathsOf(db, [value, ...results.map((row) => row.locationId)]) : new Map<string, string>();

  const skipped: Skipped[] = [];
  let unchanged = 0;
  const writes: Array<{ row: Row; column: string; to: string | number; detail: Record<string, unknown> }> = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) { skipped.push({ id, name: id, reason: "It no longer exists." }); continue; }
    if (row.updatedAt !== wanted.get(id)) { skipped.push({ id, name: row.name, reason: "Someone else changed it meanwhile." }); continue; }
    if (action === "MOVE") {
      if (row.locationId === value) unchanged += 1;
      else writes.push({ row, column: "location_id", to: value!, detail: { storageLocation: { from: places.get(row.locationId ?? "") ?? null, to: places.get(value!) ?? null } } });
    } else if (action === "CATEGORY") {
      if (row.category === value) unchanged += 1;
      else writes.push({ row, column: "category", to: value!, detail: { category: { from: row.category, to: value } } });
    } else if (action === "STOCK_AREA") {
      if ((row.stockArea ?? "Inventory") === value) unchanged += 1;
      else writes.push({ row, column: "stock_area", to: value!, detail: { stockArea: { from: row.stockArea, to: value } } });
    } else if (row.needsReview === 0) unchanged += 1;
    else if (row.itemType === "NEEDS_REVIEW") skipped.push({ id, name: row.name, reason: "Choose Borrow or Take for it first." });
    else if (row.category === UNSORTED_CATEGORY) skipped.push({ id, name: row.name, reason: "Choose its category first." });
    else writes.push({ row, column: "needs_review", to: 0, detail: { needsReview: { from: true, to: false } } });
  }

  let applied = 0;
  if (writes.length) {
    const now = new Date().toISOString();
    const batch = crypto.randomUUID();
    const statements = writes.flatMap(({ row, column, to, detail }) => [
      db.prepare(`UPDATE items SET ${column} = ?, updated_at = ? WHERE id = ? AND updated_at IS ?`).bind(to, now, row.id, row.updatedAt),
      audit(db, actor.accountId, "ITEM_UPDATED", "ITEM", row.id, { ...detail, bulk: { id: batch, items: writes.length } }, true)
    ]);
    const done = await guarded(db.batch([...statements, db.prepare(BUMP_REVISION)]));
    writes.forEach(({ row }, index) => {
      if (done[index * 2]!.meta.changes) applied += 1;
      else skipped.push({ id: row.id, name: row.name, reason: "Someone else changed it meanwhile." });
    });
  }
  return { applied, unchanged, skipped };
}
