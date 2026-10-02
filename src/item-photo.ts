import { ApiError, type Html, api, dataUrl, failure, html, icon, jpegOf, mount, reducedMotion, toast } from "./ui";

export type Photo = { id: string; width: number; height: number };
type Size = "thumb" | "display";

/** Long sides of the two variants every photo is stored as: lists and the profile use the small one, the viewer the large one. */
const EDGES = { display: 1280, thumb: 320 } as const;
/** The Worker refuses a variant over 1 MB, so a noisy photo is re-encoded harder before it is sent. */
const QUALITIES = [0.82, 0.6, 0.4];

export const photoUrl = (id: string, size: Size) => `/api/staff/media/${id}/${size}`;

/**
 * The square at the start of an item row: the image itself, and nothing at all for an item without a photo (its
 * placeholder is a background on the cell, `col-item--bare`, so a mostly unphotographed list adds no elements). It is
 * decorative (the name sits beside it) and pointer-only: the same photo opens from the item's profile, so keyboard
 * users lose nothing and 500 rows add no tab stops. Its size is fixed in CSS, so rows never shift as images arrive,
 * and only rows near the screen are fetched.
 */
export function rowThumb(photoId: string | null): Html | "" {
  return photoId ? html`<img class="thumb" data-photo="${photoId}" src="${photoUrl(photoId, "thumb")}" alt="" width="40" height="40" loading="lazy" decoding="async" />` : "";
}

/**
 * Turns a camera or library photo into the two stored variants. Decoding with `from-image` applies the camera's
 * rotation to the pixels, and re-drawing on a canvas leaves no EXIF or location behind; the original never leaves
 * the device. A browser that cannot decode the file refuses it rather than sending it as it is.
 */
async function prepare(file: File): Promise<{ display: Blob; thumb: Blob; preview: string }> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error("This photo could not be read. Choose a JPEG, PNG or WebP image."); }
  try {
    let display = await jpegOf(bitmap, EDGES.display, QUALITIES[0]!);
    for (const quality of QUALITIES.slice(1)) if (display.size > 900_000) display = await jpegOf(bitmap, EDGES.display, quality);
    return { display, thumb: await jpegOf(bitmap, EDGES.thumb, 0.8), preview: await dataUrl(display) };
  } finally { bitmap.close(); }
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
 * Opens a photo large, over everything. A modal dialog gives Escape, a focus trap and an inert page for free; Back
 * closes it too (it holds a history entry of its own), and focus returns to where it was opened. `source` is the
 * thumbnail it grows from, looked up again on closing because a live list may have redrawn it meanwhile.
 */
