import { compact, words } from "./duplicates";
import { KNOWLEDGE, matchingEntries } from "./item-knowledge";
import { type Places, ancestry, placesOf, pathOf } from "./location-tree";
import { type RelationKind, type RelationSide } from "./relation-policy";

/*
 * Global search (V1.11), shared by the browser (items, kits and places, over the staff search index) and the Worker (people, for
 * administrators). Every match is a plain rule over words staff typed into the records themselves, normalised the catalog's own
 * way (`words()`), and every result carries the one reason it was found, so nothing is guessed and no score is ever shown.
 *
 * A query is a list of words; the last may still be half typed, so a word also matches the start of a longer one ("sew" finds
 * "sewing"). An item is found when every word matches something about it: its name, another name, the kit it is in, the place it
 * is kept, its category, or a built-in knowledge-base hint about what kind of thing it is (item-knowledge.ts). Words in the name
 * count most. Then a few things are added that the records link explicitly: the items a strong match is linked to (Alternative,
 * Replacement, Used with, Holds / Goes in) and the kits that include it.
 */

export type IndexItem = {
  id: string; name: string; aliases: string | null; category: string; itemType: string; status: string; placeId: string | null;
  iconKey: string | null; visualType: "SYSTEM_ICON" | "PHOTO" | null; photoId: string | null;
};
export type IndexPlace = { id: string; name: string; parentId: string | null; active: boolean };
export type IndexKit = { id: string; name: string; placeId: string | null; active: boolean; items: string[] };
export type IndexLink = { from: string; to: string; kind: RelationKind };
/** What `GET /api/staff/search` sends: the catalog's searchable fields only (no quantities, notes, people or evidence). */
export type SearchIndex = { items: IndexItem[]; places: IndexPlace[]; kits: IndexKit[]; links: IndexLink[] };

/** Why a result was found when its name alone does not say: the UI writes the sentence. */
export type Why =
  | { by: "alias"; text: string }
  | { by: "kit"; text: string }
  | { by: "place"; text: string }
  | { by: "category"; text: string }
  | { by: "kind"; text: string }
  | { by: "link"; kind: RelationKind; side: RelationSide; text: string }
  | { by: "includes"; text: string }
  | { by: "within"; text: string }
  | { by: "position"; text: string }
  | { by: "department"; text: string };

export type ItemHit = { kind: "item"; score: number; why: Why | null; item: IndexItem; place: string | null };
export type KitHit = { kind: "kit"; score: number; why: Why | null; kit: IndexKit; place: string | null };
export type PlaceHit = { kind: "place"; score: number; why: Why | null; place: IndexPlace; parent: string | null; items: number };
/** Each kind best first, at most MAX_PER_KIND; `total` counts every match, so "show all" can say how many there are. */
export type Found = { items: ItemHit[]; kits: KitHit[]; places: PlaceHit[]; total: { items: number; kits: number; places: number } };

/** Results kept per kind; the palette shows the first few and can show the rest. */
export const MAX_PER_KIND = 50;
/** Strong item matches whose explicit links and kits are followed: one hop from what was clearly meant, never a chain. */
const FOLLOWED = 5;
/** A query shorter than this finds no records, only pages and shortcuts: one letter matches half the catalog. */
export const MIN_QUERY = 2;

/** Field weights: a word in the name says most about a record, a knowledge-base kind least. Exact words beat word starts. */
const WEIGHT = { name: [10, 8], alias: [8, 6], kit: [6, 5], place: [5, 4], category: [4, 3], kind: [3, 2] } as const;
type Field = keyof typeof WEIGHT;
/** Knowledge-base words that name no kind of thing on their own. */
const GENERIC = new Set(["supply", "supplies", "item", "items", "equipment", "and", "are", "is", "the", "a", "by", "usually", "counted", "used", "one", "at", "time", "taken", "up"]);
/**
 * The kinds of thing the built-in knowledge base knows (its product entries; packaging words such as sachet or roll say how a thing is
 * counted, not what it is). A kind is named by its key and label ("kitchenware", "first aid"); its keywords are the things of that kind
 * ("spoon", "plate"), which are followed only when the words themselves find little (see `searchCatalog`).
 */
