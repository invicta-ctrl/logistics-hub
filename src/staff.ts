import { ITEM_ICONS, itemIconSvg, resolveItemIcon, suggestItemIcon } from "./item-icons";
import { itemVisualControl } from "./item-visual-control";
import type { DepartmentCode } from "./directory-policy";
import { suggest, type Suggestion } from "./catalogue-suggest";
import { BEHAVIOUR_LABELS, type Behaviour, CONSUMPTION_MODES, ITEM_STATUSES, ITEM_TYPES, openUnitCandidate, LENDING_AUDIENCES, LISTABLE_ITEM_TYPES, PUBLIC_LENDING_ITEM_TYPE, STOCK_AREAS, behaviourFields, listingGaps, stockState } from "./catalog-policy";
import { type Borrower, type Loan, bindLoanForm, loanFields, loanRow, openReturn } from "./loan-form";
import { bindQuantityEditor, movementTitle, quantityEditor, signed } from "./movement-form";
import { type Photo, type PhotoPanel, openViewer, photoPanel, photoUrl, rowThumb } from "./item-photo";
import { MAX_DEPTH, PATH_SEPARATOR, REPORT_LABELS, type ReportKind, VISIBILITY_LABELS, ancestry, inOrder, pathOf, placesOf, withinPlace } from "./location-tree";
import { type Step, openWhereIsIt } from "./where-is-it";
import { type OpenUnit, bindOpenUnits, sealedLine } from "./open-unit-panel";
import { bulkBar } from "./bulk-select";
import { placeList } from "./catalogue-places";
import { setAccess } from "./catalogue-store";
import { ApiError, MARK, type Html, type IconName, animateNumber, api, app, categoryName, emptyState, expired, failure, formatDate, formatDateTime, html, icon, label, live, mount, navigate, onLeave, plural, preservingFocus, raw, setMessage, sheet as createSheet, sheetContent, toast, units, writeParams } from "./ui";

type Item = {
  id: string; name: string; aliases: string | null; category: string; itemType: string; unit: string; status: string; needsReview: boolean;
  lendingAudience: string; onHand: number; reorderThreshold: number; locationId: string | null; legacyLocation: string | null; openReports: number; listed: boolean;
  stockArea: string | null; expiresOn: string | null; reorderStatus: string | null; countNeeded: boolean; lastCountedAt: string | null; onLoan: number;
  consumptionMode: string; openUnits: number; openCondition: string | null; photoId: string | null; visualType?: "SYSTEM_ICON" | "PHOTO" | null; iconKey?: string | null;
  updatedAt: string | null; model: string | null; serialNumber: string | null;
};
/** A place as the Worker lists it (src/locations.ts); paths, depth and order come from location-tree.ts. */
export type PlaceRow = {
  id: string; name: string; parentId: string | null; directions: string | null; visibility: string; active: boolean; updatedAt: string;
  photo: Photo | null; itemCount: number; openReports: number; lastCheckedAt?: string | null;
};
type Inventory = { revision: number; items: Item[]; categories: string[]; locations: PlaceRow[]; units: string[] };
type Report = {
  id: string; kind: ReportKind; source: "STAFF" | "SELF_SERVICE"; note: string | null; createdAt: string; resolvedAt: string | null; resolutionNote: string | null;
  location: string | null; reportedBy: string | null; resolvedBy: string | null;
};
type Movement = { id: string; createdAt: string; movementType: string; signedQuantity: number; status: string; notes: string | null; reason: string | null; related: string | null; actor: string | null; afterQuantity: number; borrower: string | null; purpose: string | null };
type Change = { from: unknown; to: unknown };
type CatalogEvent = { at: string; action: string; actor: string | null; details: Record<string, unknown> };
type DetailItem = Item & {
  location: string | null; notes: string | null; updatedAt: string | null; listingGaps: string[]; photo: Photo | null;
  legacyReportedAvailable: number | null; migratedOnHand: number; migrationDelta: number | null;
  legacySourceSheet: string | null; legacySourceRow: string | null; verificationNote: string | null; importedFrom: string | null;
};
/** Derived from checks of a place and counts (V1.7), never stored: when the item was last seen at its place, and a finding nothing has settled. */
type Freshness = { lastVerifiedAt: string | null; lastCountedAt: string | null; openDiscrepancy: { outcome: string; at: string; auditId: string } | null };
/** A check's finding, as the profile says it. */
const FINDING_WORDS: Record<string, string> = { MISMATCH: "a different count", CANT_FIND: "it couldn’t be found", FOUND_HERE: "it somewhere else", NEEDS_REVIEW: "the record looks wrong" };
/** "today", "yesterday", "5 days ago", "3 weeks ago", or the date after two months. */
export function ageOf(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `on ${formatDate(iso.slice(0, 10))}`;
}
type Detail = { item: DetailItem; movements: Movement[]; events: CatalogEvent[]; loans: Loan[]; openUnits: OpenUnit[]; reports: Report[]; usesRecorded: number; unitsEmptied: number; freshness?: Freshness; kits?: Array<{ id: string; name: string; active: boolean; required: number }> };
type SortKey = "id" | "name" | "category" | "location" | "onHand";
type Tab = "overview" | "loan" | "details" | "history";

const active = (item: Item) => item.status !== "INACTIVE";
const tracksOpenUnits = (item: Pick<Item, "itemType" | "consumptionMode">) => item.itemType === "Consumable" && item.consumptionMode === "OPEN_UNIT";
/** What the open sheet shows of an item's stock; when the list says otherwise, the sheet refreshes. */
const stockSignature = (onHand: number, open: number, condition: string | null) => `${onHand}|${open}|${condition ?? ""}`;
const worstCondition = (units: OpenUnit[]) => ["LOW", "HALF", "PLENTY"].find((condition) => units.some((unit) => unit.condition === condition)) ?? null;
const isLow = (item: Pick<Item, "onHand" | "reorderThreshold" | "status">) => stockState(item) === "LOW";
const VIEWS = {
  all: { label: "All items", test: (_: Item) => true },
  review: { label: "Needs review", test: (item: Item) => item.needsReview },
  ready: { label: "Ready to list", test: (item: Item) => LISTABLE_ITEM_TYPES.has(item.itemType) && !item.listed && active(item) },
  listed: { label: "On Lending Hub", test: (item: Item) => item.listed },
  low: { label: "Low stock", test: (item: Item) => isLow(item) && active(item) },
  out: { label: "Out of stock", test: (item: Item) => item.onHand <= 0 && active(item) },
  inactive: { label: "Inactive", test: (item: Item) => !active(item) },
  gradual: { label: "Used gradually?", test: openUnitCandidate },
  // Shown only while something is waiting: a report from the shelf or a phone, or a typed location that has no place yet.
  reports: { label: "Location reports", test: (item: Item) => item.openReports > 0, quiet: true },
  unplaced: { label: "Needs a place", test: (item: Item) => !item.locationId && Boolean(item.legacyLocation), quiet: true }
} satisfies Record<string, { label: string; test: (item: Item) => boolean; quiet?: true }>;
type View = keyof typeof VIEWS;
const NO_LOCATION = "__none";
/** How staff see the type: their choice between lending an item out and using it up. */
const TYPE_CHOICES: Record<string, string> = { Loanable: "Borrow (Loanable)", Consumable: "Take (Consumable)" };
const FIELD_LABELS: Record<string, string> = {
  name: "Name", aliases: "Other names", category: "Category", itemType: "Type", unit: "Unit", status: "Status", storageLocation: "Place",
  reorderThreshold: "Reorder level", lendingAudience: "Who may borrow", defaultLoanDays: "Loan period (days)", maximumLoanQty: "Maximum per loan",
  needsReview: "Review", notes: "Internal notes", model: "Model", serialNumber: "Serial number", stockArea: "Stock area", expiresOn: "Earliest expiry", consumptionMode: "Normally used"
};
const LENDING_FIELDS = ["lendingAudience", "defaultLoanDays", "maximumLoanQty"];

export type Role = "STAFF" | "ADMIN" | "OWNER";
/** Who a sign-in is for: the staff of a USC department (DoL, DEM, …), an officer, or an administrator or owner (accounts.ts). */
export type Access = DepartmentCode | "OFFICER" | "ADMIN" | "OWNER";
/** A session's access; one from a server before access groups is what the role alone meant (STAFF: Logistics staff). */
export const sessionAccess = (session: Pick<Session, "role"> & { access?: Access }): Access => session.access ?? (session.role === "STAFF" ? "DoL" : session.role);
export const accessLabel = (access: Access | string): string => access === "OFFICER" ? "Officer" : access === "ADMIN" ? "Administrator" : access === "OWNER" ? "Owner" : `${access} Staff`;
export type Session = {
  id: string; username: string; displayName: string; role: Role; access?: Access; hub?: boolean; mustChangePassword: boolean; recovery: { configured: boolean; createdAt: string | null } | null; selfServiceReviews: number; selfServiceClosed: boolean;
  /** The Staff Directory entry linked to this sign-in, if an administrator linked one. */
  directory: { name: string; department: string; position: string | null } | null;
};
type Section = "items" | "stock" | "loans" | "self-service" | "activity" | "attention" | "admin" | "account";

export const ROLE_LABELS: Record<Role, string> = { STAFF: "Staff", ADMIN: "Administrator", OWNER: "Owner" };

/** The staff sections in working order. On phones the first four sit in the bottom bar; `more` ones move under More. */
const SECTIONS: ReadonlyArray<{ id: Section; href: string; text: string; icon: IconName; more?: true }> = [
  { id: "items", href: "/staff/items", text: "Items", icon: "box" },
  { id: "stock", href: "/staff/stock", text: "Stock", icon: "stack" },
  { id: "loans", href: "/staff/loans", text: "Loans", icon: "swap" },
  { id: "self-service", href: "/staff/self-service", text: "Self-Service", icon: "phone" },
  { id: "activity", href: "/staff/activity", text: "Activity", icon: "history", more: true },
  { id: "admin", href: "/staff/admin", text: "Administration", icon: "shield", more: true }
];

/** The two pages of Administration, one link each; both belong to the Administration section of the shell. */
export function adminTabs(current: "accounts" | "directory"): Html {
  const link = (id: typeof current, href: string, text: string) => html`<a class="subnav__link" href="${href}" data-route ${id === current ? html`aria-current="page"` : ""}>${text}</a>`;
  return html`<nav class="subnav" aria-label="Administration">${link("accounts", "/staff/admin", "Accounts & settings")}${link("directory", "/staff/admin/directory", "Staff Directory")}</nav>`;
}

/** Loads the signed-in account, or routes to sign-in / the forced password change. */
export async function loadSession(section: Section): Promise<Session | null> {
  try {
    const session = await api<Session>("/api/staff/session");
    if (session.mustChangePassword && section !== "account") { navigate("/staff/account", true); return null; }
    // Staff of other departments and officers have their account page only (the Worker refuses the rest anyway).
    if (session.hub === false && section !== "account") { navigate("/staff/account", true); return null; }
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { navigate("/staff", true); return null; }
    // Staff tools never work offline (there are no offline credentials); Self-Service does.
    const offline = error instanceof ApiError && error.status === 0;
    mount(app, html`<main id="main-content" class="container page-message">${offline
      ? emptyState("Staff tools need a connection", "You're offline. Items, stock, loans and administration work only online, so nothing is changed on this device. Self-Service keeps working offline.", html`<a class="button button--secondary" href="${window.location.pathname}" data-route>Try again</a> <a class="button button--ghost" href="/self-service" data-route>Open Self-Service</a>`, "error", 1)
      : emptyState("The staff workspace is unavailable", failure(error), html`<a class="button button--secondary" href="/staff/items" data-route>Try again</a>`, "error", 1)}</main>`);
    return null;
  }
}

