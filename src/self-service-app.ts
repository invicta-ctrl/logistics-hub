import "@fontsource/newsreader/latin-400-italic.css";
import "./self-service.css";
import { SELF_SERVICE_LIMITS, STUDENT_ID_PATTERN, type SelfServiceAction } from "./catalog-policy";
import { type CatalogItem, type LocalEvent, type Snapshot, estimate, openLoans, pendingByItem, summary } from "./offline-queue";
import * as store from "./offline-store";
import { type Draft, checkDecisions, clearHistory, nextAttemptAt, onSyncMessage, record, refreshCatalog, startTesting, syncNow } from "./offline-sync";
import { type Readiness, applyUpdate, canPromptInstall, hasUpdate, isStandalone, onPwaChange, platform, promptInstall, readiness, requestBackgroundSync, requestPersistence, whenIdle } from "./pwa";
import { CREST, type Html, MARK, app, categoryName, dataUrl, formatTime, html, icon, mount, navigate, onLeave, ownQuery, reducedMotion, setMessage, sheet, shrinkPhoto, thumbImg, units } from "./ui";

/*
 * Self-Service (/self-service): what a student or staff member sees after scanning the QR code
 * on their own phone. Every action is saved on the phone first (offline-sync.ts) and sent when
 * there is a connection. Screens live in the URL (?do=take&item=ITM-0043) so the phone's back
 * button closes a sheet or steps back; the router hands those changes to this module (ownQuery).
 */

type Screen = "home" | "get" | "take" | "borrow" | "use" | "return" | "activity" | "install";
type Params = { screen: Screen; item: string | null; loan: string | null };

const SCREENS = new Set<Screen>(["home", "get", "take", "borrow", "use", "return", "activity", "install"]);
/** One list of everything offered. "take", "borrow" and "use" stay valid addresses (old shortcuts, an item sheet) and show the same list. */
const inList = (screen: Screen) => screen === "get" || screen === "take" || screen === "borrow" || screen === "use";
/**
 * The item decides what a person does with it, never a choice on the phone: a Loanable is borrowed,
 * a whole-unit Consumable taken, an open-unit one (a ream, a bottle) used, with no amount asked.
 */
const SCREEN_FOR: Record<SelfServiceAction, Screen> = { TAKE: "take", BORROW: "borrow", USE: "use" };
const ACTION_WORD: Record<SelfServiceAction, string> = { TAKE: "Take", BORROW: "Borrow", USE: "Use" };
const FRESH_MS = 2 * 60_000;
const CATALOG_POLL_MS = 30_000;

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

function params(): Params {
  const query = new URLSearchParams(window.location.search);
  const screen = query.get("do") as Screen | null;
  return { screen: screen && SCREENS.has(screen) ? screen : "home", item: query.get("item"), loan: query.get("loan") };
}

/** Moves within the app; the depth in history.state lets "Done" return home without leaving the app. */
function go(next: Partial<Params>, replace = false): void {
  const current = params();
  const merged = { ...current, ...next };
  const query = new URLSearchParams();
  if (merged.screen !== "home") query.set("do", merged.screen);
  if (merged.item) query.set("item", merged.item);
  if (merged.loan) query.set("loan", merged.loan);
  const depth = ((window.history.state as { ssDepth?: number } | null)?.ssDepth ?? 0) + (replace ? 0 : 1);
  navigate(`/self-service${query.size ? `?${query}` : ""}`, replace, { ssDepth: depth });
}

function goHome(): void {
  const depth = (window.history.state as { ssDepth?: number } | null)?.ssDepth ?? 0;
  if (depth > 0) window.history.go(-depth);
  else go({ screen: "home", item: null, loan: null }, true);
}

const itemById = (id: string | null) => snapshot?.items.find((item) => item.id === id);
const pendingCount = () => events.filter((event) => event.state === "pending").length;
const fresh = () => Boolean(snapshot && !offline && Date.now() - snapshot.checkedAt < FRESH_MS);

async function load(): Promise<void> {
  [snapshot, events, profile] = await Promise.all([store.catalog(), store.events(), store.getMeta<store.Profile>("profile").then((saved) => saved ?? { name: "", studentId: "" })]);
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
  const { screen } = params();
  const tiles = region("tiles");
  if (tiles) mount(tiles, homeTiles());
  const status = region("status");
  if (status) mount(status, html`${readinessCard()}${installCard()}`);
  if (screen === "activity") { renderActivity(); return; }
  const rows = region("rows");
  if (rows && inList(screen)) mount(rows, listRows());
  const loans = region("loans");
  if (loans) mount(loans, loansSection());
}

/* ---------- Home ---------- */

function greeting(): string {
  const hour = Number(HOUR.format(new Date()));
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = profile.name.split(" ")[0];
  return first ? `${part}, ${first}.` : `${part}.`;
}

function tile(screen: Screen, name: string, detail: string, glyph: Parameters<typeof icon>[0], badge = ""): Html {
  return html`<a class="ss-tile ss-tile--${screen}" href="/self-service?do=${screen}" data-go="${screen}">
      <span class="ss-tile__icon" aria-hidden="true">${icon(glyph)}</span>
      <span class="ss-tile__name">${name}</span>
      <span class="ss-tile__detail">${detail}</span>
      ${badge ? html`<span class="ss-tile__badge" aria-hidden="true">${badge}</span>` : ""}
    </a>`;
}

