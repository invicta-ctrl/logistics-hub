import { type Behaviour } from "./catalog-policy";
import { type Basis, type Suggestion, type Suggestions } from "./catalogue-suggest";

/*
 * The catalogue draft (Final Pass amendment §4): one short-lived proposal for every field of Add items, merged onto the form and never
 * written to the database. Each field says where its value came from and how far to trust it, so the screen can show a suggestion, ask
 * for a confirmation, or say plainly that a fact cannot be known from a photo. Evidence ranks as the amendment §3.1 lists it: what the
 * person typed, then the session's own context, then confirmed items, then the built-in knowledge base, then the photo, and last
 * "unknown". A model hint (the photo's reading) never outranks any of the others and never fills a policy field by itself.
 */

/** Where a field's value came from, highest authority first. */
export type DraftSource = "USER" | "SESSION" | "VERIFIED_CATALOG" | "APPROVED_POLICY" | "KNOWLEDGE" | "OBSERVED_PHOTO" | "DEFAULT";
/**
 * `verified`: the person's own entry or the session's chosen context. `suggested`: agreed evidence, offered as a button or prefill.
 * `needs-confirmation`: weak, conflicting or only a starting value; a person must look. `unknown`: nothing defensible to offer.
 */
export type DraftState = "verified" | "suggested" | "needs-confirmation" | "unknown";

export type DraftField<T> = {
  value: T | null;
  source: DraftSource | null;
  /** The sentence a person reads, or the missing fact in plain words. */
  reason: string;
  state: DraftState;
  wasUserEdited: boolean;
  /** The other side of a conflict, shown but never filled. */
  other?: { value: T; reason: string };
};

/** What a catalogue photo shows, reduced to checkable text. Each part is null unless it passed its own checks (ambient-assist.ts). Defined here so the screen never imports server code. */
export type PhotoReading = { name: string | null; brand: string | null; model: string | null; packaging: string | null };

export const DRAFT_FIELDS = ["name", "aliases", "category", "behaviour", "unit", "quantity", "place", "stockArea", "brand", "model", "serial", "expiry", "description", "reorder"] as const;
export type DraftFieldName = typeof DRAFT_FIELDS[number];

export type CatalogDraft = {
  /** Bumped by the screen on every retake, reset or catalogue change; a result carrying an older number is dropped. */
  revision: number;
  name: DraftField<string>;
  aliases: DraftField<string>;
  category: DraftField<string>;
  behaviour: DraftField<Behaviour>;
  unit: DraftField<string>;
  quantity: DraftField<number>;
  place: DraftField<string>;
  stockArea: DraftField<string>;
  brand: DraftField<string>;
  model: DraftField<string>;
  serial: DraftField<string>;
  expiry: DraftField<string>;
  description: DraftField<string>;
  reorder: DraftField<number>;
};

export type DraftInput = {
  revision: number;
  /** Only what the person typed or deliberately cleared. A value the photo wrote into the form must not be passed here, or it would be reported as theirs. */
  typed: Partial<Record<DraftFieldName, string>>;
  /** Fields the person has touched, even if now empty (a cleared name is still their choice). */
  edited: ReadonlySet<DraftFieldName>;
  suggestions: Suggestions;
  photo: Partial<PhotoReading> | null;
  /** The place and stock area the staff member chose for this session, if any. */
  session: { place?: string | null; placeName?: string | null; stockArea?: string | null };
  /** The starting quantity the screen offers. */
  defaultQuantity: number;
};

const SOURCE_OF: Record<Basis, DraftSource> = { CATALOG: "VERIFIED_CATALOG", KNOWLEDGE: "KNOWLEDGE", SESSION: "SESSION" };
/** What can only be known by looking at the thing or its paperwork, not from a photo's guess. */
const NOT_FROM_A_PHOTO: Partial<Record<DraftFieldName, string>> = {
  quantity: "Count what is on the shelf; a photo cannot show the real amount.",
  serial: "Type it from the label if there is one.",
  expiry: "Type it from the package if there is one.",
  reorder: "Set it when the restock level is agreed.",
  description: "Add a note only if it will help the next person."
};

const unknown = <T>(reason: string): DraftField<T> => ({ value: null, source: null, reason, state: "unknown", wasUserEdited: false });
const clean = (text: string | null | undefined, limit: number) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

/** A field the person owns: their value wins everywhere, even when it is empty. */
function owned<T>(value: T | null, reason = "Entered by you"): DraftField<T> {
  return { value, source: "USER", reason, state: value === null ? "unknown" : "verified", wasUserEdited: true };
}

/** A rule-based suggestion as a draft field. Strong evidence is suggested; weak evidence needs confirming; a split is shown, not filled. */
function fromSuggestion<T>(suggestion: Suggestion<T> | undefined, missing: string): DraftField<T> {
  if (!suggestion) return unknown(missing);
  const source = SOURCE_OF[suggestion.basis];
  if (suggestion.tier === "CONFLICTING") {
    return { value: null, source, reason: "Two answers fit. Choose one.", state: "needs-confirmation", wasUserEdited: false, ...(suggestion.other ? { other: { value: suggestion.other.value, reason: suggestion.other.why } } : {}) };
  }
  return { value: suggestion.value, source, reason: suggestion.why, state: suggestion.tier === "STRONG" ? "suggested" : "needs-confirmation", wasUserEdited: false };
}

