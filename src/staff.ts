import { ITEM_STATUSES, ITEM_TYPES, LENDING_AUDIENCES, PUBLIC_LENDING_ITEM_TYPE, listingGaps } from "./catalog-policy";
import { ApiError, MARK, type Html, animateNumber, api, app, categoryName, emptyState, formatDateTime, html, icon, label, live, mount, navigate, onLeave, plural, preservingFocus, reducedMotion, toast, units, writeParams } from "./ui";

type Item = {
  id: string; name: string; aliases: string | null; category: string; itemType: string; unit: string; status: string; needsReview: boolean;
  lendingAudience: string; onHand: number; reorderThreshold: number; storageLocation: string | null; listed: boolean;
};
type Inventory = { revision: number; items: Item[]; categories: string[]; locations: string[]; units: string[] };
type Movement = { id: string; createdAt: string; movementType: string; signedQuantity: number; status: string; notes: string | null; actor: string | null };
type Change = { from: unknown; to: unknown };
type CatalogEvent = { at: string; action: string; actor: string | null; details: Record<string, unknown> };
type DetailItem = Item & {
  defaultLoanDays: number | null; maximumLoanQty: number | null; notes: string | null; updatedAt: string | null; listingGaps: string[];
  legacyReportedAvailable: number | null; migratedOnHand: number; migrationDelta: number | null;
  legacySourceSheet: string | null; legacySourceRow: string | null; verificationNote: string | null; importedFrom: string | null;
};
type Detail = { item: DetailItem; movements: Movement[]; events: CatalogEvent[] };
type SortKey = "id" | "name" | "category" | "storageLocation" | "onHand";
type Tab = "overview" | "details" | "history";

const active = (item: Item) => item.status !== "INACTIVE";
const isLow = (item: Pick<Item, "onHand" | "reorderThreshold">) => item.reorderThreshold > 0 && item.onHand > 0 && item.onHand <= item.reorderThreshold;
const VIEWS = {
  all: { label: "All items", test: (_: Item) => true },
  review: { label: "Needs review", test: (item: Item) => item.needsReview },
  ready: { label: "Ready to list", test: (item: Item) => item.itemType === PUBLIC_LENDING_ITEM_TYPE && !item.listed && active(item) },
  listed: { label: "On Lending Hub", test: (item: Item) => item.listed },
  low: { label: "Low stock", test: (item: Item) => isLow(item) && active(item) },
  out: { label: "Out of stock", test: (item: Item) => item.onHand <= 0 && active(item) },
  inactive: { label: "Inactive", test: (item: Item) => !active(item) }
};
type View = keyof typeof VIEWS;
const NO_LOCATION = "__none";
const MOVEMENT_LABELS: Record<string, string> = {
  OPENING_BALANCE: "Opening balance", STOCK_IN: "Stock in", STOCK_OUT: "Stock out", COUNT_ADJUSTMENT: "Count adjustment", ISSUE: "Issued (legacy system)"
};
const KINDS = {
  IN: { label: "Stock in", quantity: "Quantity to add", min: 1, optional: true, placeholder: "Delivery, returned item…" },
  OUT: { label: "Stock out", quantity: "Quantity to remove", min: 1, optional: true, placeholder: "Issued for an event, damaged…" },
  COUNT: { label: "Count", quantity: "Counted on the shelf", min: 0, optional: false, placeholder: "Monthly physical count…" }
} as const;
type Kind = keyof typeof KINDS;
const FIELD_LABELS: Record<string, string> = {
  name: "Name", aliases: "Other names", category: "Category", itemType: "Type", unit: "Unit", status: "Status", storageLocation: "Location",
  reorderThreshold: "Reorder level", lendingAudience: "Who may borrow", defaultLoanDays: "Loan period (days)", maximumLoanQty: "Maximum per loan",
  needsReview: "Review", notes: "Internal notes"
};
const LENDING_FIELDS = ["lendingAudience", "defaultLoanDays", "maximumLoanQty"];

export type Role = "STAFF" | "ADMIN" | "OWNER";
export type Session = { id: string; username: string; displayName: string; role: Role; mustChangePassword: boolean; recovery: { configured: boolean; createdAt: string | null } | null };
type Section = "inventory" | "admin" | "account";

export const ROLE_LABELS: Record<Role, string> = { STAFF: "Staff", ADMIN: "Administrator", OWNER: "Owner" };

/** Loads the signed-in account, or routes to sign-in / the forced password change. */
export async function loadSession(section: Section): Promise<Session | null> {
  try {
    const session = await api<Session>("/api/staff/session");
    if (session.mustChangePassword && section !== "account") { navigate("/staff/account", true); return null; }
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { navigate("/staff", true); return null; }
    mount(app, html`<main id="main-content" class="container page-message">${emptyState("The staff workspace is unavailable", failure(error), html`<a class="button button--secondary" href="/staff/inventory" data-route>Try again</a>`, "error")}</main>`);
    return null;
  }
}

