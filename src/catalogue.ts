import { BEHAVIOURS, type Behaviour, UNSORTED_CATEGORY, UNSORTED_UNIT, behaviourFields } from "./catalog-policy";
import { type Known, type Match, possibleDuplicates } from "./duplicates";
import { type Actor, InputError, audit, createItem, parseItemInput, pathsOf, text, usablePlace } from "./inventory";
import { LOCATION_ID } from "./location-tree";

/*
 * Rapid Catalogue (V1.5): a cataloguing session is one staff member walking a shelf. It lives in D1, so it resumes on any device
 * that person signs in on. Each capture creates the item, its opening count, its audit entry and its capture row in one batch
 * and is keyed by the request id the browser made, so a save whose answer was lost is retried safely and never makes two items.
 */

const SESSION_ID = /^CS-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ITEM_ID = /^ITM-[A-Za-z0-9-]{1,24}$/;
/** The captures a session shows at once, and the review-later items listed beside it: bounded however long the day was. */
const RECENT = 40;
const REVIEW_LIST = 100;
const FINISHED = "That cataloguing session is finished. Start a new one to keep adding items.";

type SessionRow = { id: string; locationId: string | null; place: string | null; status: string; startedAt: string; updatedAt: string; finishedAt: string | null; startedBy: string; owner: string; saved: number; reviewLater: number };
const SESSION_COLUMNS = `s.id, s.location_id AS locationId, lp.path AS place, s.status, s.started_at AS startedAt, s.updated_at AS updatedAt, s.finished_at AS finishedAt,
  s.started_by AS startedBy, a.display_name AS owner,
  (SELECT COUNT(*) FROM catalogue_captures c WHERE c.session_id = s.id) AS saved,
  (SELECT COUNT(*) FROM catalogue_captures c WHERE c.session_id = s.id AND c.behaviour = 'REVIEW_LATER') AS reviewLater
  FROM catalogue_sessions s JOIN staff_accounts a ON a.id = s.started_by LEFT JOIN location_paths lp ON lp.id = s.location_id`;

function placeId(value: unknown): string {
  if (typeof value !== "string" || !LOCATION_ID.test(value)) throw new InputError(400, "Choose the place you are cataloguing.");
  return value;
}

async function ownSession(db: D1Database, actor: Actor, id: string): Promise<SessionRow> {
  if (!SESSION_ID.test(id)) throw new InputError(404, "Cataloguing session not found.");
  const row = await db.prepare(`SELECT ${SESSION_COLUMNS} WHERE s.id = ?`).bind(id).first<SessionRow>();
  if (!row) throw new InputError(404, "Cataloguing session not found.");
  if (row.startedBy !== actor.accountId) throw new InputError(403, `This session belongs to ${row.owner}. Start your own to catalogue.`);
  return row;
}

/** A session as the browser sees it; `mine` says whether the reader may add to it. */
const shown = ({ startedBy, ...row }: SessionRow, me: string) => ({ ...row, mine: startedBy === me });

/** What the Catalogue page opens with: your open session (if any), who else is cataloguing, and the items waiting for a decision. */
export async function catalogueState(db: D1Database, actor: Actor) {
  const [mine, others, review, total] = await db.batch([
    db.prepare(`SELECT ${SESSION_COLUMNS} WHERE s.status = 'ACTIVE' AND s.started_by = ?`).bind(actor.accountId),
    db.prepare(`SELECT ${SESSION_COLUMNS} WHERE s.status = 'ACTIVE' AND s.started_by <> ? ORDER BY s.started_at LIMIT 10`).bind(actor.accountId),
    db.prepare(`SELECT i.id, i.name, c.created_at AS capturedAt, lp.path AS place, p.media_id AS photoId, b.on_hand AS onHand, i.unit FROM catalogue_captures c JOIN items i ON i.id = c.item_id
      LEFT JOIN location_paths lp ON lp.id = i.location_id LEFT JOIN item_media p ON p.item_id = i.id LEFT JOIN inventory_balances b ON b.id = i.id
      WHERE i.item_type = 'NEEDS_REVIEW' ORDER BY c.created_at DESC, c.rowid DESC LIMIT ${REVIEW_LIST}`),
    db.prepare("SELECT COUNT(*) AS total FROM catalogue_captures c JOIN items i ON i.id = c.item_id WHERE i.item_type = 'NEEDS_REVIEW'")
  ]);
  return {
    session: mine!.results[0] ? shown(mine!.results[0] as SessionRow, actor.accountId) : null,
    others: (others!.results as SessionRow[]).map((row) => shown(row, actor.accountId)),
    reviewLater: { total: (total!.results[0] as { total: number }).total, items: review!.results }
  };
}

