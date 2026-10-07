import { BEHAVIOURS, type Behaviour, UNSORTED_CATEGORY } from "./catalog-policy";

/*
 * The Workers AI classification second opinion (catalog intelligence amendment §13): what may be sent and what may come back, in one
 * place. V1.11 uses it only to measure the idea on fixture data (`npm run evaluate:suggestions -- --ai`); no request, page or Worker
 * route calls a model. Whatever a caller hands over, `aiPayload` keeps the typed name, its other names and the live option lists, and
 * nothing else. `readAiAnswer` keeps a value only when it is exactly one of those options; an answer is never more than Weak and
 * always reads "AI suggestion".
 */

/** Chosen from the live catalog on 2026-10-07: the cheapest current text model, on Workers Free, no licence step (release record). */
export const AI_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";
/** The reason shown with an answer, and the most it can be. */
export const AI_REASON = "AI suggestion";
export const AI_TIER = "WEAK" as const;

/** Behaviours a model may name: "not sure" is its silence (null), never an answer. */
const AI_BEHAVIOURS = BEHAVIOURS.filter((behaviour): behaviour is Exclude<Behaviour, "REVIEW_LATER"> => behaviour !== "REVIEW_LATER");
const BEHAVIOUR_MEANINGS: Record<(typeof AI_BEHAVIOURS)[number], string> = {
  BORROW: "lent out and brought back",
  CONSUME: "taken whole and not returned",
  GRADUAL: "opened, then used up a little at a time"
};

export type AiOptions = { categories: readonly string[]; units: readonly string[] };
export type AiPayload = {
  name: string;
  aliases: string[];
  options: { categories: string[]; units: string[]; behaviours: Array<{ value: string; meaning: string }> };
};
export type AiAnswer = { category?: string; unit?: string; behaviour?: Behaviour };

const clean = (text: string, limit: number) => text.replace(/\s+/g, " ").trim().slice(0, limit);

/**
 * The only thing that may reach a model. `item` may carry anything (a whole record); only its typed name and other names are read.
 * The option lists are the catalog's live ones, deduplicated, without the "unsorted" placeholder.
 */
export function aiPayload(item: { name: string; aliases?: string | null }, options: AiOptions): AiPayload {
  return {
    name: clean(item.name, 120),
    aliases: (item.aliases ?? "").split(/[;,\n]/).map((alias) => clean(alias, 60)).filter(Boolean).slice(0, 8),
    options: {
      categories: [...new Set(options.categories)].filter((category) => category && category !== UNSORTED_CATEGORY).sort(),
      units: [...new Set(options.units)].filter(Boolean).sort(),
      behaviours: AI_BEHAVIOURS.map((value) => ({ value, meaning: BEHAVIOUR_MEANINGS[value] }))
    }
  };
}

/** The structured answer asked for; every value may be null. Checked again in `readAiAnswer`, which is what counts. */
export function aiSchema(payload: AiPayload) {
  const pick = (values: string[]) => ({ type: ["string", "null"], enum: [...values, null] });
  return {
    type: "object",
    properties: { category: pick(payload.options.categories), unit: pick(payload.options.units), behaviour: pick(payload.options.behaviours.map((each) => each.value)) },
    required: ["category", "unit", "behaviour"],
    additionalProperties: false
  };
}

/** The conversation sent: fixed instructions and the payload as JSON, nothing else. */
export function aiMessages(payload: AiPayload): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: "You classify items in a student council's logistics storeroom. Reply with JSON only: {\"category\", \"unit\", \"behaviour\"}. "
        + "Each value must be copied exactly from the matching list in the request, or null when the name does not make it clear. "
        + "unit is how one is counted (singular). behaviour is how staff hand it out."
    },
    { role: "user", content: JSON.stringify(payload) }
  ];
}

/**
 * The text a model answered with: Workers AI's chat-completion shape (`choices[0].message.content`, what the REST API and binding
 * return for these models since 2026), its older `response`, or the reply itself.
 */
export function aiReplyText(reply: unknown): unknown {
  if (!reply || typeof reply !== "object") return reply;
  const choices = (reply as { choices?: unknown }).choices;
  if (Array.isArray(choices)) return (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  return "response" in reply ? (reply as { response: unknown }).response : reply;
}

/** The model's reply (a parsed object or the text of one), reduced to values that are exactly options; anything else is dropped. */
export function readAiAnswer(reply: unknown, payload: AiPayload): AiAnswer {
  let value: unknown = aiReplyText(reply);
  if (typeof value === "string") {
    const text = value.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try { value = JSON.parse(text); } catch { return {}; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answer = value as Record<string, unknown>;
  const exact = (field: string, allowed: readonly string[]) => typeof answer[field] === "string" && allowed.includes(answer[field] as string) ? answer[field] as string : undefined;
  const out: AiAnswer = {};
  const category = exact("category", payload.options.categories);
  const unit = exact("unit", payload.options.units);
  const behaviour = exact("behaviour", payload.options.behaviours.map((each) => each.value));
  if (category) out.category = category;
  if (unit) out.unit = unit;
  if (behaviour) out.behaviour = behaviour as Behaviour;
  return out;
}
