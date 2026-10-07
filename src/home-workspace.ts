import "./home.css";
import { ATTENTION_PAINTED, type AttentionGroup, SEARCH_KEYS, ageOf, attentionNow, loadSession, refreshAttention, shell } from "./staff";
import { ApiError, type Html, type IconName, api, emptyState, expired, failure, html, icon, live, mount, onLeave, plural } from "./ui";

/*
 * Home (/staff/home): where staff start. It answers "what should I do next?" from three things that already exist: what needs a person
 * (the same numbers as the bell, from the staff bar's Attention summary, so nothing is asked twice), your own unfinished cataloguing or
 * place check, and a few links for the work staff start most. Practical insights come last and arrive after the page is drawn, so
 * they can be slow or fail without ever holding up the rest. Nothing here is stored, and nothing here changes a record.
 */

type Resumable = {
  catalogue: { id: string; place: string | null; saved: number; startedAt: string; updatedAt: string } | null;
  checks: Array<{ id: string; place: string | null; status: string; expected: number; startedAt: string; updatedAt: string }>;
};
type InsightCard = { id: string; title: string; window: string; rule: string; rows: Array<{ name: string; href: string; evidence: string }>; advisory?: true };
type Completeness = { id: string; title: string; window: string; rule: string; rows: Array<{ name: string; have: number; of: number; gap: number; href: string; gapText: string }> };
type Insights = { asOf: string; cards: InsightCard[]; completeness: Completeness };

/** The work staff start most, in working order. Everyone sees these; administrators also see the two Administration pages. */
const ACTIONS: ReadonlyArray<{ href: string; icon: IconName; title: string; detail: string; admin?: true }> = [
  { href: "/staff/catalogue", icon: "plus", title: "Add items", detail: "Catalogue a shelf, or check a place" },
  { href: "/staff/loans", icon: "swap", title: "Lend or return", detail: "Loans out and back in" },
  { href: "/staff/stock", icon: "stack", title: "Stock in or out", detail: "Deliveries, takes and counts" },
  { href: "/staff/locations", icon: "pin", title: "Find a place", detail: "Where things are kept" },
  { href: "/staff/kits", icon: "box", title: "Check a kit", detail: "What is in it and what is short" },
  { href: "/staff/admin/directory", icon: "user", title: "Staff Directory", detail: "USC people and their accounts", admin: true },
  { href: "/staff/admin", icon: "shield", title: "Accounts and settings", detail: "Sign-ins and Self-Service", admin: true }
];
/** Reasons listed before a link to everything else, so the first screen stays short. */
const SHOWN = 6;

const greeting = (name: string) => {
  const hour = new Date().getHours();
  return `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${name.split(/\s+/)[0] ?? name}`;
};
const toAct = (group: AttentionGroup) => group.byUrgency.NOW + group.byUrgency.SOON;
const attentionHref = (group: AttentionGroup) => `/staff/attention?reason=${group.reason}`;

function attentionMarkup(groups: AttentionGroup[]): Html {
  // Today before This week; each keeps the order the Worker gave it.
  const urgent = groups.filter((group) => toAct(group) > 0).sort((a, b) => Number(b.byUrgency.NOW > 0) - Number(a.byUrgency.NOW > 0));
  const routine = groups.filter((group) => toAct(group) === 0 && group.total > 0);
  const act = urgent.reduce((sum, group) => sum + toAct(group), 0);
  const waiting = routine.length ? html`<p class="home-routine">When there is time: ${routine.map((group, at) => html`${at ? " · " : ""}<a class="text-link" href="${attentionHref(group)}" data-route>${group.label} <span class="mono">${group.total.toLocaleString()}</span></a>`)}</p>` : "";
  if (!urgent.length) {
    return html`<div class="home-clear">${icon("check")}<div><p class="home-clear__title">Nothing needs a person right now</p><p class="muted">Loans are on time, stock is in hand and no record is waiting. This page fills in by itself when something does.</p></div></div>${waiting}`;
  }
  return html`<ul class="home-list" aria-label="What needs a person, ${plural(act, "thing")}">${urgent.slice(0, SHOWN).map((group) => {
    const parts = [group.byUrgency.NOW ? `${group.byUrgency.NOW.toLocaleString()} today` : "", group.byUrgency.SOON ? `${group.byUrgency.SOON.toLocaleString()} this week` : "", group.byUrgency.LATER ? `${group.byUrgency.LATER.toLocaleString()} when there is time` : ""].filter(Boolean);
    return html`<li><a class="home-row" href="${attentionHref(group)}" data-route>
      <span class="home-row__count">${toAct(group).toLocaleString()}</span>
      <span class="home-row__text"><span class="home-row__title">${group.label}</span><span class="home-row__meta"><span class="tag ${group.byUrgency.NOW ? "tag--bad" : "tag--warn"}">${group.source}</span> ${parts.join(" · ")}</span></span>
      ${icon("next")}</a></li>`;
  })}</ul>
  ${urgent.length > SHOWN ? html`<p class="home-more"><a class="text-link" href="/staff/attention" data-route>Everything in Attention (${urgent.length - SHOWN} more)</a></p>` : ""}${waiting}`;
}

