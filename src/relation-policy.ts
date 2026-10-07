// Explicit item links (V1.11, migration 0030): the fixed vocabulary shared by the Worker (validation) and the browser (labels, search).

export const RELATION_KINDS = ["ALTERNATIVE", "REPLACEMENT", "USED_WITH", "CONTENTS"] as const;
export type RelationKind = typeof RELATION_KINDS[number];
/** Which end of a link an item is: `from` holds it (item_id: the replaced item, the container), `to` is the other (related_id). */
export type RelationSide = "from" | "to";

/** How a link reads from each end: "<this item> <words> <the other item>". */
export const RELATION_WORDS: Record<RelationKind, Record<RelationSide, string>> = {
  ALTERNATIVE: { from: "Alternative to", to: "Alternative to" },
  REPLACEMENT: { from: "Replaced by", to: "Replaces" },
  USED_WITH: { from: "Used with", to: "Used with" },
  CONTENTS: { from: "Holds", to: "Goes in" }
};

/** The choices a person makes on an item's record, each read from that item's side; the two-way kinds need only one. */
export const RELATION_CHOICES: ReadonlyArray<{ kind: RelationKind; side: RelationSide; label: string; hint: string }> = [
  { kind: "USED_WITH", side: "from", label: "Used with", hint: "Usually taken or used together" },
  { kind: "ALTERNATIVE", side: "from", label: "Alternative to", hint: "Does the same job when this one is not available" },
  { kind: "REPLACEMENT", side: "from", label: "Replaced by", hint: "This one is being replaced by the other" },
  { kind: "REPLACEMENT", side: "to", label: "Replaces", hint: "This one replaces the other" },
  { kind: "CONTENTS", side: "from", label: "Holds", hint: "This is the container; the other goes in it" },
  { kind: "CONTENTS", side: "to", label: "Goes in", hint: "This goes in the other, its container" }
];

/** Links one item may have, from both ends: enough for real pairings, few enough to read at a glance. */
export const MAX_LINKS = 20;
