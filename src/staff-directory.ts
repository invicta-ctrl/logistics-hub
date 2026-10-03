// The private USC Staff Directory (V1.3): people by department, their official USC ID scans, the explicit link to a
// sign-in, and what the existing records say they used and borrowed. Every route here is behind Administration
// (ADMIN or OWNER); changing ID scans is for the OWNER. Nothing here has a public, Self-Service or catalog address.
import { type Account, canManage, throttled } from "./accounts";
import { activityPage, parseActivityQuery } from "./activity";
import { STUDENT_ID_PATTERN } from "./catalog-policy";
import { type DepartmentCode, departmentCode, sourceKey } from "./directory-policy";
import { MEDIA_ID, checkJpeg } from "./item-media";
import { InputError, LOAN_COLUMNS, actorName, audit, isoDate } from "./inventory";
import { cleanText } from "./loans";

export const PERSON_ID = /^PER-[0-9a-f-]{36}$/;
const SIDES = ["front", "back"] as const;
type ScanSide = typeof SIDES[number];
/** A browser-made JPEG of one side of a card: enough to read the smallest print when zoomed, small enough to open fast. */
const SCAN = { edge: 2000, bytes: 1_500_000 } as const;
/** Two scans plus form framing; anything larger is refused before it is read. */
export const MAX_SCAN_BODY = 2 * SCAN.bytes + 64 * 1024;
/** One opening of a card writes one Activity entry, however many times its two images are fetched meanwhile. */
const VIEW_WINDOW_MS = 10 * 60_000;
const scanKey = (mediaId: string, side: ScanSide) => `ids/${mediaId}/${side}`;
const isOwner = (actor: Account) => actor.role === "OWNER";

/* ---------- Reading ---------- */

type PersonRow = {
  id: string; fullName: string; department: string; position: string | null; officer: number; studentId: string | null; active: number;
  sourceKey: string | null; createdAt: string; updatedAt: string; accountId: string | null; username: string | null; accountName: string | null; accountRole: string | null; mediaId: string | null;
};
const PERSON_COLUMNS = `SELECT p.id, p.full_name AS fullName, p.department, p.position, p.officer, p.student_id AS studentId, p.active, p.source_key AS sourceKey,
  p.created_at AS createdAt, p.updated_at AS updatedAt, a.id AS accountId, a.username, a.display_name AS accountName, a.role AS accountRole, c.media_id AS mediaId
  FROM staff_directory p LEFT JOIN staff_accounts a ON a.id = p.account_id LEFT JOIN staff_id_cards c ON c.person_id = p.id`;

const person = (row: PersonRow) => ({
  id: row.id, name: row.fullName, department: row.department, position: row.position, officer: row.officer === 1, studentId: row.studentId, active: row.active === 1,
  sourceKey: row.sourceKey, createdAt: row.createdAt, updatedAt: row.updatedAt, hasId: Boolean(row.mediaId),
  account: row.accountId ? { id: row.accountId, username: row.username!, displayName: row.accountName!, role: row.accountRole! } : null
});

export async function directory(db: D1Database) {
  const { results } = await db.prepare(`${PERSON_COLUMNS} ORDER BY p.full_name COLLATE NOCASE`).all<PersonRow>();
  return { people: results.map(person) };
}

async function personRow(db: D1Database, id: string): Promise<PersonRow> {
  const row = PERSON_ID.test(id) ? await db.prepare(`${PERSON_COLUMNS} WHERE p.id = ?`).bind(id).first<PersonRow>() : null;
  if (!row) throw new InputError(404, "That person is not in the directory.");
  return row;
}

