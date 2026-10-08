/*
 * Held-out-style measurement of the text roles (Final Pass amendment §7): synthetic, deterministic name variants of the repository's
 * own public seed catalogue, scored against a deterministic baseline with the same candidate lists. Pure functions only; the script
 * `scripts/evaluate-roles.mjs` makes the (capped, owner-approved) model calls and feeds the answers back in. Only counts leave the
 * script. This measures normalization and arbitration on typos and dropped words; it says nothing about photos.
 */

export type Variant = { kind: "typo" | "drop" | "reorder" | "plural"; text: string; truth: string };

/** Same input, same variants: no randomness, so a rerun compares like with like. */
export function variantsOf(name: string): Variant[] {
  const parts = name.trim().split(/\s+/);
  const out: Variant[] = [];
  const long = parts.reduce((best, word, index) => (word.length > (parts[best]?.length ?? 0) ? index : best), 0);
  const word = parts[long] ?? "";
  if (word.length >= 5) {
    const at = Math.floor(word.length / 2);
    const swapped = word.slice(0, at - 1) + word[at] + word[at - 1] + word.slice(at + 1);
    if (swapped !== word) out.push({ kind: "typo", text: parts.map((each, index) => (index === long ? swapped : each)).join(" "), truth: name });
  }
  if (parts.length >= 3) out.push({ kind: "drop", text: parts.slice(0, -1).join(" "), truth: name });
  if (parts.length >= 2) out.push({ kind: "reorder", text: [...parts.slice(1), parts[0]].join(" "), truth: name });
  const last = parts[parts.length - 1] ?? "";
  if (last.length >= 4) out.push({ kind: "plural", text: [...parts.slice(0, -1), last.endsWith("s") ? last.slice(0, -1) : `${last}s`].join(" "), truth: name });
  return out;
}

const grams = (text: string) => {
  const flat = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const set = new Set<string>();
  for (let index = 0; index + 3 <= flat.length; index += 1) set.add(flat.slice(index, index + 3));
  return set;
};
/** Trigram overlap (0 to 1): tolerant of typos where word matching is not. */
export function similarity(a: string, b: string): number {
  const x = grams(a);
  const y = grams(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const gram of x) if (y.has(gram)) both += 1;
  return both / (x.size + y.size - both);
}

/** The closest catalogue names to a typed name, best first: the candidate list a model would be offered. */
export function closest(typed: string, names: readonly string[], count: number): string[] {
  return [...new Set(names)].map((name) => ({ name, score: similarity(typed, name) })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, count).map((each) => each.name);
}

/** The no-model answer: the closest name, only when it is close enough and clearly ahead of the next. */
export function baselineAnswer(typed: string, terms: readonly string[]): string | null {
  const ranked = terms.map((term) => ({ term, score: similarity(typed, term) })).sort((a, b) => b.score - a.score);
  const [first, second] = ranked;
  if (!first || first.score < 0.5 || (second && first.score - second.score < 0.15)) return null;
  return first.term;
}

export type Case = { truth: string; truthOffered: boolean; baseline: string | null; model: string | null; answered: boolean };
export type Score = { cases: number; truthOffered: number; baselineAnswered: number; baselineRight: number; modelAnswered: number; modelRight: number; modelWrong: number; fixes: number; breaks: number; modelPrecision: number | null; baselinePrecision: number | null };

/** `fixes`: the baseline was wrong or silent and the model was right. `breaks`: the baseline was right and the model answered otherwise. */
export function score(cases: readonly Case[]): Score {
  const s: Score = { cases: cases.length, truthOffered: 0, baselineAnswered: 0, baselineRight: 0, modelAnswered: 0, modelRight: 0, modelWrong: 0, fixes: 0, breaks: 0, modelPrecision: null, baselinePrecision: null };
  for (const each of cases) {
    if (each.truthOffered) s.truthOffered += 1;
    const baselineRight = each.baseline === each.truth;
    if (each.baseline !== null) s.baselineAnswered += 1;
    if (baselineRight) s.baselineRight += 1;
    if (each.answered && each.model !== null) {
      s.modelAnswered += 1;
      if (each.model === each.truth) s.modelRight += 1; else s.modelWrong += 1;
    }
    if (each.model === each.truth && !baselineRight) s.fixes += 1;
    if (baselineRight && each.answered && each.model !== each.truth) s.breaks += 1;
  }
  s.modelPrecision = s.modelAnswered ? s.modelRight / s.modelAnswered : null;
  s.baselinePrecision = s.baselineAnswered ? s.baselineRight / s.baselineAnswered : null;
  return s;
}

/**
 * The quality gate used here (amendment §7.2/§7.3, thresholds proposed in §7.2): precision of shown answers at least 95% (policy-style
 * choices), at least 30 answered cases of support, and more fixes than breaks against the baseline. Anything less is not a pass.
 */
export const GATE = { precision: 0.95, support: 30 } as const;
export function passes(result: Score): { pass: boolean; why: string } {
  if (result.modelAnswered < GATE.support) return { pass: false, why: `only ${result.modelAnswered} answers (needs ${GATE.support})` };
  if ((result.modelPrecision ?? 0) < GATE.precision) return { pass: false, why: `precision ${Math.round((result.modelPrecision ?? 0) * 100)}% is under ${GATE.precision * 100}%` };
  if (result.fixes <= result.breaks) return { pass: false, why: `fixes ${result.fixes} do not exceed breaks ${result.breaks}` };
  return { pass: true, why: "meets precision, support and net benefit" };
}
