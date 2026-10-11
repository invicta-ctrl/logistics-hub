import type { Place } from "./location-tree";
import type { PhotoCleanup, PhotoCrop } from "./catalog-draft";

/*
 * What this device holds for cataloguing, in IndexedDB. No DOM: the service worker reads it too.
 *   captures  each capture taken here that the server has not fully confirmed (V1.5): written before any request and removed only
 *             once the server has the record and its photo, so neither a dropped connection nor a reload loses one
 *   sessions  the sessions this device is working on (V1.6): the one open here, with what the server last said about it so it reopens
 *             without a connection; one started here offline, until the server has it; one finished here, until the server is told
 *   meta      "access": who may catalogue on this device without a connection, and until when; "snapshot": the catalog to catalogue
 *             against (suggestions and possible matches read it online and offline alike)
 *   audits    the checks of a place this device is working on (V1.7), with what the server last said about each so it reopens offline;
 *             one started here offline until the server has it; a pause, a note about the place or a finish made here until it is sent
 *   observations  what was seen during a check, written before any request and removed once the server has it
 * Nothing here is authoritative: the server decides when anything is saved. Where the browser will not keep data (a private window),
 * everything lives in memory for the page's life and the screens say so.
 */

export type Entry = {
  /** The request id: also the server's key for this capture, so a repeat can never make a second item. */
  id: string;
  /** The session it was captured in, as this device files it (see SessionRecord). */
  sessionId: string;
  /** The account that captured it: only that account's sign-in or offline access sends it. Absent on an entry a V1.5 page left. */
  owner?: string;
  /** The capture request as it will be sent. */
  body: Record<string, unknown>;
  photo: { display: Blob; thumb: Blob; hash: string; crop?: PhotoCrop } | null;
  /** Known once the server has saved the record; the photo (if any) is what is still to send. */
  itemId: string | null;
  /** waiting: will be (re)sent; stopped: the server refused it and a person must decide. */
  state: "waiting" | "stopped";
  message: string | null;
  /** Captures taken just before this one that it was checked against ("a different one"): their request ids, turned into item ids when sent. */
  after: string[];
  /** The matches the server found, for a stopped entry. */
  matches: Array<{ id: string; reason: string; strong: boolean }> | null;
  at: string;
  /**
   * Its photo was not checked when it was taken (offline, or the check failed): the server checks it once after the photo is saved
   * (ambient-assist.ts). A reconsideration, never a command: the server re-reads the catalog as it is then, and may say nothing.
   */
  recheck?: boolean;
  /** An explicit save action: consumed before one cleanup attempt, never retried with the capture. */
  cleanBackground?: boolean;
};

/** A saved capture as the server lists it in a session. */
export type Recent = {
  captureId: string; behaviour: string; capturedAt: string; itemId: string; name: string; category: string; itemType: string; consumptionMode: string; unit: string;
  stockArea: string | null; onHand: number; place: string | null; photoId: string | null;
};
export type SessionInfo = { id: string; locationId: string | null; place: string | null; status: string; startedAt: string; finishedAt: string | null; saved: number; reviewLater: number; owner: string; mine: boolean };
export type Detail = { session: SessionInfo; counts: Record<string, number>; recent: Recent[]; photoCleanup?: PhotoCleanup };

export type SessionRecord = {
  /** The id this device files the session's captures under: the server's id, or the one it proposed when starting offline. */
  id: string;
  owner: string;
  /**
   * Where the server keeps it: null until a start sent from here is answered (or after the server finished it elsewhere and its
   * waiting captures need a new session). Usually the same id; the person's session open elsewhere when they already had one.
   */
  serverId: string | null;
  /** What the server last said about it, or what this device knows of one it started offline. */
  detail: Detail;
  /** Finished on this device: the server is told once every capture in it has been sent. */
  finishing: boolean;
};

/** One thing seen during a check of a place (V1.7), as it will be sent. */
export type ObservationEntry = {
  /** The request id: also the server's key, so a resend is never a second observation. */
  id: string;
  /** The check, as this device files it (see AuditRecord). */
  auditId: string;
  owner: string;
  body: { itemId?: string; outcome: string; expectedOnHand?: number; counted?: number; note?: string; observedAt: string; seenLocationId?: string };
  /** waiting: will be (re)sent; stopped: the server refused it and a person must look. */
  state: "waiting" | "stopped";
  message: string | null;
  at: string;
};

