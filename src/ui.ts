import { LABELS } from "./catalog-policy";

export const app = document.querySelector<HTMLDivElement>("#app")!;

/* ---------- Safe HTML ---------- */

/** Markup that is already safe to insert. Only html`` and raw() create it. */
export class Html {
  constructor(readonly value: string) {}
  toString(): string { return this.value; }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function serialize(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(serialize).join("");
  // Booleans print as "true"/"false" so ARIA attributes stay valid; use a ternary to omit markup.
  if (value === null || value === undefined) return "";
  return escapeHtml(String(value));
}

/** Tagged template that escapes every interpolation unless it is itself Html. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  return new Html(strings.reduce((out, part, index) => out + part + (index < values.length ? serialize(values[index]) : ""), ""));
}

export const raw = (markup: string): Html => new Html(markup);

export function mount(target: Element, content: Html): void {
  target.innerHTML = content.value;
}

/* ---------- Icons (24px grid, 1.75 stroke, currentColor) ---------- */

const ICONS = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  close: "M6 6l12 12M18 6 6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  plus: "M12 5v14M5 12h14",
  check: "m5 12.5 4.5 4.5L19 7.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
  alert: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
  signOut: "M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M16 8l4 4-4 4M20 12H9",
  sort: "m8 9 4-4 4 4M8 15l4 4 4-4",
  sortUp: "m8 14 4-4 4 4",
  sortDown: "m8 10 4 4 4-4",
  box: "M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9ZM4 7.5l8 3.5 8-3.5M12 11v9",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M3 3l18 18M10.6 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  refresh: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4",
  circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  next: "M9 6l6 6-6 6",
  filter: "M4 5h16l-6 7.5V18l-4 2v-7.5L4 5Z",
  camera: "M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9ZM12 16a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z",
  handoff: "M12 15V4M8 8l4-4 4 4M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): Html {
  return raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICONS[name]}"/></svg>`);
}

export const MARK = raw(`<img class="mark" src="/brand/dol-mark.png" alt="HAU USC Department of Logistics" width="183" height="163" />`);
/** The HAU University Student Council crest, shown beside the DOL mark on public pages. */
export const CREST = raw(`<img class="crest" src="/brand/hau-usc-crest.webp" alt="Holy Angel University Student Council" width="205" height="240" />`);

/* ---------- Routing and view lifecycle ---------- */

let leaveView: Array<() => void> = [];
/** Registers cleanup (timers, listeners) to run when the router leaves the current view. */
export function onLeave(cleanup: () => void): void { leaveView.push(cleanup); }
export function leave(): void { leaveView.forEach((cleanup) => cleanup()); leaveView = []; }

