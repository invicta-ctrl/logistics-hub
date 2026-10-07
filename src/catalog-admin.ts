// Administration > Catalog (V1.13): how far the catalog is classified, and the other names of items. Reads are bounded; the one write
// (an item's other names) is inventory.ts's setAliases.
import { like } from "./activity";
import { GAP_UNCLASSIFIED } from "./attention";

/** Items shown at once. A search narrows them; nothing here pages through the whole catalog. */
export const ALIAS_PAGE = 50;

export async function catalogCoverage(db: D1Database) {
  const [items, captures] = await db.batch([
    // "Unclassified" is Attention's own definition (GAP_UNCLASSIFIED), so this page and "Items to classify" always agree.
    db.prepare(`SELECT (SELECT COUNT(*) FROM items i WHERE i.status = 'ACTIVE') AS active, (SELECT COUNT(*) FROM items i WHERE ${GAP_UNCLASSIFIED}) AS unclassified`),
    db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(behaviour <> 'REVIEW_LATER'), 0) AS classified FROM catalogue_captures")
  ]);
  const item = items!.results[0] as { active: number; unclassified: number };
  const capture = captures!.results[0] as { total: number; classified: number };
  return { active: item.active, unclassified: item.unclassified, captured: capture.total, capturedClassified: capture.classified };
}

export type AliasRow = { id: string; name: string; category: string; aliases: string | null; updatedAt: string | null };

/** Active items with other names (or matching a search of their name, other names or ID), by name, at most ALIAS_PAGE of them. */
export async function aliasItems(db: D1Database, query: string) {
  const q = query.trim().slice(0, 80);
  const filter = q ? "(i.name LIKE ?1 ESCAPE '\\' OR i.aliases LIKE ?1 ESCAPE '\\' OR i.id LIKE ?1 ESCAPE '\\')" : "i.aliases IS NOT NULL";
  const statement = db.prepare(`SELECT i.id, i.name, i.category, i.aliases, i.updated_at AS updatedAt FROM items i WHERE i.status = 'ACTIVE' AND ${filter}
    ORDER BY i.name COLLATE NOCASE, i.id LIMIT ${ALIAS_PAGE + 1}`);
  const { results } = await (q ? statement.bind(like(q)) : statement).all<AliasRow>();
  return { items: results.slice(0, ALIAS_PAGE), more: results.length > ALIAS_PAGE };
}
