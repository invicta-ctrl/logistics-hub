import type { ReviewProposal } from "./ai-review-types";
export type { ReviewProposal } from "./ai-review-types";
import { type AiRunner, BANDS, BREAKER_FAILURES, BREAKER_MS, CALL_TIMEOUT_MS, type Urgency, assistOn, reserve, spend } from "./ambient-assist";
import { aiReplyText } from "./catalog-ai";
import { words } from "./duplicates";

/*
 * The four model roles of the Final Pass (amendment §5), behind the one boundary in ambient-assist.ts. Each role is a real adapter: its
 * own model, narrow task, strict reply check, token and time limits, Neuron reserve and breaker. Gemma's photo call stays in
 * ambient-assist.ts (VISION_EXTRACT); this file carries the three text roles and the router that decides, from what the Hub already
 * knows, which of them (if any) to ask. A role whose measured quality has not passed starts REVIEW_ONLY: it may produce a bounded
 * proposal for a person, but never a trusted field value. SHADOW_EVALUATION remains limited to bounded evaluations. Nothing here
 * writes a record; an answer is a value picked from a list the caller supplied, or null.
 */

export type ModelRole = "VISION_EXTRACT" | "TEXT_NORMALIZE" | "CANDIDATE_ARBITRATE" | "RARE_SECOND_OPINION";
/** Amendment §5.1. A role is ACTIVE_ELIGIBLE only after its held-out quality gate passed (§7.3); until then it is review-only. */
export type RouteState = "ACTIVE_ELIGIBLE" | "REVIEW_ONLY" | "SHADOW_EVALUATION";

export const ROLE_MODELS: Record<ModelRole, string> = {
  VISION_EXTRACT: "@cf/google/gemma-4-26b-a4b-it",
  TEXT_NORMALIZE: "@cf/ibm-granite/granite-4.0-h-micro",
  CANDIDATE_ARBITRATE: "@cf/qwen/qwen3-30b-a3b-fp8",
  RARE_SECOND_OPINION: "@cf/zai-org/glm-4.7-flash"
};

/**
 * What each text role may cost and say. Reserves are counted before the call. They rest on live calls of 2026-10-08, including
 * one maximum-size call per role (Granite 0.98 with 40 terms, Qwen 1.57 with 5 candidates, GLM 1.00; docs/road-to-v2/evidence/
 * v1.15-final-pass-provider-smoke-2026-10-08.md), and through the Worker binding all four were shown to report `usage.neurons` (0.15, 0.28, 0.44, 0.49 on a tiny probe). One sample per role: provisional. A reply's own `usage.neurons` replaces the reserve when it reports one. The thinking option
 * was accepted by Qwen and GLM, but Qwen still answered in `reasoning_content`, so it is unproven for Qwen.
 */
export const ROLE_LIMITS: Record<Exclude<ModelRole, "VISION_EXTRACT">, { reserve: number; maxTokens: number; /** Sent only to models that reason before answering; Granite is not one. Accepted by Qwen and GLM in the 2026-10-08 smoke; Qwen still answers in reasoning_content. */ thinkingOption: boolean }> = {
  TEXT_NORMALIZE: { reserve: 2, maxTokens: 40, thinkingOption: false },
  CANDIDATE_ARBITRATE: { reserve: 3, maxTokens: 60, thinkingOption: true },
  RARE_SECOND_OPINION: { reserve: 3, maxTokens: 80, thinkingOption: true }
};
/**
 * All three start review-only: Granite failed its first classification test (13% and 24%), and Qwen and GLM have no held-out result at
 * all. A proposed answer needs a person's Keep, Reject or Correct decision before it can affect a draft. ACTIVE_ELIGIBLE remains a
 * future reviewed-gate state; production code passes no override, and only tests assign to it.
 */
export const ROUTE_STATE: Record<Exclude<ModelRole, "VISION_EXTRACT">, RouteState> = {
  TEXT_NORMALIZE: "REVIEW_ONLY",
  CANDIDATE_ARBITRATE: "REVIEW_ONLY",
  RARE_SECOND_OPINION: "REVIEW_ONLY"
};

