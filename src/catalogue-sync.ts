import { type AuditDetail, type Detail, type Entry, type ObservationEntry, audits, drop, dropAudit, dropObservation, dropSession, entries, keep, keepAudit, keepObservation, keepSession, observations, sessions } from "./catalogue-store";
import { ApiError, api } from "./ui";

/*
 * Sends what this device catalogued (catalogue-store.ts), oldest first: a session started here without a connection (under the id
 * this device proposed, so a start whose answer was lost is never a second session), each capture and then its photo, and last a
 * finish made here; then the checks of a place made here (V1.7): a check started offline, what was seen in it, a pause or note, and
 * its finish. Every request is keyed, so a retry, or a save whose answer was lost, never changes anything twice. Only the
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
      const passes = async () => { do { again = false; await pass(); } while (again && sender && !ended); };
      // One sender per device: two tabs (or the installed app and a tab) never send the same capture at once.
      if (navigator.locks) await navigator.locks.request("logistics-hub-catalogue-sync", passes);
      else await passes();
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
  await sendChecks();
}

/** The next try: the soonest retry due, or a finish (or a check's pause or finish) still to tell the server. */
async function schedule(): Promise<void> {
  window.clearTimeout(timer);
  if (!sender || ended) return;
  const waiting = [...(await entries()).filter((entry) => sendable(entry) && entry.state === "waiting"),
    ...(await observations()).filter((entry) => entry.owner === sender!.owner && entry.state === "waiting")];
  const finishing = (await sessions()).some((record) => record.finishing && record.owner === sender!.owner)
    || (await audits()).some((record) => record.owner === sender!.owner && (record.finishing || record.pending !== null));
  const soon = Math.min(...waiting.map((entry) => retryAt.get(entry.id) ?? Date.now() + 2_000), finishing ? Date.now() + 15_000 : Infinity);
  if (Number.isFinite(soon)) timer = window.setTimeout(() => void syncNow(), Math.max(500, soon - Date.now()));
}

const settle = async (entry: Entry, change: Partial<Entry>) => { Object.assign(entry, change); await keep(entry); };
const transient = (error: ApiError) => error.status === 0 || error.status >= 500 || error.status === 429;
/** A request that has not answered in `ms` counts as a dropped connection, so one stalled request on a weak signal never stalls the rest. */
const within = (ms: number): RequestInit => typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(ms) } : {};
/** The next try for an entry: 2 s, doubling to 30 s. */
const backOff = (entry: { id: string }) => {
  const tries = attempts.get(entry.id) ?? 0;
  attempts.set(entry.id, tries + 1);
  retryAt.set(entry.id, Date.now() + Math.min(30_000, 2_000 * 2 ** tries));
};