/**
 * The one staff app shell. Desktop and tablet show every section in the top bar; phones move them to a
 * bottom bar with More. The avatar opens the account menu (My account, Lending Hub, Sign out), which on
 * phones also lists the sections behind More, so each destination has exactly one place per layout.
 */
export function shell(session: Session, section: Section, main: Html): void {
  const current = (id: Section) => section === id ? html`aria-current="page"` : "";
  const sections = session.mustChangePassword || session.hub === false ? [] : SECTIONS.filter((entry) => entry.id !== "admin" || session.role !== "STAFF");
  const reviews = session.selfServiceReviews;
  const badge = (id: Section) => id === "self-service" && reviews
    ? html`<span class="nav-badge" aria-hidden="true">${reviews}</span><span class="visually-hidden">, ${reviews} ${reviews === 1 ? "record" : "records"} to check</span>`
    : id === "loans" || id === "stock" ? html`<span class="attn-slot" data-attention="${id === "loans" ? "Loans" : "Stock"}"></span>` : "";
  const overflow = sections.filter((entry) => entry.more);
  const avatar = html`<span class="avatar" aria-hidden="true">${initials(session.displayName)}</span>`;
  mount(app, html`
    <header class="app-bar">
      <div class="app-bar__inner">
        <a class="app-bar__brand" href="/staff/items" data-route><span aria-hidden="true">${MARK}</span><span class="app-bar__title">Logistics Hub <small>Staff workspace</small></span></a>
        ${sections.length ? html`<nav class="app-nav" aria-label="Sections">
          ${sections.map((entry) => html`<a class="app-nav__link ${entry.more ? "app-nav__link--more" : ""}" href="${entry.href}" data-route ${current(entry.id)}>${icon(entry.icon)}<span class="app-nav__text">${entry.text}${badge(entry.id)}</span></a>`)}
          <button class="app-nav__link app-nav__more ${overflow.some((entry) => entry.id === section) || section === "account" ? "is-current" : ""}" type="button" popovertarget="staff-menu">${icon("dots")}<span class="app-nav__text">More</span></button>
        </nav>` : ""}
        ${sections.length ? html`<a class="app-bell" href="/staff/attention" data-route ${current("attention")}>${icon("bell")}<span class="visually-hidden">Attention</span><span class="attn-slot" data-attention="all"></span></a>` : ""}
        <button class="account" type="button" popovertarget="staff-menu">${avatar}<span class="account__name"><span class="visually-hidden">Account: </span>${session.displayName}<small>${accessLabel(sessionAccess(session))}</small></span></button>
      </div>
    </header>
    <div class="menu" id="staff-menu" popover>
      <div class="menu__identity">${avatar}<p><strong>${session.displayName}</strong><span>${accessLabel(sessionAccess(session))} · <span class="mono">${session.username}</span></span></p></div>
      ${overflow.length ? html`<ul class="menu__list menu__list--more" aria-label="More sections">${overflow.map((entry) => html`<li><a class="menu__item" href="${entry.href}" data-route ${current(entry.id)}>${icon(entry.icon)}${entry.text}</a></li>`)}</ul>` : ""}
      <ul class="menu__list">
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
  if (sections.length) watchAttention();
}

/*
 * The attention count in the shell: a bell with the total, and a number on Loans and Stock. It is one small request after the page is
 * drawn, kept for 30 seconds so moving between pages never waits on it, and it fails quietly: the shell works without it.
 */
type AttentionSummary = { needsAction: number; bySource: Record<string, number> };
const SUMMARY_TTL = 30_000;
let summary: { at: number; data: AttentionSummary } | null = null;
let summaryRequest: Promise<void> | null = null;

const countText = (count: number) => count > 99 ? "99+" : String(count);

function paintAttention(): void {
  if (!summary) return;
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

/** Asks again now (after something was fixed here) or when the kept answer is older than 30 seconds. */
export function refreshAttention(force = false): Promise<void> {
  if (!force && summary && Date.now() - summary.at < SUMMARY_TTL) { paintAttention(); return Promise.resolve(); }
  summaryRequest ??= api<AttentionSummary>("/api/staff/attention/summary")
    .then((data) => { summary = { at: Date.now(), data }; })
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
  try { await api("/api/staff/logout", { method: "POST" }); } catch { /* the session is dropped client-side regardless */ }
  // Signing out ends offline cataloguing on this device too (the server ended its lease); what waits here stays for the next sign-in.
  await setAccess(null);
  navigate("/staff", true);
}


/* ---------- Sign in ---------- */

export function staffLogin(): void {
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
      // The installed Catalog signs in here and goes back to the Catalogue; nothing else is accepted as a destination.
      const next = new URLSearchParams(window.location.search).get("next");
      navigate(result.mustChangePassword ? "/staff/account" : next && /^\/staff\/catalogue(\?session=CS-[0-9a-f-]{36})?$/.test(next) ? next : "/staff/items");
    } catch (error) {
      setMessage(alert, error instanceof Error ? error.message : "Sign-in failed.");
      button.disabled = false;
      button.textContent = "Sign in";
      password.select();
    }
  });
}

/* ---------- Shared item markup ---------- */

function tags(item: Item): Html {
  const list: Html[] = [];
  if (item.listed) list.push(html`<span class="tag tag--ok">On Lending Hub</span>`);
  if (item.needsReview) list.push(html`<span class="tag tag--pending">Needs review</span>`);
  if (item.status !== "ACTIVE") list.push(html`<span class="tag ${item.status === "VERIFY" ? "tag--warn" : ""}">${label(item.status)}</span>`);
  if (item.openUnits > item.onHand) list.push(html`<span class="tag tag--warn">Open units need review</span>`);
  if (item.openReports) list.push(html`<span class="tag tag--warn">Location reported</span>`);
  if (item.onHand <= 0) list.push(html`<span class="tag tag--bad">Out of stock</span>`);
  else if (isLow(item)) list.push(html`<span class="tag tag--warn">Low stock</span>`);
  return html`<span class="tags">${list}</span>`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

/** The metadata a reviewer confirms for a migrated record. */
function reviewChecklist(item: Pick<Item, "category" | "itemType" | "unit" | "locationId">): Array<[string, boolean]> {
  return [
    ["Category chosen", Boolean(item.category) && item.category.toUpperCase() !== "UNSORTED"],
    ["Type classified", item.itemType !== "NEEDS_REVIEW"],
    ["Unit set", Boolean(item.unit)],
    ["Place recorded", Boolean(item.locationId)]
  ];
}

function checklist(entries: Array<[string, boolean]>): Html {
  return html`<ul class="checklist">${entries.map(([text, done]) => html`<li class="${done ? "is-done" : ""}">${icon(done ? "check" : "circle")}<span>${text}${done ? "" : html`<span class="visually-hidden"> (still missing)</span>`}</span></li>`)}</ul>`;
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (field === "needsReview") return value ? "Needs review" : "Reviewed";
  if (field === "category") return categoryName(String(value));
  if (field === "defaultLoanDays" || field === "maximumLoanQty" || field === "reorderThreshold") return Number(value) > 0 ? String(value) : "Not set";
  return label(String(value));
}

/** Turns one audited catalog change into a headline staff can scan. */
function eventTitle(event: CatalogEvent): string {
  if (event.action === "ITEM_CREATED") return "Item created";
  const condition = (event.details.condition as Change | undefined)?.to;
  if (event.action === "UNIT_OPENED") return Number(event.details.alreadyOpen) > 0 ? `Another unit opened (${String(event.details.alreadyOpen)} already open)` : "Unit opened";
  if (event.action === "UNIT_USED") return "Use recorded";
  if (event.action === "UNIT_CONDITION") return `Open unit marked ${label(String(condition)).toLowerCase()}`;
  if (event.action === "UNIT_CORRECTED") return event.details.resolvedDiscrepancy ? "Open unit closed as not opened · discrepancy cleared" : "Open unit closed as not opened";
  if (event.action === "UNIT_RECONCILED") return `Count closed ${plural(Number(event.details.closed), "open unit")}`;
  if (event.action === "ITEM_PHOTO_ADDED") return "Photo added";
  if (event.action === "ITEM_PHOTO_REPLACED") return "Photo replaced";
  if (event.action === "ITEM_VISUAL_CHANGED") return "Item visual changed";
  if (event.action === "ITEM_PHOTO_REMOVED") return "Photo removed";
  if (event.action === "LOCATION_REPORTED") return `Reported: ${REPORT_LABELS[event.details.kind as ReportKind] ?? "location"}${event.details.source === "SELF_SERVICE" ? ` (from a phone${typeof event.details.reporter === "string" ? `, ${event.details.reporter}` : ""})` : ""}`;
  if (event.action === "LOCATION_REPORT_RESOLVED") return `Report resolved: ${REPORT_LABELS[event.details.kind as ReportKind] ?? "location"}`;
  if (event.action === "REORDER_OPENED") return "Added to the restock list";
  if (event.action === "REORDER_RESTOCKED") return `Restocked (+${String(event.details.quantity)})`;
  if (event.action === "LOAN_CLOSED") return event.details.outcome === "LOST" ? "Loan closed · lost" : "Loan closed · returned damaged";
  if (event.action === "REORDER_UPDATED") {
    const status = (event.details.status as Change | undefined)?.to;
    return status === "DISMISSED" ? "Removed from the restock list" : status === "PLANNED" ? "Restock planned" : status === "NEEDS_RESTOCK" ? "Restock re-opened" : "Restock entry updated";
  }
  const change = (field: string) => event.details[field] as Change | undefined;
  if (change("needsReview")) return change("needsReview")!.to ? "Marked for review" : "Review completed";
  if (change("status")?.to === "INACTIVE") return "Deactivated";
  if (change("status")?.from === "INACTIVE") return "Reactivated";
  if (LENDING_FIELDS.some((field) => change(field))) return "Lending settings changed";
  if (change("category") || change("storageLocation")) return change("category") ? "Category changed" : "Place changed";
  return "Details updated";
}

/* ---------- Workspace ---------- */

export async function workspace(): Promise<void> {
  const session = await loadSession("items");
  if (!session) return;
  document.title = "Items · Staff workspace";
  shell(session, "items", html`
      <header class="page-header">
        <div class="page-header__title">
          <h1>Items</h1>
          <div class="review-meter" id="review-meter" hidden></div>
        </div>
        <div class="page-header__actions">
          <p class="live-status" id="live-status">Connecting…</p>
          <a class="button button--secondary" href="/staff/locations" data-route>${icon("pin")}Locations</a>
          <a class="button button--secondary" href="/staff/kits" data-route>${icon("stack")}Kits</a>
          <a class="button button--secondary" href="/staff/catalogue" data-route>${icon("camera")}Catalogue</a>
          <button class="button button--primary" type="button" id="new-item">${icon("plus")}New item</button>
        </div>
      </header>
      <div class="views" id="views" role="group" aria-label="Item views"></div>
      <div class="table-toolbar">
        <label class="search-field">${icon("search")}<span class="visually-hidden">Search items</span><input id="inventory-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search name, other name, ID, category, place" data-search /><kbd aria-hidden="true">/</kbd><button class="search-field__clear" type="button" id="clear-search" aria-label="Clear search" hidden>${icon("close")}</button></label>
        <button class="button button--secondary filters-toggle" type="button" id="filters-toggle" aria-expanded="false" aria-controls="table-filters">${icon("filter")}<span>Filters</span></button>
        <div class="table-filters" id="table-filters">
          <div class="select-field"><label class="visually-hidden" for="filter-category">Category</label><select id="filter-category"></select></div>
          <div class="select-field"><label class="visually-hidden" for="filter-location">Place</label><select id="filter-location"></select></div>
          <div class="select-field select-field--narrow"><label class="visually-hidden" for="filter-type">Type</label><select id="filter-type"></select></div>
        </div>
        <button class="button button--secondary" type="button" id="select-toggle" aria-pressed="false">${icon("check")}Select</button>
        <p class="table-toolbar__count" id="inventory-count" aria-live="polite"></p>
      </div>
      <div class="bulk-bar" id="bulk-bar" role="region" aria-label="Selected items" hidden></div>
      <div id="inventory-results" aria-busy="true">${tableSkeleton()}</div>
      <dialog class="sheet" id="sheet" aria-labelledby="sheet-title"></dialog>
      <dialog class="sheet" id="bulk-sheet" aria-labelledby="sheet-title"></dialog>`);

  const params = new URLSearchParams(window.location.search);
  let inventory: Inventory | null = null;
  /** The places of the latest answer, with each place's full path ("Office › Cabinet 1"), so a row never walks the tree. */
  let places = placesOf([]);
  let paths = new Map<string, string>();
  let rows = new Map<string, PlaceRow>();
  const placeText = (item: Pick<Item, "locationId">) => (item.locationId ? paths.get(item.locationId) : undefined) ?? null;
  const requestedView = params.get("view") ?? "";
  let view: View = Object.hasOwn(VIEWS, requestedView) ? requestedView as View : "all";
  const [sortParam, dirParam] = (params.get("sort") ?? "name").split("-");
  let sortKey: SortKey = (["id", "name", "category", "location", "onHand"] as const).find((key) => key === sortParam) ?? "name";
  let sortDir = dirParam === "desc" ? -1 : 1;
  let filters = { category: params.get("category") ?? "", location: params.get("location") ?? "", type: params.get("type") ?? "" };
  let openId: string | null = null;
  let detail: Detail | null = null;
  let dirty = false;
  let pendingItem = params.get("item");
  const pendingTab = (["overview", "loan", "details", "history"] as const).find((value) => value === params.get("tab")) ?? "overview";
  let shownIds: string[] = [];
  /** Select mode: a checkbox on every row, and one change applied to all the ticked items at once (src/bulk-select.ts). */
  let selecting = false;
  const selected = new Set<string>();
  let lastPicked: string | null = null;
  const previous = new Map<string, number>();
  const changed = new Map<string, number>();
  const sheet = document.querySelector<HTMLDialogElement>("#sheet")!;
  const search = document.querySelector<HTMLInputElement>("#inventory-search")!;
  const selects = {
    category: document.querySelector<HTMLSelectElement>("#filter-category")!,
    location: document.querySelector<HTMLSelectElement>("#filter-location")!,
    type: document.querySelector<HTMLSelectElement>("#filter-type")!
  };
  const results = document.querySelector<HTMLDivElement>("#inventory-results")!;
  search.value = params.get("q") ?? "";

  function tableSkeleton(): Html {
    return html`<div class="data-table-wrap" aria-hidden="true">${Array.from({ length: 8 }, () => html`<div class="skeleton-row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></div>`)}</div>`;
  }

  const compare = (a: Item, b: Item) => {
    const left = sortKey === "location" ? placeText(a) ?? "" : a[sortKey] ?? "";
    const right = sortKey === "location" ? placeText(b) ?? "" : b[sortKey] ?? "";
    // Items without a place sort last in either direction, so the known ones stay together.
    if (sortKey === "location" && (!left || !right) && left !== right) return left ? -1 : 1;
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    return (order || a.name.localeCompare(b.name)) * sortDir;
  };

  const sortHeader = (key: SortKey, title: string, className = "") => {
    const current = sortKey === key;
    return html`<th scope="col" class="${className}" aria-sort="${current ? (sortDir === 1 ? "ascending" : "descending") : "none"}">
      <button type="button" class="sort-button" data-sort="${key}">${title}${icon(current ? (sortDir === 1 ? "sortUp" : "sortDown") : "sort")}</button></th>`;
  };

  const direction = (id: string) => { const was = changed.get(id); if (was === undefined) return ""; const now = previous.get(id) ?? was; return now > was ? "is-changed is-up" : "is-changed is-down"; };
  const row = (item: Item) => html`<tr data-key="${item.id}" class="${[direction(item.id), item.id === openId ? "is-open" : "", active(item) ? "" : "is-inactive", selected.has(item.id) ? "is-selected" : ""].join(" ")}">
    ${selecting ? html`<td class="col-select"><input type="checkbox" class="select-box" data-select="${item.id}" aria-label="Select ${item.name}" ${selected.has(item.id) ? html`checked` : ""} /></td>` : ""}
    <td class="col-id">${item.id}</td>
    <td class="col-item">${rowThumb(item)}<button type="button" class="row-link">${item.name}</button><span class="cell-sub"><span class="cell-id">${item.id} · </span>${label(item.itemType)}${item.aliases ? html` · <span class="cell-alias">${item.aliases}</span>` : ""}${placeText(item) ? html`<span class="cell-place"> · ${placeText(item)}</span>` : ""}</span></td>
    <td class="col-category">${categoryName(item.category)}</td>
    <td class="col-location">${placeCell(item)}</td>
    <td class="col-qty"><span class="qty" data-qty="${item.id}">${item.onHand}</span> <span class="qty-unit">${units(item.onHand, item.unit)}</span>${item.openUnits ? html`<span class="cell-sub">${sealedLine(item.onHand, item.openUnits, item.openCondition)}</span>` : ""}</td>
    <td class="col-status">${tags(item)}</td></tr>`;

  /** The leaf place with the places around it beneath; an item whose typed location has no place yet shows what was typed. */
  const placeCell = (item: Item): Html => {
    const text = placeText(item);
    if (!text) return item.legacyLocation ? html`<span class="muted">Needs a place</span><span class="cell-sub">Typed: ${item.legacyLocation}</span>` : html`<span class="muted">Not set</span>`;
    const above = text.split(PATH_SEPARATOR).slice(0, -1).join(PATH_SEPARATOR);
    return html`<span class="place-leaf">${places.get(item.locationId!)?.name}</span>${above ? html`<span class="cell-sub">${above}</span>` : ""}`;
  };
  const matches = (item: Item, query: string) => !query || `${item.name} ${item.id} ${item.aliases ?? ""} ${item.category} ${placeText(item) ?? ""} ${item.legacyLocation ?? ""}`.toLowerCase().includes(query);

  const fillSelect = (select: HTMLSelectElement, all: string, options: Array<[string, string]>, value: string) => {
    const markup = html`<option value="">${all}</option>${options.map(([optionValue, text]) => html`<option value="${optionValue}">${text}</option>`)}`;
    if (select.dataset.markup !== markup.value) { mount(select, markup); select.dataset.markup = markup.value; }
    select.value = value;
    select.classList.toggle("is-set", Boolean(value));
  };

  const render = () => {
    if (!inventory) return;
    results.removeAttribute("aria-busy");
    const items = inventory.items;
    writeParams({ view: view === "all" ? null : view, q: search.value.trim(), ...filters, sort: sortKey === "name" && sortDir === 1 ? null : `${sortKey}-${sortDir === 1 ? "asc" : "desc"}` });
    mount(document.querySelector("#views")!, html`${Object.entries(VIEWS).flatMap(([key, value]) => {
      const count = items.filter(value.test).length;
      return "quiet" in value && !count && key !== view ? [] : [html`<button type="button" class="view-tab" data-view="${key}" aria-pressed="${key === view}">${value.label}<span class="view-tab__count">${count}</span></button>`];
    })}`);
    const reviewed = items.filter((item) => !item.needsReview).length;
    const meter = document.querySelector<HTMLElement>("#review-meter")!;
    meter.hidden = reviewed === items.length;
    mount(meter, html`<p><strong>${reviewed.toLocaleString()}</strong> of ${plural(items.length, "record")} reviewed</p><progress max="${items.length}" value="${reviewed}" aria-label="Records reviewed">${reviewed}</progress>${view === "review" ? "" : html`<button type="button" class="text-link" data-view="review">Review the next records ${icon("arrow")}</button>`}`);
    fillSelect(selects.category, "All categories", inventory.categories.map((value) => [value, categoryName(value)]), filters.category);
    fillSelect(selects.location, "All places", [[NO_LOCATION, "No place set"], ...inOrder(places).map(({ place }): [string, string] => [place.id, `${paths.get(place.id)}${place.active ? "" : " (inactive)"}`])], filters.location);
    fillSelect(selects.type, "All types", ITEM_TYPES.map((value) => [value, label(value)]), filters.type);
    const active = Object.values(filters).filter(Boolean).length;
    document.querySelector("#filters-toggle span")!.textContent = active ? `Filters (${active})` : "Filters";
    const query = search.value.trim().toLowerCase();
    // A place stands for everything kept in it and in the places inside it.
    const inside = filters.location && filters.location !== NO_LOCATION ? withinPlace(places, filters.location) : null;
    const shown = items.filter((item) => VIEWS[view].test(item)
      && (!filters.category || item.category === filters.category)
      && (!filters.location || (filters.location === NO_LOCATION ? !item.locationId : inside?.has(item.locationId ?? "")))
      && (!filters.type || item.itemType === filters.type)
      && matches(item, query)).sort(compare);
    shownIds = shown.map((item) => item.id);
    document.querySelector("#inventory-count")!.textContent = shown.length === items.length ? plural(items.length, "item") : `${shown.length.toLocaleString()} of ${plural(items.length, "item")}`;
    const hint = view === "gradual" ? html`<p class="hint-line">${icon("info")}<span>Consumables counted in reams, rolls, packs, bottles and similar units are often opened and used a little at a time. Nothing changes here: to track open units for one, choose “Open and use gradually” in its Edit details.</span></p>` : "";
    preservingFocus(results, () => mount(results, shown.length
      ? html`${hint}<div class="data-table-wrap"><table class="data-table data-table--items">
          <caption class="visually-hidden">Items. Select an item to see, review or edit it.</caption>
          <thead><tr>${selecting ? html`<th scope="col" class="col-select"><input type="checkbox" class="select-box" id="select-all" aria-label="Select all ${shown.length.toLocaleString()} shown items" ${shown.every((item) => selected.has(item.id)) ? html`checked` : ""} /></th>` : ""}${sortHeader("id", "ID", "col-id")}${sortHeader("name", "Item", "col-item")}${sortHeader("category", "Category", "col-category")}${sortHeader("location", "Place", "col-location")}${sortHeader("onHand", "On hand", "col-qty")}<th scope="col" class="col-status">Status</th></tr></thead>
          <tbody>${shown.map(row)}</tbody></table></div>`
      : view === "gradual" && !query && !Object.values(filters).some(Boolean) ? emptyState("No likely items left", "No active Consumable counted in reams, rolls, packs, bottles or similar units is still used as a whole unit.")
      : emptyState(view === "review" && !query ? "Every record is reviewed" : "No items match", view === "review" && !query ? "Nothing is waiting for review with these filters." : "Try another search, filter, or view.", html`<button class="button button--secondary" type="button" id="clear-filters">Clear filters</button>`)));
    for (const [id, was] of changed) {
      const cell = results.querySelector(`[data-qty="${CSS.escape(id)}"]`);
      animateNumber(cell, Number(cell?.textContent), was);
    }
    changed.clear();
    (document.querySelector("#clear-search") as HTMLElement).hidden = !search.value;
    document.querySelector("#select-toggle")!.setAttribute("aria-pressed", String(selecting));
    bulk.draw();
  };

  /** The ticked items that still exist, as the bulk dialog needs them. */
  const bulk = bulkBar(document.querySelector<HTMLElement>("#bulk-bar")!, document.querySelector<HTMLDialogElement>("#bulk-sheet")!, {
    selected: () => (inventory?.items ?? []).filter((item) => selected.has(item.id)),
    places: () => placeList(inventory?.locations ?? []),
    categories: () => inventory?.categories ?? [],
    refresh: () => poll.refresh(),
    keepOnly: (ids) => { selected.clear(); ids.forEach((id) => selected.add(id)); render(); },
    clear: () => { selected.clear(); render(); }
  });

  const poll = live<Inventory>("/api/staff/inventory", {
    interval: 10_000,
    status: () => document.querySelector("#live-status"),
    onData: (data) => {
      let openChanged = false;
      for (const item of data.items) {
        if (previous.has(item.id) && previous.get(item.id) !== item.onHand) {
          changed.set(item.id, previous.get(item.id)!);
          if (item.id === openId) openChanged = true;
        }
        previous.set(item.id, item.onHand);
      }
      if (filters.category && !data.categories.includes(filters.category)) filters = { ...filters, category: "" };
      places = placesOf(data.locations);
      rows = new Map(data.locations.map((place) => [place.id, place]));
      paths = new Map(data.locations.map((place) => [place.id, pathOf(places, place.id)!]));
      if (filters.location && filters.location !== NO_LOCATION && !places.has(filters.location)) filters = { ...filters, location: "" };
      inventory = data;
      render();
      // Refresh the open sheet when another staff member changes its quantity or open units.
      const shown = data.items.find((item) => item.id === openId);
      if (openId && detail && shown && (openChanged || (shown.photoId ?? null) !== (detail.item.photo?.id ?? null) || shown.iconKey !== detail.item.iconKey || shown.visualType !== detail.item.visualType || shown.openReports !== detail.reports.filter((report) => !report.resolvedAt).length || stockSignature(shown.onHand, shown.openUnits, shown.openCondition) !== stockSignature(detail.item.onHand, detail.openUnits.length, worstCondition(detail.openUnits)))) void refreshStock(openId);
      if (pendingItem) { openItem(pendingItem, pendingTab); pendingItem = null; writeParams({ tab: null }); }
    },
    onError: (error) => {
      if (error.status === 401) expired();
      else if (!inventory) {
        results.removeAttribute("aria-busy");
        mount(results, emptyState("Items could not be loaded", `${error.message} Retrying automatically.`, "", "error"));
      }
    }
  });

  let searchTimer = 0;
  onLeave(() => window.clearTimeout(searchTimer));
  search.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(render, 120); });
  search.addEventListener("keydown", (event) => { if (event.key === "Escape" && search.value) { search.value = ""; render(); } });
  for (const [key, select] of Object.entries(selects)) select.addEventListener("change", () => { filters = { ...filters, [key]: select.value }; render(); });
  // On phones the three filters fold behind one button instead of stacking above the list.
  const filtersToggle = document.querySelector<HTMLButtonElement>("#filters-toggle")!;
  filtersToggle.addEventListener("click", () => {
    const open = filtersToggle.getAttribute("aria-expanded") !== "true";
    filtersToggle.setAttribute("aria-expanded", String(open));
    document.querySelector("#table-filters")!.classList.toggle("is-open", open);
    if (open) selects.category.focus();
  });
  document.querySelector("#clear-search")!.addEventListener("click", () => { search.value = ""; render(); search.focus(); });
  // Arrow keys move between rows; Home/End jump to the ends; Enter opens (native button).
  results.addEventListener("keydown", (event) => {
    const current = (event.target as HTMLElement).closest<HTMLButtonElement>(".row-link");
    if (!current || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const links = [...results.querySelectorAll<HTMLButtonElement>(".row-link")];
    const index = links.indexOf(current);
    const next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1);
    if (!links[next]) return;
    event.preventDefault();
    links[next].focus();
    links[next].scrollIntoView({ block: "nearest" });
  });
  const setView = (next: View) => { view = next; render(); };
  document.querySelector("#views")!.addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]");
    if (tab) setView(tab.dataset.view as View);
  });
  document.querySelector("#review-meter")!.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-view]")) { setView("review"); document.querySelector<HTMLButtonElement>('[data-view="review"]')?.focus(); }
  });
  results.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const thumb = target.closest<HTMLElement>("[data-photo]");
    if (thumb) {
      const id = thumb.closest<HTMLElement>("tr[data-key]")!.dataset.key!;
      const name = inventory?.items.find((entry) => entry.id === id)?.name ?? id;
      const item = inventory?.items.find((entry) => entry.id === id);
      void openViewer(photoUrl(thumb.dataset.photo!, "display"), `Photo of ${name}`, () => results.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(id)}"] img[data-photo]`), name, resolveItemIcon(item ?? { name }).key);
      return;
    }
    const sort = target.closest<HTMLButtonElement>("[data-sort]");
    if (sort) {
      const key = sort.dataset.sort as SortKey;
      sortDir = sortKey === key ? -sortDir : key === "onHand" ? -1 : 1;
      sortKey = key;
      render();
      results.querySelector<HTMLButtonElement>(`[data-sort="${key}"]`)?.focus();
      return;
    }
    if (target.closest("#clear-filters")) {
      search.value = "";
      filters = { category: "", location: "", type: "" };
      view = "all";
      render();
      search.focus();
      return;
    }
    const tableRow = target.closest<HTMLTableRowElement>("tr[data-key]");
    if (selecting) {
      if (target.id === "select-all") {
        const on = (target as HTMLInputElement).checked;
        for (const id of shownIds) { if (on) selected.add(id); else selected.delete(id); }
        render();
        return;
      }
      if (!tableRow) return;
      // A tick, or a click anywhere on the row; shift extends from the last one picked to this one.
      const id = tableRow.dataset.key!;
      const on = target.matches("[data-select]") ? (target as HTMLInputElement).checked : !selected.has(id);
      const span = (event as MouseEvent).shiftKey && lastPicked && shownIds.includes(lastPicked) ? shownIds.slice(Math.min(shownIds.indexOf(lastPicked), shownIds.indexOf(id)), Math.max(shownIds.indexOf(lastPicked), shownIds.indexOf(id)) + 1) : [id];
      for (const each of span) { if (on) selected.add(each); else selected.delete(each); }
      lastPicked = id;
      render();
      results.querySelector<HTMLInputElement>(`tr[data-key="${CSS.escape(id)}"] .select-box`)?.focus({ preventScroll: true });
      return;
    }
    if (tableRow) openItem(tableRow.dataset.key!);
  });
  document.querySelector("#select-toggle")!.addEventListener("click", () => {
    selecting = !selecting;
    if (!selecting) selected.clear();
    lastPicked = null;
    if (selecting && sheet.open) closeSheet();
    render();
  });
  document.querySelector("#new-item")!.addEventListener("click", openNew);

  /* ---------- Item sheet ---------- */

  const panel = createSheet(sheet, {
    dirty: () => dirty,
    onClose: () => {
      document.querySelector(`tr[data-key="${CSS.escape(openId ?? "")}"]`)?.classList.remove("is-open");
      openId = null;
      detail = null;
      dirty = false;
      writeParams({ item: null });
    }
  });
  const discardOk = panel.discardOk;
  const closeSheet = () => panel.close(true);
  onLeave(() => { dirty = false; });

  function sheetShell(kicker: Html | string, title: string, body: Html): void {
    mount(sheet, sheetContent(kicker, title, body));
  }

  function openItem(id: string, tab: Tab = "overview"): void {
    if (openId !== id && !discardOk()) return;
    dirty = false;
    document.querySelectorAll("tr.is-open").forEach((element) => element.classList.remove("is-open"));
    document.querySelector(`tr[data-key="${CSS.escape(id)}"]`)?.classList.add("is-open");
    openId = id;
    detail = null;
    writeParams({ item: id });
    const item = inventory?.items.find((entry) => entry.id === id);
    sheetShell(id, item?.name ?? "Loading…", html`<div class="skeleton skeleton--block"></div>`);
    panel.open();
    void loadDetail(id, tab);
  }

  async function fetchDetail(id: string): Promise<Detail | null> {
    const loaded = await api<Detail>(`/api/staff/items/${encodeURIComponent(id)}`);
    return openId === id ? loaded : null;
  }

  async function loadDetail(id: string, tab: Tab): Promise<void> {
    try {
      const loaded = await fetchDetail(id);
      if (loaded) renderDetail(loaded, tab);
    } catch (error) {
      if (openId === id) mount(sheet.querySelector(".sheet__body")!, emptyState("Could not load this item", failure(error), "", "error", 3));
    }
  }

  /** Updates quantity, loans and history in place, so an edit in progress is never lost. */
  async function refreshStock(id: string): Promise<void> {
    try {
      const loaded = await fetchDetail(id);
      if (!loaded || !detail) return;
      const { onHand, photo: loadedPhoto, openReports, location, legacyLocation, iconKey, visualType, updatedAt } = loaded.item;
      detail = { ...detail, item: { ...detail.item, onHand, photo: loadedPhoto, openReports, location, legacyLocation, iconKey, visualType, updatedAt }, movements: loaded.movements, loans: loaded.loans, events: loaded.events,
        openUnits: loaded.openUnits, reports: loaded.reports, usesRecorded: loaded.usesRecorded, unitsEmptied: loaded.unitsEmptied, freshness: loaded.freshness, kits: loaded.kits };
      photo?.render(loaded.item.photo);
      visualControl?.render();
      mount(sheet.querySelector("#reports-card")!, reportsCard(detail));
      mount(sheet.querySelector("#profile-info")!, profileInfo(detail));
      mount(sheet.querySelector("#quantity-context")!, quantityContext(detail));
      mount(sheet.querySelector("#history")!, historyMarkup(detail));
      openPanel?.render();
      const loanList = sheet.querySelector("#item-loans");
      if (loanList) mount(loanList, itemLoansMarkup(detail));
      const out = detail.loans.filter((loan) => loan.status === "OUT").length;
      const loanTab = sheet.querySelector("#tab-loan");
      if (loanTab) loanTab.textContent = out ? `Loan · ${out} out` : "Loan";
      stockForm?.refresh();
      loanForm?.refresh();
    } catch { /* the next live refresh retries */ }
  }

  /** The route to the item, outermost place first, for the Where is it? dialog. */
  function showWhere(): void {
    if (!detail || !inventory) return;
    const { item } = detail;
    const steps: Step[] = ancestry(places, item.locationId).reverse().map(({ id }) => ({ id, name: rows.get(id)!.name, directions: rows.get(id)!.directions, photo: rows.get(id)!.photo }));
    openWhereIsIt({
      item: item.name, steps, pictureUrl: (id, size) => `/api/staff/location-media/${id}/${size}`, note: true,
      returnFocus: () => sheet.querySelector<HTMLElement>("[data-where]"),
      noRoute: item.legacyLocation ? `No place is recorded yet. It was typed earlier as “${item.legacyLocation}”: choose the matching place in Edit details.` : "No place is recorded for this item yet. Choose one in Edit details.",
      report: async (kind, note, _name, id) => {
        const result = await api<{ recorded: boolean }>(`/api/staff/items/${encodeURIComponent(item.id)}/location-report`, { method: "POST", body: JSON.stringify({ id, kind, note }) });
        void refreshStock(item.id).then(() => poll.refresh());
        return result.recorded;
      },
      pictureHelp: (step) => step ? html`<a class="text-link" href="/staff/locations?place=${step.id}" data-route>Add one in Locations</a>` : html`<span class="muted">Choose a place in Edit details first.</span>`
    });
  }

  /** Asks for an optional note under the report being resolved. */
  function openResolve(button: HTMLButtonElement): void {
    const row = button.closest<HTMLElement>("[data-report-id]")!;
    if (row.querySelector(".report__form")) return;
    button.hidden = true;
    row.insertAdjacentHTML("beforeend", html`<form class="report__form form" novalidate><div class="field"><label for="resolve-note-${row.dataset.reportId}">Note <span class="field__optional">optional</span></label>
      <input id="resolve-note-${row.dataset.reportId}" name="note" maxlength="300" autocomplete="off" placeholder="Found it on shelf B" /></div>
      <div class="report__alert form-alert" role="alert" hidden></div>
      <div class="where__buttons"><button class="button button--primary button--sm" type="submit">Resolve report</button><button class="button button--ghost button--sm" type="button" data-resolve-cancel>Cancel</button></div></form>`.value);
    row.querySelector<HTMLInputElement>(".report__form input")!.focus();
  }

  async function sendResolve(form: HTMLFormElement): Promise<void> {
    const row = form.closest<HTMLElement>("[data-report-id]")!;
    const alert = form.querySelector<HTMLElement>(".report__alert")!;
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    setMessage(alert, "");
    try {
      await api(`/api/staff/location-reports/${row.dataset.reportId}/resolve`, { method: "POST", body: JSON.stringify({ note: form.querySelector<HTMLInputElement>("input[name=note]")!.value }) });
      toast("Report resolved.");
      if (openId) await refreshStock(openId);
      await poll.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) { toast(error.message, "error"); if (openId) await refreshStock(openId); await poll.refresh(); return; }
      setMessage(alert, failure(error));
      submit.disabled = false;
    }
  }

  /** Who and what the item is at a glance, beside its photo: availability, status, type, category, place, and how fresh that is. */
  function profileInfo({ item, loans, freshness, kits }: Detail): Html {
    const out = loans.filter((loan) => loan.status === "OUT").reduce((sum, loan) => sum + loan.quantity, 0);
    return html`<p class="profile__stock"><strong>${item.onHand}</strong> ${units(item.onHand, item.unit)} on hand${out ? html` <span class="muted">· ${out} on loan</span>` : ""}</p>
      ${tags(item)}
      <p class="profile__meta">${label(item.itemType)} · ${categoryName(item.category)}</p>
      ${item.model || item.serialNumber ? html`<p class="profile__meta">${[item.model && `Model ${item.model}`, item.serialNumber && `Serial ${item.serialNumber}`].filter(Boolean).join(" · ")}</p>` : ""}
      <p class="profile__meta profile__meta--place">${icon("pin")}<span>${item.location ?? html`<span class="muted">No place set</span>`}${!item.location && item.legacyLocation ? html`<span class="muted"> · typed earlier: ${item.legacyLocation}</span>` : ""}</span></p>
      ${freshnessLine(item, freshness)}
      ${kits?.length ? html`<p class="profile__meta profile__meta--kits">${icon("stack")}<span>In ${kits.length === 1 ? "the kit" : "kits"}: ${kits.map((kit, index) => html`${index ? ", " : ""}<a class="text-link" href="/staff/kits?kit=${kit.id}" data-route>${kit.name}</a>${kit.active ? "" : " (inactive)"}`)}</span></p>` : ""}
      <p class="profile__where"><button type="button" class="button button--secondary button--sm" data-where>${icon("pin")}Where is it?</button></p>`;
  }

  /** When the record was last confirmed on the shelf: seen at its place in a check, counted, and any check finding still to settle. */
  function freshnessLine(item: DetailItem, freshness: Freshness | undefined): Html {
    const seen = freshness?.lastVerifiedAt ? `Seen at its place ${ageOf(freshness.lastVerifiedAt)}` : item.location ? "Not yet seen in a check of its place" : null;
    const last = freshness?.lastCountedAt ?? item.lastCountedAt;
    const counted = last ? `counted ${ageOf(last)}` : "never counted here";
    const open = freshness?.openDiscrepancy;
    return html`${seen || last ? html`<p class="profile__meta profile__meta--fresh">${icon("clock")}<span>${seen ? `${seen} · ${counted}` : counted.charAt(0).toUpperCase() + counted.slice(1)}</span></p>` : ""}
      ${open ? html`<p class="profile__meta profile__meta--finding">${icon("alert")}<span>A check found: ${FINDING_WORDS[open.outcome] ?? "something to look at"} (${ageOf(open.at)}). <a class="text-link" href="/staff/catalogue?audit=${open.auditId}">Settle it</a></span></p>` : ""}`;
  }

  function quantityContext({ item, loans, openUnits }: Detail): Html {
    const state = stockState(item);
    const out = loans.filter((loan) => loan.status === "OUT").reduce((sum, loan) => sum + loan.quantity, 0);
    return html`${tracksOpenUnits(item) || openUnits.length ? html`<span class="quantity__sealed">${sealedLine(item.onHand, openUnits.length, worstCondition(openUnits))}</span>` : ""}${state === "OUT" ? html`<span class="tag tag--bad">Out of stock</span>` : state === "LOW" ? html`<span class="tag tag--warn">Low stock</span>` : item.reorderThreshold > 0 ? html`<span class="tag tag--ok">Above reorder level</span>` : ""}
      <span>${item.reorderThreshold > 0 ? `Reorder level ${item.reorderThreshold}` : "No reorder level set"}</span>
      ${out ? html`<button type="button" class="text-link" data-goto="loan">${out} more on loan</button>` : ""}`;
  }

  /** Open reports about where the item is, each with its own Resolve; closed ones stay in the item's history. */
  function reportsCard({ reports }: Detail): Html {
    const open = reports.filter((report) => !report.resolvedAt);
    if (!open.length) return html``;
    return html`<section class="card card--review" aria-labelledby="reports-title">
      <div class="card__head"><h3 id="reports-title">${open.length === 1 ? "Someone reported where this is" : `${open.length} reports about where this is`}</h3></div>
      <p class="card__text">A report changes nothing by itself. Look for the item, correct its place in Edit details if it moved, then resolve the report.</p>
      <ul class="report-list">${open.map((report) => html`<li class="report" data-report-id="${report.id}">
        <div><p class="report__title">${REPORT_LABELS[report.kind]}</p>
          <p class="report__meta"><time datetime="${report.createdAt}">${formatDateTime(report.createdAt)}</time> · ${report.source === "SELF_SERVICE" ? `${report.reportedBy ?? "Someone (no name given)"}, from a phone` : report.reportedBy ?? "Staff"}${report.location ? ` · said to be in ${report.location}` : ""}</p>
          ${report.note ? html`<p class="report__note">${report.note}</p>` : ""}</div>
        <button type="button" class="button button--secondary button--sm" data-resolve="${report.id}">Resolve</button></li>`)}</ul></section>`;
  }

  function overviewMarkup(detail: Detail): Html {
    const { item } = detail;
    const delta = item.migrationDelta ?? 0;
    const gaps = item.listingGaps;
    const origin = item.importedFrom === "LOGISTICS_HUB" ? "Created in the Logistics Hub" : item.legacySourceSheet ? `Migrated from the legacy system · ${categoryName(item.legacySourceSheet)}, row ${item.legacySourceRow ?? "?"}` : "Migrated from the legacy system";
    return html`
      <form id="stock-form" class="form quantity" novalidate aria-label="Update the quantity">${quantityEditor("stock")}<p class="quantity__context" id="quantity-context">${quantityContext(detail)}</p></form>
      ${tracksOpenUnits(item) || detail.openUnits.length ? html`<div id="open-units"></div>` : ""}
      ${delta !== 0 ? html`<div class="callout">${icon("info")}<p><strong>Migration evidence.</strong> At migration the legacy snapshot reported ${item.legacyReportedAvailable} ${units(item.legacyReportedAvailable ?? 0, item.unit)}, but the migrated movement ledger derives ${item.migratedOnHand}. The difference is preserved as recorded, not guessed. Once a physical count confirms the real figure, record it with a Count.</p></div>` : ""}
      ${item.verificationNote ? html`<div class="callout">${icon("alert")}<p><strong>Verify:</strong> ${item.verificationNote}</p></div>` : ""}
      ${item.needsReview ? html`<section class="card card--review" aria-labelledby="review-title">
          <div class="card__head"><h3 id="review-title">Needs review</h3><button type="button" class="button button--secondary button--sm" data-goto="details">Review details</button></div>
          <p class="card__text">This record came from the legacy system. Confirm its details, then mark it reviewed.</p>
          ${checklist(reviewChecklist(item))}
        </section>` : ""}
      <dl class="facts">
        <div><dt>Unit</dt><dd>${item.unit}</dd></div>
        <div><dt>Status</dt><dd>${label(item.status)}${item.needsReview ? "" : html` · Reviewed`}</dd></div>
        <div><dt>Other names</dt><dd>${item.aliases ?? html`<span class="muted">None</span>`}</dd></div>
      </dl>
      <div id="reports-card">${reportsCard(detail)}</div>
      <section class="card ${gaps.length ? "" : "card--ok"}" aria-labelledby="lending-title">
        <div class="card__head"><h3 id="lending-title">${gaps.length ? "Not on the Lending Hub" : "Listed on the Lending Hub"}</h3>${gaps.length ? "" : html`<a class="text-link" href="/lending?q=${encodeURIComponent(item.name)}" target="_blank" rel="noopener">View ${icon("external")}<span class="visually-hidden">(opens in a new tab)</span></a>`}</div>
        ${gaps.length
          ? html`<p class="card__text">Still needed before it can be listed:</p>${checklist(gaps.map((gap) => [gap, false]))}`
          : html`<p class="card__text">${label(item.lendingAudience)}. The public page shows live availability.</p>`}
      </section>
      <p class="provenance">${origin}</p>`;
  }

  let stockForm: ReturnType<typeof bindQuantityEditor> | null = null;
  let openPanel: ReturnType<typeof bindOpenUnits> | null = null;
  let photo: PhotoPanel | null = null;
  let visualControl: ReturnType<typeof itemVisualControl> | null = null;
  let loanForm: ReturnType<typeof bindLoanForm> | null = null;
  let known: Borrower[] = [];
  let knownLoaded = false;
  /** Earlier borrowers, fetched once when a Loan tab is first opened. */
  async function loadKnown(): Promise<void> {
    if (knownLoaded) return;
    knownLoaded = true;
    try { known = (await api<{ known: Borrower[] }>("/api/staff/loans")).known; loanForm?.refresh(); } catch { knownLoaded = false; }
  }

  function itemLoansMarkup({ loans }: Detail): Html {
    const out = loans.filter((loan) => loan.status === "OUT");
    const closed = loans.filter((loan) => loan.status !== "OUT").slice(0, 5);
    return html`<section aria-labelledby="loans-out-title"><h3 class="section-label" id="loans-out-title">On loan now${out.length ? ` · ${out.length}` : ""}</h3>
        ${out.length ? html`<ul class="loan-list">${out.map((loan) => loanRow(loan))}</ul>` : html`<p class="muted loan-list__empty">Nothing from this item is out right now.</p>`}</section>
      ${closed.length ? html`<section aria-labelledby="loans-closed-title"><h3 class="section-label" id="loans-closed-title">Recently returned</h3><ul class="loan-list loan-list--closed">${closed.map((loan) => loanRow(loan))}</ul></section>` : ""}`;
  }

  function historyMarkup({ movements, events, reports }: Detail): Html {
    type Entry = { at: string; markup: Html };
    const entries: Entry[] = [
      ...movements.map((movement) => {
        const quantity = movement.signedQuantity;
        const tone = quantity > 0 ? "is-in" : quantity < 0 ? "is-out" : "";
        return { at: movement.createdAt, markup: html`<li class="history__item ${tone}">
          <div><p class="history__title">${movementTitle(movement.related === "OPEN_UNIT" ? "UNIT_EMPTIED" : movement.movementType, quantity, movement.reason, movement.borrower)}${movement.purpose ? html` <span class="muted">(${movement.purpose === "USC" ? "USC use" : "individual use"})</span>` : ""}${movement.status === "SUPERSEDED" ? html` <span class="muted">(recorded offline before a later count, so not counted again)</span>` : movement.status !== "POSTED" ? ` (${movement.status.toLowerCase()})` : ""}</p>
            <p class="history__meta"><time datetime="${movement.createdAt}">${formatDateTime(movement.createdAt)}</time> · ${movement.actor ?? "Legacy system"}</p>
            ${movement.notes ? html`<p class="history__note">${movement.notes}</p>` : ""}</div>
          <p class="history__qty ${tone}">${signed(quantity)}<span class="history__after">${movement.afterQuantity - quantity} → ${movement.afterQuantity}</span></p></li>` };
      }),
      // A loan and a good return already appear as movements; only damaged or lost closings add a line.
      ...events.filter((event) => event.action !== "LOAN_CREATED" && !(event.action === "LOAN_CLOSED" && event.details.outcome === "RETURNED")).map((event) => {
        const changes = event.action === "ITEM_UPDATED"
          ? Object.entries(event.details).filter(([field]) => FIELD_LABELS[field]).map(([field, value]) => html`<li><span>${FIELD_LABELS[field]}</span> ${formatValue(field, (value as Change).from)} → <strong>${formatValue(field, (value as Change).to)}</strong></li>`)
          : [];
        const opening = Number(event.details.openingQuantity ?? 0);
        // What was typed with a report or its resolution lives on the report; the history shows it where it happened.
        const report = reports.find((entry) => entry.id === event.details.reportId);
        const typed = event.action === "LOCATION_REPORTED" ? report?.note : event.action === "LOCATION_REPORT_RESOLVED" ? report?.resolutionNote : null;
        return { at: event.at, markup: html`<li class="history__item is-catalog">
          <div><p class="history__title">${eventTitle(event)}</p>
            <p class="history__meta"><time datetime="${event.at}">${formatDateTime(event.at)}</time> · ${event.actor ?? "System"}</p>
            ${changes.length ? html`<ul class="history__changes">${changes}</ul>` : event.action === "ITEM_CREATED" && opening > 0 ? html`<p class="history__note">Opening quantity ${opening}</p>` : typed ? html`<p class="history__note">${typed}</p>` : ""}</div></li>` };
      })
    ].sort((a, b) => b.at.localeCompare(a.at));
    return entries.length ? html`${entries.map((entry) => entry.markup)}` : html`<li class="history__empty">No history recorded yet.</li>`;
  }

  function renderDetail(loaded: Detail, tab: Tab): void {
    detail = loaded;
    dirty = false;
    const { item } = loaded;
    const lendable = item.itemType === PUBLIC_LENDING_ITEM_TYPE;
    const out = loaded.loans.filter((loan) => loan.status === "OUT").length;
    const tabs: Array<[Tab, string]> = [["overview", "Overview"], ...(lendable ? [["loan", out ? `Loan · ${out} out` : "Loan"] as [Tab, string]] : []), ["details", item.needsReview ? "Review & edit" : "Edit details"], ["history", "History"]];
    if (tab === "loan" && !lendable) tab = "overview";
    sheetShell(html`<span class="mono">${item.id}</span>`, item.name, html`
      <section class="profile" id="photo-panel" aria-label="Item profile"><div class="profile__photo" data-tile></div><div class="profile__info"><div id="profile-info">${profileInfo(loaded)}</div><div class="profile__actions" data-actions></div><div class="item-visual-control" id="item-visual-control"></div></div></section>
      <div class="tabs" role="tablist" aria-label="Item sections">
        ${tabs.map(([key, text]) => html`<button type="button" role="tab" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${key === tab}" tabindex="${key === tab ? 0 : -1}">${text}</button>`)}
      </div>
      <section id="panel-overview" class="panel-stack" role="tabpanel" aria-labelledby="tab-overview" tabindex="0" ${tab === "overview" ? "" : html`hidden`}>${overviewMarkup(loaded)}</section>
      ${lendable ? html`<section id="panel-loan" class="panel-stack" role="tabpanel" aria-labelledby="tab-loan" ${tab === "loan" ? "" : html`hidden`}>
        ${item.status === "INACTIVE" ? html`<div class="callout">${icon("info")}<p>Inactive items cannot be lent. Reactivate it in Edit details first.</p></div>` : html`<form id="loan-form" class="form" novalidate aria-labelledby="lend-title"><h3 class="section-label" id="lend-title">Lend this item</h3>${loanFields("loan")}</form>`}
        <div id="item-loans" class="panel-stack">${itemLoansMarkup(loaded)}</div>
      </section>` : ""}
      <section id="panel-details" role="tabpanel" aria-labelledby="tab-details" ${tab === "details" ? "" : html`hidden`}>${detailsFormMarkup(item)}</section>
      <section id="panel-history" class="panel-stack" role="tabpanel" aria-labelledby="tab-history" tabindex="0" ${tab === "history" ? "" : html`hidden`}><ol class="history" id="history">${historyMarkup(loaded)}</ol>
        <p><a class="text-link" href="/staff/activity?item=${item.id}" data-route>All activity for this item ${icon("arrow")}</a></p></section>`);
    const tabButtons = [...sheet.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const select = (target: HTMLButtonElement) => {
      tabButtons.forEach((entry) => {
        const selected = entry === target;
        entry.setAttribute("aria-selected", String(selected));
        entry.tabIndex = selected ? 0 : -1;
        sheet.querySelector<HTMLElement>(`#${entry.getAttribute("aria-controls")}`)!.hidden = !selected;
      });
      if (target.id === "tab-loan") void loadKnown();
    };
    if (tab === "loan") void loadKnown();
    tabButtons.forEach((button, index) => {
      button.addEventListener("click", () => select(button));
      button.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        const next = tabButtons[(index + step + tabButtons.length) % tabButtons.length]!;
        select(next);
        next.focus();
      });
    });
    sheet.querySelector(".sheet__body")!.addEventListener("click", (event) => {
      const element = event.target as HTMLElement;
      const goto = element.closest<HTMLElement>("[data-goto]");
      if (goto) {
        select(sheet.querySelector<HTMLButtonElement>(`#tab-${goto.dataset.goto}`)!);
        (sheet.querySelector<HTMLElement>(goto.dataset.goto === "details" ? "#f-name" : "#loan-studentId") ?? sheet.querySelector<HTMLElement>(`#tab-${goto.dataset.goto}`))?.focus();
      }
      const giveBack = element.closest<HTMLButtonElement>("[data-return]");
      const loan = giveBack && detail?.loans.find((entry) => entry.id === giveBack.dataset.return);
      if (loan) openReturn(loan, async () => { await refreshStock(loan.itemId); await poll.refresh(); });
      if (element.closest("[data-where]")) showWhere();
      const resolve = element.closest<HTMLButtonElement>("[data-resolve]");
      if (resolve) openResolve(resolve);
      if (element.closest("[data-resolve-cancel]")) { const row = element.closest<HTMLElement>("[data-report-id]")!; row.querySelector(".report__form")?.remove(); row.querySelector<HTMLButtonElement>("[data-resolve]")!.hidden = false; row.querySelector<HTMLButtonElement>("[data-resolve]")!.focus(); }
    });
    sheet.querySelector(".sheet__body")!.addEventListener("submit", (event) => {
      const form = (event.target as HTMLElement).closest<HTMLFormElement>(".report__form");
      if (!form) return;
      event.preventDefault();
      void sendResolve(form);
    });
    const target = () => detail ? { id: detail.item.id, name: detail.item.name, unit: detail.item.unit, onHand: detail.item.onHand, openUnits: detail.openUnits.length } : null;
    const openHost = sheet.querySelector<HTMLElement>("#open-units");
    openPanel = openHost ? bindOpenUnits(openHost, () => detail && { ...detail.item, openUnits: detail.openUnits, usesRecorded: detail.usesRecorded, unitsEmptied: detail.unitsEmptied },
      async () => { await refreshStock(item.id); await poll.refresh(); }) : null;
    openPanel?.render();
    stockForm = bindQuantityEditor(sheet.querySelector<HTMLFormElement>("#stock-form")!, {
      target,
      onRecorded: async (recorded) => { await refreshStock(recorded.id); await poll.refresh(); }
    });
    stockForm.refresh();
    const lendForm = sheet.querySelector<HTMLFormElement>("#loan-form");
    loanForm = lendForm ? bindLoanForm(lendForm, {
      target,
      known: () => known,
      onLent: async (lent) => { await refreshStock(lent.id); await poll.refresh(); }
    }) : null;
    bindDetailsForm(item);
    photo = photoPanel(sheet.querySelector<HTMLElement>("#photo-panel")!, {
      visual: () => ({ ...detail!.item, photoId: detail!.item.photo?.id }), updatedAt: () => detail!.item.updatedAt,
      id: item.id, name: item.name, photo: item.photo, noun: "photo", endpoint: `/api/staff/items/${encodeURIComponent(item.id)}/photo`, thumbUrl: (id) => photoUrl(id, "thumb"),
      hintAdd: "Everyone sees this photo on the Lending Hub and Self-Service. Show the item itself, not people or documents.",
      hintHas: "Everyone sees this photo on the Lending Hub and Self-Service. The large version stays staff-only.", removeNote: "The item keeps its stock and history.",
      view: (shown) => void openViewer(photoUrl(shown.id, "display"), `Photo of ${item.name}`, () => sheet.querySelector<HTMLElement>("#photo-panel [data-view] img"), item.name, resolveItemIcon(detail!.item).key),
      changed: async (next) => { if (detail?.item.id === item.id) detail = { ...detail, item: { ...detail.item, photo: next } }; await refreshStock(item.id); await poll.refresh(); },
      // Someone else changed the photo first: show theirs, and the list with it.
      refresh: async () => { await refreshStock(item.id); await poll.refresh(); }
    });
    visualControl = itemVisualControl(sheet.querySelector<HTMLElement>("#item-visual-control")!, () => ({ ...detail!.item, photoId: detail!.item.photo?.id, updatedAt: detail!.item.updatedAt }), async () => {
      const loaded = await fetchDetail(item.id);
      if (loaded) { detail = loaded; photo?.render(loaded.item.photo); }
      await poll.refresh();
    });
  }

  /** Every place in reading order, indented by depth; an inactive place stays listed only for the item that is kept in it. */
  function placeOptions(current: string | null): Html {
    return html`${inOrder(places).filter(({ place }) => place.active || place.id === current).map(({ place }) =>
      html`<option value="${place.id}" ${place.id === current ? html`selected` : ""}>${paths.get(place.id)}${place.active ? "" : " (inactive)"}</option>`)}`;
  }

  /** The places a new place may go inside: active ones with room beneath them, and the top level. */
  function parentOptions(selected: string | null): Html {
    return html`<option value="">Top level</option>${inOrder(places).filter(({ place, depth }) => place.active && depth < MAX_DEPTH).map(({ place, depth }) =>
      html`<option value="${place.id}" ${place.id === selected ? html`selected` : ""}>${paths.get(place.id)}</option>`)}`;
  }

  function detailsFormMarkup(item: Partial<DetailItem>, creating = false): Html {
    const options = (values: readonly string[], current: string | undefined) => values.map((value) => html`<option value="${value}" ${value === current ? html`selected` : ""}>${label(value)}</option>`);
    // Unclassified is offered only while a migrated record still is; staff choose Loanable or Consumable.
    const types = ITEM_TYPES.filter((type) => type !== "NEEDS_REVIEW" || item.itemType === "NEEDS_REVIEW");
    const hinted = (id: string, hint: string) => hint ? html`aria-describedby="f-${id}-hint"` : "";
    const hintMarkup = (id: string, hint: string) => hint ? html`<p class="field__hint" id="f-${id}-hint">${hint}</p>` : "";
    const text = (id: string, title: string, value: unknown, attributes: Html | string = "", hint = "", optional = false) => html`<div class="field"><label for="f-${id}">${title}${optional ? html` <span class="field__optional">optional</span>` : ""}</label><input id="f-${id}" name="${id}" value="${value ?? ""}" ${attributes} ${hinted(id, hint)} />${hintMarkup(id, hint)}</div>`;
    const number = (id: string, title: string, value: unknown, max: number, hint = "") => html`<div class="field"><label for="f-${id}">${title}</label><input id="f-${id}" name="${id}" type="number" inputmode="numeric" min="0" max="${max}" step="1" value="${value ?? 0}" ${hinted(id, hint)} />${hintMarkup(id, hint)}</div>`;
    const reviewing = !creating && item.needsReview === true;
    return html`<form id="details-form" class="form" novalidate>
      ${reviewing ? html`<div class="callout callout--review">${icon("info")}<div><p><strong>Reviewing a migrated record.</strong> Check each detail against the physical item, fill in what is missing, then mark it reviewed.</p><div id="review-checklist">${checklist(reviewChecklist(item as Item))}</div></div></div>` : ""}
      <div class="form-section">
        <h3 class="form-section__title">Catalog</h3>
        ${text("name", "Name", item.name, html`required maxlength="120" autocomplete="off"`)}
        <div id="suggested-visual" class="visual-suggestion" aria-live="polite"></div>
        ${creating ? html`<div class="field"><label for="f-iconKey">System Icon</label><select id="f-iconKey" name="iconKey"><option value="">Use suggested icon</option>${ITEM_ICONS.map((entry) => html`<option value="tabler:${entry.key}">${entry.label}</option>`)}</select><p class="field__hint">Optional. A suggestion is already selected; you can upload a real photo after creating the item.</p></div>` : ""}
        <p class="field__hint field__hint--warn" id="duplicate-hint" hidden></p>
        ${text("aliases", "Other names", item.aliases, html`maxlength="300" autocomplete="off"`, "Names people also use for it, separated by commas. Search finds these too.", true)}
        ${!creating && item.itemType === "NEEDS_REVIEW" ? html`<div class="classify-hint" id="classify-hint" aria-live="polite"></div>` : ""}
        <div class="field-grid">
          ${text("category", "Category", item.category?.toUpperCase() === "UNSORTED" ? "" : item.category, html`required maxlength="100" autocomplete="off"`, "Letter case does not matter; an existing category is reused.")}
          <div class="field"><label for="f-itemType">Borrow or take</label><select id="f-itemType" name="itemType" aria-describedby="f-itemType-hint">${types.map((type) => html`<option value="${type}" ${type === (item.itemType ?? "Loanable") ? html`selected` : ""}>${TYPE_CHOICES[type] ?? label(type)}</option>`)}</select><p class="field__hint" id="f-itemType-hint">Your choice sets everything else: Borrow is lent and comes back; Take is used up and never returned. Both appear on the Lending Hub and on phones.</p></div>
        </div>
        <div class="field" data-consumption ${(item.itemType ?? "Loanable") === "Consumable" ? "" : html`hidden`}><label for="f-consumptionMode">How is this item normally used?</label><select id="f-consumptionMode" name="consumptionMode" aria-describedby="f-consumptionMode-hint">${options(CONSUMPTION_MODES, item.consumptionMode ?? "WHOLE_UNIT")}</select><p class="field__hint" id="f-consumptionMode-hint">Open and use gradually suits reams, bottles, rolls and boxes: staff open one unit at a time and mark it empty when it runs out. Stock is still counted in whole units.</p></div>
        <div class="field-grid">
          ${text("unit", "Unit", item.unit, html`required maxlength="30" autocomplete="off" placeholder="piece, box, pack"`, "Singular, as counted.")}
          <div class="field"><label for="f-locationId">Place <span class="field__optional">optional</span></label>
            <select id="f-locationId" name="locationId" aria-describedby="f-locationId-hint"><option value="">No place set</option>${placeOptions(item.locationId ?? null)}</select>
            <p class="field__hint" id="f-locationId-hint">Where staff find it. Directions and the picture belong to the place, so every item kept there shares them.</p></div>
        </div>
        ${!creating && !item.locationId && item.legacyLocation ? html`<div class="callout">${icon("info")}<p>This item’s location was typed earlier as <strong>${item.legacyLocation}</strong>. Choose the matching place, or add it below; the typed text is kept as it was.</p></div>` : ""}
        <div class="place-extra"><div class="place-preview" id="place-preview" aria-live="polite"></div>
          <p><button type="button" class="text-link" data-new-place aria-expanded="false" aria-controls="place-new">${icon("plus")} New place</button></p>
          <div class="place-new" id="place-new" hidden>
            <div class="field-grid"><div class="field"><label for="np-name">Name of the new place</label><input id="np-name" maxlength="120" autocomplete="off" placeholder="Shelf 3" /></div>
              <div class="field"><label for="np-parent">Inside</label><select id="np-parent"></select></div></div>
            <p class="form-alert" id="np-alert" role="alert" hidden></p>
            <div class="where__buttons"><button type="button" class="button button--secondary button--sm" data-np-add>Add place</button><button type="button" class="button button--ghost button--sm" data-np-cancel>Cancel</button></div></div></div>
        <div class="field-grid">
          ${text("model", "Model", item.model, html`maxlength="80" autocomplete="off"`, "", true)}
          ${text("serialNumber", "Serial number", item.serialNumber, html`maxlength="80" autocomplete="off" spellcheck="false"`, "", true)}
        </div>
        <div class="field"><label for="f-notes">Internal notes <span class="field__optional">optional</span></label><textarea id="f-notes" name="notes" maxlength="1000" rows="3">${item.notes ?? ""}</textarea></div>
      </div>
      <div class="form-section">
        <h3 class="form-section__title">Stock settings</h3>
        <div class="field-grid">
          <div class="field"><label for="f-status">Status</label><select id="f-status" name="status" aria-describedby="f-status-hint">${options(ITEM_STATUSES, item.status ?? "ACTIVE")}</select><p class="field__hint" id="f-status-hint">Inactive items leave the Lending Hub. Nothing is deleted.</p></div>
          ${number("reorderThreshold", "Reorder level", item.reorderThreshold, 100_000, "Low stock at or below this. 0 turns it off.")}
        </div>
        <div class="field-grid">
          <div class="field"><label for="f-stockArea">Stock area</label><select id="f-stockArea" name="stockArea" aria-describedby="f-stockArea-hint">${options(STOCK_AREAS, item.stockArea ?? "Inventory")}</select><p class="field__hint" id="f-stockArea-hint">Pantry items appear in Stock → Pantry.</p></div>
          <div class="field" data-expiry ${(item.stockArea ?? "Inventory") === "Pantry" ? "" : html`hidden`}><label for="f-expiresOn">Earliest expiry <span class="field__optional">optional</span></label><input id="f-expiresOn" name="expiresOn" type="date" value="${item.expiresOn ?? ""}" aria-describedby="f-expiresOn-hint" /><p class="field__hint" id="f-expiresOn-hint">The soonest date on the shelf.</p></div>
        </div>
        ${creating ? number("openingQuantity", "Opening quantity", 0, 100_000, "Recorded as the item's first movement.") : ""}
      </div>
      <div class="form-section">
        <h3 class="form-section__title">Public Lending Hub</h3>
        <div class="field"><label for="f-lendingAudience">Shown to</label><select id="f-lendingAudience" name="lendingAudience" aria-describedby="f-lendingAudience-hint">${options(LENDING_AUDIENCES, item.lendingAudience ?? (creating ? "STUDENTS_AND_USC_STAFF" : "NOT_AVAILABLE_FOR_LENDING"))}</select><p class="field__hint" id="f-lendingAudience-hint">Who sees it on the public page. Loans themselves are recorded in the Loan tab.</p></div>
        <div class="listing-status" id="listing-preview" aria-live="polite"></div>
      </div>
      <div class="form-section form-section--last">
        <label class="checkbox"><input type="checkbox" name="reviewed" ${item.needsReview === false || creating ? html`checked` : ""} /><span>Details reviewed and verified</span></label>
      </div>
      <div class="form-alert" id="details-alert" role="alert" hidden></div>
      <div class="form-actions form-actions--sticky">
        ${creating ? html`<button class="button button--primary" type="submit">Create item</button>`
          : reviewing ? html`<button class="button button--secondary" type="submit" data-intent="save">Save</button><button class="button button--primary" type="submit" data-intent="review-next">Mark reviewed &amp; next ${icon("next")}</button>`
          : html`<button class="button button--primary" type="submit" data-intent="save">Save changes</button>`}
      </div>
    </form>`;
  }

  function readDetails(form: HTMLFormElement) {
    const values = new FormData(form);
    const whole = (key: string) => values.get(key) === "" ? 0 : Number(values.get(key));
    return {
      name: String(values.get("name") ?? ""), aliases: String(values.get("aliases") ?? ""), category: String(values.get("category") ?? ""), unit: String(values.get("unit") ?? ""),
      itemType: String(values.get("itemType")), status: String(values.get("status")), locationId: String(values.get("locationId") ?? ""),
      reorderThreshold: whole("reorderThreshold"), lendingAudience: String(values.get("lendingAudience")),
      needsReview: values.get("reviewed") !== "on", notes: String(values.get("notes") ?? ""), model: String(values.get("model") ?? ""), serialNumber: String(values.get("serialNumber") ?? ""),
      stockArea: String(values.get("stockArea") ?? "Inventory"), expiresOn: String(values.get("expiresOn") ?? ""), consumptionMode: String(values.get("consumptionMode") ?? "WHOLE_UNIT"),
      ...(values.has("openingQuantity") ? { openingQuantity: whole("openingQuantity"), iconKey: String(values.get("iconKey") ?? "") || null } : {})
    };
  }

  /** Mirrors the Worker's validation so mistakes are caught before a round trip; the Worker still decides. */
  function invalidFields(form: HTMLFormElement): Array<[HTMLElement, string]> {
    const problems: Array<[HTMLElement, string]> = [];
    for (const input of form.querySelectorAll<HTMLInputElement>("input[required]")) {
      if (!input.value.trim()) problems.push([input, `${form.querySelector(`label[for="${input.id}"]`)?.firstChild?.textContent?.trim()} is required.`]);
    }
    for (const input of form.querySelectorAll<HTMLInputElement>("input[type=number]")) {
      const value = Number(input.value || 0);
      if (!Number.isInteger(value) || value < 0 || value > Number(input.max)) problems.push([input, `${form.querySelector(`label[for="${input.id}"]`)?.textContent?.trim()} must be a whole number from 0 to ${Number(input.max).toLocaleString()}.`]);
    }
    const values = readDetails(form);
    if (values.lendingAudience !== "NOT_AVAILABLE_FOR_LENDING" && !LISTABLE_ITEM_TYPES.has(values.itemType)) {
      problems.push([form.querySelector<HTMLElement>("#f-lendingAudience")!, "Only Loanable or Consumable items can be listed. Change the type, or choose Not lendable."]);
    }
    return problems;
  }

  function bindDetailsForm(item: Partial<DetailItem> & { id?: string }): void {
    const form = sheet.querySelector<HTMLFormElement>("#details-form")!;
    const alert = form.querySelector<HTMLDivElement>("#details-alert")!;
    const creating = !item.id;
    let intent = "save";
    /*
     * An Unclassified item opened from Attention (or the list) shows the top suggestion for how it is used, with how sure it is and why.
     * It is only a button: nothing changes in the form until it is pressed, and nothing is saved until the form is.
     */
    let hintKey = "";
    const showClassification = (values: ReturnType<typeof readDetails>) => {
      const element = form.querySelector<HTMLElement>("#classify-hint");
      if (!element || !inventory) return;
      const found = suggest(values.name, inventory.items.filter((entry) => entry.id !== item.id), []);
      const way = found.behaviour && found.behaviour.value !== "REVIEW_LATER" ? found.behaviour : undefined;
      const place = found.category && !values.category.trim() ? found.category : undefined;
      const key = JSON.stringify([way, place]);
      if (key === hintKey) return;
      hintKey = key;
      const named = (hint: Suggestion<Behaviour>) => BEHAVIOUR_LABELS[hint.value];
      if (!way) { mount(element, html`<p class="muted">${icon("info")}<span>No suggestion yet. Choose how it is used from what you see.</span></p>`); return; }
      if (way.tier === "CONFLICTING") {
        mount(element, html`<p class="classify-hint__line is-weak">${icon("info")}<span>It could be ${named(way)} (${way.why}) or ${BEHAVIOUR_LABELS[way.other!.value as Behaviour]} (${way.other!.why}). Choose one.</span></p>`);
        return;
      }
      const sure = way.tier === "STRONG";
      mount(element, html`<p class="classify-hint__line ${sure ? "" : "is-weak"}">${icon("info")}<span>${sure ? "Suggested" : "Maybe"}: ${named(way)}${place ? html`, category ${categoryName(place.value)}` : ""}. ${way.why}.</span>
        <button type="button" class="text-link" data-use-suggestion data-behaviour="${way.value}" data-category="${place?.value ?? ""}">Use suggestion</button></p>`);
    };
    form.addEventListener("click", (event) => {
      const use = (event.target as HTMLElement).closest<HTMLElement>("[data-use-suggestion]");
      if (!use) return;
      const fields = behaviourFields(use.dataset.behaviour as Behaviour);
      const type = form.querySelector<HTMLSelectElement>("#f-itemType")!;
      type.value = fields.itemType;
      form.querySelector<HTMLSelectElement>("#f-consumptionMode")!.value = fields.consumptionMode;
      const category = form.querySelector<HTMLInputElement>("#f-category")!;
      if (use.dataset.category && !category.value.trim()) category.value = use.dataset.category;
      type.dispatchEvent(new Event("input", { bubbles: true }));
      type.focus();
    });
    const preview = () => {
      const values = readDetails(form);
      const suggested = suggestItemIcon(values).key;
      mount(form.querySelector("#suggested-visual")!, html`${raw(itemIconSvg(suggested))}<span>Suggested visual · ${ITEM_ICONS.find((entry) => entry.key === suggested)!.label}</span>`);
      const gaps = listingGaps(values);
      const element = form.querySelector("#listing-preview")!;
      element.className = `listing-status ${gaps.length ? "" : "is-listed"}`;
      mount(element, gaps.length
        ? html`${icon("info")}<div><p>Not shown publicly. Still needed:</p>${checklist(gaps.map((gap) => [gap, false]))}</div>`
        : html`${icon("check")}<p>Will appear on the public Lending Hub, and phones can ${values.itemType === PUBLIC_LENDING_ITEM_TYPE ? "borrow" : values.consumptionMode === "OPEN_UNIT" ? "record using" : "take"} it.</p>`);
      const review = form.querySelector("#review-checklist");
      if (review) mount(review, checklist(reviewChecklist(values)));
      form.querySelector<HTMLElement>("[data-expiry]")!.hidden = values.stockArea !== "Pantry";
      form.querySelector<HTMLElement>("[data-consumption]")!.hidden = values.itemType !== "Consumable";
      showClassification(values);
      const duplicate = form.querySelector<HTMLElement>("#duplicate-hint")!;
      const name = values.name.trim().toLowerCase();
      const twin = name ? inventory?.items.find((entry) => entry.id !== item.id && entry.name.toLowerCase() === name) : undefined;
      duplicate.hidden = !twin;
      duplicate.textContent = twin ? `${twin.id} already uses this name. Check it is not the same item before saving.` : "";
      const row = values.locationId ? rows.get(values.locationId) : undefined;
      mount(form.querySelector("#place-preview")!, row
        ? html`<p class="place-preview__path">${icon("pin")}<span>${paths.get(row.id)} · ${VISIBILITY_LABELS[row.visibility] ?? row.visibility}${row.photo ? " · has a picture" : ""}</span></p>${row.directions ? html`<p class="place-preview__directions">${row.directions}</p>` : ""}`
        : html``);
    };
    const newPlace = form.querySelector<HTMLElement>("#place-new")!;
    const chooser = form.querySelector<HTMLSelectElement>("#f-locationId")!;
    const newPlaceToggle = form.querySelector<HTMLButtonElement>("[data-new-place]")!;
    const closeNewPlace = () => { newPlace.hidden = true; newPlaceToggle.setAttribute("aria-expanded", "false"); };
    newPlaceToggle.addEventListener("click", () => {
      const open = newPlace.hidden;
      newPlace.hidden = !open;
      newPlaceToggle.setAttribute("aria-expanded", String(open));
      if (!open) return;
      // A new place most often sits beside the one just chosen.
      mount(form.querySelector("#np-parent")!, parentOptions(chooser.value ? places.get(chooser.value)?.parentId ?? null : null));
      form.querySelector<HTMLInputElement>("#np-name")!.focus();
    });
    form.querySelector("[data-np-cancel]")!.addEventListener("click", () => { closeNewPlace(); newPlaceToggle.focus(); });
    form.querySelector("[data-np-add]")!.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const nameInput = form.querySelector<HTMLInputElement>("#np-name")!;
      const parent = form.querySelector<HTMLSelectElement>("#np-parent")!.value;
      const problem = form.querySelector<HTMLElement>("#np-alert")!;
      if (!nameInput.value.trim()) { nameInput.setAttribute("aria-invalid", "true"); setMessage(problem, "Give the new place a name."); nameInput.focus(); return; }
      nameInput.removeAttribute("aria-invalid");
      button.disabled = true;
      setMessage(problem, "");
      try {
        const { id: made } = await api<{ id: string }>("/api/staff/locations", { method: "POST", body: JSON.stringify({ name: nameInput.value, parentId: parent || null }) });
        await poll.refresh();
        mount(chooser, html`<option value="">No place set</option>${placeOptions(made)}`);
        chooser.value = made;
        nameInput.value = "";
        closeNewPlace();
        dirty = true;
        preview();
        toast("Place added.");
        chooser.focus();
      } catch (error) {
        setMessage(problem, failure(error));
        nameInput.focus();
      } finally {
        button.disabled = false;
      }
    });
    form.addEventListener("input", (event) => {
      dirty = true;
      // Choosing Borrow or Take lists the item, unless staff already picked who sees it.
      const audience = form.querySelector<HTMLSelectElement>("#f-lendingAudience")!;
      if ((event.target as HTMLElement).id === "f-itemType" && audience.value === "NOT_AVAILABLE_FOR_LENDING" && LISTABLE_ITEM_TYPES.has((event.target as HTMLSelectElement).value)) audience.value = "STUDENTS_AND_USC_STAFF";
      preview();
    });
    form.addEventListener("change", preview);
    form.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[type=submit]");
      if (button) intent = button.dataset.intent ?? "save";
    });
    preview();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (intent === "review-next") form.querySelector<HTMLInputElement>("input[name=reviewed]")!.checked = true;
      form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid"));
      const problems = invalidFields(form);
      if (problems.length) {
        problems.forEach(([element]) => element.setAttribute("aria-invalid", "true"));
        setMessage(alert, problems.map(([, message]) => message).join(" "));
        problems[0]![0].focus();
        return;
      }
      const buttons = [...form.querySelectorAll<HTMLButtonElement>("button[type=submit]")];
      buttons.forEach((button) => { button.disabled = true; });
      setMessage(alert, "");
      try {
        if (creating) {
          const { id: created } = await api<{ id: string }>("/api/staff/items", { method: "POST", body: JSON.stringify(readDetails(form)) });
          dirty = false;
          toast(`Item ${created} created.`);
          await poll.refresh();
          openItem(created);
          return;
        }
        const id = item.id!;
        // The queue is the list the reviewer was working through, captured before this save changes it.
        const queue = [...shownIds];
        const result = await api<{ changed: number }>(`/api/staff/items/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ ...readDetails(form), updatedAt: item.updatedAt ?? null }) });
        dirty = false;
        await poll.refresh();
        if (intent === "review-next") {
          const next = queue.slice(queue.indexOf(id) + 1).find((candidate) => inventory?.items.find((entry) => entry.id === candidate)?.needsReview);
          toast(next ? `${item.name} reviewed. Opening the next record.` : `${item.name} reviewed. That was the last record in this list.`);
          if (next) openItem(next, "details");
          else closeSheet();
          return;
        }
        toast(result.changed ? "Changes saved." : "No changes to save.");
        await loadDetail(id, "details");
      } catch (error) {
        const stale = error instanceof ApiError && error.status === 409;
        setMessage(alert, stale ? html`${failure(error)} <button type="button" class="text-link" data-reload>Load the latest details</button>` : failure(error));
        alert.querySelector("[data-reload]")?.addEventListener("click", () => { dirty = false; void loadDetail(item.id!, "details"); });
      } finally {
        buttons.forEach((button) => { button.disabled = false; });
      }
    });
  }

  function openNew(): void {
    if (!discardOk()) return;
    dirty = false;
    openId = null;
    detail = null;
    writeParams({ item: null });
    sheetShell("New item", "Add an item", detailsFormMarkup({ needsReview: false }, true));
    panel.open();
    bindDetailsForm({ needsReview: false });
    sheet.querySelector<HTMLInputElement>("#f-name")!.focus();
  }
}
