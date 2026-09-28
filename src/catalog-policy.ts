// Shared by the Worker (validation, public filtering) and the browser (labels).
export const ITEM_TYPES = ["Loanable", "Consumable", "Saleable", "NEEDS_REVIEW"] as const;
export const ITEM_STATUSES = ["ACTIVE", "VERIFY", "INACTIVE"] as const;
export const LENDING_AUDIENCES = ["NOT_AVAILABLE_FOR_LENDING", "STUDENTS_AND_USC_STAFF", "USC_STAFF_ONLY"] as const;
export const PUBLIC_LENDING_AUDIENCES = new Set<string>(["STUDENTS_AND_USC_STAFF", "USC_STAFF_ONLY"]);
export const PUBLIC_LENDING_ITEM_TYPE = "Loanable";

export const LABELS: Record<string, string> = {
  Loanable: "Loanable",
  Consumable: "Consumable",
  Saleable: "Saleable",
  NEEDS_REVIEW: "Unclassified",
  ACTIVE: "Active",
  VERIFY: "Verify",
  INACTIVE: "Inactive",
  NOT_AVAILABLE_FOR_LENDING: "Not lendable",
  STUDENTS_AND_USC_STAFF: "Students & USC staff",
  USC_STAFF_ONLY: "USC staff only"
};

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
