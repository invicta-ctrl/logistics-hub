import { type Detail, type SessionInfo, captureScreen } from "./catalogue-capture";
import { type Entry, drop, entries } from "./catalogue-outbox";
import { bindNewPlace, newPlaceForm, placeList, placeOptions } from "./catalogue-places";
import { BEHAVIOUR_LABELS, BULK_LIMIT, type Behaviour } from "./catalog-policy";
import { photoUrl } from "./item-photo";
import { loadSession, shell } from "./staff";
import type { PlaceRow, Session } from "./staff";
import { ApiError, type Html, api, emptyState, failure, formatDateTime, html, icon, mount, navigate, plural, toast, units } from "./ui";

/*
 * Catalogue (/staff/catalogue): where a cataloguing session starts, resumes and ends. A session is one person walking a shelf; it
 * lives on the server, so it resumes on any device that person signs in on. The capture screen itself is catalogue-capture.ts.
 */

type Waiting = { id: string; name: string; place: string | null; capturedAt: string; photoId: string | null; onHand: number; unit: string };
type State = { session: SessionInfo | null; others: SessionInfo[]; reviewLater: { total: number; items: Waiting[] } };
const LAST_PLACE = "catalogue-last-place";

const remembered = (): string | null => { try { return window.localStorage.getItem(LAST_PLACE); } catch { return null; } };
const remember = (id: string) => { try { window.localStorage.setItem(LAST_PLACE, id); } catch { /* a convenience only */ } };

export async function catalogueWorkspace(): Promise<void> {
  const session = await loadSession("items");
  if (!session) return;
  const open = new URLSearchParams(window.location.search).get("session");
  if (open) return captureScreen(session, open);
  document.title = "Catalogue · Staff workspace";
  shell(session, "items", html`
    <header class="page-header">
      <div class="page-header__title"><h1>Catalogue</h1><p>Walk a shelf with a phone or tablet: photo, name, how it is used, how many, next.</p></div>
      <div class="page-header__actions"><a class="button button--secondary" href="/staff/items" data-route>${icon("box")}Items</a></div>
    </header>
    <div id="cat-start" aria-busy="true"><div class="skeleton skeleton--block"></div></div>`);
  const root = document.querySelector<HTMLElement>("#cat-start")!;
  try {
    const [state, locations, held] = await Promise.all([api<State>("/api/staff/catalogue"), api<{ locations: PlaceRow[] }>("/api/staff/locations"), entries()]);
    root.removeAttribute("aria-busy");
    draw(root, state, locations.locations, held);
  } catch (error) {
    root.removeAttribute("aria-busy");
    mount(root, emptyState("The Catalogue could not be opened", failure(error), html`<a class="button button--secondary" href="/staff/catalogue" data-route>Try again</a>`, "error"));
  }
}

