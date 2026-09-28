import { ITEM_STATUSES, ITEM_TYPES, LENDING_AUDIENCES, PUBLIC_LENDING_AUDIENCES, PUBLIC_LENDING_ITEM_TYPE, isListedForLending } from "./catalog-policy";

export class InputError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type Actor = { accountId: string };

type ItemRow = {
  id: string; name: string; category: string; itemType: string; unit: string; status: string; needsReview: number;
  lendingAudience: string; onHand: number; reorderThreshold: number; storageLocation: string | null;
  defaultLoanDays: number | null; maximumLoanQty: number | null; notes: string | null;
};

const ITEM_COLUMNS = `i.id, i.name, i.category, i.item_type AS itemType, i.unit, i.status, i.needs_review AS needsReview,
 i.lending_audience AS lendingAudience, COALESCE(b.on_hand, 0) AS onHand, i.reorder_threshold AS reorderThreshold,
 i.storage_location AS storageLocation, i.default_loan_days AS defaultLoanDays, i.maximum_loan_qty AS maximumLoanQty, i.notes`;
const BUMP_REVISION = "UPDATE catalog_revision SET value = value + 1 WHERE id = 1";

export async function catalogRevision(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT value FROM catalog_revision WHERE id = 1").first<number>("value")) ?? 0;
}

function categoriesOf(items: Array<{ category: string }>): string[] {
  return [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b));
}

function positiveOrNull(value: number | null): number | null {
  return value && value > 0 ? value : null;
}

export async function publicCatalog(db: D1Database) {
  // The WHERE clause and isListedForLending() both enforce the listing policy:
  // unlisted rows never leave D1, and the DTO is filtered again in code.
  const audiences = [...PUBLIC_LENDING_AUDIENCES];
  const { results } = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN inventory_balances b ON b.id = i.id
    WHERE i.status = 'ACTIVE' AND i.needs_review = 0 AND i.item_type = ? AND i.lending_audience IN (${audiences.map(() => "?").join(",")})
    ORDER BY i.name COLLATE NOCASE`).bind(PUBLIC_LENDING_ITEM_TYPE, ...audiences).all<ItemRow>();
  const items = results.filter(isListedForLending).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    available: Math.max(0, row.onHand),
    audience: row.lendingAudience,
    maxPerLoan: positiveOrNull(row.maximumLoanQty),
    loanDays: positiveOrNull(row.defaultLoanDays)
  }));
  return { items, categories: categoriesOf(items) };
}

export async function staffInventory(db: D1Database) {
  const { results } = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN inventory_balances b ON b.id = i.id ORDER BY i.name COLLATE NOCASE`).all<ItemRow>();
  const items = results.map((row) => ({
    id: row.id, name: row.name, category: row.category, itemType: row.itemType, unit: row.unit, status: row.status,
    needsReview: row.needsReview === 1, lendingAudience: row.lendingAudience, onHand: row.onHand,
    reorderThreshold: row.reorderThreshold, storageLocation: row.storageLocation, listed: isListedForLending(row)
  }));
  return { items, categories: categoriesOf(items) };
}

export async function itemDetail(db: D1Database, id: string) {
  const [item, movements] = await db.batch([
    db.prepare(`SELECT ${ITEM_COLUMNS}, b.legacy_reported_available_qty AS legacyReportedAvailable, b.migrated_on_hand AS migratedOnHand,
      b.migration_delta AS migrationDelta, i.legacy_source_sheet AS legacySourceSheet, i.legacy_source_row AS legacySourceRow, i.verification_note AS verificationNote
      FROM items i LEFT JOIN inventory_balances b ON b.id = i.id WHERE i.id = ?`).bind(id),
    db.prepare(`SELECT m.id, m.created_at AS createdAt, m.movement_type AS movementType, m.signed_quantity AS signedQuantity, m.status,
      m.notes, a.display_name AS actor FROM inventory_movements m LEFT JOIN staff_accounts a ON a.id = m.actor_user_id
      WHERE m.item_id = ? ORDER BY m.rowid DESC LIMIT 30`).bind(id)
  ]);
  const row = item.results[0] as (ItemRow & Record<string, unknown>) | undefined;
  if (!row) throw new InputError(404, "Item not found.");
  return { item: { ...row, needsReview: row.needsReview === 1, listed: isListedForLending(row) }, movements: movements.results };
}