function homeTiles(): Html {
  const loans = openLoans(events).length;
  const counts = summary(events);
  const reviews = recentReviews();
  const activityBadge = counts.pending ? `${counts.pending} waiting` : reviews ? `${reviews} with staff` : "";
  const anything = snapshot ? snapshot.items.length > 0 : true;
  return html`${anything ? tile("get", "Get an item", "Borrow equipment or take supplies", "basket") : ""}
    ${tile("return", "Return", loans ? `${loans} on loan from this phone` : "Bring back what you borrowed", "giveBack", loans ? String(loans) : "")}
    ${tile("activity", "My activity", "What this phone recorded", "history", activityBadge)}`;
}

function renderHome(): void {
  const screen = region("screen");
  if (!screen) return;
  mount(screen, html`<div class="ss-home">
      <section class="ss-hero" aria-labelledby="ss-question">
        <h1 id="ss-question">What do you need?</h1>
        <p class="ss-hero__hello">${greeting()}</p>
      </section>
      <nav class="ss-tiles" aria-label="Actions" data-region="tiles">${homeTiles()}</nav>
      <form class="ss-find" role="search" data-find>
        <label class="visually-hidden" for="ss-find">Search everything</label>
        <div class="search-field">${icon("search")}<input id="ss-find" type="search" name="q" placeholder="Search everything…" autocomplete="off" enterkeyhint="search" /></div>
      </form>
      <ul class="ss-results" data-region="results" hidden></ul>
      <div class="ss-status" data-region="status">${readinessCard()}${installCard()}</div>
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

function renderResults(query: string): void {
  const results = region("results");
  if (!results || !snapshot) return;
  const found = query.trim() ? matching(snapshot.items, query).slice(0, 8) : [];
  results.hidden = !found.length && !query.trim();
  const available = estimate(snapshot, events);
  results.classList.toggle("ss-list--photos", hasPhotos());
  mount(results, found.length
    ? html`${found.map((item) => html`<li><a class="ss-row" href="/self-service?do=${SCREEN_FOR[item.action]}&item=${item.id}" data-open-item="${item.id}" data-screen="${SCREEN_FOR[item.action]}">${thumbImg(item.photo)}
        <span class="ss-row__main"><span class="ss-row__name">${item.name}</span><span class="ss-row__sub">${ACTION_WORD[item.action]} · ${categoryName(item.category)}</span></span>
        ${countBadge(item, available.get(item.id) ?? 0)}</a></li>`)}`
    : html`<li class="ss-results__none">Nothing matches “${query}”.</li>`);
}

/* ---------- Item lists ---------- */

const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Name, other names and location match (not the category, whose labels would match too much); every word typed must appear. */
function matching(items: CatalogItem[], query: string): CatalogItem[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const haystack = normalize(`${item.name} ${item.aliases ?? ""} ${item.location ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}

function countBadge(item: CatalogItem, available: number): Html {
  if (available <= 0) return html`<span class="ss-count ss-count--out">None left</span>`;
  const noun = item.action === "BORROW" ? "available" : "left";
  // Low stock says so in words as well as colour.
  return available <= 2 ? html`<span class="ss-count ss-count--low">Only <strong>${available}</strong> ${noun}</span>` : html`<span class="ss-count"><strong>${available}</strong> ${noun}</span>`;
}

const SCREEN_COPY = {
  get: { title: "Get an item", lead: "Pick what you need. Equipment is borrowed and returned; supplies are taken. Shared supplies, like a ream of paper, are just recorded as used.", empty: "Nothing is set up for self-service yet. Ask Logistics staff." },
  return: { title: "Return", lead: "Return what you borrowed on this phone. A photo of the item is needed.", empty: "" }
} as const;

function renderList(screen: "get" | "return"): void {
  const main = region("screen");
  if (!main) return;
  listQuery = "";
  const copy = SCREEN_COPY[screen];
  // The search box never sits inside a region that refreshes, so a sync never interrupts typing.
  mount(main, html`<div class="ss-screen">
      ${back(copy.title)}
      <p class="ss-lead">${copy.lead}</p>
      ${screen === "return" ? html`<div class="ss-screen" data-region="loans">${loansSection()}</div>` : html`
      <div class="search-field ss-search">${icon("search")}<input type="search" data-search placeholder="Search items…" aria-label="Search" autocomplete="off" enterkeyhint="search" /></div>
      <div data-region="rows">${listRows()}</div>`}
    </div>`);
}

/** Borrows made on this phone, one tap each to return (the return is then linked to the exact loan). */
function loansSection(): Html {
  const loans = openLoans(events);
  return html`${loans.length ? html`<h2 class="ss-section">On loan from this phone</h2>
      <ul class="ss-list">${loans.map((loan) => html`<li><a class="ss-row" href="/self-service?do=return&loan=${loan.id}" data-open-loan="${loan.id}">
        <span class="ss-row__main"><span class="ss-row__name">${loan.itemName}${loan.quantity > 1 ? ` ×${loan.quantity}` : ""}</span><span class="ss-row__sub">Borrowed ${when(loan.occurredAt)}${loan.state === "pending" ? " · waiting to sync" : ""}</span></span>
        <span class="ss-row__go">Return ${icon("next")}</span></a></li>`)}</ul>`
    : emptyNote("You haven't borrowed anything on this phone. Something borrowed at the Logistics desk is returned at the desk.")}`;
}

function back(title: string): Html {
  return html`<div class="ss-head"><button type="button" class="ss-back" data-back aria-label="Back">${icon("back")}</button><h1>${title}</h1></div>`;
}

let listQuery = "";

const hasPhotos = () => Boolean(snapshot?.items.some((item) => item.photo));

function listRows(): Html {
  if (!snapshot) return offline ? emptyNote("The catalog hasn't been downloaded to this phone yet. Connect to the internet once, then try again.") : skeleton();
  const available = estimate(snapshot, events);
  const waiting = pendingByItem(events);
  const offered = snapshot.items;
  if (!offered.length) return emptyNote(SCREEN_COPY.get.empty);
  const found = matching(offered, listQuery);
  if (!found.length) return emptyNote(`Nothing matches “${listQuery}”.`);
  // Recently used on this phone first, then by category.
  const recent = [...new Set(events.filter((event) => event.type !== "RETURN").sort((a, b) => b.seq - a.seq).map((event) => event.itemId))].slice(0, 3)
    .map((id) => found.find((item) => item.id === id)).filter((item): item is CatalogItem => Boolean(item));
  const byCategory = new Map<string, CatalogItem[]>();
  for (const item of found) byCategory.set(item.category, [...byCategory.get(item.category) ?? [], item]);
  // Once any item has a photo, every row keeps the same left margin, so names line up whether or not a row has its picture.
  const photoClass = hasPhotos() ? "ss-list--photos" : "";
  const row = (item: CatalogItem) => html`<li><a class="ss-row ${(available.get(item.id) ?? 0) <= 0 ? "ss-row--out" : ""}" href="/self-service?do=${SCREEN_FOR[item.action]}&item=${item.id}" data-open-item="${item.id}" data-screen="${SCREEN_FOR[item.action]}">${thumbImg(item.photo)}
      <span class="ss-row__main"><span class="ss-row__name">${item.name}</span>${sub(item, waiting.get(item.id))}</span>
      ${countBadge(item, available.get(item.id) ?? 0)}</a></li>`;
  return html`${recent.length && !listQuery ? html`<h2 class="ss-section">Recent on this phone</h2><ul class="ss-list ${photoClass}">${recent.map(row)}</ul>` : ""}
    ${[...byCategory].map(([category, items]) => html`<h2 class="ss-section">${categoryName(category)}</h2><ul class="ss-list ${photoClass}">${items.map(row)}</ul>`)}
    ${stamp()}`;
}

/** Other names and where it is kept, plus anything of it still waiting on this phone. */
function sub(item: CatalogItem, waiting = 0): Html {
  const parts = [ACTION_WORD[item.action], item.aliases, item.location, waiting ? `${waiting} waiting to sync` : null].filter(Boolean);
  return parts.length ? html`<span class="ss-row__sub">${parts.join(" · ")}</span>` : html``;
}

/** When the numbers were last confirmed, and that other phones may not be counted yet. */
function stamp(): Html {
  if (!snapshot) return html``;
  if (fresh()) return html`<p class="ss-stamp">Live counts · updated ${formatTime(new Date(snapshot.checkedAt).toISOString())}</p>`;
  return html`<p class="ss-stamp">${icon("cloudOff")}Estimated counts as of ${formatTime(new Date(snapshot.fetchedAt).toISOString())}. Other phones' offline records may not be included yet.</p>`;
}

const emptyNote = (text: string) => html`<p class="ss-empty">${text}</p>`;
const skeleton = () => html`<ul class="ss-list" aria-hidden="true">${Array.from({ length: 6 }, () => html`<li class="ss-row ss-row--skeleton"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></li>`)}</ul>`;

function when(iso: string): string {
  const date = new Date(iso);
  return DAY.format(date) === DAY.format(new Date()) ? formatTime(iso) : DAY_TIME.format(date);
}

/* ---------- Sheets: Take, Borrow, Use, Return ---------- */

function estimateLine(item: CatalogItem): Html {
  if (!snapshot) return html``;
  const count = estimate(snapshot, events).get(item.id) ?? 0;
  const mine = pendingByItem(events).get(item.id) ?? 0;
  const noun = units(count, item.unit);
  const main = count <= 0 ? "The records show none left." : fresh() ? `${count} ${noun} ${item.action === "BORROW" ? "available" : "left"}.` : `About ${count} ${noun} ${item.action === "BORROW" ? "available" : "left"}.`;
  const note = [mine ? `Includes your ${mine} not yet sent.` : "", fresh() ? "" : `Last synced ${formatTime(new Date(snapshot.fetchedAt).toISOString())}; other offline records may not be counted yet.`].filter(Boolean).join(" ");
  return html`<p class="ss-estimate ${count <= 0 ? "ss-estimate--out" : ""}"><span>${main}</span>${note ? html`<small>${note}</small>` : ""}</p>`;
}

function quantityField(max: number): Html {
  return html`<div class="field"><label for="ss-qty">How many?</label>
      <div class="stepper ss-stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="One less">${icon("minus")}</button><input id="ss-qty" name="quantity" type="number" inputmode="numeric" min="1" max="${max}" step="1" value="1" aria-describedby="ss-over" /><button type="button" class="stepper__button" data-step="1" aria-label="One more">${icon("plus")}</button></div>
      <p class="field__hint field__hint--warn" id="ss-over" aria-live="polite" data-over hidden></p></div>`;
}

const nameField = (label: string) => html`<div class="field"><label for="ss-name">${label}</label><input id="ss-name" name="name" autocomplete="name" autocapitalize="words" maxlength="120" required value="${profile.name}" enterkeyhint="done" /></div>`;
const studentIdField = (required: boolean) => html`<div class="field" data-student-id><label for="ss-student">Student ID number ${required ? "" : html`<span class="field__optional">optional</span>`}</label><input id="ss-student" name="studentId" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30" inputmode="text" value="${profile.studentId}" ${required ? "required" : ""} /></div>`;

function sheetFrame(kicker: string, title: string, body: Html): Html {
  return html`<header class="sheet__header"><div><p class="sheet__kicker">${kicker}</p><h2 id="sheet-title">${title}</h2></div><button class="icon-button" type="button" aria-label="Close" data-close>${icon("close")}</button></header>
    <div class="sheet__body">${body}</div>`;
}

/** The item's picture at the top of its sheet, so the person can confirm it is what they came for (the 320 px thumbnail; no larger size is public). */
const sheetPhoto = (item: CatalogItem): Html | "" => item.photo ? html`<img class="ss-item-photo" src="/api/public/media/${item.photo}/thumb" alt="" width="160" height="160" decoding="async" />` : "";

function takeSheet(item: CatalogItem): Html {
  return sheetFrame(`Take · ${categoryName(item.category)}`, item.name, html`
    ${sheetPhoto(item)}${estimateLine(item)}
    <form class="form ss-form" data-form="TAKE" novalidate>
      ${quantityField(SELF_SERVICE_LIMITS.quantity)}
      ${nameField("Your name")}
      <div class="form-alert" role="alert" hidden data-alert></div>
      <button class="button button--primary button--lg button--block" type="submit" data-submit><span data-qty-label>Take 1 ${units(1, item.unit)}</span></button>
    </form>`);
}

/** An open-unit item: the person only says who used it. No amount, and stock does not change. */
function useSheet(item: CatalogItem): Html {
  return sheetFrame(`Use · ${categoryName(item.category)}`, item.name, html`
    ${sheetPhoto(item)}${estimateLine(item)}
    <p class="ss-hint">${icon("info")}Nothing to count: this records that you used some. Logistics staff mark an open ${item.unit} empty when it runs out.</p>
    <form class="form ss-form" data-form="USE" novalidate>
      ${nameField("Your name")}
      <div class="form-alert" role="alert" hidden data-alert></div>
      <button class="button button--primary button--lg button--block" type="submit" data-submit>Record use</button>
    </form>`);
}

const SHEETS: Record<SelfServiceAction, (item: CatalogItem) => Html> = { TAKE: takeSheet, BORROW: borrowSheet, USE: useSheet };

function borrowSheet(item: CatalogItem): Html {
  const uscOnly = item.audience === "USC_STAFF_ONLY";
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const day = (date: Date) => DAY.format(date);
  return sheetFrame(`Borrow · ${categoryName(item.category)}`, item.name, html`
    ${sheetPhoto(item)}${estimateLine(item)}
    <form class="form ss-form" data-form="BORROW" novalidate>
      ${uscOnly ? html`<input type="hidden" name="purpose" value="USC" /><p class="callout">${icon("info")}<span>Lent for USC use only. Say what it's for.</span></p>`
        : html`<fieldset class="ss-question"><legend class="ss-legend">What is it for?</legend><div class="segmented segmented--2">
          <label><input type="radio" name="purpose" value="INDIVIDUAL" checked /><span>Individual use</span></label><label><input type="radio" name="purpose" value="USC" /><span>USC use</span></label></div></fieldset>`}
      ${nameField(uscOnly ? "Name of the person using it" : "Your full name")}
      ${studentIdField(!uscOnly)}
      <div class="field" data-reason ${uscOnly ? "" : "hidden"}><label for="ss-reason">Specific reason</label><textarea id="ss-reason" name="reason" rows="2" maxlength="300" placeholder="e.g. stage setup for the general assembly"></textarea></div>
      ${quantityField(SELF_SERVICE_LIMITS.quantity)}
      <fieldset class="ss-choices"><legend>Return by <span class="field__optional">optional</span></legend>
        <label><input type="radio" name="returnBy" value="${day(today)}" /><span>Today</span></label>
        <label><input type="radio" name="returnBy" value="${day(tomorrow)}" /><span>Tomorrow</span></label>
        <label><input type="radio" name="returnBy" value="" checked /><span>No date</span></label>
      </fieldset>
      <div class="field">
        <span class="field-label" id="ss-photo-label">Photo <span class="field__optional">required</span></span>
        <input id="ss-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="user" hidden />
        <div class="photo-field" data-photo>${photoPick()}</div>
        <p class="field__hint" id="ss-photo-hint">Your face and the item, together. It stays private to Logistics staff.</p>
      </div>
      <div class="form-alert" role="alert" hidden data-alert></div>
      <button class="button button--primary button--lg button--block" type="submit" data-submit>Borrow</button>
    </form>`);
}

const photoPick = (text = "Take a photo holding it") => html`<button type="button" class="photo-field__pick" data-pick aria-describedby="ss-photo-label ss-photo-hint">${icon("camera")}<span>${text}</span></button>`;

/** Only a borrow made on this phone can be returned, so the loan is always known. */
function returnSheet(loan: LocalEvent): Html {
  return sheetFrame(`Borrowed ${when(loan.occurredAt)}`, `Return ${loan.itemName}${loan.quantity > 1 ? ` ×${loan.quantity}` : ""}`, html`
    <form class="form ss-form" data-form="RETURN" novalidate>
      <fieldset class="ss-question"><legend class="ss-legend">How is it?</legend><div class="segmented ss-condition">
        <label><input type="radio" name="outcome" value="RETURNED" checked /><span>Good</span></label><label><input type="radio" name="outcome" value="DAMAGED" /><span>Damaged</span></label><label><input type="radio" name="outcome" value="LOST" /><span>Lost</span></label>
      </div></fieldset>
      <div class="field" data-note hidden><label for="ss-note" data-note-label>What's damaged?</label><textarea id="ss-note" name="note" rows="2" maxlength="300"></textarea></div>
      <div class="field">
        <span class="field-label" id="ss-photo-label">Photo of the item <span class="field__optional">required</span></span>
        <input id="ss-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden />
        <div class="photo-field" data-photo>${photoPick("Take a photo of the item")}</div>
        <p class="field__hint" id="ss-photo-hint">Logistics staff check this photo before the stock is updated. It stays private to staff.</p>
      </div>
      <p class="ss-hint">${icon("check")}Linked to your borrow on this phone, so Logistics knows exactly which loan this is.</p>
      <div class="form-alert" role="alert" hidden data-alert></div>
      <button class="button button--primary button--lg button--block" type="submit" data-submit>Return</button>
    </form>`);
}

const VERB: Record<string, string> = { TAKE: "Taken", BORROW: "Borrowed", USE: "Use recorded", RETURNED: "Return sent", DAMAGED: "Damaged return sent", LOST: "Reported lost" };
const verb = (event: LocalEvent) => VERB[event.type === "RETURN" ? event.outcome ?? "RETURNED" : event.type];

/** Shown in the sheet after saving: calm, specific, and it updates itself when the record syncs. */
function receipt(event: LocalEvent): Html {
  return html`<div class="ss-receipt" role="status">
      <svg class="ss-receipt__mark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="m15 27 7 7 15-16" /></svg>
      <h2 id="sheet-title">${verb(event)}</h2>
      <p class="ss-receipt__what">${event.quantity > 1 ? `${event.quantity} × ` : ""}${event.itemName}</p>
      <p class="ss-receipt__sync" data-receipt="${event.id}">${receiptState(event)}</p>
      ${event.type === "BORROW" ? html`<p class="ss-receipt__tip">Return it from <strong>Return</strong> on this phone, so it links to this loan.</p>` : ""}
      <div class="ss-receipt__actions">
        <button type="button" class="button button--primary button--lg button--block" data-done>Done</button>
        ${event.type !== "RETURN" ? html`<button type="button" class="button button--ghost button--block" data-again="${SCREEN_FOR[event.type]}">${ACTION_WORD[event.type]} something else</button>` : ""}
      </div>
    </div>`;
}

function receiptState(event: LocalEvent): Html {
  if (event.state === "synced") return html`<span class="ss-state ss-state--ok">${icon("check")}Sent to Logistics</span>`;
  if (event.state === "review") return html`<span class="ss-state ss-state--review">${icon("info")}${event.message ?? "Staff will check it."}</span>`;
  if (event.state === "rejected") return html`<span class="ss-state ss-state--bad">${icon("alert")}Not recorded: ${event.message ?? "please ask Logistics staff."}</span>`;
  return offline
    ? html`<span class="ss-state ss-state--wait">${icon("cloudOff")}Saved on this phone. It will sync when you're back online.</span>`
    : html`<span class="ss-state ss-state--wait"><span class="ss-spinner" aria-hidden="true"></span>Saved on this phone · syncing…</span>`;
}

/* ---------- My activity ---------- */

const STATE: Record<LocalEvent["state"], [string, string]> = { pending: ["wait", "Waiting to sync"], synced: ["ok", "Synced"], review: ["review", "Staff will check"], rejected: ["bad", "Not recorded"] };

function renderActivity(): void {
  const main = region("screen");
  if (!main) return;
  const counts = summary(events);
  const loans = openLoans(events);
  const recent = [...events].sort((a, b) => b.seq - a.seq);
  const status = syncing && counts.pending ? `Syncing ${counts.pending}…`
    : counts.pending ? `${counts.pending} waiting to sync${offline ? " · you're offline" : ""}`
    : "Everything on this phone is synced.";
  // This screen redraws as records sync; a keyboard user keeps their place on its buttons.
  const focusKey = ["[data-sync]", "[data-clear]", "[data-forget]"].find((selector) => document.activeElement?.matches(selector));
  mount(main, html`<div class="ss-screen">
      ${back("My activity")}
      <div class="ss-sync">
        <p class="ss-sync__status" aria-live="polite">${counts.pending ? "" : icon("check")}${status}</p>
        <button type="button" class="button button--secondary button--sm" data-sync ${syncing ? "disabled" : ""}>${icon("refresh")}Sync now</button>
      </div>
      ${counts.pending ? html`<p class="ss-warning">${icon("alert")}<span>Records wait on this phone until they sync. Don't clear this site's data or delete the app until then.</span></p>` : ""}
      ${loans.length ? html`<h2 class="ss-section">On loan from this phone</h2><ul class="ss-list">${loans.map((loan) => html`<li><a class="ss-row" href="/self-service?do=return&loan=${loan.id}" data-open-loan="${loan.id}">
          <span class="ss-row__main"><span class="ss-row__name">${loan.itemName}${loan.quantity > 1 ? ` ×${loan.quantity}` : ""}</span><span class="ss-row__sub">Borrowed ${when(loan.occurredAt)}</span></span><span class="ss-row__go">Return ${icon("next")}</span></a></li>`)}</ul>` : ""}
      <h2 class="ss-section">Recorded on this phone</h2>
      ${recent.length ? html`<ul class="ss-timeline">${recent.map((event) => {
        const [tone, text] = STATE[event.state];
        return html`<li class="ss-event"><div><p class="ss-event__what">${event.itemName}${event.quantity > 1 ? html` <span class="muted">×${event.quantity}</span>` : ""}</p>
            <p class="ss-event__when">${verb(event)} ${when(event.occurredAt)}</p>
            ${event.message ? html`<p class="ss-event__note">${event.message}</p>` : ""}</div>
          <span class="tag tag--${tone === "wait" ? "pending" : tone === "review" ? "gold" : tone}">${text}</span></li>`;
      })}</ul>` : emptyNote("Nothing yet. What you take, borrow, use and return with this phone shows up here.")}
      <div class="ss-housekeeping">
        <button type="button" class="button button--ghost button--sm" data-clear ${events.some((event) => event.state !== "pending") ? "" : "disabled"}>Clear synced history</button>
        ${profile.name ? html`<button type="button" class="button button--ghost button--sm" data-forget>Forget my details</button>` : ""}
      </div>
      <p class="ss-fine">Your records stay on this phone for 30 days after they sync, then clear themselves. Photos are deleted from the phone as soon as Logistics receives them.</p>
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
      <p class="ss-fine">Records made offline wait on your phone and sync by themselves when you're back online. Don't clear this site's data or delete the app while any are waiting.</p>
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

/** The screen currently drawn under any sheet, so closing a sheet never redraws (or scrolls) it. */
let renderedScreen: Screen | null = null;

function renderScreen(): void {
  const { screen } = params();
  renderedScreen = screen;
  // The campus photograph belongs to home (see self-service.css), and to the closed notice.
  document.body.dataset.ssScreen = paused ? "home" : screen;
  if (paused) { renderPaused(); document.title = "Under maintenance · Self-Service"; return; }
  if (screen === "home") renderHome();
  else if (screen === "activity") renderActivity();
  else if (screen === "install") renderInstall();
  else renderList(screen === "return" ? "return" : "get");
  document.title = screen === "home" ? "Self-Service · HAU USC Logistics" : `${screen === "activity" ? "My activity" : screen === "install" ? "Install" : SCREEN_COPY[screen === "return" ? "return" : "get"].title} · Self-Service`;
}

/** Wires one sheet form to its action. The record is saved on the phone first, then synced. */
function bindForm(form: HTMLFormElement, item: CatalogItem | undefined, loan: LocalEvent | undefined, onSaved: (event: LocalEvent) => void): void {
  const type = form.dataset.form as Draft["type"];
  const alert = form.querySelector<HTMLElement>("[data-alert]")!;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]")!;
  const quantity = form.querySelector<HTMLInputElement>("input[name=quantity]");
  const available = item && snapshot ? estimate(snapshot, events).get(item.id) ?? 0 : 0;
  let photo: Blob | null = null;
  let preparing: Promise<void> | null = null;

  /** Keeps the form's dependent parts (labels, hints, optional fields) in step with its input. */
  const updateFields = () => {
    const count = Math.max(1, Math.min(SELF_SERVICE_LIMITS.quantity, Math.round(Number(quantity?.value) || 1)));
    const label = form.querySelector("[data-qty-label]");
    if (label && item) label.textContent = `Take ${count} ${units(count, item.unit)}`;
    const over = form.querySelector<HTMLElement>("[data-over]");
    if (over && item && type !== "RETURN") {
      over.hidden = count <= available;
      over.textContent = available <= 0 ? "The records show none left. If you have it in hand, record it anyway; staff will recount." : `That's more than the ${available} the records show. Staff will be asked to recount.`;
    }
    const purpose = form.querySelector<HTMLInputElement>("input[name=purpose]:checked, input[type=hidden][name=purpose]")?.value;
    const reason = form.querySelector<HTMLElement>("[data-reason]");
    if (reason) reason.hidden = purpose !== "USC";
    const idField = form.querySelector<HTMLElement>("[data-student-id]");
    if (idField && type === "BORROW") {
      const required = purpose !== "USC";
      idField.querySelector("input")!.required = required;
      mount(idField.querySelector("label")!, html`Student ID number ${required ? "" : html`<span class="field__optional">optional</span>`}`);
    }
    const outcome = form.querySelector<HTMLInputElement>("input[name=outcome]:checked")?.value;
    const note = form.querySelector<HTMLElement>("[data-note]");
    if (note) {
      note.hidden = !outcome || outcome === "RETURNED";
      form.querySelector("[data-note-label]")!.textContent = outcome === "LOST" ? "What happened?" : "What's damaged?";
    }
  };

  form.addEventListener("input", () => {
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
    if (target.closest("[data-pick]")) form.querySelector<HTMLInputElement>("#ss-photo")?.click();
    if (target.closest("[data-clear-photo]")) { photo = null; showPhoto(null); }
  });

  const photoBox = form.querySelector<HTMLElement>("[data-photo]");
  const showPhoto = (preview: string | null) => {
    if (!photoBox) return;
    mount(photoBox, preview
      ? html`<img class="photo-field__preview" src="${preview}" alt="Photo to attach" /><div class="photo-field__actions"><button type="button" class="button button--secondary button--sm" data-pick>${icon("camera")}Retake</button><button type="button" class="button button--ghost button--sm" data-clear-photo>Remove</button></div>`
      : photoPick(type === "RETURN" ? "Take a photo of the item" : undefined));
  };
  form.querySelector<HTMLInputElement>("#ss-photo")?.addEventListener("change", (event) => {
    const chosen = (event.target as HTMLInputElement).files?.[0];
    if (!chosen) return;
    dirty = true;
    if (photoBox) mount(photoBox, html`<p class="photo-field__busy">Preparing the photo…</p>`);
    preparing = (async () => {
      try {
        photo = await shrinkPhoto(chosen, SELF_SERVICE_LIMITS.photoBytes);
        showPhoto(await dataUrl(photo));
      } catch (error) {
        photo = null;
        showPhoto(null);
        setMessage(alert, error instanceof Error ? error.message : "This photo could not be read.");
      } finally {
        preparing = null;
      }
    })();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    if (preparing) await preparing;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim().replace(/\s+/g, " ");
    const studentId = String(data.get("studentId") ?? "").trim().toUpperCase();
    const purpose = String(data.get("purpose") ?? "INDIVIDUAL") as "INDIVIDUAL" | "USC";
    const reason = String(data.get("reason") ?? "").trim();
    const outcome = String(data.get("outcome") ?? "RETURNED") as "RETURNED" | "DAMAGED" | "LOST";
    const note = String(data.get("note") ?? "").trim();
    const count = Math.round(Number(data.get("quantity") ?? loan?.quantity ?? 1));
    // The first problem, and the field to fix it in.
    const [problem, field] = !loan && !name ? ["Please enter a name.", "#ss-name"]
      : type === "BORROW" && purpose === "INDIVIDUAL" && !studentId ? ["Your student ID number is needed for individual use.", "#ss-student"]
      : studentId && !STUDENT_ID_PATTERN.test(studentId) ? ["The student ID may use only letters, digits and dashes.", "#ss-student"]
      : type === "BORROW" && purpose === "USC" && !reason ? ["Say what it's for.", "#ss-reason"]
      : type === "BORROW" && !photo ? ["Take a photo holding the item.", "[data-pick]"]
      : type === "RETURN" && !photo ? ["Take a photo of the item you are returning.", "[data-pick]"]
      : type === "RETURN" && outcome !== "RETURNED" && !note ? [outcome === "LOST" ? "Say what happened." : "Say what's damaged.", "#ss-note"]
      : !Number.isInteger(count) || count < 1 || count > SELF_SERVICE_LIMITS.quantity ? [`Choose a quantity from 1 to ${SELF_SERVICE_LIMITS.quantity}.`, "#ss-qty"] : ["", ""];
    if (problem) {
      setMessage(alert, problem);
      const invalid = form.querySelector<HTMLElement>(field);
      invalid?.setAttribute("aria-invalid", "true");
      invalid?.focus();
      navigator.vibrate?.([20, 40, 20]);
      return;
    }
    submit.disabled = true;
    const target = loan ? { itemId: loan.itemId, itemName: loan.itemName, unit: loan.unit } : { itemId: item!.id, itemName: item!.name, unit: item!.unit };
    const person = loan ? loan.person : { name, ...(studentId ? { studentId } : {}) };
    const draft: Draft = type === "TAKE" || type === "USE" ? { type, ...target, quantity: count, person: { name } }
      : type === "BORROW" ? { type, ...target, quantity: count, person, purpose, ...(purpose === "USC" ? { reason } : {}), returnBy: String(data.get("returnBy") || "") || null }
      : { type, ...target, quantity: loan?.quantity ?? count, person, loanEventId: loan?.id ?? null, outcome, ...(outcome === "RETURNED" ? {} : { note }) };
    try {
      const saved = await record(draft, photo ?? undefined);
      if (type !== "RETURN" && name) {
        profile = { name, studentId: type === "BORROW" ? studentId || profile.studentId : profile.studentId };
        void store.setMeta("profile", profile);
      }
      dirty = false;
      navigator.vibrate?.(15);
      onSaved(saved);
      void requestPersistence();
      void requestBackgroundSync();
    } catch {
      submit.disabled = false;
      setMessage(alert, "This phone could not save the record. Check that you're not in private browsing, then try again.");
    }
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
  const dialog = document.querySelector<HTMLDialogElement>("#ss-sheet")!;
  let receiptFor: string | null = null;
  /** Set when code closes the sheet and moves the address itself. */
  let steering = false;
  const control = sheet(dialog, {
    dirty: () => dirty,
    onClose: () => {
      dirty = false;
      receiptFor = null;
      // Closing with X, Escape or the backdrop also steps the address back.
      const { item, loan } = params();
      if ((item || loan) && !steering) window.history.back();
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
    const { screen, item: itemId, loan: loanId } = params();
    if (paused) { if (dialog.open) { steering = true; control.close(true); } return; }
    if (receiptFor) return;
    if (!itemId && !loanId) { if (dialog.open) control.close(true); return; }
    if (dialog.open && shown === `${screen}:${itemId}:${loanId}`) return;
    shown = `${screen}:${itemId}:${loanId}`;
    const loan = loanId ? events.find((event) => event.id === loanId && event.type === "BORROW") : undefined;
    const item = itemById(itemId) ?? (loan ? itemById(loan.itemId) : undefined);
    // A return is only ever for a borrow made on this phone.
    if (screen === "return" ? !loan : !item) { if (snapshot || screen === "return") go({ item: null, loan: null }, true); return; }
    // The item's own action decides the sheet, whatever an old link or shortcut asked for.
    const body = screen === "return" ? returnSheet(loan!) : SHEETS[item!.action](item!);
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
    if (window.matchMedia("(pointer: fine)").matches) form.querySelector<HTMLInputElement>("input:not([type=hidden]):not([type=radio]):not([type=file])")?.focus();
  };

  const show = () => {
    renderScreen();
    refreshRegions();
    syncSheet();
  };

  ownQuery(() => {
    // Back while a form has input asks first, and stays put if the answer is no.
    if (dialog.open && dirty && !params().item && !params().loan && !window.confirm("Discard what you've entered?")) {
      window.history.forward();
      return;
    }
    const { screen, item, loan } = params();
    if (item || loan) { syncSheet(); return; }
    // The address moved on (back, Done): the sheet goes, and the address already reflects it.
    if (dialog.open) { receiptFor = null; steering = true; control.close(true); }
    // Closing a sheet keeps the list, and its scroll position, as it was.
    if (screen === renderedScreen) return;
    renderScreen();
    refreshRegions();
    window.scrollTo(0, 0);
  });

  // One delegated listener for the whole app (the sheet is inside it too).
  app.addEventListener("click", clickHandler);
  function clickHandler(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const goTo = target.closest<HTMLAnchorElement>("[data-go]");
    if (goTo) { event.preventDefault(); go({ screen: goTo.dataset.go as Screen, item: null, loan: null }); return; }
    const open = target.closest<HTMLAnchorElement>("[data-open-item]");
    if (open) { event.preventDefault(); go({ screen: (open.dataset.screen as Screen) ?? params().screen, item: open.dataset.openItem!, loan: null }); return; }
    const openLoan = target.closest<HTMLAnchorElement>("[data-open-loan]");
    if (openLoan) { event.preventDefault(); go({ screen: "return", item: null, loan: openLoan.dataset.openLoan! }); return; }
    if (target.closest("[data-back]")) { event.preventDefault(); goBack(); return; }
    const themeToggle = target.closest<HTMLElement>("[data-theme-toggle]");
    if (themeToggle) { switchTheme(themeToggle); return; }
    if (target.closest("[data-done]")) { closeAnd(goHome); return; }
    const again = target.closest<HTMLElement>("[data-again]");
    // "Take something else" steps back to the list the item was picked from.
    if (again) { closeAnd(() => { if (renderedScreen === again.dataset.again) goBack(); else go({ screen: again.dataset.again as Screen, item: null, loan: null }, true); }); return; }
    if (target.closest("[data-install]")) { void promptInstall().then((accepted) => { if (accepted) renderScreen(); }); return; }
    if (target.closest("[data-apply-update]")) { applyUpdate(); return; }
    if (target.closest("[data-sync]")) { void runSync(true).then(() => poll()); return; }
    if (target.closest("[data-clear]")) { void clearHistory(); return; }
    if (target.closest("[data-forget]") && window.confirm("Forget your name and student ID on this phone?")) {
      profile = { name: "", studentId: "" };
      void store.setMeta("profile", profile).then(renderScreen);
    }
  }

  function goBack(): void {
    const depth = (window.history.state as { ssDepth?: number } | null)?.ssDepth ?? 0;
    if (depth > 0) window.history.back();
    else go({ screen: "home", item: null, loan: null }, true);
  }

  const onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "ss-find") renderResults(input.value);
    else if (input.matches("[data-search]")) {
      listQuery = input.value;
      const rows = region("rows");
      const { screen } = params();
      if (rows && inList(screen)) mount(rows, listRows());
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
    if (!dialog.open && (params().item || params().loan)) syncSheet();
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
  async function poll() {
    window.clearTimeout(pollTimer);
    if (document.visibilityState !== "visible") return;
    const result = await refreshCatalog();
    offline = result === "offline";
    // Offline, the phone keeps what it last heard; opening or closing redraws whatever is on screen.
    const closed = result === "offline" ? paused : result === "paused";
    if (closed !== paused) {
      const redraw = Boolean(closed) !== Boolean(paused) && renderedScreen !== null;
      paused = closed;
      // A test never tells this browser's own Self-Service that it is open.
      if (!testing) void store.setMeta("paused", closed);
      if (redraw) show();
    }
    if (result !== "updated") refreshRegions();
    // Records waiting for staff learn their decision (the "changed" message redraws them).
    if (result === "updated" || result === "unchanged") await checkDecisions();
    pollTimer = window.setTimeout(() => void poll(), CATALOG_POLL_MS);
  }
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    void runSync();
    void poll();
    void refreshReadiness();
  };
  const goneOffline = () => { offline = true; refreshRegions(); updateReceipt(); };
  const backOnline = () => { offline = false; refreshRegions(); void runSync(true); void poll(); };

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
