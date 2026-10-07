import { type Actor, BUMP_REVISION, InputError, actorName, audit } from "./inventory";
import { MAX_LINKS, RELATION_KINDS, RELATION_WORDS, type RelationKind, type RelationSide } from "./relation-policy";

/*
 * Explicit item links (V1.11, migration 0030): Alternative, Replacement, Used with, and Holds / Goes in (a container and its
 * contents, amendment §7). Staff set them on an item's record; search follows them one hop, and each item's record lists its own.
 * A link changes nothing about either item: no stock, place, behaviour or loan. Setting or removing one is audited on the item it was
 * set from and bumps the catalog revision, so every open search index refreshes.
 */

const ITEM_ID = /^ITM-[A-Za-z0-9-]{1,24}$/;
const object = (input: unknown): Record<string, unknown> => input && typeof input === "object" ? input as Record<string, unknown> : {};

type LinkRow = { holder: string; kind: RelationKind; createdAt: string; createdBy: string | null; id: string; name: string; status: string; place: string | null };

/** An item's links, from both ends, each read from this item's side ("Replaced by", "Goes in"). */
export async function linksOf(db: D1Database, itemId: string) {
  const { results } = await db.prepare(`SELECT r.item_id AS holder, r.kind, r.created_at AS createdAt, ${actorName("a", "r.created_by")} AS createdBy,
      i.id, i.name, i.status, lp.path AS place
    FROM item_relationships r JOIN items i ON i.id = CASE r.item_id WHEN ?1 THEN r.related_id ELSE r.item_id END
    LEFT JOIN location_paths lp ON lp.id = i.location_id LEFT JOIN staff_accounts a ON a.id = r.created_by
    WHERE r.item_id = ?1 OR r.related_id = ?1 ORDER BY i.name COLLATE NOCASE, i.id`).bind(itemId).all<LinkRow>();
  return results.map(({ holder, ...row }) => {
    const side: RelationSide = holder === itemId ? "from" : "to";
    return { ...row, side, words: RELATION_WORDS[row.kind][side] };
  });
}

async function names(db: D1Database, itemId: string, otherId: string) {
  const { results } = await db.prepare("SELECT id, name FROM items WHERE id IN (?, ?)").bind(itemId, otherId).all<{ id: string; name: string }>();
  const name = results.find((row) => row.id === itemId)?.name;
  const other = results.find((row) => row.id === otherId)?.name;
  if (!name) throw new InputError(404, "Item not found.");
  if (!other) throw new InputError(404, "The other item was not found.");
  return { name, other };
}

/** Links this item to another, read from this item's side: `{ itemId, kind, side }` ("from" unless it says "to"). */
export async function linkItems(db: D1Database, actor: Actor, itemId: string, input: unknown) {
  const body = object(input);
  const otherId = body.itemId;
  const kind = body.kind;
  const side = body.side ?? "from";
  if (typeof otherId !== "string" || !ITEM_ID.test(otherId)) throw new InputError(400, "Choose the item to link.");
  if (typeof kind !== "string" || !(RELATION_KINDS as readonly string[]).includes(kind)) throw new InputError(400, "Choose how the two items relate.");
  if (side !== "from" && side !== "to") throw new InputError(400, "Choose how the two items relate.");
  if (otherId === itemId) throw new InputError(400, "An item cannot be linked to itself.");
  const { other } = await names(db, itemId, otherId);
  const [from, to] = side === "from" ? [itemId, otherId] : [otherId, itemId];
  const words = RELATION_WORDS[kind as RelationKind][side];
  const now = new Date().toISOString();
  let inserted: D1Result;
  try {
    // Written only while both items are under the cap, so two people linking at once cannot pass it.
    [inserted] = await db.batch([
      db.prepare(`INSERT INTO item_relationships(item_id, related_id, kind, created_at, created_by) SELECT ?1, ?2, ?3, ?4, ?5
        WHERE (SELECT COUNT(*) FROM item_relationships WHERE item_id = ?1) + (SELECT COUNT(*) FROM item_relationships WHERE related_id = ?1) < ?6
          AND (SELECT COUNT(*) FROM item_relationships WHERE item_id = ?2) + (SELECT COUNT(*) FROM item_relationships WHERE related_id = ?2) < ?6`)
        .bind(from, to, kind, now, actor.accountId, MAX_LINKS),
      audit(db, actor.accountId, "ITEM_LINKED", "ITEM", itemId, { otherId, otherName: other, kind, side, words }, true),
      db.prepare(BUMP_REVISION)
    ]) as [D1Result];
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed|PRIMARY KEY/i.test(error.message)) throw new InputError(409, "These two items are already linked. Remove that link first to change how they relate.");
    throw error;
  }
  if (!inserted.meta.changes) throw new InputError(409, `An item can have up to ${MAX_LINKS} links. Remove one first.`);
  return { links: await linksOf(db, itemId) };
}

/** Removes the link between two items, whichever end it was set from. */
export async function unlinkItems(db: D1Database, actor: Actor, itemId: string, otherId: string) {
  if (!ITEM_ID.test(otherId)) throw new InputError(404, "Those items are not linked.");
  const link = await db.prepare(`SELECT r.item_id AS "from", r.related_id AS "to", r.kind, i.name AS otherName FROM item_relationships r JOIN items i ON i.id = ?2
    WHERE (r.item_id = ?1 AND r.related_id = ?2) OR (r.item_id = ?2 AND r.related_id = ?1)`).bind(itemId, otherId).first<{ from: string; to: string; kind: RelationKind; otherName: string }>();
  if (!link) throw new InputError(404, "Those items are not linked.");
  const side: RelationSide = link.from === itemId ? "from" : "to";
  await db.batch([
    db.prepare("DELETE FROM item_relationships WHERE item_id = ? AND related_id = ?").bind(link.from, link.to),
    audit(db, actor.accountId, "ITEM_UNLINKED", "ITEM", itemId, { otherId, otherName: link.otherName, kind: link.kind, side, words: RELATION_WORDS[link.kind][side] }, true),
    db.prepare(BUMP_REVISION)
  ]);
  return { links: await linksOf(db, itemId) };
}
