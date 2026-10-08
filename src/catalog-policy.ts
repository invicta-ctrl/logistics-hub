// Shared by the Worker (validation, public filtering) and the browser (labels).
/** An item is Loanable or Consumable. NEEDS_REVIEW marks a migrated record nobody has classified yet. */
export const ITEM_TYPES = ["Loanable", "Consumable", "NEEDS_REVIEW"] as const;
export const ITEM_STATUSES = ["ACTIVE", "VERIFY", "INACTIVE"] as const;
export const LENDING_AUDIENCES = ["NOT_AVAILABLE_FOR_LENDING", "STUDENTS_AND_USC_STAFF", "USC_STAFF_ONLY"] as const;
export const PUBLIC_LENDING_AUDIENCES = new Set<string>(["STUDENTS_AND_USC_STAFF", "USC_STAFF_ONLY"]);
/** Loanable items are lent and come back; Consumables are taken and never return. Both are shown on the Lending Hub. */
export const PUBLIC_LENDING_ITEM_TYPE = "Loanable";
export const LISTABLE_ITEM_TYPES = new Set<string>(["Loanable", "Consumable"]);
export const STOCK_AREAS = ["Inventory", "Pantry"] as const;
/**
 * How a Consumable is used: taken a whole unit at a time, or opened and used gradually (a ream, a bottle).
 * Either way only outer units are counted. Every item starts WHOLE_UNIT; staff opt an item in.
 */
export const CONSUMPTION_MODES = ["WHOLE_UNIT", "OPEN_UNIT"] as const;
/**
 * What a staff member decides about an item at the shelf (Rapid Catalogue). It is the item's behaviour, never a session default:
 * one shelf holds loanable, whole-unit and gradually used things together. REVIEW_LATER is "not sure": the item is kept, counted
 * and located but stays unclassified (and so hidden from every public surface) until someone decides.
 */
export const BEHAVIOURS = ["BORROW", "CONSUME", "GRADUAL", "REVIEW_LATER"] as const;
export type Behaviour = typeof BEHAVIOURS[number];
export const BEHAVIOUR_LABELS: Record<Behaviour, string> = { BORROW: "Borrow & return", CONSUME: "Take", GRADUAL: "Use gradually", REVIEW_LATER: "Not sure / Review later" };
export const behaviourFields = (behaviour: Behaviour): { itemType: string; consumptionMode: string } => ({
  itemType: behaviour === "BORROW" ? "Loanable" : behaviour === "REVIEW_LATER" ? "NEEDS_REVIEW" : "Consumable",
  consumptionMode: behaviour === "GRADUAL" ? "OPEN_UNIT" : "WHOLE_UNIT"
});
export const behaviourOf = (item: { itemType: string; consumptionMode: string }): Behaviour | null =>
  item.itemType === "Loanable" ? "BORROW" : item.itemType === "Consumable" ? (item.consumptionMode === "OPEN_UNIT" ? "GRADUAL" : "CONSUME") : item.itemType === "NEEDS_REVIEW" ? "REVIEW_LATER" : null;
/** One bulk edit changes at most this many items: it is one D1 batch, and a longer selection is sent in pieces. */
export const BULK_LIMIT = 50;
/** The category of a record captured before anyone knew its category. Shown as "Unsorted", never offered as a choice. */
export const UNSORTED_CATEGORY = "UNSORTED";
/** The unit of a record captured before anyone knew how it is counted. */
export const UNSORTED_UNIT = "piece";

/** A rough label for an open unit. Never an amount: it does not change stock. */
export const OPEN_UNIT_CONDITIONS = ["PLENTY", "HALF", "LOW"] as const;
/** Counting words of things usually opened and used a little at a time (units are stored singular). */
const OPEN_UNIT_WORDS = new Set(["ream", "box", "bottle", "jar", "roll", "pack", "can", "tub", "pouch", "container"]);

/**
 * A whole-unit Consumable that is probably opened and used gradually, judged only by its unit word.
 * It only suggests: nothing changes until staff choose "Open and use gradually" for the item.
 */
