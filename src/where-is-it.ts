import { ApiError, type Html, failure, html, icon, mount, sheet, sheetContent } from "./ui";
import { openViewer } from "./item-photo";
import { REPORT_KINDS, REPORT_LABELS, type ReportKind } from "./location-tree";

/*
 * "Where is it?" for staff and for Self-Service: where an item is kept as a short route (Office → Cabinet 1 → Shelf 2) with
 * the directions of each step and the nearest picture, then the two ways to say it is not there. A report only tells staff:
 * the dialog says so, and nothing it does can change stock or where the item is kept.
 */

export type Step = { id: string; name: string; directions: string | null; photo: { id: string; width: number; height: number } | null };

export type WhereIsIt = {
  /** The item the person is looking for. */
  item: string;
  /** From the outermost place to the one the item is in; empty when no place can be shown. */
  steps: Step[];
  /** Why there is no route to show, in the words the person reads. */
  noRoute: string;
  pictureUrl: (id: string, size: "thumb" | "display") => string;
  /** Staff may add a note to a report; a phone may not. */
  note: boolean;
  /** Sends one report and says whether it was newly recorded; `id` is the same on a retry so the Worker records it once. Null when reporting is not possible right now. */
  report: ((kind: ReportKind, note: string, id: string) => Promise<boolean>) | null;
  /** Why reporting is not possible, shown in place of the buttons. */
  reportBlocked?: string;
  /** Beside "No picture yet": staff are shown where to add one. */
  pictureHelp?: (step: Step | undefined) => Html | "";
  /** Extra class for the dialog: Self-Service dresses its sheets in its own theme. */
  sheetClass?: string;
  /** Where focus returns when a page that redraws itself has replaced the button that opened the dialog. */
  returnFocus?: () => HTMLElement | null;
};

const CONFIRM: Record<ReportKind, string> = {
  CANT_FIND: "Tell DOL staff this item could not be found where it should be.",
  LOCATION_WRONG: "Tell DOL staff that this item is not kept where the route says."
};

/** The nearest picture on the way: the item's own place first, then the places around it. */
const nearestPicture = (steps: Step[]): Step | undefined => [...steps].reverse().find((step) => step.photo);

function route(steps: Step[], noRoute: string): Html {
  if (!steps.length) return html`<p class="where__empty">${icon("pin")}<span>${noRoute}</span></p>`;
  return html`<ol class="where__steps" aria-label="Route to ${steps[steps.length - 1]!.name}">${steps.map((step, index) => html`<li class="where__step ${index === steps.length - 1 ? "is-last" : ""}">
      <span class="where__name">${step.name}${index === steps.length - 1 ? html`<span class="visually-hidden"> (where it is kept)</span>` : ""}</span>
      ${step.directions ? html`<p class="where__directions">${step.directions}</p>` : ""}</li>`)}</ol>`;
}

function picture(options: WhereIsIt, step: Step | undefined): Html {
  if (!options.steps.length) return html``;
  if (!step?.photo) return html`<div class="where__missing">${icon("camera")}<div><p><strong>No picture yet</strong></p><p>Nobody has added a picture of this place.</p>${options.pictureHelp?.(options.steps[options.steps.length - 1]) ?? ""}</div></div>`;
  const { photo } = step;
  const leaf = options.steps[options.steps.length - 1]!;
  return html`<figure class="where__figure"><button type="button" class="where__photo" data-zoom aria-label="Enlarge the picture of ${step.name}">
      <img src="${options.pictureUrl(photo.id, "thumb")}" alt="Picture of ${step.name}" width="${photo.width}" height="${photo.height}" decoding="async" /></button>
    <figcaption>${step.id === leaf.id ? step.name : html`${step.name}, the place around it`}</figcaption></figure>`;
}

/**
 * Opens the dialog. Escape, the backdrop and Close dismiss it, and focus returns to what opened it. The report flow stays in
 * the dialog: choose, confirm (with a note, for staff), then a plain confirmation that nothing else changed.
 */