/** One session with its newest captures; `counts` say how the whole session went, whatever has scrolled away. */
export async function sessionDetail(db: D1Database, actor: Actor, id: string) {
  if (!SESSION_ID.test(id)) throw new InputError(404, "Cataloguing session not found.");
  const [session, counts, recent] = await db.batch([
    db.prepare(`SELECT ${SESSION_COLUMNS} WHERE s.id = ?`).bind(id),
    db.prepare("SELECT behaviour, COUNT(*) AS n FROM catalogue_captures WHERE session_id = ? GROUP BY behaviour").bind(id),
    db.prepare(`SELECT c.id AS captureId, c.behaviour, c.created_at AS capturedAt, i.id AS itemId, i.name, i.category, i.item_type AS itemType, i.consumption_mode AS consumptionMode, i.unit,
        i.stock_area AS stockArea, i.needs_review AS needsReview, b.on_hand AS onHand, lp.path AS place, p.media_id AS photoId
      FROM catalogue_captures c JOIN items i ON i.id = c.item_id LEFT JOIN inventory_balances b ON b.id = i.id LEFT JOIN location_paths lp ON lp.id = c.location_id LEFT JOIN item_media p ON p.item_id = i.id
      WHERE c.session_id = ? ORDER BY c.created_at DESC, c.rowid DESC LIMIT ${RECENT}`).bind(id)
  ]);
  const found = session!.results[0] as SessionRow | undefined;
  if (!found) throw new InputError(404, "Cataloguing session not found.");
  return {
    session: shown(found, actor.accountId),
    counts: Object.fromEntries((counts!.results as Array<{ behaviour: string; n: number }>).map((row) => [row.behaviour, row.n])),
    recent: recent!.results
  };
}

/** The classified, still-unreviewed items of a session, with the versions a bulk "mark reviewed" needs. */
export async function unreviewed(db: D1Database, id: string) {
  if (!SESSION_ID.test(id)) throw new InputError(404, "Cataloguing session not found.");
  const { results } = await db.prepare(`SELECT i.id, i.updated_at AS updatedAt FROM catalogue_captures c JOIN items i ON i.id = c.item_id
    WHERE c.session_id = ? AND i.needs_review = 1 AND i.item_type <> 'NEEDS_REVIEW' AND i.category <> '${UNSORTED_CATEGORY}' ORDER BY c.created_at, c.rowid LIMIT 1000`).bind(id).all();
  return { items: results };
}

