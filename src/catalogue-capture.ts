import { suggest } from "./catalogue-suggest";
import { type Entry, drop, durable, entries, keep } from "./catalogue-outbox";
import { type PlaceList, bindNewPlace, newPlaceForm, placeList, placeOptions, refreshParents } from "./catalogue-places";
import { BEHAVIOURS, BEHAVIOUR_LABELS, type Behaviour, UNSORTED_CATEGORY } from "./catalog-policy";
import { type Known as DuplicateKnown, type Match, possibleDuplicates } from "./duplicates";
import { preparePhoto, photoUrl } from "./item-photo";
import type { PlaceRow, Session } from "./staff";
import { shell } from "./staff";
import { ApiError, type Html, api, categoryName, dataUrl, emptyState, expired, failure, html, icon, leave, live, mount, onLeave, plural, preservingFocus, setMessage, toast, units } from "./ui";

/*
 * The capture screen of a cataloguing session (/staff/catalogue?session=…): one form, kept on screen, that turns a thing on a shelf
 * into a saved record in a few taps, then clears for the next. Saving never waits: the form is cleared at once and the record goes
 * to the server from a short queue (catalogue-outbox.ts), shown below with its state until the server has everything.
 */

type InventoryItem = {
  id: string; name: string; aliases: string | null; category: string; itemType: string; consumptionMode: string; unit: string; stockArea: string | null;
  status: string; model: string | null; serialNumber: string | null; photoHash: string | null; photoId: string | null; locationId: string | null; onHand: number;
};
type Inventory = { revision: number; items: InventoryItem[]; categories: string[]; units: string[]; locations: PlaceRow[] };
export type SessionInfo = { id: string; locationId: string | null; place: string | null; status: string; startedAt: string; finishedAt: string | null; saved: number; reviewLater: number; owner: string; mine: boolean };
type Recent = { captureId: string; behaviour: Behaviour; capturedAt: string; itemId: string; name: string; category: string; itemType: string; consumptionMode: string; unit: string; stockArea: string | null; onHand: number; place: string | null; photoId: string | null };
export type Detail = { session: SessionInfo; counts: Record<string, number>; recent: Recent[] };

const HINTS: Record<Behaviour, string> = { BORROW: "Lent out and brought back", CONSUME: "Taken and used up", GRADUAL: "Opened, used a little at a time", REVIEW_LATER: "Keep it counted, decide later" };
const ORDER = ["cat-name", "cat-qty", "cat-category", "cat-unit"];
const TYPING = "input, textarea, select, [contenteditable=true]";

/** What a queued capture looks like to the lists and rules that read items. */
function known(entry: Entry): InventoryItem {
  const body = entry.body;
  const text = (key: string) => (typeof body[key] === "string" && body[key] ? body[key] as string : null);
  const behaviour = body.behaviour as Behaviour;
  return {
    id: entry.itemId ?? `pending:${entry.id}`, name: String(body.name), aliases: text("aliases"), category: text("category") ?? UNSORTED_CATEGORY, unit: text("unit") ?? "piece",
    itemType: behaviour === "BORROW" ? "Loanable" : behaviour === "REVIEW_LATER" ? "NEEDS_REVIEW" : "Consumable", consumptionMode: behaviour === "GRADUAL" ? "OPEN_UNIT" : "WHOLE_UNIT",
    stockArea: text("stockArea"), status: "ACTIVE", model: text("model"), serialNumber: text("serialNumber"), photoHash: entry.photo?.hash ?? null, photoId: null,
    locationId: text("locationId"), onHand: Number(body.quantity)
  };
}