export async function personDetail(db: D1Database, id: string) {
  const row = await personRow(db, id);
  const [card, history] = await db.batch([
    db.prepare(`SELECT c.media_id AS mediaId, c.front_width AS frontWidth, c.front_height AS frontHeight, c.back_width AS backWidth, c.back_height AS backHeight,
      c.source_front AS sourceFront, c.source_back AS sourceBack, c.created_at AS createdAt, a.display_name AS createdBy
      FROM staff_id_cards c LEFT JOIN staff_accounts a ON a.id = c.created_by WHERE c.person_id = ?`).bind(id),
    db.prepare(`SELECT l.created_at AS at, l.action, l.details_json AS details, ${actorName("a", "l.actor_user_id")} AS actor FROM audit_log l
      LEFT JOIN staff_accounts a ON a.id = l.actor_user_id WHERE l.entity_type = 'STAFF' AND l.entity_id = ? ORDER BY l.created_at DESC, l.rowid DESC LIMIT 50`).bind(id)
  ]);
  const scan = card!.results[0] as Record<string, string | number> | undefined;
  return {
    person: person(row),
    card: scan ? {
      mediaId: scan.mediaId, front: { width: scan.frontWidth, height: scan.frontHeight }, back: { width: scan.backWidth, height: scan.backHeight },
      sourceFront: scan.sourceFront, sourceBack: scan.sourceBack, createdAt: scan.createdAt, createdBy: scan.createdBy
    } : null,
    history: (history!.results as Array<{ at: string; action: string; details: string; actor: string | null }>).map((entry) => ({ ...entry, details: parse(entry.details) }))
  };
}

