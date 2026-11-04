import "./activity.css";
import { ACTIVITY_SOURCES, ACTIVITY_TITLES, ACTIVITY_TYPES, STOCK_AREAS, type ActivitySource, selfServiceReference } from "./catalog-policy";
import { type Place, inOrder, pathOf, placesOf } from "./location-tree";
import { signed } from "./movement-form";
import { type Session, loadSession, shell } from "./staff-shell";
import { api, ApiError, emptyState, expired, failure, formatDate, formatDateTime, formatTime, type Html, html, icon, type IconName, label, live, mount, officeDay, onLeave, preservingFocus, readKept, sheet as createSheet, sheetContent, toast, units, writeParams } from "./ui";
import { PAGE_SIZE, landOn, onLayoutChange, onPhone, stepOf, stepsMarkup } from "./pager";

/*
 * Activity (/staff/activity): one newest-first list of who did what, read from GET /api/staff/activity.
 * Every filter lives in the URL and is applied by the Worker before it cuts a page, so "Load older"
 * continues the same question. The first page refreshes live; older pages stay below it.
 *
 * The page is one viewport tall (V1.15): the title, source tabs, search and filters stay where they are and only the feed scrolls,
 * loading older pages as it nears its end. The newest MAX_SHOWN entries are ever drawn, so a long history never grows the page.
 */

type Entry = {
  id: string; correlationId: string; at: string | null; source: ActivitySource; type: string; summary: string; actor: string; actorId: string | null;
  itemId: string | null; itemName: string | null; unit: string | null; change: number; stockChanged: boolean; before: number | null; after: number | null;
  reason: string | null; note: string | null; attention: boolean; fields?: string[];
};
type Page = { events: Entry[]; nextCursor: string | null };
type Picker = { items: Array<{ id: string; name: string }>; locations: string[] };
type InventoryAnswer = { items: Array<{ id: string; name: string }>; locations: Place[] };

/** The API's filters, in URL order. Search and source sit on the page; the rest live in the filter sheet. */
const KEYS = ["q", "source", "type", "actor", "item", "from", "to", "stockArea", "location", "changed", "attention"] as const;
const SHEET_KEYS = KEYS.slice(2);
type Key = typeof KEYS[number];
type Filters = Partial<Record<Key, string>>;
const CHANGED: Record<string, string> = { yes: "Changed stock", no: "Did not change stock" };

