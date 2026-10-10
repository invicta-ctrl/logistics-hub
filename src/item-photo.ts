import { cutoutProblem, cutoutShares } from "./cutout-share";
import { type VisualItem, itemIconSvg } from "./item-icons";
import { ApiError, type Html, api, dataUrl, failure, html, icon, jpegOf, itemVisual, mount, raw, reducedMotion, toast } from "./ui";

/** `cutout`: a cleaned picture (background removed) is kept beside the original. `cleanable`: the Worker can make one (src/item-cutout.ts). */
export type Photo = { id: string; width: number; height: number; cutout?: boolean; cleanable?: boolean; cleanupReason?: string };
type Size = "thumb" | "display";

/** Long sides of the two variants every photo is stored as: lists and the profile use the small one, the viewer the large one. */
const EDGES = { display: 1280, thumb: 320 } as const;
/** The Worker refuses a variant over 1 MB, so a noisy photo is re-encoded harder before it is sent. */
const QUALITIES = [0.82, 0.6, 0.4];

export const photoUrl = (id: string, size: Size) => `/api/staff/media/${id}/${size}`;
/** The picture an item shows: its cleaned cutout when it has one, else the original at `size`. */
export const shownUrl = (photo: Photo, size: Size) => (photo.cutout ? `/api/staff/media/${photo.id}/cutout` : photoUrl(photo.id, size));

/** Decorative fixed-size item visual; only loaded real photos open the viewer. */
export const rowThumb = (item: VisualItem): Html => itemVisual(item, (id) => photoUrl(id, "thumb"), "thumb");

/**
 * A 64-bit difference hash of the picture as 16 hex digits: the picture at 9 × 8 grey pixels, one bit for each pixel brighter than
 * its right-hand neighbour. Two photos of one object usually differ by a few bits, two different objects by about thirty. It
 * is only a hint for finding duplicates (src/duplicates.ts) and says nothing a person could recognise.
 */
function dhashOf(bitmap: ImageBitmap): string {
  const context = Object.assign(document.createElement("canvas"), { width: 9, height: 8 }).getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 9, 8);
  context.drawImage(bitmap, 0, 0, 9, 8);
  const { data } = context.getImageData(0, 0, 9, 8);
  const grey = (index: number) => data[index * 4]! * 0.299 + data[index * 4 + 1]! * 0.587 + data[index * 4 + 2]! * 0.114;
  let hex = "";
  for (let row = 0; row < 8; row += 1) {
    for (let group = 0; group < 2; group += 1) {
      let nibble = 0;
      for (let bit = 0; bit < 4; bit += 1) { const at = row * 9 + group * 4 + bit; nibble = (nibble << 1) | (grey(at) > grey(at + 1) ? 1 : 0); }
      hex += nibble.toString(16);
    }
  }
  return hex;
}

/**
 * Turns a camera or library photo into the two stored variants. Decoding with `from-image` applies the camera's
 * rotation to the pixels, and re-drawing on a canvas leaves no EXIF or location behind; the original never leaves
 * the device. A browser that cannot decode the file refuses it rather than sending it as it is.
 */
export type Prepared = { display: Blob; thumb: Blob; preview: string; hash: string };
export async function preparePhoto(file: File): Promise<Prepared> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size === 0 || file.size > 20_000_000) throw new Error("Choose a photo smaller than 20 MB.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error("This photo could not be read. Choose a JPEG, PNG or WebP image."); }
  try {
    let display = await jpegOf(bitmap, EDGES.display, QUALITIES[0]!);
    for (const quality of QUALITIES.slice(1)) if (display.size > 900_000) display = await jpegOf(bitmap, EDGES.display, quality);
    return { display, thumb: await jpegOf(bitmap, EDGES.thumb, 0.8), preview: await dataUrl(display), hash: dhashOf(bitmap) };
  } finally { bitmap.close(); }
}

