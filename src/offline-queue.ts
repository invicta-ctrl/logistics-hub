import { SELF_SERVICE_LIMITS, type SelfServiceAction } from "./catalog-policy";

/*
 * The phone's queue rules, with no storage, network or DOM, so they are easy to test and are
 * shared by the page and the service worker. The sync engine (offline-sync.ts) moves events;
 * these functions decide what to send and what a server answer means.
 */

/** One item as the phone's catalog snapshot holds it (the Worker's self-service DTO). */
export type CatalogItem = {
  id: string; name: string; aliases: string | null; category: string; unit: string;
  action: SelfServiceAction; available: number; location: string | null; audience: string | null;
  /** The item's photo id, if it has one (absent in a snapshot saved before photos were public). */
  photo?: string | null;
  /** Its place, when staff share it with Self-Service (absent in a snapshot saved before places); `location` is that place's full path. */
  locationId?: string | null;
};
/** A place staff share with Self-Service: only its name, directions and picture ever reach a phone. */
export type SharedPlace = { id: string; name: string; parentId: string | null; directions: string | null; photo: { id: string; width: number; height: number } | null };
export type Snapshot = { revision: number; items: CatalogItem[]; places?: SharedPlace[]; fetchedAt: number; checkedAt: number };

export type EventType = "TAKE" | "BORROW" | "USE" | "RETURN";
export type Outcome = "RETURNED" | "DAMAGED" | "LOST";

/** What the phone sends. Immutable once saved: a retry sends exactly the same record. */
export type WireEvent = {
  v: 1; id: string; seq: number; type: EventType; itemId: string; quantity: number; occurredAt: string; catalogRevision: number | null;
  person: { name: string; studentId?: string };
  purpose?: "INDIVIDUAL" | "USC"; reason?: string; returnBy?: string | null;
  loanEventId?: string | null; outcome?: Outcome; note?: string;
  /** Made in the Administration test panel: the server always holds it for staff. */
  test?: true;
};

/**
 * pending: saved on this phone, not yet acknowledged. synced: recorded. review: recorded or
 * held, and staff will check. rejected: not recorded (the message says why).
 */
export type LocalState = "pending" | "synced" | "review" | "rejected";

export type LocalEvent = WireEvent & {
  state: LocalState; message?: string; attempts: number; nextAttemptAt: number;
  /** The catalog revision the server reported after recording it; a snapshot at or past it already includes it. */
  appliedRevision?: number; settledAt?: number; hasPhoto: boolean;
  /** Kept for My activity even if the item later leaves the catalog. */
  itemName: string; unit: string;
};

export type ServerResult = { id: string; outcome: "accepted" | "review" | "rejected" | "retry"; message?: string; duplicate?: boolean };

const MINUTE = 60_000;
const WIRE_KEYS = ["v", "id", "seq", "type", "itemId", "quantity", "occurredAt", "catalogRevision", "person", "purpose", "reason", "returnBy", "loanEventId", "outcome", "note", "test"] as const;
/** Synced history kept on the phone. Open loans stay until they are returned. */
export const RETENTION_MS = 30 * 24 * 60 * MINUTE;

export function toWire(event: LocalEvent): WireEvent {
  return Object.fromEntries(WIRE_KEYS.filter((key) => event[key] !== undefined).map((key) => [key, event[key]])) as WireEvent;
}

/** Waits 5 s, 10 s, 20 s … up to 15 minutes between automatic attempts. */
export const backoff = (attempts: number): number => Math.min(15 * MINUTE, 5_000 * 2 ** Math.max(0, attempts - 1));

const waiting = (event: LocalEvent) => event.state === "pending";

/**
 * The next request: the earliest pending events in the phone's own order, at most five and at
 * most four photos. The order is never skipped, so a return always follows its borrow; when the
 * first one is backing off, the rest wait with it unless the person pressed "Sync now".
 */
export function nextBatch(events: LocalEvent[], now: number, force = false): LocalEvent[] {
  const pending = events.filter(waiting).sort((a, b) => a.seq - b.seq);
  if (!pending.length || (!force && pending[0]!.nextAttemptAt > now)) return [];
  const batch: LocalEvent[] = [];
  let photos = 0;
  for (const event of pending) {
    if (batch.length === SELF_SERVICE_LIMITS.eventsPerSync) break;
    if (event.hasPhoto && photos === SELF_SERVICE_LIMITS.photosPerSync) break;
    photos += event.hasPhoto ? 1 : 0;
    batch.push(event);
  }
  return batch;
}

/**
 * Applies the server's answers. Anything but `retry` is final and its photo can go. A borrow that
 * was not recorded takes its not-yet-sent return with it, so that return is never sent.
 */
