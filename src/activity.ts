import { ACTIVITY_SOURCES, ACTIVITY_TITLES, LABELS, REVIEW_REASONS, STOCK_AREAS, type ActivitySource, units } from "./catalog-policy";
import { InputError, actorName } from "./inventory";
import { OPEN_REVIEW, balanceCtes } from "./self-service";

/**
 * Activity: one newest-first feed of who did what, read from the tables that already record it.
 * It is a read model, never an authority: quantity stays the movement ledger's, loan state the
 * loans', review state the phone records'. Borrower names, student IDs and phone person names are never
 * selected, so they cannot reach the output or a search. Typed reasons and notes show as written, like
 * Loans and Self-Service do; the search reads the same columns the output shows.
 *
 * Arms of one UNION ALL (each filtered and limited before the merge, so a page costs about the
 * page size, not the history):
 *   mov     inventory_movements, enriched with loans. The only arm that owns a quantity change: a
 *           POSTED movement counts, a SUPERSEDED one (kept as evidence) is 0.
 *   audit   audit_log. LOAN_CREATED and a good LOAN_CLOSED repeat a movement, so they are dropped;
 *           damaged/lost closings stay (no movement exists for them, change 0). Account and
 *           recovery events exist only for ADMIN and OWNER.
 *   phone   self_service_events that are not just a duplicate of a movement: returns, held records
 *           and anything a review was opened on.
 *   resolve the staff resolution of such a held record.
 */

const SOURCES = Object.keys(ACTIVITY_SOURCES) as ActivitySource[];
const ACTIVITY_TYPES = Object.keys(ACTIVITY_TITLES);
/** Catalog and restock fields an audit entry may name; anything else in its JSON is never read. */
const FIELDS: Record<string, string> = {
  name: "name", aliases: "aliases", category: "category", itemType: "type", unit: "unit", status: "status", storageLocation: "location", reorderThreshold: "restock level",
  lendingAudience: "lending audience", needsReview: "review flag", notes: "notes", stockArea: "stock area", expiresOn: "expiry date", desiredQuantity: "quantity to restock", note: "note"
};
const MAX_LIMIT = 100;
const SENTINEL = "0000-01-01T00:00:00.000Z";
const MANILA_OFFSET_MS = 8 * 60 * 60_000;

/**
 * The one time every order, cursor and date filter uses: the stored text as UTC with milliseconds
 * (the stored timestamps mix "Z" and "+08:00"). Text that is not a date becomes the oldest possible
 * key, so it sorts last and is shown as "unknown" instead of as an invented time.
 */
const utc = (column: string) => `COALESCE(CASE WHEN ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) END, '${SENTINEL}')`;

/* ---------- Query ---------- */

export type ActivityFilters = {
  q?: string; item?: string; actor?: string; source?: string; type?: string; from?: string; to?: string;
  stockArea?: string; location?: string; changed?: "yes" | "no"; attention?: boolean;
};
export type ActivityQuery = { filters: ActivityFilters; cursor: string | null; limit: number };

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|((?:mov|audit|phone|resolve):[A-Za-z0-9._-]{1,80})$/;
const DAY = /^(20\d\d)-(\d\d)-(\d\d)$/;