type ItemInput = {
  name: string; category: string; itemType: string; unit: string; status: string; storageLocation: string | null;
  reorderThreshold: number; lendingAudience: string; defaultLoanDays: number; maximumLoanQty: number; needsReview: boolean; notes: string | null;
};

function text(body: Record<string, unknown>, key: string, label: string, max: number, required: boolean): string | null {
  const value = typeof body[key] === "string" ? (body[key] as string).trim() : "";
  if (required && !value) throw new InputError(400, `${label} is required.`);
  if (value.length > max) throw new InputError(400, `${label} must be ${max} characters or fewer.`);
  return value || null;
}

function whole(body: Record<string, unknown>, key: string, label: string, min: number, max: number): number {
  const value = body[key] ?? 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new InputError(400, `${label} must be a whole number from ${min} to ${max}.`);
  return value;
}

function choice<T extends readonly string[]>(body: Record<string, unknown>, key: string, label: string, options: T): T[number] {
  const value = body[key];
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) throw new InputError(400, `Choose a valid ${label}.`);
  return value as T[number];
}

export function parseItemInput(body: unknown): ItemInput {
  if (!body || typeof body !== "object") throw new InputError(400, "Invalid item details.");
  const record = body as Record<string, unknown>;
  const input: ItemInput = {
    name: text(record, "name", "Name", 120, true)!,
    category: text(record, "category", "Category", 100, true)!,
    itemType: choice(record, "itemType", "item type", ITEM_TYPES),
    unit: text(record, "unit", "Unit", 30, true)!,
    status: choice(record, "status", "status", ITEM_STATUSES),
    storageLocation: text(record, "storageLocation", "Storage location", 120, false),
    reorderThreshold: whole(record, "reorderThreshold", "Reorder level", 0, 100_000),
    lendingAudience: choice(record, "lendingAudience", "lending audience", LENDING_AUDIENCES),
    defaultLoanDays: whole(record, "defaultLoanDays", "Loan period", 0, 365),
    maximumLoanQty: whole(record, "maximumLoanQty", "Maximum per loan", 0, 100_000),
    needsReview: record.needsReview === true,
    notes: text(record, "notes", "Notes", 1000, false)
  };
  if (input.lendingAudience !== "NOT_AVAILABLE_FOR_LENDING" && input.itemType !== PUBLIC_LENDING_ITEM_TYPE) {
    throw new InputError(400, "Only Loanable items can be offered for lending.");
  }
  return input;
}

const EDITABLE: Array<[keyof ItemInput, string]> = [
  ["name", "name"], ["category", "category"], ["itemType", "item_type"], ["unit", "unit"], ["status", "status"],
  ["storageLocation", "storage_location"], ["reorderThreshold", "reorder_threshold"], ["lendingAudience", "lending_audience"],
  ["defaultLoanDays", "default_loan_days"], ["maximumLoanQty", "maximum_loan_qty"], ["needsReview", "needs_review"], ["notes", "notes"]
];
const stored = (value: ItemInput[keyof ItemInput]) => typeof value === "boolean" ? Number(value) : value;

function audit(db: D1Database, actor: Actor, action: string, entityId: string, details: unknown): D1PreparedStatement {
  return db.prepare("INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json) VALUES(?, ?, ?, ?, 'ITEM', ?, ?)")
    .bind(crypto.randomUUID(), new Date().toISOString(), actor.accountId, action, entityId, JSON.stringify(details));
}

