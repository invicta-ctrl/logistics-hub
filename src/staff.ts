import { ITEM_STATUSES, ITEM_TYPES, LENDING_AUDIENCES, isListedForLending } from "./catalog-policy";
import { ApiError, MARK, type Html, api, app, categoryName, emptyState, formatDateTime, html, icon, label, live, mount, navigate, onLeave, plural, preservingFocus, toast, units, writeParams } from "./ui";

type Item = {
  id: string; name: string; category: string; itemType: string; unit: string; status: string; needsReview: boolean;
  lendingAudience: string; onHand: number; reorderThreshold: number; storageLocation: string | null; listed: boolean;
};
type Inventory = { revision: number; items: Item[]; categories: string[] };
type Movement = { id: string; createdAt: string; movementType: string; signedQuantity: number; status: string; notes: string | null; actor: string | null };
type DetailItem = Item & { defaultLoanDays: number | null; maximumLoanQty: number | null; notes: string | null; legacyReportedAvailable: number | null; migratedOnHand: number; migrationDelta: number | null };
type Detail = { item: DetailItem; movements: Movement[] };
type SortKey = "id" | "name" | "category" | "onHand";

const VIEWS = {
  all: { label: "All items", test: (_: Item) => true },
  listed: { label: "On Lending Hub", test: (item: Item) => item.listed },
  ready: { label: "Ready to list", test: (item: Item) => item.itemType === "Loanable" && !item.listed && item.status !== "INACTIVE" },
  review: { label: "Needs review", test: (item: Item) => item.needsReview },
  out: { label: "Out of stock", test: (item: Item) => item.onHand <= 0 && item.status !== "INACTIVE" }
};
type View = keyof typeof VIEWS;
const MOVEMENT_LABELS: Record<string, string> = {
  OPENING_BALANCE: "Opening balance", STOCK_IN: "Stock in", STOCK_OUT: "Stock out", COUNT_ADJUSTMENT: "Count adjustment", ISSUE: "Issued (legacy system)"
};
const KINDS = {
  IN: { label: "Stock in", quantity: "Quantity to add", min: 1, note: "Reason", optional: true, placeholder: "Delivery, returned item…" },
  OUT: { label: "Stock out", quantity: "Quantity to remove", min: 1, note: "Reason", optional: true, placeholder: "Issued for an event, damaged…" },
  COUNT: { label: "Count", quantity: "Counted on the shelf", min: 0, note: "Reason", optional: false, placeholder: "Monthly physical count…" }
} as const;
type Kind = keyof typeof KINDS;

function expired(): void {
  navigate("/staff?expired=1", true);
}

function failure(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) expired();
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function setMessage(element: HTMLElement, message: string, tone: "error" | "ok" | "" = "error"): void {
  element.className = `form-alert ${tone ? `form-alert--${tone}` : ""}`;
  element.hidden = !message;
  mount(element, message ? html`${icon(tone === "ok" ? "check" : "alert")}<span>${message}</span>` : html``);
}

/* ---------- Sign in ---------- */

