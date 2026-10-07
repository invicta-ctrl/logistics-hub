import "./attention.css";
import { ageOf, loadSession, refreshAttention, shell } from "./staff";
import { ApiError, type Html, api, emptyState, expired, failure, html, icon, live, mount, preservingFocus, toast, writeParams } from "./ui";

/*
 * Attention (/staff/attention): the records that need a person, gathered from Items, Stock, Loans, Locations, Kits, Catalog and
 * Self-Service. Nothing is stored here. An entry is shown for as long as its cause is true, so fixing the cause (returning the loan,
 * restocking, settling the finding) is what clears it, and each entry opens the record where that next step is made.
 */

type Urgency = "NOW" | "SOON" | "LATER";
type Entry = { key: string; reason: string; source: string; urgency: Urgency; title: string; why: string; since: string | null; href: string; action: string; review?: { loanId: string } };
type Group = { reason: string; source: string; label: string; total: number };
type Answer = { today: string; groups: Group[]; entries: Entry[] };

const SOURCES = ["Loans", "Stock", "Locations", "Kits", "Catalog", "Self-Service"] as const;
const URGENCY_LABELS: Record<Urgency, string> = { NOW: "Today", SOON: "This week", LATER: "When there is time" };
const URGENCY_TAG: Record<Urgency, string> = { NOW: "tag--bad", SOON: "tag--warn", LATER: "" };
const URGENCY_ORDER: Urgency[] = ["NOW", "SOON", "LATER"];
const AGES = [{ id: "", text: "Any age" }, { id: "7", text: "Older than a week" }, { id: "30", text: "Older than a month" }] as const;
const SHOWN = 5;