const usable = (list: string[]) => [...new Set(list)].filter((word) => !GENERIC.has(word));
const KINDS = new Map(KNOWLEDGE.filter((entry) => entry.kind === "product").map((entry) => [entry.key, {
  label: entry.label ?? entry.note,
  // The key names the kind only where it is not one of its things ("cleaning", not "glue", whose kind is "Art and school supplies").
  names: usable([...(entry.keywords.includes(entry.key) ? [] : words(entry.key.replace(/-/g, " "))), ...words(entry.label ?? entry.note)]),
  things: usable(entry.keywords.flatMap((keyword) => words(keyword)))
}]));

/** 2 for the same word, 1 when the query word starts a longer one, 0 otherwise. */
function wordMatch(token: string, list: readonly string[]): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  for (const word of list) {
    if (word === token) return 2;
    if (token.length >= 2 && word.startsWith(token)) best = 1;
  }
  return best;
}

/** The query as words; empty below MIN_QUERY characters. */
export function queryWords(query: string): string[] {
  return query.trim().length >= MIN_QUERY ? words(query) : [];
}

type Labelled = { text: string; words: string[] };
type Kind = { text: string; names: string[]; things: string[] };
type PreparedItem = {
  item: IndexItem; id: string; path: string | null; name: string[]; aliases: Labelled[]; kits: Labelled[]; places: Labelled[]; category: string[]; kinds: Kind[];
};

/** The index with every record's words worked out once, so each keystroke only compares words. */
export type Prepared = {
  index: SearchIndex; places: Places; items: PreparedItem[]; byId: Map<string, PreparedItem>;
  kits: Array<{ kit: IndexKit; name: string[]; above: Labelled[]; place: string | null }>; kitsOf: Map<string, IndexKit[]>;
  placeWords: Array<{ place: IndexPlace; name: string[]; above: Labelled[] }>; itemsUnder: Map<string, number>;
  links: Map<string, Array<{ other: string; kind: RelationKind; side: RelationSide }>>;
};

const labelled = (text: string): Labelled => ({ text, words: words(text) });
const splitAliases = (aliases: string | null) => (aliases ?? "").split(/[;,\n]/).map((alias) => alias.trim()).filter(Boolean);

export function prepare(index: SearchIndex): Prepared {
  const places = placesOf(index.places);
  const kitsOf = new Map<string, IndexKit[]>();
  for (const kit of index.kits) for (const id of kit.items) kitsOf.set(id, [...kitsOf.get(id) ?? [], kit]);
  const links = new Map<string, Array<{ other: string; kind: RelationKind; side: RelationSide }>>();
  const add = (id: string, entry: { other: string; kind: RelationKind; side: RelationSide }) => links.set(id, [...links.get(id) ?? [], entry]);
  for (const link of index.links) { add(link.from, { other: link.to, kind: link.kind, side: "from" }); add(link.to, { other: link.from, kind: link.kind, side: "to" }); }
  const itemsUnder = new Map<string, number>();
  for (const item of index.items) for (const place of ancestry(places, item.placeId)) itemsUnder.set(place.id, (itemsUnder.get(place.id) ?? 0) + 1);
  const items = index.items.map((item): PreparedItem => ({
    item, id: compact(item.id), path: pathOf(places, item.placeId), name: words(item.name), aliases: splitAliases(item.aliases).map(labelled),
    kits: (kitsOf.get(item.id) ?? []).map((kit) => labelled(kit.name)),
    // The place and every place above it: "cabinet" finds what is on Cabinet 1's shelves too.
    places: ancestry(places, item.placeId).map((place) => labelled(place.name)),
    category: words(item.category),
    kinds: matchingEntries(item.name, item.aliases).flatMap((entry) => { const kind = KINDS.get(entry.key); return kind ? [{ text: kind.label, names: kind.names, things: kind.things }] : []; })
  }));
  return {
    index, places, items, byId: new Map(items.map((entry) => [entry.item.id, entry])), kitsOf, links, itemsUnder,
    kits: index.kits.map((kit) => ({ kit, name: words(kit.name), above: ancestry(places, kit.placeId).map((place) => labelled(place.name)), place: pathOf(places, kit.placeId) })),
    placeWords: index.places.map((place) => ({ place, name: words(place.name), above: ancestry(places, place.parentId).map((parent) => labelled(parent.name)) }))
  };
}