/** Text the photo read, offered only when it is short and printable; the person still checks it. */
function observed(text: string | null | undefined, limit: number, what: string): DraftField<string> {
  const value = clean(text, limit);
  if (!value || !/\p{L}|\p{N}/u.test(value)) return unknown(`No ${what} could be read in the photo.`);
  return { value, source: "OBSERVED_PHOTO", reason: `Read from the photo. Check it.`, state: "needs-confirmation", wasUserEdited: false };
}

/**
 * Builds the draft. Pure: it reads nothing, calls nothing and writes nothing. For every field the order is the person's entry, the
 * session's context, then evidence, then `unknown`. Quantity, serial, expiry, reorder level and notes are never taken from a photo.
 */
export function composeDraft(input: DraftInput): CatalogDraft {
  const mine = <T>(field: DraftFieldName, convert: (text: string) => T | null): DraftField<T> | null => {
    const text = input.typed[field] ?? "";
    if (!input.edited.has(field)) return null;
    return owned(text.trim() ? convert(text.trim()) : null);
  };
  const text = (field: DraftFieldName) => mine<string>(field, (value) => value);
  const count = (field: DraftFieldName) => mine<number>(field, (value) => (Number.isFinite(Number(value)) ? Number(value) : null));
  const photo = input.photo;
  const photoName = clean(photo?.name, 48);
  const catalogue = input.suggestions;

  const name: DraftField<string> = text("name") ?? (photoName
    ? { value: photoName, source: "OBSERVED_PHOTO", reason: "Suggested from the photo. Check it, or type over it.", state: "needs-confirmation", wasUserEdited: false }
    : unknown("Type what it is called. A temporary name is fine."));

  const quantity: DraftField<number> = count("quantity") ?? { value: input.defaultQuantity, source: "DEFAULT", reason: NOT_FROM_A_PHOTO.quantity!, state: "needs-confirmation", wasUserEdited: false };

  const place: DraftField<string> = text("place") ?? (input.session.place
    ? { value: input.session.place, source: "SESSION", reason: input.session.placeName ? `The place you chose for this session: ${input.session.placeName}` : "The place you chose for this session", state: "verified", wasUserEdited: false }
    : unknown("Choose where it is kept. A photo cannot show that."));

  const stockArea: DraftField<string> = text("stockArea") ?? (input.session.stockArea
    ? { value: input.session.stockArea, source: "SESSION", reason: "The stock area you chose for this session", state: "verified", wasUserEdited: false }
    : fromSuggestion(catalogue.stockArea, "Choose the stock area."));

  return {
    revision: input.revision,
    name,
    aliases: text("aliases") ?? unknown("Other names people use, if any."),
    category: text("category") ?? fromSuggestion(catalogue.category, "Choose a category."),
    behaviour: mine<Behaviour>("behaviour", (value) => value as Behaviour) ?? fromSuggestion(catalogue.behaviour, "Choose how it is handed out."),
    unit: text("unit") ?? fromSuggestion(catalogue.unit, "Choose how one is counted."),
    quantity,
    place,
    stockArea,
    brand: text("brand") ?? observed(photo?.brand, 60, "brand"),
    model: text("model") ?? observed(photo?.model, 60, "model"),
    serial: text("serial") ?? unknown(NOT_FROM_A_PHOTO.serial!),
    expiry: text("expiry") ?? unknown(NOT_FROM_A_PHOTO.expiry!),
    description: text("description") ?? unknown(NOT_FROM_A_PHOTO.description!),
    reorder: count("reorder") ?? unknown(NOT_FROM_A_PHOTO.reorder!)
  };
}

/** Fields a person still has to look at before the item is complete, in the order the form shows them. */
export function needsAttention(draft: CatalogDraft): DraftFieldName[] {
  return DRAFT_FIELDS.filter((field) => {
    const entry = draft[field];
    return entry.state === "needs-confirmation" || (entry.state === "unknown" && (field === "name" || field === "category" || field === "behaviour" || field === "unit"));
  });
}

/**
 * A model result applies only to the revision it was asked for. A retake, reset, leaving the screen or a catalogue change bumps the
 * screen's revision, so an older answer is dropped instead of filling a different item's form.
 */
export const isStale = (resultRevision: number, currentRevision: number): boolean => resultRevision !== currentRevision;
/** Photo reading distinguishes an answered photo from a temporary service failure. */
export type PhotoOutcome = "NAMED" | "NO_NAME" | "OFF" | "UNAVAILABLE" | "BUDGET" | "BREAKER" | "FAILED";
export type PhotoCleanup = { cleanable?: boolean; cleanupReason?: string; canEnable?: boolean };
export type PhotoCrop = { x: number; y: number; width: number; height: number };
