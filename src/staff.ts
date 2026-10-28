import { resolveItemIcon } from "./item-icons";
import { itemVisualControl } from "./item-visual-control";
import { suggest, type Suggestion } from "./catalogue-suggest";
import { formatItemName, BEHAVIOUR_LABELS, type Behaviour, CONSUMPTION_MODES, ITEM_STATUSES, ITEM_TYPES, openUnitCandidate, LENDING_AUDIENCES, LISTABLE_ITEM_TYPES, PUBLIC_LENDING_ITEM_TYPE, STOCK_AREAS, STOCK_STATE_LABELS, behaviourFields, listingGaps, stockState } from "./catalog-policy";
import { type Borrower, type Loan, bindLoanForm, loanFields, loanRow, openReturn } from "./loan-form";
import { bindQuantityEditor, movementTitle, quantityEditor, signed } from "./movement-form";
import { type Photo, type PhotoCleanup, type PhotoPanel, openViewer, photoPanel, photoUrl, rowThumb, shownUrl } from "./item-photo";
import { MAX_DEPTH, PATH_SEPARATOR, REPORT_LABELS, type ReportKind, VISIBILITY_LABELS, ancestry, inOrder, pathOf, placesOf, withinPlace } from "./location-tree";
import { type Step, openWhereIsIt } from "./where-is-it";
import { type ItemLink, bindItemLinks } from "./item-links-panel";
import { type OpenUnit, bindOpenUnits, sealedLine } from "./open-unit-panel";
import { bulkBar } from "./bulk-select";
import { placeList } from "./catalogue-places";
import { ageOf, loadSession, shell } from "./staff-shell";
import { ApiError, type Html, animateNumber, api, categoryName, emptyState, expired, failure, formatDateTime, formatQuantity, html, icon, label, live, mount, onLeave, plural, preservingFocus, raw, setMessage, sheet as createSheet, sheetContent, toast, units, working, writeParams } from "./ui";

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
type Movement = { id: string; createdAt: string; sortAt?: string; movementType: string; signedQuantity: number; status: string; notes: string | null; reason: string | null; related: string | null; actor: string | null; afterQuantity: number; borrower: string | null; purpose: string | null };
type Change = { from: unknown; to: unknown };
type CatalogEvent = { id?: string; at: string; sortAt?: string; action: string; actor: string | null; details: Record<string, unknown> };
/** Where the next page of an item's history starts (inventory.ts historyCursor). */
type HistoryCursor = { at: string; id: string };
/** The item's open restock entry, if it has one. */
type OpenReorder = { id: string; status: string; desiredQuantity: number | null; updatedAt: string };
type KitChoice = { id: string; name: string; active: boolean };
type KitDetail = { kit: KitChoice & { description: string | null; locationId: string | null; updatedAt: string }; components: Array<{ itemId: string; required: number }> };
type DetailItem = Item & {
  location: string | null; notes: string | null; updatedAt: string | null; listingGaps: string[]; photo: Photo | null; photoCleanup?: PhotoCleanup;
  legacyReportedAvailable: number | null; migratedOnHand: number; migrationDelta: number | null;
  legacySourceSheet: string | null; legacySourceRow: string | null; verificationNote: string | null; importedFrom: string | null;
};
/** Derived from checks of a place and counts (V1.7), never stored: when the item was last seen at its place, and a finding nothing has settled. */
type Freshness = { lastVerifiedAt: string | null; lastCountedAt: string | null; openDiscrepancy: { outcome: string; at: string; auditId: string } | null };
/** A check's finding, as the profile says it. */
const FINDING_WORDS: Record<string, string> = { MISMATCH: "a different count", CANT_FIND: "it couldn’t be found", FOUND_HERE: "it somewhere else", NEEDS_REVIEW: "the record looks wrong" };
type Detail = { mergedInto?: { id: string; name: string } | null; item: DetailItem; movements: Movement[]; events: CatalogEvent[]; loans: Loan[]; openUnits: OpenUnit[]; reports: Report[]; usesRecorded: number; unitsEmptied: number; freshness?: Freshness; kits?: Array<{ id: string; name: string; active: boolean; required: number }>; links?: ItemLink[];
  historyNext?: HistoryCursor | null; reorder?: OpenReorder | null };
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
  review: { label: "Needs details check", test: (item: Item) => item.needsReview },
  ready: { label: "Ready to list", test: (item: Item) => LISTABLE_ITEM_TYPES.has(item.itemType) && !item.listed && active(item) },
  listed: { label: "On Lending Hub", test: (item: Item) => item.listed },
  low: { label: "Low stock", test: (item: Item) => isLow(item) && active(item) },
  out: { label: "Out of stock", test: (item: Item) => stockState(item) === "OUT" && active(item) },
  inactive: { label: "Inactive", test: (item: Item) => !active(item) },
  gradual: { label: "Used gradually?", test: openUnitCandidate },
  // Shown only while something is waiting: a report from the shelf or a phone, or a typed location that has no place yet.
  reports: { label: "Location reports", test: (item: Item) => item.openReports > 0, quiet: true },
  unplaced: { label: "Needs a place", test: (item: Item) => !item.locationId && Boolean(item.legacyLocation), quiet: true }
} satisfies Record<string, { label: string; test: (item: Item) => boolean; quiet?: true }>;
type View = keyof typeof VIEWS;
const NO_LOCATION = "__none";
/** Rows drawn at first, and added by each "Show more". */
const ROW_PAGE = 100;
/** How staff see the type: their choice between lending an item out and using it up. */
const TYPE_CHOICES: Record<string, string> = { Loanable: "Borrow (Loanable)", Consumable: "Take (Consumable)" };
const FIELD_LABELS: Record<string, string> = {
  name: "Name", aliases: "Other names", category: "Category", itemType: "Type", unit: "Unit", status: "Status", storageLocation: "Place",
  reorderThreshold: "Reorder level", lendingAudience: "Who may borrow", defaultLoanDays: "Loan period (days)", maximumLoanQty: "Maximum per loan",
  needsReview: "Review", notes: "Internal notes", model: "Model", serialNumber: "Serial number", stockArea: "Stock area", expiresOn: "Earliest expiry", consumptionMode: "Normally used"
};
const LENDING_FIELDS = ["lendingAudience", "defaultLoanDays", "maximumLoanQty"];

/* ---------- Shared item markup ---------- */

const STOCK_TAG_TONES = { OUT: "tag--bad", ON_LOAN: "tag--pending", LOW: "tag--warn", OK: "tag--ok" } as const;
/** An open restock entry, as its tag says it. */
const RESTOCK_LABELS: Record<string, string> = { NEEDS_RESTOCK: "Restock requested", PLANNED: "Restock planned" };
/** The status choices, each on its axis: VERIFY is an active item whose figure needs a count (V1.16.4 §4.3). */
const STATUS_CHOICES: Record<string, string> = { ACTIVE: "Active", VERIFY: "Active, needs a count", INACTIVE: "Inactive" };

/**
 * An item's tags, one per status axis (V1.16.4 §4.3), so no tag text stands for two fields: lifecycle (Inactive), classification
 * (Unclassified), details check (Needs details check), quantity confidence (Needs count), availability (computed) and restock.
 */
function tags(item: Item): Html {
  const list: Html[] = [];
  if (item.listed) list.push(html`<span class="tag tag--ok">On Lending Hub</span>`);
  if (item.status === "INACTIVE") list.push(html`<span class="tag">Inactive</span>`);
  if (item.itemType === "NEEDS_REVIEW") list.push(html`<span class="tag tag--pending">Unclassified</span>`);
  if (item.needsReview) list.push(html`<span class="tag tag--pending">Needs details check</span>`);
  if (item.countNeeded) list.push(html`<span class="tag tag--warn">Needs count</span>`);
  if (item.openUnits > item.onHand) list.push(html`<span class="tag tag--warn">Open units need review</span>`);
  if (item.openReports) list.push(html`<span class="tag tag--warn">Location reported</span>`);
  const state = stockState(item);
  if (state !== "OK") list.push(html`<span class="tag ${STOCK_TAG_TONES[state]}">${STOCK_STATE_LABELS[state]}</span>`);
  if (item.reorderStatus) list.push(html`<span class="tag tag--gold">${RESTOCK_LABELS[item.reorderStatus] ?? label(item.reorderStatus)}</span>`);
  return html`<span class="tags">${list}</span>`;
}

/** One history entry in two answers: by id, or, from a Worker before V1.16.4, by its time and action. */
const sameEvent = (a: CatalogEvent, b: CatalogEvent) => a.id ? a.id === b.id : a.at === b.at && a.action === b.action;
/** Out on loan now, from the item's own loans. */
const onLoanOf = (loans: Loan[]) => loans.filter((loan) => loan.status === "OUT").reduce((sum, loan) => sum + loan.quantity, 0);

