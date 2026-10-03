import { ACTIVITY_SOURCES, ACTIVITY_TITLES, ACTIVITY_TYPES, STOCK_AREAS, type ActivitySource } from "./catalog-policy";
import { signed } from "./movement-form";
import { type Session, loadSession, shell } from "./staff";
import { type Html, ApiError, api, emptyState, expired, failure, formatDate, formatDateTime, html, icon, label, live, mount, officeDay, onLeave, preservingFocus, sheet as createSheet, sheetContent, toast, units, writeParams } from "./ui";

/*
 * Activity (/staff/activity): one newest-first list of who did what, read from GET /api/staff/activity.
 * Every filter lives in the URL and is applied by the Worker before it cuts a page, so "Load older"
 * continues the same question. The first page refreshes live; older pages stay below it.
 */

type Entry = {
  id: string; correlationId: string; at: string | null; source: ActivitySource; type: string; summary: string; actor: string; actorId: string | null;
  itemId: string | null; itemName: string | null; unit: string | null; change: number; stockChanged: boolean; before: number | null; after: number | null;
  reason: string | null; note: string | null; attention: boolean;
};
type Page = { events: Entry[]; nextCursor: string | null };
type Picker = { items: Array<{ id: string; name: string }>; locations: string[] };

/** The API's filters, in URL order. Search and source sit on the page; the rest live in the filter sheet. */
const KEYS = ["q", "source", "type", "actor", "item", "from", "to", "stockArea", "location", "changed", "attention"] as const;
const SHEET_KEYS = KEYS.slice(2);
type Key = typeof KEYS[number];
type Filters = Partial<Record<Key, string>>;
const CHANGED: Record<string, string> = { yes: "Changed stock", no: "Did not change stock" };

const entryCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? "entry" : "entries"}`;

export async function activityWorkspace(): Promise<void> {
  // Read before the first await: the view being left may still tidy its own query string.
  const params = new URLSearchParams(window.location.search);
  const signedIn = await loadSession("activity");
  if (!signedIn) return;
  const session: Session = signedIn;
  const sources = (Object.keys(ACTIVITY_SOURCES) as ActivitySource[]).filter((source) => (source !== "ACCOUNT" && source !== "DIRECTORY") || session.role !== "STAFF");
  document.title = "Activity · Staff workspace";
  shell(session, "activity", html`
    <header class="page-header">
      <div class="page-header__title"><h1>Activity</h1><p>Who did what, to which item, and whether stock changed.</p></div>
      <div class="page-header__actions">
        <p class="live-status" id="live-status">Connecting…</p>
        <button class="button button--secondary" type="button" id="activity-export" title="Download this filtered list as a CSV file. Typed loan and phone notes are left out of files.">${icon("install")}Export CSV</button>
      </div>
    </header>
    <div class="views" id="activity-sources" role="group" aria-label="Source"></div>
    <div class="table-toolbar">
      <label class="search-field">${icon("search")}<span class="visually-hidden">Search activity</span><input id="activity-search" type="search" maxlength="80" autocomplete="off" spellcheck="false" placeholder="Search item, ID, staff or note" data-search /><kbd aria-hidden="true">/</kbd><button class="search-field__clear" type="button" id="activity-clear-search" aria-label="Clear search" hidden>${icon("close")}</button></label>
      <button class="button button--secondary" type="button" id="activity-filters" aria-haspopup="dialog">${icon("filter")}<span>Filters</span></button>
      <p class="table-toolbar__count" id="activity-count" aria-live="polite"></p>
    </div>
    <div class="chips chips--flush" id="activity-chips" role="group" aria-label="Filters in use" hidden></div>
    <div id="activity-results" aria-busy="true"></div>
    <div class="activity-more" id="activity-more" hidden><button class="button button--secondary" type="button" id="activity-older">Load older</button><p class="muted" id="activity-end"></p></div>
    <dialog class="sheet" id="activity-sheet" aria-labelledby="sheet-title"></dialog>`);

  let filters: Filters = Object.fromEntries(KEYS.map((key) => [key, params.get(key) ?? ""]).filter(([, value]) => value));
  let entries: Entry[] = [];
  let nextCursor: string | null = null;
  let olderLoaded = false;
  let loaded = false;
  let run = 0;
  let fetchingOlder = false;
  let poll: { refresh: () => Promise<void>; stop: () => void } | null = null;
  let picker: Picker | null = null;
  /** Names of the people seen in loaded entries, for the "Who" choice. */
  const actors = new Map<string, string>();
  const results = document.querySelector<HTMLElement>("#activity-results")!;
  const more = document.querySelector<HTMLElement>("#activity-more")!;
  const older = document.querySelector<HTMLButtonElement>("#activity-older")!;
  const end = document.querySelector<HTMLElement>("#activity-end")!;
  const search = document.querySelector<HTMLInputElement>("#activity-search")!;
  const count = document.querySelector<HTMLElement>("#activity-count")!;
  const sheetElement = document.querySelector<HTMLDialogElement>("#activity-sheet")!;
  const panel = createSheet(sheetElement);
  search.value = filters.q ?? "";

  const query = (extra: Record<string, string> = {}) => new URLSearchParams(Object.entries({ ...filters, ...extra }).filter(([, value]) => value) as Array<[string, string]>).toString();
  const filtered = () => KEYS.some((key) => filters[key]);
  const itemLabel = (id: string) => picker?.items.find((item) => item.id === id)?.name ?? entries.find((entry) => entry.itemId === id)?.itemName ?? id;
  const actorLabel = (id: string) => id === session.id ? `you (${session.displayName})` : id === "SELF_SERVICE" ? "Self-Service (phones)" : id === "SYSTEM" ? "System" : actors.get(id) ?? "the chosen person";

  function chipText(key: Key, value: string): string {
    if (key === "type") return `Type: ${ACTIVITY_TITLES[value] ?? value}`;
    if (key === "actor") return `By ${actorLabel(value)}`;
    if (key === "item") return `Item: ${itemLabel(value)}`;
    if (key === "from") return `From ${formatDate(value)}`;
    if (key === "to") return `To ${formatDate(value)}`;
    if (key === "stockArea") return `Stock area: ${label(value)}`;
    if (key === "location") return `Location: ${value}`;
    if (key === "changed") return CHANGED[value] ?? value;
    return "Needs attention only";
  }

  function renderControls(): void {
    mount(document.querySelector("#activity-sources")!, html`${[["", "Everything"], ...sources.map((source) => [source, ACTIVITY_SOURCES[source]])].map(([key, text]) =>
      html`<button type="button" class="view-tab" data-source="${key}" aria-pressed="${(filters.source ?? "") === key}">${text}</button>`)}`);
    const set = SHEET_KEYS.filter((key) => filters[key]);
    document.querySelector("#activity-filters span")!.textContent = set.length ? `Filters (${set.length})` : "Filters";
    const chips = document.querySelector<HTMLElement>("#activity-chips")!;
    chips.hidden = !set.length;
    mount(chips, html`${set.map((key) => {
      const text = chipText(key, filters[key]!);
      return html`<button type="button" class="chip" data-remove="${key}" aria-label="Remove filter: ${text}">${text}${icon("close")}</button>`;
    })}${set.length > 1 ? html`<button type="button" class="text-link" data-remove="all">Clear filters</button>` : ""}`);
    document.querySelector<HTMLElement>("#activity-clear-search")!.hidden = !search.value;
  }

  function row(entry: Entry): Html {
    const tone = entry.change > 0 ? "is-in" : entry.change < 0 ? "is-out" : "";
    // A catalog or account entry has nothing to do with stock; anything else says so when stock stayed put.
    const change = entry.stockChanged ? signed(entry.change) : ["CATALOG", "ACCOUNT", "DIRECTORY"].includes(entry.source) ? "" : "no change";
    const reason = entry.reason && !entry.summary.toLowerCase().includes(entry.reason.toLowerCase()) ? entry.reason : null;
    const balance = entry.before !== null && entry.after !== null ? ` · ${entry.before} → ${entry.after}${entry.unit ? ` ${units(entry.after, entry.unit)}` : ""}` : "";
    return html`<li class="activity-row ${tone}" data-key="${entry.id}">
        <p class="activity-row__change ${entry.stockChanged ? "" : "activity-row__change--none"}">${change}</p>
        <div class="activity-row__main">
          ${entry.itemId ? html`<a class="row-link activity-row__summary" href="/staff/items?item=${entry.itemId}" data-route>${entry.summary}</a>` : html`<p>${entry.summary}</p>`}
          <p class="cell-sub">${entry.at ? html`<time datetime="${entry.at}">${formatDateTime(entry.at)}</time>` : "Time unknown"} · <span class="tag">${ACTIVITY_SOURCES[entry.source] ?? entry.source}</span>${entry.attention ? html` <span class="tag tag--warn">Needs attention</span>` : ""}${balance}${entry.itemId ? html` · <span class="mono">${entry.itemId}</span>` : ""}${entry.correlationId.startsWith("LN-")
            ? html` · Loan <span class="mono">${entry.correlationId}</span>` : ""}${entry.source === "PHONE" && entry.attention ? html` · <a href="/staff/self-service" data-route>Review in Self-Service</a>` : ""}</p>
          ${reason || entry.note ? html`<p class="activity-row__note">${reason ? html`<span class="muted">Reason:</span> ${reason}` : ""}${reason && entry.note ? " · " : ""}${entry.note ? html`<span class="muted">Note:</span> ${entry.note}` : ""}</p>` : ""}
        </div>
      </li>`;
  }

  function render(): void {
    results.removeAttribute("aria-busy");
    for (const entry of entries) if (entry.actorId && entry.actorId !== "SELF_SERVICE") actors.set(entry.actorId, entry.actor);
    const text = entries.length ? `${entryCount(entries.length)}${nextCursor ? " shown, older ones below" : ""}` : "No entries";
    if (count.textContent !== text) count.textContent = text;
    preservingFocus(results, () => mount(results, entries.length ? html`<ol class="activity-list" aria-label="Activity, newest first">${entries.map(row)}</ol>` : filtered()
      ? emptyState("Nothing matches", "Try another search or filter, or clear them to see everything.", html`<button class="button button--secondary" type="button" data-remove="everything">Clear search and filters</button>`)
      : emptyState("No activity yet", "Stock changes, loans, phone records and catalog edits appear here as they happen.")), "a");
    more.hidden = !entries.length;
    older.hidden = !nextCursor;
    end.hidden = Boolean(nextCursor);
    end.textContent = filtered() ? "No older entries match." : "That is the beginning of the records.";
    renderControls();
  }

  function failed(message: string, clear: boolean): void {
    results.removeAttribute("aria-busy");
    more.hidden = true;
    count.textContent = "";
    if (clear) {
      // A refused question is not retried, so the status must not promise it.
      const status = document.querySelector<HTMLElement>("#live-status");
      if (status) { status.dataset.state = "offline"; status.textContent = "Not updating"; }
    }
    mount(results, emptyState(clear ? "These filters cannot be used" : "Activity could not be loaded", message, clear ? html`<button class="button button--secondary" type="button" data-remove="everything">Clear search and filters</button>` : "", "error"));
  }

  /** (Re)starts the list for the current filters: the URL, the live first page, and no older pages yet. */
  function start(): void {
    poll?.stop();
    const current = ++run;
    entries = [];
    nextCursor = null;
    olderLoaded = false;
    loaded = false;
    count.textContent = "";
    writeParams(Object.fromEntries(KEYS.map((key) => [key, filters[key]])));
    renderControls();
    results.setAttribute("aria-busy", "true");
    more.hidden = true;
    mount(results, html`<div class="data-table-wrap" aria-hidden="true">${Array.from({ length: 6 }, () => html`<div class="skeleton-row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></div>`)}</div>`);
    const question = query();
    poll = live<Page>(`/api/staff/activity${question ? `?${question}` : ""}`, {
      interval: 15_000,
      status: () => document.querySelector("#live-status"),
      onData: (page) => {
        if (current !== run) return;
        loaded = true;
        if (olderLoaded) return void reloadShown(page);
        entries = page.events;
        nextCursor = page.nextCursor;
        render();
      },
      onError: (error) => {
        if (current !== run) return;
        if (error.status === 401) return expired();
        if (error.status === 400) { poll?.stop(); failed(error.message, true); return; }
        if (!loaded) failed(`${error.message} Retrying automatically.`, false);
      }
    });
  }

  let reloads = 0;
  /**
   * The first page changed while older pages are shown: fetch those pages again too, so an entry that
   * stopped matching the filters (a resolved record under "needs attention") does not linger below.
   */
  async function reloadShown(first: Page): Promise<void> {
    const current = run;
    const mine = ++reloads;
    let list = first.events;
    let cursor = first.nextCursor;
    try {
      while (cursor && list.length < entries.length) {
        const next = await api<Page>(`/api/staff/activity?${query({ cursor })}`);
        if (current !== run || mine !== reloads) return;
        list = list.concat(next.events);
        cursor = next.nextCursor;
      }
    } catch {
      // Older pages could not be refreshed; show only what is known to be current.
      [list, cursor, olderLoaded] = [first.events, first.nextCursor, false];
    }
    if (current !== run || mine !== reloads) return;
    entries = list;
    nextCursor = cursor;
    render();
  }

  async function loadOlder(): Promise<void> {
    if (!nextCursor || fetchingOlder) return;
    const current = run;
    // Not disabled: the button keeps keyboard focus while the next page loads.
    fetchingOlder = true;
    older.setAttribute("aria-busy", "true");
    try {
      const page = await api<Page>(`/api/staff/activity?${query({ cursor: nextCursor })}`);
      if (current !== run) return;
      const known = new Set(entries.map((entry) => entry.id));
      entries = [...entries, ...page.events.filter((entry) => !known.has(entry.id))];
      nextCursor = page.nextCursor;
      olderLoaded = true;
      render();
    } catch (error) {
      toast(failure(error), "error");
    } finally {
      fetchingOlder = false;
      older.removeAttribute("aria-busy");
    }
  }

  let exporting = false;
  /** The Worker builds the file from the same filters (and audits it); the browser only saves it. */
  async function exportFile(button: HTMLButtonElement): Promise<void> {
    if (exporting) return;
    exporting = true;
    button.setAttribute("aria-busy", "true");
    try {
      const question = query();
      const response = await fetch(`/api/staff/activity/export${question ? `?${question}` : ""}`, { method: "POST", credentials: "same-origin" })
        .catch(() => { throw new ApiError(0, "You appear to be offline. Check your connection and try again."); });
      if (!response.ok) throw new ApiError(response.status, ((await response.json().catch(() => ({}))) as { error?: string }).error ?? "The export failed. Please try again.");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "logistics-activity.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      const rows = Number(response.headers.get("x-export-rows"));
      toast(response.headers.get("x-export-truncated") === "1" ? `Exported the newest ${entryCount(rows)}. More match: narrow the filters to export the rest.` : `Exported ${entryCount(rows)}.`);
    } catch (error) {
      toast(failure(error), "error");
    } finally {
      exporting = false;
      button.removeAttribute("aria-busy");
    }
  }

  function setFilter(key: Key, value: string): void {
    if ((filters[key] ?? "") === value) return;
    filters = { ...filters, [key]: value };
    // A type belongs to one source; changing the source drops a type it cannot have.
    if (key === "source" && value && filters.type && !(filters.type in ACTIVITY_TYPES[value as ActivitySource])) filters.type = "";
    start();
  }

  /* ---------- Filter sheet (a side panel on desktop, a bottom sheet on phones) ---------- */

  function filterForm(): Html {
    const option = (value: string, text: string, current = "") => html`<option value="${value}" ${value === current ? html`selected` : ""}>${text}</option>`;
    const groups = (filters.source ? [filters.source as ActivitySource] : sources).map((source) => html`<optgroup label="${ACTIVITY_SOURCES[source]}">${Object.entries(ACTIVITY_TYPES[source]).map(([value, text]) => option(value, text, filters.type))}</optgroup>`);
    const people = [...actors].filter(([id]) => id !== session.id).sort(([, a], [, b]) => a.localeCompare(b));
    const known = ["", session.id, "SELF_SERVICE", "SYSTEM", ...people.map(([id]) => id)];
    const today = officeDay();
    return html`<form class="form" id="activity-filter-form" novalidate>
      <div class="field"><label for="f-type">Type</label><select id="f-type" name="type">${option("", "All types")}${groups}</select></div>
      <div class="field"><label for="f-actor">Who</label><select id="f-actor" name="actor">${option("", "Anyone", filters.actor)}${option(session.id, `Me (${session.displayName})`, filters.actor)}${option("SELF_SERVICE", "Self-Service (phones)", filters.actor)}${option("SYSTEM", "System", filters.actor)}${people.map(([id, name]) => option(id, name, filters.actor))}${filters.actor && !known.includes(filters.actor) ? option(filters.actor, "The chosen person", filters.actor) : ""}</select><p class="field__hint">Other staff appear here once their entries are on the list.</p></div>
      <div class="field"><label for="f-item">Item</label><input id="f-item" name="item" list="activity-items" autocomplete="off" spellcheck="false" placeholder="Name or ID" value="${filters.item ? `${itemLabel(filters.item)} · ${filters.item}` : ""}" aria-describedby="f-item-hint" /><datalist id="activity-items"></datalist><p class="field__hint" id="f-item-hint">Pick from the list, or type an item ID.</p></div>
      <div class="field-grid">
        <div class="field"><label for="f-from">From</label><input id="f-from" name="from" type="date" value="${filters.from ?? ""}" max="${filters.to || today}" /></div>
        <div class="field"><label for="f-to">To</label><input id="f-to" name="to" type="date" value="${filters.to ?? ""}" min="${filters.from ?? ""}" max="${today}" /></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="f-stockArea">Stock area</label><select id="f-stockArea" name="stockArea">${option("", "All areas")}${STOCK_AREAS.map((area) => option(area, label(area), filters.stockArea))}</select></div>
        <div class="field"><label for="f-changed">Stock change</label><select id="f-changed" name="changed">${option("", "Any")}${Object.entries(CHANGED).map(([value, text]) => option(value, text, filters.changed))}</select></div>
      </div>
      <div class="field"><label for="f-location">Location</label><input id="f-location" name="location" list="activity-locations" maxlength="80" autocomplete="off" placeholder="Any location" value="${filters.location ?? ""}" /><datalist id="activity-locations"></datalist></div>
      <label class="checkbox"><input type="checkbox" name="attention" ${filters.attention ? html`checked` : ""} /><span>Needs attention only</span></label>
      <div class="form-actions form-actions--sticky"><button type="button" class="button button--ghost" data-remove="all">Clear filters</button><button type="button" class="button button--primary" data-close>Show results</button></div>
    </form>`;
  }

  function fillPickers(): void {
    if (!picker || !sheetElement.open) return;
    mount(sheetElement.querySelector("#activity-items")!, html`${picker.items.map((item) => html`<option value="${item.name} · ${item.id}"></option>`)}`);
    mount(sheetElement.querySelector("#activity-locations")!, html`${picker.locations.map((location) => html`<option value="${location}"></option>`)}`);
  }

  /** Draws the filter form into the open sheet and wires it; drawn again after "Clear filters". */
  function showFilters(): void {
    mount(sheetElement.querySelector(".sheet__body")!, filterForm());
    const form = sheetElement.querySelector<HTMLFormElement>("#activity-filter-form")!;
    form.addEventListener("change", (event) => {
      const field = event.target as HTMLInputElement | HTMLSelectElement;
      if (field.name === "item") return;
      if (field.name === "from" || field.name === "to") {
        const from = form.querySelector<HTMLInputElement>("#f-from")!;
        const to = form.querySelector<HTMLInputElement>("#f-to")!;
        to.min = from.value;
        from.max = to.value || officeDay();
        if (from.value && to.value && from.value > to.value) { field.setAttribute("aria-invalid", "true"); toast("The start date must not be after the end date.", "error"); return; }
        from.removeAttribute("aria-invalid");
        to.removeAttribute("aria-invalid");
      }
      setFilter(field.name as Key, field instanceof HTMLInputElement && field.type === "checkbox" ? (field.checked ? "1" : "") : field.value.trim());
    });
    const item = form.querySelector<HTMLInputElement>("#f-item")!;
    item.addEventListener("input", () => {
      const id = item.value.match(/ITM-[A-Za-z0-9-]+/i)?.[0]?.toUpperCase();
      const named = picker?.items.filter((entry) => entry.name.toLowerCase() === item.value.trim().toLowerCase()) ?? [];
      const chosen = id ?? (named.length === 1 ? named[0]!.id : "");
      form.querySelector("#f-item-hint")!.textContent = chosen ? `Showing ${itemLabel(chosen)} only.` : item.value.trim() ? "Pick an item from the list, or type its ID." : "Pick from the list, or type an item ID.";
      if (chosen || !item.value.trim()) setFilter("item", chosen);
    });
    fillPickers();
  }

  function openFilters(): void {
    mount(sheetElement, sheetContent("Activity", "Filters", html``));
    panel.open();
    showFilters();
    if (!picker) void api<Picker>("/api/staff/inventory").then((inventory) => { picker = { items: inventory.items, locations: inventory.locations }; fillPickers(); }).catch(() => { /* the pickers stay empty; typing an ID still works */ });
    sheetElement.querySelector<HTMLElement>("#f-type")!.focus();
  }

  /* ---------- Events ---------- */

  document.querySelector("#activity-sources")!.addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-source]");
    if (!tab) return;
    setFilter("source", tab.dataset.source!);
    document.querySelector<HTMLElement>(`[data-source="${CSS.escape(filters.source ?? "")}"]`)?.focus();
  });
  document.querySelector("#activity-filters")!.addEventListener("click", openFilters);
  const exportButton = document.querySelector<HTMLButtonElement>("#activity-export")!;
  exportButton.addEventListener("click", () => void exportFile(exportButton));
  older.addEventListener("click", () => void loadOlder());
  let searchTimer = 0;
  onLeave(() => window.clearTimeout(searchTimer));
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => setFilter("q", search.value.trim()), 300);
  });
  search.addEventListener("keydown", (event) => { if (event.key === "Escape" && search.value) { search.value = ""; setFilter("q", ""); } });
  document.querySelector("#activity-clear-search")!.addEventListener("click", () => { search.value = ""; setFilter("q", ""); search.focus(); });
  // Removing one filter, the sheet's filters, or everything (from the empty state).
  document.querySelector("#main-content")!.addEventListener("click", (event) => {
    const remove = (event.target as HTMLElement).closest<HTMLElement>("[data-remove]")?.dataset.remove;
    if (!remove) return;
    const keep = remove === "everything" ? [] : remove === "all" ? ["q", "source"] : KEYS.filter((key) => key !== remove);
    filters = Object.fromEntries(Object.entries(filters).filter(([key]) => keep.includes(key)));
    if (remove === "everything") search.value = "";
    start();
    if (sheetElement.open) { showFilters(); sheetElement.querySelector<HTMLElement>("#f-type")!.focus(); }
    else (remove === "everything" ? search : document.querySelector<HTMLElement>("#activity-filters"))!.focus();
  });
  start();
}
