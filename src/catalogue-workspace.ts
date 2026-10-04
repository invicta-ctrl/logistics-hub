import { captureScreen } from "./catalogue-capture";
import { type Who, identify, prepare, readiness, ready, refreshSnapshot, turnOff, turnOn } from "./catalogue-offline";
import { bindNewPlace, newPlaceForm, placeList, placeOptions } from "./catalogue-places";
import { type Access, type Detail, type Entry, type SessionInfo, type SessionRecord, drop, entries, keep, keepSession, sessions, snapshot } from "./catalogue-store";
import { onSyncChange, sendable, startSending, syncNow } from "./catalogue-sync";
import { BEHAVIOUR_LABELS, BULK_LIMIT, type Behaviour } from "./catalog-policy";
import { photoUrl } from "./item-photo";
import { applyUpdate, canPromptInstall, hasUpdate, isStandalone, onPwaChange, platform, promptInstall, whenIdle } from "./pwa";
import { catalogueShell } from "./catalogue-shell";
import { ApiError, type Html, api, emptyState, failure, formatDateTime, html, icon, mount, navigate, onLeave, plural, toast, units } from "./ui";

/*
 * Catalogue (/staff/catalogue): where a cataloguing session starts, resumes and ends, and the start page of the installed Logistics
 * Catalog. A session is one person walking a shelf; it lives on the server, so it resumes on any device that person signs in on.
 * With offline cataloguing on (V1.6, catalogue-offline.ts) the same page and the capture screen (catalogue-capture.ts) also work
 * without a connection, from what this device saved, and whatever is saved here waits on the device until the server has it.
 */

type Waiting = { id: string; name: string; place: string | null; capturedAt: string; photoId: string | null; onHand: number; unit: string };
type State = { session: SessionInfo | null; others: SessionInfo[]; reviewLater: { total: number; items: Waiting[] } };
type Signed = Exclude<Who, { mode: "closed" } | { mode: "signed-out" }>;
const LAST_PLACE = "catalogue-last-place";

const remembered = (): string | null => { try { return window.localStorage.getItem(LAST_PLACE); } catch { return null; } };
const remember = (id: string) => { try { window.localStorage.setItem(LAST_PLACE, id); } catch { /* a convenience only */ } };
const day = (at: number) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(at));
/** Where sign-in should come back to. */
export const signInHere = (expired = false) => `/staff?${expired ? "expired=1&" : ""}next=${encodeURIComponent(window.location.pathname + window.location.search)}`;

