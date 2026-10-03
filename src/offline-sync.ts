import { type CatalogItem, type Decision, type SharedPlace, type LocalEvent, type ServerResult, type WireEvent, applyDecisions, applyResults, forgettable, nextBatch, retryAll, toWire } from "./offline-queue";
import * as store from "./offline-store";

/*
 * The sync engine. Records a new action locally first (it is safe the moment it is saved), then
 * sends pending actions in the phone's own order and applies the server's answers. It has no DOM,
 * so the service worker runs the same code for Background Sync. The server is idempotent, so a
 * repeated or overlapping send can never double-count.
 */

export type SyncMessage = { type: "syncing"; count: number } | { type: "changed" } | { type: "catalog" };
export type SyncReport = { offline: boolean; skipped?: boolean };

const CHANNEL = "logistics-hub";
/**
 * A request that neither answers nor fails (a dropped connection on campus Wi-Fi) must not stall
 * the queue: it is abandoned after this long and counts as offline.
 */
const deadline = (ms: number) => typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
let channel: BroadcastChannel | null = null;
/** Set in the Administration test panel: requests ask to pass a closed Self-Service, and new records are tests. */
let testing = false;
const testHeaders = (): Record<string, string> => testing ? { "x-self-service-test": "1" } : {};

export function startTesting(): void {
  testing = true;
}

/**
 * Tells every open page (including this one) that local data changed. A BroadcastChannel
 * reaches every other channel object of the same name, in this page and in other tabs and the
 * service worker, so each listener hears a message exactly once.
 */
function announce(message: SyncMessage): void {
  channel ??= new BroadcastChannel(CHANNEL);
  channel.postMessage(message);
}

export function onSyncMessage(listener: (message: SyncMessage) => void): () => void {
  const channelForListener = new BroadcastChannel(CHANNEL);
  channelForListener.onmessage = (event: MessageEvent<SyncMessage>) => listener(event.data);
  return () => channelForListener.close();
}

/**
 * Brings the catalog snapshot up to date. The ETag is the catalog revision, so an unchanged
 * catalog costs one tiny 304 and nothing is rewritten.
 */
export async function refreshCatalog(): Promise<"updated" | "unchanged" | "offline" | "paused"> {
  const current = await store.catalog();
  let response: Response;
  try {
    response = await fetch("/api/self-service/catalog", { headers: { ...testHeaders(), ...current ? { "if-none-match": `"r${current.revision}"` } : {} }, signal: deadline(15_000) });
  } catch {
    return "offline";
  }
  const now = Date.now();
  if (response.status === 304 && current) {
    await store.putCatalog({ ...current, checkedAt: now });
    return "unchanged";
  }
  if (!response.ok) {
    // The office has closed Self-Service (worker.ts); any other failure is treated as no connection.
    const closed = response.status === 503 && (await response.json().catch(() => null) as { maintenance?: boolean } | null)?.maintenance === true;
    return closed ? "paused" : "offline";
  }
  const body = await response.json() as { revision: number; items: CatalogItem[]; places?: SharedPlace[] };
  await store.putCatalog({ revision: body.revision, items: body.items, places: body.places ?? [], fetchedAt: now, checkedAt: now });
  announce({ type: "catalog" });
  return "updated";
}

export type Draft = Omit<WireEvent, "v" | "id" | "seq" | "occurredAt" | "catalogRevision"> & { itemName: string; unit: string };

/**
 * Records an action on this phone. It is durable as soon as this resolves, with or without a
 * connection; sending happens afterwards.
 */
export async function record(draft: Draft, photo?: Blob): Promise<LocalEvent> {
  const [snapshot, bytes] = await Promise.all([store.catalog(), photo?.arrayBuffer()]);
  const id = crypto.randomUUID();
  const occurredAt = new Date().toISOString();
  const saved = await store.saveEvent((seq) => ({
    ...draft, v: 1, id, seq, occurredAt, catalogRevision: snapshot?.revision ?? null, ...testing ? { test: true as const } : {},
    state: "pending", attempts: 0, nextAttemptAt: 0, hasPhoto: Boolean(photo)
  }), photo && bytes ? { type: photo.type || "image/jpeg", bytes } : undefined);
  announce({ type: "changed" });
  return saved;
}