function parse(text: string | null): Record<string, unknown> {
  try { return text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { return {}; }
}

/**
 * Whose records are these: a loan or phone record belongs to a person when both carry a student ID and the IDs are equal,
 * or, when either has none, when its name is exactly the person's full name (letter case aside). A one-word name, such as a
 * surname an import started from, never matches by name. Nothing is matched by surname, photo or face.
 */
const ME = "me AS (SELECT student_id AS sid, lower(full_name) AS name, instr(full_name, ' ') > 0 AS byName FROM staff_directory WHERE id = ?1)";
const owned = (sid: string, name: string) => `CASE WHEN ${sid} IS NOT NULL AND me.sid IS NOT NULL THEN ${sid} = me.sid ELSE me.byName AND lower(${name}) = me.name END`;
const matchedBy = (sid: string) => `CASE WHEN ${sid} IS NOT NULL AND me.sid IS NOT NULL THEN 'STUDENT_ID' ELSE 'NAME' END`;

/**
 * What left stock for this person: every take recorded on a phone and every loan, read from the movement ledger (one row
 * per movement, never a copy), newest first. Dates are office (Manila) days; item, category and area are narrowed in the browser.
 */
export async function personUsage(db: D1Database, id: string, params: URLSearchParams) {
  await personRow(db, id);
  const from = isoDate(params.get("from") || null, "Start date");
  const to = isoDate(params.get("to") || null, "End date");
  if (from && to && from > to) throw new InputError(400, "The start date must not be after the end date.");
  const sid = "COALESCE(l.student_id, e.student_id)";
  const { results } = await db.prepare(`WITH ${ME}
    SELECT m.id, m.created_at AS at, i.id AS itemId, i.name AS itemName, i.category, COALESCE(i.stock_area, 'Inventory') AS stockArea, i.unit, m.quantity,
      CASE WHEN l.id IS NOT NULL THEN 'LOAN' ELSE 'TAKE' END AS kind, COALESCE(l.purpose, e.purpose) AS purpose, CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END AS phone,
      ${matchedBy(sid)} AS matchedBy
    FROM inventory_movements m JOIN items i ON i.id = m.item_id CROSS JOIN me
    LEFT JOIN loans l ON m.movement_type = 'LOAN_OUT' AND m.related_entity_type = 'LOAN' AND l.id = m.related_entity_id
    LEFT JOIN self_service_events e ON m.related_entity_type = 'SELF_SERVICE' AND e.id = m.related_entity_id AND e.event_type = 'TAKE'
    WHERE (l.id IS NOT NULL OR e.id IS NOT NULL) AND ${owned(sid, "COALESCE(l.borrower_name, e.person_name)")}
      AND (?2 IS NULL OR julianday(m.created_at) >= julianday(?2 || 'T00:00:00+08:00')) AND (?3 IS NULL OR julianday(m.created_at) < julianday(?3 || 'T00:00:00+08:00', '+1 day'))
    ORDER BY julianday(m.created_at) DESC LIMIT 1000`).bind(id, from, to).all();
  return { usage: results, truncated: results.length === 1000 };
}

/** Loans this person borrowed, by the same matching as usage: what is out now first, then the history. */
export async function personLoans(db: D1Database, id: string) {
  await personRow(db, id);
  const { results } = await db.prepare(`WITH ${ME} ${LOAN_COLUMNS} CROSS JOIN me WHERE ${owned("l.student_id", "l.borrower_name")}
    ORDER BY l.status = 'OUT' DESC, l.created_at DESC LIMIT 200`).bind(id).all();
  return { loans: results };
}

/** What the person did in Logistics Hub through their linked sign-in (the Activity feed, narrowed to that account). */
export async function personActivity(db: D1Database, id: string, cursor: string | null) {
  const row = await personRow(db, id);
  if (!row.accountId) return { linked: false, events: [], nextCursor: null };
  // The feed's own parser checks the page marker, exactly as for /staff/activity.
  const query = parseActivityQuery(new URLSearchParams({ actor: row.accountId, limit: "30", ...(cursor ? { cursor } : {}) }));
  return { linked: true, ...await activityPage(db, true, query) };
}

/* ---------- Profile ---------- */

type Input = Record<string, unknown>;
const body = (input: unknown): Input => input && typeof input === "object" ? input as Input : {};
const FIELD_COLUMNS = { name: "full_name", department: "department", position: "position", officer: "officer", studentId: "student_id", active: "active" } as const;
type Field = keyof typeof FIELD_COLUMNS;

function department(value: unknown): DepartmentCode {
  const code = typeof value === "string" ? departmentCode(value) : null;
  if (!code) throw new InputError(400, "Choose a department.");
  return code;
}

/** The profile fields present in `input`, checked: a full name, a department, an optional position and student ID, and two flags. */
function profileFields(input: Input): Partial<Record<Field, string | number | null>> {
  const fields: Partial<Record<Field, string | number | null>> = {};
  if ("name" in input) fields.name = cleanText(input.name, "Full name", 120, true);
  if ("department" in input) fields.department = department(input.department);
  if ("position" in input) fields.position = cleanText(input.position, "Position", 80, false);
  if ("officer" in input) fields.officer = input.officer === true ? 1 : 0;
  if ("active" in input) fields.active = input.active === false ? 0 : 1;
  if ("studentId" in input) {
    const studentId = cleanText(input.studentId, "Student ID number", 30, false)?.toUpperCase() ?? null;
    if (studentId && !STUDENT_ID_PATTERN.test(studentId)) throw new InputError(400, "Student ID number may use only letters, digits and dashes.");
    fields.studentId = studentId;
  }
  return fields;
}

/** The database's uniqueness refusals in the words an administrator reads. */
async function unique<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("staff_directory.student_id")) throw new InputError(409, "Another person in the directory already has that student ID number.");
    if (message.includes("staff_directory.account_id")) throw new InputError(409, "That account is already linked to another person. Unlink it there first.");
    if (message.includes("staff_directory.source_key")) throw new InputError(409, "That person was already imported. Refresh the directory.");
    throw error;
  }
}

export async function createPerson(db: D1Database, actor: Account, input: unknown) {
  const fields = profileFields(body(input));
  if (!fields.name || !fields.department) throw new InputError(400, "A full name and a department are required.");
  const id = `PER-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await unique(db.batch([
    db.prepare(`INSERT INTO staff_directory(id, full_name, department, position, officer, student_id, active, created_at, created_by, updated_at, updated_by)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, fields.name, fields.department, fields.position ?? null, fields.officer ?? 0, fields.studentId ?? null, fields.active ?? 1, now, actor.accountId, now, actor.accountId),
    audit(db, actor.accountId, "STAFF_PERSON_ADDED", "STAFF", id, { name: fields.name, department: fields.department })
  ]));
  return { id };
}