export function openUnitCandidate(item: { itemType: string; consumptionMode: string; status: string; unit: string }): boolean {
  return item.itemType === "Consumable" && item.consumptionMode !== "OPEN_UNIT" && item.status !== "INACTIVE" && OPEN_UNIT_WORDS.has(item.unit.trim().toLowerCase());
}
/** Why stock moved. Kept short and operational; "OTHER" always needs a note. A count is its own reason. */
export const MOVEMENT_REASONS = {
  IN: ["DELIVERY", "RETURNED", "DONATION", "OTHER"],
  OUT: ["CONSUMED", "ISSUED", "DAMAGED", "MISSING", "TRANSFERRED", "OTHER"]
} as const;
export const LOAN_PURPOSES = ["INDIVIDUAL", "USC"] as const;
/** How a loan ends. Only a good return puts the quantity back on the shelf. */
export const LOAN_OUTCOMES = ["RETURNED", "DAMAGED", "LOST"] as const;
export const OPEN_REORDER_STATUSES = new Set<string>(["NEEDS_RESTOCK", "PLANNED"]);

export const LABELS: Record<string, string> = {
  Inventory: "General stock",
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
  CONSUMED: "Taken or used",
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
  LOST: "Lost",
  WHOLE_UNIT: "Whole unit",
  OPEN_UNIT: "Open and use gradually",
  PLENTY: "Plenty",
  HALF: "Half-ish",
  LOW: "Low"
};

/** "1 piece", "3 pieces", "2 boxes": units are stored singular. */
export function units(count: number, unit: string): string {
  if (Math.abs(count) === 1 || /s$/i.test(unit)) return unit;
  return /(x|ch|sh)$/i.test(unit) ? `${unit}es` : `${unit}s`;
}

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
 * Loanable or Consumable, kept Active, and given an audience. Anything else fails closed.
 */
export function listingGaps(item: ListingCandidate): string[] {
  const gaps: string[] = [];
  if (!LISTABLE_ITEM_TYPES.has(item.itemType)) gaps.push("Set the type to Loanable or Consumable");
  if (!PUBLIC_LENDING_AUDIENCES.has(item.lendingAudience)) gaps.push("Choose who may use it");
  if (item.status !== "ACTIVE") gaps.push("Set the status to Active");
  if (!(item.needsReview === 0 || item.needsReview === false)) gaps.push("Mark the details reviewed");
  return gaps;
}

export function isListedForLending(item: ListingCandidate): boolean {
  return listingGaps(item).length === 0;
}

/* ---------- Self-service (phones, Part 4.5) ---------- */

export type SelfServiceCandidate = ListingCandidate & { consumptionMode?: string };
export type SelfServiceAction = "TAKE" | "BORROW" | "USE";

/**
 * What still blocks an item from phone self-service, in the words staff see. Fail closed:
 * the item type decides (a Consumable is taken, a Loanable borrowed); a Consumable must be
 * Active and reviewed, a Loanable must also be listed on the Lending Hub (so it has an audience).
 */
export function selfServiceGaps(item: SelfServiceCandidate): string[] {
  const gaps: string[] = [];
  if (item.itemType === PUBLIC_LENDING_ITEM_TYPE) gaps.push(...listingGaps(item));
  else if (item.itemType !== "Consumable") gaps.push("Set the type to Loanable or Consumable");
  else {
    if (item.status !== "ACTIVE") gaps.push("Set the status to Active");
    if (!(item.needsReview === 0 || item.needsReview === false)) gaps.push("Mark the details reviewed");
  }
  return gaps;
}

/**
 * The one self-service rule, decided by the item, never by the person: a Loanable is borrowed, a
 * whole-unit Consumable taken, an open-unit Consumable used (no amount, no stock change); anything else is not offered.
 */
export function selfServiceAction(item: SelfServiceCandidate): SelfServiceAction | null {
  if (selfServiceGaps(item).length) return null;
  if (item.itemType === PUBLIC_LENDING_ITEM_TYPE) return "BORROW";
  return item.consumptionMode === "OPEN_UNIT" ? "USE" : "TAKE";
}

/* ---------- Activity (Part 5) ---------- */

