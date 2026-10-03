import { type Actor, BUMP_REVISION, InputError, audit, pathsOf, text, usablePlace } from "./inventory";
import { LOCATION_ID, MAX_DEPTH, type Place, VISIBILITIES, ancestry, cleanName, levelsBelow, placesOf, withinPlace } from "./location-tree";

/*
 * Locations (V1.4): the places items are kept, as a shallow hierarchy (Office → Storage Area → Cabinet 1 → Shelf 2).
 * An item points at one place by id; its original typed storage text stays in items.storage_location as evidence and is
 * never read again. Places are few and always loaded whole, so every rule that needs the hierarchy walks it in memory,
 * and the database (migration 0024) is the backstop for loops, inactive parents and items in inactive places.
 */

/** A bound on the whole set, so "load every place" stays a small, fixed read. */
const MAX_LOCATIONS = 500;
const STALE = "Someone else changed this place while you were editing. Your changes were not saved; review the latest details and try again.";

export type Photo = { id: string; width: number; height: number };
type Row = { id: string; name: string; parentId: string | null; directions: string | null; visibility: string; active: number; updatedAt: string; photoId: string | null; photoWidth: number | null; photoHeight: number | null };

/** Every place with how many items are directly in it and how many open reports concern those items. */
export async function locationList(db: D1Database) {
  const { results } = await db.prepare(`SELECT l.id, l.name, l.parent_id AS parentId, l.directions, l.visibility, l.active, l.updated_at AS updatedAt,
      l.media_id AS photoId, l.media_width AS photoWidth, l.media_height AS photoHeight,
      (SELECT COUNT(*) FROM items i WHERE i.location_id = l.id) AS itemCount,
      (SELECT COUNT(*) FROM location_reports r JOIN items i ON i.id = r.item_id WHERE r.resolved_at IS NULL AND i.location_id = l.id) AS openReports
    FROM locations l ORDER BY l.name COLLATE NOCASE, l.id`).all<Row & { itemCount: number; openReports: number }>();
  return results.map(({ photoId, photoWidth, photoHeight, active, ...row }) => ({
    ...row, active: active === 1, photo: photoId ? { id: photoId, width: photoWidth!, height: photoHeight! } : null
  }));
}

/** What Self-Service may show of a place: its name, directions and picture. */
export type SharedPlace = { id: string; name: string; parentId: string | null; directions: string | null; photo: Photo | null };

/**
 * The places staff share with Self-Service: the place and every place above it is active and shared (the `shown` column of
 * location_paths). Anything else never leaves D1, so a staff-only parent hides everything beneath it.
 */
export async function sharedPlaces(db: D1Database): Promise<Map<string, SharedPlace>> {
  const { results } = await db.prepare(`SELECT l.id, l.name, l.parent_id AS parentId, l.directions, l.media_id AS photoId, l.media_width AS photoWidth, l.media_height AS photoHeight
    FROM locations l JOIN location_paths p ON p.id = l.id WHERE p.shown = 1`).all<Pick<Row, "id" | "name" | "parentId" | "directions" | "photoId" | "photoWidth" | "photoHeight">>();
  return new Map(results.map(({ photoId, photoWidth, photoHeight, ...place }) => [place.id, { ...place, photo: photoId ? { id: photoId, width: photoWidth!, height: photoHeight! } : null }]));
}

const loadPlaces = async (db: D1Database) => placesOf((await db.prepare("SELECT id, name, parent_id AS parentId, active FROM locations").all<Omit<Place, "active"> & { active: number }>())
  .results.map((row) => ({ ...row, active: row.active === 1 })));

const object = (input: unknown): Record<string, unknown> => input && typeof input === "object" ? input as Record<string, unknown> : {};