function continueMarkup(work: Resumable): Html {
  const rows: Html[] = [];
  if (work.catalogue) {
    const { id, place, saved, startedAt } = work.catalogue;
    rows.push(html`<li><a class="home-row" href="/staff/catalogue?session=${id}" data-route>
      <span class="home-row__text"><span class="home-row__title">Cataloguing${place ? ` at ${place}` : ""}</span><span class="home-row__meta">${saved ? `${plural(saved, "item")} added` : "Nothing added yet"} · started ${ageOf(startedAt)}</span></span>
      <span class="home-row__go">Resume ${icon("next")}</span></a></li>`);
  }
  for (const check of work.checks) {
    rows.push(html`<li><a class="home-row" href="/staff/catalogue?audit=${check.id}" data-route>
      <span class="home-row__text"><span class="home-row__title">Check of ${check.place ?? "a place"}</span><span class="home-row__meta">${check.status === "PAUSED" ? "Paused" : "Open"} · ${plural(check.expected, "item")} expected · last worked on ${ageOf(check.updatedAt)}</span></span>
      <span class="home-row__go">Resume ${icon("next")}</span></a></li>`);
  }
  return html`<ul class="home-list" aria-labelledby="home-continue-title">${rows}</ul>`;
}

function cardMarkup(card: InsightCard): Html {
  return html`<article class="home-card" aria-labelledby="insight-${card.id}">
    <h3 id="insight-${card.id}">${card.title}</h3>
    <p class="home-card__meta">${card.window} · ${card.rule}</p>
    <ul class="home-card__list">${card.rows.map((row) => html`<li><a class="home-card__name" href="${row.href}" data-route>${row.name}</a><span class="home-card__why">${row.evidence}</span></li>`)}</ul>
    ${card.advisory ? html`<p class="home-card__note">Advice only. Nothing is ordered or changed from here.</p>` : ""}</article>`;
}

function completenessMarkup(card: Completeness): Html {
  return html`<article class="home-card" aria-labelledby="insight-${card.id}">
    <h3 id="insight-${card.id}">${card.title}</h3>
    <p class="home-card__meta">${card.window} · ${card.rule}</p>
    <ul class="home-card__list">${card.rows.map((row) => html`<li>
      <span class="home-card__name">${row.name}</span>
      <span class="home-card__why"><span class="mono">${row.have.toLocaleString()} of ${row.of.toLocaleString()}</span> ${row.gap ? html`· <a class="text-link" href="${row.href}" data-route>${row.gap.toLocaleString()} ${row.gapText}</a>` : "· all done"}</span>
      <progress class="home-meter" value="${row.have}" max="${Math.max(row.of, 1)}" aria-hidden="true"></progress></li>`)}</ul></article>`;
}

function insightsMarkup(data: Insights): Html {
  return html`${data.cards.length ? "" : html`<p class="muted home-quiet">Nothing is repeating enough to show. A pattern appears here once the same thing has happened at least twice in its window.</p>`}
    <div class="home-cards">${data.cards.map(cardMarkup)}${completenessMarkup(data.completeness)}</div>`;
}

