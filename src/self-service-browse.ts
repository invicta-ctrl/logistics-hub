import type { SelfServiceAction } from "./catalog-policy";
import { PATH_SEPARATOR } from "./location-tree";
import type { CatalogItem, LocalEvent } from "./offline-queue";

/*
 * How Self-Service sorts and finds items, with no DOM so it is easy to test. The groups are
 * derived from what the catalog already says (the item's action and its stock area): staff
 * keep nothing extra, and a phone with an older snapshot still shows every item somewhere.
 */

export type GroupId = "equipment" | "supplies" | "pantry";
export const GROUPS: ReadonlyArray<{ id: GroupId; name: string }> = [
  { id: "equipment", name: "Equipment" },
  { id: "supplies", name: "Supplies" },
  { id: "pantry", name: "Pantry" }
];
export const groupName = (id: GroupId): string => GROUPS.find((group) => group.id === id)!.name;
export const isGroup = (value: string | null): value is GroupId => GROUPS.some((group) => group.id === value);

/** Things lent and returned are Equipment; everything else is Supplies, or Pantry when staff keep it in the pantry. */
export const groupOf = (item: CatalogItem): GroupId => item.action === "BORROW" ? "equipment" : item.area === "Pantry" ? "pantry" : "supplies";

/** The offered items by group, in the catalog's own order; a group nobody offers anything from is absent. */
export function grouped(items: CatalogItem[]): Array<{ id: GroupId; name: string; items: CatalogItem[] }> {
  return GROUPS.map((group) => ({ ...group, items: items.filter((item) => groupOf(item) === group.id) })).filter((group) => group.items.length);
}

/** What this phone has used most (then most recently), at most `limit` items still on offer. Returns of something are not use. */
export function frequentItems(events: LocalEvent[], items: CatalogItem[], limit = 4): CatalogItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const tally = new Map<string, { count: number; last: number }>();
  for (const event of events) {
    if (event.type === "RETURN" || event.state === "rejected" || !byId.has(event.itemId)) continue;
    const seen = tally.get(event.itemId);
    tally.set(event.itemId, { count: (seen?.count ?? 0) + 1, last: Math.max(seen?.last ?? 0, event.seq) });
  }
  return [...tally].sort(([, a], [, b]) => b.count - a.count || b.last - a.last).slice(0, limit).map(([id]) => byId.get(id)!);
}

/** "Main office › Storage › Shelf B" becomes "Storage › Shelf B": the part a person walking in needs. */
export const conciseLocation = (location: string | null | undefined): string | null =>
  location ? location.split(PATH_SEPARATOR).slice(-2).join(PATH_SEPARATOR) : null;

/** What the item is, in a sentence, for the item page: the item's configuration says it, the person never chooses. */
export function behaviourLine(action: SelfServiceAction, audience: string | null): string {
  if (action === "BORROW") return `Borrow it and bring it back${audience === "USC_STAFF_ONLY" ? ". Lent for USC use only" : ""}. You take a photo when you borrow it and again when you return it.`;
  if (action === "TAKE") return "Take what you need. There is nothing to return.";
  return "A shared supply. Just say you used some. There is nothing to count or return.";
}

export const normalize = (text: string): string => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Name, other names and location match (not the category, whose labels would match too much); every word typed must appear. */
export function matching(items: CatalogItem[], query: string): CatalogItem[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const haystack = normalize(`${item.name} ${item.aliases ?? ""} ${item.location ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}
