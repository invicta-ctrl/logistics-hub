import { UNSETTLED_FINDING } from "./audits";
import { OPEN_REORDER_STATUSES, REVIEW_REASONS, type ReviewReason } from "./catalog-policy";
import { type Actor, InputError } from "./inventory";
import { kitsNotReady } from "./kits";
import { LOAN_ID, officeDay } from "./loans";
import { ERASED } from "./retention";

/*
 * Attention (V1.10): the records that deserve a person, derived from what Items, Stock, Loans, Locations, Kits, Catalog and
 * Self-Service already store. Nothing here is stored or kept in step: an entry exists exactly while its condition does, so fixing
 * the cause is what clears it. The one thing a person records is "I reviewed this return", an audit entry like any other.
 */

export const SOURCES = ["Loans", "Stock", "Locations", "Kits", "Catalog", "Self-Service"] as const;
export type Source = (typeof SOURCES)[number];
/** Now: act today. Soon: this week. Later: routine. Each reason fixes its urgency by a stated rule, never by a score. */
export type Urgency = "NOW" | "SOON" | "LATER";

export type Entry = {
  /** Stable while the condition lasts, so the page can keep your place across a refresh. */
  key: string;
  reason: string;
  source: Source;
  urgency: Urgency;
  title: string;
  why: string;
  /** When the condition began, where it has a real start; null when it is simply true now. */
  since: string | null;
  /** The record or screen where the next step is made. */
  href: string;
  action: string;
  /** Set when a person can mark it reviewed here. */
  review?: { loanId: string };
};

/** Past this many days an unreviewed damaged or lost return is left to the loan history instead of asking again. */
export const RETURN_PROBLEM_DAYS = 60;
const PER_REASON = 100;
const OPEN = [...OPEN_REORDER_STATUSES].map((status) => `'${status}'`).join(",");
const DAY_MS = 86_400_000;

/*
 * Out and Low are the two halves of one question about each item's balance, and the balance sums the whole movement ledger, so the
 * counts ask it once. Their lists and this count are built from the same rules below, and a test holds them to each other.
 */
const ASKED = `EXISTS (SELECT 1 FROM reorders r WHERE r.item_id = i.id AND r.status IN (${OPEN}))`;
const STOCK_BASE = "FROM items i JOIN inventory_balances b ON b.id = i.id WHERE i.status <> 'INACTIVE'";
const IS_OUT = "b.on_hand <= 0";
const IS_LOW = "b.on_hand > 0 AND i.reorder_threshold > 0 AND b.on_hand <= i.reorder_threshold";
const OUT_URGENCY = `CASE WHEN ${ASKED} THEN 'LATER' WHEN i.reorder_threshold > 0 THEN 'NOW' ELSE 'SOON' END`;
const LOW_URGENCY = `CASE WHEN ${ASKED} THEN 'LATER' ELSE 'SOON' END`;
const STOCK_COUNT = `SELECT CASE WHEN ${IS_OUT} THEN 'STOCK_OUT' ELSE 'STOCK_LOW' END AS reason, CASE WHEN ${IS_OUT} THEN ${OUT_URGENCY} ELSE ${LOW_URGENCY} END AS urgency, COUNT(*) AS n
  ${STOCK_BASE} AND (${IS_OUT} OR (${IS_LOW})) GROUP BY 1, 2`;
const STOCK_REASONS = new Set(["STOCK_OUT", "STOCK_LOW"]);

const day = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", timeZone: "Asia/Manila" });
export const dayOf = (value: string) => day.format(new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value));
const daysAgo = (value: string, now: number) => Math.max(0, Math.floor((now - Date.parse(value.length === 10 ? `${value}T00:00:00+08:00` : value)) / DAY_MS));
export const times = (count: number) => (count === 1 ? "once" : `${count} times`);
const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;
const borrower = (name: string) => (name === ERASED ? "A borrower whose record was removed" : name);

type Row = Record<string, string | number | null>;
type Reason = {
  id: string;
  source: Source;
  /** The heading the inbox groups under. */
  label: string;
  /** `FROM … WHERE …`, shared by the list and the count so they can never disagree. */
  from: string;
  /** SQL for the urgency of one row. */
  urgency: string;
  cols: string;
  order: string;
  bind?: (today: string, now: number) => Array<string | number>;
  entry: (row: Row, now: number) => Omit<Entry, "key" | "reason" | "source" | "urgency">;
};

