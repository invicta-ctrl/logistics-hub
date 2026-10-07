import { type Actor, BUMP_REVISION, InputError, audit, pathsOf, text, usablePlace } from "./inventory";
import { CHECK_OUTCOMES, COMPONENT_STATE_LABELS, type CheckOutcome, type ComponentState, readComponent, readKit } from "./kit-policy";
import { LOCATION_ID } from "./location-tree";

/*
 * Kits (V1.8): a kit is a list of existing items and how many of each it should hold, plus where it is kept. It owns no stock. Every
 * state shown for a kit is derived at read time from the components' own records (ledger balance, loans, open units, expiry, reorder
 * level), so it cannot drift from them. A check of a kit records what staff saw and writes no movement: stock changes only through
 * the movement rules, from the component's own record.
 */

const MAX_KITS = 200;
const MAX_TEMPLATES = 100;
const MAX_COMPONENTS = 60;
const KIT_ID = /^KIT-\d{4,}$/;
const TEMPLATE_ID = /^KTP-\d{4,}$/;
const ITEM_ID = /^ITM-[A-Za-z0-9-]{1,24}$/;
const CHECK_ID = /^KC-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STALE = "Someone else changed this while you were editing. Your changes were not saved; review the latest and try again.";
const object = (input: unknown): Record<string, unknown> => input && typeof input === "object" ? input as Record<string, unknown> : {};

type ComponentInput = { itemId: string; required: number };

/** The list of components a request carries: whole numbers, each item once, and every item a real record. */
async function readComponents(db: D1Database, input: unknown): Promise<ComponentInput[]> {
  if (!Array.isArray(input)) throw new InputError(400, "Send the components as a list.");
  if (input.length > MAX_COMPONENTS) throw new InputError(400, `A kit holds at most ${MAX_COMPONENTS} different items.`);
  const seen = new Set<string>();
  const list = input.map((entry) => {
    const { itemId, required } = object(entry);
    if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) throw new InputError(400, "Choose an item for each component.");
    if (seen.has(itemId)) throw new InputError(400, "An item can be in a kit only once. Raise its quantity instead.");
    seen.add(itemId);
    if (typeof required !== "number" || !Number.isInteger(required) || required < 1 || required > 1000) throw new InputError(400, "Each component needs a quantity from 1 to 1000.");
    return { itemId, required };
  });
  if (list.length) {
    const { results } = await db.prepare(`SELECT id FROM items WHERE id IN (${list.map(() => "?").join(",")})`).bind(...list.map((entry) => entry.itemId)).all<{ id: string }>();
    if (results.length !== list.length) throw new InputError(400, "One of those items no longer exists. Reload and choose again.");
  }
  return list;
}

