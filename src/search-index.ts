import { type IndexItem, type IndexKit, type IndexLink, type IndexPlace, type SearchIndex } from "./search";

/*
 * The staff search index (V1.11, `GET /api/staff/search`): the catalog's searchable words in one read, sent once per catalog revision
 * (the client asks again with If-None-Match and gets 304 until something changes). Items, places, kits and their links only: no
 * quantities, notes, loans, people, evidence or Staff Directory data, which global search never ranks in the browser. Ranking runs in
 * the browser over this (search.ts), so typing reads nothing from D1.
 */

export async function searchIndex(db: D1Database): Promise<SearchIndex> {
  const [items, places, kits, components, links] = await db.batch([
    db.prepare(`SELECT i.id, i.name, i.aliases, i.category, i.item_type AS itemType, i.status, i.location_id AS placeId, i.icon_key AS iconKey,
        i.visual_type AS visualType, p.media_id AS photoId
      FROM items i LEFT JOIN item_media p ON p.item_id = i.id ORDER BY i.name COLLATE NOCASE, i.id`),
    db.prepare("SELECT id, name, parent_id AS parentId, active FROM locations ORDER BY name COLLATE NOCASE, id"),
    db.prepare("SELECT id, name, location_id AS placeId, active FROM kits ORDER BY name COLLATE NOCASE, id"),
    db.prepare("SELECT kit_id AS kitId, item_id AS itemId FROM kit_components ORDER BY kit_id, position"),
    db.prepare(`SELECT item_id AS "from", related_id AS "to", kind FROM item_relationships ORDER BY item_id, related_id`)
  ]) as [D1Result<IndexItem>, D1Result<Omit<IndexPlace, "active"> & { active: number }>, D1Result<Omit<IndexKit, "active" | "items"> & { active: number }>, D1Result<{ kitId: string; itemId: string }>, D1Result<IndexLink>];
  const contents = new Map<string, string[]>();
  for (const { kitId, itemId } of components.results) contents.set(kitId, [...contents.get(kitId) ?? [], itemId]);
  return {
    items: items.results,
    places: places.results.map((place) => ({ ...place, active: place.active === 1 })),
    kits: kits.results.map((kit) => ({ ...kit, active: kit.active === 1, items: contents.get(kit.id) ?? [] })),
    links: links.results
  };
}
