import { BULK_LIMIT, STOCK_AREAS, UNSORTED_CATEGORY } from "./catalog-policy";
import type { PlaceList } from "./catalogue-places";
import { placeOptions } from "./catalogue-places";
import { type Html, api, categoryName, failure, html, icon, label, mount, plural, setMessage, sheet, sheetContent, toast } from "./ui";

/*
 * Bulk edits in Items (Select → choose items → one change): a place, a category, a stock area, or "reviewed". The change is
 * shown with the items it will touch before anything is sent, never touches a quantity, and is sent in pieces of BULK_LIMIT
 * with the version each item had on screen, so an item someone else changed meanwhile is skipped and named (src/bulk.ts).
 */

export type Selected = { id: string; name: string; updatedAt: string | null; category: string; stockArea: string | null; locationId: string | null; needsReview: boolean; itemType: string };
type Action = "MOVE" | "CATEGORY" | "STOCK_AREA" | "REVIEWED";
type Answer = { applied: number; unchanged: number; skipped: Array<{ id: string; name: string; reason: string }> };

const TITLES: Record<Action, string> = { MOVE: "Move to a place", CATEGORY: "Set the category", STOCK_AREA: "Set the stock area", REVIEWED: "Mark reviewed" };
const BUTTONS: Array<[Action, string]> = [["MOVE", "Move to…"], ["CATEGORY", "Category…"], ["STOCK_AREA", "Stock area…"], ["REVIEWED", "Mark reviewed"]];

export type BulkDeps = {
  selected: () => Selected[];
  places: () => PlaceList;
  categories: () => string[];
  /** Reload the list after a change. */
  refresh: () => Promise<void>;
  /** The selection after a change: only what was skipped stays selected, so it can be looked at. */
  keepOnly: (ids: string[]) => void;
  clear: () => void;
};

