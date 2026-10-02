import { stockState } from "./catalog-policy";
import { type Preset, bindQuantityEditor, movementTitle, quantityEditor, signed } from "./movement-form";
import { type OpenUnit, bindOpenUnits, sealedLine } from "./open-unit-panel";
import { loadSession, shell } from "./staff";
import {
  type Html, api, categoryName, emptyState, expired, failure, formatDate, formatDateTime, formatTime, html, icon, label, live, mount,
  officeDay, onLeave, plural, preservingFocus, sheet as createSheet, sheetContent, toast, units, writeParams
} from "./ui";

type StockItem = {
  id: string; name: string; aliases: string | null; category: string; unit: string; status: string; onHand: number; reorderThreshold: number;
  storageLocation: string | null; stockArea: string | null; expiresOn: string | null; reorderStatus: string | null; countNeeded: boolean;
  itemType: string; consumptionMode: string; openUnits: number; openCondition: string | null;
};
type Reorder = { id: string; itemId: string; itemName: string; unit: string; status: string; desiredQuantity: number | null; note: string | null; updatedAt: string; closedAt: string | null; updatedBy: string | null };
type Activity = { id: string; createdAt: string; itemId: string; itemName: string; unit: string; movementType: string; related: string | null; change: number; afterQuantity: number; reason: string | null; notes: string | null; actor: string | null };
type Stock = { revision: number; items: StockItem[]; reorders: Reorder[]; activity: Activity[] };
type View = "attention" | "restock" | "pantry" | "activity";
type Focus = "all" | "out" | "low" | "count" | "expiring" | "open";

const EXPIRING_DAYS = 14;
const isOpen = (reorder: Reorder) => reorder.status === "NEEDS_RESTOCK" || reorder.status === "PLANNED";
const daysUntil = (isoDay: string) => Math.round((Date.parse(`${isoDay}T00:00:00Z`) - Date.parse(`${officeDay()}T00:00:00Z`)) / 86_400_000);
const tracked = (item: StockItem) => item.itemType === "Consumable" && item.consumptionMode === "OPEN_UNIT";
const expiring = (item: StockItem) => item.stockArea === "Pantry" && Boolean(item.expiresOn) && daysUntil(item.expiresOn!) <= EXPIRING_DAYS;

/** Why an item needs attention, most urgent first; empty when it does not. */
function reasons(item: StockItem): Array<Exclude<Focus, "all">> {
  if (item.status === "INACTIVE") return [];
  const list: Array<Exclude<Focus, "all">> = [];
  const state = stockState(item);
  if (state === "OUT") list.push("out");
  if (state === "LOW") list.push("low");
  if (item.countNeeded) list.push("count");
  if (expiring(item)) list.push("expiring");
  // Only a stored fault can leave more units open than on hand; the database refuses to create it.
  if (item.openUnits > item.onHand) list.push("open");
  return list;
}

const FOCUS: Record<Exclude<Focus, "all">, string> = { out: "Out of stock", low: "Low stock", count: "Needs count", expiring: "Expiring", open: "Open units need review" };

function expiryTag(item: StockItem): Html {
  if (!item.expiresOn) return html`<span class="muted">—</span>`;
  const days = daysUntil(item.expiresOn);
  const text = formatDate(item.expiresOn);
  if (days < 0) return html`<span class="tag tag--bad">Expired ${text}</span>`;
  if (days <= EXPIRING_DAYS) return html`<span class="tag tag--warn">${days === 0 ? "Expires today" : `In ${plural(days, "day")}`} · ${text}</span>`;
  return html`<span class="tag">${text}</span>`;
}

function whyTags(item: StockItem): Html {
  return html`<span class="tags">${reasons(item).map((reason) => {
    if (reason === "out") return html`<span class="tag tag--bad">Out of stock</span>`;
    if (reason === "low") return html`<span class="tag tag--warn">${item.onHand < item.reorderThreshold ? `Low · ${item.reorderThreshold - item.onHand} short of level` : "Low · at reorder level"}</span>`;
    if (reason === "count") return html`<span class="tag tag--pending">Needs count</span>`;
    if (reason === "open") return html`<span class="tag tag--warn">Open units need review</span>`;
    return expiryTag(item);
  })}${item.reorderStatus ? html`<span class="tag tag--gold">${label(item.reorderStatus)}</span>` : ""}</span>`;
}

