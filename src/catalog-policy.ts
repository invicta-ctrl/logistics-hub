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
 * An item appears on the public Lending Hub only when staff have explicitly
 * reviewed it, classified it Loanable, kept it Active, and chosen an audience.
 * Anything else fails closed and is never sent to the public.
 */
export function isListedForLending(item: ListingCandidate): boolean {
  return item.status === "ACTIVE"
    && (item.needsReview === 0 || item.needsReview === false)
    && PUBLIC_LENDING_AUDIENCES.has(item.lendingAudience)
    && item.itemType === PUBLIC_LENDING_ITEM_TYPE;
}
