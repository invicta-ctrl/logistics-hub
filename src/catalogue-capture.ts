import type { Who } from "./catalogue-offline";
import { type DraftFieldName, type PhotoOutcome, composeDraft, needsAttention } from "./catalog-draft";
import type { ReviewOffer } from "./ai-review-types";
import { suggest, verified } from "./catalogue-suggest";
import { type Detail, type Entry, type SessionRecord, type Snapshot, type SnapshotItem, drop, dropSession, durable, entries, keep, keepSession, sessions, setAccess, setSnapshot, snapshot } from "./catalogue-store";
import { type PlaceList, bindNewPlace, newPlaceForm, placeList, placeOptions, refreshParents } from "./catalogue-places";
import { onSyncChange, savedItem, signedOut, syncNow } from "./catalogue-sync";
import { formatItemName, BEHAVIOURS, BEHAVIOUR_LABELS, type Behaviour, UNSORTED_CATEGORY } from "./catalog-policy";
import { type Known as DuplicateKnown, type Match, possibleDuplicates } from "./duplicates";
import { cropEditor, preparePhoto, photoUrl, type Prepared } from "./item-photo";
import { whenIdle } from "./pwa";
import { catalogueShell } from "./catalogue-shell";
import { ApiError, type Html, api, categoryName, dataUrl, emptyState, failure, html, icon, leave, live, mount, navigate, onLeave, plural, preservingFocus, setMessage, toast, units } from "./ui";

/*
 * The capture screen of a cataloguing session (/staff/catalogue?session=…): one form, kept on screen, that turns a thing on a shelf
 * into a saved record in a few taps, then clears for the next. Saving never waits: the form is cleared at once and the record is kept
 * on this device (catalogue-store.ts) and sent from there (catalogue-sync.ts), shown below with its state until the server has
 * everything. With offline cataloguing on (V1.6) it works the same without a connection, against the catalog this device saved.
 */

type Signed = Exclude<Who, { mode: "closed" } | { mode: "signed-out" }>;
type Item = SnapshotItem & { photoId?: string | null };

const HINTS: Record<Behaviour, string> = { BORROW: "Lent out and brought back", CONSUME: "Taken and used up", GRADUAL: "Opened, used a little at a time", REVIEW_LATER: "Keep it counted, decide later" };
const ORDER = ["cat-name", "cat-qty", "cat-category", "cat-unit"];

/** What a queued capture looks like to the lists and rules that read items. */
function known(entry: Entry): Item {
  const body = entry.body;
  const text = (key: string) => (typeof body[key] === "string" && body[key] ? body[key] as string : null);
  const behaviour = body.behaviour as Behaviour;
  return {
    id: entry.itemId ?? `pending:${entry.id}`, name: String(body.name), aliases: text("aliases"), category: text("category") ?? UNSORTED_CATEGORY, unit: text("unit") ?? "piece",
    itemType: behaviour === "BORROW" ? "Loanable" : behaviour === "REVIEW_LATER" ? "NEEDS_REVIEW" : "Consumable", consumptionMode: behaviour === "GRADUAL" ? "OPEN_UNIT" : "WHOLE_UNIT",
    stockArea: text("stockArea"), status: "ACTIVE", needsReview: true, model: text("model"), serialNumber: text("serialNumber"), photoHash: entry.photo?.hash ?? null,
    locationId: text("locationId"), onHand: Number(body.quantity)
  };
}

/** How many of each kind a list of captures holds, as the server counts a session. */
const countsOf = (list: Entry[]) => list.reduce<Record<string, number>>((out, entry) => ({ ...out, [String(entry.body.behaviour)]: (out[String(entry.body.behaviour)] ?? 0) + 1 }), {});

