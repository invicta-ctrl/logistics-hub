/*
 * What each Administration setting does, in one place (V1.13), so the switch, its confirmation and the record of the change say the
 * same thing. A setting's value lives in one place, never repeated in an environment variable or the page.
 */

export const SELF_SERVICE_COPY = {
  label: "Self-Service on phones",
  /** Who changes it. The value lives in `system_settings` (src/settings.ts); a missing value reads as closed. */
  source: "Only this switch changes it, and every change is recorded in Accountability.",
  open: {
    state: "Open",
    effect: "People can take, borrow, use and return with their own phones."
  },
  closed: {
    state: "Closed for maintenance",
    effect: "Phones show the maintenance screen and record nothing, and people are sent to DoL staff in person. Records already waiting on a phone are kept and sent once it reopens."
  }
} as const;

/** What phones ask for before they record anything (the rules are enforced in src/self-service.ts and src/loans.ts). */
export const SELF_SERVICE_RULES: ReadonlyArray<{ action: string; asks: string }> = [
  { action: "Take, use, borrow, return", asks: "Full name, an 8-digit student ID number and a photo taken on the phone." },
  { action: "Borrow for USC use", asks: "Also a specific reason." },
  { action: "Return", asks: "Also whether it came back good, damaged or lost. Staff check the photo before stock changes." }
];
