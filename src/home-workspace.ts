import "./home.css";
import { type AttentionGroup, ageOf, loadSession, shell, supplyAttention } from "./staff-shell";
import { ApiError, type Html, api, emptyState, expired, failure, formatDateTime, html, icon, live, mount, navigate, onLeave, plural } from "./ui";

/*
 * Home (/staff/home) and Attention (/staff/attention). Home is four groups (V1.16.4 §4.1): what needs attention, three entries a reason
 * with the way to the rest; what can wait, as its reasons; the person's own next actions; and Insights, closed until asked for.
 * Attention is the full queue (attention-workspace.ts) beside a context column. Both take the bar's numbers from the queue answer they
 * already poll, so neither asks for the summary as well. Nothing here is stored, and nothing here changes a record except the queue's
 * own guarded actions.
 */

type Resumable = {
  catalogue: { id: string; place: string | null; saved: number; startedAt: string; updatedAt: string } | null;
  checks: Array<{ id: string; place: string | null; status: string; expected: number; startedAt: string; updatedAt: string }>;
};
type InsightCard = { id: string; title: string; window: string; rule: string; rows: Array<{ name: string; href: string; evidence: string }>; advisory?: true };
/** The answer still carries the catalog-completeness card for older tabs; this page no longer shows it (V1.16.4 §4.1). */
type Insights = { revision: number; asOf: string; cards: InsightCard[] };
type Urgency = "NOW" | "SOON" | "LATER";
type Entry = { key: string; reason: string; source: string; urgency: Urgency; basis?: string; title: string; why: string; href: string; action: string };
type Answer = { today: string; groups: AttentionGroup[]; entries: Entry[] };

const greeting = (name: string) => {
  const hour = new Date().getHours();
  return `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${name.split(/\s+/)[0] ?? name}`;
};
/** Today as staff read it, in the Hub's own time zone: "Tuesday, 14 October". */
const today = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" });
const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });
const toAct = (group: AttentionGroup) => group.byUrgency.NOW + group.byUrgency.SOON;
/** Entries Home lists per reason; "View all" opens the rest in the queue. */
const PER_REASON = 3;
/** The queue's own address keys. Home used to hold the queue, so an old Home address carrying one opens the queue instead. */
const QUEUE_KEYS = ["entry", "reason", "source", "urgency", "age"];

/** Home's line under the heading: who is here, then the one answer that matters ("17 things to act on.", or that nothing needs a person). */
function ledeMarkup(name: string, act: number | null): Html {
  const summary = act === null ? "" : act ? html`<strong>${plural(act, "thing")}</strong> to act on.` : "Nothing needs a person right now.";
  return html`<span class="ws-head__hello">${greeting(name)}.</span> <span class="ws-head__summary">${summary}</span>`;
}

/* ---------- Needs attention and When there is time ---------- */

const SKELETON = html`<div class="home-skeleton" aria-hidden="true">${[1, 2, 3].map(() => html`<div class="home-skeleton__row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--text"></span></div>`)}</div><span class="visually-hidden">Loading what needs attention</span>`;

/** How soon, in words as well as the pip's colour, as Attention's bands name it. */
const WHEN: Record<string, string> = { NOW: "Now", SOON: "Soon" };

function entryMarkup(entry: Entry): Html {
  return html`<li><a class="home-row home-row--entry" href="${entry.href}" data-route>
    <span class="home-pip home-pip--${entry.urgency.toLowerCase()}" aria-hidden="true"></span>
    <span class="home-row__text"><span class="home-row__title">${entry.title}</span><span class="home-row__meta">${WHEN[entry.urgency] ? html`<span class="home-row__when">${WHEN[entry.urgency]}</span> · ` : ""}${entry.why}</span>${entry.basis ? html`<span class="home-row__basis">${entry.basis}</span>` : ""}</span>
    <span class="home-row__go">${entry.action}${icon("next")}</span></a></li>`;
}