export function applyResults(events: LocalEvent[], results: ServerResult[], revision: number, now: number): LocalEvent[] {
  const answers = new Map(results.map((result) => [result.id, result]));
  const updated = events.map((event): LocalEvent => {
    const result = answers.get(event.id);
    if (!result || event.state !== "pending") return event;
    if (result.outcome === "retry") return { ...event, attempts: event.attempts + 1, nextAttemptAt: now + backoff(event.attempts + 1), message: result.message };
    const state: LocalState = result.outcome === "accepted" ? "synced" : result.outcome;
    return { ...event, state, message: result.message, appliedRevision: state === "rejected" ? undefined : revision, settledAt: now };
  });
  const lostBorrows = new Set(updated.filter((event) => event.type === "BORROW" && event.state === "rejected").map((event) => event.id));
  return updated.map((event) => event.state === "pending" && event.loanEventId && lostBorrows.has(event.loanEventId)
    ? { ...event, state: "rejected", message: "The borrow was not recorded, so this return was not sent.", settledAt: now }
    : event);
}

export type Decision = { id: string; outcome: "accepted" | "dismissed" };

/** Settles records staff have decided: accepted ones are recorded, dismissed ones are not. Returns only the changed records. */
export function applyDecisions(events: LocalEvent[], decisions: Decision[], now: number): LocalEvent[] {
  const decided = new Map(decisions.map((decision) => [decision.id, decision.outcome]));
  return events.filter((event) => event.state === "review" && decided.has(event.id)).map((event) => decided.get(event.id) === "accepted"
    ? { ...event, state: "synced", message: "Accepted by Logistics staff.", settledAt: now }
    : { ...event, state: "rejected", message: "Logistics staff did not accept it.", appliedRevision: undefined, settledAt: now });
}

/** Marks a whole request for another try (offline, rate-limited or a server error). */
export function retryAll(events: LocalEvent[], ids: Set<string>, now: number, message?: string): LocalEvent[] {
  return events.map((event) => ids.has(event.id) && event.state === "pending"
    ? { ...event, attempts: event.attempts + 1, nextAttemptAt: now + backoff(event.attempts + 1), message }
    : event);
}

/** True when this phone's snapshot already includes the event, or the event never counted. */
function reflected(event: LocalEvent, snapshot: Snapshot): boolean {
  if (event.state === "rejected") return true;
  return event.state !== "pending" && event.appliedRevision !== undefined && event.appliedRevision <= snapshot.revision;
}

/**
 * Estimated available now: the last server snapshot minus this phone's takes and borrows it
 * does not include yet, plus this phone's good returns (a use changes nothing). Other phones' offline activity cannot
 * be known, so the screen always calls this an estimate.
 */
export function estimate(snapshot: Snapshot, events: LocalEvent[]): Map<string, number> {
  const available = new Map(snapshot.items.map((item) => [item.id, item.available]));
  for (const event of events) {
    if (reflected(event, snapshot) || !available.has(event.itemId)) continue;
    const change = event.type === "RETURN" ? (event.outcome === "RETURNED" ? event.quantity : 0) : event.type === "USE" ? 0 : -event.quantity;
    available.set(event.itemId, available.get(event.itemId)! + change);
  }
  for (const [id, count] of available) if (count < 0) available.set(id, 0);
  return available;
}

/** How many of each item this phone has recorded but not synced (for "Includes your 1 pending"). */
export function pendingByItem(events: LocalEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) if (event.state === "pending") counts.set(event.itemId, (counts.get(event.itemId) ?? 0) + 1);
  return counts;
}

/** Borrows made on this phone that no return from this phone has closed yet. */
export function openLoans(events: LocalEvent[]): LocalEvent[] {
  const returned = new Set(events.filter((event) => event.type === "RETURN" && event.state !== "rejected" && event.loanEventId).map((event) => event.loanEventId));
  return events.filter((event) => event.type === "BORROW" && event.state !== "rejected" && !returned.has(event.id)).sort((a, b) => b.seq - a.seq);
}

export type Summary = { pending: number; review: number; rejected: number };

export function summary(events: LocalEvent[]): Summary {
  const count = (state: LocalState) => events.filter((event) => event.state === state).length;
  return { pending: count("pending"), review: count("review"), rejected: count("rejected") };
}

/**
 * History the phone may forget: settled records older than the retention period, or all settled
 * ones when the person clears it. Pending records and open loans are never forgotten.
 */
export function forgettable(events: LocalEvent[], now: number, everything = false): string[] {
  const open = new Set(openLoans(events).map((event) => event.id));
  return events.filter((event) => event.state !== "pending" && !open.has(event.id) && (everything || now - (event.settledAt ?? now) > RETENTION_MS)).map((event) => event.id);
}
