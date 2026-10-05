import { type Behaviour } from "./catalog-policy";
import { words } from "./duplicates";

/*
 * The built-in item knowledge base (V1.8, catalog intelligence amendment §6): generic hints about common things, shipped with the
 * application. It works offline, reads nothing, and is evidence rather than truth: it ranks below a person's confirmed fields and below
 * the confirmed look-alike items (catalogue-suggest.ts).
 *
 * Version 1 is seeded from the vocabulary of the real catalog: its counting words (roll, sheet, ream, sachet, gallon…) and the words in
 * its item names (ribbon, cartolina, detergent, gauze…), grouped by the categories that catalog uses. Change it in a pull request,
 * bump KNOWLEDGE_VERSION, and rerun `npm run evaluate:suggestions`; there is no admin screen and no database table.
 *
 * Two kinds of entry answer two questions (§6.2). Packaging words mostly decide behaviour and unit ("sachet" is taken one at a time;
 * a "ream" is opened and used gradually). Product words mostly decide category and sometimes unit, and rarely behaviour, because a
 * conditioner sachet and a conditioner bottle behave differently. Hints from several matching entries combine; where they disagree on
 * a field, that field gets no hint.
 *
 * Relation to item-icons.ts: the picture an item gets stays entirely in item-icons.ts, which owns that vocabulary. This file
 * carries no icon keys and never repeats a whole icon list (tests/item-knowledge.test.ts enforces both), so there are never two
 * lists answering the same question. A single word (ribbon, bleach, spoon) is shared on purpose where this file's entry answers a
 * different question: item-icons.ts says what it looks like, this file says how it is counted, taken and filed. Neither file
 * derives from the other; the shared words are the catalog's own vocabulary.
 */

export const KNOWLEDGE_VERSION = 1;

export type KnowledgeEntry = {
  key: string;
  kind: "packaging" | "product";
  /** Words or phrases matched against the typed name and aliases, with the catalog's own normalization (`words()`). */
  keywords: readonly string[];
  behaviour?: Exclude<Behaviour, "REVIEW_LATER">;
  /** A typical counting word, singular as stored. */
  unit?: string;
  /** A typical category; offered only when the live catalog has a category of this name. */
  category?: string;
  /** Why the hint is offered, in the sentence a person reads. */
  note: string;
};

const CRAFT = "SCHOOL SUPPLIES";
const CLEANING = "CLEANING SUPPLIES & EQUIPMENT";
const KITCHEN = "KITCHEN TOOLS AND EQUIPMENT";
const MEDICAL = "MEDICAL SUPPLIES";
const PARTY = "PARTY NEEDS";
const OFFICE = "OFFICE EQUIPMENT AND SUPPLIES";
const PANTRY = "PANTRY";
const SPORTS = "SPORTS EQUIPMENT";

