import "./search-palette.css";
import { RELATION_WORDS } from "./relation-policy";
import { type GoHit, type ItemHit, type KitHit, type PersonHit, type PlaceHit, type Prepared, type SearchIndex, type Why, MIN_QUERY, prepare, queryWords, searchCatalog, searchShortcuts } from "./search";
import { ApiError, type Html, type IconName, categoryName, html, icon, itemVisual, mount, navigate } from "./ui";

/*
 * Global search (V1.11): one dialog for the whole staff workspace, opened from the top bar or with Ctrl+K (⌘K on a Mac). It is the
 * APG combobox with a grouped listbox popup: focus stays in the field, the arrow keys move the active option (aria-activedescendant),
 * Enter opens it, Escape clears the field and then closes. Items, kits and places are ranked here, in the browser, over the staff
 * search index (one request per catalog change); people are ranked by the Worker for administrators only and never kept here. Every
 * result says what it is, why it matched and where it goes; nothing here changes a record.
 */

const INDEX_URL = "/api/staff/search";
const PEOPLE_URL = "/api/staff/admin/directory/search";
/** Each opening checks the index again (a 304 reading one row while nothing changed), so a link or item added a moment ago is
 *  found; only a check this recent (pointing at the button, then pressing it) is reused. */
const FRESH_MS = 1_000;
/** People are asked for once typing pauses this long, never per keystroke. */
const PEOPLE_DELAY = 220;
/** The result count is announced once typing pauses this long. */
const ANNOUNCE_DELAY = 600;
/** Rows a group shows before "Show all"; one group alone shows more. */
const ROWS = { go: 4, items: 6, kits: 4, places: 4, people: 5 } as const;
const ALONE = 12;

type GroupKey = keyof typeof ROWS;
type Option = { id: string; label: string; body: Html; href?: string; expand?: GroupKey };
/** `more` follows the rows once they are all shown: where to see every match when the group holds only the best few. */
type Group = { key: GroupKey; title: string; total: number; best: number; rows: Option[]; more?: Option };

let held: { etag: string; prepared: Prepared; checkedAt: number } | null = null;
let fetching: Promise<void> | null = null;
let indexError: ApiError | null = null;