/** The fields a place is made of, checked against the hierarchy as it is now. `self` is the place being edited. */
async function readPlace(db: D1Database, input: unknown, self: string | null, current?: { name: string; parentId: string | null }) {
  const record = object(input);
  const name = cleanName(record.name);
  if (!name) throw new InputError(400, "Give the place a name of 1 to 120 characters, without the › sign.");
  const directions = text(record, "directions", "Directions", 600, false, true);
  const visibility = record.visibility ?? "STAFF_ONLY";
  if (typeof visibility !== "string" || !(VISIBILITIES as readonly string[]).includes(visibility)) throw new InputError(400, "Choose who sees these directions.");
  const parentId = record.parentId ?? null;
  if (parentId !== null && (typeof parentId !== "string" || !LOCATION_ID.test(parentId))) throw new InputError(400, "Choose a valid place to put this inside.");
  if (record.active !== undefined && typeof record.active !== "boolean") throw new InputError(400, "Invalid status.");
  const places = await loadPlaces(db);
  const parent = parentId ? places.get(parentId) : null;
  if (parentId && !parent) throw new InputError(400, "That place no longer exists. Choose another to put this inside.");
  if (parent && self && withinPlace(places, self).has(parent.id)) throw new InputError(400, "A place cannot be put inside itself or inside something it holds.");
  const above = parent ? ancestry(places, parent.id).length : 0;
  if (above + (self ? levelsBelow(places, self) : 1) > MAX_DEPTH) throw new InputError(400, `Places go at most ${MAX_DEPTH} levels deep (for example Office, Storage Area, Cabinet, Shelf, Box).`);
  // Reconciliation keeps look-alike names apart (Cabinet 1, cabinet 1); only a new or changed name must be distinct.
  const twin = current?.name === name && current.parentId === parentId ? undefined
    : [...places.values()].find((place) => place.id !== self && place.parentId === parentId && place.name.toLowerCase() === name.toLowerCase());
  if (twin) throw new InputError(409, `${parent ? `${parent.name} already has` : "There is already"} a place called ${twin.name}${twin.active ? "" : " (inactive)"}. Use it, or choose a different name.`);
  if (!self && places.size >= MAX_LOCATIONS) throw new InputError(400, `There are already ${MAX_LOCATIONS} places. Combine or remove the ones no longer used first.`);
  return { name, parentId, directions, visibility, active: record.active !== false, parentActive: parent ? parent.active : true, places };
}

/** The database's refusals (migration 0024), in the words staff read. */
export async function placeGuard<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("location_cycle")) throw new InputError(409, "A place cannot be put inside itself or inside something it holds.");
    if (message.includes("location_parent_inactive")) throw new InputError(409, "That place is inactive. Reactivate it first, or choose another to put this inside.");
    if (message.includes("location_has_active_children")) throw new InputError(409, "Places inside it are still in use. Move or deactivate them first.");
    if (message.includes("location_inactive")) throw new InputError(409, "That place is inactive, so items cannot be kept there. Choose another place.");
    if (/UNIQUE constraint failed: locations/i.test(message)) throw new InputError(409, "A place with that name already exists here.");
    throw error;
  }
}

export async function createLocation(db: D1Database, actor: Actor, input: unknown) {
  const place = await readPlace(db, input, null);
  if (!place.parentActive) throw new InputError(409, "That place is inactive. Reactivate it first, or choose another to put this inside.");
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = await db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) + 1 AS next FROM locations").first<number>("next");
    const id = `LOC-${String(next).padStart(4, "0")}`;
    try {
      await placeGuard(db.batch([
        db.prepare("INSERT INTO locations(id, name, parent_id, directions, visibility, active, created_at, created_by, updated_at, updated_by) VALUES(?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
          .bind(id, place.name, place.parentId, place.directions, place.visibility, now, actor.accountId, now, actor.accountId),
        audit(db, actor.accountId, "LOCATION_CREATED", "LOCATION", id, { name: place.name, parentId: place.parentId, visibility: place.visibility }),
        db.prepare(BUMP_REVISION)
      ]));
      return { id, updatedAt: now };
    } catch (error) {
      // Two people adding at once can race for the next ID; the primary key rejects the loser, which retries.
      if (!(error instanceof Error && /PRIMARY KEY|locations\.id/i.test(error.message)) || attempt === 2) throw error;
    }
  }
  throw new InputError(409, "Could not allocate a place ID. Please try again.");
}