/** The two catalog gaps, defined once: Attention lists them and Home counts them against the whole catalog. */
export const GAP_UNCLASSIFIED = "i.status = 'ACTIVE' AND i.item_type = 'NEEDS_REVIEW'";
export const GAP_NO_PLACE = "i.status = 'ACTIVE' AND i.item_type <> 'NEEDS_REVIEW' AND i.location_id IS NULL";

const REASONS: readonly Reason[] = [
  {
    id: "LOAN_OVERDUE", source: "Loans", label: "Overdue loans",
    from: "FROM loans l JOIN items i ON i.id = l.item_id WHERE l.status = 'OUT' AND l.return_by IS NOT NULL AND l.return_by < ?1",
    urgency: "'NOW'",
    cols: "l.id AS id, i.name AS item, l.quantity AS quantity, l.borrower_name AS who, l.return_by AS due",
    order: "l.return_by, l.id",
    bind: (today) => [today],
    entry: (row, now) => ({
      title: `${row.item}${Number(row.quantity) > 1 ? ` × ${row.quantity}` : ""}`,
      why: `${borrower(String(row.who))} was due to return it ${dayOf(String(row.due))}, ${days(daysAgo(String(row.due), now))} ago.`,
      since: String(row.due), href: `/staff/loans?loan=${row.id}`, action: "Open the loan"
    })
  },
  {
    id: "RETURN_PROBLEM", source: "Loans", label: "Damaged or lost returns",
    from: `FROM loans l JOIN items i ON i.id = l.item_id WHERE l.status IN ('DAMAGED', 'LOST') AND l.closed_at >= ?1
      AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type = 'ITEM' AND a.entity_id = l.item_id AND a.action = 'LOAN_REVIEWED' AND json_extract(a.details_json, '$.loanId') = l.id)`,
    urgency: "'SOON'",
    cols: "l.id AS id, i.name AS item, l.quantity AS quantity, l.status AS status, l.borrower_name AS who, l.closed_at AS at",
    order: "l.closed_at, l.id",
    bind: (_today, now) => [new Date(now - RETURN_PROBLEM_DAYS * DAY_MS).toISOString()],
    entry: (row) => ({
      title: `${row.item}${Number(row.quantity) > 1 ? ` × ${row.quantity}` : ""}`,
      why: `${borrower(String(row.who))} returned it ${row.status === "LOST" ? "as lost" : "damaged"} on ${dayOf(String(row.at))}. Nothing went back to stock.`,
      since: String(row.at), href: `/staff/loans?view=history&loan=${row.id}`, action: "Open the loan", review: { loanId: String(row.id) }
    })
  },
  {
    id: "STOCK_OUT", source: "Stock", label: "Out of stock",
    from: `${STOCK_BASE} AND ${IS_OUT}`,
    urgency: OUT_URGENCY,
    cols: `i.id AS id, i.name AS item, i.reorder_threshold AS level, ${ASKED} AS asked`,
    order: "i.reorder_threshold > 0 DESC, i.name COLLATE NOCASE, i.id",
    entry: (row) => ({
      title: String(row.item),
      why: row.asked ? "None left. A restock is already requested." : Number(row.level) > 0 ? `None left, and staff keep at least ${row.level}.` : "None left.",
      since: null, href: `/staff/items?item=${row.id}`, action: "Open the item"
    })
  },
  {
    id: "STOCK_LOW", source: "Stock", label: "Low stock",
    from: `${STOCK_BASE} AND ${IS_LOW}`,
    urgency: LOW_URGENCY,
    cols: `i.id AS id, i.name AS item, b.on_hand AS onHand, i.reorder_threshold AS level, ${ASKED} AS asked`,
    order: "i.name COLLATE NOCASE, i.id",
    entry: (row) => ({
      title: String(row.item),
      why: `${row.onHand} left; staff keep at least ${row.level}.${row.asked ? " A restock is already requested." : ""}`,
      since: null, href: `/staff/items?item=${row.id}`, action: "Open the item"
    })
  },
  {
    id: "FINDING", source: "Locations", label: "Check findings to settle",
    from: `FROM location_audit_observations o JOIN location_audits a ON a.id = o.audit_id LEFT JOIN items i ON i.id = o.item_id LEFT JOIN location_paths lp ON lp.id = a.location_id
      LEFT JOIN location_paths sp ON sp.id = o.seen_location_id WHERE o.outcome <> 'NEEDS_REVIEW' AND ${UNSETTLED_FINDING}`,
    urgency: "'SOON'",
    cols: "o.id AS id, o.audit_id AS audit, COALESCE(i.name, 'Not in the catalog') AS item, o.outcome AS outcome, o.counted AS counted, o.expected_on_hand AS expected, lp.path AS place, sp.path AS seen, o.received_at AS at",
    order: "o.received_at, o.rowid",
    entry: (row) => ({
      title: String(row.item),
      why: row.outcome === "MISMATCH" ? `Counted ${row.counted} at ${row.place ?? "a place"}; the record said ${row.expected}.`
        : row.outcome === "CANT_FIND" ? `Could not be found at ${row.place ?? "a place"}.`
        : row.outcome === "FOUND_HERE" ? `Found at ${row.seen ?? "another place"}, not where it is recorded.`
        : `Seen at ${row.seen ?? row.place ?? "a place"} but is not in the catalog.`,
      since: String(row.at), href: `/staff/catalogue?audit=${row.audit}`, action: "Settle the finding"
    })
  },
  {
    id: "RECORD_WRONG", source: "Catalog", label: "Records that look wrong",
    // Settled when the record is edited after it was flagged, or by the same rules as any other finding.
    from: `FROM location_audit_observations o JOIN location_audits a ON a.id = o.audit_id JOIN items i ON i.id = o.item_id WHERE o.outcome = 'NEEDS_REVIEW' AND ${UNSETTLED_FINDING}
      AND NOT (i.updated_at > o.received_at)`,
    urgency: "'LATER'",
    cols: "o.id AS id, i.id AS itemId, i.name AS item, o.note AS note, o.received_at AS at",
    order: "o.received_at, o.rowid",
    entry: (row) => ({
      title: String(row.item),
      why: row.note ? `Looked wrong at a check: ${row.note}` : "Looked wrong at a check.",
      since: String(row.at), href: `/staff/items?item=${row.itemId}&tab=details`, action: "Fix the record"
    })
  },
  {
    id: "REPEATED_REPORT", source: "Locations", label: "Reported more than once",
    from: `FROM (SELECT r.item_id AS itemId, COUNT(*) AS n, MIN(r.created_at) AS first, SUM(r.kind = 'CANT_FIND') AS cant FROM location_reports r WHERE r.resolved_at IS NULL
      GROUP BY r.item_id HAVING COUNT(*) >= 2) g JOIN items i ON i.id = g.itemId`,
    urgency: "'SOON'",
    cols: "i.id AS id, i.name AS item, g.n AS n, g.cant AS cant, g.first AS at",
    order: "g.first, i.id",
    entry: (row) => ({
      title: String(row.item),
      why: `Reported ${times(Number(row.n))} since ${dayOf(String(row.at))}: ${row.cant} could not find it, ${Number(row.n) - Number(row.cant)} said the place looks wrong.`,
      since: String(row.at), href: `/staff/items?item=${row.id}`, action: "Open the item"
    })
  },
  {
    id: "CLASSIFY", source: "Catalog", label: "Items to classify",
    from: `FROM items i WHERE ${GAP_UNCLASSIFIED}`,
    urgency: "'LATER'", cols: "i.id AS id, i.name AS item", order: "i.name COLLATE NOCASE, i.id",
    entry: (row) => ({ title: String(row.item), why: "Not classified yet, so it stays out of every public list.", since: null, href: `/staff/items?item=${row.id}&tab=details`, action: "Classify it" })
  },
  {
    id: "NO_PLACE", source: "Catalog", label: "Items without a place",
    from: `FROM items i WHERE ${GAP_NO_PLACE}`,
    urgency: "'LATER'", cols: "i.id AS id, i.name AS item", order: "i.name COLLATE NOCASE, i.id",
    entry: (row) => ({ title: String(row.item), why: "No place is recorded, so nobody can be told where to find it.", since: null, href: `/staff/items?item=${row.id}&tab=details`, action: "Choose a place" })
  },
  {
    id: "PHONE_RECORD", source: "Self-Service", label: "Phone records to check",
    from: "FROM self_service_events e JOIN items i ON i.id = e.item_id WHERE e.review IS NOT NULL AND e.resolved_at IS NULL",
    // A record held for more than a day is making someone wait.
    urgency: "CASE WHEN e.received_at < ?1 THEN 'NOW' ELSE 'SOON' END",
    cols: "e.id AS id, i.name AS item, e.quantity AS quantity, e.event_type AS type, e.review AS review, e.received_at AS at",
    order: "e.received_at, e.id",
    bind: (_today, now) => [new Date(now - DAY_MS).toISOString()],
    entry: (row) => ({
      title: `Phone ${String(row.type).toLowerCase()} of ${row.item}${Number(row.quantity) > 1 ? ` × ${row.quantity}` : ""}`,
      why: `${REVIEW_REASONS[row.review as ReviewReason] ?? "It needs a person to decide"}.`,
      since: String(row.at), href: "/staff/self-service", action: "Check the record"
    })
  },
  {
    id: "PHONE_REPORT", source: "Self-Service", label: "Reports from phones",
    from: "FROM location_reports r JOIN items i ON i.id = r.item_id WHERE r.source = 'SELF_SERVICE' AND r.resolved_at IS NULL",
    urgency: "'SOON'", cols: "r.id AS id, i.id AS itemId, i.name AS item, r.kind AS kind, r.created_at AS at", order: "r.created_at, r.id",
    entry: (row) => ({
      title: String(row.item),
      why: row.kind === "CANT_FIND" ? "Someone using Self-Service could not find it." : "Someone using Self-Service says its place looks wrong.",
      since: String(row.at), href: `/staff/items?item=${row.itemId}`, action: "Open the item"
    })
  }
];