export async function catalogueWorkspace(): Promise<void> {
  let who: Who;
  try {
    who = await identify();
  } catch (error) {
    catalogueShell(null, emptyState("The Catalogue could not be opened", failure(error), html`<a class="button button--secondary" href="/staff/catalogue" data-route>Try again</a>`, "error", 1));
    return;
  }
  if (who.mode === "signed-out") return navigate(signInHere(), true);
  if (who.mode === "closed") return closed(who.access);
  if (who.mode === "signed-in" && (who.session.mustChangePassword || who.session.hub === false)) return navigate("/staff/account", true);
  // From here this member's work is sent whenever it can be, on this page and the capture screen alike.
  startSending({ owner: who.session.id, legacy: who.mode === "signed-in" });
  const open = new URLSearchParams(window.location.search).get("session");
  if (open) return captureScreen(who, open);
  document.title = "Catalogue · Catalog";
  whenIdle(() => true);
  onLeave(() => whenIdle(() => false));
  catalogueShell(who, html`<div id="cat-start" aria-busy="true"><div class="skeleton skeleton--block"></div></div>`, html`
    <h1>Catalogue</h1>
    <p class="cg-hero__lead">Walk a shelf with a phone or tablet: photo, name, how it is used, how many, next.</p>
    ${who.mode === "offline" ? html`<p class="cg-mode" role="status">${icon("cloudOff")}<span><strong>You're offline.</strong> You can keep cataloguing on this device until ${day(who.access.expiresAt)}. What you save here is sent when you're back online.</span></p>` : ""}
    ${who.mode === "lease" ? html`<p class="cg-mode" role="status">${icon("user")}<span><strong>You're signed out.</strong> This device can still catalogue for you until ${day(who.access.expiresAt)}, and sends what you save. Sign in again for Items, Stock and the rest.</span> <a class="cg-mode__action" href="${signInHere()}" data-route>Sign in</a></p>` : ""}`);
  const root = document.querySelector<HTMLElement>("#cat-start")!;
  try {
    const [state, catalog] = await Promise.all([
      who.mode === "offline" ? Promise.resolve(null) : api<State>("/api/staff/catalogue"),
      who.mode === "offline" ? snapshot() : refreshSnapshot()
    ]);
    root.removeAttribute("aria-busy");
    await draw(root, who, state, catalog?.places ?? []);
  } catch (error) {
    root.removeAttribute("aria-busy");
    mount(root, emptyState("The Catalogue could not be opened", failure(error), html`<a class="button button--secondary" href="/staff/catalogue" data-route>Try again</a>`, "error"));
  }
}

/** Offline, with no offline access on this device: nothing can be catalogued until there is a connection. */
async function closed(granted: Access | null): Promise<void> {
  document.title = "Catalogue · Catalog";
  const held = await entries();
  const ended = granted && granted.expiresAt <= Date.now() ? ` Offline cataloguing on this device ended ${day(granted.expiresAt)}.` : "";
  catalogueShell(null, emptyState("The Catalogue needs a connection here",
    `You're offline, and this device isn't set up to catalogue without one.${ended} Connect, sign in, and turn on offline cataloguing on the Catalogue page to use it offline next time.${held.length ? ` ${plural(held.length, "item")} catalogued here ${held.length === 1 ? "is" : "are"} waiting on this device and will be sent once you're back online and signed in.` : ""}`,
    html`<a class="button button--secondary" href="/staff/catalogue" data-route>Try again</a>`, "error", 1));
}

/** The member's open session as this device knows it: one started or opened here (unless finished here), else the server's. */
function current(records: SessionRecord[], owner: string, server: SessionInfo | null): SessionInfo | null {
  const here = records.find((record) => record.owner === owner && !record.finishing && record.detail.session.status === "ACTIVE");
  return here ? { ...here.detail.session, id: here.id } : server;
}

async function draw(root: HTMLElement, who: Signed, state: State | null, places: Parameters<typeof placeList>[0]): Promise<void> {
  const list = placeList(places);
  const records = await sessions();
  const mine = current(records, who.session.id, state?.session ?? null);
  const active = places.filter((place) => place.active);
  const choice = remembered() && list.places.get(remembered()!)?.active ? remembered() : null;
  const online = who.mode !== "offline";
  mount(root, html`
    <div id="cat-held"></div>
    ${mine ? html`<section class="card cat-card" aria-labelledby="resume-title">
        <div class="card__head"><h2 id="resume-title">Your session is open</h2></div>
        <p class="cat-card__place">${icon("pin")}<span>${mine.place ?? "No place"}</span></p>
        <p class="card__text">${plural(mine.saved, "item")} saved${mine.reviewLater ? `, ${mine.reviewLater} to review later` : ""}. Started ${formatDateTime(mine.startedAt)}. It stays open on every device you sign in on until you finish it.</p>
        <div class="where__buttons"><a class="button button--primary button--lg" href="/staff/catalogue?session=${mine.id}" data-route>Resume cataloguing ${icon("next")}</a></div>
      </section>`
      : active.length ? html`<section class="card cat-card" aria-labelledby="start-title">
        <div class="card__head"><h2 id="start-title">Start cataloguing</h2></div>
        <p class="card__text">Choose where you are standing. It stays chosen for every item until you change it, and what each item is used for is still your call, one at a time.</p>
        <div class="field"><label for="start-place">Place</label><select id="start-place">${placeOptions(list, choice)}</select></div>
        ${who.mode === "signed-in" ? html`<p><button type="button" class="text-link" data-new-place-toggle aria-expanded="false" aria-controls="start-new">${icon("plus")} New place</button></p>
          <div id="start-new">${newPlaceForm(list, choice)}</div>` : html`<p class="field__hint">Adding a new place needs a connection and a sign-in.</p>`}
        <div class="form-alert" id="start-alert" role="alert" hidden></div>
        <div class="where__buttons"><button class="button button--primary button--lg" type="button" id="start-go">Start cataloguing ${icon("next")}</button></div>
      </section>`
      : html`<section class="card cat-card">${emptyState("Add a place first", "Cataloguing records where each item is kept. Add the shelf or cabinet you are standing at, then start.", who.mode === "signed-in" ? html`<a class="button button--primary" href="/staff/locations" data-route>${icon("pin")}Add a place</a>` : "", "", 2)}</section>`}
    <div id="cat-device"></div>
    ${state && who.mode === "signed-in" && state.others.length ? html`<section class="cat-others" aria-labelledby="others-title"><h2 id="others-title">Cataloguing now</h2>
      <ul class="plain-list">${state.others.map((other) => html`<li>${icon("user")}<span><strong>${other.owner}</strong> in ${other.place ?? "no place"} · ${plural(other.saved, "item")} saved</span></li>`)}</ul></section>` : ""}
    ${state && who.mode === "signed-in" ? html`<section class="cat-review" aria-labelledby="review-title"><h2 id="review-title">Review later${state.reviewLater.total ? html` <span class="view-tab__count">${state.reviewLater.total}</span>` : ""}</h2>
      ${state.reviewLater.total ? html`<p class="card__text">Counted and placed, but nobody has decided how they are used. They stay out of the Lending Hub and Self-Service until someone does.</p>
        <ul class="cat-rows">${state.reviewLater.items.map(reviewRow)}</ul>
        ${state.reviewLater.total > state.reviewLater.items.length ? html`<p class="muted">Showing the newest ${state.reviewLater.items.length}. <a class="text-link" href="/staff/items?view=review" data-route>See them all under Items</a>.</p>` : ""}`
        : html`<p class="muted">Nothing is waiting for a decision.</p>`}
    </section>` : html`<p class="muted cat-later">Who else is cataloguing, and the items waiting for a decision, show when you're signed in and online.</p>`}`);

  const drawHeld = async () => mount(root.querySelector<HTMLElement>("#cat-held")!, heldList(await entries(), who.session.id, who.mode === "signed-in", online));
  await drawHeld();
  onLeave(onSyncChange(() => void drawHeld()));
  bindHeld(root, drawHeld);
  // Offline, the note above says all there is to say about this device, and installing needs a connection.
  if (who.mode !== "offline") void deviceCard(root.querySelector<HTMLElement>("#cat-device")!, who);
  if (mine || !active.length) return;

  const select = root.querySelector<HTMLSelectElement>("#start-place")!;
  const alert = root.querySelector<HTMLElement>("#start-alert")!;
  const go = root.querySelector<HTMLButtonElement>("#start-go")!;
  if (who.mode === "signed-in") bindNewPlace(root, async (id) => {
    // The new place joins the list and is chosen: the next step is to start in it.
    const fresh = await refreshSnapshot();
    mount(select, placeOptions(placeList(fresh?.places ?? []), id));
    select.value = id;
    toast("Place added.");
    select.focus();
  });
  go.addEventListener("click", async () => {
    go.disabled = true;
    setAlert(alert, "");
    remember(select.value);
    try {
      navigate(`/staff/catalogue?session=${await start(who, select.value, list.paths.get(select.value) ?? null)}`);
    } catch (error) {
      setAlert(alert, failure(error));
      go.disabled = false;
    }
  });
}

/**
 * Starts a session in `placeId`. Online the server makes it; without a connection (or with one, but signed out) this device starts it
 * under an id it proposes, and the server makes it under that id when the first capture is sent (catalogue-sync.ts).
 */
async function start(who: Signed, placeId: string, place: string | null): Promise<string> {
  if (who.mode === "signed-in") {
    const started = await api<{ id: string }>("/api/staff/catalogue/sessions", { method: "POST", body: JSON.stringify({ locationId: placeId }) });
    return started.id;
  }
  const id = `CS-${crypto.randomUUID()}`;
  const detail: Detail = { session: { id, locationId: placeId, place, status: "ACTIVE", startedAt: new Date().toISOString(), finishedAt: null, saved: 0, reviewLater: 0, owner: who.session.displayName, mine: true }, counts: {}, recent: [] };
  await keepSession({ id, owner: who.session.id, serverId: null, detail, finishing: false });
  return id;
}

const setAlert = (element: HTMLElement, message: string) => { element.hidden = !message; element.textContent = message; };

/**
 * What this device still holds that the server does not have: this member's, with what each is waiting for, and the rest counted (another
 * member's, and on a lease, what a V1.5 page left without an owner: only a full sign-in sends those).
 */
function heldList(all: Entry[], owner: string, legacy: boolean, online: boolean): Html {
  const ours = all.filter((entry) => entry.owner === owner || (!entry.owner && legacy));
  const others = all.length - ours.length;
  if (!all.length) return html``;
  // Offline, the note above already says they are sent when the connection is back; only what needs a person is spelled out per item.
  return html`<section class="callout cat-held" role="status" aria-labelledby="held-title">${icon("clock")}<div>
    <p id="held-title"><strong>${ours.length ? `${plural(ours.length, "item")} on this device ${ours.length === 1 ? "has" : "have"} not been saved to the server.` : "Items on this device are waiting for their member."}</strong>
      ${ours.length && online ? ` ${ours.length === 1 ? "It is" : "They are"} being sent.` : ""}</p>
    ${ours.length ? html`<ul>${ours.map((entry) => html`<li>${String(entry.body.name)}${entry.state === "stopped"
      ? html`: <span class="cat-row__note is-bad">${entry.message ?? "Needs you."}</span> ${entry.matches ? html`<button type="button" class="text-link" data-held-separate="${entry.id}">Save as a separate item</button>` : ""} <button type="button" class="text-link" data-held-discard="${entry.id}">${entry.itemId ? "Keep without photo" : "Discard"}</button>`
      : entry.itemId ? " (saved, photo to send)" : ""}</li>`)}</ul>` : ""}
    ${others ? html`<p>${plural(others, "item")} another member catalogued here ${others === 1 ? "is" : "are"} waiting for them to sign in on this device. <button type="button" class="text-link" data-held-others>Discard ${others === 1 ? "it" : "them"}</button></p>` : ""}
  </div></section>`;
}

function bindHeld(root: HTMLElement, redraw: () => Promise<void>): void {
  root.querySelector("#cat-held")!.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-held-separate], [data-held-discard], [data-held-others]");
    if (!target) return;
    const all = await entries();
    if (target.dataset.heldOthers !== undefined) {
      const others = all.filter((entry) => !sendable(entry));
      if (!window.confirm(`Discard ${plural(others.length, "item")} another member catalogued on this device? ${others.length === 1 ? "It was" : "They were"} never saved to the server.`)) return;
      for (const entry of others) await drop(entry.id);
    } else {
      const entry = all.find((each) => each.id === (target.dataset.heldSeparate ?? target.dataset.heldDiscard));
      if (!entry) return;
      if (target.dataset.heldSeparate) {
        Object.assign(entry, { state: "waiting", message: null, body: { ...entry.body, acknowledged: (entry.matches ?? []).map((match) => match.id) }, matches: null });
        await keep(entry);
        void syncNow();
      } else {
        if (!window.confirm(entry.itemId ? "Keep this item without its photo?" : `Discard ${String(entry.body.name)}? It was never saved.`)) return;
        await drop(entry.id);
        void syncNow();
      }
    }
    await redraw();
  });
}