/** Validates the query string; the filters stay separate from the page so an export can reuse them without a cursor. */
export function parseActivityQuery(params: URLSearchParams): ActivityQuery {
  const one = (name: string) => {
    const values = params.getAll(name);
    if (values.length > 1) throw new InputError(400, `Use only one ${name}.`);
    return values[0]?.trim() || undefined;
  };
  const pick = <T extends string>(name: string, allowed: readonly T[]): T | undefined => {
    const value = one(name);
    if (value !== undefined && !(allowed as readonly string[]).includes(value)) throw new InputError(400, `Choose a valid ${name}.`);
    return value as T | undefined;
  };
  const match = (name: string, pattern: RegExp) => {
    const value = one(name);
    if (value !== undefined && !pattern.test(value)) throw new InputError(400, `Choose a valid ${name}.`);
    return value;
  };
  const day = (name: string) => {
    const value = match(name, DAY);
    if (value && manilaDay(value, 0) === null) throw new InputError(400, `Choose a valid ${name} date.`);
    return value;
  };
  const text = (name: string, max: number) => {
    const value = one(name);
    if (value !== undefined && (value.length > max || /[\u0000-\u001f]/.test(value))) throw new InputError(400, `Keep ${name} under ${max} characters.`);
    return value;
  };
  const filters: ActivityFilters = {
    q: text("q", 80), item: match("item", /^ITM-[A-Za-z0-9-]{1,24}$/), actor: match("actor", /^(ACC-[A-Za-z0-9-]{1,60}|SELF_SERVICE|SYSTEM)$/),
    source: pick("source", SOURCES), type: pick("type", ACTIVITY_TYPES), from: day("from"), to: day("to"),
    stockArea: pick("stockArea", STOCK_AREAS), location: text("location", 80), changed: pick("changed", ["yes", "no"] as const), attention: pick("attention", ["1"] as const) ? true : undefined
  };
  if (filters.from && filters.to && filters.from > filters.to) throw new InputError(400, "The start date must not be after the end date.");
  const cursor = one("cursor") ?? null;
  if (cursor !== null) {
    const parsed = CURSOR.exec(cursor);
    if (!parsed || !Number.isFinite(Date.parse(parsed[1]!)) || new Date(parsed[1]!).toISOString() !== parsed[1]) throw new InputError(400, "That page marker is not valid. Reload the list.");
  }
  const rawLimit = one("limit");
  if (rawLimit !== undefined && !/^\d{1,3}$/.test(rawLimit)) throw new InputError(400, `Choose a page size from 1 to ${MAX_LIMIT}.`);
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (limit < 1 || limit > MAX_LIMIT) throw new InputError(400, `Choose a page size from 1 to ${MAX_LIMIT}.`);
  return { filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) as ActivityFilters, cursor, limit };
}

/** Midnight (Asia/Manila, no daylight saving) of a calendar day, `plus` days later, as the UTC key; null if the day does not exist. */
function manilaDay(day: string, plus: number): string | null {
  const [, y, m, d] = DAY.exec(day)!;
  const start = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const check = new Date(start);
  if (check.getUTCFullYear() !== Number(y) || check.getUTCMonth() !== Number(m) - 1 || check.getUTCDate() !== Number(d)) return null;
  return new Date(start + plus * 86_400_000 - MANILA_OFFSET_MS).toISOString();
}

const COLUMNS = ["sid", "k", "src", "type", "itemId", "itemName", "unit", "actorId", "actor", "qty", "delta", "status", "reason", "outcome", "note", "corr", "purpose", "review", "details", "mov", "open"] as const;
type Column = typeof COLUMNS[number];
type Arm = {
  prefix: string; id: string; from: string; where: string; cols: Record<Column, string>;
  sources: readonly string[]; owns: (type: string) => boolean; moves: boolean;
};

const PHONE_TYPES = ["PHONE_TAKE", "PHONE_BORROW", "PHONE_RETURN"];
const AUDIT_LOAN = "CASE WHEN json_valid(a.details_json) THEN json_extract(a.details_json, '$.loanId') END";
const AUDIT_OUTCOME = "CASE WHEN json_valid(a.details_json) THEN json_extract(a.details_json, '$.outcome') END";

