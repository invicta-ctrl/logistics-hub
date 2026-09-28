import { ITEM_STATUSES, ITEM_TYPES, LENDING_AUDIENCES, isListedForLending } from "./catalog-policy";
import { ApiError, MARK, api, app, categoryName, escapeHtml, label, live, navigate, onLeave, stateMarkup, units } from "./ui";

type Item = {
  id: string; name: string; category: string; itemType: string; unit: string; status: string; needsReview: boolean;
  lendingAudience: string; onHand: number; reorderThreshold: number; storageLocation: string | null; listed: boolean;
};
type Inventory = { revision: number; items: Item[]; categories: string[] };
type Movement = { id: string; createdAt: string; movementType: string; signedQuantity: number; status: string; notes: string | null; actor: string | null };
type Detail = {
  item: Item & { defaultLoanDays: number | null; maximumLoanQty: number | null; notes: string | null; legacyReportedAvailable: number | null; migrationDelta: number | null };
  movements: Movement[];
};

const FILTERS: Record<string, { label: string; test: (item: Item) => boolean }> = {
  all: { label: "All items", test: () => true },
  listed: { label: "On Lending Hub", test: (item) => item.listed },
  queue: { label: "Loanable, not yet listed", test: (item) => item.itemType === "Loanable" && !item.listed && item.status !== "INACTIVE" },
  out: { label: "Out of stock", test: (item) => item.onHand <= 0 && item.status !== "INACTIVE" }
};
const MOVEMENT_LABELS: Record<string, string> = {
  OPENING_BALANCE: "Opening balance", STOCK_IN: "Stock in", STOCK_OUT: "Stock out", COUNT_ADJUSTMENT: "Count adjustment", ISSUE: "Issued (legacy system)"
};
const KINDS = {
  IN: { label: "Stock in", quantity: "Quantity to add", min: 1, note: "Reason (optional)", placeholder: "e.g. Delivery, returned item" },
  OUT: { label: "Stock out", quantity: "Quantity to remove", min: 1, note: "Reason (optional)", placeholder: "e.g. Issued for event, damaged" },
  COUNT: { label: "Count", quantity: "Counted on the shelf", min: 0, note: "Reason (required)", placeholder: "e.g. Monthly physical count" }
} as const;
const dateFormat = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

function expired(): void {
  navigate("/staff?expired=1", true);
}

function failure(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) expired();
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function staffLogin(): void {
  document.title = "Staff login · Department of Logistics";
  const ended = new URLSearchParams(window.location.search).has("expired");
  app.innerHTML = `<main id="main-content" class="signin"><section class="signin__card" aria-labelledby="signin-title">
    <a href="/" data-route aria-label="Department of Logistics home">${MARK}</a>
    <h1 id="signin-title">Staff login</h1>
    <p>Sign in to manage inventory and the Lending Hub.</p>
    <form id="staff-login" novalidate>
      <div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required /></div>
      <p id="staff-message" class="form-message form-message--error" role="status">${ended ? "Your session ended. Please sign in again." : ""}</p>
      <button class="btn btn--primary" type="submit">Sign in</button>
    </form>
    <p class="signin__foot">Accounts are issued by the Department of Logistics. <a href="/" data-route>Back to the public site</a></p>
  </section></main>`;
  const form = document.querySelector<HTMLFormElement>("#staff-login")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector<HTMLParagraphElement>("#staff-message")!;
    const button = form.querySelector<HTMLButtonElement>("button")!;
    const values = new FormData(form);
    if (!String(values.get("username")).trim() || !values.get("password")) { message.textContent = "Enter your username and password."; return; }
    button.disabled = true;
    button.textContent = "Signing in…";
    message.textContent = "";
    try {
      await api("/api/staff/login", { method: "POST", body: JSON.stringify({ username: values.get("username"), password: values.get("password") }) });
      navigate("/staff/inventory");
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Sign-in failed.";
      button.disabled = false;
      button.textContent = "Sign in";
      form.querySelector<HTMLInputElement>("#password")!.select();
    }
  });
}

