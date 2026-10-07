import type { Who } from "./catalogue-offline";
import { placeOptions, placeList } from "./catalogue-places";
import { catalogueShell } from "./catalogue-shell";
import { type AuditDetail, type AuditItem, type AuditRecord, type ObservationEntry, type Snapshot, audits, dropObservation, durable, keepAudit, keepObservation, observations, snapshot } from "./catalogue-store";
import { onSyncChange, refreshCheck, syncNow } from "./catalogue-sync";
import { childrenOf, pathOf, placesOf } from "./location-tree";
import { whenIdle } from "./pwa";
import { ApiError, type Html, api, emptyState, failure, formatDateTime, html, icon, mount, navigate, onLeave, plural, reducedMotion, sheet, sheetContent, toast, units } from "./ui";

/*
 * Checking a place (V1.7), in the Catalog app. A check is one person verifying what should be at one place and the places inside it:
 * each expected item is marked Here (the count matches), Count differs, I can't find it or Record looks wrong; anything else on the
 * shelf is Found here (recorded elsewhere) or Not in the catalog. Everything seen is written on this device first and sent in order
 * (catalogue-sync.ts), so a check runs the same with or without a connection. Nothing seen changes stock: the review, after the check is
 * finished, settles each finding through the ledger (audits.ts).
 */

type Signed = Exclude<Who, { mode: "closed" } | { mode: "signed-out" }>;
type Review = { discrepancies: Finding[] };
type Finding = {
  id: string; itemId: string | null; outcome: string; expectedOnHand: number | null; counted: number | null; note: string | null; name: string | null; unit: string | null;
  recordedPlace: string | null; seenPlace: string | null; onHandNow: number; changedSince: boolean; resolution: string | null; resolutionNote: string | null; resolvedBy: string | null;
};

/** What staff see for each outcome: one term each (amendment §4), reusing the existing words for existing concepts. */
export const OUTCOME_LABELS: Record<string, string> = {
  CONFIRMED: "Here", MISMATCH: "Count differs", CANT_FIND: "I can’t find it", FOUND_HERE: "Found here", UNLISTED: "Not in the catalog", NEEDS_REVIEW: "Record looks wrong"
};
const FINDINGS = new Set(["MISMATCH", "CANT_FIND", "FOUND_HERE", "UNLISTED", "NEEDS_REVIEW"]);
const RESOLVED_LABELS: Record<string, string> = { POSTED_COUNT: "Count posted", MOVED_HERE: "Moved here", REPORTED: "Reported", NO_CHANGE: "No change" };

const now = () => new Date().toISOString();
const checkLink = (id: string) => `/staff/catalogue?audit=${id}`;
const amount = (count: number, unit: string) => `${count} ${units(count, unit)}`;