/** A kit is not Ready because something is short (replenish) or because something needs a person to look (review). */
const KIT_LABELS = { REPLENISH: "Kits to replenish", REVIEW: "Kits to review" } as const;

export type Group = { reason: string; source: Source; label: string; total: number; /** The true totals by urgency, however many entries are listed. */ byUrgency: Record<Urgency, number> };
const byUrgency = (rows: Array<{ urgency: Urgency; n: number }>): Record<Urgency, number> => { const out = { NOW: 0, SOON: 0, LATER: 0 }; for (const row of rows) out[row.urgency] += row.n; return out; };

const bindFor = (reason: Reason, today: string, now: number) => reason.bind?.(today, now) ?? [];

const listSql = (reason: Reason) => `SELECT ${reason.cols}, ${reason.urgency} AS urgency ${reason.from} ORDER BY ${reason.order} LIMIT ${PER_REASON}`;
const countSql = (reason: Reason) => `SELECT ${reason.urgency} AS urgency, COUNT(*) AS n ${reason.from} GROUP BY 1`;

async function kitEntries(db: D1Database) {
  return (await kitsNotReady(db)).map((kit) => ({
    reason: kit.state === "REPLENISH" ? "KIT_REPLENISH" : "KIT_REVIEW", source: "Kits" as const, urgency: kit.state === "REPLENISH" ? "SOON" as const : "LATER" as const,
    key: `KIT:${kit.id}`, title: kit.name, why: kit.holding.length ? kit.holding.slice(0, 3).join(" ") : "Nothing is in it yet.", since: null, href: `/staff/kits?kit=${kit.id}`,
    action: kit.state === "REPLENISH" ? "Open the kit" : "Check the kit"
  }));
}

