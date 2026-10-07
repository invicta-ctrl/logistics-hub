import "@fontsource/newsreader/latin-400-italic.css";
import "./self-service.css";
import { SELF_SERVICE_LIMITS, SELF_SERVICE_STUDENT_ID, type SelfServiceAction, selfServiceReference } from "./catalog-policy";
import { bindHelp, helpTip } from "./contextual-help";
import { type CatalogItem, type LocalEvent, type Snapshot, estimate, openLoans, pendingByItem, summary } from "./offline-queue";
import * as store from "./offline-store";
import { type Draft, checkDecisions, clearHistory, nextAttemptAt, onSyncMessage, record, refreshCatalog, startTesting, syncNow } from "./offline-sync";
import { type Readiness, applyUpdate, canPromptInstall, hasUpdate, isStandalone, onPwaChange, platform, promptInstall, readiness, requestBackgroundSync, requestPersistence, whenIdle } from "./pwa";
import { ancestry, placesOf, type ReportKind } from "./location-tree";
import { type GroupId, GROUPS, behaviourLine, conciseLocation, frequentItems, groupName, groupOf, grouped, isGroup, matching } from "./self-service-browse";
import { type Step, openWhereIsIt } from "./where-is-it";
import { ApiError, CREST, type Html, MARK, app, categoryName, dataUrl, formatTime, html, icon, keepFailure, mount, navigate, onLeave, ownQuery, reducedMotion, setMessage, sheet, shrinkPhoto, itemVisual, units } from "./ui";

/*
 * Self-Service (/self-service): what a student or staff member sees after scanning the QR code
 * on their own phone. Every action is saved on the phone first (offline-sync.ts) and sent when
 * there is a connection. The flow is Search or browse, the item's page, its form, a check of
 * what is about to be sent, then a receipt. Screens live in the URL (?do=item&item=ITM-0043)
 * so the phone's back button closes a sheet or steps back; the router hands those changes to
 * this module (ownQuery).
 */

type Screen = "home" | "get" | "item" | "take" | "borrow" | "use" | "return" | "activity" | "install";
type Params = { screen: Screen; item: string | null; loan: string | null; group: GroupId | null };

const SCREENS = new Set<Screen>(["home", "get", "item", "take", "borrow", "use", "return", "activity", "install"]);
/** The item decides what a person does with it, never a choice on the phone. These forms open as a sheet over the item's page. */
const FORM_SCREENS = new Set<Screen>(["take", "borrow", "use"]);
const SCREEN_FOR: Record<SelfServiceAction, Screen> = { TAKE: "take", BORROW: "borrow", USE: "use" };
const ACTION_WORD: Record<SelfServiceAction, string> = { TAKE: "Take", BORROW: "Borrow", USE: "Use" };
const FRESH_MS = 2 * 60_000;
const CATALOG_POLL_MS = 30_000;
/** After this many checks in a row that found the catalog unchanged, a phone left open asks a third as often; any change or return to the app restores the pace. */
const QUIET_CHECKS = 6;
/** Home shows a few items per group and a link to the rest, so a catalog of any size draws the same small page. */
const GROUP_PREVIEW = 4;
const SEARCH_RESULTS = 12;

/* ---------- State ---------- */

let snapshot: Snapshot | undefined;
let events: LocalEvent[] = [];
let profile: store.Profile = { name: "", studentId: "" };
let ready: Readiness | null = null;
let syncing = false;
let offline = !navigator.onLine;
/** A form in a sheet has input that closing would lose. */
let dirty = false;
/** The office has closed Self-Service (the Worker says so); undefined until this phone has heard either way. */
let paused: boolean | undefined;
/** Shown inside Administration's test panel (only this site may frame it): records are tests the server holds for staff. */
const testing = window.self !== window.top;

/* Formatting in the office's time zone, whatever the phone's own setting. */
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });
const DAY_TIME = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
const HOUR = new Intl.DateTimeFormat("en-PH", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Manila" });
const WEEKDAY_DAY = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" });

function params(): Params {
  const query = new URLSearchParams(window.location.search);
  const screen = query.get("do") as Screen | null;
  const group = query.get("group");
  return { screen: screen && SCREENS.has(screen) ? screen : "home", item: query.get("item"), loan: query.get("loan"), group: isGroup(group) ? group : null };
}

/** Moves within the app; the depth in history.state lets "Done" return home without leaving the app. */
function go(next: Partial<Params>, replace = false): void {
  const merged = { ...params(), ...next };
  const query = new URLSearchParams();
  if (merged.screen !== "home") query.set("do", merged.screen);
  if (merged.item) query.set("item", merged.item);
  if (merged.loan) query.set("loan", merged.loan);
  if (merged.group) query.set("group", merged.group);
  const depth = ((window.history.state as { ssDepth?: number } | null)?.ssDepth ?? 0) + (replace ? 0 : 1);
  navigate(`/self-service${query.size ? `?${query}` : ""}`, replace, { ssDepth: depth });
}

function goHome(): void {
  const depth = (window.history.state as { ssDepth?: number } | null)?.ssDepth ?? 0;
  if (depth > 0) window.history.go(-depth);
  else go({ screen: "home", item: null, loan: null, group: null }, true);
}

/** An address that opens a sheet: a form for an item, or the return of a loan. */
const opensSheet = (current: Params) => Boolean(current.loan) || (FORM_SCREENS.has(current.screen) && Boolean(current.item));

/** What is drawn under the address. An item's form opens over that item's page, and a bare old shortcut shows the list. */
function viewOf(current: Params): Screen {
  if (FORM_SCREENS.has(current.screen)) return current.item ? "item" : "get";
  return current.screen;
}
const viewKey = (current: Params) => {
  const view = viewOf(current);
  return `${view}:${view === "item" ? current.item : view === "get" ? current.group ?? "" : ""}`;
};

const itemById = (id: string | null) => snapshot?.items.find((item) => item.id === id);
const pendingCount = () => events.filter((event) => event.state === "pending").length;
const fresh = () => Boolean(snapshot && !offline && Date.now() - snapshot.checkedAt < FRESH_MS);

async function load(): Promise<void> {
  [snapshot, events, profile] = await Promise.all([store.catalog(), store.events(), store.getMeta<store.Profile>("profile").then((saved) => saved ?? { name: "", studentId: "" })]);
}

/** A change of screen that morphs the item's picture into the item page where the browser can; otherwise it just changes. */
function withTransition(change: () => void, source: HTMLElement | null): void {
  if (!source || !document.startViewTransition || reducedMotion()) return change();
  source.style.viewTransitionName = "ss-visual";
  const transition = document.startViewTransition(change);
  void transition.finished.finally(() => { source.style.viewTransitionName = ""; });
}

/* ---------- Theme ---------- */

type Theme = "light" | "dark";
const THEME_KEY = "ss-theme";
const THEME_COLOR: Record<Theme, string> = { light: "#faf9f7", dark: "#140609" };

/** Dark unless this phone chose light; the choice stays on the phone only. */
function storedTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"; } catch { return "dark"; }
}

function applyTheme(theme: Theme): void {
  document.body.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  document.querySelector("[data-theme-toggle]")?.setAttribute("aria-pressed", String(theme === "dark"));
}

/** The new theme spreads out from the switch as a circle where the browser can; otherwise it swaps at once. */
function switchTheme(button: HTMLElement): void {
  const next: Theme = document.body.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch { /* the choice lasts this visit only */ }
  if (!document.startViewTransition || reducedMotion()) return applyTheme(next);
  const box = button.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  document.startViewTransition(() => applyTheme(next)).ready.then(() => {
    document.documentElement.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 500, easing: "cubic-bezier(.2, .8, .2, 1)", pseudoElement: "::view-transition-new(root)" });
  }).catch(() => undefined);
}

/* ---------- Frame ---------- */

function frame(): Html {
  return html`<div class="ss-photo" aria-hidden="true"></div>
    <header class="ss-bar">
      <div class="ss-bar__inner">
        <a class="ss-bar__brand" href="/self-service" data-route aria-label="Self-Service home"><span class="ss-bar__marks" aria-hidden="true">${CREST}${MARK}</span><span class="ss-bar__title"><span>Self-Service</span><small>HAU USC Logistics</small></span></a>
        <div class="ss-bar__end">
          <button class="ss-theme" type="button" data-theme-toggle aria-label="Dark theme" aria-pressed="${String(document.body.dataset.theme === "dark")}">${icon("sun")}${icon("moon")}</button>
          <div data-region="pill"></div>
        </div>
      </div>
      <div class="ss-update" data-region="update" hidden></div>
      ${testing ? html`<p class="ss-test">${icon("info")}<span><strong>Test mode.</strong> Records you make are held for staff review and change nothing. Self-Service stays closed to everyone else.</span></p>` : ""}
    </header>
    <main id="main-content" class="ss" data-region="screen"></main>
    <dialog class="sheet ss-sheet" id="ss-sheet" aria-labelledby="sheet-title"></dialog>`;
}

/** Records staff will check, flagged in the bar for a day; after that they are just history in My activity. */
const recentReviews = () => events.filter((event) => event.state === "review" && Date.now() - (event.settledAt ?? 0) < 24 * 60 * 60_000).length;