/** Asks what staff decided about records waiting for them, and settles the ones they have decided. */
export async function checkDecisions(): Promise<void> {
  const waiting = (await store.events()).filter((event) => event.state === "review").slice(0, 50);
  if (!waiting.length) return;
  const response = await fetch(`/api/self-service/decisions?ids=${waiting.map((event) => event.id).join(",")}`, { headers: testHeaders(), signal: deadline(15_000) }).catch(() => null);
  if (!response?.ok) return;
  const { results } = await response.json() as { results: Decision[] };
  const settled = applyDecisions(waiting, results, Date.now());
  if (!settled.length) return;
  await store.putEvents(settled);
  announce({ type: "changed" });
}

let running: Promise<SyncReport> | null = null;

/**
 * Sends everything that is due. One sync runs at a time in this context, and a Web Lock keeps
 * the page and the service worker from sending at the same moment. `force` ignores backoff
 * (the "Sync now" button).
 */
export function syncNow(force = false): Promise<SyncReport> {
  running ??= exclusive(() => drain(force)).finally(() => { running = null; });
  return running;
}

async function exclusive(work: () => Promise<SyncReport>): Promise<SyncReport> {
  const locks = "locks" in navigator ? navigator.locks : null;
  if (!locks) return work();
  return locks.request("logistics-hub-sync", { ifAvailable: true }, (lock) => lock ? work() : { offline: false, skipped: true });
}

async function drain(force: boolean): Promise<SyncReport> {
  const deviceId = await store.deviceId();
  let recorded = false;
  let offline = false;
  // Bounded, so a server that keeps answering can never keep a phone busy forever.
  for (let round = 0; round < 50; round += 1) {
    const before = await store.events();
    const batch = nextBatch(before, Date.now(), force);
    if (!batch.length) break;
    announce({ type: "syncing", count: before.filter((event) => event.state === "pending").length });
    const ids = new Set(batch.map((event) => event.id));
    const form = new FormData();
    form.set("batch", JSON.stringify({ deviceId, sentAt: new Date().toISOString(), events: batch.map(toWire) }));
    for (const event of batch) {
      const stored = event.hasPhoto ? await store.photo(event.id) : undefined;
      if (stored) form.set(`photo:${event.id}`, new Blob([stored.bytes], { type: stored.type }), "photo.jpg");
    }
    let response: Response | null = null;
    try {
      response = await fetch("/api/self-service/sync", { method: "POST", body: form, headers: testHeaders(), credentials: "same-origin", signal: deadline(45_000) });
    } catch {
      offline = true;
    }
    if (!response?.ok) {
      // Offline, busy (429) or a server error: everything stays on the phone for the next try.
      const message = response?.status === 429 ? "Waiting: the server is busy." : response ? "Waiting to try again." : undefined;
      await store.putEvents(retryAll(before, ids, Date.now(), message).filter((event, index) => event !== before[index]));
      announce({ type: "changed" });
      break;
    }
    const body = await response.json() as { revision: number; results: ServerResult[] };
    const after = applyResults(before, body.results, body.revision, Date.now());
    await store.putEvents(after.filter((event, index) => event !== before[index]));
    // A photo stays only until the server has answered for its borrow.
    await store.deletePhotos(after.filter((event) => ids.has(event.id) && event.state !== "pending").map((event) => event.id));
    recorded ||= body.results.some((result) => result.outcome === "accepted" || result.outcome === "review");
    announce({ type: "changed" });
    if (body.results.some((result) => result.outcome === "retry")) break;
  }
  if (recorded) await refreshCatalog();
  const old = forgettable(await store.events(), Date.now());
  if (old.length) await store.deleteEvents(old);
  return { offline };
}

/** When the next automatic attempt is due, if anything is waiting. */
export async function nextAttemptAt(): Promise<number | null> {
  const pending = (await store.events()).filter((event) => event.state === "pending");
  return pending.length ? Math.min(...pending.map((event) => event.nextAttemptAt)) : null;
}

/** Removes settled history from this phone. Pending records and open loans always stay. */
export async function clearHistory(): Promise<number> {
  const ids = forgettable(await store.events(), Date.now(), true);
  await store.deleteEvents(ids);
  announce({ type: "changed" });
  return ids.length;
}
