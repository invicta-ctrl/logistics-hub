import "./self-service.css";
import { LABELS, SELF_SERVICE_LIMITS } from "./catalog-policy";
import { type CatalogItem, type LocalEvent, type Snapshot, estimate, openLoans, pendingByItem, summary } from "./offline-queue";
import * as store from "./offline-store";
import { type Draft, clearHistory, nextAttemptAt, onSyncMessage, record, refreshCatalog, syncNow } from "./offline-sync";
import { type Readiness, applyUpdate, canPromptInstall, hasUpdate, isStandalone, onPwaChange, platform, promptInstall, readiness, requestBackgroundSync, requestPersistence, whenIdle } from "./pwa";
import { CREST, type Html, MARK, app, categoryName, dataUrl, formatTime, html, icon, mount, navigate, onLeave, ownQuery, reducedMotion, setMessage, sheet, shrinkPhoto, units } from "./ui";

/*
 * Self-Service (/self-service): what a student or staff member sees after scanning the QR code
 * on their own phone. Every action is saved on the phone first (offline-sync.ts) and sent when
 * there is a connection. Screens live in the URL (?do=take&item=ITM-0043) so the phone's back
 * button closes a sheet or steps back; the router hands those changes to this module (ownQuery).
 */

type Screen = "home" | "take" | "borrow" | "return" | "activity" | "install";
type Params = { screen: Screen; item: string | null; loan: string | null };

const SCREENS = new Set<Screen>(["home", "take", "borrow", "return", "activity", "install"]);
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
/** Set by the running screen: what to do once a new record is saved (start a sync). */
let afterSave: () => void = () => void syncNow();

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

/* ---------- Frame ---------- */

function frame(): Html {
  return html`<header class="ss-bar">
      <div class="ss-bar__inner">
        <a class="ss-bar__brand" href="/self-service" data-route aria-label="Self-Service home"><span class="ss-bar__marks" aria-hidden="true">${CREST}${MARK}</span><span class="ss-bar__title">Self-Service<small>HAU USC Logistics</small></span></a>
        <div data-region="pill"></div>
      </div>
      <div class="ss-update" data-region="update" hidden></div>
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
    : offline && counts.pending ? ["offline", `Offline · ${counts.pending} pending`]
    : offline ? ["offline", "Offline"]
    : counts.pending ? ["waiting", `${counts.pending} waiting`]
    : ["ok", "Synced"];
  return html`<a class="ss-pill ss-pill--${tone}" href="/self-service?do=activity" data-route aria-label="${text}. Open My activity."><span class="ss-pill__dot" aria-hidden="true"></span>${text}</a>`;
}

function region(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-region="${name}"]`);
}

/** Refreshes what the data changed, without disturbing a field the person is typing in. */
function refreshRegions(): void {
  const pillRegion = region("pill");
  if (pillRegion) mount(pillRegion, pill());
  const updateRegion = region("update");
  if (updateRegion) {
    updateRegion.hidden = !hasUpdate();
    mount(updateRegion, hasUpdate() ? html`<p>${icon("refresh")}A new version is ready.</p><button type="button" class="button button--gold button--sm" data-apply-update>Update</button>` : html``);
  }
  const { screen } = params();
  const tiles = region("tiles");
  if (tiles) mount(tiles, homeTiles());
  const status = region("status");
  if (status) mount(status, html`${readinessCard()}${installCard()}`);
  if (screen === "activity") { renderActivity(); return; }
  const rows = region("rows");
  if (rows && (screen === "take" || screen === "borrow" || screen === "return")) mount(rows, listRows(screen));
  const loans = region("loans");
  if (loans) mount(loans, loansSection());
}

/* ---------- Home ---------- */

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-PH", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Manila" }).format(new Date()));
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = profile.name.split(" ")[0];
  return first ? `${part}, ${first}.` : `${part}.`;
}

