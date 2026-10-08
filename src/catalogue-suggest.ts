import { type Behaviour, UNSORTED_CATEGORY, behaviourOf } from "./catalog-policy";
import { words } from "./duplicates";
import { knowledgeHints } from "./item-knowledge";

/*
 * Suggestions while cataloguing: plain rules over what the catalog and this session already hold, each with the reason it is
 * offered. A suggestion is only ever a button to tap; nothing is chosen or saved because of one, and nothing here calls a network.
 */

export type Known = { name: string; aliases?: string | null; category: string; itemType: string; consumptionMode: string; unit: string; stockArea: string | null; status: string };
/**
 * Strong: an exact name match to a confirmed item, or enough look-alikes agree and nothing in the built-in knowledge disagrees.
 * Weak: a single look-alike, a few that do not yet agree enough, or the knowledge base alone. Conflicting: the look-alikes and the
 * knowledge base disagree, or the vote ties; both options are shown, each with its reason. No percentage is ever shown.
 */
export type Tier = "STRONG" | "WEAK" | "CONFLICTING";
/** Where a suggestion's evidence came from: confirmed items, the built-in knowledge base, or what this session just added. */
export type Basis = "CATALOG" | "KNOWLEDGE" | "SESSION";
export type Suggestion<T> = { value: T; why: string; tier: Tier; basis: Basis; /** The other side of a Conflicting suggestion. */ other?: { value: T; why: string } };
export type Suggestions = { behaviour?: Suggestion<Behaviour>; category?: Suggestion<string>; unit?: Suggestion<string>; stockArea?: Suggestion<string> };

/** How many look-alike items vote. */
const VOTERS = 5;
/** Look-alikes (of at most five) that must agree, with nothing contradicting them, for a Strong suggestion: 4, from 3, because the leave-one-out run separated Strong from Weak cleanly there (tuned by `npm run evaluate:suggestions`). */
export const STRONG_VOTES = 4;
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

/** The values voters gave, most shared first (the nearest look-alike wins a tie), with how many gave each. */
function tally<T>(values: T[]): Array<[T, number]> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || values.indexOf(a[0]) - values.indexOf(b[0]));
}

/** What the look-alikes and the knowledge base say about one field, and how sure that is. */
function decide<T>(votes: T[], exact: boolean, why: string, hint: { value: T; why: string } | undefined): Suggestion<T> | undefined {
  const ranked = tally(votes);
  const top = ranked[0];
  if (!top) return hint ? { value: hint.value, why: hint.why, tier: "WEAK", basis: "KNOWLEDGE" } : undefined;
  const tied = ranked[1] !== undefined && ranked[1][1] === top[1];
  if (tied) return { value: top[0], why, tier: "CONFLICTING", basis: "CATALOG", other: { value: ranked[1]![0], why } };
  if (hint && hint.value !== top[0]) return { value: top[0], why, tier: "CONFLICTING", basis: "CATALOG", other: hint };
  return { value: top[0], why, tier: exact || top[1] >= STRONG_VOTES ? "STRONG" : "WEAK", basis: "CATALOG" };
}

/**
 * Suggestions for the item being typed. `catalog` is every item known so far; `recent` is what this session just added, newest
 * first. Evidence, in order: confirmed look-alike items (a hint explains itself: "Like “Whiteboard marker”"), then the built-in
 * knowledge base (item-knowledge.ts); with neither, the session's own repetition is offered.
 */
export function suggest(typed: string, catalog: readonly Known[], recent: readonly Known[], options: { knowledge?: boolean } = {}): Suggestions {
  const active = catalog.filter((item) => item.status !== "INACTIVE");
  const similar = lookAlikes(typed, active);
  const hints = options.knowledge === false ? {} : knowledgeHints(typed, [...new Set(active.map((item) => item.category))]);
  const out: Suggestions = {};
  if (similar.length || hints.behaviour || hints.unit || hints.category) {
    const exact = similar.length > 0 && words(similar[0]!.name).join(" ") === words(typed).join(" ");
    const why = similar.length ? `Like ${quoted(similar[0]!.name)}${similar.length > 1 ? ` and ${similar.length - 1} more` : ""}` : "";
    const behaviour = decide(similar.map((item) => behaviourOf(item)).filter((value): value is Behaviour => value !== null && value !== "REVIEW_LATER"), exact, why, hints.behaviour);
    const category = decide(similar.map((item) => item.category), exact, why, hints.category);
    const unit = decide(similar.map((item) => item.unit), exact, why, hints.unit);
    const stockArea = decide(similar.map((item) => item.stockArea ?? "Inventory"), exact, why, undefined);
    if (behaviour) out.behaviour = behaviour;
    if (category) out.category = category;
    if (unit) out.unit = unit;
    if (stockArea) out.stockArea = stockArea;
    if (similar.length) return out;
  }
  const last = recent.filter((item) => item.category !== UNSORTED_CATEGORY);
  if (last[0]) {
    const same = <T>(pick: (item: Known) => T) => last.length >= 2 && last.slice(0, 2).every((item) => pick(item) === pick(last[0]!));
    if (!out.category) out.category = { value: last[0].category, why: same((item) => item.category) ? "Same as your last two items" : "Same as your last item", tier: "WEAK", basis: "SESSION" };
    const behaviour = behaviourOf(last[0]);
    if (!out.behaviour && behaviour && behaviour !== "REVIEW_LATER" && same((item) => behaviourOf(item))) out.behaviour = { value: behaviour, why: "Same as your last two items", tier: "WEAK", basis: "SESSION" };
    if (!out.stockArea && same((item) => item.stockArea ?? "Inventory")) out.stockArea = { value: last[0].stockArea ?? "Inventory", why: "Same as your last two items", tier: "WEAK", basis: "SESSION" };
  }
  return out;
}