function draw(root: HTMLElement, state: State, rows: PlaceRow[], held: Entry[]): void {
  const list = placeList(rows);
  const mine = state.session;
  const active = rows.filter((row) => row.active);
  const choice = remembered() && list.places.get(remembered()!)?.active ? remembered() : null;
  mount(root, html`
    ${held.length ? html`<section class="callout cat-held" role="status" aria-labelledby="held-title">${icon("alert")}<div><p id="held-title"><strong>${plural(held.length, "item")} on this device ${held.length === 1 ? "has" : "have"} not been saved to the server.</strong></p>
      <ul>${held.map((entry) => html`<li>${String(entry.body.name)}${entry.itemId ? " (saved, photo not sent)" : ""}: ${entry.sessionId === mine?.id ? html`<a class="text-link" href="/staff/catalogue?session=${mine.id}" data-route>open the session to send ${held.length === 1 ? "it" : "them"}</a>` : html`its session is finished, so it cannot be sent. <button type="button" class="text-link" data-discard-held="${entry.id}">Discard</button>`}</li>`)}</ul></div></section>` : ""}
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
        <p><button type="button" class="text-link" data-new-place-toggle aria-expanded="false" aria-controls="start-new">${icon("plus")} New place</button></p>
        <div id="start-new">${newPlaceForm(list, choice)}</div>
        <div class="form-alert" id="start-alert" role="alert" hidden></div>
        <div class="where__buttons"><button class="button button--primary button--lg" type="button" id="start-go">Start cataloguing ${icon("next")}</button></div>
      </section>`
      : html`<section class="card cat-card">${emptyState("Add a place first", "Cataloguing records where each item is kept. Add the shelf or cabinet you are standing at, then start.", html`<a class="button button--primary" href="/staff/locations" data-route>${icon("pin")}Add a place</a>`, "", 2)}</section>`}
    ${state.others.length ? html`<section class="cat-others" aria-labelledby="others-title"><h2 id="others-title">Cataloguing now</h2>
      <ul class="plain-list">${state.others.map((other) => html`<li>${icon("user")}<span><strong>${other.owner}</strong> in ${other.place ?? "no place"} · ${plural(other.saved, "item")} saved</span></li>`)}</ul></section>` : ""}
    <section class="cat-review" aria-labelledby="review-title"><h2 id="review-title">Review later${state.reviewLater.total ? html` <span class="view-tab__count">${state.reviewLater.total}</span>` : ""}</h2>
      ${state.reviewLater.total ? html`<p class="card__text">Counted and placed, but nobody has decided how they are used. They stay out of the Lending Hub and Self-Service until someone does.</p>
        <ul class="cat-rows">${state.reviewLater.items.map(reviewRow)}</ul>
        ${state.reviewLater.total > state.reviewLater.items.length ? html`<p class="muted">Showing the newest ${state.reviewLater.items.length}. <a class="text-link" href="/staff/items?view=review" data-route>See them all under Items</a>.</p>` : ""}`
        : html`<p class="muted">Nothing is waiting for a decision.</p>`}
    </section>`);

  root.querySelector("[data-discard-held]")?.closest("section")?.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-discard-held]");
    const entry = held.find((each) => each.id === button?.dataset.discardHeld);
    if (!button || !entry || !window.confirm(`Discard ${String(entry.body.name)}? It was never saved.`)) return;
    await drop(entry.id);
    button.closest("li")!.remove();
  });
  if (mine || !active.length) return;
  const select = root.querySelector<HTMLSelectElement>("#start-place")!;
  const alert = root.querySelector<HTMLElement>("#start-alert")!;
  const go = root.querySelector<HTMLButtonElement>("#start-go")!;
  bindNewPlace(root, async (id) => {
    // The new place joins the list and is chosen: the next step is to start in it.
    const fresh = await api<{ locations: PlaceRow[] }>("/api/staff/locations");
    const next = placeList(fresh.locations);
    mount(select, placeOptions(next, id));
    select.value = id;
    toast("Place added.");
    select.focus();
  });
  go.addEventListener("click", async () => {
    go.disabled = true;
    setAlert(alert, "");
    try {
      remember(select.value);
      const started = await api<{ id: string; resumed: boolean }>("/api/staff/catalogue/sessions", { method: "POST", body: JSON.stringify({ locationId: select.value }) });
      navigate(`/staff/catalogue?session=${started.id}`);
    } catch (error) {
      setAlert(alert, failure(error));
      go.disabled = false;
    }
  });
}

const setAlert = (element: HTMLElement, message: string) => { element.hidden = !message; element.textContent = message; };

function reviewRow(item: Waiting): Html {
  return html`<li class="cat-row" data-key="${item.id}">
    ${item.photoId ? html`<img class="cat-row__thumb" src="${photoUrl(item.photoId, "thumb")}" alt="" width="44" height="44" loading="lazy" decoding="async" />` : html`<span class="cat-row__thumb cat-row__thumb--none">${icon("box")}</span>`}
    <span class="cat-row__text"><strong>${item.name}</strong><span>${item.onHand} ${units(item.onHand, item.unit)}${item.place ? ` · ${item.place}` : ""}</span></span>
    <span class="cat-row__state"><a class="button button--secondary button--sm" href="/staff/items?item=${item.id}" data-route>Decide<span class="visually-hidden"> about ${item.name}</span></a></span></li>`;
}

/** The end of a session (or someone else's, read-only): how it went, and the one step that makes its classified items official. */
export function finishedView(root: HTMLElement, detail: Detail): void {
  const { session, counts } = detail;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const done = session.status === "FINISHED";
  mount(root, html`
    <header class="page-header">
      <div class="page-header__title"><h1>${done ? "Cataloguing finished" : `${session.owner} is cataloguing`}</h1><p>${session.place ?? "No place"} · started ${formatDateTime(session.startedAt)}</p></div>
      <div class="page-header__actions"><a class="button button--secondary" href="/staff/catalogue" data-route>Back to Catalogue</a></div>
    </header>
    <section class="card cat-card" aria-labelledby="sum-title"><div class="card__head"><h2 id="sum-title">${plural(total, "item")} saved</h2></div>
      ${total ? html`<ul class="plain-list">${(Object.keys(BEHAVIOUR_LABELS) as Behaviour[]).filter((key) => counts[key]).map((key) => html`<li><span class="cat-count">${counts[key]}</span> ${BEHAVIOUR_LABELS[key]}</li>`)}</ul>` : html`<p class="muted">Nothing was saved in this session.</p>`}
      ${counts.REVIEW_LATER ? html`<p class="card__text">${plural(counts.REVIEW_LATER, "item")} still ${counts.REVIEW_LATER === 1 ? "needs" : "need"} a decision. They stay out of the Lending Hub and Self-Service until someone makes it.</p>` : ""}
    </section>
    ${done && session.mine ? html`<section class="card cat-card" id="cat-review" aria-labelledby="rev-title"><div class="card__head"><h2 id="rev-title">Make them official</h2></div>
      <p class="card__text" id="rev-text">Checking what is waiting…</p>
      <div class="form-alert" id="rev-alert" role="alert" hidden></div>
      <div class="where__buttons"><button type="button" class="button button--primary" id="rev-go" hidden></button></div></section>` : ""}
    <div class="where__buttons">${done ? html`<a class="button button--primary" href="/staff/catalogue" data-route>Start another session</a>` : ""}<a class="button button--secondary" href="/staff/items" data-route>See them under Items</a></div>`);
  if (done && session.mine) void offerReview(root, session.id);
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