export async function captureScreen(session: Session, sessionId: string): Promise<void> {
  document.title = "Cataloguing · Staff workspace";
  shell(session, "items", html`<div class="cat" id="cat"><div class="skeleton skeleton--block"></div></div>`);
  const root = document.querySelector<HTMLElement>("#cat")!;
  let detail: Detail;
  try {
    detail = await api<Detail>(`/api/staff/catalogue/sessions/${sessionId}`);
  } catch (error) {
    mount(root, emptyState("This cataloguing session could not be opened", failure(error), html`<a class="button button--secondary" href="/staff/catalogue" data-route>Back to Catalogue</a>`, "error", 1));
    return;
  }
  if (detail.session.status !== "ACTIVE" || !detail.session.mine) {
    const { finishedView } = await import("./catalogue-workspace");
    finishedView(root, detail);
    return;
  }

  let inventory: Inventory | null = null;
  let list: PlaceList = placeList([]);
  let placeId = detail.session.locationId;
  let waiting: Entry[] = [];
  /** Captures taken on this page, by request id, so a possible match can name the thing just added. */
  const created = new Map<string, string>();
  let photo: { display: Blob; thumb: Blob; preview: string; hash: string } | null = null;
  let behaviour: Behaviour | null = null;
  /** True once Save has shown the possible matches: the next Save is the person saying "a different one". */
  let armed = false;
  let preparing = false;
  const thumbs = new Map<string, string>();

  mount(root, html`
    <p class="visually-hidden" id="cat-announce" role="status"></p>
    <input class="visually-hidden" type="file" id="cat-file" accept="image/*" capture="environment" tabindex="-1" aria-label="Choose a photo" />
    <header class="cat-bar">
      <a class="button button--ghost button--sm" href="/staff/catalogue" data-route>${icon("back")}Catalogue</a>
      <div class="cat-bar__place"><span class="cat-bar__label">Cataloguing in</span>
        <button type="button" class="cat-place" id="cat-place" aria-expanded="false" aria-controls="cat-place-panel">${icon("pin")}<span id="cat-place-name"></span><span class="cat-place__change">Change</span></button></div>
      <p class="cat-bar__count"><strong id="cat-count"></strong> <span id="cat-sync" class="live-status" data-state="live"></span></p>
      <button type="button" class="button button--secondary button--sm" id="cat-finish">Finish</button>
    </header>
    <div class="cat-place-panel" id="cat-place-panel" hidden>
      <div class="field"><label for="cat-place-select">Next items are in</label><select id="cat-place-select"></select></div>
      <p><button type="button" class="text-link" data-new-place-toggle aria-expanded="false" aria-controls="cat-new-place">${icon("plus")} New place</button></p>
      <div id="cat-new-place"></div>
    </div>
    <div class="cat-layout">
      <form class="cat-form card" id="cat-form" novalidate aria-label="Add an item">
        <div class="cat-top">
          <button type="button" class="cat-photo" id="cat-photo" aria-label="Take a photo"><span class="cat-photo__empty">${icon("camera")}<span>Photo</span></span></button>
          <div class="field cat-name"><label for="cat-name">Name</label><input id="cat-name" maxlength="120" autocomplete="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="next" placeholder="What is it?" aria-describedby="cat-name-hint" /><p class="field__hint" id="cat-name-hint">A temporary name is fine if you are not sure.</p></div>
        </div>
        <div class="cat-dup" id="cat-dup" aria-live="polite"></div>
        <fieldset class="cat-behaviour" id="cat-behaviour"><legend>How is it used?</legend>
          <div class="cat-choices">${BEHAVIOURS.map((value, index) => html`<button type="button" class="cat-choice" data-behaviour="${value}" aria-pressed="false" aria-keyshortcuts="${index + 1}"><span class="cat-choice__title">${BEHAVIOUR_LABELS[value]}</span><span class="cat-choice__hint">${HINTS[value]}</span><span class="cat-choice__suggest" hidden>Suggested</span></button>`)}</div>
          <p class="cat-suggest" id="cat-why" aria-live="polite"></p>
        </fieldset>
        <div class="cat-qty field"><label for="cat-qty">How many are here?</label>
          <div class="stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="One fewer">${icon("minus")}</button><input id="cat-qty" type="number" inputmode="numeric" min="0" max="100000" step="1" value="1" /><button type="button" class="stepper__button" data-step="1" aria-label="One more">${icon("plus")}</button></div></div>
        <div class="field-grid">
          <div class="field"><label for="cat-category">Category <span class="field__optional" data-optional hidden>optional for now</span></label><input id="cat-category" list="cat-categories" maxlength="100" autocomplete="off" /><datalist id="cat-categories"></datalist><div class="cat-chips" id="cat-category-chips"></div></div>
          <div class="field"><label for="cat-unit">Counted in <span class="field__optional" data-optional hidden>optional for now</span></label><input id="cat-unit" list="cat-units" maxlength="30" autocomplete="off" placeholder="piece, box, ream" /><datalist id="cat-units"></datalist><div class="cat-chips" id="cat-unit-chips"></div></div>
        </div>
        <details class="cat-more" id="cat-more"><summary>More details</summary>
          <div class="field-grid">
            <div class="field"><label for="cat-model">Model <span class="field__optional">optional</span></label><input id="cat-model" maxlength="80" autocomplete="off" /></div>
            <div class="field"><label for="cat-serial">Serial number <span class="field__optional">optional</span></label><input id="cat-serial" maxlength="80" autocomplete="off" autocapitalize="characters" spellcheck="false" /></div>
          </div>
          <div class="field-grid">
            <div class="field"><label for="cat-stock">Stock area</label><select id="cat-stock"><option value="Inventory">General stock</option><option value="Pantry">Pantry</option></select></div>
            <div class="field"><label for="cat-aliases">Other names <span class="field__optional">optional</span></label><input id="cat-aliases" maxlength="300" autocomplete="off" /></div>
          </div>
          <div class="field"><label for="cat-notes">Notes <span class="field__optional">optional</span></label><textarea id="cat-notes" rows="2" maxlength="1000"></textarea></div>
        </details>
        <div class="form-alert" id="cat-alert" role="alert" hidden></div>
        <div class="cat-actions">
          <button type="submit" class="button button--primary button--lg" id="cat-save">Save &amp; next ${icon("next")}</button>
          <button type="button" class="button button--secondary" id="cat-like">Save, then add another like this</button>
        </div>
        <p class="cat-keys" aria-hidden="true"><kbd>Ctrl</kbd> <kbd>Enter</kbd> save · <kbd>1</kbd>–<kbd>4</kbd> how it is used · <kbd>P</kbd> photo</p>
      </form>
      <section class="cat-recent" aria-labelledby="cat-recent-title"><h2 id="cat-recent-title">Just added</h2><div id="cat-list"></div></section>
    </div>`);

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const form = $<HTMLFormElement>("#cat-form");
  const field = (id: string) => $<HTMLInputElement>(`#${id}`);
  const value = (id: string) => field(id).value.trim();
  const sync = $("#cat-sync");

  /* ---------- Places ---------- */

  const showPlace = () => {
    $("#cat-place-name").textContent = (placeId ? list.paths.get(placeId) : null) ?? detail.session.place ?? "Choose a place";
    mount($("#cat-place-select"), placeOptions(list, placeId));
  };
  const panel = $("#cat-place-panel");
  $("#cat-place").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    $("#cat-place").setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) $("#cat-place-select").focus();
  });
  const choosePlace = async (id: string) => {
    placeId = id;
    showPlace();
    panel.hidden = true;
    $("#cat-place").setAttribute("aria-expanded", "false");
    // Where a resumed session opens; every capture also names its own place, so a failure here loses nothing.
    void api(`/api/staff/catalogue/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify({ locationId: id }) }).catch(() => undefined);
    field("cat-name").focus();
  };
  $("#cat-place-select").addEventListener("change", (event) => { void choosePlace((event.target as HTMLSelectElement).value); });
  mount($("#cat-new-place"), newPlaceForm(list, placeId));
  bindNewPlace(panel, async (id) => { await poll.refresh(); await choosePlace(id); toast("Place added."); });

  /* ---------- The form: suggestions and possible matches ---------- */

  /** Everything known so far: what the server listed, and what this page has queued and not yet seen come back. */
  const everything = (): InventoryItem[] => {
    const queued = waiting.map(known);
    const ids = new Set(queued.map((item) => item.id));
    return [...queued, ...(inventory?.items ?? []).filter((item) => !ids.has(item.id))];
  };

  const recent = (): InventoryItem[] => [...waiting].reverse().map(known).concat(detail.recent.filter((row) => !waiting.some((entry) => entry.id === row.captureId)).map((row) => ({
    id: row.itemId, name: row.name, aliases: null, category: row.category, itemType: row.itemType, consumptionMode: row.consumptionMode, unit: row.unit, stockArea: row.stockArea,
    status: "ACTIVE", model: null, serialNumber: null, photoHash: null, photoId: row.photoId, locationId: null, onHand: row.onHand
  })));

  let matches: Match[] = [];
  const matchRows = (): Html => html`${matches.map((match) => {
    const item = everything().find((entry) => entry.id === match.id);
    const pending = match.id.startsWith("pending:");
    return html`<li class="cat-dup__row"><span class="cat-dup__text"><strong>${item?.name ?? match.id}</strong><span>${match.reason}${item ? ` · ${item.onHand} ${units(item.onHand, item.unit)}` : ""}${item?.locationId ? ` · ${list.paths.get(item.locationId) ?? ""}` : ""}</span></span>
      ${pending ? html`<span class="muted">Just added</span>` : html`<a class="text-link" href="/staff/items?item=${match.id}" target="_blank" rel="noopener">Open<span class="visually-hidden"> ${item?.name ?? match.id} (opens in a new tab)</span></a>`}</li>`;
  })}`;

  const drawMatches = () => {
    const host = $("#cat-dup");
    if (!matches.length) { mount(host, html``); return; }
    mount(host, html`<div class="callout cat-dup__card ${armed ? "is-armed" : ""}" role="group" aria-label="Possible matches">${icon("info")}<div>
      <p><strong>${matches.some((match) => match.strong) ? "This may already be in the catalog." : "This may be one you already have."}</strong> ${armed ? "If this is a different one, press Save again." : "Check before you save. Two of the same thing are fine."}</p>
      <ul class="cat-dup__list">${matchRows()}</ul></div></div>`);
  };

  const chip = (text: string, attribute: string, suggested = false) => html`<button type="button" class="cat-chip ${suggested ? "is-suggested" : ""}" ${attribute}>${text}${suggested ? html`<span class="visually-hidden"> (suggested)</span>` : ""}</button>`;

  let suggestions = suggest("", [], []);
  const draw = () => {
    const name = value("cat-name");
    const items = everything();
    suggestions = suggest(name, items, recent());
    // Possible matches, judged as the person types, against what is already known (and what was just added).
    matches = name || value("cat-serial") ? possibleDuplicates({ name, category: value("cat-category"), model: value("cat-model"), serialNumber: value("cat-serial"), photoHash: photo?.hash ?? null }, items as DuplicateKnown[]) : [];
    if (!matches.length) armed = false;
    drawMatches();
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-behaviour]")) {
      const mine = button.dataset.behaviour as Behaviour;
      button.setAttribute("aria-pressed", String(behaviour === mine));
      const suggested = suggestions.behaviour?.value === mine && behaviour !== mine;
      button.classList.toggle("is-suggested", suggested);
      button.querySelector<HTMLElement>(".cat-choice__suggest")!.hidden = !suggested;
    }
    const lines = [suggestions.behaviour, suggestions.category, suggestions.unit].filter(Boolean);
    const pending = [suggestions.behaviour && behaviour === null, suggestions.category && !value("cat-category"), suggestions.unit && !value("cat-unit")].filter(Boolean).length;
    mount($("#cat-why"), lines.length && pending ? html`<span>${icon("info")}Suggested: ${[suggestions.behaviour && BEHAVIOUR_LABELS[suggestions.behaviour.value], suggestions.category && categoryName(suggestions.category.value), suggestions.unit?.value].filter(Boolean).join(" · ")}. ${lines[0]!.why}.</span> <button type="button" class="text-link" id="cat-use-all">Use these</button>` : html``);
    const categories = [...new Set([suggestions.category?.value, ...recent().map((item) => item.category), ...(inventory?.categories ?? [])].filter((entry): entry is string => Boolean(entry) && entry !== UNSORTED_CATEGORY))];
    mount($("#cat-category-chips"), html`${categories.slice(0, 5).map((category) => chip(categoryName(category), `data-category="${category}"`, category === suggestions.category?.value))}`);
    const common = [suggestions.unit?.value, ...recent().map((item) => item.unit), ...(inventory?.units ?? [])].filter((entry): entry is string => Boolean(entry));
    mount($("#cat-unit-chips"), html`${[...new Set(common)].slice(0, 5).map((unit) => chip(unit, `data-unit="${unit}"`, unit === suggestions.unit?.value))}`);
    mount($("#cat-categories"), html`${(inventory?.categories ?? []).map((category) => html`<option value="${category}">`)}`);
    mount($("#cat-units"), html`${(inventory?.units ?? []).map((unit) => html`<option value="${unit}">`)}`);
    const later = behaviour === "REVIEW_LATER";
    root.querySelectorAll<HTMLElement>("[data-optional]").forEach((element) => { element.hidden = !later; });
    $("#cat-save").firstChild!.textContent = matches.length && armed ? "Save as a separate item " : "Save & next ";
  };

  let drawTimer = 0;
  const later = () => { window.clearTimeout(drawTimer); drawTimer = window.setTimeout(draw, 70); };
  onLeave(() => window.clearTimeout(drawTimer));
  form.addEventListener("input", () => { armed = false; later(); });

  const choose = (next: Behaviour) => { behaviour = next; armed = false; setMessage($("#cat-alert"), ""); $("#cat-behaviour").removeAttribute("aria-invalid"); draw(); };
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>("[data-behaviour], [data-category], [data-unit], [data-step], #cat-use-all");
    if (!button) return;
    if (button.dataset.behaviour) choose(button.dataset.behaviour as Behaviour);
    else if (button.dataset.category) { field("cat-category").value = button.dataset.category; armed = false; draw(); }
    else if (button.dataset.unit) { field("cat-unit").value = button.dataset.unit; armed = false; draw(); }
    else if (button.dataset.step) {
      const quantity = field("cat-qty");
      quantity.value = String(Math.min(100_000, Math.max(0, (Number(quantity.value) || 0) + Number(button.dataset.step))));
    } else if (button.id === "cat-use-all") {
      if (suggestions.behaviour) behaviour = suggestions.behaviour.value;
      if (suggestions.category && !value("cat-category")) field("cat-category").value = suggestions.category.value;
      if (suggestions.unit && !value("cat-unit")) field("cat-unit").value = suggestions.unit.value;
      if (suggestions.stockArea) $<HTMLSelectElement>("#cat-stock").value = suggestions.stockArea.value;
      armed = false;
      draw();
      field("cat-qty").focus();
    }
  });

  /* ---------- Photo ---------- */

  const drawPhoto = () => {
    const tile = $("#cat-photo");
    tile.classList.toggle("has-photo", Boolean(photo) || preparing);
    mount(tile, preparing ? html`<span class="cat-photo__empty" role="status">Preparing…</span>`
      : photo ? html`<img src="${photo.preview}" alt="Photo to save with this item" /><span class="cat-photo__retake">${icon("camera")}Retake</span>`
      : html`<span class="cat-photo__empty">${icon("camera")}<span>Photo</span></span>`);
    tile.setAttribute("aria-label", photo ? "Retake the photo" : "Take a photo");
  };
  const file = field("cat-file");
  $("#cat-photo").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    preparing = true;
    drawPhoto();
    try { photo = await preparePhoto(chosen); setMessage($("#cat-alert"), ""); } catch (error) { setMessage($("#cat-alert"), error instanceof Error ? error.message : "This photo could not be used."); }
    preparing = false;
    armed = false;
    drawPhoto();
    draw();
    field("cat-name").focus();
  });

  /* ---------- Saving ---------- */

  const invalid = (id: string, message: string) => {
    const element = id === "cat-behaviour" ? $("#cat-behaviour") : field(id);
    element.setAttribute("aria-invalid", "true");
    setMessage($("#cat-alert"), message);
    (id === "cat-behaviour" ? root.querySelector<HTMLElement>("[data-behaviour]")! : element).focus();
    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  /** Empties the form for the next item; "like this" keeps what a second one of the same would share. */
  const clear = (keep: boolean) => {
    const kept = keep ? { name: value("cat-name"), category: value("cat-category"), unit: value("cat-unit"), model: value("cat-model"), stock: $<HTMLSelectElement>("#cat-stock").value } : null;
    form.reset();
    photo = null;
    armed = false;
    if (kept) {
      field("cat-name").value = kept.name;
      field("cat-category").value = kept.category;
      field("cat-unit").value = kept.unit;
      field("cat-model").value = kept.model;
      $<HTMLSelectElement>("#cat-stock").value = kept.stock;
    } else behaviour = null;
    $("#cat-more").removeAttribute("open");
    form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid"));
    setMessage($("#cat-alert"), "");
    drawPhoto();
    draw();
    field("cat-name").focus();
    if (keep) field("cat-name").select();
  };

  const submit = async (like: boolean) => {
    form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid"));
    const name = value("cat-name");
    const quantity = field("cat-qty").value === "" ? NaN : Number(field("cat-qty").value);
    if (!name) return invalid("cat-name", "Give it a name, even a temporary one.");
    if (!behaviour) return invalid("cat-behaviour", "Choose how it is used, or Not sure to decide later.");
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100_000) return invalid("cat-qty", "How many must be a whole number from 0 to 100000.");
    if (behaviour !== "REVIEW_LATER") {
      if (!value("cat-category")) return invalid("cat-category", "Choose a category, or Not sure to decide later.");
      if (!value("cat-unit")) return invalid("cat-unit", "Say what it is counted in, such as piece, box or ream.");
    }
    if (!placeId) return invalid("cat-name", "Choose the place you are cataloguing.");
    draw();
    // The possible matches are shown first; the next press says "a different one".
    if (matches.length && !armed) {
      armed = true;
      draw();
      $("#cat-dup").scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      $("#cat-save").focus();
      return;
    }
    const id = crypto.randomUUID();
    const body: Record<string, unknown> = {
      id, behaviour, name, aliases: value("cat-aliases"), category: value("cat-category"), unit: value("cat-unit"), quantity, locationId: placeId,
      stockArea: $<HTMLSelectElement>("#cat-stock").value, model: value("cat-model"), serialNumber: value("cat-serial"), notes: value("cat-notes"),
      photoHash: photo?.hash ?? "", acknowledged: matches.filter((match) => !match.id.startsWith("pending:")).map((match) => match.id)
    };
    const entry: Entry = {
      id, sessionId, body, photo: photo ? { display: photo.display, thumb: photo.thumb, hash: photo.hash } : null, itemId: null, state: "waiting", message: null, matches: null,
      at: new Date().toISOString(), after: matches.filter((match) => match.id.startsWith("pending:")).map((match) => match.id.slice(8))
    };
    if (photo) thumbs.set(id, photo.preview);
    // On the device before anything is sent: from here a dropped connection or a reload cannot lose it.
    await keep(entry);
    waiting = await entries().then((all) => all.filter((each) => each.sessionId === sessionId));
    clear(like);
    announce(`Saving ${name}.`);
    void pump();
    drawList();
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); void submit(false); });
  $("#cat-like").addEventListener("click", () => { void submit(true); });

  const announce = (text: string) => { $("#cat-announce").textContent = text; };

  /* ---------- Sending ---------- */

  let pumping = false;
  const retryAt = new Map<string, number>();
  const attempts = new Map<string, number>();
  let retryTimer = 0;
  onLeave(() => window.clearTimeout(retryTimer));

  const settle = async (entry: Entry, change: Partial<Entry>) => { Object.assign(entry, change); await keep(entry); };

  /** The ids of the earlier captures this one was told about, now that they have items of their own. */
  const acknowledged = (entry: Entry): string[] => {
    const own = (entry.body.acknowledged as string[]) ?? [];
    const earlier = (entry.after ?? []).map((request) => created.get(request) ?? waiting.find((other) => other.id === request)?.itemId).filter((id): id is string => Boolean(id));
    return [...new Set([...own, ...earlier])];
  };

  async function send(entry: Entry): Promise<void> {
    if (!entry.itemId) {
      try {
        const saved = await api<{ id: string }>(`/api/staff/catalogue/sessions/${sessionId}/captures`, { method: "POST", body: JSON.stringify({ ...entry.body, acknowledged: acknowledged(entry) }) });
        created.set(entry.id, saved.id);
        await settle(entry, { itemId: saved.id, state: "waiting", message: null, matches: null });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 401) { expired(); return; }
        if (error.status === 0 || error.status >= 500 || error.status === 429) {
          const tries = attempts.get(entry.id) ?? 0;
          attempts.set(entry.id, tries + 1);
          retryAt.set(entry.id, Date.now() + Math.min(30_000, 2_000 * 2 ** tries));
          await settle(entry, { state: "waiting", message: error.status === 0 ? "Not saved yet. It will be sent when the connection is back." : "Not saved yet. The server is busy; trying again." });
        } else {
          const found = error.status === 409 && Array.isArray(error.body.duplicates) ? error.body.duplicates as Match[] : null;
          await settle(entry, { state: "stopped", message: found ? "This may already be in the catalog." : error.message, matches: found });
        }
        return;
      }
    }
    if (entry.photo && entry.itemId) {
      const form = new FormData();
      form.set("display", entry.photo.display, "display.jpg");
      form.set("thumb", entry.photo.thumb, "thumb.jpg");
      form.set("expected", "");
      form.set("hash", entry.photo.hash);
      try {
        await api(`/api/staff/items/${entry.itemId}/photo`, { method: "PUT", body: form });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 401) { expired(); return; }
        if (error.status === 409) {
          // A repeat of an upload whose answer was lost finds the photo already there.
          const there = await api<{ item: { photo: unknown } }>(`/api/staff/items/${entry.itemId}`).then((answer) => Boolean(answer.item.photo), () => false);
          if (!there) { await settle(entry, { state: "stopped", message: `Saved, but the photo was not: ${error.message}` }); return; }
        } else if (error.status === 0 || error.status >= 500 || error.status === 429) {
          retryAt.set(entry.id, Date.now() + 4_000);
          await settle(entry, { state: "waiting", message: "Saved. The photo has not gone up yet; trying again." });
          return;
        } else {
          await settle(entry, { state: "stopped", message: `Saved, but the photo was not: ${error.message}` });
          return;
        }
      }
    }
    await drop(entry.id);
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        waiting = (await entries()).filter((entry) => entry.sessionId === sessionId);
        const next = waiting.find((entry) => entry.state === "waiting" && (retryAt.get(entry.id) ?? 0) <= Date.now());
        if (!next) break;
        retryAt.delete(next.id);
        await send(next);
        drawList();
      }
    } finally {
      pumping = false;
      waiting = (await entries()).filter((entry) => entry.sessionId === sessionId);
      const soon = Math.min(...waiting.filter((entry) => entry.state === "waiting").map((entry) => retryAt.get(entry.id) ?? Date.now() + 2_000));
      window.clearTimeout(retryTimer);
      if (Number.isFinite(soon)) retryTimer = window.setTimeout(() => void pump(), Math.max(500, soon - Date.now()));
      await reload();
      drawList();
    }
  }

  /** The server's own view of the session: what is saved, and how many. */
  async function reload(): Promise<void> {
    try { detail = await api<Detail>(`/api/staff/catalogue/sessions/${sessionId}`); } catch (error) { if (error instanceof ApiError && error.status === 401) expired(); }
  }

  const resume = () => { retryAt.clear(); void pump(); };
  window.addEventListener("online", resume);
  const visible = () => { if (document.visibilityState === "visible") resume(); };
  document.addEventListener("visibilitychange", visible);
  const leaving = (event: BeforeUnloadEvent) => { if (waiting.length && !durable()) { event.preventDefault(); event.returnValue = ""; } };
  window.addEventListener("beforeunload", leaving);
  onLeave(() => { window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", visible); window.removeEventListener("beforeunload", leaving); });

  /* ---------- Just added ---------- */

  const stateOf = (entry: Entry): Html => {
    if (entry.state === "stopped") return html`<span class="tag tag--bad">Needs you</span>`;
    if (!entry.itemId) return entry.message ? html`<span class="tag tag--warn">Not saved yet</span>` : html`<span class="tag tag--pending">Saving…</span>`;
    return entry.message ? html`<span class="tag tag--warn">Saved, photo to send</span>` : html`<span class="tag tag--pending">Sending photo…</span>`;
  };

  const thumbFor = (entry: Entry): Html => {
    const cached = thumbs.get(entry.id);
    if (cached) return html`<img class="cat-row__thumb" src="${cached}" alt="" width="44" height="44" />`;
    if (entry.photo) void dataUrl(entry.photo.thumb).then((url) => { thumbs.set(entry.id, url); drawList(); });
    return html`<span class="cat-row__thumb cat-row__thumb--none">${icon("box")}</span>`;
  };

  const queuedRow = (entry: Entry): Html => {
    const body = entry.body;
    const stopped = entry.state === "stopped";
    const open = (entry.matches ?? []).map((match) => html`<li>${match.reason}: <a class="text-link" href="/staff/items?item=${match.id}" target="_blank" rel="noopener">${match.id}<span class="visually-hidden"> (opens in a new tab)</span></a></li>`);
    return html`<li class="cat-row ${stopped ? "is-stopped" : ""}" data-key="${entry.id}">
      ${thumbFor(entry)}
      <span class="cat-row__text"><strong>${String(body.name)}</strong><span>${BEHAVIOUR_LABELS[body.behaviour as Behaviour]} · ${Number(body.quantity)} ${units(Number(body.quantity), String(body.unit || "piece"))}</span>
        ${entry.message ? html`<span class="cat-row__note ${stopped ? "is-bad" : ""}">${entry.message}</span>` : ""}
        ${open.length ? html`<ul class="cat-row__matches">${open}</ul>` : ""}
        ${stopped ? html`<span class="cat-row__actions">${entry.matches ? html`<button type="button" class="button button--secondary button--sm" data-separate="${entry.id}">Save as a separate item</button>` : ""}${entry.itemId ? "" : html`<button type="button" class="button button--secondary button--sm" data-edit="${entry.id}">Edit</button>`}<button type="button" class="button button--ghost button--sm" data-discard="${entry.id}">${entry.itemId ? "Keep without photo" : "Discard"}</button></span>` : ""}</span>
      <span class="cat-row__state">${stateOf(entry)}</span></li>`;
  };

  const savedRow = (row: Recent): Html => html`<li class="cat-row" data-key="${row.captureId}">
    ${row.photoId ? html`<img class="cat-row__thumb" src="${photoUrl(row.photoId, "thumb")}" alt="" width="44" height="44" loading="lazy" decoding="async" />` : html`<span class="cat-row__thumb cat-row__thumb--none">${icon("box")}</span>`}
    <span class="cat-row__text"><strong>${row.name}</strong><span>${BEHAVIOUR_LABELS[row.behaviour]} · ${row.onHand} ${units(row.onHand, row.unit)}${row.place ? ` · ${row.place.split(" › ").pop()}` : ""}</span></span>
    <span class="cat-row__state">${row.behaviour === "REVIEW_LATER" ? html`<span class="tag tag--pending">Review later</span>` : html`<span class="tag tag--ok">Saved</span>`}
      <a class="icon-button" href="/staff/items?item=${row.itemId}" target="_blank" rel="noopener" aria-label="Open ${row.name} (opens in a new tab)">${icon("external")}</a></span></li>`;

  function drawList(): void {
    const queued = [...waiting].reverse();
    const sent = detail.recent.filter((row) => !waiting.some((entry) => entry.id === row.captureId));
    const holding = waiting.length;
    $("#cat-count").textContent = plural(detail.session.saved + waiting.filter((entry) => !entry.itemId).length, "item");
    const stopped = waiting.some((entry) => entry.state === "stopped");
    const offline = waiting.some((entry) => entry.state === "waiting" && entry.message);
    sync.dataset.state = offline || stopped ? "offline" : "live";
    sync.textContent = stopped ? "Needs you" : offline ? `${holding} waiting to send` : holding ? "Saving…" : "All saved";
    preservingFocus($("#cat-list"), () => mount($("#cat-list"), queued.length || sent.length
      ? html`${!durable() && holding ? html`<p class="callout">${icon("alert")}<span>This browser cannot keep unsent items if the page closes. Stay on this page until they are saved.</span></p>` : ""}<ul class="cat-rows">${queued.map(queuedRow)}${sent.map(savedRow)}</ul>
        ${detail.session.saved > sent.length ? html`<p class="muted">Showing the newest ${sent.length}. The others are saved; find them under Items.</p>` : ""}`
      : html`<p class="muted">Nothing yet. The first item you save appears here.</p>`));
  }

  $("#cat-list").addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const act = target.closest<HTMLElement>("[data-separate], [data-edit], [data-discard]");
    if (!act) return;
    const entry = waiting.find((each) => each.id === (act.dataset.separate ?? act.dataset.edit ?? act.dataset.discard));
    if (!entry) return;
    if (act.dataset.separate) {
      await settle(entry, { state: "waiting", message: null, body: { ...entry.body, acknowledged: (entry.matches ?? []).map((match) => match.id) }, matches: null });
      void pump();
    } else if (act.dataset.edit) {
      const body = entry.body;
      field("cat-name").value = String(body.name);
      behaviour = body.behaviour as Behaviour;
      field("cat-qty").value = String(body.quantity);
      field("cat-category").value = String(body.category ?? "");
      field("cat-unit").value = String(body.unit ?? "");
      field("cat-model").value = String(body.model ?? "");
      field("cat-serial").value = String(body.serialNumber ?? "");
      field("cat-aliases").value = String(body.aliases ?? "");
      field("cat-notes").value = String(body.notes ?? "");
      $<HTMLSelectElement>("#cat-stock").value = String(body.stockArea ?? "Inventory");
      photo = entry.photo ? { ...entry.photo, preview: thumbs.get(entry.id) ?? "" } : null;
      if (photo && !photo.preview) photo.preview = await dataUrl(photo.display);
      await drop(entry.id);
      waiting = waiting.filter((each) => each.id !== entry.id);
      drawPhoto();
      draw();
      drawList();
      field("cat-name").focus();
    } else if (window.confirm(entry.itemId ? "Keep this item without its photo?" : `Discard ${String(entry.body.name)}? It has not been saved.`)) {
      await drop(entry.id);
      waiting = waiting.filter((each) => each.id !== entry.id);
      drawList();
    }
  });

  /* ---------- Keys ---------- */

  const onKey = (event: KeyboardEvent) => {
    if (document.querySelector("dialog[open]")) return;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit(false); return; }
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && target instanceof HTMLInputElement && form.contains(target) && !event.isComposing) {
      // Enter moves on rather than saving: saving is a deliberate press.
      event.preventDefault();
      const next = ORDER[ORDER.indexOf(target.id) + 1];
      if (target.id === "cat-name" && !behaviour) root.querySelector<HTMLElement>(".cat-choice.is-suggested, .cat-choice")!.focus();
      else if (next) field(next).focus();
      else $("#cat-save").focus();
      return;
    }
    if (target.closest(TYPING) || event.metaKey || event.ctrlKey || event.altKey) return;
    const digit = Number(event.key);
    if (digit >= 1 && digit <= BEHAVIOURS.length) { event.preventDefault(); choose(BEHAVIOURS[digit - 1]!); }
    else if (event.key.toLowerCase() === "p") { event.preventDefault(); file.click(); }
  };
  document.addEventListener("keydown", onKey);
  onLeave(() => document.removeEventListener("keydown", onKey));

  /* ---------- Finishing ---------- */

  $("#cat-finish").addEventListener("click", async () => {
    await pump();
    if (waiting.length) { toast(`${plural(waiting.length, "item")} here ${waiting.length === 1 ? "is" : "are"} not saved yet. Wait for ${waiting.length === 1 ? "it" : "them"}, or resolve ${waiting.length === 1 ? "it" : "them"} first.`, "error"); drawList(); return; }
    if (!window.confirm(`Finish cataloguing? ${plural(detail.session.saved, "item")} saved.`)) return;
    try {
      await api(`/api/staff/catalogue/sessions/${sessionId}/finish`, { method: "POST" });
      // The address does not change, so the page is drawn again rather than navigated to.
      leave();
      await captureScreen(session, sessionId);
    } catch (error) {
      toast(failure(error), "error");
    }
  });

  /* ---------- Data ---------- */

  const poll = live<Inventory>("/api/staff/inventory", {
    interval: 30_000,
    status: () => null,
    onData: (data) => {
      inventory = data;
      list = placeList(data.locations);
      if (!placeId || !list.places.get(placeId)?.active) placeId = detail.session.locationId && list.places.get(detail.session.locationId)?.active ? detail.session.locationId : null;
      const selected = $<HTMLSelectElement>("#cat-place-select");
      showPlace();
      if (placeId) selected.value = placeId;
      refreshParents(panel, list, placeId);
      draw();
    },
    onError: (error) => { if (error.status === 401) expired(); }
  });

  drawPhoto();
  showPlace();
  waiting = (await entries()).filter((entry) => entry.sessionId === sessionId);
  for (const entry of waiting) if (entry.itemId) created.set(entry.id, entry.itemId);
  draw();
  drawList();
  field("cat-name").focus();
  void pump();
}

