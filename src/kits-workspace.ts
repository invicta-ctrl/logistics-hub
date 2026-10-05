import "./kits.css";
import { behaviourOf, BEHAVIOUR_LABELS, units } from "./catalog-policy";
import { CHECK_LABELS, CHECK_OUTCOMES, COMPONENT_STATE_LABELS, KIT_STATE_LABELS, type CheckOutcome, type ComponentState, type KitState } from "./kit-policy";
import { openViewer, photoPanel, rowThumb } from "./item-photo";
import { inOrder, pathOf, placesOf } from "./location-tree";
import { type PlaceRow, ageOf, loadSession, shell } from "./staff";
import { ApiError, type Html, api, emptyState, expired, failure, html, icon, live, mount, onLeave, plural, preservingFocus, setMessage, sheet as createSheet, sheetContent, toast, writeParams } from "./ui";

/*
 * Kits (/staff/kits): groupings such as a Sewing Kit, made of items that already exist. A kit holds no stock. Each component keeps its
 * own record (borrow & return, take or use gradually), and the kit's state is read from those records, so it can never disagree with
 * them. Checking a kit writes down what staff saw; to correct stock, staff use the component's own record.
 */

type Photo = { id: string; width: number; height: number };
type Summary = { id: string; name: string; description: string | null; locationId: string | null; place: string | null; templateId: string | null; templateName: string | null; active: boolean;
  updatedAt: string; photo: Photo | null; lastCheckedAt: string | null; lastCheckedBy: string | null; state: KitState; ready: number; total: number };
type Template = { id: string; name: string; description: string | null; active: boolean; updatedAt: string; components: number; kits: number };
type Answer = { revision: number; kits: Summary[]; templates: Template[] };
type Part = { itemId: string; name: string; unit: string; category: string; itemType: string; consumptionMode: string; iconKey: string | null; visualType: "SYSTEM_ICON" | "PHOTO" | null; photoId: string | null; required: number; demand: number;
  onHand: number; onLoan: number; expiresOn: string | null; state: ComponentState; reason: string | null; seen: { outcome: CheckOutcome; note: string | null; at: string } | null };
type Check = { id: string; checkedAt: string; checkedBy: string; note: string | null; okCount: number; flaggedCount: number; uncheckedCount: number };
type Detail = { kit: Summary; components: Part[]; checks: Check[]; lastCheck: (Check & { observations: Array<{ itemId: string; name: string; outcome: CheckOutcome; note: string | null }> }) | null };
type PickItem = { id: string; name: string; unit: string; category: string; itemType: string; consumptionMode: string; status: string; onHand: number; iconKey: string | null; visualType: "SYSTEM_ICON" | "PHOTO" | null; photoId: string | null };
type Draft = { itemId: string; name: string; unit: string; required: number };
type Mode = "view" | "edit" | "check" | "summary" | "template";

const STATE_TAG: Record<KitState, string> = { READY: "tag--ok", REPLENISH: "tag--warn", REVIEW: "tag--bad" };
const PART_TAG: Record<ComponentState, string> = { OK: "tag--ok", SHORT: "tag--warn", LOW: "tag--warn", EXPIRING: "tag--warn", REVIEW: "tag--bad" };
const PART_ICON: Record<ComponentState, "check" | "alert" | "info"> = { OK: "check", SHORT: "alert", LOW: "info", EXPIRING: "info", REVIEW: "alert" };
const CHECK_ICON: Record<CheckOutcome, "check" | "alert" | "info"> = { OK: "check", LOW: "info", MISSING: "alert", DAMAGED: "alert" };
const behaviourText = (part: { itemType: string; consumptionMode?: string }) => { const behaviour = behaviourOf({ itemType: part.itemType, consumptionMode: part.consumptionMode ?? "WHOLE_UNIT" }); return behaviour ? BEHAVIOUR_LABELS[behaviour] : "Unclassified"; };