/** The best way one query word matches an item, or null. `things`: also the knowledge base's things of the item's kind. */
function bestField(token: string, entry: PreparedItem, things: boolean): { field: Field; score: number; label?: string } | null {
  let best: { field: Field; score: number; label?: string } | null = null;
  const consider = (field: Field, list: readonly string[], label?: string) => {
    const quality = wordMatch(token, list);
    if (!quality) return;
    const score = WEIGHT[field][quality === 2 ? 0 : 1];
    if (!best || score > best.score) best = { field, score, label };
  };
  consider("name", entry.name);
  for (const alias of entry.aliases) consider("alias", alias.words, alias.text);
  for (const kit of entry.kits) consider("kit", kit.words, kit.text);
  for (const place of entry.places) consider("place", place.words, place.text);
  consider("category", entry.category, entry.item.category);
  for (const kind of entry.kinds) consider("kind", things ? [...kind.names, ...kind.things] : kind.names, kind.text);
  return best;
}

/** The reason to show when the name alone does not explain the match, most telling first. */
const WHY_ORDER: Field[] = ["alias", "kit", "place", "kind", "category"];

function scoreItem(entry: PreparedItem, tokens: string[], idQuery: string, things = false): { score: number; why: Why | null; strong: boolean } | null {
  if (idQuery.length >= 4 && entry.id === idQuery) return { score: 1000, why: null, strong: true };
  const used = new Map<Field, string | undefined>();
  let score = 0;
  let inName = 0;
  let exact = 0;
  // Each field is remembered with the first label it matched (the alias, kit or place), which becomes the reason.
  for (const token of tokens) {
    const best = bestField(token, entry, things);
    if (!best) return null;
    score += best.score;
    if (best.field === "name") { inName += 1; if (best.score === WEIGHT.name[0]) exact += 1; }
    if (!used.has(best.field)) used.set(best.field, best.label);
  }
  const allInName = inName === tokens.length;
  if (allInName) {
    score += 20 - Math.min(10, (entry.name.length - tokens.length) * 0.5);
    if (exact === tokens.length && entry.name.length === tokens.length) score += 100;
    else if (wordMatch(tokens[0]!, entry.name.slice(0, 1))) score += 5;
  }
  if (entry.item.status === "INACTIVE") score -= 40;
  const field = WHY_ORDER.find((each) => used.has(each));
  const why: Why | null = allInName || !field ? null : { by: field, text: used.get(field) ?? "" } as Why;
  // What was clearly meant: every word is in the name or another name.
  return { score, why, strong: [...used.keys()].every((each) => each === "name" || each === "alias") };
}

function scoreWords(tokens: string[], name: string[], above: Labelled[] = []): { score: number; via: string | null } | null {
  let score = 0;
  let via: string | null = null;
  let inName = 0;
  for (const token of tokens) {
    const quality = wordMatch(token, name);
    if (quality) { score += WEIGHT.name[quality === 2 ? 0 : 1]; inName += 1; continue; }
    const parent = above.find((each) => wordMatch(token, each.words));
    if (!parent) return null;
    score += WEIGHT.place[wordMatch(token, parent.words) === 2 ? 0 : 1];
    via ??= parent.text;
  }
  // The same bonuses as an item's name, so a place or kit named what was typed ranks level with an item named the same.
  if (inName === tokens.length) {
    score += 20 - Math.min(10, (name.length - tokens.length) * 0.5);
    if (tokens.every((token) => name.includes(token)) && name.length === tokens.length) score += 100;
    else if (wordMatch(tokens[0]!, name.slice(0, 1))) score += 5;
  }
  return { score, via };
}

