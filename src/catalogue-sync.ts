import { type Detail, type Entry, drop, dropSession, entries, keep, keepSession, sessions } from "./catalogue-store";
import { ApiError, api } from "./ui";

/*
 * Sends what this device catalogued (catalogue-store.ts), oldest first: a session started here without a connection (under the id
 * this device proposed, so a start whose answer was lost is never a second session), each capture and then its photo, and last a
 * finish made here. Every request is keyed, so a retry, or a save whose answer was lost, never changes anything twice. Only the
 * account that captured something sends it: a device two members share never files one member's work under the other.
 * Nothing is the record until the server has answered; until then the screens show it as waiting.
 */

/** Whose work is sent. A full sign-in (`legacy`) also sends what a V1.5 page left without an owner. */
export type Sender = { owner: string; legacy: boolean };

const events = new EventTarget();
let sender: Sender | null = null;
let running: Promise<void> | null = null;
let again = false;
let timer = 0;
let listening = false;
/** The server answered 401: neither a sign-in nor this device's offline access is valid any more, so nothing more is sent. */
let ended = false;
const retryAt = new Map<string, number>();
const attempts = new Map<string, number>();
/** The item each capture sent from this page became, by request id: a capture taken afterwards can still name it ("a different one"). */
const savedAs = new Map<string, string>();
export const savedItem = (requestId: string): string | null => savedAs.get(requestId) ?? null;

/** Something was sent, refused or held: the screens redraw. */
export const onSyncChange = (listener: () => void): (() => void) => {
  events.addEventListener("change", listener);
  return () => events.removeEventListener("change", listener);
};
const changed = () => events.dispatchEvent(new Event("change"));
export const signedOut = (): boolean => ended;
export const sendable = (entry: Entry): boolean => Boolean(sender) && (entry.owner === sender!.owner || (!entry.owner && sender!.legacy));

/** Starts sending `next`'s work, now and whenever the connection comes back or the app is opened again. */
export function startSending(next: Sender): void {
  sender = next;
  ended = false;
  retryAt.clear();
  if (!listening) {
    listening = true;
    const resume = () => { if (document.visibilityState === "visible") { retryAt.clear(); void syncNow(); } };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
  }
  void syncNow();
}

/** Sends whatever may be sent now. A call while sending runs another pass once this one ends, and resolves after it. */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await pass(); } while (again && sender && !ended);
    } finally {
      running = null;
      await schedule();
      changed();
    }
  })();
  return running;
}

async function pass(): Promise<void> {
  for (;;) {
    if (!sender || ended) return;
    const next = (await entries()).find((entry) => sendable(entry) && entry.state === "waiting" && (retryAt.get(entry.id) ?? 0) <= Date.now());
    if (!next) break;
    retryAt.delete(next.id);
    await send(next);
    changed();
  }
  await finishSessions();
}

/** The next try: the soonest retry due, or a finish still to tell the server. */
async function schedule(): Promise<void> {
  window.clearTimeout(timer);
  if (!sender || ended) return;
  const waiting = (await entries()).filter((entry) => sendable(entry) && entry.state === "waiting");
  const finishing = (await sessions()).some((record) => record.finishing && record.owner === sender!.owner);
  const soon = Math.min(...waiting.map((entry) => retryAt.get(entry.id) ?? Date.now() + 2_000), finishing ? Date.now() + 15_000 : Infinity);
  if (Number.isFinite(soon)) timer = window.setTimeout(() => void syncNow(), Math.max(500, soon - Date.now()));
}

const settle = async (entry: Entry, change: Partial<Entry>) => { Object.assign(entry, change); await keep(entry); };
const transient = (error: ApiError) => error.status === 0 || error.status >= 500 || error.status === 429;

/** A refusal: a person decides (or, for a dropped connection or a busy server, it waits and goes again by itself). */
async function failed(entry: Entry, error: unknown): Promise<void> {
  if (!(error instanceof ApiError)) throw error;
  if (error.status === 401) { ended = true; return; }
  if (transient(error)) {
    const tries = attempts.get(entry.id) ?? 0;
    attempts.set(entry.id, tries + 1);
    retryAt.set(entry.id, Date.now() + Math.min(30_000, 2_000 * 2 ** tries));
    await settle(entry, { state: "waiting", message: error.status === 0 ? "It will be sent when the connection is back." : "The server is busy; it will be sent shortly." });
    return;
  }
  const found = error.status === 409 && Array.isArray(error.body.duplicates) ? error.body.duplicates as Entry["matches"] : null;
  await settle(entry, { state: "stopped", message: found ? "This may already be in the catalog." : error.message, matches: found });
}