/** Where an Activity entry comes from, in the words staff see. ACCOUNT entries exist only for ADMIN and OWNER. */
export const ACTIVITY_SOURCES = { MOVEMENT: "Stock", LOAN: "Loans", PHONE: "Self-Service", CATALOG: "Catalog", ACCOUNT: "Accounts & exports", DIRECTORY: "Staff Directory" } as const;
export type ActivitySource = keyof typeof ACTIVITY_SOURCES;
/** Every Activity entry type and its title, grouped by the source it usually belongs to (a phone take is a stock-out movement). */
export const ACTIVITY_TYPES: Record<ActivitySource, Record<string, string>> = {
  MOVEMENT: {
    OPENING_BALANCE: "Opening balance", STOCK_IN: "Stock in", STOCK_OUT: "Stock out", COUNT_ADJUSTMENT: "Count", ISSUE: "Issued (legacy system)",
    UNIT_OPENED: "Unit opened", UNIT_USED: "Use recorded", UNIT_CONDITION: "Condition set", UNIT_EMPTIED: "Unit marked empty", UNIT_CORRECTED: "Open unit corrected",
    UNIT_RECONCILED: "Open units closed by a count"
  },
  LOAN: { LOAN_OUT: "Lent", LOAN_RETURN: "Returned", LOAN_DAMAGED: "Returned damaged", LOAN_LOST: "Reported lost", LOAN_CLOSED: "Loan closed", LOAN_REVIEWED: "Return reviewed" },
  PHONE: { PHONE_TAKE: "Phone take", PHONE_BORROW: "Phone borrow", PHONE_RETURN: "Phone return", PHONE_USE: "Phone use", REVIEW_RESOLVED: "Review resolved", IDENTITY_REVIEWED: "Identity reviewed" },
  CATALOG: { ITEM_CREATED: "Item added", ITEM_UPDATED: "Item edited", ITEM_PHOTO_ADDED: "Photo added", ITEM_PHOTO_REPLACED: "Photo replaced", ITEM_PHOTO_REMOVED: "Photo removed",
    ITEM_VISUAL_CHANGED: "Item visual changed", ITEM_LINKED: "Items linked", ITEM_UNLINKED: "Items unlinked",
    LOCATION_CREATED: "Place added", LOCATION_UPDATED: "Place edited", LOCATION_PHOTO_ADDED: "Place picture added", LOCATION_PHOTO_REPLACED: "Place picture replaced", LOCATION_PHOTO_REMOVED: "Place picture removed",
    LOCATION_DELETED: "Place deleted", LOCATION_ITEMS_MOVED: "Items moved to another place", LOCATIONS_RECONCILED: "Places made from item locations", LOCATION_REPORTED: "Location reported", LOCATION_REPORT_RESOLVED: "Location report resolved",
    CATALOGUE_STARTED: "Cataloguing started", CATALOGUE_FINISHED: "Cataloguing finished",
    AUDIT_STARTED: "Place check started", AUDIT_PAUSED: "Place check paused", AUDIT_RESUMED: "Place check resumed", AUDIT_FINISHED: "Place check finished", AUDIT_RESOLVED: "Check finding settled",
    KIT_CREATED: "Kit made", KIT_UPDATED: "Kit edited", KIT_CHECKED: "Kit checked", KIT_PHOTO_ADDED: "Kit picture added", KIT_PHOTO_REPLACED: "Kit picture replaced", KIT_PHOTO_REMOVED: "Kit picture removed",
    KIT_TEMPLATE_CREATED: "Kit template made", KIT_TEMPLATE_UPDATED: "Kit template edited",
    REORDER_OPENED: "Restock requested", REORDER_UPDATED: "Restock updated", REORDER_RESTOCKED: "Restocked" },
  ACCOUNT: {
    ACCOUNT_CREATED: "Account created", ACCOUNT_UPDATED: "Account updated", PASSWORD_RESET: "Password reset", PASSWORD_CHANGED: "Password changed", SESSIONS_REVOKED: "Sessions ended",
    RECOVERY_KEY_ROTATED: "Recovery key replaced", RECOVERY_KEY_REVOKED: "Recovery key revoked", OWNER_RECOVERY_USED: "Owner recovery used", OWNER_BOOTSTRAPPED: "First owner set up",
    ACTIVITY_EXPORTED: "Activity exported", SETTING_CHANGED: "Setting changed", RETENTION_ERASED: "Old personal details removed",
    CATALOGUE_OFFLINE_ON: "Offline cataloguing turned on", CATALOGUE_OFFLINE_OFF: "Offline cataloguing turned off"
  },
  DIRECTORY: {
    STAFF_PERSON_ADDED: "Person added", STAFF_PROFILE_UPDATED: "Profile edited", STAFF_ACCOUNT_LINKED: "Account linked", STAFF_ACCOUNT_UNLINKED: "Account unlinked",
    STAFF_ID_IMPORTED: "ID scans imported", STAFF_ID_ADDED: "ID scans added", STAFF_ID_REPLACED: "ID scans replaced", STAFF_ID_REMOVED: "ID scans removed", STAFF_ID_VIEWED: "USC ID viewed", STAFF_ID_DERIVED: "ID thumbnail and profile picture made"
  }
};
export const ACTIVITY_TITLES: Record<string, string> = Object.assign({}, ...Object.values(ACTIVITY_TYPES));