/** Crop only the thumbnail; the sanitized display and its identity remain untouched. */
export async function cropPhoto(source: Prepared, rect: { x: number; y: number; width: number; height: number }): Promise<Prepared> {
  const bitmap = await createImageBitmap(source.display);
  try {
    const width = Math.max(1, Math.round(bitmap.width * Math.min(100, Math.max(1, rect.width)) / 100));
    const height = Math.max(1, Math.round(bitmap.height * Math.min(100, Math.max(1, rect.height)) / 100));
    const x = Math.max(0, Math.min(bitmap.width - width, Math.round(bitmap.width * rect.x / 100)));
    const y = Math.max(0, Math.min(bitmap.height - height, Math.round(bitmap.height * rect.y / 100)));
    const scale = Math.min(1, 320 / Math.max(width, height));
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
    canvas.getContext("2d")!.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const thumb = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The crop could not be prepared.")), "image/jpeg", .8));
    return { ...source, thumb, preview: await dataUrl(thumb) };
  } finally { bitmap.close(); }
}

/** Drag the frame or its corners; only the thumbnail changes after Apply, then Save. */
export function cropEditor(host: HTMLElement, source: Prepared, apply: (photo: Prepared) => void, cancel: () => void): void {
  let closed = false;
  let preparing = false;
  let ready = false;
  let rect = { x: 0, y: 0, width: 100, height: 100 };
  type Handle = "move" | "nw" | "ne" | "sw" | "se";
  type Rect = typeof rect;
  let drag: { pointer: number; handle: Handle; x: number; y: number; rect: Rect; bounds: DOMRect } | null = null;
  const hintId = `photo-crop-hint-${crypto.randomUUID()}`;
  mount(host, html`<fieldset class="photo-crop"><legend>Crop thumbnail</legend>
    <p id="${hintId}">Drag a corner to crop. Drag inside the frame to move it.<span class="visually-hidden"> Arrow keys adjust the focused control. Hold Shift for a larger step.</span></p>
    <div class="photo-crop__stage"><div class="photo-crop__image"><img alt="Full photo with the selected crop frame" draggable="false" />
      <div class="photo-crop__frame" hidden><button type="button" class="photo-crop__move" data-crop-handle="move" aria-label="Move crop frame" aria-describedby="${hintId}"><span class="photo-crop__grid" aria-hidden="true"></span></button>
        ${(["nw", "ne", "sw", "se"] as const).map((handle) => html`<button type="button" class="photo-crop__handle photo-crop__handle--${handle}" data-crop-handle="${handle}" aria-label="Resize crop from ${{ nw: "top left", ne: "top right", sw: "bottom left", se: "bottom right" }[handle]}" aria-describedby="${hintId}"></button>`)}
      </div></div></div>
    <output class="visually-hidden" data-crop-summary aria-live="polite"></output><p role="alert" hidden></p>
    <div class="photo-actions"><button type="button" class="button button--primary" data-apply disabled>Apply crop</button><button type="button" class="button button--secondary" data-reset disabled>Reset crop</button><button type="button" class="button button--ghost" data-cancel-crop>Cancel crop</button></div></fieldset>`);
  const editor = host.querySelector<HTMLFieldSetElement>("fieldset")!;
  const preview = editor.querySelector<HTMLImageElement>("img")!;
  const image = editor.querySelector<HTMLElement>(".photo-crop__image")!;
  const frame = editor.querySelector<HTMLElement>(".photo-crop__frame")!;
  const move = editor.querySelector<HTMLButtonElement>("[data-crop-handle=move]")!;
  const controls = [...editor.querySelectorAll<HTMLButtonElement>("button:not([data-cancel-crop])")];
  for (const button of controls) button.disabled = true;
  const valid = () => !closed && editor.isConnected && host.contains(editor);
  const draw = () => {
    Object.assign(frame.style, { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` });
    editor.querySelector<HTMLOutputElement>("[data-crop-summary]")!.value = `${Math.round(rect.width)}% wide, ${Math.round(rect.height)}% high, ${Math.round(rect.x)}% from the left and ${Math.round(rect.y)}% from the top.`;
  };
  const showError = () => { const alert = editor.querySelector<HTMLElement>("[role=alert]")!; alert.hidden = false; alert.textContent = "The crop could not be prepared. Your photo is unchanged."; };
  const endDrag = () => { const pointer = drag?.pointer; drag = null; if (pointer !== undefined && frame.hasPointerCapture(pointer)) frame.releasePointerCapture(pointer); };
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const adjust = (from: Rect, handle: Handle, dx: number, dy: number, bounds: DOMRect) => {
    if (handle === "move") rect = { ...from, x: clamp(from.x + dx, 0, 100 - from.width), y: clamp(from.y + dy, 0, 100 - from.height) };
    else {
      const minWidth = Math.min(from.width, Math.max(10, 48 / bounds.width * 100));
      const minHeight = Math.min(from.height, Math.max(10, 48 / bounds.height * 100));
      let left = from.x, top = from.y, right = from.x + from.width, bottom = from.y + from.height;
      if (handle.endsWith("w")) left = clamp(left + dx, 0, right - minWidth);
      else right = clamp(right + dx, left + minWidth, 100);
      if (handle.startsWith("n")) top = clamp(top + dy, 0, bottom - minHeight);
      else bottom = clamp(bottom + dy, top + minHeight, 100);
      rect = { x: left, y: top, width: right - left, height: bottom - top };
    }
    draw();
  };
  frame.addEventListener("pointerdown", (event) => {
    if (!ready || preparing || drag || (event.pointerType === "mouse" && event.button !== 0)) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-crop-handle]");
    if (!button) return;
    const bounds = image.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
    event.preventDefault(); button.focus({ preventScroll: true });
    drag = { pointer: event.pointerId, handle: button.dataset.cropHandle as Handle, x: event.clientX, y: event.clientY, rect: { ...rect }, bounds };
    frame.setPointerCapture(event.pointerId);
  });
  frame.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointer !== event.pointerId || !valid()) return;
    adjust(drag.rect, drag.handle, (event.clientX - drag.x) / drag.bounds.width * 100, (event.clientY - drag.y) / drag.bounds.height * 100, drag.bounds);
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"] as const) frame.addEventListener(event, (event) => { if (drag?.pointer === event.pointerId) endDrag(); });
  frame.addEventListener("keydown", (event) => {
    if (!ready || preparing || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const handle = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-crop-handle]")?.dataset.cropHandle as Handle | undefined;
    if (!handle) return;
    event.preventDefault(); const step = event.shiftKey ? 5 : 1;
    adjust(rect, handle, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0, image.getBoundingClientRect());
  });
  editor.querySelector("[data-reset]")!.addEventListener("click", () => { endDrag(); rect = { x: 0, y: 0, width: 100, height: 100 }; draw(); move.focus({ preventScroll: true }); });
  editor.querySelector("[data-cancel-crop]")!.addEventListener("click", () => { if (!valid()) return; closed = true; endDrag(); cancel(); });
  editor.querySelector("[data-apply]")!.addEventListener("click", async () => {
    if (!valid() || !ready || preparing) return;
    endDrag(); preparing = true; for (const button of controls) button.disabled = true;
    try { const next = await cropPhoto(source, { ...rect }); if (valid()) { closed = true; apply(next); } }
    catch { if (valid()) showError(); }
    finally { preparing = false; if (valid()) for (const button of controls) button.disabled = false; }
  });
  preview.addEventListener("load", () => {
    if (!valid() || !preview.naturalWidth || !preview.naturalHeight) return;
    image.style.setProperty("--photo-ratio", String(preview.naturalWidth / preview.naturalHeight));
    ready = true; frame.hidden = false; for (const button of controls) button.disabled = false; draw(); move.focus({ preventScroll: true });
  }, { once: true });
  preview.addEventListener("error", () => { if (valid()) showError(); }, { once: true });
  void dataUrl(source.display).then((url) => { if (valid()) preview.src = url; }).catch(() => { if (valid()) showError(); });
  draw();
}

/**
 * Judges the pending cut the Worker just made (not yet the item's picture) by drawing it small and reading its alpha channel (the Worker cannot afford to decode
 * it). Answers null for a real cutout, or the sentence that says why not. A picture that cannot be loaded is not a cutout either.
 */
async function cutoutFault(id: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/staff/media/${id}/pending`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return "The cleaned picture could not be loaded.";
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
      const canvas = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) });
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return cutoutProblem(cutoutShares(context.getImageData(0, 0, canvas.width, canvas.height).data));
    } finally { bitmap.close(); }
  } catch { return "The cleaned picture could not be checked."; }
}