/** The possible matches the person saw and saved past: item ids, including captures taken just before this one that have items now. */
const acknowledged = (entry: Entry): string[] => [...new Set([
  ...((entry.body.acknowledged as string[] | undefined) ?? []),
  ...entry.after.map((id) => id.startsWith("ITM-") ? id : savedAs.get(id)).filter((id): id is string => Boolean(id))
])];

/** Where the server keeps the entry's session, starting it there first if this device started it without a connection. */
async function serverSession(entry: Entry): Promise<string> {
  const record = (await sessions()).find((each) => each.id === entry.sessionId);
  if (!record) return entry.sessionId;
  if (record.serverId) return record.serverId;
  // A session finished here before this one was started must be finished on the server first, or the start would find it still
  // open and file this session's captures under it. Captures go oldest first, so everything in it has been sent by now.
  await finishSessions();
  // The capture's own place: it is where the person was standing, and is a place the server can check.
  const started = await api<{ id: string }>("/api/staff/catalogue/sessions", { method: "POST", body: JSON.stringify({ id: record.id, locationId: entry.body.locationId }) });
  await keepSession({ ...record, serverId: started.id });
  return started.id;
}

/**
 * A 409 that is not about duplicates may mean the session was finished meanwhile (on another device). Then the capture is filed under
 * a new session: the next start proposes the finished one's id, and the server answers with the person's open or a new session.
 */
async function finishedElsewhere(entry: Entry, target: string): Promise<boolean> {
  const detail = await api<Detail>(`/api/staff/catalogue/sessions/${target}`).catch(() => null);
  if (detail?.session.status !== "FINISHED") return false;
  const record = (await sessions()).find((each) => each.id === entry.sessionId);
  await keepSession({ ...(record ?? { id: entry.sessionId, owner: sender!.owner, detail, finishing: false }), serverId: null });
  return true;
}

async function send(entry: Entry): Promise<void> {
  if (!entry.itemId) {
    let target: string | undefined;
    try {
      target = await serverSession(entry);
      const saved = await api<{ id: string }>(`/api/staff/catalogue/sessions/${target}/captures`, { method: "POST", body: JSON.stringify({ ...entry.body, acknowledged: acknowledged(entry) }) });
      attempts.delete(entry.id);
      savedAs.set(entry.id, saved.id);
      await settle(entry, { itemId: saved.id, state: "waiting", message: null, matches: null });
      // Captures checked against this one ("a different one") now name its item, even after a reload.
      for (const other of await entries()) if (other.after.includes(entry.id)) await settle(other, { after: other.after.map((id) => id === entry.id ? saved.id : id) });
    } catch (error) {
      if (target && error instanceof ApiError && error.status === 409 && !Array.isArray(error.body.duplicates) && await finishedElsewhere(entry, target)) return;
      return failed(entry, error);
    }
  }
  if (entry.photo && entry.itemId) {
    const form = new FormData();
    form.set("display", entry.photo.display, "display.jpg");
    form.set("thumb", entry.photo.thumb, "thumb.jpg");
    form.set("expected", "");
    form.set("hash", entry.photo.hash);
    try {
      await api(`/api/staff/items/${entry.itemId}/photo`, { method: "PUT", body: form });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 401) { ended = true; return; }
      // A first photo is refused with 409 only when the item has one already: a repeat of an upload whose answer was lost.
      if (error.status !== 409) {
        if (transient(error)) {
          retryAt.set(entry.id, Date.now() + 4_000);
          await settle(entry, { state: "waiting", message: "Saved. The photo has not gone up yet; trying again." });
        } else await settle(entry, { state: "stopped", message: `Saved, but the photo was not: ${error.message}` });
        return;
      }
    }
  }
  await drop(entry.id);
}

/** Tells the server about sessions finished on this device, once everything captured in them has been sent (or discarded). */
async function finishSessions(): Promise<void> {
  const waiting = await entries();
  for (const record of await sessions()) {
    if (!record.finishing || record.owner !== sender?.owner || waiting.some((entry) => entry.sessionId === record.id)) continue;
    // Never started on the server: nothing was saved in it, so there is nothing to finish.
    if (record.serverId) {
      try {
        await api(`/api/staff/catalogue/sessions/${record.serverId}/finish`, { method: "POST" });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 401) { ended = true; return; }
        if (transient(error)) continue;
      }
    }
    await dropSession(record.id);
  }
}