export async function updateItem(db: D1Database, actor: Actor, id: string, input: ItemInput) {
  const current = await db.prepare(`SELECT ${EDITABLE.map(([key, column]) => `${column} AS ${key}`).join(", ")} FROM items WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!current) throw new InputError(404, "Item not found.");
  const changed = EDITABLE.filter(([key]) => current[key] !== stored(input[key]));
  if (!changed.length) return { changed: 0 };
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE items SET ${changed.map(([, column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...changed.map(([key]) => stored(input[key])), now, id),
    audit(db, actor, "ITEM_UPDATED", id, Object.fromEntries(changed.map(([key]) => [key, { from: current[key], to: stored(input[key]) }]))),
    db.prepare(BUMP_REVISION)
  ]);
  return { changed: changed.length };
}

export async function createItem(db: D1Database, actor: Actor, input: ItemInput, openingQuantity: number) {
  const now = new Date().toISOString();
  // Two staff creating at once can race for the next ID; the primary key rejects the loser, which retries.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = await db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) + 1 AS next FROM items WHERE id LIKE 'ITM-%'").first<number>("next");
    const id = `ITM-${String(next).padStart(4, "0")}`;
    const statements = [
      db.prepare(`INSERT INTO items(id, name, category, item_type, unit, status, storage_location, reorder_threshold, lending_audience,
        default_loan_days, maximum_loan_qty, needs_review, notes, imported_from, imported_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOGISTICS_HUB', ?, ?)`)
        .bind(id, input.name, input.category, input.itemType, input.unit, input.status, input.storageLocation, input.reorderThreshold, input.lendingAudience,
          input.defaultLoanDays, input.maximumLoanQty, Number(input.needsReview), input.notes, now, now),
      audit(db, actor, "ITEM_CREATED", id, { ...input, openingQuantity }),
      db.prepare(BUMP_REVISION)
    ];
    if (openingQuantity > 0) {
      statements.push(db.prepare(`INSERT INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, status)
        VALUES(?, ?, 'OPENING_BALANCE', 'IN', ?, ?, ?, ?, ?, 'POSTED')`).bind(`MOV-${crypto.randomUUID()}`, now, id, openingQuantity, input.unit, openingQuantity, actor.accountId));
    }
    try {
      await db.batch(statements);
      return { id };
    } catch (error) {
      if (!(error instanceof Error && /UNIQUE|PRIMARY KEY/i.test(error.message)) || attempt === 2) throw error;
    }
  }
  throw new InputError(409, "Could not allocate an item ID. Please try again.");
}

const MOVEMENTS = {
  IN: { type: "STOCK_IN", direction: "IN", signed: "?1", guard: "1" },
  OUT: { type: "STOCK_OUT", direction: "OUT", signed: "-?1", guard: "b.on_hand >= ?1" },
  COUNT: { type: "COUNT_ADJUSTMENT", direction: "ADJUST", signed: "?1 - b.on_hand", guard: "?1 <> b.on_hand" }
} as const;

export async function recordMovement(db: D1Database, actor: Actor, itemId: string, body: unknown) {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kind = choice(record, "kind", "movement", ["IN", "OUT", "COUNT"] as const);
  const quantity = whole(record, "quantity", kind === "COUNT" ? "Counted quantity" : "Quantity", kind === "COUNT" ? 0 : 1, 100_000);
  const note = text(record, "note", "Reason", 500, kind === "COUNT");
  const key = typeof record.key === "string" && /^[A-Za-z0-9-]{8,80}$/.test(record.key) ? record.key : null;
  if (!key) throw new InputError(400, "Missing request key.");
  const movement = MOVEMENTS[kind];
  // One statement computes the signed quantity from the live balance and applies
  // the guard, so concurrent writers cannot drive stock negative or double-count.
  const insert = db.prepare(`INSERT OR IGNORE INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, idempotency_key, notes, status)
    SELECT ?2, ?3, '${movement.type}', '${movement.direction}', i.id, ABS(${movement.signed}), i.unit, ${movement.signed}, ?4, ?5, ?6, 'POSTED'
    FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.id = ?7 AND ${movement.guard}`)
    .bind(quantity, `MOV-${crypto.randomUUID()}`, new Date().toISOString(), actor.accountId, key, note, itemId);
  // changes() still refers to the INSERT, so a retry or refused write leaves the revision untouched.
  const [result] = await db.batch([insert, db.prepare(`${BUMP_REVISION} AND changes() > 0`)]);
  const balance = await db.prepare("SELECT on_hand AS onHand FROM inventory_balances WHERE id = ?").bind(itemId).first<number>("onHand");
  if (result.meta.changes > 0) return { onHand: balance };
  if (balance === null) throw new InputError(404, "Item not found.");
  if (await db.prepare("SELECT 1 FROM inventory_movements WHERE idempotency_key = ?").bind(key).first()) return { onHand: balance };
  throw new InputError(409, kind === "OUT" ? `Only ${balance} on hand; cannot remove ${quantity}.` : "The count matches the current on-hand quantity; nothing to adjust.");
}
