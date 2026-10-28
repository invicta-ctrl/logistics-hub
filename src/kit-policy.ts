import { EXPIRY_WINDOW_DAYS, stockState } from "./catalog-policy";

// Shared by the Worker (derivation) and the browser (labels). A kit holds no stock of its own: everything below is read from its
// components' own records, so a kit's state can never disagree with the items it lists.

export const CHECK_OUTCOMES = ["OK", "LOW", "MISSING", "DAMAGED"] as const;
export type CheckOutcome = typeof CHECK_OUTCOMES[number];
export const CHECK_LABELS: Record<CheckOutcome, string> = { OK: "All there", LOW: "Running low", MISSING: "Missing", DAMAGED: "Damaged" };

export type KitState = "READY" | "REPLENISH" | "REVIEW";
export const KIT_STATE_LABELS: Record<KitState, string> = { READY: "Ready", REPLENISH: "Needs replenishment", REVIEW: "Needs review" };

/** What one component needs: nothing, more stock, or a person to look at the record. */
export type ComponentState = "OK" | "SHORT" | "LOW" | "EXPIRING" | "REVIEW";
export const COMPONENT_STATE_LABELS: Record<ComponentState, string> = { OK: "Ready", SHORT: "Short", LOW: "Running low", EXPIRING: "Expiring", REVIEW: "Needs review" };

/** A supply kit is not ready with a component about to expire: the one expiry window (catalog-policy.ts, V1.16.4 D7). */
export { EXPIRY_WINDOW_DAYS };

export type ComponentFacts = {
  required: number;
  /** What every active kit asks of this item together: one pool of stock cannot make two kits ready at once. */
  demand: number;
  onHand: number;
  onLoan: number;
  reorderThreshold: number;
  itemStatus: string;
  itemType: string;
  openCondition: string | null;
  expiresOn: string | null;
  /** The latest check's word about it, if any. */
  seen: CheckOutcome | null;
};

/**
 * `label` names the one cause (V1.16.4 §4.3 status axes): a component that needs a person says which axis, Inactive, Needs count,
 * Unclassified, Missing or Damaged, never a general "Needs review".
 */
export type ComponentReading = { state: ComponentState; label: string; reason: string | null };
const reading = (state: ComponentState, reason: string | null, label: string = COMPONENT_STATE_LABELS[state]): ComponentReading => ({ state, label, reason });

const pieces = (count: number) => `${count} on the shelf`;

/** One component's state and, when it is not Ready, the plain sentence that says why. `today` is an ISO date. */
export function readComponent(facts: ComponentFacts, today: string): ComponentReading {
  if (facts.itemStatus === "INACTIVE") return reading("REVIEW", "This item is retired.", "Inactive");
  if (facts.itemStatus !== "ACTIVE") return reading("REVIEW", "This item is waiting to be verified.", "Needs count");
  if (facts.itemType === "NEEDS_REVIEW") return reading("REVIEW", "This item is not classified yet.", "Unclassified");
  if (facts.seen === "MISSING") return reading("REVIEW", "Missing at the last check.", "Missing");
  if (facts.seen === "DAMAGED") return reading("REVIEW", "Damaged at the last check.", "Damaged");
  if (facts.onHand < facts.demand) {
    const shared = facts.demand > facts.required ? ` (${facts.demand} across kits)` : "";
    return reading("SHORT", `Needs ${facts.required}${shared}, ${pieces(facts.onHand)}${facts.onLoan ? `, ${facts.onLoan} on loan` : ""}.`);
  }
  if (facts.expiresOn) {
    const days = Math.floor((Date.parse(`${facts.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (days < 0) return reading("EXPIRING", "Expired.");
    if (days <= EXPIRY_WINDOW_DAYS) return reading("EXPIRING", days === 0 ? "Expires today." : `Expires in ${days} ${days === 1 ? "day" : "days"}.`);
  }
  if (facts.seen === "LOW") return reading("LOW", "Running low at the last check.");
  if (facts.openCondition === "LOW") return reading("LOW", "The open one is running low.");
  if (stockState({ onHand: facts.onHand, reorderThreshold: facts.reorderThreshold, status: facts.itemStatus }) === "LOW") return reading("LOW", "At or below its reorder level.");
  return reading("OK", null);
}

/** The kit's state from its components. A kit with nothing in it has nothing to be ready with. */
export function readKit(states: ComponentState[]): { state: KitState; ready: number; total: number } {
  const ready = states.filter((state) => state === "OK").length;
  const state: KitState = !states.length || states.includes("REVIEW") ? "REVIEW" : states.every((each) => each === "OK") ? "READY" : "REPLENISH";
  return { state, ready, total: states.length };
}
