export const PUBLIC_LENDING_AUDIENCES = new Set([
  "STUDENTS_AND_USC_STAFF",
  "USC_STAFF_ONLY"
]);

export const PUBLIC_LENDING_ITEM_TYPES = new Set([
  "EQUIPMENT",
  "FURNITURE",
  "AUDIO_VISUAL_EQUIPMENT"
]);

export type InventoryCandidate = {
  status: string;
  needsReview: number | boolean;
  lendingAudience: string;
  itemType: string;
  onHand: number;
};

export function isPubliclyLendable(item: InventoryCandidate): boolean {
  return item.status === "ACTIVE"
    && (item.needsReview === 0 || item.needsReview === false)
    && PUBLIC_LENDING_AUDIENCES.has(item.lendingAudience)
    && PUBLIC_LENDING_ITEM_TYPES.has(item.itemType)
    && Number.isInteger(item.onHand)
    && item.onHand > 0;
}

export function lendingAvailability(item: InventoryCandidate): "available" | "unavailable" {
  return isPubliclyLendable(item) ? "available" : "unavailable";
}
