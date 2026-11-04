import { openViewer, photoPanel, rowThumb } from "./item-photo";
import type { VisualItem } from "./item-icons";
import { MAX_DEPTH, VISIBILITIES, VISIBILITY_LABELS, ancestry, inOrder, levelsBelow, lookAlikes, pathOf, placesOf, withinPlace } from "./location-tree";
import type { PlaceRow } from "./staff";
import { UP_TO_ITEMS, ageOf, loadSession, shell } from "./staff-shell";
import type { Session } from "./staff-shell";
import { ApiError, type Html, api, emptyState, expired, failure, formatDateTime, formatQuantity, html, icon, live, mount, navigate, onLeave, plural, preservingFocus, readKept, setMessage, sheet as createSheet, sheetContent, toast, units, writeParams } from "./ui";
import { formEdits, warnOnUnload } from "./unsaved";

/** A place sheet's tabs, as the item sheet's (V1.16.7). */
type PlaceTab = "overview" | "details" | "history";
const PLACE_TABS: Array<[PlaceTab, string]> = [["overview", "Overview"], ["details", "Edit details"], ["history", "History"]];
/** An item kept in a place, from the item list All items reads (inventory.ts staffInventory). */
type KeptItem = VisualItem & { id: string; locationId: string | null; onHand: number; unit: string; updatedAt?: string | null };
/** What a History tab shows of Activity (activity.ts ActivityEvent). */
type PlaceEvent = { id: string; at: string | null; summary: string; itemId: string | null; change: number; stockChanged: boolean };
/** How many items kept here, and how many events, a place sheet lists before handing over to Items and Activity. */
const KEPT_SHOWN = 12;
const HISTORY_SHOWN = 15;

/*
 * Locations (/staff/locations): the places items are kept, as the tree staff think in (Office → Storage Area → Cabinet 1 →
 * Shelf 2). A place carries plain-language directions, one reference picture shared by every item kept there, and whether
 * Self-Service may show them. Items choose a place in their own edit form; this page is where places are made, described,
 * moved, retired, and where look-alike spellings left by the migration are combined on purpose. On the website a place is also checked
 * from here (LH-IP02-S03): Check this place starts, or resumes, the person's check, which runs in this page at ?check=LA-….
 */

type Answer = { revision: number; locations: PlaceRow[] };
const SNIPPET = 90;