/** The list row's facts for the open item, read from its own record: what its tags and next action go by. */
function profileFacts({ item, loans, freshness, reorder, openUnits, reports }: Detail): Item {
  const lastCountedAt = freshness?.lastCountedAt ?? item.lastCountedAt ?? null;
  return { ...item, onLoan: onLoanOf(loans), openUnits: openUnits.length, openReports: reports.filter((report) => !report.resolvedAt).length, reorderStatus: reorder?.status ?? null, lastCountedAt,
    countNeeded: item.status !== "INACTIVE" && !lastCountedAt && ((item.migrationDelta ?? 0) !== 0 || item.status === "VERIFY") };
}

type NextAction = { key: "classify" | "count" | "place" | "stock-in" | "lend" | "return"; label: string };
/** The one next step the item's state asks for (V1.16.4 §4.3), most pressing first; an inactive item has none. */
function nextAction(detail: Detail): NextAction | null {
  const facts = profileFacts(detail);
  if (facts.status === "INACTIVE") return null;
  if (facts.itemType === "NEEDS_REVIEW") return { key: "classify", label: "Classify" };
  if (facts.countNeeded) return { key: "count", label: "Count" };
  if (!facts.locationId) return { key: "place", label: "Choose place" };
  const state = stockState(facts);
  if (state === "ON_LOAN") return { key: "return", label: "Return" };
  if (state === "OUT" || state === "LOW") return { key: "stock-in", label: "Stock in" };
  return facts.itemType === PUBLIC_LENDING_ITEM_TYPE && facts.onHand > 0 ? { key: "lend", label: "Lend" } : { key: "stock-in", label: "Stock in" };
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
  if (event.action === "ITEM_MERGED") return "Duplicate merged";
  if (event.action === "ITEM_MERGED_IN") return "Inactive duplicate merged in";
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
  if (event.action === "ITEM_LINKED") return `Linked: ${String(event.details.words ?? "")} ${String(event.details.otherName ?? "another item")}`;
  if (event.action === "ITEM_UNLINKED") return `Link removed: ${String(event.details.words ?? "")} ${String(event.details.otherName ?? "another item")}`;
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
          <div class="review-meter" id="review-meter"><span class="skeleton skeleton--text" aria-hidden="true"></span></div>
        </div>
        <div class="page-header__actions">
          <p class="live-status" id="live-status">Connecting…</p>
          <button type="button" class="button button--primary" id="add-items">${icon("plus")}Add items</button>
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
      <dialog class="sheet" id="bulk-sheet" aria-labelledby="sheet-title"></dialog>
      <dialog class="sheet sheet--picture" id="picture-sheet" aria-labelledby="picture-sheet-title"></dialog>`);

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
  /** Whether the open item's Stock settings differ from what is saved (bindSettings). */
  let settingsChanged: () => boolean = () => false;
  /** Older pages of the open item's history, shown below its first page, and where the next one starts. */
  let extraMovements: Movement[] = [];
  let extraEvents: CatalogEvent[] = [];
  let historyNext: HistoryCursor | null = null;
  let pendingItem = params.get("add") === "1" ? null : params.get("item");
  const pendingTab = (["overview", "loan", "details", "history"] as const).find((value) => value === params.get("tab")) ?? "overview";
  let shownIds: string[] = [];
  /** How many rows are drawn: the table grows by a page on request, so the page's size does not follow the catalog's (docs/PERFORMANCE_RELIABILITY_DOCTRINE.md). */
  let rowLimit = ROW_PAGE;
  let question = "";
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
    <td class="col-qty"><span class="qty" data-qty="${item.id}" data-quantity="${item.onHand}">${formatQuantity(item.onHand)}</span> <span class="qty-unit">${units(item.onHand, item.unit)}</span>${item.openUnits ? html`<span class="cell-sub">${sealedLine(item.onHand, item.openUnits, item.openCondition)}</span>` : ""}</td>
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
    const asked = JSON.stringify([view, query, filters, sortKey, sortDir]);
    if (asked !== question) { question = asked; rowLimit = ROW_PAGE; }
    // The open item stays drawn, wherever it falls.
    if (openId) rowLimit = Math.max(rowLimit, shownIds.indexOf(openId) + 1);
    const drawn = shown.slice(0, rowLimit);
    document.querySelector("#inventory-count")!.textContent = shown.length === items.length ? plural(items.length, "item") : `${shown.length.toLocaleString()} of ${plural(items.length, "item")}`;
    const hint = view === "gradual" ? html`<p class="hint-line">${icon("info")}<span>Consumables counted in reams, rolls, packs, bottles and similar units are often opened and used a little at a time. Nothing changes here: to track open units for one, choose “Open and use gradually” in its Edit details.</span></p>` : "";
    preservingFocus(results, () => mount(results, shown.length
      ? html`${hint}<div class="data-table-wrap data-table-wrap--responsive"><table class="data-table data-table--items">
          <caption class="visually-hidden">Items. Select an item to see, review or edit it.</caption>
          <thead><tr>${selecting ? html`<th scope="col" class="col-select"><input type="checkbox" class="select-box" id="select-all" aria-label="Select all ${shown.length.toLocaleString()} shown items" ${shown.every((item) => selected.has(item.id)) ? html`checked` : ""} /></th>` : ""}${sortHeader("id", "ID", "col-id")}${sortHeader("name", "Item", "col-item")}${sortHeader("category", "Category", "col-category")}${sortHeader("location", "Place", "col-location")}${sortHeader("onHand", "On hand", "col-qty")}<th scope="col" class="col-status">Status</th></tr></thead>
          <tbody>${drawn.map(row)}</tbody></table></div>${shown.length > drawn.length ? html`<p class="table-more"><button type="button" class="button button--secondary" data-more>Show ${Math.min(ROW_PAGE, shown.length - drawn.length).toLocaleString()} more <span class="muted">(${drawn.length.toLocaleString()} of ${shown.length.toLocaleString()} shown)</span></button></p>` : ""}`
      : view === "gradual" && !query && !Object.values(filters).some(Boolean) ? emptyState("No likely items left", "No active Consumable counted in reams, rolls, packs, bottles or similar units is still used as a whole unit.")
      : emptyState(view === "review" && !query ? "Every record is reviewed" : "No items match", view === "review" && !query ? "Nothing is waiting for review with these filters." : "Try another search, filter, or view.", html`<button class="button button--secondary" type="button" id="clear-filters">Clear filters</button>`)));
    for (const [id, was] of changed) {
      const cell = results.querySelector(`[data-qty="${CSS.escape(id)}"]`);
      animateNumber(cell, Number(cell?.getAttribute("data-quantity")), was);
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
  // The three filters fold behind one button (LH-IP02-S04), open on arrival when the address already narrows the list.
  const filtersToggle = document.querySelector<HTMLButtonElement>("#filters-toggle")!;
  const showFilters = (open: boolean) => {
    filtersToggle.setAttribute("aria-expanded", String(open));
    document.querySelector("#table-filters")!.classList.toggle("is-open", open);
  };
  if (Object.values(filters).some(Boolean)) showFilters(true);
  filtersToggle.addEventListener("click", () => {
    const open = filtersToggle.getAttribute("aria-expanded") !== "true";
    showFilters(open);
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
    if (target.closest("[data-more]")) {
      const first = rowLimit;
      rowLimit += ROW_PAGE;
      render();
      results.querySelectorAll<HTMLElement>("tbody .row-link")[first]?.focus({ preventScroll: true });
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

  /* ---------- Item sheet ---------- */

  let addGeneration = 0;
  const addCleanups: Array<() => void> = [];
  const stopAdding = () => {
    addGeneration += 1;
    addCleanups.splice(0).forEach((cleanup) => cleanup());
    sheet.classList.remove("sheet--add");
  };
  const panel = createSheet(sheet, {
    dirty: () => dirty || settingsChanged(),
    onClose: () => {
      stopAdding();
      document.querySelector(`tr[data-key="${CSS.escape(openId ?? "")}"]`)?.classList.remove("is-open");
      openId = null;
      detail = null;
      dirty = false;
      settingsChanged = () => false;
      writeParams({ item: null, add: null });
    }
  });
  const closeSheet = () => panel.close(true);
  onLeave(() => { stopAdding(); dirty = false; settingsChanged = () => false; });

  function sheetShell(kicker: Html | string, title: string, body: Html): void {
    // Replacing the sheet's content (the loaded record after its placeholder) would drop keyboard focus onto the page behind.
    const holding = sheet.open && sheet.contains(document.activeElement);
    mount(sheet, sheetContent(kicker, title, body));
    if (holding && !sheet.contains(document.activeElement)) sheet.querySelector<HTMLElement>("[data-close]")?.focus({ preventScroll: true });
  }

  function openItem(id: string, tab: Tab = "overview"): void {
    if (openId !== id && panel.unsaved()) { void panel.discardOk().then((discard) => { if (discard) openItem(id, tab); }); return; }
    stopAdding();
    dirty = false;
    document.querySelectorAll("tr.is-open").forEach((element) => element.classList.remove("is-open"));
    const origin = document.querySelector(`tr[data-key="${CSS.escape(id)}"]`);
    origin?.classList.add("is-open");
    openId = id;
    detail = null;
    // A link or the search can open an item the table has not drawn yet; render() draws it.
    if (shownIds.indexOf(id) >= rowLimit) render();
    writeParams({ item: id, add: null });
    const item = inventory?.items.find((entry) => entry.id === id);
    sheetShell(html`<span class="mono">${id}</span>`, item?.name ?? "Loading…", html`<div class="skeleton skeleton--block"></div>`);
    panel.open(origin);
    void loadDetail(id, tab);
  }

  function openAdd(): void {
    if (!session) return;
    if (panel.unsaved()) { void panel.discardOk().then((discard) => { if (discard) openAdd(); }); return; }
    stopAdding();
    const generation = addGeneration;
    dirty = false;
    openId = null;
    detail = null;
    pendingItem = null;
    document.querySelectorAll("tr.is-open").forEach((element) => element.classList.remove("is-open"));
    writeParams({ item: null, add: "1", tab: null });
    sheet.classList.add("sheet--add");
    sheetShell("", "Add items", html`<div id="direct-add"><div class="skeleton skeleton--block"></div></div>`);
    panel.open();
    const host = sheet.querySelector<HTMLElement>("#direct-add")!;
    const current = () => generation === addGeneration && host.isConnected && sheet.open;
    void (async () => {
      try {
        const { captureScreen } = await import("./catalogue-capture");
        if (!current()) return;
        const started = await api<{ id: string }>("/api/staff/catalogue/sessions", { method: "POST", body: JSON.stringify({ locationId: null, direct: true }) });
        if (!current()) return;
        const { startSending } = await import("./catalogue-sync");
        if (!current()) return;
        startSending({ owner: session.id, legacy: true });
        await captureScreen({ mode: "signed-in", session, access: null }, started.id, {
          host,
          onCleanup: (cleanup) => { if (current()) addCleanups.push(cleanup); else cleanup(); },
          onDirty: (next) => { if (current()) dirty = next; }
        });
      } catch (error) {
        if (!current()) return;
        if (error instanceof ApiError && error.status === 401) return expired();
        mount(host, emptyState("Add items could not be opened", failure(error), html`<button type="button" class="button button--secondary" id="add-retry">Try again</button>`, "error", 2));
        host.querySelector("#add-retry")!.addEventListener("click", openAdd);
      }
    })();
  }
  document.querySelector("#add-items")!.addEventListener("click", openAdd);
  if (params.get("add") === "1") openAdd();

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
      // Older pages already shown stay shown: what the new first page no longer holds joins them (V1.16.4 §4.3).
      if (extraMovements.length || extraEvents.length) {
        extraMovements = [...detail.movements, ...extraMovements].filter((entry) => !loaded.movements.some((fresh) => fresh.id === entry.id));
        extraEvents = [...detail.events, ...extraEvents].filter((entry) => !loaded.events.some((fresh) => sameEvent(fresh, entry)));
      } else historyNext = loaded.historyNext ?? null;
      detail = { ...detail, item: { ...detail.item, onHand, photo: loadedPhoto, openReports, location, legacyLocation, iconKey, visualType, updatedAt }, movements: loaded.movements, loans: loaded.loans, events: loaded.events,
        openUnits: loaded.openUnits, reports: loaded.reports, usesRecorded: loaded.usesRecorded, unitsEmptied: loaded.unitsEmptied, freshness: loaded.freshness, kits: loaded.kits, links: loaded.links, reorder: loaded.reorder ?? null };
      photo?.render(loaded.item.photo);
      linksPanel?.render();
      visualControl?.render();
      mount(sheet.querySelector("#reports-card")!, reportsCard(detail));
      mount(sheet.querySelector("#profile-info")!, profileInfo(detail));
      mount(sheet.querySelector("#quantity-context")!, quantityContext(detail));
      mount(sheet.querySelector("#history")!, historyMarkup(detail));
      const more = sheet.querySelector("#history-more");
      if (more) mount(more, historyMore());
      const restock = sheet.querySelector("#restock-state");
      if (restock) mount(restock, restockState(detail));
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

  /**
   * Who and what the item is at a glance, beside its photo: the ledger's count (and what is out on loan, kept apart from it), status,
   * type, category, the recorded place, and how fresh that is. The place is what the record says, never a live position: the line
   * under it says when the item was last seen there.
   */
  function profileInfo(loaded: Detail): Html {
    const { item, loans, freshness, kits } = loaded;
    const out = onLoanOf(loans);
    const next = nextAction(loaded);
    return html`<div class="profile__stock"><p class="readout"><strong>${item.onHand}</strong> <span>${units(item.onHand, item.unit)} on hand</span></p>${out ? html`<p class="readout readout--loan"><strong>${out}</strong> <span>on loan</span></p>` : ""}</div>
      ${next ? html`<p class="profile__next"><button type="button" class="button button--primary button--sm" data-next="${next.key}">${next.label}</button></p>` : ""}
      ${tags(profileFacts(loaded))}
      <p class="profile__meta">${label(item.itemType)} · ${categoryName(item.category)}</p>
      ${item.model || item.serialNumber ? html`<p class="profile__meta">${[item.model && `Model ${item.model}`, item.serialNumber && `Serial ${item.serialNumber}`].filter(Boolean).join(" · ")}</p>` : ""}
      <p class="profile__meta profile__meta--place"><span class="profile__label">Recorded place</span>${icon("pin")}<span>${item.location ?? html`<span class="muted">No place set</span>`}${!item.location && item.legacyLocation ? html`<span class="muted"> · typed earlier: ${item.legacyLocation}</span>` : ""}</span></p>
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
      ${open ? html`<p class="profile__meta profile__meta--finding">${icon("alert")}<span>A check found: ${FINDING_WORDS[open.outcome] ?? "something to look at"} (${ageOf(open.at)}). <a class="text-link" href="/staff/catalogue?audit=${open.auditId}" data-route>Settle it</a></span></p>` : ""}`;
  }

  function quantityContext({ item, loans, openUnits }: Detail): Html {
    const out = onLoanOf(loans);
    const state = stockState({ ...item, onLoan: out });
    return html`${tracksOpenUnits(item) || openUnits.length ? html`<span class="quantity__sealed">${sealedLine(item.onHand, openUnits.length, worstCondition(openUnits))}</span>` : ""}${state === "OUT" ? html`<span class="tag tag--bad">Out of stock</span>` : state === "ON_LOAN" ? html`<span class="tag tag--pending">All on loan</span>` : state === "LOW" ? html`<span class="tag tag--warn">Low stock</span>` : item.reorderThreshold > 0 ? html`<span class="tag tag--ok">Above reorder level</span>` : ""}
      ${item.reorderThreshold > 0 ? html`<span>Reorder level ${item.reorderThreshold}</span>` : ""}
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
      ${settingsMarkup(detail)}
      ${delta !== 0 ? html`<div class="callout">${icon("info")}<p><strong>Migration evidence.</strong> At migration the legacy snapshot reported ${item.legacyReportedAvailable} ${units(item.legacyReportedAvailable ?? 0, item.unit)}, but the migrated movement ledger derives ${item.migratedOnHand}. The difference is preserved as recorded, not guessed. Once a physical count confirms the real figure, record it with a Count.</p></div>` : ""}
      ${item.verificationNote ? html`<div class="callout">${icon("alert")}<p><strong>Verify:</strong> ${item.verificationNote}</p></div>` : ""}
      ${item.needsReview ? html`<section class="card card--review" aria-labelledby="review-title">
          <div class="card__head"><h3 id="review-title">Needs details check</h3><button type="button" class="button button--secondary button--sm" data-goto="details">Review details</button></div>
          <p class="card__text">This record came from the legacy system. Confirm its details, then mark it reviewed.</p>
          ${checklist(reviewChecklist(item))}
        </section>` : ""}
      <dl class="facts">
        <div><dt>Unit</dt><dd>${item.unit}</dd></div>
        <div><dt>Status</dt><dd>${item.status === "INACTIVE" ? "Inactive" : "Active"}${item.itemType === "NEEDS_REVIEW" ? " · unclassified" : ""} · ${item.needsReview ? "needs a details check" : "details checked"}</dd></div>
        ${item.aliases ? html`<div><dt>Other names</dt><dd>${item.aliases}</dd></div>` : ""}
      </dl>
      <div id="reports-card">${reportsCard(detail)}</div>
      <details class="advanced-details"><summary>Availability &amp; record</summary><div class="advanced-details__body">
      <section class="card ${gaps.length ? "" : "card--ok"}" aria-labelledby="lending-title">
        <div class="card__head"><h3 id="lending-title">${gaps.length ? "Not on the Lending Hub" : "Listed on the Lending Hub"}</h3>${gaps.length ? "" : html`<a class="text-link" href="/lending?q=${encodeURIComponent(item.name)}" target="_blank" rel="noopener">View ${icon("external")}<span class="visually-hidden">(opens in a new tab)</span></a>`}</div>
        ${gaps.length
          ? html`<p class="card__text">Still needed before it can be listed:</p>${checklist(gaps.map((gap) => [gap, false]))}`
          : html`<p class="card__text">${label(item.lendingAudience)}</p>`}
      </section>
      <p class="provenance">${origin}</p></div></details>`;
  }

  /**
   * Stock settings in the item's sheet (V1.16.4 §4.3): reorder level, stock area, expiry and status, saved on their own, with Add to
   * restock and Add to kit beside them, so nobody leaves Items for these.
   */
  function settingsMarkup(loaded: Detail): Html {
    const { item } = loaded;
    const options = (values: readonly string[], current: string, names: Record<string, string> = {}) => values.map((value) => html`<option value="${value}" ${value === current ? html`selected` : ""}>${names[value] ?? label(value)}</option>`);
    return html`<section class="stock-settings" aria-labelledby="settings-title">
      <h3 class="section-label" id="settings-title">Stock settings</h3>
      <form id="settings-form" class="form stock-settings__form" novalidate>
        <div class="field"><label for="s-reorderThreshold">Reorder level</label><input id="s-reorderThreshold" name="reorderThreshold" type="number" inputmode="numeric" min="0" max="100000" step="1" value="${item.reorderThreshold}" aria-describedby="s-reorder-hint" /><p class="field__hint" id="s-reorder-hint">Low at or below this. 0 turns it off.</p></div>
        <div class="field"><label for="s-stockArea">Stock area</label><select id="s-stockArea" name="stockArea">${options(STOCK_AREAS, item.stockArea ?? "Inventory")}</select></div>
        <div class="field" data-settings-expiry ${(item.stockArea ?? "Inventory") === "Pantry" ? "" : html`hidden`}><label for="s-expiresOn">Earliest expiry <span class="field__optional">optional</span></label><input id="s-expiresOn" name="expiresOn" type="date" value="${item.expiresOn ?? ""}" /></div>
        <div class="field"><label for="s-status">Status</label><select id="s-status" name="status">${options(ITEM_STATUSES, item.status ?? "ACTIVE", STATUS_CHOICES)}</select></div>
        <div class="form-alert stock-settings__alert" role="alert" hidden data-settings-alert></div>
        <div class="stock-settings__save"><button type="submit" class="button button--primary button--sm" data-settings-save hidden>Save settings</button><button type="button" class="button button--ghost button--sm" data-settings-reset hidden>Cancel</button></div>
      </form>
      <div class="stock-settings__links"><span class="stock-settings__restock" id="restock-state">${restockState(loaded)}</span>
        <button type="button" class="button button--secondary button--sm" data-add-kit aria-expanded="false" aria-controls="kit-adder">${icon("stack")}Add to kit</button></div>
      <div class="kit-adder" id="kit-adder" hidden></div>
    </section>`;
  }

  /** The item's place on the restock list: its entry's state and a link to the list, or the button that adds it. */
  function restockState({ item, reorder }: Detail): Html {
    if (reorder) return html`<span class="tag tag--gold">${RESTOCK_LABELS[reorder.status] ?? label(reorder.status)}</span> <a class="text-link" href="/staff/stock?view=restock" data-route>Restock list</a>`;
    return item.status === "INACTIVE" ? html`` : html`<button type="button" class="button button--secondary button--sm" data-add-restock>${icon("plus")}Add to restock</button>`;
  }

  /** Wires the Stock settings form to the item. `item` is the object the edit form holds too, so both send the latest version. */
  function bindSettings(item: DetailItem): void {
    const form = sheet.querySelector<HTMLFormElement>("#settings-form");
    if (!form) return;
    const alert = form.querySelector<HTMLElement>("[data-settings-alert]")!;
    const read = () => {
      const values = new FormData(form);
      const level = String(values.get("reorderThreshold") ?? "").trim();
      return { status: String(values.get("status")), reorderThreshold: level === "" ? 0 : Number(level), stockArea: String(values.get("stockArea")), expiresOn: String(values.get("expiresOn") ?? "") };
    };
    const saved = () => ({ status: item.status, reorderThreshold: item.reorderThreshold, stockArea: item.stockArea ?? "Inventory", expiresOn: item.expiresOn ?? "" });
    const changed = () => JSON.stringify(read()) !== JSON.stringify(saved());
    settingsChanged = () => form.isConnected && changed();
    const sync = () => {
      form.querySelector<HTMLElement>("[data-settings-expiry]")!.hidden = read().stockArea !== "Pantry";
      const edited = changed();
      form.querySelectorAll<HTMLElement>("[data-settings-save], [data-settings-reset]").forEach((button) => { button.hidden = !edited; });
    };
    form.addEventListener("input", () => {
      form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid"));
      setMessage(alert, "");
      sync();
    });
    form.addEventListener("change", sync);
    form.querySelector("[data-settings-reset]")!.addEventListener("click", () => {
      const was = saved();
      form.querySelector<HTMLInputElement>("#s-reorderThreshold")!.value = String(was.reorderThreshold);
      form.querySelector<HTMLSelectElement>("#s-stockArea")!.value = was.stockArea;
      form.querySelector<HTMLInputElement>("#s-expiresOn")!.value = was.expiresOn;
      form.querySelector<HTMLSelectElement>("#s-status")!.value = was.status;
      setMessage(alert, "");
      sync();
      form.querySelector<HTMLElement>("#s-reorderThreshold")!.focus();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = read();
      const level = form.querySelector<HTMLInputElement>("#s-reorderThreshold")!;
      if (!Number.isInteger(values.reorderThreshold) || values.reorderThreshold < 0 || values.reorderThreshold > 100_000) {
        level.setAttribute("aria-invalid", "true");
        setMessage(alert, "Reorder level must be a whole number from 0 to 100,000.");
        level.focus();
        return;
      }
      const submit = form.querySelector<HTMLButtonElement>("[data-settings-save]")!;
      submit.disabled = true;
      setMessage(alert, "");
      try {
        const result = await api<{ changed: number; updatedAt: string | null }>(`/api/staff/items/${encodeURIComponent(item.id)}/settings`, { method: "PATCH", body: JSON.stringify({ ...values, updatedAt: item.updatedAt ?? null }) });
        const stored = { ...values, expiresOn: values.expiresOn || null, updatedAt: result.updatedAt };
        Object.assign(item, stored);
        if (detail?.item.id === item.id) detail = { ...detail, item: { ...detail.item, ...stored } };
        sync();
        toast(result.changed ? "Stock settings saved." : "No changes to save.");
        await refreshStock(item.id);
        await poll.refresh();
      } catch (error) {
        const stale = error instanceof ApiError && error.status === 409;
        setMessage(alert, stale ? html`${failure(error)} <button type="button" class="text-link" data-reload>Load the latest details</button>` : failure(error));
        alert.querySelector("[data-reload]")?.addEventListener("click", () => { dirty = false; settingsChanged = () => false; void loadDetail(item.id, "overview"); });
      } finally {
        submit.disabled = false;
      }
    });
    sync();
  }

  async function addToRestock(button: HTMLButtonElement): Promise<void> {
    if (!detail) return;
    const { id, name } = detail.item;
    const done = working(button);
    try {
      await api("/api/staff/reorders", { method: "POST", body: JSON.stringify({ itemId: id }) });
      toast(`${name} added to the restock list.`);
      await refreshStock(id);
      sheet.querySelector<HTMLElement>("#restock-state a")?.focus();
      await poll.refresh();
    } catch (error) {
      toast(failure(error), "error");
      if (error instanceof ApiError && error.status === 409) await refreshStock(id);
    } finally { done(); }
  }

  /** Opens (or closes) the small form that puts the item into a kit in use, from the kits it is not in yet. */
  async function toggleKitAdder(button: HTMLButtonElement): Promise<void> {
    const host = sheet.querySelector<HTMLElement>("#kit-adder");
    if (!host || !detail) return;
    if (!host.hidden) { closeKitAdder(); return; }
    host.hidden = false;
    button.setAttribute("aria-expanded", "true");
    mount(host, html`<p class="muted" role="status">Loading kits…</p>`);
    const id = detail.item.id;
    try {
      const { kits } = await api<{ kits: KitChoice[] }>("/api/staff/kits");
      if (detail?.item.id !== id || host.hidden) return;
      const already = new Set((detail.kits ?? []).map((kit) => kit.id));
      const open = kits.filter((kit) => kit.active && !already.has(kit.id));
      mount(host, open.length ? html`<form class="kit-adder__form" data-kit-form novalidate>
          <div class="field"><label for="ka-kit">Kit</label><select id="ka-kit" name="kit">${open.map((kit) => html`<option value="${kit.id}">${kit.name}</option>`)}</select></div>
          <div class="field kit-adder__qty"><label for="ka-qty">Needed</label><input id="ka-qty" name="required" type="number" inputmode="numeric" min="1" max="1000" step="1" value="1" /></div>
          <div class="form-alert" role="alert" hidden data-kit-alert></div>
          <div class="kit-adder__actions"><button class="button button--primary button--sm" type="submit">Add to kit</button><button class="button button--ghost button--sm" type="button" data-kit-cancel>Cancel</button></div>
        </form>`
        : html`<p class="muted">${kits.some((kit) => kit.active) ? "It is already in every kit in use." : "There are no kits in use yet."} <a class="text-link" href="/staff/kits" data-route>Kits</a></p>`);
      host.querySelector<HTMLElement>("#ka-kit, a")?.focus();
    } catch (error) {
      mount(host, html`<p class="form-alert" role="alert">${failure(error)}</p>`);
    }
  }

  function closeKitAdder(): void {
    const host = sheet.querySelector<HTMLElement>("#kit-adder");
    if (!host) return;
    host.hidden = true;
    mount(host, html``);
    const button = sheet.querySelector<HTMLButtonElement>("[data-add-kit]");
    button?.setAttribute("aria-expanded", "false");
    button?.focus();
  }

  /** Adds the item to a kit by saving that kit's whole list with it at the end, under the kit's own version check. */
  async function addToKit(form: HTMLFormElement): Promise<void> {
    if (!detail) return;
    const item = detail.item;
    const alert = form.querySelector<HTMLElement>("[data-kit-alert]")!;
    const quantity = form.querySelector<HTMLInputElement>("#ka-qty")!;
    const required = Number(quantity.value.trim());
    if (!/^\d{1,4}$/.test(quantity.value.trim()) || required < 1 || required > 1000) {
      quantity.setAttribute("aria-invalid", "true");
      setMessage(alert, "Needed must be a whole number from 1 to 1,000.");
      quantity.focus();
      return;
    }
    quantity.removeAttribute("aria-invalid");
    const kitId = form.querySelector<HTMLSelectElement>("#ka-kit")!.value;
    const done = working(form);
    setMessage(alert, "");
    try {
      const { kit, components } = await api<KitDetail>(`/api/staff/kits/${encodeURIComponent(kitId)}`);
      await api(`/api/staff/kits/${encodeURIComponent(kitId)}`, { method: "PATCH", body: JSON.stringify({
        name: kit.name, description: kit.description, locationId: kit.locationId, active: kit.active, updatedAt: kit.updatedAt,
        components: [...components.map((part) => ({ itemId: part.itemId, required: part.required })), { itemId: item.id, required }] }) });
      toast(`${item.name} added to ${kit.name}.`);
      closeKitAdder();
      await refreshStock(item.id);
    } catch (error) {
      setMessage(alert, failure(error));
    } finally { done(); }
  }

  /** The button under the history that brings its next older page, while there is one. */
  const historyMore = (): Html => historyNext ? html`<button type="button" class="button button--secondary button--sm" data-history-more>Show older history</button>` : html``;

  async function loadOlderHistory(button: HTMLButtonElement): Promise<void> {
    if (!detail || !historyNext) return;
    const id = detail.item.id;
    const done = working(button);
    try {
      const page = await api<{ movements: Movement[]; events: CatalogEvent[]; next: HistoryCursor | null }>(`/api/staff/items/${encodeURIComponent(id)}/history?before=${encodeURIComponent(`${historyNext.at},${historyNext.id}`)}`);
      if (detail?.item.id !== id) return;
      extraMovements = [...extraMovements, ...page.movements];
      extraEvents = [...extraEvents, ...page.events];
      historyNext = page.next;
      mount(sheet.querySelector("#history")!, historyMarkup(detail));
      mount(sheet.querySelector("#history-more")!, historyMore());
      (sheet.querySelector<HTMLElement>("[data-history-more]") ?? sheet.querySelector<HTMLElement>("#panel-history"))?.focus({ preventScroll: true });
    } catch (error) {
      toast(failure(error), "error");
    } finally { done(); }
  }

  let stockForm: ReturnType<typeof bindQuantityEditor> | null = null;
  let openPanel: ReturnType<typeof bindOpenUnits> | null = null;
  let linksPanel: ReturnType<typeof bindItemLinks> | null = null;
  let photo: PhotoPanel | null = null;
  let visualControl: ReturnType<typeof itemVisualControl> | null = null;
  let openPicture: (() => void) | null = null;
  const pictureSheet = document.querySelector<HTMLDialogElement>("#picture-sheet")!;
  const picturePanel = createSheet(pictureSheet, { onClose: () => { visualControl = null; sheet.querySelector<HTMLElement>("#photo-panel [data-photo-menu]")?.focus({ preventScroll: true }); } });
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
    type Entry = { at: string; id: string; markup: Html };
    const entries: Entry[] = [
      ...[...movements, ...extraMovements].map((movement) => {
        const quantity = movement.signedQuantity;
        const tone = quantity > 0 ? "is-in" : quantity < 0 ? "is-out" : "";
        return { at: movement.sortAt ?? movement.createdAt, id: movement.id, markup: html`<li class="history__item ${tone}">
          <div><p class="history__title">${movementTitle(movement.related === "OPEN_UNIT" ? "UNIT_EMPTIED" : movement.movementType, quantity, movement.reason, movement.borrower)}${movement.purpose ? html` <span class="muted">(${movement.purpose === "USC" ? "USC use" : "individual use"})</span>` : ""}${movement.status === "SUPERSEDED" ? html` <span class="muted">(recorded offline before a later count, so not counted again)</span>` : movement.status !== "POSTED" ? ` (${movement.status.toLowerCase()})` : ""}</p>
            <p class="history__meta"><time datetime="${movement.createdAt}">${formatDateTime(movement.createdAt)}</time> · ${movement.actor ?? "Legacy system"}</p>
            ${movement.notes ? html`<p class="history__note">${movement.notes}</p>` : ""}</div>
          <p class="history__qty ${tone}">${signed(quantity)}<span class="history__after">${movement.afterQuantity - quantity} → ${movement.afterQuantity}</span></p></li>` };
      }),
      // A loan and a good return already appear as movements; only damaged or lost closings add a line.
      ...[...events, ...extraEvents].filter((event) => event.action !== "LOAN_CREATED" && !(event.action === "LOAN_CLOSED" && event.details.outcome === "RETURNED")).map((event) => {
        const changes = event.action === "ITEM_UPDATED"
          ? Object.entries(event.details).filter(([field]) => FIELD_LABELS[field]).map(([field, value]) => html`<li><span>${FIELD_LABELS[field]}</span> ${formatValue(field, (value as Change).from)} → <strong>${formatValue(field, (value as Change).to)}</strong></li>`)
          : [];
        const opening = Number(event.details.openingQuantity ?? 0);
        const mergeId = event.action === "ITEM_MERGED" ? event.details.targetId : event.action === "ITEM_MERGED_IN" ? event.details.sourceId : null;
        const mergeName = event.action === "ITEM_MERGED" ? event.details.targetName : event.details.sourceName;
        // What was typed with a report or its resolution lives on the report; the history shows it where it happened.
        const report = reports.find((entry) => entry.id === event.details.reportId);
        const typed = event.action === "LOCATION_REPORTED" ? report?.note : event.action === "LOCATION_REPORT_RESOLVED" ? report?.resolutionNote : null;
        return { at: event.sortAt ?? event.at, id: event.id ?? "", markup: html`<li class="history__item is-catalog">
          <div><p class="history__title">${eventTitle(event)}</p>
            <p class="history__meta"><time datetime="${event.at}">${formatDateTime(event.at)}</time> · ${event.actor ?? "System"}</p>
            ${typeof mergeId === "string" ? html`<p class="history__note"><a class="text-link" href="/staff/items?item=${encodeURIComponent(mergeId)}" data-route>${event.action === "ITEM_MERGED" ? "Retained item" : "Merged from"}: ${String(mergeName ?? mergeId)} (${mergeId})</a></p>` : ""}
            ${changes.length ? html`<ul class="history__changes">${changes}</ul>` : event.action === "ITEM_CREATED" && opening > 0 ? html`<p class="history__note">Opening quantity ${opening}</p>` : typed ? html`<p class="history__note">${typed}</p>` : ""}</div></li>` };
      })
    // Newest first by the one time, then id: the order the pages are cut in (inventory.ts historyPage).
    ].sort((a, b) => a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    return entries.length ? html`${entries.map((entry) => entry.markup)}` : html`<li class="history__empty">No history recorded yet.</li>`;
  }

  function renderDetail(loaded: Detail, tab: Tab): void {
    detail = loaded;
    dirty = false;
    settingsChanged = () => false;
    extraMovements = [];
    extraEvents = [];
    historyNext = loaded.historyNext ?? null;
    const { item } = loaded;
    if (loaded.mergedInto) {
      sheetShell(html`<span class="mono">${item.id}</span>`, item.name, html`
        <p class="callout">Merged into <a class="text-link" href="/staff/items?item=${encodeURIComponent(loaded.mergedInto.id)}" data-route>${loaded.mergedInto.name} (${loaded.mergedInto.id})</a></p>
        ${item.photo ? html`<button type="button" class="photo-tile" data-archived-photo aria-label="View retained photo"><img src="${photoUrl(item.photo.id, "thumb")}" alt="${item.name}" width="180" height="180"></button>` : ""}
        <dl class="facts"><div><dt>Unit</dt><dd>${item.unit}</dd></div><div><dt>Where found</dt><dd>${item.location ?? "No place set"}</dd></div>
          ${item.model ? html`<div><dt>Model</dt><dd>${item.model}</dd></div>` : ""}${item.serialNumber ? html`<div><dt>Serial number</dt><dd>${item.serialNumber}</dd></div>` : ""}</dl>
        <h3 class="section-label">History</h3><ol class="history">${historyMarkup(loaded)}</ol>
        <p><a class="text-link" href="/staff/activity?item=${item.id}" data-route>All activity for this item ${icon("arrow")}</a></p>`);
      sheet.querySelector<HTMLButtonElement>("[data-archived-photo]")?.addEventListener("click", () => {
        if (item.photo) void openViewer(shownUrl(item.photo, "display"), `Photo of ${item.name}`, () => sheet.querySelector<HTMLImageElement>("[data-archived-photo] img"), item.name, resolveItemIcon(item).key);
      });
      return;
    }
    const lendable = item.itemType === PUBLIC_LENDING_ITEM_TYPE;
    const out = loaded.loans.filter((loan) => loan.status === "OUT").length;
    const tabs: Array<[Tab, string]> = [["overview", "Overview"], ...(lendable ? [["loan", out ? `Loan · ${out} out` : "Loan"] as [Tab, string]] : []), ["details", item.needsReview ? "Review & edit" : "Edit details"], ["history", "History"]];
    if (tab === "loan" && !lendable) tab = "overview";
    sheetShell(html`<span class="mono">${item.id}</span>`, item.name, html`
      <section class="profile theater drafting" id="photo-panel" aria-label="Item profile"><div class="profile__photo" data-tile></div><div class="profile__info"><div id="profile-info">${profileInfo(loaded)}</div></div><div class="profile__actions" data-actions></div></section>
      <div class="tabs" role="tablist" aria-label="Item sections">
        ${tabs.map(([key, text]) => html`<button type="button" role="tab" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${key === tab}" tabindex="${key === tab ? 0 : -1}">${text}</button>`)}
      </div>
      <section id="panel-overview" class="panel-stack" role="tabpanel" aria-labelledby="tab-overview" tabindex="0" ${tab === "overview" ? "" : html`hidden`}>${overviewMarkup(loaded)}</section>
      ${lendable ? html`<section id="panel-loan" class="panel-stack" role="tabpanel" aria-labelledby="tab-loan" ${tab === "loan" ? "" : html`hidden`}>
        ${item.status === "INACTIVE" ? html`<div class="callout">${icon("info")}<p>Inactive items cannot be lent. Reactivate it in Stock settings on the Overview first.</p></div>` : html`<form id="loan-form" class="form" novalidate aria-labelledby="lend-title"><h3 class="section-label" id="lend-title">Lend this item</h3>${loanFields("loan")}</form>`}
        <div id="item-loans" class="panel-stack">${itemLoansMarkup(loaded)}</div>
      </section>` : ""}
      <section id="panel-details" role="tabpanel" aria-labelledby="tab-details" ${tab === "details" ? "" : html`hidden`}>${detailsFormMarkup(item)}</section>
      <section id="panel-history" class="panel-stack" role="tabpanel" aria-labelledby="tab-history" tabindex="0" ${tab === "history" ? "" : html`hidden`}><ol class="history" id="history">${historyMarkup(loaded)}</ol>
        <div class="history__more" id="history-more">${historyMore()}</div>
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
    /** Carries out the profile's next action where it is done: the stock editor, the loan tab or Edit details. */
    const runNext = (key: string) => {
      if (key === "count" || key === "stock-in") {
        select(sheet.querySelector<HTMLButtonElement>("#tab-overview")!);
        const reorder = detail?.reorder;
        stockForm?.preset(key === "count" ? { reason: "COUNT" } : { reason: "DELIVERY", ...(reorder?.desiredQuantity ? { delta: reorder.desiredQuantity } : {}) });
        return;
      }
      const lending = key === "lend" || key === "return";
      const panelTab = sheet.querySelector<HTMLButtonElement>(`#tab-${lending ? "loan" : "details"}`);
      if (!panelTab) return;
      select(panelTab);
      const field = { lend: "#loan-studentId", return: "#item-loans [data-return]", classify: "#f-itemType", place: "#f-locationId" }[key];
      (sheet.querySelector<HTMLElement>(field ?? "") ?? panelTab).focus();
    };
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
      const next = element.closest<HTMLElement>("[data-next]");
      if (next) runNext(next.dataset.next!);
      const restock = element.closest<HTMLButtonElement>("[data-add-restock]");
      if (restock) void addToRestock(restock);
      const kit = element.closest<HTMLButtonElement>("[data-add-kit]");
      if (kit) void toggleKitAdder(kit);
      if (element.closest("[data-kit-cancel]")) closeKitAdder();
      const older = element.closest<HTMLButtonElement>("[data-history-more]");
      if (older) void loadOlderHistory(older);
      const resolve = element.closest<HTMLButtonElement>("[data-resolve]");
      if (resolve) openResolve(resolve);
      if (element.closest("[data-resolve-cancel]")) { const row = element.closest<HTMLElement>("[data-report-id]")!; row.querySelector(".report__form")?.remove(); row.querySelector<HTMLButtonElement>("[data-resolve]")!.hidden = false; row.querySelector<HTMLButtonElement>("[data-resolve]")!.focus(); }
    });
    sheet.querySelector(".sheet__body")!.addEventListener("submit", (event) => {
      const kitForm = (event.target as HTMLElement).closest<HTMLFormElement>("[data-kit-form]");
      if (kitForm) { event.preventDefault(); void addToKit(kitForm); return; }
      const form = (event.target as HTMLElement).closest<HTMLFormElement>(".report__form");
      if (!form) return;
      event.preventDefault();
      void sendResolve(form);
    });
    const target = () => detail ? { id: detail.item.id, name: detail.item.name, unit: detail.item.unit, onHand: detail.item.onHand, openUnits: detail.openUnits.length, reorder: detail.reorder ?? null } : null;
    const openHost = sheet.querySelector<HTMLElement>("#open-units");
    openPanel = openHost ? bindOpenUnits(openHost, () => detail && { ...detail.item, openUnits: detail.openUnits, usesRecorded: detail.usesRecorded, unitsEmptied: detail.unitsEmptied },
      async () => { await refreshStock(item.id); await poll.refresh(); }) : null;
    openPanel?.render();
    linksPanel = bindItemLinks(sheet.querySelector<HTMLElement>("#item-links")!, {
      itemId: () => item.id, links: () => detail?.links ?? [],
      candidates: () => (inventory?.items ?? []).map((entry) => ({ id: entry.id, name: entry.name, status: entry.status, place: placeText(entry) })),
      changed: (links) => { if (detail?.item.id === item.id) { detail = { ...detail, links }; linksPanel?.render(); } }
    });
    linksPanel.render();
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
    bindSettings(item);
    photo = photoPanel(sheet.querySelector<HTMLElement>("#photo-panel")!, {
      visual: () => ({ ...detail!.item, photoId: detail!.item.photo?.id }), updatedAt: () => detail!.item.updatedAt,
      // Rebase only our successful photo repair; another writer's detail changes still conflict.
      repairVersion: (from, to) => { if (item.updatedAt === from) item.updatedAt = to; },
      id: item.id, name: item.name, photo: item.photo, noun: "photo", endpoint: `/api/staff/items/${encodeURIComponent(item.id)}/photo`, cleanup: `/api/staff/items/${encodeURIComponent(item.id)}/cutout`,
      cleanupState: () => detail?.item.photoCleanup,
      enableCleanup: async () => { await api("/api/staff/admin/cleanup", { method: "PATCH", body: JSON.stringify({ on: true }) }); await poll.refresh(); },
      // The sheet's tile is the detail size, named by the item's last change so it can be kept (V1.16.4 §4.4).
      thumbUrl: (id) => photoUrl(id, "detail", detail?.item.updatedAt ?? null),
      hintAdd: "Everyone sees this photo on the Lending Hub and Self-Service. Show the item itself, not people or documents.",
      hintHas: "Everyone sees this photo on the Lending Hub and Self-Service. The large version stays staff-only.", removeNote: "The item keeps its stock and history.",
      chooseIcon: () => openPicture?.(),
      view: (shown, edit) => void openViewer(shownUrl(shown, "display"), `Photo of ${item.name}`, () => sheet.querySelector<HTMLElement>("#photo-panel .photo-tile img"), item.name, resolveItemIcon(detail!.item).key, edit),
      changed: async (next) => { if (detail?.item.id === item.id) detail = { ...detail, item: { ...detail.item, photo: next } }; await refreshStock(item.id); await poll.refresh(); },
      // Someone else changed the photo first: show theirs, and the list with it.
      refresh: async () => { await refreshStock(item.id); await poll.refresh(); }
    });
    // The item's picture (LH-IP02-S04): its icon and whether the photo or the icon shows, in a sheet opened from the picture's own menu.
    openPicture = () => {
      mount(pictureSheet, sheetContent(item.name, "Item picture", html`<div class="item-visual-control" id="item-visual-control"></div>`, "picture-sheet-title"));
      visualControl = itemVisualControl(pictureSheet.querySelector<HTMLElement>("#item-visual-control")!, () => ({ ...detail!.item, photoId: detail!.item.photo?.id, updatedAt: detail!.item.updatedAt }), async () => {
        const loaded = await fetchDetail(item.id);
        if (loaded) { detail = loaded; photo?.render(loaded.item.photo); }
        await poll.refresh();
      }, () => { picturePanel.close(true); sheet.querySelector<HTMLButtonElement>("#photo-panel [data-pick]")?.click(); });
      picturePanel.open();
    };
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

  function detailsFormMarkup(item: DetailItem): Html {
    const options = (values: readonly string[], current: string | undefined) => values.map((value) => html`<option value="${value}" ${value === current ? html`selected` : ""}>${label(value)}</option>`);
    // Unclassified is offered only while a migrated record still is; staff choose Loanable or Consumable.
    const types = ITEM_TYPES.filter((type) => type !== "NEEDS_REVIEW" || item.itemType === "NEEDS_REVIEW");
    const hinted = (id: string, hint: string) => hint ? html`aria-describedby="f-${id}-hint"` : "";
    const hintMarkup = (id: string, hint: string) => hint ? html`<p class="visually-hidden" id="f-${id}-hint">${hint}</p>` : "";
    const text = (id: string, title: string, value: unknown, attributes: Html | string = "", hint = "", optional = false) => html`<div class="field"><label for="f-${id}">${title}${optional ? html` <span class="field__optional">optional</span>` : ""}</label><input id="f-${id}" name="${id}" value="${value ?? ""}" ${attributes} ${hinted(id, hint)} />${hintMarkup(id, hint)}</div>`;
    const reviewing = item.needsReview === true;
    return html`<form id="details-form" class="form" novalidate>
      ${reviewing ? html`<div class="callout callout--review">${icon("info")}<div><p><strong>Reviewing a migrated record.</strong> Check each detail against the physical item, fill in what is missing, then mark it reviewed.</p><div id="review-checklist">${checklist(reviewChecklist(item as Item))}</div></div></div>` : ""}
      <div class="form-section">
        <h3 class="form-section__title">Catalog</h3>
        ${text("name", "Name", item.name, html`required maxlength="120" autocomplete="off" autocapitalize="words" autocorrect="on" spellcheck="true"`)}
        <div class="field__hint field__hint--warn" id="duplicate-hint" hidden></div>
        ${item.itemType === "NEEDS_REVIEW" ? html`<div class="classify-hint" id="classify-hint" aria-live="polite"></div>` : ""}
        <div class="field-grid">
          ${text("category", "Category", item.category?.toUpperCase() === "UNSORTED" ? "" : item.category, html`required maxlength="100" autocomplete="off" autocorrect="on" spellcheck="true"`, "Letter case does not matter; an existing category is reused.")}
          <div class="field"><label for="f-itemType">Borrow or take</label><select id="f-itemType" name="itemType">${types.map((type) => html`<option value="${type}" ${type === (item.itemType ?? "Loanable") ? html`selected` : ""}>${TYPE_CHOICES[type] ?? label(type)}</option>`)}</select></div>
        </div>
        <div class="field" data-consumption ${(item.itemType ?? "Loanable") === "Consumable" ? "" : html`hidden`}><label for="f-consumptionMode">How is it used?</label><select id="f-consumptionMode" name="consumptionMode">${options(CONSUMPTION_MODES, item.consumptionMode ?? "WHOLE_UNIT")}</select></div>
        <div class="field-grid">
          ${text("unit", "Unit", item.unit, html`required maxlength="30" autocomplete="off" placeholder="piece, box, pack"`, "Singular, as counted.")}
          <div class="field"><label for="f-locationId">Place <span class="field__optional">optional</span></label>
            <select id="f-locationId" name="locationId"><option value="">No place set</option>${placeOptions(item.locationId ?? null)}</select></div>
        </div>
        ${!item.locationId && item.legacyLocation ? html`<div class="callout">${icon("info")}<p>This item’s location was typed earlier as <strong>${item.legacyLocation}</strong>. Choose the matching place, or add it below; the typed text is kept as it was.</p></div>` : ""}
        <div class="place-extra"><div class="place-preview" id="place-preview" aria-live="polite"></div>
          <p><button type="button" class="text-link" data-new-place aria-expanded="false" aria-controls="place-new">${icon("plus")} New place</button></p>
          <div class="place-new" id="place-new" hidden>
            <div class="field-grid"><div class="field"><label for="np-name">Name of the new place</label><input id="np-name" maxlength="120" autocomplete="off" placeholder="Shelf 3" /></div>
              <div class="field"><label for="np-parent">Inside</label><select id="np-parent"></select></div></div>
            <p class="form-alert" id="np-alert" role="alert" hidden></p>
            <div class="where__buttons"><button type="button" class="button button--secondary button--sm" data-np-add>Add place</button><button type="button" class="button button--ghost button--sm" data-np-cancel>Cancel</button></div></div></div>
      </div>
      <details class="advanced-details" id="item-advanced"><summary>Advanced details</summary><div class="advanced-details__body">
      <div class="form-section">
        ${text("aliases", "Other names", item.aliases, html`maxlength="300" autocomplete="off" autocapitalize="words" autocorrect="on" spellcheck="true" placeholder="Separate names with commas"`, "", true)}
        <div class="field-grid">
          ${text("model", "Model", item.model, html`maxlength="80" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"`, "", true)}
          ${text("serialNumber", "Serial number", item.serialNumber, html`maxlength="80" autocomplete="off" spellcheck="false"`, "", true)}
        </div>
        <div class="field"><label for="f-notes">Internal notes <span class="field__optional">optional</span></label><textarea id="f-notes" name="notes" maxlength="1000" rows="3" autocapitalize="sentences" autocorrect="on" spellcheck="true">${item.notes ?? ""}</textarea></div>
      </div>
      <div class="form-section">
        <h3 class="form-section__title">Availability</h3>
        <div class="field"><label for="f-lendingAudience">Shown to</label><select id="f-lendingAudience" name="lendingAudience">${options(LENDING_AUDIENCES, item.lendingAudience ?? "NOT_AVAILABLE_FOR_LENDING")}</select></div>
        <div class="listing-status" id="listing-preview" aria-live="polite"></div>
      </div>
      <div id="item-links"></div>
      </div></details>
      <div class="form-section form-section--last">
        <label class="checkbox"><input type="checkbox" name="reviewed" ${item.needsReview === false ? html`checked` : ""} /><span>Details reviewed and verified</span></label>
      </div>
      <div class="form-alert" id="details-alert" role="alert" hidden></div>
      <div class="form-actions form-actions--sticky">
        ${reviewing ? html`<button class="button button--secondary" type="submit" data-intent="save">Save</button><button class="button button--primary" type="submit" data-intent="review-next">Mark reviewed &amp; next ${icon("next")}</button>`
          : html`<button class="button button--primary" type="submit" data-intent="save">Save changes</button>`}
      </div>
    </form>`;
  }

  /**
   * The edit form's values. Status and reorder level are the sheet's Stock settings now (V1.16.4 §4.3): they are sent as saved, from
   * `item`, which a settings save keeps current; stock area and expiry are left out, so the Worker keeps what is stored.
   */
  function readDetails(form: HTMLFormElement, item: Pick<DetailItem, "status" | "reorderThreshold">) {
    const values = new FormData(form);
    return {
      name: String(values.get("name") ?? ""), aliases: String(values.get("aliases") ?? ""), category: String(values.get("category") ?? ""), unit: String(values.get("unit") ?? ""),
      itemType: String(values.get("itemType")), status: item.status, locationId: String(values.get("locationId") ?? ""),
      reorderThreshold: item.reorderThreshold, lendingAudience: String(values.get("lendingAudience")),
      needsReview: values.get("reviewed") !== "on", notes: String(values.get("notes") ?? ""), model: String(values.get("model") ?? ""), serialNumber: String(values.get("serialNumber") ?? ""),
      consumptionMode: String(values.get("consumptionMode") ?? "WHOLE_UNIT")
    };
  }

  /** Mirrors the Worker's validation so mistakes are caught before a round trip; the Worker still decides. */
  function invalidFields(form: HTMLFormElement, item: DetailItem): Array<[HTMLElement, string]> {
    const problems: Array<[HTMLElement, string]> = [];
    for (const input of form.querySelectorAll<HTMLInputElement>("input[required]")) {
      if (!input.value.trim()) problems.push([input, `${form.querySelector(`label[for="${input.id}"]`)?.firstChild?.textContent?.trim()} is required.`]);
    }
    for (const input of form.querySelectorAll<HTMLInputElement>("input[type=number]")) {
      const value = Number(input.value || 0);
      if (!Number.isInteger(value) || value < 0 || value > Number(input.max)) problems.push([input, `${form.querySelector(`label[for="${input.id}"]`)?.textContent?.trim()} must be a whole number from 0 to ${Number(input.max).toLocaleString()}.`]);
    }
    const values = readDetails(form, item);
    if (values.lendingAudience !== "NOT_AVAILABLE_FOR_LENDING" && !LISTABLE_ITEM_TYPES.has(values.itemType)) {
      problems.push([form.querySelector<HTMLElement>("#f-lendingAudience")!, "Only Loanable or Consumable items can be listed. Change the type, or choose Not lendable."]);
    }
    return problems;
  }

  function bindDetailsForm(item: DetailItem): void {
    const form = sheet.querySelector<HTMLFormElement>("#details-form")!;
    const alert = form.querySelector<HTMLDivElement>("#details-alert")!;
    form.querySelector<HTMLInputElement>("#f-name")!.addEventListener("blur", (event) => {
      const input = event.target as HTMLInputElement;
      const name = formatItemName(input.value);
      if (name !== input.value) { input.value = name; input.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    let mergeChoice: string | null = null;
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
      const values = readDetails(form, item);
      const gaps = listingGaps(values);
      const element = form.querySelector("#listing-preview")!;
      element.className = `listing-status ${gaps.length ? "" : "is-listed"}`;
      mount(element, gaps.length
        ? html`${icon("info")}<div><p>Not shown publicly. Still needed:</p>${checklist(gaps.map((gap) => [gap, false]))}</div>`
        : html`${icon("check")}<p>Will appear on the public Lending Hub, and phones can ${values.itemType === PUBLIC_LENDING_ITEM_TYPE ? "borrow" : values.consumptionMode === "OPEN_UNIT" ? "record using" : "take"} it.</p>`);
      const review = form.querySelector("#review-checklist");
      if (review) mount(review, checklist(reviewChecklist(values)));
      form.querySelector<HTMLElement>("[data-consumption]")!.hidden = values.itemType !== "Consumable";
      showClassification(values);
      const duplicate = form.querySelector<HTMLElement>("#duplicate-hint")!;
      const name = values.name.trim().toLowerCase();
      const twins = name ? inventory?.items.filter((entry) => entry.id !== item.id && entry.name.trim().toLowerCase() === name) ?? [] : [];
      duplicate.hidden = !twins.length;
      mount(duplicate, html`${twins.map((twin) => html`<p><a class="text-link" href="/staff/items?item=${encodeURIComponent(twin.id)}" data-route>${twin.id}</a> · ${label(twin.status)}${twin.status === "INACTIVE" && values.status === "ACTIVE" ? html` <button type="button" class="text-link" data-merge="${twin.id}">Merge & remove duplicate</button>` : ""}</p>`)}`);
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
      const choice = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-merge]");
      if (choice) {
        mergeChoice = choice.dataset.merge ?? null;
        form.requestSubmit();
        mergeChoice = null;
        return;
      }
    });
    preview();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      const intent = mergeChoice ? "merge" : submitter?.dataset.intent ?? "save";
      if (intent === "review-next") form.querySelector<HTMLInputElement>("input[name=reviewed]")!.checked = true;
      form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid"));
      const problems = invalidFields(form, item);
      if (problems.length) {
        problems.forEach(([element]) => element.setAttribute("aria-invalid", "true"));
        setMessage(alert, problems.map(([, message]) => message).join(" "));
        const hiddenDetails = problems[0]![0].closest<HTMLDetailsElement>("details");
        if (hiddenDetails) hiddenDetails.open = true;
        problems[0]![0].focus();
        return;
      }
      const sourceId = mergeChoice;
      const source = sourceId ? inventory?.items.find((entry) => entry.id === sourceId && entry.status === "INACTIVE") : undefined;
      const targetOnHand = detail?.item.id === item.id ? detail.item.onHand : item.onHand;
      if (intent === "merge") {
        if (!source || readDetails(form, item).status !== "ACTIVE") { setMessage(alert, "Reload and choose an inactive duplicate for this active item."); return; }
        if (!window.confirm(`Save changes and merge ${source.id} into ${item.id}?\n\nStock: ${source.onHand} + ${targetOnHand} = ${source.onHand + targetOnHand} ${units(source.onHand + targetOnHand, readDetails(form, item).unit)}. Combine only separate stock.\n\nRemove ${source.id} from the catalogue; keep its history.`)) return;
      }
      let savedBeforeMerge = false;
      const buttons = [...form.querySelectorAll<HTMLButtonElement>("button[type=submit], [data-merge]")];
      buttons.forEach((button) => { button.disabled = true; });
      setMessage(alert, "");
      try {
        const id = item.id!;
        // The queue is the list the reviewer was working through, captured before this save changes it.
        const queue = [...shownIds];
        const result = await api<{ changed: number; updatedAt: string | null }>(`/api/staff/items/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ ...readDetails(form, item), updatedAt: item.updatedAt ?? null }) });
        item.updatedAt = result.updatedAt;
        dirty = false;
        if (intent === "merge" && source) {
          savedBeforeMerge = true;
          await api(`/api/staff/items/${encodeURIComponent(id)}/merge`, { method: "POST", body: JSON.stringify({ sourceId: source.id, sourceUpdatedAt: source.updatedAt, updatedAt: item.updatedAt, sourceOnHand: source.onHand, targetOnHand, confirmed: true }) });
          await poll.refresh();
          toast(`${source.id} merged into ${id}.`);
          await loadDetail(id, "details");
          return;
        }
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
        setMessage(alert, stale ? html`${savedBeforeMerge ? "Details saved. " : ""}${failure(error)} <button type="button" class="text-link" data-reload>Load the latest details</button>` : `${savedBeforeMerge ? "Details saved. " : ""}${failure(error)}`);
        alert.querySelector("[data-reload]")?.addEventListener("click", () => { dirty = false; void loadDetail(item.id!, "details"); });
      } finally {
        buttons.forEach((button) => { button.disabled = false; });
      }
    });
  }

}
