import { GAP_NO_PLACE, GAP_UNCLASSIFIED, dayOf, times } from "./attention";
import { behaviourOf, BEHAVIOUR_LABELS } from "./catalog-policy";
import { openSession } from "./catalogue";
import { openChecks } from "./audits";
import type { Actor } from "./inventory";

/*
 * Operations home (V1.12). Two reads, neither stored: what this person can pick up where they left off, and a handful of practical
 * insights. What needs attention is not here at all: Home takes it from the Attention summary the staff bar already loads, so the
 * bell, Home and the inbox are one set of numbers. Insights are bounded (an explicit time window, a minimum of two events, at
 * most five rows a card), run in one batch, and are fetched after the page is drawn, so a failure here never touches navigation.
 */

/** What this person can resume: their own open cataloguing session and their own open or paused place checks, nobody else's. */
export async function resumable(db: D1Database, actor: Actor) {
  const [session, checks] = await db.batch([openSession(db, actor), openChecks(db, actor)]);
  const mine = session!.results[0] as { id: string; place: string | null; startedAt: string; updatedAt: string; saved: number } | undefined;
  return {
    catalogue: mine ? { id: mine.id, place: mine.place, saved: mine.saved, startedAt: mine.startedAt, updatedAt: mine.updatedAt } : null,
    checks: (checks!.results as Array<{ id: string; place: string | null; status: string; expectedAtStart: number; startedAt: string; updatedAt: string }>)
      .map((check) => ({ id: check.id, place: check.place, status: check.status, expected: check.expectedAtStart, startedAt: check.startedAt, updatedAt: check.updatedAt }))
  };
}

const DAY_MS = 86_400_000;
/** The explicit windows the insights look back over. Short for things that move fast (use), long for things that repeat slowly. */
export const WINDOWS = { borrowed: 90, used: 30, short: 90, reports: 90, kits: 90, corrections: 90 } as const;
const ROWS = 5;
/** A pattern needs at least this many events in its window; one event is an incident, not a pattern. */
const AT_LEAST = 2;

export type InsightRow = { name: string; href: string; evidence: string };
export type InsightCard = { id: string; title: string; window: string; rule: string; rows: InsightRow[]; advisory?: true };
export type Completeness = { id: "completeness"; title: string; window: string; rule: string; rows: Array<{ name: string; have: number; of: number; gap: number; href: string; gapText: string }> };

const since = (days: number, now: number) => new Date(now - days * DAY_MS).toISOString();
const windowText = (days: number) => `Last ${days} days`;
const unitsText = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;
const ITEM_LINK = (id: unknown) => `/staff/items?item=${id}`;

type Row = Record<string, string | number | null>;

/**
 * Practical insights, each answering one question staff ask, from records the Hub already keeps. Every figure carries its window and
 * its evidence; none is a score, and nothing here orders, restocks or changes a record.
 */
