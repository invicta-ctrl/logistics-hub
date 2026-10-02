import { CONSUMPTION_MODES, ITEM_STATUSES, ITEM_TYPES, LENDING_AUDIENCES, MOVEMENT_REASONS, OPEN_REORDER_STATUSES, LISTABLE_ITEM_TYPES, PUBLIC_LENDING_AUDIENCES, STOCK_AREAS, isListedForLending, listingGaps } from "./catalog-policy";

export class InputError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type Actor = { accountId: string };

type ItemRow = {
  id: string; name: string; aliases: string | null; category: string; itemType: string; unit: string; status: string; needsReview: number;
  lendingAudience: string; onHand: number; reorderThreshold: number; storageLocation: string | null; notes: string | null; updatedAt: string | null;
  stockArea: string | null; expiresOn: string | null; consumptionMode: string;
};

const ITEM_COLUMNS = `i.id, i.name, i.aliases, i.category, i.item_type AS itemType, i.unit, i.status, i.needs_review AS needsReview,
 i.lending_audience AS lendingAudience, COALESCE(b.on_hand, 0) AS onHand, i.reorder_threshold AS reorderThreshold,
 i.storage_location AS storageLocation, i.notes, i.updated_at AS updatedAt,
 i.stock_area AS stockArea, i.expires_on AS expiresOn, i.consumption_mode AS consumptionMode`;
export const BUMP_REVISION = "UPDATE catalog_revision SET value = value + 1 WHERE id = 1";
/**
 * History is shown in business order: migrated rows keep their import order, then everything
 * recorded in the Hub in the order it happened (a phone that synced late slots into place).
 * julianday() compares the migrated "+08:00" and the Hub's "Z" timestamps correctly.
 */
export const HISTORY_ORDER = "CASE WHEN m.imported_from IS NULL THEN julianday(m.created_at) ELSE 0 END, m.rowid";
/** A physical count this close to a movement (either side, in days) may or may not have seen it. */
export const COUNT_TOLERANCE_DAYS = 5 / (24 * 60);
/**
 * Status for a movement that happened at `at` but is only being recorded now (a phone that was
 * offline). A physical count recorded after it already observed its effect, so it is kept as
 * evidence but excluded from on-hand. Evaluated inside the INSERT, so a count saved a moment
 * earlier is always seen.
 */
export const countAwareStatus = (item: string, at: string) => `CASE WHEN EXISTS (SELECT 1 FROM inventory_movements c
  WHERE c.item_id = ${item} AND c.movement_type = 'COUNT_ADJUSTMENT' AND c.status = 'POSTED' AND c.imported_from IS NULL
    AND julianday(c.created_at) > julianday(${at}) + ${COUNT_TOLERANCE_DAYS}) THEN 'SUPERSEDED' ELSE 'POSTED' END`;
/** Who recorded something: a staff member's name, or "Self-service" for a phone (actor id SELF_SERVICE). */
export const actorName = (account: string, actorId: string) => `COALESCE(${account}.display_name, CASE ${actorId} WHEN 'SELF_SERVICE' THEN 'Self-service' END)`;
/** One loan as staff see it; the photo is served separately and never inlined. */
export const LOAN_COLUMNS = `SELECT l.id, l.item_id AS itemId, i.name AS itemName, i.unit, l.quantity, l.purpose, l.borrower_name AS borrowerName,
  l.student_id AS studentId, l.photo_key <> '' AS hasPhoto, l.reason, l.return_by AS returnBy, l.status, l.return_note AS returnNote, l.created_at AS createdAt,
  l.closed_at AS closedAt, ${actorName("c", "l.created_by")} AS createdBy, ${actorName("x", "l.closed_by")} AS closedBy
  FROM loans l JOIN items i ON i.id = l.item_id LEFT JOIN staff_accounts c ON c.id = l.created_by LEFT JOIN staff_accounts x ON x.id = l.closed_by`;
const OPEN_REORDERS = [...OPEN_REORDER_STATUSES].map((status) => `'${status}'`).join(",");