export async function attentionWorkspace(): Promise<void> {
  const session = await loadSession("attention");
  if (!session) return;
  document.title = "Attention · Staff workspace";
  shell(session, "attention", html`
    <header class="page-header">
      <div class="page-header__title"><h1>Attention</h1><p>What needs a person right now. Each entry clears by itself once the cause is fixed.</p></div>
      <div class="page-header__actions"><p class="live-status" id="live-status">Connecting…</p></div>
    </header>
    <div class="table-toolbar attn-filters" role="group" aria-label="Filter attention">
      <div class="field"><label for="filter-source">From</label><select id="filter-source"><option value="">Everywhere</option>${SOURCES.map((source) => html`<option value="${source}">${source}</option>`)}</select></div>
      <div class="field"><label for="filter-urgency">How soon</label><select id="filter-urgency"><option value="">Any</option>${URGENCY_ORDER.map((urgency) => html`<option value="${urgency}">${URGENCY_LABELS[urgency]}</option>`)}</select></div>
      <div class="field"><label for="filter-age">Age</label><select id="filter-age">${AGES.map((age) => html`<option value="${age.id}">${age.text}</option>`)}</select></div>
      <button class="button button--ghost button--sm" type="button" id="clear-filters" hidden>Clear filters</button>
      <p class="table-toolbar__count" id="attn-count" aria-live="polite"></p>
    </div>
    <div id="attn-results" aria-busy="true"><div class="skeleton skeleton--block"></div></div>`);

  const params = new URLSearchParams(window.location.search);
  const source = document.querySelector<HTMLSelectElement>("#filter-source")!;
  const urgency = document.querySelector<HTMLSelectElement>("#filter-urgency")!;
  const age = document.querySelector<HTMLSelectElement>("#filter-age")!;
  const results = document.querySelector<HTMLElement>("#attn-results")!;
  const clear = document.querySelector<HTMLElement>("#clear-filters")!;
  const pick = (select: HTMLSelectElement, value: string | null) => { if (value && [...select.options].some((option) => option.value === value)) select.value = value; };
  pick(source, params.get("source"));
  pick(urgency, params.get("urgency"));
  pick(age, params.get("age"));

  let data: Answer | null = null;
  const expanded = new Set<string>();

  const old = (entry: Entry, days: number) => entry.since !== null && Date.now() - Date.parse(entry.since.length === 10 ? `${entry.since}T00:00:00+08:00` : entry.since) >= days * 86_400_000;
  const filtered = () => source.value || urgency.value || age.value;

  function rowMarkup(entry: Entry): Html {
    return html`<li class="attn-row" data-key="${entry.key}">
      <a class="attn-row__main" href="${entry.href}" data-route>
        <span class="attn-row__title">${entry.title}</span>
        <span class="attn-row__why">${entry.why}</span>
        ${entry.since ? html`<span class="attn-row__since">Since ${ageOf(entry.since.length === 10 ? `${entry.since}T00:00:00+08:00` : entry.since)}</span>` : ""}
      </a>
      <span class="attn-row__actions">
        ${entry.review ? html`<button class="button button--secondary button--sm" type="button" data-review="${entry.review.loanId}">${icon("check")}Mark reviewed</button>` : ""}
        <a class="button button--ghost button--sm" href="${entry.href}" data-route>${entry.action}${icon("next")}</a>
      </span></li>`;
  }

  function groupMarkup(group: Group, entries: Entry[], level: Urgency): Html {
    const open = expanded.has(group.reason);
    const shown = open ? entries : entries.slice(0, SHOWN);
    const bounded = !filtered() && group.total > entries.length;
    const id = `attn-${group.reason}`;
    return html`<section class="attn-group" aria-labelledby="${id}">
      <div class="attn-group__head"><h2 id="${id}">${group.label}</h2><span class="tag ${URGENCY_TAG[level]}">${group.source} · ${filtered() ? entries.length : group.total}</span></div>
      <ul class="attn-list" aria-labelledby="${id}">${shown.map(rowMarkup)}</ul>
      ${entries.length > SHOWN ? html`<button class="button button--ghost button--sm attn-more" type="button" data-more="${group.reason}" aria-expanded="${open}">${open ? "Show fewer" : `Show all ${entries.length}`}</button>` : ""}
      ${bounded && open ? html`<p class="muted attn-note">Showing the oldest ${entries.length} of ${group.total}. The rest appear as these are cleared.</p>` : ""}
    </section>`;
  }

  const render = () => {
    if (!data) return;
    results.removeAttribute("aria-busy");
    writeParams({ source: source.value || null, urgency: urgency.value || null, age: age.value || null });
    clear.hidden = !filtered();
    const minDays = age.value ? Number(age.value) : 0;
    const byReason = new Map<string, Entry[]>();
    for (const entry of data.entries) {
      if ((source.value && entry.source !== source.value) || (urgency.value && entry.urgency !== urgency.value) || (minDays && !old(entry, minDays))) continue;
      byReason.set(entry.reason, [...(byReason.get(entry.reason) ?? []), entry]);
    }
    const sections = data.groups.filter((group) => byReason.has(group.reason));
    const total = sections.reduce((sum, group) => sum + (filtered() ? byReason.get(group.reason)!.length : group.total), 0);
    document.querySelector("#attn-count")!.textContent = total ? `${total.toLocaleString()} ${total === 1 ? "entry" : "entries"}` : "";
    if (!sections.length) {
      preservingFocus(results, () => mount(results, data!.entries.length
        ? emptyState("Nothing matches these filters", "Clear the filters to see everything that needs a person.", html`<button class="button button--secondary" type="button" id="clear-all">Clear filters</button>`)
        : emptyState("Nothing needs attention", "Loans are on time, stock is in hand, and no record is waiting for a person. This page fills in by itself when something needs a look.")));
      return;
    }
    // Each group sits under the soonest urgency of its entries, and the groups keep the order the Worker gave them within it.
    const level = (group: Group): Urgency => URGENCY_ORDER.find((value) => byReason.get(group.reason)!.some((entry) => entry.urgency === value))!;
    preservingFocus(results, () => mount(results, html`${URGENCY_ORDER.map((value) => {
      const mine = sections.filter((group) => level(group) === value);
      return mine.length ? html`<div class="attn-band"><h2 class="attn-band__title">${URGENCY_LABELS[value]}</h2>${mine.map((group) => groupMarkup(group, byReason.get(group.reason)!, value))}</div>` : "";
    })}`));
  };

  const poll = live<Answer>("/api/staff/attention", {
    interval: 15_000,
    status: () => document.querySelector("#live-status"),
    onData: (next) => { data = next; render(); void refreshAttention(true); },
    onError: (error: ApiError) => {
      if (error.status === 401) expired();
      else if (!data) { results.removeAttribute("aria-busy"); mount(results, emptyState("Attention could not be loaded", `${error.message} Retrying automatically.`, "", "error")); }
    }
  });

  for (const select of [source, urgency, age]) select.addEventListener("change", render);
  const clearFilters = () => { source.value = ""; urgency.value = ""; age.value = ""; render(); };
  clear.addEventListener("click", clearFilters);
  results.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("#clear-all")) return clearFilters();
    const more = target.closest<HTMLElement>("[data-more]");
    if (more) { const id = more.dataset.more!; if (expanded.has(id)) expanded.delete(id); else expanded.add(id); render(); return; }
    const review = target.closest<HTMLButtonElement>("[data-review]");
    if (review) {
      review.disabled = true;
      api(`/api/staff/loans/${review.dataset.review}/review`, { method: "POST" })
        .then(() => { toast("Marked as reviewed."); return poll.refresh(); })
        .catch((error) => { review.disabled = false; toast(failure(error), "error"); });
    }
  });
}
