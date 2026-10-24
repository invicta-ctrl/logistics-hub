/*
 * The staff shell every staff page shares: the session and where a session that cannot use the workspace is sent, the app bar with
 * its sections, menu, search and attention bell, sign-out, and the sign-in page. It stays apart from the Items screen (staff.ts), so
 * sign-in and the other staff pages never download that screen (V1.16 bounded modularity amendment, MA2).
 */
import type { DepartmentCode } from "./directory-policy";
import { setAccess } from "./catalogue-store";
import { staffDark } from "./theme";
import { ApiError, CREST, MARK, type Html, type IconName, api, app, emptyState, expired, failure, forgetKept, formatDate, html, icon, keepFor, mount, navigate, noteBuild, onLeave, prefetch, setMessage, takePrefetched, toast } from "./ui";

export type Role = "STAFF" | "ADMIN" | "OWNER";
/** Who a sign-in is for: the staff of a USC department (DoL, DEM, …), an officer, or an administrator or owner (accounts.ts). */
export type Access = DepartmentCode | "OFFICER" | "ADMIN" | "OWNER";
/** A session's access; one from a server before access groups is what the role alone meant (STAFF: Logistics staff). */
export const sessionAccess = (session: Pick<Session, "role"> & { access?: Access }): Access => session.access ?? (session.role === "STAFF" ? "DoL" : session.role);
export const accessLabel = (access: Access | string): string => access === "OFFICER" ? "Officer" : access === "ADMIN" ? "Administrator" : access === "OWNER" ? "Owner" : `${access} Staff`;
export type Session = {
  /** `build`: the release the Worker is running (V1.16.4), so a tab on an older one reloads at its next page move. */
  build?: string | null;
  id: string; username: string; displayName: string; role: Role; access?: Access; hub?: boolean; mustChangePassword: boolean; recovery: { configured: boolean; createdAt: string | null } | null; selfServiceReviews: number; selfServiceClosed: boolean;
  /** The Staff Directory entry linked to this sign-in, if an administrator linked one. */
  directory: { name: string; department: string; position: string | null } | null;
};
type Section = "home" | "items" | "stock" | "locations" | "kits" | "catalogue" | "loans" | "self-service" | "activity" | "attention" | "admin" | "account";


/**
 * The staff destinations, grouped as the rail shows them (LH-IP02-S01). Home leads without a label; on phones Home, Find and More sit in
 * the bottom bar and every other destination is listed under More. Cataloguing is not one of them (LH-IP02-S03): administrators start it
 * from Administration › Catalog, and everyone else catalogues in the installed Catalog app.
 */
const SECTIONS: ReadonlyArray<{ id: Section; href: string; text: string; icon: IconName; group: string }> = [
  { id: "home", href: "/staff/home", text: "Home", icon: "home", group: "" },
  { id: "items", href: "/staff/items", text: "Items", icon: "box", group: "Resources" },
  { id: "stock", href: "/staff/stock", text: "Stock", icon: "stack", group: "Resources" },
  { id: "locations", href: "/staff/locations", text: "Locations", icon: "pin", group: "Resources" },
  { id: "kits", href: "/staff/kits", text: "Kits", icon: "basket", group: "Resources" },
  { id: "loans", href: "/staff/loans", text: "Loans", icon: "swap", group: "Circulation" },
  { id: "self-service", href: "/staff/self-service", text: "Self-Service", icon: "phone", group: "Circulation" },
  { id: "activity", href: "/staff/activity", text: "Activity", icon: "history", group: "Records" },
  { id: "admin", href: "/staff/admin", text: "Administration", icon: "shield", group: "Manage" }
];

/** Locations and Kits load as part of Items; their own address decides which rail entry is current. Attention is Home's queue. */
function currentSection(section: Section): Section {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path.startsWith("/staff/locations")) return "locations";
  if (path.startsWith("/staff/kits")) return "kits";
  return section === "attention" ? "home" : section;
}

/**
 * The icon rail (tablet widths) names each control in a tooltip: after a short pause under a mouse or pen, at once on keyboard focus.
 * It is one label in the top layer, so no scrolling rail can clip it; Escape puts it away, and the name is already each control's own.
 */