function badges(item: Item): string {
  const list: string[] = [];
  if (item.listed) list.push(`<span class="badge badge--ok">On Lending Hub</span>`);
  if (item.needsReview) list.push(`<span class="badge badge--warn">Needs review</span>`);
  if (item.status !== "ACTIVE") list.push(`<span class="badge badge--quiet">${escapeHtml(label(item.status))}</span>`);
  if (item.onHand <= 0) list.push(`<span class="badge badge--bad">Out of stock</span>`);
  else if (item.reorderThreshold > 0 && item.onHand <= item.reorderThreshold) list.push(`<span class="badge badge--warn">Low stock</span>`);
  return list.join("");
}

function row(item: Item, changed: boolean): string {
  return `<tr data-id="${escapeHtml(item.id)}" class="${changed ? "item--changed" : ""}">
    <td><button type="button" class="inv__name">${escapeHtml(item.name)}</button><span class="inv__id">${escapeHtml(item.id)}${item.storageLocation ? ` · ${escapeHtml(item.storageLocation)}` : ""}</span></td>
    <td class="cat">${escapeHtml(categoryName(item.category))}</td>
    <td class="type">${escapeHtml(label(item.itemType))}</td>
    <td class="qty">${item.onHand} <small>${escapeHtml(units(item.onHand, item.unit))}</small></td>
    <td class="status"><div class="inv__badges">${badges(item)}</div></td></tr>`;
}