export const KNOWLEDGE: readonly KnowledgeEntry[] = [
  // Packaging and counting words: behaviour and unit.
  { key: "sachet", kind: "packaging", keywords: ["sachet", "packet"], behaviour: "CONSUME", unit: "sachet", note: "Sachets are usually taken one at a time" },
  { key: "ream", kind: "packaging", keywords: ["ream"], behaviour: "GRADUAL", unit: "ream", note: "A ream is opened and used a sheet at a time" },
  { key: "refill", kind: "packaging", keywords: ["refill"], behaviour: "GRADUAL", note: "Refills are used up gradually" },
  { key: "aerosol", kind: "packaging", keywords: ["aerosol", "spray paint"], behaviour: "GRADUAL", unit: "can", note: "Aerosol cans are used gradually" },
  { key: "battery", kind: "product", keywords: ["battery", "aa", "aaa"], behaviour: "CONSUME", unit: "piece", note: "Batteries are used up" },
  { key: "gloves", kind: "product", keywords: ["gloves"], behaviour: "CONSUME", unit: "pair", note: "Disposable gloves are taken by the pair" },
  { key: "mask", kind: "product", keywords: ["facemask", "face mask", "mask"], behaviour: "CONSUME", unit: "piece", category: MEDICAL, note: "Masks are taken one at a time" },
  { key: "roll", kind: "packaging", keywords: ["roll"], unit: "roll", note: "Counted by the roll" },
  { key: "tissue", kind: "product", keywords: ["tissue", "paper towel"], unit: "roll", note: "Usually counted by the roll" },
  { key: "sheet", kind: "packaging", keywords: ["sheet", "sticker"], unit: "sheet", note: "Counted by the sheet" },
  { key: "pack", kind: "packaging", keywords: ["pack", "sequin", "assorted"], unit: "pack", note: "Usually bought and counted in packs" },
  { key: "gallon", kind: "packaging", keywords: ["gallon"], unit: "gallon", note: "Counted by the gallon" },
  { key: "jar", kind: "packaging", keywords: ["jar"], unit: "jar", note: "Counted by the jar" },
  { key: "tube", kind: "packaging", keywords: ["tube"], unit: "tube", note: "Counted by the tube" },
  { key: "pair", kind: "packaging", keywords: ["pair"], unit: "pair", note: "Counted by the pair" },
  // Product words: category (and a unit where the catalog's own items agree).
  { key: "ribbon", kind: "product", keywords: ["ribbon", "yarn", "twine", "rope"], unit: "roll", category: CRAFT, note: "Ribbon and yarn are counted by the roll" },
  { key: "tape", kind: "product", keywords: ["tape"], unit: "roll", note: "Tape is counted by the roll" },
  { key: "foil", kind: "product", keywords: ["foil", "crepe", "vellum", "cartolina", "construction paper"], category: CRAFT, note: "Craft paper" },
  { key: "paint", kind: "product", keywords: ["paint", "acrylic", "watercolor", "poster color"], category: CRAFT, note: "Art supplies" },
  { key: "glue", kind: "product", keywords: ["glue", "glitter", "marker", "chalk", "crayon", "pastel"], category: CRAFT, note: "Art and school supplies" },
  { key: "stationery", kind: "product", keywords: ["folder", "envelope", "notebook", "binder", "pad", "eraser"], category: CRAFT, note: "School supplies" },
  { key: "cleaning", kind: "product", keywords: ["detergent", "bleach", "softener", "dishwashing", "mop", "broom", "scrub", "dustpan"], category: CLEANING, note: "Cleaning supplies" },
  { key: "kitchenware", kind: "product", keywords: ["spoon", "fork", "plate", "bowl", "glass", "ladle", "pitcher"], category: KITCHEN, note: "Kitchenware" },
  { key: "first-aid", kind: "product", keywords: ["gauze", "bandage", "thermometer", "plaster", "cotton"], category: MEDICAL, note: "First-aid supplies" },
  { key: "party", kind: "product", keywords: ["balloon", "candle", "banner", "confetti", "streamer"], category: PARTY, note: "Party supplies" },
  { key: "office", kind: "product", keywords: ["stapler", "staple", "puncher", "toner", "fastener"], category: OFFICE, note: "Office supplies" },
  { key: "pantry", kind: "product", keywords: ["coffee", "sugar", "creamer", "noodle", "kopiko", "biscuit"], category: PANTRY, note: "Pantry items" },
  { key: "sports", kind: "product", keywords: ["ball", "jersey", "whistle", "cone"], category: SPORTS, note: "Sports equipment" }
];

export type Hint<T> = { value: T; why: string };
export type Hints = { behaviour?: Hint<Exclude<Behaviour, "REVIEW_LATER">>; unit?: Hint<string>; category?: Hint<string> };

const phrases = KNOWLEDGE.map((entry) => ({ entry, parts: entry.keywords.map((keyword) => words(keyword)) }));

/** Whether the phrase's words appear in order, side by side, in the typed words. */
function contains(typed: readonly string[], phrase: readonly string[]): boolean {
  for (let start = 0; start + phrase.length <= typed.length; start += 1) if (phrase.every((word, offset) => typed[start + offset] === word)) return true;
  return false;
}

/** The entries whose keywords occur in a name (or its other names). */
export function matchingEntries(name: string, aliases?: string | null): KnowledgeEntry[] {
  const typed = [...words(name), ...(aliases ?? "").split(/[;,\n]/).flatMap((alias) => words(alias))];
  return phrases.filter(({ parts }) => parts.some((phrase) => phrase.length && contains(typed, phrase))).map(({ entry }) => entry);
}

/**
 * What the knowledge base says about a name. Each field takes the value every matching entry that has an opinion agrees on; entries
 * that disagree on a field leave it without a hint. `categories` is the live category list: a category hint is offered only for a
 * category the catalog actually has.
 */
export function knowledgeHints(name: string, categories: readonly string[], aliases?: string | null): Hints {
  const found = matchingEntries(name, aliases);
  const out: Hints = {};
  const agree = <T extends string>(pick: (entry: KnowledgeEntry) => T | undefined, allowed?: (value: T) => boolean) => {
    const opinions = found.filter((entry) => pick(entry) !== undefined && (!allowed || allowed(pick(entry)!)));
    const values = new Set(opinions.map((entry) => pick(entry)));
    return values.size === 1 ? { value: pick(opinions[0]!)!, why: opinions[0]!.note } : undefined;
  };
  const behaviour = agree((entry) => entry.behaviour);
  const unit = agree((entry) => entry.unit);
  const category = agree((entry) => entry.category, (value) => categories.includes(value));
  if (behaviour) out.behaviour = behaviour;
  if (unit) out.unit = unit;
  if (category) out.category = category;
  return out;
}