export async function locationsWorkspace(): Promise<void> {
  const session = await loadSession("items");
  if (!session) return;
  // A check runs in this page; its id becomes an API path, so only the shape the server issues is taken.
  const checking = new URLSearchParams(window.location.search).get("check");
  if (checking && /^LA-[A-Za-z0-9-]+$/.test(checking)) return placeCheck(session, checking);
  document.title = "Locations · Staff workspace";
  shell(session, "items", html`
    <header class="page-header">
      <div class="page-header__title">${UP_TO_ITEMS}<h1>Locations</h1><p>Where things are kept. Items point at a place, so its directions and picture are written once and shared.</p></div>
      <div class="page-header__actions">
        <p class="live-status" id="live-status">Connecting…</p>
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
  let placeTab: PlaceTab = "overview";
  /** The place form's edits, against how it was drawn (V1.16.4 §4.7): a form typed back to what it was is clean. */
  let edited: () => boolean = () => false;
  let pendingOpen = params.get("place");
  /** A place just added opens on Edit details, where its directions go next; one opened by its address opens on its Overview. */
  let pendingTab: PlaceTab = "overview";
  const sheetElement = document.querySelector<HTMLDialogElement>("#sheet")!;
  const results = document.querySelector<HTMLElement>("#place-results")!;
  const search = document.querySelector<HTMLInputElement>("#place-search")!;
  const inactive = document.querySelector<HTMLInputElement>("#show-inactive")!;
  search.value = params.get("q") ?? "";

  const panel = createSheet(sheetElement, {
    dirty: () => edited(),
    onClose: () => { openId = null; edited = () => false; writeParams({ place: null }); results.querySelectorAll(".is-open").forEach((row) => row.classList.remove("is-open")); }
  });
  onLeave(() => { edited = () => false; });

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
      if (pendingOpen) { if (rows.has(pendingOpen)) openPlace(pendingOpen, pendingTab); pendingOpen = null; pendingTab = "overview"; }
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

  function openPlace(id: string | null, tab: PlaceTab = "overview"): void {
    if ((id ?? "") !== (openId ?? "") && panel.unsaved()) { void panel.discardOk().then((discard) => { if (discard) openPlace(id, tab); }); return; }
    edited = () => false;
    openId = id;
    placeTab = tab;
    results.querySelectorAll(".is-open").forEach((row) => row.classList.remove("is-open"));
    if (id) results.querySelector(`[data-key="${CSS.escape(id)}"]`)?.classList.add("is-open");
    writeParams({ place: id });
    const row = id ? rows.get(id) : undefined;
    mount(sheetElement, sheetContent(row ? html`<span class="mono">${row.id}</span>` : "New place", row ? row.name : "Add a place", row ? placeSheet(row) : form(undefined)));
    panel.open();
    bind(row);
  }

  /**
   * A place's sheet takes the item sheet's layout (V1.16.7): a stage that holds only its picture, with the picture's own controls
   * under it as an item's are; then Overview (where it is, its last check, Check this place, and the items kept here, each opening
   * its own sheet in All items), Edit details (the form, Move items and Delete) and History (what happened to the items here).
   */
  function placeSheet(row: PlaceRow): Html {
    const tabPanel = (key: PlaceTab, body: Html, stack = true) => html`<section id="place-panel-${key}" class="${stack ? "panel-stack" : ""}" role="tabpanel" aria-labelledby="place-tab-${key}" ${key === "details" ? "" : html`tabindex="0"`} ${key === placeTab ? "" : html`hidden`}>${body}</section>`;
    return html`<section class="profile theater drafting" id="place-photo" aria-label="Place picture"><div class="profile__photo" data-tile></div><div class="profile__actions" data-actions></div></section>
      <div class="tabs" role="tablist" aria-label="Place sections">
        ${PLACE_TABS.map(([key, text]) => html`<button type="button" role="tab" id="place-tab-${key}" aria-controls="place-panel-${key}" aria-selected="${key === placeTab}" tabindex="${key === placeTab ? 0 : -1}">${text}</button>`)}
      </div>
      ${tabPanel("overview", html`<div class="place-profile">
          <p class="profile__meta profile__meta--place">${icon("pin")}<span>${paths.get(row.id)}</span></p>
          <p class="profile__meta profile__meta--fresh">${icon("clock")}<span>${row.lastCheckedAt ? `Last checked ${ageOf(row.lastCheckedAt)}` : "Not checked yet"}</span></p>
          ${row.openReports ? html`<p class="profile__meta profile__meta--finding">${icon("alert")}<span>${plural(row.openReports, "open report")} about items here</span></p>` : ""}
          ${row.active ? html`<p class="where__buttons"><button type="button" class="button button--secondary button--sm" data-check-place>${icon("check")}Check this place</button></p>
            <div class="form-alert" id="check-alert" role="alert" hidden></div>` : html`<p class="profile__meta">Not in use. Turn on In use in Edit details to check it again.</p>`}
        </div>
        <section aria-labelledby="kept-title"><h3 class="section-label" id="kept-title">Kept here${row.itemCount ? ` · ${row.itemCount}` : ""}</h3>
          <div id="kept-here">${row.itemCount ? html`<p class="muted" role="status">Loading the items kept here…</p>` : html`<p class="muted">No items are kept here. An item is put here from its own Edit details.</p>`}</div></section>`)}
      ${tabPanel("details", form(row), false)}
      ${tabPanel("history", html`<ol class="history" id="place-history"><li class="history__empty" role="status">Loading…</li></ol>
        <p><a class="text-link" href="/staff/activity?location=${encodeURIComponent(paths.get(row.id) ?? row.name)}" data-route>All activity here ${icon("arrow")}</a></p>`)}`;
  }

  /** The items kept here, from the item list All items reads; each opens its own sheet in All items, the same sheet with the same tabs. */
  async function showKept(row: PlaceRow): Promise<void> {
    const host = sheetElement.querySelector<HTMLElement>("#kept-here");
    if (!host || !row.itemCount) return;
    try {
      const { items } = await readKept<{ items: KeptItem[] }>("/api/staff/inventory");
      if (openId !== row.id || !host.isConnected) return;
      const here = items.filter((item) => item.locationId === row.id).sort((a, b) => a.name.localeCompare(b.name));
      const shown = here.slice(0, KEPT_SHOWN);
      mount(host, here.length ? html`<ul class="kept-list">${shown.map((item) => html`<li><a class="kept-row" href="/staff/items?item=${encodeURIComponent(item.id)}" data-route>${rowThumb(item)}
          <span class="kept-row__name">${item.name}</span><span class="kept-row__sub"><span class="mono">${item.id}</span> · ${formatQuantity(item.onHand)} ${units(item.onHand, item.unit)}</span></a></li>`)}</ul>
        ${here.length > shown.length ? html`<p><a class="text-link" href="/staff/items?location=${row.id}" data-route>All ${plural(here.length, "item")} kept here, in Items ${icon("arrow")}</a></p>` : ""}`
        : html`<p class="muted">No items are kept here now.</p>`);
    } catch (error) {
      if (openId === row.id && host.isConnected) mount(host, html`<p class="form-alert" role="alert">${failure(error)} <a class="text-link" href="/staff/items?location=${row.id}" data-route>See them in Items</a></p>`);
    }
  }

  /** What happened to the items kept here and in the places inside it: the newest entries of Activity, filtered to this place. */
  async function showHistory(row: PlaceRow): Promise<void> {
    const host = sheetElement.querySelector<HTMLElement>("#place-history");
    if (!host || host.dataset.loaded) return;
    host.dataset.loaded = "1";
    try {
      const { events } = await api<{ events: PlaceEvent[] }>(`/api/staff/activity?location=${encodeURIComponent(paths.get(row.id) ?? row.name)}&limit=${HISTORY_SHOWN}`);
      if (openId !== row.id || !host.isConnected) return;
      mount(host, events.length ? html`${events.map((event) => {
        const tone = event.change > 0 ? "is-in" : event.change < 0 ? "is-out" : "";
        return html`<li class="history__item ${tone}"><div>${event.itemId ? html`<a class="history__title text-link" href="/staff/items?item=${encodeURIComponent(event.itemId)}" data-route>${event.summary}</a>` : html`<p class="history__title">${event.summary}</p>`}
          ${event.at ? html`<p class="history__meta"><time datetime="${event.at}">${formatDateTime(event.at)}</time></p>` : ""}</div>
          ${event.stockChanged ? html`<p class="history__qty ${tone}">${event.change > 0 ? "+" : ""}${formatQuantity(event.change)}</p>` : ""}</li>`;
      })}` : html`<li class="history__empty">Nothing has happened to the items here yet.</li>`);
    } catch (error) {
      delete host.dataset.loaded;
      if (openId === row.id && host.isConnected) mount(host, html`<li class="history__empty"><span class="form-alert" role="alert">${failure(error)}</span></li>`);
    }
  }

  /** The tabs, as the item sheet's: a click or the arrow keys choose one, and History loads the first time it is shown. */
  function bindTabs(row: PlaceRow): void {
    const buttons = [...sheetElement.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const select = (target: HTMLButtonElement) => {
      buttons.forEach((entry) => {
        const selected = entry === target;
        entry.setAttribute("aria-selected", String(selected));
        entry.tabIndex = selected ? 0 : -1;
        sheetElement.querySelector<HTMLElement>(`#${entry.getAttribute("aria-controls")}`)!.hidden = !selected;
      });
      placeTab = target.id.replace("place-tab-", "") as PlaceTab;
      if (placeTab === "history") void showHistory(row);
    };
    buttons.forEach((button, index) => {
      button.addEventListener("click", () => select(button));
      button.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        const next = buttons[(index + step + buttons.length) % buttons.length]!;
        select(next);
        next.focus();
      });
    });
    if (placeTab === "history") void showHistory(row);
  }

  function form(row: PlaceRow | undefined): Html {
    const creating = !row;
    const hint = (id: string, text: string) => html`<p class="field__hint" id="p-${id}-hint">${text}</p>`;
    return html`
      <form id="place-form" class="form" novalidate>
        <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" value="${row?.name ?? ""}" required maxlength="120" autocomplete="off" placeholder="Cabinet 1" aria-describedby="p-name-hint" />${hint("name", "What staff call it. Cabinet 1 inside Storage Area reads as Storage Area › Cabinet 1.")}</div>
        <div class="field"><label for="p-parent">Inside</label><select id="p-parent" name="parentId" aria-describedby="p-parent-hint">${parentChoices(row?.id ?? null, row?.parentId ?? null)}</select>${hint("parent", `Places nest up to ${MAX_DEPTH} levels, for example Office, Storage Area, Cabinet 1, Shelf 2, Box.`)}
          <div class="inside-tools"><button type="button" class="text-link" id="inside-add">${icon("plus")}Add a place to this list</button><button type="button" class="text-link inside-tools__remove" id="inside-remove" hidden></button></div>
          <div class="inside-new" id="inside-new" hidden><label for="inside-name">New place</label><div class="inside-new__row"><input id="inside-name" maxlength="120" autocomplete="off" placeholder="Cabinet 2" /><button type="button" class="button button--secondary" id="inside-save">Add</button></div></div>
          <div class="form-alert" id="inside-alert" role="alert" hidden></div></div>
        <div class="field"><label for="p-directions">Directions <span class="field__optional">optional</span></label><textarea id="p-directions" name="directions" rows="3" maxlength="600" aria-describedby="p-directions-hint">${row?.directions ?? ""}</textarea>${hint("directions", "Plain words for someone who has never been here: “Second door on the left, grey cabinet by the window.” Keep it short.")}</div>
        <fieldset class="field fieldset"><legend>Who sees the directions and picture</legend>
          ${VISIBILITIES.map((value) => html`<label class="choice"><input type="radio" name="visibility" value="${value}" ${(row?.visibility ?? "STAFF_ONLY") === value ? html`checked` : ""} /><span><strong>${VISIBILITY_LABELS[value]}</strong>
            <small>${value === "STAFF_ONLY" ? "Only signed-in staff. Self-Service says to ask DoL staff." : "Anyone using Self-Service on a phone. Items here show the route, the directions and the picture. A place inside a staff-only place is never shown."}</small></span></label>`)}</fieldset>
        ${row ? html`<label class="checkbox"><input type="checkbox" name="active" ${row.active ? html`checked` : ""} /><span>In use</span></label>
          <p class="field__hint">Turning this off keeps every item’s history. Items already here stay here; no new item can be kept in an inactive place, and places inside it must be turned off or moved first.</p>` : ""}
        <div class="form-alert" id="place-alert" role="alert" hidden></div>
        <div class="form-actions form-actions--sticky"><button class="button button--primary" type="submit">${creating ? "Add place" : "Save changes"}</button></div>
      </form>
      ${row && row.itemCount ? html`<section class="card" aria-labelledby="move-title"><div class="card__head"><h3 id="move-title">Move items</h3></div>
        <p class="card__text">Move all ${plural(row.itemCount, "item")} kept here to another place, for example to combine two spellings of one cabinet. Each item’s history records the move.</p>
        <div class="field"><label for="move-to">Move to</label><select id="move-to"><option value="">Choose a place</option>${inOrder(places).filter(({ place }) => place.active && place.id !== row.id).map(({ place }) => html`<option value="${place.id}">${paths.get(place.id)}</option>`)}</select></div>
        <div class="form-alert" id="move-alert" role="alert" hidden></div>
        <div class="where__buttons"><button type="button" class="button button--secondary" id="move-go">Move ${plural(row.itemCount, "item")}</button></div></section>` : ""}
      ${row ? deleteCard(row) : ""}`;
  }

  /**
   * The Inside list manages itself: a place can be added to it (top level, nestable later from its own sheet) or the chosen
   * one removed (deleted, under the same rules as Delete place), without leaving the form being edited.
   */
  function bindInside(row: PlaceRow | undefined): void {
    const select = sheetElement.querySelector<HTMLSelectElement>("#p-parent")!;
    const remove = sheetElement.querySelector<HTMLButtonElement>("#inside-remove")!;
    const adding = sheetElement.querySelector<HTMLElement>("#inside-new")!;
    const name = sheetElement.querySelector<HTMLInputElement>("#inside-name")!;
    const save = sheetElement.querySelector<HTMLButtonElement>("#inside-save")!;
    const problem = sheetElement.querySelector<HTMLElement>("#inside-alert")!;
    const choose = (id: string) => {
      mount(select, parentChoices(row?.id ?? null, id || null));
      select.value = id;
      const chosen = id ? rows.get(id) : undefined;
      remove.hidden = !chosen;
      remove.textContent = chosen ? `Remove ${chosen.name} from this list` : "";
    };
    choose(select.value);
    select.addEventListener("change", () => { setMessage(problem, ""); choose(select.value); });
    sheetElement.querySelector("#inside-add")!.addEventListener("click", () => { adding.hidden = false; setMessage(problem, ""); name.focus(); });
    const add = async () => {
      const value = name.value.trim();
      if (!value) { setMessage(problem, "Give the new place a name."); name.focus(); return; }
      save.disabled = true;
      setMessage(problem, "");
      try {
        const { id } = await api<{ id: string }>("/api/staff/locations", { method: "POST", body: JSON.stringify({ name: value, parentId: null, directions: "", visibility: "STAFF_ONLY" }) });
        await poll.refresh();
        name.value = "";
        adding.hidden = true;
        choose(id);
        warnOnUnload();
        select.focus();
        toast(`${value} added to the list.`);
      } catch (error) {
        setMessage(problem, failure(error));
      } finally {
        save.disabled = false;
      }
    };
    save.addEventListener("click", () => void add());
    name.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void add(); } });
    remove.addEventListener("click", async () => {
      const chosen = rows.get(select.value);
      if (!chosen || !window.confirm(`Remove ${paths.get(chosen.id)} from the list? This deletes the place and can't be undone.`)) return;
      remove.disabled = true;
      setMessage(problem, "");
      try {
        await api(`/api/staff/locations/${chosen.id}?expected=${encodeURIComponent(chosen.updatedAt)}`, { method: "DELETE" });
        await poll.refresh();
        choose("");
        warnOnUnload();
        toast(`${chosen.name} removed.`);
      } catch (error) {
        setMessage(problem, html`${failure(error)} <button type="button" class="text-link" data-open-chosen>Open ${chosen.name}</button>`);
        problem.querySelector("[data-open-chosen]")?.addEventListener("click", () => openPlace(chosen.id));
      } finally {
        remove.disabled = false;
      }
    });
  }

  /** Delete, for a place added by mistake. What blocks it is said up front; the server also refuses a place past records name. */
  function deleteCard(row: PlaceRow): Html {
    const inside = [...places.values()].filter((place) => place.parentId === row.id).length;
    const blocked = row.itemCount ? `Move the ${plural(row.itemCount, "item")} kept here to another place first (Move items, above).`
      : inside ? `Move or delete the ${plural(inside, "place")} inside it first.` : "";
    return html`<section class="card" aria-labelledby="delete-title"><div class="card__head"><h3 id="delete-title">Delete place</h3></div>
      <p class="card__text">${blocked || "For a place added by mistake. A place that past records name (a report, cataloguing or a check) can’t be deleted; turn off In use instead."}</p>
      ${blocked ? "" : html`<div class="form-alert" id="delete-alert" role="alert" hidden></div>
        <div class="where__buttons"><button type="button" class="button button--danger" id="delete-go">Delete ${row.name}</button></div>`}</section>`;
  }

  function bind(row: PlaceRow | undefined): void {
    const checkPlace = sheetElement.querySelector<HTMLButtonElement>("[data-check-place]");
    checkPlace?.addEventListener("click", async () => {
      checkPlace.disabled = true;
      try {
        const { checkLink, startCheck } = await import("./audit-screen");
        const id = await startCheck({ mode: "signed-in", session: session!, access: null }, row!.id, paths.get(row!.id) ?? row!.name);
        panel.close(true);
        navigate(checkLink(id));
      } catch (error) {
        setMessage(sheetElement.querySelector("#check-alert")!, failure(error));
        checkPlace.disabled = false;
      }
    });
    const place = sheetElement.querySelector<HTMLFormElement>("#place-form")!;
    const alert = place.querySelector<HTMLElement>("#place-alert")!;
    edited = formEdits(place).dirty;
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
          edited = () => false;
          pendingOpen = id;
          pendingTab = "details";
          await poll.refresh();
          toast("Place added. Add directions or a picture next.");
          return;
        }
        const result = await api<{ changed: number }>(`/api/staff/locations/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
        edited = () => false;
        await poll.refresh();
        openPlace(row.id, placeTab);
        toast(result.changed ? "Changes saved." : "No changes to save.");
      } catch (error) {
        const stale = error instanceof ApiError && error.status === 409 && /Someone else/.test(error.message);
        setMessage(alert, stale ? html`${failure(error)} <button type="button" class="text-link" data-reload>Load the latest details</button>` : failure(error));
        alert.querySelector("[data-reload]")?.addEventListener("click", async () => { edited = () => false; await poll.refresh(); openPlace(row!.id, placeTab); });
        button.disabled = false;
      }
    });
    bindInside(row);
    if (!row) { place.querySelector<HTMLInputElement>("#p-name")!.focus(); return; }
    bindTabs(row);
    void showKept(row);
    photoPanel(sheetElement.querySelector<HTMLElement>("#place-photo")!, {
      id: row.id, name: row.name, photo: row.photo, noun: "picture", endpoint: `/api/staff/locations/${row.id}/photo`, thumbUrl: (id) => `/api/staff/location-media/${id}/thumb`,
      hintAdd: "One picture shows where to look; every item kept here shares it. Show the cabinet or shelf, not people or documents.",
      hintHas: "Every item kept here shares this picture. Self-Service shows it only if this place is shared.",
      removeNote: "Items keep their place.",
      view: (shown) => void openViewer(`/api/staff/location-media/${shown.id}/display`, `Picture of ${row.name}`, () => sheetElement.querySelector<HTMLElement>("#place-photo [data-view] img:not(.photo-tile__ambient)"), row.name),
      changed: async () => { await poll.refresh(); },
      refresh: async () => { await poll.refresh(); openPlace(row.id, placeTab); }
    });
    const remove = sheetElement.querySelector<HTMLButtonElement>("#delete-go");
    remove?.addEventListener("click", async () => {
      const problem = sheetElement.querySelector<HTMLElement>("#delete-alert")!;
      if (!window.confirm(`Delete ${paths.get(row.id)}? This can't be undone.`)) return;
      remove.disabled = true;
      setMessage(problem, "");
      try {
        await api(`/api/staff/locations/${row.id}?expected=${encodeURIComponent(row.updatedAt)}`, { method: "DELETE" });
        panel.close(true);
        await poll.refresh();
        toast(`${row.name} deleted.`);
      } catch (error) {
        setMessage(problem, failure(error));
        remove.disabled = false;
      }
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
        openPlace(row.id, placeTab);
        toast(`Moved ${plural(moved, "item")}.`);
      } catch (error) {
        setMessage(problem, failure(error));
        go.disabled = false;
      }
    });
  }

}

/** A place check in the staff workspace: the same check screen the Catalog runs, framed by the shell, sending what it records as it goes. */
async function placeCheck(session: Session, id: string): Promise<void> {
  document.title = "Checking a place · Locations";
  shell(session, "items", html`<div id="check-host"><div class="skeleton skeleton--block"></div></div>`);
  const host = document.querySelector<HTMLElement>("#check-host")!;
  try {
    const [{ checkScreen }, { startSending }] = await Promise.all([import("./audit-screen"), import("./catalogue-sync")]);
    if (!host.isConnected) return;
    startSending({ owner: session.id, legacy: true });
    await checkScreen({ mode: "signed-in", session, access: null }, id, host);
  } catch (error) {
    if (!host.isConnected) return;
    if (error instanceof ApiError && error.status === 401) return expired();
    mount(host, emptyState("This check could not be opened", failure(error), html`<a class="button button--secondary" href="/staff/locations" data-route>Back to Locations</a>`, "error", 1));
  }
}