/** A refusal: a person decides (or, for a dropped connection or a busy server, it waits and goes again by itself). */
async function failed(entry: Entry, error: unknown): Promise<void> {
  if (!(error instanceof ApiError)) throw error;
  if (error.status === 401) { ended = true; return; }
  if (transient(error)) {
    backOff(entry);
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

/**
 * Where the server keeps the entry's session, starting it there first if this device started it without a connection; null while it
 * must wait (below).
 */
async function serverSession(entry: Entry): Promise<string | null> {
  const record = (await sessions()).find((each) => each.id === entry.sessionId);
  if (!record) return entry.sessionId;
  if (record.serverId) return record.serverId;
  // A session finished here before this one started must be finished on the server first, or the start would find it still open
  // and file this session's captures under it. While one of its captures is still on its way (a retry pending), this one waits;
  // one that needs a person does not hold it up (this session then joins it, as one open session per person means anyway).
  await finishSessions();
  const held = await entries();
  const before = (await sessions()).some((other) => other.finishing && other.owner === record.owner && other.id !== record.id
    && held.some((each) => each.sessionId === other.id && each.state === "waiting"));
  if (before) return null;
  // The capture's own place: it is where the person was standing, and is a place the server can check.
  const started = await api<{ id: string }>("/api/staff/catalogue/sessions", { method: "POST", body: JSON.stringify({ id: record.id, locationId: entry.body.locationId }), ...within(20_000) });
  await keepSession({ ...record, serverId: started.id });
  return started.id;
}

/**
 * A 409 that is not about duplicates may mean the session was finished meanwhile (on another device). Then the capture is filed under
 * a new session: the next start proposes the finished one's id, and the server answers with the person's open or a new session.
 */
async function finishedElsewhere(entry: Entry, target: string): Promise<boolean> {
  const detail = await api<Detail>(`/api/staff/catalogue/sessions/${target}`, within(20_000)).catch(() => null);
  if (detail?.session.status !== "FINISHED") return false;
  const record = (await sessions()).find((each) => each.id === entry.sessionId);
  await keepSession({ ...(record ?? { id: entry.sessionId, owner: sender!.owner, detail, finishing: false }), serverId: null });
  return true;
}

async function send(entry: Entry): Promise<void> {
  if (!entry.itemId) {
    let target: string | undefined;
    try {
      target = await serverSession(entry) ?? undefined;
      if (!target) { retryAt.set(entry.id, Date.now() + 4_000); return; }
      const saved = await api<{ id: string }>(`/api/staff/catalogue/sessions/${target}/captures`, { method: "POST", body: JSON.stringify({ ...entry.body, acknowledged: acknowledged(entry) }), ...within(20_000) });
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
      await api(`/api/staff/items/${entry.itemId}/photo`, { method: "PUT", body: form, ...within(90_000) });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 401) { ended = true; return; }
      // A first photo is refused with 409 only when the item has one already: a repeat of an upload whose answer was lost.
      if (error.status !== 409) {
        if (transient(error)) {
          backOff(entry);
          await settle(entry, { state: "waiting", message: "Saved. The photo has not gone up yet; trying again." });
        } else await settle(entry, { state: "stopped", message: `Saved, but the photo was not: ${error.message}` });
        return;
      }
    }
  }
  await drop(entry.id);
}

/**
 * Tells the server about sessions finished on this device, once everything captured in them has been sent (or discarded), and forgets
 * a session the server finished elsewhere once nothing here refers to it.
 */
async function finishSessions(): Promise<void> {
  const waiting = await entries();
  for (const record of await sessions()) {
    if (record.owner !== sender?.owner || waiting.some((entry) => entry.sessionId === record.id)) continue;
    if (!record.finishing) {
      if (record.detail.session.status !== "ACTIVE") await dropSession(record.id);
      continue;
    }
    // Never started on the server: nothing was saved in it, so there is nothing to finish.
    if (record.serverId) {
      try {
        await api(`/api/staff/catalogue/sessions/${record.serverId}/finish`, { method: "POST", ...within(20_000) });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 401) { ended = true; return; }
        if (transient(error)) continue;
      }
    }
    await dropSession(record.id);
  }
}

/**
 * Sends this member's checks of a place (V1.7), each in order: a start made offline (under the id this device proposed), then what was
 * seen, oldest first, then a pause or a note about the place, then a finish once nothing in it waits. Within a check, sending stops at the
 * first observation that must wait, so a second look at an item never arrives before the first (the server keeps the latest).
 */
