import { type VisualItem, itemIconSvg, resolveItemVisual } from "./item-icons";
import { LABELS } from "./catalog-policy";
import { frameByPhoto, seatOnPedestal, unframe } from "./photo-frame";

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

/* ---------- Icons ----------
 * One family, drawn here: a 24-unit grid with at least a unit of padding, one unfilled path per icon stroked at 1.75 in
 * currentColor with round caps and joins (src/styles.css sets size and stroke). A dot is a tiny circle, so it reads at every
 * size without its own stroke width. Icons are decorative: the control or text beside one names it. */

const ICONS = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  close: "M6 6l12 12M18 6 6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  check: "m5 12.5 4.5 4.5L19 7.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
  alert: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
  signOut: "M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M16 8l4 4-4 4M20 12H9",
  sort: "m8 9 4-4 4 4M8 15l4 4 4-4",
  sortUp: "m8 14 4-4 4 4",
  sortDown: "m8 10 4 4 4-4",
  box: "M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9ZM4 7.5l8 3.5 8-3.5M12 11v9",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  crop: "M7 3v12.5A1.5 1.5 0 0 0 8.5 17H21M3 7h12.5A1.5 1.5 0 0 1 17 8.5V21",
  sparkle: "M12 4.5 13.6 9 18 10.5 13.6 12 12 16.5 10.4 12 6 10.5 10.4 9ZM18 16v3M16.5 17.5h3",
  eyeOff: "M3 3l18 18M10.6 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  refresh: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4",
  circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  next: "M9 6l6 6-6 6",
  filter: "M4 5h16l-6 7.5V18l-4 2v-7.5L4 5Z",
  camera: "M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9ZM12 16a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z",
  handoff: "M12 15V4M8 8l4-4 4 4M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12",
  giveBack: "M12 4v11M8 11l4 4 4-4M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12",
  basket: "M4 9.5h16l-1.6 9a1.5 1.5 0 0 1-1.5 1.25H7.1a1.5 1.5 0 0 1-1.5-1.25L4 9.5ZM8.5 9.5 12 4l3.5 5.5M10 13.5v3M14 13.5v3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2",
  history: "M3.5 12A8.5 8.5 0 1 0 6 6L3.5 8.5M3.5 4v4.5H8M12 7.5V12l3 2",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  back: "M15 18l-6-6 6-6",
  share: "M12 3v11M8.5 6.5 12 3l3.5 3.5M8 10H6.5A1.5 1.5 0 0 0 5 11.5v7A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 17.5 10H16",
  install: "M12 4v10M8 10.5l4 4 4-4M5 19.5h14",
  cloudOff: "M3 3l18 18M8.4 8.4A5 5 0 0 0 6.5 18H17M20.2 16.4A3.8 3.8 0 0 0 17 10.2h-.6A6 6 0 0 0 10.5 6.2",
  more: "M12 4.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM12 17.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",
  dots: "M5.5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM18.5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",
  home: "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-7.5Z",
  bell: "M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0",
  swap: "M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4",
  stack: "M12 4 3.5 8.5 12 13l8.5-4.5L12 4ZM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5",
  phone: "M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3ZM11 18h2",
  shield: "M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6l-7-3ZM9 12l2 2 4-4",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"
} as const;

export type IconName = keyof typeof ICONS;

/** A fixed frame always contains a local icon, beneath a selected photo while it loads. */
export function itemVisual(item: VisualItem, url: (id: string) => string, className = "", meaningful = false): Html {
  const visual = resolveItemVisual(item);
  const key = visual.type === "PHOTO" ? visual.fallback.key : visual.icon.key;
  return html`<span class="item-visual ${className}">${raw(itemIconSvg(key))}${visual.type === "PHOTO"
    ? html`<img class="item-visual__photo" data-item-photo data-photo="${visual.photoId}" src="${url(visual.photoId)}" alt="${meaningful ? `Photo of ${item.name}` : ""}" width="160" height="160" loading="lazy" decoding="async" />` : ""}</span>`;
}
const thumbnailVersions = new Map<string, number>();
export const itemThumbnailUrl = (id: string, scope: "staff" | "public" = "public", size: "thumb" | "detail" = "thumb") =>
  `/api/${scope}/media/${id}/${size}?v=2${thumbnailVersions.has(id) ? `&r=${thumbnailVersions.get(id)}` : ""}`;

