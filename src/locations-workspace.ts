import { openViewer, photoPanel } from "./item-photo";
import { MAX_DEPTH, VISIBILITIES, VISIBILITY_LABELS, ancestry, inOrder, levelsBelow, lookAlikes, pathOf, placesOf, withinPlace } from "./location-tree";
import { type PlaceRow, loadSession, shell } from "./staff";
import { ApiError, type Html, api, emptyState, expired, failure, html, icon, live, mount, onLeave, plural, preservingFocus, setMessage, sheet as createSheet, sheetContent, toast, writeParams } from "./ui";

/*
 * Locations (/staff/locations): the places items are kept, as the tree staff think in (Office → Storage Area → Cabinet 1 →
 * Shelf 2). A place carries plain-language directions, one reference picture shared by every item kept there, and whether
 * Self-Service may show them. Items choose a place in their own edit form; this page is where places are made, described,
 * moved, retired, and where look-alike spellings left by the migration are combined on purpose.
 */

type Answer = { revision: number; locations: PlaceRow[] };
const SNIPPET = 90;

export async function locationsWorkspace(): Promise<void> {
  const session = await loadSession("items");
  if (!session) return;
  document.title = "Locations · Staff workspace";
  shell(session, "items", html`
    <header class="page-header">
      <div class="page-header__title"><h1>Locations</h1><p>Where things are kept. Items point at a place, so its directions and picture are written once and shared.</p></div>
      <div class="page-header__actions">
        <p class="live-status" id="live-status">Connecting…</p>
        <a class="button button--secondary" href="/staff/items" data-route>${icon("box")}Items</a>
        <button class="button button--primary" type="button" id="new-place">${icon("plus")}New place</button>
      </div>
    </header>
    <div id="look-alikes"></div>
    <div class="table-toolbar">
      <label class="search-field">${icon("search")}<span class="visually-hidden">Search places</span><input id="place-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search places" data-search /><kbd aria-hidden="true">/</kbd><button class="search-field__clear" type="button" id="clear-search" aria-label="Clear search" hidden>${icon("close")}</button></label>
      <label class="checkbox"><input type="checkbox" id="show-inactive" /><span>Show inactive</span></label>
      <p class="table-toolbar__count" id="place-count" aria-live="polite"></p>
    </div>
    <div id="place-results" aria-busy="true"><div class="skeleton skeleton--block"></div></div>
    <dialog class="sheet" id="sheet" aria-labelledby="sheet-title"></dialog>`);

  const params = new URLSearchParams(window.location.search);
  let data: Answer | null = null;
  let places = placesOf([]);
  let paths = new Map<string, string>();
  let rows = new Map<string, PlaceRow>();
  let openId: string | null = null;
  let dirty = false;
  let pendingOpen = params.get("place");
  const sheetElement = document.querySelector<HTMLDialogElement>("#sheet")!;
  const results = document.querySelector<HTMLElement>("#place-results")!;
  const search = document.querySelector<HTMLInputElement>("#place-search")!;
  const inactive = document.querySelector<HTMLInputElement>("#show-inactive")!;
  search.value = params.get("q") ?? "";

  const panel = createSheet(sheetElement, {
    dirty: () => dirty,
    onClose: () => { openId = null; dirty = false; writeParams({ place: null }); results.querySelectorAll(".is-open").forEach((row) => row.classList.remove("is-open")); }
  });
  onLeave(() => { dirty = false; });

  /* ---------- The tree ---------- */

  const countLabel = (row: PlaceRow) => row.itemCount ? plural(row.itemCount, "item") : "No items";

  function rowMarkup(row: PlaceRow, depth: number): Html {
    const directions = row.directions ? (row.directions.length > SNIPPET ? `${row.directions.slice(0, SNIPPET).trimEnd()}…` : row.directions) : "";
    return html`<li class="place-row place-row--d${depth} ${row.active ? "" : "is-inactive"} ${row.id === openId ? "is-open" : ""}" data-key="${row.id}">
      <button type="button" class="place-row__main" data-open="${row.id}">
        <span class="place-row__thumb ${row.photo ? "" : "place-row__thumb--none"}">${row.photo ? html`<img src="/api/staff/location-media/${row.photo.id}/thumb" alt="" width="44" height="44" loading="lazy" decoding="async" />` : icon("pin")}</span>
        <span class="place-row__text"><span class="place-row__name">${row.name}</span>${directions ? html`<span class="place-row__sub">${directions}</span>` : html`<span class="place-row__sub place-row__sub--empty">No directions yet</span>`}</span>
      </button>
      <span class="place-row__meta tags">
        ${row.active ? "" : html`<span class="tag">Inactive</span>`}
        <span class="tag ${row.visibility === "SELF_SERVICE" ? "tag--ok" : ""}">${VISIBILITY_LABELS[row.visibility] ?? row.visibility}</span>
        ${row.openReports ? html`<span class="tag tag--warn">${plural(row.openReports, "report")}</span>` : ""}
        ${row.itemCount ? html`<a class="text-link" href="/staff/items?location=${row.id}" data-route>${countLabel(row)}<span class="visually-hidden"> in ${row.name}: view them</span></a>` : html`<span class="muted">${countLabel(row)}</span>`}
      </span></li>`;
  }

  /** Places that read alike under one parent. The migration never merges them; this is what asks staff to look. */
  function lookAlikeNotice(): Html {
    const groups = lookAlikes(placesOf((data?.locations ?? []).filter((row) => row.active)));
    if (!groups.length) return html``;
    return html`<div class="callout callout--review" role="note">${icon("info")}<div><p><strong>Some places have almost the same name.</strong> They were made from what staff typed, and nothing was combined for you. Open one and use <em>Move items</em> to combine them on purpose.</p>
      <ul class="look-alikes">${groups.map((group) => html`<li>${group.map((place, index) => html`${index ? " and " : ""}<button type="button" class="text-link" data-open="${place.id}">${paths.get(place.id)}</button> <span class="muted">(${countLabel(rows.get(place.id)!)})</span>`)}</li>`)}</ul></div></div>`;
  }

  const render = () => {
    if (!data) return;
    results.removeAttribute("aria-busy");
    const query = search.value.trim().toLowerCase();
    writeParams({ q: query || null, place: openId });
    mount(document.querySelector("#look-alikes")!, lookAlikeNotice());
    const ordered = inOrder(places).filter(({ place }) => inactive.checked || place.active);
    // A place matches by name, path or directions; the places around a match stay so it is seen in context.
    const matching = new Set(ordered.filter(({ place }) => !query || `${paths.get(place.id)} ${rows.get(place.id)?.directions ?? ""}`.toLowerCase().includes(query)).map(({ place }) => place.id));
    const shownIds = new Set([...matching].flatMap((id) => ancestry(places, id).map((place) => place.id)));
    const shown = ordered.filter(({ place }) => shownIds.has(place.id));
    document.querySelector("#place-count")!.textContent = plural(matching.size, "place");
    (document.querySelector("#clear-search") as HTMLElement).hidden = !search.value;
    preservingFocus(results, () => mount(results, shown.length
      ? html`<ul class="place-tree" aria-label="Places">${shown.map(({ place, depth }) => rowMarkup(rows.get(place.id)!, depth))}</ul>`
      : data!.locations.length
        ? emptyState("No places match", "Try another search, or show inactive places.", html`<button class="button button--secondary" type="button" id="clear-all">Clear search</button>`)
        : emptyState("No places yet", "Add the places items are kept, such as the office, a cabinet or a shelf. Items then choose from them instead of typing.", html`<button class="button button--primary" type="button" data-new>${icon("plus")}New place</button>`)));
  };

  const poll = live<Answer>("/api/staff/locations", {
    interval: 10_000,
    status: () => document.querySelector("#live-status"),
    onData: (next) => {
      data = next;
      places = placesOf(next.locations);
      rows = new Map(next.locations.map((row) => [row.id, row]));
      paths = new Map(next.locations.map((row) => [row.id, pathOf(places, row.id)!]));
      render();
      if (pendingOpen) { if (rows.has(pendingOpen)) openPlace(pendingOpen); pendingOpen = null; }
    },
    onError: (error) => {
      if (error.status === 401) expired();
      else if (!data) { results.removeAttribute("aria-busy"); mount(results, emptyState("Places could not be loaded", `${error.message} Retrying automatically.`, "", "error")); }
    }
  });

  let searchTimer = 0;
  onLeave(() => window.clearTimeout(searchTimer));
  search.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(render, 120); });
  search.addEventListener("keydown", (event) => { if (event.key === "Escape" && search.value) { search.value = ""; render(); } });
  inactive.addEventListener("change", render);
  document.querySelector("#clear-search")!.addEventListener("click", () => { search.value = ""; render(); search.focus(); });
  document.querySelector("#new-place")!.addEventListener("click", () => openPlace(null));
  const onClick = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-new]")) openPlace(null);
    else if (target.closest("#clear-all")) { search.value = ""; inactive.checked = true; render(); }
    else {
      const open = target.closest<HTMLElement>("[data-open]");
      if (open) openPlace(open.dataset.open!);
    }
  };
  results.addEventListener("click", onClick);
  document.querySelector("#look-alikes")!.addEventListener("click", onClick);

  /* ---------- The place sheet ---------- */

  /** Where a place may be put: an active place that is not itself or inside it, with room left beneath it for what the place holds. */
  function parentChoices(self: string | null, current: string | null): Html {
    const own = self ? withinPlace(places, self) : new Set<string>();
    const room = self ? levelsBelow(places, self) : 1;
    return html`<option value="">Top level</option>${inOrder(places).filter(({ place, depth }) => !own.has(place.id) && (place.active || place.id === current) && depth + room <= MAX_DEPTH).map(({ place }) =>
      html`<option value="${place.id}" ${place.id === current ? html`selected` : ""}>${paths.get(place.id)}${place.active ? "" : " (inactive)"}</option>`)}`;
  }

  function openPlace(id: string | null): void {
    if ((id ?? "") !== (openId ?? "") && !panel.discardOk()) return;
    dirty = false;
    openId = id;
    results.querySelectorAll(".is-open").forEach((row) => row.classList.remove("is-open"));
    if (id) results.querySelector(`[data-key="${CSS.escape(id)}"]`)?.classList.add("is-open");
    writeParams({ place: id });
    const row = id ? rows.get(id) : undefined;
    mount(sheetElement, sheetContent(row ? html`<span class="mono">${row.id}</span>` : "New place", row ? row.name : "Add a place", form(row)));
    panel.open();
    bind(row);
  }

  function form(row: PlaceRow | undefined): Html {
    const creating = !row;
    const hint = (id: string, text: string) => html`<p class="field__hint" id="p-${id}-hint">${text}</p>`;
    return html`
      ${row ? html`<section class="profile" id="place-photo" aria-label="Picture"><div class="profile__photo" data-tile></div>
        <div class="profile__info"><p class="profile__meta profile__meta--place">${icon("pin")}<span>${paths.get(row.id)}</span></p>
          <p class="profile__meta">${row.itemCount ? html`<a class="text-link" href="/staff/items?location=${row.id}" data-route>${countLabel(row)} kept here</a>` : "No items kept here"}${row.openReports ? ` · ${plural(row.openReports, "open report")}` : ""}</p>
          <div class="profile__actions" data-actions></div></div></section>` : ""}
      <form id="place-form" class="form" novalidate>
        <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" value="${row?.name ?? ""}" required maxlength="120" autocomplete="off" placeholder="Cabinet 1" aria-describedby="p-name-hint" />${hint("name", "What staff call it. Cabinet 1 inside Storage Area reads as Storage Area › Cabinet 1.")}</div>
        <div class="field"><label for="p-parent">Inside</label><select id="p-parent" name="parentId" aria-describedby="p-parent-hint">${parentChoices(row?.id ?? null, row?.parentId ?? null)}</select>${hint("parent", `Places nest up to ${MAX_DEPTH} levels, for example Office, Storage Area, Cabinet 1, Shelf 2, Box.`)}</div>
        <div class="field"><label for="p-directions">Directions <span class="field__optional">optional</span></label><textarea id="p-directions" name="directions" rows="3" maxlength="600" aria-describedby="p-directions-hint">${row?.directions ?? ""}</textarea>${hint("directions", "Plain words for someone who has never been here: “Second door on the left, grey cabinet by the window.” Keep it short.")}</div>
        <fieldset class="field fieldset"><legend>Who sees the directions and picture</legend>
          ${VISIBILITIES.map((value) => html`<label class="choice"><input type="radio" name="visibility" value="${value}" ${(row?.visibility ?? "STAFF_ONLY") === value ? html`checked` : ""} /><span><strong>${VISIBILITY_LABELS[value]}</strong>
            <small>${value === "STAFF_ONLY" ? "Only signed-in staff. Self-Service says to ask DOL staff." : "Anyone using Self-Service on a phone. Items here show the route, the directions and the picture. A place inside a staff-only place is never shown."}</small></span></label>`)}</fieldset>
        ${row ? html`<label class="checkbox"><input type="checkbox" name="active" ${row.active ? html`checked` : ""} /><span>In use</span></label>
          <p class="field__hint">Turning this off keeps every item’s history. Items already here stay here; no new item can be kept in an inactive place, and places inside it must be turned off or moved first.</p>` : ""}
        <div class="form-alert" id="place-alert" role="alert" hidden></div>
        <div class="form-actions form-actions--sticky"><button class="button button--primary" type="submit">${creating ? "Add place" : "Save changes"}</button></div>
      </form>
      ${row && row.itemCount ? html`<section class="card" aria-labelledby="move-title"><div class="card__head"><h3 id="move-title">Move items</h3></div>
        <p class="card__text">Move all ${plural(row.itemCount, "item")} kept here to another place, for example to combine two spellings of one cabinet. Each item’s history records the move.</p>
        <div class="field"><label for="move-to">Move to</label><select id="move-to"><option value="">Choose a place</option>${inOrder(places).filter(({ place }) => place.active && place.id !== row.id).map(({ place }) => html`<option value="${place.id}">${paths.get(place.id)}</option>`)}</select></div>
        <div class="form-alert" id="move-alert" role="alert" hidden></div>
        <div class="where__buttons"><button type="button" class="button button--secondary" id="move-go">Move ${plural(row.itemCount, "item")}</button></div></section>` : ""}`;
  }

  function bind(row: PlaceRow | undefined): void {
    const place = sheetElement.querySelector<HTMLFormElement>("#place-form")!;
    const alert = place.querySelector<HTMLElement>("#place-alert")!;
    place.addEventListener("input", () => { dirty = true; });
    place.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(place);
      const name = String(values.get("name") ?? "");
      if (!name.trim()) { place.querySelector("#p-name")!.setAttribute("aria-invalid", "true"); setMessage(alert, "Give the place a name."); place.querySelector<HTMLInputElement>("#p-name")!.focus(); return; }
      place.querySelector("#p-name")!.removeAttribute("aria-invalid");
      const button = place.querySelector<HTMLButtonElement>("button[type=submit]")!;
      button.disabled = true;
      setMessage(alert, "");
      const body = { name, parentId: String(values.get("parentId") ?? "") || null, directions: String(values.get("directions") ?? ""), visibility: String(values.get("visibility")), ...(row ? { active: values.get("active") === "on", updatedAt: row.updatedAt } : {}) };
      try {
        if (!row) {
          const { id } = await api<{ id: string }>("/api/staff/locations", { method: "POST", body: JSON.stringify(body) });
          dirty = false;
          pendingOpen = id;
          await poll.refresh();
          toast("Place added. Add directions or a picture next.");
          return;
        }
        const result = await api<{ changed: number }>(`/api/staff/locations/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
        dirty = false;
        await poll.refresh();
        openPlace(row.id);
        toast(result.changed ? "Changes saved." : "No changes to save.");
      } catch (error) {
        const stale = error instanceof ApiError && error.status === 409 && /Someone else/.test(error.message);
        setMessage(alert, stale ? html`${failure(error)} <button type="button" class="text-link" data-reload>Load the latest details</button>` : failure(error));
        alert.querySelector("[data-reload]")?.addEventListener("click", async () => { dirty = false; await poll.refresh(); openPlace(row!.id); });
        button.disabled = false;
      }
    });
    if (!row) { place.querySelector<HTMLInputElement>("#p-name")!.focus(); return; }
    photoPanel(sheetElement.querySelector<HTMLElement>("#place-photo")!, {
      id: row.id, name: row.name, photo: row.photo, noun: "picture", endpoint: `/api/staff/locations/${row.id}/photo`, thumbUrl: (id) => `/api/staff/location-media/${id}/thumb`,
      hintAdd: "One picture shows where to look; every item kept here shares it. Show the cabinet or shelf, not people or documents.",
      hintHas: "Every item kept here shares this picture. Self-Service shows it only if this place is shared.",
      removeNote: "Items keep their place.",
      view: (shown) => void openViewer(`/api/staff/location-media/${shown.id}/display`, `Picture of ${row.name}`, () => sheetElement.querySelector<HTMLElement>("#place-photo [data-view] img"), row.name),
      changed: async () => { await poll.refresh(); },
      refresh: async () => { await poll.refresh(); openPlace(row.id); }
    });
    const go = sheetElement.querySelector<HTMLButtonElement>("#move-go");
    go?.addEventListener("click", async () => {
      const target = sheetElement.querySelector<HTMLSelectElement>("#move-to")!;
      const problem = sheetElement.querySelector<HTMLElement>("#move-alert")!;
      if (!target.value) { setMessage(problem, "Choose the place to move them to."); target.focus(); return; }
      if (!window.confirm(`Move ${plural(row.itemCount, "item")} from ${paths.get(row.id)} to ${paths.get(target.value)}?`)) return;
      go.disabled = true;
      setMessage(problem, "");
      try {
        const { moved } = await api<{ moved: number }>(`/api/staff/locations/${row.id}/move-items`, { method: "POST", body: JSON.stringify({ toLocationId: target.value }) });
        await poll.refresh();
        openPlace(row.id);
        toast(`Moved ${plural(moved, "item")}.`);
      } catch (error) {
        setMessage(problem, failure(error));
        go.disabled = false;
      }
    });
  }

}