function arms(admin: boolean): Arm[] {
  const base = { qty: "NULL", delta: "0", status: "NULL", reason: "NULL", outcome: "NULL", note: "NULL", purpose: "NULL", review: "NULL", details: "NULL", mov: "NULL", open: "0" };
  const item = { itemId: "i.id", itemName: "i.name", unit: "i.unit" };
  const movementType = ["OPENING_BALANCE", "STOCK_IN", "STOCK_OUT", "COUNT_ADJUSTMENT", "ISSUE", "LOAN_OUT", "LOAN_RETURN"];
  return [
    {
      prefix: "mov:", id: "m.id", sources: ["MOVEMENT", "LOAN", "PHONE"], moves: true, owns: (type) => movementType.includes(type),
      from: `inventory_movements m JOIN items i ON i.id = m.item_id LEFT JOIN staff_accounts a ON a.id = m.actor_user_id
        LEFT JOIN loans l ON m.related_entity_type = 'LOAN' AND l.id = m.related_entity_id`,
      where: "1",
      cols: {
        ...base, ...item, sid: "'mov:' || m.id", k: utc("m.created_at"), src: "CASE m.related_entity_type WHEN 'LOAN' THEN 'LOAN' WHEN 'SELF_SERVICE' THEN 'PHONE' ELSE 'MOVEMENT' END",
        type: "m.movement_type", actorId: "m.actor_user_id", actor: actorName("a", "m.actor_user_id"), qty: "m.quantity",
        delta: "CASE WHEN m.status = 'POSTED' THEN m.signed_quantity ELSE 0 END", status: "m.status",
        reason: "COALESCE(m.reason, CASE WHEN m.movement_type = 'LOAN_OUT' THEN l.reason END)",
        note: "CASE WHEN m.movement_type = 'LOAN_RETURN' THEN COALESCE(m.notes, l.return_note) ELSE m.notes END",
        corr: "COALESCE(m.related_entity_id, m.id)", purpose: "l.purpose", mov: "m.id"
      }
    },
    {
      prefix: "audit:", id: "a.id", sources: admin ? ["CATALOG", "LOAN", "ACCOUNT"] : ["CATALOG", "LOAN"], moves: false, owns: (type) => !movementType.includes(type) && !PHONE_TYPES.includes(type) && type !== "REVIEW_RESOLVED",
      // A closing entry's loan is its own (`loans.id` is the key): the join adds no row and supplies the typed return note.
      from: `audit_log a LEFT JOIN items i ON a.entity_type = 'ITEM' AND i.id = a.entity_id LEFT JOIN staff_accounts c ON c.id = a.actor_user_id
        LEFT JOIN loans l ON a.action = 'LOAN_CLOSED' AND l.id = ${AUDIT_LOAN}`,
      // Account and recovery events are refused here, before any search or page limit, unless the reader is ADMIN or OWNER.
      where: `a.action <> 'LOAN_CREATED' AND NOT (a.action = 'LOAN_CLOSED' AND COALESCE(${AUDIT_OUTCOME}, '') = 'RETURNED')${admin ? "" : " AND a.entity_type = 'ITEM'"}`,
      cols: {
        ...base, sid: "'audit:' || a.id", k: utc("a.created_at"), itemId: "i.id", itemName: "i.name", unit: "i.unit",
        src: "CASE WHEN a.action = 'LOAN_CLOSED' THEN 'LOAN' WHEN a.entity_type = 'ITEM' THEN 'CATALOG' ELSE 'ACCOUNT' END",
        type: `CASE WHEN a.action = 'LOAN_CLOSED' THEN CASE ${AUDIT_OUTCOME} WHEN 'DAMAGED' THEN 'LOAN_DAMAGED' WHEN 'LOST' THEN 'LOAN_LOST' ELSE 'LOAN_CLOSED' END ELSE a.action END`,
        actorId: "a.actor_user_id", actor: actorName("c", "a.actor_user_id"), details: "a.details_json", note: "l.return_note", corr: AUDIT_LOAN
      }
    },
    {
      prefix: "phone:", id: "e.id", sources: ["PHONE"], moves: false, owns: (type) => PHONE_TYPES.includes(type),
      from: "self_service_events e JOIN items i ON i.id = e.item_id",
      where: "(e.review IS NOT NULL OR e.event_type = 'RETURN' OR e.applied = 0)",
      cols: {
        ...base, ...item, sid: "'phone:' || e.id", k: utc("e.occurred_at"), src: "'PHONE'", type: "'PHONE_' || e.event_type", actorId: "'SELF_SERVICE'", actor: "'Self-service'",
        qty: "e.quantity", status: "CASE e.applied WHEN 1 THEN 'APPLIED' ELSE 'HELD' END", outcome: "e.return_outcome", corr: "COALESCE(e.loan_id, e.id)", purpose: "e.purpose",
        reason: "e.reason", note: "e.note",
        review: "e.review", open: `CASE WHEN ${OPEN_REVIEW} THEN 1 ELSE 0 END`
      }
    },
    {
      prefix: "resolve:", id: "e.id", sources: ["PHONE"], moves: false, owns: (type) => type === "REVIEW_RESOLVED",
      from: "self_service_events e JOIN items i ON i.id = e.item_id LEFT JOIN staff_accounts r ON r.id = e.resolved_by",
      where: "e.resolved_at IS NOT NULL",
      cols: {
        ...base, ...item, sid: "'resolve:' || e.id", k: utc("e.resolved_at"), src: "'PHONE'", type: "'REVIEW_RESOLVED'", actorId: "e.resolved_by", actor: "r.display_name",
        qty: "e.quantity", note: "e.resolution_note", corr: "COALESCE(e.loan_id, e.id)", review: "e.review",
        // What staff decided, from facts the resolution froze: a COUNT_OVERLAP record was applied at sync and only checked;
        // any other held record is applied (or matched) now, or dismissed and still unapplied.
        outcome: "e.event_type || CASE WHEN e.review = 'COUNT_OVERLAP' THEN ':CHECKED' WHEN e.applied = 1 THEN ':ACCEPTED' ELSE ':DISMISSED' END"
      }
    }
  ];
}