/** How many times a photo's cleaned picture changed under the same id, so a picture drawn from it again is fetched fresh. */
export const thumbnailVersion = (id: string): number => thumbnailVersions.get(id) ?? 0;

/** Refresh already-visible photos after changing a cutout without replacing its media id. */
export function refreshItemThumbnail(id: string): void {
  thumbnailVersions.set(id, (thumbnailVersions.get(id) ?? 0) + 1);
  for (const image of document.querySelectorAll<HTMLImageElement>("img")) {
    const path = new URL(image.src, location.href).pathname;
    for (const scope of ["staff", "public"] as const) {
      if (path === `/api/${scope}/media/${id}/thumb`) image.src = itemThumbnailUrl(id, scope);
      else if (path === `/api/${scope}/media/${id}/detail`) image.src = itemThumbnailUrl(id, scope, "detail");
    }
  }
}

export const thumbImg = (item: VisualItem & { photo?: string | null }): Html =>
  itemVisual({ ...item, photoId: item.photo }, itemThumbnailUrl, "item-thumb");

// Resource events do not bubble. Capture lets redraws share one fallback handler without per-row listeners.
document.addEventListener("load", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  // A cut-out on the item sheet's pedestal, and the photo just chosen while adding an item, are framed by the picture itself (photo-frame.ts).
  if (image.hasAttribute("data-pedestal")) return seatOnPedestal(image);
  if (image.parentElement?.classList.contains("cat-photo")) return frameByPhoto(image, image.parentElement);
  if (image.hasAttribute("data-item-photo")) {
    const frame = image.parentElement;
    frame?.classList.add("item-visual--loaded");
    // Every item picture takes its own background, and a cleaned one stands on a pedestal: staff pages, the Lending Hub and Self-Service.
    if (frame) frameByPhoto(image, frame);
    if (frame?.classList.contains("ss-item__visual")) {
      frame.style.setProperty("--item-photo-edge", `${Math.max(image.naturalWidth, image.naturalHeight) / (window.devicePixelRatio || 1)}px`);
    }
  }
}, true);
document.addEventListener("error", (event) => {
  const image = event.target;
  // A cut-out that cannot be fetched stands on the pedestal as its thumbnail instead, so the tile is never empty.
  if (image instanceof HTMLImageElement && image.hasAttribute("data-pedestal")) {
    image.removeAttribute("data-pedestal");
    if (image.dataset.fallback) image.src = image.dataset.fallback;
    image.parentElement?.classList.add("is-seated");
    return;
  }
  if (image instanceof HTMLImageElement && image.hasAttribute("data-item-photo")) {
    image.parentElement?.classList.remove("item-visual--loaded");
    if (image.parentElement) unframe(image.parentElement);
    if (image.parentElement?.classList.contains("ss-item__visual")) image.parentElement.style.removeProperty("--item-photo-edge");
    image.remove();
  }
}, true);

export function icon(name: IconName): Html {
  return raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICONS[name]}"/></svg>`);
}

/** A compact, native-popover action list. Its action buttons keep their existing delegated handlers. */
export function rowActionMenu(id: string, label: string, actions: Html): Html {
  return html`<span class="row-menu"><button class="button button--ghost button--sm row-menu__trigger" type="button" data-row-menu popovertarget="${id}" aria-controls="${id}" aria-expanded="false" aria-label="More actions for ${label}">${icon("more")}<span>More actions</span></button><div class="menu menu--row" id="${id}" popover><ul class="menu__list">${actions}</ul></div></span>`;
}