/**
 * What needs a person now or soon: each reason with any, those with something for now first, then the server's order. Each lists its
 * first three entries in the server's order, and "View all" names the reason's true total and opens the queue on that reason.
 */
function needsMarkup(data: Answer): Html {
  const reasons = data.groups.filter((group) => toAct(group) > 0).sort((a, b) => Number(b.byUrgency.NOW > 0) - Number(a.byUrgency.NOW > 0));
  if (!reasons.length) return emptyState("Nothing needs a person right now", "Loans are on time, stock is in hand and no record is waiting. This fills in by itself when something does.", "", "", 3);
  return html`${reasons.map((group) => {
    const id = `home-reason-${group.reason}`;
    const entries = data.entries.filter((entry) => entry.reason === group.reason && entry.urgency !== "LATER").slice(0, PER_REASON);
    return html`<section class="home-reason" aria-labelledby="${id}">
      <div class="home-reason__head"><h3 id="${id}">${group.label}</h3><a class="text-link home-reason__all" href="/staff/attention?reason=${encodeURIComponent(group.reason)}" data-route>View all ${group.total.toLocaleString()}<span class="visually-hidden"> ${group.label.toLowerCase()}</span></a></div>
      <ul class="home-list">${entries.map(entryMarkup)}</ul>
    </section>`;
  })}`;
}

/** What can wait: one heading per reason with its count, each opening the queue on exactly that work. */
function laterMarkup(groups: AttentionGroup[]): Html {
  return html`${groups.filter((group) => group.byUrgency.LATER > 0).map((group) => html`<li><a class="home-later" href="/staff/attention?reason=${encodeURIComponent(group.reason)}&urgency=LATER" data-route>
    <span class="home-later__label">${group.label}</span><span class="home-later__count">${group.byUrgency.LATER.toLocaleString()}</span></a></li>`)}`;
}

/* ---------- Next actions and Insights: Home's last two groups, and Attention's resting column ---------- */

function nextActionsMarkup(work: Resumable): Html {
  return html`<ul class="home-list" aria-labelledby="home-continue-title">${work.checks.map((check) => html`<li><a class="home-row" href="/staff/locations?check=${check.id}" data-route>
      ${icon("pin")}<span class="home-row__text"><span class="home-row__title">Check of ${check.place ?? "a place"}</span><span class="home-row__meta">${check.status === "PAUSED" ? "Paused" : "Open"} · ${plural(check.expected, "item")} expected · last worked on ${ageOf(check.updatedAt)}</span></span>
      <span class="home-row__go">Resume ${icon("next")}</span></a></li>`)}</ul>`;
}

/** Where an insight comes from and what it is for stays one press away, so the group reads as the evidence itself. */
function aboutMarkup(id: string, window: string, rule: string): Html {
  return html`<button class="home-about" type="button" aria-expanded="false" aria-controls="about-${id}">About this insight${icon("sortDown")}</button>
    <div class="home-about__body" id="about-${id}" hidden><p class="home-card__meta">${window} · ${rule}</p></div>`;
}

function cardMarkup(card: InsightCard): Html {
  return html`<article class="home-card" aria-labelledby="insight-${card.id}">
    <h3 id="insight-${card.id}">${card.title}</h3>
    <ul class="home-card__list">${card.rows.map((row) => html`<li><a class="home-card__name" href="${row.href}" data-route>${row.name}</a><span class="home-card__why">${row.evidence}</span></li>`)}</ul>
    ${card.advisory ? html`<p class="home-card__note">Advice only. Nothing is ordered or changed from here.</p>` : ""}
    ${aboutMarkup(card.id, card.window, card.rule)}</article>`;
}

function insightsMarkup(data: Insights): Html {
  return data.cards.length ? html`<div class="home-cards">${data.cards.map(cardMarkup)}</div>`
    : html`<p class="muted home-quiet">Nothing is repeating enough to show. A pattern appears here once the same thing has happened at least twice in its window.</p>`;
}