/** The database's refusals that keep open units within stock (migration 0017), in the words staff read. */
export async function guarded<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("open_units_exceed_on_hand")) throw new InputError(409, "That would leave fewer units on hand than are open. Mark an open unit empty or correct the open units first.");
    if (message.includes("open_units_block_change")) throw new InputError(409, "This item has open units. Mark them empty or correct them before changing how it is used, its type, or making it inactive.");
    if (message.includes("open_unit_closed")) throw new InputError(409, "That unit is no longer open. Refresh to see the latest.");
    throw error;
  }
}

/** An item's open units, oldest first, with who opened them. */
export function openUnitsOf(db: D1Database, itemId: string): D1PreparedStatement {
  return db.prepare(`SELECT o.id, o.opened_at AS openedAt, COALESCE(a.display_name, 'Staff') AS openedBy, o.condition, o.condition_at AS conditionAt
    FROM open_units o LEFT JOIN staff_accounts a ON a.id = o.opened_by WHERE o.item_id = ? AND o.closed_at IS NULL ORDER BY o.opened_at, o.id`).bind(itemId);
}

export async function catalogRevision(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT value FROM catalog_revision WHERE id = 1").first<number>("value")) ?? 0;
}

function distinct(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

export async function publicCatalog(db: D1Database) {
  // The WHERE clause and isListedForLending() both enforce the listing policy:
  // unlisted rows never leave D1, and the DTO is filtered again in code.
  const audiences = [...PUBLIC_LENDING_AUDIENCES];
  const { results } = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN inventory_balances b ON b.id = i.id
    WHERE i.status = 'ACTIVE' AND i.needs_review = 0 AND i.item_type IN (${[...LISTABLE_ITEM_TYPES].map(() => "?").join(",")}) AND i.lending_audience IN (${audiences.map(() => "?").join(",")})
    ORDER BY i.name COLLATE NOCASE`).bind(...LISTABLE_ITEM_TYPES, ...audiences).all<ItemRow>();
  const items = results.filter(isListedForLending).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    itemType: row.itemType,
    available: Math.max(0, row.onHand),
    audience: row.lendingAudience
  }));
  return { items, categories: distinct(items.map((item) => item.category)) };
}

type StaffRow = ItemRow & { lastCountedAt: string | null; migrationDelta: number | null; reorderStatus: string | null; onLoan: number; openUnits: number; openCondition: string | null };

export async function staffInventory(db: D1Database) {
  // lastCountedAt counts only physical counts recorded in the Hub, not migrated rows.
  const { results } = await db.prepare(`SELECT ${ITEM_COLUMNS}, b.migration_delta AS migrationDelta,
      (SELECT MAX(m.created_at) FROM inventory_movements m WHERE m.item_id = i.id AND m.movement_type = 'COUNT_ADJUSTMENT' AND m.imported_from IS NULL) AS lastCountedAt,
      (SELECT r.status FROM reorders r WHERE r.item_id = i.id AND r.status IN (${OPEN_REORDERS})) AS reorderStatus,
      (SELECT COALESCE(SUM(l.quantity), 0) FROM loans l WHERE l.item_id = i.id AND l.status = 'OUT') AS onLoan,
      (SELECT COUNT(*) FROM open_units o WHERE o.item_id = i.id AND o.closed_at IS NULL) AS openUnits,
      (SELECT o.condition FROM open_units o WHERE o.item_id = i.id AND o.closed_at IS NULL ORDER BY CASE o.condition WHEN 'LOW' THEN 0 WHEN 'HALF' THEN 1 WHEN 'PLENTY' THEN 2 ELSE 3 END LIMIT 1) AS openCondition
    FROM items i LEFT JOIN inventory_balances b ON b.id = i.id ORDER BY i.name COLLATE NOCASE`).all<StaffRow>();
  const items = results.map((row) => ({
    id: row.id, name: row.name, aliases: row.aliases, category: row.category, itemType: row.itemType, unit: row.unit, status: row.status,
    needsReview: row.needsReview === 1, lendingAudience: row.lendingAudience, onHand: row.onHand,
    reorderThreshold: row.reorderThreshold, storageLocation: row.storageLocation, listed: isListedForLending(row),
    stockArea: row.stockArea, expiresOn: row.expiresOn, lastCountedAt: row.lastCountedAt, reorderStatus: row.reorderStatus, onLoan: row.onLoan,
    consumptionMode: row.consumptionMode, openUnits: row.openUnits, openCondition: row.openCondition,
    // The legacy quantity is doubtful (migration discrepancy or a VERIFY record) until someone counts it.
    countNeeded: row.status !== "INACTIVE" && !row.lastCountedAt && ((row.migrationDelta ?? 0) !== 0 || row.status === "VERIFY")
  }));
  // Existing values feed the pickers, so staff reuse a spelling instead of inventing a near-duplicate.
  return {
    items,
    categories: distinct(results.map((row) => row.category)),
    locations: distinct(results.map((row) => row.storageLocation)),
    units: distinct(results.map((row) => row.unit))
  };
}

type AuditRow = { at: string; action: string; details: string | null; actor: string | null };

export async function itemDetail(db: D1Database, id: string) {
  const [item, movements, events, loans, units, uses] = await db.batch([
    db.prepare(`SELECT ${ITEM_COLUMNS}, b.legacy_reported_available_qty AS legacyReportedAvailable, b.migrated_on_hand AS migratedOnHand,
      b.migration_delta AS migrationDelta, i.legacy_source_sheet AS legacySourceSheet, i.legacy_source_row AS legacySourceRow,
      i.verification_note AS verificationNote, i.imported_from AS importedFrom
      FROM items i LEFT JOIN inventory_balances b ON b.id = i.id WHERE i.id = ?`).bind(id),
    db.prepare(`SELECT * FROM (SELECT m.id, m.created_at AS createdAt, m.movement_type AS movementType, m.signed_quantity AS signedQuantity, m.status,
      m.notes, m.reason, m.related_entity_type AS related, ${actorName("a", "m.actor_user_id")} AS actor, ROW_NUMBER() OVER (ORDER BY ${HISTORY_ORDER}) AS seq,
      COALESCE(l.borrower_name, s.person_name) AS borrower, l.purpose,
      SUM(CASE WHEN m.status = 'POSTED' THEN m.signed_quantity ELSE 0 END) OVER (ORDER BY ${HISTORY_ORDER}) AS afterQuantity
      FROM inventory_movements m LEFT JOIN staff_accounts a ON a.id = m.actor_user_id
      LEFT JOIN loans l ON m.related_entity_type = 'LOAN' AND l.id = m.related_entity_id
      LEFT JOIN self_service_events s ON m.related_entity_type = 'SELF_SERVICE' AND s.id = m.related_entity_id WHERE m.item_id = ?) ORDER BY seq DESC LIMIT 50`).bind(id),
    db.prepare(`SELECT l.created_at AS at, l.action, l.details_json AS details, ${actorName("a", "l.actor_user_id")} AS actor FROM audit_log l
      LEFT JOIN staff_accounts a ON a.id = l.actor_user_id WHERE l.entity_type = 'ITEM' AND l.entity_id = ? ORDER BY l.created_at DESC, l.rowid DESC LIMIT 50`).bind(id),
    db.prepare(`${LOAN_COLUMNS} WHERE l.item_id = ? ORDER BY l.status = 'OUT' DESC, l.created_at DESC LIMIT 20`).bind(id),
    openUnitsOf(db, id),
    // Two separate measures, never mixed: uses recorded (staff and phones, no stock change) and units used up (each one -1).
    db.prepare(`SELECT (SELECT COUNT(*) FROM audit_log WHERE entity_type = 'ITEM' AND entity_id = ?1 AND action = 'UNIT_USED')
        + (SELECT COUNT(*) FROM self_service_events WHERE item_id = ?1 AND event_type = 'USE' AND applied = 1) AS usesRecorded,
      (SELECT COUNT(*) FROM inventory_movements WHERE item_id = ?1 AND related_entity_type = 'OPEN_UNIT' AND status = 'POSTED') AS unitsEmptied`).bind(id)
  ]);
  const row = item.results[0] as (ItemRow & Record<string, unknown>) | undefined;
  if (!row) throw new InputError(404, "Item not found.");
  return {
    item: { ...row, needsReview: row.needsReview === 1, listed: isListedForLending(row), listingGaps: listingGaps(row) },
    movements: movements.results,
    loans: loans.results,
    openUnits: units!.results,
    ...(uses!.results[0] as { usesRecorded: number; unitsEmptied: number }),
    // Parsed here so the browser renders sentences, never raw JSON.
    events: (events.results as AuditRow[]).map((event) => ({ at: event.at, action: event.action, actor: event.actor, details: event.details ? JSON.parse(event.details) as Record<string, unknown> : {} }))
  };
}

type ItemInput = {
  name: string; aliases: string | null; category: string; itemType: string; unit: string; status: string; storageLocation: string | null;
  reorderThreshold: number; lendingAudience: string; needsReview: boolean; notes: string | null;
  // Optional: an older form that omits them keeps the stored value.
  stockArea?: string; expiresOn?: string | null; consumptionMode?: string;
};

function text(body: Record<string, unknown>, key: string, label: string, max: number, required: boolean, multiline = false): string | null {
  const raw = typeof body[key] === "string" ? (body[key] as string).trim() : "";
  // Single-line values collapse inner whitespace, so "Shelf  A" and "Shelf A" are one value.
  const value = multiline ? raw : raw.replace(/\s+/g, " ");
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

/** "Mic, mic ,  microphone" becomes "Mic, microphone": trimmed, de-duplicated, never the item's own name. */
function aliasList(body: Record<string, unknown>, name: string): string | null {
  const value = text(body, "aliases", "Other names", 300, false);
  if (!value) return null;
  const seen = new Set([name.toLowerCase()]);
  const names = value.split(/[,;]/).map((part) => part.trim()).filter((part) => {
    if (!part || seen.has(part.toLowerCase())) return false;
    seen.add(part.toLowerCase());
    return true;
  });
  if (names.some((part) => part.length > 60)) throw new InputError(400, "Each other name must be 60 characters or fewer.");
  return names.join(", ") || null;
}

export function parseItemInput(body: unknown): ItemInput {
  if (!body || typeof body !== "object") throw new InputError(400, "Invalid item details.");
  const record = body as Record<string, unknown>;
  const name = text(record, "name", "Name", 120, true)!;
  const input: ItemInput = {
    name,
    aliases: aliasList(record, name),
    category: text(record, "category", "Category", 100, true)!,
    itemType: choice(record, "itemType", "item type", ITEM_TYPES),
    unit: text(record, "unit", "Unit", 30, true)!,
    status: choice(record, "status", "status", ITEM_STATUSES),
    storageLocation: text(record, "storageLocation", "Storage location", 120, false),
    reorderThreshold: whole(record, "reorderThreshold", "Reorder level", 0, 100_000),
    lendingAudience: choice(record, "lendingAudience", "lending audience", LENDING_AUDIENCES),
    needsReview: record.needsReview === true,
    notes: text(record, "notes", "Notes", 1000, false, true),
    ...(record.stockArea === undefined ? {} : { stockArea: choice(record, "stockArea", "stock area", STOCK_AREAS) }),
    ...(record.expiresOn === undefined ? {} : { expiresOn: isoDate(record.expiresOn, "Expiry date") })
  };
  // Only a Consumable is opened and used gradually; anything else is stored as a whole unit.
  if (input.itemType !== "Consumable") input.consumptionMode = "WHOLE_UNIT";
  else if (record.consumptionMode !== undefined) input.consumptionMode = choice(record, "consumptionMode", "way it is used", CONSUMPTION_MODES);
  if (input.lendingAudience !== "NOT_AVAILABLE_FOR_LENDING" && !LISTABLE_ITEM_TYPES.has(input.itemType)) {
    throw new InputError(400, "Only Loanable or Consumable items can be listed on the Lending Hub.");
  }
  return input;
}

/** A calendar date as YYYY-MM-DD, or null when left empty. */
export function isoDate(value: unknown, label: string): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new InputError(400, `${label} must be a real date.`);
  }
  return value;
}

/** Reuses another item's stored spelling of a category, unit or location that differs only in letter case. */
async function canonical(db: D1Database, input: ItemInput, itemId = ""): Promise<ItemInput> {
  const lookup = (column: string, value: string | null) => value
    ? db.prepare(`SELECT ${column} AS value FROM items WHERE ${column} = ? COLLATE NOCASE AND id <> ? ORDER BY ${column} = ? DESC LIMIT 1`).bind(value, itemId, value).first<string>("value")
    : Promise.resolve(null);
  const [category, unit, location] = await Promise.all([lookup("category", input.category), lookup("unit", input.unit), lookup("storage_location", input.storageLocation)]);
  return { ...input, category: category ?? input.category, unit: unit ?? input.unit, storageLocation: location ?? input.storageLocation };
}

const EDITABLE: Array<[keyof ItemInput, string]> = [
  ["name", "name"], ["aliases", "aliases"], ["category", "category"], ["itemType", "item_type"], ["unit", "unit"], ["status", "status"],
  ["storageLocation", "storage_location"], ["reorderThreshold", "reorder_threshold"], ["lendingAudience", "lending_audience"],
  ["needsReview", "needs_review"], ["notes", "notes"],
  ["stockArea", "stock_area"], ["expiresOn", "expires_on"], ["consumptionMode", "consumption_mode"]
];
const stored = (value: ItemInput[keyof ItemInput]) => typeof value === "boolean" ? Number(value) : value;

/**
 * The one audit writer. Details must never contain passwords, hashes, keys or tokens.
 * With `afterChange`, the row is written only when the previous statement in the batch changed a row.
 */
export function audit(db: D1Database, actorId: string | null, action: string, entityType: "ITEM" | "ACCOUNT" | "RECOVERY" | "EXPORT" | "SETTING" | "RETENTION", entityId: string, details: unknown, afterChange = false): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json) SELECT ?, ?, ?, ?, ?, ?, ?${afterChange ? " WHERE changes() > 0" : ""}`)
    .bind(crypto.randomUUID(), new Date().toISOString(), actorId, action, entityType, entityId, JSON.stringify(details));
}