/** An item expected at a checked place, with the latest thing seen about it. */
export type AuditItem = {
  id: string; name: string; unit: string; locationId: string | null; place: string | null; onHand: number; photoId?: string | null; onLoan?: number; lastCountedAt?: string | null;
  observation: { id: string; outcome: string; counted: number | null; note: string | null } | null;
};
export type AuditInfo = { id: string; locationId: string; place: string | null; status: string; expectedAtStart: number; placeNote: string | null; startedAt: string; finishedAt: string | null; owner: string; mine: boolean };
export type AuditDetail = {
  audit: AuditInfo;
  place: { directions: string | null; mediaId: string | null; mediaWidth: number | null; mediaHeight: number | null } | null;
  items: AuditItem[];
  extras: Array<{ id: string; itemId: string | null; outcome: string; counted: number | null; note: string | null; name: string | null }>;
  checked: number;
};

export type AuditRecord = {
  /** The id this device files the check's observations under: the server's, or the one it proposed when starting offline. */
  id: string;
  owner: string;
  /** Local write identity: a late server read cannot replace work saved after it started. */
  revision?: string;
  /** Where the server keeps it: null until a start sent from here is answered. */
  serverId: string | null;
  /** What the server last said, or what this device knows of a check it started offline. */
  detail: AuditDetail;
  /** A pause, resume or note about the place made here and not yet sent. */
  pending: { status?: "OPEN" | "PAUSED"; placeNote?: string | null } | null;
  /** Finished on this device: the server is told once every observation in it has been sent. */
  finishing: boolean;
};

/** Who may catalogue here without a connection, as the server last confirmed, and until when (its lease, V1.6). */
export type Access = { accountId: string; displayName: string; username: string; role: string; access: string; expiresAt: number };

export type SnapshotItem = {
  id: string; name: string; aliases: string | null; category: string; itemType: string; consumptionMode: string; unit: string; stockArea: string | null; status: string; needsReview: boolean;
  model: string | null; serialNumber: string | null; locationId: string | null; photoHash: string | null; onHand: number;
};
export type Snapshot = { revision: number; items: SnapshotItem[]; categories: string[]; units: string[]; places: Array<Place & { directions?: string | null }>; fetchedAt: string };

/** The database's name; version 2 or later exists only where offline cataloguing was turned on (V1.6). */
export const CATALOGUE_DB = "logistics-hub-catalogue";
type StoreName = "captures" | "sessions" | "meta" | "audits" | "observations";
/** The page's own copy: what is read when the browser keeps nothing. */
const memory: Record<StoreName, Map<string, unknown>> = { captures: new Map(), sessions: new Map(), meta: new Map(), audits: new Map(), observations: new Map() };
let opening: Promise<IDBDatabase | null> | null = null;
let kept = true;

/** Whether what is held here survives closing the page. False after the browser refuses storage. */
export const durable = () => kept;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      // Version 2 (V1.6) adds sessions and meta, version 3 (V1.7) audits and observations; what an older page left is kept as it is.
      const request = indexedDB.open(CATALOGUE_DB, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of ["captures", "sessions", "audits", "observations"] as const) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => { kept = false; resolve(null); };
    } catch {
      kept = false;
      resolve(null);
    }
  });
  return opening;
}

const settled = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
});

/** Everything in a store. The browser's copy is the truth while it works, so another tab's changes (or a previous page's) are seen. */
async function all<T>(store: StoreName): Promise<Map<string, T>> {
  const db = await open();
  if (db && kept) {
    try {
      const transaction = db.transaction(store);
      const keys = transaction.objectStore(store).getAllKeys();
      const values = transaction.objectStore(store).getAll();
      await settled(transaction);
      memory[store] = new Map(keys.result.map((key, index) => [String(key), values.result[index]]));
    } catch { kept = false; }
  }
  return memory[store] as Map<string, T>;
}