export async function homeWorkspace(): Promise<void> {
  const session = await loadSession("home");
  if (!session) return;
  document.title = "Home · Staff workspace";
  const admin = session.role !== "STAFF";
  const actions = ACTIONS.filter((action) => !action.admin || admin);
  shell(session, "home", html`
    <header class="page-header">
      <div class="page-header__title"><h1>Home</h1><p id="home-lede" aria-live="polite">${greeting(session.displayName)}.</p></div>
    </header>
    <button class="home-search" type="button" id="home-search" aria-haspopup="dialog">${icon("search")}<span class="home-search__text">Search items, places and kits</span><kbd aria-hidden="true">${SEARCH_KEYS}</kbd></button>
    <div class="home-grid">
      <div class="home-main">
        <section class="home-section" aria-labelledby="home-attention-title">
          <div class="home-section__head"><h2 id="home-attention-title">Needs attention</h2><a class="text-link" href="/staff/attention" data-route>Open Attention</a></div>
          <div id="home-attention" aria-busy="true"><div class="skeleton skeleton--block"></div></div>
        </section>
        <section class="home-section" id="home-continue" aria-labelledby="home-continue-title" hidden>
          <div class="home-section__head"><h2 id="home-continue-title">Continue</h2></div>
          <div id="home-continue-body"></div>
        </section>
      </div>
      <section class="home-side" aria-labelledby="home-actions-title">
        <div class="home-section__head"><h2 id="home-actions-title">Quick actions</h2></div>
        <ul class="home-list">${actions.map((action) => html`<li><a class="home-row" href="${action.href}" data-route><span class="home-row__icon">${icon(action.icon)}</span><span class="home-row__text"><span class="home-row__title">${action.title}</span><span class="home-row__meta">${action.detail}</span></span>${icon("next")}</a></li>`)}</ul>
      </section>
    </div>
    <section class="home-section home-insights" aria-labelledby="home-insights-title">
      <div class="home-section__head"><h2 id="home-insights-title">Insights</h2><p class="home-section__aside" id="home-insights-asof">Patterns from the Hub's own records, each with its window and its evidence.</p></div>
      <div id="home-insights" aria-busy="true"><div class="skeleton skeleton--block"></div></div>
    </section>`);

  const lede = document.querySelector<HTMLElement>("#home-lede")!;
  const attentionBox = document.querySelector<HTMLElement>("#home-attention")!;
  const continueBox = document.querySelector<HTMLElement>("#home-continue")!;
  document.querySelector("#home-search")!.addEventListener("click", () => document.querySelector<HTMLElement>("[data-palette]")?.click());

  // What needs a person is the staff bar's own answer; this only reads it, and paints again each time the bar does.
  const paintAttention = () => {
    const now = attentionNow();
    if (!now) return;
    const groups = now.groups ?? [];
    attentionBox.removeAttribute("aria-busy");
    mount(attentionBox, attentionMarkup(groups));
    const act = groups.reduce((sum, group) => sum + toAct(group), 0);
    lede.textContent = `${greeting(session.displayName)}. ${act ? `${plural(act, "thing")} to act on today or this week.` : "Nothing needs a person right now."}`;
  };
  document.addEventListener(ATTENTION_PAINTED, paintAttention);
  onLeave(() => document.removeEventListener(ATTENTION_PAINTED, paintAttention));
  paintAttention();
  // Home always asks again: the kept answer may be 30 seconds old, and this page is where it is read.
  void refreshAttention(true).then(() => {
    if (!attentionNow()) { attentionBox.removeAttribute("aria-busy"); mount(attentionBox, emptyState("What needs attention could not be loaded", "The rest of Home still works. Open Attention to try again.", html`<a class="button button--secondary" href="/staff/attention" data-route>Open Attention</a>`, "error", 3)); }
  });

  // Your own unfinished work. The section exists only while there is some.
  live<Resumable>("/api/staff/home", {
    interval: 30_000,
    onData: (work) => {
      const any = Boolean(work.catalogue) || work.checks.length > 0;
      continueBox.hidden = !any;
      if (any) mount(document.querySelector("#home-continue-body")!, continueMarkup(work));
    },
    onError: (error: ApiError) => { if (error.status === 401) expired(); }
  });

  // Insights come last and alone: slow or failing, they leave everything above as it is.
  const box = document.querySelector<HTMLElement>("#home-insights")!;
  const loadInsights = () => {
    box.setAttribute("aria-busy", "true");
    api<Insights>("/api/staff/home/insights", { priority: "low" } as RequestInit).then((data) => {
      box.removeAttribute("aria-busy");
      mount(box, insightsMarkup(data));
    }).catch((error) => {
      box.removeAttribute("aria-busy");
      if (error instanceof ApiError && error.status === 401) return expired();
      mount(box, html`<div class="home-failed" role="status">${icon("alert")}<p>Insights could not be loaded. ${failure(error)}</p><button class="button button--secondary button--sm" type="button" id="home-insights-retry">Try again</button></div>`);
      document.querySelector("#home-insights-retry")?.addEventListener("click", loadInsights);
    });
  };
  loadInsights();
}