/** Keeps each row menu aligned with its opener, including the small no-Popover fallback. `data-row-menu="start"` opens it from the opener's left edge. */
export function bindRowActionMenus(scope: HTMLElement): void {
  const native = "showPopover" in HTMLElement.prototype;
  const triggers = [...scope.querySelectorAll<HTMLButtonElement>("[data-row-menu]")];
  const position = (trigger: HTMLButtonElement, menu: HTMLElement) => requestAnimationFrame(() => {
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gutter = 8;
    const left = Math.max(gutter, Math.min(trigger.dataset.rowMenu === "start" ? triggerRect.left : triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - gutter));
    const below = triggerRect.bottom + 4;
    const top = below + menuRect.height <= window.innerHeight - gutter ? below : Math.max(gutter, triggerRect.top - menuRect.height - 4);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  });
  for (const trigger of triggers) {
    const menu = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    if (!(menu instanceof HTMLElement)) continue;
    const expanded = (open: boolean) => trigger.setAttribute("aria-expanded", String(open));
    expanded(false);
    if (native) menu.addEventListener("toggle", (event) => {
      const open = (event as ToggleEvent).newState === "open";
      expanded(open);
      if (open) position(trigger, menu);
    });
    else {
      trigger.removeAttribute("popovertarget");
      trigger.parentElement?.classList.add("row-menu--fallback");
      menu.removeAttribute("popover");
      menu.classList.add("menu--row-fallback");
      menu.hidden = true;
      trigger.addEventListener("click", () => {
        const open = menu.hidden;
        scope.querySelectorAll<HTMLElement>(".menu--row:not([hidden])").forEach((other) => { other.hidden = true; scope.querySelector<HTMLButtonElement>(`[aria-controls="${other.id}"]`)?.setAttribute("aria-expanded", "false"); });
        menu.hidden = !open;
        expanded(open);
        if (open) position(trigger, menu);
      });
      menu.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        menu.hidden = true;
        expanded(false);
        trigger.focus();
      });
    }
  }
}

export const MARK = raw(`<img class="mark" src="/brand/dol-mark.png" alt="HAU USC Department of Logistics" width="183" height="163" />`);
/** The HAU University Student Council crest, shown beside the DOL mark on public pages. */
export const CREST = raw(`<img class="crest" src="/brand/hau-usc-crest.webp" alt="Holy Angel University Student Council" width="205" height="240" />`);

/* ---------- Routing and view lifecycle ---------- */

let leaveView: Array<() => void> = [];
/** Registers cleanup (timers, listeners) to run when the router leaves the current view. */
export function onLeave(cleanup: () => void): void { leaveView.push(cleanup); }
export function leave(): void { leaveView.forEach((cleanup) => cleanup()); leaveView = []; }

let queryOwner: (() => void) | null = null;
/**
 * Lets a view render its own query-string states (steps, open sheets) instead of being rebuilt
 * by the router, so back and forward move between them without a full re-render.
 */
export function ownQuery(handler: () => void): void {
  queryOwner = handler;
  onLeave(() => { if (queryOwner === handler) queryOwner = null; });
}
/** The router asks this first when only the query changed; false means "render the view". */
export function handOverQuery(): boolean {
  if (!queryOwner) return false;
  queryOwner();
  return true;
}