async function sendChecks(): Promise<void> {
  for (const record of await audits()) {
    if (!sender || ended || record.owner !== sender.owner) continue;
    const held = (await observations()).filter((entry) => entry.auditId === record.id && entry.owner === sender!.owner);
    if (!held.length && !record.pending && !record.finishing) continue;
    try {
      if (!record.serverId) {
        const started = await api<{ id: string }>("/api/staff/audits", { method: "POST", body: JSON.stringify({ id: record.id, locationId: record.detail.audit.locationId }), ...within(20_000) });
        record.serverId = started.id;
        await keepAudit(record);
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 401) { ended = true; return; }
      if (transient(error)) continue;
      // Someone else is checking this place now: what was seen here waits for a person to decide.
      for (const entry of held) if (entry.state === "waiting") await keepObservation({ ...entry, state: "stopped", message: error.message });
      changed();
      continue;
    }
    let blocked = false;
    for (const entry of held) {
      if (entry.state !== "waiting") continue;
      if ((retryAt.get(entry.id) ?? 0) > Date.now()) { blocked = true; break; }
      try {
        await api(`/api/staff/audits/${record.serverId}/observations`, { method: "POST", body: JSON.stringify({ id: entry.id, ...entry.body }), ...within(20_000) });
        attempts.delete(entry.id);
        retryAt.delete(entry.id);
        await dropObservation(entry.id);
        changed();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 401) { ended = true; return; }
        if (transient(error)) { backOff(entry); await keepObservation({ ...entry, message: "It will be sent when the connection is back." }); blocked = true; break; }
        await keepObservation({ ...entry, state: "stopped", message: error.message });
        changed();
      }
    }
    if (blocked || (await observations()).some((entry) => entry.auditId === record.id && entry.state === "waiting")) continue;
    try {
      if (record.pending) {
        await api(`/api/staff/audits/${record.serverId}`, { method: "PATCH", body: JSON.stringify(record.pending), ...within(20_000) });
        record.pending = null;
        await keepAudit(record);
      }
      if (record.finishing) {
        await api(`/api/staff/audits/${record.serverId}/finish`, { method: "POST", ...within(20_000) });
        // The server has it all now: its summary is the record. What was stopped stays until a person looks.
        if (!(await observations()).some((entry) => entry.auditId === record.id)) await dropAudit(record.id);
        else await keepAudit({ ...record, finishing: false, detail: { ...record.detail, audit: { ...record.detail.audit, status: "FINISHED" } } });
      }
      changed();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 401) { ended = true; return; }
      // A finished check refuses a pause: it was finished elsewhere, and its pause no longer matters.
      if (error.status === 409 && record.pending) { record.pending = null; await keepAudit(record); }
    }
  }
}

/** What this device saw in a check and has not sent yet, laid over what the server last said: the device's view of the check. */
export function withHeld(detail: AuditDetail, held: ObservationEntry[]): AuditDetail {
  for (const entry of held) {
    const seen = { id: entry.id, outcome: entry.body.outcome, counted: entry.body.counted ?? null, note: entry.body.note ?? null };
    const item = detail.items.find((each) => each.id === entry.body.itemId);
    if (item) item.observation = seen;
    else if (!detail.extras.some((extra) => extra.id === entry.id)) detail.extras.push({ ...seen, itemId: entry.body.itemId ?? null, name: entry.body.itemId ? detail.extras.find((extra) => extra.itemId === entry.body.itemId)?.name ?? null : entry.body.note ?? null });
  }
  detail.checked = detail.items.filter((each) => each.observation).length;
  return detail;
}

/** The check as the server has it now (with what this device has not sent yet), kept on the device so it reopens offline; null without a connection. */
export async function refreshCheck(id: string, owner: string): Promise<AuditDetail | null> {
  const record = (await audits()).find((each) => each.id === id || each.serverId === id);
  try {
    const answer = await api<AuditDetail>(`/api/staff/audits/${record?.serverId ?? id}`, within(20_000));
    const detail = record ? withHeld(answer, (await observations()).filter((entry) => entry.auditId === record.id)) : answer;
    if (detail.audit.mine && detail.audit.status !== "FINISHED") await keepAudit({ id: record?.id ?? id, owner, serverId: detail.audit.id, pending: record?.pending ?? null, finishing: record?.finishing ?? false, detail });
    else if (record && !record.finishing && detail.audit.status === "FINISHED" && !(await observations()).some((entry) => entry.auditId === record.id)) await dropAudit(record.id);
    return detail;
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) return null;
    throw error;
  }
}