/* ---------- This device: offline cataloguing and installing ---------- */

/** The steps that install the Catalog on this kind of device, as the platforms word them today (docs/visual-research/v1.6.md). */
function installSteps(): Html[] {
  const kind = platform();
  if (kind === "ios") return [
    html`Open this page in <strong>Safari</strong>.`,
    html`Tap ${icon("share")}<strong>Share</strong> (on newer iPhones it's in the ${icon("dots")} menu beside the address bar; tap <strong>View More</strong> if the next step isn't listed).`,
    html`Tap <strong>Add to Home Screen</strong>, keep <strong>Open as Web App</strong> on where it's shown, then tap <strong>Add</strong>.`,
    html`Open <strong>Catalog</strong> from your Home Screen while you're online, sign in, and turn on offline cataloguing there.`,
    html`Wait for <strong>Ready for offline cataloguing</strong> before you rely on it without a connection.`
  ];
  if (kind === "android") return [
    html`Open this page in <strong>Chrome</strong>.`,
    html`Tap <strong>Install</strong> above if it's there. If not, tap the Chrome ${icon("more")} menu, then <strong>Add to Home screen</strong> and <strong>Install</strong> (some phones say <strong>Install app</strong>). Don't choose <strong>Create shortcut</strong>.`,
    html`Open <strong>Catalog</strong> from your home screen or app drawer while you're online, and turn on offline cataloguing.`,
    html`Wait for <strong>Ready for offline cataloguing</strong> before you rely on it without a connection.`
  ];
  return [
    html`Use <strong>Chrome</strong> or <strong>Edge</strong>.`,
    html`Click the install icon at the right of the address bar. Or open the browser menu: in Chrome, <strong>Cast, save, and share</strong> › <strong>Install Logistics Catalog</strong>; in Edge, <strong>Apps</strong> › <strong>Install Logistics Catalog</strong>.`,
    html`Open <strong>Logistics Catalog</strong>, and turn on offline cataloguing there.`
  ];
}