/** Fetches the index when it is missing or stale; an unchanged index costs one 304. */
function loadIndex(): Promise<void> {
  if (held && Date.now() - held.checkedAt < FRESH_MS) return Promise.resolve();
  fetching ??= (async () => {
    let response: Response;
    try {
      response = await fetch(INDEX_URL, { credentials: "same-origin", headers: held ? { "if-none-match": held.etag, accept: "application/json" } : { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ApiError(0, "Search needs a connection. The pages below still open.");
    }
    if (response.status === 304 && held) { held.checkedAt = Date.now(); return; }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new ApiError(response.status, body.error ?? "Search could not load. Try again.");
    }
    const data = await response.json() as SearchIndex;
    held = { etag: response.headers.get("etag") ?? "", prepared: prepare(data), checkedAt: Date.now() };
  })().then(() => { indexError = null; }, (error: unknown) => { indexError = error instanceof ApiError ? error : new ApiError(0, "Search could not load. Try again."); })
    .finally(() => { fetching = null; });
  return fetching;
}

/** Starts loading early when someone points at or tabs to the search button; failures wait for the real open. */
export function warmPalette(): void { void loadIndex(); }

/* ---------- Words on screen ---------- */

const WHY_TEXT = (why: Why): string => {
  switch (why.by) {
    case "alias": return `Also called “${why.text}”`;
    case "kit": return `In the kit ${why.text}`;
    case "place": return `Kept in ${why.text}`;
    case "category": return `Category: ${categoryName(why.text)}`;
    case "kind": return `Kind: ${why.text}`;
    case "link": return `${RELATION_WORDS[why.kind][why.side]} ${why.text}`;
    case "includes": return `Includes ${why.text}`;
    case "within": return `Inside ${why.text}`;
    case "position": return why.text;
    case "department": return why.text;
  }
};

/** Folds a character the catalog's way (accents off, lower case), keeping one entry per original character. */
const fold = (character: string) => character.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The name with the start of each word a query word matched marked; the marks are visual only (the option's label says why). */
export function highlight(name: string, tokens: readonly string[]): Html {
  if (!tokens.length) return html`${name}`;
  const characters = [...name];
  const folded = characters.map(fold);
  const marked = new Array<boolean>(characters.length).fill(false);
  for (let start = 0; start < characters.length; start += 1) {
    if (start > 0 && /[\p{L}\p{N}]/u.test(folded[start - 1]!)) continue;
    for (const token of tokens) {
      // A plural in the name ("Markers") still matches its singular query word ("marker"), and its "s" is marked with the word.
      let index = start;
      let matched = 0;
      while (index < characters.length && matched < token.length && folded[index] === token[matched]) { index += 1; matched += folded[index - 1]!.length; }
      if (matched < token.length) continue;
      if (folded[index] === "s" && !/[\p{L}\p{N}]/u.test(folded[index + 1] ?? "")) index += 1;
      for (let each = start; each < index; each += 1) marked[each] = true;
    }
  }
  const parts: Html[] = [];
  let run = "";
  let inMark = false;
  const flush = () => { if (run) parts.push(inMark ? html`<mark>${run}</mark>` : html`${run}`); run = ""; };
  characters.forEach((character, index) => {
    if (marked[index] !== inMark) { flush(); inMark = marked[index]!; }
    run += character;
  });
  flush();
  return html`${parts}`;
}

const SHORTCUT_ICONS: Record<string, IconName> = {
  overdue: "clock", low: "stack", out: "stack", count: "stack", expiring: "clock", classify: "filter", attention: "bell", items: "box", catalogue: "plus",
  stock: "stack", loans: "swap", places: "pin", kits: "basket", "self-service": "phone", activity: "history", admin: "shield", directory: "user", account: "user", loan: "swap"
};

const row = (visual: Html, title: Html, detail: string, kind: string): Html => html`
  <span class="palette__visual">${visual}</span>
  <span class="palette__main"><span class="palette__title">${title}</span>${detail ? html`<span class="palette__detail">${detail}</span>` : ""}</span>
  <span class="palette__kind">${kind}</span>`;
const glyph = (name: IconName) => html`<span class="palette__glyph">${icon(name)}</span>`;
const joined = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(" · ");

/** The reason, then where it is kept; a match by place names the whole path once ("Kept in Cabinet 1 › Shelf A"). */
const reasonAndPlace = (why: Why | null, place: string | null) => why?.by === "place" ? [`Kept in ${place ?? why.text}`] : [why ? WHY_TEXT(why) : null, place];
/** The detail line read aloud: the separators become commas. */
const spoken = (...parts: string[]) => joined(...parts).replace(/ · /g, ", ");

function itemOption(hit: ItemHit, tokens: string[]): Option {
  const { item } = hit;
  const detail = joined(item.status === "INACTIVE" && "Inactive", ...reasonAndPlace(hit.why, hit.place));
  return {
    id: `palette-item-${item.id}`, href: `/staff/items?item=${encodeURIComponent(item.id)}`, label: spoken(item.name, "item", detail),
    body: row(itemVisual(item, (id) => `/api/staff/media/${id}/thumb`, "palette__thumb"), highlight(item.name, tokens), detail, "Item")
  };
}

function kitOption(hit: KitHit, tokens: string[]): Option {
  const { kit } = hit;
  const count = `${kit.items.length} ${kit.items.length === 1 ? "item" : "items"}`;
  const detail = joined(!kit.active && "Inactive", ...reasonAndPlace(hit.why, hit.place), count);
  return { id: `palette-kit-${kit.id}`, href: `/staff/kits?kit=${encodeURIComponent(kit.id)}`, label: spoken(kit.name, "kit", detail), body: row(glyph("basket"), highlight(kit.name, tokens), detail, "Kit") };
}

function placeOption(hit: PlaceHit, tokens: string[]): Option {
  const { place } = hit;
  const detail = joined(!place.active && "Inactive", hit.parent && `Inside ${hit.parent}`, `${hit.items} ${hit.items === 1 ? "item" : "items"} kept here`);
  return { id: `palette-place-${place.id}`, href: `/staff/locations?place=${encodeURIComponent(place.id)}`, label: spoken(place.name, "place", detail), body: row(glyph("pin"), highlight(place.name, tokens), detail, "Place") };
}

function personOption(hit: PersonHit, tokens: string[]): Option {
  const detail = joined(!hit.active && "Former member", hit.why ? WHY_TEXT(hit.why) : hit.position, hit.department);
  const initials = hit.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
  return { id: `palette-person-${hit.id}`, href: `/staff/admin/directory?person=${encodeURIComponent(hit.id)}`, label: spoken(hit.name, "person in the Staff Directory", detail), body: row(html`<span class="palette__initials" aria-hidden="true">${initials}</span>`, highlight(hit.name, tokens), detail, "Person") };
}

function goOption(hit: GoHit, tokens: string[]): Option {
  const { shortcut } = hit;
  return { id: `palette-go-${shortcut.id}`, href: shortcut.href, label: spoken(shortcut.title, "go to", shortcut.detail), body: row(glyph(SHORTCUT_ICONS[shortcut.id] ?? "arrow"), highlight(shortcut.title, tokens), shortcut.detail, "Go to") };
}

/* ---------- The dialog ---------- */
/** The shortcut as people read it on this device. */

let dialog: HTMLDialogElement | null = null;
let admin = false;
let opener: HTMLElement | null = null;
let options: Option[] = [];
let active = -1;
const expanded = new Set<GroupKey>();
let people: { query: string; hits: PersonHit[]; total: number; error: boolean } | null = null;
let peopleTimer = 0;
let peopleRequest: AbortController | null = null;
let announceTimer = 0;
/** The pause came before the whole answer did: announce when the rest arrives. */
let waiting = false;
let lastQuery = "";

const parts = () => {
  const root = dialog!;
  return {
    input: root.querySelector<HTMLInputElement>("#palette-input")!, list: root.querySelector<HTMLElement>("#palette-list")!,
    note: root.querySelector<HTMLElement>("#palette-note")!, status: root.querySelector<HTMLElement>("#palette-status")!, escape: root.querySelector<HTMLElement>("#palette-escape-action")!
  };
};

function build(): HTMLDialogElement {
  const element = document.createElement("dialog");
  element.className = "palette";
  element.setAttribute("aria-labelledby", "palette-heading");
  mount(element, html`
    <h2 class="visually-hidden" id="palette-heading">Search the Hub</h2>
    <div class="palette__head">
      <button class="palette__back icon-button" type="button" data-close aria-label="Close search">${icon("back")}</button>
      <div class="palette__field">
        ${icon("search")}
        <input id="palette-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="palette-list" aria-describedby="palette-hint"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Search items, places, kits or pages" aria-label="Search the Hub" autofocus />
      </div>
      <button class="palette__esc" type="button" data-close aria-label="Close search"><kbd>Esc</kbd></button>
    </div>
    <p class="visually-hidden" id="palette-hint">Results appear as you type. Use the up and down arrows to choose, Enter to open, Escape to clear or close.</p>
    <div class="palette__body">
      <div id="palette-list" class="palette__list" role="listbox" aria-label="Results"></div>
      <div id="palette-note" class="palette__note"></div>
    </div>
    <footer class="palette__foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> <span id="palette-escape-action">close</span></span></footer>
    <div class="visually-hidden" id="palette-status" role="status" aria-live="polite" aria-atomic="true"></div>`);
  document.body.append(element);
  const { input, list } = { input: element.querySelector<HTMLInputElement>("#palette-input")!, list: element.querySelector<HTMLElement>("#palette-list")! };
  input.addEventListener("input", () => { expanded.clear(); render(true); });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(active < 0 ? (step > 0 ? 0 : options.length - 1) : (active + step + options.length) % options.length, true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = options[active] ?? options[0];
      if (chosen) choose(chosen, event.ctrlKey || event.metaKey);
    }
  });
  // Escape clears what was typed first, then closes: a slip of the key never loses the page.
  element.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (input.value) { input.value = ""; expanded.clear(); render(true); } else close();
  });
  element.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target === element || target.closest("[data-close]")) { close(); return; }
    const option = target.closest<HTMLElement>("[role=option]");
    if (option) {
      const index = options.findIndex((each) => each.id === option.id);
      if (index >= 0) choose(options[index]!, event.ctrlKey || event.metaKey);
    }
  });
  // The pointer moves the active option only when it really moves, so a list scrolling under a still pointer changes nothing.
  list.addEventListener("pointermove", (event) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>("[role=option]");
    if (!option) return;
    const index = options.findIndex((each) => each.id === option.id);
    if (index >= 0 && index !== active) setActive(index, false);
  });
  // A click on an option never moves focus out of the field.
  list.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("close", () => {
    window.clearTimeout(peopleTimer);
    window.clearTimeout(announceTimer);
    waiting = false;
    peopleRequest?.abort();
    people = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
  return element;
}

function setActive(index: number, scroll: boolean): void {
  const { input, list } = parts();
  list.querySelector('[aria-selected="true"]')?.setAttribute("aria-selected", "false");
  active = index;
  const option = options[index];
  if (!option) { input.removeAttribute("aria-activedescendant"); return; }
  const element = list.querySelector<HTMLElement>(`#${CSS.escape(option.id)}`);
  element?.setAttribute("aria-selected", "true");
  input.setAttribute("aria-activedescendant", option.id);
  if (scroll) element?.scrollIntoView({ block: "nearest" });
}

function choose(option: Option, newTab: boolean): void {
  if (option.expand) {
    const first = options.indexOf(option);
    expanded.add(option.expand);
    render(false);
    setActive(Math.min(first, options.length - 1), true);
    return;
  }
  if (!option.href) return;
  if (newTab) { window.open(option.href, "_blank", "noopener"); return; }
  // Focus goes where the destination puts it (a page's heading, an opened sheet), not back to the search button.
  opener = null;
  close();
  navigate(option.href);
}

function close(): void {
  if (dialog?.open) dialog.close();
}

/** Asks the Worker for people once typing pauses; only administrators reach this, and nothing is kept after the dialog closes. */
function askPeople(query: string): void {
  window.clearTimeout(peopleTimer);
  peopleRequest?.abort();
  if (!admin || !queryWords(query).length) { people = null; return; }
  if (people?.query === query) return;
  peopleTimer = window.setTimeout(async () => {
    const abort = new AbortController();
    peopleRequest = abort;
    try {
      const response = await fetch(`${PEOPLE_URL}?q=${encodeURIComponent(query)}`, { credentials: "same-origin", headers: { accept: "application/json" }, signal: abort.signal });
      const body = await response.json().catch(() => ({})) as { people?: PersonHit[]; total?: number };
      if (abort.signal.aborted) return;
      const hits = response.ok ? body.people ?? [] : [];
      people = { query, hits, total: Math.max(hits.length, body.total ?? 0), error: !response.ok };
    } catch {
      if (abort.signal.aborted) return;
      people = { query, hits: [], total: 0, error: true };
    }
    if (dialog?.open && parts().input.value.trim() === query) render(false);
  }, PEOPLE_DELAY);
}

function groupsFor(query: string): Group[] {
  const tokens = queryWords(query);
  const groups: Group[] = [];
  const go = searchShortcuts(query, admin);
  if (go.length) groups.push({ key: "go", title: "Go to", total: go.length, best: query.trim() ? go[0]!.score : Infinity, rows: go.map((hit) => goOption(hit, tokens)) });
  if (tokens.length && held) {
    const found = searchCatalog(held.prepared, query);
    if (found.items.length) groups.push({ key: "items", title: "Items", total: found.total.items, best: found.items[0]!.score, rows: found.items.map((hit) => itemOption(hit, tokens)) });
    if (found.kits.length) groups.push({ key: "kits", title: "Kits", total: found.total.kits, best: found.kits[0]!.score, rows: found.kits.map((hit) => kitOption(hit, tokens)) });
    if (found.places.length) groups.push({ key: "places", title: "Places", total: found.total.places, best: found.places[0]!.score, rows: found.places.map((hit) => placeOption(hit, tokens)) });
  }
  if (admin && tokens.length) {
    const current = people?.query === query.trim() ? people : null;
    if (current?.hits.length) {
      // The Worker sends the best few; the rest are one step away, on the directory's own search.
      const more = current.total > current.hits.length ? { id: "palette-people-all", href: `/staff/admin/directory?q=${encodeURIComponent(query.trim())}`, label: `See all ${current.total} matching people in the Staff Directory`, body: html`<span class="palette__more">See all ${current.total} in the Staff Directory</span>` } : undefined;
      groups.push({ key: "people", title: "Staff Directory", total: current.total, best: current.hits[0]!.score, rows: current.hits.map((hit) => personOption(hit, tokens)), more });
    }
  }
  // The group with the best match leads; equal ones keep this order, so the same query always lists the same way. A place or kit
  // named exactly what was typed comes before items that share the word: it is the narrower answer, and its items are a step away.
  const order: GroupKey[] = ["go", "places", "kits", "items", "people"];
  return groups.sort((a, b) => b.best - a.best || order.indexOf(a.key) - order.indexOf(b.key));
}

const KIND_WORDS: Record<GroupKey, [string, string]> = { go: ["page", "pages"], items: ["item", "items"], kits: ["kit", "kits"], places: ["place", "places"], people: ["person", "people"] };
const counted = (count: number, key: GroupKey) => `${count} ${KIND_WORDS[key][count === 1 ? 0 : 1]}`;

function render(typed: boolean): void {
  const { input, list, note, escape } = parts();
  const query = input.value.trim();
  const previous = options[active]?.id;
  if (typed) askPeople(query);
  const groups = groupsFor(query);
  const alone = groups.filter((group) => group.key !== "go").length === 1;
  options = [];
  const tokens = queryWords(query);
  mount(list, html`${groups.map((group) => {
    const limit = expanded.has(group.key) ? group.rows.length : alone && group.key !== "go" ? ALONE : ROWS[group.key];
    const shown = group.rows.slice(0, limit);
    const rest = group.rows.length - shown.length;
    options.push(...shown);
    const more = rest > 0
      ? { id: `palette-more-${group.key}`, expand: group.key, label: `Show all ${counted(group.rows.length, group.key)}`, body: html`<span class="palette__more">Show all ${counted(group.rows.length, group.key)}</span>` }
      : group.more ?? null;
    if (more) options.push(more);
    const capped = !group.more && expanded.has(group.key) && group.total > group.rows.length;
    return html`<div class="palette__group" role="group" aria-labelledby="palette-group-${group.key}">
      <div class="palette__heading" role="presentation" id="palette-group-${group.key}">${group.title}${group.key !== "go" ? html` <span class="palette__count">${group.total}</span>` : ""}</div>
      ${[...shown, ...(more ? [more] : [])].map((option) => html`<div class="palette__option${more && option === more ? " palette__option--more" : ""}" role="option" id="${option.id}" aria-selected="false" aria-label="${option.label}">${option.body}</div>`)}
      ${capped ? html`<p class="palette__capped" role="presentation">The first ${group.rows.length} of ${group.total}. Add a word to narrow them.</p>` : ""}
    </div>`;
  })}`);
  input.setAttribute("aria-expanded", String(options.length > 0));
  list.setAttribute("aria-busy", String(Boolean(tokens.length && !held && fetching)));
  escape.textContent = input.value ? "clear" : "close";

  // The line under the results: what to type, that it is loading, or that nothing matched.
  const records = groups.some((group) => group.key !== "go");
  const loadingPeople = admin && tokens.length > 0 && people?.query !== query;
  let message: Html | string = "";
  if (!query) message = html`<p>Find items by name, other names, where they are kept or the kit they are in${admin ? ", and people in the Staff Directory" : ""}. An item, kit or place ID opens it directly.</p>`;
  else if (query.length < MIN_QUERY) message = html`<p>Keep typing to search the records.</p>`;
  else if (!held && indexError) message = html`<p class="palette__error">${icon("alert")} ${indexError.status === 401 ? "Your session has ended. Sign in again to search." : indexError.message}</p>`;
  else if (!held) message = html`<div class="palette__loading" aria-hidden="true"><span></span><span></span><span></span></div>`;
  else if (!records && !loadingPeople) message = html`<div class="palette__none"><p class="palette__none-title">No matches for “${query}”</p><p>Check the spelling, or try another name, a place or a kit.</p></div>`;
  if (admin && people?.error && people.query === query) message = html`${message}<p class="palette__error">${icon("alert")} The Staff Directory could not be searched just now.</p>`;
  mount(note, html`${message}`);

  // Keep the same result active when it is still listed; otherwise the best one.
  const kept = previous ? options.findIndex((option) => option.id === previous) : -1;
  setActive(typed || kept < 0 ? (options.length && query ? 0 : -1) : kept, false);
  if (typed) list.scrollTop = 0;

  if (query !== lastQuery || typed) {
    lastQuery = query;
    waiting = false;
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(announce, ANNOUNCE_DELAY);
  } else if (waiting) announce();
}

/** Says how many results there are, once typing has paused and every part of the answer (the records, the directory) is in. */
function announce(): void {
  waiting = false;
  const { input, status } = parts();
  const query = input.value.trim();
  if (!dialog?.open || query.length < MIN_QUERY) return;
  if (!held || (admin && queryWords(query).length && people?.query !== query)) { waiting = true; return; }
  const counts = groupsFor(query).filter((group) => group.key !== "go").map((group) => counted(group.total, group.key));
  status.textContent = counts.length ? `${counts.join(", ")}.` : `No matches for ${query}.`;
}

/** Opens global search, or closes it when it is already open (the same shortcut does both). `isAdmin`: show the Staff Directory. */
export function togglePalette(isAdmin: boolean): void {
  dialog ??= build();
  if (dialog.open) { close(); return; }
  admin = isAdmin;
  opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const { input, status } = parts();
  input.value = "";
  status.textContent = "";
  expanded.clear();
  people = null;
  lastQuery = "";
  render(false);
  dialog.showModal();
  input.focus();
  // A fresh index re-ranks whatever has been typed meanwhile; the active result stays where it was.
  void loadIndex().then(() => { if (dialog?.open) render(false); });
}