const NEXT_ACTIONS = html`<section class="home-group" id="home-continue" aria-labelledby="home-continue-title" hidden>
    <div class="home-group__head"><h2 id="home-continue-title">Next actions</h2></div>
    <div id="home-continue-body"></div>
  </section>`;
/** Insights stay closed until asked for: nothing is requested before then (V1.16.4 §4.1). */
const INSIGHTS = html`<section class="home-group home-insights" aria-labelledby="home-insights-title">
    <details class="home-disclosure" id="home-insights-box">
      <summary><span class="home-disclosure__title"><h2 id="home-insights-title">Insights</h2><span class="home-section__aside" id="home-insights-asof">From the Hub's own records</span></span>${icon("sortDown")}</summary>
      <div id="home-insights"></div>
    </details>
  </section>`;

/** The person's own unfinished place checks; the group exists only while there are some. */
function startNextActions(): void {
  const box = document.querySelector<HTMLElement>("#home-continue")!;
  live<Resumable>("/api/staff/home", {
    interval: 30_000,
    onData: (work) => {
      box.hidden = !work.checks.length;
      if (work.checks.length) mount(document.querySelector("#home-continue-body")!, nextActionsMarkup(work));
    },
    onError: (error: ApiError) => { if (error.status === 401) expired(); }
  });
}

/** Insights load when first opened, and alone: slow or failing, they stay inside their group, with Try again. */
function startInsights(path: string): void {
  const details = document.querySelector<HTMLDetailsElement>("#home-insights-box")!;
  const box = document.querySelector<HTMLElement>("#home-insights")!;
  box.addEventListener("click", (event) => {
    const about = (event.target as HTMLElement).closest<HTMLButtonElement>(".home-about");
    if (!about) return;
    const open = about.getAttribute("aria-expanded") !== "true";
    about.setAttribute("aria-expanded", String(open));
    document.getElementById(about.getAttribute("aria-controls")!)!.hidden = !open;
  });
  let active = true;
  onLeave(() => { active = false; });
  // The page is left the moment the address changes, while the next page's code may still be loading: an answer that arrives
  // then, an ended session included, belongs to the page the person left and never sends them anywhere. Like the router,
  // this ignores trailing slashes, so Home opened as /staff/home/ is still here.
  const here = () => active && window.location.pathname.replace(/\/+$/, "") === path;
  let asked = false;
  const load = () => {
    asked = true;
    box.setAttribute("aria-busy", "true");
    mount(box, html`<div class="skeleton skeleton--text"></div><div class="skeleton skeleton--text"></div>`);
    api<Insights>("/api/staff/home/insights", { priority: "low" } as RequestInit).then((data) => {
      if (!here()) return;
      document.querySelector("#home-insights-asof")!.textContent = `Updated ${formatDateTime(data.asOf)}`;
      box.removeAttribute("aria-busy");
      mount(box, insightsMarkup(data));
    }).catch((error) => {
      if (!here()) return;
      box.removeAttribute("aria-busy");
      if (error instanceof ApiError && error.status === 401) return expired();
      mount(box, html`<div class="home-failed" role="status">${icon("alert")}<p>Insights could not be loaded. ${failure(error)}</p><button class="button button--secondary button--sm" type="button" id="home-insights-retry">Try again</button></div>`);
      document.querySelector("#home-insights-retry")?.addEventListener("click", load);
    });
  };
  details.addEventListener("toggle", () => { if (details.open && !asked) load(); });
}

/* ---------- The two pages ---------- */

