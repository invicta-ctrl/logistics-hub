// Shared by the Worker (validation, public guidance) and the browser (pickers, filters, the Locations page).
// Locations are few (tens, never thousands), so the whole set is always loaded and these walk it in memory.

export const PATH_SEPARATOR = " › ";
/** Office → Storage Area → Cabinet 1 → Shelf 2 → Box: deep enough for an office, shallow enough to read at a glance. */
export const MAX_DEPTH = 5;
export const LOCATION_ID = /^LOC-\d{4,}$/;
export const VISIBILITIES = ["STAFF_ONLY", "SELF_SERVICE"] as const;
export const VISIBILITY_LABELS: Record<string, string> = { STAFF_ONLY: "Staff only", SELF_SERVICE: "Shown in Self-Service" };
export const REPORT_KINDS = ["CANT_FIND", "LOCATION_WRONG"] as const;
export type ReportKind = typeof REPORT_KINDS[number];
export const REPORT_LABELS: Record<ReportKind, string> = { CANT_FIND: "I can’t find it", LOCATION_WRONG: "Location looks wrong" };

export type Place = { id: string; name: string; parentId: string | null; active: boolean };
export type Places = ReadonlyMap<string, Place>;

export const placesOf = (list: readonly Place[]): Places => new Map(list.map((place) => [place.id, place]));

/** The place and every place above it, nearest first. A broken parent link ends the walk instead of looping. */
export function ancestry(places: Places, id: string | null): Place[] {
  const chain: Place[] = [];
  for (let at = id ? places.get(id) : undefined; at && chain.length < MAX_DEPTH + 3; at = at.parentId ? places.get(at.parentId) : undefined) chain.push(at);
  return chain;
}

/** "Office › Cabinet 1 › Shelf 2". */
export const pathOf = (places: Places, id: string | null): string | null => id && places.has(id) ? ancestry(places, id).reverse().map((place) => place.name).join(PATH_SEPARATOR) : null;

export function childrenOf(places: Places): Map<string | null, Place[]> {
  const byParent = new Map<string | null, Place[]>();
  for (const place of places.values()) byParent.set(place.parentId, [...byParent.get(place.parentId) ?? [], place]);
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return byParent;
}

/** The place and everything inside it. */
export function withinPlace(places: Places, id: string): Set<string> {
  const byParent = childrenOf(places);
  const found = new Set<string>();
  const visit = (at: string) => { if (found.has(at)) return; found.add(at); for (const child of byParent.get(at) ?? []) visit(child.id); };
  visit(id);
  return found;
}

/** Every place in reading order (each place before what is inside it), with how deep it is: what a picker or the tree shows. */
export function inOrder(places: Places): Array<{ place: Place; depth: number }> {
  const byParent = childrenOf(places);
  const out: Array<{ place: Place; depth: number }> = [];
  const visit = (parent: string | null, depth: number) => { for (const place of byParent.get(parent) ?? []) { if (out.length < places.size) { out.push({ place, depth }); visit(place.id, depth + 1); } } };
  visit(null, 1);
  return out;
}

/** How many levels the place and what is inside it span (a place alone is 1). */
export function levelsBelow(places: Places, id: string): number {
  const byParent = childrenOf(places);
  const deepest = (at: string, seen: number): number => seen > MAX_DEPTH + 3 ? seen : Math.max(seen, ...(byParent.get(at) ?? []).map((child) => deepest(child.id, seen + 1)));
  return deepest(id, 1);
}

/** The key two names share when staff would call them the same place: "Cabinet 1", "cabinet  1" and "Cabinet-1". */
export const sameNameKey = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Places under one parent whose names read alike. Reconciliation never merges them; this is what asks staff to look. */
export function lookAlikes(places: Places): Place[][] {
  const groups = new Map<string, Place[]>();
  for (const place of places.values()) {
    const key = `${place.parentId ?? ""}|${sameNameKey(place.name)}`;
    groups.set(key, [...groups.get(key) ?? [], place]);
  }
  return [...groups.values()].filter((group) => group.length > 1).map((group) => group.sort((a, b) => a.id.localeCompare(b.id)));
}

/** A name as stored: trimmed, inner whitespace collapsed, and never the path separator. */
export function cleanName(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.length >= 1 && text.length <= 120 && !text.includes(PATH_SEPARATOR.trim()) && !/[\u0000-\u001f]/.test(text) ? text : null;
}