/** Most entries drawn at once; past it the person narrows the filters or exports, as the Worker's own export cap already asks. */
const MAX_SHOWN = 300;

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
    <div class="activity-workspace">
      <div class="activity-workspace__top">
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
      </div>
      <div class="activity-feed" id="activity-feed" role="region" aria-label="Activity feed" tabindex="0">
        <div id="activity-results" aria-busy="true"></div>
        <div class="activity-more" id="activity-more" hidden><button class="button button--secondary" type="button" id="activity-older">Load older</button><p class="muted" id="activity-end"></p></div>
      </div>
    </div>
    <dialog class="sheet" id="activity-sheet" aria-labelledby="sheet-title"></dialog>`);

  let filters: Filters = Object.fromEntries(KEYS.map((key) => [key, params.get(key) ?? ""]).filter(([, value]) => value));
  let entries: Entry[] = [];
  let nextCursor: string | null = null;
  let olderLoaded = false;
  let loaded = false;
  let run = 0;
  // A load of older entries that answers after the page is left belongs to no list: leaving ends the run as a new search does.
  onLeave(() => { run += 1; });
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
    if (key === "location") return `Place: ${value}`;
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

  /** Each source's mark in the feed, the same picture the rail and Home use for that part of the Hub. */
  const SOURCE_ICONS: Record<string, IconName> = { MOVEMENT: "stack", LOAN: "swap", PHONE: "phone", CATALOG: "box", ACCOUNT: "user", DIRECTORY: "shield" };
  /** The day an entry belongs to, as the office counts days: Today, Yesterday, or the date. */
  const dayOf = (entry: Entry) => entry.at ? officeDay(entry.at) : "";
  const dayLabel = (day: string) => !day ? "Time unknown" : day === officeDay() ? "Today" : day === officeDay(new Date(Date.now() - 86_400_000)) ? "Yesterday" : formatDate(day);
  /** The feed by day (LH-IP02-S04): one heading and one list per day, newest first, in the order the entries came. */
  function feed(list: Entry[]): Html {
    const days: Array<{ day: string; entries: Entry[] }> = [];
    for (const entry of list) {
      const day = dayOf(entry);
      if (days.at(-1)?.day === day) days.at(-1)!.entries.push(entry); else days.push({ day, entries: [entry] });
    }
    return html`${days.map(({ day, entries: mine }, index) => html`<section class="activity-day" aria-labelledby="activity-day-${index}">
      <h2 class="activity-day__title" id="activity-day-${index}">${dayLabel(day)}</h2>
      <ol class="activity-list" aria-label="${dayLabel(day)}, newest first">${mine.map(row)}</ol></section>`)}`;
  }

  /**
   * One entry as one line (V1.16.7): when, what happened to what and by whom, and the stock change. It opens in place to its full
   * detail; only one is open at a time, so the list stays light. The line is a button with aria-expanded, so it opens from the keyboard.
   */
  let openKey: string | null = null;
  const detailId = (entry: Entry) => `activity-detail-${entry.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  function row(entry: Entry): Html {
    const tone = entry.change > 0 ? "is-in" : entry.change < 0 ? "is-out" : "";
    // A catalog or account entry has nothing to do with stock; anything else says so when stock stayed put.
    const change = entry.stockChanged ? signed(entry.change) : ["CATALOG", "ACCOUNT", "DIRECTORY"].includes(entry.source) ? "" : "no change";
    const open = entry.id === openKey;
    return html`<li class="activity-row activity-row--fold ${tone} ${open ? "is-open" : ""}" data-key="${entry.id}">
        <p class="activity-row__time">${entry.at ? html`<time datetime="${entry.at}">${formatTime(entry.at)}</time>` : ""}</p>
        <span class="activity-row__icon" aria-hidden="true">${icon(SOURCE_ICONS[entry.source] ?? "history")}</span>
        <p class="activity-row__change ${entry.stockChanged ? "" : "activity-row__change--none"}">${change}</p>
        <div class="activity-row__main">
          <button type="button" class="activity-row__toggle" aria-expanded="${open}" aria-controls="${detailId(entry)}" data-fold="${entry.id}"><span class="activity-row__line">${entry.summary}</span>${entry.attention ? html`<span class="tag tag--warn">Needs attention</span>` : ""}</button>
        </div>
        <div class="activity-row__detail" id="${detailId(entry)}" ${open ? "" : "hidden"}>${open ? detail(entry) : ""}</div>
      </li>`;
  }

  /** What an open entry shows: when and by whom, the source, the stock before and after, the item, loan and phone record it belongs to, and what was typed. */
  function detail(entry: Entry): Html {
    const fact = (term: string, value: Html | string) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`;
    const reason = entry.reason && !entry.summary.toLowerCase().includes(entry.reason.toLowerCase()) ? entry.reason : null;
    const loan = entry.correlationId.startsWith("LN-") ? entry.correlationId : null;
    const phone = entry.source === "PHONE" && !loan && /^[0-9a-f-]{36}$/.test(entry.correlationId) ? selfServiceReference(entry.correlationId) : null;
    return html`<dl class="facts activity-detail">
        ${fact("When", entry.at ? formatDateTime(entry.at) : "Time unknown")}
        ${fact("By", entry.actor)}
        ${fact("Source", html`<span class="tag">${ACTIVITY_SOURCES[entry.source] ?? entry.source}</span>`)}
        ${entry.before !== null && entry.after !== null ? fact("Stock", `${entry.before} → ${entry.after}${entry.unit ? ` ${units(entry.after, entry.unit)}` : ""}`) : ""}
        ${entry.itemId ? fact("Item", html`<a class="text-link" href="/staff/items?item=${entry.itemId}" data-route>${entry.itemName ?? entry.itemId}</a> <span class="mono muted">${entry.itemId}</span>`) : ""}
        ${loan ? fact("Loan", html`<a class="text-link" href="/staff/loans?loan=${loan}" data-route><span class="mono">${loan}</span></a>`) : ""}
        ${phone ? fact("Request", html`<span class="mono">${phone}</span>`) : ""}
        ${entry.fields?.length ? fact("Changed", entry.fields.join(", ")) : ""}
        ${reason ? fact("Reason", reason) : ""}
        ${entry.note ? fact("Note", entry.note) : ""}
      </dl>
      ${entry.source === "PHONE" && entry.attention ? html`<p><a class="text-link" href="/staff/self-service" data-route>Review in Self-Service ${icon("arrow")}</a></p>` : ""}`;
  }

  /** Opens one entry (closing the one open before) or closes it, without redrawing the list. */
  function fold(key: string): void {
    const next = openKey === key ? null : key;
    for (const id of [openKey, next]) {
      if (!id) continue;
      const item = results.querySelector<HTMLElement>(`[data-key="${CSS.escape(id)}"]`);
      const entry = entries.find((each) => each.id === id);
      if (!item || !entry) continue;
      const opening = id === next;
      item.classList.toggle("is-open", opening);
      item.querySelector("[data-fold]")!.setAttribute("aria-expanded", String(opening));
      const panel = item.querySelector<HTMLElement>(".activity-row__detail")!;
      if (opening) mount(panel, detail(entry));
      panel.hidden = !opening;
    }
    openKey = next;
  }

  /**
   * On a desktop the feed is read 25 at a time, newest first, with Newer and Older (V1.16.12); Older past what is loaded fetches
   * the next batch. A phone keeps the one scrolling feed that loads as it nears its end.
   */
  let deskPage = 1;
  const capped = () => Boolean(nextCursor) && entries.length >= MAX_SHOWN;
  function render(): void {
    results.removeAttribute("aria-busy");
    for (const entry of entries) if (entry.actorId && entry.actorId !== "SELF_SERVICE") actors.set(entry.actorId, entry.actor);
    const desk = !onPhone();
    deskPage = Math.max(1, Math.min(deskPage, Math.ceil(entries.length / PAGE_SIZE)));
    const first = desk ? (deskPage - 1) * PAGE_SIZE : 0;
    const drawn = desk ? entries.slice(first, first + PAGE_SIZE) : entries;
    const olderThere = first + PAGE_SIZE < entries.length || (Boolean(nextCursor) && !capped());
    const lastPage = !desk || !olderThere;
    const text = entries.length ? `${entryCount(entries.length)}${nextCursor ? desk ? " loaded, older ones on later pages" : " shown, older ones below" : ""}` : "No entries";
    if (count.textContent !== text) count.textContent = text;
    preservingFocus(results, () => mount(results, entries.length ? html`${feed(drawn)}${desk ? stepsMarkup(first, drawn.length, olderThere, "Activity pages") : ""}` : filtered()
      ? emptyState("Nothing matches", "Try another search or filter, or clear them to see everything.", html`<button class="button button--secondary" type="button" data-remove="everything">Clear search and filters</button>`)
      : emptyState("No activity yet", "Stock changes, loans, phone records and catalog edits appear here as they happen.")), "[data-fold]");
    const atCap = capped();
    more.hidden = !entries.length || !lastPage || (desk && Boolean(nextCursor) && !atCap);
    older.hidden = desk || !nextCursor || atCap;
    if (!desk && nextCursor && !atCap) watchEnd(); else watcher?.unobserve(more);
    end.hidden = Boolean(nextCursor) && !atCap;
    end.textContent = atCap ? `Showing the newest ${entryCount(MAX_SHOWN)}. Narrow the filters or export the list to see more.` : filtered() ? "No older entries match." : "That is the beginning of the records.";
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
    deskPage = 1;
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
    if (!nextCursor || fetchingOlder || capped()) return;
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
      if (current === run) toast(failure(error), "error");
    } finally {
      fetchingOlder = false;
      older.removeAttribute("aria-busy");
    }
  }

  /** Loads the next page when the feed nears its end, so scrolling just continues; the button stays for keyboards and older browsers. */
  const watcher = "IntersectionObserver" in window
    ? new IntersectionObserver((seen) => { if (seen.some((entry) => entry.isIntersecting)) void loadOlder(); }, { root: document.querySelector("#activity-feed"), rootMargin: "0px 0px 240px 0px" }) : null;
  /** Observing again reports the end afresh, so a page that did not fill the feed still asks for the next one. A failed request is not retried this way: the button stays. */
  const watchEnd = () => { watcher?.unobserve(more); watcher?.observe(more); };
  onLeave(() => watcher?.disconnect());
  onLeave(onLayoutChange(() => { if (loaded) render(); }));

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
      <div class="field"><label for="f-location">Place</label><input id="f-location" name="location" list="activity-locations" maxlength="300" autocomplete="off" placeholder="Any place, or everything inside one" value="${filters.location ?? ""}" /><datalist id="activity-locations"></datalist></div>
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
    if (!picker) void readKept<InventoryAnswer>("/api/staff/inventory").then((inventory) => { const known = placesOf(inventory.locations); picker = { items: inventory.items, locations: inOrder(known).map(({ place }) => pathOf(known, place.id)!) }; fillPickers(); }).catch(() => { /* the pickers stay empty; typing an ID still works */ });
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
  results.addEventListener("click", async (event) => {
    const step = stepOf(event.target as HTMLElement);
    if (step) {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-page]")!;
      deskPage += step === "older" ? 1 : -1;
      // Older past what is loaded reads the next batch first; the step shows it is working until the batch is drawn.
      if (step === "older" && deskPage * PAGE_SIZE > entries.length && nextCursor) { button.setAttribute("aria-busy", "true"); await loadOlder(); }
      render();
      landOn(results, { kind: "page", from: (deskPage - 1) * PAGE_SIZE }, () => [...results.querySelectorAll<HTMLElement>("[data-fold]")]);
      return;
    }
    const toggle = (event.target as HTMLElement).closest<HTMLElement>("[data-fold]");
    if (toggle) fold(toggle.dataset.fold!);
  });
  let searchTimer = 0;
  onLeave(() => window.clearTimeout(searchTimer));
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => setFilter("q", search.value.trim()), 300);
  });
  search.addEventListener("keydown", (event) => { if (event.key === "Escape" && search.value) { search.value = ""; setFilter("q", ""); } });
  document.querySelector("#activity-clear-search")!.addEventListener("click", () => { search.value = ""; setFilter("q", ""); search.focus(); });
  // Removing one filter, the sheet's filters, or everything (from the empty state). The page area stays from page to page
  // (V1.16.5), so this listener leaves with the page.
  const listening = new AbortController();
  onLeave(() => listening.abort());
  document.querySelector("#main-content")!.addEventListener("click", (event) => {
    const remove = (event.target as HTMLElement).closest<HTMLElement>("[data-remove]")?.dataset.remove;
    if (!remove) return;
    const keep = remove === "everything" ? [] : remove === "all" ? ["q", "source"] : KEYS.filter((key) => key !== remove);
    filters = Object.fromEntries(Object.entries(filters).filter(([key]) => keep.includes(key)));
    if (remove === "everything") search.value = "";
    start();
    if (sheetElement.open) { showFilters(); sheetElement.querySelector<HTMLElement>("#f-type")!.focus(); }
    else (remove === "everything" ? search : document.querySelector<HTMLElement>("#activity-filters"))!.focus();
  }, { signal: listening.signal });
  start();
}