/** The sync status in the top bar: quiet when all is well, specific when something waits. */
function pill(): Html {
  const counts = summary(events);
  const reviews = recentReviews();
  const [tone, text] = syncing && counts.pending ? ["busy", `Syncing ${counts.pending}…`]
    : reviews ? ["review", `${reviews} ${reviews === 1 ? "needs" : "need"} review`]
    : offline && counts.pending ? ["offline", `Offline · ${counts.pending} waiting`]
    : offline ? ["offline", "Offline"]
    : counts.pending ? ["waiting", `${counts.pending} waiting`]
    : ["ok", events.length ? "Synced" : "Online"];
  return html`<a class="ss-pill ss-pill--${tone}" href="/self-service?do=activity" data-route aria-label="${text}. Open My activity."><span class="ss-pill__dot" aria-hidden="true"></span>${text}</a>`;
}

function region(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-region="${name}"]`);
}

/** Refreshes what the data changed, without disturbing a field the person is typing in. */
function refreshRegions(): void {
  const pillRegion = region("pill");
  if (pillRegion) mount(pillRegion, paused ? html`` : pill());
  const updateRegion = region("update");
  if (updateRegion) {
    updateRegion.hidden = !hasUpdate();
    mount(updateRegion, hasUpdate() ? html`<p>${icon("refresh")}A new version is ready.</p><button type="button" class="button button--primary button--sm" data-apply-update>Update</button>` : html``);
  }
  if (paused) return;
  const view = viewOf(params());
  const tiles = region("tiles");
  if (tiles) mount(tiles, homeTiles());
  const groups = region("groups");
  if (groups) mount(groups, groupsSection());
  const status = region("status");
  if (status) mount(status, html`${readinessCard()}${installCard()}`);
  if (view === "activity") { renderActivity(); return; }
  const rows = region("rows");
  if (rows && view === "get") mount(rows, listRows());
  const itemRegion = region("item");
  if (itemRegion && view === "item") mount(itemRegion, itemPage());
  const loans = region("loans");
  if (loans) mount(loans, loansSection());
}

/* ---------- Items: pictures, availability, where ---------- */

const visual = (item: CatalogItem, className: string, meaningful = false): Html =>
  itemVisual({ ...item, photoId: item.photo }, (id) => `/api/public/media/${id}/thumb`, className, meaningful);

function countBadge(item: CatalogItem, available: number): Html {
  if (available <= 0) return html`<span class="ss-count ss-count--out">None left</span>`;
  const noun = item.action === "BORROW" ? "available" : "left";
  // Low stock says so in words as well as colour.
  return available <= 2 ? html`<span class="ss-count ss-count--low">Only <strong>${available}</strong> ${noun}</span>` : html`<span class="ss-count"><strong>${available}</strong> ${noun}</span>`;
}

/** The two facts a card or row carries besides the name and the count: how it is used, and where to look. */
const cue = (item: CatalogItem, waiting = 0): string =>
  [ACTION_WORD[item.action], conciseLocation(item.location), waiting ? `${waiting} waiting to send` : null].filter(Boolean).join(" · ");

/** A compact card: picture, name, how many, and the cue. Home shows a few per group. */
function card(item: CatalogItem, available: number): Html {
  return html`<li><a class="ss-card ${available <= 0 ? "ss-card--out" : ""}" href="/self-service?do=item&item=${item.id}" data-open-item="${item.id}" data-screen="item">
      ${visual(item, "ss-card__visual")}
      <span class="ss-card__name">${item.name}</span>
      ${countBadge(item, available)}
      <span class="ss-card__cue">${cue(item)}</span></a></li>`;
}

/** One row of a long list: lighter than a card, so hundreds of items stay quick to scan. */
function row(item: CatalogItem, available: number, waiting = 0): Html {
  return html`<li><a class="ss-row ${available <= 0 ? "ss-row--out" : ""}" href="/self-service?do=item&item=${item.id}" data-open-item="${item.id}" data-screen="item">${visual(item, "item-thumb")}
      <span class="ss-row__main"><span class="ss-row__name">${item.name}</span><span class="ss-row__sub">${cue(item, waiting)}</span></span>
      ${countBadge(item, available)}</a></li>`;
}

/** The item page's own availability line: live or estimated, and what this phone has not sent yet. */
function estimateLine(item: CatalogItem): Html {
  if (!snapshot) return html``;
  const count = estimate(snapshot, events).get(item.id) ?? 0;
  const mine = pendingByItem(events).get(item.id) ?? 0;
  const noun = units(count, item.unit);
  const main = count <= 0 ? "The records show none left." : fresh() ? `${count} ${noun} ${item.action === "BORROW" ? "available" : "left"}.` : `About ${count} ${noun} ${item.action === "BORROW" ? "available" : "left"}.`;
  const note = [mine ? `Includes your ${mine} not yet sent.` : "", fresh() ? "" : `Last synced ${formatTime(new Date(snapshot.fetchedAt).toISOString())}; other offline records may not be counted yet.`].filter(Boolean).join(" ");
  return html`<p class="ss-estimate ${count <= 0 ? "ss-estimate--out" : ""}"><span>${main}</span>${note ? html`<small>${note}</small>` : ""}</p>`;
}

/** Where the item is kept, when staff share it, and the way into the full route. Without a shared place the person is pointed to the desk. */
const whereLine = (item: CatalogItem): Html => html`<p class="ss-where">${icon("pin")}<span>${item.location ?? "Ask DOL staff where this is kept."}</span><button type="button" class="text-link" data-where="${item.id}">Where is it?</button></p>`;

/* ---------- Home ---------- */

function greeting(): string {
  const hour = Number(HOUR.format(new Date()));
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = profile.name.split(" ")[0];
  return first ? `${part}, ${first}.` : `${part}.`;
}

function tile(screen: Screen, name: string, detail: string, glyph: Parameters<typeof icon>[0], badge = ""): Html {
  return html`<a class="ss-tile" href="/self-service?do=${screen}" data-go="${screen}">
      <span class="ss-tile__icon" aria-hidden="true">${icon(glyph)}</span>
      <span class="ss-tile__text"><span class="ss-tile__name">${name}</span><span class="ss-tile__detail">${detail}</span></span>
      ${badge ? html`<span class="ss-tile__badge" aria-hidden="true">${badge}</span>` : ""}
    </a>`;
}

function homeTiles(): Html {
  const loans = openLoans(events).length;
  const counts = summary(events);
  const reviews = recentReviews();
  const activityBadge = counts.pending ? `${counts.pending} waiting` : reviews ? `${reviews} with staff` : "";
  return html`${tile("return", "Return", loans ? `${loans} on loan` : "Bring something back", "giveBack", loans ? String(loans) : "")}
    ${tile("activity", "My activity", "Loans and history", "history", activityBadge)}`;
}

/** Frequently used on this phone first, then what is offered, a few from each group; the rest is one tap away. */
function groupsSection(): Html {
  if (!snapshot) return offline ? html`` : skeleton();
  if (!snapshot.items.length) return emptyNote("Nothing is set up for self-service yet. Ask Logistics staff.");
  const available = estimate(snapshot, events);
  const frequent = frequentItems(events, snapshot.items, GROUP_PREVIEW);
  const sections = [
    ...frequent.length ? [{ id: "frequent", name: "Frequently used", items: frequent, more: null as GroupId | null }] : [],
    ...grouped(snapshot.items).map((group) => ({ id: group.id, name: group.name, items: group.items, more: group.items.length > GROUP_PREVIEW ? group.id : null }))
  ];
  return html`${sections.map((section) => html`<section class="ss-group" aria-labelledby="ss-group-${section.id}">
      <div class="ss-group__head"><h2 id="ss-group-${section.id}">${section.name}</h2>${section.more ? html`<a class="ss-group__all" href="/self-service?do=get&group=${section.more}" data-go="get" data-group="${section.more}">See all ${section.items.length}<span class="visually-hidden"> in ${section.name}</span></a>` : ""}</div>
      <ul class="ss-cards">${section.items.slice(0, GROUP_PREVIEW).map((item) => card(item, available.get(item.id) ?? 0))}</ul>
    </section>`)}`;
}

function renderHome(): void {
  const screen = region("screen");
  if (!screen) return;
  mount(screen, html`<div class="ss-home">
      <section class="ss-hero" aria-labelledby="ss-question">
        <h1 id="ss-question">What do you need?</h1>
        <p class="ss-hero__hello">${greeting()}</p>
        <form class="ss-find" role="search" data-find>
          <label class="visually-hidden" for="ss-find">Search everything</label>
          <div class="search-field">${icon("search")}<input id="ss-find" type="search" name="q" placeholder="Search for an item" autocomplete="off" enterkeyhint="search" /></div>
        </form>
      </section>
      <ul class="ss-results" data-region="results" hidden></ul>
      <div class="ss-home__body" data-region="body">
        <nav class="ss-tiles" aria-label="Return and activity" data-region="tiles">${homeTiles()}</nav>
        <div class="ss-groups" data-region="groups">${groupsSection()}</div>
        <div class="ss-status" data-region="status">${readinessCard()}${installCard()}</div>
      </div>
    </div>`);
}

/**
 * Whether this phone can keep working without internet, in plain words. On an iPhone, a Safari
 * tab keeps its own storage apart from the Home Screen app, so offline use starts after installing.
 */
function readinessCard(): Html {
  const updated = snapshot ? html` · Catalog updated ${formatTime(new Date(snapshot.fetchedAt).toISOString())}` : "";
  if (!snapshot && offline) return html`<section class="ss-ready ss-ready--bad">${icon("cloudOff")}<div><h2>Offline setup incomplete</h2><p>Connect to the internet once to download the catalog. After that, this works without a connection.</p></div></section>`;
  // On iPhone and iPad a Safari tab keeps its own storage, so offline use starts in the installed app (see installCard).
  if (platform() === "ios" && !isStandalone()) return html``;
  if (ready && ready.shell && ready.catalog && ready.storage) {
    return html`<section class="ss-ready ss-ready--ok">${icon("check")}<div><h2>Ready for offline use</h2><p>Works without internet. Records send when you are back online${updated}.</p></div></section>`;
  }
  if (ready && !ready.storage) return html`<section class="ss-ready ss-ready--bad">${icon("alert")}<div><h2>Offline setup incomplete</h2><p>This browser is not letting the app save data (private browsing?). Open it in a normal window to use it offline.</p></div></section>`;
  return html`<section class="ss-ready ss-ready--todo" aria-live="polite">${icon("refresh")}<div><h2>Getting ready for offline use…</h2><p>Keep this page open for a moment while it saves the app and catalog${updated}.</p></div></section>`;
}

function installCard(): Html {
  if (isStandalone()) return html``;
  const ios = platform() === "ios";
  const action = canPromptInstall()
    ? html`<button type="button" class="button button--primary" data-install>${icon("install")}Install</button>`
    : html`<a class="button button--secondary" href="/self-service?do=install" data-go="install">How to install</a>`;
  return html`<section class="ss-install" aria-labelledby="ss-install-title">
      <img src="/icons/icon-192.png" alt="" width="56" height="56" />
      <div><h2 id="ss-install-title">Install Logistics Hub</h2><p>${ios ? "Add it to your Home Screen once while you're online. Offline recording works from the Home Screen app." : platform() === "android" ? "Install it from Chrome once while you're online. It then opens like an app and keeps recording when the office internet is down." : "Use Self-Service faster and keep recording when the office internet is down."}</p></div>
      ${action}
    </section>`;
}

/** Search results replace the groups while something is typed; the first few, then a note to narrow it. */
function renderResults(query: string): void {
  const results = region("results");
  const body = region("body");
  if (!results || !snapshot) return;
  const typed = query.trim();
  const found = typed ? matching(snapshot.items, typed) : [];
  if (body) body.hidden = Boolean(typed);
  results.hidden = !typed;
  const available = estimate(snapshot, events);
  mount(results, found.length
    ? html`${found.slice(0, SEARCH_RESULTS).map((item) => row(item, available.get(item.id) ?? 0))}${found.length > SEARCH_RESULTS ? html`<li class="ss-results__none">${found.length - SEARCH_RESULTS} more. Type a little more to narrow it down.</li>` : ""}`
    : html`<li class="ss-results__none">Nothing matches “${typed}”.</li>`);
}

/* ---------- Browse: all items, or one group ---------- */

let listQuery = "";

const emptyNote = (text: string) => html`<p class="ss-empty">${text}</p>`;
const skeleton = () => html`<ul class="ss-list" aria-hidden="true">${Array.from({ length: 6 }, () => html`<li class="ss-row ss-row--skeleton"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></li>`)}</ul>`;

function back(title: string): Html {
  return html`<div class="ss-head"><button type="button" class="ss-back" data-back aria-label="Back">${icon("back")}</button><h1 tabindex="-1">${title}</h1></div>`;
}

/** One list of everything offered, or one group of it, by category. The search box never sits inside a region that refreshes, so a sync never interrupts typing. */
function renderBrowse(): void {
  const main = region("screen");
  if (!main) return;
  listQuery = "";
  const { group } = params();
  const filters = [{ id: null, name: "All" }, ...GROUPS];
  mount(main, html`<div class="ss-screen">
      ${back(group ? groupName(group) : "All items")}
      <nav class="ss-chips" aria-label="Groups">${filters.map((filter) => html`<a class="ss-chip" href="/self-service?do=get${filter.id ? `&group=${filter.id}` : ""}" data-go="get" data-group="${filter.id ?? ""}" ${filter.id === group ? html`aria-current="page"` : ""}>${filter.name}</a>`)}</nav>
      <div class="search-field ss-search">${icon("search")}<input type="search" data-search placeholder="Search items" aria-label="Search" autocomplete="off" enterkeyhint="search" /></div>
      <div data-region="rows">${listRows()}</div>
    </div>`);
}

function listRows(): Html {
  if (!snapshot) return offline ? emptyNote("The catalog hasn't been downloaded to this phone yet. Connect to the internet once, then try again.") : skeleton();
  const { group } = params();
  const available = estimate(snapshot, events);
  const waiting = pendingByItem(events);
  const offered = group ? snapshot.items.filter((item) => groupOf(item) === group) : snapshot.items;
  if (!offered.length) return emptyNote(group ? "Nothing is offered in this group right now." : "Nothing is set up for self-service yet. Ask Logistics staff.");
  const found = matching(offered, listQuery);
  if (!found.length) return emptyNote(`Nothing matches “${listQuery}”.`);
  const byCategory = new Map<string, CatalogItem[]>();
  for (const item of found) byCategory.set(item.category, [...byCategory.get(item.category) ?? [], item]);
  // Every item has the same reserved icon/photo frame, keeping names aligned.
  return html`${[...byCategory].map(([category, items]) => html`<h2 class="ss-section">${categoryName(category)}</h2><ul class="ss-list ss-list--photos">${items.map((item) => row(item, available.get(item.id) ?? 0, waiting.get(item.id)))}</ul>`)}
    ${stamp()}`;
}

/** When the numbers were last confirmed, and that other phones may not be counted yet. */
function stamp(): Html {
  if (!snapshot) return html``;
  if (fresh()) return html`<p class="ss-stamp">Live counts · updated ${formatTime(new Date(snapshot.checkedAt).toISOString())}</p>`;
  return html`<p class="ss-stamp">${icon("cloudOff")}Estimated counts as of ${formatTime(new Date(snapshot.fetchedAt).toISOString())}. Other phones' offline records may not be included yet.</p>`;
}