function railTips(): void {
  const tip = document.querySelector<HTMLElement>(".rail-tip");
  const bar = document.querySelector<HTMLElement>(".app-bar");
  if (!tip || !bar || !("showPopover" in HTMLElement.prototype)) return;
  const compact = window.matchMedia("(min-width: 761px) and (max-width: 1180px)");
  let timer = 0;
  let shownFor: Element | null = null;
  const hide = () => {
    window.clearTimeout(timer);
    shownFor = null;
    if (tip.matches(":popover-open")) tip.hidePopover();
  };
  const show = (target: HTMLElement, delay: number) => {
    window.clearTimeout(timer);
    if (!compact.matches) return;
    timer = window.setTimeout(() => {
      if (!target.isConnected) return;
      const box = target.getBoundingClientRect();
      tip.textContent = target.dataset.tip ?? "";
      tip.style.left = `${Math.round(box.right + 8)}px`;
      tip.style.top = `${Math.round(box.top + box.height / 2)}px`;
      shownFor = target;
      if (!tip.matches(":popover-open")) tip.showPopover();
    }, delay);
  };
  const tipped = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null;
  bar.addEventListener("pointerover", (event) => {
    const target = tipped(event.target);
    if (target && target !== shownFor && event.pointerType !== "touch") show(target, 400);
  });
  bar.addEventListener("pointerout", (event) => { const target = tipped(event.target); if (target && !target.contains(event.relatedTarget as Node | null)) hide(); });
  bar.addEventListener("focusin", (event) => { const target = tipped(event.target); if (target?.matches(":focus-visible")) show(target, 0); });
  bar.addEventListener("focusout", hide);
  bar.addEventListener("click", hide);
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", hide, { passive: true, capture: true });
  onLeave(() => { hide(); document.removeEventListener("keydown", onKey); window.removeEventListener("scroll", hide, { capture: true }); });
}

/**
 * The signed-in account, kept for this page's lifetime so moving between staff pages draws at once (Earl, 2026-10-24). Every move still
 * asks the Worker again in the background, and a sign-out, an ended session or a required password change takes effect there. An account
 * that must change its password, or one outside the Hub, is never kept.
 */
let known: Session | null = null;
/** The page that last drew with the kept account. A page drawing itself again (after a change made on it) asks afresh. */
let knownOn = "";
/** Forgets the kept account and every answer kept for it: after signing out or in, and after changing one's own profile or password. */
export const forgetSession = (): void => { known = null; forgetKept(); };
/** Where an account must go instead of this section, if anywhere. */
const elsewhere = (session: Session, section: Section): string | null =>
  // Staff of other departments and officers have their account page only (the Worker refuses the rest anyway).
  (session.mustChangePassword || session.hub === false) && section !== "account" ? "/staff/account" : null;
/** The reads a page move may draw from at once (ui.ts): catalog-shaped, the same for every account, and never about a borrower. */
const KEPT = ["/api/staff/inventory", "/api/staff/stock", "/api/staff/locations", "/api/staff/kits"];
const keep = (session: Session) => {
  noteBuild(session.build);
  known = session.mustChangePassword || session.hub === false ? null : session;
  // Answers are kept for one account at a time: another account's are dropped here.
  if (known) keepFor(known.id, KEPT); else forgetKept();
};
// A cold staff page asks who is signed in as soon as this code runs, while the page's own code may still be loading (V1.16.4 §4.8).
if (window.location.pathname.startsWith("/staff/") && window.location.pathname !== "/staff/catalogue" && navigator.onLine) prefetch("/api/staff/session");

/*
 * Every staff tab hears when another signs out or in (V1.16.4 §4.8), on one channel that carries nothing but the event. A sign-out
 * elsewhere ended this tab's session too: it forgets what it kept and goes to sign in (asking first while something is unsaved). A
 * sign-in elsewhere replaced the account behind this tab, so the next page asks afresh who that is.
 */
const sessions = "BroadcastChannel" in window ? new BroadcastChannel("staff-session") : null;
sessions?.addEventListener("message", (event: MessageEvent<{ type?: string }>) => {
  known = null;
  forgetKept();
  if (event.data?.type === "signed-out" && window.location.pathname.startsWith("/staff/") && window.location.pathname !== "/staff/catalogue") expired();
});
const tellOtherTabs = (type: "signed-in" | "signed-out") => { try { sessions?.postMessage({ type }); } catch { /* another tab finds out from the Worker */ } };

