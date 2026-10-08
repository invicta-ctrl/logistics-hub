import "./id-card.css";
import { LANDED_MS, cardMotion, flyIn, flyOut, liftShadow } from "./card-motion";
import { DEPARTMENTS, type DepartmentCode } from "./directory-policy";
import { ISSUE_KINDS, type IssueKind, type Pair, type Preflight, preflight } from "./staff-import";
import { ApiError, type Html, api, dataUrl, failure, formatDateTime, html, icon, jpegOf, mount, navigate, onLeave, plural, reducedMotion, setMessage, toast } from "./ui";

/*
 * Official USC ID scans in the browser (Administration → Staff Directory): fetching them for one visit, a person's card large
 * (their details and both sides of the ID, turned over in 3D), turning a scan into what the Worker stores, the owner's
 * add/replace panel, and the archive import with its preflight.
 */

export type Side = "front" | "back";
export type Card = { mediaId: string; front: { width: number; height: number }; back: { width: number; height: number }; sourceFront: string | null; sourceBack: string | null; createdAt: string; createdBy: string | null };
type Who = { id: string; name: string; department: string };

/* ---------- Scans, for this visit only ---------- */

/**
 * A scan is kept in memory as a data: URL (the CSP allows data: images, not blob:), so the tile and the viewer share it and
 * flipping is instant. It is never written to a cache or to disk (the Worker answers no-store), the map is dropped when another
 * person's profile opens or the page is left, and an entry is fetched again after five minutes: the Worker records one opening
 * per viewer and card every ten, so a card opened again later is always recorded again.
 */
const KEEP_MS = 5 * 60_000;
/** A scan still not here after this long is given up on, so a stalled connection ends in a message and a retry, not a spinner. */
const SCAN_TIMEOUT_MS = 20_000;
const scans = new Map<string, { at: number; url: Promise<string> }>();
/** What a person reads when a scan cannot be opened: the Worker's own words, or a plain line for a network that did not answer. */
const scanFailure = (error: unknown): Error => error instanceof ApiError ? error
  : error instanceof DOMException && error.name === "TimeoutError" ? new Error("This scan is taking too long to open. Check your connection and try again.")
  : new Error("This scan could not be opened. Check your connection and try again.");
