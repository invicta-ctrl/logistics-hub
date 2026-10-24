import "./attention.css";
import { ageOf, refreshAttention } from "./staff-shell";
import { ApiError, type Html, api, emptyState, expired, failure, formatDate, formatDateTime, html, icon, live, mount, navigate, onLeave, ownQuery, preservingFocus, sheet, toast, writeParams } from "./ui";

/*
 * The Attention queue: the records that need a person, gathered from Items, Stock, Loans, Locations, Kits, Catalog and
 * Self-Service. Nothing is stored here. An entry is shown for as long as its cause is true, so fixing the cause (returning the loan,
 * restocking, settling the finding) is what clears it, and each entry opens the record where that next step is made.
 *
 * Home and Attention are one workspace (LH-IP02-S01): both mount the composition in home-workspace.ts, and this module is its
 * queue. Home opens on what to act on today or this week; /staff/attention opens on everything, as every existing link expects.
 * Choosing an entry opens its record document beside the queue, or in a sheet on narrower screens, with one `entry` key in the
 * address so Back closes it.
 */

type Urgency = "NOW" | "SOON" | "LATER";
type Entry = { key: string; reason: string; source: string; urgency: Urgency; title: string; why: string; since: string | null; href: string; action: string; review?: { loanId: string }; identity?: { eventId: string }; keepBoth?: { itemId: string } };
type Group = { reason: string; source: string; label: string; total: number; byUrgency: Record<Urgency, number> };
type Answer = { today: string; groups: Group[]; entries: Entry[] };
/** "active" is Home's view (today and this week); "any" is Attention's, everything. Only the default differs; the keys are the same. */
export type QueueScope = "active" | "any";

const SOURCES = ["Loans", "Stock", "Locations", "Kits", "Catalog", "Self-Service"] as const;
const URGENCY_LABELS: Record<Urgency, string> = { NOW: "Today", SOON: "This week", LATER: "When there is time" };
const URGENCY_TAG: Record<Urgency, string> = { NOW: "tag--bad", SOON: "tag--warn", LATER: "" };
const URGENCY_ORDER: Urgency[] = ["NOW", "SOON", "LATER"];
const AGES = [{ id: "", text: "Any age" }, { id: "7", text: "Older than a week" }, { id: "30", text: "Older than a month" }] as const;
const SHOWN = 5;
/** The record document sits beside the queue from here up; below it opens as a sheet. */
const WIDE = "(min-width: 1181px)";

const sinceIso = (since: string) => since.length === 10 ? `${since}T00:00:00+08:00` : since;
const toAct = (group: Group) => group.byUrgency.NOW + group.byUrgency.SOON;

/** A placeholder shaped like the queue, shown only while the first answer is on its way. */
const SKELETON = html`<div class="attn-skeleton" aria-hidden="true">${[1, 2, 3, 4].map(() => html`<div class="attn-skeleton__row"><span class="skeleton attn-skeleton__pip"></span><span class="attn-skeleton__lines"><span class="skeleton"></span><span class="skeleton"></span></span></div>`)}</div><span class="sr-only">Loading what needs attention</span>`;

