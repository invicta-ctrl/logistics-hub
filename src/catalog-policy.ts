// Shared by the Worker (validation, public filtering) and the browser (labels).
/** An item is Loanable or Consumable. NEEDS_REVIEW marks a migrated record nobody has classified yet. */
export const ITEM_TYPES = ["Loanable", "Consumable", "NEEDS_REVIEW"] as const;
export const ITEM_STATUSES = ["ACTIVE", "VERIFY", "INACTIVE"] as const;
export const LENDING_AUDIENCES = ["NOT_AVAILABLE_FOR_LENDING", "STUDENTS_AND_USC_STAFF", "USC_STAFF_ONLY"] as const;
export const PUBLIC_LENDING_AUDIENCES = new Set<string>(["STUDENTS_AND_USC_STAFF", "USC_STAFF_ONLY"]);
export const PUBLIC_LENDING_ITEM_TYPE = "Loanable";
export const STOCK_AREAS = ["Inventory", "Pantry"] as const;
/** Why stock moved. Kept short and operational; "OTHER" always needs a note. A count is its own reason. */
export const MOVEMENT_REASONS = {
  IN: ["DELIVERY", "RETURNED", "DONATION", "OTHER"],
  OUT: ["CONSUMED", "ISSUED", "DAMAGED", "MISSING", "TRANSFERRED", "OTHER"]
} as const;
export const LOAN_PURPOSES = ["INDIVIDUAL", "USC"] as const;
/** How a loan ends. Only a good return puts the quantity back on the shelf. */
export const LOAN_OUTCOMES = ["RETURNED", "DAMAGED", "LOST"] as const;
export const REORDER_STATUSES = ["NEEDS_RESTOCK", "PLANNED", "RESTOCKED", "DISMISSED"] as const;
export const OPEN_REORDER_STATUSES = new Set<string>(["NEEDS_RESTOCK", "PLANNED"]);

export const LABELS: Record<string, string> = {
  Loanable: "Loanable",
  Consumable: "Consumable",
  NEEDS_REVIEW: "Unclassified",
  ACTIVE: "Active",
  VERIFY: "Verify",
  INACTIVE: "Inactive",
  NOT_AVAILABLE_FOR_LENDING: "Not lendable",
  STUDENTS_AND_USC_STAFF: "Students & USC staff",
  USC_STAFF_ONLY: "USC staff only",
  DELIVERY: "New stock received",
  RETURNED: "Returned",
  DONATION: "Donation",
  CONSUMED: "Consumed or used",
  ISSUED: "Given out",
  DAMAGED: "Damaged",
  MISSING: "Missing",
  TRANSFERRED: "Transferred",
  OTHER: "Other",
  NEEDS_RESTOCK: "Needs restock",
  PLANNED: "Planned",
  RESTOCKED: "Restocked",
  DISMISSED: "Dismissed",
  COUNT: "Physical count",
  INDIVIDUAL: "Individual use",
  USC: "USC use",
  OUT: "On loan",
  LOST: "Lost"
};

export type StockCandidate = { onHand: number; reorderThreshold: number; status: string };

/**
 * One definition of stock state for the Worker and the browser. Low stock needs a reorder
 * level: without one an item is never called low (no alarm without a threshold).
 */
export function stockState(item: StockCandidate): "OUT" | "LOW" | "OK" {
  if (item.onHand <= 0) return "OUT";
  if (item.reorderThreshold > 0 && item.onHand <= item.reorderThreshold) return "LOW";
  return "OK";
}

export type ListingCandidate = {
  status: string;
  needsReview: number | boolean;
  lendingAudience: string;
  itemType: string;
};

/**
 * What still blocks an item from the public Lending Hub, in the words staff see.
 * An item is listed only when nothing is missing: explicitly reviewed, classified
 * Loanable, kept Active, and given an audience. Anything else fails closed.
 */
export function listingGaps(item: ListingCandidate): string[] {
  const gaps: string[] = [];
  if (item.itemType !== PUBLIC_LENDING_ITEM_TYPE) gaps.push("Set the type to Loanable");
  if (!PUBLIC_LENDING_AUDIENCES.has(item.lendingAudience)) gaps.push("Choose who may borrow it");
  if (item.status !== "ACTIVE") gaps.push("Set the status to Active");
  if (!(item.needsReview === 0 || item.needsReview === false)) gaps.push("Mark the details reviewed");
  return gaps;
}

export function isListedForLending(item: ListingCandidate): boolean {
  return listingGaps(item).length === 0;
}

/* ---------- Self-service (phones, Part 4.5) ---------- */

export type SelfServiceCandidate = ListingCandidate & { selfService: number | boolean };
export type SelfServiceAction = "TAKE" | "BORROW";

/**
 * What still blocks an item from phone self-service, in the words staff see. Fail closed:
 * staff opt each item in; a Consumable must be Active and reviewed, a Loanable must also be
 * listed on the Lending Hub (so it has an audience).
 */
export function selfServiceGaps(item: SelfServiceCandidate): string[] {
  const gaps: string[] = [];
  if (!(item.selfService === 1 || item.selfService === true)) gaps.push("Turn on self-service");
  if (item.itemType === PUBLIC_LENDING_ITEM_TYPE) gaps.push(...listingGaps(item));
  else if (item.itemType !== "Consumable") gaps.push("Set the type to Loanable or Consumable");
  else {
    if (item.status !== "ACTIVE") gaps.push("Set the status to Active");
    if (!(item.needsReview === 0 || item.needsReview === false)) gaps.push("Mark the details reviewed");
  }
  return gaps;
}

/** The one self-service rule: a Consumable can be taken, a Loanable borrowed, anything else is not offered. */
export function selfServiceAction(item: SelfServiceCandidate): SelfServiceAction | null {
  if (selfServiceGaps(item).length) return null;
  return item.itemType === PUBLIC_LENDING_ITEM_TYPE ? "BORROW" : "TAKE";
}

/**
 * Limits shared by the phone and the Worker, so the form never offers what the server refuses.
 * Five events per sync keeps one request well inside D1's per-invocation query budget.
 * Past `unitsPerItemHour` self-service units of one item in an hour, further takes and borrows
 * are held for staff, which bounds what an abusive client can do to the shelf's records.
 */
export const SELF_SERVICE_LIMITS = { quantity: 50, eventsPerSync: 5, photosPerSync: 4, unitsPerItemHour: 30 } as const;

/**
 * Why a self-service event needs a person, in the words staff read. Everything else reconciles
 * automatically. A held event changed nothing yet: staff apply (or match) it, or dismiss it.
 */
export const REVIEW_REASONS = {
  UNMATCHED_RETURN: "A return that could not be matched to one open loan",
  RETURN_CONFLICT: "A return that does not fit its loan (already closed differently, or a different quantity)",
  NOT_ELIGIBLE: "Recorded offline for an item that is no longer self-service",
  VOLUME: "More of this item was recorded in an hour than self-service allows",
  CLOCK: "The phone's clock was implausible, so the time cannot be trusted",
  COUNT_OVERLAP: "Happened within minutes of a physical count; the count may already include it",
  ERROR: "Could not be applied automatically"
} as const;
export type ReviewReason = keyof typeof REVIEW_REASONS;