/** Sequential ids staff can read aloud (KIT-0001), allocated against the highest in use; the primary key settles a race. */
async function allocate<T>(db: D1Database, table: "kits" | "kit_templates", prefix: string, write: (id: string) => Promise<T>): Promise<{ id: string; result: T }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = await db.prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(id, ${prefix.length + 2}) AS INTEGER)), 0) + 1 AS next FROM ${table}`).first<number>("next");
    const id = `${prefix}-${String(next).padStart(4, "0")}`;
    try {
      return { id, result: await write(id) };
    } catch (error) {
      if (!(error instanceof Error && /PRIMARY KEY|\.id\b/i.test(error.message)) || attempt === 2) throw error;
    }
  }
  throw new InputError(409, "Could not allocate an ID. Please try again.");
}

/** The database's refusals, in the words staff read. */
async function guarded<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/idx_kits_name|idx_kit_templates_name|UNIQUE constraint failed: index/i.test(message)) throw new InputError(409, "Another kit or template already has that name. Choose a different one.");
    if (message.includes("location_inactive")) throw new InputError(409, "That place is inactive, so a kit cannot be kept there. Choose another place.");
    throw error;
  }
}

function fields(input: unknown) {
  const body = object(input);
  const name = text(body, "name", "Name", 80, true)!;
  const description = text(body, "description", "Description", 600, false, true);
  if (body.active !== undefined && typeof body.active !== "boolean") throw new InputError(400, "Invalid status.");
  return { name, description, active: body.active !== false, body };
}

function placeOf(body: Record<string, unknown>): string | null {
  const id = body.locationId ?? null;
  if (id !== null && (typeof id !== "string" || !LOCATION_ID.test(id))) throw new InputError(400, "Choose a valid place.");
  return id;
}

/* ---------- Reading ---------- */

type Fact = {
  kitId: string; itemId: string; required: number; name: string; unit: string; category: string; itemType: string; consumptionMode: string; iconKey: string | null; visualType: string | null; photoId: string | null;
  itemStatus: string; reorderThreshold: number; expiresOn: string | null; onHand: number; onLoan: number; demand: number; openCondition: string | null; seen: CheckOutcome | null; seenNote: string | null; seenAt: string | null;
};

/** Every component of the kits asked for (all of them without `only`) with the facts its state is read from. */
async function components(db: D1Database, only?: string): Promise<Map<string, Fact[]>> {
  const { results } = await db.prepare(`SELECT kc.kit_id AS kitId, kc.item_id AS itemId, kc.required, i.name, i.unit, i.category, i.item_type AS itemType, i.consumption_mode AS consumptionMode, i.icon_key AS iconKey, i.visual_type AS visualType,
      p.media_id AS photoId, i.status AS itemStatus, i.reorder_threshold AS reorderThreshold, i.expires_on AS expiresOn, COALESCE(b.on_hand, 0) AS onHand,
      (SELECT COALESCE(SUM(l.quantity), 0) FROM loans l WHERE l.item_id = i.id AND l.status = 'OUT') AS onLoan,
      (SELECT COALESCE(SUM(k2.required), 0) FROM kit_components k2 JOIN kits k ON k.id = k2.kit_id WHERE k2.item_id = i.id AND k.active = 1) AS demand,
      (SELECT o.condition FROM open_units o WHERE o.item_id = i.id AND o.closed_at IS NULL ORDER BY CASE o.condition WHEN 'LOW' THEN 0 WHEN 'HALF' THEN 1 WHEN 'PLENTY' THEN 2 ELSE 3 END LIMIT 1) AS openCondition,
      seen.outcome AS seen, seen.note AS seenNote, seen.checked_at AS seenAt
    FROM kit_components kc JOIN items i ON i.id = kc.item_id LEFT JOIN inventory_balances b ON b.id = i.id LEFT JOIN item_media p ON p.item_id = i.id
    LEFT JOIN (SELECT c.kit_id, o.item_id, o.outcome, o.note, c.checked_at, ROW_NUMBER() OVER (PARTITION BY c.kit_id, o.item_id ORDER BY c.checked_at DESC, c.rowid DESC) AS n
      FROM kit_check_observations o JOIN kit_checks c ON c.id = o.check_id) seen ON seen.kit_id = kc.kit_id AND seen.item_id = kc.item_id AND seen.n = 1
    ${only ? "WHERE kc.kit_id = ?1" : ""} ORDER BY kc.kit_id, kc.position`).bind(...(only ? [only] : [])).all<Fact>();
  const byKit = new Map<string, Fact[]>();
  for (const fact of results) byKit.set(fact.kitId, [...byKit.get(fact.kitId) ?? [], fact]);
  return byKit;
}

const today = () => new Date().toISOString().slice(0, 10);

function derive(facts: Fact[]) {
  const when = today();
  const read = facts.map((fact) => {
    const { state, reason } = readComponent({ ...fact, openCondition: fact.openCondition, seen: fact.seen }, when);
    return { fact, state, reason };
  });
  return { rows: read, ...readKit(read.map((entry) => entry.state)) };
}

type KitRow = { id: string; name: string; description: string | null; locationId: string | null; templateId: string | null; templateName: string | null; active: number; updatedAt: string;
  mediaId: string | null; mediaWidth: number | null; mediaHeight: number | null; lastCheckedAt: string | null; lastCheckedBy: string | null };
const KIT_COLUMNS = `k.id, k.name, k.description, k.location_id AS locationId, k.template_id AS templateId, t.name AS templateName, k.active, k.updated_at AS updatedAt,
  k.media_id AS mediaId, k.media_width AS mediaWidth, k.media_height AS mediaHeight,
  (SELECT c.checked_at FROM kit_checks c WHERE c.kit_id = k.id ORDER BY c.checked_at DESC, c.rowid DESC LIMIT 1) AS lastCheckedAt,
  (SELECT s.display_name FROM kit_checks c JOIN staff_accounts s ON s.id = c.checked_by WHERE c.kit_id = k.id ORDER BY c.checked_at DESC, c.rowid DESC LIMIT 1) AS lastCheckedBy
  FROM kits k LEFT JOIN kit_templates t ON t.id = k.template_id`;

function shape(row: KitRow, facts: Fact[], places: Map<string, string>) {
  const { mediaId, mediaWidth, mediaHeight, active, ...rest } = row;
  const { state, ready, total } = derive(facts);
  return { ...rest, active: active === 1, place: row.locationId ? places.get(row.locationId) ?? null : null, photo: mediaId ? { id: mediaId, width: mediaWidth!, height: mediaHeight! } : null, state, ready, total };
}

/** Every kit with its derived state, and the templates new kits can start from. */
export async function kitList(db: D1Database) {
  const [kits, templates, byKit] = await Promise.all([
    db.prepare(`SELECT ${KIT_COLUMNS} ORDER BY k.name COLLATE NOCASE, k.id LIMIT ${MAX_KITS}`).all<KitRow>(),
    db.prepare(`SELECT t.id, t.name, t.description, t.active, t.updated_at AS updatedAt, (SELECT COUNT(*) FROM kit_template_components c WHERE c.template_id = t.id) AS components,
      (SELECT COUNT(*) FROM kits k WHERE k.template_id = t.id) AS kits FROM kit_templates t ORDER BY t.name COLLATE NOCASE LIMIT ${MAX_TEMPLATES}`).all<{ id: string; name: string; description: string | null; active: number; updatedAt: string; components: number; kits: number }>(),
    components(db)
  ]);
  const places = await pathsOf(db, kits.results.map((row) => row.locationId));
  return {
    kits: kits.results.map((row) => shape(row, byKit.get(row.id) ?? [], places)),
    templates: templates.results.map(({ active, ...row }) => ({ ...row, active: active === 1 }))
  };
}

/** Active kits that are not Ready, each with what holds it back: what the Attention inbox reads. Derived like the list, never stored. */
export async function kitsNotReady(db: D1Database) {
  const [kits, byKit] = await Promise.all([
    db.prepare(`SELECT k.id, k.name FROM kits k WHERE k.active = 1 ORDER BY k.name COLLATE NOCASE, k.id LIMIT ${MAX_KITS}`).all<{ id: string; name: string }>(),
    components(db)
  ]);
  return kits.results.flatMap((kit) => {
    const { state, rows } = derive(byKit.get(kit.id) ?? []);
    return state === "READY" ? [] : [{ id: kit.id, name: kit.name, state, holding: rows.filter((entry) => entry.state !== "OK").map((entry) => `${entry.fact.name}: ${entry.reason ?? COMPONENT_STATE_LABELS[entry.state]}`) }];
  });
}

/** One kit: its components with their states and the plain reason for each, and its recent checks (the latest in full). */
export async function kitDetail(db: D1Database, id: string) {
  if (!KIT_ID.test(id)) throw new InputError(404, "Kit not found.");
  const row = await db.prepare(`SELECT ${KIT_COLUMNS} WHERE k.id = ?`).bind(id).first<KitRow>();
  if (!row) throw new InputError(404, "Kit not found.");
  const [byKit, checks, places] = await Promise.all([
    components(db, id),
    db.prepare(`SELECT c.id, c.checked_at AS checkedAt, s.display_name AS checkedBy, c.note, c.ok_count AS okCount, c.flagged_count AS flaggedCount, c.unchecked_count AS uncheckedCount
      FROM kit_checks c JOIN staff_accounts s ON s.id = c.checked_by WHERE c.kit_id = ? ORDER BY c.checked_at DESC, c.rowid DESC LIMIT 10`).bind(id)
      .all<{ id: string; checkedAt: string; checkedBy: string; note: string | null; okCount: number; flaggedCount: number; uncheckedCount: number }>(),
    pathsOf(db, [row.locationId])
  ]);
  const facts = byKit.get(id) ?? [];
  const { rows } = derive(facts);
  const latest = checks.results[0];
  const seen = latest ? (await db.prepare(`SELECT o.item_id AS itemId, i.name, o.outcome, o.note FROM kit_check_observations o JOIN items i ON i.id = o.item_id WHERE o.check_id = ? ORDER BY i.name COLLATE NOCASE`).bind(latest.id)
    .all<{ itemId: string; name: string; outcome: CheckOutcome; note: string | null }>()).results : [];
  return {
    kit: shape(row, facts, places),
    components: rows.map(({ fact, state, reason }) => ({
      itemId: fact.itemId, name: fact.name, unit: fact.unit, category: fact.category, itemType: fact.itemType, consumptionMode: fact.consumptionMode, iconKey: fact.iconKey, visualType: fact.visualType, photoId: fact.photoId,
      required: fact.required, demand: fact.demand, onHand: fact.onHand, onLoan: fact.onLoan, expiresOn: fact.expiresOn, state, reason,
      seen: fact.seen ? { outcome: fact.seen, note: fact.seenNote, at: fact.seenAt } : null
    })),
    checks: checks.results,
    lastCheck: latest ? { ...latest, observations: seen } : null
  };
}

/** The kits an item is a component of, for its own record and for the Catalog. */
export async function kitsOfItem(db: D1Database, itemId: string) {
  const { results } = await db.prepare(`SELECT k.id, k.name, k.active, kc.required FROM kit_components kc JOIN kits k ON k.id = kc.kit_id WHERE kc.item_id = ? ORDER BY k.name COLLATE NOCASE`)
    .bind(itemId).all<{ id: string; name: string; active: number; required: number }>();
  return results.map(({ active, ...row }) => ({ ...row, active: active === 1 }));
}

/* ---------- Writing ---------- */

const componentStatements = (db: D1Database, table: "kit_components" | "kit_template_components", owner: string, list: ComponentInput[], guardTable: "kits" | "kit_templates", stamp: string) => {
  const column = table === "kit_components" ? "kit_id" : "template_id";
  // Written only while the owner row still carries this write's own stamp: a lost race writes nothing.
  const still = `EXISTS (SELECT 1 FROM ${guardTable} WHERE id = ?1 AND updated_at = ?2)`;
  return [
    db.prepare(`DELETE FROM ${table} WHERE ${column} = ?1 AND ${still}`).bind(owner, stamp),
    ...list.map((entry, position) => db.prepare(`INSERT INTO ${table}(${column}, item_id, required, position) SELECT ?1, ?3, ?4, ?5 WHERE ${still}`).bind(owner, stamp, entry.itemId, entry.required, position))
  ];
};

/** Makes a kit, empty or from a template (whose components are copied once; the kit does not follow later template edits). */
export async function createKit(db: D1Database, actor: Actor, input: unknown) {
  const { name, description, active, body } = fields(input);
  const locationId = placeOf(body);
  await usablePlace(db, locationId);
  if ((await db.prepare("SELECT COUNT(*) AS n FROM kits").first<number>("n") ?? 0) >= MAX_KITS) throw new InputError(400, `There are already ${MAX_KITS} kits. Deactivate the ones no longer used first.`);
  const templateId = body.templateId ?? null;
  let list: ComponentInput[];
  if (templateId !== null) {
    if (typeof templateId !== "string" || !TEMPLATE_ID.test(templateId)) throw new InputError(400, "Choose a valid template.");
    const template = await db.prepare("SELECT active FROM kit_templates WHERE id = ?").bind(templateId).first<number>("active");
    if (template === null) throw new InputError(404, "Template not found.");
    if (template !== 1) throw new InputError(409, "That template is turned off. Turn it on first, or start without it.");
    list = (await db.prepare("SELECT item_id AS itemId, required FROM kit_template_components WHERE template_id = ? ORDER BY position").bind(templateId).all<ComponentInput>()).results;
  } else {
    list = body.components === undefined ? [] : await readComponents(db, body.components);
  }
  const now = new Date().toISOString();
  const { id } = await allocate(db, "kits", "KIT", (id) => guarded(db.batch([
    db.prepare("INSERT INTO kits(id, name, description, location_id, template_id, active, created_at, created_by, updated_at, updated_by) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, name, description, locationId, templateId, active ? 1 : 0, now, actor.accountId, now, actor.accountId),
    ...list.map((entry, position) => db.prepare("INSERT INTO kit_components(kit_id, item_id, required, position) VALUES(?, ?, ?, ?)").bind(id, entry.itemId, entry.required, position)),
    audit(db, actor.accountId, "KIT_CREATED", "KIT", id, { name, locationId, templateId, components: list.length }),
    db.prepare(BUMP_REVISION)
  ])));
  return { id, updatedAt: now };
}

/** Applies a kit edit: its details, its place, whether it is in use, and (when sent) its whole list of components. */
export async function updateKit(db: D1Database, actor: Actor, id: string, input: unknown) {
  if (!KIT_ID.test(id)) throw new InputError(404, "Kit not found.");
  const body = object(input);
  const current = await db.prepare("SELECT name, description, location_id AS locationId, active, updated_at AS updatedAt FROM kits WHERE id = ?")
    .bind(id).first<{ name: string; description: string | null; locationId: string | null; active: number; updatedAt: string }>();
  if (!current) throw new InputError(404, "Kit not found.");
  if (body.updatedAt !== current.updatedAt) throw new InputError(409, STALE);
  const { name, description, active } = fields(body);
  const locationId = placeOf(body);
  if (locationId !== current.locationId) await usablePlace(db, locationId);
  const list = body.components === undefined ? null : await readComponents(db, body.components);
  const changed = { name: current.name !== name, description: current.description !== description, locationId: current.locationId !== locationId, active: (current.active === 1) !== active };
  if (!Object.values(changed).some(Boolean) && !list) return { changed: 0, updatedAt: current.updatedAt };
  const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
  const details = { ...(changed.name ? { name: { from: current.name, to: name } } : {}), ...(changed.description ? { description: true } : {}), ...(changed.locationId ? { locationId: { from: current.locationId, to: locationId } } : {}),
    ...(changed.active ? { active: { from: current.active === 1, to: active } } : {}), ...(list ? { components: list.length } : {}) };
  const [update] = await guarded(db.batch([
    db.prepare("UPDATE kits SET name = ?, description = ?, location_id = ?, active = ?, updated_at = ?, updated_by = ? WHERE id = ? AND updated_at = ?")
      .bind(name, description, locationId, active ? 1 : 0, now, actor.accountId, id, current.updatedAt),
    ...(list ? componentStatements(db, "kit_components", id, list, "kits", now) : []),
    audit(db, actor.accountId, "KIT_UPDATED", "KIT", id, details, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]));
  if (!update!.meta.changes) throw new InputError(409, STALE);
  return { changed: Object.values(changed).filter(Boolean).length + (list ? 1 : 0), updatedAt: now };
}

/**
 * Records one check of a kit, in one batch: which components were seen and how. Components left unmarked stay "not checked". The
 * ledger is not touched: what the check found is fixed from the item's own record, by the movement rules. A resent check (same id)
 * is found, not repeated.
 */
export async function checkKit(db: D1Database, actor: Actor, id: string, input: unknown) {
  if (!KIT_ID.test(id)) throw new InputError(404, "Kit not found.");
  const body = object(input);
  if (typeof body.id !== "string" || !CHECK_ID.test(body.id)) throw new InputError(400, "That check id is not valid. Reload and try again.");
  const checkId = body.id;
  const kit = await db.prepare("SELECT name, active FROM kits WHERE id = ?").bind(id).first<{ name: string; active: number }>();
  if (!kit) throw new InputError(404, "Kit not found.");
  const done = await db.prepare("SELECT kit_id AS kitId, checked_by AS by, ok_count AS ok, flagged_count AS flagged, unchecked_count AS unchecked FROM kit_checks WHERE id = ?").bind(checkId).first<{ kitId: string; by: string; ok: number; flagged: number; unchecked: number }>();
  if (done) {
    if (done.kitId !== id || done.by !== actor.accountId) throw new InputError(409, "That check id is already used. Reload and try again.");
    return { id: checkId, okCount: done.ok, flaggedCount: done.flagged, uncheckedCount: done.unchecked, replayed: true };
  }
  if (kit.active !== 1) throw new InputError(409, "This kit is turned off. Turn it on to check it.");
  const note = text(body, "note", "Note", 300, false);
  if (!Array.isArray(body.observations) || !body.observations.length) throw new InputError(400, "Mark at least one component before finishing.");
  const members = new Set((await db.prepare("SELECT item_id AS itemId FROM kit_components WHERE kit_id = ?").bind(id).all<{ itemId: string }>()).results.map((row) => row.itemId));
  const seen = new Set<string>();
  const observations = body.observations.map((entry) => {
    const each = object(entry);
    const itemId = each.itemId;
    if (typeof itemId !== "string" || !members.has(itemId)) throw new InputError(409, "The kit's list changed while you were checking. Reload and check again.");
    if (seen.has(itemId)) throw new InputError(400, "Each component can be marked once.");
    seen.add(itemId);
    if (typeof each.outcome !== "string" || !(CHECK_OUTCOMES as readonly string[]).includes(each.outcome)) throw new InputError(400, "Choose how each component looked.");
    return { itemId, outcome: each.outcome as CheckOutcome, note: text(each, "note", "Note", 300, false) };
  });
  const flagged = observations.filter((entry) => entry.outcome !== "OK").length;
  const ok = observations.length - flagged;
  const unchecked = members.size - observations.length;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO kit_checks(id, kit_id, checked_by, checked_at, note, ok_count, flagged_count, unchecked_count) VALUES(?, ?, ?, ?, ?, ?, ?, ?)").bind(checkId, id, actor.accountId, now, note, ok, flagged, unchecked),
    ...observations.map((entry) => db.prepare(`INSERT INTO kit_check_observations(check_id, item_id, outcome, required, on_hand, note)
      SELECT ?1, ?2, ?3, kc.required, COALESCE(b.on_hand, 0), ?4 FROM kit_components kc LEFT JOIN inventory_balances b ON b.id = kc.item_id WHERE kc.kit_id = ?5 AND kc.item_id = ?2`)
      .bind(checkId, entry.itemId, entry.outcome, entry.note, id)),
    audit(db, actor.accountId, "KIT_CHECKED", "KIT", id, { name: kit.name, checkId, ok, flagged, unchecked }),
    db.prepare(BUMP_REVISION)
  ]);
  return { id: checkId, okCount: ok, flaggedCount: flagged, uncheckedCount: unchecked, replayed: false };
}

/* ---------- Templates ---------- */

/** A template's components, for editing it or making a kit by hand from it. */
export async function templateDetail(db: D1Database, id: string) {
  if (!TEMPLATE_ID.test(id)) throw new InputError(404, "Template not found.");
  const row = await db.prepare("SELECT id, name, description, active, updated_at AS updatedAt FROM kit_templates WHERE id = ?").bind(id).first<{ id: string; name: string; description: string | null; active: number; updatedAt: string }>();
  if (!row) throw new InputError(404, "Template not found.");
  const { results } = await db.prepare(`SELECT c.item_id AS itemId, i.name, i.unit, c.required FROM kit_template_components c JOIN items i ON i.id = c.item_id WHERE c.template_id = ? ORDER BY c.position`)
    .bind(id).all<{ itemId: string; name: string; unit: string; required: number }>();
  return { template: { ...row, active: row.active === 1 }, components: results };
}

/** Makes a template, from a list or from an existing kit's components (the kit is not changed). */
export async function createTemplate(db: D1Database, actor: Actor, input: unknown) {
  const { name, description, active, body } = fields(input);
  if ((await db.prepare("SELECT COUNT(*) AS n FROM kit_templates").first<number>("n") ?? 0) >= MAX_TEMPLATES) throw new InputError(400, `There are already ${MAX_TEMPLATES} templates. Turn off the ones no longer used first.`);
  let list: ComponentInput[];
  if (body.fromKitId !== undefined) {
    if (typeof body.fromKitId !== "string" || !KIT_ID.test(body.fromKitId)) throw new InputError(400, "Choose a valid kit.");
    list = (await db.prepare("SELECT item_id AS itemId, required FROM kit_components WHERE kit_id = ? ORDER BY position").bind(body.fromKitId).all<ComponentInput>()).results;
    if (!list.length) throw new InputError(400, "That kit has no components to copy yet.");
  } else {
    list = await readComponents(db, body.components ?? []);
  }
  const now = new Date().toISOString();
  const { id } = await allocate(db, "kit_templates", "KTP", (id) => guarded(db.batch([
    db.prepare("INSERT INTO kit_templates(id, name, description, active, created_at, created_by, updated_at, updated_by) VALUES(?, ?, ?, ?, ?, ?, ?, ?)").bind(id, name, description, active ? 1 : 0, now, actor.accountId, now, actor.accountId),
    ...list.map((entry, position) => db.prepare("INSERT INTO kit_template_components(template_id, item_id, required, position) VALUES(?, ?, ?, ?)").bind(id, entry.itemId, entry.required, position)),
    audit(db, actor.accountId, "KIT_TEMPLATE_CREATED", "KIT", id, { name, components: list.length, fromKitId: body.fromKitId ?? null }),
    db.prepare(BUMP_REVISION)
  ])));
  return { id, updatedAt: now };
}

export async function updateTemplate(db: D1Database, actor: Actor, id: string, input: unknown) {
  if (!TEMPLATE_ID.test(id)) throw new InputError(404, "Template not found.");
  const body = object(input);
  const current = await db.prepare("SELECT name, description, active, updated_at AS updatedAt FROM kit_templates WHERE id = ?").bind(id).first<{ name: string; description: string | null; active: number; updatedAt: string }>();
  if (!current) throw new InputError(404, "Template not found.");
  if (body.updatedAt !== current.updatedAt) throw new InputError(409, STALE);
  const { name, description, active } = fields(body);
  const list = body.components === undefined ? null : await readComponents(db, body.components);
  if (current.name === name && current.description === description && (current.active === 1) === active && !list) return { changed: 0, updatedAt: current.updatedAt };
  const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
  const [update] = await guarded(db.batch([
    db.prepare("UPDATE kit_templates SET name = ?, description = ?, active = ?, updated_at = ?, updated_by = ? WHERE id = ? AND updated_at = ?").bind(name, description, active ? 1 : 0, now, actor.accountId, id, current.updatedAt),
    ...(list ? componentStatements(db, "kit_template_components", id, list, "kit_templates", now) : []),
    audit(db, actor.accountId, "KIT_TEMPLATE_UPDATED", "KIT", id, { name, active, ...(list ? { components: list.length } : {}) }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]));
  if (!update!.meta.changes) throw new InputError(409, STALE);
  return { changed: 1, updatedAt: now };
}

/**
 * Items catalogued most recently (Rapid Catalogue), so a kit's editor can offer what was just put on the shelf without a search.
 * It is a shortlist of existing items; cataloguing itself knows nothing about kits.
 */
export async function recentlyCatalogued(db: D1Database) {
  const { results } = await db.prepare(`SELECT i.id, i.name, i.unit, i.category, i.item_type AS itemType, i.consumption_mode AS consumptionMode, i.icon_key AS iconKey, i.visual_type AS visualType,
      p.media_id AS photoId, COALESCE(b.on_hand, 0) AS onHand, i.status
    FROM catalogue_captures c JOIN items i ON i.id = c.item_id LEFT JOIN inventory_balances b ON b.id = i.id LEFT JOIN item_media p ON p.item_id = i.id
    WHERE i.status <> 'INACTIVE' ORDER BY c.created_at DESC, c.rowid DESC LIMIT 8`).all();
  return { items: results };
}
