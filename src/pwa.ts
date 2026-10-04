/// <reference types="vite/client" />
import * as store from "./offline-store";

/*
 * The installable-app side of the page: registers the service worker, offers installation,
 * notices new versions and says whether this phone is ready to work offline. It holds state and
 * raises events; the self-service screens decide how to show it.
 */

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export type Platform = "ios" | "android" | "other";
export type Readiness = { shell: boolean; catalog: boolean; storage: boolean; persisted: boolean };

const events = new EventTarget();
let installPrompt: InstallPrompt | null = null;
let registration: ServiceWorkerRegistration | null = null;
let updateReady = false;
let reloading = false;
let lastCheck = 0;
/** The screen in use says whether reloading now would lose anything (see whenIdle). */
let idle: () => boolean = () => false;

/** "install" (a prompt became available or was used), "update" (a new version is ready). */
export const onPwaChange = (listener: () => void): (() => void) => {
  events.addEventListener("change", listener);
  return () => events.removeEventListener("change", listener);
};
const changed = () => events.dispatchEvent(new Event("change"));

export function platform(): Platform {
  const agent = navigator.userAgent;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(agent) ? "android" : "other";
}

export const isStandalone = (): boolean => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const canPromptInstall = (): boolean => installPrompt !== null;

/** The page now installs the other app (its manifest changed): a prompt the browser offered for the previous one must not be used. */
export function forgetInstallPrompt(): void {
  if (!installPrompt) return;
  installPrompt = null;
  changed();
}
export const hasUpdate = (): boolean => updateReady;

/** Shows the browser's own install dialog (Chrome, Edge, Samsung Internet). */
export async function promptInstall(): Promise<boolean> {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  changed();
  return outcome === "accepted";
}

/** Tells the app whether the current screen could be reloaded without losing anything. */
export function whenIdle(check: () => boolean): void { idle = check; }

/** Switches to the waiting version now. Saved actions are in IndexedDB and survive the reload. */
export function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (!waiting) return;
  reloading = true;
  waiting.postMessage({ type: "SKIP_WAITING" });
}

/** Asks the browser, at most every 30 minutes, whether a newer build exists. */
function checkForUpdate(): void {
  if (!registration || Date.now() - lastCheck < 30 * 60_000) return;
  lastCheck = Date.now();
  void registration.update().catch(() => undefined);
}

function watch(worker: ServiceWorker | null): void {
  if (!worker) return;
  const settle = () => {
    // Only an update waits: the very first install has nothing to replace.
    if (worker.state === "installed" && navigator.serviceWorker.controller) {
      updateReady = true;
      changed();
    }
  };
  worker.addEventListener("statechange", settle);
  settle();
}

/**
 * Registers the service worker (production builds only; the dev server has no /sw.js). A new
 * version is applied when the person comes back to the app on a screen with nothing unsaved;
 * otherwise the app offers "Update" and waits.
 */
export function startPwa(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    changed();
  });
  window.addEventListener("appinstalled", () => { installPrompt = null; changed(); });
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((found) => {
      registration = found;
      lastCheck = Date.now();
      watch(found.waiting ?? found.installing);
      found.addEventListener("updatefound", () => watch(found.installing));
    }).catch((error: unknown) => console.warn("service_worker_unavailable", error));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (updateReady && idle()) applyUpdate();
    else checkForUpdate();
  });
}

/** Where Background Sync exists (Chromium), the browser sends saved actions even after the app closes. */
export async function requestBackgroundSync(): Promise<void> {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  const ready = await navigator.serviceWorker.ready;
  await (ready as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync?.register("logistics-hub-sync").catch(() => undefined);
}

/** Asks the browser to keep this app's data even when the phone is low on space. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return await navigator.storage?.persist?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Whether this phone can work offline right now: the app itself is saved (the service worker
 * controls the page and its shell is cached), a catalog is saved, and storage works.
 */
export async function readiness(): Promise<Readiness> {
  const [catalog, storage, persisted, shell] = await Promise.all([
    store.catalog().then(Boolean).catch(() => false),
    store.storageWorks(),
    navigator.storage?.persisted?.().catch(() => false) ?? Promise.resolve(false),
    shellCached()
  ]);
  return { shell, catalog, storage, persisted };
}

async function shellCached(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller || !("caches" in window)) return false;
  for (const key of await caches.keys()) {
    if (key.startsWith("logistics-shell-") && await (await caches.open(key)).match("/")) return true;
  }
  return false;
}