const FIELDS = [["name", "name"], ["parentId", "parent_id"], ["directions", "directions"], ["visibility", "visibility"], ["active", "active"]] as const;

/** Applies a place edit. `updatedAt` is the version the editor loaded, so a stale form never overwrites someone else's change. */
export async function updateLocation(db: D1Database, actor: Actor, id: string, input: unknown) {
  const record = object(input);
  const current = await db.prepare("SELECT name, parent_id AS parentId, directions, visibility, active, updated_at AS updatedAt FROM locations WHERE id = ?")
    .bind(id).first<{ name: string; parentId: string | null; directions: string | null; visibility: string; active: number; updatedAt: string }>();
  if (!current) throw new InputError(404, "Place not found.");
  if (record.updatedAt !== current.updatedAt) throw new InputError(409, STALE);
  const next = await readPlace(db, record, id, current);
  if (next.active && !next.parentActive) throw new InputError(409, "That place is inactive. Reactivate it first, or choose another to put this inside.");
  if (!next.active && current.active === 1) {
    if ([...next.places.values()].some((place) => place.parentId === id && place.active)) throw new InputError(409, "Places inside it are still in use. Move or deactivate them first.");
  }
  const before: Record<string, unknown> = { ...current, active: current.active === 1 };
  const after: Record<string, unknown> = { name: next.name, parentId: next.parentId, directions: next.directions, visibility: next.visibility, active: next.active };
  const changed = FIELDS.filter(([key]) => before[key] !== after[key]);
  if (!changed.length) return { changed: 0, updatedAt: current.updatedAt };
  const now = new Date().toISOString();
  const [update] = await placeGuard(db.batch([
    db.prepare(`UPDATE locations SET ${changed.map(([, column]) => `${column} = ?`).join(", ")}, updated_at = ?, updated_by = ? WHERE id = ? AND updated_at = ?`)
      .bind(...changed.map(([key]) => typeof after[key] === "boolean" ? Number(after[key]) : after[key]), now, actor.accountId, id, current.updatedAt),
    audit(db, actor.accountId, "LOCATION_UPDATED", "LOCATION", id, Object.fromEntries(changed.map(([key]) => [key, { from: before[key], to: after[key] }])), true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]));
  if (!update!.meta.changes) throw new InputError(409, STALE);
  return { changed: changed.length, updatedAt: now };
}

/**
 * Moves every item kept in one place to another, in one batch: each item's history records the change in words, and the
 * place keeps an entry of its own. This is how two spellings of one place are combined on purpose, never by migration.
 */
export async function moveItems(db: D1Database, actor: Actor, fromId: string, input: unknown) {
  const toId = object(input).toLocationId;
  if (typeof toId !== "string" || !LOCATION_ID.test(toId)) throw new InputError(400, "Choose where to move the items.");
  if (toId === fromId) throw new InputError(400, "Choose a different place to move the items to.");
  const paths = await pathsOf(db, [fromId, toId]);
  if (!paths.has(fromId)) throw new InputError(404, "Place not found.");
  await usablePlace(db, toId);
  const now = new Date().toISOString();
  const [, moved] = await placeGuard(db.batch([
    db.prepare(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
      SELECT lower(hex(randomblob(16))), ?1, ?2, 'ITEM_UPDATED', 'ITEM', i.id, json_object('storageLocation', json_object('from', ?3, 'to', ?4)) FROM items i WHERE i.location_id = ?5`)
      .bind(now, actor.accountId, paths.get(fromId)!, paths.get(toId)!, fromId),
    db.prepare("UPDATE items SET location_id = ?, updated_at = ? WHERE location_id = ?").bind(toId, now, fromId),
    audit(db, actor.accountId, "LOCATION_ITEMS_MOVED", "LOCATION", fromId, { to: toId, fromPath: paths.get(fromId), toPath: paths.get(toId) }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]));
  return { moved: moved!.meta.changes };
}