const STALE = "Someone else changed this item while you were editing. Your changes were not saved; review the latest details and try again.";

/**
 * Applies a catalog edit. `expectedUpdatedAt` is the version the editor loaded, so a stale
 * form can never silently overwrite another staff member's change.
 */
export async function updateItem(db: D1Database, actor: Actor, id: string, parsed: ItemInput, expectedUpdatedAt: unknown) {
  if (expectedUpdatedAt !== null && typeof expectedUpdatedAt !== "string") throw new InputError(400, "Missing item version. Reload the item and try again.");
  const current = await db.prepare(`SELECT ${EDITABLE.map(([key, column]) => `${column} AS ${key}`).join(", ")}, updated_at AS updatedAt FROM items WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!current) throw new InputError(404, "Item not found.");
  if (current.updatedAt !== expectedUpdatedAt) throw new InputError(409, STALE);
  const input = await canonical(db, parsed, id);
  const changed = EDITABLE.filter(([key]) => input[key] !== undefined && current[key] !== stored(input[key]));
  if (!changed.length) return { changed: 0, updatedAt: current.updatedAt };
  const now = new Date().toISOString();
  const [update] = await guarded(db.batch([
    db.prepare(`UPDATE items SET ${changed.map(([, column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND updated_at IS ?`)
      .bind(...changed.map(([key]) => stored(input[key])), now, id, expectedUpdatedAt),
    audit(db, actor.accountId, "ITEM_UPDATED", "ITEM", id, Object.fromEntries(changed.map(([key]) => [key, { from: current[key], to: stored(input[key]) }])), true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]));
  if (!update!.meta.changes) throw new InputError(409, STALE);
  return { changed: changed.length, updatedAt: now };
}

export async function createItem(db: D1Database, actor: Actor, parsed: ItemInput, openingQuantity: number) {
  const input = await canonical(db, parsed);
  const now = new Date().toISOString();
  // Two staff creating at once can race for the next ID; the primary key rejects the loser, which retries.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = await db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) + 1 AS next FROM items WHERE id LIKE 'ITM-%'").first<number>("next");
    const id = `ITM-${String(next).padStart(4, "0")}`;
    const statements = [
      db.prepare(`INSERT INTO items(id, name, aliases, category, item_type, unit, status, storage_location, reorder_threshold, lending_audience,
        needs_review, notes, stock_area, expires_on, consumption_mode, imported_from, imported_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOGISTICS_HUB', ?, ?)`)
        .bind(id, input.name, input.aliases, input.category, input.itemType, input.unit, input.status, input.storageLocation, input.reorderThreshold, input.lendingAudience,
          Number(input.needsReview), input.notes, input.stockArea ?? "Inventory", input.expiresOn ?? null, input.consumptionMode ?? "WHOLE_UNIT", now, now),
      audit(db, actor.accountId, "ITEM_CREATED", "ITEM", id, { ...input, openingQuantity }),
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
  // A count records what was observed on the shelf, even when it matches (a 0 adjustment).
  COUNT: { type: "COUNT_ADJUSTMENT", direction: "ADJUST", signed: "?1 - b.on_hand", guard: "1" }
} as const;

export async function recordMovement(db: D1Database, actor: Actor, itemId: string, body: unknown) {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kind = choice(record, "kind", "movement", ["IN", "OUT", "COUNT"] as const);
  const quantity = whole(record, "quantity", kind === "COUNT" ? "Counted quantity" : "Quantity", kind === "COUNT" ? 0 : 1, 100_000);
  const reason = kind === "COUNT" ? null : choice(record, "reason", "reason", MOVEMENT_REASONS[kind]);
  const note = text(record, "note", kind === "COUNT" ? "Reason" : "Note", 500, kind === "COUNT" || reason === "OTHER");
  const key = typeof record.key === "string" && /^[A-Za-z0-9-]{8,80}$/.test(record.key) ? record.key : null;
  if (!key) throw new InputError(400, "Missing request key.");
  // The quantity editor sends the figure it showed, so a change made elsewhere meanwhile is never overwritten blindly.
  const expected = record.expectedOnHand === undefined || record.expectedOnHand === null ? null : whole(record, "expectedOnHand", "Expected quantity", -1_000_000, 1_000_000);
  if (kind === "COUNT" && expected === null) throw new InputError(400, "Refresh the item before recording a count.");
  const reorderId = record.reorderId === undefined || record.reorderId === null ? null : record.reorderId;
  if (reorderId !== null) {
    if (kind !== "IN" || typeof reorderId !== "string" || !/^RO-[A-Za-z0-9-]{1,60}$/.test(reorderId)) throw new InputError(400, "Only a Stock in can receive a restock entry.");
    const open = await db.prepare(`SELECT 1 FROM reorders WHERE id = ? AND item_id = ? AND status IN (${OPEN_REORDERS})`).bind(reorderId, itemId).first();
    const received = await db.prepare("SELECT 1 FROM inventory_movements WHERE idempotency_key = ?").bind(key).first();
    if (!open && !received) throw new InputError(409, "That restock entry is already closed. Refresh to see the latest list.");
  }
  // A count below the open units must say so: it closes the extra ones (oldest first) in the same batch.
  const reconcile = kind === "COUNT" && record.reconcileOpen === true;
  const movement = MOVEMENTS[kind];
  const movementId = `MOV-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (reconcile) {
    // Guarded exactly like the count below (same balance, unused key), so both happen or neither does.
    statements.push(db.prepare(`UPDATE open_units SET closed_at = ?1, closed_by = ?2, close_kind = 'COUNTED', movement_id = ?3
      WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY opened_at DESC, id DESC) AS n FROM open_units WHERE item_id = ?4 AND closed_at IS NULL) WHERE n > ?5)
        AND (SELECT on_hand FROM inventory_balances WHERE id = ?4) = ?6 AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE idempotency_key = ?7)`)
      .bind(now, actor.accountId, movementId, itemId, quantity, expected, key),
    db.prepare(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
      SELECT ?1, ?2, ?3, 'UNIT_RECONCILED', 'ITEM', ?4, json_object('closed', changes(), 'counted', ?5) WHERE changes() > 0`)
      .bind(crypto.randomUUID(), now, actor.accountId, itemId, quantity));
  }
  // One statement computes the signed quantity from the live balance and applies
  // the guard, so concurrent writers cannot drive stock negative or double-count.
  statements.push(
    db.prepare(`INSERT OR IGNORE INTO inventory_movements(id, created_at, movement_type, direction, item_id, quantity, unit, signed_quantity, actor_user_id, idempotency_key, notes, reason, status)
      SELECT ?2, ?3, '${movement.type}', '${movement.direction}', i.id, ABS(${movement.signed}), i.unit, ${movement.signed}, ?4, ?5, ?6, ?8, 'POSTED'
      FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.id = ?7 AND ${movement.guard} AND (?9 IS NULL OR b.on_hand = ?9)`)
      .bind(quantity, movementId, now, actor.accountId, key, note, itemId, reason, expected),
    // changes() still refers to the INSERT, so a retry or refused write leaves the revision untouched.
    db.prepare(`${BUMP_REVISION} AND changes() > 0`));
  if (reorderId) {
    // Closes the restock entry only if this request's movement was actually written.
    statements.push(db.prepare(`UPDATE reorders SET status = 'RESTOCKED', movement_id = ?1, closed_at = ?2, updated_at = ?2, updated_by = ?3
      WHERE id = ?4 AND item_id = ?5 AND status IN (${OPEN_REORDERS}) AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = ?1)`)
      .bind(movementId, now, actor.accountId, reorderId, itemId));
    statements.push(audit(db, actor.accountId, "REORDER_RESTOCKED", "ITEM", itemId, { quantity }, true));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    // The database keeps open units within on-hand (migration 0017); say what to do instead.
    if (!(error instanceof Error && error.message.includes("open_units_exceed_on_hand"))) throw error;
    const open = await db.prepare("SELECT COUNT(*) AS open FROM open_units WHERE item_id = ? AND closed_at IS NULL").bind(itemId).first<number>("open") ?? 0;
    throw new InputError(409, kind === "COUNT"
      ? `${open} ${open === 1 ? "unit is" : "units are"} open, more than the ${quantity} you counted. Close the extra open units with this count, or correct them first.`
      : `${open} of the units on hand ${open === 1 ? "is" : "are"} open, so ${quantity} cannot be taken out. Mark an open unit empty instead, or correct the open units first.`);
  }
  // Found for a first write and for an idempotent retry alike.
  const written = await db.prepare(`SELECT m.item_id AS itemId, m.signed_quantity AS change, b.on_hand AS onHand
    FROM inventory_movements m JOIN inventory_balances b ON b.id = m.item_id WHERE m.idempotency_key = ?`).bind(key).first<{ itemId: string; change: number; onHand: number }>();
  if (written?.itemId === itemId) return { onHand: written.onHand, change: written.change };
  if (written) throw new InputError(409, "That request was already used for another item. Please try again.");
  const balance = await db.prepare("SELECT on_hand AS onHand FROM inventory_balances WHERE id = ?").bind(itemId).first<number>("onHand");
  if (balance === null) throw new InputError(404, "Item not found.");
  if (expected !== null && balance !== expected) throw new InputError(409, `Someone else just changed this item: ${balance} on hand now. Check the figure and save again.`);
  throw new InputError(409, `Only ${balance} on hand; cannot remove ${quantity}.`);
}