/** A student ID number as the office writes it: letters, digits and dashes. */
export const STUDENT_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,29}$/;

/**
 * A new Self-Service record names its person by exactly eight digits. Only the format is checked: the number is not
 * confirmed against any student source, though an exact match to a Staff Directory person links to that person.
 * Older records and staff-entered loans keep the wider pattern above, so no history is invalid.
 */
export const SELF_SERVICE_STUDENT_ID = /^\d{8}$/;
/** Records made before the identity rule are version 1 and are still accepted, then listed in Attention; version 2 is held to the rule. */
export const SELF_SERVICE_RECORD_VERSION = 2;
/** The settings row holding when this Hub first received a record under the identity rule: Attention never asks about anything earlier. */
export const IDENTITY_RULE_KEY = "identity_rule_from";

/**
 * Limits shared by the phone and the Worker, so the form never offers what the server refuses.
 * - Five events per sync keeps one request inside D1's per-invocation budget (about 25 round
 *   trips at worst).
 * - Past `unitsPerItemHour` self-service units of one item in an hour, further takes and borrows
 *   are held for staff; a network may leave at most `heldPerNetworkDay` held records a day. Both
 *   bound what an abusive client can do to the records.
 * - A phone photo is compressed to about 300 KB; 2 MB leaves room without letting four photos
 *   exceed the request cap.
 */
export const SELF_SERVICE_LIMITS = { quantity: 30, eventsPerSync: 5, photosPerSync: 4, unitsPerItemHour: 30, heldPerNetworkDay: 60, photoBytes: 2 * 1024 * 1024, photoEdge: 1280, photoQuality: 0.75 } as const;


const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/**
 * The short code people read aloud for a phone record, such as SS-7K4Q-9M2X. It is computed from the record's immutable id
 * (the first 40 random bits, in an alphabet without I, L, O or U), so the phone, the receipt and staff screens always agree
 * and nothing is stored. The id stays the key everywhere; the reference is only for people.
 */
export function selfServiceReference(eventId: string): string {
  let bits = Number.parseInt(eventId.replace(/-/g, "").slice(0, 10), 16);
  let code = "";
  for (let place = 0; place < 8; place += 1) {
    code = REFERENCE_ALPHABET[bits % 32]! + code;
    bits = Math.floor(bits / 32);
  }
  return `SS-${code.slice(0, 4)}-${code.slice(4)}`;
}

/** A reference as someone typed it, folded to the form it is stored in: case, spaces, dashes and the look-alike letters O, I and L. */
export const foldReference = (text: string): string => text.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

/**
 * Why a self-service event needs a person, in the words staff read. Everything else reconciles
 * automatically. A held event changed nothing yet: staff apply (or match) it, or dismiss it.
 */
export const REVIEW_REASONS = {
  RETURN_CHECK: "A return with a photo, waiting for staff to confirm the item is back before stock is updated",
  UNMATCHED_RETURN: "A return that could not be matched to one open loan",
  RETURN_CONFLICT: "A return that does not fit its loan (already closed differently, or a different quantity)",
  NOT_ELIGIBLE: "Recorded offline for an item that is no longer self-service",
  USC_ONLY: "An individual borrow of an item lent for USC use only",
  VOLUME: "More of this item was recorded in an hour than self-service allows",
  CLOCK: "The phone's clock was implausible, so the time cannot be trusted",
  COUNT_OVERLAP: "Happened within minutes of a physical count; the count may already include it",
  ERROR: "Could not be applied automatically",
  TEST: "A test made in Administration while Self-Service is closed; it changes nothing unless applied"
} as const;
export type ReviewReason = keyof typeof REVIEW_REASONS;