function tile(screen: Screen, name: string, detail: string, glyph: Parameters<typeof icon>[0], badge = ""): Html {
  return html`<a class="ss-tile ss-tile--${screen}" href="/self-service?do=${screen}" data-go="${screen}">
      <span class="ss-tile__icon" aria-hidden="true">${icon(glyph)}</span>
      <span class="ss-tile__name">${name}</span>
      <span class="ss-tile__detail">${detail}</span>
      ${badge ? html`<span class="ss-tile__badge">${badge}</span>` : ""}
    </a>`;
}

function homeTiles(): Html {
  const loans = openLoans(events).length;
  const counts = summary(events);
  const reviews = recentReviews();
  const activityBadge = counts.pending ? `${counts.pending} waiting` : reviews ? `${reviews} with staff` : "";
  const hasTake = snapshot?.items.some((item) => item.action === "TAKE") ?? true;
  const hasBorrow = snapshot?.items.some((item) => item.action === "BORROW") ?? true;
  return html`${hasTake ? tile("take", "Take", "Supplies you use up", "basket") : ""}
    ${hasBorrow ? tile("borrow", "Borrow", "Equipment you bring back", "handoff") : ""}
    ${tile("return", "Return", loans ? `${loans} on loan from this phone` : "Bring back what you borrowed", "giveBack", loans ? String(loans) : "")}
    ${tile("activity", "My activity", "What this phone recorded", "clock", activityBadge)}`;
}