/** /staff/home: four groups, in this order: Needs attention, When there is time, Next actions, Insights. */
async function homePage(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (QUEUE_KEYS.some((key) => params.has(key))) { navigate(`/staff/attention?${params}`, true); return; }
  const session = await loadSession("home");
  if (!session) return;
  document.title = "Home · Staff workspace";
  shell(session, "home", html`
    <div class="home">
      <header class="ws-head">
        <div class="ws-head__title"><h1>Home</h1><time datetime="${isoDay.format(new Date())}">${today.format(new Date())}</time></div>
        <p id="home-lede" class="ws-head__lede" aria-live="polite">${ledeMarkup(session.displayName, null)}</p>
      </header>
      <section class="home-group" aria-labelledby="home-attn-title">
        <div class="home-group__head"><h2 id="home-attn-title">Needs attention</h2><p class="live-status" id="live-status">Connecting…</p></div>
        <div id="home-attn" aria-busy="true">${SKELETON}</div>
      </section>
      <section class="home-group" id="home-later" aria-labelledby="home-later-title" hidden>
        <div class="home-group__head"><h2 id="home-later-title">When there is time</h2></div>
        <ul class="home-laters" id="home-later-list" aria-labelledby="home-later-title"></ul>
      </section>
      ${NEXT_ACTIONS}
      ${INSIGHTS}
    </div>`);

  const lede = document.querySelector<HTMLElement>("#home-lede")!;
  const dateline = document.querySelector<HTMLTimeElement>(".ws-head__title time")!;
  const needs = document.querySelector<HTMLElement>("#home-attn")!;
  const later = document.querySelector<HTMLElement>("#home-later")!;
  let loaded = false;
  // One poll of the queue, the same one Attention keeps: Home's numbers and the bar's both come from it.
  live<Answer>("/api/staff/attention", {
    interval: 15_000,
    status: () => document.querySelector("#live-status"),
    onData: (data) => {
      loaded = true;
      supplyAttention(data.groups);
      mount(lede, ledeMarkup(session.displayName, data.groups.reduce((sum, group) => sum + toAct(group), 0)));
      // The date moves on with the greeting, so a Home left open overnight does not keep yesterday.
      const day = new Date();
      if (dateline.dateTime !== isoDay.format(day)) { dateline.dateTime = isoDay.format(day); dateline.textContent = today.format(day); }
      needs.removeAttribute("aria-busy");
      mount(needs, needsMarkup(data));
      const laters = laterMarkup(data.groups);
      mount(document.querySelector("#home-later-list")!, laters);
      later.hidden = !document.querySelector("#home-later-list")!.childElementCount;
    },
    onError: (error: ApiError) => {
      if (error.status === 401) expired();
      else if (!loaded) { needs.removeAttribute("aria-busy"); mount(needs, emptyState("What needs attention could not be loaded", `${error.message} Retrying automatically.`, "", "error", 3)); }
    }
  });
  startNextActions();
  startInsights("/staff/home");
}

/** /staff/attention: the queue, opened on everything, beside a column that holds the chosen entry's record or, at rest, Home's last two groups. */
async function attentionPage(): Promise<void> {
  const session = await loadSession("attention");
  if (!session) return;
  document.title = "Attention · Staff workspace";
  const { queueMarkup, startQueue } = await import("./attention-workspace");
  shell(session, "attention", html`
    <div class="ws">
      <header class="ws-head">
        <div class="ws-head__title"><h1>Attention</h1><time datetime="${isoDay.format(new Date())}">${today.format(new Date())}</time></div>
        <p class="ws-head__lede">What needs a person right now. Each entry clears by itself once the cause is fixed.</p>
      </header>
      ${queueMarkup()}
      <aside class="ws-context" aria-label="Context">
        <div class="ws-context__doc" id="attn-doc" hidden></div>
        <div class="ws-context__today" id="ws-today">${NEXT_ACTIONS}${INSIGHTS}</div>
      </aside>
      <dialog class="sheet attn-sheet" id="attn-sheet" aria-labelledby="attn-doc-title"></dialog>
    </div>`);
  startQueue();
  startNextActions();
  startInsights("/staff/attention");
}

/** Both entries come through here; the router lazily loads this module for either. */
export async function workspace(entry: "home" | "attention"): Promise<void> {
  await (entry === "home" ? homePage() : attentionPage());
}

export async function homeWorkspace(): Promise<void> {
  await homePage();
}