/* ---------- The item's page ---------- */

/** Picture, how many, how it works in a sentence, where it is, and the one thing to do with it. */
function itemPage(): Html {
  const item = itemById(params().item);
  if (!item) {
    return html`${back("Item")}${snapshot ? html`<p class="ss-empty">This item isn't offered in Self-Service right now.</p><a class="button button--secondary button--block" href="/self-service?do=get" data-go="get">Browse all items</a>` : offline ? emptyNote("The catalog hasn't been downloaded to this phone yet. Connect to the internet once, then try again.") : skeleton()}`;
  }
  return html`${back(item.name)}
    ${visual(item, "ss-item__visual", true)}
    <p class="ss-item__type">${categoryName(item.category)} · ${ACTION_WORD[item.action]}</p>
    ${estimateLine(item)}
    <p class="ss-item__how">${behaviourLine(item.action, item.audience)}</p>
    ${whereLine(item)}
    <a class="button button--primary button--lg button--block ss-item__action" href="/self-service?do=${SCREEN_FOR[item.action]}&item=${item.id}" data-open-item="${item.id}" data-screen="${SCREEN_FOR[item.action]}">${ACTION_WORD[item.action]}</a>`;
}

function renderItem(): void {
  const main = region("screen");
  if (main) mount(main, html`<div class="ss-screen ss-item" data-region="item">${itemPage()}</div>`);
}

/* ---------- Return: what is on loan from this phone ---------- */

const SCREEN_COPY = { return: { title: "Return", lead: "Return what you borrowed on this phone. A photo of the item is needed." } } as const;

function renderReturn(): void {
  const main = region("screen");
  if (!main) return;
  mount(main, html`<div class="ss-screen">
      ${back(SCREEN_COPY.return.title)}
      <p class="ss-lead">${SCREEN_COPY.return.lead}</p>
      <div class="ss-screen" data-region="loans">${loansSection()}</div>
    </div>`);
}

/** "Today", "Tomorrow" or the day, for a return-by date (YYYY-MM-DD in the office's time zone). */
function dayLabel(day: string): string {
  const today = DAY.format(new Date());
  if (day === today) return "Today";
  if (day === DAY.format(new Date(Date.now() + 86_400_000))) return "Tomorrow";
  return WEEKDAY_DAY.format(new Date(`${day}T12:00:00+08:00`));
}
const overdue = (loan: LocalEvent) => Boolean(loan.returnBy && loan.returnBy < DAY.format(new Date()));

/** Borrows made on this phone, one tap each to return (the return is then linked to the exact loan). */
function loanCards(loans: LocalEvent[]): Html {
  return html`<ul class="ss-loans">${loans.map((loan) => html`<li class="ss-loan">
      <div class="ss-loan__main">
        <p class="ss-loan__name">${loan.itemName}${loan.quantity > 1 ? ` ×${loan.quantity}` : ""}</p>
        <p class="ss-loan__meta">Borrowed ${when(loan.occurredAt)}${loan.returnBy ? html` · Return by ${dayLabel(loan.returnBy)}` : ""}${loan.state === "pending" ? " · waiting to send" : ""}</p>
        ${overdue(loan) ? html`<p class="ss-loan__late">${icon("clock")}Past its return date</p>` : ""}
      </div>
      <a class="button button--secondary" href="/self-service?do=return&loan=${loan.id}" data-open-loan="${loan.id}">Return<span class="visually-hidden"> ${loan.itemName}</span></a>
    </li>`)}</ul>`;
}

