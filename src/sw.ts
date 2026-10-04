/// <reference lib="webworker" />
import { CATALOGUE_DB, access } from "./catalogue-store";
import { nextAttemptAt, syncNow } from "./offline-sync";

/*
 * The service worker: it makes the app open without a connection and sends saved actions in
 * the background where the browser allows it (Background Sync, Chromium).
 *
 * - Every build precaches its own app shell under a versioned cache; old versions are deleted
 *   only once the new one is active. People's saved actions live in IndexedDB, never in these
 *   caches, so an update can never lose them.
 * - /api/* is never intercepted or cached: live data and anything personal go to the network.
 * - A new version waits until the page says it is a good moment (pwa.ts), so nobody's
 *   half-filled form is reloaded away.
 * - The Catalogue's screens (V1.6) are saved only on a device where staff turned offline
 *   cataloguing on, and saved again by every new version there, so an update never takes
 *   offline cataloguing away. What was catalogued waits in IndexedDB (catalogue-store.ts).
 */

declare const self: ServiceWorkerGlobalScope;
/** Written by the build (vite.config.ts): this build's version, the files it needs offline, and the Catalogue's own. */
declare const __BUILD__: { version: string; files: string[]; catalogue: string[] };
type SyncEvent = ExtendableEvent & { tag: string };

const SHELL = `logistics-shell-${__BUILD__.version}`;
const MEDIA = "logistics-media";
/** The app's one HTML page. Every route is rendered from it in the browser. */
const PAGE = "/";
const CATALOGUE = "/staff/catalogue";
const precached = new Set([...__BUILD__.files, ...__BUILD__.catalogue]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll([PAGE, ...__BUILD__.files]);
    if (await catalogueOn()) await cache.addAll(__BUILD__.catalogue);
  })());
});

/**
 * Whether offline cataloguing is on here. Only such a device has the catalogue store at version 2: opening it anywhere else would
 * create it on every Self-Service phone, or upgrade it under a V1.5 page still open there.
 */
async function catalogueOn(): Promise<boolean> {
  if (indexedDB.databases) {
    const known = await indexedDB.databases().catch(() => []);
    if (!known.some((db) => db.name === CATALOGUE_DB && (db.version ?? 0) >= 2)) return false;
  }
  return (await access().catch(() => null)) !== null;
}

/** Saves the Catalogue's screens in this version's shell (what is already there is not fetched again); false if any is missing. */
async function keepCatalogue(): Promise<boolean> {
  try {
    const cache = await caches.open(SHELL);
    const missing = (await Promise.all(__BUILD__.catalogue.map(async (file) => (await cache.match(file)) ? null : file))).filter((file): file is string => file !== null);
    if (missing.length) await cache.addAll(missing);
    return true;
  } catch {
    return false;
  }
}

const catalogueKept = async () => (await Promise.all(__BUILD__.catalogue.map((file) => caches.match(file, { cacheName: SHELL })))).every(Boolean);

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("logistics-shell-") && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const type = (event.data as { type?: string } | null)?.type;
  if (type === "SKIP_WAITING") void self.skipWaiting();
  // The Catalogue asks for its screens to be saved when offline cataloguing is turned on, and whether they are (catalogue-offline.ts).
  if (type === "KEEP_CATALOGUE") event.waitUntil(keepCatalogue().then((kept) => event.ports[0]?.postMessage({ kept })));
  if (type === "CATALOGUE_KEPT") event.waitUntil(catalogueKept().then((kept) => event.ports[0]?.postMessage({ kept })));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") event.respondWith(page(request, url));
  else if (precached.has(url.pathname)) event.respondWith(cacheFirst(request));
  else if (url.pathname.startsWith("/brand/") || url.pathname.startsWith("/qr/")) event.respondWith(staleWhileRevalidate(request, event));
});

/**
 * Self-Service opens instantly from the cached shell, so it works with no connection. Every other
 * page goes to the network first: visitors see a new version as soon as it is deployed, and the
 * Worker's session check still decides who sees staff pages. Offline, they get the shell, which
 * explains or shows what it can.
 */
async function page(request: Request, url: URL): Promise<Response> {
  const cached = await caches.match(PAGE, { cacheName: SHELL });
  if (url.pathname.startsWith("/self-service")) return cached ?? fetch(request);
  // On a device that catalogues offline, the Catalogue opens from what it saved, so a shelf with no signal still works.
  if (url.pathname === CATALOGUE && cached && await catalogueKept()) return cached;
  // The original request keeps the browser's own redirect handling (the Worker may redirect to sign-in).
  try {
    return await fetch(request);
  } catch {
    return cached ?? Response.error();
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  return (await caches.match(request, { cacheName: SHELL })) ?? fetch(request);
}

async function staleWhileRevalidate(request: Request, event: FetchEvent): Promise<Response> {
  const cache = await caches.open(MEDIA);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    if (response.ok) void cache.put(request, response.clone());
    return response;
  });
  event.waitUntil(fresh.catch(() => undefined));
  return cached ?? fresh;
}

self.addEventListener("sync", (event) => {
  const sync = event as SyncEvent;
  // Rejecting tells the browser to try again later (it does a few times) while anything still waits.
  if (sync.tag === "logistics-hub-sync") sync.waitUntil(syncNow().then(async (report) => { if (report.offline || report.skipped || await nextAttemptAt() !== null) throw new Error("Records still waiting."); }));
});