export async function captureScreen(who: Signed, sessionId: string): Promise<void> {
  const session = who.session;
  /** Whether the server can be reached: opened offline, it follows the connection from then on. */
  let online = who.mode !== "offline";
  document.title = "Cataloguing · Catalog";
  catalogueShell(who, html`<div class="cat" id="cat"><div class="skeleton skeleton--block"></div></div>`);
  const root = document.querySelector<HTMLElement>("#cat")!;
  const { finishedView, signInHere } = await import("./catalogue-workspace");

  // What the server says about the session where it can be asked; otherwise what this device knows of it.
  let record: SessionRecord | null = (await sessions()).find((each) => each.id === sessionId) ?? null;
  let detail: Detail;
  try {
    if (record && (!online || !record.serverId)) detail = record.detail;
    else detail = await api<Detail>(`/api/staff/catalogue/sessions/${encodeURIComponent(record?.serverId ?? sessionId)}`);
  } catch (error) {
    if (!(record && error instanceof ApiError && error.status === 0)) {
      mount(root, emptyState("This cataloguing session could not be opened", record || online ? failure(error) : "It isn't saved on this device, so it opens only with a connection.", html`<a class="button button--secondary" href="/staff/catalogue" data-route>Back to Add items</a>`, "error", 1));
      return;
    }
    detail = record.detail;
  }
  const here = async () => (await entries()).filter((entry) => entry.sessionId === sessionId);
  if (record?.finishing) {
    const left = await here();
    finishedView(root, { ...detail, session: { ...detail.session, status: "FINISHED" }, counts: Object.entries(countsOf(left)).reduce((out, [key, n]) => ({ ...out, [key]: (out[key] ?? 0) + n }), { ...detail.counts }) }, left.length, false);
    return;
  }
  if (detail.session.status !== "ACTIVE" || !detail.session.mine) {
    // Finished on another device: no longer this device's open session. Anything still here goes to a new one (catalogue-sync.ts).
    if (record && detail.session.mine) await ((await here()).length ? keepSession({ ...record, detail }) : dropSession(record.id));
    finishedView(root, detail, 0, who.mode === "signed-in");
    return;
  }
  // This device keeps the open session, so it reopens here without a connection; a start sent from here keeps the server's answer.
  record = { id: sessionId, owner: session.id, finishing: false, ...record, serverId: record?.serverId ?? (online ? detail.session.id : null), detail };
  await keepSession(record);
  /** This session as the device holds it now: sending updates it (the server's id) while this page is open. */
  const stored = async () => (await sessions()).find((each) => each.id === sessionId) ?? null;

  let catalog: Snapshot | null = await snapshot();
  let list: PlaceList = placeList(catalog?.places ?? []);
  let placeId = detail.session.locationId;
  let waiting: Entry[] = [];
  /** Everything this page has captured, as the lists and rules read items, until the saved catalog catches up with it. */
  const local = new Map<string, Item>();
  let photo: Prepared | null = null;
  let originalPhoto: Prepared | null = null;
  let draftId = crypto.randomUUID();
  let draftRevision = 0;
  let reviewOffer: ReviewOffer | null = null;
  let reviewDecision: { decision: "KEEP" | "REJECT" | "CORRECT"; correction?: string } | null = null;
  let requestingReview = false;
  let reviewTimer: ReturnType<typeof setTimeout> | undefined;
  let wantedReview: { id: string; revision: number; name: string } | null = null;
  let behaviour: Behaviour | null = null;
  /** True once Save has shown the possible matches: the next Save is the person saying "a different one". */
  let armed = false;
  let preparing = false;
  /*
   * Photo suggestions (ambient assist): online, a new photo is named by the server's model. The name fills an empty name field for the
   * person to check, and is compared with the catalog by the same duplicate rule as typed names. A photo that could not be checked
   * (offline, or the check failed) is marked on its capture, and the server checks it once after it syncs.
   */
  let photoName: string | null = null;
  let photoChecked = false;
  let photoOutcome: PhotoOutcome | "CHECKING" | null = null;
  let nameFromPhoto = false;
  /** Each retake and form reset invalidates both in-flight preparation and model responses. */
  let photoRevision = 0;
  /** A typed empty name is still an explicit staff choice until this capture is reset. */
  let nameEdited = false;
  /** The same ownership rule for the Model field: a keystroke makes it the person's, and a retake or reset takes back only what the photo wrote. */
  let modelEdited = false;
  /** The count is the person's once they change it; the starting 1 is only a default (amendment §4). */
  let quantityEdited = false;
  let modelFromPhoto = false;
  onLeave(() => { photoRevision += 1; });
  const thumbs = new Map<string, string>();
  const canAddPlace = who.mode === "signed-in";

  mount(root, html`
    <h1 class="visually-hidden">Cataloguing</h1>
    <p class="visually-hidden" id="cat-announce" role="status"></p>
    <input class="visually-hidden" type="file" id="cat-file" accept="image/jpeg,image/png,image/webp" capture="environment" tabindex="-1" aria-label="Take a photo" />
    <input class="visually-hidden" type="file" id="cat-library" accept="image/jpeg,image/png,image/webp" tabindex="-1" aria-label="Choose a photo or image file" />
    <header class="cat-bar">
      <a class="button button--ghost button--sm" href="/staff/catalogue" data-route>${icon("back")}Add items</a>
      <div class="cat-bar__place"><span class="cat-bar__label">Cataloguing in</span>
        <button type="button" class="cat-place" id="cat-place" aria-expanded="false" aria-controls="cat-place-panel">${icon("pin")}<span id="cat-place-name"></span><span class="cat-place__change">Change</span></button></div>
      <p class="cat-bar__count"><strong id="cat-count"></strong> <span id="cat-sync" class="live-status" data-state="live"></span> <button type="button" class="text-link cat-see" id="cat-see" hidden>See</button></p>
      <button type="button" class="button button--secondary button--sm" id="cat-finish">Finish</button>
    </header>
    <p class="cat-ready cat-offline" id="cat-offline" role="status" ${online ? html`hidden` : ""}>${icon("cloudOff")}<span><strong>Offline.</strong> Keep going: what you save stays on this device and is sent when you're back online.</span></p>
    <div class="cat-place-panel" id="cat-place-panel" hidden>
      <div class="field"><label for="cat-place-select">Next items are in</label><select id="cat-place-select"></select></div>
      ${canAddPlace ? html`<p><button type="button" class="text-link" data-new-place-toggle aria-expanded="false" aria-controls="cat-new-place">${icon("plus")} New place</button></p>
        <div id="cat-new-place"></div>` : html`<p class="field__hint">Adding a new place needs a connection and a sign-in.</p>`}
    </div>
    <div class="cat-layout">
      <form class="cat-form" id="cat-form" novalidate aria-label="Add an item">
        <div class="cat-top">
          <div class="cat-photo-wrap"><button type="button" class="cat-photo" id="cat-photo" aria-label="Choose photo or file"><span class="cat-photo__empty">${icon("camera")}<span>Choose photo</span></span></button><button type="button" class="button button--ghost button--sm cat-photo__choose" id="cat-camera-button">Take photo</button><button type="button" class="button button--ghost button--sm" id="cat-crop-button" hidden>Crop thumbnail</button></div>
          <div class="field cat-name"><label for="cat-name">Name</label><input id="cat-name" maxlength="120" autocomplete="off" autocapitalize="words" autocorrect="on" spellcheck="true" enterkeyhint="next" placeholder="What is it?" aria-describedby="cat-name-hint" /><p class="visually-hidden" id="cat-name-hint">A temporary name is fine if you are not sure.</p></div>
        </div>
        <div id="cat-crop" hidden></div>
        <div id="cat-photo-status" class="field__hint" role="status" hidden></div>
        <div id="cat-cleanup" class="field__hint" hidden><span id="cat-cleanup-hint" role="status"></span> <button type="button" class="text-link" id="cat-enable-cleanup" hidden>Enable background removal</button></div>
        <section class="cat-ai" aria-label="AI suggestions" hidden><div id="cat-ai" aria-live="polite"></div></section>
        <div class="cat-dup" id="cat-dup" aria-live="polite"></div>
        <fieldset class="cat-behaviour" id="cat-behaviour"><legend>How is it used?</legend>
          <div class="cat-choices">${BEHAVIOURS.map((value, index) => html`<button type="button" class="cat-choice" data-behaviour="${value}" aria-pressed="false" aria-keyshortcuts="Alt+${index + 1}"><span class="cat-choice__title">${BEHAVIOUR_LABELS[value]}</span><span class="cat-choice__hint visually-hidden">${HINTS[value]}</span><span class="cat-choice__suggest" hidden>Suggested</span></button>`)}</div>
          <p class="cat-suggest" id="cat-why" aria-live="polite"></p>
        </fieldset>
        <div class="cat-qty field"><label for="cat-qty">How many are here?</label>
          <div class="stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="One fewer">${icon("minus")}</button><input id="cat-qty" type="number" inputmode="numeric" min="0" max="100000" step="1" value="1" /><button type="button" class="stepper__button" data-step="1" aria-label="One more">${icon("plus")}</button></div></div>
        <p class="cat-suggest" id="cat-draft" role="status"></p>
        <div class="field-grid">
          <div class="field"><label for="cat-category">Category <span class="field__optional" data-optional hidden>optional for now</span></label><input id="cat-category" list="cat-categories" maxlength="100" autocomplete="off" /><datalist id="cat-categories"></datalist><div class="cat-chips" id="cat-category-chips"></div></div>
          <div class="field"><label for="cat-unit">Counted in <span class="field__optional" data-optional hidden>optional for now</span></label><input id="cat-unit" list="cat-units" maxlength="30" autocomplete="off" placeholder="piece, box, ream" /><datalist id="cat-units"></datalist><div class="cat-chips" id="cat-unit-chips"></div></div>
        </div>
        <details class="cat-more" id="cat-more"><summary>Advanced details</summary>
          <div class="field-grid">
            <div class="field"><label for="cat-model">Model <span class="field__optional">optional</span></label><input id="cat-model" maxlength="80" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-describedby="cat-model-hint" /><p class="cat-name-hint cat-name-hint--photo" id="cat-model-hint" aria-live="polite"></p></div>
            <div class="field"><label for="cat-serial">Serial number <span class="field__optional">optional</span></label><input id="cat-serial" maxlength="80" autocomplete="off" autocapitalize="characters" spellcheck="false" /></div>
          </div>
          <div class="field-grid">
            <div class="field"><label for="cat-stock">Stock area</label><select id="cat-stock"><option value="Inventory">General stock</option><option value="Pantry">Pantry</option></select></div>
            <div class="field"><label for="cat-aliases">Other names <span class="field__optional">optional</span></label><input id="cat-aliases" maxlength="300" autocomplete="off" autocapitalize="words" autocorrect="on" spellcheck="true" /></div>
          </div>
          <div class="field"><label for="cat-notes">Notes <span class="field__optional">optional</span></label><textarea id="cat-notes" rows="2" maxlength="1000" autocapitalize="sentences" autocorrect="on" spellcheck="true"></textarea></div>
        </details>
        <div class="form-alert" id="cat-alert" role="alert" hidden></div>
        <div class="cat-actions">
          <button type="submit" class="button button--primary button--lg" id="cat-save">Save &amp; next ${icon("next")}</button>
          <button type="button" class="button button--secondary" id="cat-save-clean" hidden>Save &amp; remove background</button>
          <button type="button" class="button button--secondary" id="cat-like">Save, then add another like this</button>
        </div>
        <p class="cat-keys visually-hidden" aria-hidden="true"><kbd>Ctrl</kbd> <kbd>Enter</kbd> save · <kbd>Alt</kbd> <kbd>1</kbd>–<kbd>4</kbd> how it is used · <kbd>Alt</kbd> <kbd>P</kbd> photo</p>
      </form>
      <section class="cat-recent" aria-labelledby="cat-recent-title"><h2 id="cat-recent-title">Just added</h2><div id="cat-list"></div></section>
    </div>`);

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const form = $<HTMLFormElement>("#cat-form");
  const field = (id: string) => $<HTMLInputElement>(`#${id}`);
  const value = (id: string) => field(id).value.trim();
  const sync = $("#cat-sync");
  // A new version of the app waits until nothing is being typed here (pwa.ts).
  whenIdle(() => root.isConnected && !value("cat-name") && !photo && !preparing);
  onLeave(() => whenIdle(() => false));

  const invalidateReview = () => {
    clearTimeout(reviewTimer);
    reviewTimer = undefined;
    wantedReview = null;
    draftRevision += 1;
    reviewOffer = null;
    reviewDecision = null;
    mount($("#cat-ai"), html``);
    $(".cat-ai").hidden = true;
  };
  onLeave(invalidateReview);
  // Native fields emit input as they change; their later blur/change must not invalidate a displayed decision.
  form.addEventListener("input", (event) => {
    if ((event.target as HTMLElement).closest(".cat-ai, #cat-crop")) return;
    invalidateReview();
    scheduleReview();
  });
  const drawReview = () => {
    $(".cat-ai").hidden = false;
    const target = $("#cat-ai");
    if (!reviewOffer?.proposal) {
      $(".cat-ai").hidden = reviewOffer?.reason !== "PENDING";
      mount(target, reviewOffer?.reason === "PENDING" ? html`<p role="status">Suggestions are busy. You can keep editing or save.</p>` : html``);
      return;
    }
    const followUp = reviewOffer.proposal.field === "follow_up";
    const followUpLabels: Record<string, string> = { CHECK_NAME: "Check the name", CHECK_CATEGORY: "Check the category", CHECK_COUNTING_UNIT: "Check the counting unit", CHECK_BORROW_OR_TAKE: "Check how it is used", LOOKS_LIKE_EXISTING_ITEM: "Check the possible existing item" };
    const label = followUp ? followUpLabels[reviewOffer.label!] : reviewOffer.label;
    mount(target, html`<p><strong>AI suggestion — check it:</strong> ${label}. ${followUp ? "This is a question for staff, not a classification." : "Keep applies this name. Correct applies the reviewed item's name, category, unit and use."}</p>
      ${reviewDecision ? html`<p role="status">${reviewDecision.decision === "KEEP" ? "Kept" : reviewDecision.decision === "REJECT" ? "Rejected" : "Corrected"}. Save the item when you are ready.</p>` : html`<div class="photo-actions"><button type="button" class="button button--secondary" data-ai-decision="KEEP">Keep</button><button type="button" class="button button--ghost" data-ai-decision="REJECT">Reject</button><button type="button" class="button button--ghost" data-ai-correct>Correct</button></div>
        <div id="cat-ai-correction" hidden><label for="cat-ai-corrected">Correct reviewed item name</label><input id="cat-ai-corrected" maxlength="120" autocomplete="off" /><button type="button" class="button button--secondary" data-ai-apply>Apply correction</button><p role="alert" id="cat-ai-error"></p></div>`}`);
  };
  const canReview = () => root.isConnected && online && who.mode === "signed-in" && Boolean(record?.serverId) && !preparing && (!photo || photoChecked) && Boolean(value("cat-name"));
  /** One request at a time; a newer settled draft replaces the queued one, never the person's fields. */
  const requestReview = async () => {
    if (requestingReview || !wantedReview) return;
    const { id, revision, name } = wantedReview;
    wantedReview = null;
    if (!canReview() || id !== draftId || revision !== draftRevision) return;
    requestingReview = true;
    $(".cat-ai").hidden = false;
    mount($("#cat-ai"), html`<p role="status">Checking a suggestion… You can keep editing or save.</p>`);
    try {
      const offer = await api<ReviewOffer>(`/api/staff/catalogue/sessions/${record!.serverId}/ai-offer`, { method: "POST", body: JSON.stringify({ draftId: id, revision, name }), ...(typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(30_000) } : {}) });
      if (!root.isConnected || revision !== draftRevision || id !== draftId || offer.draftId !== id || offer.revision !== revision || offer.expiresAt <= Date.now()) return;
      reviewOffer = offer;
      reviewDecision = null;
      drawReview();
    } catch { if (root.isConnected && id === draftId && revision === draftRevision) mount($("#cat-ai"), html`<p>AI suggestions are unavailable. You can still save this item.</p>`); }
    finally { requestingReview = false; if (wantedReview) void requestReview(); }
  };
  /** Wait for typing to settle; photo prefill requests immediately. Failures and abstentions never retry themselves. */
  const scheduleReview = (delay = 700) => {
    clearTimeout(reviewTimer);
    reviewTimer = undefined;
    if (!canReview()) return;
    reviewTimer = setTimeout(() => {
      reviewTimer = undefined;
      if (!canReview()) return;
      wantedReview = { id: draftId, revision: draftRevision, name: value("cat-name") };
      void requestReview();
    }, delay);
  };
  $("#cat-ai").addEventListener("click", (event) => {
    if (!reviewOffer?.proposal || reviewOffer.revision !== draftRevision || reviewOffer.expiresAt <= Date.now()) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.hasAttribute("data-ai-correct")) { $("#cat-ai-correction").hidden = false; field("cat-ai-corrected").focus(); return; }
    if (button.hasAttribute("data-ai-apply")) {
      const corrected = value("cat-ai-corrected");
      const target = catalog?.items.filter(verified).find((item) => item.name.toLocaleLowerCase() === corrected.toLocaleLowerCase());
      if (!target) { $("#cat-ai-error").textContent = "Choose the exact name of a reviewed catalogue item, or edit the form manually."; return; }
      field("cat-name").value = target.name;
      field("cat-category").value = target.category;
      field("cat-unit").value = target.unit;
      choose(target.itemType === "Loanable" ? "BORROW" : target.consumptionMode === "OPEN_UNIT" ? "GRADUAL" : "CONSUME");
      reviewDecision = { decision: "CORRECT", correction: target.name };
      nameEdited = true; nameFromPhoto = false;
    } else {
      const decision = button.dataset.aiDecision;
      if (decision !== "KEEP" && decision !== "REJECT") return;
      if (decision === "KEEP" && reviewOffer.proposal.field !== "follow_up" && reviewOffer.label) { field("cat-name").value = reviewOffer.label; nameEdited = true; nameFromPhoto = false; }
      reviewDecision = { decision };
    }
    draw(); drawReview();
  });

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
    invalidateReview();
    placeId = id;
    scheduleReview();
    showPlace();
    panel.hidden = true;
    $("#cat-place").setAttribute("aria-expanded", "false");
    // Where a resumed session opens, here and on the server; every capture also names its own place, so a failure here loses nothing.
    const latest = (await stored()) ?? record!;
    record = { ...latest, detail: { ...latest.detail, session: { ...latest.detail.session, locationId: id, place: list.paths.get(id) ?? null } } };
    await keepSession(record);
    if (online && record.serverId) void api(`/api/staff/catalogue/sessions/${record.serverId}`, { method: "PATCH", body: JSON.stringify({ locationId: id }) }).catch(() => undefined);
    field("cat-name").focus();
  };
  $("#cat-place-select").addEventListener("change", (event) => { void choosePlace((event.target as HTMLSelectElement).value); });
  if (canAddPlace) {
    mount($("#cat-new-place"), newPlaceForm(list, placeId));
    bindNewPlace(panel, async (id) => { await poll?.refresh(); await choosePlace(id); toast("Place added."); });
  }

  /* ---------- The form: suggestions and possible matches ---------- */

  /** Everything known so far: the saved catalog, and what this page and this device have captured since. */
  const everything = (): Item[] => {
    const ours = new Map([...local.values(), ...waiting.map(known)].map((item) => [item.id, item]));
    return [...ours.values(), ...(catalog?.items ?? []).filter((item) => !ours.has(item.id))];
  };

  const recent = (): Item[] => [...waiting].reverse().map(known).concat(detail.recent.filter((row) => !waiting.some((entry) => entry.id === row.captureId)).map((row) => ({
    id: row.itemId, name: row.name, aliases: null, category: row.category, itemType: row.itemType, consumptionMode: row.consumptionMode, unit: row.unit, stockArea: row.stockArea,
    status: "ACTIVE", needsReview: true, model: null, serialNumber: null, photoHash: null, photoId: row.photoId, locationId: null, onHand: row.onHand
  })));

  let matches: Match[] = [];
  const matchRows = (): Html => html`${matches.map((match) => {
    const item = everything().find((entry) => entry.id === match.id);
    const pending = match.id.startsWith("pending:");
    return html`<li class="cat-dup__row"><span class="cat-dup__text"><strong>${item?.name ?? match.id}</strong><span>${match.reason}${item ? ` · ${item.onHand} ${units(item.onHand, item.unit)}` : ""}${item?.locationId ? ` · ${list.paths.get(item.locationId) ?? ""}` : ""}</span></span>
      ${pending ? html`<span class="muted">Just added</span>` : html`<span class="cat-dup__actions"><a class="text-link" href="/staff/items?item=${match.id}" target="_blank" rel="noopener">Open<span class="visually-hidden"> ${item?.name ?? match.id} (opens in a new tab)</span></a><a class="text-link" href="/staff/items?item=${match.id}" target="_blank" rel="noopener" data-use-existing="${item?.name ?? ""}">Use existing<span class="visually-hidden"> ${item?.name ?? match.id} instead of adding this one (opens in a new tab)</span></a></span>`}</li>`;
  })}`;

  const drawMatches = () => {
    const host = $("#cat-dup");
    if (!matches.length) { mount(host, html``); return; }
    mount(host, html`<div class="callout cat-dup__card ${armed ? "is-armed" : ""}" role="group" aria-label="Possible matches">${icon("info")}<div>
      <p><strong>${matches.some((match) => match.strong) ? "This may already be in the catalog." : "This may be one you already have."}</strong> ${armed ? "If this is a different one, press Save again." : "Check before you save. Two of the same thing are fine."}</p>
      <ul class="cat-dup__list">${matchRows()}</ul></div></div>`);
  };

  /** A tappable suggestion: `kind` names the field it fills ("category" or "unit") and `value` is what it puts there, escaped as an attribute value. */
  const chip = (text: string, kind: "category" | "unit", value: string, suggested = false) => html`<button type="button" class="cat-chip ${suggested ? "is-suggested" : ""}" data-fill="${kind}" data-value="${value}">${text}${suggested ? html`<span class="visually-hidden"> (suggested)</span>` : ""}</button>`;

  let suggestions = suggest("", [], []);
  /** Conflicting fields are shown with both options and their reasons, but never filled in by a tap on "Use these" or highlighted as the answer. */
  const settled = <T extends { tier: string }>(hint: T | undefined) => hint && hint.tier !== "CONFLICTING" ? hint : undefined;
  const draw = () => {
    const name = value("cat-name");
    const items = everything();
    const raw = suggest(name, items, recent());
    const conflicting = (["behaviour", "category", "unit"] as const).filter((field) => raw[field]?.tier === "CONFLICTING");
    suggestions = { ...raw, behaviour: settled(raw.behaviour), category: settled(raw.category), unit: settled(raw.unit) };
    // Possible matches, judged as the person types, against what is already known (and what was just added).
    matches = name || value("cat-serial") ? possibleDuplicates({ name, category: value("cat-category"), model: value("cat-model"), serialNumber: value("cat-serial"), photoHash: photo?.hash ?? null }, items as DuplicateKnown[]) : [];
    // What the photo looks like, when that differs from the typed name: the same rule, said as the photo's.
    if (photoName) {
      for (const match of possibleDuplicates({ name: photoName, photoName, serialNumber: value("cat-serial") }, items as DuplicateKnown[])) {
        if (matches.length < 3 && !matches.some((each) => each.id === match.id)) matches.push({ ...match, reason: "Looks like it in the photo" });
      }
    }
    drawDraft(raw);
    const hint = $("#cat-name-hint");
    mount(hint, nameFromPhoto ? html`${icon("camera")}Suggested from photo` : html``);
    hint.classList.toggle("visually-hidden", !nameFromPhoto);
    hint.classList.toggle("cat-name-hint--photo", nameFromPhoto);
    mount($("#cat-model-hint"), modelFromPhoto ? html`${icon("camera")}From photo` : html``);
    if (!matches.length) armed = false;
    drawMatches();
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-behaviour]")) {
      const mine = button.dataset.behaviour as Behaviour;
      button.setAttribute("aria-pressed", String(behaviour === mine));
      const suggested = suggestions.behaviour?.value === mine && behaviour !== mine;
      button.classList.toggle("is-suggested", suggested);
      button.querySelector<HTMLElement>(".cat-choice__suggest")!.hidden = !suggested;
    }
    const stock = suggestions.stockArea && suggestions.stockArea.value !== $<HTMLSelectElement>("#cat-stock").value ? suggestions.stockArea : undefined;
    const lines = [suggestions.behaviour, suggestions.category, suggestions.unit, stock].filter(Boolean);
    const pending = [suggestions.behaviour && behaviour === null, suggestions.category && !value("cat-category"), suggestions.unit && !value("cat-unit"), stock].filter(Boolean).length;
    // Everything "Use these" would fill is named here first: nothing changes silently, including the stock area behind "More details".
    const sure = lines.every((line) => line!.tier === "STRONG");
    const named = [suggestions.behaviour && BEHAVIOUR_LABELS[suggestions.behaviour.value], suggestions.category && categoryName(suggestions.category.value), suggestions.unit?.value, stock && (stock.value === "Pantry" ? "Pantry" : "General stock")].filter(Boolean).join(" · ");
    const notSure = conflicting.map((field) => {
      const hint = raw[field]!;
      const show = (value: string) => field === "behaviour" ? BEHAVIOUR_LABELS[value as Behaviour] : field === "category" ? categoryName(value) : value;
      return html`<span class="cat-suggest__split">${show(hint.value)} (${hint.why}) or ${show(hint.other!.value)} (${hint.other!.why}). Choose one.</span>`;
    });
    // Everything "Use these" would fill is named here first: nothing changes silently, including the stock area behind "More details".
    // Strong suggestions say "Suggested", weaker ones say "Maybe"; a split between two answers is shown, never filled.
    mount($("#cat-why"), html`${lines.length && pending ? html`<span class="cat-suggest__line ${sure ? "" : "is-weak"}">${icon("info")}${sure ? "Suggested" : "Maybe"}: ${named}. ${lines[0]!.why}.</span> <button type="button" class="text-link" id="cat-use-all">Use these</button>` : html``}${notSure}`);
    const categories = [...new Set([suggestions.category?.value, ...recent().map((item) => item.category), ...(catalog?.categories ?? [])].filter((entry): entry is string => Boolean(entry) && entry !== UNSORTED_CATEGORY))];
    mount($("#cat-category-chips"), html`${categories.slice(0, 4).map((category) => chip(categoryName(category), "category", category, category === suggestions.category?.value))}`);
    const common = [suggestions.unit?.value, ...recent().map((item) => item.unit), ...(catalog?.units ?? [])].filter((entry): entry is string => Boolean(entry));
    mount($("#cat-unit-chips"), html`${[...new Set(common)].slice(0, 4).map((unit) => chip(unit, "unit", unit, unit === suggestions.unit?.value))}`);
    mount($("#cat-categories"), html`${(catalog?.categories ?? []).map((category) => html`<option value="${category}">`)}`);
    mount($("#cat-units"), html`${(catalog?.units ?? []).map((unit) => html`<option value="${unit}">`)}`);
    const later = behaviour === "REVIEW_LATER";
    root.querySelectorAll<HTMLElement>("[data-optional]").forEach((element) => { element.hidden = !later; });
    $("#cat-save").firstChild!.textContent = matches.length && armed ? "Save as a separate item " : "Save & next ";
    drawCleanup();
  };

  /** What a photo cannot settle, said once in plain words: the CatalogDraft decides which fields still need a person. */
  const DRAFT_LABELS: Partial<Record<DraftFieldName, string>> = { category: "the category", unit: "what it is counted in", behaviour: "how it is handed out" };
  /** The line last drawn. It is a polite status region, so it is only replaced when its words change: a redraw on every keystroke would read it out again. */
  let draftText = "";
  const drawDraft = (raw: ReturnType<typeof suggest>) => {
    const say = (text: string) => { if (text === draftText) return; draftText = text; mount($("#cat-draft"), text ? html`${icon("info")}${text}` : html``); };
    if (!photo) { say(""); return; }
    const edited = new Set<DraftFieldName>();
    const typed: Partial<Record<DraftFieldName, string>> = {};
    const own = (name: DraftFieldName, text: string) => { if (text) { edited.add(name); typed[name] = text; } };
    if (nameEdited) { edited.add("name"); typed.name = value("cat-name"); }
    if (modelEdited) own("model", value("cat-model"));
    if (quantityEdited) own("quantity", field("cat-qty").value);
    own("category", value("cat-category"));
    own("unit", value("cat-unit"));
    if (behaviour) own("behaviour", behaviour);
    const draft = composeDraft({ revision: photoRevision, typed, edited, suggestions: raw, photo: { name: photoName, model: modelFromPhoto ? value("cat-model") : null }, session: {}, defaultQuantity: 1 });
    // Only what nothing has been offered for: a suggestion or a split is already named above ("Maybe: …", "Choose one"), and category and unit are optional under "Review later".
    const optional = behaviour === "REVIEW_LATER";
    const still = needsAttention(draft).filter((name) => DRAFT_LABELS[name] && draft[name].state === "unknown" && !(optional && (name === "category" || name === "unit"))).map((name) => DRAFT_LABELS[name]!);
    const count = draft.quantity.state === "needs-confirmation" ? "Count what is on the shelf; a photo cannot show the real amount." : "";
    const choose = still.length ? `Still to choose: ${still.join(", ")}.` : "";
    say([count, choose].filter(Boolean).join(" "));
  };

  let drawTimer = 0;
  const later = () => { window.clearTimeout(drawTimer); drawTimer = window.setTimeout(draw, 70); };
  onLeave(() => window.clearTimeout(drawTimer));
  form.addEventListener("input", () => { armed = false; later(); });
  field("cat-qty").addEventListener("input", () => { quantityEdited = true; });
  // Having looked at the count and left the field is confirming it, even when the shelf really holds 1.
  field("cat-qty").addEventListener("blur", () => { if (photo && !quantityEdited) { quantityEdited = true; later(); } });

  const choose = (next: Behaviour) => { behaviour = next; armed = false; setMessage($("#cat-alert"), ""); $("#cat-behaviour").classList.remove("is-invalid"); draw(); };
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    // "Use existing" (amendment 2026-10-08, Possible existing item): the record already in the catalog opens to be updated there, and
    // this capture is dropped, so the match never becomes a duplicate. Nothing about the existing item changes from here.
    const existing = target.closest<HTMLAnchorElement>("[data-use-existing]");
    if (existing) { const name = existing.dataset.useExisting; clear(false); toast(name ? `Not added. ${name} is open in a new tab to update.` : "Not added."); return; }
    const button = target.closest<HTMLElement>("[data-behaviour], [data-fill], [data-step], #cat-use-all");
    if (!button) return;
    invalidateReview();
    if (button.dataset.behaviour) choose(button.dataset.behaviour as Behaviour);
    else if (button.dataset.fill) { field(`cat-${button.dataset.fill}`).value = button.dataset.value ?? ""; armed = false; draw(); }
    else if (button.dataset.step) {
      const quantity = field("cat-qty");
      quantity.value = String(Math.min(100_000, Math.max(0, (Number(quantity.value) || 0) + Number(button.dataset.step))));
      quantityEdited = true;
      later();
    } else if (button.id === "cat-use-all") {
      if (suggestions.behaviour) behaviour = suggestions.behaviour.value;
      if (suggestions.category && !value("cat-category")) field("cat-category").value = suggestions.category.value;
      if (suggestions.unit && !value("cat-unit")) field("cat-unit").value = suggestions.unit.value;
      if (suggestions.stockArea && suggestions.stockArea.value !== $<HTMLSelectElement>("#cat-stock").value) $<HTMLSelectElement>("#cat-stock").value = suggestions.stockArea.value;
      armed = false;
      draw();
      field("cat-qty").focus();
    }
    scheduleReview();
  });

  /* ---------- Photo ---------- */

  const drawPhoto = () => {
    const tile = $("#cat-photo");
    tile.classList.toggle("has-photo", Boolean(photo) || preparing);
    mount(tile, preparing ? html`<span class="cat-photo__empty" role="status">Preparing…</span>`
      : photo ? html`<img src="${photo.preview}" alt="Photo to save with this item" /><span class="cat-photo__retake">${icon("camera")}Change photo</span>`
      : html`<span class="cat-photo__empty">${icon("camera")}<span>Choose photo</span></span>`);
    $("#cat-crop-button").hidden = !photo || preparing;
    tile.setAttribute("aria-label", photo ? "Change photo or file" : "Choose photo or file");
    const messages = { CHECKING: "Reading the photo… You can keep editing.", NO_NAME: "Couldn't identify this photo. Enter a name or try a clearer photo.", OFF: "Photo suggestions are off.", UNAVAILABLE: "Photo suggestions are unavailable right now. You can enter a name.", BUDGET: "Today's photo suggestion allowance is used. You can enter a name.", BREAKER: "Photo reading is taking a break after errors. You can enter a name.", FAILED: "Couldn't read the photo right now. You can enter a name." };
    const status = $("#cat-photo-status");
    status.hidden = !photoOutcome || photoOutcome === "NAMED";
    mount(status, photoOutcome && photoOutcome !== "NAMED" ? html`${messages[photoOutcome]}${photoOutcome === "OFF" && who.session.role === "OWNER" ? html` <button type="button" class="text-link" id="cat-enable-ai">Enable photo suggestions</button>` : ""}` : html``);
    drawCleanup();
  };
  const drawCleanup = () => {
    const state = detail.photoCleanup;
    const signedIn = online && who.mode === "signed-in";
    const action = $<HTMLButtonElement>("#cat-save-clean");
    action.hidden = !photo || preparing;
    action.disabled = !signedIn || !state?.cleanable;
    $("#cat-cleanup").hidden = !photo || preparing;
    $("#cat-cleanup-hint").textContent = !signedIn ? "Sign in online to remove the background." : !state?.cleanable ? state?.cleanupReason || "Background removal is unavailable right now." : "Background removal keeps the original photo.";
    $("#cat-enable-cleanup").hidden = !signedIn || !state?.canEnable;
  };
  $("#cat-enable-cleanup").addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!online || who.mode !== "signed-in" || !detail.photoCleanup?.canEnable) return;
    button.disabled = true;
    try {
      await api("/api/staff/admin/cleanup", { method: "PATCH", body: JSON.stringify({ on: true }) });
      await reload();
      if (root.isConnected) { drawCleanup(); toast("Background removal enabled."); }
    } catch (error) { if (root.isConnected) setMessage($("#cat-alert"), failure(error)); }
    finally { button.disabled = false; }
  });
  $("#cat-photo-status").addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("#cat-enable-ai");
    if (!button || !online || !photo || preparing) return;
    button.disabled = true;
    const taken = photo, revision = photoRevision;
    try {
      await api("/api/staff/admin/assist", { method: "PATCH", body: JSON.stringify({ on: true }) });
      if (revision !== photoRevision || !root.isConnected) return;
      void checkPhoto(taken, revision);
    } catch (error) { if (revision === photoRevision && root.isConnected) { setMessage($("#cat-alert"), failure(error)); button.disabled = false; } }
  });
  const file = field("cat-file");
  const library = field("cat-library");
  $("#cat-photo").addEventListener("click", () => library.click());
  $("#cat-camera-button").addEventListener("click", () => file.click());
  $("#cat-crop-button").addEventListener("click", () => {
    if (!photo || preparing) return;
    const source = originalPhoto ?? photo;
    const revision = photoRevision;
    const host = $("#cat-crop"); host.hidden = false;
    cropEditor(host, source, (cropped) => { if (revision !== photoRevision || !root.isConnected) return; photo = cropped; host.hidden = true; drawPhoto(); $("#cat-crop-button").focus(); }, () => { host.hidden = true; $("#cat-crop-button").focus(); });
  });
  const selectPhoto = async (chooser: HTMLInputElement) => {
    const chosen = chooser.files?.[0];
    chooser.value = "";
    if (!chosen) return;
    const revision = ++photoRevision;
    invalidateReview();
    $("#cat-crop").hidden = true;
    preparing = true;
    drawPhoto();
    let prepared: NonNullable<typeof photo> | null = null;
    let preparationError: string | null = null;
    try { prepared = await preparePhoto(chosen); } catch (error) { preparationError = error instanceof Error ? error.message : "This photo could not be used."; }
    // A newer retake (or a reset, which clears the flag itself) owns "Preparing…" now: an older one finishing late must not hide it.
    if (revision !== photoRevision) return;
    setMessage($("#cat-alert"), preparationError ?? "");
    preparing = false;
    // A photo that could not be used leaves the earlier photo, its name and its check exactly as they were.
    if (!prepared) { drawPhoto(); scheduleReview(); return; }
    armed = false;
    photoName = null;
    photoChecked = false;
    photoOutcome = null;
    if (nameFromPhoto) { field("cat-name").value = ""; nameFromPhoto = false; }
    if (modelFromPhoto) { field("cat-model").value = ""; modelFromPhoto = false; }
    originalPhoto = photo = prepared;
    drawPhoto();
    draw();
    field("cat-name").focus();
    if (online) void checkPhoto(prepared, revision);
  };
  file.addEventListener("change", () => void selectPhoto(file));
  library.addEventListener("change", () => void selectPhoto(library));
  /** Never in the way: the person keeps typing while it runs, and a failure leaves the photo to be checked after it syncs. */
  const checkPhoto = async (taken: NonNullable<typeof photo>, revision: number) => {
    photoOutcome = "CHECKING";
    drawPhoto();
    try {
      const answer = await api<{ name: string | null; model?: string | null; outcome?: PhotoOutcome }>("/api/staff/catalogue/photo-name", { method: "POST", body: taken.thumb, headers: { "content-type": "image/jpeg" }, ...(typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(15_000) } : {}) });
      if (revision !== photoRevision || photo?.display !== taken.display) return;
      photoOutcome = answer.outcome ?? (answer.name ? "NAMED" : "NO_NAME");
      photoChecked = photoOutcome === "NAMED" || photoOutcome === "NO_NAME";
      photoName = answer.name;
      if (answer.name && !nameEdited && !value("cat-name")) {
        field("cat-name").value = answer.name;
        nameFromPhoto = true;
        announce(`Suggested name from the photo: ${answer.name}.`);
      }
      // The model printed on the item, only into an empty Model field the person has not touched; they check it like the name.
      if (answer.name && answer.model && !modelEdited && !value("cat-model")) {
        field("cat-model").value = answer.model;
        modelFromPhoto = true;
        // The field sits under "More details": open it, say where the value came from, and announce it like the name.
        $("#cat-more").setAttribute("open", "");
        announce(`Model read from the photo: ${answer.model}. Check it.`);
      }
      invalidateReview();
      draw();
      drawPhoto();
      scheduleReview(0);
    } catch { if (revision === photoRevision && photo?.display === taken.display && root.isConnected) { photoOutcome = "FAILED"; drawPhoto(); } /* checked after sync instead */ }
  };
  field("cat-model").addEventListener("input", () => { modelEdited = true; modelFromPhoto = false; draw(); });
  field("cat-name").addEventListener("input", () => { nameEdited = true; if (nameFromPhoto) { nameFromPhoto = false; draw(); } });
  field("cat-name").addEventListener("blur", () => {
    const input = field("cat-name"); const name = formatItemName(input.value);
    if (name !== input.value) { input.value = name; input.dispatchEvent(new Event("input", { bubbles: true })); }
  });

  /* ---------- Saving ---------- */

  const invalid = (id: string, message: string) => {
    const element = id === "cat-behaviour" ? $("#cat-behaviour") : field(id);
    // A fieldset cannot be invalid; the group is marked by a class and the message is read from the alert.
    if (id === "cat-behaviour") element.classList.add("is-invalid"); else element.setAttribute("aria-invalid", "true");
    setMessage($("#cat-alert"), message);
    (id === "cat-behaviour" ? root.querySelector<HTMLElement>("[data-behaviour]")! : element).focus();
    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  /** Empties the form for the next item; "like this" keeps what a second one of the same would share. */
  const clear = (keepShared: boolean) => {
    const kept = keepShared ? { name: value("cat-name"), category: value("cat-category"), unit: value("cat-unit"), model: value("cat-model"), stock: $<HTMLSelectElement>("#cat-stock").value } : null;
    form.reset();
    draftId = crypto.randomUUID();
    invalidateReview();
    originalPhoto = null;
    $("#cat-crop").hidden = true;
    photoRevision += 1;
    nameEdited = false;
    modelEdited = false;
    quantityEdited = false;
    modelFromPhoto = false;
    preparing = false;
    photo = null;
    photoName = null;
    photoChecked = false;
    photoOutcome = null;
    nameFromPhoto = false;
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
    if (keepShared) field("cat-name").select();
    if (keepShared) scheduleReview();
  };

  /** True from pressing Save until the item is on this device: a second press or a held key cannot queue it twice. */
  let submitting = false;
  const submit = async (like: boolean, cleanBackground = false) => {
    if (submitting) return;
    if (cleanBackground && (!photo || preparing || !online || who.mode !== "signed-in" || !detail.photoCleanup?.cleanable)) return;
    form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid"));
    $("#cat-behaviour").classList.remove("is-invalid");
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
      $(cleanBackground ? "#cat-save-clean" : "#cat-save").focus();
      return;
    }
    submitting = true;
    const id = crypto.randomUUID();
    const body: Record<string, unknown> = {
      id, behaviour, name, aliases: value("cat-aliases"), category: value("cat-category"), unit: value("cat-unit"), quantity, locationId: placeId,
      stockArea: $<HTMLSelectElement>("#cat-stock").value, model: value("cat-model"), serialNumber: value("cat-serial"), notes: value("cat-notes"),
      ...(reviewOffer && reviewDecision ? { aiFeedback: { offerId: reviewOffer.id, draftId, revision: reviewOffer.revision, ...reviewDecision } } : {}),
      photoHash: photo?.hash ?? "", acknowledged: matches.filter((match) => !match.id.startsWith("pending:")).map((match) => match.id)
    };
    const entry: Entry = {
      id, sessionId, owner: session.id, body, photo: photo ? { display: photo.display, thumb: photo.thumb, hash: photo.hash, ...(photo.crop ? { crop: photo.crop } : {}) } : null, itemId: null, state: "waiting", message: null, matches: null,
      ...(photo && !photoChecked ? { recheck: true } : {}),
      ...(cleanBackground ? { cleanBackground: true } : {}),
      at: new Date().toISOString(), after: matches.filter((match) => match.id.startsWith("pending:")).map((match) => match.id.slice(8))
    };
    if (photo) thumbs.set(id, photo.preview);
    // On the device before anything is sent: from here a dropped connection, a reload or an update cannot lose it.
    try {
      await keep(entry);
      local.set(id, known(entry));
      waiting = await here();
    } finally {
      submitting = false;
    }
    clear(like);
    announce(online ? `Saving ${name}.` : `${name} is not saved yet. It will be sent when you're back online.`);
    drawList();
    void syncNow();
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); void submit(false); });
  $("#cat-like").addEventListener("click", () => { void submit(true); });
  $("#cat-save-clean").addEventListener("click", () => { void submit(false, true); });

  const announce = (text: string) => { $("#cat-announce").textContent = text; };

  /* ---------- Sending (catalogue-sync.ts) ---------- */

  /** The server's own view of the session: what is saved, and how many. Kept on this device for opening it again offline. */
  async function reload(): Promise<void> {
    const target = (await stored())?.serverId;
    if (!online || !target) return;
    try {
      detail = await api<Detail>(`/api/staff/catalogue/sessions/${target}`);
      if (root.isConnected) drawCleanup();
      // Written back from what is stored now, and only while still open here: a finish pressed meanwhile is never undone.
      const latest = await stored();
      if (latest && !latest.finishing && detail.session.status === "ACTIVE") await keepSession(record = { ...latest, detail });
    } catch { /* the next change tries again */ }
  }

  /** Neither a sign-in nor this device's offline access is valid any more: what is here waits on the device for the next sign-in. */
  const ended = async () => {
    await setAccess(null);
    navigate(signInHere(true), true);
  };
  const connected = (now: boolean) => {
    if (online === now) return;
    online = now;
    $("#cat-offline").hidden = online;
    drawCleanup();
    drawList();
  };
  const onConnection = () => connected(navigator.onLine);
  window.addEventListener("online", onConnection);
  window.addEventListener("offline", onConnection);
  onLeave(() => { window.removeEventListener("online", onConnection); window.removeEventListener("offline", onConnection); });

  const refresh = async () => {
    if (signedOut()) return ended();
    const now = await here();
    // Something reached the server: it can be reached again.
    if (waiting.some((entry) => !now.some((each) => each.id === entry.id) || (entry.itemId === null && now.find((each) => each.id === entry.id)?.itemId))) connected(true);
    // A capture the server has saved is known by its item from now on, so the next look-alike names it as "a different one".
    for (const entry of waiting) {
      const item = savedItem(entry.id) ?? now.find((each) => each.id === entry.id)?.itemId;
      if (item) local.set(entry.id, { ...known(entry), id: item });
    }
    // Once the server has everything an item leaves the queue; its row must come back from the server's list in the same moment,
    // so it never seems to vanish in between.
    if (waiting.some((entry) => !now.some((each) => each.id === entry.id))) await reload();
    waiting = now;
    drawList();
  };
  onLeave(onSyncChange(() => void refresh()));

  /* ---------- Just added ---------- */

  const stateOf = (entry: Entry): Html => {
    if (entry.state === "stopped") return html`<span class="tag tag--bad">Needs you</span>`;
    // One term for a capture the server does not have yet, whatever the reason (amendment §4): offline is said once, above the form.
    if (!entry.itemId) return entry.message || !online ? html`<span class="tag tag--warn">Not saved yet</span>` : html`<span class="tag tag--pending">Saving…</span>`;
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

  // Saved photos are served to signed-in staff only, from the network: without one, the row shows the plain tile.
  const savedRow = (row: Detail["recent"][number]): Html => html`<li class="cat-row" data-key="${row.captureId}">
    ${row.photoId && who.mode === "signed-in" ? html`<img class="cat-row__thumb" src="${photoUrl(row.photoId, "thumb")}" alt="" width="44" height="44" loading="lazy" decoding="async" />` : html`<span class="cat-row__thumb cat-row__thumb--none">${icon("box")}</span>`}
    <span class="cat-row__text"><strong>${row.name}</strong><span>${BEHAVIOUR_LABELS[row.behaviour as Behaviour]} · ${row.onHand} ${units(row.onHand, row.unit)}${row.place ? ` · ${row.place.split(" › ").pop()}` : ""}</span></span>
    <span class="cat-row__state">${row.behaviour === "REVIEW_LATER" ? html`<span class="tag tag--pending">Review later</span>` : html`<span class="tag tag--ok">Saved</span>`}
      ${who.mode === "signed-in" ? html`<a class="icon-button" href="/staff/items?item=${row.itemId}" target="_blank" rel="noopener" aria-label="Open ${row.name} (opens in a new tab)">${icon("external")}</a>` : ""}</span></li>`;

  function drawList(): void {
    const queued = [...waiting].reverse();
    const sent = detail.recent.filter((row) => !waiting.some((entry) => entry.id === row.captureId));
    const holding = waiting.length;
    $("#cat-count").textContent = plural(detail.session.saved + waiting.filter((entry) => !entry.itemId).length, "item");
    const stopped = waiting.some((entry) => entry.state === "stopped");
    const offline = !online || waiting.some((entry) => entry.state === "waiting" && entry.message);
    sync.dataset.state = offline || stopped ? "offline" : "live";
    sync.textContent = stopped ? "Needs you" : offline && holding ? `${holding} waiting to send` : holding ? "Saving…" : online ? "All saved" : "Offline";
    // On a phone the list sits below the form: one tap goes to whatever is waiting.
    $("#cat-see").hidden = !((offline && holding) || stopped);
    preservingFocus($("#cat-list"), () => mount($("#cat-list"), queued.length || sent.length
      ? html`${!durable() && holding ? html`<p class="callout">${icon("alert")}<span>This browser cannot keep unsent items if the page closes. Stay on this page until they are saved.</span></p>` : ""}<ul class="cat-rows">${queued.map(queuedRow)}${sent.map(savedRow)}</ul>
        ${detail.session.saved > sent.length ? html`<p class="muted">Showing the newest ${sent.length}. The others are saved; find them under Items.</p>` : ""}`
      : html`<p class="muted">Nothing yet. The first item you save appears here.</p>`));
  }

  $("#cat-see").addEventListener("click", () => { $("#cat-recent-title").scrollIntoView({ block: "start", behavior: "smooth" }); });
  $("#cat-list").addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const act = target.closest<HTMLElement>("[data-separate], [data-edit], [data-discard]");
    if (!act) return;
    const entry = waiting.find((each) => each.id === (act.dataset.separate ?? act.dataset.edit ?? act.dataset.discard));
    if (!entry) return;
    if (act.dataset.separate) {
      Object.assign(entry, { state: "waiting", message: null, body: { ...entry.body, acknowledged: (entry.matches ?? []).map((match) => match.id) }, matches: null });
      await keep(entry);
      void syncNow();
    } else if (act.dataset.edit) {
      if ((value("cat-name") || photo) && !window.confirm("Replace what you are typing with this item?")) return;
      draftId = crypto.randomUUID();
      invalidateReview();
      const revision = ++photoRevision;
      preparing = false;
      nameEdited = modelEdited = quantityEdited = true;
      modelFromPhoto = false;
      $("#cat-crop").hidden = true;
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
      originalPhoto = null;
      photo = entry.photo ? { ...entry.photo, preview: thumbs.get(entry.id) ?? "" } : null;
      if (photo && !photo.preview) {
        const restored = photo;
        const preview = await dataUrl(restored.display);
        if (revision !== photoRevision || !root.isConnected) return;
        restored.preview = preview;
      }
      photoName = null;
      photoOutcome = null;
      photoChecked = Boolean(photo) && !entry.recheck;
      nameFromPhoto = false;
      await drop(entry.id);
      waiting = waiting.filter((each) => each.id !== entry.id);
      drawPhoto();
      draw();
      drawList();
      scheduleReview();
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
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!event.repeat) void submit(false); return; }
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && target instanceof HTMLInputElement && form.contains(target) && !event.isComposing) {
      // Enter moves on rather than saving: saving is a deliberate press.
      event.preventDefault();
      const next = ORDER[ORDER.indexOf(target.id) + 1];
      if (!ORDER.includes(target.id)) return;
      if (target.id === "cat-name" && !behaviour) root.querySelector<HTMLElement>(".cat-choice.is-suggested, .cat-choice")!.focus();
      else if (next) field(next).focus();
      else $("#cat-save").focus();
      return;
    }
    // Alt + a key, so a shortcut never fires while someone is typing a name (WCAG 2.1.4); it works from any field.
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
    if (digit && Number(digit) <= BEHAVIOURS.length) { event.preventDefault(); invalidateReview(); choose(BEHAVIOURS[Number(digit) - 1]!); scheduleReview(); }
    else if (event.code === "KeyP") { event.preventDefault(); library.click(); }
  };
  document.addEventListener("keydown", onKey);
  onLeave(() => document.removeEventListener("keydown", onKey));

  /* ---------- Finishing ---------- */

  $("#cat-finish").addEventListener("click", async () => {
    await syncNow();
    waiting = await here();
    const stopped = waiting.filter((entry) => entry.state === "stopped");
    if (stopped.length) { toast(`${plural(stopped.length, "item")} here ${stopped.length === 1 ? "needs" : "need"} you first: save, edit or discard ${stopped.length === 1 ? "it" : "them"}.`, "error"); drawList(); return; }
    const unsent = waiting.filter((entry) => !entry.itemId).length;
    const total = detail.session.saved + unsent;
    if (!window.confirm(`Finish cataloguing? ${plural(total, "item")} saved${waiting.length ? `; ${waiting.length === 1 ? "1 is" : `${waiting.length} are`} still on this device and will be sent when ${online ? "the connection allows" : "you're back online"}` : ""}.`)) return;
    try {
      // What is stored now: sending may have started the session on the server since this page read it.
      const latest = (await stored()) ?? record!;
      if (!waiting.length && online && latest.serverId) {
        await api(`/api/staff/catalogue/sessions/${latest.serverId}/finish`, { method: "POST" });
        // Finished on the server: the page drawn next is the server's summary, with signing items off, under the server's id (a
        // session started here offline may have joined the one this person had open elsewhere).
        await dropSession(latest.id);
        if (latest.serverId !== sessionId) { navigate(`/staff/catalogue?session=${latest.serverId}`, true); return; }
      } else {
        // Finished here: the server is told once everything in it has been sent (catalogue-sync.ts).
        await keepSession({ ...latest, finishing: true });
      }
      void syncNow();
      // The address does not change, so the page is drawn again rather than navigated to.
      leave();
      await captureScreen(who, sessionId);
    } catch (error) {
      toast(failure(error), "error");
    }
  });

  /* ---------- Data ---------- */

  const takeCatalog = (fresh: Snapshot) => {
    if ((reviewOffer && reviewOffer.catalogRevision !== fresh.revision) || (requestingReview && catalog?.revision !== fresh.revision)) { invalidateReview(); scheduleReview(); }
    catalog = fresh;
    list = placeList(fresh.places);
    if (!placeId || !list.places.get(placeId)?.active) placeId = detail.session.locationId && list.places.get(detail.session.locationId)?.active ? detail.session.locationId : null;
    const selected = $<HTMLSelectElement>("#cat-place-select");
    showPlace();
    if (placeId) selected.value = placeId;
    if (canAddPlace) refreshParents(panel, list, placeId);
    draw();
  };
  // Online, the saved catalog is kept current (one small 304 while nothing changes) and the screen reads the same copy offline.
  const poll = online ? live<Omit<Snapshot, "fetchedAt">>("/api/staff/catalogue/snapshot", {
    interval: 30_000,
    etag: catalog?.items.every((item) => typeof item.needsReview === "boolean") ? `"r${catalog.revision}"` : "",
    status: () => null,
    onData: (data) => { const fresh = { ...data, fetchedAt: new Date().toISOString() }; void setSnapshot(fresh); takeCatalog(fresh); },
    onError: (error) => { if (error.status === 401) void ended(); }
  }) : null;

  drawPhoto();
  if (catalog) takeCatalog(catalog); else showPlace();
  waiting = await here();
  draw();
  drawList();
  field("cat-name").focus();
  void syncNow();
}