function loansSection(): Html {
  const loans = openLoans(events);
  return loans.length ? html`<h2 class="ss-section">On loan from this phone</h2>${loanCards(loans)}`
    : emptyNote("You haven't borrowed anything on this phone. Something borrowed at the Logistics desk is returned at the desk.");
}

function when(iso: string): string {
  const date = new Date(iso);
  return DAY.format(date) === DAY.format(new Date()) ? formatTime(iso) : DAY_TIME.format(date);
}

/**
 * "I can’t find it" / "Location looks wrong": one small request, online only (a report is useless once the person has left).
 * It tells staff and changes nothing else. The same id on a retry is recorded once.
 */
async function sendReport(itemId: string, kind: ReportKind, name: string, id: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch("/api/self-service/location-report", { method: "POST", headers: { "content-type": "application/json", ...testing ? { "x-self-service-test": "1" } : {} }, body: JSON.stringify({ id, itemId, kind, name }), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ApiError(0, "The report could not be sent. Check your connection and try again.");
  }
  const body = await response.json().catch(() => ({})) as { error?: string; recorded?: boolean; test?: boolean };
  if (!response.ok) throw new ApiError(response.status, body.error ?? "The report could not be sent. Please try again.");
  // The next form on this phone starts with the same name.
  if (profile.name !== name) { profile = { ...profile, name }; void store.setMeta("profile", profile); }
  return body.recorded === true || body.test === true;
}

/* ---------- Sheets: Take, Borrow, Use, Return ---------- */

function quantityField(max: number): Html {
  return html`<div class="field"><label for="ss-qty">How many?</label>
      <div class="stepper ss-stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="One less">${icon("minus")}</button><input id="ss-qty" name="quantity" type="number" inputmode="numeric" min="1" max="${max}" step="1" value="1" aria-describedby="ss-over" /><button type="button" class="stepper__button" data-step="1" aria-label="One more">${icon("plus")}</button></div>
      <p class="field__hint field__hint--warn" id="ss-over" aria-live="polite" data-over hidden></p></div>`;
}

const nameField = (label: string) => html`<div class="field"><label for="ss-name">${label}</label><input id="ss-name" name="name" autocomplete="name" autocapitalize="words" maxlength="120" required value="${profile.name}" enterkeyhint="done" /></div>`;
const STUDENT_ID_HELP = "Logistics keeps a record of who has each item. Only Logistics staff see it.";
const studentIdField = () => html`<div class="field" data-student-id><div class="ss-label-row"><label for="ss-student">Student ID number</label>${helpTip("the student ID", STUDENT_ID_HELP)}</div><input id="ss-student" name="studentId" type="text" inputmode="numeric" pattern="[0-9]{8}" minlength="8" maxlength="8" autocomplete="off" spellcheck="false" required aria-describedby="ss-student-hint" value="${rememberedId() ? profile.studentId : ""}" /><p class="field__hint" id="ss-student-hint">8 digits</p></div>`;
/** Whether the remembered student ID still meets the rule: an older phone may remember one that does not. */
const rememberedId = () => SELF_SERVICE_STUDENT_ID.test(profile.studentId);

/**
 * Who this is for. A phone that knows the person shows them with "Not you? Change"; otherwise the fields, and a choice to remember them.
 * The details live in this phone's own storage only; nothing here is shared or looked up.
 */
function identityBlock(nameLabel: string): Html {
  const known = Boolean(profile.name) && rememberedId();
  return html`<div class="ss-identity" data-identity>
      ${known ? html`<div class="ss-who" data-who>
          <span class="ss-who__icon" aria-hidden="true">${icon("user")}</span>
          <p class="ss-who__text"><strong>${profile.name}</strong><span>ID ${profile.studentId}</span></p>
          <button type="button" class="text-link ss-who__change" data-change-identity>Not you? Change</button>
        </div>` : ""}
      <div class="ss-identity__fields" data-identity-fields ${known ? "hidden" : ""}>
        ${nameField(nameLabel)}
        ${studentIdField()}
        <div class="ss-remember"><label><input type="checkbox" name="remember" checked /><span>Remember me on this phone</span></label>${helpTip("remembering you", "Your name and student ID stay on this phone only, so you do not type them again. Forget them any time in My activity.")}</div>
      </div>
    </div>`;
}

function sheetFrame(kicker: string, title: string, body: Html): Html {
  return html`<header class="sheet__header"><div><p class="sheet__kicker">${kicker}</p><h2 id="sheet-title">${title}</h2></div><button class="icon-button" type="button" aria-label="Close" data-close>${icon("close")}</button></header>
    <div class="sheet__body">${body}</div>`;
}

const submitButton = (text: string) => html`<button class="button button--primary button--lg button--block" type="submit" data-submit>${text}</button>`;

const photoPick = (text: string) => html`<button type="button" class="photo-field__pick" data-pick aria-describedby="ss-photo-label ss-photo-hint">${icon("camera")}<span>${text}</span></button>`;

/** The photo proof every Self-Service record carries. Only Logistics staff see it. */
const photoField = (tip: string, hint: string, capture: "user" | "environment", pick: string) => html`<div class="field">
        <div class="ss-label-row"><span class="field-label" id="ss-photo-label">Photo proof</span>${helpTip("the photo", tip)}</div>
        <input id="ss-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="${capture}" hidden />
        <div class="photo-field" data-photo>${photoPick(pick)}</div>
        <p class="field__hint" id="ss-photo-hint">${hint}</p>
      </div>`;
const HOLD_TIP = "Only Logistics staff can see it. It shows what left and who has it. It is deleted from this phone once it is sent, and Logistics keeps it for about a year after the record is settled.";
const holdingPhoto = () => photoField(HOLD_TIP, "Hold the item so your face and the item are both in view.", "user", "Take a photo holding it");

function takeSheet(item: CatalogItem): Html {
  return sheetFrame(`Take · ${categoryName(item.category)}`, item.name, html`
    <form class="form ss-form" data-form="TAKE" novalidate>
      ${quantityField(SELF_SERVICE_LIMITS.quantity)}
      ${identityBlock("Your full name")}
      ${holdingPhoto()}
      <div class="form-alert" role="alert" hidden data-alert></div>
      ${submitButton("Review and take")}
    </form>`);
}

/** An open-unit item: the person says who used it and shows the item. No amount, and stock does not change. */
function useSheet(item: CatalogItem): Html {
  return sheetFrame(`Use · ${categoryName(item.category)}`, item.name, html`
    <form class="form ss-form" data-form="USE" novalidate>
      ${identityBlock("Your full name")}
      ${holdingPhoto()}
      <div class="form-alert" role="alert" hidden data-alert></div>
      ${submitButton("Review and use")}
    </form>`);
}


function borrowSheet(item: CatalogItem): Html {
  const uscOnly = item.audience === "USC_STAFF_ONLY";
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const day = (date: Date) => DAY.format(date);
  return sheetFrame(`Borrow · ${categoryName(item.category)}`, item.name, html`
    <form class="form ss-form" data-form="BORROW" novalidate>
      ${uscOnly ? html`<input type="hidden" name="purpose" value="USC" /><p class="callout">${icon("info")}<span>Lent for USC use only. Say what it's for.</span></p>`
        : html`<fieldset class="ss-question"><legend class="ss-legend">What is it for?</legend><div class="segmented segmented--2">
          <label><input type="radio" name="purpose" value="INDIVIDUAL" checked /><span>Individual use</span></label><label><input type="radio" name="purpose" value="USC" /><span>USC use</span></label></div></fieldset>`}
      ${identityBlock(uscOnly ? "Full name of the person using it" : "Your full name")}
      <div class="field" data-reason ${uscOnly ? "" : "hidden"}><label for="ss-reason">Specific reason</label><textarea id="ss-reason" name="reason" rows="2" maxlength="300" placeholder="e.g. stage setup for the general assembly"></textarea></div>
      ${quantityField(SELF_SERVICE_LIMITS.quantity)}
      <fieldset class="ss-choices"><legend>Return by <span class="field__optional">optional</span></legend>
        <label><input type="radio" name="returnBy" value="${day(today)}" /><span>Today</span></label>
        <label><input type="radio" name="returnBy" value="${day(tomorrow)}" /><span>Tomorrow</span></label>
        <label><input type="radio" name="returnBy" value="" checked /><span>No date</span></label>
      </fieldset>
      ${holdingPhoto()}
      <div class="form-alert" role="alert" hidden data-alert></div>
      ${submitButton("Review and borrow")}
    </form>`);
}

/** Only a borrow made on this phone can be returned, so the loan is always known. */
/** A return carries the identity its borrow was made with. A borrow an older phone saved without a valid ID has to say who is returning. */
const loanKnown = (loan: LocalEvent) => Boolean(loan.person.name) && SELF_SERVICE_STUDENT_ID.test(loan.person.studentId ?? "");

function returnSheet(loan: LocalEvent): Html {
  return sheetFrame(`Borrowed ${when(loan.occurredAt)}`, `Return ${loan.itemName}${loan.quantity > 1 ? ` ×${loan.quantity}` : ""}`, html`
    <form class="form ss-form" data-form="RETURN" novalidate>
      <fieldset class="ss-question"><legend class="ss-legend">How is it?</legend><div class="segmented ss-condition">
        <label><input type="radio" name="outcome" value="RETURNED" checked /><span>Good</span></label><label><input type="radio" name="outcome" value="DAMAGED" /><span>Damaged</span></label><label><input type="radio" name="outcome" value="LOST" /><span>Lost</span></label>
      </div></fieldset>
      <div class="field" data-note hidden><label for="ss-note" data-note-label>What's damaged?</label><textarea id="ss-note" name="note" rows="2" maxlength="300"></textarea></div>
      ${loanKnown(loan) ? "" : identityBlock("Your full name")}
      ${photoField("Logistics staff check it before the stock is updated. Only staff can see it, and it is deleted from this phone once it is sent.", "Show the item as you hand it back.", "environment", "Take a photo of the item")}
      <div class="form-alert" role="alert" hidden data-alert></div>
      ${submitButton("Review and return")}
    </form>`);
}

const VERB: Record<string, string> = { TAKE: "Taken", BORROW: "Borrowed", USE: "Use recorded", RETURNED: "Return sent", DAMAGED: "Damaged return sent", LOST: "Reported lost" };
const verb = (event: LocalEvent) => VERB[event.type === "RETURN" ? event.outcome ?? "RETURNED" : event.type];
const OUTCOME_WORD = { RETURNED: "Good", DAMAGED: "Damaged", LOST: "Lost" } as const;

/** What is about to be sent, in the person's own terms: the last look before the record is saved. */
function summaryRows(draft: Draft, photoUrl: string | null, loan: LocalEvent | undefined): Html {
  const what = `${draft.type === "USE" ? "" : `${draft.quantity} × `}${draft.itemName}`;
  const rows: Array<[string, Html | string]> = [["Item", what], ["Name", draft.person.name], ["Student ID number", draft.person.studentId ?? ""]];
  if (draft.type === "TAKE") rows.push(["After this", "Nothing to return."]);
  else if (draft.type === "USE") rows.push(["After this", "Nothing is counted or returned."]);
  else if (draft.type === "BORROW") {
    rows.push(["For", draft.purpose === "USC" ? `USC use: ${draft.reason}` : "Individual use"],
      ["Return by", draft.returnBy ? dayLabel(draft.returnBy) : "No date set. Return it from Return on this phone."]);
  } else {
    rows.push(["Borrowed", loan ? when(loan.occurredAt) : ""], ["Condition", draft.outcome === "RETURNED" ? "Good" : `${OUTCOME_WORD[draft.outcome!]}: ${draft.note}`]);
  }
  return html`<dl class="ss-summary">${rows.filter(([, value]) => value !== "").map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}
      ${photoUrl ? html`<div class="ss-summary__photo"><dt>Photo proof</dt><dd><img src="${photoUrl}" alt="The photo you are sending" /></dd></div>` : ""}</dl>`;
}

/** Shown in the sheet after saving: calm, specific, and it updates itself when the record syncs. */
function receipt(event: LocalEvent): Html {
  return html`<div class="ss-receipt" role="status">
      <svg class="ss-receipt__mark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="m15 27 7 7 15-16" /></svg>
      <h2 id="sheet-title">${verb(event)}</h2>
      <p class="ss-receipt__what">${event.type === "USE" ? "" : event.quantity > 1 ? `${event.quantity} × ` : ""}${event.itemName}</p>
      <p class="ss-receipt__who">${event.person.name}${event.person.studentId ? ` · ID ${event.person.studentId}` : ""} · ${when(event.occurredAt)}</p>
      <p class="ss-receipt__ref"><span>Reference</span><strong>${selfServiceReference(event.id)}</strong></p>
      <p class="ss-receipt__sync" data-receipt="${event.id}">${receiptState(event)}</p>
      ${event.type === "BORROW" ? html`<p class="ss-receipt__tip">${event.returnBy ? html`Return it by <strong>${dayLabel(event.returnBy)}</strong> from` : "Return it from"} <strong>Return</strong> on this phone, so it links to this loan.</p>` : ""}
      <div class="ss-receipt__actions">
        <button type="button" class="button button--primary button--lg button--block" data-done>Done</button>
        ${event.type !== "RETURN" ? html`<button type="button" class="button button--ghost button--block" data-again>${ACTION_WORD[event.type]} something else</button>` : ""}
      </div>
    </div>`;
}

function receiptState(event: LocalEvent): Html {
  if (event.state === "synced") return html`<span class="ss-state ss-state--ok">${icon("check")}Sent to Logistics</span>`;
  if (event.state === "review") return html`<span class="ss-state ss-state--review">${icon("info")}${event.message ?? "Staff will check it."}</span>`;
  if (event.state === "rejected") return html`<span class="ss-state ss-state--bad">${icon("alert")}Not recorded: ${event.message ?? "please ask Logistics staff."}</span>`;
  return offline
    ? html`<span class="ss-state ss-state--wait">${icon("cloudOff")}Saved on this phone. It will send when you're back online.</span>`
    : html`<span class="ss-state ss-state--wait"><span class="ss-spinner" aria-hidden="true"></span>Saved on this phone · sending…</span>`;
}

/* ---------- My activity ---------- */

const STATE: Partial<Record<LocalEvent["state"], [string, string]>> = { pending: ["pending", "Waiting to send"], review: ["gold", "Staff will check"], rejected: ["bad", "Not recorded"] };

/** One record: what, when, its reference, and a state only when it is not simply sent. */
function eventRow(event: LocalEvent): Html {
  const state = STATE[event.state];
  return html`<li class="ss-event"><div><p class="ss-event__what">${event.itemName}${event.quantity > 1 && event.type !== "USE" ? html` <span class="muted">×${event.quantity}</span>` : ""}</p>
      <p class="ss-event__when">${verb(event)} ${when(event.occurredAt)} · <span class="ss-ref">${selfServiceReference(event.id)}</span></p>
      ${event.message ? html`<p class="ss-event__note">${event.message}</p>` : ""}</div>
    ${state ? html`<span class="tag tag--${state[0]}">${state[1]}</span>` : ""}</li>`;
}

/** Currently borrowed, then anything waiting to send, then what was recorded lately. Sync detail appears only when something waits. */
function renderActivity(): void {
  const main = region("screen");
  if (!main) return;
  const counts = summary(events);
  const loans = openLoans(events);
  const waiting = events.filter((event) => event.state === "pending").sort((a, b) => b.seq - a.seq);
  const recent = events.filter((event) => event.state !== "pending").sort((a, b) => b.seq - a.seq);
  // This screen redraws as records sync; a keyboard user keeps their place on its buttons.
  const focusKey = ["[data-sync]", "[data-clear]", "[data-forget]"].find((selector) => document.activeElement?.matches(selector));
  const open = main.querySelector<HTMLDetailsElement>("details.ss-more")?.open ?? false;
  mount(main, html`<div class="ss-screen">
      ${back("My activity")}
      ${loans.length ? html`<h2 class="ss-section">On loan now</h2>${loanCards(loans)}` : ""}
      ${waiting.length ? html`<section class="ss-waiting" aria-labelledby="ss-waiting-title">
          <div class="ss-waiting__head"><h2 id="ss-waiting-title">${syncing ? `Sending ${counts.pending}…` : `${counts.pending} waiting to send${offline ? " · you're offline" : ""}`}</h2>
            <button type="button" class="button button--secondary button--sm" data-sync ${syncing ? "disabled" : ""}>${icon("refresh")}Send now</button></div>
          <p>Saved on this phone, photos included. They send by themselves when there is a connection. Don't clear this site's data or delete the app until they have.</p>
          <ul class="ss-timeline">${waiting.map(eventRow)}</ul></section>` : ""}
      <h2 class="ss-section">Recent</h2>
      ${recent.length ? html`<ul class="ss-timeline">${recent.map(eventRow)}</ul>` : emptyNote(loans.length || waiting.length ? "Nothing sent yet." : "Nothing yet. What you take, borrow, use and return with this phone shows up here.")}
      <details class="ss-more" ${open ? "open" : ""}><summary>This phone</summary>
        <p class="ss-fine">${profile.name ? html`Remembered here: <strong>${profile.name}</strong>${profile.studentId ? ` · ID ${profile.studentId}` : ""}. ` : "Nobody is remembered on this phone. "}Records stay on this phone for 30 days after they send, then clear themselves. Photos are deleted from the phone as soon as Logistics receives them.</p>
        <div class="ss-housekeeping">
          ${profile.name ? html`<button type="button" class="button button--secondary button--sm" data-forget>Forget me on this phone</button>` : ""}
          <button type="button" class="button button--ghost button--sm" data-clear ${events.some((event) => event.state !== "pending") ? "" : "disabled"}>Clear history</button>
          ${waiting.length ? "" : html`<button type="button" class="button button--ghost button--sm" data-sync ${syncing ? "disabled" : ""}>${icon("refresh")}Check for updates</button>`}
        </div>
      </details>
    </div>`);
  if (focusKey) main.querySelector<HTMLElement>(focusKey)?.focus({ preventScroll: true });
}

/* ---------- Install ---------- */

function renderInstall(): void {
  const main = region("screen");
  if (!main) return;
  const kind = platform();
  const steps = kind === "ios"
    ? [html`Open this page in <strong>Safari</strong>.`, html`Tap ${icon("share")}<strong>Share</strong>. On newer iPhones it's in the ${icon("more")} menu next to the address bar; tap <strong>View More</strong> if you don't see the next step.`, html`Tap <strong>Add to Home Screen</strong>, keep <strong>Open as Web App</strong> on, then tap <strong>Add</strong>.`, html`Open <strong>Logistics</strong> from your Home Screen once while online. It's ready when it says <strong>Ready for offline use</strong>.`]
    : kind === "android"
      ? [html`Open this page in <strong>Chrome</strong>. If the QR code opened it inside another app (Messenger, Facebook or a scanner), tap ${icon("more")} then <strong>Open in Chrome</strong>.`, html`Tap <strong>Install now</strong> above, then <strong>Install</strong>. No button? Tap the Chrome ${icon("more")} menu, then <strong>Install app</strong> (or <strong>Add to Home screen</strong>, then <strong>Install</strong>; don't choose Create shortcut).`, html`<strong>Samsung Internet:</strong> tap the install icon in the address bar, or the menu, then <strong>Add page to</strong> and <strong>Home screen</strong>.`, html`Open <strong>Logistics</strong> from your home screen or app drawer while online. Allow the <strong>camera</strong> when asked: borrows and returns need a photo.`, html`Wait for <strong>Ready for offline use</strong> before you rely on it offline.`]
      : [html`Open this page in <strong>Chrome</strong> or <strong>Edge</strong>.`, html`Use the install icon in the address bar, or the ${icon("more")} menu, then <strong>Install</strong>.`, html`Open <strong>Logistics</strong> and wait for <strong>Ready for offline use</strong>.`];
  mount(main, html`<div class="ss-screen">
      ${back("Install Logistics Hub")}
      <p class="ss-lead">Install it once while you have internet. After that it opens like an app and keeps recording when the office internet is down.</p>
      ${canPromptInstall() ? html`<button type="button" class="button button--primary button--lg button--block" data-install>${icon("install")}Install now</button>` : ""}
      <ol class="ss-steps">${steps.map((step) => html`<li>${step}</li>`)}</ol>
      <p class="ss-fine">Records made offline wait on your phone and send by themselves when you're back online. Don't clear this site's data or delete the app while any are waiting.</p>
    </div>`);
}

/* ---------- Closed ---------- */

/** Every address shows this while Self-Service is closed; anything waiting stays on the phone until it reopens. */
function renderPaused(): void {
  const screen = region("screen");
  if (!screen) return;
  const waiting = pendingCount();
  mount(screen, html`<div class="ss-home">
      <section class="ss-hero" aria-labelledby="ss-paused">
        <h1 id="ss-paused">Self-Service is under maintenance</h1>
        <p class="ss-hero__hello">You can't borrow, take or return items with your phone for now.</p>
      </section>
      <section class="ss-ready ss-ready--todo">${icon("pin")}<div><h2>Ask DOL staff in person</h2><p>Any logistics request must be made in person. Go to the Department of Logistics and ask DOL staff for permission. They will record it for you.</p></div></section>
      ${waiting ? html`<p class="ss-warning">${icon("clock")}<span>${waiting} ${waiting === 1 ? "record is" : "records are"} still saved on this phone. ${waiting === 1 ? "It" : "They"} will be sent when Self-Service reopens, so don't clear this site's data or delete the app.</span></p>` : ""}
      <a class="button button--secondary button--block" href="/lending" data-route>See what's available to borrow</a>
    </div>`);
}

/* ---------- Behaviour ---------- */

/** The key of the view currently drawn under any sheet, so closing a sheet never redraws (or scrolls) it. */
let renderedKey: string | null = null;

function renderScreen(): void {
  const current = params();
  const view = viewOf(current);
  renderedKey = viewKey(current);
  // The campus photograph belongs to home (see self-service.css), and to the closed notice.
  document.body.dataset.ssScreen = paused ? "home" : view;
  if (paused) { renderPaused(); document.title = "Under maintenance · Self-Service"; return; }
  if (view === "home") renderHome();
  else if (view === "activity") renderActivity();
  else if (view === "install") renderInstall();
  else if (view === "item") renderItem();
  else if (view === "return") renderReturn();
  else renderBrowse();
  const main = region("screen");
  if (main && !reducedMotion()) {
    main.classList.remove("is-entering");
    void main.offsetWidth;
    main.classList.add("is-entering");
    main.addEventListener("animationend", () => main.classList.remove("is-entering"), { once: true });
  }
  const item = view === "item" ? itemById(current.item) : undefined;
  const title = view === "home" ? "Self-Service · HAU USC Logistics" : `${view === "activity" ? "My activity" : view === "install" ? "Install" : view === "return" ? "Return" : view === "item" ? item?.name ?? "Item" : "All items"} · Self-Service`;
  document.title = title;
}

/** Wires one sheet form to its action. The record is saved on the phone first, then synced; first the person checks what is about to be sent. */
function bindForm(form: HTMLFormElement, item: CatalogItem | undefined, loan: LocalEvent | undefined, onSaved: (event: LocalEvent) => void): void {
  const type = form.dataset.form as Draft["type"];
  const alert = form.querySelector<HTMLElement>("[data-alert]")!;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]")!;
  const quantity = form.querySelector<HTMLInputElement>("input[name=quantity]");
  const available = item && snapshot ? estimate(snapshot, events).get(item.id) ?? 0 : 0;
  let photo: Blob | null = null;
  let photoUrl: string | null = null;
  let preparing: Promise<void> | null = null;

  /** Keeps the form's dependent parts (labels, hints, optional fields) in step with its input. */
  const updateFields = () => {
    const count = Math.max(1, Math.min(SELF_SERVICE_LIMITS.quantity, Math.round(Number(quantity?.value) || 1)));
    const over = form.querySelector<HTMLElement>("[data-over]");
    if (over && item && type !== "RETURN") {
      over.hidden = count <= available;
      over.textContent = available <= 0 ? "The records show none left. If you have it in hand, record it anyway; staff will recount." : `That's more than the ${available} the records show. Staff will be asked to recount.`;
    }
    const purpose = form.querySelector<HTMLInputElement>("input[name=purpose]:checked, input[type=hidden][name=purpose]")?.value;
    const reason = form.querySelector<HTMLElement>("[data-reason]");
    if (reason) reason.hidden = purpose !== "USC";
    const outcome = form.querySelector<HTMLInputElement>("input[name=outcome]:checked")?.value;
    const note = form.querySelector<HTMLElement>("[data-note]");
    if (note) {
      note.hidden = !outcome || outcome === "RETURNED";
      form.querySelector("[data-note-label]")!.textContent = outcome === "LOST" ? "What happened?" : "What's damaged?";
    }
  };

  /** Shows the name and ID fields in place of the remembered person. */
  const revealIdentity = () => {
    form.querySelector<HTMLElement>("[data-who]")?.setAttribute("hidden", "");
    form.querySelector<HTMLElement>("[data-identity-fields]")?.removeAttribute("hidden");
  };

  // A pasted "21-000115" must not be cut at eight characters before its dash is dropped.
  form.addEventListener("paste", (event) => {
    const field = event.target as HTMLInputElement;
    if (field.id !== "ss-student") return;
    event.preventDefault();
    const digits = (event.clipboardData?.getData("text") ?? "").replace(/\D/g, "");
    const before = field.value.slice(0, field.selectionStart ?? 0) + digits + field.value.slice(field.selectionEnd ?? 0);
    field.value = before.slice(0, 8);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  form.addEventListener("input", (event) => {
    // The student ID is eight digits: letters, spaces and dashes are dropped as they are typed or pasted.
    const typed = event.target as HTMLInputElement;
    if (typed.id === "ss-student") typed.value = typed.value.replace(/\D/g, "").slice(0, 8);
    dirty = true;
    setMessage(alert, "");
    form.querySelectorAll("[aria-invalid]").forEach((field) => field.removeAttribute("aria-invalid"));
    updateFields();
  });
  form.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const step = target.closest<HTMLElement>("[data-step]");
    if (step && quantity) {
      quantity.value = String(Math.max(1, Math.min(SELF_SERVICE_LIMITS.quantity, (Number(quantity.value) || 1) + Number(step.dataset.step))));
      navigator.vibrate?.(8);
      updateFields();
    }
    if (target.closest("[data-change-identity]")) { dirty = true; revealIdentity(); form.querySelector<HTMLInputElement>("#ss-name")?.focus(); }
    if (target.closest("[data-pick]")) form.querySelector<HTMLInputElement>("#ss-photo")?.click();
    if (target.closest("[data-clear-photo]")) { photo = null; photoUrl = null; showPhoto(null); }
  });

  const photoBox = form.querySelector<HTMLElement>("[data-photo]");
  const showPhoto = (preview: string | null) => {
    if (!photoBox) return;
    mount(photoBox, preview
      ? html`<img class="photo-field__preview" src="${preview}" alt="Photo to attach" /><div class="photo-field__actions"><button type="button" class="button button--secondary button--sm" data-pick>${icon("camera")}Retake</button><button type="button" class="button button--ghost button--sm" data-clear-photo>Remove</button></div>`
      : photoPick(type === "RETURN" ? "Take a photo of the item" : "Take a photo holding it"));
  };
  form.querySelector<HTMLInputElement>("#ss-photo")?.addEventListener("change", (event) => {
    const chosen = (event.target as HTMLInputElement).files?.[0];
    if (!chosen) return;
    dirty = true;
    if (photoBox) mount(photoBox, html`<p class="photo-field__busy">Preparing the photo…</p>`);
    preparing = (async () => {
      try {
        photo = await shrinkPhoto(chosen, SELF_SERVICE_LIMITS.photoBytes);
        photoUrl = await dataUrl(photo);
        showPhoto(photoUrl);
      } catch (error) {
        photo = null;
        photoUrl = null;
        showPhoto(null);
        setMessage(alert, error instanceof Error ? error.message : "This photo could not be read.");
      } finally {
        preparing = null;
      }
    })();
  });

  const read = () => {
    const data = new FormData(form);
    return {
      name: String(data.get("name") ?? "").trim().replace(/\s+/g, " "),
      studentId: String(data.get("studentId") ?? "").trim(),
      purpose: String(data.get("purpose") ?? "INDIVIDUAL") as "INDIVIDUAL" | "USC",
      reason: String(data.get("reason") ?? "").trim(),
      outcome: String(data.get("outcome") ?? "RETURNED") as "RETURNED" | "DAMAGED" | "LOST",
      note: String(data.get("note") ?? "").trim(),
      count: Math.round(Number(data.get("quantity") ?? loan?.quantity ?? 1)),
      returnBy: String(data.get("returnBy") || "") || null,
      remember: data.get("remember") !== null
    };
  };

  /** The first problem, with the field to fix it in, or null when the form is ready to check. */
  const validate = (values: ReturnType<typeof read>): [string, string] | null => {
    const { name, studentId, purpose, reason, outcome, note, count } = values;
    const needsIdentity = !loan || !loanKnown(loan);
    const problem = needsIdentity && !name ? ["Please enter your full name.", "#ss-name"]
      : needsIdentity && name.split(" ").length < 2 ? ["Please enter your full name, first and last.", "#ss-name"]
      : needsIdentity && !SELF_SERVICE_STUDENT_ID.test(studentId) ? [studentId ? "The student ID number must be exactly 8 digits." : "Please enter your student ID number.", "#ss-student"]
      : type === "BORROW" && purpose === "USC" && !reason ? ["Say what it's for.", "#ss-reason"]
      : !photo ? [type === "RETURN" ? "Take a photo of the item you are returning." : "Take a photo holding the item.", "[data-pick]"]
      : type === "RETURN" && outcome !== "RETURNED" && !note ? [outcome === "LOST" ? "Say what happened." : "Say what's damaged.", "#ss-note"]
      : !Number.isInteger(count) || count < 1 || count > SELF_SERVICE_LIMITS.quantity ? [`Choose a quantity from 1 to ${SELF_SERVICE_LIMITS.quantity}.`, "#ss-qty"] : null;
    return problem as [string, string] | null;
  };
  /** Swaps the form for a summary of what will be sent, with one clear way to send it and one to edit it. */
  const check = (draft: Draft, remember: boolean) => {
    const verbWord = type === "RETURN" ? "return" : ACTION_WORD[type].toLowerCase();
    const panel = document.createElement("div");
    panel.className = "ss-confirm";
    panel.setAttribute("data-confirm", "");
    mount(panel, html`<h3 class="ss-confirm__title" tabindex="-1">Check before you send</h3>
      ${summaryRows(draft, photoUrl, loan)}
      <p class="ss-hint">${icon(offline ? "cloudOff" : "info")}<span>${offline ? "You're offline. It is saved on this phone and sends when you're back online." : "It is saved on this phone first, then sent to Logistics."}</span></p>
      <div class="form-alert" role="alert" hidden data-alert></div>
      <button type="button" class="button button--primary button--lg button--block" data-confirm-save>Confirm ${verbWord}</button>
      <button type="button" class="button button--ghost button--block" data-confirm-edit>Edit</button>`);
    form.hidden = true;
    form.after(panel);
    panel.querySelector<HTMLElement>(".ss-confirm__title")!.focus();
    const confirmAlert = panel.querySelector<HTMLElement>("[data-alert]")!;
    panel.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-confirm-edit]")) { panel.remove(); form.hidden = false; submit.focus(); return; }
      const save = target.closest<HTMLButtonElement>("[data-confirm-save]");
      if (!save || save.disabled) return;
      save.disabled = true;
      try {
        const saved = await record(draft, photo ?? undefined);
        if (draft.person.name && remember) {
          profile = { name: draft.person.name, studentId: draft.person.studentId ?? profile.studentId };
          void store.setMeta("profile", profile);
        }
        dirty = false;
        navigator.vibrate?.(15);
        onSaved(saved);
        void requestPersistence();
        void requestBackgroundSync();
      } catch (error) {
        save.disabled = false;
        setMessage(confirmAlert, keepFailure(error));
      }
    });
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (preparing) await preparing;
    const values = read();
    const found = validate(values);
    if (found) {
      const [problem, field] = found;
      // A remembered person's fields are out of sight until they are the thing to fix.
      if (field === "#ss-name" || field === "#ss-student") revealIdentity();
      setMessage(alert, problem);
      const invalid = form.querySelector<HTMLElement>(field);
      invalid?.setAttribute("aria-invalid", "true");
      invalid?.focus();
      navigator.vibrate?.([20, 40, 20]);
      return;
    }
    const { name, studentId, purpose, reason, outcome, note, count, returnBy, remember } = values;
    const target = loan ? { itemId: loan.itemId, itemName: loan.itemName, unit: loan.unit } : { itemId: item!.id, itemName: item!.name, unit: item!.unit };
    const person = loan && loanKnown(loan) ? loan.person : { name, studentId };
    const draft: Draft = type === "TAKE" || type === "USE" ? { type, ...target, quantity: type === "USE" ? 1 : count, person }
      : type === "BORROW" ? { type, ...target, quantity: count, person, purpose, ...(purpose === "USC" ? { reason } : {}), returnBy }
      : { type, ...target, quantity: loan?.quantity ?? count, person, loanEventId: loan?.id ?? null, outcome, ...(outcome === "RETURNED" ? {} : { note }) };
    check(draft, remember);
  });
  updateFields();
}

