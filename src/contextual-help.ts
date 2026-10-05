import { type Html, html, icon } from "./ui";

/*
 * The one contextual-help component (catalog intelligence amendment, rule C). Use it for a technical term, an
 * ambiguous label, a policy-dependent behaviour or a consequential action, never to explain an obvious name.
 *
 * It is a toggletip: a real button that opens a short note on hover or focus after a brief delay and on tap or
 * Enter/Space. The note is a status message, so a screen reader announces it when it opens. Escape closes it
 * and leaves focus on the button; the note stays open while the pointer is over it and while focus is on its
 * button (WCAG 1.4.13). The button's hit area is 44 px, well past the 24 px of WCAG 2.2 AA (2.5.8).
 *
 *   helpTip("Why a photo?", "Staff use it to see what left and who has it.")   // markup, put it beside a label
 *   bindHelp(root)                                                             // once, on a container
 */

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 250;
let counter = 0;

/** The trigger and its (empty until opened) status region. `label` names what the help is about. */
export function helpTip(label: string, text: string): Html {
  counter += 1;
  return html`<span class="help" data-help><button type="button" class="help__trigger" aria-expanded="false" aria-controls="help-${counter}" aria-label="About ${label}">${icon("info")}</button><span class="help__status" id="help-${counter}" role="status" data-help-text="${text}"></span></span>`;
}

/** Wires every help tip under `root`, now and when they are redrawn. Returns the way to undo it. */
export function bindHelp(root: HTMLElement): () => void {
  let openTip: HTMLElement | null = null;
  let timer = 0;
  const cancel = () => { window.clearTimeout(timer); timer = 0; };

  const place = (tip: HTMLElement, note: HTMLElement) => {
    const box = tip.querySelector<HTMLElement>(".help__trigger")!.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(288, window.innerWidth - margin * 2);
    note.style.width = `${width}px`;
    note.style.left = `${Math.max(margin, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - margin))}px`;
    // Below the button, unless that would run off the screen.
    const height = note.offsetHeight;
    const below = box.bottom + 6;
    note.style.top = `${below + height > window.innerHeight - margin && box.top - height - 6 > margin ? box.top - height - 6 : below}px`;
  };
  const show = (tip: HTMLElement) => {
    cancel();
    if (openTip === tip) return;
    hide();
    const status = tip.querySelector<HTMLElement>("[data-help-text]")!;
    // The status region is always there; the note goes into it on opening, which is what makes a screen reader say it.
    const note = document.createElement("span");
    note.className = "help__note";
    note.textContent = status.dataset.helpText ?? "";
    status.append(note);
    tip.querySelector(".help__trigger")!.setAttribute("aria-expanded", "true");
    place(tip, note);
    openTip = tip;
  };
  function hide() {
    cancel();
    if (!openTip) return;
    openTip.querySelector(".help__trigger")?.setAttribute("aria-expanded", "false");
    const status = openTip.querySelector<HTMLElement>("[data-help-text]");
    if (status) status.textContent = "";
    openTip = null;
  }
  const later = (work: () => void, delay: number) => { cancel(); timer = window.setTimeout(work, delay); };
  const tipOf = (event: Event) => (event.target as HTMLElement).closest<HTMLElement>("[data-help]");

  const onOver = (event: PointerEvent) => {
    const tip = tipOf(event);
    if (tip && event.pointerType === "mouse") later(() => show(tip), OPEN_DELAY_MS);
  };
  const onOut = (event: PointerEvent) => {
    const tip = tipOf(event);
    if (!tip || event.pointerType !== "mouse" || tip.contains(event.relatedTarget as Node | null)) return;
    if (openTip === tip && !tip.contains(document.activeElement)) later(hide, CLOSE_DELAY_MS);
    else cancel();
  };
  const onFocusIn = (event: FocusEvent) => {
    // Only keyboard focus opens it; a tap or click is handled by the click, so the two never fight.
    const tip = tipOf(event);
    if (tip && (event.target as HTMLElement).matches(".help__trigger:focus-visible")) later(() => show(tip), OPEN_DELAY_MS);
  };
  const onFocusOut = (event: FocusEvent) => {
    const tip = tipOf(event);
    if (tip && openTip === tip && !tip.contains(event.relatedTarget as Node | null)) hide();
    else cancel();
  };
  const onClick = (event: MouseEvent) => {
    const tip = tipOf(event);
    const trigger = (event.target as HTMLElement).closest(".help__trigger");
    if (tip && trigger) {
      event.preventDefault();
      if (openTip === tip) hide();
      else show(tip);
    } else if (openTip && !tip) hide();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !openTip) return;
    // Escape closes the note first; a second Escape closes whatever holds it (a sheet).
    event.preventDefault();
    event.stopPropagation();
    const trigger = openTip.querySelector<HTMLElement>(".help__trigger")!;
    hide();
    trigger.focus({ preventScroll: true });
  };
  // The note is positioned against the screen, so an open one closes rather than drifts when the page moves.
  // A note still waiting to open is placed when it opens, so moving the page does not cancel it.
  const onMove = () => { if (openTip) hide(); };

  root.addEventListener("pointerover", onOver);
  root.addEventListener("pointerout", onOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("keydown", onKey, true);
  document.addEventListener("click", onClick);
  window.addEventListener("resize", onMove);
  window.addEventListener("scroll", onMove, true);
  return () => {
    hide();
    root.removeEventListener("pointerover", onOver);
    root.removeEventListener("pointerout", onOut);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    root.removeEventListener("keydown", onKey, true);
    document.removeEventListener("click", onClick);
    window.removeEventListener("resize", onMove);
    window.removeEventListener("scroll", onMove, true);
  };
}
