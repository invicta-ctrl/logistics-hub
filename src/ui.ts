import { LABELS } from "./catalog-policy";

export const app = document.querySelector<HTMLDivElement>("#app")!;
export const MARK = `<img src="/dol-mark.png" alt="HAU USC Department of Logistics" width="183" height="163" />`;

let leaveView: Array<() => void> = [];
/** Registers cleanup (timers, listeners) to run when the router leaves the current view. */
export function onLeave(cleanup: () => void): void { leaveView.push(cleanup); }
export function leave(): void { leaveView.forEach((cleanup) => cleanup()); leaveView = []; }

export function navigate(path: string, replace = false): void {
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

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

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", ...init, headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  } catch {
    throw new ApiError(0, "You appear to be offline. Check your connection and try again.");
  }
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, body.error ?? "Something went wrong. Please try again.");
  return body;
}

type LiveOptions<T> = { interval: number; onData: (data: T) => void; onError?: (error: ApiError) => void; status?: () => HTMLElement | null };

/**
 * Keeps a view current by polling an ETag'd endpoint. Unchanged data costs one
 * tiny 304; polling pauses while the tab is hidden and resumes on return.
 */
export function live<T>(url: string, options: LiveOptions<T>): { refresh: () => Promise<void> } {
  let etag = "";
  let timer = 0;
  let stopped = false;
  const setStatus = (state: "live" | "offline", text: string) => {
    const element = options.status?.();
    if (!element) return;
    element.dataset.state = state;
    element.textContent = text;
    element.title = `Last checked ${new Date().toLocaleTimeString()}`;
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
      } else if (response.status !== 304) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new ApiError(response.status, body.error ?? "Could not refresh.");
      }
      setStatus("live", "Live");
    } catch (error) {
      const failure = error instanceof ApiError ? error : new ApiError(0, "Offline");
      setStatus("offline", "Reconnecting…");
      options.onError?.(failure);
      if (failure.status === 401) return;
    }
    window.clearTimeout(timer);
    if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(tick, options.interval);
  };
  const resume = () => { if (document.visibilityState === "visible") void tick(); };
  document.addEventListener("visibilitychange", resume);
  onLeave(() => { stopped = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", resume); });
  void tick();
  return { refresh: tick };
}

export function stateMarkup(title: string, detail: string, extra = "", tone = ""): string {
  return `<div class="state ${tone}"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p>${extra}</div>`;
}
