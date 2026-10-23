import "./home.css";
import { queueMarkup, startQueue } from "./attention-workspace";
import { ATTENTION_PAINTED, type AttentionGroup, ageOf, attentionNow, loadSession, refreshAttention, shell } from "./staff-shell";
import { ApiError, type Html, api, expired, failure, formatDateTime, html, icon, live, mount, onLeave, plural } from "./ui";

/*
 * Home (/staff/home) and Attention (/staff/attention) are one workspace (LH-IP02-S01): a heading, the Attention queue, and a
 * context column. Home opens on what to act on today or this week; Attention opens on everything. The context column holds
 * your own unfinished place checks and the practical insights, and gives way to an entry's record document when one is chosen.
 * Insights arrive after the page is drawn, so they can be slow or fail without ever holding up the queue. Nothing here is
 * stored, and nothing here changes a record except the queue's own guarded actions.
 */

type Resumable = {
  catalogue: { id: string; place: string | null; saved: number; startedAt: string; updatedAt: string } | null;
  checks: Array<{ id: string; place: string | null; status: string; expected: number; startedAt: string; updatedAt: string }>;
};
type InsightCard = { id: string; title: string; window: string; rule: string; rows: Array<{ name: string; href: string; evidence: string }>; advisory?: true };
type Completeness = { id: string; title: string; window: string; rule: string; rows: Array<{ name: string; have: number; of: number; gap: number; href: string; gapText: string }> };
type Insights = { revision: number; asOf: string; cards: InsightCard[]; completeness: Completeness };

const greeting = (name: string) => {
  const hour = new Date().getHours();
  return `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${name.split(/\s+/)[0] ?? name}`;
};
/** Today as staff read it, in the Hub's own time zone: "Tuesday, 14 October". */
const today = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" });
const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });
const toAct = (group: AttentionGroup) => group.byUrgency.NOW + group.byUrgency.SOON;

/** Home's line under the heading: who is here, then the one answer that matters ("17 things to act on…", or that nothing needs a person). */
function ledeMarkup(name: string, act: number | null): Html {
  const summary = act === null ? "" : act ? html`<strong>${plural(act, "thing")}</strong> to act on today or this week.` : "Nothing needs a person right now.";
  return html`<span class="ws-head__hello">${greeting(name)}.</span> <span class="ws-head__summary">${summary}</span>`;
}

function continueMarkup(work: Resumable): Html {
  return html`<ul class="home-list" aria-labelledby="home-continue-title">${work.checks.map((check) => html`<li><a class="home-row" href="/staff/catalogue?audit=${check.id}" data-route>
      ${icon("pin")}<span class="home-row__text"><span class="home-row__title">Check of ${check.place ?? "a place"}</span><span class="home-row__meta">${check.status === "PAUSED" ? "Paused" : "Open"} · ${plural(check.expected, "item")} expected · last worked on ${ageOf(check.updatedAt)}</span></span>
      <span class="home-row__go">Resume ${icon("next")}</span></a></li>`)}</ul>`;
}

/** Where an insight comes from and what it is for stays one press away, so the column reads as the evidence itself. */
function aboutMarkup(id: string, window: string, rule: string, note: Html | string = ""): Html {
  return html`<button class="home-about" type="button" aria-expanded="false" aria-controls="about-${id}">About this insight${icon("sortDown")}</button>
    <div class="home-about__body" id="about-${id}" hidden><p class="home-card__meta">${window} · ${rule}</p>${note}</div>`;
}

function cardMarkup(card: InsightCard): Html {
  return html`<article class="home-card" aria-labelledby="insight-${card.id}">
    <h3 id="insight-${card.id}">${card.title}</h3>
    <ul class="home-card__list">${card.rows.map((row) => html`<li><a class="home-card__name" href="${row.href}" data-route>${row.name}</a><span class="home-card__why">${row.evidence}</span></li>`)}</ul>
    ${card.advisory ? html`<p class="home-card__note">Advice only. Nothing is ordered or changed from here.</p>` : ""}
    ${aboutMarkup(card.id, card.window, card.rule)}</article>`;
}

function completenessMarkup(card: Completeness): Html {
  return html`<article class="home-card" aria-labelledby="insight-${card.id}">
    <h3 id="insight-${card.id}">${card.title}</h3>
    <ul class="home-card__list">${card.rows.map((row) => html`<li>
      <span class="home-card__name">${row.name}</span>
      <span class="home-card__why"><span class="mono">${row.have.toLocaleString()} of ${row.of.toLocaleString()}</span> ${row.gap ? html`· <a class="text-link" href="${row.href}" data-route>${row.gap.toLocaleString()} ${row.gapText}</a>` : "· all done"}</span>
      <progress class="home-meter" value="${row.have}" max="${Math.max(row.of, 1)}" aria-hidden="true"></progress></li>`)}</ul>
    ${aboutMarkup(card.id, card.window, card.rule)}</article>`;
}