/** One collator for every comparison: `localeCompare` with options builds a new one per call, the slowest part of a sort. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byScore = <T extends { score: number }>(name: (hit: T) => string) => (a: T, b: T) => b.score - a.score || collator.compare(name(a), name(b));

/** Items, kits and places for a query, best first in each kind. */
export function searchCatalog(prepared: Prepared, query: string): Found {
  const tokens = queryWords(query);
  if (!tokens.length) return { items: [], kits: [], places: [], total: { items: 0, kits: 0, places: 0 } };
  const idQuery = compact(query);
  const items = new Map<string, ItemHit>();
  const strong: ItemHit[] = [];
  for (const entry of prepared.items) {
    const scored = scoreItem(entry, tokens, idQuery);
    if (!scored) continue;
    const hit: ItemHit = { kind: "item", score: scored.score, why: scored.why, item: entry.item, place: entry.path };
    items.set(entry.item.id, hit);
    if (scored.strong) strong.push(hit);
  }
  // No strong match: things of the same kind ("twine" finds the ribbon and yarn). Beside a strong match they would only be noise.
  if (!strong.length) {
    for (const entry of prepared.items) {
      if (items.has(entry.item.id)) continue;
      const scored = scoreItem(entry, tokens, idQuery, true);
      if (scored) items.set(entry.item.id, { kind: "item", score: scored.score, why: scored.why, item: entry.item, place: entry.path });
    }
  }
  strong.sort(byScore((hit) => hit.item.name));
  const followed = strong.slice(0, FOLLOWED);

  // One hop along the links staff set: what a strong match is used with, replaced by, holds or goes in.
  for (const [rank, hit] of followed.entries()) {
    for (const link of prepared.links.get(hit.item.id) ?? []) {
      const other = prepared.byId.get(link.other);
      if (!other || items.has(link.other)) continue;
      // The other end reads its side of the link: if A is replaced by B, then B "Replaces" A.
      const side = link.side === "from" ? "to" : "from";
      items.set(link.other, { kind: "item", score: 7.5 - rank * 0.1 - (other.item.status === "INACTIVE" ? 40 : 0), why: { by: "link", kind: link.kind, side, text: hit.item.name }, item: other.item, place: other.path });
    }
  }

  const kits = new Map<string, KitHit>();
  for (const { kit, name, above, place } of prepared.kits) {
    const scored = (idQuery.length >= 4 && compact(kit.id) === idQuery) ? { score: 1000, via: null } : scoreWords(tokens, name, above);
    if (scored) kits.set(kit.id, { kind: "kit", score: scored.score - (kit.active ? 0 : 40), why: scored.via ? { by: "place", text: scored.via } : null, kit, place });
  }
  // A kit is a container too: searching what is in it finds the kit.
  for (const [rank, hit] of followed.entries()) {
    for (const kit of prepared.kitsOf.get(hit.item.id) ?? []) {
      if (!kits.has(kit.id)) kits.set(kit.id, { kind: "kit", score: 7 - rank * 0.1 - (kit.active ? 0 : 40), why: { by: "includes", text: hit.item.name }, kit, place: pathOf(prepared.places, kit.placeId) });
    }
  }

  const places: PlaceHit[] = [];
  for (const { place, name, above } of prepared.placeWords) {
    const scored = (idQuery.length >= 4 && compact(place.id) === idQuery) ? { score: 1000, via: null } : scoreWords(tokens, name, above);
    if (scored) places.push({ kind: "place", score: scored.score - (place.active ? 0 : 40), why: scored.via ? { by: "within", text: scored.via } : null, place, parent: pathOf(prepared.places, place.parentId), items: prepared.itemsUnder.get(place.id) ?? 0 });
  }

  return {
    items: [...items.values()].sort(byScore((hit) => hit.item.name)).slice(0, MAX_PER_KIND),
    kits: [...kits.values()].sort(byScore((hit) => hit.kit.name)).slice(0, MAX_PER_KIND),
    places: places.sort(byScore((hit) => hit.place.name)).slice(0, MAX_PER_KIND),
    total: { items: items.size, kits: kits.size, places: places.length }
  };
}