/** Loads the signed-in account, or routes to sign-in / the forced password change. */
export async function loadSession(section: Section): Promise<Session | null> {
  const page = window.location.pathname;
  if (known && navigator.onLine && page !== knownOn) {
    const held = known;
    knownOn = page;
    // Draw now with the account already known; the Worker's answer arrives behind it and is what the next move uses.
    void api<Session>("/api/staff/session").then((fresh) => {
      keep(fresh);
      const away = elsewhere(fresh, section);
      if (away && window.location.pathname === page) navigate(away, true);
    }).catch((error) => {
      if (!(error instanceof ApiError && error.status === 401)) return;
      known = null;
      if (window.location.pathname === page) expired();
    });
    return held;
  }
  try {
    const session = await (takePrefetched<Session>("/api/staff/session") ?? api<Session>("/api/staff/session"));
    const away = elsewhere(session, section);
    if (away) { navigate(away, true); return null; }
    keep(session);
    knownOn = page;
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { forgetKept(); navigate("/staff", true); return null; }
    // Staff tools never work offline (there are no offline credentials); Self-Service does.
    const offline = error instanceof ApiError && error.status === 0;
    mount(app, html`<main id="main-content" class="container page-message">${offline
      ? emptyState("Staff tools need a connection", "You're offline. Items, stock, loans and administration work only online, so nothing is changed on this device. Self-Service keeps working offline.", html`<a class="button button--secondary" href="${window.location.pathname}" data-route>Try again</a> <a class="button button--ghost" href="/self-service" data-route>Open Self-Service</a>`, "error", 1)
      : emptyState("The staff workspace is unavailable", failure(error), html`<a class="button button--secondary" href="/staff/items" data-route>Try again</a>`, "error", 1)}</main>`);
    return null;
  }
}

/**
 * The one staff app shell (LH-IP02-S01). On desktop and tablet `header.app-bar` is the oxblood rail: brand, Find, the attention bell, the
 * grouped sections, and the department and account pinned at the bottom. On phones it is a top bar, and Home, Find and More sit in a bottom
 * bar; More opens the account menu (My account, Lending Hub, Sign out), which on phones also lists every other section, so each destination
 * has exactly one place per layout. Home is the one current destination for both of its entries (Home and Attention).
 */
