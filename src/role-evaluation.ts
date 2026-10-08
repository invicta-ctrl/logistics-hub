/*
 * Held-out-style measurement of the text roles (Final Pass amendment §7): synthetic, deterministic name variants of the repository's
 * own public seed catalogue, scored against a deterministic baseline with the same candidate lists. Pure functions only; the script
 * `scripts/evaluate-roles.mjs` makes the (capped, owner-approved) model calls and feeds the answers back in. Only counts leave the
 * script. This measures normalization and arbitration on typos and dropped words; it says nothing about photos.
 *
 * Honesty rules (review of 2026-10-08): the catalogue's names are split once, by a fixed hash, into a TUNE half (the only half prompts
 * may be adjusted against) and a sealed TEST half; variants that more than one catalogue name could explain are set aside, not scored;
 * names that are NOT in the catalogue are asked too, so a model that never abstains cannot pass; coverage is printed beside precision.
 */

export type Variant = { kind: "typo" | "drop" | "reorder" | "plural" | "absent"; text: string; /** The catalogue name it should resolve to, or null when no catalogue name is right (the model should abstain). */ truth: string | null };

/** Which half of the catalogue a name belongs to. Fixed (FNV-1a), so a rerun and a different machine split it the same way. */
export function splitOf(name: string): "TUNE" | "TEST" {
  let hash = 0x811c9dc5;
  for (const char of name.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash % 2 === 0 ? "TUNE" : "TEST";
}

const flat = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/**
 * A variant is ambiguous when it is itself another catalogue name, or a leading part of two or more names ("Packing tape" for "Packing
 * tape roll" and "Packing tape dispenser"): a person could mean more than one, so scoring it right or wrong would be arbitrary.
 */
export function isAmbiguous(variant: Variant, names: readonly string[]): boolean {
  const text = flat(variant.text);
  if (!text) return true;
  const others = names.filter((name) => name !== variant.truth);
  if (others.some((name) => flat(name) === text)) return true;
  return variant.kind === "drop" && names.filter((name) => flat(name).startsWith(`${text} `)).length > 1;
}

/**
 * Plausible names that are not in the catalogue: the first word of one name with the rest of another (never an existing name, and never
 * a near-copy of one). The right answer for these is no answer.
 */
export function absentNames(names: readonly string[], count: number): Variant[] {
  const out: Variant[] = [];
  const known = new Set(names.map(flat));
  const sorted = [...new Set(names)].sort();
  for (let index = 0; out.length < count && index < sorted.length * 3; index += 1) {
    const a = sorted[(index * 7) % sorted.length]!.split(/\s+/);
    const b = sorted[(index * 13 + 5) % sorted.length]!.split(/\s+/);
    if (a.length < 2 || b.length < 2) continue;
    const text = `${a[0]} ${b.slice(1).join(" ")}`;
    if (known.has(flat(text)) || out.some((each) => each.text === text)) continue;
    if (names.some((name) => similarity(text, name) >= 0.7)) continue;
    out.push({ kind: "absent", text, truth: null });
  }
  return out;
}

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

export type Case = { truth: string | null; truthOffered: boolean; baseline: string | null; model: string | null; answered: boolean };
export type Score = { cases: number; truthOffered: number; baselineAnswered: number; baselineRight: number; modelAnswered: number; modelRight: number; modelWrong: number; fixes: number; breaks: number; modelPrecision: number | null; baselinePrecision: number | null; /** Share of all cases the model answered (the rest it abstained on or failed). */ coverage: number | null; /** Answers given where no name was right. */ absentAnswered: number; absentCases: number };

/** `fixes`: the baseline was wrong or silent and the model was right. `breaks`: the baseline was right and the model answered otherwise. */
export function score(cases: readonly Case[]): Score {
  const s: Score = { cases: cases.length, truthOffered: 0, baselineAnswered: 0, baselineRight: 0, modelAnswered: 0, modelRight: 0, modelWrong: 0, fixes: 0, breaks: 0, modelPrecision: null, baselinePrecision: null, coverage: null, absentAnswered: 0, absentCases: 0 };
  for (const each of cases) {
    if (each.truthOffered) s.truthOffered += 1;
    // Staying silent is never "right": a case with no true name counts for nothing when the baseline says nothing.
    const baselineRight = each.baseline !== null && each.baseline === each.truth;
    if (each.truth === null) s.absentCases += 1;
    if (each.baseline !== null) s.baselineAnswered += 1;
    if (baselineRight) s.baselineRight += 1;
    if (each.answered && each.model !== null) {
      s.modelAnswered += 1;
      if (each.model === each.truth) s.modelRight += 1; else s.modelWrong += 1;
      if (each.truth === null) s.absentAnswered += 1;
    }
    if (each.model !== null && each.model === each.truth && !baselineRight) s.fixes += 1;
    if (baselineRight && each.answered && each.model !== each.truth) s.breaks += 1;
  }
  s.coverage = s.cases ? s.modelAnswered / s.cases : null;
  s.modelPrecision = s.modelAnswered ? s.modelRight / s.modelAnswered : null;
  s.baselinePrecision = s.baselineAnswered ? s.baselineRight / s.baselineAnswered : null;
  return s;
}

/**
 * The quality gate used here (amendment §7.2/§7.3, thresholds proposed in §7.2): precision of shown answers at least 95% (policy-style
 * choices), at least 30 answered cases of support, and more fixes than breaks against the baseline. Anything less is not a pass.
 */
export const GATE = { precision: 0.95, support: 30 } as const;
/**
 * `netBenefit: false` is for a run where the baseline was silent on every case, so breaks are zero by construction and "more fixes than
 * breaks" proves nothing; the gate then rests on precision (negatives included) and support alone, and says so.
 */
export function passes(result: Score, { netBenefit = true }: { netBenefit?: boolean } = {}): { pass: boolean; why: string } {
  if (result.modelAnswered < GATE.support) return { pass: false, why: `only ${result.modelAnswered} answers (needs ${GATE.support})` };
  if ((result.modelPrecision ?? 0) < GATE.precision) return { pass: false, why: `precision ${Math.round((result.modelPrecision ?? 0) * 100)}% is under ${GATE.precision * 100}%` };
  if (netBenefit && result.fixes <= result.breaks) return { pass: false, why: `fixes ${result.fixes} do not exceed breaks ${result.breaks}` };
  return { pass: true, why: netBenefit ? "meets precision, support and net benefit" : "meets precision and support (net benefit not measurable here)" };
}