export async function openViewer(photoId: string, name: string, source: () => HTMLElement | null): Promise<void> {
  if (document.querySelector("dialog.viewer")) return;
  const opener = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "viewer";
  dialog.setAttribute("aria-label", `Photo of ${name}`);
  mount(dialog, html`<button class="viewer__close icon-button" type="button" data-close aria-label="Close photo">${icon("close")}</button>
    <figure class="viewer__figure" data-backdrop><img class="viewer__image" src="${photoUrl(photoId, "display")}" alt="Photo of ${name}" /><figcaption>${name}</figcaption></figure>`);
  document.body.append(dialog);
  const image = dialog.querySelector("img")!;
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

/**
 * The photo of an item profile: add, change (with a preview before anything is saved) and remove. `host` holds a
 * `[data-tile]` for the picture and a `[data-actions]` beside it for the buttons. `refresh` re-reads the item after
 * another person changed the photo first; `changed` runs after every save.
 */
export function photoPanel(host: HTMLElement, options: { itemId: string; name: string; photo: Photo | null; changed: (photo: Photo | null) => void; refresh: () => Promise<void>; view: (photo: Photo) => void }): PhotoPanel {
  const { itemId, name } = options;
  let photo = options.photo;
  let staged: { display: Blob; thumb: Blob; preview: string } | null = null;
  let state: "" | "preparing" | "saving" | "removing" = "";
  let confirming = false;
  let error = "";
  const tile = host.querySelector<HTMLElement>("[data-tile]")!;
  const actions = host.querySelector<HTMLElement>("[data-actions]")!;
  const input = document.createElement("input");
  input.className = "visually-hidden";
  input.type = "file";
  input.accept = "image/*";
  input.tabIndex = -1;
  input.setAttribute("aria-label", `Choose a photo of ${name}`);
  host.append(input);
  const busy = () => state !== "";
  const show = (picture: Html, buttons: Html) => { mount(tile, picture); mount(actions, buttons); };

  const draw = () => {
    const alert = error ? html`<p class="form-alert" role="alert">${icon("alert")}<span>${error}</span></p>` : "";
    if (state === "preparing") return show(html`<div class="photo-tile photo-tile--busy" role="status">Preparing the photo…</div>`, html``);
    if (staged) {
      return show(html`<div class="photo-tile photo-tile--preview"><img src="${staged.preview}" alt="Preview of the new photo of ${name}" /></div>`, html`<div class="photo-actions"><button type="button" class="button button--primary button--sm" data-save ${busy() ? "disabled" : ""}>${state === "saving" ? "Saving…" : "Save photo"}</button>
          <button type="button" class="button button--secondary button--sm" data-pick ${busy() ? "disabled" : ""}>Choose another</button>
          <button type="button" class="button button--ghost button--sm" data-cancel ${busy() ? "disabled" : ""}>Cancel</button></div>${alert}`);
    }
    if (!photo) {
      return show(html`<button type="button" class="photo-tile photo-tile--add" data-pick aria-describedby="photo-hint-${itemId}">${icon("camera")}<span>Add photo</span></button>`,
        html`<p class="field__hint" id="photo-hint-${itemId}">Show the item itself, not people or documents.</p>${alert}`);
    }
    show(html`<button type="button" class="photo-tile" data-view aria-label="View photo of ${name}"><img src="${photoUrl(photo.id, "thumb")}" alt="" width="160" height="160" /></button>`,
      html`${confirming
        ? html`<div class="inline-confirm" role="group" aria-label="Confirm"><p>Remove this photo? The item keeps its stock and history.</p>
            <div class="inline-confirm__actions"><button type="button" class="button button--danger button--sm" data-remove-confirmed ${busy() ? "disabled" : ""}>${state === "removing" ? "Removing…" : "Remove photo"}</button><button type="button" class="button button--ghost button--sm" data-keep>Keep</button></div></div>`
        : html`<div class="photo-actions"><button type="button" class="button button--secondary button--sm" data-pick>${icon("camera")}Change<span class="visually-hidden"> photo</span></button><button type="button" class="button button--ghost button--sm" data-remove>Remove</button></div>`}${alert}`);
  };
  const focus = (selector: string) => host.querySelector<HTMLElement>(selector)?.focus();

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    state = "preparing";
    error = "";
    draw();
    try { staged = await prepare(file); } catch (problem) { error = problem instanceof Error ? problem.message : "This photo could not be used."; }
    state = "";
    draw();
    focus(staged ? "[data-save]" : "[data-pick]");
  });

  /** A write another person got to first is said so and replaced by what is there now; anything else stays here to retry. */
  const failed = async (problem: unknown) => {
    state = "";
    if (problem instanceof ApiError && problem.status === 409) {
      toast(problem.message, "error");
      staged = null;
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
    else if (target.closest("[data-view]") && photo) options.view(photo);
    else if (target.closest("[data-cancel]")) { staged = null; error = ""; draw(); focus("[data-pick]"); }
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
      try {
        const saved = await api<{ photo: Photo }>(`/api/staff/items/${encodeURIComponent(itemId)}/photo`, { method: "PUT", body: form });
        photo = saved.photo;
        staged = null;
        state = "";
        draw();
        toast("Photo saved.");
        void Promise.resolve(options.changed(photo)).catch(() => undefined);
        focus("[data-view]");
      } catch (problem) {
        await failed(problem);
      }
    } else if (target.closest("[data-remove-confirmed]") && photo) {
      state = "removing";
      draw();
      try {
        await api(`/api/staff/items/${encodeURIComponent(itemId)}/photo?expected=${photo.id}`, { method: "DELETE" });
        photo = null;
        confirming = false;
        state = "";
        draw();
        toast("Photo removed.");
        void Promise.resolve(options.changed(null)).catch(() => undefined);
        focus("[data-pick]");
      } catch (problem) {
        await failed(problem);
      }
    }
  });

  draw();
  return { render: (next) => { if (busy() || staged) return; photo = next; confirming = false; error = ""; draw(); } };
}
