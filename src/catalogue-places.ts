import { MAX_DEPTH, inOrder, pathOf, placesOf } from "./location-tree";
import type { PlaceRow } from "./staff";
import { ApiError, type Html, api, failure, html, icon, mount, setMessage } from "./ui";

/** The places a cataloguing session can be in: the tree's active places, each labelled with its full path. */
export type PlaceList = { places: ReturnType<typeof placesOf>; paths: Map<string, string> };

export function placeList(rows: readonly PlaceRow[]): PlaceList {
  const places = placesOf(rows);
  return { places, paths: new Map(rows.map((row) => [row.id, pathOf(places, row.id)!])) };
}

export function placeOptions({ places, paths }: PlaceList, selected: string | null): Html {
  return html`${inOrder(places).filter(({ place }) => place.active).map(({ place }) => html`<option value="${place.id}" ${place.id === selected ? html`selected` : ""}>${paths.get(place.id)}</option>`)}`;
}

/** A place can sit inside another only while the tree stays within its depth. */
function parentOptions({ places, paths }: PlaceList, selected: string | null): Html {
  return html`<option value="">Top level</option>${inOrder(places).filter(({ place, depth }) => place.active && depth < MAX_DEPTH).map(({ place }) => html`<option value="${place.id}" ${place.id === selected ? html`selected` : ""}>${paths.get(place.id)}</option>`)}`;
}

/** The markup of the quick "new place" form: a name and where it sits. Bind it with `bindNewPlace`. */
export function newPlaceForm(list: PlaceList, beside: string | null): Html {
  return html`<div class="place-new" data-new-place hidden>
    <div class="field-grid"><div class="field"><label for="np-name">Name of the new place</label><input id="np-name" maxlength="120" autocomplete="off" placeholder="Shelf 3" /></div>
      <div class="field"><label for="np-parent">Inside</label><select id="np-parent">${parentOptions(list, beside ? list.places.get(beside)?.parentId ?? null : null)}</select></div></div>
    <p class="form-alert" data-new-place-alert role="alert" hidden></p>
    <div class="where__buttons"><button type="button" class="button button--secondary button--sm" data-new-place-add>${icon("plus")}Add place</button><button type="button" class="button button--ghost button--sm" data-new-place-cancel>Cancel</button></div></div>`;
}

/**
 * Makes `newPlaceForm` work inside `root`: the button that opens it, the add and the cancel. `added` runs with the new place's id
 * once the server has made it, after which the caller refreshes its places and selects it.
 */
export function bindNewPlace(root: HTMLElement, added: (id: string) => Promise<void> | void): void {
  const form = root.querySelector<HTMLElement>("[data-new-place]")!;
  const toggle = root.querySelector<HTMLButtonElement>("[data-new-place-toggle]");
  const alert = form.querySelector<HTMLElement>("[data-new-place-alert]")!;
  const name = form.querySelector<HTMLInputElement>("#np-name")!;
  const close = () => { form.hidden = true; toggle?.setAttribute("aria-expanded", "false"); setMessage(alert, ""); name.value = ""; };
  toggle?.addEventListener("click", () => {
    form.hidden = !form.hidden;
    toggle.setAttribute("aria-expanded", String(!form.hidden));
    if (!form.hidden) name.focus();
  });
  form.querySelector("[data-new-place-cancel]")!.addEventListener("click", () => { close(); toggle?.focus(); });
  const add = form.querySelector<HTMLButtonElement>("[data-new-place-add]")!;
  add.addEventListener("click", async () => {
    if (!name.value.trim()) { name.setAttribute("aria-invalid", "true"); setMessage(alert, "Give the new place a name."); name.focus(); return; }
    name.removeAttribute("aria-invalid");
    add.disabled = true;
    setMessage(alert, "");
    try {
      const { id } = await api<{ id: string }>("/api/staff/locations", { method: "POST", body: JSON.stringify({ name: name.value, parentId: form.querySelector<HTMLSelectElement>("#np-parent")!.value || null }) });
      close();
      await added(id);
    } catch (error) {
      setMessage(alert, error instanceof ApiError ? error.message : failure(error));
    } finally {
      add.disabled = false;
    }
  });
}

export const refreshParents = (root: HTMLElement, list: PlaceList, beside: string | null): void => {
  const select = root.querySelector<HTMLSelectElement>("#np-parent");
  if (select) mount(select, parentOptions(list, beside ? list.places.get(beside)?.parentId ?? null : null));
};
