/*
 * What each Administration setting does, in one place (V1.13), so the switch, its confirmation and the record of the change say the
 * same thing. Where a setting's value lives is stated too: one place each, never repeated in an environment variable or the page.
 */

export const SELF_SERVICE_COPY = {
  label: "Self-Service on phones",
  /** Where the value lives (src/settings.ts). A missing value reads as closed. */
  source: "Stored in the database as the system setting “self_service”. Only this switch changes it, and every change is recorded in Accountability.",
  open: {
    state: "Open",
    effect: "People can take, borrow, use and return with their own phones."
  },
  closed: {
    state: "Closed for maintenance",
    effect: "Phones show the maintenance screen and record nothing, and people are sent to DOL staff in person. Records already waiting on a phone are kept and sent once it reopens."
  }
} as const;

/** What phones ask for before they record anything (the rules are enforced in src/self-service.ts and src/loans.ts). */
export const SELF_SERVICE_RULES: ReadonlyArray<{ action: string; asks: string }> = [
  { action: "Take, Use", asks: "A name. No photo." },
  { action: "Borrow, individual use", asks: "Full name, student ID number and a photo taken on the phone." },
  { action: "Borrow, USC use", asks: "The user’s name, a specific reason and a photo. The student ID is optional." },
  { action: "Return", asks: "A photo, and whether it came back good, damaged or lost. Staff check the photo before stock changes." }
];