export function navigate(path: string, replace = false, state: object = {}): void {
  window.history[replace ? "replaceState" : "pushState"](state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** The address the current view rendered, or last mirrored into the URL: the router treats a popstate to it as no change. */
export const shown = { address: "" };

/** Mirrors view state (filters, sort, open item) into the query string without adding history entries. */
export function writeParams(values: Record<string, string | null | undefined>): void {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  shown.address = window.location.pathname + window.location.search;
}

/** Re-renders a live region while keeping keyboard focus on the same keyed row (its first `control`). */
export function preservingFocus(container: Element, render: () => void, control = "button"): void {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.closest<HTMLElement>("[data-key]")?.dataset.key : undefined;
  render();
  if (key) container.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] ${control}`)?.focus({ preventScroll: true });
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

export { units } from "./catalog-policy";

const quantities = new Intl.NumberFormat("en-PH");
export const formatQuantity = (value: number): string => quantities.format(value);
export const plural = (count: number, word: string): string => `${formatQuantity(count)} ${word}${count === 1 ? "" : "s"}`;

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
export function animateNumber(element: Element | null, to: number, from = Number(element?.textContent?.replace(/,/g, ""))): void {
  if (!element) return;
  if (!Number.isFinite(from) || from === to || reducedMotion()) { element.textContent = formatQuantity(to); return; }
  const start = performance.now();
  const duration = Math.min(700, 250 + Math.abs(to - from) * 30);
  element.textContent = formatQuantity(from);
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    element.textContent = formatQuantity(Math.round(from + (to - from) * (1 - (1 - progress) ** 3)));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Sheets ---------- */

/** The shared sheet frame: kicker, title, close button, scrolling body. */
/** `titleId` names the title for the dialog's aria-labelledby; a page with a second sheet gives that one its own. */
export function sheetContent(kicker: Html | string, title: string, body: Html, titleId = "sheet-title"): Html {
  return html`<header class="sheet__header">
      <div><p class="sheet__kicker">${kicker}</p><h2 id="${titleId}">${title}</h2></div>
      <button class="icon-button" type="button" aria-label="Close" data-close>${icon("close")}</button>
    </header>
    <div class="sheet__body">${body}</div>`;
}

export type Sheet = { open: (origin?: Element | null) => void; close: (force?: boolean) => void; discardOk: () => boolean };

/**
 * The one sheet behaviour (side panel on desktop, bottom sheet on phones): modal open,
 * Escape and backdrop close, an optional unsaved-changes guard, an exit animation, and
 * focus returned to whatever opened it.
 *
 * A caller that passes `origin` (the item profile passes its row) gets a side panel attached to it: the origin sets where the
 * panel grows from and where its notch points, as viewport coordinates in --origin-x/--origin-y, when it is still in view beside
 * the panel. Scrolling the page behind detaches it, so the notch never points at a row that has moved. Without an origin a
 * sheet opens as it always has, whatever control had focus.
 */
export function sheet(dialog: HTMLDialogElement, options: { dirty?: () => boolean; onClose?: () => void } = {}): Sheet {
  let opener: HTMLElement | null = null;
  const detach = () => { delete dialog.dataset.origin; };
  // Only an origin still in view beside the open panel (at least 3rem of it) gets the attachment; a phone's bottom sheet never does.
  const anchor = (origin: Element | null | undefined) => {
    const box = origin && origin !== document.body && !origin.closest("dialog") ? origin.getBoundingClientRect() : null;
    const visible = box ? Math.min(box.right, dialog.getBoundingClientRect().left) : 0;
    if (!box?.height || visible - box.left < 48) return detach();
    dialog.style.setProperty("--origin-x", `${Math.round((box.left + visible) / 2)}px`);
    dialog.style.setProperty("--origin-y", `${Math.round(box.top + box.height / 2)}px`);
    dialog.dataset.origin = "";
    document.addEventListener("scroll", detach, { once: true, passive: true });
  };
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
  // A file input inside the sheet also fires a bubbling "cancel" when its picker is dismissed; only Escape on the dialog itself closes it.
  dialog.addEventListener("cancel", (event) => { if (event.target !== dialog) return; event.preventDefault(); close(); });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || (event.target as HTMLElement).closest("[data-close]")) close();
  });
  dialog.addEventListener("close", () => {
    // onClose runs first so a caller can take back content it lent to the sheet.
    options.onClose?.();
    dialog.innerHTML = "";
    detach();
    document.removeEventListener("scroll", detach);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
  /*
   * Phones: a sheet comes up from the bottom with a handle, so it goes down the same way. Dragging its header moves the sheet with the
   * finger; let go far or fast enough and it closes as Close does (unsaved changes still ask first), otherwise it settles back.
   */
  const phone = window.matchMedia("(max-width: 760px)");
  dialog.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    if (!phone.matches || !event.isPrimary || event.button !== 0 || !target.closest(".sheet__header") || target.closest("button, a, input, select, textarea")) return;
    const startY = event.clientY;
    const startAt = event.timeStamp;
    let distance = 0;
    dialog.setPointerCapture(event.pointerId);
    dialog.style.transition = "none";
    const move = (moved: PointerEvent) => { distance = Math.max(0, moved.clientY - startY); dialog.style.transform = distance ? `translateY(${distance}px)` : ""; };
    const settle = (to: string, then?: () => void) => {
      const done = () => { window.clearTimeout(fallback); dialog.removeEventListener("transitionend", done); dialog.style.transition = ""; then?.(); };
      const fallback = window.setTimeout(done, 400);
      if (reducedMotion()) { dialog.style.transform = to; done(); return; }
      dialog.style.transition = "transform var(--dur-2) var(--ease)";
      dialog.addEventListener("transitionend", done);
      dialog.style.transform = to;
    };
    const end = (ended: PointerEvent) => {
      dialog.removeEventListener("pointermove", move);
      dialog.removeEventListener("pointerup", end);
      dialog.removeEventListener("pointercancel", end);
      const fast = distance > 40 && distance / Math.max(1, ended.timeStamp - startAt) > 0.6;
      if (ended.type === "pointerup" && (distance > Math.min(160, dialog.offsetHeight / 4) || fast) && discardOk()) {
        settle("translateY(100%)", () => { if (dialog.open) dialog.close(); dialog.style.transform = ""; });
      } else settle("");
    };
    dialog.addEventListener("pointermove", move);
    dialog.addEventListener("pointerup", end);
    dialog.addEventListener("pointercancel", end);
  });
  onLeave(() => { if (dialog.open) dialog.close(); });
  return {
    open: (origin) => {
      // Opening another record while the panel is up moves the notch to it; the panel itself stays.
      if (dialog.open) { if (origin) anchor(origin); return; }
      opener = document.activeElement as HTMLElement | null;
      dialog.showModal();
      anchor(origin);
    },
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

/** `level` follows the surrounding outline: 1 when it is the whole page, 3 inside a sheet or titled section. */
export function emptyState(title: string, detail: string, action: Html | string = "", tone: "" | "error" = "", level: 1 | 2 | 3 = 2): Html {
  return html`<div class="empty ${tone ? `empty--${tone}` : ""}">${icon(tone ? "alert" : "box")}<h${level}>${title}</h${level}><p>${detail}</p>${action}</div>`;
}

/* ---------- Photos ---------- */

const MAX_PHOTO_EDGE = 1600;

/**
 * Draws a decoded photo no larger than `edge` px on its long side and encodes it as JPEG. The bitmap is already
 * upright (decoded with `imageOrientation: "from-image"`), and a canvas carries no EXIF or location, so the
 * result is oriented and clean. Transparency lands on white, not black.
 */
export function jpegOf(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("encode")), "image/jpeg", quality));
}

/**
 * Shrinks a camera photo to at most 1600 px as JPEG (or `edge` at `quality`), so it uploads quickly on school Wi-Fi and
 * stays small on the phone. A browser that cannot decode it sends the original, up to `maxBytes`.
 */
export async function shrinkPhoto(file: File, maxBytes = 8 * 1024 * 1024, edge = MAX_PHOTO_EDGE, quality = 0.82): Promise<Blob> {
  let photo: Blob | null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try { photo = await jpegOf(bitmap, edge, quality); } finally { bitmap.close(); }
  } catch {
    photo = /^image\/(jpeg|png|webp)$/.test(file.type) ? file : null;
  }
  if (!photo) throw new Error("This photo could not be read. Take a new one, or choose a JPEG or PNG.");
  if (photo.size > maxBytes) throw new Error("This photo is too large. Take a new one.");
  return photo;
}

/** A data: URL for previews (the CSP allows data: images but not blob: URLs). */
export const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/* ---------- Data ---------- */

export class ApiError extends Error {
  /** `body` is the whole answer, for the few that carry more than a message (possible duplicates). */
  constructor(readonly status: number, message: string, readonly body: Record<string, unknown> = {}) { super(message); }
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
  if (!response.ok) throw new ApiError(response.status, body.error ?? "Something went wrong. Please try again.", body as Record<string, unknown>);
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

/**
 * Acknowledges a save the moment it is pressed: the form's submit buttons (or the one button given) go off and are marked busy until the write settles, so a
 * second tap cannot send it twice. The returned function puts them back, on success and on failure alike, and returns focus to
 * the button that had it (turning a button off drops its focus, so a failed save would otherwise leave the keyboard on the page).
 */
export function working(scope: ParentNode): () => void {
  const buttons = scope instanceof HTMLButtonElement ? (scope.disabled ? [] : [scope]) : [...scope.querySelectorAll<HTMLButtonElement>("button[type=submit]:not(:disabled)")];
  const focused = buttons.find((button) => button === document.activeElement);
  for (const button of buttons) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  return () => {
    for (const button of buttons) { button.disabled = false; button.removeAttribute("aria-busy"); }
    if (focused?.isConnected && (document.activeElement === document.body || !document.activeElement)) focused.focus({ preventScroll: true });
  };
}

export function setMessage(element: HTMLElement, message: string | Html, tone: "error" | "ok" | "" = "error"): void {
  element.className = `form-alert ${tone ? `form-alert--${tone}` : ""}`;
  element.hidden = !message;
  mount(element, message ? html`${icon(tone === "ok" ? "check" : "alert")}<span>${message}</span>` : html``);
}

/** `etag`: the version the caller already holds (a copy saved on the device), so an unchanged first answer is a 304 too. */
type LiveOptions<T> = { interval: number; onData: (data: T) => void; onError?: (error: ApiError) => void; status?: () => HTMLElement | null; etag?: string };

/** A poll that has not answered in this long counts as offline; the next one tries again. */
const LIVE_TIMEOUT = 15_000;
/** After this many checks in a row that found nothing new, an open view asks a third as often until something changes or the person acts. */
const QUIET_AFTER = 6;
const QUIET_SLOWDOWN = 3;

/**
 * Keeps a view current by polling an ETag'd endpoint. Unchanged data costs one
 * tiny 304; polling pauses while the tab is hidden and resumes on return.
 * One request is out at a time, so an older answer can never land after a newer
 * one; a refresh asked for meanwhile runs as soon as the current one ends, and
 * its promise resolves only after data fetched after the call has been applied.
 */
export function live<T>(url: string, options: LiveOptions<T>): { refresh: () => Promise<void>; stop: () => void } {
  let etag = options.etag ?? "";
  let timer = 0;
  let settle = 0;
  let stopped = false;
  let loaded = false;
  let sequence = 0;
  let accepted = 0;
  let running: Promise<void> | null = null;
  let again = false;
  let quiet = 0;
  let scheduled = false;
  let inFlight: AbortController | null = null;
  // The status names when this view last received changed data, not when it last asked.
  let changedAt = "";
  const setStatus = (state: "live" | "offline" | "updated") => {
    const element = options.status?.();
    if (!element) return;
    if (state === "live" && element.dataset.state === "updated") return;
    if (state === "offline") window.clearTimeout(settle);
    element.dataset.state = state;
    element.textContent = state === "offline" ? "Offline, retrying" : `Updated ${changedAt}`;
    element.title = `Last checked ${formatTime(new Date().toISOString())}`;
    if (state === "updated") {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { element.dataset.state = "live"; }, 4000);
    }
  };
  // One request. Answers false when polling must not continue (signed out, or stopped).
  const request = async (): Promise<boolean> => {
    const id = ++sequence;
    const abort = new AbortController();
    inFlight = abort;
    const limit = window.setTimeout(() => abort.abort(), LIVE_TIMEOUT);
    try {
      const response = await fetch(url, { credentials: "same-origin", headers: etag ? { "if-none-match": etag } : {}, signal: abort.signal });
      if (response.status === 200) {
        const data = await response.json() as T;
        if (stopped || id <= accepted) return !stopped;
        accepted = id;
        quiet = 0;
        etag = response.headers.get("etag") ?? "";
        changedAt = formatTime(new Date().toISOString());
        options.onData(data);
        if (loaded) setStatus("updated");
        loaded = true;
      } else if (response.status === 304) {
        quiet += 1;
      } else {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new ApiError(response.status, body.error ?? "Could not refresh.");
      }
      if (stopped) return false;
      setStatus("live");
      return true;
    } catch (error) {
      if (stopped) return false;
      const failure = error instanceof ApiError ? error : new ApiError(0, "Offline");
      setStatus("offline");
      options.onError?.(failure);
      return failure.status !== 401;
    } finally {
      window.clearTimeout(limit);
      if (inFlight === abort) inFlight = null;
    }
  };
  const tick = (): Promise<void> => {
    window.clearTimeout(timer);
    // Only the clock keeps the slow pace: a refresh the person or a save asked for, or coming back to the tab, asks at the normal pace again.
    if (!scheduled) quiet = 0;
    scheduled = false;
    if (stopped) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      let polling = true;
      do { again = false; polling = await request(); } while (again && polling && !stopped);
      running = null;
      window.clearTimeout(timer);
      if (polling && !stopped && document.visibilityState === "visible") timer = window.setTimeout(() => { scheduled = true; void tick(); }, quiet >= QUIET_AFTER ? options.interval * QUIET_SLOWDOWN : options.interval);
    })();
    return running;
  };
  const resume = () => { if (document.visibilityState === "visible") void tick(); };
  const stop = () => {
    stopped = true;
    inFlight?.abort();
    window.clearTimeout(timer);
    window.clearTimeout(settle);
    document.removeEventListener("visibilitychange", resume);
  };
  document.addEventListener("visibilitychange", resume);
  onLeave(stop);
  void tick();
  return { refresh: tick, stop };
}

/** What to tell someone whose device refused to keep a record: a full device is fixed by freeing space; anything else by leaving private browsing. Either way nothing typed is lost. */
export function keepFailure(error: unknown): string {
  const full = error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22);
  return full ? "This device is out of space, so the record was not saved. Free some space, then save again. What you typed is still here." : "This device could not save the record. Check that you're not in private browsing, then try again. What you typed is still here.";
}