export function staffLogin(): void {
  document.title = "Staff sign in · Department of Logistics";
  const ended = new URLSearchParams(window.location.search).has("expired");
  mount(app, html`<main id="main-content" class="auth">
    <section class="auth__panel" aria-labelledby="signin-title">
      <a class="auth__brand" href="/" data-route aria-label="Department of Logistics home">${MARK}</a>
      <h1 id="signin-title">Staff sign in</h1>
      <p class="auth__lede">Manage inventory and the public Lending Hub.</p>
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
        <button class="button button--primary button--block" type="submit">Sign in</button>
      </form>
      <p class="auth__foot">Accounts are issued by the Department of Logistics.</p>
    </section>
    <a class="auth__back text-link" href="/" data-route>Back to the public site</a>
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
      await api("/api/staff/login", { method: "POST", body: JSON.stringify({ username: values.get("username"), password: values.get("password") }) });
      navigate("/staff/inventory");
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
  if (item.status !== "ACTIVE") list.push(html`<span class="tag">${label(item.status)}</span>`);
  if (item.onHand <= 0) list.push(html`<span class="tag tag--bad">Out of stock</span>`);
  else if (item.reorderThreshold > 0 && item.onHand <= item.reorderThreshold) list.push(html`<span class="tag tag--warn">Low stock</span>`);
  return html`<span class="tags">${list}</span>`;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

/* ---------- Workspace ---------- */

export async function workspace(): Promise<void> {
  let session: { displayName: string };
  try {
    session = await api("/api/staff/session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { navigate("/staff", true); return; }
    mount(app, html`<main id="main-content" class="container page-message">${emptyState("The staff workspace is unavailable", failure(error), html`<a class="button button--secondary" href="/staff/inventory" data-route>Try again</a>`, "error")}</main>`);
    return;
  }
  document.title = "Inventory · Staff workspace";
  mount(app, html`
    <header class="app-bar">
      <div class="app-bar__inner">
        <a class="app-bar__brand" href="/staff/inventory" data-route aria-label="Staff workspace home">${MARK}</a>
        <nav class="app-nav" aria-label="Workspace"><a href="/staff/inventory" data-route aria-current="page">Inventory</a></nav>
        <div class="app-bar__end">
          <a class="app-bar__link" href="/lending" target="_blank" rel="noopener">Public Lending Hub ${icon("external")}<span class="visually-hidden">(opens in a new tab)</span></a>
          <span class="account"><span class="account__avatar" aria-hidden="true">${initials(session.displayName)}</span><span class="account__name">${session.displayName}</span></span>
          <button class="button button--ghost button--sm" type="button" id="staff-logout">${icon("signOut")}<span>Sign out</span></button>
        </div>
      </div>
    </header>
    <main id="main-content" class="app-main">
      <header class="page-header">
        <div>
          <h1>Inventory</h1>
          <p id="inventory-summary">Quantities are derived from the movement ledger; every change is recorded under your name.</p>
        </div>
        <div class="page-header__actions">
          <p class="live-status" id="live-status">Connecting…</p>
          <button class="button button--primary" type="button" id="new-item">${icon("plus")}New item</button>
        </div>
      </header>
      <div class="views" id="views" role="group" aria-label="Inventory views"></div>
      <div class="table-toolbar">
        <label class="search-field">${icon("search")}<span class="visually-hidden">Search inventory</span><input id="inventory-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search name, ID, category, location" data-search /><kbd aria-hidden="true">/</kbd></label>
        <label class="select-field"><span class="visually-hidden">Category</span><select id="inventory-category"><option value="">All categories</option></select></label>
        <p class="table-toolbar__count" id="inventory-count" aria-live="polite"></p>
      </div>
      <div id="inventory-results" aria-busy="true">${tableSkeleton()}</div>
    </main>
    <dialog class="sheet" id="sheet" aria-labelledby="sheet-title"></dialog>`);

  const params = new URLSearchParams(window.location.search);
  let inventory: Inventory | null = null;
  const requestedView = params.get("view") ?? "";
  let view: View = Object.hasOwn(VIEWS, requestedView) ? requestedView as View : "all";
  const [sortParam, dirParam] = (params.get("sort") ?? "name").split("-");
  let sortKey: SortKey = (["id", "name", "category", "onHand"] as const).find((key) => key === sortParam) ?? "name";
  let sortDir = dirParam === "desc" ? -1 : 1;
  let openId: string | null = null;
  let dirty = false;
  let pendingItem = params.get("item");
  const previous = new Map<string, number>();
  const changed = new Set<string>();
  const sheet = document.querySelector<HTMLDialogElement>("#sheet")!;
  const search = document.querySelector<HTMLInputElement>("#inventory-search")!;
  const categorySelect = document.querySelector<HTMLSelectElement>("#inventory-category")!;
  const results = document.querySelector<HTMLDivElement>("#inventory-results")!;
  search.value = params.get("q") ?? "";
  let category = params.get("category") ?? "";

  function tableSkeleton(): Html {
    return html`<div class="data-table-wrap" aria-hidden="true">${Array.from({ length: 8 }, () => html`<div class="skeleton-row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></div>`)}</div>`;
  }

  const compare = (a: Item, b: Item) => {
    const left = a[sortKey];
    const right = b[sortKey];
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    return (order || a.name.localeCompare(b.name)) * sortDir;
  };

  const sortHeader = (key: SortKey, title: string, className = "") => {
    const active = sortKey === key;
    return html`<th scope="col" class="${className}" aria-sort="${active ? (sortDir === 1 ? "ascending" : "descending") : "none"}">
      <button type="button" class="sort-button" data-sort="${key}">${title}${icon(active ? (sortDir === 1 ? "sortUp" : "sortDown") : "sort")}</button></th>`;
  };

  const row = (item: Item) => html`<tr data-key="${item.id}" class="${[changed.has(item.id) ? "is-changed" : "", item.id === openId ? "is-open" : ""].join(" ")}">
    <td class="col-id">${item.id}</td>
    <td class="col-item"><button type="button" class="row-link">${item.name}</button><span class="cell-sub">${label(item.itemType)}</span></td>
    <td class="col-category">${categoryName(item.category)}</td>
    <td class="col-location">${item.storageLocation ?? html`<span class="muted">—</span>`}</td>
    <td class="col-qty"><span class="qty">${item.onHand}</span> <span class="qty-unit">${units(item.onHand, item.unit)}</span></td>
    <td class="col-status">${tags(item)}</td></tr>`;

  const render = () => {
    if (!inventory) return;
    results.removeAttribute("aria-busy");
    const items = inventory.items;
    writeParams({ view: view === "all" ? null : view, q: search.value.trim(), category, sort: sortKey === "name" && sortDir === 1 ? null : `${sortKey}-${sortDir === 1 ? "asc" : "desc"}` });
    mount(document.querySelector("#views")!, html`${Object.entries(VIEWS).map(([key, value]) =>
      html`<button type="button" class="view-tab" data-view="${key}" aria-pressed="${key === view}">${value.label}<span class="view-tab__count">${items.filter(value.test).length}</span></button>`)}`);
    if ([...categorySelect.options].slice(1).map((option) => option.value).join("\n") !== inventory.categories.join("\n")) {
      mount(categorySelect, html`<option value="">All categories</option>${inventory.categories.map((value) => html`<option value="${value}">${categoryName(value)}</option>`)}`);
    }
    categorySelect.value = category;
    const query = search.value.trim().toLowerCase();
    const shown = items.filter((item) => VIEWS[view].test(item)
      && (!category || item.category === category)
      && (!query || `${item.name} ${item.id} ${item.category} ${item.storageLocation ?? ""}`.toLowerCase().includes(query))).sort(compare);
    document.querySelector("#inventory-count")!.textContent = shown.length === items.length ? plural(items.length, "item") : `${shown.length.toLocaleString()} of ${plural(items.length, "item")}`;
    preservingFocus(results, () => mount(results, shown.length
      ? html`<div class="data-table-wrap"><table class="data-table">
          <caption class="visually-hidden">Inventory items. Select an item to record stock or edit it.</caption>
          <thead><tr>${sortHeader("id", "ID", "col-id")}${sortHeader("name", "Item", "col-item")}${sortHeader("category", "Category", "col-category")}<th scope="col" class="col-location">Location</th>${sortHeader("onHand", "On hand", "col-qty")}<th scope="col" class="col-status">Status</th></tr></thead>
          <tbody>${shown.map(row)}</tbody></table></div>`
      : emptyState("No items match", "Try another search, category, or view.", html`<button class="button button--secondary" type="button" id="clear-filters">Clear filters</button>`)));
    changed.clear();
  };

  const poll = live<Inventory>("/api/staff/inventory", {
    interval: 10_000,
    status: () => document.querySelector("#live-status"),
    onData: (data) => {
      let openChanged = false;
      for (const item of data.items) {
        if (previous.has(item.id) && previous.get(item.id) !== item.onHand) {
          changed.add(item.id);
          if (item.id === openId) openChanged = true;
        }
        previous.set(item.id, item.onHand);
      }
      if (category && !data.categories.includes(category)) category = "";
      inventory = data;
      render();
      if (openChanged && openId) void loadDetail(openId, false);
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
  categorySelect.addEventListener("change", () => { category = categorySelect.value; render(); });
  document.querySelector("#views")!.addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]");
    if (tab) { view = tab.dataset.view as View; render(); }
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
      category = "";
      view = "all";
      render();
      search.focus();
      return;
    }
    const tableRow = target.closest<HTMLTableRowElement>("tr[data-key]");
    if (tableRow) openItem(tableRow.dataset.key!);
  });
  document.querySelector("#new-item")!.addEventListener("click", openNew);
  document.querySelector("#staff-logout")!.addEventListener("click", async () => {
    try { await api("/api/staff/logout", { method: "POST" }); } catch { /* the cookie is cleared server-side on the next sign-in anyway */ }
    navigate("/staff", true);
  });

  /* ---------- Item sheet ---------- */

  const requestClose = () => {
    if (dirty && !window.confirm("Discard your unsaved changes to this item?")) return;
    sheet.close();
  };
  sheet.addEventListener("cancel", (event) => { event.preventDefault(); requestClose(); });
  sheet.addEventListener("click", (event) => { if (event.target === sheet) requestClose(); });
  sheet.addEventListener("close", () => {
    const closedId = openId;
    openId = null;
    dirty = false;
    sheet.innerHTML = "";
    writeParams({ item: null });
    document.querySelector(`tr[data-key="${CSS.escape(closedId ?? "")}"]`)?.classList.remove("is-open");
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

  function openItem(id: string): void {
    if (dirty && openId !== id && !window.confirm("Discard your unsaved changes to this item?")) return;
    dirty = false;
    document.querySelectorAll("tr.is-open").forEach((element) => element.classList.remove("is-open"));
    document.querySelector(`tr[data-key="${CSS.escape(id)}"]`)?.classList.add("is-open");
    openId = id;
    writeParams({ item: id });
    const item = inventory?.items.find((entry) => entry.id === id);
    sheetShell(id, item?.name ?? "Loading…", html`<div class="skeleton skeleton--block"></div>`);
    if (!sheet.open) sheet.showModal();
    void loadDetail(id, true);
  }

  async function loadDetail(id: string, full: boolean): Promise<void> {
    try {
      const detail = await api<Detail>(`/api/staff/items/${encodeURIComponent(id)}`);
      if (openId !== id) return;
      if (full) return renderDetail(detail);
      sheet.querySelector("#summary")!.outerHTML = summaryMarkup(detail).value;
      mount(sheet.querySelector("#history")!, historyMarkup(detail.movements));
      sheet.querySelector<HTMLFormElement>("#stock-form")?.dispatchEvent(new Event("refresh"));
    } catch (error) {
      if (openId === id && full) mount(sheet.querySelector(".sheet__body")!, emptyState("Could not load this item", failure(error), "", "error"));
    }
  }

  function summaryMarkup({ item }: Detail): Html {
    const delta = item.migrationDelta ?? 0;
    return html`<div id="summary">
      <dl class="summary" data-onhand="${item.onHand}">
        <div class="summary__primary"><dt>On hand</dt><dd><span class="summary__qty ${item.onHand <= 0 ? "is-out" : ""}">${item.onHand}</span> ${units(item.onHand, item.unit)}${item.reorderThreshold > 0 && item.onHand > 0 && item.onHand <= item.reorderThreshold ? html` <span class="tag tag--warn">Low stock</span>` : ""}</dd></div>
        <div><dt>Type</dt><dd>${label(item.itemType)}</dd></div>
        <div><dt>Status</dt><dd>${label(item.status)}${item.needsReview ? html`<span class="summary__flag">Needs review</span>` : ""}</dd></div>
        <div><dt>Location</dt><dd>${item.storageLocation ?? "Not set"}</dd></div>
        <div><dt>Lending Hub</dt><dd>${item.listed ? "Listed" : "Not listed"}</dd></div>
      </dl>
      ${delta !== 0 ? html`<div class="callout">${icon("info")}<p><strong>Migration evidence.</strong> At migration the legacy snapshot reported ${item.legacyReportedAvailable} ${units(item.legacyReportedAvailable ?? 0, item.unit)}, but the migrated movement ledger derives ${item.migratedOnHand}. The difference is preserved as recorded, not guessed. Once a physical count confirms the real figure, record it with a Count.</p></div>` : ""}
    </div>`;
  }

  function historyMarkup(movements: Movement[]): Html {
    if (!movements.length) return html`<li class="history__empty">No movements recorded yet.</li>`;
    return html`${movements.map((movement) => {
      const quantity = movement.signedQuantity;
      return html`<li class="history__item">
        <div><p class="history__title">${MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}${movement.status !== "POSTED" ? ` (${movement.status.toLowerCase()})` : ""}</p>
          <p class="history__meta"><time datetime="${movement.createdAt}">${formatDateTime(movement.createdAt)}</time> · ${movement.actor ?? "Legacy system"}</p>
          ${movement.notes ? html`<p class="history__note">${movement.notes}</p>` : ""}</div>
        <p class="history__qty ${quantity > 0 ? "is-in" : quantity < 0 ? "is-out" : ""}">${quantity > 0 ? "+" : quantity < 0 ? "−" : ""}${Math.abs(quantity)}</p></li>`;
    })}`;
  }

  function renderDetail(detail: Detail): void {
    const { item } = detail;
    sheetShell(html`<span class="mono">${item.id}</span> · ${categoryName(item.category)}`, item.name, html`${summaryMarkup(detail)}
      <div class="tabs" role="tablist" aria-label="Item sections">
        <button type="button" role="tab" id="tab-stock" aria-controls="panel-stock" aria-selected="true">Stock</button>
        <button type="button" role="tab" id="tab-details" aria-controls="panel-details" aria-selected="false" tabindex="-1">Details &amp; lending</button>
        <button type="button" role="tab" id="tab-history" aria-controls="panel-history" aria-selected="false" tabindex="-1">History</button>
      </div>
      <section id="panel-stock" role="tabpanel" aria-labelledby="tab-stock" tabindex="0">${stockFormMarkup()}</section>
      <section id="panel-details" role="tabpanel" aria-labelledby="tab-details" tabindex="0" hidden>${detailsFormMarkup(item)}</section>
      <section id="panel-history" role="tabpanel" aria-labelledby="tab-history" tabindex="0" hidden><ol class="history" id="history">${historyMarkup(detail.movements)}</ol></section>`);
    const tabs = [...sheet.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const select = (tab: HTMLButtonElement) => tabs.forEach((entry) => {
      const active = entry === tab;
      entry.setAttribute("aria-selected", String(active));
      entry.tabIndex = active ? 0 : -1;
      sheet.querySelector<HTMLElement>(`#${entry.getAttribute("aria-controls")}`)!.hidden = !active;
    });
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        const next = tabs[(index + step + tabs.length) % tabs.length]!;
        select(next);
        next.focus();
      });
    });
    bindStockForm(item);
    bindDetailsForm(item.id);
  }

  function stockFormMarkup(): Html {
    return html`<form id="stock-form" class="form" novalidate>
      <fieldset class="segmented"><legend class="visually-hidden">Movement type</legend>
        ${Object.entries(KINDS).map(([kind, value], index) => html`<label><input type="radio" name="kind" value="${kind}" ${index === 0 ? html`checked` : ""} /><span>${value.label}</span></label>`)}
      </fieldset>
      <div class="field-row">
        <div class="field"><label for="stock-quantity" id="stock-quantity-label">${KINDS.IN.quantity}</label><input id="stock-quantity" name="quantity" type="number" inputmode="numeric" min="1" max="100000" step="1" required /></div>
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
    const onHand = () => Number(sheet.querySelector<HTMLElement>("[data-onhand]")?.dataset.onhand ?? item.onHand);
    const update = () => {
      const config = KINDS[kind()];
      form.querySelector("#stock-quantity-label")!.textContent = config.quantity;
      form.querySelector<HTMLElement>("#stock-note-optional")!.textContent = config.optional ? "optional" : "required";
      note.placeholder = config.placeholder;
      note.required = !config.optional;
      quantity.min = String(config.min);
      button.textContent = kind() === "COUNT" ? "Record count" : `Record ${config.label.toLowerCase()}`;
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
        await loadDetail(item.id, false);
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
    const text = (id: string, title: string, value: unknown, attributes: Html | string = "") => html`<div class="field"><label for="f-${id}">${title}</label><input id="f-${id}" name="${id}" value="${value ?? ""}" ${attributes} /></div>`;
    const number = (id: string, title: string, value: unknown, hint = "") => html`<div class="field"><label for="f-${id}">${title}</label><input id="f-${id}" name="${id}" type="number" inputmode="numeric" min="0" step="1" value="${value ?? 0}" ${hint ? html`aria-describedby="f-${id}-hint"` : ""} />${hint ? html`<p class="field__hint" id="f-${id}-hint">${hint}</p>` : ""}</div>`;
    return html`<form id="details-form" class="form" novalidate>
      <div class="form-section">
        <h3 class="form-section__title">Catalog record</h3>
        ${text("name", "Name", item.name, html`required maxlength="120"`)}
        <div class="field-grid">${text("category", "Category", item.category, html`required maxlength="100" list="category-options"`)}${text("unit", "Unit", item.unit, html`required maxlength="30" placeholder="piece, box, pack"`)}</div>
        <datalist id="category-options">${(inventory?.categories ?? []).map((value) => html`<option value="${value}"></option>`)}</datalist>
        <div class="field-grid">
          <div class="field"><label for="f-itemType">Type</label><select id="f-itemType" name="itemType">${options(ITEM_TYPES, item.itemType ?? "Loanable")}</select></div>
          <div class="field"><label for="f-status">Status</label><select id="f-status" name="status">${options(ITEM_STATUSES, item.status ?? "ACTIVE")}</select></div>
        </div>
        <div class="field-grid">${text("storageLocation", "Storage location", item.storageLocation, html`maxlength="120"`)}${number("reorderThreshold", "Reorder level", item.reorderThreshold, "Flags low stock at or below this. 0 turns it off.")}</div>
        ${creating ? number("openingQuantity", "Opening quantity", 0, "Recorded as the item's opening movement.") : ""}
      </div>
      <div class="form-section">
        <h3 class="form-section__title">Lending Hub</h3>
        <div class="field"><label for="f-lendingAudience">Who may borrow</label><select id="f-lendingAudience" name="lendingAudience">${options(LENDING_AUDIENCES, item.lendingAudience ?? "NOT_AVAILABLE_FOR_LENDING")}</select></div>
        <div class="field-grid">${number("defaultLoanDays", "Loan period (days)", item.defaultLoanDays)}${number("maximumLoanQty", "Maximum per loan", item.maximumLoanQty)}</div>
        <label class="checkbox"><input type="checkbox" name="reviewed" ${item.needsReview === false || creating ? html`checked` : ""} /><span>Details reviewed and verified</span></label>
        <p class="listing-status" id="listing-preview" aria-live="polite"></p>
      </div>
      <div class="form-section">
        <div class="field"><label for="f-notes">Internal notes</label><textarea id="f-notes" name="notes" maxlength="1000" rows="3">${item.notes ?? ""}</textarea></div>
      </div>
      <div class="form-alert" id="details-alert" role="alert" hidden></div>
      <div class="form-actions"><button class="button button--primary" type="submit">${creating ? "Create item" : "Save changes"}</button></div>
    </form>`;
  }

  function readDetails(form: HTMLFormElement) {
    const values = new FormData(form);
    const whole = (key: string) => values.get(key) === "" ? 0 : Number(values.get(key));
    return {
      name: String(values.get("name") ?? ""), category: String(values.get("category") ?? ""), unit: String(values.get("unit") ?? ""),
      itemType: String(values.get("itemType")), status: String(values.get("status")), storageLocation: String(values.get("storageLocation") ?? ""),
      reorderThreshold: whole("reorderThreshold"), lendingAudience: String(values.get("lendingAudience")),
      defaultLoanDays: whole("defaultLoanDays"), maximumLoanQty: whole("maximumLoanQty"),
      needsReview: values.get("reviewed") !== "on", notes: String(values.get("notes") ?? ""),
      ...(values.has("openingQuantity") ? { openingQuantity: whole("openingQuantity") } : {})
    };
  }

  function bindDetailsForm(id: string | null): void {
    const form = sheet.querySelector<HTMLFormElement>("#details-form")!;
    const alert = form.querySelector<HTMLDivElement>("#details-alert")!;
    const preview = () => {
      const listed = isListedForLending(readDetails(form));
      const element = form.querySelector("#listing-preview")!;
      element.className = `listing-status ${listed ? "is-listed" : ""}`;
      mount(element, listed
        ? html`${icon("check")}<span>Will appear on the public Lending Hub.</span>`
        : html`${icon("info")}<span>Not shown publicly. Listing needs the Loanable type, Active status, an audience, and reviewed details.</span>`);
    };
    form.addEventListener("input", () => { dirty = true; preview(); });
    form.addEventListener("change", preview);
    preview();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const missing = [...form.querySelectorAll<HTMLInputElement>("input[required]")].filter((input) => !input.value.trim());
      form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid"));
      if (missing.length) {
        missing.forEach((input) => input.setAttribute("aria-invalid", "true"));
        setMessage(alert, `${missing.map((input) => form.querySelector(`label[for="${input.id}"]`)?.textContent).join(", ")} ${missing.length === 1 ? "is" : "are"} required.`);
        missing[0]!.focus();
        return;
      }
      const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      button.disabled = true;
      setMessage(alert, "");
      try {
        if (id) {
          const result = await api<{ changed: number }>(`/api/staff/items/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(readDetails(form)) });
          dirty = false;
          toast(result.changed ? "Changes saved." : "No changes to save.");
          await poll.refresh();
          await loadDetail(id, false);
          const title = sheet.querySelector("#sheet-title");
          const current = inventory?.items.find((entry) => entry.id === id);
          if (title && current) title.textContent = current.name;
        } else {
          const { id: created } = await api<{ id: string }>("/api/staff/items", { method: "POST", body: JSON.stringify(readDetails(form)) });
          dirty = false;
          toast(`Item ${created} created.`);
          await poll.refresh();
          openItem(created);
        }
      } catch (error) {
        setMessage(alert, failure(error));
      } finally {
        button.disabled = false;
      }
    });
  }

  function openNew(): void {
    if (dirty && !window.confirm("Discard your unsaved changes to this item?")) return;
    dirty = false;
    openId = null;
    writeParams({ item: null });
    sheetShell("New item", "Add an item", detailsFormMarkup({ needsReview: false }, true));
    if (!sheet.open) sheet.showModal();
    bindDetailsForm(null);
    sheet.querySelector<HTMLInputElement>("#f-name")!.focus();
  }
}