type Counts = Map<string, Array<{ urgency: Urgency; n: number }>>;
/** How many entries each reason has, by urgency: one batch, with Out and Low counted in a single pass over the ledger. */
async function countAll(db: D1Database, today: string, now: number): Promise<Counts> {
  const plain = REASONS.filter((reason) => !STOCK_REASONS.has(reason.id));
  const results = await db.batch([...plain.map((reason) => db.prepare(countSql(reason)).bind(...bindFor(reason, today, now))), db.prepare(STOCK_COUNT)]);
  const counts: Counts = new Map(REASONS.map((reason) => [reason.id, []]));
  plain.forEach((reason, at) => { for (const row of results[at]!.results as Array<{ urgency: Urgency; n: number }>) counts.get(reason.id)!.push(row); });
  for (const row of results[plain.length]!.results as Array<{ reason: string; urgency: Urgency; n: number }>) counts.get(row.reason)!.push(row);
  return counts;
}

/** The groups, one per reason, each with its true total and the totals by urgency: the one definition the inbox, the bell and Home share. */
function groupsOf(counts: Counts, kits: Array<{ reason: string; urgency: Urgency }>): Group[] {
  const groups: Group[] = REASONS.map((reason) => {
    const rows = counts.get(reason.id)!;
    return { reason: reason.id, source: reason.source, label: reason.label, total: rows.reduce((sum, row) => sum + row.n, 0), byUrgency: byUrgency(rows) };
  });
  for (const state of ["REPLENISH", "REVIEW"] as const) {
    const mine = kits.filter((entry) => entry.reason === `KIT_${state}`);
    groups.push({ reason: `KIT_${state}`, source: "Kits", label: KIT_LABELS[state], total: mine.length, byUrgency: byUrgency(mine.map((entry) => ({ urgency: entry.urgency, n: 1 }))) });
  }
  return groups;
}