/** The one staff app shell: brand, section navigation by role, account and sign out. */
export function shell(session: Session, section: Section, main: Html): void {
  const link = (target: Section, href: string, text: string) => html`<a href="${href}" data-route ${section === target ? html`aria-current="page"` : ""}>${text}</a>`;
  mount(app, html`
    <header class="app-bar">
      <div class="app-bar__inner">
        <a class="app-bar__brand" href="/staff/inventory" data-route aria-label="Logistics Hub staff workspace home">${MARK}<span class="app-bar__title" aria-hidden="true">Logistics Hub<small>Staff workspace</small></span></a>
        <nav class="app-nav" aria-label="Workspace">
          ${session.mustChangePassword ? "" : link("inventory", "/staff/inventory", "Inventory")}
          ${session.role !== "STAFF" && !session.mustChangePassword ? link("admin", "/staff/admin", "Administration") : ""}
          ${link("account", "/staff/account", "My account")}
        </nav>
        <div class="app-bar__end">
          <a class="app-bar__link" href="/lending" target="_blank" rel="noopener">Public Lending Hub ${icon("external")}<span class="visually-hidden">(opens in a new tab)</span></a>
          <a class="account" href="/staff/account" data-route><span class="account__avatar" aria-hidden="true">${initials(session.displayName)}</span><span class="account__name">${session.displayName}<small>${ROLE_LABELS[session.role]}</small></span></a>
          <button class="button button--ghost button--sm app-bar__signout" type="button" id="staff-logout">${icon("signOut")}<span>Sign out</span></button>
        </div>
      </div>
    </header>
    <main id="main-content" class="app-main">${main}</main>`);
  document.querySelector("#staff-logout")!.addEventListener("click", async () => {
    try { await api("/api/staff/logout", { method: "POST" }); } catch { /* the session is dropped client-side regardless */ }
    navigate("/staff", true);
  });
}

function expired(): void {
  navigate("/staff?expired=1", true);
}

export function failure(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) expired();
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function setMessage(element: HTMLElement, message: string | Html, tone: "error" | "ok" | "" = "error"): void {
  element.className = `form-alert ${tone ? `form-alert--${tone}` : ""}`;
  element.hidden = !message;
  mount(element, message ? html`${icon(tone === "ok" ? "check" : "alert")}<span>${message}</span>` : html``);
}

/* ---------- Sign in ---------- */

