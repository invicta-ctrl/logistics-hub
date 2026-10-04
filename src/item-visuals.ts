import { itemIconKey } from "./item-icons";
import { type Actor, BUMP_REVISION, InputError, audit } from "./inventory";

/** A visual edit has the same item version guard as Details; a stored photo is retained when choosing an icon. */
export async function updateItemVisual(db: D1Database, actor: Actor, id: string, body: unknown) {
  if (!body || typeof body !== "object") throw new InputError(400, "Invalid item visual.");
  const input = body as Record<string, unknown>;
  if (input.visualType !== "SYSTEM_ICON" && input.visualType !== "PHOTO") throw new InputError(400, "Choose System Icon or Real Photo.");
  const key = typeof input.iconKey === "string" ? itemIconKey(input.iconKey) : null;
  if (input.iconKey !== null && !key) throw new InputError(400, "Choose an available system icon, or use the suggestion.");
  if (input.updatedAt !== null && typeof input.updatedAt !== "string") throw new InputError(400, "Reload the item and try again.");
  const current = await db.prepare("SELECT visual_type AS visualType, icon_key AS iconKey, updated_at AS updatedAt FROM items WHERE id = ?").bind(id)
    .first<{ visualType: string | null; iconKey: string | null; updatedAt: string | null }>();
  if (!current) throw new InputError(404, "Item not found.");
  const changed = "Someone else changed this item. Reload to see the latest, then try again.";
  if (current.updatedAt !== input.updatedAt) throw new InputError(409, changed);
  const iconKey = key ? `tabler:${key}` : null;
  if (current.visualType === input.visualType && current.iconKey === iconKey) return { updatedAt: current.updatedAt };
  const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt ?? "") + 1 || 0)).toISOString();
  const [write] = await db.batch([
    db.prepare(`UPDATE items SET visual_type = ?, icon_key = ?, updated_at = ? WHERE id = ? AND updated_at IS ?
      AND (? <> 'PHOTO' OR EXISTS (SELECT 1 FROM item_media WHERE item_id = items.id))`)
      .bind(input.visualType, iconKey, now, id, input.updatedAt, input.visualType),
    audit(db, actor.accountId, "ITEM_VISUAL_CHANGED", "ITEM", id, { visualType: { from: current.visualType, to: input.visualType }, iconKey: { from: current.iconKey, to: iconKey } }, true),
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]);
  if (!write!.meta.changes) throw new InputError(409, input.visualType === "PHOTO" ? "The photo or item changed. Reload the item; upload a photo if needed." : changed);
  return { updatedAt: now };
}