/** The items expected at a place (and the places inside it), from the catalog this device saved: what a check started offline expects. */
export function expectedFrom(saved: Snapshot, locationId: string): AuditItem[] {
  const places = placesOf(saved.places);
  const below = childrenOf(places);
  const inside = new Set<string>();
  const walk = (id: string, depth: number) => { inside.add(id); if (depth < 8) for (const child of below.get(id) ?? []) walk(child.id, depth + 1); };
  walk(locationId, 0);
  return saved.items.filter((item) => item.locationId && inside.has(item.locationId) && item.status !== "INACTIVE")
    .map((item) => ({ id: item.id, name: item.name, unit: item.unit, locationId: item.locationId, place: pathOf(places, item.locationId), onHand: item.onHand, observation: null }))
    .sort((a, b) => (a.place ?? "").localeCompare(b.place ?? "") || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/* ---------- Home: start, resume, who else is checking ---------- */

type CheckRow = { id: string; place: string | null; status: string; owner: string; startedAt: string; finishedAt: string | null; mine: boolean };
type State = { mine: CheckRow[]; others: CheckRow[]; finished: CheckRow[] };

/** The "Check a place" card on the Catalog's home. */
export async function checksCard(host: HTMLElement, who: Signed, places: Parameters<typeof placeList>[0]): Promise<void> {
  const list = placeList(places);
  const state: State = navigator.onLine ? await api<State>("/api/staff/audits").catch(() => ({ mine: [], others: [], finished: [] })) : { mine: [], others: [], finished: [] };
  // This device's own checks first (a check started offline is known only here), then the server's.
  const local = (await audits()).filter((record) => record.owner === who.session.id && record.detail.audit.status !== "FINISHED");
  const held = await observations();
  const mine = [...local.map((record) => ({ id: record.id, place: record.detail.audit.place, paused: (record.pending?.status ?? record.detail.audit.status) === "PAUSED",
    progress: `${checkedOf(record.detail, held.filter((entry) => entry.auditId === record.id))} / ${record.detail.items.length} checked` })),
    ...state.mine.filter((row) => !local.some((record) => record.id === row.id || record.serverId === row.id)).map((row) => ({ id: row.id, place: row.place, paused: row.status === "PAUSED", progress: `Started ${formatDateTime(row.startedAt)}` }))];
  const active = places.filter((place) => place.active);
  mount(host, html`<section class="card cat-card ck-home" aria-labelledby="checks-title">
      <div class="card__head"><h2 id="checks-title">Check a place</h2></div>
      <p class="card__text">Go through what should be at one place: mark each item here, a different count, or not found, and note anything that isn’t on the list. Stock changes only when you settle the findings afterwards.</p>
      ${mine.length ? html`<ul class="ck-mine">${mine.map((row) => html`<li><a class="ck-mine__row" href="${checkLink(row.id)}" data-route>
          <span class="ck-mine__text"><strong>${row.place ?? "A place"}</strong><span>${row.paused ? "Paused · " : ""}${row.progress}</span></span>
          <span class="ck-mine__go">${row.paused ? "Resume" : "Continue"} ${icon("next")}</span></a></li>`)}</ul>` : ""}
      ${active.length ? html`<div class="field"><label for="check-place">Place to check</label><select id="check-place">${placeOptions(list, null)}</select></div>
        <div class="form-alert" id="check-alert" role="alert" hidden></div>
        <div class="where__buttons"><button class="button button--secondary button--lg" type="button" id="check-go">${icon("check")}Start checking</button></div>` : ""}
      ${state.others.length ? html`<p class="card__text ck-others">${icon("user")}<span>${state.others.map((row) => `${row.owner} is checking ${row.place ?? "a place"}`).join(" · ")}.</span></p>` : ""}
      ${state.finished.length ? html`<details class="ck-finished"><summary>Finished checks</summary><ul>${state.finished.map((row) => html`<li><a class="text-link" href="${checkLink(row.id)}" data-route>${row.place ?? "A place"}</a> <span class="muted">· ${row.owner}, ${formatDateTime(row.finishedAt ?? row.startedAt)}</span></li>`)}</ul></details>` : ""}
    </section>`);
  const go = host.querySelector<HTMLButtonElement>("#check-go");
  go?.addEventListener("click", async () => {
    const select = host.querySelector<HTMLSelectElement>("#check-place")!;
    const alert = host.querySelector<HTMLElement>("#check-alert")!;
    go.disabled = true;
    alert.hidden = true;
    try {
      navigate(checkLink(await startCheck(who, select.value, list.paths.get(select.value) ?? null)));
    } catch (error) {
      alert.hidden = false;
      alert.textContent = failure(error);
      go.disabled = false;
    }
  });
}

/**
 * Starts a check. With a connection the server makes it (or answers with this person's open check of the place, or refuses when someone
 * else is checking it); without one, this device starts it under an id it proposes and expects what its saved catalog says is there.
 */
async function startCheck(who: Signed, locationId: string, place: string | null): Promise<string> {
  if (navigator.onLine) {
    try {
      const started = await api<{ id: string }>("/api/staff/audits", { method: "POST", body: JSON.stringify({ locationId }) });
      await refreshCheck(started.id, who.session.id);
      return started.id;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 0)) throw error;
    }
  }
  const saved = await snapshot();
  if (!saved) throw new Error("This device has no saved catalog yet. Connect once to check places offline.");
  const id = `LA-${crypto.randomUUID()}`;
  const items = expectedFrom(saved, locationId);
  const directions = saved.places.find((entry) => entry.id === locationId)?.directions ?? null;
  const detail: AuditDetail = {
    audit: { id, locationId, place, status: "OPEN", expectedAtStart: items.length, placeNote: null, startedAt: now(), finishedAt: null, owner: who.session.displayName, mine: true },
    place: { directions, mediaId: null, mediaWidth: null, mediaHeight: null }, items, extras: [], checked: 0
  };
  await keepAudit({ id, owner: who.session.id, serverId: null, detail, pending: null, finishing: false });
  return id;
}

/** How many expected items have been looked at, counting what this device saw and has not sent yet. */
function checkedOf(detail: AuditDetail, held: ObservationEntry[]): number {
  const seen = new Set(detail.items.filter((item) => item.observation).map((item) => item.id));
  for (const entry of held) if (entry.body.itemId && detail.items.some((item) => item.id === entry.body.itemId)) seen.add(entry.body.itemId);
  return seen.size;
}

/* ---------- The check ---------- */

export async function checkScreen(who: Signed, id: string): Promise<void> {
  document.title = "Checking a place · Catalog";
  catalogueShell(who, html`<div class="ck" id="ck" aria-busy="true"><div class="skeleton skeleton--block"></div></div>`);
  const root = document.querySelector<HTMLElement>("#ck")!;
  let record = (await audits()).find((each) => each.id === id || each.serverId === id) ?? null;
  let detail: AuditDetail | null = null;
  try {
    // The connection now, not how the page opened: a page opened offline asks the server again once it is back.
    detail = navigator.onLine ? await refreshCheck(id, who.session.id) : null;
  } catch (error) {
    root.removeAttribute("aria-busy");
    mount(root, emptyState("This check could not be opened", failure(error), html`<a class="button button--secondary" href="/staff/catalogue" data-route>Back to the Catalog</a>`, "error", 1));
    return;
  }
  record = (await audits()).find((each) => each.id === id || each.serverId === id) ?? record;
  detail ??= record?.detail ?? null;
  root.removeAttribute("aria-busy");
  if (!detail) {
    mount(root, emptyState("This check isn’t saved on this device", "It opens only with a connection.", html`<a class="button button--secondary" href="/staff/catalogue" data-route>Back to the Catalog</a>`, "error", 1));
    return;
  }
  if (detail.audit.status === "FINISHED" || record?.finishing) return summary(root, who, detail, record);
  if (!detail.audit.mine || !record) return summary(root, who, detail, null);
  return checking(root, who, record);
}

