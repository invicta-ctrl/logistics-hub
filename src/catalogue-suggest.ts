import { type Behaviour, UNSORTED_CATEGORY, behaviourOf } from "./catalog-policy";
import { words } from "./duplicates";

/*
 * Suggestions while cataloguing: plain rules over what the catalog and this session already hold, each with the reason it is
 * offered. A suggestion is only ever a button to tap; nothing is chosen or saved because of one, and nothing here calls a network.
 */

export type Known = { name: string; aliases?: string | null; category: string; itemType: string; consumptionMode: string; unit: string; stockArea: string | null; status: string };
export type Suggestion<T> = { value: T; why: string };
export type Suggestions = { behaviour?: Suggestion<Behaviour>; category?: Suggestion<string>; unit?: Suggestion<string>; stockArea?: Suggestion<string> };

/** How many look-alike items vote. */
const VOTERS = 5;
const quoted = (name: string) => `“${name.length > 28 ? `${name.slice(0, 27).trimEnd()}…` : name}”`;

/** Existing items whose name shares words with what was typed (the last word may still be half typed), best first. */
function lookAlikes(typed: string, known: readonly Known[]): Known[] {
  const wanted = words(typed);
  if (!wanted.length) return [];
  const last = wanted[wanted.length - 1]!;
  const scored: Array<{ item: Known; hit: number; size: number }> = [];
  for (const item of known) {
    if (item.itemType === "NEEDS_REVIEW" || item.category === UNSORTED_CATEGORY) continue;
    const other = words(item.name);
    const hit = wanted.filter((word) => other.includes(word) || (word === last && word.length >= 3 && other.some((candidate) => candidate.startsWith(word)))).length;
    if (hit && hit / wanted.length >= 0.5) scored.push({ item, hit, size: other.length });
  }
  return scored.sort((a, b) => b.hit / wanted.length - a.hit / wanted.length || a.size - b.size || a.item.name.localeCompare(b.item.name)).slice(0, VOTERS).map(({ item }) => item);
}

/** The value most voters share; the nearest look-alike wins a tie. */
function plurality<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || values.indexOf(a[0]) - values.indexOf(b[0]))[0]?.[0];
}

/**
 * Suggestions for the item being typed. `catalog` is every item known so far; `recent` is what this session just added, newest
 * first. A look-alike by name explains itself ("Like “Whiteboard marker”"); with none, the session's own repetition is offered.
 */
export function suggest(typed: string, catalog: readonly Known[], recent: readonly Known[]): Suggestions {
  const similar = lookAlikes(typed, catalog.filter((item) => item.status !== "INACTIVE"));
  const out: Suggestions = {};
  if (similar.length) {
    const why = `Like ${quoted(similar[0]!.name)}${similar.length > 1 ? ` and ${similar.length - 1} more` : ""}`;
    const behaviour = plurality(similar.map((item) => behaviourOf(item)).filter((value): value is Behaviour => value !== null && value !== "REVIEW_LATER"));
    const category = plurality(similar.map((item) => item.category));
    const unit = plurality(similar.map((item) => item.unit));
    const stockArea = plurality(similar.map((item) => item.stockArea ?? "Inventory"));
    if (behaviour) out.behaviour = { value: behaviour, why };
    if (category) out.category = { value: category, why };
    if (unit) out.unit = { value: unit, why };
    if (stockArea) out.stockArea = { value: stockArea, why };
    return out;
  }
  const last = recent.filter((item) => item.category !== UNSORTED_CATEGORY);
  if (last[0]) {
    const same = <T>(pick: (item: Known) => T) => last.length >= 2 && last.slice(0, 2).every((item) => pick(item) === pick(last[0]!));
    if (same((item) => item.category)) out.category = { value: last[0].category, why: "Same as your last two items" };
    else out.category = { value: last[0].category, why: "Same as your last item" };
    const behaviour = behaviourOf(last[0]);
    if (behaviour && behaviour !== "REVIEW_LATER" && same((item) => behaviourOf(item))) out.behaviour = { value: behaviour, why: "Same as your last two items" };
    if (same((item) => item.stockArea ?? "Inventory")) out.stockArea = { value: last[0].stockArea ?? "Inventory", why: "Same as your last two items" };
  }
  return out;
}
