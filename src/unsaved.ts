/*
 * Unsaved edits, everywhere (V1.16.4 §4.7). A sheet or form registers a check that says whether what is on screen differs from what
 * was saved. While one says yes, every way out asks first: a sheet's X, Cancel, Escape, outside click and swipe; links and the rail;
 * Back and Forward; sign-out; and, through the browser's own warning, closing or reloading the tab. An untouched or reverted form
 * never asks.
 *
 * The question is an in-app alertdialog: Keep editing (focused first; Escape and a click outside mean it too) or Discard. Keep editing
 * changes nothing. Nothing typed is ever stored, because there is no safe place on a shared device to keep a draft.
 *
 * This module also owns the index each history entry the app creates carries, so a Back or Forward taken while something is unsaved
 * can be put back before it is asked about. It has no imports, so ui.ts and the router can both use it.
 */

type Check = () => boolean;
const checks = new Set<Check>();
/** Checks whose edits the person chose to discard: quiet until something is typed again, so the way out they chose is not asked twice. */
const discarded = new Set<Check>();

const holds = (check: Check): boolean => {
  if (discarded.has(check)) return false;
  try { return check(); } catch { return false; }
};

/** Registers a check while its form exists; the returned function removes it (pages call it from onLeave, sheets when they go). */
export function trackEdits(dirty: Check): () => void {
  checks.add(dirty);
  return () => { checks.delete(dirty); discarded.delete(dirty); warnOnUnload(); };
}

/** Whether anything (or anything in `scope`) holds edits not yet saved and not discarded. */
export const hasUnsaved = (scope: Iterable<Check> = checks): boolean => [...scope].some(holds);

/** What a person can change in `root`'s fields, as one string: values, choices and chosen files. A search box finds; it edits nothing. */
function fieldsOf(root: ParentNode): string {
  const parts: string[] = [];
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type=search]), select, textarea").forEach((field, index) => {
    const name = field.name || field.id || String(index);
    if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) parts.push(`${name}:${field.value}=${field.checked}`);
    else if (field instanceof HTMLInputElement && field.type === "file") parts.push(`${name}=${[...field.files ?? []].map((file) => `${file.name}/${file.size}`).join()}`);
    else parts.push(`${name}=${field.value}`);
  });
  return parts.join("\n");
}

/**
 * One form's edits, compared with how it was drawn, so a form typed back to what it was is clean again. `extra` adds what the form
 * keeps outside its fields (a prepared photo). `reset` takes the current state as saved; a form no longer in the page holds nothing.
 */
export function formEdits(root: HTMLElement, extra: () => string = () => ""): { dirty: () => boolean; reset: () => void } {
  const read = () => `${fieldsOf(root)}\n${extra()}`;
  let saved = read();
  return { dirty: () => root.isConnected && read() !== saved, reset: () => { saved = read(); } };
}

/* ---------- The question ---------- */

let open: { dialog: HTMLDialogElement; answer: Promise<boolean> } | null = null;
/** Closes still to arrive from moving the question back on top (a dialog's close event comes a task later): they are not an answer. */
let raising = 0;

/**
 * Asks once, however many ways out arrive together. `leave` resolves true. Keep editing puts focus back where it was, without
 * scrolling, so values, focus, scroll position and address are all as they were.
 */