export function scan(personId: string, mediaId: string, side: Side): Promise<string> {
  const key = `${personId}/${mediaId}/${side}`;
  const kept = scans.get(key);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.url;
  const url = fetch(`/api/staff/admin/directory/${personId}/id/${side}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) }).then(async (response) => {
    if (!response.ok) throw new ApiError(response.status, response.status === 429 ? "Too many ID scans opened in a short time. Please wait a few minutes." : "This scan could not be opened.");
    return dataUrl(await response.blob());
  }).catch((error: unknown) => { throw scanFailure(error); });
  // A scan that failed is forgotten, so the next ask is a fresh try.
  url.catch(() => scans.delete(key));
  scans.set(key, { at: Date.now(), url });
  return url;
}
export const forgetScans = (): void => scans.clear();

/** How long a person's card details may take before the viewer gives up and says so. */
const CARD_TIMEOUT_MS = 15_000;
/** The work's answer, or an error with `message` once `ms` have passed. */
const within = <T>(work: Promise<T>, ms: number, message: string): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = window.setTimeout(() => reject(new Error(message)), ms);
  work.then(resolve, reject).finally(() => window.clearTimeout(timer));
});

/**
 * Fills the two ID tiles of a profile (`[data-open]` buttons holding an `img`): each side is fetched when its tile is near the
 * screen, the front first and the back once the front has settled (so the front is not slowed by a second download), with a
 * loading state meanwhile and, when a scan cannot be opened, the reason and a "Try again". Tiles are laid out at their scan's
 * shape first, so nothing moves when the picture arrives.
 */
export function fillTiles(host: HTMLElement, personId: string, card: Card): void {
  const frontSettled: { done: Promise<void> | null } = { done: null };
  const load = (button: HTMLElement) => {
    const side = button.dataset.open as Side;
    const figure = button.closest("figure")!;
    const failedNote = figure.querySelector(".id-tile__failed");
    // "Try again" goes with its note, so focus moves to the tile first rather than falling to the page.
    if (failedNote?.contains(document.activeElement)) button.focus({ preventScroll: true });
    failedNote?.remove();
    button.classList.add("is-loading");
    const after = side === "back" ? frontSettled.done ?? Promise.resolve() : Promise.resolve();
    const done = after.then(() => scan(personId, card.mediaId, side)).then((url) => {
      button.querySelector("img")!.src = url;
      button.classList.remove("is-loading");
    }, (error: unknown) => {
      button.classList.remove("is-loading");
      const note = document.createElement("div");
      note.className = "id-tile__failed";
      note.setAttribute("role", "alert");
      mount(note, html`<p class="form-alert form-alert--error">${icon("alert")}<span>${failure(error)}</span></p><button type="button" class="button button--secondary button--sm">Try again</button>`);
      note.querySelector("button")!.addEventListener("click", () => load(button));
      figure.append(note);
    });
    if (side === "front") frontSettled.done = done;
  };
  const tiles = [...host.querySelectorAll<HTMLElement>("[data-open]")];
  if (!("IntersectionObserver" in window)) return tiles.forEach(load);
  const watcher = new IntersectionObserver((seen) => {
    for (const entry of seen) if (entry.isIntersecting) { watcher.unobserve(entry.target); load(entry.target as HTMLElement); }
  }, { rootMargin: "240px" });
  tiles.forEach((tile) => watcher.observe(tile));
  onLeave(() => watcher.disconnect());
}

/* ---------- The card, large ---------- */

const MAX_ZOOM = 4;
/** The directory's own card has the shape of the USC ID (1545 × 2000), so drawn cards and scanned ones line up on the wall. */
export const CARD_RATIO = 1545 / 2000;
/** The details are read from a taller card (ID-1 upright), which holds them on a phone without scrolling. */
const DETAILS_RATIO = 53.98 / 85.6;

/** What the card shows: the person's USC ID, one card with its front and back that turns over (Earl, 2026-10-03), or their details. */
export type View = "profile" | "details";
/** What a face can hold: a side of the ID, the details, or the wall's own picture of the card (the tile) while it flies. */
type Content = Side | "details" | "cover";
const VIEWS: View[] = ["profile", "details"];
const viewOf = (content: Content): View => content === "details" ? "details" : "profile";
/** A tile says which face it shows: "cover", a view, or a side; the profile is the ID's front. */
const tileFace = (shows: string | undefined, fallback: Content): Content => shows === "profile" ? "front" : (shows as Content | undefined) ?? fallback;

export type Opening = {
  /** What it opens on. */
  start: View;
  /** The directory card's front, as a fresh element: what a directory tile shows, so the card leaves and lands on it. */
  cover: () => HTMLElement;
  /** The person's details for the reverse. Links in it marked data-leave close the card and go where they point. */
  details: HTMLElement;
  /** The scans: null when none are on file; a function loads them the first time the profile is shown. */
  card: Card | null | (() => Promise<Card | null>);
  /** Whether a USC ID is on file, so the sides can be offered before the scans are loaded. */
  hasId: boolean;
  /** The tile the card flies from and back into for a view, if any; its data-shows says which face it is ("cover" or a view). */
  tileFor: (view: View) => HTMLElement | null;
};

/**
 * A person's card, large, over everything, in 3D (src/card-motion.ts). It flies out of its tile turning, lands on what was asked
 * for, leans toward the pointer or a finger under a glare and a holographic sheen, presses in when held, and turns over on a
 * spring between their profile (both sides of their USC ID together) and their details: each turn brings the other view onto
 * the face underneath. Closing flies it back into its tile, turning to the face the tile shows. It rests flat and unlit, lies
 * still while zoomed, and does none of this under reduced motion. The profile zooms up to 4× with the wheel, a pinch, a
 * double-click or + and −, and pans by dragging or with the arrow keys. The scans are fetched when the profile is shown, and
 * that opening is recorded by the Worker. A modal dialog gives Escape, a focus trap and an inert page; Back closes it (it
 * holds a history entry); focus returns to its opener.
 */
export async function openCard(person: Who, opening: Opening): Promise<void> {
  if (document.querySelector("dialog.id-viewer")) return;
  const opener = document.activeElement as HTMLElement | null;
  const department = DEPARTMENTS[person.department as DepartmentCode] ?? person.department;
  const dialog = document.createElement("dialog");
  dialog.className = "id-viewer";
  dialog.setAttribute("aria-label", `USC ID of ${person.name}`);
  const face = (which: "front" | "back") => html`<div class="id-card__face id-card__face--${which}"><div class="id-card__slot" data-slot></div><span class="id-card__shine" aria-hidden="true"></span><span class="id-card__glare" aria-hidden="true"></span></div>`;
  mount(dialog, html`<header class="id-viewer__bar">
      <p class="id-viewer__title"><strong>${person.name}</strong><span>${department} · USC ID</span></p>
      <div class="id-viewer__sides" role="group" aria-label="View" ${opening.hasId ? "" : html`hidden`}>
        <button type="button" data-view="profile">Profile</button><button type="button" data-view="details">Details</button>
      </div>
      <button type="button" class="button button--sm id-viewer__flip" data-flip>Turn over</button>
      <div class="id-viewer__zoom" role="group" aria-label="Zoom">
        <button type="button" class="icon-button" data-zoom="out" aria-label="Zoom out"><span aria-hidden="true">−</span></button>
        <output class="id-viewer__level" aria-live="polite">100%</output>
        <button type="button" class="icon-button" data-zoom="in" aria-label="Zoom in">${icon("plus")}</button>
        <button type="button" class="button button--sm id-viewer__fit" data-zoom="fit">Fit</button>
      </div>
      <button class="icon-button id-viewer__close" type="button" data-close aria-label="Close card">${icon("close")}</button>
    </header>
    <div class="id-viewer__stage" data-stage><div class="id-viewer__pan" data-pan><div class="id-card__flight" data-flight><div class="id-card" data-card>${face("front")}${face("back")}</div></div></div></div>
    <p class="id-viewer__hint">${reducedMotion() ? "" : "Move over the card or drag it to tilt it · "}${opening.hasId ? "Tap the card or press F to turn it over · P and D switch between the profile and the details · + and − zoom · " : ""}Esc closes.${opening.hasId ? " Opening a USC ID is recorded in Activity." : ""}</p>`);
  document.body.append(dialog);
  const stage = dialog.querySelector<HTMLElement>("[data-stage]")!;
  const pan = dialog.querySelector<HTMLElement>("[data-pan]")!;
  const flight = dialog.querySelector<HTMLElement>("[data-flight]")!;
  const cardBox = dialog.querySelector<HTMLElement>("[data-card]")!;
  const level = dialog.querySelector("output")!;
  const zoomGroup = dialog.querySelector<HTMLElement>(".id-viewer__zoom")!;
  const flipButton = dialog.querySelector<HTMLButtonElement>("[data-flip]")!;
  const faces = [...dialog.querySelectorAll<HTMLElement>(".id-card__face")] as [HTMLElement, HTMLElement];
  const motion = cardMotion(cardBox);

  /* What goes on the faces: one element per content, moved between the two faces as the card turns. */
  let card: Card | null = typeof opening.card === "function" ? null : opening.card;
  let cardLoad: Promise<Card | null> | null = typeof opening.card === "function" ? null : Promise.resolve(card);
  const loadCard = () => cardLoad ??= (opening.card as () => Promise<Card | null>)().then((loaded) => (card = loaded), (error: unknown) => { cardLoad = null; throw error; });
  // The profile is the ID itself: each side its own picture, loaded once, the first time the profile is shown.
  const scanFace = (side: Side) => {
    const holder = document.createElement("div");
    holder.className = "id-card__scan is-loading";
    const image = Object.assign(document.createElement("img"), { alt: `${side === "front" ? "Front" : "Back"} of ${person.name}'s USC ID`, draggable: false });
    image.dataset.face = side;
    // Shown instead of the picture when the scan cannot be opened; "Try again" asks for it afresh.
    const failed = document.createElement("div");
    failed.className = "id-card__failed";
    failed.hidden = true;
    failed.setAttribute("role", "alert");
    const message = document.createElement("p");
    const retry = Object.assign(document.createElement("button"), { type: "button", className: "button button--sm", textContent: "Try again" });
    retry.dataset.retry = side;
    failed.append(message, retry);
    holder.append(image, failed);
    return { holder, image, failed, message, ready: null as Promise<void> | null };
  };
  const sides = { front: scanFace("front"), back: scanFace("back") };
  const cover = opening.cover();
  const element = (content: Content) => content === "details" ? opening.details : content === "cover" ? cover : sides[content].holder;
  /** Fetches a side's scan once (the Worker records the opening) and resolves when it can be drawn. */
  const loadSide = (side: Side) => sides[side].ready ??= loadCard().then((loaded) => {
    if (!loaded) throw new Error("No USC ID is on file.");
    return scan(person.id, loaded.mediaId, side);
  }).then(async (url) => {
    sides[side].image.src = url;
    await sides[side].image.decode().catch(() => undefined);
    sides[side].holder.classList.remove("is-loading", "is-failed");
    sides[side].failed.hidden = true;
  }, (error: unknown) => {
    const failed = sides[side];
    failed.ready = null;
    failed.message.textContent = failure(error);
    failed.holder.classList.remove("is-loading");
    failed.holder.classList.add("is-failed");
    failed.failed.hidden = false;
    throw error;
  });
  /** Asks again for a side that could not be opened; the card shows its loading state until the answer. */
  const retrySide = (side: Side) => {
    // "Try again" is hidden with its note, so focus stays in the viewer instead of falling to the page.
    if (sides[side].failed.contains(document.activeElement)) (flipButton.hidden ? dialog.querySelector<HTMLElement>("button:not([hidden]):not(:disabled)") : flipButton)?.focus({ preventScroll: true });
    sides[side].failed.hidden = true;
    sides[side].holder.classList.remove("is-failed");
    sides[side].holder.classList.add("is-loading");
    void loadSide(side).then(side === "front" ? warmBack : undefined, () => undefined);
  };
  /** The back is fetched once the front has landed, so it turns over at once without sharing the first download. */
  const warmBack = () => void loadSide("back").catch(() => undefined);
  const ratio = (content: Content) => (content === "front" || content === "back") && card ? card[content].width / card[content].height : content === "details" ? DETAILS_RATIO : CARD_RATIO;

  // The card's turn, in degrees: always a multiple of 180, so one face is up.
  let angle = 0;
  const up = () => faces[(((angle / 180) % 2) + 2) % 2]!;
  const under = () => faces[(((angle / 180) % 2) + 2) % 2 === 0 ? 1 : 0]!;
  const place = (content: Content, target: HTMLElement) => {
    target.querySelector("[data-slot]")!.replaceChildren(element(content));
    target.dataset.holds = content;
  };
  const settleFaces = () => {
    // Only the face that is up can be read or reached: the other is hidden from assistive technology and from Tab.
    for (const which of faces) {
      const hidden = which !== up();
      which.setAttribute("aria-hidden", String(hidden));
      which.inert = hidden;
    }
  };

  // What the face that is up shows, and the side of the ID the profile last showed.
  let shown: Content = opening.start === "details" ? "details" : "front";
  let side: Side = "front";
  const current = () => viewOf(shown);
  let view = { scale: 1, x: 0, y: 0 };
  // While the card flies in or out it takes no other input.
  let flying = false;
  let closing = false;
  const zoomable = () => current() === "profile";

  const clamp = () => {
    // The flight box is never tilted, so it measures the card as laid out (and zoomed).
    const box = flight.getBoundingClientRect();
    const [width, height] = [box.width / view.scale, box.height / view.scale];
    const limit = (size: number, viewport: number) => Math.max(0, (size * view.scale - viewport) / 2 + size * 0.05);
    view.x = Math.max(-limit(width, stage.clientWidth), Math.min(limit(width, stage.clientWidth), view.x));
    view.y = Math.max(-limit(height, stage.clientHeight), Math.min(limit(height, stage.clientHeight), view.y));
  };
  const apply = (animate = false) => {
    if (view.scale <= 1) view = { scale: 1, x: 0, y: 0 };
    else { clamp(); motion.still(); }
    pan.classList.toggle("is-animating", animate && !reducedMotion());
    pan.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    level.textContent = `${Math.round(view.scale * 100)}%`;
    stage.classList.toggle("is-zoomed", view.scale > 1);
  };
  /** Zooms a side to `scale`, keeping the point under (cx, cy) (stage coordinates from its centre) where it is. */
  const zoomTo = (scale: number, cx = 0, cy = 0, animate = true) => {
    if (!zoomable()) return;
    const next = Math.max(1, Math.min(MAX_ZOOM, scale));
    view = { scale: next, x: cx - (cx - view.x) * (next / view.scale), y: cy - (cy - view.y) * (next / view.scale) };
    apply(animate);
  };
  const fromCentre = (event: { clientX: number; clientY: number }) => {
    const box = stage.getBoundingClientRect();
    return [event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2] as const;
  };

  const marks = () => {
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("[data-view]")];
    const focused = buttons.includes(document.activeElement as HTMLButtonElement);
    buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === current())));
    // Turning the card by key keeps the focus on the view now shown, so the ring never points at another one.
    if (focused) buttons.find((button) => button.dataset.view === current())!.focus();
    // A control that hides while it has the focus hands it to the view now shown, so keys keep reaching the card.
    const lost = !zoomable() && (flipButton.contains(document.activeElement) || zoomGroup.contains(document.activeElement));
    zoomGroup.hidden = !zoomable();
    flipButton.hidden = !zoomable();
    if (lost) buttons.find((button) => button.dataset.view === current())?.focus();
    flipButton.setAttribute("aria-label", `Turn over to the ${shown === "back" ? "front" : "back"}`);
    cardBox.dataset.view = current();
    cardBox.dataset.side = shown;
  };

  let asked = 0;
  /** Turns the card over to `next`: forward (the way a card is turned) or back. */
  const turnTo = async (next: Content, forward: boolean, animate = true) => {
    if (next === shown || closing) return;
    const ask = ++asked;
    if (next === "front" || next === "back") {
      try {
        // A side appears once it can be drawn, or after a short wait with its loading state.
        await Promise.race([loadSide(next), new Promise((resolve) => window.setTimeout(resolve, 600))]);
      } catch (error) { toast(failure(error), "error"); return; }
      if (ask !== asked || closing) return;
      side = next;
    }
    shown = next;
    place(next, under());
    angle += forward ? 180 : -180;
    if (ratio(next) !== Number(flight.style.getPropertyValue("--ratio"))) {
      flight.classList.add("is-reshaping");
      window.setTimeout(() => flight.classList.remove("is-reshaping"), 420);
    }
    flight.style.setProperty("--ratio", String(ratio(next)));
    motion.turn(angle, animate);
    settleFaces();
    view = { scale: 1, x: 0, y: 0 };
    apply(true);
    marks();
  };
  /** The profile (the side of the ID it last showed) or the details. */
  const show = (next: View) => next === current() ? undefined : turnTo(next === "details" ? "details" : side, next === "details");
  /** Turns the ID over: front to back, back to front. */
  const flip = () => { if (current() === "profile") void turnTo(shown === "back" ? "front" : "back", true); };

  // Laid out on the face that is up, with what the tile shows underneath, so the card can leave the tile showing it.
  const tile = opening.tileFor(current());
  const leaves = tileFace(tile?.dataset.shows, shown);
  place(shown, faces[0]);
  // Underneath: what the tile shows, or else the ID's back (so it shows as the card turns in flight), or the drawn card.
  const other: Content = leaves !== shown ? leaves : shown === "details" ? "cover" : "back";
  place(other, faces[1]);
  if (shown !== "details") {
    // The tile says at once that the tap was taken; a card that does not come within the limit ends in a message, and a second tap asks again.
    tile?.setAttribute("aria-busy", "true");
    try { await within(loadCard(), CARD_TIMEOUT_MS, "The card is taking too long to open. Check your connection and try again."); }
    catch (error) { cardLoad = null; toast(failure(error), "error"); dialog.remove(); return; }
    finally { tile?.removeAttribute("aria-busy"); }
    // The front first, then the back, so on a slow connection the first look is not shared with a second download.
    const front = loadSide("front");
    void front.then(warmBack, () => undefined);
    // A failed side says so on the card itself, with its own "Try again".
    await Promise.race([front.catch(() => undefined), new Promise((resolve) => window.setTimeout(resolve, 600))]);
  }
  flight.style.setProperty("--ratio", String(ratio(shown)));
  motion.turn(0, false);
  settleFaces();
  marks();

  const bar = dialog.querySelector<HTMLElement>(".id-viewer__bar")!;
  const hint = dialog.querySelector<HTMLElement>(".id-viewer__hint")!;
  const shade = (from: number, to: number, duration: number) => dialog.animate([{ backgroundColor: `rgb(12 10 9 / ${from}%)` }, { backgroundColor: `rgb(12 10 9 / ${to}%)` }], { duration, easing: "ease-out", fill: "forwards" });
  const chrome = (show: boolean) => [bar, hint].map((part) => part.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
    { duration: show ? 240 : 90, delay: show ? 300 : 0, easing: "ease-out", direction: show ? "normal" : "reverse", fill: show ? "backwards" : "forwards" }));

  let entryGone = false;
  let leaveTo: string | null = null;
  /** Flies the card back into the tile of what it shows, turning to the tile's face if it shows another (or shrinks it away), then closes. */
  const closeViewer = () => {
    if (closing || !dialog.open) return;
    closing = true;
    const back = opening.tileFor(current());
    if (reducedMotion() || flying) { dialog.close(); return; }
    view = { scale: 1, x: 0, y: 0 };
    apply();
    motion.still();
    const lands = tileFace(back?.dataset.shows, shown);
    let spin = 0;
    if (lands !== shown) {
      place(lands, under());
      flight.style.setProperty("--ratio", String(ratio(lands)));
      spin = 180;
    }
    back?.classList.add("is-away");
    const out = flyOut(flight, back?.isConnected ? back.getBoundingClientRect() : null, spin);
    const done = [out, shade(99, 0, 300), ...chrome(false), ...liftShadow(faces, true, Number(out.effect?.getTiming().duration) || 300)];
    void Promise.all(done.map((animation) => animation.finished)).catch(() => undefined).then(() => dialog.close());
  };
  const onBack = () => { entryGone = true; closeViewer(); };
  dialog.addEventListener("close", () => {
    motion.stop();
    for (const which of VIEWS) opening.tileFor(which)?.classList.remove("is-away");
    window.removeEventListener("popstate", onBack);
    dialog.remove();
    const to = leaveTo;
    if (!entryGone && window.history.state?.viewer) {
      // Give back the card's own history entry first, then go on, so Back from there returns to the directory.
      if (to) window.addEventListener("popstate", () => navigate(to), { once: true });
      window.history.back();
    } else if (to) navigate(to);
    if (!to && opener?.isConnected) opener.focus({ preventScroll: true });
  });
  // Escape flies the card back too, rather than dropping it.
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeViewer(); });
  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const leave = target.closest<HTMLAnchorElement>("a[data-leave]");
    if (leave && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      leaveTo = leave.pathname + leave.search;
      closing = true;
      dialog.close();
      return;
    }
    if (target.closest("[data-close]")) closeViewer();
    const retry = target.closest<HTMLElement>("[data-retry]")?.dataset.retry;
    if (retry === "front" || retry === "back") retrySide(retry);
    if (target.closest("[data-flip]")) flip();
    const viewButton = target.closest<HTMLButtonElement>("[data-view]");
    if (viewButton) void show(viewButton.dataset.view as View);
    const zoom = target.closest<HTMLButtonElement>("[data-zoom]")?.dataset.zoom;
    if (zoom === "in") zoomTo(view.scale * 1.5);
    if (zoom === "out") zoomTo(view.scale / 1.5);
    if (zoom === "fit") zoomTo(1);
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLElement && event.target.matches("button, a[href]") && (event.key === "Enter" || event.key === " ")) return;
    const step = 60;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const key = event.key.toLowerCase();
    if (opening.hasId && (key === "p" || key === "d")) void show(key === "p" ? "profile" : "details");
    else if (key === "f" && current() === "profile") flip();
    else if (event.key === "+" || event.key === "=") zoomTo(view.scale * 1.5);
    else if (event.key === "-") zoomTo(view.scale / 1.5);
    else if (event.key === "0") zoomTo(1);
    else if (moves[event.key] && view.scale > 1) { view.x += moves[event.key]![0]; view.y += moves[event.key]![1]; apply(true); }
    // Left and right turn the ID over, as a hand would.
    else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && view.scale === 1 && current() === "profile") flip();
    else return;
    event.preventDefault();
  });
  stage.addEventListener("wheel", (event) => {
    // On the details the wheel scrolls them, if they are longer than the card.
    if (!zoomable()) return;
    event.preventDefault();
    const [cx, cy] = fromCentre(event);
    zoomTo(view.scale * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015)), cx, cy, false);
  }, { passive: false });
  // One finger or the mouse drags a zoomed side; two fingers pinch. At 100% the card leans toward the mouse (or a finger held on it).
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; scale: number } | null = null;
  const distance = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y); };
  const tilts = () => view.scale === 1 && !pinch && !flying && !closing;
  /** Where the pointer is across the card (0–1 each), or null when it is off the card. */
  const across = (event: PointerEvent) => {
    const box = flight.getBoundingClientRect();
    const [x, y] = [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [x, y] as const : null;
  };
  // A tap on the ID (a press that hardly moves and is let go soon) turns it over.
  let tap: { id: number; x: number; y: number; at: number } | null = null;
  stage.addEventListener("pointerdown", (event) => {
    // A link or button on the details is pressed like any other: captured, its click would land on the stage instead.
    if ((event.target as HTMLElement).closest("a[href], button")) return;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    tap = pointers.size === 1 && across(event) && view.scale === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now() } : null;
    if (pointers.size === 2 && zoomable()) { tap = null; pinch = { distance: distance(), scale: view.scale }; motion.rest(); return; }
    const point = across(event);
    if (point && tilts()) { motion.press(true); motion.point(...point); }
  });
  stage.addEventListener("pointermove", (event) => {
    const last = pointers.get(event.pointerId);
    if (last) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const [cx, cy] = fromCentre({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 });
      zoomTo(pinch.scale * distance() / pinch.distance, cx, cy, false);
    } else if (last && view.scale > 1) {
      view.x += event.clientX - last.x;
      view.y += event.clientY - last.y;
      apply();
    } else if (tilts() && (event.pointerType === "mouse" || last)) {
      // A finger dragged off the card keeps it leaning toward the nearest edge; the mouse leaving it lets go.
      const point = across(event);
      if (point) motion.point(...point);
      else if (event.pointerType !== "mouse") { const box = flight.getBoundingClientRect(); motion.point((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height); }
      else motion.rest();
    }
  });
  const release = (event: PointerEvent) => {
    const tapped = event.type === "pointerup" && tap?.id === event.pointerId && pointers.size === 1 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 10 && Date.now() - tap.at < 450;
    tap = null;
    if (tapped && current() === "profile") flip();
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    motion.press(false);
    if (event.pointerType !== "mouse" || !across(event)) motion.rest();
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse") motion.rest(); });

  window.history.pushState({ viewer: true }, "");
  window.addEventListener("popstate", onBack);
  dialog.showModal();
  (dialog.querySelector<HTMLButtonElement>(`[data-view="${current}"]:not([hidden] *)`) ?? dialog.querySelector<HTMLElement>("[data-close]")!).focus();
  if (reducedMotion()) return;
  // The card leaves its tile: the tile empties, the page darkens, and the card flies in turning (one and a half turns when it
  // lands on another face than the tile's), then catches the light.
  flying = true;
  tile?.classList.add("is-away");
  const landing = flyIn(flight, tile?.isConnected ? tile.getBoundingClientRect() : null, leaves !== shown ? -540 : -360);
  // Darker than the static viewer's 97%, because its backdrop stays clear while the card flies (src/styles.css).
  shade(0, 99, 320);
  chrome(true);
  liftShadow(faces, false, 420);
  // Landed once it is 95% of the way (the spring's last settling shows no movement): take input, and let the light sweep over it.
  let landed = false;
  const land = () => { if (landed) return; landed = true; flying = false; if (!closing && dialog.open) motion.sweep(); };
  const early = window.setTimeout(land, LANDED_MS);
  void landing.finished.catch(() => undefined).then(() => {
    window.clearTimeout(early);
    land();
    if (!closing) tile?.classList.remove("is-away");
  });
}