/** Saves the fields that changed, only if the profile is still the one the editor loaded (`updatedAt`). */
export async function updatePerson(db: D1Database, actor: Account, id: string, input: unknown) {
  const data = body(input);
  const current = await personRow(db, id);
  // The profile of someone linked to an administrator or owner sign-in is their verified identity: the same rule as linking it.
  if (current.accountId && !mayLink(actor, { id: current.accountId, role: current.accountRole as Account["role"] })) throw new InputError(403, "Only an owner can edit the profile of a person linked to an administrator or owner sign-in.");
  const fields = profileFields(data);
  const before: Record<Field, string | number | null> = { name: current.fullName, department: current.department, position: current.position, officer: current.officer, studentId: current.studentId, active: current.active };
  const changed = (Object.keys(fields) as Field[]).filter((field) => fields[field] !== before[field]);
  if (!changed.length) return { changed: 0, updatedAt: current.updatedAt };
  if (data.updatedAt !== current.updatedAt) throw new InputError(409, "Someone else changed this profile while you were editing. Your changes were not saved; review the latest and try again.");
  const now = new Date().toISOString();
  const [write] = await unique(db.batch([
    db.prepare(`UPDATE staff_directory SET ${changed.map((field) => `${FIELD_COLUMNS[field]} = ?`).join(", ")}, updated_at = ?, updated_by = ? WHERE id = ? AND updated_at = ?`)
      .bind(...changed.map((field) => fields[field]!), now, actor.accountId, id, current.updatedAt),
    // Field names only: a student ID number or a former name is never copied into the log.
    audit(db, actor.accountId, "STAFF_PROFILE_UPDATED", "STAFF", id, { name: fields.name ?? current.fullName, department: fields.department ?? current.department, fields: changed }, true)
  ]));
  if (!write!.meta.changes) throw new InputError(409, "Someone else changed this profile while you were editing. Your changes were not saved; review the latest and try again.");
  return { changed: changed.length, updatedAt: now };
}

/* ---------- Account link ---------- */

type AccountRow = { id: string; username: string; displayName: string; role: Account["role"]; active: number; personId: string | null; personName: string | null };

/** An administrator links STAFF accounts and their own; an owner links any. The same rule as managing the account itself. */
const mayLink = (actor: Account, account: Pick<AccountRow, "id" | "role">) => account.id === actor.accountId || canManage(actor, account);

export async function linkableAccounts(db: D1Database, actor: Account) {
  const { results } = await db.prepare(`SELECT a.id, a.username, a.display_name AS displayName, a.role, a.active, p.id AS personId, p.full_name AS personName
    FROM staff_accounts a LEFT JOIN staff_directory p ON p.account_id = a.id ORDER BY a.display_name COLLATE NOCASE`).all<AccountRow>();
  return { accounts: results.filter((row) => mayLink(actor, row)).map((row) => ({ ...row, active: row.active === 1 })) };
}

