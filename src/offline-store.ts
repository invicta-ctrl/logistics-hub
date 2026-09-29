import type { LocalEvent, Snapshot } from "./offline-queue";

/*
 * The phone's own storage, in IndexedDB. Nothing personal ever goes to Cache Storage.
 *   meta     small values by key: device id, next sequence number, remembered details
 *   catalog  one record ("snapshot"): the last self-service catalog from the server
 *   events   every action this phone recorded, with its sync state (offline-queue.ts)
 *   photos   a borrow's compressed photo, only until the server acknowledges the borrow
 * Works in pages and in the service worker (no DOM).
 */

const NAME = "logistics-hub";
const VERSION = 1;

export type Profile = { name: string; studentId: string };
export type StoredPhoto = { id: string; type: string; bytes: ArrayBuffer };

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = () => {
      // Version 1. A later version may add stores or indexes here, but never drops events.
      const db = request.result;
      db.createObjectStore("meta");
      db.createObjectStore("catalog");
      db.createObjectStore("events", { keyPath: "id" });
      db.createObjectStore("photos", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema asks us to let go; the next call reopens.
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => { opening = null; reject(request.error ?? new Error("Storage is unavailable.")); };
  });
  return opening;
}

const settled = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error("Storage failed."));
  transaction.onabort = () => reject(transaction.error ?? new Error("Storage failed."));
});

function read<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  }));
}

/** Runs writes in one transaction; resolves once they are durable. */
async function writeAll(storeNames: string[], work: (transaction: IDBTransaction) => void): Promise<void> {
  const transaction = (await open()).transaction(storeNames, "readwrite");
  const done = settled(transaction);
  work(transaction);
  await done;
}

export const getMeta = <T>(key: string) => read<T>("meta", key);
export const setMeta = (key: string, value: unknown) => writeAll(["meta"], (transaction) => transaction.objectStore("meta").put(value, key));

/** A random id for this installation, created once. Never derived from the device itself. */
export async function deviceId(): Promise<string> {
  const existing = await getMeta<string>("deviceId");
  if (existing) return existing;
  await writeAll(["meta"], (transaction) => {
    const meta = transaction.objectStore("meta");
    const request = meta.get("deviceId");
    request.onsuccess = () => { if (!request.result) meta.put(crypto.randomUUID(), "deviceId"); };
  });
  return (await getMeta<string>("deviceId"))!;
}

/**
 * Saves a new action atomically: the next sequence number, the event and its photo are written
 * in one transaction, so an event never exists without its photo (or the reverse).
 */
export async function saveEvent(build: (seq: number) => LocalEvent, photo?: { type: string; bytes: ArrayBuffer }): Promise<LocalEvent> {
  let saved: LocalEvent | undefined;
  await writeAll(["meta", "events", "photos"], (transaction) => {
    const meta = transaction.objectStore("meta");
    const request = meta.get("seq");
    request.onsuccess = () => {
      const seq = (typeof request.result === "number" ? request.result : 0) + 1;
      saved = build(seq);
      meta.put(seq, "seq");
      transaction.objectStore("events").put(saved);
      if (photo) transaction.objectStore("photos").put({ id: saved.id, ...photo } satisfies StoredPhoto);
    };
  });
  return saved!;
}

export async function events(): Promise<LocalEvent[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("events").objectStore("events").getAll();
    request.onsuccess = () => resolve((request.result as LocalEvent[]).sort((a, b) => a.seq - b.seq));
    request.onerror = () => reject(request.error);
  });
}

export const putEvents = (list: LocalEvent[]) => list.length
  ? writeAll(["events"], (transaction) => list.forEach((event) => transaction.objectStore("events").put(event)))
  : Promise.resolve();

/** Forgets events and any photos they still hold. */
export const deleteEvents = (ids: string[]) => ids.length
  ? writeAll(["events", "photos"], (transaction) => ids.forEach((id) => { transaction.objectStore("events").delete(id); transaction.objectStore("photos").delete(id); }))
  : Promise.resolve();

export const photo = (id: string) => read<StoredPhoto>("photos", id);
export const deletePhotos = (ids: string[]) => ids.length
  ? writeAll(["photos"], (transaction) => ids.forEach((id) => transaction.objectStore("photos").delete(id)))
  : Promise.resolve();

export const catalog = () => read<Snapshot>("catalog", "snapshot");
export const putCatalog = (snapshot: Snapshot) => writeAll(["catalog"], (transaction) => transaction.objectStore("catalog").put(snapshot, "snapshot"));

/** True when this browser lets the app keep data (private modes and blocked storage do not). */
export async function storageWorks(): Promise<boolean> {
  try {
    await setMeta("probe", Date.now());
    return typeof await getMeta<number>("probe") === "number";
  } catch {
    return false;
  }
}
