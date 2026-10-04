/// <reference types="vite/client" />
import { type Access, type Snapshot, access, durable, setAccess, setSnapshot, snapshot } from "./catalogue-store";
import { isStandalone, platform, requestPersistence } from "./pwa";
import type { Session } from "./staff";
import { ApiError, api } from "./ui";

/*
 * Offline cataloguing on this device (V1.6). Staff turn it on while signed in; the server then gives this device a week-long lease that
 * may only catalogue (worker.ts), and the device keeps the Catalogue's screens (sw.ts) and a copy of the catalog (catalogue-store.ts).
 * No password is kept anywhere: the lease is an HttpOnly cookie, and this device only remembers who it belongs to and until when.
 */

/** Who is cataloguing on this page, and how. */
export type Who =
  /** Signed in, online. `access` is this device's offline cataloguing, if it is on. */
  | { mode: "signed-in"; session: Session; access: Access | null }
  /** Online, but only this device's offline access is valid (the sign-in ended): cataloguing works, the rest needs a sign-in. */
  | { mode: "lease"; session: Session; access: Access }
  /** No connection, with offline access: cataloguing works from what this device saved. */
  | { mode: "offline"; session: Session; access: Access }
  /** No connection and no offline access (never turned on, ended or expired). */
  | { mode: "closed"; access: Access | null }
  /** Online and signed out. */
  | { mode: "signed-out" };

type OfflineState = { signedIn: boolean; lease: { expiresAt: number } | null; account: { id: string; displayName: string; username: string; role: string; access: string } };

/** A renewal moves the lease a full week ahead; it is asked for at most once a day. */
const RENEW_BEFORE = 6 * 24 * 60 * 60 * 1000;

/** The shell's view of a member known only through this device's offline access: a Logistics member, with nothing to review. */
const sessionOf = (granted: Access): Session => ({
  id: granted.accountId, username: granted.username, displayName: granted.displayName, role: granted.role as Session["role"], access: granted.access as Session["access"],
  hub: true, mustChangePassword: false, recovery: null, selfServiceReviews: 0, selfServiceClosed: false, directory: null
});

const accessFrom = (state: OfflineState): Access | null => state.lease ? { accountId: state.account.id, displayName: state.account.displayName, username: state.account.username, role: state.account.role, access: state.account.access, expiresAt: state.lease.expiresAt } : null;

/** Whether the access this device remembers can still be used here without asking the server. */
export const usable = (granted: Access | null): granted is Access => granted !== null && granted.expiresAt > Date.now();

/** Finds out who may catalogue here, keeping what this device remembers in step with the server whenever it can ask. */
export async function identify(): Promise<Who> {
  const remembered = await access();
  let session: Session;
  try {
    session = await api<Session>("/api/staff/session");
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 0) return usable(remembered) ? { mode: "offline", session: sessionOf(remembered), access: remembered } : { mode: "closed", access: remembered };
    if (error.status !== 401) throw error;
    // Signed out: this device's lease may still catalogue.
    const state = await api<OfflineState>("/api/staff/catalogue/offline").catch(() => null);
    const granted = state ? accessFrom(state) : null;
    await setAccess(granted);
    return granted ? { mode: "lease", session: sessionOf(granted), access: granted } : { mode: "signed-out" };
  }
  if (session.mustChangePassword || session.hub === false) return { mode: "signed-in", session, access: null };
  if (!remembered) return { mode: "signed-in", session, access: null };
  // Offline cataloguing is on here: check it with the server, and keep it a week ahead while its member is signed in.
  const state = await api<OfflineState>("/api/staff/catalogue/offline").catch(() => null);
  let granted = state ? accessFrom(state) : remembered;
  if (state && !granted) await setAccess(null);
  else if (granted && granted.expiresAt - Date.now() < RENEW_BEFORE) granted = await turnOn().catch(() => granted);
  else if (granted) await setAccess(granted);
  return { mode: "signed-in", session, access: granted };
}

/** Turns offline cataloguing on (or renews it) for the signed-in member, and starts saving what the device needs. */
export async function turnOn(): Promise<Access> {
  const granted = accessFrom(await api<OfflineState>("/api/staff/catalogue/offline", { method: "POST" }))!;
  await setAccess(granted);
  return granted;
}

/** Turns it off: the lease ends on the server. Anything not yet sent stays on this device until its member signs in here. */
export async function turnOff(): Promise<void> {
  await api("/api/staff/catalogue/offline", { method: "DELETE" });
  await setAccess(null);
}

/** Brings the device's copy of the catalog up to date (one small 304 when nothing changed). Answers the copy it has. */
export async function refreshSnapshot(): Promise<Snapshot | null> {
  const saved = await snapshot();
  try {
    const response = await fetch("/api/staff/catalogue/snapshot", { credentials: "same-origin", headers: saved ? { "if-none-match": `"r${saved.revision}"` } : {} });
    if (response.status === 200) {
      const fresh = { ...(await response.json() as Omit<Snapshot, "fetchedAt">), fetchedAt: new Date().toISOString() };
      await setSnapshot(fresh);
      return fresh;
    }
  } catch { /* offline: the saved copy is what there is */ }
  return saved;
}

/** Asks the service worker about the Catalogue's saved screens: `keep` saves any that are missing. False where there is no service worker. */
async function askWorker(type: "KEEP_CATALOGUE" | "CATALOGUE_KEPT"): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return false;
  const worker = navigator.serviceWorker.controller ?? (await navigator.serviceWorker.ready).active;
  if (!worker) return false;
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve(false), 30_000);
    channel.port1.onmessage = (event) => { window.clearTimeout(timeout); resolve(Boolean((event.data as { kept?: boolean }).kept)); };
    worker.postMessage({ type }, [channel.port2]);
  });
}

export const keepScreens = () => askWorker("KEEP_CATALOGUE");

export type Readiness = {
  /** Offline access for this device, still valid. */
  access: boolean;
  /** The Catalogue's screens are saved, and the service worker runs this page. */
  screens: boolean;
  /** A copy of the catalog is saved. */
  catalog: boolean;
  /** The browser keeps this site's data (false in a private window). */
  storage: boolean;
  /** The browser promised not to clear it when space runs low. */
  persisted: boolean;
  /** iPhone and iPad keep a Safari tab's data apart from the Home Screen app's: offline cataloguing works from the app. */
  needsHomeScreen: boolean;
  /** When the saved catalog was last brought up to date. */
  savedAt: string | null;
};

export const ready = (state: Readiness) => state.access && state.screens && state.catalog && state.storage && !state.needsHomeScreen;

/** Whether this device can catalogue without a connection right now, and if not, what is missing. */
export async function readiness(granted: Access | null): Promise<Readiness> {
  const [saved, screens, persisted] = await Promise.all([
    snapshot(),
    navigator.serviceWorker?.controller ? askWorker("CATALOGUE_KEPT") : Promise.resolve(false),
    navigator.storage?.persisted?.().catch(() => false) ?? Promise.resolve(false)
  ]);
  return { access: usable(granted), screens, catalog: saved !== null, storage: durable(), persisted, needsHomeScreen: platform() === "ios" && !isStandalone(), savedAt: saved?.fetchedAt ?? null };
}

/** Everything turning offline cataloguing on needs on this device: the screens, the catalog, and storage the browser will keep. */
export async function prepare(): Promise<void> {
  await Promise.all([keepScreens(), refreshSnapshot(), requestPersistence()]);
}