function ask(title: string, body: string, keep: string, leave: string): Promise<boolean> {
  if (open) return open.answer;
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog dialog--confirm";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-labelledby", "unsaved-title");
  dialog.setAttribute("aria-describedby", "unsaved-body");
  dialog.innerHTML = `<div class="dialog__body"><h2 id="unsaved-title"></h2><p id="unsaved-body"></p>
    <div class="form-actions"><button class="button button--primary" type="button" data-keep></button><button class="button button--secondary" type="button" data-leave></button></div></div>`;
  dialog.querySelector("h2")!.textContent = title;
  dialog.querySelector("p")!.textContent = body;
  dialog.querySelector("[data-keep]")!.textContent = keep;
  dialog.querySelector("[data-leave]")!.textContent = leave;
  const answer = new Promise<boolean>((resolve) => {
    const finish = (leaving: boolean) => {
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      dialog.remove();
      open = null;
      if (!leaving && before?.isConnected) before.focus({ preventScroll: true });
      resolve(leaving);
    };
    // Anything that closes the question without choosing (Escape, the platform's back) is Keep editing.
    const onClose = () => { if (raising) raising -= 1; else finish(false); };
    dialog.addEventListener("close", onClose);
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener("click", (event) => {
      const target = event.target as Element;
      if (target === dialog || target.closest("[data-keep]")) finish(false);
      else if (target.closest("[data-leave]")) finish(true);
    });
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>("[data-keep]")!.focus();
  open = { dialog, answer };
  return answer;
}

/** Puts an open question back on top of the top layer, after a sheet behind it had to be shown again. */
export function raiseQuestion(): void {
  if (!open?.dialog.open) return;
  const { dialog } = open;
  raising += 1;
  dialog.close();
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>("[data-keep]")!.focus();
}

/**
 * Asks whether to discard the edits in `scope` (by default, everything open). Resolves true at once when nothing there is unsaved;
 * on Discard, those checks stay quiet until something is typed again.
 */
export async function confirmDiscard(scope: Iterable<Check> = checks): Promise<boolean> {
  const dirty = [...scope].filter(holds);
  if (!dirty.length) return true;
  const discard = await ask("Discard your changes?", "What you changed here isn't saved.", "Keep editing", "Discard");
  if (discard) dirty.forEach((check) => discarded.add(check));
  warnOnUnload();
  return discard;
}

/**
 * A session that ended while something was unsaved (V1.16.4 §4.7): Stay keeps the page, so the text can still be copied; Go to sign in
 * leaves it. Resolves true for Go to sign in, and at once when nothing is unsaved.
 */
export async function confirmSessionEnded(): Promise<boolean> {
  if (!hasUnsaved()) return true;
  const leave = await ask("Your session ended", "Your changes are not saved. Copy anything you need before you sign in again.", "Stay", "Go to sign in");
  if (leave) checks.forEach((check) => discarded.add(check));
  warnOnUnload();
  return leave;
}

/* ---------- Closing or reloading the tab ---------- */

const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
let warning = false;
/**
 * The browser's own warning, attached only while something is unsaved (an unload listener costs the back-forward cache). Browsers
 * show their own wording, only after the page was interacted with, and iOS Safari largely ignores it.
 */
export function warnOnUnload(): void {
  const dirty = hasUnsaved();
  if (dirty === warning) return;
  warning = dirty;
  if (dirty) window.addEventListener("beforeunload", warn);
  else window.removeEventListener("beforeunload", warn);
}
// Typing re-arms a discarded form, and every edit decides afresh whether the tab warns. Pages update their own state in their
// listeners, which run after this capture phase, so the check waits a turn.
const edited = (event: Event) => {
  if (event.type === "input") discarded.clear();
  window.setTimeout(warnOnUnload, 0);
};
document.addEventListener("input", edited, true);
document.addEventListener("change", edited, true);

/* ---------- Back and Forward ---------- */

/** The index of the history entry shown now. Entries the app creates carry theirs in `state.idx`; an overlay's own entry (a photo viewer) carries none. */
let position = typeof history.state?.idx === "number" ? history.state.idx as number : 0;
if (typeof history.state?.idx !== "number") history.replaceState({ ...(history.state ?? {}), idx: position }, "");

/** The state for a new history entry after this one, or for replacing this one. */
export function entryState(state: object, replace: boolean): object {
  if (!replace) position += 1;
  return { ...state, idx: position };
}

let restoring = false;
/**
 * Called by the router first on every popstate. A Back or Forward taken while something is unsaved is put back (`history.go`) and
 * asked about; Discard then takes it again. Answers true when the router must ignore this event: the move being held, or the event
 * of putting it back.
 */
export function holdMove(): boolean {
  const target = typeof history.state?.idx === "number" ? history.state.idx as number : null;
  if (restoring) { restoring = false; if (target !== null) position = target; return true; }
  if (target === null) return false;
  const delta = target - position;
  if (!delta || !hasUnsaved()) { position = target; return false; }
  restoring = true;
  history.go(-delta);
  void confirmDiscard().then((discard) => { if (discard) history.go(delta); });
  return true;
}