export function shell(session: Session, section: Section, main: Html): void {
  const here = currentSection(section);
  const current = (id: Section) => here === id ? html`aria-current="page"` : "";
  const sections = session.mustChangePassword || session.hub === false ? [] : SECTIONS.filter((entry) => entry.id !== "admin" || session.role !== "STAFF");
  const reviews = session.selfServiceReviews;
  const badge = (id: Section) => id === "self-service" && reviews
    ? html`<span class="nav-badge" aria-hidden="true">${reviews}</span><span class="visually-hidden">, ${reviews} ${reviews === 1 ? "record" : "records"} to check</span>`
    : id === "loans" || id === "stock" ? html`<span class="attn-slot" data-attention="${id === "loans" ? "Loans" : "Stock"}"></span>` : "";
  const overflow = sections.filter((entry) => entry.id !== "home");
  const groups = [...new Set(sections.map((entry) => entry.group))];
  const avatar = html`<span class="avatar" aria-hidden="true">${initials(session.displayName)}</span>`;
  mount(app, html`
    <header class="app-bar">
      <div class="app-bar__inner">
        <a class="app-bar__brand" href="/staff/home" data-route data-tip="Logistics Hub"><span aria-hidden="true">${CREST}</span><span class="app-bar__title">Logistics Hub</span></a>
        ${sections.length ? html`<button class="app-search" type="button" data-tip="Search" data-palette data-admin="${session.role === "STAFF" ? "0" : "1"}" aria-haspopup="dialog" aria-keyshortcuts="${MAC ? "Meta+K" : "Control+K"}">${icon("search")}<span class="app-search__text">Search</span><kbd class="app-search__keys" aria-hidden="true">${SEARCH_KEYS}</kbd></button>` : ""}
        ${sections.length ? html`<a class="app-bell" href="/staff/attention" data-route data-tip="Attention">${icon("bell")}<span class="visually-hidden">Attention</span><span class="attn-slot" data-attention="all"></span></a>` : ""}
        ${sections.length ? html`<nav class="app-nav" aria-label="Sections">
          ${groups.map((group) => html`<div class="app-nav__group">${group ? html`<p class="app-nav__label" aria-hidden="true">${group}</p>` : ""}${sections.filter((entry) => entry.group === group).map((entry) => html`<a class="app-nav__link ${entry.id === "home" ? "" : "app-nav__link--more"}" href="${entry.href}" data-route data-tip="${entry.text}" ${current(entry.id)}>${icon(entry.icon)}<span class="app-nav__text">${entry.text}${badge(entry.id)}</span></a>`)}</div>`)}
          <button class="app-nav__link app-nav__all" type="button" popovertarget="staff-menu" data-tip="All destinations">${icon("dots")}<span class="app-nav__text">All destinations</span></button>
          <button class="app-nav__link app-nav__find" type="button" data-find>${icon("search")}<span class="app-nav__text">Find</span></button>
          <button class="app-nav__link app-nav__more ${overflow.some((entry) => entry.id === here) || here === "account" ? "is-current" : ""}" type="button" popovertarget="staff-menu">${icon("dots")}<span class="app-nav__text">More</span></button>
        </nav>` : ""}
        <p class="app-bar__dept"><span aria-hidden="true">${MARK}</span><span class="app-bar__dept-text">Department of Logistics<small>HAU USC</small></span></p>
        <button class="account" type="button" popovertarget="staff-menu" data-tip="${session.displayName}">${avatar}<span class="account__name"><span class="visually-hidden">Account: </span>${session.displayName}<small>${accessLabel(sessionAccess(session))}</small></span></button>
      </div>
      <div class="rail-tip" popover="manual" aria-hidden="true"></div>
    </header>
    <div class="menu" id="staff-menu" popover>
      <div class="menu__identity">${avatar}<p><strong>${session.displayName}</strong><span>${accessLabel(sessionAccess(session))} · <span class="mono">${session.username}</span></span></p><button class="menu__theme" type="button" data-staff-theme aria-label="Dark theme" aria-pressed="${String(staffDark())}">${icon("sun")}${icon("moon")}</button></div>
      ${overflow.length ? html`<ul class="menu__list menu__list--more" aria-label="More sections">${overflow.map((entry) => html`<li><a class="menu__item" href="${entry.href}" data-route ${current(entry.id)}>${icon(entry.icon)}${entry.text}</a></li>`)}</ul>` : ""}
      <ul class="menu__list">
        ${sections.length ? html`<li><a class="menu__item" href="/staff/home" data-route ${current("home")}>${icon("home")}Home</a></li>` : ""}
        <li><a class="menu__item" href="/staff/account" data-route ${current("account")}>${icon("user")}My account</a></li>
        <li><a class="menu__item" href="/lending" target="_blank" rel="noopener">${icon("globe")}Public Lending Hub<span class="visually-hidden"> (opens in a new tab)</span><span class="menu__aside">${icon("external")}</span></a></li>
        <li><button class="menu__item" type="button" id="staff-logout">${icon("signOut")}Sign out</button></li>
      </ul>
    </div>
    <main id="main-content" class="app-main">${main}</main>`);
  // Both openers (the avatar and, on phones, More) report whether the menu is open.
  const menu = document.querySelector<HTMLElement>("#staff-menu")!;
  const openers = document.querySelectorAll('[popovertarget="staff-menu"]');
  const expanded = (open: boolean) => openers.forEach((opener) => opener.setAttribute("aria-expanded", String(open)));
  expanded(false);
  menu.addEventListener("toggle", (event) => expanded((event as ToggleEvent).newState === "open"));
  // Without the Popover API (iOS before 17) the openers simply show and hide the menu.
  const native = "showPopover" in HTMLElement.prototype;
  if (!native) {
    menu.hidden = true;
    openers.forEach((opener) => opener.addEventListener("click", () => { menu.hidden = !menu.hidden; expanded(!menu.hidden); }));
  }
  // A choice closes the menu at once, even for the page already shown or while the next page loads.
  menu.addEventListener("click", (event) => {
    if (!(event.target as Element).closest("a")) return;
    if (native) menu.hidePopover();
    else { menu.hidden = true; expanded(false); }
  });
  document.querySelector("#staff-logout")!.addEventListener("click", signOut);
  railTips();
  if (sections.length) watchAttention();
  const search = document.querySelector<HTMLElement>("[data-palette]");
  if (search) {
    search.addEventListener("click", () => openSearch(search));
    // Pointing at or tabbing to it starts loading the search code and index, so opening rarely waits.
    const warm = () => { void import("./search-palette").then((module) => module.warmPalette()).catch(() => { /* opening reports it */ }); };
    search.addEventListener("pointerenter", warm, { once: true });
    search.addEventListener("focus", warm, { once: true });
    // The phone bottom bar's Find opens the same search as the bar's search button.
    document.querySelector("[data-find]")?.addEventListener("click", () => openSearch(search));
  }
  listenForSearchKey();
}