export async function insights(db: D1Database, now = Date.now()) {
  const day = (days: number) => since(days, now);
  const [borrowed, used, short, reports, kits, corrections, catalog] = await db.batch([
    db.prepare(`SELECT i.id AS id, i.name AS name, COUNT(*) AS n, MAX(l.created_at) AS last FROM loans l INDEXED BY idx_loans_created JOIN items i ON i.id = l.item_id
      WHERE l.created_at >= ?1 GROUP BY l.item_id HAVING COUNT(*) >= ?2 ORDER BY n DESC, last DESC, i.name COLLATE NOCASE LIMIT ${ROWS}`).bind(day(WINDOWS.borrowed), AT_LEAST),
    // The window's own index: left to itself the planner walks the item index and so the whole ledger. On hand is read for the few rows kept.
    db.prepare(`SELECT t.*, (SELECT b.on_hand FROM inventory_balances b WHERE b.id = t.id) AS onHand FROM (
        SELECT i.id AS id, i.name AS name, i.unit AS unit, i.reorder_threshold AS level, -SUM(m.signed_quantity) AS taken, COUNT(*) AS n
        FROM inventory_movements m INDEXED BY idx_inventory_movements_created JOIN items i ON i.id = m.item_id
        WHERE m.created_at >= ?1 AND m.movement_type = 'STOCK_OUT' AND m.status = 'POSTED' AND m.imported_from IS NULL AND i.item_type = 'Consumable' AND i.status <> 'INACTIVE'
        GROUP BY m.item_id HAVING COUNT(*) >= ?2 ORDER BY taken DESC, i.name COLLATE NOCASE LIMIT ${ROWS}) t ORDER BY t.taken DESC, t.name COLLATE NOCASE`).bind(day(WINDOWS.used), AT_LEAST),
    db.prepare(`SELECT i.id AS id, i.name AS name, i.reorder_threshold AS level, g.n AS n, g.last AS last FROM (
        SELECT r.item_id AS itemId, COUNT(*) AS n, MAX(r.created_at) AS last FROM reorders r WHERE r.created_at >= ?1 AND r.status <> 'DISMISSED'
        GROUP BY r.item_id HAVING COUNT(*) >= ?2 ORDER BY n DESC, last DESC LIMIT ${ROWS}) g JOIN items i ON i.id = g.itemId ORDER BY g.n DESC, g.last DESC, i.name COLLATE NOCASE`).bind(day(WINDOWS.short), AT_LEAST),
    db.prepare(`SELECT g.id AS id, lp.path AS place, g.n AS n, g.cant AS cant, g.items AS items FROM (
        SELECT r.location_id AS id, COUNT(*) AS n, SUM(r.kind = 'CANT_FIND') AS cant, COUNT(DISTINCT r.item_id) AS items, MAX(r.created_at) AS last FROM location_reports r
        WHERE r.created_at >= ?1 AND r.location_id IS NOT NULL GROUP BY r.location_id HAVING COUNT(*) >= ?2 ORDER BY n DESC, last DESC LIMIT ${ROWS}) g
      JOIN location_paths lp ON lp.id = g.id ORDER BY g.n DESC, g.last DESC, lp.path COLLATE NOCASE`).bind(day(WINDOWS.reports), AT_LEAST),
    // A kit "needs a refill" in a check when something in it was Low or Missing; Damaged is a repair, not a refill.
    db.prepare(`SELECT k.id AS id, k.name AS name, g.short AS short, g.last AS last, (SELECT COUNT(*) FROM kit_checks x WHERE x.kit_id = k.id AND x.checked_at >= ?1) AS checks FROM (
        SELECT c.kit_id AS kitId, COUNT(DISTINCT c.id) AS short, MAX(c.checked_at) AS last FROM kit_checks c JOIN kit_check_observations o ON o.check_id = c.id AND o.outcome IN ('LOW', 'MISSING')
        WHERE c.checked_at >= ?1 GROUP BY c.kit_id HAVING COUNT(DISTINCT c.id) >= ?2 ORDER BY short DESC, last DESC LIMIT ${ROWS}) g
      JOIN kits k ON k.id = g.kitId WHERE k.active = 1 ORDER BY g.short DESC, g.last DESC, k.name COLLATE NOCASE`).bind(day(WINDOWS.kits), AT_LEAST),
    // How an item is used (Borrow, Take, Use gradually) changed again after it had been sorted: the first sort out of "not sure" is not a correction.
    db.prepare(`SELECT i.id AS id, i.name AS name, i.item_type AS itemType, i.consumption_mode AS consumptionMode, g.n AS n, g.last AS last FROM (
        SELECT a.entity_id AS itemId, COUNT(*) AS n, MAX(a.created_at) AS last FROM audit_log a WHERE a.entity_type = 'ITEM' AND a.action = 'ITEM_UPDATED' AND a.created_at >= ?1
          AND (json_extract(a.details_json, '$.consumptionMode') IS NOT NULL OR COALESCE(json_extract(a.details_json, '$.itemType.from'), 'NEEDS_REVIEW') <> 'NEEDS_REVIEW')
        GROUP BY a.entity_id HAVING COUNT(*) >= ?2 ORDER BY n DESC, last DESC LIMIT ${ROWS}) g JOIN items i ON i.id = g.itemId ORDER BY g.n DESC, g.last DESC, i.name COLLATE NOCASE`).bind(day(WINDOWS.corrections), AT_LEAST),
    db.prepare(`SELECT (SELECT COUNT(*) FROM items i WHERE i.status = 'ACTIVE') AS total, (SELECT COUNT(*) FROM items i WHERE ${GAP_UNCLASSIFIED}) AS unclassified, (SELECT COUNT(*) FROM items i WHERE ${GAP_NO_PLACE}) AS noPlace`)
  ]);
  const rows = (result: D1Result | undefined) => (result?.results ?? []) as Row[];
  const cards: InsightCard[] = [];
  const add = (card: Omit<InsightCard, "rows">, entries: InsightRow[]) => { if (entries.length) cards.push({ ...card, rows: entries }); };

  add({ id: "borrowed", title: "What equipment is borrowed most?", window: windowText(WINDOWS.borrowed), rule: "Items lent at least twice." },
    rows(borrowed).map((row) => ({ name: String(row.name), href: ITEM_LINK(row.id), evidence: `Lent ${times(Number(row.n))}; the latest on ${dayOf(String(row.last))}.` })));
  add({ id: "used", title: "Which consumables go fastest?", window: windowText(WINDOWS.used), rule: "Items taken out at least twice.", advisory: true },
    rows(used).map((row) => ({
      name: String(row.name), href: ITEM_LINK(row.id),
      evidence: `${unitsText(Number(row.taken), String(row.unit))} taken out, ${times(Number(row.n))}. ${Number(row.onHand ?? 0)} left${Number(row.level) > 0 ? `; the reorder level is ${row.level}` : "; no reorder level is set"}.`
    })));
  add({ id: "short", title: "What keeps running short?", window: windowText(WINDOWS.short), rule: "Items with a restock requested at least twice.", advisory: true },
    rows(short).map((row) => ({
      name: String(row.name), href: ITEM_LINK(row.id),
      evidence: `A restock was requested ${times(Number(row.n))}; the latest on ${dayOf(String(row.last))}. ${Number(row.level) > 0 ? `The reorder level is ${row.level}.` : "No reorder level is set."}`
    })));
  add({ id: "reports", title: "Where do people keep failing to find things?", window: windowText(WINDOWS.reports), rule: "Places with at least two reports." },
    rows(reports).map((row) => ({
      name: String(row.place), href: `/staff/locations?place=${row.id}`,
      evidence: `${Number(row.n)} reports about ${Number(row.items) === 1 ? "one item" : `${row.items} items`}: ${row.cant} could not find it, ${Number(row.n) - Number(row.cant)} said the place looks wrong.`
    })));
  add({ id: "kits", title: "Which kits keep needing a refill?", window: windowText(WINDOWS.kits), rule: "Kits found short or missing something in at least two checks." },
    rows(kits).map((row) => ({ name: String(row.name), href: `/staff/kits?kit=${row.id}`, evidence: `Short or missing something in ${row.short} of ${row.checks} checks; the latest on ${dayOf(String(row.last))}.` })));
  add({ id: "corrections", title: "What keeps being reclassified?", window: windowText(WINDOWS.corrections), rule: "Items whose use (Borrow, Take, Use gradually) was changed at least twice." },
    rows(corrections).map((row) => {
      const behaviour = behaviourOf({ itemType: String(row.itemType), consumptionMode: String(row.consumptionMode) });
      return { name: String(row.name), href: `/staff/items?item=${row.id}&tab=history`, evidence: `Its use was changed ${times(Number(row.n))}; the latest on ${dayOf(String(row.last))}. Now: ${behaviour ? BEHAVIOUR_LABELS[behaviour] : "not set"}.` };
    }));

  const counts = rows(catalog)[0] as { total: number; unclassified: number; noPlace: number };
  const sorted = counts.total - counts.unclassified;
  const completeness: Completeness = {
    id: "completeness", title: "How complete is the catalog?", window: "Today", rule: "Active items only.",
    rows: [
      { name: "Sorted into how they are used", have: sorted, of: counts.total, gap: counts.unclassified, href: "/staff/attention?reason=CLASSIFY", gapText: "to classify" },
      { name: "Sorted items with a place", have: sorted - counts.noPlace, of: sorted, gap: counts.noPlace, href: "/staff/attention?reason=NO_PLACE", gapText: "without a place" }
    ]
  };
  return { asOf: new Date(now).toISOString(), cards, completeness };
}
