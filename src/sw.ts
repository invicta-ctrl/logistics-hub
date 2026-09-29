/// <reference lib="webworker" />
import { syncNow } from "./offline-sync";

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
 */

declare const self: ServiceWorkerGlobalScope;
/** Written by the build (vite.config.ts): this build's version and the files it needs offline. */
declare const __BUILD__: { version: string; files: string[] };
type SyncEvent = ExtendableEvent & { tag: string };

const SHELL = `logistics-shell-${__BUILD__.version}`;
const MEDIA = "logistics-media";
/** The app's one HTML page. Every route is rendered from it in the browser. */
const PAGE = "/";
const precached = new Set(__BUILD__.files);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll([PAGE, ...__BUILD__.files])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("logistics-shell-") && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
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
 * Public pages open instantly from the cached shell. Staff pages go to the network first, so the
 * Worker's session check still decides who sees them; offline, they get the shell, which explains.
 */
async function page(request: Request, url: URL): Promise<Response> {
  const cached = await caches.match(PAGE, { cacheName: SHELL });
  if (url.pathname.startsWith("/staff")) {
    // The original request keeps the browser's own redirect handling (the Worker may redirect to sign-in).
    try {
      return await fetch(request);
    } catch {
      return cached ?? Response.error();
    }
  }
  return cached ?? fetch(request);
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
  // Rejecting tells the browser to try again later, which it does a few times.
  if (sync.tag === "logistics-hub-sync") sync.waitUntil(syncNow().then((report) => { if (report.offline) throw new Error("Still offline."); }));
});