export async function startSession(db: D1Database, actor: Actor, input: unknown) {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const existing = await db.prepare("SELECT id FROM catalogue_sessions WHERE status = 'ACTIVE' AND started_by = ?").bind(actor.accountId).first<string>("id");
  if (existing) return { id: existing, resumed: true };
  const locationId = placeId(body.locationId);
  await usablePlace(db, locationId);
  const id = `CS-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const place = (await pathsOf(db, [locationId])).get(locationId) ?? null;
  try {
    await db.batch([
      db.prepare("INSERT INTO catalogue_sessions(id, started_by, location_id, status, started_at, updated_at) VALUES(?, ?, ?, 'ACTIVE', ?, ?)").bind(id, actor.accountId, locationId, now, now),
      audit(db, actor.accountId, "CATALOGUE_STARTED", "CATALOGUE", id, { place })
    ]);
  } catch (error) {
    // Two devices starting at once: the database allows one open session each, so the second finds the first.
    const raced = await db.prepare("SELECT id FROM catalogue_sessions WHERE status = 'ACTIVE' AND started_by = ?").bind(actor.accountId).first<string>("id");
    if (raced) return { id: raced, resumed: true };
    throw error;
  }
  return { id, resumed: false };
}

/** Where the next item is assumed to be. Every capture also names its own place, so this only decides where a resumed session opens. */
export async function setSessionPlace(db: D1Database, actor: Actor, id: string, input: unknown) {
  const session = await ownSession(db, actor, id);
  if (session.status !== "ACTIVE") throw new InputError(409, FINISHED);
  const locationId = placeId((input as Record<string, unknown> | null)?.locationId);
  await usablePlace(db, locationId);
  await db.prepare("UPDATE catalogue_sessions SET location_id = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'").bind(locationId, new Date().toISOString(), id).run();
  return { locationId };
}

export async function finishSession(db: D1Database, actor: Actor, id: string) {
  const session = await ownSession(db, actor, id);
  if (session.status === "FINISHED") return { saved: session.saved, reviewLater: session.reviewLater };
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE catalogue_sessions SET status = 'FINISHED', finished_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'ACTIVE'").bind(now, id),
    audit(db, actor.accountId, "CATALOGUE_FINISHED", "CATALOGUE", id, { saved: session.saved, reviewLater: session.reviewLater, place: session.place }, true)
  ]);
  return { saved: session.saved, reviewLater: session.reviewLater };
}

/** The matches staff already saw and chose to save past: item ids only. */
function acknowledged(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10 || value.some((id) => typeof id !== "string" || !ITEM_ID.test(id))) throw new InputError(400, "Those possible matches are not valid. Reload and try again.");
  return value as string[];
}

export type Captured = { id: string; captureId: string; replayed: boolean };
export type CaptureOutcome = Captured | { duplicates: Match[] };

/**
 * Saves one item from the shelf. The place, the behaviour and the quantity are always the person's own choice; a record whose
 * behaviour is "Review later" is stored unclassified (type Unclassified, needs review) and so stays out of every public list until
 * someone decides. Possible duplicates are returned, not refused, unless the person has already seen them and said to save anyway.
 */
export async function capture(db: D1Database, actor: Actor, sessionId: string, input: unknown): Promise<CaptureOutcome> {
  const session = await ownSession(db, actor, sessionId);
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const requestId = body.id;
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) throw new InputError(400, "Missing request id. Reload and try again.");
  const replay = async (): Promise<Captured | null> => {
    const found = await db.prepare("SELECT item_id AS id, session_id AS sessionId FROM catalogue_captures WHERE id = ?").bind(requestId).first<{ id: string; sessionId: string }>();
    if (!found) return null;
    if (found.sessionId !== sessionId) throw new InputError(409, "That request was already used. Reload and try again.");
    return { id: found.id, captureId: requestId, replayed: true };
  };
  const earlier = await replay();
  if (earlier) return earlier;
  if (session.status !== "ACTIVE") throw new InputError(409, FINISHED);

  const behaviour = body.behaviour;
  if (typeof behaviour !== "string" || !(BEHAVIOURS as readonly string[]).includes(behaviour)) throw new InputError(400, "Choose Borrow & return, Consume, Use gradually, or Not sure.");
  const decided = behaviour as Behaviour;
  const locationId = placeId(body.locationId);
  const later = decided === "REVIEW_LATER";
  const quantity = body.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0 || quantity > 100_000) throw new InputError(400, "Quantity must be a whole number from 0 to 100000.");
  const input2 = parseItemInput({
    name: body.name, aliases: body.aliases, notes: body.notes, model: body.model ?? "", serialNumber: body.serialNumber ?? "", stockArea: body.stockArea ?? "Inventory",
    // An unknown category or unit is only allowed for a record that waits for review, and says so.
    category: later && !text(body, "category", "Category", 100, false) ? UNSORTED_CATEGORY : body.category,
    unit: later && !text(body, "unit", "Unit", 30, false) ? UNSORTED_UNIT : body.unit,
    ...behaviourFields(decided), status: "ACTIVE", locationId, reorderThreshold: 0, lendingAudience: "NOT_AVAILABLE_FOR_LENDING",
    // Captured at the shelf, but nobody has signed it off for Self-Service: "Mark reviewed" (or the Items form) does that.
    needsReview: true
  });
  const hash = typeof body.photoHash === "string" && /^[0-9a-f]{16}$/.test(body.photoHash) ? body.photoHash : null;
  const seen = acknowledged(body.acknowledged);
  const { results } = await db.prepare(`SELECT i.id, i.name, i.aliases, i.category, i.model, i.serial_number AS serialNumber, p.dhash AS photoHash, i.status
    FROM items i LEFT JOIN item_media p ON p.item_id = i.id`).all<Known>();
  const matches = possibleDuplicates({ name: input2.name, category: input2.category, model: input2.model, serialNumber: input2.serialNumber, photoHash: hash }, results);
  if (matches.some((match) => !seen.includes(match.id))) return { duplicates: matches };

  const now = new Date().toISOString();
  try {
    const { id } = await createItem(db, actor, input2, quantity, {
      audit: { catalogueSession: sessionId, behaviour: decided, ...(seen.length ? { savedDespite: seen } : {}) },
      also: (itemId) => [
        db.prepare("INSERT INTO catalogue_captures(id, session_id, item_id, location_id, behaviour, acknowledged, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
          .bind(requestId, sessionId, itemId, locationId, decided, seen.length ? JSON.stringify(seen) : null, now),
        db.prepare("UPDATE catalogue_sessions SET location_id = ?, updated_at = ? WHERE id = ?").bind(locationId, now, sessionId)
      ]
    });
    return { id, captureId: requestId, replayed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("catalogue_session_finished")) throw new InputError(409, FINISHED);
    // The same request arriving twice at once: the loser finds the winner's item.
    if (/catalogue_captures\.id|PRIMARY KEY constraint failed: catalogue_captures/i.test(message)) {
      const won = await replay();
      if (won) return won;
    }
    throw error;
  }
}