export type TextRole = keyof typeof ROLE_LIMITS;
export type RoleOutcome = "ANSWER" | "ABSTAIN" | "UNAVAILABLE";
export type ProposalField = "term" | "id" | "follow_up";
const ROLE_FIELDS: Record<TextRole, ProposalField> = { TEXT_NORMALIZE: "term", CANDIDATE_ARBITRATE: "id", RARE_SECOND_OPINION: "follow_up" };
/** A bounded candidate for a person to Keep, Reject or Correct; never a trusted draft value. */
/**
 * `value` is what a caller may use. REVIEW_ONLY and SHADOW_EVALUATION always return null; only the latter exposes its answer in
 * `observed` to a bounded evaluation (`evaluation: true`), which no screen or route reads.
 */
export type RoleResult = { role: TextRole; version: string; outcome: RoleOutcome; reason: string; value: string | null; proposal: ReviewProposal | null; observed: string | null; neurons: number | null; shadow: boolean };

const breakers: Record<TextRole, { failures: number; openUntil: number }> = {
  TEXT_NORMALIZE: { failures: 0, openUntil: 0 },
  CANDIDATE_ARBITRATE: { failures: 0, openUntil: 0 },
  RARE_SECOND_OPINION: { failures: 0, openUntil: 0 }
};
export const resetRoleBreakers = () => { for (const each of Object.values(breakers)) { each.failures = 0; each.openUntil = 0; } };

const clean = (text: string, limit: number) => text.replace(/\s+/g, " ").trim().slice(0, limit);

/* ---------- The three adapters: what is sent, the schema asked for, and how a reply is read ---------- */

type Task = { system: string; user: string; allowed: readonly string[]; field: ProposalField };

/** TEXT_NORMALIZE (Granite): the observed or typed name, and the canonical terms it may be normalized to. Returns one of them or null. */
export const MAX_TERMS = 40;
export function normalizeTask(observed: string, terms: readonly string[], preferred: readonly string[] = []): Task {
  const wanted = new Set(words(observed));
  const overlap = (term: string) => words(term).filter((word) => wanted.has(word)).length;
  // Terms longer than 60 characters are skipped rather than cut (a cut term could match something else); the closest 40 are kept.
  const allowed = [...new Set(terms.map((term) => term.replace(/\s+/g, " ").trim()).filter((term) => term && term.length <= 60))]
    .sort((a, b) => overlap(b) - overlap(a) || Number(preferred.includes(b)) - Number(preferred.includes(a)) || a.localeCompare(b)).slice(0, MAX_TERMS);
  return {
    field: "term", allowed,
    system: "You match a storeroom item name to the catalogue's own wording. Reply with JSON only: {\"term\": ...}. term must be copied exactly from the list in the request. Answer only when the name is clearly the same item as one term (a misspelling, a plural, reordered words, or one missing word) and no other term fits equally well; otherwise null.",
    user: JSON.stringify({ name: clean(observed, 80), terms: allowed })
  };
}

/** CANDIDATE_ARBITRATE (Qwen): two or more already-valid catalogue items. Returns one supplied id or null. */
export function arbitrateTask(observed: string, candidates: ReadonlyArray<{ id: string; name: string }>): Task {
  const list = candidates.slice(0, 5).map((candidate) => ({ id: candidate.id, name: clean(candidate.name, 80) }));
  return {
    field: "id", allowed: list.map((candidate) => candidate.id),
    system: "You decide which existing storeroom item a new name refers to. Reply with JSON only: {\"id\": ...}. id must be copied exactly from the candidates in the request, or null when it is unclear or none fits.",
    user: JSON.stringify({ name: clean(observed, 80), candidates: list })
  };
}