export function staffLogin(): void {
  document.title = "Staff sign in · Department of Logistics";
  const ended = new URLSearchParams(window.location.search).has("expired");
  mount(app, html`<main id="main-content" class="auth">
    <div class="auth__layout">
      <section class="auth__intro" aria-hidden="true">
        <p class="auth__eyebrow">Holy Angel University · University Student Council</p>
        <p class="auth__statement">Department of Logistics</p>
        <p class="auth__sub">Inventory, catalog and the Lending Hub, kept in one place.</p>
      </section>
      <section class="auth__panel" aria-labelledby="signin-title">
        <a class="auth__brand" href="/" data-route aria-label="Department of Logistics home">${MARK}</a>
        <h1 id="signin-title">Staff sign in</h1>
        <p class="auth__lede">For Department of Logistics staff.</p>
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
    </div>
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
      navigate(result.mustChangePassword ? "/staff/account" : "/staff/inventory");
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
  if (item.needsReview) list.push(html`<span class="tag tag--warn">Needs review</span>`);
  if (item.status !== "ACTIVE") list.push(html`<span class="tag ${item.status === "VERIFY" ? "tag--warn" : ""}">${label(item.status)}</span>`);
  if (item.onHand <= 0) list.push(html`<span class="tag tag--bad">Out of stock</span>`);
  else if (isLow(item)) list.push(html`<span class="tag tag--warn">Low stock</span>`);
  return html`<span class="tags">${list}</span>`;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

/** The metadata a reviewer confirms for a migrated record. */
function reviewChecklist(item: Pick<Item, "category" | "itemType" | "unit" | "storageLocation">): Array<[string, boolean]> {
  return [
    ["Category chosen", Boolean(item.category)],
    ["Type classified", item.itemType !== "NEEDS_REVIEW"],
    ["Unit set", Boolean(item.unit)],
    ["Storage location recorded", Boolean(item.storageLocation)]
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
  const change = (field: string) => event.details[field] as Change | undefined;
  if (change("needsReview")) return change("needsReview")!.to ? "Marked for review" : "Review completed";
  if (change("status")?.to === "INACTIVE") return "Deactivated";
  if (change("status")?.from === "INACTIVE") return "Reactivated";
  if (LENDING_FIELDS.some((field) => change(field))) return "Lending settings changed";
  if (change("category") || change("storageLocation")) return change("category") ? "Category changed" : "Location changed";
  return "Details updated";
}

/* ---------- Workspace ---------- */

export async function workspace(): Promise<void> {
  const session = await loadSession("inventory");
  if (!session) return;
  document.title = "Inventory · Staff workspace";
  shell(session, "inventory", html`
      <header class="page-header">
        <div>
          <h1>Inventory</h1>
          <p>Quantities come from the movement ledger. Every change is recorded under your name.</p>
        </div>
        <div class="page-header__actions">
          <p class="live-status" id="live-status">Connecting…</p>
          <button class="button button--primary" type="button" id="new-item">${icon("plus")}New item</button>
        </div>
      </header>
      <div class="review-meter" id="review-meter" hidden></div>
      <div class="views" id="views" role="group" aria-label="Inventory views"></div>
      <div class="table-toolbar">
        <label class="search-field">${icon("search")}<span class="visually-hidden">Search inventory</span><input id="inventory-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search name, other name, ID, category, location" data-search /><kbd aria-hidden="true">/</kbd><button class="search-field__clear" type="button" id="clear-search" aria-label="Clear search" hidden>${icon("close")}</button></label>
        <div class="select-field"><label class="visually-hidden" for="filter-category">Category</label><select id="filter-category"></select></div>
        <div class="select-field"><label class="visually-hidden" for="filter-location">Location</label><select id="filter-location"></select></div>
        <div class="select-field select-field--narrow"><label class="visually-hidden" for="filter-type">Type</label><select id="filter-type"></select></div>
        <p class="table-toolbar__count" id="inventory-count" aria-live="polite"></p>
      </div>
      <div id="inventory-results" aria-busy="true">${tableSkeleton()}</div>
      <dialog class="sheet" id="sheet" aria-labelledby="sheet-title"></dialog>`);

  const params = new URLSearchParams(window.location.search);
  let inventory: Inventory | null = null;
  const requestedView = params.get("view") ?? "";
  let view: View = Object.hasOwn(VIEWS, requestedView) ? requestedView as View : "all";
  const [sortParam, dirParam] = (params.get("sort") ?? "name").split("-");
  let sortKey: SortKey = (["id", "name", "category", "storageLocation", "onHand"] as const).find((key) => key === sortParam) ?? "name";
  let sortDir = dirParam === "desc" ? -1 : 1;
  let filters = { category: params.get("category") ?? "", location: params.get("location") ?? "", type: params.get("type") ?? "" };
  let openId: string | null = null;
  let detail: Detail | null = null;
  let dirty = false;
  let pendingItem = params.get("item");
  let shownIds: string[] = [];
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
    const left = a[sortKey] ?? "";
    const right = b[sortKey] ?? "";
    // Empty locations sort last in either direction, so the known ones stay together.
    if (sortKey === "storageLocation" && (!left || !right) && left !== right) return left ? -1 : 1;
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    return (order || a.name.localeCompare(b.name)) * sortDir;
  };

  const sortHeader = (key: SortKey, title: string, className = "") => {
    const current = sortKey === key;
    return html`<th scope="col" class="${className}" aria-sort="${current ? (sortDir === 1 ? "ascending" : "descending") : "none"}">
      <button type="button" class="sort-button" data-sort="${key}">${title}${icon(current ? (sortDir === 1 ? "sortUp" : "sortDown") : "sort")}</button></th>`;
  };

  const direction = (id: string) => { const was = changed.get(id); if (was === undefined) return ""; const now = previous.get(id) ?? was; return now > was ? "is-changed is-up" : "is-changed is-down"; };
  const row = (item: Item) => html`<tr data-key="${item.id}" class="${[direction(item.id), item.id === openId ? "is-open" : "", active(item) ? "" : "is-inactive"].join(" ")}">
    <td class="col-id">${item.id}</td>
    <td class="col-item"><button type="button" class="row-link">${item.name}</button><span class="cell-sub">${label(item.itemType)}${item.aliases ? html` · <span class="cell-alias">${item.aliases}</span>` : ""}</span></td>
    <td class="col-category">${categoryName(item.category)}</td>
    <td class="col-location">${item.storageLocation ?? html`<span class="muted">Not set</span>`}</td>
    <td class="col-qty"><span class="qty" data-qty="${item.id}">${item.onHand}</span> <span class="qty-unit">${units(item.onHand, item.unit)}</span></td>
    <td class="col-status">${tags(item)}</td></tr>`;

  const matches = (item: Item, query: string) => !query || `${item.name} ${item.id} ${item.aliases ?? ""} ${item.category} ${item.storageLocation ?? ""}`.toLowerCase().includes(query);

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
    mount(document.querySelector("#views")!, html`${Object.entries(VIEWS).map(([key, value]) =>
      html`<button type="button" class="view-tab" data-view="${key}" aria-pressed="${key === view}">${value.label}<span class="view-tab__count">${items.filter(value.test).length}</span></button>`)}`);
    const reviewed = items.filter((item) => !item.needsReview).length;
    const meter = document.querySelector<HTMLElement>("#review-meter")!;
    meter.hidden = reviewed === items.length;
    mount(meter, html`<p><strong>${reviewed.toLocaleString()}</strong> of ${plural(items.length, "record")} reviewed</p><progress max="${items.length}" value="${reviewed}" aria-label="Records reviewed">${reviewed}</progress>${view === "review" ? "" : html`<button type="button" class="text-link" data-view="review">Review the next records ${icon("arrow")}</button>`}`);
    fillSelect(selects.category, "All categories", inventory.categories.map((value) => [value, categoryName(value)]), filters.category);
    fillSelect(selects.location, "All locations", [[NO_LOCATION, "No location set"], ...inventory.locations.map((value): [string, string] => [value, value])], filters.location);
    fillSelect(selects.type, "All types", ITEM_TYPES.map((value) => [value, label(value)]), filters.type);
    const query = search.value.trim().toLowerCase();
    const shown = items.filter((item) => VIEWS[view].test(item)
      && (!filters.category || item.category === filters.category)
      && (!filters.location || (filters.location === NO_LOCATION ? !item.storageLocation : item.storageLocation === filters.location))
      && (!filters.type || item.itemType === filters.type)
      && matches(item, query)).sort(compare);
    shownIds = shown.map((item) => item.id);
    document.querySelector("#inventory-count")!.textContent = shown.length === items.length ? plural(items.length, "item") : `${shown.length.toLocaleString()} of ${plural(items.length, "item")}`;
    preservingFocus(results, () => mount(results, shown.length
      ? html`<div class="data-table-wrap"><table class="data-table">
          <caption class="visually-hidden">Inventory items. Select an item to see, review or edit it.</caption>
          <thead><tr>${sortHeader("id", "ID", "col-id")}${sortHeader("name", "Item", "col-item")}${sortHeader("category", "Category", "col-category")}${sortHeader("storageLocation", "Location", "col-location")}${sortHeader("onHand", "On hand", "col-qty")}<th scope="col" class="col-status">Status</th></tr></thead>
          <tbody>${shown.map(row)}</tbody></table></div>`
      : emptyState(view === "review" && !query ? "Every record is reviewed" : "No items match", view === "review" && !query ? "Nothing is waiting for review with these filters." : "Try another search, filter, or view.", html`<button class="button button--secondary" type="button" id="clear-filters">Clear filters</button>`)));
    for (const [id, was] of changed) {
      const cell = results.querySelector(`[data-qty="${CSS.escape(id)}"]`);
      animateNumber(cell, Number(cell?.textContent), was);
    }
    changed.clear();
    (document.querySelector("#clear-search") as HTMLElement).hidden = !search.value;
  };

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
      if (filters.location && filters.location !== NO_LOCATION && !data.locations.includes(filters.location)) filters = { ...filters, location: "" };
      inventory = data;
      render();
      // Refresh the open sheet when another staff member changes its quantity.
      if (openChanged && openId && detail?.item.onHand !== data.items.find((item) => item.id === openId)?.onHand) void refreshStock(openId);
      if (pendingItem) { openItem(pendingItem); pendingItem = null; }
    },
    onError: (error) => {
      if (error.status === 401) expired();
      else if (!inventory) {
        results.removeAttribute("aria-busy");
        mount(results, emptyState("Inventory could not be loaded", `${error.message} Retrying automatically.`, "", "error"));
      }
    }
  });

  let searchTimer = 0;
  onLeave(() => window.clearTimeout(searchTimer));
  search.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(render, 120); });
  search.addEventListener("keydown", (event) => { if (event.key === "Escape" && search.value) { search.value = ""; render(); } });
  for (const [key, select] of Object.entries(selects)) select.addEventListener("change", () => { filters = { ...filters, [key]: select.value }; render(); });
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
    if (tableRow) openItem(tableRow.dataset.key!);
  });
  document.querySelector("#new-item")!.addEventListener("click", openNew);

  /* ---------- Item sheet ---------- */

  /** Plays the exit animation before closing, so the sheet leaves the way it arrived. */
  const closeSheet = () => {
    if (!sheet.open || sheet.classList.contains("is-closing")) return;
    if (reducedMotion()) return sheet.close();
    sheet.classList.add("is-closing");
    // Only the sheet's own exit animation ends the close; child animations bubble here too.
    const finish = (event?: AnimationEvent) => {
      if (event && event.target !== sheet) return;
      sheet.removeEventListener("animationend", finish);
      window.clearTimeout(fallback);
      sheet.classList.remove("is-closing");
      sheet.close();
    };
    const fallback = window.setTimeout(finish, 400);
    sheet.addEventListener("animationend", finish);
  };
  const discardOk = () => !dirty || window.confirm("Discard your unsaved changes to this item?");
  const requestClose = () => { if (discardOk()) closeSheet(); };
  sheet.addEventListener("cancel", (event) => { event.preventDefault(); requestClose(); });
  sheet.addEventListener("click", (event) => { if (event.target === sheet) requestClose(); });
  sheet.addEventListener("close", () => {
    const closedId = openId;
    openId = null;
    detail = null;
    dirty = false;
    sheet.innerHTML = "";
    writeParams({ item: null });
    const closedRow = document.querySelector(`tr[data-key="${CSS.escape(closedId ?? "")}"]`);
    closedRow?.classList.remove("is-open");
    closedRow?.querySelector<HTMLButtonElement>(".row-link")?.focus({ preventScroll: true });
  });
  onLeave(() => { dirty = false; if (sheet.open) sheet.close(); });

  function sheetShell(kicker: Html | string, title: string, body: Html): void {
    mount(sheet, html`<header class="sheet__header">
        <div><p class="sheet__kicker">${kicker}</p><h2 id="sheet-title">${title}</h2></div>
        <button class="icon-button" type="button" aria-label="Close" data-close>${icon("close")}</button>
      </header>
      <div class="sheet__body">${body}</div>`);
    sheet.querySelector("[data-close]")!.addEventListener("click", requestClose);
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
    if (!sheet.open) sheet.showModal();
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
      if (openId === id) mount(sheet.querySelector(".sheet__body")!, emptyState("Could not load this item", failure(error), "", "error"));
    }
  }

  /** Updates only the quantity and history in place, so an edit in progress is never lost. */
  async function refreshStock(id: string): Promise<void> {
    try {
      const was = detail?.item.onHand;
      const loaded = await fetchDetail(id);
      if (!loaded || !detail) return;
      detail = { ...detail, item: { ...detail.item, onHand: loaded.item.onHand }, movements: loaded.movements };
      mount(sheet.querySelector("#quantity")!, quantityMarkup(detail.item));
      if (was !== undefined && was !== loaded.item.onHand) {
        animateNumber(sheet.querySelector(".quantity__value"), loaded.item.onHand, was);
        const difference = loaded.item.onHand - was;
        sheet.querySelector(".quantity__figure")?.insertAdjacentHTML("beforeend", html`<span class="delta ${difference > 0 ? "delta--up" : "delta--down"}">${difference > 0 ? "+" : "−"}${Math.abs(difference)}</span>`.value);
      }
      mount(sheet.querySelector("#history")!, historyMarkup(detail));
      sheet.querySelector<HTMLFormElement>("#stock-form")?.dispatchEvent(new Event("refresh"));
    } catch { /* the next live refresh retries */ }
  }

  function quantityMarkup(item: DetailItem): Html {
    const low = isLow(item);
    return html`<div class="quantity__figure"><span class="quantity__value ${item.onHand <= 0 ? "is-out" : low ? "is-low" : ""}">${item.onHand}</span> <span class="quantity__unit">${units(item.onHand, item.unit)} on hand</span></div>
      <p class="quantity__context">${item.reorderThreshold > 0
        ? html`${item.onHand <= 0 ? html`<span class="tag tag--bad">Out of stock</span>` : low ? html`<span class="tag tag--warn">Low stock</span>` : html`<span class="tag tag--ok">Above reorder level</span>`} Reorder level ${item.reorderThreshold}`
        : item.onHand <= 0 ? html`<span class="tag tag--bad">Out of stock</span> No reorder level set` : "No reorder level set"}</p>`;
  }

  function overviewMarkup({ item }: Detail): Html {
    const delta = item.migrationDelta ?? 0;
    const gaps = item.listingGaps;
    const origin = item.importedFrom === "LOGISTICS_HUB" ? "Created in the Logistics Hub" : item.legacySourceSheet ? `Migrated from the legacy system · ${categoryName(item.legacySourceSheet)}, row ${item.legacySourceRow ?? "?"}` : "Migrated from the legacy system";
    return html`
      <div class="quantity" id="quantity">${quantityMarkup(item)}</div>
      ${delta !== 0 ? html`<div class="callout">${icon("info")}<p><strong>Migration evidence.</strong> At migration the legacy snapshot reported ${item.legacyReportedAvailable} ${units(item.legacyReportedAvailable ?? 0, item.unit)}, but the migrated movement ledger derives ${item.migratedOnHand}. The difference is preserved as recorded, not guessed. Once a physical count confirms the real figure, record it with a Count.</p></div>` : ""}
      ${item.verificationNote ? html`<div class="callout">${icon("alert")}<p><strong>Verify:</strong> ${item.verificationNote}</p></div>` : ""}
      ${item.needsReview ? html`<section class="card card--review" aria-labelledby="review-title">
          <div class="card__head"><h3 id="review-title">Needs review</h3><button type="button" class="button button--secondary button--sm" data-goto="details">Review details</button></div>
          <p class="card__text">This record came from the legacy system. Confirm its details, then mark it reviewed.</p>
          ${checklist(reviewChecklist(item))}
        </section>` : ""}
      <dl class="facts">
        <div><dt>Type</dt><dd>${label(item.itemType)}</dd></div>
        <div><dt>Category</dt><dd>${categoryName(item.category)}</dd></div>
        <div><dt>Location</dt><dd>${item.storageLocation ?? html`<span class="muted">Not set</span>`}</dd></div>
        <div><dt>Unit</dt><dd>${item.unit}</dd></div>
        <div><dt>Status</dt><dd>${label(item.status)}${item.needsReview ? "" : html` · Reviewed`}</dd></div>
        <div><dt>Other names</dt><dd>${item.aliases ?? html`<span class="muted">None</span>`}</dd></div>
      </dl>
      <section class="card ${gaps.length ? "" : "card--ok"}" aria-labelledby="lending-title">
        <div class="card__head"><h3 id="lending-title">${gaps.length ? "Not on the Lending Hub" : "Listed on the Lending Hub"}</h3>${gaps.length ? "" : html`<a class="text-link" href="/lending?q=${encodeURIComponent(item.name)}" target="_blank" rel="noopener">View ${icon("external")}<span class="visually-hidden">(opens in a new tab)</span></a>`}</div>
        ${gaps.length
          ? html`<p class="card__text">Still needed before it can be listed:</p>${checklist(gaps.map((gap) => [gap, false]))}`
          : html`<p class="card__text">${label(item.lendingAudience)}${item.maximumLoanQty ? ` · up to ${item.maximumLoanQty} per loan` : ""}${item.defaultLoanDays ? ` · ${item.defaultLoanDays}-day loan` : ""}. Students see live availability.</p>`}
      </section>
      <section aria-labelledby="stock-title" class="stock">
        <h3 id="stock-title" class="section-label">Record stock</h3>
        ${stockFormMarkup()}
      </section>
      <p class="provenance">${origin}</p>`;
  }

  function historyMarkup({ movements, events }: Detail): Html {
    type Entry = { at: string; markup: Html };
    const entries: Entry[] = [
      ...movements.map((movement) => {
        const quantity = movement.signedQuantity;
        const tone = quantity > 0 ? "is-in" : quantity < 0 ? "is-out" : "";
        return { at: movement.createdAt, markup: html`<li class="history__item ${tone}">
          <div><p class="history__title">${MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}${movement.status !== "POSTED" ? ` (${movement.status.toLowerCase()})` : ""}</p>
            <p class="history__meta"><time datetime="${movement.createdAt}">${formatDateTime(movement.createdAt)}</time> · ${movement.actor ?? "Legacy system"}</p>
            ${movement.notes ? html`<p class="history__note">${movement.notes}</p>` : ""}</div>
          <p class="history__qty ${tone}">${quantity > 0 ? "+" : quantity < 0 ? "−" : ""}${Math.abs(quantity)}</p></li>` };
      }),
      ...events.map((event) => {
        const changes = event.action === "ITEM_UPDATED"
          ? Object.entries(event.details).filter(([field]) => FIELD_LABELS[field]).map(([field, value]) => html`<li><span>${FIELD_LABELS[field]}</span> ${formatValue(field, (value as Change).from)} → <strong>${formatValue(field, (value as Change).to)}</strong></li>`)
          : [];
        const opening = Number(event.details.openingQuantity ?? 0);
        return { at: event.at, markup: html`<li class="history__item is-catalog">
          <div><p class="history__title">${eventTitle(event)}</p>
            <p class="history__meta"><time datetime="${event.at}">${formatDateTime(event.at)}</time> · ${event.actor ?? "System"}</p>
            ${changes.length ? html`<ul class="history__changes">${changes}</ul>` : event.action === "ITEM_CREATED" && opening > 0 ? html`<p class="history__note">Opening quantity ${opening}</p>` : ""}</div></li>` };
      })
    ].sort((a, b) => b.at.localeCompare(a.at));
    return entries.length ? html`${entries.map((entry) => entry.markup)}` : html`<li class="history__empty">No history recorded yet.</li>`;
  }

  function renderDetail(loaded: Detail, tab: Tab): void {
    detail = loaded;
    dirty = false;
    const { item } = loaded;
    const tabs: Array<[Tab, string]> = [["overview", "Overview"], ["details", item.needsReview ? "Review & edit" : "Edit details"], ["history", "History"]];
    sheetShell(html`<span class="mono">${item.id}</span> · ${categoryName(item.category)}`, item.name, html`
      <div class="sheet__tags">${tags(item)}</div>
      <div class="tabs" role="tablist" aria-label="Item sections">
        ${tabs.map(([key, text]) => html`<button type="button" role="tab" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${key === tab}" tabindex="${key === tab ? 0 : -1}">${text}</button>`)}
      </div>
      <section id="panel-overview" class="panel-stack" role="tabpanel" aria-labelledby="tab-overview" tabindex="0" ${tab === "overview" ? "" : html`hidden`}>${overviewMarkup(loaded)}</section>
      <section id="panel-details" role="tabpanel" aria-labelledby="tab-details" tabindex="0" ${tab === "details" ? "" : html`hidden`}>${detailsFormMarkup(item)}</section>
      <section id="panel-history" role="tabpanel" aria-labelledby="tab-history" tabindex="0" ${tab === "history" ? "" : html`hidden`}><ol class="history" id="history">${historyMarkup(loaded)}</ol></section>`);
    const tabButtons = [...sheet.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const select = (target: HTMLButtonElement) => tabButtons.forEach((entry) => {
      const selected = entry === target;
      entry.setAttribute("aria-selected", String(selected));
      entry.tabIndex = selected ? 0 : -1;
      sheet.querySelector<HTMLElement>(`#${entry.getAttribute("aria-controls")}`)!.hidden = !selected;
    });
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
    sheet.querySelector("[data-goto=details]")?.addEventListener("click", () => {
      select(sheet.querySelector<HTMLButtonElement>("#tab-details")!);
      sheet.querySelector<HTMLInputElement>("#f-name")?.focus();
    });
    bindStockForm(item);
    bindDetailsForm(item);
  }

  function stockFormMarkup(): Html {
    return html`<form id="stock-form" class="form" novalidate>
      <fieldset class="segmented"><legend class="visually-hidden">Movement type</legend>
        ${Object.entries(KINDS).map(([kind, value], index) => html`<label><input type="radio" name="kind" value="${kind}" ${index === 0 ? html`checked` : ""} /><span>${value.label}</span></label>`)}
      </fieldset>
      <div class="field-row">
        <div class="field"><label for="stock-quantity" id="stock-quantity-label">${KINDS.IN.quantity}</label>
          <div class="stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="Decrease quantity">−</button><input id="stock-quantity" name="quantity" type="number" inputmode="numeric" min="1" max="100000" step="1" required /><button type="button" class="stepper__button" data-step="1" aria-label="Increase quantity">+</button></div></div>
        <p class="stock-preview" id="stock-preview" aria-live="polite"></p>
      </div>
      <div class="field"><label for="stock-note"><span id="stock-note-label">Reason</span> <span class="field__optional" id="stock-note-optional">optional</span></label><input id="stock-note" name="note" maxlength="500" placeholder="${KINDS.IN.placeholder}" /></div>
      <div class="form-alert" id="stock-alert" role="alert" hidden></div>
      <div class="form-actions"><button class="button button--primary" type="submit">Record stock in</button></div>
    </form>`;
  }

  function bindStockForm(item: DetailItem): void {
    const form = sheet.querySelector<HTMLFormElement>("#stock-form")!;
    const quantity = form.querySelector<HTMLInputElement>("#stock-quantity")!;
    const note = form.querySelector<HTMLInputElement>("#stock-note")!;
    const alert = form.querySelector<HTMLDivElement>("#stock-alert")!;
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    let key = crypto.randomUUID();
    const kind = () => (new FormData(form).get("kind") ?? "IN") as Kind;
    const onHand = () => detail?.item.onHand ?? item.onHand;
    const update = () => {
      const config = KINDS[kind()];
      form.querySelector("#stock-quantity-label")!.textContent = config.quantity;
      form.querySelector<HTMLElement>("#stock-note-optional")!.textContent = config.optional ? "optional" : "required";
      note.placeholder = config.placeholder;
      note.required = !config.optional;
      quantity.min = String(config.min);
      if (!button.classList.contains("is-done")) button.textContent = kind() === "COUNT" ? "Record count" : `Record ${config.label.toLowerCase()}`;
      button.classList.toggle("button--danger", kind() === "OUT");
      button.classList.toggle("button--primary", kind() !== "OUT");
      const value = Number(quantity.value);
      const preview = form.querySelector("#stock-preview")!;
      if (quantity.value === "" || !Number.isInteger(value) || value < config.min) { mount(preview, html``); return; }
      const after = kind() === "IN" ? onHand() + value : kind() === "OUT" ? onHand() - value : value;
      const difference = after - onHand();
      mount(preview, after < 0
        ? html`<span class="is-error">Only ${onHand()} on hand</span>`
        : html`${onHand()} → <strong>${after}</strong> ${units(after, item.unit)}${kind() === "COUNT" ? html` <span class="muted">(${difference >= 0 ? "+" : "−"}${Math.abs(difference)})</span>` : ""}`);
    };
    form.addEventListener("change", () => { setMessage(alert, ""); update(); });
    form.addEventListener("input", () => { key = crypto.randomUUID(); quantity.removeAttribute("aria-invalid"); note.removeAttribute("aria-invalid"); update(); });
    form.addEventListener("refresh", update);
    form.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((stepButton) => stepButton.addEventListener("click", () => {
      const next = Math.max(KINDS[kind()].min, (Number(quantity.value) || 0) + Number(stepButton.dataset.step));
      quantity.value = String(next);
      quantity.dispatchEvent(new Event("input", { bubbles: true }));
    }));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = Number(quantity.value);
      if (quantity.value === "" || !Number.isInteger(value) || value < KINDS[kind()].min) {
        quantity.setAttribute("aria-invalid", "true");
        setMessage(alert, "Enter a whole-number quantity.");
        quantity.focus();
        return;
      }
      if (kind() === "COUNT" && !note.value.trim()) {
        note.setAttribute("aria-invalid", "true");
        setMessage(alert, "Give a reason for the count adjustment.");
        note.focus();
        return;
      }
      button.disabled = true;
      setMessage(alert, "");
      try {
        const result = await api<{ onHand: number }>(`/api/staff/items/${encodeURIComponent(item.id)}/movements`, { method: "POST", body: JSON.stringify({ kind: kind(), quantity: value, note: note.value, key }) });
        toast(`${KINDS[kind()].label} recorded. ${item.name} now has ${result.onHand} ${units(result.onHand, item.unit)}.`);
        form.reset();
        key = crypto.randomUUID();
        update();
        // Brief in-place confirmation; the toast carries the full message for screen readers.
        button.classList.add("is-done");
        mount(button, html`${icon("check")}Recorded`);
        window.setTimeout(() => { button.classList.remove("is-done"); update(); }, 1400);
        await refreshStock(item.id);
        await poll.refresh();
      } catch (error) {
        setMessage(alert, failure(error));
      } finally {
        button.disabled = false;
      }
    });
    update();
  }

  function detailsFormMarkup(item: Partial<DetailItem>, creating = false): Html {
    const options = (values: readonly string[], current: string | undefined) => values.map((value) => html`<option value="${value}" ${value === current ? html`selected` : ""}>${label(value)}</option>`);
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
        <p class="field__hint field__hint--warn" id="duplicate-hint" hidden></p>
        ${text("aliases", "Other names", item.aliases, html`maxlength="300" autocomplete="off"`, "Names people also use for it, separated by commas. Search finds these too.", true)}
        <div class="field-grid">
          ${text("category", "Category", item.category, html`required maxlength="100" list="category-options" autocomplete="off"`, "Pick an existing category where one fits.")}
          <div class="field"><label for="f-itemType">Type</label><select id="f-itemType" name="itemType">${options(ITEM_TYPES, item.itemType ?? "Loanable")}</select></div>
        </div>
        <div class="field-grid">
          ${text("unit", "Unit", item.unit, html`required maxlength="30" list="unit-options" autocomplete="off" placeholder="piece, box, pack"`, "Singular, as counted.")}
          ${text("storageLocation", "Storage location", item.storageLocation, html`maxlength="120" list="location-options" autocomplete="off" placeholder="Office cabinet 2"`, "Where staff find it.", true)}
        </div>
        <datalist id="category-options">${(inventory?.categories ?? []).map((value) => html`<option value="${value}"></option>`)}</datalist>
        <datalist id="unit-options">${(inventory?.units ?? []).map((value) => html`<option value="${value}"></option>`)}</datalist>
        <datalist id="location-options">${(inventory?.locations ?? []).map((value) => html`<option value="${value}"></option>`)}</datalist>
        <div class="field"><label for="f-notes">Internal notes <span class="field__optional">optional</span></label><textarea id="f-notes" name="notes" maxlength="1000" rows="3">${item.notes ?? ""}</textarea></div>
      </div>
      <div class="form-section">
        <h3 class="form-section__title">Inventory settings</h3>
        <div class="field-grid">
          <div class="field"><label for="f-status">Status</label><select id="f-status" name="status" aria-describedby="f-status-hint">${options(ITEM_STATUSES, item.status ?? "ACTIVE")}</select><p class="field__hint" id="f-status-hint">Inactive items leave the Lending Hub. Nothing is deleted.</p></div>
          ${number("reorderThreshold", "Reorder level", item.reorderThreshold, 100_000, "Low stock at or below this. 0 turns it off.")}
        </div>
        ${creating ? number("openingQuantity", "Opening quantity", 0, 100_000, "Recorded as the item's first movement.") : ""}
      </div>
      <div class="form-section">
        <h3 class="form-section__title">Lending</h3>
        <div class="field"><label for="f-lendingAudience">Who may borrow</label><select id="f-lendingAudience" name="lendingAudience">${options(LENDING_AUDIENCES, item.lendingAudience ?? "NOT_AVAILABLE_FOR_LENDING")}</select></div>
        <div class="field-grid">${number("defaultLoanDays", "Loan period (days)", item.defaultLoanDays, 365, "0 leaves it unstated.")}${number("maximumLoanQty", "Maximum per loan", item.maximumLoanQty, 100_000, "0 leaves it unstated.")}</div>
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
      itemType: String(values.get("itemType")), status: String(values.get("status")), storageLocation: String(values.get("storageLocation") ?? ""),
      reorderThreshold: whole("reorderThreshold"), lendingAudience: String(values.get("lendingAudience")),
      defaultLoanDays: whole("defaultLoanDays"), maximumLoanQty: whole("maximumLoanQty"),
      needsReview: values.get("reviewed") !== "on", notes: String(values.get("notes") ?? ""),
      ...(values.has("openingQuantity") ? { openingQuantity: whole("openingQuantity") } : {})
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
    if (values.lendingAudience !== "NOT_AVAILABLE_FOR_LENDING" && values.itemType !== PUBLIC_LENDING_ITEM_TYPE) {
      problems.push([form.querySelector<HTMLElement>("#f-lendingAudience")!, "Only Loanable items can be offered for lending. Change the type, or choose Not lendable."]);
    }
    return problems;
  }

  function bindDetailsForm(item: Partial<DetailItem> & { id?: string }): void {
    const form = sheet.querySelector<HTMLFormElement>("#details-form")!;
    const alert = form.querySelector<HTMLDivElement>("#details-alert")!;
    const creating = !item.id;
    let intent = "save";
    const preview = () => {
      const values = readDetails(form);
      const gaps = listingGaps(values);
      const element = form.querySelector("#listing-preview")!;
      element.className = `listing-status ${gaps.length ? "" : "is-listed"}`;
      mount(element, gaps.length
        ? html`${icon("info")}<div><p>Not shown publicly. Still needed:</p>${checklist(gaps.map((gap) => [gap, false]))}</div>`
        : html`${icon("check")}<p>Will appear on the public Lending Hub.</p>`);
      const review = form.querySelector("#review-checklist");
      if (review) mount(review, checklist(reviewChecklist(values)));
      const duplicate = form.querySelector<HTMLElement>("#duplicate-hint")!;
      const name = values.name.trim().toLowerCase();
      const twin = name ? inventory?.items.find((entry) => entry.id !== item.id && entry.name.toLowerCase() === name) : undefined;
      duplicate.hidden = !twin;
      duplicate.textContent = twin ? `${twin.id} already uses this name. Check it is not the same item before saving.` : "";
    };
    form.addEventListener("input", () => { dirty = true; preview(); });
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
    if (!sheet.open) sheet.showModal();
    bindDetailsForm({ needsReview: false });
    sheet.querySelector<HTMLInputElement>("#f-name")!.focus();
  }
}