export async function selfService(): Promise<void> {
  document.body.classList.add("is-self-service");
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const pageTheme = themeColor?.content ?? "";
  applyTheme(storedTheme());
  onLeave(() => {
    document.body.classList.remove("is-self-service");
    delete document.body.dataset.ssScreen;
    delete document.body.dataset.theme;
    themeColor?.setAttribute("content", pageTheme);
  });
  mount(app, frame());
  onLeave(bindHelp(app));
  const dialog = document.querySelector<HTMLDialogElement>("#ss-sheet")!;
  let receiptFor: string | null = null;
  /** Set when code closes the sheet and moves the address itself. */
  let steering = false;
  const control = sheet(dialog, {
    dirty: () => dirty,
    onClose: () => {
      dirty = false;
      receiptFor = null;
      // Closing with X, Escape or the backdrop also steps the address back; a direct link has nothing behind it, so the page underneath replaces it.
      if (opensSheet(params()) && !steering) {
        const depth = (window.history.state as { ssDepth?: number } | null)?.ssDepth ?? 0;
        if (depth > 0) window.history.back();
        else go(FORM_SCREENS.has(params().screen) ? { screen: "item" } : { loan: null }, true);
      }
      steering = false;
    }
  });
  const closeAnd = (next: () => void) => {
    receiptFor = null;
    steering = dialog.open;
    control.close(true);
    next();
  };

  /** Which sheet is open, so returning to the same address never redraws (and empties) a form. */
  let shown = "";
  /** Opens the sheet the URL asks for, or closes it when the URL no longer does. */
  const syncSheet = () => {
    const current = params();
    const { screen, item: itemId, loan: loanId } = current;
    if (paused) { if (dialog.open) { steering = true; control.close(true); } return; }
    if (receiptFor) return;
    if (!opensSheet(current)) { if (dialog.open) control.close(true); return; }
    if (dialog.open && shown === `${screen}:${itemId}:${loanId}`) return;
    shown = `${screen}:${itemId}:${loanId}`;
    const loan = loanId ? events.find((event) => event.id === loanId && event.type === "BORROW") : undefined;
    const item = itemById(itemId) ?? (loan ? itemById(loan.itemId) : undefined);
    // A return is only ever for a borrow made on this phone.
    if (screen === "return" ? !loan : !item) { if (snapshot || screen === "return") go({ item: null, loan: null }, true); return; }
    // The item's own action decides the sheet, whatever an old link or shortcut asked for.
    const body = screen === "return" ? returnSheet(loan!) : item!.action === "BORROW" ? borrowSheet(item!) : item!.action === "TAKE" ? takeSheet(item!) : useSheet(item!);
    mount(dialog, body);
    control.open();
    dirty = false;
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    bindForm(form, item, loan, (saved) => {
      receiptFor = saved.id;
      mount(dialog, receipt(saved));
      dialog.querySelector<HTMLButtonElement>("[data-done]")?.focus();
      void runSync();
    });
    // Phones would pop the keyboard over the sheet; only a mouse user starts typing straight away.
    if (window.matchMedia("(pointer: fine)").matches) form.querySelector<HTMLInputElement>("input:not([type=hidden]):not([type=radio]):not([type=file]):not([type=checkbox])")?.focus();
  };

  const show = () => {
    renderScreen();
    refreshRegions();
    syncSheet();
  };

  ownQuery(() => {
    const current = params();
    // Back while a form has input asks first, and stays put if the answer is no.
    if (dialog.open && dirty && !opensSheet(current) && !window.confirm("Discard what you've entered?")) {
      window.history.forward();
      return;
    }
    if (opensSheet(current)) { syncSheet(); return; }
    // The address moved on (back, Done): the sheet goes, and the address already reflects it.
    if (dialog.open) { receiptFor = null; steering = true; control.close(true); }
    // Closing a sheet keeps the screen, and its scroll position, as it was.
    if (viewKey(current) === renderedKey) return;
    renderScreen();
    refreshRegions();
    window.scrollTo(0, 0);
    // A screen reader hears the new screen: focus moves to its heading, as it does between pages.
    region("screen")?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  });

  // One delegated listener for the whole app (the sheet is inside it too).
  app.addEventListener("click", clickHandler);
  function clickHandler(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const goTo = target.closest<HTMLAnchorElement>("[data-go]");
    if (goTo) { event.preventDefault(); go({ screen: goTo.dataset.go as Screen, item: null, loan: null, group: (goTo.dataset.group || null) as GroupId | null }, goTo.hasAttribute("aria-current")); return; }
    const open = target.closest<HTMLAnchorElement>("[data-open-item]");
    if (open) {
      event.preventDefault();
      const next = { screen: (open.dataset.screen as Screen) ?? "item", item: open.dataset.openItem!, loan: null };
      withTransition(() => go(next), next.screen === "item" ? open.querySelector<HTMLElement>(".item-visual") : null);
      return;
    }
    const openLoan = target.closest<HTMLAnchorElement>("[data-open-loan]");
    if (openLoan) { event.preventDefault(); go({ screen: "return", item: null, loan: openLoan.dataset.openLoan! }); return; }
    const where = target.closest<HTMLElement>("[data-where]");
    if (where) { showWhere(itemById(where.dataset.where!)); return; }
    if (target.closest("[data-back]")) { event.preventDefault(); goBack(); return; }
    const themeToggle = target.closest<HTMLElement>("[data-theme-toggle]");
    if (themeToggle) { switchTheme(themeToggle); return; }
    if (target.closest("[data-done]")) { closeAnd(goHome); return; }
    // "Take something else" starts again from the list.
    if (target.closest("[data-again]")) { closeAnd(() => go({ screen: "get", item: null, loan: null, group: null }, true)); return; }
    if (target.closest("[data-install]")) { void promptInstall().then((accepted) => { if (accepted) renderScreen(); }); return; }
    if (target.closest("[data-apply-update]")) { applyUpdate(); return; }
    if (target.closest("[data-sync]")) { void runSync(true).then(() => poll()); return; }
    if (target.closest("[data-clear]")) { void clearHistory(); return; }
    if (target.closest("[data-forget]") && window.confirm("Forget your name and student ID on this phone?")) {
      profile = { name: "", studentId: "" };
      void store.setMeta("profile", profile).then(renderScreen);
    }
  }

  /** The route to an item from the places staff share; the phone's last snapshot is all it needs, so it works offline (the picture needs a connection). */
  function showWhere(item: CatalogItem | undefined): void {
    if (!item) return;
    const shared = new Map((snapshot?.places ?? []).map((place) => [place.id, place]));
    const known = placesOf((snapshot?.places ?? []).map((place) => ({ id: place.id, name: place.name, parentId: place.parentId, active: true })));
    const steps: Step[] = ancestry(known, item.locationId ?? null).reverse().map(({ id }) => ({ id, name: shared.get(id)!.name, directions: shared.get(id)!.directions, photo: shared.get(id)!.photo }));
    openWhereIsIt({
      item: item.name, steps, note: false, sheetClass: "ss-sheet", pictureUrl: (id, size) => `/api/public/location-media/${id}/${size}`,
      noRoute: "DOL staff keep this one at the office. Please ask them where to find it.",
      askName: { value: profile.name },
      report: offline ? null : (kind, _note, name, id) => sendReport(item.id, kind, name, id),
      reportBlocked: "Reports need a connection. You can report again when you are back online."
    });
  }

  function goBack(): void {
    const depth = (window.history.state as { ssDepth?: number } | null)?.ssDepth ?? 0;
    if (depth > 0) window.history.back();
    else go({ screen: "home", item: null, loan: null, group: null }, true);
  }

  const onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "ss-find") renderResults(input.value);
    else if (input.matches("[data-search]")) {
      listQuery = input.value;
      const rows = region("rows");
      if (rows && viewOf(params()) === "get") mount(rows, listRows());
    }
  };
  const onFind = (event: Event) => { if ((event.target as HTMLElement).matches("[data-find]")) event.preventDefault(); };
  // On a phone, lift the search box to the top so its results are not hidden under the keyboard.
  const onFocus = (event: FocusEvent) => {
    const field = (event.target as HTMLElement).closest(".ss-find");
    if (field && window.matchMedia("(pointer: coarse)").matches) window.setTimeout(() => field.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }), 250);
  };
  app.addEventListener("input", onInput);
  app.addEventListener("submit", onFind);
  app.addEventListener("focusin", onFocus);

  const refreshReadiness = async () => { ready = await readiness(); refreshRegions(); };
  const reload = async () => {
    await load();
    refreshRegions();
    updateReceipt();
    scheduleSync();
    // A link straight to an item opens its sheet as soon as the catalog has arrived.
    if (!dialog.open && opensSheet(params())) syncSheet();
  };
  const updateReceipt = () => {
    const spot = receiptFor ? dialog.querySelector<HTMLElement>(`[data-receipt="${CSS.escape(receiptFor)}"]`) : null;
    const event = spot ? events.find((entry) => entry.id === receiptFor) : undefined;
    if (spot && event) mount(spot, receiptState(event));
  };

  let syncTimer = 0;
  let pollTimer = 0;
  /** Wakes up for the next automatic attempt; the server's backoff decides when. */
  const scheduleSync = () => {
    window.clearTimeout(syncTimer);
    void nextAttemptAt().then((at) => {
      if (at !== null && !offline) syncTimer = window.setTimeout(() => void runSync(), Math.max(1_000, at - Date.now()));
    });
  };
  /** Every sync this screen starts; the pill shows "Syncing…" until it settles. */
  async function runSync(force = false) {
    const report = await syncNow(force);
    syncing = false;
    if (report.offline) offline = true;
    await reload();
    return report;
  }
  let quietChecks = 0;
  async function poll() {
    window.clearTimeout(pollTimer);
    if (document.visibilityState !== "visible") return;
    const result = await refreshCatalog();
    offline = result === "offline";
    // Offline, the phone keeps what it last heard; opening or closing redraws whatever is on screen.
    const closed = result === "offline" ? paused : result === "paused";
    if (closed !== paused) {
      const redraw = Boolean(closed) !== Boolean(paused) && renderedKey !== null;
      paused = closed;
      // A test never tells this browser's own Self-Service that it is open.
      if (!testing) void store.setMeta("paused", closed);
      if (redraw) show();
    }
    if (result !== "updated") refreshRegions();
    // Records waiting for staff learn their decision (the "changed" message redraws them).
    if (result === "updated" || result === "unchanged") await checkDecisions();
    quietChecks = result === "unchanged" ? quietChecks + 1 : 0;
    pollTimer = window.setTimeout(() => void poll(), quietChecks >= QUIET_CHECKS ? CATALOG_POLL_MS * 3 : CATALOG_POLL_MS);
  }
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    quietChecks = 0;
    void runSync();
    void poll();
    void refreshReadiness();
  };
  const goneOffline = () => { offline = true; refreshRegions(); updateReceipt(); };
  const backOnline = () => { quietChecks = 0; offline = false; refreshRegions(); void runSync(true); void poll(); };

  const unsubscribe = onSyncMessage((message) => {
    if (message.type === "syncing") { syncing = true; refreshRegions(); return; }
    // A sync started elsewhere (another tab, the service worker) is over once nothing waits.
    void reload().then(() => { if (!pendingCount()) { syncing = false; refreshRegions(); } });
  });
  const unsubscribePwa = onPwaChange(() => refreshRegions());
  window.addEventListener("online", backOnline);
  window.addEventListener("offline", goneOffline);
  document.addEventListener("visibilitychange", wake);
  navigator.serviceWorker?.addEventListener("controllerchange", refreshReadiness);
  // The service worker may have taken control before the listener above existed, so look again for a few seconds.
  let settleReadinessTimer = 0;
  const settleReadiness = (tries = 0) => void refreshReadiness().then(() => {
    if (!(ready?.shell && ready.catalog) && tries < 15) settleReadinessTimer = window.setTimeout(() => settleReadiness(tries + 1), 1_000);
  });
  settleReadiness();
  // An update may apply itself when the person comes back to a screen with nothing unsaved.
  whenIdle(() => !dialog.open && (params().screen === "home" || params().screen === "activity"));
  onLeave(() => {
    unsubscribe();
    unsubscribePwa();
    window.clearTimeout(syncTimer);
    window.clearTimeout(pollTimer);
    window.clearTimeout(settleReadinessTimer);
    window.removeEventListener("online", backOnline);
    window.removeEventListener("offline", goneOffline);
    document.removeEventListener("visibilitychange", wake);
    navigator.serviceWorker?.removeEventListener("controllerchange", refreshReadiness);
    app.removeEventListener("click", clickHandler);
    app.removeEventListener("input", onInput);
    app.removeEventListener("submit", onFind);
    app.removeEventListener("focusin", onFocus);
    whenIdle(() => false);
  });

  if (testing) startTesting();
  await load();
  paused = testing ? undefined : await store.getMeta<boolean>("paused");
  // Launch: fetch the latest catalog, then send anything waiting from earlier. A phone that has never
  // heard from the office waits a moment for it, so a closed Self-Service does not flash open first.
  const launched = poll();
  if (paused === undefined && !offline) await Promise.race([launched, new Promise((done) => window.setTimeout(done, 3_000))]);
  show();
  void refreshReadiness();
  await launched;
  await runSync();
}