/** The queue's own markup. The composition places it beside the context column. */
export function queueMarkup(scope: QueueScope): Html {
  return html`<section class="ws-queue" aria-labelledby="attn-title">
    <div class="ws-queue__head"><h2 id="attn-title">Needs attention</h2><p class="live-status" id="live-status">Connecting…</p></div>
    <div class="attn-reasons" id="attn-reasons" role="group" aria-label="Show one kind" hidden></div>
    <div class="attn-filters" role="group" aria-label="Filter attention">
      <button class="button button--secondary button--sm filters-toggle" type="button" id="filters-toggle" aria-expanded="false" aria-controls="table-filters">${icon("filter")}<span>Filters</span></button>
      <button class="button button--ghost button--sm" type="button" id="clear-filters" hidden>Clear filters</button>
      <p class="table-toolbar__count" id="attn-count" aria-live="polite"></p>
      <div class="table-filters" id="table-filters">
        <div class="field"><label for="filter-source">From</label><select id="filter-source"><option value="">Everywhere</option>${SOURCES.map((source) => html`<option value="${source}">${source}</option>`)}</select></div>
        <div class="field"><label for="filter-urgency">How soon</label><select id="filter-urgency"><option value="">${scope === "active" ? "Today and this week" : "Any"}</option>${URGENCY_ORDER.map((urgency) => html`<option value="${urgency}">${URGENCY_LABELS[urgency]}</option>`)}</select></div>
        <div class="field"><label for="filter-age">Age</label><select id="filter-age">${AGES.map((age) => html`<option value="${age.id}">${age.text}</option>`)}</select></div>
      </div>
    </div>
    <p class="attn-only" id="attn-only" hidden></p>
    <div id="attn-results" class="attn-results" aria-busy="true">${SKELETON}</div>
  </section>`;
}

/** The guarded actions an entry carries. In a row they answer the pointer; the keyboard reaches them in the record document. */
function actionsMarkup(entry: Entry, inRow: boolean): Html {
  const skip = inRow ? html`tabindex="-1"` : "";
  return html`${entry.review ? html`<button class="button button--secondary button--sm" type="button" data-review="${entry.review.loanId}" ${skip}>${icon("check")}Mark reviewed</button>` : ""}
    ${entry.identity ? html`<button class="button button--secondary button--sm" type="button" data-identity="${entry.identity.eventId}" data-outcome="CONFIRMED" ${skip}>${icon("check")}Confirm identity</button>
      <button class="button button--ghost button--sm" type="button" data-identity="${entry.identity.eventId}" data-outcome="IGNORED" ${skip}>Ignore</button>` : ""}
    ${entry.keepBoth ? html`<button class="button button--ghost button--sm" type="button" data-keep-both="${entry.keepBoth.itemId}" ${skip}>Keep both</button>` : ""}`;
}

/**
 * Runs the queue inside an already mounted composition: one live poll, the filters and their address keys, the bounded groups,
 * the guarded actions, and the record document in `#attn-doc` (wide) or the `#attn-sheet` dialog. `#ws-today` is the context
 * column's resting content, hidden while a document is beside the queue.
 */