/* ---------- The wall's thumbnail and the profile picture ---------- */

/**
 * Where the photo sits on the back of the USC ID (2026–27 design, 1545 × 2000 px), as fractions of the card: measured on
 * the issued cards. A fixed place on a fixed design, not a search for a face. A back of another shape gets no profile picture.
 */
export const PHOTO_AREA = { x: 40 / 1545, y: 710 / 2000, w: 394 / 1545, h: 396 / 2000 } as const;
const USC_ID_RATIO = 1545 / 2000;
const THUMB_EDGE = 720;
const FACE_EDGE = 360;

function cropJpeg(bitmap: ImageBitmap, area: typeof PHOTO_AREA, edge: number): Promise<Blob> {
  const [sx, sy, sw, sh] = [area.x * bitmap.width, area.y * bitmap.height, area.w * bitmap.width, area.h * bitmap.height];
  const scale = Math.min(1, edge / Math.max(sw, sh));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(sw * scale), height: Math.round(sh * scale) });
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("encode")), "image/jpeg", 0.86));
}

/** The front small, for the directory wall, and the photo cut from the back, for the profile picture (when the back is a USC ID). */
export async function deriveImages(front: Blob, back: Blob): Promise<{ thumb: Blob; face: Blob | null }> {
  const [frontBitmap, backBitmap] = await Promise.all([createImageBitmap(front), createImageBitmap(back)]);
  try {
    const usc = Math.abs(backBitmap.width / backBitmap.height - USC_ID_RATIO) < 0.03;
    return { thumb: await jpegOf(frontBitmap, THUMB_EDGE, 0.82), face: usc ? await cropJpeg(backBitmap, PHOTO_AREA, FACE_EDGE) : null };
  } finally { frontBitmap.close(); backBitmap.close(); }
}