/** Writes (or, with `undefined`, removes) one value. The in-page copy always changes; the call resolves once the browser has it durably too. */
async function put(store: StoreName, key: string, value: unknown): Promise<void> {
  if (value === undefined) memory[store].delete(key); else memory[store].set(key, value);
  const db = await open();
  if (!db) return;
  try {
    const transaction = db.transaction(store, "readwrite");
    const done = settled(transaction);
    if (value === undefined) transaction.objectStore(store).delete(key);
    else if (store === "meta") transaction.objectStore(store).put(value, key);
    else transaction.objectStore(store).put(value);
    await done;
  } catch { kept = false; }
}

/** Every capture still held here, oldest first. */
export const entries = async (): Promise<Entry[]> => [...(await all<Entry>("captures")).values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
export const keep = (entry: Entry) => put("captures", entry.id, entry);
export const drop = (id: string) => put("captures", id, undefined);

/** Atomically consume cleanup intent across tabs. Without durable storage, leave cosmetic work to an explicit Inventory action. */
export async function claimPhotoCleanup(id: string): Promise<boolean> {
  const db = await open();
  if (!db || !kept) return false;
  try {
    const transaction = db.transaction("captures", "readwrite");
    const done = settled(transaction);
    const store = transaction.objectStore("captures");
    const request = store.get(id);
    let claimed: Entry | null = null;
    request.onsuccess = () => {
      const current = request.result as Entry | undefined;
      if (current?.cleanBackground) {
        claimed = { ...current, photo: null, cleanBackground: false };
        store.put(claimed);
      }
    };
    await done;
    if (claimed) memory.captures.set(id, claimed);
    return claimed !== null;
  } catch { kept = false; return false; }
}

export const sessions = async (): Promise<SessionRecord[]> => [...(await all<SessionRecord>("sessions")).values()];
export const keepSession = (record: SessionRecord) => put("sessions", record.id, record);
export const dropSession = (id: string) => put("sessions", id, undefined);

export const access = async (): Promise<Access | null> => (await all<Access>("meta")).get("access") ?? null;
export const setAccess = (value: Access | null) => put("meta", "access", value ?? undefined);
export const snapshot = async (): Promise<Snapshot | null> => (await all<Snapshot>("meta")).get("snapshot") ?? null;
export const setSnapshot = (value: Snapshot) => put("meta", "snapshot", value);

export const audits = async (): Promise<AuditRecord[]> => structuredClone([...(await all<AuditRecord>("audits")).values()]);
// Keep this page's memory copy and durable writes in the same order, including a write that exhausts storage.
let writingAudits: Promise<void> = Promise.resolve();
function auditWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = writingAudits.then(write);
  writingAudits = result.then(() => {}, () => {});
  return result;
}
export const keepAudit = (record: AuditRecord) => {
  const saved = structuredClone({ ...record, revision: crypto.randomUUID() });
  return auditWrite(() => put("audits", saved.id, saved));
};
export const dropAudit = (id: string) => auditWrite(() => put("audits", id, undefined));

/** Merge a server acknowledgement with the latest local intent in one IndexedDB transaction. */
export function updateAudit(id: string, change: (current: AuditRecord | null) => AuditRecord | null): Promise<AuditRecord | null> {
  return auditWrite(async () => {
    const apply = (current: AuditRecord | null) => {
      const next = change(current);
      return next === current ? current : next ? { ...next, revision: crypto.randomUUID() } : null;
    };
    const remember = (record: AuditRecord | null) => {
      if (record) memory.audits.set(id, structuredClone(record)); else memory.audits.delete(id);
    };
    const db = await open();
    if (db && kept) {
      try {
        const transaction = db.transaction("audits", "readwrite");
        const done = settled(transaction);
        const store = transaction.objectStore("audits");
        const request = store.get(id);
        let result: AuditRecord | null = null;
        request.onsuccess = () => {
          const current = (request.result as AuditRecord | undefined) ?? null;
          result = apply(current);
          if (result !== current) { if (result) store.put(result); else store.delete(id); }
        };
        await done;
        remember(result);
        return structuredClone(result);
      } catch { kept = false; }
    }
    const result = apply(structuredClone((memory.audits.get(id) as AuditRecord | undefined) ?? null));
    remember(result);
    return structuredClone(result);
  });
}

/** Every observation still held here, oldest first. */
export const observations = async (): Promise<ObservationEntry[]> => [...(await all<ObservationEntry>("observations")).values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
export const keepObservation = (entry: ObservationEntry) => put("observations", entry.id, entry);
export const dropObservation = (id: string) => put("observations", id, undefined);