export async function workspace(): Promise<void> {
  let session: { displayName: string };
  try {
    session = await api("/api/staff/session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { navigate("/staff", true); return; }
    app.innerHTML = `<main id="main-content" class="wrap page-message">${stateMarkup("The staff workspace is unavailable", failure(error), `<a class="btn btn--line" href="/staff/inventory" data-route>Try again</a>`, "state--error")}</main>`;
    return;
  }
  document.title = "Inventory · Staff workspace";
  app.innerHTML = `<header class="shell__bar"><div class="wrap">
      <a class="shell__brand" href="/staff/inventory" data-route aria-label="Staff workspace home">${MARK}<span>Staff workspace</span></a>
      <nav class="shell__nav" aria-label="Staff"><a href="/staff/inventory" data-route aria-current="page">Inventory</a><a href="/lending" target="_blank" rel="noopener">View Lending Hub ↗</a></nav>
      <div class="shell__user"><strong>${escapeHtml(session.displayName)}</strong><button class="btn btn--line" type="button" id="staff-logout">Sign out</button></div>
    </div></header>
    <main id="main-content" class="wrap">
      <div class="shell__head">
        <div><h1>Inventory</h1><p>Quantities are derived from the movement ledger. Every change is recorded under your name.</p></div>
        <div class="shell__actions"><span class="live" id="live-status">Connecting…</span><button class="btn btn--primary" type="button" id="new-item">New item</button></div>
      </div>
      <div class="tiles" id="tiles" role="group" aria-label="Filter inventory"></div>
      <div class="toolbar inventory-tools">
        <label class="search"><span class="visually-hidden">Search inventory</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="inventory-search" type="search" autocomplete="off" placeholder="Search by name, ID, category, or location" /></label>
        <label><span class="visually-hidden">Category</span><select id="inventory-category"><option value="">All categories</option></select></label>
      </div>
      <p class="result-count" id="inventory-count" aria-live="polite"></p>
      <div id="inventory-results"><div class="stack" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div></div></div>
    </main>
    <dialog class="drawer" id="drawer" aria-labelledby="drawer-title"></dialog>`;

  let inventory: Inventory | null = null;
  let filter = "all";
  let openId: string | null = null;
  const previous = new Map<string, number>();
  const changed = new Set<string>();
  const drawer = document.querySelector<HTMLDialogElement>("#drawer")!;
  const search = document.querySelector<HTMLInputElement>("#inventory-search")!;
  const categorySelect = document.querySelector<HTMLSelectElement>("#inventory-category")!;

  const render = () => {
    if (!inventory) return;
    const items = inventory.items;
    document.querySelector("#tiles")!.innerHTML = Object.entries(FILTERS).map(([key, value]) =>
      `<button type="button" class="tile" data-filter="${key}" aria-pressed="${key === filter}"><strong class="num">${items.filter(value.test).length}</strong><span>${value.label}</span></button>`).join("");
    if (categorySelect.options.length !== inventory.categories.length + 1) {
      const selected = categorySelect.value;
      categorySelect.innerHTML = `<option value="">All categories</option>${inventory.categories.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(categoryName(value))}</option>`).join("")}`;
      categorySelect.value = selected;
    }
    const query = search.value.trim().toLowerCase();
    const shown = items.filter((item) => FILTERS[filter].test(item)
      && (!categorySelect.value || item.category === categorySelect.value)
      && (!query || `${item.name} ${item.id} ${item.category} ${item.storageLocation ?? ""}`.toLowerCase().includes(query)));
    document.querySelector("#inventory-count")!.textContent = `Showing ${shown.length} of ${items.length} items`;
    document.querySelector("#inventory-results")!.innerHTML = shown.length
      ? `<div class="table-wrap"><table class="inv"><caption class="visually-hidden">Inventory items</caption><thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Type</th><th scope="col" class="qty">On hand</th><th scope="col">Status</th></tr></thead><tbody>${shown.map((item) => row(item, changed.has(item.id))).join("")}</tbody></table></div>`
      : stateMarkup("No items match", "Try another search, category, or filter.");
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
      inventory = data;
      render();
      if (openChanged && openId) void loadDetail(openId, false);
    },
    onError: (error) => {
      if (error.status === 401) expired();
      else if (!inventory) document.querySelector("#inventory-results")!.innerHTML = stateMarkup("Inventory could not be loaded", `${error.message} Retrying automatically.`, "", "state--error");
    }
  });

  let searchTimer = 0;
  search.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(render, 120); });
  categorySelect.addEventListener("change", render);
  document.querySelector("#tiles")!.addEventListener("click", (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-filter]");
    if (tile) { filter = tile.dataset.filter!; render(); }
  });
  document.querySelector("#inventory-results")!.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-id]");
    if (target) openItem(target.dataset.id!);
  });
  document.querySelector("#new-item")!.addEventListener("click", () => openNew());
  document.querySelector("#staff-logout")!.addEventListener("click", async () => {
    try { await api("/api/staff/logout", { method: "POST" }); } finally { navigate("/staff", true); }
  });
  drawer.addEventListener("close", () => { openId = null; drawer.innerHTML = ""; });
  drawer.addEventListener("click", (event) => { if (event.target === drawer) drawer.close(); });
  onLeave(() => { if (drawer.open) drawer.close(); });

  function drawerShell(eyebrow: string, title: string, body: string): void {
    drawer.innerHTML = `<header class="drawer__head"><div><p class="eyebrow">${eyebrow}</p><h2 id="drawer-title">${escapeHtml(title)}</h2></div><button class="drawer__close" type="button" aria-label="Close" data-close>×</button></header><div class="drawer__body">${body}</div>`;
    drawer.querySelector("[data-close]")!.addEventListener("click", () => drawer.close());
  }

  function openItem(id: string): void {
    openId = id;
    const item = inventory?.items.find((entry) => entry.id === id);
    drawerShell(escapeHtml(id), item?.name ?? "Loading…", `<div class="skeleton"></div>`);
    if (!drawer.open) drawer.showModal();
    void loadDetail(id, true);
  }

  async function loadDetail(id: string, full: boolean): Promise<void> {
    try {
      const detail = await api<Detail>(`/api/staff/items/${encodeURIComponent(id)}`);
      if (openId !== id) return;
      if (full) renderDetail(detail);
      else {
        drawer.querySelector("#onhand")!.outerHTML = onHandMarkup(detail);
        drawer.querySelector("#history")!.innerHTML = historyMarkup(detail.movements);
        drawer.querySelector<HTMLFormElement>("#stock-form")?.dispatchEvent(new Event("input"));
      }
    } catch (error) {
      if (openId === id && full) drawer.querySelector(".drawer__body")!.innerHTML = stateMarkup("Could not load this item", failure(error), "", "state--error");
    }
  }

  function onHandMarkup({ item }: Detail): string {
    const delta = item.migrationDelta ?? 0;
    return `<div id="onhand"><div class="onhand" data-onhand="${item.onHand}"><div><strong class="num">${item.onHand}</strong> <span class="onhand__unit">${escapeHtml(units(item.onHand, item.unit))} on hand</span></div><div class="inv__badges">${badges(item)}</div></div>
      ${delta !== 0 ? `<p class="notice"><strong>Migration evidence:</strong> the legacy snapshot reported ${item.legacyReportedAvailable} ${escapeHtml(units(item.legacyReportedAvailable ?? 0, item.unit))}; the movement ledger derives ${item.onHand}. The difference is preserved as recorded. If a physical count confirms the correct figure, record it with a Count.</p>` : ""}</div>`;
  }

  function historyMarkup(movements: Movement[]): string {
    if (!movements.length) return `<li><span>No movements recorded yet.</span></li>`;
    return movements.map((movement) => {
      const quantity = movement.signedQuantity;
      return `<li><span>${escapeHtml(MOVEMENT_LABELS[movement.movementType] ?? movement.movementType)}${movement.status !== "POSTED" ? ` (${escapeHtml(movement.status.toLowerCase())})` : ""}</span>
        <span class="history__qty ${quantity > 0 ? "history__qty--in" : quantity < 0 ? "history__qty--out" : ""}">${quantity > 0 ? "+" : quantity < 0 ? "−" : ""}${Math.abs(quantity)}</span>
        <small>${escapeHtml(dateFormat.format(new Date(movement.createdAt)))} · ${escapeHtml(movement.actor ?? "Legacy system")}${movement.notes ? ` · ${escapeHtml(movement.notes)}` : ""}</small></li>`;
    }).join("");
  }

  function renderDetail(detail: Detail): void {
    const { item } = detail;
    drawerShell(`${escapeHtml(item.id)} · ${escapeHtml(categoryName(item.category))}`, item.name, `${onHandMarkup(detail)}
      <div class="tabs" role="tablist" aria-label="Item sections">
        <button type="button" role="tab" id="tab-stock" aria-controls="panel-stock" aria-selected="true">Stock</button>
        <button type="button" role="tab" id="tab-details" aria-controls="panel-details" aria-selected="false" tabindex="-1">Details &amp; lending</button>
        <button type="button" role="tab" id="tab-history" aria-controls="panel-history" aria-selected="false" tabindex="-1">History</button>
      </div>
      <section id="panel-stock" role="tabpanel" aria-labelledby="tab-stock">${stockFormMarkup()}</section>
      <section id="panel-details" role="tabpanel" aria-labelledby="tab-details" hidden>${detailsFormMarkup(detail.item)}</section>
      <section id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden><ul class="history" id="history">${historyMarkup(detail.movements)}</ul></section>`);
    const tabs = [...drawer.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const select = (tab: HTMLButtonElement) => tabs.forEach((entry) => {
      const active = entry === tab;
      entry.setAttribute("aria-selected", String(active));
      entry.tabIndex = active ? 0 : -1;
      drawer.querySelector<HTMLElement>(`#${entry.getAttribute("aria-controls")}`)!.hidden = !active;
    });
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        const next = tabs[(index + step + tabs.length) % tabs.length];
        select(next);
        next.focus();
      });
    });
    bindStockForm(item);
    bindDetailsForm(item.id);
  }

  function stockFormMarkup(): string {
    return `<form id="stock-form" class="stack" novalidate>
      <div class="segmented" role="radiogroup" aria-label="Movement type">${Object.entries(KINDS).map(([kind, value], index) => `<label><input type="radio" name="kind" value="${kind}" ${index === 0 ? "checked" : ""} />${value.label}</label>`).join("")}</div>
      <div class="grid-2"><div class="field"><label for="stock-quantity" id="stock-quantity-label">${KINDS.IN.quantity}</label><input id="stock-quantity" name="quantity" type="number" inputmode="numeric" min="1" max="100000" step="1" required /></div>
      <p class="preview" id="stock-preview" aria-live="polite"></p></div>
      <div class="field"><label for="stock-note" id="stock-note-label">${KINDS.IN.note}</label><input id="stock-note" name="note" maxlength="500" placeholder="${KINDS.IN.placeholder}" /></div>
      <p class="form-message" id="stock-message" role="status"></p>
      <button class="btn btn--primary" type="submit">Record stock in</button></form>`;
  }

  function bindStockForm(item: Detail["item"]): void {
    const form = drawer.querySelector<HTMLFormElement>("#stock-form")!;
    const quantity = form.querySelector<HTMLInputElement>("#stock-quantity")!;
    const note = form.querySelector<HTMLInputElement>("#stock-note")!;
    const message = form.querySelector<HTMLParagraphElement>("#stock-message")!;
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    let key = crypto.randomUUID();
    const kind = () => (new FormData(form).get("kind") ?? "IN") as keyof typeof KINDS;
    const update = (event?: Event) => {
      const config = KINDS[kind()];
      if (event?.type === "change") message.textContent = "";
      form.querySelector("#stock-quantity-label")!.textContent = config.quantity;
      form.querySelector("#stock-note-label")!.textContent = config.note;
      note.placeholder = config.placeholder;
      quantity.min = String(config.min);
      button.textContent = kind() === "COUNT" ? "Record count" : `Record ${config.label.toLowerCase()}`;
      const onHand = Number(drawer.querySelector<HTMLElement>("[data-onhand]")?.dataset.onhand ?? item.onHand);
      const value = Number(quantity.value);
      const preview = form.querySelector("#stock-preview")!;
      if (quantity.value === "" || !Number.isInteger(value) || value < config.min) { preview.textContent = ""; return; }
      const after = kind() === "IN" ? onHand + value : kind() === "OUT" ? onHand - value : value;
      preview.innerHTML = after < 0 ? `Only <strong>${onHand}</strong> on hand.` : `On hand after: <strong class="num">${after}</strong> ${escapeHtml(units(after, item.unit))}${kind() === "COUNT" ? ` (${after - onHand >= 0 ? "+" : "−"}${Math.abs(after - onHand)})` : ""}`;
    };
    form.addEventListener("change", update);
    form.addEventListener("input", () => { key = crypto.randomUUID(); update(); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = Number(quantity.value);
      if (quantity.value === "" || !Number.isInteger(value) || value < KINDS[kind()].min) { message.className = "form-message form-message--error"; message.textContent = "Enter a whole-number quantity."; quantity.focus(); return; }
      if (kind() === "COUNT" && !note.value.trim()) { message.className = "form-message form-message--error"; message.textContent = "Give a reason for the count adjustment."; note.focus(); return; }
      button.disabled = true;
      try {
        const result = await api<{ onHand: number }>(`/api/staff/items/${encodeURIComponent(item.id)}/movements`, { method: "POST", body: JSON.stringify({ kind: kind(), quantity: value, note: note.value, key }) });
        message.className = "form-message form-message--ok";
        message.textContent = `Recorded. On hand is now ${result.onHand} ${units(result.onHand, item.unit)}.`;
        form.reset();
        key = crypto.randomUUID();
        update();
        await loadDetail(item.id, false);
        await poll.refresh();
      } catch (error) {
        message.className = "form-message form-message--error";
        message.textContent = failure(error);
      } finally {
        button.disabled = false;
      }
    });
    update();
  }

  function detailsFormMarkup(item: Partial<Detail["item"]>, creating = false): string {
    const options = (values: readonly string[], current: string | undefined) => values.map((value) => `<option value="${value}" ${value === current ? "selected" : ""}>${escapeHtml(label(value))}</option>`).join("");
    const text = (id: string, title: string, value: unknown, extra = "") => `<div class="field"><label for="f-${id}">${title}</label><input id="f-${id}" name="${id}" value="${escapeHtml(value ?? "")}" ${extra} /></div>`;
    const number = (id: string, title: string, value: unknown, hint = "") => `<div class="field"><label for="f-${id}">${title}${hint ? ` <small>${hint}</small>` : ""}</label><input id="f-${id}" name="${id}" type="number" inputmode="numeric" min="0" step="1" value="${escapeHtml(value ?? 0)}" /></div>`;
    return `<form id="details-form" class="stack" novalidate>
      ${text("name", "Name", item.name, `required maxlength="120"`)}
      <div class="grid-2">${text("category", "Category", item.category, `required maxlength="100" list="category-options"`)}${text("unit", "Unit", item.unit, `required maxlength="30" placeholder="piece, box, pack"`)}</div>
      <datalist id="category-options">${(inventory?.categories ?? []).map((value) => `<option value="${escapeHtml(value)}"></option>`).join("")}</datalist>
      <div class="grid-2"><div class="field"><label for="f-itemType">Type</label><select id="f-itemType" name="itemType">${options(ITEM_TYPES, item.itemType ?? "Loanable")}</select></div>
        <div class="field"><label for="f-status">Status</label><select id="f-status" name="status">${options(ITEM_STATUSES, item.status ?? "ACTIVE")}</select></div></div>
      <div class="grid-2">${text("storageLocation", "Storage location", item.storageLocation, `maxlength="120"`)}${number("reorderThreshold", "Reorder level", item.reorderThreshold, "0 = off")}</div>
      ${creating ? number("openingQuantity", "Opening quantity", 0, "recorded as an opening movement") : ""}
      <fieldset><legend>Lending Hub</legend>
        <div class="field"><label for="f-lendingAudience">Who may borrow</label><select id="f-lendingAudience" name="lendingAudience">${options(LENDING_AUDIENCES, item.lendingAudience ?? "NOT_AVAILABLE_FOR_LENDING")}</select></div>
        <div class="grid-2">${number("defaultLoanDays", "Loan period (days)", item.defaultLoanDays)}${number("maximumLoanQty", "Maximum per loan", item.maximumLoanQty)}</div>
        <label class="check"><input type="checkbox" name="reviewed" ${item.needsReview === false || creating ? "checked" : ""} /> Details reviewed and verified</label>
        <p class="listing" id="listing-preview" aria-live="polite"></p>
      </fieldset>
      <div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" maxlength="1000">${escapeHtml(item.notes ?? "")}</textarea></div>
      <p class="form-message" id="details-message" role="status"></p>
      <button class="btn btn--primary" type="submit">${creating ? "Create item" : "Save changes"}</button></form>`;
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
    const form = drawer.querySelector<HTMLFormElement>("#details-form")!;
    const message = form.querySelector<HTMLParagraphElement>("#details-message")!;
    const preview = () => {
      const listed = isListedForLending(readDetails(form));
      const element = form.querySelector("#listing-preview")!;
      element.className = `listing ${listed ? "listing--on" : "listing--off"}`;
      element.textContent = listed ? "✓ Will appear on the public Lending Hub." : "Not shown publicly. Listing requires: Loanable type, Active status, an audience, and reviewed details.";
    };
    form.addEventListener("input", preview);
    form.addEventListener("change", preview);
    preview();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      button.disabled = true;
      message.className = "form-message";
      message.textContent = "Saving…";
      try {
        if (id) {
          const result = await api<{ changed: number }>(`/api/staff/items/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(readDetails(form)) });
          message.className = "form-message form-message--ok";
          message.textContent = result.changed ? "Saved." : "No changes to save.";
          await poll.refresh();
          const item = inventory?.items.find((entry) => entry.id === id);
          if (item) {
            drawer.querySelector("#drawer-title")!.textContent = item.name;
            drawer.querySelector("#onhand .inv__badges")!.innerHTML = badges(item);
          }
        } else {
          const { id: created } = await api<{ id: string }>("/api/staff/items", { method: "POST", body: JSON.stringify(readDetails(form)) });
          await poll.refresh();
          openItem(created);
        }
      } catch (error) {
        message.className = "form-message form-message--error";
        message.textContent = failure(error);
      } finally {
        button.disabled = false;
      }
    });
  }

  function openNew(): void {
    openId = null;
    drawerShell("New item", "Add an item", detailsFormMarkup({ needsReview: false }, true));
    drawer.showModal();
    bindDetailsForm(null);
    drawer.querySelector<HTMLInputElement>("#f-name")!.focus();
  }
}