/** Both scans as the Worker stores them, with the thumbnail and profile picture made from them. */
async function addScans(form: FormData, front: File, back: File): Promise<void> {
  const [prepared, preparedBack] = [await prepareScan(front), await prepareScan(back)];
  form.set("front", prepared.blob, "front.jpg");
  form.set("back", preparedBack.blob, "back.jpg");
  const derived = await deriveImages(prepared.blob, preparedBack.blob);
  form.set("thumb", derived.thumb, "thumb.jpg");
  if (derived.face) form.set("face", derived.face, "face.jpg");
}

/**
 * Makes the missing thumbnails and profile pictures (owner): each card is opened once (recorded, as any opening), the two
 * small images are made here and stored beside the scans. Stops at the first refusal, so it can be run again later.
 */
export async function makeMissingImages(missing: Array<{ id: string; mediaId: string }>, progress: (done: number) => void): Promise<number> {
  let done = 0;
  for (const card of missing) {
    const side = (which: Side) => fetch(`/api/staff/admin/directory/${card.id}/id/${which}?derive=1`, { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new ApiError(response.status, response.status === 429 ? "Too many ID scans opened in a short time. Wait a few minutes, then continue." : "A scan could not be opened.");
      return response.blob();
    });
    const derived = await deriveImages(await side("front"), await side("back"));
    const form = new FormData();
    form.set("expected", card.mediaId);
    form.set("thumb", derived.thumb, "thumb.jpg");
    if (derived.face) form.set("face", derived.face, "face.jpg");
    await api(`/api/staff/admin/directory/${card.id}/id/derived`, { method: "PUT", body: form });
    progress(++done);
  }
  return done;
}