export async function linkAccount(db: D1Database, actor: Account, id: string, input: unknown) {
  const accountId = body(input).accountId;
  const current = await personRow(db, id);
  if (typeof accountId !== "string" || !/^ACC-[A-Za-z0-9-]{1,60}$/.test(accountId)) throw new InputError(400, "Choose an account.");
  const account = await db.prepare("SELECT id, username, role FROM staff_accounts WHERE id = ?").bind(accountId).first<Pick<AccountRow, "id" | "username" | "role">>();
  if (!account) throw new InputError(404, "Account not found.");
  if (!mayLink(actor, account)) throw new InputError(403, "Only an owner can link an administrator or owner account.");
  if (current.accountId === accountId) return { linked: account.username };
  if (current.accountId) throw new InputError(409, "This person is already linked to another account. Unlink it first.");
  const [write] = await unique(db.batch([
    db.prepare("UPDATE staff_directory SET account_id = ?, updated_at = ?, updated_by = ? WHERE id = ? AND account_id IS NULL").bind(accountId, new Date().toISOString(), actor.accountId, id),
    audit(db, actor.accountId, "STAFF_ACCOUNT_LINKED", "STAFF", id, { name: current.fullName, department: current.department, username: account.username }, true)
  ]));
  if (!write!.meta.changes) throw new InputError(409, "This person was linked meanwhile. Refresh to see the latest.");
  return { linked: account.username };
}

export async function unlinkAccount(db: D1Database, actor: Account, id: string) {
  const current = await personRow(db, id);
  if (!current.accountId) return { linked: null };
  if (!mayLink(actor, { id: current.accountId, role: current.accountRole as Account["role"] })) throw new InputError(403, "Only an owner can unlink an administrator or owner account.");
  await db.batch([
    db.prepare("UPDATE staff_directory SET account_id = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND account_id = ?").bind(new Date().toISOString(), actor.accountId, id, current.accountId),
    audit(db, actor.accountId, "STAFF_ACCOUNT_UNLINKED", "STAFF", id, { name: current.fullName, department: current.department, username: current.username }, true)
  ]);
  return { linked: null };
}

/** The directory entry linked to a sign-in, if any: the signed-in person's own verified identity. */
export function linkedPerson(db: D1Database, accountId: string) {
  return db.prepare("SELECT full_name AS name, department, position FROM staff_directory WHERE account_id = ? AND active = 1").bind(accountId).first<{ name: string; department: string; position: string | null }>();
}

/* ---------- Official USC ID scans ---------- */

async function readScans(form: FormData) {
  const read = async (side: ScanSide) => {
    const value = form.get(side);
    if (!(value instanceof File) || value.size === 0) throw new InputError(400, `The ${side} scan is missing.`);
    if (value.size > SCAN.bytes) throw new InputError(400, `The ${side} scan is too large.`);
    return checkJpeg(new Uint8Array(await value.arrayBuffer()), `${side} scan`, SCAN.edge);
  };
  return { front: await read("front"), back: await read("back") };
}

/** A source file's name as the archive had it, for reconciling the import later; never shown outside Administration. */
const sourceName = (value: unknown) => typeof value === "string" ? cleanText(value, "Source file", 300, false) : null;

async function dropScans(bucket: R2Bucket, mediaId: string): Promise<void> {
  await Promise.all(SIDES.map((side) => bucket.delete(scanKey(mediaId, side)).catch(() => console.error("staff_id_cleanup_failed", { mediaId, side }))));
}

/** Both sides under a new id; if either fails, neither stays behind. */
async function storeScans(bucket: R2Bucket, scans: Awaited<ReturnType<typeof readScans>>): Promise<string> {
  const mediaId = crypto.randomUUID();
  try {
    for (const side of SIDES) await bucket.put(scanKey(mediaId, side), scans[side].bytes, { httpMetadata: { contentType: "image/jpeg" } });
  } catch (error) {
    await dropScans(bucket, mediaId);
    throw error;
  }
  return mediaId;
}

/** After a failed write: keep the files whenever D1 may already point at them (a dangling reference is worse than an unused file). */
async function rollback(db: D1Database, bucket: R2Bucket, mediaId: string, error: unknown): Promise<never> {
  const referenced = error instanceof InputError ? false : await db.prepare("SELECT 1 FROM staff_id_cards WHERE media_id = ?").bind(mediaId).first().then(Boolean, () => true);
  if (!referenced) await dropScans(bucket, mediaId);
  throw error;
}

const cardValues = (scans: Awaited<ReturnType<typeof readScans>>) => [scans.front.width, scans.front.height, scans.back.width, scans.back.height];