async function checking(root: HTMLElement, who: Signed, start: AuditRecord): Promise<void> {
  let record = start;
  let filter: "todo" | "done" | "findings" = "todo";
  let counting: string | null = null;
  let reviewing: string | null = null;
  let editingNote = false;
  whenIdle(() => counting === null && reviewing === null && !editingNote);
  onLeave(() => whenIdle(() => false));
  const dialog = document.createElement("dialog");
  dialog.className = "sheet";
  dialog.setAttribute("aria-labelledby", "sheet-title");
  document.querySelector("main")!.append(dialog);
  const found = sheet(dialog);
  /** What the open "not on the list" sheet is working with; one click handler serves every opening. */
  let finding: { saved: Snapshot | null; places: ReturnType<typeof placesOf> } = { saved: null, places: new Map() };

  const held = async () => (await observations()).filter((entry) => entry.auditId === record.id);
  /** Writes what was seen on this device (and into the check as this device knows it, so it reopens offline), then sends it. */
  const see = async (body: ObservationEntry["body"]) => {
    const entry: ObservationEntry = { id: crypto.randomUUID(), auditId: record.id, owner: who.session.id, body, state: "waiting", message: null, at: now() };
    await keepObservation(entry);
    const seen = { id: entry.id, outcome: body.outcome, counted: body.counted ?? null, note: body.note ?? null };
    const item = record.detail.items.find((each) => each.id === body.itemId);
    if (item) item.observation = seen;
    else {
      const name = body.itemId ? (await snapshot())?.items.find((each) => each.id === body.itemId)?.name ?? body.itemId : body.note ?? null;
      record.detail.extras = [...record.detail.extras.filter((extra) => !body.itemId || extra.itemId !== body.itemId), { ...seen, itemId: body.itemId ?? null, name }];
    }
    record.detail.audit.status = "OPEN";
    if (record.pending?.status === "PAUSED") record.pending = { ...record.pending, status: "OPEN" };
    await keepAudit(record);
    await draw();
    void syncNow();
  };

  const draw = async () => {
    const waiting = await held();
    const pendingIds = new Set(waiting.map((entry) => entry.id));
    const stopped = waiting.filter((entry) => entry.state === "stopped");
    const { detail } = record;
    const items = detail.items;
    const checked = items.filter((item) => item.observation).length;
    const findings = [...items.filter((item) => item.observation && FINDINGS.has(item.observation.outcome)), ...detail.extras];
    const todo = items.filter((item) => !item.observation);
    const done = items.filter((item) => item.observation);
    const paused = (record.pending?.status ?? detail.audit.status) === "PAUSED";
    const offline = !navigator.onLine;
    if (filter === "todo" && !todo.length) filter = "done";
    const shown = filter === "todo" ? todo : filter === "done" ? done : findings.filter((entry): entry is AuditItem => "onHand" in entry);
    mount(root, html`
      <p class="cat-back"><a class="text-link" href="/staff/catalogue" data-route>${icon("back")}Catalog</a></p>
      <header class="ck-head">
        <p class="ck-head__kicker">Checking</p>
        <h1>${detail.audit.place ?? "A place"}</h1>
        ${paused ? html`<p class="ck-paused" role="status">${icon("clock")}<span><strong>Paused.</strong> Pick up where you left off, or resume to carry on.</span> <button type="button" class="button button--secondary button--sm" data-resume>Resume</button></p>` : ""}
      </header>
      ${!durable() && waiting.length ? html`<p class="callout" role="status">${icon("alert")}<span>This browser cannot keep unsent marks if the page closes. Stay on this page until they are sent.</span></p>` : ""}
      <section class="ck-progress" aria-label="Progress">
        <p class="ck-progress__count"><strong>${checked} / ${items.length}</strong> checked${findings.length ? html` · <span class="ck-progress__findings">${plural(findings.length, "finding")}</span>` : ""}${waiting.length ? html` · <span class="live-status" data-state="waiting">${waiting.length} waiting to send</span>` : ""}</p>
        <progress class="ck-bar" aria-label="Items checked" max="${Math.max(items.length, 1)}" value="${items.length ? checked : 1}">${checked} of ${items.length}</progress>
      </section>
      ${offline ? html`<p class="ck-note" role="status">${icon("cloudOff")}<span><strong>Offline.</strong> Keep going: what you mark stays on this device and is sent when you’re back online.</span></p>` : ""}
      ${stopped.length ? html`<section class="callout ck-stopped" role="alert">${icon("alert")}<div><p><strong>${plural(stopped.length, "thing")} you marked could not be saved.</strong> ${stopped[0]!.message ?? ""}</p>
        <button type="button" class="text-link" data-discard-stopped>Discard ${stopped.length === 1 ? "it" : "them"}</button></div></section>` : ""}
      <details class="ck-place"${detail.place?.directions || detail.place?.mediaId ? "" : html` open`}>
        <summary>${icon("pin")}Directions and picture</summary>
        ${detail.place?.directions ? html`<p class="ck-place__directions">${detail.place.directions}</p>` : html`<p class="muted">No directions for this place yet.</p>`}
        ${detail.place?.mediaId && !offline ? html`<img class="ck-place__picture" src="/api/staff/location-media/${detail.place.mediaId}/display" alt="Reference picture of ${detail.audit.place ?? "this place"}" width="${detail.place.mediaWidth ?? 320}" height="${detail.place.mediaHeight ?? 240}" loading="lazy" decoding="async" />` : ""}
        ${editingNote ? html`<div class="field"><label for="ck-place-note">What needs fixing about this place’s directions or picture?</label><textarea id="ck-place-note" maxlength="300" rows="2">${record.pending?.placeNote ?? detail.audit.placeNote ?? ""}</textarea></div>
            <div class="where__buttons"><button type="button" class="button button--secondary button--sm" data-save-note>Save note</button><button type="button" class="text-link" data-cancel-note>Cancel</button></div>`
          : html`<p>${(record.pending?.placeNote ?? detail.audit.placeNote) ? html`<span class="ck-place__flag">${icon("info")}${record.pending?.placeNote ?? detail.audit.placeNote}</span> ` : ""}<button type="button" class="text-link" data-edit-note>${(record.pending?.placeNote ?? detail.audit.placeNote) ? "Change note" : "Directions or picture wrong?"}</button></p>`}
      </details>
      <div class="segmented ck-tabs" role="tablist" aria-label="Show">
        ${([["todo", "To check", todo.length], ["done", "Checked", done.length], ["findings", "Findings", findings.length]] as const).map(([key, text, count]) =>
          html`<button type="button" role="tab" aria-selected="${String(filter === key)}" data-filter="${key}">${text} <span class="view-tab__count">${count}</span></button>`)}
      </div>
      ${filter === "todo" && !todo.length ? html`<p class="ck-empty">${icon("check")}Everything expected here has been checked.</p>` : ""}
      <ul class="ck-list">${shown.map((item) => row(item, pendingIds))}</ul>
      ${filter === "findings" && detail.extras.length ? html`<h2 class="ck-section">Not on the list</h2><ul class="ck-list">${detail.extras.map((extra) => html`<li class="ck-row is-checked">
          <div class="ck-row__main"><strong>${extra.name ?? "Something"}</strong><span>${OUTCOME_LABELS[extra.outcome] ?? extra.outcome}${extra.counted !== null ? ` · ${extra.counted} seen` : ""}${pendingIds.has(extra.id) ? " · Not saved yet" : ""}</span></div></li>`)}</ul>` : ""}
      <div class="ck-actions">
        <button type="button" class="button button--secondary" data-found>${icon("plus")}Found something not on the list</button>
        <div class="ck-actions__end">
          <button type="button" class="button button--secondary" data-pause>Pause</button>
          <button type="button" class="button button--primary" data-finish>Finish check</button>
        </div>
      </div>`);
    // An opened row comes fully into view, clear of the sticky progress above and the actions below, with its field ready.
    const opened = counting ? root.querySelector<HTMLElement>(`#ck-count-${CSS.escape(counting)}`) : reviewing ? root.querySelector<HTMLElement>(`#ck-why-${CSS.escape(reviewing)}`) : null;
    if (opened) {
      opened.focus({ preventScroll: true });
      opened.closest(".ck-row")?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  };

  const row = (item: AuditItem, pending: Set<string>): Html => {
    const seen = item.observation;
    const where = html`${item.place ?? ""}${item.place ? " · " : ""}${amount(item.onHand, item.unit)} expected${item.onLoan ? ` · ${item.onLoan} on loan` : ""}`;
    if (counting === item.id) return html`<li class="ck-row is-open" data-item="${item.id}">
        <div class="ck-row__main"><strong>${item.name}</strong><span>${where}</span></div>
        <div class="ck-count"><label for="ck-count-${item.id}">How many are here?</label>
          <div class="stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="One fewer">${icon("minus")}</button><input id="ck-count-${item.id}" type="number" inputmode="numeric" min="0" max="100000" step="1" value="${seen?.counted ?? item.onHand}" /><button type="button" class="stepper__button" data-step="1" aria-label="One more">${icon("plus")}</button></div>
          <div class="where__buttons"><button type="button" class="button button--primary" data-save-count>Save count</button><button type="button" class="text-link" data-cancel>Cancel</button></div></div></li>`;
    if (reviewing === item.id) return html`<li class="ck-row is-open" data-item="${item.id}">
        <div class="ck-row__main"><strong>${item.name}</strong><span>${where}</span></div>
        <div class="ck-count"><label for="ck-why-${item.id}">Record looks wrong? Say what, so whoever reviews it can fix it.</label><textarea id="ck-why-${item.id}" maxlength="300" rows="2"></textarea>
          <div class="where__buttons"><button type="button" class="button button--primary" data-save-review>Save</button><button type="button" class="text-link" data-cancel>Cancel</button></div></div></li>`;
    if (seen) {
      const what = seen.outcome === "CONFIRMED" ? `Here · ${amount(seen.counted ?? item.onHand, item.unit)}`
        : seen.outcome === "MISMATCH" ? `Count differs · ${seen.counted} of ${item.onHand}` : OUTCOME_LABELS[seen.outcome] ?? seen.outcome;
      return html`<li class="ck-row is-checked ${FINDINGS.has(seen.outcome) ? "is-finding" : ""}" data-item="${item.id}">
        <div class="ck-row__main"><strong>${item.name}</strong><span>${item.place ?? ""}</span></div>
        <p class="ck-row__state"><span class="ck-chip ck-chip--${seen.outcome.toLowerCase()}">${seen.outcome === "CONFIRMED" ? icon("check") : icon("alert")}${what}</span>${pending.has(seen.id) ? html` <span class="cat-row__note">Not saved yet</span>` : ""}
          <button type="button" class="text-link" data-again>Change<span class="visually-hidden"> what you marked for ${item.name}</span></button></p></li>`;
    }
    return html`<li class="ck-row" data-item="${item.id}">
      <div class="ck-row__head"><div class="ck-row__main"><strong>${item.name}</strong><span>${where}</span></div>
        <button type="button" class="icon-button ck-row__more" data-review title="Record looks wrong" aria-label="Record looks wrong for ${item.name}">${icon("dots")}</button></div>
      <div class="ck-row__actions">
        <button type="button" class="button button--primary ck-here" data-here>${icon("check")}Here · ${item.onHand}<span class="visually-hidden"> ${item.name}</span></button>
        <button type="button" class="button button--secondary" data-count>Count differs<span class="visually-hidden"> for ${item.name}</span></button>
        <button type="button" class="button button--secondary" data-missing>Can’t find<span class="visually-hidden"> ${item.name}</span></button>
      </div></li>`;
  };

  root.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button");
    if (!target) return;
    const itemId = target.closest<HTMLElement>("[data-item]")?.dataset.item;
    const item = record.detail.items.find((each) => each.id === itemId);
    if (target.dataset.filter) { filter = target.dataset.filter as typeof filter; return draw(); }
    if (target.dataset.step) {
      const input = target.closest(".stepper")!.querySelector<HTMLInputElement>("input")!;
      input.value = String(Math.max(0, Math.min(100_000, (Number(input.value) || 0) + Number(target.dataset.step))));
      return;
    }
    if (target.hasAttribute("data-cancel")) { counting = null; reviewing = null; return draw(); }
    if (item && target.hasAttribute("data-here")) return see({ itemId: item.id, outcome: "CONFIRMED", expectedOnHand: item.onHand, observedAt: now() });
    if (item && target.hasAttribute("data-missing")) return see({ itemId: item.id, outcome: "CANT_FIND", expectedOnHand: item.onHand, observedAt: now() });
    if (item && target.hasAttribute("data-count")) { counting = item.id; reviewing = null; return draw(); }
    if (item && target.hasAttribute("data-review")) { reviewing = item.id; counting = null; return draw(); }
    if (item && target.hasAttribute("data-again")) { item.observation = null; return draw(); }
    if (item && target.hasAttribute("data-save-count")) {
      const value = Number(root.querySelector<HTMLInputElement>(`#ck-count-${CSS.escape(item.id)}`)!.value);
      if (!Number.isInteger(value) || value < 0 || value > 100_000) { toast("Enter a whole number from 0 to 100000.", "error"); return; }
      counting = null;
      return see(value === item.onHand ? { itemId: item.id, outcome: "CONFIRMED", expectedOnHand: item.onHand, observedAt: now() }
        : { itemId: item.id, outcome: "MISMATCH", expectedOnHand: item.onHand, counted: value, observedAt: now() });
    }
    if (item && target.hasAttribute("data-save-review")) {
      const note = root.querySelector<HTMLTextAreaElement>(`#ck-why-${CSS.escape(item.id)}`)!.value.trim();
      if (!note) { toast("Say what looks wrong, so whoever reviews it knows.", "error"); return; }
      reviewing = null;
      return see({ itemId: item.id, outcome: "NEEDS_REVIEW", note, observedAt: now() });
    }
    if (target.hasAttribute("data-edit-note")) { editingNote = true; await draw(); root.querySelector<HTMLTextAreaElement>("#ck-place-note")?.focus(); return; }
    if (target.hasAttribute("data-cancel-note")) { editingNote = false; return draw(); }
    if (target.hasAttribute("data-save-note")) {
      const note = root.querySelector<HTMLTextAreaElement>("#ck-place-note")!.value.trim() || null;
      record.pending = { ...record.pending, placeNote: note };
      record.detail.audit.placeNote = note;
      editingNote = false;
      await keepAudit(record);
      toast(note ? "Note saved." : "Note removed.");
      void syncNow();
      return draw();
    }
    if (target.hasAttribute("data-resume")) {
      record.pending = { ...record.pending, status: "OPEN" };
      record.detail.audit.status = "OPEN";
      await keepAudit(record);
      void syncNow();
      return draw();
    }
    if (target.hasAttribute("data-pause")) {
      record.pending = { ...record.pending, status: "PAUSED" };
      record.detail.audit.status = "PAUSED";
      await keepAudit(record);
      void syncNow();
      toast("Check paused. Resume it from the Catalog on any device.");
      return navigate("/staff/catalogue");
    }
    if (target.hasAttribute("data-discard-stopped")) {
      if (!window.confirm("Discard what could not be saved? It was never on the server.")) return;
      for (const entry of (await held()).filter((each) => each.state === "stopped")) await dropObservation(entry.id);
      return draw();
    }
    if (target.hasAttribute("data-found")) return openFound();
    if (target.hasAttribute("data-finish")) {
      const left = record.detail.items.filter((each) => !each.observation).length;
      if (!window.confirm(left ? `${plural(left, "item")} ${left === 1 ? "hasn’t" : "haven’t"} been checked. Finish anyway? ${left === 1 ? "It stays" : "They stay"} “not checked” in the summary.` : "Finish this check?")) return;
      record.finishing = true;
      await keepAudit(record);
      await syncNow();
      return checkScreen(who, record.serverId ?? record.id);
    }
  });

  /** Something on the shelf that is not on the list: an item recorded elsewhere (from the saved catalog), or one not in the catalog. */
  const openFound = async () => {
    const saved = await snapshot();
    const listed = new Set(record.detail.items.map((each) => each.id));
    mount(dialog, sheetContent("Not on the list", "What did you find?", html`
      <div class="field"><label for="ck-find">Search the catalog</label><input id="ck-find" type="search" autocomplete="off" placeholder="Name of the item" /></div>
      <ul class="ck-results" id="ck-results"></ul>
      <div class="ck-found-count" id="ck-found-count" hidden></div>
      <details class="ck-unlisted"><summary>It isn’t in the catalog</summary>
        <div class="field"><label for="ck-unlisted-name">What is it?</label><input id="ck-unlisted-name" maxlength="300" autocomplete="off" /></div>
        <div class="where__buttons"><button type="button" class="button button--primary" data-save-unlisted>Save as not in the catalog</button></div>
        <p class="field__hint">Catalogue it later to add it; the check keeps it as a finding.</p>
      </details>`));
    found.open();
    const input = dialog.querySelector<HTMLInputElement>("#ck-find")!;
    const results = dialog.querySelector<HTMLElement>("#ck-results")!;
    const places = saved ? placesOf(saved.places) : new Map();
    finding = { saved, places };
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      const matches = !query || !saved ? [] : saved.items.filter((each) => !listed.has(each.id) && each.status !== "INACTIVE" && `${each.name} ${each.aliases ?? ""}`.toLowerCase().includes(query)).slice(0, 12);
      mount(results, query && !matches.length ? html`<li class="muted">Nothing in the saved catalog matches. If it isn’t in the catalog, say what it is below.</li>`
        : html`${matches.map((each) => html`<li><button type="button" class="ck-result" data-pick="${each.id}"><strong>${each.name}</strong><span>${pathOf(places, each.locationId) ?? "No place recorded"} · ${amount(each.onHand, each.unit)}</span></button></li>`)}`);
    });
    input.focus();
  };
  dialog.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button");
    const countHost = dialog.querySelector<HTMLElement>("#ck-found-count");
    const { saved, places } = finding;
    if (!target || !countHost) return;
    if (target.dataset.pick && saved) {
      const pick = saved.items.find((each) => each.id === target.dataset.pick)!;
      countHost.hidden = false;
      mount(countHost, html`<p><strong>${pick.name}</strong> is recorded at ${pathOf(places, pick.locationId) ?? "no place"}.</p>
        <label for="ck-found-qty">How many are here?</label>
        <div class="stepper"><button type="button" class="stepper__button" data-fstep="-1" aria-label="One fewer">${icon("minus")}</button><input id="ck-found-qty" type="number" inputmode="numeric" min="0" max="100000" step="1" value="1" /><button type="button" class="stepper__button" data-fstep="1" aria-label="One more">${icon("plus")}</button></div>
        <div class="where__buttons"><button type="button" class="button button--primary" data-save-found="${pick.id}">Save as found here</button></div>`);
      countHost.querySelector<HTMLInputElement>("#ck-found-qty")!.focus();
      return;
    }
    if (target.dataset.fstep) {
      const qty = countHost.querySelector<HTMLInputElement>("#ck-found-qty")!;
      qty.value = String(Math.max(0, Math.min(100_000, (Number(qty.value) || 0) + Number(target.dataset.fstep))));
      return;
    }
    if (target.dataset.saveFound && saved) {
      const pick = saved.items.find((each) => each.id === target.dataset.saveFound)!;
      const qty = Number(countHost.querySelector<HTMLInputElement>("#ck-found-qty")!.value);
      if (!Number.isInteger(qty) || qty < 0) { toast("Enter a whole number.", "error"); return; }
      found.close(true);
      filter = "findings";
      return see({ itemId: pick.id, outcome: "FOUND_HERE", expectedOnHand: pick.onHand, counted: qty, observedAt: now() });
    }
    if (target.hasAttribute("data-save-unlisted")) {
      const name = dialog.querySelector<HTMLInputElement>("#ck-unlisted-name")!.value.trim();
      if (!name) { toast("Say what it is.", "error"); return; }
      found.close(true);
      filter = "findings";
      return see({ outcome: "UNLISTED", note: name, observedAt: now() });
    }
  });

  // After each send, the check is read again from the server (with what is still waiting here), so the count is the server's
  // truth plus this device's, never a copy that missed a mark sent in between. One read at a time; a change meanwhile reads again.
  let reading: Promise<void> | null = null;
  let again = false;
  const reread = async (): Promise<void> => {
    if (reading) { again = true; return; }
    reading = (async () => {
      do {
        again = false;
        if (navigator.onLine && await refreshCheck(record.id, who.session.id).catch(() => null)) record = (await audits()).find((each) => each.id === record.id) ?? record;
        // Never under someone's fingers: an open count, reason or note keeps what is typed, and closing it draws the fresh state.
        if (counting === null && reviewing === null && !editingNote) await draw();
      } while (again);
    })();
    try { await reading; } finally { reading = null; }
  };
  onLeave(onSyncChange(() => void reread()));
  await draw();
}