/* ---------- Preparing a scan ---------- */

const SCAN_EDGE = 2000;
/** The Worker refuses a scan over 1.5 MB, so a detailed one is re-encoded harder before it is sent. */
const SCAN_QUALITIES = [0.88, 0.8, 0.7, 0.6];

/**
 * A scan as the Worker stores it: decoded (rotation applied to the pixels), at most 2000 px on its long side, re-encoded as JPEG
 * on a canvas, so no metadata of the original file travels. The original never leaves the device.
 */
export async function prepareScan(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error(`${file.name} could not be read as an image.`); }
  try {
    let blob = await jpegOf(bitmap, SCAN_EDGE, SCAN_QUALITIES[0]!);
    for (const quality of SCAN_QUALITIES.slice(1)) if (blob.size > 1_400_000) blob = await jpegOf(bitmap, SCAN_EDGE, quality);
    const scale = Math.min(1, SCAN_EDGE / Math.max(bitmap.width, bitmap.height));
    return { blob, width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) };
  } finally { bitmap.close(); }
}

/* ---------- Owner: add or replace one person's scans ---------- */

/**
 * Two pickers (front, back) with previews; nothing is sent until Save. `expected` is the card the owner is looking at
 * (null for none), so a change someone else made meanwhile is never overwritten.
 */