function renderHome(): void {
  const screen = region("screen");
  if (!screen) return;
  mount(screen, html`<div class="ss-home">
      <section class="ss-hero" aria-labelledby="ss-question">
        <p class="ss-hero__hello">${greeting()}</p>
        <h1 id="ss-question">What do you need?</h1>
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
    return html`<section class="ss-ready ss-ready--ok">${icon("check")}<div><h2>Ready for offline use</h2><p>Keep using it without internet; records wait on this phone and send later${updated}.</p></div></section>`;
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
      <div><h2 id="ss-install-title">Install Logistics Hub</h2><p>${ios ? "Add it to your Home Screen once while you're online. Offline recording works from the Home Screen app." : "Use Self-Service faster and keep recording when the office internet is down."}</p></div>
      ${action}
    </section>`;
}

function renderResults(query: string): void {
  const results = region("results");
  if (!results || !snapshot) return;
  const found = query.trim() ? matching(snapshot.items, query).slice(0, 8) : [];
  results.hidden = !found.length && !query.trim();
  const available = estimate(snapshot, events);
  mount(results, found.length
    ? html`${found.map((item) => html`<li><a class="ss-row" href="/self-service?do=${item.action === "TAKE" ? "take" : "borrow"}&item=${item.id}" data-open-item="${item.id}" data-screen="${item.action === "TAKE" ? "take" : "borrow"}">
        <span class="ss-row__main"><span class="ss-row__name">${item.name}</span><span class="ss-row__sub">${item.action === "TAKE" ? "Take" : "Borrow"} · ${categoryName(item.category)}</span></span>
        ${countBadge(item, available.get(item.id) ?? 0)}</a></li>`)}`
    : html`<li class="ss-results__none">Nothing matches “${query}”.</li>`);
}

/* ---------- Item lists ---------- */

const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Name, other names, category and location all match; every word typed must appear. */
function matching(items: CatalogItem[], query: string): CatalogItem[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const haystack = normalize(`${item.name} ${item.aliases ?? ""} ${item.category} ${item.location ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}

function countBadge(item: CatalogItem, available: number): Html {
  if (available <= 0) return html`<span class="ss-count ss-count--out">None left</span>`;
  return html`<span class="ss-count ${available <= 2 ? "ss-count--low" : ""}"><strong>${available}</strong> ${item.action === "TAKE" ? "left" : "free"}</span>`;
}

const SCREEN_COPY = {
  take: { title: "Take", lead: "Supplies you use up. Pick one, say how many, done.", empty: "Nothing is set up for self-service taking yet. Ask Logistics staff." },
  borrow: { title: "Borrow", lead: "Equipment you bring back. You'll need your name and a quick photo.", empty: "Nothing is set up for self-service borrowing yet. Ask Logistics staff." },
  return: { title: "Return", lead: "Bring back what you borrowed.", empty: "" }
} as const;

function renderList(screen: "take" | "borrow" | "return"): void {
  const main = region("screen");
  if (!main) return;
  listQuery = "";
  const copy = SCREEN_COPY[screen];
  // The search box never sits inside a region that refreshes, so a sync never interrupts typing.
  mount(main, html`<div class="ss-screen">
      ${back(copy.title)}
      <p class="ss-lead">${copy.lead}</p>
      ${screen === "return" ? html`<div class="ss-screen" data-region="loans">${loansSection()}</div>` : ""}
      <div class="search-field ss-search">${icon("search")}<input type="search" data-search placeholder="Search ${screen === "take" ? "supplies" : "equipment"}…" aria-label="Search" autocomplete="off" enterkeyhint="search" /></div>
      <div data-region="rows">${listRows(screen)}</div>
    </div>`);
}

/** Borrows made on this phone, one tap each to return (the return is then linked to the exact loan). */
function loansSection(): Html {
  const loans = openLoans(events);
  return html`${loans.length ? html`<h2 class="ss-section">On loan from this phone</h2>
      <ul class="ss-list">${loans.map((loan) => html`<li><a class="ss-row" href="/self-service?do=return&loan=${loan.id}" data-open-loan="${loan.id}">
        <span class="ss-row__main"><span class="ss-row__name">${loan.itemName}${loan.quantity > 1 ? ` ×${loan.quantity}` : ""}</span><span class="ss-row__sub">Borrowed ${when(loan.occurredAt)}${loan.state === "pending" ? " · waiting to sync" : ""}</span></span>
        <span class="ss-row__go">Return ${icon("next")}</span></a></li>`)}</ul>` : ""}
    <h2 class="ss-section">${loans.length ? "Returning something else?" : "What are you returning?"}</h2>`;
}

function back(title: string): Html {
  return html`<div class="ss-head"><button type="button" class="ss-back" data-back aria-label="Back">${icon("back")}</button><h1>${title}</h1></div>`;
}

let listQuery = "";

function listRows(screen: "take" | "borrow" | "return"): Html {
  if (!snapshot) return offline ? emptyNote("The catalog hasn't been downloaded to this phone yet. Connect to the internet once, then try again.") : skeleton();
  const available = estimate(snapshot, events);
  const waiting = pendingByItem(events);
  if (screen === "return") {
    const loanable = matching(snapshot.items.filter((item) => item.action === "BORROW"), listQuery);
    return loanable.length ? html`<ul class="ss-list">${loanable.map((item) => html`<li><a class="ss-row" href="/self-service?do=return&item=${item.id}" data-open-item="${item.id}" data-screen="return">
        <span class="ss-row__main"><span class="ss-row__name">${item.name}</span><span class="ss-row__sub">${categoryName(item.category)}</span></span><span class="ss-row__go">${icon("next")}</span></a></li>`)}</ul>`
      : emptyNote("Nothing matches. Borrowed from the Logistics desk? Return it at the desk.");
  }
  const action = screen === "take" ? "TAKE" : "BORROW";
  const offered = snapshot.items.filter((item) => item.action === action);
  if (!offered.length) return emptyNote(SCREEN_COPY[screen].empty);
  const found = matching(offered, listQuery);
  if (!found.length) return emptyNote(`Nothing matches “${listQuery}”.`);
  // Recently used on this phone first, then by category.
  const recent = [...new Set(events.filter((event) => event.type === action).sort((a, b) => b.seq - a.seq).map((event) => event.itemId))].slice(0, 3)
    .map((id) => found.find((item) => item.id === id)).filter((item): item is CatalogItem => Boolean(item));
  const byCategory = new Map<string, CatalogItem[]>();
  for (const item of found) byCategory.set(item.category, [...byCategory.get(item.category) ?? [], item]);
  const row = (item: CatalogItem) => html`<li><a class="ss-row ${(available.get(item.id) ?? 0) <= 0 ? "ss-row--out" : ""}" href="/self-service?do=${screen}&item=${item.id}" data-open-item="${item.id}" data-screen="${screen}">
      <span class="ss-row__main"><span class="ss-row__name">${item.name}</span>${sub(item, waiting.get(item.id))}</span>
      ${countBadge(item, available.get(item.id) ?? 0)}</a></li>`;
  return html`${recent.length && !listQuery ? html`<h2 class="ss-section">Recent on this phone</h2><ul class="ss-list">${recent.map(row)}</ul>` : ""}
    ${[...byCategory].map(([category, items]) => html`<h2 class="ss-section">${categoryName(category)}</h2><ul class="ss-list">${items.map(row)}</ul>`)}
    ${stamp()}`;
}

/** Other names and where it is kept, plus anything of it still waiting on this phone. */
function sub(item: CatalogItem, waiting = 0): Html {
  const parts = [item.aliases, item.location, waiting ? `${waiting} waiting to sync` : null].filter(Boolean);
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
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(date);
  if (day === today) return formatTime(iso);
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(date);
}

/* ---------- Sheets: Take, Borrow, Return ---------- */

function estimateLine(item: CatalogItem): Html {
  if (!snapshot) return html``;
  const count = estimate(snapshot, events).get(item.id) ?? 0;
  const mine = pendingByItem(events).get(item.id) ?? 0;
  const noun = units(count, item.unit);
  const main = count <= 0 ? "The records show none left." : fresh() ? `${count} ${noun} ${item.action === "TAKE" ? "left" : "available"}.` : `About ${count} ${noun} ${item.action === "TAKE" ? "left" : "available"}.`;
  const note = [mine ? `Includes your ${mine} not yet sent.` : "", fresh() ? "" : `Last synced ${formatTime(new Date(snapshot.fetchedAt).toISOString())}; other offline records may not be counted yet.`].filter(Boolean).join(" ");
  return html`<p class="ss-estimate ${count <= 0 ? "ss-estimate--out" : ""}"><span>${main}</span>${note ? html`<small>${note}</small>` : ""}</p>`;
}

function quantityField(max: number): Html {
  return html`<div class="field"><label for="ss-qty">How many?</label>
      <div class="stepper ss-stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="One less">−</button><input id="ss-qty" name="quantity" type="number" inputmode="numeric" min="1" max="${max}" step="1" value="1" /><button type="button" class="stepper__button" data-step="1" aria-label="One more">+</button></div>
      <p class="field__hint" data-over hidden></p></div>`;
}

const nameField = (label: string) => html`<div class="field"><label for="ss-name">${label}</label><input id="ss-name" name="name" autocomplete="name" autocapitalize="words" maxlength="120" required value="${profile.name}" enterkeyhint="done" /></div>`;
const studentIdField = (required: boolean) => html`<div class="field" data-student-id><label for="ss-student">Student ID number ${required ? "" : html`<span class="field__optional">optional</span>`}</label><input id="ss-student" name="studentId" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30" inputmode="text" value="${profile.studentId}" ${required ? "required" : ""} /></div>`;

function sheetFrame(kicker: string, title: string, body: Html): Html {
  return html`<header class="sheet__header"><div><p class="sheet__kicker">${kicker}</p><h2 id="sheet-title">${title}</h2></div><button class="icon-button" type="button" aria-label="Close" data-close>${icon("close")}</button></header>
    <div class="sheet__body">${body}</div>`;
}

function takeSheet(item: CatalogItem): Html {
  return sheetFrame(`Take · ${categoryName(item.category)}`, item.name, html`
    ${estimateLine(item)}
    <form class="form ss-form" data-form="TAKE" novalidate>
      ${quantityField(SELF_SERVICE_LIMITS.quantity)}
      ${nameField("Your name")}
      <div class="form-alert" role="alert" hidden data-alert></div>
      <button class="button button--primary button--lg button--block" type="submit" data-submit><span data-qty-label>Take 1 ${units(1, item.unit)}</span></button>
    </form>`);
}

function borrowSheet(item: CatalogItem): Html {
  const uscOnly = item.audience === "USC_STAFF_ONLY";
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(date);
  return sheetFrame(`Borrow · ${categoryName(item.category)}`, item.name, html`
    ${estimateLine(item)}
    <form class="form ss-form" data-form="BORROW" novalidate>
      ${uscOnly ? html`<input type="hidden" name="purpose" value="USC" /><p class="callout">${icon("info")}<span>Lent for USC use only. Say what it's for.</span></p>`
        : html`<fieldset class="segmented segmented--2"><legend class="visually-hidden">What is it for?</legend>
          <label><input type="radio" name="purpose" value="INDIVIDUAL" checked /><span>Individual use</span></label><label><input type="radio" name="purpose" value="USC" /><span>USC use</span></label></fieldset>`}
      ${nameField(uscOnly ? "Name of the person using it" : "Your full name")}
      ${studentIdField(!uscOnly)}
      <div class="field" data-reason ${uscOnly ? "" : "hidden"}><label for="ss-reason">Specific reason</label><textarea id="ss-reason" name="reason" rows="2" maxlength="300" placeholder="e.g. stage setup for the general assembly"></textarea></div>
      ${quantityField(SELF_SERVICE_LIMITS.quantity)}
      <fieldset class="ss-choices"><legend>Return by <span class="field__optional">optional</span></legend>
        <label><input type="radio" name="returnBy" value="${day(today)}" /><span>Today</span></label>
        <label><input type="radio" name="returnBy" value="${day(tomorrow)}" /><span>Tomorrow</span></label>
        <label><input type="radio" name="returnBy" value="" checked /><span>Not sure</span></label>
      </fieldset>
      <div class="field">
        <span class="field-label" id="ss-photo-label">Photo <span class="field__optional">required</span></span>
        <input class="visually-hidden" id="ss-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="user" tabindex="-1" aria-labelledby="ss-photo-label" />
        <div class="photo-field" data-photo><button type="button" class="photo-field__pick" data-pick aria-describedby="ss-photo-hint">${icon("camera")}<span>Take a photo holding it</span></button></div>
        <p class="field__hint" id="ss-photo-hint">Your face and the item, together. It stays private to Logistics staff.</p>
      </div>
      <div class="form-alert" role="alert" hidden data-alert></div>
      <button class="button button--primary button--lg button--block" type="submit" data-submit>Borrow</button>
    </form>`);
}

function returnSheet(item: CatalogItem | undefined, loan: LocalEvent | undefined): Html {
  const name = loan?.itemName ?? item?.name ?? "Item";
  return sheetFrame(loan ? `Borrowed ${when(loan.occurredAt)}` : "Return", `Return ${name}${loan && loan.quantity > 1 ? ` ×${loan.quantity}` : ""}`, html`
    <form class="form ss-form" data-form="RETURN" novalidate>
      <fieldset class="segmented ss-condition"><legend class="ss-legend">How is it?</legend>
        <label><input type="radio" name="outcome" value="RETURNED" checked /><span>Good</span></label><label><input type="radio" name="outcome" value="DAMAGED" /><span>Damaged</span></label><label><input type="radio" name="outcome" value="LOST" /><span>Lost</span></label>
      </fieldset>
      <div class="field" data-note hidden><label for="ss-note" data-note-label>What's damaged?</label><textarea id="ss-note" name="note" rows="2" maxlength="300"></textarea></div>
      ${loan ? html`<p class="ss-hint">${icon("check")}Linked to your borrow on this phone, so Logistics knows exactly which loan this is.</p>` : html`
        <p class="ss-hint">${icon("info")}Tell us who borrowed it so Logistics can match the loan.</p>
        ${nameField("Borrower's name")}
        ${studentIdField(false)}
        ${quantityField(SELF_SERVICE_LIMITS.quantity)}`}
      <div class="form-alert" role="alert" hidden data-alert></div>
      <button class="button button--primary button--lg button--block" type="submit" data-submit>Return</button>
    </form>`);
}

/** Shown in the sheet after saving: calm, specific, and it updates itself when the record syncs. */
function receipt(event: LocalEvent): Html {
  const verb = event.type === "TAKE" ? "Taken" : event.type === "BORROW" ? "Borrowed" : event.outcome === "RETURNED" ? "Returned" : event.outcome === "DAMAGED" ? "Returned damaged" : "Reported lost";
  return html`<div class="ss-receipt" role="status">
      <svg class="ss-receipt__mark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="m15 27 7 7 15-16" /></svg>
      <h2 id="sheet-title">${verb}</h2>
      <p class="ss-receipt__what">${event.quantity > 1 ? `${event.quantity} × ` : ""}${event.itemName}</p>
      <p class="ss-receipt__sync" data-receipt="${event.id}">${receiptState(event)}</p>
      ${event.type === "BORROW" ? html`<p class="ss-receipt__tip">Return it from <strong>Return</strong> on this phone, so it links to this loan.</p>` : ""}
      <div class="ss-receipt__actions">
        <button type="button" class="button button--primary button--lg button--block" data-done>Done</button>
        ${event.type !== "RETURN" ? html`<button type="button" class="button button--ghost button--block" data-again="${event.type === "TAKE" ? "take" : "borrow"}">${event.type === "TAKE" ? "Take something else" : "Borrow something else"}</button>` : ""}
      </div>
    </div>`;
}

function receiptState(event: LocalEvent): Html {
  if (event.state === "synced") return html`<span class="ss-state ss-state--ok">${icon("check")}Synced with Logistics</span>`;
  if (event.state === "review") return html`<span class="ss-state ss-state--review">${icon("info")}${event.message ?? "Staff will check it."}</span>`;
  if (event.state === "rejected") return html`<span class="ss-state ss-state--bad">${icon("alert")}Not recorded: ${event.message ?? "please ask Logistics staff."}</span>`;
  return offline
    ? html`<span class="ss-state ss-state--wait">${icon("cloudOff")}Saved on this phone. It will sync when you're back online.</span>`
    : html`<span class="ss-state ss-state--wait"><span class="ss-spinner" aria-hidden="true"></span>Saved on this phone · syncing…</span>`;
}

/* ---------- My activity ---------- */

const VERB: Record<string, string> = { TAKE: "Taken", BORROW: "Borrowed", RETURNED: "Returned", DAMAGED: "Returned damaged", LOST: "Reported lost" };
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
            <p class="ss-event__when">${VERB[event.type === "RETURN" ? event.outcome ?? "RETURNED" : event.type]} ${when(event.occurredAt)}</p>
            ${event.message && event.state !== "synced" ? html`<p class="ss-event__note">${event.message}</p>` : ""}</div>
          <span class="tag tag--${tone === "wait" ? "pending" : tone === "review" ? "gold" : tone}">${text}</span></li>`;
      })}</ul>` : emptyNote("Nothing yet. What you take, borrow and return with this phone shows up here.")}
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
  const ios = platform() === "ios";
  const steps = ios
    ? [html`Open this page in <strong>Safari</strong>.`, html`Tap ${icon("share")}<strong>Share</strong>. On newer iPhones it's in the ${icon("more")} menu next to the address bar; tap <strong>View More</strong> if you don't see the next step.`, html`Tap <strong>Add to Home Screen</strong>, keep <strong>Open as Web App</strong> on, then tap <strong>Add</strong>.`, html`Open <strong>Logistics Hub</strong> from your Home Screen once while online. It's ready when it says <strong>Ready for offline use</strong>.`]
    : [html`Open this page in <strong>Chrome</strong> (or Samsung Internet).`, html`Tap the ${icon("more")} menu, then <strong>Install app</strong> or <strong>Add to Home screen</strong> (newer Chrome: <strong>Install and create shortcut</strong> → <strong>Install</strong>).`, html`Open <strong>Logistics Hub</strong> from your home screen or app drawer.`, html`Wait for <strong>Ready for offline use</strong> before you rely on it offline.`];
  mount(main, html`<div class="ss-screen">
      ${back("Install Logistics Hub")}
      <p class="ss-lead">Install it once while you have internet. After that it opens like an app and keeps recording when the office internet is down.</p>
      ${canPromptInstall() ? html`<button type="button" class="button button--primary button--lg button--block" data-install>${icon("install")}Install now</button>` : ""}
      <ol class="ss-steps">${steps.map((step) => html`<li>${step}</li>`)}</ol>
      <p class="ss-fine">Records made offline wait on your phone and sync by themselves when you're back online. Don't clear this site's data or delete the app while any are waiting.</p>
    </div>`);
}

/* ---------- Behaviour ---------- */

/** The screen currently drawn under any sheet, so closing a sheet never redraws (or scrolls) it. */
let renderedScreen: Screen | null = null;

function renderScreen(): void {
  const { screen } = params();
  renderedScreen = screen;
  if (screen === "home") renderHome();
  else if (screen === "activity") renderActivity();
  else if (screen === "install") renderInstall();
  else renderList(screen);
  document.title = screen === "home" ? "Self-Service · HAU USC Logistics" : `${screen === "activity" ? "My activity" : screen === "install" ? "Install" : SCREEN_COPY[screen].title} · Self-Service`;
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

  const sync = () => {
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

  form.addEventListener("input", () => { dirty = true; setMessage(alert, ""); sync(); });
  form.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const step = target.closest<HTMLElement>("[data-step]");
    if (step && quantity) {
      quantity.value = String(Math.max(1, Math.min(SELF_SERVICE_LIMITS.quantity, (Number(quantity.value) || 1) + Number(step.dataset.step))));
      navigator.vibrate?.(8);
      sync();
    }
    if (target.closest("[data-pick]")) form.querySelector<HTMLInputElement>("#ss-photo")?.click();
    if (target.closest("[data-clear-photo]")) { photo = null; showPhoto(null); }
  });

  const photoBox = form.querySelector<HTMLElement>("[data-photo]");
  const showPhoto = (preview: string | null) => {
    if (!photoBox) return;
    mount(photoBox, preview
      ? html`<img class="photo-field__preview" src="${preview}" alt="Photo to attach" /><div class="photo-field__actions"><button type="button" class="button button--secondary button--sm" data-pick>${icon("camera")}Retake</button><button type="button" class="button button--ghost button--sm" data-clear-photo>Remove</button></div>`
      : html`<button type="button" class="photo-field__pick" data-pick aria-describedby="ss-photo-hint">${icon("camera")}<span>Take a photo holding it</span></button>`);
  };
  form.querySelector<HTMLInputElement>("#ss-photo")?.addEventListener("change", (event) => {
    const chosen = (event.target as HTMLInputElement).files?.[0];
    if (!chosen) return;
    dirty = true;
    if (photoBox) mount(photoBox, html`<p class="photo-field__busy">Preparing the photo…</p>`);
    preparing = (async () => {
      try {
        photo = await shrinkPhoto(chosen);
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
    const problem = !loan && !name ? "Please enter a name."
      : type === "BORROW" && purpose === "INDIVIDUAL" && !studentId ? "Your student ID number is needed for individual use."
      : studentId && !/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(studentId) ? "The student ID may use only letters, digits and dashes."
      : type === "BORROW" && purpose === "USC" && !reason ? "Say what it's for."
      : type === "BORROW" && !photo ? "Take a photo holding the item."
      : type === "RETURN" && outcome !== "RETURNED" && !note ? (outcome === "LOST" ? "Say what happened." : "Say what's damaged.")
      : !Number.isInteger(count) || count < 1 || count > SELF_SERVICE_LIMITS.quantity ? `Choose a quantity from 1 to ${SELF_SERVICE_LIMITS.quantity}.` : "";
    if (problem) {
      setMessage(alert, problem);
      navigator.vibrate?.([20, 40, 20]);
      return;
    }
    submit.disabled = true;
    const target = loan ? { itemId: loan.itemId, itemName: loan.itemName, unit: loan.unit } : { itemId: item!.id, itemName: item!.name, unit: item!.unit };
    const person = loan ? loan.person : { name, ...(studentId ? { studentId } : {}) };
    const draft: Draft = type === "TAKE" ? { type, ...target, quantity: count, person: { name } }
      : type === "BORROW" ? { type, ...target, quantity: count, person, purpose, ...(purpose === "USC" ? { reason } : {}), returnBy: String(data.get("returnBy") || "") || null }
      : { type, ...target, quantity: loan?.quantity ?? count, person, loanEventId: loan?.id ?? null, outcome, ...(outcome === "RETURNED" ? {} : { note }) };
    try {
      const saved = await record(draft, photo ?? undefined);
      if (type !== "RETURN" && name) {
        profile = { name, studentId: type === "TAKE" ? profile.studentId : studentId || profile.studentId };
        void store.setMeta("profile", profile);
      }
      dirty = false;
      navigator.vibrate?.(15);
      onSaved(saved);
      void requestPersistence();
      void requestBackgroundSync();
      afterSave();
    } catch {
      submit.disabled = false;
      setMessage(alert, "This phone could not save the record. Check that you're not in private browsing, then try again.");
    }
  });
  sync();
}

export async function selfService(): Promise<void> {
  document.body.classList.add("is-self-service");
  onLeave(() => document.body.classList.remove("is-self-service"));
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
    if (receiptFor) return;
    if (!itemId && !loanId) { if (dialog.open) control.close(true); return; }
    if (dialog.open && shown === `${screen}:${itemId}:${loanId}`) return;
    shown = `${screen}:${itemId}:${loanId}`;
    const loan = loanId ? events.find((event) => event.id === loanId && event.type === "BORROW") : undefined;
    const item = itemById(itemId) ?? (loan ? itemById(loan.itemId) : undefined);
    if (!loan && !item) { if (snapshot) go({ item: null, loan: null }, true); return; }
    const body = screen === "take" && item?.action === "TAKE" ? takeSheet(item)
      : screen === "borrow" && item?.action === "BORROW" ? borrowSheet(item)
      : returnSheet(item, loan);
    mount(dialog, body);
    control.open();
    dirty = false;
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    bindForm(form, item, loan, (saved) => {
      receiptFor = saved.id;
      mount(dialog, receipt(saved));
      dialog.querySelector<HTMLButtonElement>("[data-done]")?.focus();
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
    const switchScreen = () => { renderScreen(); refreshRegions(); };
    if (document.startViewTransition && !reducedMotion()) document.startViewTransition(switchScreen);
    else switchScreen();
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
      if (rows && (screen === "take" || screen === "borrow" || screen === "return")) mount(rows, listRows(screen));
    }
  };
  const onFind = (event: Event) => { if ((event.target as HTMLElement).matches("[data-find]")) event.preventDefault(); };
  app.addEventListener("input", onInput);
  app.addEventListener("submit", onFind);

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
    if (result !== "updated") refreshRegions();
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
  // An update may apply itself when the person comes back to a screen with nothing unsaved.
  whenIdle(() => !dialog.open && (params().screen === "home" || params().screen === "activity"));
  onLeave(() => {
    unsubscribe();
    unsubscribePwa();
    window.clearTimeout(syncTimer);
    window.clearTimeout(pollTimer);
    window.removeEventListener("online", backOnline);
    window.removeEventListener("offline", goneOffline);
    document.removeEventListener("visibilitychange", wake);
    navigator.serviceWorker?.removeEventListener("controllerchange", refreshReadiness);
    app.removeEventListener("click", clickHandler);
    app.removeEventListener("input", onInput);
    app.removeEventListener("submit", onFind);
    whenIdle(() => false);
  });

  afterSave = () => void runSync();
  onLeave(() => { afterSave = () => void syncNow(); });
  await load();
  show();
  void refreshReadiness();
  // Launch: fetch the latest catalog, then send anything waiting from earlier.
  await poll();
  await runSync();
}