export function bulkBar(bar: HTMLElement, dialog: HTMLDialogElement, deps: BulkDeps): { draw: () => void } {
  const panel = sheet(dialog);

  const draw = () => {
    const count = deps.selected().length;
    bar.hidden = count === 0;
    if (!count) { mount(bar, html``); return; }
    mount(bar, html`<p class="bulk-bar__count" role="status"><strong>${count.toLocaleString()}</strong> selected</p>
      <div class="bulk-bar__actions">${BUTTONS.map(([action, text]) => html`<button type="button" class="button button--secondary button--sm" data-bulk="${action}">${text}</button>`)}<button type="button" class="button button--ghost button--sm" data-bulk-clear>Clear</button></div>`);
  };
  bar.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-bulk]")?.dataset.bulk as Action | undefined;
    if (action) open(action);
    else if (target.closest("[data-bulk-clear]")) deps.clear();
  });

  function open(action: Action): void {
    const items = deps.selected();
    if (!items.length) return;
    const list = deps.places();
    const control: Html = action === "MOVE" ? html`<div class="field"><label for="bulk-place">Move them to</label><select id="bulk-place"><option value="">Choose a place</option>${placeOptions(list, null)}</select></div>`
      : action === "CATEGORY" ? html`<div class="field"><label for="bulk-category">Category</label><input id="bulk-category" list="bulk-categories" maxlength="100" autocomplete="off" /><datalist id="bulk-categories">${deps.categories().map((category) => html`<option value="${category}">`)}</datalist><p class="field__hint">Pick an existing one, or type a new one. Letter case does not matter.</p></div>`
      : action === "STOCK_AREA" ? html`<fieldset class="field fieldset"><legend>Stock area</legend>${STOCK_AREAS.map((area, index) => html`<label class="choice"><input type="radio" name="bulk-area" value="${area}" ${index === 0 ? html`checked` : ""} /><span><strong>${label(area)}</strong></span></label>`)}</fieldset>`
      : html`<p class="card__text">Marks each item as checked against the real thing. Reviewed items that are Active are offered in Self-Service. An item still waiting for a decision on how it is used, or without a category, is skipped.</p>`;
    mount(dialog, sheetContent("Items", `${TITLES[action]} · ${plural(items.length, "item")}`, html`<form class="form" id="bulk-form" novalidate>
      ${control}
      <div class="bulk-preview" id="bulk-preview" aria-live="polite"></div>
      <div class="form-alert" id="bulk-alert" role="alert" hidden></div>
      <div id="bulk-skipped"></div>
      <div class="form-actions form-actions--sticky"><button type="button" class="button button--ghost" data-close>Cancel</button><button type="submit" class="button button--primary" id="bulk-apply"></button></div>
    </form>`));
    panel.open();
    bind(action, items, list);
  }

  function bind(action: Action, items: Selected[], list: PlaceList): void {
    const form = dialog.querySelector<HTMLFormElement>("#bulk-form")!;
    const apply = form.querySelector<HTMLButtonElement>("#bulk-apply")!;
    const alert = form.querySelector<HTMLElement>("#bulk-alert")!;
    const names = (some: Selected[]) => `${some.slice(0, 5).map((item) => item.name).join(", ")}${some.length > 5 ? ` and ${some.length - 5} more` : ""}`;

    const chosen = (): string => action === "MOVE" ? form.querySelector<HTMLSelectElement>("#bulk-place")!.value
      : action === "CATEGORY" ? form.querySelector<HTMLInputElement>("#bulk-category")!.value.trim()
      : action === "STOCK_AREA" ? form.querySelector<HTMLInputElement>("input[name=bulk-area]:checked")!.value : "";

    /** What would change, from the items as shown: those already right, those that cannot take the change, and the rest. */
    const preview = () => {
      const value = chosen();
      const wanted = (item: Selected) => action === "MOVE" ? item.locationId === value : action === "CATEGORY" ? item.category.toLowerCase() === value.toLowerCase() : action === "STOCK_AREA" ? (item.stockArea ?? "Inventory") === value : !item.needsReview;
      const blocked = action === "REVIEWED" ? items.filter((item) => item.needsReview && (item.itemType === "NEEDS_REVIEW" || item.category === UNSORTED_CATEGORY)) : [];
      const ready = (action === "MOVE" || action === "CATEGORY" ? Boolean(value) : true) ? items.filter((item) => !wanted(item) && !blocked.includes(item)) : [];
      const same = (action === "MOVE" || action === "CATEGORY") && !value ? [] : items.filter(wanted);
      const what = action === "MOVE" ? (value ? `to ${list.paths.get(value) ?? "that place"}` : "") : action === "CATEGORY" ? (value ? `to ${categoryName(value)}` : "") : action === "STOCK_AREA" ? `to ${label(value)}` : "";
      mount(form.querySelector("#bulk-preview")!, html`<p>${ready.length ? html`<strong>${plural(ready.length, "item")}</strong> will change${what ? ` ${what}` : ""}.` : html`Nothing will change.`}</p>
        ${ready.length ? html`<p class="muted">${names(ready)}</p>` : ""}
        ${same.length ? html`<p class="muted">${plural(same.length, "item")} already ${same.length === 1 ? "has" : "have"} this.</p>` : ""}
        ${blocked.length ? html`<p class="muted">${plural(blocked.length, "item")} will be skipped until ${blocked.length === 1 ? "it is" : "they are"} classified or ${blocked.length === 1 ? "has" : "have"} a category: ${names(blocked)}.</p>` : ""}
        <p class="muted">Quantities are not changed. Each change is written to the item’s history.</p>`);
      apply.disabled = !ready.length;
      apply.textContent = action === "MOVE" ? `Move ${plural(ready.length, "item")}` : action === "REVIEWED" ? `Mark ${plural(ready.length, "item")} reviewed` : `Change ${plural(ready.length, "item")}`;
    };
    form.addEventListener("input", preview);
    form.addEventListener("change", preview);
    preview();
    form.querySelector<HTMLElement>("select, input")?.focus();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = chosen();
      if ((action === "MOVE" || action === "CATEGORY") && !value) { setMessage(alert, action === "MOVE" ? "Choose the place to move them to." : "Type or choose a category."); return; }
      apply.disabled = true;
      setMessage(alert, "");
      let applied = 0;
      const skipped: Answer["skipped"] = [];
      try {
        for (let at = 0; at < items.length; at += BULK_LIMIT) {
          const piece = items.slice(at, at + BULK_LIMIT);
          const answer = await api<Answer>("/api/staff/items/bulk", { method: "POST", body: JSON.stringify({ action, ...(action === "REVIEWED" ? {} : { value }), items: piece.map(({ id, updatedAt }) => ({ id, updatedAt })) }) });
          applied += answer.applied;
          skipped.push(...answer.skipped);
          apply.textContent = `Working… ${Math.min(items.length, at + BULK_LIMIT)} of ${items.length}`;
        }
      } catch (error) {
        // Pieces already sent stay done; the person sees what is left on the next look at the list.
        setMessage(alert, `${applied ? `${plural(applied, "item")} changed before this stopped. ` : ""}${failure(error)}`);
        apply.disabled = false;
        await deps.refresh();
        return;
      }
      await deps.refresh();
      deps.keepOnly(skipped.map((entry) => entry.id));
      toast(`${applied ? plural(applied, "item") : "Nothing"} changed${skipped.length ? `, ${skipped.length} skipped` : ""}.`);
      if (!skipped.length) { panel.close(true); return; }
      mount(form.querySelector("#bulk-skipped")!, html`<div class="callout" role="status">${icon("info")}<div><p><strong>${plural(skipped.length, "item")} skipped.</strong> They are still selected.</p>
        <ul>${skipped.map((entry) => html`<li>${entry.name}: ${entry.reason}</li>`)}</ul></div></div>`);
      apply.hidden = true;
      form.querySelector("[data-close]")!.textContent = "Close";
    });
  }

  return { draw };
}