/**
 * One reviewed Front/Back pair from the import preflight. The person is found by the import's source key (normalised
 * identity + department), or added; then the card is attached unless they already have one. Importing the same archive
 * twice therefore changes nothing the second time, and answers which pairs were already there.
 */
export async function importPair(db: D1Database, bucket: R2Bucket, actor: Account, form: FormData) {
  if (!isOwner(actor)) throw new InputError(403, "Importing ID scans is for the owner.");
  const identity = cleanText(form.get("identity"), "Name", 120, true)!;
  const code = department(form.get("department"));
  const key = sourceKey(identity, code);
  const officer = form.get("officer") === "1" ? 1 : 0;
  const existing = await db.prepare("SELECT p.id, c.media_id AS mediaId FROM staff_directory p LEFT JOIN staff_id_cards c ON c.person_id = p.id WHERE p.source_key = ?").bind(key).first<{ id: string; mediaId: string | null }>();
  if (existing?.mediaId) return { id: existing.id, status: "exists" as const };
  const scans = await readScans(form);
  const id = existing?.id ?? `PER-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const mediaId = await storeScans(bucket, scans);
  try {
    const [, card] = await unique(db.batch([
      db.prepare(`INSERT INTO staff_directory(id, full_name, department, officer, active, source_key, created_at, created_by, updated_at, updated_by)
        VALUES(?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?6, ?7) ON CONFLICT(source_key) DO NOTHING`).bind(id, identity, code, officer, key, now, actor.accountId),
      db.prepare(`INSERT INTO staff_id_cards(person_id, media_id, front_width, front_height, back_width, back_height, source_front, source_back, created_at, created_by)
        SELECT p.id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM staff_directory p WHERE p.source_key = ? AND NOT EXISTS (SELECT 1 FROM staff_id_cards c WHERE c.person_id = p.id)`)
        .bind(mediaId, ...cardValues(scans), sourceName(form.get("sourceFront")), sourceName(form.get("sourceBack")), now, actor.accountId, key),
      db.prepare(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
        SELECT ?, ?, ?, 'STAFF_ID_IMPORTED', 'STAFF', p.id, json_object('name', p.full_name, 'department', p.department, 'officer', json(CASE p.officer WHEN 1 THEN 'true' ELSE 'false' END))
        FROM staff_directory p WHERE p.source_key = ? AND changes() > 0`).bind(crypto.randomUUID(), now, actor.accountId, key)
    ]));
    if (!card!.meta.changes) {
      await dropScans(bucket, mediaId);
      const raced = await db.prepare("SELECT id FROM staff_directory WHERE source_key = ?").bind(key).first<string>("id");
      return { id: raced ?? id, status: "exists" as const };
    }
  } catch (error) {
    return rollback(db, bucket, mediaId, error);
  }
  return { id, status: "imported" as const };
}

