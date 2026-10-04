/*
 * The captures this device has taken but the server has not fully confirmed: a record that has not been saved yet, or a saved one
 * whose photo has not gone up. Each is written here before any network call and removed only when the server has everything, so
 * a dropped connection or a reload never loses one. It is not an offline mode: nothing is saved without the server (V1.6 builds
 * the offline queue on this same boundary). Where the browser will not keep data (a private window), the entries live in memory
 * for the page's life and the screen says so.
 */

export type Entry = {
  /** The request id: also the server's key for this capture, so a repeat can never make a second item. */
  id: string;
  sessionId: string;
  /** The capture request as it will be sent. */
  body: Record<string, unknown>;
  photo: { display: Blob; thumb: Blob; hash: string } | null;
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
};

const NAME = "logistics-hub-catalogue";
const memory = new Map<string, Entry>();
let opening: Promise<IDBDatabase | null> | null = null;
let kept = true;

/** Whether entries survive closing the page. False until storage is known to work, and after it fails. */
export const durable = () => kept;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("captures", { keyPath: "id" }); };
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

/** Everything this device is still holding, oldest first; the first call also reads what a previous page left behind. */
export async function entries(): Promise<Entry[]> {
  const db = await open();
  if (db) {
    try {
      const request = db.transaction("captures").objectStore("captures").getAll();
      const stored = await new Promise<Entry[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result as Entry[]); request.onerror = () => reject(request.error); });
      for (const entry of stored) if (!memory.has(entry.id)) memory.set(entry.id, entry);
    } catch { kept = false; }
  }
  return [...memory.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** Writes (or rewrites) an entry. The in-page copy is always updated; the call resolves once the browser has it durably too. */
export async function keep(entry: Entry): Promise<void> {
  memory.set(entry.id, entry);
  const db = await open();
  if (!db) return;
  try {
    const transaction = db.transaction("captures", "readwrite");
    const done = settled(transaction);
    transaction.objectStore("captures").put(entry);
    await done;
  } catch { kept = false; }
}

export async function drop(id: string): Promise<void> {
  memory.delete(id);
  const db = await open();
  if (!db) return;
  try {
    const transaction = db.transaction("captures", "readwrite");
    const done = settled(transaction);
    transaction.objectStore("captures").delete(id);
    await done;
  } catch { kept = false; }
}