export function startQueue(scope: QueueScope): void {
  const params = new URLSearchParams(window.location.search);
  const source = document.querySelector<HTMLSelectElement>("#filter-source")!;
  const urgency = document.querySelector<HTMLSelectElement>("#filter-urgency")!;
  const age = document.querySelector<HTMLSelectElement>("#filter-age")!;
  const results = document.querySelector<HTMLElement>("#attn-results")!;
  const clear = document.querySelector<HTMLElement>("#clear-filters")!;
  const reasons = document.querySelector<HTMLElement>("#attn-reasons")!;
  const docHost = document.querySelector<HTMLElement>("#attn-doc")!;
  const today = document.querySelector<HTMLElement>("#ws-today")!;
  const dialog = document.querySelector<HTMLDialogElement>("#attn-sheet")!;
  const pick = (select: HTMLSelectElement, value: string | null) => { if (value && [...select.options].some((option) => option.value === value)) select.value = value; };
  pick(source, params.get("source"));
  pick(urgency, params.get("urgency"));
  pick(age, params.get("age"));

  // A reason link (?reason=LOAN_OVERDUE) shows one kind, so its count and this list are the same set; "Show everything" lifts it.
  let only = params.get("reason");
  let selected = params.get("entry");
  let data: Answer | null = null;
  const expanded = new Set<string>();

  const old = (entry: Entry, days: number) => entry.since !== null && Date.now() - Date.parse(sinceIso(entry.since)) >= days * 86_400_000;
  const narrowed = () => Boolean(source.value || urgency.value || age.value);
  // Home leaves routine work out until it is asked for; Attention shows everything.
  const activeOnly = () => scope === "active" && !urgency.value;
  /** A group's true size in this view, from the Worker's totals rather than the entries it listed. */
  const scopedTotal = (group: Group) => activeOnly() ? toAct(group) : group.total;

  function rowMarkup(entry: Entry): Html {
    const current = entry.key === selected;
    return html`<li class="attn-row${current ? " is-selected" : ""}" data-key="${entry.key}">
      <button class="attn-row__main" type="button" data-select="${entry.key}" tabindex="-1" ${current ? html`aria-current="true"` : ""}>
        <span class="attn-row__title">${entry.title}</span>
        <span class="attn-row__why">${entry.why}</span>
        ${entry.since ? html`<span class="attn-row__since">Since ${ageOf(sinceIso(entry.since))}</span>` : ""}
      </button>
      <span class="attn-row__actions">${actionsMarkup(entry, true)}<a class="button button--ghost button--sm" href="${entry.href}" data-route tabindex="-1">${entry.action}${icon("next")}</a></span></li>`;
  }

  function groupMarkup(group: Group, entries: Entry[], level: Urgency): Html {
    const open = expanded.has(group.reason);
    const shown = open ? entries : entries.slice(0, SHOWN);
    const bounded = !narrowed() && scopedTotal(group) > entries.length;
    const id = `attn-${group.reason}`;
    return html`<section class="attn-group" aria-labelledby="${id}">
      <div class="attn-group__head"><h4 id="${id}">${group.label}</h4><span class="tag ${URGENCY_TAG[level]}">${group.source} · ${narrowed() ? entries.length : scopedTotal(group)}</span></div>
      <ul class="attn-list" aria-labelledby="${id}">${shown.map(rowMarkup)}</ul>
      ${entries.length > SHOWN ? html`<button class="button button--ghost button--sm attn-more" type="button" data-more="${group.reason}" aria-expanded="${open}">${open ? "Show fewer" : bounded ? `Show the first ${entries.length}` : `Show all ${entries.length}`}</button>` : ""}
      ${bounded && open ? html`<p class="muted attn-note">Showing the first ${entries.length} of ${scopedTotal(group)}. The rest appear as these are cleared.</p>` : ""}
    </section>`;
  }

  /*
   * One button per kind, with the same count its list will show. On Home the kinds to act on come first; routine kinds follow
   * with their "when there is time" count, and choosing one shows exactly those.
   */
  function reasonsMarkup(groups: Group[]): Html {
    const button = (group: Group, count: number, later: boolean) => html`<button class="attn-reason" type="button" data-reason="${group.reason}" ${later ? html`data-later` : ""} aria-pressed="${only === group.reason}">
      <span class="attn-reason__label">${group.label}</span><span class="attn-reason__count">${count.toLocaleString()}</span></button>`;
    if (scope === "any") return html`${groups.filter((group) => group.total > 0).map((group) => button(group, group.total, false))}`;
    const urgent = groups.filter((group) => toAct(group) > 0).sort((a, b) => Number(b.byUrgency.NOW > 0) - Number(a.byUrgency.NOW > 0));
    const routine = groups.filter((group) => toAct(group) === 0 && group.total > 0);
    return html`${urgent.map((group) => button(group, toAct(group), false))}${routine.length ? html`<span class="attn-reasons__later">When there is time</span>${routine.map((group) => button(group, group.byUrgency.LATER, true))}` : ""}`;
  }

  /** The entries in the order they are on screen, for previous and next. */
  const onScreen = () => [...results.querySelectorAll<HTMLElement>(".attn-row")].map((row) => row.dataset.key!);
  const rowOf = (key: string | null) => key ? results.querySelector<HTMLButtonElement>(`[data-select="${CSS.escape(key)}"]`) : null;

  /** The queue is one tab stop: the selected entry, or the first, takes it; the arrow keys move between the rest. */
  const rove = (to?: HTMLButtonElement | null) => {
    const buttons = [...results.querySelectorAll<HTMLButtonElement>(".attn-row__main")];
    const target = to ?? rowOf(selected) ?? buttons[0];
    for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  };

  const render = () => {
    if (!data) return;
    results.removeAttribute("aria-busy");
    if (only && !data.groups.some((group) => group.reason === only)) only = null;
    writeParams({ source: source.value || null, urgency: urgency.value || null, age: age.value || null, reason: only });
    const narrowedNote = document.querySelector<HTMLElement>("#attn-only")!;
    narrowedNote.hidden = !only;
    if (only) mount(narrowedNote, html`Showing only <strong>${data.groups.find((group) => group.reason === only)!.label}</strong>. <button class="text-link" type="button" id="show-everything">Show everything</button>`);
    mount(reasons, reasonsMarkup(data.groups));
    reasons.hidden = !reasons.childElementCount;
    clear.hidden = !narrowed();
    const active = [source, urgency, age].filter((select) => select.value).length;
    document.querySelector("#filters-toggle span")!.textContent = active ? `Filters (${active})` : "Filters";
    const minDays = age.value ? Number(age.value) : 0;
    const byReason = new Map<string, Entry[]>();
    for (const entry of data.entries) {
      if ((only && entry.reason !== only) || (activeOnly() && entry.urgency === "LATER") || (source.value && entry.source !== source.value) || (urgency.value && entry.urgency !== urgency.value) || (minDays && !old(entry, minDays))) continue;
      byReason.set(entry.reason, [...(byReason.get(entry.reason) ?? []), entry]);
    }
    const sections = data.groups.filter((group) => byReason.has(group.reason));
    // The same split as the bell: what needs a person now or this week, and what can wait. The bell counts only the first.
    const shownCount = (group: Group, entries: Entry[], urgent: boolean) => narrowed() ? entries.filter((entry) => (entry.urgency !== "LATER") === urgent).length
      : urgent ? toAct(group) : activeOnly() ? 0 : group.byUrgency.LATER;
    const soon = sections.reduce((sum, group) => sum + shownCount(group, byReason.get(group.reason)!, true), 0);
    const later = sections.reduce((sum, group) => sum + shownCount(group, byReason.get(group.reason)!, false), 0);
    document.querySelector("#attn-count")!.textContent = soon + later ? [soon ? `${soon.toLocaleString()} to act on` : "", later ? `${later.toLocaleString()} when there is time` : ""].filter(Boolean).join(" · ") : "";
    if (!sections.length) {
      preservingFocus(results, () => mount(results, only && !narrowed()
        ? emptyState("Nothing left here", "Everything of this kind has been dealt with. It disappears from this page by itself.", html`<button class="button button--secondary" type="button" id="clear-all">Show everything</button>`, "", 3)
        : narrowed()
        ? emptyState("Nothing matches these filters", "Clear the filters to see everything that needs a person.", html`<button class="button button--secondary" type="button" id="clear-all">Clear filters</button>`, "", 3)
        : scope === "active"
        ? emptyState("Nothing needs a person right now", "Loans are on time, stock is in hand and no record is waiting. This fills in by itself when something does.", "", "", 3)
        : emptyState("Nothing needs attention", "Loans are on time, stock is in hand, and no record is waiting for a person. This page fills in by itself when something needs a look.", "", "", 3)));
      syncDocument(false);
      return;
    }
    // Each group sits under the soonest urgency of its entries, and the groups keep the order the Worker gave them within it.
    const level = (group: Group): Urgency => URGENCY_ORDER.find((value) => byReason.get(group.reason)!.some((entry) => entry.urgency === value))!;
    preservingFocus(results, () => mount(results, html`${URGENCY_ORDER.map((value) => {
      const mine = sections.filter((group) => level(group) === value);
      return mine.length ? html`<div class="attn-band"><h3 class="attn-band__title"><span class="attn-pip attn-pip--${value.toLowerCase()}" aria-hidden="true"></span>${URGENCY_LABELS[value]}</h3>${mine.map((group) => groupMarkup(group, byReason.get(group.reason)!, value))}</div>` : "";
    })}`));
    rove(results.contains(document.activeElement) ? document.activeElement?.closest<HTMLButtonElement>(".attn-row__main") : null);
    syncDocument(false);
  };

  /* ---------- The record document ---------- */

  const wide = window.matchMedia(WIDE);
  // Leaving the page closes the sheet too; that close belongs to the page left behind and must not touch the next one's address.
  let left = false;
  onLeave(() => { left = true; });
  const panel = sheet(dialog, { onClose: () => { if (!quiet && !left) closeDocument(); quiet = false; } });
  /** Set while the page itself closes the sheet (Back, a cleared entry), so its close is not read as the person closing it. */
  let quiet = false;
  /** What the open document was drawn from, so a poll that changed nothing about it leaves focus and scroll alone. */
  let drawn = "";
  /** The row to focus once a document closes, so focus returns to the entry it came from. */
  let returnTo: string | null = null;

  function documentMarkup(entry: Entry): Html {
    const keys = onScreen();
    const at = keys.indexOf(entry.key);
    const group = data?.groups.find((candidate) => candidate.reason === entry.reason);
    const since = entry.since ? sinceIso(entry.since) : null;
    return html`<article class="attn-doc" aria-labelledby="attn-doc-title">
      <div class="attn-doc__bar"><p class="attn-doc__crumb">${entry.source}</p>
        <div class="attn-doc__nav">
          <button class="icon-button" type="button" data-step="-1" aria-label="Previous entry" title="Previous" ${at > 0 ? "" : "disabled"}>${icon("sortUp")}</button>
          <button class="icon-button" type="button" data-step="1" aria-label="Next entry" title="Next" ${at >= 0 && at < keys.length - 1 ? "" : "disabled"}>${icon("sortDown")}</button>
          <button class="icon-button" type="button" data-close aria-label="Close" title="Close">${icon("close")}</button>
        </div></div>
      <div class="attn-doc__body">
        <h2 class="attn-doc__title" id="attn-doc-title" tabindex="-1">${entry.title}</h2>
        <p class="attn-doc__status attn-doc__status--${entry.urgency.toLowerCase()}"><span class="attn-pip attn-pip--${entry.urgency.toLowerCase()}" aria-hidden="true"></span>${URGENCY_LABELS[entry.urgency]} · ${group?.label ?? entry.reason}</p>
        ${at < 0 ? html`<p class="attn-doc__note">Not in the list as it is shown now.${only || narrowed() ? html` <button class="text-link" type="button" id="doc-clear">Show everything</button>` : ""}</p>` : ""}
        <section class="attn-doc__why" aria-labelledby="attn-doc-why"><h3 id="attn-doc-why">Why it is here</h3><p>${entry.why}</p></section>
        <dl class="attn-doc__facts">
          <div><dt>From</dt><dd>${entry.source}</dd></div>
          ${since ? html`<div><dt>Waiting since</dt><dd><time datetime="${since}">${entry.since!.length === 10 ? formatDate(entry.since!) : formatDateTime(since)}</time> · ${ageOf(since)}</dd></div>` : ""}
        </dl>
      </div>
      <div class="attn-doc__actions">${actionsMarkup(entry, false)}<a class="button button--primary" href="${entry.href}" data-route>${entry.action}${icon("next")}</a></div>
    </article>`;
  }

  function markRows() {
    for (const row of results.querySelectorAll<HTMLElement>(".attn-row")) {
      const current = row.dataset.key === selected;
      row.classList.toggle("is-selected", current);
      const button = row.querySelector(".attn-row__main")!;
      if (current) button.setAttribute("aria-current", "true"); else button.removeAttribute("aria-current");
    }
  }

  /** Draws the document for the address's `entry`, or puts the context column back. `focus` moves focus into a newly opened one. */
  function syncDocument(focus: boolean) {
    const entry = selected && data ? data.entries.find((candidate) => candidate.key === selected) : undefined;
    // An entry that is no longer here (cleared, or an old link) is let go quietly; the queue stays as it is.
    if (selected && data && !entry) { selected = null; if (window.history.state?.attnEntry) window.history.back(); else writeParams({ entry: null }); }
    markRows();
    if (!entry) {
      drawn = "";
      docHost.hidden = true;
      docHost.replaceChildren();
      today.hidden = false;
      if (dialog.open) { quiet = true; panel.close(true); }
      const back = rowOf(returnTo);
      returnTo = null;
      if (back) { rove(back); back.focus({ preventScroll: true }); }
      return;
    }
    const key = `${wide.matches}|${JSON.stringify(entry)}|${onScreen().join()}`;
    if (key === drawn && !focus) return;
    drawn = key;
    if (wide.matches) {
      if (dialog.open) { quiet = true; panel.close(true); }
      mount(docHost, documentMarkup(entry));
      docHost.hidden = false;
      today.hidden = true;
    } else {
      docHost.hidden = true;
      docHost.replaceChildren();
      today.hidden = false;
      mount(dialog, documentMarkup(entry));
      panel.open(rowOf(entry.key)?.closest(".attn-row"));
      if (focus) dialog.querySelector<HTMLElement>("#attn-doc-title")?.focus({ preventScroll: true });
    }
  }

  /** Opening adds one history entry; moving to another entry while one is open replaces it, so Back always closes the document. */
  function open(key: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("entry", key);
    const replace = selected !== null;
    navigate(`${url.pathname}${url.search}`, replace, replace ? window.history.state ?? {} : { attnEntry: true });
  }

  function closeDocument() {
    returnTo = selected;
    if (window.history.state?.attnEntry) { window.history.back(); return; }
    selected = null;
    writeParams({ entry: null });
    syncDocument(false);
  }

  function step(by: number) {
    const keys = onScreen();
    const next = keys[keys.indexOf(selected ?? "") + by];
    if (!next) return;
    rove(rowOf(next));
    open(next);
  }

  // Back and forward reach the document through the address alone.
  ownQuery(() => {
    selected = new URLSearchParams(window.location.search).get("entry");
    syncDocument(true);
  });
  const onWidth = () => { drawn = ""; syncDocument(false); };
  wide.addEventListener("change", onWidth);
  onLeave(() => wide.removeEventListener("change", onWidth));

  const poll = live<Answer>("/api/staff/attention", {
    interval: 15_000,
    status: () => document.querySelector("#live-status"),
    onData: (next) => { data = next; render(); void refreshAttention(true); },
    onError: (error: ApiError) => {
      if (error.status === 401) expired();
      else if (!data) { results.removeAttribute("aria-busy"); mount(results, emptyState("Attention could not be loaded", `${error.message} Retrying automatically.`, "", "error", 3)); }
    }
  });

  /* ---------- Controls ---------- */

  for (const select of [source, urgency, age]) select.addEventListener("change", render);
  // The three filters fold behind one button, so the queue starts right under its heading.
  const toggle = document.querySelector<HTMLButtonElement>("#filters-toggle")!;
  const setFilters = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    document.querySelector("#table-filters")!.classList.toggle("is-open", open);
  };
  if (narrowed()) setFilters(true);
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    setFilters(open);
    if (open) source.focus();
  });
  const clearFilters = () => { source.value = ""; urgency.value = ""; age.value = ""; only = null; render(); };
  clear.addEventListener("click", clearFilters);
  document.querySelector("#attn-only")!.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest("#show-everything")) { only = null; render(); document.querySelector<HTMLElement>("#main-content")?.focus(); } });
  reasons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-reason]");
    if (!button) return;
    const reason = button.dataset.reason!;
    only = only === reason ? null : reason;
    // A routine kind on Home is shown as what it is: work for when there is time.
    if (scope === "active") urgency.value = only && button.hasAttribute("data-later") ? "LATER" : "";
    render();
  });

  /** The guarded actions, the same from a row and from the document: each disables itself until the server answers. */
  function act(target: HTMLElement): boolean {
    const identity = target.closest<HTMLButtonElement>("[data-identity]");
    if (identity) {
      const buttons = identity.parentElement!.querySelectorAll<HTMLButtonElement>("[data-identity]");
      buttons.forEach((button) => { button.disabled = true; });
      api(`/api/staff/self-service/${identity.dataset.identity}/identity`, { method: "POST", body: JSON.stringify({ outcome: identity.dataset.outcome }) })
        .then(() => { toast(identity.dataset.outcome === "CONFIRMED" ? "Identity confirmed." : "Ignored. The record keeps what the person gave."); return poll.refresh(); })
        .catch((error) => { buttons.forEach((button) => { button.disabled = false; }); toast(failure(error), "error"); });
      return true;
    }
    const keep = target.closest<HTMLButtonElement>("[data-keep-both]");
    if (keep) {
      keep.disabled = true;
      api(`/api/staff/attention/possible-duplicate/${encodeURIComponent(keep.dataset.keepBoth!)}`, { method: "POST" })
        .then(() => { toast("Kept as two separate items."); return poll.refresh(); })
        .catch((error) => { keep.disabled = false; toast(failure(error), "error"); });
      return true;
    }
    const review = target.closest<HTMLButtonElement>("[data-review]");
    if (review) {
      review.disabled = true;
      api(`/api/staff/loans/${review.dataset.review}/review`, { method: "POST" })
        .then(() => { toast("Marked as reviewed."); return poll.refresh(); })
        .catch((error) => { review.disabled = false; toast(failure(error), "error"); });
      return true;
    }
    return false;
  }

  results.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("#clear-all")) return clearFilters();
    const more = target.closest<HTMLElement>("[data-more]");
    if (more) { const id = more.dataset.more!; if (expanded.has(id)) expanded.delete(id); else expanded.add(id); render(); return; }
    if (act(target)) return;
    const row = target.closest<HTMLButtonElement>("[data-select]");
    if (row) { rove(row); open(row.dataset.select!); }
  });

  // Up, down, Home and End move between entries; Enter and Space (the button's own) open one. With a document beside the queue,
  // moving also moves the selection, so the queue can be read through without reaching for the pointer.
  results.addEventListener("keydown", (event) => {
    const current = (event.target as HTMLElement).closest<HTMLButtonElement>(".attn-row__main");
    if (!current) return;
    if (event.key === "Escape" && selected) { event.preventDefault(); closeDocument(); return; }
    const buttons = [...results.querySelectorAll<HTMLButtonElement>(".attn-row__main")];
    const at = buttons.indexOf(current);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (to === undefined || !buttons[to]) return;
    event.preventDefault();
    rove(buttons[to]);
    buttons[to].focus();
    if (selected && wide.matches) open(buttons[to].dataset.select!);
  });

  const onDocument = (event: Event) => {
    const target = event.target as HTMLElement;
    if (act(target)) return;
    if (target.closest("#doc-clear")) { clearFilters(); return; }
    const by = target.closest<HTMLElement>("[data-step]");
    if (by) { step(Number(by.dataset.step)); return; }
    // In the sheet the sheet itself closes on [data-close]; beside the queue the document does.
    if (target.closest("[data-close]") && !dialog.contains(target)) closeDocument();
  };
  docHost.addEventListener("click", onDocument);
  dialog.addEventListener("click", onDocument);
  docHost.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeDocument(); } });
}

/** /staff/attention: the same workspace as Home, opened on everything that needs a person. */
export async function attentionWorkspace(): Promise<void> {
  const { workspace } = await import("./home-workspace");
  await workspace("attention");
}
