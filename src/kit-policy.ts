import { stockState } from "./catalog-policy";

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

/** Days ahead that an expiry date starts to count: a supply kit is not ready with a component about to expire. */
export const EXPIRY_WINDOW_DAYS = 30;

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

export type ComponentReading = { state: ComponentState; reason: string | null };

const pieces = (count: number) => `${count} on the shelf`;

/** One component's state and, when it is not Ready, the plain sentence that says why. `today` is an ISO date. */
export function readComponent(facts: ComponentFacts, today: string): ComponentReading {
  if (facts.itemStatus !== "ACTIVE") return { state: "REVIEW", reason: facts.itemStatus === "INACTIVE" ? "This item is retired." : "This item is waiting to be verified." };
  if (facts.itemType === "NEEDS_REVIEW") return { state: "REVIEW", reason: "This item is not classified yet." };
  if (facts.seen === "MISSING") return { state: "REVIEW", reason: "Missing at the last check." };
  if (facts.seen === "DAMAGED") return { state: "REVIEW", reason: "Damaged at the last check." };
  if (facts.onHand < facts.demand) {
    const shared = facts.demand > facts.required ? ` (${facts.demand} across kits)` : "";
    return { state: "SHORT", reason: `Needs ${facts.required}${shared}, ${pieces(facts.onHand)}${facts.onLoan ? `, ${facts.onLoan} on loan` : ""}.` };
  }
  if (facts.expiresOn) {
    const days = Math.floor((Date.parse(`${facts.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (days < 0) return { state: "EXPIRING", reason: "Expired." };
    if (days <= EXPIRY_WINDOW_DAYS) return { state: "EXPIRING", reason: days === 0 ? "Expires today." : `Expires in ${days} ${days === 1 ? "day" : "days"}.` };
  }
  if (facts.seen === "LOW") return { state: "LOW", reason: "Running low at the last check." };
  if (facts.openCondition === "LOW") return { state: "LOW", reason: "The open one is running low." };
  if (stockState({ onHand: facts.onHand, reorderThreshold: facts.reorderThreshold, status: facts.itemStatus }) === "LOW") return { state: "LOW", reason: "At or below its reorder level." };
  return { state: "OK", reason: null };
}

/** The kit's state from its components. A kit with nothing in it has nothing to be ready with. */
export function readKit(states: ComponentState[]): { state: KitState; ready: number; total: number } {
  const ready = states.filter((state) => state === "OK").length;
  const state: KitState = !states.length || states.includes("REVIEW") ? "REVIEW" : states.every((each) => each === "OK") ? "READY" : "REPLENISH";
  return { state, ready, total: states.length };
}