const like = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** The predicate that keeps only rows strictly after the cursor in (time, id) descending order, valid inside one arm. */
function afterCursor(arm: Arm, cursor: string, bind: (value: unknown) => string): string {
  const [time, sid] = cursor.split("|") as [string, string];
  const at = bind(time);
  const prefix = sid.slice(0, sid.indexOf(":") + 1);
  // Arms never share a prefix, so a whole arm sits before or after the cursor's id at an equal time.
  if (arm.prefix !== prefix) return arm.prefix < prefix ? `${arm.cols.k} <= ${at}` : `${arm.cols.k} < ${at}`;
  return `(${arm.cols.k} < ${at} OR (${arm.cols.k} = ${at} AND ${arm.id} < ${bind(sid.slice(prefix.length))}))`;
}

type Row = Record<Column, string | number | null> & { after: number | null; attention: number };

/**
 * One page of the feed, newest first. `admin` is the role gate (ADMIN or OWNER). Returns the page
 * and the cursor of the next one, if any; a cursor-less call with a cap is what an export needs.
 */
export async function activityPage(db: D1Database, admin: boolean, { filters, cursor, limit }: ActivityQuery) {
  const binds: unknown[] = [];
  const bind = (value: unknown) => { binds.push(value); return `?${binds.length}`; };
  const pattern = filters.q ? bind(like(filters.q)) : null;
  const from = filters.from ? bind(manilaDay(filters.from, 0)) : null;
  const to = filters.to ? bind(manilaDay(filters.to, 1)) : null;
  const size = bind(limit + 1);

  const selected = arms(admin).filter((arm) => (!filters.source || arm.sources.includes(filters.source)) && (!filters.type || arm.owns(filters.type)) && (filters.changed !== "yes" || arm.moves));
  if (!selected.length) return { events: [] as ActivityEvent[], nextCursor: null };
  const parts = selected.map((arm) => {
    const { cols } = arm;
    const where = [arm.where];
    if (filters.item) where.push(`${cols.itemId} = ${bind(filters.item)}`);
    if (filters.actor) where.push(filters.actor === "SYSTEM" ? `${cols.actorId} IS NULL` : `${cols.actorId} = ${bind(filters.actor)}`);
    if (filters.source) where.push(`${cols.src} = ${bind(filters.source)}`);
    if (filters.type) where.push(`${cols.type} = ${bind(filters.type)}`);
    if (from) where.push(`${cols.k} >= ${from}`);
    if (to) where.push(`${cols.k} < ${to}`);
    if (filters.stockArea) where.push(`i.stock_area = ${bind(filters.stockArea)}`);
    if (filters.location) where.push(`i.storage_location = ${bind(filters.location)} COLLATE NOCASE`);
    if (filters.changed) where.push(`${cols.delta} ${filters.changed === "yes" ? "<>" : "="} 0`);
    if (filters.attention) where.push(`(${cols.itemId} IN (SELECT itemId FROM bad) OR ${cols.open} = 1)`);
    if (pattern) where.push(`(i.name LIKE ${pattern} ESCAPE '\\' OR i.id LIKE ${pattern} ESCAPE '\\' OR i.aliases LIKE ${pattern} ESCAPE '\\' OR ${cols.actor} LIKE ${pattern} ESCAPE '\\' OR ${cols.reason} LIKE ${pattern} ESCAPE '\\' OR ${cols.note} LIKE ${pattern} ESCAPE '\\')`);
    if (cursor) where.push(afterCursor(arm, cursor, bind));
    const list = COLUMNS.map((column) => `${cols[column]} AS ${column}`).join(", ");
    return `SELECT * FROM (SELECT ${list} FROM ${arm.from} WHERE ${where.join(" AND ")} ORDER BY ${cols.k} DESC, ${arm.id} DESC LIMIT ${size})`;
  });

  // "Needs attention": a record waiting for a person, or an item whose balance went below zero since its
  // last count (the self-service review's own rule, here over every item, not just phone-touched ones in
  // 30 days). The warning is historical by design: it clears when a late entry or a new count fixes the order.
  const bad = `bad AS (SELECT r.itemId FROM running r LEFT JOIN counted c ON c.item_id = r.itemId WHERE r.t >= COALESCE(c.at, 0) GROUP BY r.itemId HAVING MIN(r.balance) < 0)`;
  const page = `page AS MATERIALIZED (${parts.join(" UNION ALL ")} ORDER BY k DESC, sid DESC LIMIT ${size})`;
  const warned = filters.attention ? [balanceCtes("SELECT id AS item_id FROM items"), bad, page] : [page, balanceCtes("SELECT DISTINCT itemId AS item_id FROM page WHERE itemId IS NOT NULL"), bad];
  // A POSTED movement's balance after it is its item's running total in business order, which `running` already holds.
  const { results } = await db.prepare(`WITH ${warned.join(", ")}
    SELECT p.*, CASE WHEN p.status = 'POSTED' THEN r.balance END AS after,
      CASE WHEN p.open = 1 OR p.itemId IN (SELECT itemId FROM bad) THEN 1 ELSE 0 END AS attention
    FROM page p LEFT JOIN running r ON p.mov IS NOT NULL AND r.movementId = p.mov ORDER BY p.k DESC, p.sid DESC`).bind(...binds).all<Row>();
  const more = results.length > limit;
  const rows = results.slice(0, limit);
  return { events: rows.map(toEvent), nextCursor: more ? `${rows[rows.length - 1]!.k}|${rows[rows.length - 1]!.sid}` : null };
}