/* ---------- People (the Worker, for administrators only) ---------- */

/** What a person result carries: never a student ID, an ID scan, an account or anything they borrowed. */
export type PersonHit = { id: string; name: string; department: string; position: string | null; officer: boolean; active: boolean; score: number; why: Why | null };
export type PersonRow = { id: string; name: string; department: string; departmentName: string; position: string | null; officer: boolean; active: boolean };
/** People returned for one query: enough to recognise the one meant. */
export const MAX_PEOPLE = 8;

/** Directory people for a query: by name first, then position, then department; the best few, and how many matched in all. */
export function rankPeople(rows: readonly PersonRow[], query: string): { people: PersonHit[]; total: number } {
  const tokens = queryWords(query);
  if (!tokens.length) return { people: [], total: 0 };
  const found: PersonHit[] = [];
  for (const row of rows) {
    const name = words(row.name);
    const position = words(row.position);
    const department = [...words(row.departmentName), row.department.toLowerCase()];
    let score = 0;
    let via: Why | null = null;
    let inName = 0;
    let missed = false;
    for (const token of tokens) {
      const byName = wordMatch(token, name);
      if (byName) { score += WEIGHT.name[byName === 2 ? 0 : 1]; inName += 1; continue; }
      const byPosition = wordMatch(token, position);
      if (byPosition) { score += byPosition === 2 ? 6 : 5; via ??= { by: "position", text: row.position ?? "" }; continue; }
      const byDepartment = wordMatch(token, department);
      if (byDepartment) { score += byDepartment === 2 ? 4 : 3; via ??= { by: "department", text: row.departmentName }; continue; }
      missed = true;
      break;
    }
    if (missed) continue;
    if (inName === tokens.length) score += 20;
    if (!row.active) score -= 40;
    found.push({ id: row.id, name: row.name, department: row.department, position: row.position, officer: row.officer, active: row.active, score, why: inName === tokens.length ? null : via });
  }
  return { people: found.sort(byScore((hit) => hit.name)).slice(0, MAX_PEOPLE), total: found.length };
}

/* ---------- Go to: pages and a few fixed shortcuts ---------- */

/**
 * Where a few unambiguous words go. Each opens an existing page or filter (Attention, Stock); none runs an action, and nothing is
 * parsed beyond matching these words. `admin` ones are shown only to administrators (the Worker refuses the pages to anyone else).
 */