/* ---------- Viewer ---------- */

/**
 * Moves one photo into the place of another with the browser's own view transition, so a thumbnail grows into
 * the viewer and back. Without the API, or under reduced motion, the change is simply instant.
 */
const canMorph = (from: HTMLElement | null, to: HTMLElement | null): from is HTMLElement => Boolean(from && to && !reducedMotion() && "startViewTransition" in document);
function morph(from: HTMLElement | null, to: HTMLElement | null, update: () => void): void {
  if (!canMorph(from, to)) { update(); return; }
  from.style.setProperty("view-transition-name", "item-photo");
  const transition = document.startViewTransition(() => {
    from.style.removeProperty("view-transition-name");
    to!.style.setProperty("view-transition-name", "item-photo");
    update();
  });
  void transition.finished.finally(() => to!.style.removeProperty("view-transition-name"));
}

/**
 * Opens a picture large, over everything. A modal dialog gives Escape, a focus trap and an inert page for free; Back
 * closes it too (it holds a history entry of its own), and focus returns to where it was opened. `source` is the
 * thumbnail it grows from, looked up again on closing because a live list may have redrawn it meanwhile. `url` is the
 * large image, `description` its alternative text ("Photo of Stapler") and `caption` the line under it.
 */
export async function openViewer(url: string, description: string, source: () => HTMLElement | null, caption = description, fallbackKey?: string): Promise<void> {
  if (document.querySelector("dialog.viewer")) return;
  const opener = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "viewer";
  dialog.setAttribute("aria-label", description);
  mount(dialog, html`<button class="viewer__close icon-button" type="button" data-close aria-label="Close photo">${icon("close")}</button>
    <figure class="viewer__figure" data-backdrop><img class="viewer__image" src="${url}" alt="${description}" /><figcaption>${caption}</figcaption></figure>`);
  document.body.append(dialog);
  const image = dialog.querySelector("img")!;
  if (fallbackKey) image.addEventListener("error", () => {
    image.hidden = true;
    const fallback = document.createElement("div");
    fallback.className = "viewer__fallback";
    fallback.setAttribute("role", "img");
    fallback.setAttribute("aria-label", `${description}. Photo unavailable; system icon shown.`);
    mount(fallback, raw(itemIconSvg(fallbackKey)));
    image.after(fallback);
  }, { once: true });
  // The large image is ready before it grows, so the movement never ends in a blank frame.
  await Promise.race([image.decode().catch(() => undefined), new Promise((resolve) => window.setTimeout(resolve, 400))]);
  let entryGone = false;
  const requestClose = () => { if (dialog.open) morph(image, source(), () => dialog.close()); };
  const onBack = () => { entryGone = true; if (dialog.open) dialog.close(); };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); requestClose(); });
  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target === dialog || target.hasAttribute("data-backdrop") || target.closest("[data-close]")) requestClose();
  });
  dialog.addEventListener("close", () => {
    window.removeEventListener("popstate", onBack);
    dialog.remove();
    // Closed with Escape or a tap: take the viewer's history entry back. Closed with Back it is already gone.
    if (!entryGone && window.history.state?.viewer) window.history.back();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  window.history.pushState({ viewer: true }, "");
  window.addEventListener("popstate", onBack);
  const from = source();
  // Without a transition to play, a plain fade (none under reduced motion) keeps the opening from being abrupt.
  if (!canMorph(from, image) && !reducedMotion()) dialog.classList.add("viewer--fade");
  morph(from, image, () => dialog.showModal());
}

/* ---------- Profile photo panel ---------- */

export type PhotoPanel = { render: (photo: Photo | null) => void };

/** What a photo panel says and where it saves: an item's photo or a place's picture. */
export type PhotoSubject = {
  /** The route that saves (PUT) and removes (DELETE) the picture, e.g. /api/staff/items/ITM-0001/photo. */
  endpoint: string; thumbUrl: (id: string) => string; noun: "photo" | "picture";
  hintAdd: string; hintHas: string; removeNote: string;
};

/**
 * A photo or picture panel: add, change (with a preview before anything is saved) and remove. `host` holds a
 * `[data-tile]` for the picture and a `[data-actions]` beside it for the buttons. `refresh` re-reads the record after
 * another person changed the picture first; `changed` runs after every save.
 */
export function photoPanel(host: HTMLElement, options: PhotoSubject & { id: string; name: string; photo: Photo | null; /** Item photos only: the route that cleans (POST) and restores (DELETE) the background, e.g. /api/staff/items/ITM-0001/cutout. */ cleanup?: string; changed: (photo: Photo | null) => void; refresh: () => Promise<void>; view: (photo: Photo) => void; visual?: () => VisualItem; updatedAt?: () => string | null }): PhotoPanel {
  const { id: itemId, name, noun, endpoint } = options;
  let photo = options.photo;
  let staged: Prepared | null = null;
  let originalStaged: Prepared | null = null;
  let cropExisting = false;
  let stagedVersion: string | null | undefined;
  let cropping = false;
  let state: "" | "preparing" | "saving" | "removing" | "cleaning" = "";
  let confirming = false;
  let error = "";
  const tile = host.querySelector<HTMLElement>("[data-tile]")!;
  const actions = host.querySelector<HTMLElement>("[data-actions]")!;
  const input = document.createElement("input");
  input.className = "visually-hidden";
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  input.tabIndex = -1;
  input.setAttribute("aria-label", `Choose a ${noun} of ${name}`);
  host.append(input);
  const camera = input.cloneNode() as HTMLInputElement;
  camera.setAttribute("capture", "environment");
  camera.setAttribute("aria-label", `Take a ${noun} of ${name}`);
  host.append(camera);
  let selection = 0;
  const busy = () => state !== "" || cropping;
  /** The profile tile shows the cleaned picture when there is one. */
  const tileUrl = (id: string) => (photo?.cutout && photo.id === id ? shownUrl(photo, "thumb") : options.thumbUrl(id));
  const show = (picture: Html, buttons: Html) => { mount(tile, picture); mount(actions, buttons); };

  /** Item photos only: remove the background, or go back to the original. The original photo is never changed by either. */
  const cleanButton = (): Html => {
    if (!options.cleanup || !photo) return html``;
    if (photo.cutout) return html`<button type="button" class="button button--ghost button--sm" data-original ${busy() ? "disabled" : ""}>Use original</button>`;
    return photo.cleanable ? html`<button type="button" class="button button--ghost button--sm" data-clean ${busy() ? "disabled" : ""}>Remove background</button>` : html``;
  };

  const draw = () => {
    const alert = error ? html`<p class="form-alert" role="alert">${icon("alert")}<span>${error}</span></p>` : "";
    if (state === "preparing") return show(html`<div class="photo-tile photo-tile--busy" role="status">Preparing the photo…</div>`, html``);
    if (cropping && originalStaged) {
      show(html`<div class="photo-tile photo-tile--preview"><img src="${staged!.preview}" alt="Current thumbnail preview" /></div>`, html``);
      const revision = selection;
      cropEditor(actions, originalStaged, (next) => { if (revision !== selection) return; staged = next; cropping = false; draw(); focus("[data-save]"); }, () => { cropping = false; draw(); focus("[data-crop-photo]"); });
      return;
    }
    if (staged) {
      return show(html`<div class="photo-tile photo-tile--preview"><img src="${staged.preview}" alt="Preview of the new ${noun} of ${name}" /></div>`, html`<div class="photo-actions"><button type="button" class="button button--primary button--sm" data-save ${busy() ? "disabled" : ""}>${state === "saving" ? "Saving…" : `Save ${noun}`}</button>
          <button type="button" class="button button--secondary button--sm" data-pick ${busy() ? "disabled" : ""}>Choose another</button><button type="button" class="button button--ghost button--sm" data-camera ${busy() ? "disabled" : ""}>Take photo</button>
          <button type="button" class="button button--secondary button--sm" data-crop-photo ${busy() ? "disabled" : ""}>Crop thumbnail</button><button type="button" class="button button--ghost button--sm" data-reset-photo ${busy() ? "disabled" : ""}>Reset thumbnail</button><button type="button" class="button button--ghost button--sm" data-cancel ${busy() ? "disabled" : ""}>Cancel</button></div>${alert}`);
    }
    if (!photo) {
      return show(html`<button type="button" class="photo-tile photo-tile--add" data-pick aria-describedby="photo-hint-${itemId}">${options.visual ? itemVisual({ ...options.visual(), photoId: null }, options.thumbUrl, "profile-visual") : icon("camera")}<span>${options.visual ? "Upload photo" : `Add ${noun}`}</span></button>`,
        html`<div class="photo-actions"><button type="button" class="button button--secondary button--sm" data-pick>Choose photo</button><button type="button" class="button button--ghost button--sm" data-camera>Take photo</button></div><p class="field__hint" id="photo-hint-${itemId}">${options.hintAdd}</p>${alert}`);
    }
    show(options.visual && options.visual().visualType === "SYSTEM_ICON"
      ? html`<div class="photo-tile">${itemVisual({ ...options.visual(), photoId: null }, options.thumbUrl, "profile-visual")}</div>`
      : html`<button type="button" class="photo-tile" data-view aria-label="View ${noun} of ${name}">${options.visual ? itemVisual({ ...options.visual(), photoId: photo.id }, tileUrl, "profile-visual", true) : html`<img src="${tileUrl(photo.id)}" alt="" width="160" height="160" />`}</button>`,
      html`${confirming
        ? html`<div class="inline-confirm" role="group" aria-label="Confirm"><p>Remove this ${noun}? ${options.removeNote}</p>
            <div class="inline-confirm__actions"><button type="button" class="button button--danger button--sm" data-remove-confirmed ${busy() ? "disabled" : ""}>${state === "removing" ? "Removing…" : `Remove ${noun}`}</button><button type="button" class="button button--ghost button--sm" data-keep>Keep</button></div></div>`
        : html`<div class="photo-actions"><button type="button" class="button button--secondary button--sm" data-pick>${icon("camera")}Change<span class="visually-hidden"> ${noun}</span></button><button type="button" class="button button--ghost button--sm" data-camera>Take photo</button>${options.noun === "photo" ? html`<button type="button" class="button button--secondary button--sm" data-crop-existing>Crop thumbnail</button>` : ""}<button type="button" class="button button--ghost button--sm" data-remove>Remove</button>${cleanButton()}</div>${state === "cleaning" ? html`<p class="field__hint" role="status">Working on the picture…</p>` : ""}<p class="field__hint">${options.visual?.().visualType === "SYSTEM_ICON" ? "Your photo is saved. Select Real Photo to display it on the catalog." : options.hintHas}</p>`}${options.cleanup && !photo.cleanable && photo.cleanupReason ? html`<p class="field__hint" role="status">${photo.cleanupReason} The original photo is kept.</p>` : ""}${alert}`);
  };
  const focus = (selector: string) => host.querySelector<HTMLElement>(selector)?.focus();

  const select = async (chooser: HTMLInputElement) => {
    const file = chooser.files?.[0];
    chooser.value = "";
    if (!file) return;
    const version = options.updatedAt?.();
    const revision = ++selection;
    state = "preparing";
    error = "";
    draw();
    let prepared: Prepared | null = null;
    let preparationError = "";
    try { prepared = await preparePhoto(file); } catch (problem) { preparationError = problem instanceof Error ? problem.message : "This photo could not be used."; }
    if (revision !== selection || !host.isConnected) return;
    if (prepared) { staged = originalStaged = prepared; cropExisting = false; stagedVersion = version; }
    error = preparationError;
    state = "";
    draw();
    focus(staged ? "[data-save]" : "[data-pick]");
  };
  input.addEventListener("change", () => void select(input));
  camera.addEventListener("change", () => void select(camera));

  /** A write another person got to first is said so and replaced by what is there now; anything else stays here to retry. */
  const failed = async (problem: unknown) => {
    state = "";
    if (problem instanceof ApiError && problem.status === 409) {
      toast(problem.message, "error");
      staged = originalStaged = null;
      cropExisting = false;
      confirming = false;
      error = "";
      draw();
      await options.refresh().catch(() => undefined);
      return;
    }
    error = failure(problem);
    draw();
  };

  host.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (busy()) return;
    if (target.closest("[data-pick]")) input.click();
    else if (target.closest("[data-camera]")) camera.click();
    else if (target.closest("[data-view]") && photo) options.view(photo);
    else if (target.closest("[data-crop-photo]") && staged) { cropping = true; draw(); }
    else if (target.closest("[data-reset-photo]") && originalStaged) { staged = originalStaged; draw(); focus("[data-save]"); }
    else if (target.closest("[data-crop-existing]") && photo) {
      const version = options.updatedAt?.(); const revision = ++selection; state = "preparing"; draw();
      try {
        const response = await fetch(photoUrl(photo.id, "display"), { credentials: "same-origin" });
        if (!response.ok) throw new Error("The full photo could not be loaded. Your photo is unchanged.");
        const display = await response.blob(); const prepared = await preparePhoto(new File([display], "original.jpg", { type: "image/jpeg" }));
        if (revision !== selection || !host.isConnected) return;
        staged = originalStaged = { ...prepared, display }; cropExisting = true; stagedVersion = version; cropping = true; state = ""; draw();
      } catch (problem) { if (revision === selection) { state = ""; error = failure(problem); draw(); } }
    }
    else if (target.closest("[data-cancel]")) { selection += 1; staged = originalStaged = null; cropExisting = false; error = ""; draw(); focus("[data-pick]"); }
    else if (target.closest("[data-remove]")) { confirming = true; draw(); focus("[data-remove-confirmed]"); }
    else if (target.closest("[data-keep]")) { confirming = false; draw(); focus("[data-remove]"); }
    else if (target.closest("[data-save]") && staged) {
      state = "saving";
      error = "";
      draw();
      const form = new FormData();
      form.set("display", staged.display, "display.jpg");
      form.set("thumb", staged.thumb, "thumb.jpg");
      form.set("expected", photo?.id ?? "");
      form.set("hash", staged.hash);
      if (cropExisting) form.set("crop", "1");
      if (options.updatedAt) form.set("updatedAt", stagedVersion ?? "");
      try {
        const saved = await api<{ photo: Photo }>(endpoint, { method: "PUT", body: form });
        photo = saved.photo;
        staged = originalStaged = null;
        cropExisting = false;
        state = "";
        draw();
        toast(`${noun === "photo" ? "Photo" : "Picture"} saved.`);
        void Promise.resolve(options.changed(photo)).catch(() => undefined);
        focus("[data-view]");
      } catch (problem) {
        await failed(problem);
      }
    } else if ((target.closest("[data-clean]") || target.closest("[data-original]")) && photo && options.cleanup) {
      const cleaning = Boolean(target.closest("[data-clean]"));
      state = "cleaning";
      error = "";
      draw();
      try {
        // A new cut waits as pending: the browser judges it, and only an accepted one becomes the picture. A closed tab leaves the original.
        let fault: string | null = null;
        if (cleaning) {
          const made = await api<{ pending?: boolean; cutout?: boolean }>(options.cleanup, { method: "POST", body: JSON.stringify({ expected: photo.id }) });
          if (made.pending) {
            fault = await cutoutFault(photo.id);
            if (fault) await api(`${options.cleanup}?expected=${photo.id}`, { method: "DELETE" });
            else await api(options.cleanup, { method: "POST", body: JSON.stringify({ expected: photo.id, accept: true }) });
          }
        } else await api(`${options.cleanup}?expected=${photo.id}`, { method: "DELETE" });
        photo = { ...photo, cutout: cleaning && !fault };
        state = "";
        draw();
        if (fault) { error = `${fault} The original photo is still in use.`; draw(); focus("[data-clean]"); return; }
        toast(cleaning ? "Background removed. The original photo is kept." : "Using the original photo.");
        void Promise.resolve(options.changed(photo)).catch(() => undefined);
        focus(cleaning ? "[data-original]" : "[data-clean]");
      } catch (problem) {
        await failed(problem);
      }
    } else if (target.closest("[data-remove-confirmed]") && photo) {
      state = "removing";
      draw();
      try {
        await api(`${endpoint}?expected=${photo.id}`, { method: "DELETE" });
        photo = null;
        confirming = false;
        state = "";
        draw();
        toast(`${noun === "photo" ? "Photo" : "Picture"} removed.`);
        void Promise.resolve(options.changed(null)).catch(() => undefined);
        focus("[data-pick]");
      } catch (problem) {
        await failed(problem);
      }
    }
  });

  draw();
  return { render: (next) => {
    if (busy() || staged) return;
    selection += 1;
    // A redraw replaces the buttons, so whichever one has focus is given it again.
    const held = ["data-pick", "data-view", "data-remove", "data-clean", "data-original"].find((name) => host.querySelector(`[${name}]:focus`));
    photo = next; confirming = false; error = ""; draw();
    if (held) focus(`[${held}]`);
  } };
}