/** Adds or replaces a person's card (owner): both scans are stored first, then one batch switches the reference if the card is still the one the owner saw. */
export async function putIdCard(db: D1Database, bucket: R2Bucket, actor: Account, id: string, form: FormData) {
  if (!isOwner(actor)) throw new InputError(403, "Changing ID scans is for the owner.");
  const current = await personRow(db, id);
  const expected = form.get("expected") || null;
  if (expected !== null && (typeof expected !== "string" || !MEDIA_ID.test(expected))) throw new InputError(400, "Reload the profile and try again.");
  if (expected !== current.mediaId) throw new InputError(409, "Someone else changed these ID scans. Reload the profile to see the latest.");
  const scans = await readScans(form);
  const mediaId = await storeScans(bucket, scans);
  const now = new Date().toISOString();
  try {
    const [write] = await db.batch([
      expected
        ? db.prepare(`UPDATE staff_id_cards SET media_id = ?, front_width = ?, front_height = ?, back_width = ?, back_height = ?, source_front = ?, source_back = ?, created_at = ?, created_by = ?
            WHERE person_id = ? AND media_id = ?`).bind(mediaId, ...cardValues(scans), sourceName(form.get("sourceFront")), sourceName(form.get("sourceBack")), now, actor.accountId, id, expected)
        : db.prepare(`INSERT INTO staff_id_cards(person_id, media_id, front_width, front_height, back_width, back_height, source_front, source_back, created_at, created_by)
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 WHERE NOT EXISTS (SELECT 1 FROM staff_id_cards WHERE person_id = ?1)`)
          .bind(id, mediaId, ...cardValues(scans), sourceName(form.get("sourceFront")), sourceName(form.get("sourceBack")), now, actor.accountId),
      audit(db, actor.accountId, expected ? "STAFF_ID_REPLACED" : "STAFF_ID_ADDED", "STAFF", id, { name: current.fullName, department: current.department }, true)
    ]);
    if (!write!.meta.changes) throw new InputError(409, "Someone else changed these ID scans. Reload the profile to see the latest.");
  } catch (error) {
    return rollback(db, bucket, mediaId, error);
  }
  if (expected) await dropScans(bucket, expected);
  return { mediaId };
}

/** Removes a person's card (owner): the reference first, then the files. */
export async function removeIdCard(db: D1Database, bucket: R2Bucket, actor: Account, id: string, expected: string | null) {
  if (!isOwner(actor)) throw new InputError(403, "Removing ID scans is for the owner.");
  const current = await personRow(db, id);
  if (!expected || !MEDIA_ID.test(expected)) throw new InputError(400, "Reload the profile and try again.");
  const [removal] = await db.batch([
    db.prepare("DELETE FROM staff_id_cards WHERE person_id = ? AND media_id = ?").bind(id, expected),
    audit(db, actor.accountId, "STAFF_ID_REMOVED", "STAFF", id, { name: current.fullName, department: current.department }, true)
  ]);
  if (!removal!.meta.changes) throw new InputError(409, "Someone else changed these ID scans. Reload the profile to see the latest.");
  await dropScans(bucket, expected);
  return { mediaId: null };
}

/**
 * One side of a person's card, to an administrator or owner, never cached anywhere (no-store) and never embeddable by
 * another site. Each opening is written to Activity once per viewer and card within ten minutes, and a viewer may open
 * only so many in a short time, so the directory cannot be quietly scraped.
 */
export async function idScan(db: D1Database, bucket: R2Bucket, actor: Account, id: string, side: string): Promise<Response> {
  if (!PERSON_ID.test(id) || !(SIDES as readonly string[]).includes(side)) throw new InputError(404, "Not found.");
  const mediaId = await db.prepare("SELECT media_id AS mediaId FROM staff_id_cards WHERE person_id = ?").bind(id).first<string>("mediaId");
  if (!mediaId) throw new InputError(404, "Not found.");
  if (await throttled(db, `staff-id-view:${actor.accountId}`, 120, 10 * 60_000)) throw new InputError(429, "Too many ID scans opened in a short time. Please wait a few minutes.");
  const now = Date.now();
  await db.prepare(`INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
    SELECT ?1, ?2, ?3, 'STAFF_ID_VIEWED', 'STAFF', p.id, json_object('name', p.full_name, 'department', p.department) FROM staff_directory p
    WHERE p.id = ?4 AND NOT EXISTS (SELECT 1 FROM audit_log v WHERE v.entity_type = 'STAFF' AND v.entity_id = ?4 AND v.actor_user_id = ?3 AND v.action = 'STAFF_ID_VIEWED' AND v.created_at > ?5)`)
    .bind(crypto.randomUUID(), new Date(now).toISOString(), actor.accountId, id, new Date(now - VIEW_WINDOW_MS).toISOString()).run();
  const object = await bucket.get(scanKey(mediaId, side as ScanSide));
  if (!object) throw new InputError(404, "Not found.");
  return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "cross-origin-resource-policy": "same-origin" } });
}
