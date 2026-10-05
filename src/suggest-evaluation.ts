import { UNSORTED_CATEGORY, behaviourOf } from "./catalog-policy";
import { type Known, type Tier, suggest } from "./catalogue-suggest";

/*
 * Leave-one-out measurement of the suggestion pipeline (catalog intelligence amendment §9). Each confirmed item is hidden in turn, its
 * name is typed as if new, and the pipeline's suggestion for behaviour, unit and category is compared with what the item really is,
 * per strength tier. Only counts are produced, so aggregates can be recorded in the repository while the catalog itself stays out of it.
 */

export const FIELDS = ["behaviour", "unit", "category"] as const;
export type Field = typeof FIELDS[number];
export type Cell = { n: number; right: number; either: number };
export type Evaluation = { items: number; fields: Record<Field, Record<Tier | "NONE", Cell>> };

const confirmed = (item: Known) => item.itemType !== "NEEDS_REVIEW" && item.category !== UNSORTED_CATEGORY && item.status !== "INACTIVE";

export function evaluate(catalog: readonly Known[], options: { knowledge: boolean }): Evaluation {
  const items = catalog.filter(confirmed);
  const empty = (): Record<Tier | "NONE", Cell> => ({ STRONG: { n: 0, right: 0, either: 0 }, WEAK: { n: 0, right: 0, either: 0 }, CONFLICTING: { n: 0, right: 0, either: 0 }, NONE: { n: 0, right: 0, either: 0 } });
  const result: Evaluation = { items: items.length, fields: { behaviour: empty(), unit: empty(), category: empty() } };
  for (const [index, item] of items.entries()) {
    const others = items.filter((_, other) => other !== index);
    const found = suggest(item.name, others, [], options);
    const truth: Record<Field, string | null> = { behaviour: behaviourOf(item), unit: item.unit, category: item.category };
    for (const field of FIELDS) {
      const suggestion = found[field] as { value: string; tier: Tier; other?: { value: string } } | undefined;
      const cell = result.fields[field][suggestion?.tier ?? "NONE"];
      cell.n += 1;
      if (suggestion?.value === truth[field]) cell.right += 1;
      if (suggestion && (suggestion.value === truth[field] || suggestion.other?.value === truth[field])) cell.either += 1;
    }
  }
  return result;
}

const pct = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : "–";

/** A plain table for the release record: how often each tier spoke, and how often it was right. Evaluation output, not user-facing copy. */
export function report(label: string, evaluation: Evaluation): string {
  const lines = [`${label}: ${evaluation.items} confirmed items`];
  for (const field of FIELDS) {
    const cells = evaluation.fields[field];
    const offered = evaluation.items - cells.NONE.n;
    const right = cells.STRONG.right + cells.WEAK.right + cells.CONFLICTING.right;
    lines.push(`  ${field}: suggested for ${pct(offered, evaluation.items)}; first choice right ${pct(right, offered)} of those`);
    for (const tier of ["STRONG", "WEAK", "CONFLICTING"] as const) {
      const cell = cells[tier];
      lines.push(`    ${tier.padEnd(11)} ${String(cell.n).padStart(4)} items; right ${pct(cell.right, cell.n)}${tier === "CONFLICTING" ? `; either option right ${pct(cell.either, cell.n)}` : ""}`);
    }
    lines.push(`    ${"NONE".padEnd(11)} ${String(cells.NONE.n).padStart(4)} items`);
  }
  return lines.join("\n");
}