export function navigate(path: string, replace = false): void {
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Mirrors view state (filters, sort, open item) into the query string without adding history entries. */
export function writeParams(values: Record<string, string | null | undefined>): void {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

/** Re-renders a live region while keeping keyboard focus on the same keyed row. */
export function preservingFocus(container: Element, render: () => void): void {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.closest<HTMLElement>("[data-key]")?.dataset.key : undefined;
  render();
  if (key) container.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] button`)?.focus({ preventScroll: true });
}

/* ---------- Formatting ---------- */

export const label = (value: string): string => LABELS[value] ?? value;

const LOWER = new Set(["and", "for", "of", "the", "&", "a", "to"]);
/** Legacy categories are stored in capitals; present them in title case. */
export function categoryName(value: string): string {
  return value.toLowerCase().split(/\s+/).map((word, index) => {
    if (word === "usc" || word === "(usc") return word.toUpperCase();
    if (index > 0 && LOWER.has(word)) return word;
    return word.replace(/^(\(?)(\p{L})/u, (_, bracket: string, letter: string) => bracket + letter.toUpperCase());
  }).join(" ");
}

/** "1 piece", "3 pieces", "2 boxes": units are stored singular. */
export function units(count: number, unit: string): string {
  if (Math.abs(count) === 1 || /s$/i.test(unit)) return unit;
  return /(x|ch|sh)$/i.test(unit) ? `${unit}es` : `${unit}s`;
}

export const plural = (count: number, word: string): string => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

const dateTime = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));
const time = new Intl.DateTimeFormat("en-PH", { timeStyle: "short", timeZone: "Asia/Manila" });
export const formatTime = (iso: string): string => time.format(new Date(iso));
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });
/** The office's calendar day (Asia/Manila) as YYYY-MM-DD, for "today" and expiry. */
export const officeDay = (date: Date | string = new Date()): string => day.format(typeof date === "string" ? new Date(date) : date);
const dateOnly = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "UTC" });
export const formatDate = (isoDay: string): string => dateOnly.format(new Date(`${isoDay}T00:00:00Z`));

/* ---------- Motion ---------- */

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Rolls a number to `to` (from `from`, or its current text), so a change is seen rather than jumped. */
export function animateNumber(element: Element | null, to: number, from = Number(element?.textContent)): void {
  if (!element) return;
  if (!Number.isFinite(from) || from === to || reducedMotion()) { element.textContent = String(to); return; }
  const start = performance.now();
  const duration = Math.min(700, 250 + Math.abs(to - from) * 30);
  element.textContent = String(from);
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    element.textContent = String(Math.round(from + (to - from) * (1 - (1 - progress) ** 3)));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Sheets ---------- */

/** The shared sheet frame: kicker, title, close button, scrolling body. */
export function sheetContent(kicker: Html | string, title: string, body: Html): Html {
  return html`<header class="sheet__header">
      <div><p class="sheet__kicker">${kicker}</p><h2 id="sheet-title">${title}</h2></div>
      <button class="icon-button" type="button" aria-label="Close" data-close>${icon("close")}</button>
    </header>
    <div class="sheet__body">${body}</div>`;
}

export type Sheet = { open: () => void; close: (force?: boolean) => void; discardOk: () => boolean };

/**
 * The one sheet behaviour (side panel on desktop, bottom sheet on phones): modal open,
 * Escape and backdrop close, an optional unsaved-changes guard, an exit animation, and
 * focus returned to whatever opened it.
 */
export function sheet(dialog: HTMLDialogElement, options: { dirty?: () => boolean; onClose?: () => void } = {}): Sheet {
  let opener: HTMLElement | null = null;
  const discardOk = () => !options.dirty?.() || window.confirm("Discard your unsaved changes?");
  const close = (force = false) => {
    if (!dialog.open || dialog.classList.contains("is-closing") || (!force && !discardOk())) return;
    if (reducedMotion()) return dialog.close();
    dialog.classList.add("is-closing");
    // Only the dialog's own exit animation ends the close; child animations bubble here too.
    const finish = (event?: AnimationEvent) => {
      if (event && event.target !== dialog) return;
      dialog.removeEventListener("animationend", finish);
      window.clearTimeout(fallback);
      dialog.classList.remove("is-closing");
      dialog.close();
    };
    const fallback = window.setTimeout(finish, 400);
    dialog.addEventListener("animationend", finish);
  };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || (event.target as HTMLElement).closest("[data-close]")) close();
  });
  dialog.addEventListener("close", () => {
    // onClose runs first so a caller can take back content it lent to the sheet.
    options.onClose?.();
    dialog.innerHTML = "";
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
  onLeave(() => { if (dialog.open) dialog.close(); });
  return {
    open: () => { if (!dialog.open) { opener = document.activeElement as HTMLElement | null; dialog.showModal(); } },
    close,
    discardOk
  };
}

/* ---------- Feedback ---------- */

/** Transient confirmation in a single polite live region that survives view changes. */
export function toast(message: string, tone: "ok" | "error" = "ok"): void {
  let region = document.querySelector<HTMLDivElement>("#toasts");
  if (!region) {
    region = document.createElement("div");
    region.id = "toasts";
    region.className = "toasts";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const item = document.createElement("div");
  item.className = `toast toast--${tone}`;
  mount(item, html`${icon(tone === "ok" ? "check" : "alert")}<span>${message}</span>`);
  region.append(item);
  window.setTimeout(() => {
    item.classList.add("toast--leaving");
    window.setTimeout(() => item.remove(), 250);
  }, tone === "ok" ? 3500 : 6000);
}

export function emptyState(title: string, detail: string, action: Html | string = "", tone: "" | "error" = ""): Html {
  return html`<div class="empty ${tone ? `empty--${tone}` : ""}">${icon(tone ? "alert" : "box")}<h2>${title}</h2><p>${detail}</p>${action}</div>`;
}

/* ---------- Data ---------- */

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    // JSON bodies are strings; a FormData body sets its own multipart boundary.
    response = await fetch(url, { credentials: "same-origin", ...init, headers: { accept: "application/json", ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...init.headers } });
  } catch {
    throw new ApiError(0, "You appear to be offline. Check your connection and try again.");
  }
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, body.error ?? "Something went wrong. Please try again.");
  return body;
}

/** Sends a signed-out user back to sign in, explaining why. */
export function expired(): void {
  navigate("/staff?expired=1", true);
}

/** The message to show for a failed request; an ended session also routes to sign in. */
export function failure(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) expired();
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function setMessage(element: HTMLElement, message: string | Html, tone: "error" | "ok" | "" = "error"): void {
  element.className = `form-alert ${tone ? `form-alert--${tone}` : ""}`;
  element.hidden = !message;
  mount(element, message ? html`${icon(tone === "ok" ? "check" : "alert")}<span>${message}</span>` : html``);
}

type LiveOptions<T> = { interval: number; onData: (data: T) => void; onError?: (error: ApiError) => void; status?: () => HTMLElement | null };

/**
 * Keeps a view current by polling an ETag'd endpoint. Unchanged data costs one
 * tiny 304; polling pauses while the tab is hidden and resumes on return.
 */
export function live<T>(url: string, options: LiveOptions<T>): { refresh: () => Promise<void> } {
  let etag = "";
  let timer = 0;
  let settle = 0;
  let stopped = false;
  let loaded = false;
  const setStatus = (state: "live" | "offline" | "updated") => {
    const element = options.status?.();
    if (!element) return;
    if (state === "live" && element.dataset.state === "updated") return;
    if (state === "offline") window.clearTimeout(settle);
    element.dataset.state = state;
    element.textContent = state === "offline" ? "Offline, retrying" : state === "updated" ? "Updated just now" : "Live updates";
    element.title = `Last checked ${new Date().toLocaleTimeString()}`;
    if (state === "updated") {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { element.dataset.state = "live"; element.textContent = "Live updates"; }, 4000);
    }
  };
  const tick = async () => {
    window.clearTimeout(timer);
    if (stopped) return;
    try {
      const response = await fetch(url, { credentials: "same-origin", headers: etag ? { "if-none-match": etag } : {} });
      if (response.status === 200) {
        etag = response.headers.get("etag") ?? "";
        const data = await response.json() as T;
        if (!stopped) options.onData(data);
        if (loaded) setStatus("updated");
        loaded = true;
      } else if (response.status !== 304) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new ApiError(response.status, body.error ?? "Could not refresh.");
      }
      setStatus("live");
    } catch (error) {
      const failure = error instanceof ApiError ? error : new ApiError(0, "Offline");
      setStatus("offline");
      options.onError?.(failure);
      if (failure.status === 401) return;
    }
    window.clearTimeout(timer);
    if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(tick, options.interval);
  };
  const resume = () => { if (document.visibilityState === "visible") void tick(); };
  document.addEventListener("visibilitychange", resume);
  onLeave(() => { stopped = true; window.clearTimeout(timer); window.clearTimeout(settle); document.removeEventListener("visibilitychange", resume); });
  void tick();
  return { refresh: tick };
}