/* ---------- Output ---------- */

export type ActivityEvent = {
  id: string; correlationId: string; at: string | null; source: string; type: string; title: string; summary: string; actor: string; actorId: string | null;
  itemId: string | null; itemName: string | null; unit: string | null; quantity: number | null; change: number; stockChanged: boolean; before: number | null; after: number | null;
  reason: string | null; note: string | null; fields: string[]; attention: boolean;
};

const PURPOSE: Record<string, string> = { INDIVIDUAL: " to an individual", USC: " for USC use" };
/** How an export entry names the filters it used; their values stay in the audit row only. */
const FILTER_NAMES: Record<string, string> = {
  q: "search", source: "source", type: "type", actor: "person", item: "item", from: "start date", to: "end date", stockArea: "stock area", location: "location", changed: "stock change", attention: "needs attention"
};

function toEvent(row: Row): ActivityEvent {
  const text = (value: unknown) => typeof value === "string" && value ? value : null;
  const details = parse(row.details);
  const type = String(row.type);
  const actor = text(row.actor) ?? "System";
  const item = text(row.itemName) ?? "an item";
  const unit = text(row.unit);
  const quantity = typeof row.qty === "number" ? row.qty : typeof details.quantity === "number" ? details.quantity : typeof details.desiredQuantity === "number" ? details.desiredQuantity : null;
  const amount = quantity === null ? "" : `${quantity}${unit ? ` ${units(quantity, unit)}` : ""} of `;
  const change = Number(row.delta);
  const after = typeof row.after === "number" ? row.after : null;
  const phoneRecord = type.startsWith("PHONE_") || type === "REVIEW_RESOLVED";
  const reason = phoneRecord ? (row.review ? REVIEW_REASONS[row.review as keyof typeof REVIEW_REASONS] ?? null : null) : text(row.reason) ? LABELS[String(row.reason)] ?? String(row.reason) : null;
  // A phone record's typed reason and note are one context line; the loan and movement arms carry theirs in `reason` and `note`.
  const note = phoneRecord ? [row.reason, row.note].filter((value) => text(value)).join(" · ") || null : text(row.note);
  const fields = ["ITEM_UPDATED", "REORDER_UPDATED"].includes(type) ? Object.keys(details).filter((key) => key in FIELDS).map((key) => FIELDS[key]!)
    : type === "ACTIVITY_EXPORTED" && details.filters && typeof details.filters === "object" ? Object.keys(details.filters).filter((key) => key in FILTER_NAMES).map((key) => FILTER_NAMES[key]!) : [];
  const account = row.src === "ACCOUNT" && typeof details.username === "string" ? ` for ${details.username.slice(0, 60)}` : "";
  const purpose = PURPOSE[String(row.purpose)] ?? "";
  const held = row.status === "HELD";
  const outcome = text(row.outcome) ? ` (${String(row.outcome).toLowerCase()})` : "";
  const sentence: Record<string, () => string> = {
    OPENING_BALANCE: () => `${amount}${item} was carried over as the opening balance.`,
    ISSUE: () => `${amount}${item} was issued in the legacy system.`,
    STOCK_IN: () => `${actor} received ${amount}${item}${reason ? ` (${reason.toLowerCase()})` : ""}.`,
    STOCK_OUT: () => `${actor} took out ${amount}${item}${reason ? ` (${reason.toLowerCase()})` : ""}.`,
    COUNT_ADJUSTMENT: () => `${actor} counted ${item}${after === null ? "" : `: ${after}${unit ? ` ${units(after, unit)}` : ""} on hand`}.`,
    LOAN_OUT: () => `${actor} lent ${amount}${item}${purpose}.`,
    LOAN_RETURN: () => `${actor} took back ${amount}${item}.`,
    LOAN_DAMAGED: () => `${actor} closed a loan of ${item} as damaged; nothing went back to stock.`,
    LOAN_LOST: () => `${actor} closed a loan of ${item} as lost; nothing went back to stock.`,
    LOAN_CLOSED: () => `${actor} closed a loan of ${item}.`,
    REVIEW_RESOLVED: () => {
      const [kind, decision] = String(row.outcome).split(":");
      const what = `a phone ${String(kind).toLowerCase()} of ${amount}${item}`;
      if (decision === "CHECKED") return `${actor} marked ${what} as checked; it had already been recorded.`;
      if (decision === "DISMISSED") return `${actor} dismissed ${what}; nothing changed.`;
      return kind === "RETURN" ? `${actor} confirmed ${what}; the loan is closed.` : `${actor} applied ${what} that was held for staff.`;
    },
    ITEM_CREATED: () => `${actor} added ${item} to the catalog.`,
    ITEM_UPDATED: () => `${actor} edited ${item}${fields.length ? `: ${fields.join(", ")}` : ""}.`,
    REORDER_OPENED: () => `${actor} put ${item} on the restock list.`,
    REORDER_UPDATED: () => `${actor} updated the restock entry for ${item}${fields.length ? `: ${fields.join(", ")}` : ""}.`,
    REORDER_RESTOCKED: () => `${actor} received a restock of ${amount}${item}.`,
    OWNER_BOOTSTRAPPED: () => `${actor} was set up as the first owner from the Owner Console.`,
    ACTIVITY_EXPORTED: () => `${actor} exported ${details.rows === 1 ? "1 activity entry" : `${typeof details.rows === "number" ? details.rows : "some"} activity entries`} to a file${fields.length ? `, filtered by ${fields.join(", ")}` : ""}${details.truncated === true ? " (the newest; more matched)" : ""}.`
  };
  const phone = () => `A phone ${type.slice(6).toLowerCase()} of ${amount}${item}${outcome} was ${held ? "held for staff" : "recorded"}${reason ? `: ${reason}` : ""}.`;
  const summary = `${(type.startsWith("PHONE_") ? phone() : sentence[type]?.()) ?? `${ACTIVITY_TITLES[type] ?? "Change"}${account} by ${actor}.`}${row.status === "SUPERSEDED" ? " It did not change stock: a later count already covers it." : ""}`;
  const loan = typeof row.corr === "string" && /^LN-[A-Za-z0-9-]{1,60}$/.test(row.corr) ? row.corr : null;
  const known = row.k !== SENTINEL;
  return {
    id: String(row.sid), correlationId: loan ?? (typeof row.corr === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(row.corr) ? row.corr : String(row.sid)),
    at: known ? String(row.k) : null, source: String(row.src), type, title: ACTIVITY_TITLES[type] ?? type, summary, actor, actorId: text(row.actorId),
    itemId: text(row.itemId), itemName: text(row.itemName), unit, quantity, change, stockChanged: change !== 0, before: after === null ? null : after - change, after,
    reason, note, fields, attention: row.attention === 1
  };
}