export type Shortcut = { id: string; title: string; detail: string; href: string; terms: readonly string[]; admin?: true; start?: true };
export const SHORTCUTS: readonly Shortcut[] = [
  { id: "home", title: "Home", detail: "Page, what to do next", href: "/staff/home", terms: ["home", "start", "today", "next", "what next", "continue", "insights", "dashboard"] },
  { id: "overdue", title: "Overdue loans", detail: "Attention, loans past their return date", href: "/staff/attention?source=Loans&urgency=NOW", terms: ["overdue", "overdue loans", "late", "late loans", "late returns", "not returned"], start: true },
  { id: "low", title: "Low stock", detail: "Stock, at or under the reorder level", href: "/staff/stock?show=low", terms: ["low stock", "running low", "reorder", "restock"], start: true },
  { id: "out", title: "Out of stock", detail: "Stock, none left", href: "/staff/stock?show=out", terms: ["out of stock", "none left", "no stock", "empty"] },
  { id: "count", title: "Needs count", detail: "Stock, quantities to confirm by counting", href: "/staff/stock?show=count", terms: ["needs count", "needs counting", "to count", "recount", "count"] },
  { id: "expiring", title: "Expiring", detail: "Stock, expiring soon or expired", href: "/staff/stock?show=expiring", terms: ["expiring", "expiry", "expired", "expires"] },
  { id: "classify", title: "Items to classify", detail: "Items, Unclassified", href: "/staff/items?type=NEEDS_REVIEW", terms: ["unclassified", "classify", "to classify", "not sorted"] },
  { id: "attention", title: "Attention", detail: "What needs a person now", href: "/staff/attention", terms: ["attention", "needs attention", "inbox", "bell"], start: true },
  { id: "items", title: "Items", detail: "Page", href: "/staff/items", terms: ["items", "catalog items", "inventory"] },
  { id: "catalogue", title: "Add items", detail: "Rapid capture, a shelf at a time", href: "/staff/catalogue", terms: ["add items", "add item", "new item", "catalogue", "catalog", "capture"], start: true },
  { id: "stock", title: "Stock", detail: "Page", href: "/staff/stock", terms: ["stock", "stock in", "stock out", "pantry"] },
  { id: "loans", title: "Loans", detail: "Page", href: "/staff/loans", terms: ["loans", "lend", "lending", "borrowed", "returns"] },
  { id: "places", title: "Places", detail: "Page, where things are kept", href: "/staff/locations", terms: ["places", "locations", "where", "shelves"], start: true },
  { id: "kits", title: "Kits", detail: "Page", href: "/staff/kits", terms: ["kits", "kit templates", "containers"], start: true },
  { id: "self-service", title: "Self-Service review", detail: "Page", href: "/staff/self-service", terms: ["self service", "phone records", "phones", "qr"] },
  { id: "activity", title: "Activity", detail: "Page, who did what", href: "/staff/activity", terms: ["activity", "history", "audit", "log", "export"] },
  { id: "admin", title: "Administration", detail: "Accounts and settings", href: "/staff/admin", terms: ["administration", "admin", "accounts", "settings", "users"], admin: true },
  { id: "directory", title: "Staff Directory", detail: "Administration, USC people", href: "/staff/admin/directory", terms: ["staff directory", "directory", "people", "members"], admin: true },
  { id: "account", title: "My account", detail: "Password and profile", href: "/staff/account", terms: ["my account", "account", "password", "profile"] }
];

/** A loan reference typed or pasted whole opens that loan in the Loans list. */
const LOAN_REFERENCE = /^LN-[A-Za-z0-9-]{1,60}$/i;

export type GoHit = { kind: "go"; score: number; shortcut: Shortcut };

/** The pages and shortcuts a query names: a term that is the query, or that the query starts, word by word. */
export function searchShortcuts(query: string, admin: boolean): GoHit[] {
  const allowed = SHORTCUTS.filter((shortcut) => admin || !shortcut.admin);
  const trimmed = query.trim();
  if (!trimmed) return allowed.filter((shortcut) => shortcut.start).map((shortcut) => ({ kind: "go", score: 0, shortcut }));
  if (LOAN_REFERENCE.test(trimmed)) {
    const id = `LN-${trimmed.slice(3)}`;
    return [{ kind: "go", score: 100, shortcut: { id: "loan", title: `Loan ${id}`, detail: "Loans, this loan", href: `/staff/loans?loan=${encodeURIComponent(id)}`, terms: [] } }];
  }
  const tokens = words(trimmed);
  if (!tokens.length) return [];
  const hits: GoHit[] = [];
  for (const shortcut of allowed) {
    let best = 0;
    for (const term of shortcut.terms) {
      const termWords = words(term);
      if (tokens.length > termWords.length) continue;
      const qualities = tokens.map((token, index) => token === termWords[index] ? 2 : termWords[index]!.startsWith(token) ? 1 : 0);
      if (qualities.includes(0)) continue;
      const whole = tokens.length === termWords.length && qualities.every((quality) => quality === 2);
      best = Math.max(best, whole ? 50 : 20 + tokens.length);
    }
    if (best) hits.push({ kind: "go", score: best, shortcut });
  }
  return hits.sort((a, b) => b.score - a.score || SHORTCUTS.indexOf(a.shortcut) - SHORTCUTS.indexOf(b.shortcut)).slice(0, 4);
}