/** Everything that needs a person, grouped by reason, each reason bounded; `groups` carries the true totals. */
export async function attention(db: D1Database) {
  const now = Date.now();
  const today = officeDay(new Date(now));
  const [lists, counts, kits] = await Promise.all([
    db.batch(REASONS.map((reason) => db.prepare(listSql(reason)).bind(...bindFor(reason, today, now)))),
    countAll(db, today, now),
    kitEntries(db)
  ]);
  const entries: Entry[] = [];
  REASONS.forEach((reason, at) => {
    for (const row of lists[at]!.results as Row[]) {
      entries.push({ key: `${reason.id}:${row.id}`, reason: reason.id, source: reason.source, urgency: row.urgency as Urgency, ...reason.entry(row, now) });
    }
  });
  entries.push(...kits);
  return { today, groups: groupsOf(counts, kits), entries };
}

/**
 * The numbers for the staff shell and Home: how many need a person now or soon, in total and by where they are handled, and the
 * groups they come from (counts only, no entries). One definition, so the bell, Home and the inbox cannot disagree.
 */
export async function attentionSummary(db: D1Database) {
  const now = Date.now();
  const today = officeDay(new Date(now));
  const [counts, kits] = await Promise.all([countAll(db, today, now), kitEntries(db)]);
  const groups = groupsOf(counts, kits);
  const bySource: Record<string, number> = Object.fromEntries(SOURCES.map((source) => [source, 0]));
  for (const group of groups) bySource[group.source]! += group.byUrgency.NOW + group.byUrgency.SOON;
  return { needsAction: Object.values(bySource).reduce((sum, count) => sum + count, 0), bySource, groups };
}

/**
 * A person has looked at a damaged or lost return and decided what it needs. The loan keeps its record; this only stops the inbox
 * asking. Written once per loan: a second review answers with the first.
 */
export async function reviewReturn(db: D1Database, actor: Actor, loanId: string) {
  if (!LOAN_ID.test(loanId)) throw new InputError(404, "Not found.");
  const loan = await db.prepare("SELECT l.id, l.item_id AS itemId, l.status FROM loans l WHERE l.id = ?").bind(loanId).first<{ id: string; itemId: string; status: string }>();
  if (!loan) throw new InputError(404, "Not found.");
  if (loan.status !== "DAMAGED" && loan.status !== "LOST") throw new InputError(409, "Only a damaged or lost return needs a review.");
  await db.prepare(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
      SELECT ?1, ?2, ?3, 'LOAN_REVIEWED', 'ITEM', ?4, ?5
      WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type = 'ITEM' AND a.entity_id = ?4 AND a.action = 'LOAN_REVIEWED' AND json_extract(a.details_json, '$.loanId') = ?6)`)
    .bind(crypto.randomUUID(), new Date().toISOString(), actor.accountId, loan.itemId, JSON.stringify({ loanId: loan.id, outcome: loan.status }), loan.id).run();
  return { reviewed: true };
}

/** Records waiting for a person in Self-Service: what the staff shell's Self-Service badge counts, from the same definitions as the inbox. */
export async function selfServiceToCheck(db: D1Database): Promise<number> {
  const mine = REASONS.filter((reason) => reason.source === "Self-Service");
  const now = Date.now();
  const counts = await db.batch(mine.map((reason) => db.prepare(countSql(reason)).bind(...bindFor(reason, officeDay(new Date(now)), now))));
  return counts.reduce((sum, result) => sum + (result.results as Array<{ n: number }>).reduce((inner, row) => inner + row.n, 0), 0);
}