export function cardForm(host: HTMLElement, person: Who, expected: string | null, onSaved: () => Promise<void>, onCancel: () => void): void {
  const chosen: Partial<Record<Side, { file: File; preview: string }>> = {};
  const pick = (which: Side) => html`<div class="scan-pick">
      <label class="scan-pick__tile" for="pick-${which}">${chosen[which] ? html`<img src="${chosen[which]!.preview}" alt="Chosen ${which} scan" />` : html`${icon("camera")}<span>Choose the ${which}</span>`}</label>
      <input class="visually-hidden" id="pick-${which}" type="file" accept="image/png,image/jpeg,image/webp" data-pick="${which}" />
      <p class="field__hint">${chosen[which]?.file.name ?? `${which === "front" ? "Front" : "Back"} of the card`}</p></div>`;
  const draw = (busy = false) => mount(host, html`<form class="form scan-form" novalidate>
      <p class="field__hint">${expected ? "The new scans replace the current ones for good." : "Add both sides of the official USC ID."} PNG, JPEG or WebP; it is re-encoded on this device before upload.</p>
      <div class="scan-picks">${pick("front")}${pick("back")}</div>
      <div class="form-alert" role="alert" hidden data-alert></div>
      <div class="form-actions form-actions--start"><button class="button button--primary" type="submit" ${busy || !chosen.front || !chosen.back ? "disabled" : ""}>${busy ? "Saving…" : "Save scans"}</button>
      <button class="button button--ghost" type="button" data-cancel ${busy ? "disabled" : ""}>Cancel</button></div></form>`);
  draw();
  host.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    const which = input.dataset.pick as Side | undefined;
    const file = input.files?.[0];
    if (!which || !file) return;
    chosen[which] = { file, preview: await dataUrl(file) };
    draw();
    host.querySelector<HTMLElement>(`label[for="pick-${which}"]`)?.focus();
  });
  host.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest("[data-cancel]")) onCancel(); });
  host.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!chosen.front || !chosen.back) return;
    draw(true);
    try {
      const form = new FormData();
      await addScans(form, chosen.front.file, chosen.back.file);
      form.set("sourceFront", chosen.front.file.name);
      form.set("sourceBack", chosen.back.file.name);
      form.set("expected", expected ?? "");
      await api(`/api/staff/admin/directory/${person.id}/id`, { method: "PUT", body: form });
      toast(expected ? "ID scans replaced." : "ID scans added.");
      await onSaved();
    } catch (error) {
      draw();
      setMessage(host.querySelector<HTMLElement>("[data-alert]")!, failure(error));
    }
  });
}