/** The follow-up questions the second opinion may ask a person to settle; it picks one or none and decides nothing itself. */
export const FOLLOW_UPS = ["CHECK_NAME", "CHECK_CATEGORY", "CHECK_COUNTING_UNIT", "CHECK_BORROW_OR_TAKE", "LOOKS_LIKE_EXISTING_ITEM"] as const;
/** What conflicts, as fixed codes: no catalogue text, name or person data can reach the second opinion. */
export const FACT_CODES = ["NAME_AND_PHOTO_DISAGREE", "CATALOGUE_AND_KNOWLEDGE_DISAGREE", "CATEGORY_SPLIT", "UNIT_SPLIT", "BEHAVIOUR_SPLIT", "POSSIBLE_DUPLICATE"] as const;
export type FactCode = typeof FACT_CODES[number];
/** RARE_SECOND_OPINION (GLM): which things conflict. Returns one fixed follow-up or null. */
export function secondOpinionTask(facts: readonly FactCode[]): Task {
  return {
    field: "follow_up", allowed: FOLLOW_UPS,
    system: "Staff are cataloguing a storeroom item and the evidence conflicts. Reply with JSON only: {\"follow_up\": ...}. follow_up is the one question a person should check first, copied exactly from the allowed list, or null.",
    user: JSON.stringify({ conflicts: [...new Set(facts)].filter((fact) => FACT_CODES.includes(fact)), allowed: FOLLOW_UPS })
  };
}

/** A reply reduced to one allowed value, or null. A value that is not exactly in the allowed list is dropped. */
export function readChoice(reply: unknown, task: Pick<Task, "allowed" | "field">): string | null {
  let value: unknown = aiReplyText(reply);
  // Measured 2026-10-08: with thinking off, Qwen returns its JSON in `reasoning_content` and leaves `content` null.
  if (value === null || value === undefined) {
    const message = (reply as { choices?: Array<{ message?: { reasoning_content?: unknown; reasoning?: unknown } }> } | null)?.choices?.[0]?.message;
    value = message?.reasoning_content ?? message?.reasoning;
  }
  if (typeof value === "string") {
    try { value = JSON.parse(value.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== task.field) return null;
  const picked = (value as Record<string, unknown>)[task.field];
  return typeof picked === "string" && task.allowed.includes(picked) ? picked : null;
}

const neuronsOf = (reply: unknown, fallback: number) => {
  const used = Number((reply as { usage?: { neurons?: unknown } } | null)?.usage?.neurons);
  return Number.isFinite(used) && used > 0 ? used : fallback;
};
const log = (role: TextRole, outcome: RoleOutcome, reason: string, ms: number, neurons: number) => console.log(JSON.stringify({ assist: role, model: ROLE_MODELS[role], outcome, reason, ms, neurons }));

/**
 * Runs one text role. Never throws. An allowance, switch, breaker or reply check that refuses is an ABSTAIN or UNAVAILABLE with a
 * reason code and no value. REVIEW_ONLY returns a typed proposal with a null trusted value. SHADOW_EVALUATION runs only when
 * `evaluation` is true (a bounded benchmark), and only that state exposes an observation.
 */
export async function runRole(db: D1Database, ai: AiRunner | undefined, role: TextRole, task: Task, urgency: Urgency, options: { evaluation?: boolean; now?: number } = {}): Promise<RoleResult> {
  const now = options.now ?? Date.now();
  const started = Date.now();
  const state = ROUTE_STATE[role];
  const shadow = state === "SHADOW_EVALUATION";
  const reviewOnly = state === "REVIEW_ONLY";
  const done = (outcome: RoleOutcome, reason: string, value: string | null = null, neurons: number | null = null): RoleResult => {
    log(role, outcome, reason, Date.now() - started, neurons ?? 0);
    const proposal = reviewOnly && value ? { kind: "REVIEW_ONLY" as const, role, field: task.field, value } : null;
    return { role, version: ROLE_MODELS[role], outcome, reason, value: shadow || reviewOnly ? null : value, proposal, observed: shadow && options.evaluation ? value : null, neurons, shadow };
  };
  try {
    if (!ai) return done("UNAVAILABLE", "NO_BINDING");
    if (shadow && !options.evaluation) return done("ABSTAIN", "SHADOW_ONLY");
    if (!await assistOn(db)) return done("ABSTAIN", "SWITCHED_OFF");
    if (task.field !== ROLE_FIELDS[role]) return done("ABSTAIN", "TASK_MISMATCH");
    if (task.allowed.length === 0) return done("ABSTAIN", "NOTHING_TO_CHOOSE");
    const breaker = breakers[role];
    if (breaker.openUntil > now) return done("UNAVAILABLE", "BREAKER_OPEN");
    const limits = ROLE_LIMITS[role];
    if (!await reserve(db, limits.reserve, urgency, now)) return done("ABSTAIN", "BUDGET");
    let reply: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      reply = await Promise.race([
        ai.run(ROLE_MODELS[role], {
          messages: [{ role: "system", content: task.system }, { role: "user", content: task.user }],
          response_format: { type: "json_schema", json_schema: { type: "object", properties: { [task.field]: { type: ["string", "null"], enum: [...task.allowed, null] } }, required: [task.field], additionalProperties: false } },
          max_tokens: limits.maxTokens, temperature: 0, ...(limits.thinkingOption ? { chat_template_kwargs: { enable_thinking: false } } : {})
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), CALL_TIMEOUT_MS); })
      ]);
    } catch {
      breaker.failures += 1;
      if (breaker.failures >= BREAKER_FAILURES) { breaker.openUntil = now + BREAKER_MS; breaker.failures = 0; }
      return done("UNAVAILABLE", "CALL_FAILED", null, limits.reserve);
    } finally {
      clearTimeout(timer);
    }
    breaker.failures = 0;
    const neurons = neuronsOf(reply, limits.reserve);
    if (neurons !== limits.reserve) await spend(db, neurons - limits.reserve, now);
    const value = readChoice(reply, task);
    return value === null ? done("ABSTAIN", "NO_VALID_ANSWER", null, neurons) : done("ANSWER", "OK", value, neurons);
  } catch {
    return done("UNAVAILABLE", "ERROR");
  }
}