async function deviceCard(host: HTMLElement, who: Signed): Promise<void> {
  let granted = who.access;
  let state = await readiness(granted);
  let preparing = false;
  let problem = "";
  const ios = platform() === "ios";

  const status = (): Html => {
    if (!granted) {
      if (state.needsHomeScreen) return html`<p class="card__text">On iPhone and iPad, offline cataloguing works from the Home Screen app, not from a Safari tab. Add the Catalog to your Home Screen (below), open it, and turn this on there.</p>`;
      return html`<p class="card__text">Keeps the catalog and your session on this device for a week, so you can keep cataloguing where there's no signal. What you save offline is sent when you're back online. Your password is never kept on the device.</p>
        ${who.mode === "signed-in" ? html`<div class="where__buttons"><button type="button" class="button button--primary" data-offline-on>${icon("cloudOff")}Turn on offline cataloguing</button></div>` : ""}`;
    }
    if (!state.storage) return html`<p class="cat-ready cat-ready--bad">${icon("alert")}<span><strong>This browser won't keep data for the Catalogue.</strong> It may be a private window. Open the Catalogue in a normal window to catalogue offline.</span></p>`;
    if (state.needsHomeScreen) return html`<p class="cat-ready cat-ready--bad">${icon("alert")}<span><strong>Open the Catalog from your Home Screen.</strong> On iPhone and iPad a Safari tab keeps its data apart from the Home Screen app, so offline cataloguing works from the app.</span></p>`;
    const until = html`Works without a connection until ${day(granted.expiresAt)}.${state.savedAt ? ` Catalog saved ${day(Date.parse(state.savedAt))}.` : ""}`;
    if (ready(state)) return html`<p class="cat-ready cat-ready--ok">${icon("check")}<span><strong>Ready for offline cataloguing</strong> ${until} What you save offline is sent when you're back online.</span></p>
      ${granted.expiresAt - Date.now() < 24 * 60 * 60 * 1000 ? html`<p class="card__text">Offline cataloguing here ends soon. Open the Catalogue while you're signed in and online to keep it on for another week.</p>` : ""}
      ${state.persisted ? "" : html`<p class="card__text">The browser may clear saved data if this device runs out of space, so send your work when you can.</p>`}`;
    if (problem) return html`<p class="cat-ready cat-ready--bad">${icon("alert")}<span><strong>Not ready for offline cataloguing.</strong> ${problem}</span></p>
      ${who.mode !== "offline" ? html`<div class="where__buttons"><button type="button" class="button button--secondary" data-offline-retry>${icon("refresh")}Try again</button></div>` : ""}`;
    return html`<p class="cat-ready" aria-live="polite">${icon("refresh")}<span><strong>Getting ready for offline cataloguing…</strong> Keep this page open for a moment while the Catalogue and the catalog are saved on this device.</span></p>`;
  };

  const install = (): Html => isStandalone() ? html`` : html`<details class="cat-install"${!granted && ios ? html` open` : ""}>
      <summary>${icon("install")}Install the Catalog on this ${ios || platform() === "android" ? "phone or tablet" : "computer"}</summary>
      ${ios ? "" : html`<p class="card__text">It opens straight to the Catalogue, like an app, and works best offline.</p>`}
      ${canPromptInstall() ? html`<div class="where__buttons"><button type="button" class="button button--secondary" data-install>${icon("install")}Install</button></div>` : ""}
      <ol class="cat-steps">${installSteps().map((step) => html`<li>${step}</li>`)}</ol>
    </details>`;

  const render = () => mount(host, html`<section class="card cat-card cat-device" aria-labelledby="device-title">
      <div class="card__head"><h2 id="device-title">Offline cataloguing on this device</h2></div>
      ${status()}
      ${hasUpdate() ? html`<p class="card__text">A new version of the Catalogue is ready. <button type="button" class="text-link" data-update>Update now</button></p>` : ""}
      ${granted ? html`<p class="card__text"><button type="button" class="text-link" data-offline-off>Turn off offline cataloguing</button></p>` : ""}
      ${install()}
    </section>`);

  /** Saves what offline cataloguing needs, then says how it went. */
  const getReady = async () => {
    preparing = true;
    problem = "";
    render();
    await prepare();
    state = await readiness(granted);
    preparing = false;
    if (!ready(state) && state.storage && !state.needsHomeScreen) {
      problem = !("serviceWorker" in navigator) ? "This browser can't keep the Catalogue for use without a connection. Use Chrome, Edge or Safari."
        : !state.screens ? "The Catalogue's screens could not be saved on this device. Check the connection and try again."
        : "The catalog could not be saved on this device. Check the connection and try again.";
    }
    render();
  };

  host.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-offline-on], [data-offline-off], [data-offline-retry], [data-install], [data-update]");
    if (!target || target.disabled) return;
    if (target.dataset.install !== undefined) { await promptInstall(); render(); return; }
    if (target.dataset.update !== undefined) { applyUpdate(); return; }
    target.disabled = true;
    try {
      if (target.dataset.offlineOff !== undefined) {
        if (!window.confirm("Turn off offline cataloguing on this device? Anything not yet sent stays here and is sent the next time you're signed in.")) { target.disabled = false; return; }
        await turnOff();
        granted = null;
        toast("Offline cataloguing is off on this device.");
        state = await readiness(granted);
        render();
        return;
      }
      if (target.dataset.offlineOn !== undefined) granted = await turnOn();
      await getReady();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : failure(error), "error");
      target.disabled = false;
    }
  });
  onLeave(onPwaChange(render));

  render();
  // A device with offline cataloguing on keeps itself ready whenever it opens online: a new version's screens, the latest catalog.
  if (granted && who.mode !== "offline" && !preparing && !ready(state)) void getReady();
}

function reviewRow(item: Waiting): Html {
  return html`<li class="cat-row" data-key="${item.id}">
    ${item.photoId ? html`<img class="cat-row__thumb" src="${photoUrl(item.photoId, "thumb")}" alt="" width="44" height="44" loading="lazy" decoding="async" />` : html`<span class="cat-row__thumb cat-row__thumb--none">${icon("box")}</span>`}
    <span class="cat-row__text"><strong>${item.name}</strong><span>${item.onHand} ${units(item.onHand, item.unit)}${item.place ? ` · ${item.place}` : ""}</span></span>
    <span class="cat-row__state"><a class="button button--secondary button--sm" href="/staff/items?item=${item.id}" data-route>Decide<span class="visually-hidden"> about ${item.name}</span></a></span></li>`;
}

/**
 * The end of a session (or someone else's, read-only): how it went, and the one step that makes its classified items official.
 * `onDevice` counts what was finished here but is still on this device; signing items off waits until they are all on the server.
 */
export function finishedView(root: HTMLElement, detail: Detail, onDevice = 0, canSignOff = true): void {
  const { session, counts } = detail;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const done = session.status === "FINISHED";
  mount(root, html`
    <header class="page-header">
      <div class="page-header__title"><h1>${done ? "Cataloguing finished" : `${session.owner} is cataloguing`}</h1><p>${session.place ?? "No place"} · started ${formatDateTime(session.startedAt)}</p></div>
      <div class="page-header__actions"><a class="button button--secondary" href="/staff/catalogue" data-route>Back to Catalogue</a></div>
    </header>
    <section class="card cat-card" aria-labelledby="sum-title"><div class="card__head"><h2 id="sum-title">${plural(total, "item")} ${onDevice ? "catalogued" : "saved"}</h2></div>
      ${total ? html`<ul class="plain-list">${(Object.keys(BEHAVIOUR_LABELS) as Behaviour[]).filter((key) => counts[key]).map((key) => html`<li><span class="cat-count">${counts[key]}</span> ${BEHAVIOUR_LABELS[key]}</li>`)}</ul>` : html`<p class="muted">Nothing was saved in this session.</p>`}
      ${onDevice ? html`<p class="cat-ready">${icon("cloudOff")}<span><strong>${plural(onDevice, "item")} ${onDevice === 1 ? "is" : "are"} not saved yet.</strong> ${onDevice === 1 ? "It waits" : "They wait"} on this device and ${onDevice === 1 ? "is" : "are"} sent when you're back online; the session is finished on the server once ${onDevice === 1 ? "it is" : "they are"} all there.</span></p>` : ""}
      ${counts.REVIEW_LATER ? html`<p class="card__text">${plural(counts.REVIEW_LATER, "item")} still ${counts.REVIEW_LATER === 1 ? "needs" : "need"} a decision. They stay out of the Lending Hub and Self-Service until someone makes it.</p>` : ""}
    </section>
    ${done && session.mine && canSignOff && !onDevice ? html`<section class="card cat-card" id="cat-review" aria-labelledby="rev-title"><div class="card__head"><h2 id="rev-title">Make them official</h2></div>
      <p class="card__text" id="rev-text">Checking what is waiting…</p>
      <div class="form-alert" id="rev-alert" role="alert" hidden></div>
      <div class="where__buttons"><button type="button" class="button button--primary" id="rev-go" hidden></button></div></section>` : ""}
    <div class="where__buttons">${done ? html`<a class="button button--primary" href="/staff/catalogue" data-route>Start another session</a>` : ""}${canSignOff ? html`<a class="button button--secondary" href="/staff/items" data-route>See them under Items</a>` : ""}</div>`);
  if (done && session.mine && canSignOff && !onDevice) void offerReview(root, session.id);
}

/** Items captured and classified at the shelf are not yet signed off for Self-Service; one deliberate step does that, in pieces of 50. */
async function offerReview(root: HTMLElement, id: string): Promise<void> {
  const text = root.querySelector<HTMLElement>("#rev-text")!;
  const go = root.querySelector<HTMLButtonElement>("#rev-go")!;
  const alert = root.querySelector<HTMLElement>("#rev-alert")!;
  try {
    const { items } = await api<{ items: Array<{ id: string; updatedAt: string | null }> }>(`/api/staff/catalogue/sessions/${id}/unreviewed`);
    if (!items.length) { text.textContent = "Nothing here is waiting for sign-off."; return; }
    text.textContent = `${plural(items.length, "item")} you classified ${items.length === 1 ? "is" : "are"} saved but not marked reviewed, so Self-Service does not offer ${items.length === 1 ? "it" : "them"} yet. Check them under Items, or mark them all reviewed now.`;
    go.hidden = false;
    go.textContent = `Mark ${plural(items.length, "item")} reviewed`;
    go.addEventListener("click", async () => {
      go.disabled = true;
      setAlert(alert, "");
      let applied = 0;
      const skipped: string[] = [];
      try {
        for (let at = 0; at < items.length; at += BULK_LIMIT) {
          const answer = await api<{ applied: number; skipped: Array<{ name: string; reason: string }> }>("/api/staff/items/bulk", { method: "POST", body: JSON.stringify({ action: "REVIEWED", items: items.slice(at, at + BULK_LIMIT) }) });
          applied += answer.applied;
          skipped.push(...answer.skipped.map((entry) => `${entry.name}: ${entry.reason}`));
          go.textContent = `Marking… ${Math.min(items.length, at + BULK_LIMIT)} of ${items.length}`;
        }
        text.textContent = `${plural(applied, "item")} marked reviewed.${skipped.length ? ` ${plural(skipped.length, "item")} skipped: ${skipped.slice(0, 3).join("; ")}${skipped.length > 3 ? "…" : ""}` : ""}`;
        go.hidden = true;
        toast(`${plural(applied, "item")} marked reviewed.`);
      } catch (error) {
        setAlert(alert, failure(error));
        go.disabled = false;
        go.textContent = "Try again";
      }
    });
  } catch (error) {
    text.textContent = error instanceof ApiError ? error.message : "Could not check what is waiting.";
  }
}