/* ---------- Owner: import an archive ---------- */

type Existing = Map<string, { hasId: boolean }>;
type Outcome = { pair: Pair; status: "waiting" | "working" | "imported" | "exists" | "failed"; message?: string };

const hashOf = async (file: File) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const departmentName = (code: string) => DEPARTMENTS[code as DepartmentCode] ?? code;

/**
 * The import, in the sheet `host`: choose the downloaded Official IDs folder (or files) → a preflight that reads only names and
 * hashes on this device → the owner reviews it → only the complete, unambiguous pairs not already in the directory are sent,
 * one at a time. Everything else stays on the device, listed for a person to sort out.
 */
export function importArchive(host: HTMLElement, existing: Existing, done: () => Promise<void>): void {
  let files = new Map<string, File>();
  let report: Preflight | null = null;
  let outcomes: Outcome[] = [];
  let running = false;

  const choose = () => mount(host, html`<div class="import">
      <p>Download the <strong>Official IDs</strong> folder from Google Drive and unzip it, then choose that folder here. You can also choose scan files directly.</p>
      <ul class="import__rules">
        <li>Scans are paired by name, department code and side (<span class="mono">Name_Front_DoL.png</span>, <span class="mono">Name_Back_DoL.png</span>); never by surname alone.</li>
        <li>Files in <span class="mono">OFFICERS</span> keep the department in their name, with officer status beside it.</li>
        <li>Nothing is uploaded until you have reviewed the check and pressed Import. Scans that need a person to look at them are left out.</li>
      </ul>
      <div class="form-actions form-actions--start">
        <label class="button button--primary" for="import-folder">${icon("stack")}Choose folder</label>
        <label class="button button--secondary" for="import-files">Choose files</label>
      </div>
      <input class="visually-hidden" id="import-folder" type="file" webkitdirectory multiple data-files />
      <input class="visually-hidden" id="import-files" type="file" multiple accept="image/png,image/jpeg,image/webp" data-files />
      <p class="import__status" role="status" data-status></p>
    </div>`);

  const ready = () => (report?.pairs ?? []).filter((pair) => !existing.get(pair.key)?.hasId);
  const already = () => (report?.pairs ?? []).filter((pair) => existing.get(pair.key)?.hasId);

  const issueList = (kind: IssueKind) => {
    const issues = report!.issues.filter((issue) => issue.kind === kind);
    if (!issues.length) return "";
    return html`<details class="import__issues" open><summary><strong>${ISSUE_KINDS[kind]}</strong> <span class="chip__count">${issues.length}</span></summary>
      <ul>${issues.map((issue) => html`<li><p>${issue.detail}</p><p class="mono muted">${issue.files.join(" · ")}</p></li>`)}</ul></details>`;
  };
  const pairRows = (pairs: Pair[]) => html`<ul class="import__pairs">${pairs.map((pair) => html`<li><span class="dept-dot dept-${pair.department}" aria-hidden="true"></span>
      <span><strong>${pair.identity}</strong><span class="muted"> · ${departmentName(pair.department)}</span></span>${pair.officer ? html`<span class="tag tag--gold">Officer</span>` : ""}</li>`)}</ul>`;

  const review = () => {
    const issues = report!.issues.length;
    const count = ready().length;
    mount(host, html`<div class="import">
      <dl class="stat-strip stat-strip--import">
        <div class="stat"><dt>Files</dt><dd><span class="stat__value">${report!.files}</span></dd></div>
        <div class="stat"><dt>Ready</dt><dd><span class="stat__value">${count}</span><span class="stat__note">complete pairs</span></dd></div>
        <div class="stat ${issues ? "stat--warn" : ""}"><dt>Need review</dt><dd><span class="stat__value">${issues}</span><span class="stat__note">left out</span></dd></div>
        <div class="stat"><dt>Already here</dt><dd><span class="stat__value">${already().length}</span><span class="stat__note">skipped</span></dd></div>
      </dl>
      ${issues ? html`<section aria-labelledby="needs-review"><h3 class="section-label" id="needs-review">Needs a person before it can be imported</h3>
        <p class="field__hint">Fix these in a copy of the folder (for example rename <span class="mono">Cruz_Front_DoL.png</span> to <span class="mono">Cruz_J_Front_DoL.png</span>) and import again; they are never guessed.</p>
        ${(Object.keys(ISSUE_KINDS) as IssueKind[]).map(issueList)}</section>` : html`<p class="callout callout--review">${icon("check")}<span>The check is clean: every scan forms a complete Front/Back pair.</span></p>`}
      ${count ? html`<section aria-labelledby="ready-title"><h3 class="section-label" id="ready-title">Ready to import (${count})</h3>${pairRows(ready())}</section>` : ""}
      ${already().length ? html`<details class="import__issues"><summary><strong>Already in the directory</strong> <span class="chip__count">${already().length}</span></summary>${pairRows(already())}</details>` : ""}
      ${report!.ignored.length ? html`<p class="field__hint">${plural(report!.ignored.length, "system file")} skipped (such as .DS_Store or desktop.ini).</p>` : ""}
      <div class="form-actions form-actions--start">
        <button type="button" class="button button--primary" data-run ${count ? "" : "disabled"}>${count ? `Import ${plural(count, "pair")}` : "Nothing to import"}</button>
        <button type="button" class="button button--ghost" data-again>Choose another folder</button>
      </div></div>`);
  };

  const progress = () => {
    const finished = outcomes.filter((entry) => entry.status !== "waiting" && entry.status !== "working").length;
    const failed = outcomes.filter((entry) => entry.status === "failed");
    const label: Record<Outcome["status"], string> = { waiting: "Waiting", working: "Uploading…", imported: "Imported", exists: "Already there", failed: "Failed" };
    const tone: Record<Outcome["status"], string> = { waiting: "", working: "tag--pending", imported: "tag--ok", exists: "", failed: "tag--bad" };
    mount(host, html`<div class="import">
      <div class="import__progress"><label for="import-progress">${running ? `Importing ${finished + 1} of ${outcomes.length}…` : `Finished: ${plural(outcomes.filter((entry) => entry.status === "imported").length, "pair")} imported${failed.length ? `, ${failed.length} failed` : ""}.`}</label>
        <progress id="import-progress" max="${outcomes.length}" value="${finished}"></progress></div>
      <ul class="import__pairs">${outcomes.map((entry) => html`<li><span class="dept-dot dept-${entry.pair.department}" aria-hidden="true"></span>
        <span><strong>${entry.pair.identity}</strong><span class="muted"> · ${entry.pair.department}</span>${entry.message ? html`<span class="cell-sub">${entry.message}</span>` : ""}</span><span class="tag ${tone[entry.status]}">${label[entry.status]}</span></li>`)}</ul>
      ${running ? "" : html`<p class="field__hint">Scans that needed review were not sent. Every import is recorded in Activity under Staff Directory.</p>
        <div class="form-actions form-actions--start">${failed.length ? html`<button type="button" class="button button--secondary" data-retry>Retry failed</button>` : ""}<button type="button" class="button button--primary" data-close>Done</button></div>`}</div>`);
  };

  async function run(entries: Outcome[]): Promise<void> {
    running = true;
    for (const entry of entries) {
      entry.status = "working";
      entry.message = undefined;
      progress();
      try {
        const form = new FormData();
        form.set("identity", entry.pair.identity);
        form.set("department", entry.pair.department);
        form.set("officer", entry.pair.officer ? "1" : "0");
        await addScans(form, files.get(entry.pair.front.path)!, files.get(entry.pair.back.path)!);
        form.set("sourceFront", entry.pair.front.path);
        form.set("sourceBack", entry.pair.back.path);
        const result = await api<{ status: "imported" | "exists" }>("/api/staff/admin/directory/import", { method: "POST", body: form });
        entry.status = result.status;
      } catch (error) {
        entry.status = "failed";
        entry.message = failure(error);
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) break;
      }
    }
    running = false;
    progress();
    await done();
  }

  host.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.hasAttribute("data-files") || !input.files?.length) return;
    const chosen = [...input.files];
    const status = host.querySelector<HTMLElement>("[data-status]")!;
    files = new Map();
    const listed = [];
    // Hashes let identical copies (a department folder and OFFICERS) count once; they are computed here and never sent.
    for (const [index, file] of chosen.entries()) {
      status.textContent = `Checking ${index + 1} of ${chosen.length}…`;
      const path = file.webkitRelativePath || file.name;
      files.set(path, file);
      listed.push({ path, size: file.size, hash: file.size <= 25 * 1024 * 1024 ? await hashOf(file) : undefined });
    }
    report = preflight(listed);
    review();
    host.querySelector<HTMLElement>("[data-run]:not([disabled])")?.focus();
  });
  host.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-again]")) choose();
    if (target.closest("[data-run]") && !running) {
      outcomes = ready().map((pair) => ({ pair, status: "waiting" }));
      void run(outcomes);
    }
    if (target.closest("[data-retry]") && !running) void run(outcomes.filter((entry) => entry.status === "failed"));
  });
  choose();
}

/** "Imported 3 Oct 2026 by Alex Reyes from Name_Front_DEM.png and Name_Back_DEM.png." */
export function cardSource(card: Card): Html {
  const sources = [card.sourceFront, card.sourceBack].filter(Boolean).map((source) => source!.split("/").at(-1));
  return html`Added ${formatDateTime(card.createdAt)}${card.createdBy ? ` by ${card.createdBy}` : ""}${sources.length ? html` from <span class="mono">${sources.join(" and ")}</span>` : ""}.`;
}
