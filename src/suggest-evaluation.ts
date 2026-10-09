import { type AiPayload, aiPayload, readAiAnswer } from "./catalog-ai";
import { behaviourOf } from "./catalog-policy";
import { type Known, type Tier, suggest, verified } from "./catalogue-suggest";

/*
 * Leave-one-out measurement of the suggestion pipeline (catalog intelligence amendment §9). Each confirmed item is hidden in turn, its
 * name is typed as if new, and the pipeline's suggestion for behaviour, unit and category is compared with what the item really is,
 * per strength tier. Only counts are produced, so aggregates can be recorded in the repository while the catalog itself stays out of it.
 */

export const FIELDS = ["behaviour", "unit", "category"] as const;
export type Field = typeof FIELDS[number];
export type Cell = { n: number; right: number; either: number };
export type Evaluation = { items: number; fields: Record<Field, Record<Tier | "NONE", Cell>> };

export function evaluate(catalog: readonly Known[], options: { knowledge: boolean }): Evaluation {
  const items = catalog.filter(verified);
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

/* ---------- The Workers AI second opinion, measured (amendment §13.6) ---------- */

/** Built-in results a second opinion may add to: never Strong, never a field a person confirmed. */
const SOFT = ["WEAK", "CONFLICTING", "NONE"] as const;
type Soft = typeof SOFT[number];
export type AiCell = { n: number; answered: number; aiRight: number; builtInRight: number; eitherRight: number };
export type AiEvaluation = { items: number; calls: number; failed: number; skipped: number; fields: Record<Field, Record<Soft, AiCell>> };

/**
 * Leave-one-out again, with one model call per item whose built-in result is not Strong for some field (one call answers all three).
 * `ask` receives only `aiPayload`'s output, never the record. `limit` caps the calls; items past it are counted as skipped.
 */
export async function evaluateWithAi(catalog: readonly Known[], ask: (payload: AiPayload) => Promise<unknown>, limit: number): Promise<AiEvaluation> {
  const items = catalog.filter(confirmed);
  const cell = (): AiCell => ({ n: 0, answered: 0, aiRight: 0, builtInRight: 0, eitherRight: 0 });
  const empty = (): Record<Soft, AiCell> => ({ WEAK: cell(), CONFLICTING: cell(), NONE: cell() });
  const result: AiEvaluation = { items: items.length, calls: 0, failed: 0, skipped: 0, fields: { behaviour: empty(), unit: empty(), category: empty() } };
  for (const [index, item] of items.entries()) {
    const others = items.filter((_, other) => other !== index);
    const found = suggest(item.name, others, [], { knowledge: true });
    const soft = FIELDS.filter((field) => (found[field]?.tier ?? "NONE") !== "STRONG");
    if (!soft.length) continue;
    if (result.calls >= limit) { result.skipped += 1; continue; }
    const payload = aiPayload(item, { categories: others.map((other) => other.category), units: others.map((other) => other.unit) });
    result.calls += 1;
    let answer: ReturnType<typeof readAiAnswer> = {};
    try { answer = readAiAnswer(await ask(payload), payload); } catch { result.failed += 1; }
    const truth: Record<Field, string | null> = { behaviour: behaviourOf(item), unit: item.unit, category: item.category };
    for (const field of soft) {
      const suggestion = found[field] as { value: string; tier: Tier; other?: { value: string } } | undefined;
      const target = result.fields[field][(suggestion?.tier ?? "NONE") as Soft];
      const builtIn = suggestion?.value === truth[field] || suggestion?.other?.value === truth[field];
      target.n += 1;
      if (answer[field] !== undefined) target.answered += 1;
      if (answer[field] === truth[field]) target.aiRight += 1;
      if (suggestion?.value === truth[field]) target.builtInRight += 1;
      if (builtIn || answer[field] === truth[field]) target.eitherRight += 1;
    }
  }
  return result;
}

/** Built-in against built-in plus the AI suggestion, per built-in tier. Evaluation output, not user-facing copy. */
export function reportAi(label: string, evaluation: AiEvaluation): string {
  const lines = [`${label}: ${evaluation.items} confirmed items; ${evaluation.calls} calls (${evaluation.failed} failed), ${evaluation.skipped} items past the call limit`];
  for (const field of FIELDS) {
    lines.push(`  ${field}:`);
    for (const tier of SOFT) {
      const cell = evaluation.fields[field][tier];
      lines.push(`    ${tier.padEnd(11)} ${String(cell.n).padStart(4)} items; built-in right ${pct(cell.builtInRight, cell.n)}; AI answered ${pct(cell.answered, cell.n)}, right ${pct(cell.aiRight, cell.n)}; either right ${pct(cell.eitherRight, cell.n)}`);
    }
    const cells = SOFT.map((tier) => evaluation.fields[field][tier]);
    const answered = cells.reduce((sum, cell) => sum + cell.answered, 0);
    lines.push(`    AI precision: right ${pct(cells.reduce((sum, cell) => sum + cell.aiRight, 0), answered)} of ${answered} answers; recovered ${evaluation.fields[field].NONE.aiRight} of ${evaluation.fields[field].NONE.n} items with no built-in suggestion`);
  }
  return lines.join("\n");
}