export function openWhereIsIt(options: WhereIsIt): void {
  if (document.querySelector("dialog.where")) return;
  const dialog = document.createElement("dialog");
  dialog.className = `sheet where ${options.sheetClass ?? ""}`.trim();
  dialog.setAttribute("aria-labelledby", "sheet-title");
  document.body.append(dialog);
  const control = sheet(dialog, { onClose: () => queueMicrotask(() => { dialog.remove(); options.returnFocus?.()?.focus({ preventScroll: true }); }) });
  const shown = nearestPicture(options.steps);
  const kinds = options.steps.length ? REPORT_KINDS : (["CANT_FIND"] as const);
  // One id per report, kept across retries, so a lost answer never records it twice.
  let requestId = crypto.randomUUID();
  let state: { phase: "choose" } | { phase: "confirm"; kind: ReportKind; sending: boolean; error: string; note: string } | { phase: "sent"; kind: ReportKind; recorded: boolean } = { phase: "choose" };

  const reporting = (): Html => {
    if (!options.report) return html`<p class="where__blocked">${icon("cloudOff")}<span>${options.reportBlocked ?? "Reports are not available right now."}</span></p>`;
    if (state.phase === "sent") {
      return html`<div class="where__done" role="status">${icon("check")}<div><p><strong>${state.recorded ? "Reported. Thank you." : "Already reported. Thank you."}</strong></p>
        <p>DOL staff will check. Nothing was changed: stock and where the item is kept stay as they were.</p></div></div>`;
    }
    if (state.phase === "confirm") {
      const { kind, sending, error, note } = state;
      return html`<form class="where__confirm form" data-confirm novalidate aria-labelledby="where-confirm-title">
        <h3 id="where-confirm-title">${REPORT_LABELS[kind]}</h3>
        <p>${CONFIRM[kind]} Nothing is changed by this report.</p>
        ${options.note ? html`<div class="field"><label for="where-note">Note <span class="field__optional">optional</span></label><textarea id="where-note" name="note" rows="2" maxlength="300" ${sending ? "disabled" : ""}>${note}</textarea></div>` : ""}
        ${error ? html`<p class="form-alert" role="alert">${icon("alert")}<span>${error}</span></p>` : ""}
        <div class="where__buttons"><button class="button button--primary" type="submit" ${sending ? "disabled" : ""}>${sending ? "Sending…" : "Send report"}</button>
          <button class="button button--ghost" type="button" data-cancel ${sending ? "disabled" : ""}>Cancel</button></div></form>`;
    }
    return html`<div class="where__buttons">${kinds.map((kind) => html`<button class="button button--secondary" type="button" data-report="${kind}">${REPORT_LABELS[kind]}</button>`)}</div>`;
  };

  const draw = () => {
    mount(dialog, sheetContent("Where is it?", options.item, html`
      <section aria-label="Place">${route(options.steps, options.noRoute)}</section>
      <section aria-label="Picture">${picture(options, shown)}</section>
      <section class="where__report" aria-labelledby="where-report-title"><h3 class="section-label" id="where-report-title">Not there?</h3><div id="where-report">${reporting()}</div></section>`));
  };
  const redrawReport = (focus?: string) => {
    mount(dialog.querySelector("#where-report")!, reporting());
    if (focus) dialog.querySelector<HTMLElement>(focus)?.focus();
  };

  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-zoom]") && shown?.photo) {
      const image = dialog.querySelector<HTMLImageElement>(".where__photo img")!;
      void openViewer(options.pictureUrl(shown.photo.id, "display"), `Picture of ${shown.name}`, () => dialog.querySelector<HTMLElement>(".where__photo img") ?? image, `${shown.name} · where to find ${options.item}`);
      return;
    }
    const choose = target.closest<HTMLElement>("[data-report]");
    if (choose) {
      state = { phase: "confirm", kind: choose.dataset.report as ReportKind, sending: false, error: "", note: "" };
      redrawReport("#where-note, [data-confirm] button[type=submit]");
    } else if (target.closest("[data-cancel]")) {
      const kind = state.phase === "confirm" ? state.kind : kinds[0];
      state = { phase: "choose" };
      redrawReport(`[data-report="${kind}"]`);
    }
  });
  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.phase !== "confirm" || state.sending || !options.report) return;
    const { kind } = state;
    const note = dialog.querySelector<HTMLTextAreaElement>("#where-note")?.value.trim() ?? "";
    state = { phase: "confirm", kind, sending: true, error: "", note };
    redrawReport();
    try {
      const recorded = await options.report(kind, note, requestId);
      requestId = crypto.randomUUID();
      state = { phase: "sent", kind, recorded };
      redrawReport();
      dialog.querySelector<HTMLElement>("#where-report .where__done")?.setAttribute("tabindex", "-1");
      dialog.querySelector<HTMLElement>("#where-report .where__done")?.focus();
    } catch (problem) {
      // A busy network or a closed Self-Service is said plainly; the same id is sent again on retry.
      state = { phase: "confirm", kind, sending: false, error: problem instanceof ApiError && problem.status === 429 ? "Too many reports just now. Please ask DOL staff in person." : failure(problem), note };
      redrawReport("[data-confirm] button[type=submit]");
    }
  });

  draw();
  control.open();
}