/* ---------- Global search (V1.11): the button above and Ctrl+K / ⌘K open search-palette.ts, loaded on first use. ---------- */

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const SEARCH_KEYS = MAC ? "⌘K" : "Ctrl K";

function openSearch(button: HTMLElement): void {
  void import("./search-palette").then((module) => module.togglePalette(button.dataset.admin === "1"))
    .catch(() => toast("Search could not load. Check your connection and try again.", "error"));
}

let searchKey = false;
/** Ctrl+K (⌘K on a Mac; Control-K there stays the text-editing key) opens and closes search wherever the shell shows its button. */
function listenForSearchKey(): void {
  if (searchKey) return;
  searchKey = true;
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey || event.isComposing || !(MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
    const button = document.querySelector<HTMLElement>("[data-palette]");
    if (!button) return;
    // Another dialog (an item, a form) keeps the keyboard: search never opens over it.
    const open = document.querySelector("dialog[open]");
    if (open && !open.classList.contains("palette")) return;
    event.preventDefault();
    openSearch(button);
  });
}

/*
 * The attention count in the shell: a bell with the total, and a number on Loans and Stock. It is one small request after the page is
 * drawn, kept for 30 seconds so moving between pages never waits on it, and it fails quietly: the shell works without it.
 */
export type AttentionGroup = { reason: string; source: string; label: string; total: number; byUrgency: { NOW: number; SOON: number; LATER: number } };
export type AttentionSummary = { needsAction: number; bySource: Record<string, number>; groups?: AttentionGroup[] };
const SUMMARY_TTL = 30_000;
let summary: { at: number; data: AttentionSummary } | null = null;
let summaryRequest: Promise<void> | null = null;
let summaryTag = "";

const countText = (count: number) => count > 99 ? "99+" : String(count);

function paintAttention(): void {
  if (!summary) return;
  document.dispatchEvent(new Event(ATTENTION_PAINTED));
  const needsAction = summary.data.needsAction ?? 0;
  const bySource = summary.data.bySource ?? {};
  document.querySelectorAll<HTMLElement>("[data-attention]").forEach((slot) => {
    const key = slot.dataset.attention!;
    const count = key === "all" ? needsAction : bySource[key] ?? 0;
    const bell = key === "all";
    slot.innerHTML = count
      ? `<span class="nav-badge" aria-hidden="true">${countText(count)}</span><span class="visually-hidden">${bell ? ", " : ", "}${count} ${bell ? (count === 1 ? "thing needs" : "things need") + " attention" : count === 1 ? "needs attention" : "need attention"}</span>`
      : "";
  });
}

/** The numbers the bar holds now, which Home reads instead of asking again; `null` until the first answer. */
export const attentionNow = (): AttentionSummary | null => summary?.data ?? null;
/** Fired on the document each time the bar's numbers are painted, so a page that shows them (Home) stays in step with the bell. */
export const ATTENTION_PAINTED = "attention:painted";

/** Asks again now (after something was fixed here) or when the kept answer is older than 30 seconds. */
export function refreshAttention(force = false): Promise<void> {
  if (!force && summary && Date.now() - summary.at < SUMMARY_TTL) { paintAttention(); return Promise.resolve(); }
  // Asked with the tag of the last answer: nothing changed (a 304) costs one row instead of the whole summary.
  summaryRequest ??= fetch("/api/staff/attention/summary", { credentials: "same-origin", headers: { accept: "application/json", ...(summaryTag ? { "if-none-match": summaryTag } : {}) } })
    .then(async (response) => {
      if (response.status === 304 && summary) { summary = { at: Date.now(), data: summary.data }; return; }
      if (!response.ok) return;
      summaryTag = response.headers.get("etag") ?? "";
      summary = { at: Date.now(), data: await response.json() as AttentionSummary };
    })
    .catch(() => { /* the numbers are a convenience; the next page tries again */ })
    .finally(() => { summaryRequest = null; paintAttention(); });
  return summaryRequest;
}