const itemCell = (item: { id: string; name: string; storageLocation?: string | null }) => html`<td class="col-item"><a class="row-link" href="/staff/items?item=${item.id}" data-route>${item.name}</a><span class="cell-sub"><span class="mono">${item.id}</span>${item.storageLocation !== undefined ? html` · ${item.storageLocation ?? "No location"}` : ""}</span></td>`;
const qtyCell = (onHand: number, unit: string, item?: StockItem) => html`<td class="col-qty"><span class="qty">${onHand}</span> <span class="qty-unit">${units(onHand, unit)}</span>${item?.openUnits ? html`<span class="cell-sub">${sealedLine(onHand, item.openUnits, item.openCondition)}</span>` : ""}</td>`;
const levelCell = (item: StockItem) => html`<td class="col-level">${item.reorderThreshold > 0 ? item.reorderThreshold : html`<span class="muted">Not set</span>`}</td>`;

export async function stockWorkspace(): Promise<void> {
  const session = await loadSession("stock");
  if (!session) return;
  document.title = "Stock · Staff workspace";
  shell(session, "stock", html`
    <header class="page-header">
      <div class="page-header__title"><h1>Stock</h1><p id="stock-today">Loading today's activity…</p></div>
      <div class="page-header__actions">
        <p class="live-status" id="live-status">Connecting…</p>
        <button class="button button--primary record-open" type="button" data-record>${icon("plus")}Update stock</button>
      </div>
    </header>
    <div class="stock-layout">
      <section class="stock-main" aria-label="Stock lists">
        <div class="views" id="stock-views" role="group" aria-label="Stock views"></div>
        <div id="stock-results" aria-busy="true"><div class="data-table-wrap" aria-hidden="true">${Array.from({ length: 6 }, () => html`<div class="skeleton-row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></div>`)}</div></div>
      </section>
      <aside class="record-home" id="record-home" aria-labelledby="record-title">
        <div class="record-panel" id="record-panel">
          <h2 id="record-title" class="record-panel__title">Update stock</h2>
          <form id="record-form" class="form" novalidate>
            <div class="field">
              <label for="record-item">Item</label>
              <input id="record-item" name="item" list="record-items" autocomplete="off" spellcheck="false" placeholder="Search by name or ID" data-search aria-describedby="record-item-card" />
              <datalist id="record-items"></datalist>
            </div>
            <div class="record-card" id="record-card" aria-live="polite"><p class="muted">Choose an item to see what is on the shelf.</p></div>
            ${quantityEditor("record")}
          </form>
          <div id="record-open-units"></div>
          <ol class="receipts" id="receipts" aria-label="Recorded this session"></ol>
        </div>
      </aside>
    </div>
    <dialog class="sheet" id="record-sheet" aria-labelledby="sheet-title"></dialog>`);

  const params = new URLSearchParams(window.location.search);
  let view: View = (["attention", "restock", "pantry", "activity"] as const).find((value) => value === params.get("view")) ?? "attention";
  let focus: Focus = (["all", "out", "low", "count", "expiring", "open"] as const).find((value) => value === params.get("show")) ?? "all";
  let todayOnly = params.get("range") !== "recent";
  let stock: Stock | null = null;
  let selected: StockItem | null = null;
  let optionsSignature = "";
  const results = document.querySelector<HTMLElement>("#stock-results")!;
  const input = document.querySelector<HTMLInputElement>("#record-item")!;
  const form = document.querySelector<HTMLFormElement>("#record-form")!;
  const receipts: Html[] = [];

  /* ---------- Record panel (an aside on desktop, a bottom sheet on phones) ---------- */

  const compact = window.matchMedia("(max-width: 960px)");
  const recordSheet = document.querySelector<HTMLDialogElement>("#record-sheet")!;
  const panelNode = document.querySelector<HTMLElement>("#record-panel")!;
  const home = document.querySelector<HTMLElement>("#record-home")!;
  const lent = createSheet(recordSheet, { onClose: () => home.append(panelNode) });
  const showRecord = () => {
    if (compact.matches) {
      mount(recordSheet, sheetContent("Stock", "Update stock", html``));
      recordSheet.querySelector(".sheet__body")!.append(panelNode);
      lent.open();
    }
    (selected ? form.querySelector<HTMLInputElement>("input[name=total]")! : input).focus();
  };

  const movement = bindQuantityEditor(form, {
    target: () => selected,
    onRecorded: async (target, result, reason) => {
      receipts.unshift(html`<li><strong>${signed(result.change)}</strong> ${target.name} <span class="muted">· ${result.onHand - result.change} → ${result.onHand} ${units(result.onHand, target.unit)} · ${label(reason).toLowerCase()} ${formatTime(new Date().toISOString())}</span></li>`);
      mount(document.querySelector("#receipts")!, html`${receipts.slice(0, 5)}`);
      await poll.refresh();
      // Ready for the next entry: a fresh item.
      select(null);
      input.value = "";
      input.focus();
    }
  });

  /* An open-unit item's units, loaded when it is chosen (the list carries only how many are open). */
  let openUnits: { itemId: string; units: OpenUnit[] } | null = null;
  const openPanel = bindOpenUnits(document.querySelector<HTMLElement>("#record-open-units")!,
    () => selected && openUnits?.itemId === selected.id ? { ...selected, openUnits: openUnits.units } : null,
    async (summary) => { if (selected) openUnits = { itemId: selected.id, units: summary.openUnits }; await poll.refresh(); });
  async function loadOpenUnits(item: StockItem): Promise<void> {
    try {
      const detail = await api<{ openUnits: OpenUnit[] }>(`/api/staff/items/${encodeURIComponent(item.id)}`);
      if (selected?.id !== item.id) return;
      openUnits = { itemId: item.id, units: detail.openUnits };
      openPanel.render();
    } catch (error) { toast(failure(error), "error"); }
  }

  function select(item: StockItem | null): void {
    const changed = item?.id !== selected?.id || item?.openUnits !== selected?.openUnits || item?.openCondition !== selected?.openCondition || item?.onHand !== selected?.onHand;
    selected = item;
    if (!item || !tracked(item) && !item.openUnits) openUnits = null;
    else if (changed) void loadOpenUnits(item);
    openPanel.render();
    const card = document.querySelector("#record-card")!;
    if (!item) { mount(card, html`<p class="muted">Choose an item to see what is on the shelf.</p>`); movement.refresh(); return; }
    mount(card, html`<p class="record-card__name">${item.name} <span class="mono muted">${item.id}</span></p>
      <p class="record-card__meta"><strong>${item.onHand}</strong> ${units(item.onHand, item.unit)} on hand${item.openUnits ? ` (${sealedLine(item.onHand, item.openUnits, item.openCondition)})` : ""} · ${item.storageLocation ?? "No location"} · reorder level ${item.reorderThreshold > 0 ? item.reorderThreshold : "not set"}</p>
      ${reasons(item).length || item.reorderStatus ? whyTags(item) : ""}`);
    movement.refresh();
  }

  const findItem = (value: string): StockItem | null => {
    if (!stock) return null;
    const id = value.match(/ITM-[A-Za-z0-9-]+/i)?.[0]?.toUpperCase();
    if (id) return stock.items.find((item) => item.id === id) ?? null;
    const matches = stock.items.filter((item) => item.name.toLowerCase() === value.trim().toLowerCase());
    return matches.length === 1 ? matches[0]! : null;
  };
  input.addEventListener("input", () => {
    const item = findItem(input.value);
    if (item?.id !== selected?.id) select(item);
  });

  /** Prefills the panel from a row action: the item, the likely change and reason, and optionally a restock entry. */
  function startRecord(itemId: string, preset: Preset): void {
    const item = stock?.items.find((entry) => entry.id === itemId) ?? null;
    if (!item) return;
    input.value = `${item.name} · ${item.id}`;
    select(item);
    movement.preset(preset);
    showRecord();
  }

  /* ---------- Lists ---------- */

  const tab = (key: View, text: string, count: number | string) => html`<button type="button" class="view-tab" data-view="${key}" aria-pressed="${key === view}">${text}<span class="view-tab__count">${count}</span></button>`;

  function attentionMarkup(data: Stock): Html {
    const needing = data.items.filter((item) => reasons(item).length);
    const counts = Object.fromEntries((Object.keys(FOCUS) as Array<keyof typeof FOCUS>).map((key) => [key, needing.filter((item) => reasons(item).includes(key)).length]));
    const shown = needing.filter((item) => focus === "all" || reasons(item).includes(focus))
      .sort((a, b) => ["out", "open", "low", "count", "expiring"].indexOf(reasons(a)[0]!) - ["out", "open", "low", "count", "expiring"].indexOf(reasons(b)[0]!) || a.name.localeCompare(b.name));
    const unset = data.items.filter((item) => item.status !== "INACTIVE" && item.reorderThreshold <= 0).length;
    return html`<div class="chips chips--flush" role="group" aria-label="Show">
        ${[["all", "Everything", needing.length], ...Object.entries(FOCUS).filter(([key]) => key !== "open" || counts.open || focus === "open").map(([key, text]) => [key, text, counts[key]])].map(([key, text, count]) =>
          html`<button type="button" class="chip" data-focus="${key}" aria-pressed="${key === focus}">${text}<span class="chip__count">${count}</span></button>`)}
      </div>
      ${unset ? html`<p class="hint-line">${icon("info")}<span>${plural(unset, "active item")} ${unset === 1 ? "has" : "have"} no reorder level, so ${unset === 1 ? "it is" : "they are"} never called low. Set levels in an item's Edit details in <a class="text-link" href="/staff/items" data-route>Items</a>.</span></p>` : ""}
      ${shown.length ? html`<div class="data-table-wrap"><table class="data-table data-table--static">
        <caption class="visually-hidden">Items that need attention</caption>
        <thead><tr><th scope="col" class="col-item">Item</th><th scope="col" class="col-qty">On hand</th><th scope="col" class="col-level">Reorder level</th><th scope="col">Why</th><th scope="col" class="col-actions"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${shown.map((item) => html`<tr data-key="${item.id}">${itemCell(item)}${qtyCell(item.onHand, item.unit, item)}${levelCell(item)}<td>${whyTags(item)}</td>
          <td class="col-actions"><span class="row-actions">
            ${reasons(item)[0] === "open" ? html`<button type="button" class="button button--secondary button--sm" data-open-units="${item.id}">Open units</button>`
              : html`<button type="button" class="button button--secondary button--sm" data-record-item="${item.id}" data-reason="${reasons(item)[0] === "count" ? "COUNT" : "DELIVERY"}">${reasons(item)[0] === "count" ? "Count" : "Stock in"}</button>`}
            ${item.reorderStatus ? "" : html`<button type="button" class="button button--ghost button--sm" data-restock="${item.id}">Add to restock</button>`}
          </span></td></tr>`)}</tbody></table></div>`
        : emptyState(focus === "all" ? "Nothing needs attention" : `No items: ${FOCUS[focus as keyof typeof FOCUS]}`, focus === "all" ? "Every active item is in stock, above its reorder level, counted where needed, and not near expiry." : "Try another filter.")}`;
  }

  function restockMarkup(data: Stock): Html {
    const open = data.reorders.filter(isOpen);
    const closed = data.reorders.filter((reorder) => !isOpen(reorder));
    const byId = new Map(data.items.map((item) => [item.id, item]));
    const suggestions = data.items.filter((item) => item.status !== "INACTIVE" && item.reorderThreshold > 0 && stockState(item) !== "OK" && !item.reorderStatus);
    return html`
      ${open.length ? html`<div class="data-table-wrap"><table class="data-table data-table--static">
        <caption class="visually-hidden">Restock list</caption>
        <thead><tr><th scope="col" class="col-item">Item</th><th scope="col" class="col-qty">On hand</th><th scope="col" class="col-desired">Restock qty</th><th scope="col">Status</th><th scope="col" class="col-actions"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${open.map((reorder) => {
          const item = byId.get(reorder.itemId);
          return html`<tr data-key="${reorder.id}">${itemCell({ id: reorder.itemId, name: reorder.itemName, storageLocation: item?.storageLocation ?? null })}${qtyCell(item?.onHand ?? 0, reorder.unit)}
            <td class="col-desired"><label class="visually-hidden" for="desired-${reorder.id}">Restock quantity for ${reorder.itemName}</label><input class="input-compact" id="desired-${reorder.id}" type="number" inputmode="numeric" min="0" max="100000" step="1" value="${reorder.desiredQuantity ?? ""}" placeholder="—" data-desired="${reorder.id}" /></td>
            <td><span class="tag ${reorder.status === "PLANNED" ? "tag--gold" : "tag--warn"}">${label(reorder.status)}</span><span class="cell-sub">${reorder.note ?? ""}${reorder.note && reorder.updatedBy ? " · " : ""}${reorder.updatedBy ?? ""}</span></td>
            <td class="col-actions"><span class="row-actions">
              <button type="button" class="button button--primary button--sm" data-receive="${reorder.id}">Receive</button>
              <button type="button" class="button button--secondary button--sm" data-status="${reorder.status === "PLANNED" ? "NEEDS_RESTOCK" : "PLANNED"}" data-reorder="${reorder.id}">${reorder.status === "PLANNED" ? "Not planned" : "Mark planned"}</button>
              <button type="button" class="button button--ghost button--sm" data-status="DISMISSED" data-reorder="${reorder.id}">Dismiss</button>
            </span></td></tr>`;
        })}</tbody></table></div>`
        : emptyState("The restock list is empty", "Add items from Needs attention, or from the suggestions below when stock drops to its reorder level.")}
      ${suggestions.length ? html`<section class="subsection" aria-labelledby="suggested-title"><h2 class="subsection__title" id="suggested-title">Suggested from reorder levels</h2>
        <ul class="plain-list">${suggestions.map((item) => html`<li><span><strong>${item.name}</strong> <span class="muted">· ${item.onHand} on hand, level ${item.reorderThreshold}</span></span><button type="button" class="button button--secondary button--sm" data-restock="${item.id}">Add</button></li>`)}</ul></section>` : ""}
      ${closed.length ? html`<section class="subsection" aria-labelledby="closed-title"><h2 class="subsection__title" id="closed-title">Closed in the last two weeks</h2>
        <ul class="plain-list plain-list--muted">${closed.map((reorder) => html`<li><span>${reorder.itemName}</span><span class="muted">${label(reorder.status)} · ${formatDateTime(reorder.closedAt ?? reorder.updatedAt)}${reorder.updatedBy ? ` · ${reorder.updatedBy}` : ""}</span></li>`)}</ul></section>` : ""}`;
  }

  function pantryMarkup(data: Stock): Html {
    const pantry = data.items.filter((item) => item.stockArea === "Pantry" && item.status !== "INACTIVE")
      .sort((a, b) => Number(expiring(b)) - Number(expiring(a)) || a.name.localeCompare(b.name));
    if (!pantry.length) return emptyState("No pantry items", "Set an item's stock area to Pantry in Items → Edit details to track it here.");
    return html`<div class="data-table-wrap"><table class="data-table data-table--static">
      <caption class="visually-hidden">Pantry items</caption>
      <thead><tr><th scope="col" class="col-item">Item</th><th scope="col" class="col-qty">On hand</th><th scope="col" class="col-level">Reorder level</th><th scope="col">Expiry</th><th scope="col">Status</th><th scope="col" class="col-actions"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${pantry.map((item) => html`<tr data-key="${item.id}">${itemCell(item)}${qtyCell(item.onHand, item.unit, item)}${levelCell(item)}<td>${expiryTag(item)}</td>
        <td>${stockState(item) === "OUT" ? html`<span class="tag tag--bad">Out of stock</span>` : stockState(item) === "LOW" ? html`<span class="tag tag--warn">Low stock</span>` : html`<span class="tag tag--ok">In stock</span>`}</td>
        <td class="col-actions"><span class="row-actions">${tracked(item)
          ? html`<button type="button" class="button button--secondary button--sm" data-open-units="${item.id}">Open units</button>`
          : html`<button type="button" class="button button--secondary button--sm" data-record-item="${item.id}" data-reason="CONSUMED" data-delta="-1">Use</button>`}<button type="button" class="button button--ghost button--sm" data-record-item="${item.id}" data-reason="DELIVERY">Restock</button></span></td></tr>`)}</tbody></table></div>`;
  }

  function activityMarkup(data: Stock): Html {
    const today = officeDay();
    const entries = data.activity.filter((entry) => !todayOnly || officeDay(entry.createdAt) === today);
    return html`<div class="sort-toggle activity-range" role="group" aria-label="Period">
        <button type="button" data-range="today" aria-pressed="${todayOnly}">Today</button><button type="button" data-range="recent" aria-pressed="${!todayOnly}">Recent</button>
      </div>
      ${entries.length ? html`<ol class="activity-list">${entries.map((entry) => html`<li class="activity-row ${entry.change > 0 ? "is-in" : entry.change < 0 ? "is-out" : ""}">
          <p class="activity-row__change">${signed(entry.change)}</p>
          <div class="activity-row__main">
            <p><a class="row-link" href="/staff/items?item=${entry.itemId}" data-route>${entry.itemName}</a> <span class="muted">· ${movementTitle(entry.related === "OPEN_UNIT" ? "UNIT_EMPTIED" : entry.movementType, entry.change, entry.reason)}</span></p>
            <p class="cell-sub">${entry.afterQuantity - entry.change} → ${entry.afterQuantity} ${units(entry.afterQuantity, entry.unit)} · ${entry.actor ?? "Unknown"} · <time datetime="${entry.createdAt}">${todayOnly ? formatTime(entry.createdAt) : formatDateTime(entry.createdAt)}</time>${entry.notes ? ` · ${entry.notes}` : ""}</p>
          </div></li>`)}</ol>`
        : emptyState(todayOnly ? "No stock changes today" : "No stock activity yet", todayOnly ? "Movements recorded today appear here as they happen." : "Stock in, stock out and counts appear here.")}`;
  }

  const render = () => {
    if (!stock) return;
    results.removeAttribute("aria-busy");
    writeParams({ view: view === "attention" ? null : view, show: view === "attention" && focus !== "all" ? focus : null, range: view === "activity" && !todayOnly ? "recent" : null });
    const needing = stock.items.filter((item) => reasons(item).length).length;
    const today = stock.activity.filter((entry) => officeDay(entry.createdAt) === officeDay());
    const pantry = stock.items.filter((item) => item.stockArea === "Pantry" && item.status !== "INACTIVE");
    const soon = pantry.filter(expiring).length;
    mount(document.querySelector("#stock-views")!, html`${tab("attention", "Needs attention", needing)}${tab("restock", "Restock list", stock.reorders.filter(isOpen).length)}${tab("pantry", soon ? `Pantry · ${soon} expiring` : "Pantry", pantry.length)}${tab("activity", "Activity", today.length)}`);
    document.querySelector("#stock-today")!.textContent = today.length
      ? `${plural(today.length, "stock movement")} today · last by ${today[0]!.actor ?? "staff"} at ${formatTime(today[0]!.createdAt)}`
      : "No stock movements recorded today yet.";
    preservingFocus(results, () => mount(results, view === "attention" ? attentionMarkup(stock!) : view === "restock" ? restockMarkup(stock!) : view === "pantry" ? pantryMarkup(stock!) : activityMarkup(stock!)));
  };

  const poll = live<Stock>("/api/staff/stock", {
    interval: 10_000,
    status: () => document.querySelector("#live-status"),
    onData: (data) => {
      stock = data;
      // The item picker lists every active item; rebuild it only when names change.
      const signature = data.items.map((item) => `${item.id}${item.name}${item.status}`).join("|");
      if (signature !== optionsSignature) {
        optionsSignature = signature;
        mount(document.querySelector("#record-items")!, html`${data.items.filter((item) => item.status !== "INACTIVE").map((item) => html`<option value="${item.name} · ${item.id}">${categoryName(item.category)}</option>`)}`);
      }
      if (selected) select(data.items.find((item) => item.id === selected!.id) ?? null);
      render();
    },
    onError: (error) => {
      if (error.status === 401) expired();
      else if (!stock) { results.removeAttribute("aria-busy"); mount(results, emptyState("Stock could not be loaded", `${error.message} Retrying automatically.`, "", "error")); }
    }
  });

  /* ---------- Actions ---------- */

  async function restock(itemId: string): Promise<void> {
    try {
      await api("/api/staff/reorders", { method: "POST", body: JSON.stringify({ itemId }) });
      toast(`${stock?.items.find((item) => item.id === itemId)?.name ?? itemId} added to the restock list.`);
      await poll.refresh();
    } catch (error) { toast(failure(error), "error"); }
  }

  async function patchReorder(reorder: Reorder, changes: { status?: string; desiredQuantity?: number | null }): Promise<void> {
    try {
      await api(`/api/staff/reorders/${encodeURIComponent(reorder.id)}`, { method: "PATCH", body: JSON.stringify({ status: changes.status ?? reorder.status, desiredQuantity: changes.desiredQuantity, updatedAt: reorder.updatedAt }) });
      if (changes.status) toast(changes.status === "DISMISSED" ? `${reorder.itemName} removed from the restock list.` : `${reorder.itemName}: ${label(changes.status).toLowerCase()}.`);
      await poll.refresh();
    } catch (error) { toast(failure(error), "error"); await poll.refresh(); }
  }

  document.querySelector("#stock-views")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]");
    if (button) { view = button.dataset.view as View; render(); }
  });
  document.querySelector("[data-record]")!.addEventListener("click", showRecord);
  results.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const chip = target.closest<HTMLButtonElement>("[data-focus]");
    if (chip) { focus = chip.dataset.focus as Focus; render(); results.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus(); return; }
    const range = target.closest<HTMLButtonElement>("[data-range]");
    if (range) { todayOnly = range.dataset.range === "today"; render(); return; }
    const record = target.closest<HTMLButtonElement>("[data-record-item]");
    if (record) return startRecord(record.dataset.recordItem!, { reason: record.dataset.reason, delta: record.dataset.delta ? Number(record.dataset.delta) : undefined });
    const openUnitsButton = target.closest<HTMLButtonElement>("[data-open-units]");
    if (openUnitsButton) return startRecord(openUnitsButton.dataset.openUnits!, {});
    const add = target.closest<HTMLButtonElement>("[data-restock]");
    if (add) return void restock(add.dataset.restock!);
    const receive = target.closest<HTMLButtonElement>("[data-receive]");
    const reorderOf = (id: string | undefined) => stock?.reorders.find((entry) => entry.id === id);
    if (receive) {
      const reorder = reorderOf(receive.dataset.receive);
      if (reorder) startRecord(reorder.itemId, { delta: reorder.desiredQuantity ?? undefined, reorderId: reorder.id, reason: "DELIVERY", context: `Receiving the restock of ${reorder.itemName}. Saving the added stock closes the entry.` });
      return;
    }
    const status = target.closest<HTMLButtonElement>("[data-status]");
    if (status) {
      const reorder = reorderOf(status.dataset.reorder);
      if (reorder && (status.dataset.status !== "DISMISSED" || window.confirm(`Remove ${reorder.itemName} from the restock list?`))) void patchReorder(reorder, { status: status.dataset.status });
    }
  });
  results.addEventListener("change", (event) => {
    const field = (event.target as HTMLElement).closest<HTMLInputElement>("[data-desired]");
    const reorder = stock?.reorders.find((entry) => entry.id === field?.dataset.desired);
    if (!field || !reorder) return;
    const value = field.value === "" ? null : Number(field.value);
    if (value !== null && (!Number.isInteger(value) || value < 0)) { field.setAttribute("aria-invalid", "true"); toast("Restock quantity must be a whole number.", "error"); return; }
    void patchReorder(reorder, { desiredQuantity: value });
  });
  onLeave(() => { receipts.length = 0; });
}