function insightsMarkup(data: Insights): Html {
  return html`${data.cards.length ? "" : html`<p class="muted home-quiet">Nothing is repeating enough to show. A pattern appears here once the same thing has happened at least twice in its window.</p>`}
    <div class="home-cards">${data.cards.map(cardMarkup)}${completenessMarkup(data.completeness)}</div>`;
}

/** Both entries mount this: the same heading, queue and context column, with only the queue's opening view different. */
export async function workspace(entry: "home" | "attention"): Promise<void> {
  const session = await loadSession(entry);
  if (!session) return;
  const home = entry === "home";
  const path = home ? "/staff/home" : "/staff/attention";
  document.title = `${home ? "Home" : "Attention"} · Staff workspace`;
  shell(session, entry, html`
    <div class="ws">
      <header class="ws-head">
        <div class="ws-head__title"><h1>${home ? "Home" : "Attention"}</h1><time datetime="${isoDay.format(new Date())}">${today.format(new Date())}</time></div>
        ${home ? html`<p id="home-lede" class="ws-head__lede" aria-live="polite">${ledeMarkup(session.displayName, null)}</p>`
          : html`<p class="ws-head__lede">What needs a person right now. Each entry clears by itself once the cause is fixed.</p>`}
      </header>
      ${queueMarkup(home ? "active" : "any")}
      <aside class="ws-context" aria-label="Context">
        <div class="ws-context__doc" id="attn-doc" hidden></div>
        <div class="ws-context__today" id="ws-today">
          <section class="ws-context__part" id="home-continue" aria-labelledby="home-continue-title" hidden>
            <h2 class="ws-label" id="home-continue-title">Continue</h2>
            <div id="home-continue-body"></div>
          </section>
          <section class="ws-context__part home-insights" aria-labelledby="home-insights-title">
            <div class="ws-label-row"><h2 class="ws-label" id="home-insights-title">Insights</h2><p class="home-section__aside" id="home-insights-asof">From the Hub's own records</p></div>
            <div id="home-insights" aria-busy="true"><div class="skeleton skeleton--text"></div><div class="skeleton skeleton--text"></div></div>
          </section>
        </div>
      </aside>
      <dialog class="sheet attn-sheet" id="attn-sheet" aria-labelledby="attn-doc-title"></dialog>
    </div>`);

  startQueue(home ? "active" : "any");

  // Home's line under the heading is the staff bar's own answer; this only reads it, and paints again each time the bar does.
  if (home) {
    const lede = document.querySelector<HTMLElement>("#home-lede")!;
    const dateline = document.querySelector<HTMLTimeElement>(".ws-head__title time")!;
    const paintLede = () => {
      const now = attentionNow();
      if (!now) return;
      mount(lede, ledeMarkup(session.displayName, (now.groups ?? []).reduce((sum, group) => sum + toAct(group), 0)));
      // The date moves on with the greeting, so a Home left open overnight does not keep yesterday.
      const day = new Date();
      if (dateline.dateTime !== isoDay.format(day)) { dateline.dateTime = isoDay.format(day); dateline.textContent = today.format(day); }
    };
    document.addEventListener(ATTENTION_PAINTED, paintLede);
    onLeave(() => document.removeEventListener(ATTENTION_PAINTED, paintLede));
    paintLede();
    void refreshAttention(true);
  }

  // Your own unfinished work. The part exists only while there is some.
  const continueBox = document.querySelector<HTMLElement>("#home-continue")!;
  live<Resumable>("/api/staff/home", {
    interval: 30_000,
    onData: (work) => {
      const any = work.checks.length > 0;
      continueBox.hidden = !any;
      if (any) mount(document.querySelector("#home-continue-body")!, continueMarkup(work));
    },
    onError: (error: ApiError) => { if (error.status === 401) expired(); }
  });

  // Insights come last and alone: slow or failing, they leave the queue as it is.
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
  const loadInsights = () => {
    box.setAttribute("aria-busy", "true");
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
      document.querySelector("#home-insights-retry")?.addEventListener("click", loadInsights);
    });
  };
  loadInsights();
}

/** /staff/home: the workspace opened on what to act on today or this week. */
export async function homeWorkspace(): Promise<void> {
  await workspace("home");
}