export async function kitsWorkspace(): Promise<void> {
  const session = await loadSession("items");
  if (!session) return;
  document.title = "Kits · Staff workspace";
  shell(session, "items", html`
    <header class="page-header">
      <div class="page-header__title"><h1>Kits</h1><p>Groups of items kept together, like a sewing kit. A kit holds no stock of its own: it shows whether the items inside are ready.</p></div>
      <div class="page-header__actions">
        <p class="live-status" id="live-status">Connecting…</p>
        <a class="button button--secondary" href="/staff/items" data-route>${icon("box")}Items</a>
        <button class="button button--primary" type="button" id="new-kit">${icon("plus")}New kit</button>
      </div>
    </header>
    <div class="table-toolbar">
      <label class="search-field">${icon("search")}<span class="visually-hidden">Search kits</span><input id="kit-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search kits" data-search /><kbd aria-hidden="true">/</kbd><button class="search-field__clear" type="button" id="clear-search" aria-label="Clear search" hidden>${icon("close")}</button></label>
      <label class="checkbox"><input type="checkbox" id="show-inactive" /><span>Show inactive</span></label>
      <p class="table-toolbar__count" id="kit-count" aria-live="polite"></p>
    </div>
    <div id="kit-results" aria-busy="true"><div class="skeleton skeleton--block"></div></div>
    <section class="kit-templates" aria-labelledby="templates-title">
      <div class="kit-templates__head"><h2 id="templates-title">Kit templates</h2><button class="button button--secondary button--sm" type="button" id="new-template">${icon("plus")}New template</button></div>
      <p class="muted">A template is a ready list of components. Making a kit from one copies the list; it never copies stock, and later template edits leave existing kits alone.</p>
      <div id="template-results"></div>
    </section>
    <dialog class="sheet" id="sheet" aria-labelledby="sheet-title"></dialog>`);

  const params = new URLSearchParams(window.location.search);
  let data: Answer | null = null;
  let places = placesOf([]);
  let placeRows: PlaceRow[] = [];
  let pickable: PickItem[] | null = null;
  let openId: string | null = null;
  let detail: Detail | null = null;
  let mode: Mode = "view";
  let dirty = false;
  let marks = new Map<string, { outcome: CheckOutcome; note: string }>();
  let pendingOpen = params.get("kit");
  const sheetElement = document.querySelector<HTMLDialogElement>("#sheet")!;
  const results = document.querySelector<HTMLElement>("#kit-results")!;
  const search = document.querySelector<HTMLInputElement>("#kit-search")!;
  const inactive = document.querySelector<HTMLInputElement>("#show-inactive")!;
  search.value = params.get("q") ?? "";

  const panel = createSheet(sheetElement, {
    dirty: () => dirty || (mode === "check" && marks.size > 0),
    onClose: () => { openId = null; detail = null; dirty = false; marks = new Map(); mode = "view"; writeParams({ kit: null }); results.querySelectorAll(".is-open").forEach((row) => row.classList.remove("is-open")); }
  });
  onLeave(() => { dirty = false; marks = new Map(); });

  const pathText = (id: string | null) => id ? pathOf(places, id) ?? null : null;
  const loadPlaces = async () => {
    const { locations } = await api<{ locations: PlaceRow[] }>("/api/staff/locations");
    placeRows = locations;
    places = placesOf(locations);
  };
  const loadItems = async () => { pickable ??= (await api<{ items: PickItem[] }>("/api/staff/inventory")).items; return pickable; };

  /* ---------- The list ---------- */

  /** One small square per component, in the kit's own order: the kit's state at a glance, and which parts need a look. */
  const strip = (row: Summary) => row.total ? html`<span class="kit-strip" aria-hidden="true">${Array.from({ length: Math.min(row.total, 24) }, (_, index) => html`<span class="kit-strip__cell ${index < row.ready ? "is-ready" : ""}"></span>`)}</span>` : "";

  function rowMarkup(row: Summary): Html {
    const progress = row.total ? `${row.ready} of ${row.total} ready` : "No components yet";
    return html`<li class="kit-row ${row.active ? "" : "is-inactive"} ${row.id === openId ? "is-open" : ""}" data-key="${row.id}">
      <button type="button" class="kit-row__main" data-open="${row.id}">
        <span class="kit-row__thumb ${row.photo ? "" : "kit-row__thumb--none"}">${row.photo ? html`<img src="/api/staff/kit-media/${row.photo.id}/thumb" alt="" width="52" height="52" loading="lazy" decoding="async" />` : icon("stack")}</span>
        <span class="kit-row__text"><span class="kit-row__name">${row.name}</span>
          <span class="kit-row__sub">${row.place ?? "No place yet"}${row.templateName ? ` · from ${row.templateName}` : ""}</span>
          <span class="kit-row__sub">${row.lastCheckedAt ? `Checked ${ageOf(row.lastCheckedAt)}` : "Not checked yet"}</span></span>
      </button>
      <span class="kit-row__meta">
        ${row.active ? html`<span class="tag ${STATE_TAG[row.state]}">${KIT_STATE_LABELS[row.state]}</span>` : html`<span class="tag">Inactive</span>`}
        <span class="kit-row__progress">${strip(row)}<span>${progress}</span></span>
      </span></li>`;
  }

  const render = () => {
    if (!data) return;
    results.removeAttribute("aria-busy");
    const query = search.value.trim().toLowerCase();
    writeParams({ q: query || null, kit: openId });
    const shown = data.kits.filter((row) => (inactive.checked || row.active) && (!query || `${row.name} ${row.place ?? ""} ${row.description ?? ""} ${row.templateName ?? ""}`.toLowerCase().includes(query)));
    document.querySelector("#kit-count")!.textContent = plural(shown.length, "kit");
    (document.querySelector("#clear-search") as HTMLElement).hidden = !search.value;
    preservingFocus(results, () => mount(results, shown.length
      ? html`<ul class="kit-list" aria-label="Kits">${shown.map(rowMarkup)}</ul>`
      : data!.kits.length
        ? emptyState("No kits match", "Try another search, or show inactive kits.", html`<button class="button button--secondary" type="button" id="clear-all">Clear search</button>`)
        : emptyState("No kits yet", "Make a kit for a group of items that is kept and checked together, such as a Sewing Kit. Start from a template to avoid listing everything again.", html`<button class="button button--primary" type="button" data-new>${icon("plus")}New kit</button>`)));
    const templates = data.templates;
    mount(document.querySelector("#template-results")!, templates.length
      ? html`<ul class="kit-list kit-list--templates" aria-label="Kit templates">${templates.map((template) => html`<li class="kit-row ${template.active ? "" : "is-inactive"}">
          <button type="button" class="kit-row__main" data-template="${template.id}"><span class="kit-row__text"><span class="kit-row__name">${template.name}</span>
            <span class="kit-row__sub">${plural(template.components, "component")} · ${template.kits ? `${plural(template.kits, "kit")} made` : "no kits made yet"}</span></span></button>
          <span class="kit-row__meta">${template.active ? "" : html`<span class="tag">Turned off</span>`}</span></li>`)}</ul>`
      : html`<p class="muted">No templates yet. Save a kit as a template from its page, or make one here.</p>`);
  };

  const poll = live<Answer>("/api/staff/kits", {
    interval: 10_000,
    status: () => document.querySelector("#live-status"),
    onData: (next) => {
      data = next;
      render();
      if (pendingOpen) { if (data.kits.some((row) => row.id === pendingOpen)) void openKit(pendingOpen); pendingOpen = null; }
    },
    onError: (error) => {
      if (error.status === 401) expired();
      else if (!data) { results.removeAttribute("aria-busy"); mount(results, emptyState("Kits could not be loaded", `${error.message} Retrying automatically.`, "", "error")); }
    }
  });

  let searchTimer = 0;
  onLeave(() => window.clearTimeout(searchTimer));
  search.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(render, 120); });
  search.addEventListener("keydown", (event) => { if (event.key === "Escape" && search.value) { search.value = ""; render(); } });
  inactive.addEventListener("change", render);
  document.querySelector("#clear-search")!.addEventListener("click", () => { search.value = ""; render(); search.focus(); });
  document.querySelector("#new-kit")!.addEventListener("click", () => void newKit());
  document.querySelector("#new-template")!.addEventListener("click", () => void openTemplate(null));
  const onClick = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-new]")) void newKit();
    else if (target.closest("#clear-all")) { search.value = ""; inactive.checked = true; render(); }
    else {
      const open = target.closest<HTMLElement>("[data-open]");
      if (open) void openKit(open.dataset.open!);
      const template = target.closest<HTMLElement>("[data-template]");
      if (template) void openTemplate(template.dataset.template!);
    }
  };
  results.addEventListener("click", onClick);
  document.querySelector("#template-results")!.addEventListener("click", onClick);

  /* ---------- The sheet ---------- */

  const show = (kicker: Html | string, title: string, body: Html) => { mount(sheetElement, sheetContent(kicker, title, body)); panel.open(); };
  const sheetBody = () => sheetElement.querySelector<HTMLElement>(".sheet__body")!;

  async function openKit(id: string, next: Mode = "view"): Promise<void> {
    if (id !== openId && !panel.discardOk()) return;
    dirty = false;
    openId = id;
    mode = next;
    marks = new Map();
    results.querySelectorAll(".is-open").forEach((row) => row.classList.remove("is-open"));
    results.querySelector(`[data-key="${CSS.escape(id)}"]`)?.classList.add("is-open");
    writeParams({ kit: id });
    try {
      await loadPlaces();
      detail = await api<Detail>(`/api/staff/kits/${id}`);
    } catch (error) {
      toast(failure(error), "error");
      return;
    }
    draw();
  }

  /** What the open kit's sheet shows, for the current mode. */
  function draw(): void {
    if (!detail) return;
    if (mode === "edit") return editKit(detail);
    if (mode === "check") return checkKit(detail);
    if (mode === "summary") return summary(detail);
    return profile(detail);
  }

  const partRow = (part: Part, extra: Html | "" = ""): Html => html`<li class="kit-part kit-part--${part.state.toLowerCase()}" data-item="${part.itemId}">
      ${rowThumb({ name: part.name, category: part.category, itemType: part.itemType, iconKey: part.iconKey, visualType: part.visualType, photoId: part.photoId })}
      <div class="kit-part__text">
        <a class="kit-part__name text-link" href="/staff/items?item=${part.itemId}" data-route>${part.name}</a>
        <span class="kit-part__facts">${behaviourText(part)} · needs ${part.required} · ${part.onHand} on the shelf${part.onLoan ? ` · ${part.onLoan} on loan` : ""}</span>
        ${part.reason ? html`<span class="kit-part__why">${part.reason}</span>` : ""}
        ${part.seen && part.seen.outcome !== "OK" && part.seen.note ? html`<span class="kit-part__why">Last check: “${part.seen.note}”</span>` : ""}
      </div>
      <span class="tag ${PART_TAG[part.state]} kit-part__state">${icon(PART_ICON[part.state])}${COMPONENT_STATE_LABELS[part.state]}</span>${extra}</li>`;

  /* ---------- Profile ---------- */

  function profile(view: Detail): void {
    const { kit, components } = view;
    const needing = components.filter((part) => part.state !== "OK");
    const checkText = view.lastCheck ? `Checked ${ageOf(view.lastCheck.checkedAt)} by ${view.lastCheck.checkedBy}: ${view.lastCheck.okCount} all there${view.lastCheck.flaggedCount ? `, ${view.lastCheck.flaggedCount} to look at` : ""}${view.lastCheck.uncheckedCount ? `, ${view.lastCheck.uncheckedCount} not checked` : ""}.` : "Not checked yet.";
    show(html`<span class="mono">${kit.id}</span>`, kit.name, html`
      <section class="profile kit-profile" id="kit-photo" aria-label="Picture"><div class="profile__photo" data-tile></div>
        <div class="profile__info">
          <p class="kit-status"><span class="tag tag--lg ${kit.active ? STATE_TAG[kit.state] : ""}">${kit.active ? KIT_STATE_LABELS[kit.state] : "Inactive"}</span>
            <span>${components.length ? `${kit.ready} of ${components.length} components ready` : "No components yet"}</span></p>
          <p class="profile__meta profile__meta--place">${icon("pin")}<span>${kit.place ?? "No place yet"}</span></p>
          ${kit.description ? html`<p class="profile__meta">${kit.description}</p>` : ""}
          <p class="profile__meta profile__meta--fresh">${icon("clock")}<span>${checkText}</span></p>
          ${kit.templateName ? html`<p class="profile__meta">Made from the template ${kit.templateName}.</p>` : ""}
          <div class="profile__actions" data-actions></div>
        </div></section>
      <div class="kit-actions">
        <button class="button button--primary" type="button" id="kit-check" ${kit.active && components.length ? "" : "disabled"}>${icon("check")}Check kit</button>
        <button class="button button--secondary" type="button" id="kit-edit">Edit kit</button>
        <button class="button button--secondary" type="button" id="kit-save-template" ${components.length ? "" : "disabled"}>Save as template</button>
      </div>
      <p class="callout callout--note kit-note" role="note">${icon("info")}<span>The kit’s state is read from the items below. Checking a kit does not change stock; to correct a quantity, open the item.</span></p>
      <div class="form-alert" id="kit-alert" role="alert" hidden></div>
      ${needing.length ? html`<h3 class="kit-heading">Needs attention <span class="muted">(${needing.length})</span></h3><ul class="kit-parts">${needing.map((part) => partRow(part))}</ul>` : ""}
      <h3 class="kit-heading">${needing.length ? "Everything else" : "Components"} <span class="muted">(${components.length - needing.length})</span></h3>
      ${components.length ? html`<ul class="kit-parts">${components.filter((part) => part.state === "OK").map((part) => partRow(part))}</ul>`
        : html`<p class="muted">Nothing listed yet. Use Edit kit to add the items it should hold.</p>`}
      ${view.checks.length ? html`<h3 class="kit-heading">Recent checks</h3><ul class="kit-history">${view.checks.map((check) => html`<li><strong>${ageOf(check.checkedAt)}</strong> · ${check.checkedBy}<span class="muted"> · ${check.okCount} all there${check.flaggedCount ? `, ${check.flaggedCount} to look at` : ""}${check.uncheckedCount ? `, ${check.uncheckedCount} not checked` : ""}${check.note ? ` · “${check.note}”` : ""}</span></li>`)}</ul>` : ""}
      <div id="template-form"></div>`);
    const alert = sheetElement.querySelector<HTMLElement>("#kit-alert")!;
    sheetElement.querySelector("#kit-check")!.addEventListener("click", () => { mode = "check"; marks = new Map(); draw(); });
    sheetElement.querySelector("#kit-edit")!.addEventListener("click", () => { mode = "edit"; draw(); });
    sheetElement.querySelector("#kit-save-template")!.addEventListener("click", () => {
      const host = sheetElement.querySelector<HTMLElement>("#template-form")!;
      mount(host, html`<form class="card kit-template-form" novalidate><div class="card__head"><h3>Save as a template</h3></div>
        <p class="card__text">Copies this kit’s list of components, not its stock. New kits made from it start with the same list.</p>
        <div class="field"><label for="tpl-name">Template name</label><input id="tpl-name" maxlength="80" autocomplete="off" value="${kit.name.replace(/\s+[A-Z0-9]$/, "")}" /></div>
        <div class="form-alert" id="tpl-alert" role="alert" hidden></div>
        <div class="where__buttons"><button class="button button--primary" type="submit">Save template</button></div></form>`);
      const form = host.querySelector("form")!;
      host.querySelector<HTMLInputElement>("#tpl-name")!.focus();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = host.querySelector<HTMLInputElement>("#tpl-name")!.value;
        const problem = host.querySelector<HTMLElement>("#tpl-alert")!;
        setMessage(problem, "");
        try {
          await api("/api/staff/kit-templates", { method: "POST", body: JSON.stringify({ name, description: kit.description, fromKitId: kit.id }) });
          await poll.refresh();
          mount(host, html``);
          toast("Template saved. Choose it when you make the next kit.");
        } catch (error) { setMessage(problem, failure(error)); }
      });
    });
    const body = sheetElement.querySelector<HTMLElement>("#kit-photo")!;
    photoPanel(body, {
      id: kit.id, name: kit.name, photo: kit.photo, noun: "picture", endpoint: `/api/staff/kits/${kit.id}/photo`, thumbUrl: (photoId) => `/api/staff/kit-media/${photoId}/thumb`,
      hintAdd: "Optional. A picture of the kit as it should look when it is complete.",
      hintHas: "Shown beside the kit in the list.",
      removeNote: "Nothing else changes.",
      view: (shown) => void openViewer(`/api/staff/kit-media/${shown.id}/display`, `Picture of ${kit.name}`, () => sheetElement.querySelector<HTMLElement>("#kit-photo [data-view] img"), kit.name),
      changed: async () => { await poll.refresh(); },
      refresh: async () => { await openKit(kit.id); }
    });
    void alert;
  }

  /* ---------- Editing: details and components ---------- */

  const placeOptions = (current: string | null) => html`<option value="">No place yet</option>${inOrder(places).filter(({ place }) => place.active || place.id === current).map(({ place }) =>
    html`<option value="${place.id}" ${place.id === current ? html`selected` : ""}>${pathOf(places, place.id)}${place.active ? "" : " (inactive)"}</option>`)}`;

  /**
   * The component list of a kit or a template: a quantity and a remove button per row, and a search that adds an item once.
   * Edits live in `draft` until the form is saved.
   */
  function componentsEditor(host: HTMLElement, draft: Draft[], changed: () => void): void {
    host.innerHTML = "";
    mount(host, html`<fieldset class="field fieldset kit-editor"><legend>Components</legend>
      <p class="field__hint" id="parts-hint">Each item keeps its own stock and rules, so one kit can hold things to borrow, things to take and things used gradually. The number is how many the kit should hold.</p>
      <ul class="kit-edit-rows" id="parts-rows" aria-describedby="parts-hint"></ul>
      <div class="field"><label for="parts-search">Add an item</label><input id="parts-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search the catalog" /></div>
      <ul class="kit-pick" id="parts-pick" aria-label="Matching items"></ul></fieldset>`);
    const rows = host.querySelector<HTMLElement>("#parts-rows")!;
    const pick = host.querySelector<HTMLElement>("#parts-pick")!;
    const input = host.querySelector<HTMLInputElement>("#parts-search")!;
    const drawRows = () => mount(rows, draft.length ? html`${draft.map((entry, index) => html`<li class="kit-edit-row"><span class="kit-edit-row__name">${entry.name}</span>
        <label class="kit-edit-row__qty"><span class="visually-hidden">How many ${entry.name} the kit holds</span><input type="number" inputmode="numeric" min="1" max="1000" step="1" value="${entry.required}" data-qty="${index}" /></label>
        <button class="icon-button" type="button" data-remove="${index}" aria-label="Remove ${entry.name} from the kit">${icon("close")}</button></li>`)}`
      : html`<li class="muted">Nothing yet. Search below to add the first item.</li>`);
    const drawPick = async () => {
      const query = input.value.trim().toLowerCase();
      if (!query) { mount(pick, html``); return; }
      const items = await loadItems();
      const taken = new Set(draft.map((entry) => entry.itemId));
      const found = items.filter((entry) => !taken.has(entry.id) && entry.status !== "INACTIVE" && `${entry.name} ${entry.category} ${entry.id}`.toLowerCase().includes(query)).slice(0, 8);
      mount(pick, found.length ? html`${found.map((entry) => html`<li><button type="button" class="kit-pick__item" data-add="${entry.id}">${rowThumb({ name: entry.name, category: entry.category, itemType: entry.itemType, iconKey: entry.iconKey, visualType: entry.visualType, photoId: entry.photoId })}
          <span class="kit-pick__text"><strong>${entry.name}</strong><span>${behaviourText(entry)} · ${entry.onHand} ${units(entry.onHand, entry.unit)} on hand</span></span>${icon("plus")}</button></li>`)}`
        : html`<li class="muted">No active item matches “${input.value.trim()}”.</li>`);
    };
    drawRows();
    input.addEventListener("input", () => void drawPick());
    host.addEventListener("input", (event) => {
      const qty = (event.target as HTMLElement).closest<HTMLInputElement>("[data-qty]");
      if (!qty) return;
      draft[Number(qty.dataset.qty)]!.required = Number(qty.value) || 0;
      changed();
    });
    host.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
      const remove = target.closest<HTMLElement>("[data-remove]");
      if (remove) { draft.splice(Number(remove.dataset.remove), 1); drawRows(); void drawPick(); changed(); return; }
      const add = target.closest<HTMLElement>("[data-add]");
      if (!add) return;
      const entry = (await loadItems()).find((each) => each.id === add.dataset.add);
      if (!entry) return;
      draft.push({ itemId: entry.id, name: entry.name, unit: entry.unit, required: 1 });
      input.value = "";
      drawRows();
      mount(pick, html``);
      changed();
      rows.querySelector<HTMLInputElement>(`[data-qty="${draft.length - 1}"]`)?.focus();
    });
  }

  const draftOf = (parts: Part[]): Draft[] => parts.map((part) => ({ itemId: part.itemId, name: part.name, unit: part.unit, required: part.required }));
  const draftBody = (draft: Draft[]) => draft.map(({ itemId, required }) => ({ itemId, required }));
  const badQuantity = (draft: Draft[]) => draft.find((entry) => !Number.isInteger(entry.required) || entry.required < 1 || entry.required > 1000);

  function editKit(view: Detail): void {
    const { kit } = view;
    const draft = draftOf(view.components);
    show(html`<span class="mono">${kit.id}</span>`, `Edit ${kit.name}`, html`<form id="kit-form" class="form" novalidate>
      <div class="field"><label for="k-name">Name</label><input id="k-name" name="name" value="${kit.name}" required maxlength="80" autocomplete="off" /></div>
      <div class="field"><label for="k-place">Kept at</label><select id="k-place" name="locationId">${placeOptions(kit.locationId)}</select></div>
      <div class="field"><label for="k-description">Description <span class="field__optional">optional</span></label><textarea id="k-description" name="description" rows="2" maxlength="600">${kit.description ?? ""}</textarea></div>
      <div id="parts"></div>
      <label class="checkbox"><input type="checkbox" name="active" ${kit.active ? html`checked` : ""} /><span>In use</span></label>
      <p class="field__hint">Turning this off hides the kit from the list and stops it asking for stock. Its checks stay on record.</p>
      <div class="form-alert" id="kit-alert" role="alert" hidden></div>
      <div class="form-actions form-actions--sticky"><button class="button button--primary" type="submit">Save changes</button><button class="button button--ghost" type="button" id="kit-cancel">Cancel</button></div></form>`);
    const form = sheetElement.querySelector<HTMLFormElement>("#kit-form")!;
    const alert = form.querySelector<HTMLElement>("#kit-alert")!;
    componentsEditor(form.querySelector<HTMLElement>("#parts")!, draft, () => { dirty = true; });
    form.addEventListener("input", () => { dirty = true; });
    form.querySelector("#kit-cancel")!.addEventListener("click", () => { if (!panel.discardOk()) return; dirty = false; mode = "view"; draw(); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const name = String(values.get("name") ?? "");
      if (!name.trim()) { setMessage(alert, "Give the kit a name."); form.querySelector<HTMLInputElement>("#k-name")!.focus(); return; }
      const wrong = badQuantity(draft);
      if (wrong) { setMessage(alert, `Give ${wrong.name} a whole number from 1 to 1000.`); return; }
      const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      button.disabled = true;
      setMessage(alert, "");
      try {
        const result = await api<{ changed: number }>(`/api/staff/kits/${kit.id}`, { method: "PATCH", body: JSON.stringify({ name, description: String(values.get("description") ?? ""), locationId: String(values.get("locationId") ?? "") || null,
          active: values.get("active") === "on", updatedAt: kit.updatedAt, components: draftBody(draft) }) });
        dirty = false;
        await poll.refresh();
        await openKit(kit.id);
        toast(result.changed ? "Changes saved." : "No changes to save.");
      } catch (error) {
        const stale = error instanceof ApiError && error.status === 409 && /Someone else/.test(error.message);
        setMessage(alert, stale ? html`${failure(error)} <button type="button" class="text-link" data-reload>Load the latest</button>` : failure(error));
        alert.querySelector("[data-reload]")?.addEventListener("click", async () => { dirty = false; await openKit(kit.id); });
        button.disabled = false;
      }
    });
    form.querySelector<HTMLInputElement>("#k-name")!.focus();
  }

  async function newKit(): Promise<void> {
    if (!panel.discardOk()) return;
    dirty = false;
    openId = null;
    detail = null;
    mode = "edit";
    writeParams({ kit: null });
    try { await loadPlaces(); } catch (error) { toast(failure(error), "error"); return; }
    const templates = (data?.templates ?? []).filter((template) => template.active);
    show("New kit", "Make a kit", html`<form id="kit-form" class="form" novalidate>
      <div class="field"><label for="k-name">Name</label><input id="k-name" name="name" required maxlength="80" autocomplete="off" placeholder="Sewing Kit A" aria-describedby="k-name-hint" /><p class="field__hint" id="k-name-hint">What staff call this one. Each physical kit gets its own name, so its state stays its own.</p></div>
      <div class="field"><label for="k-template">Start from</label><select id="k-template" name="templateId"><option value="">An empty kit</option>${templates.map((template) => html`<option value="${template.id}">${template.name} (${plural(template.components, "component")})</option>`)}</select>
        <p class="field__hint">A template copies its list of components. You can change the list afterwards.</p></div>
      <div class="field"><label for="k-place">Kept at</label><select id="k-place" name="locationId">${placeOptions(null)}</select></div>
      <div class="field"><label for="k-description">Description <span class="field__optional">optional</span></label><textarea id="k-description" name="description" rows="2" maxlength="600"></textarea></div>
      <div class="form-alert" id="kit-alert" role="alert" hidden></div>
      <div class="form-actions form-actions--sticky"><button class="button button--primary" type="submit">Make kit</button></div></form>`);
    const form = sheetElement.querySelector<HTMLFormElement>("#kit-form")!;
    const alert = form.querySelector<HTMLElement>("#kit-alert")!;
    form.addEventListener("input", () => { dirty = true; });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      if (!String(values.get("name") ?? "").trim()) { setMessage(alert, "Give the kit a name."); form.querySelector<HTMLInputElement>("#k-name")!.focus(); return; }
      const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      button.disabled = true;
      setMessage(alert, "");
      try {
        const { id } = await api<{ id: string }>("/api/staff/kits", { method: "POST", body: JSON.stringify({ name: String(values.get("name")), description: String(values.get("description") ?? ""),
          locationId: String(values.get("locationId") ?? "") || null, ...(values.get("templateId") ? { templateId: String(values.get("templateId")) } : {}) }) });
        dirty = false;
        await poll.refresh();
        await openKit(id, values.get("templateId") ? "view" : "edit");
        toast(values.get("templateId") ? "Kit made from the template." : "Kit made. Add its components next.");
      } catch (error) {
        setMessage(alert, failure(error));
        button.disabled = false;
      }
    });
    form.querySelector<HTMLInputElement>("#k-name")!.focus();
  }

  /* ---------- Templates ---------- */

  async function openTemplate(id: string | null): Promise<void> {
    if (!panel.discardOk()) return;
    dirty = false;
    openId = null;
    mode = "template";
    type Template1 = { id: string; name: string; description: string | null; active: boolean; updatedAt: string };
    let template = null as Template1 | null;
    let draft: Draft[] = [];
    if (id) {
      try {
        const loaded = await api<{ template: Template1; components: Array<{ itemId: string; name: string; unit: string; required: number }> }>(`/api/staff/kit-templates/${id}`);
        template = loaded.template;
        draft = loaded.components;
      } catch (error) { toast(failure(error), "error"); return; }
    }
    show(template ? html`<span class="mono">${template.id}</span>` : "New template", template ? template.name : "Make a template", html`<form id="template-edit" class="form" novalidate>
      <div class="field"><label for="t-name">Name</label><input id="t-name" name="name" value="${template?.name ?? ""}" required maxlength="80" autocomplete="off" placeholder="Sewing Kit" /></div>
      <div class="field"><label for="t-description">Description <span class="field__optional">optional</span></label><textarea id="t-description" name="description" rows="2" maxlength="600">${template?.description ?? ""}</textarea></div>
      <div id="parts"></div>
      ${template ? html`<label class="checkbox"><input type="checkbox" name="active" ${template.active ? html`checked` : ""} /><span>Available for new kits</span></label>
        <p class="field__hint">Kits already made from it are not changed by turning it off or by editing it.</p>` : ""}
      <div class="form-alert" id="template-alert" role="alert" hidden></div>
      <div class="form-actions form-actions--sticky"><button class="button button--primary" type="submit">${template ? "Save changes" : "Make template"}</button></div></form>`);
    const form = sheetElement.querySelector<HTMLFormElement>("#template-edit")!;
    const alert = form.querySelector<HTMLElement>("#template-alert")!;
    componentsEditor(form.querySelector<HTMLElement>("#parts")!, draft, () => { dirty = true; });
    form.addEventListener("input", () => { dirty = true; });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      if (!String(values.get("name") ?? "").trim()) { setMessage(alert, "Give the template a name."); return; }
      const wrong = badQuantity(draft);
      if (wrong) { setMessage(alert, `Give ${wrong.name} a whole number from 1 to 1000.`); return; }
      const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      button.disabled = true;
      setMessage(alert, "");
      const body = { name: String(values.get("name")), description: String(values.get("description") ?? ""), components: draftBody(draft) };
      try {
        if (template) await api(`/api/staff/kit-templates/${template.id}`, { method: "PATCH", body: JSON.stringify({ ...body, active: values.get("active") === "on", updatedAt: template.updatedAt }) });
        else await api("/api/staff/kit-templates", { method: "POST", body: JSON.stringify(body) });
        dirty = false;
        await poll.refresh();
        panel.close(true);
        toast(template ? "Template saved." : "Template made.");
      } catch (error) {
        setMessage(alert, failure(error));
        button.disabled = false;
      }
    });
    form.querySelector<HTMLInputElement>("#t-name")!.focus();
  }

  /* ---------- Checking a kit ---------- */

  function checkKit(view: Detail): void {
    const { kit, components } = view;
    const rowOf = (part: Part): Html => {
      const mark = marks.get(part.itemId);
      return html`<li class="kit-check-row ${mark ? (mark.outcome === "OK" ? "is-ok" : "is-flagged") : ""}" data-item="${part.itemId}">
        <div class="kit-check-row__head">${rowThumb({ name: part.name, category: part.category, itemType: part.itemType, iconKey: part.iconKey, visualType: part.visualType, photoId: part.photoId })}
          <div class="kit-part__text"><strong>${part.name}</strong><span class="kit-part__facts">${part.required} ${units(part.required, part.unit)} · ${behaviourText(part)}${part.reason ? ` · ${part.reason}` : ""}</span></div></div>
        <div class="kit-check-row__choices" role="group" aria-label="How ${part.name} looks">${CHECK_OUTCOMES.map((outcome) => html`<button type="button" class="button ${mark?.outcome === outcome ? "button--primary" : "button--secondary"}" data-mark="${outcome}" aria-pressed="${mark?.outcome === outcome ? "true" : "false"}">${mark?.outcome === outcome ? icon(CHECK_ICON[outcome]) : ""}${CHECK_LABELS[outcome]}</button>`)}</div>
        ${mark && mark.outcome !== "OK" ? html`<label class="kit-check-row__note"><span class="visually-hidden">Note about ${part.name}</span><input type="text" maxlength="300" placeholder="What did you see? (optional)" value="${mark.note}" data-note autocomplete="off" /></label>` : ""}</li>`;
    };
    const redraw = () => {
      const done = marks.size;
      const flagged = [...marks.values()].filter((mark) => mark.outcome !== "OK").length;
      mount(sheetElement.querySelector<HTMLElement>("#check-rows")!, html`${components.map(rowOf)}`);
      sheetElement.querySelector(".kit-progress__count")!.innerHTML = `<strong>${done} / ${components.length}</strong> checked${flagged ? ` · ${plural(flagged, "finding")}` : ""}`;
      const bar = sheetElement.querySelector<HTMLProgressElement>(".kit-progress progress")!;
      bar.value = done;
      sheetElement.querySelector<HTMLButtonElement>("#check-finish")!.disabled = done === 0;
    };
    show(html`<span class="mono">${kit.id}</span>`, `Check ${kit.name}`, html`
      <div class="kit-progress"><p class="kit-progress__count" aria-live="polite"></p><progress aria-label="Components checked" max="${Math.max(components.length, 1)}" value="0"></progress></div>
      <p class="muted">Look at each part and mark how it is. This records what you saw; it does not change stock.</p>
      <div class="kit-check-tools"><button class="button button--ghost button--sm" type="button" id="check-all">${icon("check")}Mark everything not yet marked as all there</button></div>
      <ul class="kit-check-rows" id="check-rows"></ul>
      <label class="field kit-check-note"><span>Note about the kit <span class="field__optional">optional</span></span><input id="check-note" maxlength="300" autocomplete="off" /></label>
      <div class="form-alert" id="check-alert" role="alert" hidden></div>
      <div class="form-actions form-actions--sticky"><button class="button button--primary" type="button" id="check-finish" disabled>Finish check</button><button class="button button--ghost" type="button" id="check-cancel">Cancel</button></div>`);
    redraw();
    const alert = sheetElement.querySelector<HTMLElement>("#check-alert")!;
    const rows = sheetElement.querySelector<HTMLElement>("#check-rows")!;
    rows.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-mark]");
      const itemId = (event.target as HTMLElement).closest<HTMLElement>("[data-item]")?.dataset.item;
      if (!button || !itemId) return;
      const outcome = button.dataset.mark as CheckOutcome;
      marks.set(itemId, { outcome, note: marks.get(itemId)?.note ?? "" });
      redraw();
      rows.querySelector<HTMLElement>(`[data-item="${CSS.escape(itemId)}"] [data-mark="${outcome}"]`)?.focus();
    });
    rows.addEventListener("input", (event) => {
      const field = (event.target as HTMLElement).closest<HTMLInputElement>("[data-note]");
      const itemId = (event.target as HTMLElement).closest<HTMLElement>("[data-item]")?.dataset.item;
      if (field && itemId && marks.has(itemId)) marks.get(itemId)!.note = field.value;
    });
    sheetElement.querySelector("#check-all")!.addEventListener("click", () => { for (const part of components) if (!marks.has(part.itemId)) marks.set(part.itemId, { outcome: "OK", note: "" }); redraw(); });
    sheetElement.querySelector("#check-cancel")!.addEventListener("click", () => { if (!panel.discardOk()) return; marks = new Map(); mode = "view"; draw(); });
    const finish = sheetElement.querySelector<HTMLButtonElement>("#check-finish")!;
    // One id per check: if the answer is lost and this is pressed again, the server finds the check it already has.
    const checkId = `KC-${crypto.randomUUID()}`;
    finish.addEventListener("click", async () => {
      const left = components.length - marks.size;
      if (left && !window.confirm(`${plural(left, "component")} ${left === 1 ? "hasn’t" : "haven’t"} been marked. Finish anyway? ${left === 1 ? "It stays" : "They stay"} “not checked” in the summary.`)) return;
      finish.disabled = true;
      setMessage(alert, "");
      try {
        await api(`/api/staff/kits/${kit.id}/checks`, { method: "POST", body: JSON.stringify({ id: checkId, note: sheetElement.querySelector<HTMLInputElement>("#check-note")!.value,
          observations: [...marks].map(([itemId, mark]) => ({ itemId, outcome: mark.outcome, note: mark.outcome === "OK" ? "" : mark.note })) }) });
        marks = new Map();
        await poll.refresh();
        detail = await api<Detail>(`/api/staff/kits/${kit.id}`);
        mode = "summary";
        draw();
      } catch (error) {
        setMessage(alert, failure(error));
        finish.disabled = false;
      }
    });
  }

  function summary(view: Detail): void {
    const { kit, lastCheck } = view;
    if (!lastCheck) { mode = "view"; return draw(); }
    const flagged = lastCheck.observations.filter((entry) => entry.outcome !== "OK");
    const partOf = (id: string) => view.components.find((part) => part.itemId === id);
    show(html`<span class="mono">${kit.id}</span>`, `${kit.name}: checked`, html`
      <dl class="kit-stats"><div><dt>All there</dt><dd>${lastCheck.okCount}</dd></div><div><dt>To look at</dt><dd>${lastCheck.flaggedCount}</dd></div><div><dt>Not checked</dt><dd>${lastCheck.uncheckedCount}</dd></div></dl>
      <p class="kit-status"><span class="tag tag--lg ${STATE_TAG[kit.state]}">${KIT_STATE_LABELS[kit.state]}</span><span>${kit.ready} of ${kit.total} components ready now</span></p>
      <p class="callout callout--note kit-note" role="note">${icon("info")}<span>Stock was not changed by this check. To put a quantity right, open the item and use its own Stock in, Stock out or Count.</span></p>
      ${flagged.length ? html`<h3 class="kit-heading">To look at</h3><ul class="kit-parts">${flagged.map((entry) => html`<li class="kit-part kit-part--${entry.outcome === "LOW" ? "low" : "review"}">
        <div class="kit-part__text"><a class="kit-part__name text-link" href="/staff/items?item=${entry.itemId}" data-route>${entry.name}</a>
          <span class="kit-part__facts">${partOf(entry.itemId) ? `${partOf(entry.itemId)!.onHand} on the shelf, needs ${partOf(entry.itemId)!.required}` : ""}</span>${entry.note ? html`<span class="kit-part__why">“${entry.note}”</span>` : ""}</div>
        <span class="tag ${entry.outcome === "LOW" ? "tag--warn" : "tag--bad"} kit-part__state">${icon(CHECK_ICON[entry.outcome])}${CHECK_LABELS[entry.outcome]}</span></li>`)}</ul>`
        : html`<p class="muted">Everything marked was there.</p>`}
      ${lastCheck.note ? html`<p class="muted">Note: “${lastCheck.note}”</p>` : ""}
      <div class="form-actions"><button class="button button--primary" type="button" id="summary-done">Back to the kit</button></div>`);
    sheetElement.querySelector("#summary-done")!.addEventListener("click", () => { mode = "view"; draw(); });
  }

  void sheetBody;
}