/* ---------- Summary and review ---------- */

/**
 * The end of a check: how it went, suitable to hand over (and print), and the findings to settle. Settling needs a connection and a full
 * sign-in; each one goes through the ledger or the record's own rules on the server, and says so here.
 */
async function summary(root: HTMLElement, who: Signed, detail: AuditDetail, record: AuditRecord | null): Promise<void> {
  const local = record !== null && (record.finishing || !record.serverId);
  const waiting = record ? (await observations()).filter((entry) => entry.auditId === record.id).length : 0;
  let review: Review | null = null;
  // Settling needs a full sign-in: a device on its offline access alone (a lease) is answered 401, and says so below.
  let signIn = who.mode === "lease";
  if (!local && navigator.onLine && !signIn) {
    review = await api<Review>(`/api/staff/audits/${detail.audit.id}/review`).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) signIn = true;
      return null;
    });
  }
  const items = detail.items;
  const checked = items.filter((item) => item.observation);
  const confirmed = checked.filter((item) => item.observation!.outcome === "CONFIRMED").length;
  const findings = review?.discrepancies ?? [...checked.filter((item) => FINDINGS.has(item.observation!.outcome)).map((item) => ({ id: item.observation!.id, name: item.name, outcome: item.observation!.outcome })), ...detail.extras.map((extra) => ({ id: extra.id, name: extra.name, outcome: extra.outcome }))];
  const notChecked = items.filter((item) => !item.observation);
  const minutes = detail.audit.finishedAt ? Math.max(1, Math.round((Date.parse(detail.audit.finishedAt) - Date.parse(detail.audit.startedAt)) / 60_000)) : null;
  const open = review?.discrepancies.filter((entry) => !entry.resolution).length ?? findings.length;
  document.title = `Check of ${detail.audit.place ?? "a place"} · Catalog`;
  mount(root, html`
    <p class="cat-back"><a class="text-link" href="/staff/catalogue" data-route>${icon("back")}Catalog</a></p>
    <header class="ck-head">
      <p class="ck-head__kicker">${detail.audit.status === "FINISHED" ? "Check finished" : "Check finished on this device"}</p>
      <h1>${detail.audit.place ?? "A place"}</h1>
      <p class="ck-head__meta">${detail.audit.owner} · started ${formatDateTime(detail.audit.startedAt)}${detail.audit.finishedAt ? ` · finished ${formatDateTime(detail.audit.finishedAt)}` : ""}${minutes ? ` · ${plural(minutes, "minute")}` : ""}</p>
    </header>
    ${waiting ? html`<p class="ck-note" role="status">${icon("cloudOff")}<span><strong>${plural(waiting, "thing")} you marked ${waiting === 1 ? "is" : "are"} not saved yet.</strong> ${waiting === 1 ? "It is" : "They are"} sent when you’re back online; the check is finished on the server once everything is there.</span></p>` : ""}
    <dl class="ck-stats">
      <div><dt>Expected</dt><dd>${items.length}</dd></div>
      <div><dt>Checked</dt><dd>${checked.length}</dd></div>
      <div><dt>Here</dt><dd>${confirmed}</dd></div>
      <div class="${findings.length ? "is-finding" : ""}"><dt>Findings</dt><dd>${findings.length}</dd></div>
      <div><dt>Not checked</dt><dd>${notChecked.length}</dd></div>
    </dl>
    ${detail.audit.placeNote ? html`<p class="ck-note">${icon("info")}<span><strong>About the place:</strong> ${detail.audit.placeNote}</span></p>` : ""}
    <section class="card cat-card" aria-labelledby="findings-title">
      <div class="card__head"><h2 id="findings-title">Findings</h2>${review && review.discrepancies.length ? html`<span class="muted">${open ? `${open} to settle` : "All settled"}</span>` : ""}</div>
      ${!findings.length ? html`<p class="muted">Everything checked was where it should be, in the expected number.</p>`
        : review ? html`<p class="card__text">Nothing has changed stock yet. Settle each finding: a count is posted as a count, with your name and this check on it.</p><ul class="ck-findings">${review.discrepancies.map(findingRow)}</ul>`
        : html`<ul class="ck-findings">${findings.map((entry) => html`<li class="ck-finding"><strong>${entry.name ?? "Something"}</strong><span>${OUTCOME_LABELS[entry.outcome] ?? entry.outcome}</span></li>`)}</ul>
          <p class="card__text">${signIn ? "Sign in again to settle these." : navigator.onLine && !local ? "The findings could not be loaded. Reload to settle them." : "Settle these once you’re online and signed in."}</p>`}
    </section>
    ${notChecked.length ? html`<details class="ck-notchecked"><summary>Not checked (${notChecked.length})</summary><ul>${notChecked.map((item) => html`<li>${item.name} <span class="muted">· ${item.place ?? ""}</span></li>`)}</ul></details>` : ""}
    <div class="where__buttons ck-summary-actions"><button type="button" class="button button--secondary" data-print>Print summary</button><a class="button button--primary" href="/staff/catalogue" data-route>Back to the Catalog</a></div>`);

  // One listener per screen: redrawing after a finding is settled reuses it.
  if (root.dataset.summary) return;
  root.dataset.summary = "1";
  root.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button");
    if (!target) return;
    if (target.hasAttribute("data-print")) { window.print(); return; }
    const host = target.closest<HTMLElement>("[data-finding]");
    if (!host) return;
    if (target.dataset.step) {
      const input = target.closest(".stepper")!.querySelector<HTMLInputElement>("input")!;
      input.value = String(Math.max(0, Math.min(100_000, (Number(input.value) || 0) + Number(target.dataset.step))));
      return;
    }
    const action = target.dataset.settle;
    if (!action) return;
    const body: Record<string, unknown> = { action };
    if (action === "NO_CHANGE") {
      const note = host.querySelector<HTMLInputElement>("[data-why]")?.value.trim();
      if (!note) { host.querySelector<HTMLInputElement>("[data-why]")?.focus(); toast("Say why it stays as it is.", "error"); return; }
      body.note = note;
    }
    if (target.hasAttribute("data-fresh")) {
      body.counted = Number(host.querySelector<HTMLInputElement>("[data-fresh-count]")!.value);
      body.expectedOnHand = Number(target.dataset.fresh);
    }
    target.setAttribute("disabled", "");
    try {
      await api(`/api/staff/audits/observations/${host.dataset.finding}/resolve`, { method: "POST", body: JSON.stringify(body) });
      toast(RESOLVED_LABELS[action] ?? "Settled.");
      await summary(root, who, detail, record);
    } catch (error) {
      toast(failure(error), "error");
      target.removeAttribute("disabled");
      if (error instanceof ApiError && error.status === 409) await summary(root, who, detail, record);
    }
  });
}