function watchAttention(): void {
  void refreshAttention();
  const timer = window.setInterval(() => { if (!document.hidden) void refreshAttention(); }, 60_000);
  onLeave(() => window.clearInterval(timer));
}

/** Signs out here, in the staff workspace or the Catalog. */
export async function signOut(): Promise<void> {
  forgetSession();
  try { await api("/api/staff/logout", { method: "POST" }); } catch { /* the session is dropped client-side regardless */ }
  tellOtherTabs("signed-out");
  // Signing out ends offline cataloguing on this device too (the server ended its lease); what waits here stays for the next sign-in.
  await setAccess(null);
  navigate("/staff", true);
}


/* ---------- Sign in ---------- */

export function staffLogin(): void {
  // Whoever signs in next is asked for afresh.
  forgetSession();
  document.title = "Staff sign in · Department of Logistics";
  const ended = new URLSearchParams(window.location.search).has("expired");
  mount(app, html`<main id="main-content" class="auth">
    <section class="auth__panel" aria-labelledby="signin-title">
      <a class="auth__brand" href="/" data-route aria-label="Department of Logistics home">${MARK}</a>
      <h1 id="signin-title">Staff sign in</h1>
      <form id="staff-login" class="form" novalidate>
        <div class="form-alert" id="login-alert" role="alert" hidden></div>
        <div class="field">
          <label for="username">Username</label>
          <input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <div class="input-group">
            <input id="password" name="password" type="password" autocomplete="current-password" required aria-describedby="caps-hint" />
            <button class="input-group__button" type="button" id="toggle-password" aria-label="Show password" aria-pressed="false">${icon("eye")}</button>
          </div>
          <p class="field__hint field__hint--warn" id="caps-hint" hidden>Caps Lock is on.</p>
        </div>
        <button class="button button--primary button--block button--lg" type="submit">Sign in</button>
      </form>
      <p class="auth__foot">Accounts are issued by the Department of Logistics. Forgot your password? Ask an administrator to reset it.</p>
    </section>
    <p class="auth__back"><a class="text-link text-link--light" href="/" data-route>Back to the public site</a></p>
  </main>`);
  const form = document.querySelector<HTMLFormElement>("#staff-login")!;
  const alert = form.querySelector<HTMLDivElement>("#login-alert")!;
  const password = form.querySelector<HTMLInputElement>("#password")!;
  const toggle = form.querySelector<HTMLButtonElement>("#toggle-password")!;
  if (ended) setMessage(alert, "Your session ended. Please sign in again.");
  toggle.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    mount(toggle, icon(show ? "eyeOff" : "eye"));
  });
  const caps = (event: KeyboardEvent) => { form.querySelector<HTMLElement>("#caps-hint")!.hidden = !event.getModifierState?.("CapsLock"); };
  password.addEventListener("keydown", caps);
  password.addEventListener("keyup", caps);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    const values = new FormData(form);
    // Only the username is trimmed; a password is checked exactly as typed.
    const missing = [...form.querySelectorAll<HTMLInputElement>("input[required]")].filter((input) => input.name === "password" ? !input.value : !input.value.trim());
    form.querySelectorAll("input").forEach((input) => input.removeAttribute("aria-invalid"));
    if (missing.length) {
      missing.forEach((input) => input.setAttribute("aria-invalid", "true"));
      setMessage(alert, "Enter your username and password.");
      missing[0].focus();
      return;
    }
    button.disabled = true;
    button.textContent = "Signing in…";
    setMessage(alert, "");
    try {
      const result = await api<{ mustChangePassword: boolean }>("/api/staff/login", { method: "POST", body: JSON.stringify({ username: values.get("username"), password: values.get("password") }) });
      tellOtherTabs("signed-in");
      // The installed Catalog signs in here and goes back to the Catalogue; nothing else is accepted as a destination.
      const next = new URLSearchParams(window.location.search).get("next");
      navigate(result.mustChangePassword ? "/staff/account" : next && /^\/staff\/catalogue(\?session=CS-[0-9a-f-]{36})?$/.test(next) ? next : "/staff/home");
    } catch (error) {
      setMessage(alert, error instanceof Error ? error.message : "Sign-in failed.");
      button.disabled = false;
      button.textContent = "Sign in";
      password.select();
    }
  });
}

/* ---------- Small helpers the staff pages share ---------- */

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", or the date after two months. */
export function ageOf(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `on ${formatDate(iso.slice(0, 10))}`;
}