/* ---------- The router ---------- */

export type RouteContext = {
  /** An exact verified catalogue item already resolves the draft: no model is needed. */
  exactMatch: boolean;
  /** The name could not be matched to the catalogue's wording by the built-in rules. */
  unmatchedName: string | null;
  /** Canonical terms the name may be normalized to. */
  terms: readonly string[];
  /** Verified items that remain equally plausible for the name. */
  candidates: ReadonlyArray<{ id: string; name: string }>;
  /** What conflicts, as fixed codes, when a different answer would change what a person should check. */
  conflict: readonly FactCode[];
  /** Neurons spent today (neuronsToday). GLM is asked only in the NORMAL band, below the first protection line. */
  used: number;
};

const closeWord = (left: string, right: string): boolean => {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftAt = 0;
  let rightAt = 0;
  let edits = 0;
  while (leftAt < left.length && rightAt < right.length) {
    if (left[leftAt] === right[rightAt]) { leftAt += 1; rightAt += 1; continue; }
    if (++edits > 1) return false;
    if (left.length > right.length) leftAt += 1;
    else if (right.length > left.length) rightAt += 1;
    else { leftAt += 1; rightAt += 1; }
  }
  return edits + (left.length - leftAt) + (right.length - rightAt) <= 1;
};

const relevantTerm = (name: string, terms: readonly string[]) => {
  const typed = words(name);
  return typed.some((typedWord) => terms.some((term) => words(term).some((termWord) => closeWord(typedWord, termWord))));
};

/**
 * A draft asks at most one text role: Qwen takes priority for two or more valid candidates, Granite only follows failed deterministic
 * normalization with relevant terms, and GLM only asks a fixed meaningful conflict while the day remains in the NORMAL band.
 */
export function route(context: RouteContext): TextRole[] {
  if (context.exactMatch) return [];
  const validCandidateIds = new Set(context.candidates.filter((candidate) => candidate.id.trim() && candidate.name.trim()).map((candidate) => candidate.id));
  if (validCandidateIds.size >= 2) return ["CANDIDATE_ARBITRATE"];
  if (context.unmatchedName && relevantTerm(context.unmatchedName, context.terms)) return ["TEXT_NORMALIZE"];
  if (context.conflict.some((fact) => FACT_CODES.includes(fact)) && context.used < BANDS.conserve) return ["RARE_SECOND_OPINION"];
  return [];
}