/** Only names and numbers of a trusted audit entry are ever read back; a malformed one is just empty. */
function parse(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/* ---------- Export (CSV) ---------- */

/**
 * One file holds at most this many entries; when more match, the file and the person exporting are told.
 * Building a file costs about 10 µs of Worker CPU per entry (docs/ACTIVITY_PERF.md), so the cap also bounds that.
 */
export const EXPORT_ROWS = 2_000;
const EXPORT_COLUMNS = ["Time (Manila)", "Activity", "Description", "Actor", "Source", "Item ID", "Item", "Unit", "Change", "Before", "After", "Reason", "Note", "Reference", "Entry ID"];
/** A spreadsheet runs a text cell that starts like a formula; a leading apostrophe keeps it text. */
const FORMULA = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/;

function cell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  return `"${(FORMULA.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
}

/**
 * One file row. Owner decision B(ii): typed text from a loan or a phone record (loan reason, return
 * note, phone reason and note, resolution note) is left blank in a file, though the signed-in page shows
 * it. A cell is filled only from fields that carry no typed person-linked text: catalog names, staff
 * names, the fixed reason lists (a phone record's review reason is one) and a stock movement's own note.
 */
function exportRow(event: ActivityEvent): Array<string | number | null> {
  const personal = event.source === "LOAN" || event.source === "PHONE";
  const at = event.at === null ? null : new Date(Date.parse(event.at) + MANILA_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
  return [at, event.title, event.summary, event.actor, ACTIVITY_SOURCES[event.source as ActivitySource] ?? event.source, event.itemId, event.itemName, event.unit,
    event.change, event.before, event.after, event.source === "LOAN" ? null : event.reason, personal ? null : event.note, event.correlationId, event.id];
}

/** UTF-8 with a byte-order mark and CRLF lines, so Excel opens it as it is; fixed columns; every text cell quoted and guarded. */
export function activityCsv(events: ActivityEvent[], truncated: boolean): string {
  const lines = [EXPORT_COLUMNS.map(cell), ...events.map((event) => exportRow(event).map(cell))].map((row) => row.join(","));
  // The notice is a row of the same fixed columns, so a strict importer still reads every line.
  if (truncated) lines.push(EXPORT_COLUMNS.map((_, column) => cell(column === 1 ? "More entries match" : column === 2
    ? `One file holds the newest ${EXPORT_ROWS.toLocaleString("en-US")} entries. Narrow the filters, for example the dates, to export the rest.` : null)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** A file name the server chooses, never from input: logistics-activity-YYYYMMDD-HHMM.csv in Manila time. */
export function exportName(now: Date): string {
  const manila = new Date(now.getTime() + MANILA_OFFSET_MS).toISOString();
  return `logistics-activity-${manila.slice(0, 10).replaceAll("-", "")}-${manila.slice(11, 16).replace(":", "")}.csv`;
}

/**
 * The revision of this exact answer: a digest of what the reader may see plus the normalized question
 * and the role scope. It moves for anything visible (a rename, a same-time or backdated entry) and for
 * nothing hidden (an account event a STAFF reader cannot see), so it is the validator for this endpoint only.
 */
export async function activityTag(admin: boolean, query: ActivityQuery, result: { events: ActivityEvent[]; nextCursor: string | null }): Promise<string> {
  const { filters, cursor, limit } = query;
  const canonical = JSON.stringify([admin ? "all" : "operational", Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)), cursor, limit, result]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  return `"a${[...digest.subarray(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}