function findingRow(entry: Finding): Html {
  const name = entry.name ?? entry.note ?? "Something";
  const unit = entry.unit ?? "piece";
  const what = entry.outcome === "MISMATCH" ? `Count differs: ${entry.counted} counted, ${entry.expectedOnHand} recorded`
    : entry.outcome === "CANT_FIND" ? `I can’t find it: ${entry.expectedOnHand} recorded`
    : entry.outcome === "FOUND_HERE" ? `Found here: ${entry.counted} seen, recorded at ${entry.recordedPlace ?? "no place"}`
    : entry.outcome === "UNLISTED" ? "Not in the catalog"
    : `Record looks wrong${entry.note ? `: “${entry.note}”` : ""}`;
  if (entry.resolution) return html`<li class="ck-finding is-settled" data-key="${entry.id}"><strong>${name}</strong><span>${what}</span>
      <span class="ck-chip ck-chip--done">${icon("check")}${RESOLVED_LABELS[entry.resolution] ?? entry.resolution}${entry.resolvedBy ? ` by ${entry.resolvedBy}` : ""}</span>${entry.resolutionNote ? html`<span class="muted">${entry.resolutionNote}</span>` : ""}</li>`;
  // A count is the item's whole stock: only one made at its own place can be posted (a few found elsewhere say nothing about the rest).
  const countable = entry.itemId && (entry.outcome === "MISMATCH" || entry.outcome === "CANT_FIND");
  const posted = entry.outcome === "CANT_FIND" ? 0 : entry.counted;
  return html`<li class="ck-finding" data-finding="${entry.id}"><strong>${name}</strong><span>${what}</span>
    ${entry.changedSince && countable ? html`<p class="cat-ready cat-ready--bad">${icon("alert")}<span><strong>Stock changed since this was counted.</strong> ${amount(entry.onHandNow, unit)} recorded now. Count it again and post what you see.</span></p>
      <div class="ck-fresh"><label for="ck-fresh-${entry.id}">How many are there now?</label><div class="stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="One fewer">${icon("minus")}</button><input id="ck-fresh-${entry.id}" data-fresh-count type="number" inputmode="numeric" min="0" max="100000" step="1" value="${entry.onHandNow}" /><button type="button" class="stepper__button" data-step="1" aria-label="One more">${icon("plus")}</button></div>
      <button type="button" class="button button--primary button--sm" data-settle="POSTED_COUNT" data-fresh="${entry.onHandNow}">Post this count</button></div>`
      : countable ? html`<div class="where__buttons"><button type="button" class="button button--primary button--sm" data-settle="POSTED_COUNT">Post count: ${posted}</button>
        ${entry.outcome === "CANT_FIND" ? html`<button type="button" class="button button--secondary button--sm" data-settle="REPORTED">Report its location</button>` : ""}</div>`
      : entry.outcome === "FOUND_HERE" && entry.itemId ? html`<div class="where__buttons"><button type="button" class="button button--primary button--sm" data-settle="MOVED_HERE">Move it here</button>
        <button type="button" class="button button--secondary button--sm" data-settle="REPORTED">Report its location</button></div>` : ""}
    ${entry.outcome === "NEEDS_REVIEW" && entry.itemId ? html`<p><a class="text-link" href="/staff/items?item=${entry.itemId}" data-route>Open the item to fix its record</a></p>` : ""}
    <details class="ck-why"><summary>Leave it as it is</summary>
      <div class="ck-why__form"><label for="ck-why-${entry.id}">Why it stays as it is</label><input id="ck-why-${entry.id}" data-why maxlength="300" />
        <button type="button" class="button button--secondary button--sm" data-settle="NO_CHANGE">No change</button></div></details></li>`;
}
