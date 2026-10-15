import { itemIconSvg } from "./item-icons";
import { html, icon, mount, raw, reducedMotion } from "./ui";

/*
 * The photo viewer, apart from the staff photo editor (item-photo.ts, which passes it on to staff screens): Self-Service's
 * "Where is it?" opens a picture with it, so phones load this file and not the editor (V1.16 bounded modularity amendment, MA2b).
 */

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
export async function openViewer(url: string, description: string, source: () => HTMLElement | null, caption = description, fallbackKey?: string, edit?: () => void): Promise<void> {
  if (document.querySelector("dialog.viewer")) return;
  const opener = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "viewer";
  dialog.setAttribute("aria-label", description);
  mount(dialog, html`<button class="viewer__close icon-button" type="button" data-close aria-label="Close photo">${icon("close")}</button>
    ${edit ? html`<button class="viewer__edit button button--sm" type="button" data-edit-photo>${icon("camera")}Edit photo</button>` : ""}
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
  let editRequested = false;
  const requestClose = () => { if (dialog.open) morph(image, source(), () => dialog.close()); };
  const onBack = () => { entryGone = true; if (dialog.open) dialog.close(); };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); requestClose(); });
  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-edit-photo]")) { editRequested = true; requestClose(); return; }
    if (target === dialog || target.hasAttribute("data-backdrop") || target.closest("[data-close]")) requestClose();
  });
  dialog.addEventListener("close", () => {
    window.removeEventListener("popstate", onBack);
    dialog.remove();
    // Closed with Escape or a tap: take the viewer's history entry back. Closed with Back it is already gone.
    if (!entryGone && window.history.state?.viewer) window.history.back();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    if (editRequested) edit?.();
  });
  window.history.pushState({ viewer: true }, "");
  window.addEventListener("popstate", onBack);
  const from = source();
  // Without a transition to play, a plain fade (none under reduced motion) keeps the opening from being abrupt.
  if (!canMorph(from, image) && !reducedMotion()) dialog.classList.add("viewer--fade");
  morph(from, image, () => dialog.showModal());
}
