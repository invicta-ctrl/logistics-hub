import { compact, words } from "./duplicates";
import { RELATION_CHOICES, type RelationKind, type RelationSide } from "./relation-policy";
import { ApiError, type Html, api, failure, html, icon, mount, setMessage, toast } from "./ui";

/*
 * Linked items (V1.11) on an item's record: Used with, Alternative to, Replaced by / Replaces, Holds / Goes in. Each link reads from
 * this item's side. Linking changes nothing about either item; it helps global search and whoever opens either record next.
 */

export type ItemLink = { id: string; name: string; status: string; place: string | null; kind: RelationKind; side: RelationSide; words: string; createdAt: string; createdBy: string | null };
export type LinkCandidate = { id: string; name: string; place: string | null; status: string };
type Options = { itemId: () => string; links: () => ItemLink[]; candidates: () => LinkCandidate[]; changed: (links: ItemLink[]) => void };

/** Items offered while typing the other item's name: every word must start a word of the name (or the ID), at most this many. */
const PICKS = 6;

export function bindItemLinks(host: HTMLElement, options: Options): { render: () => void } {
  let adding = false;
  let choice = 0;
  let query = "";
  let picked: LinkCandidate | null = null;
  let busy = false;

  const matches = (): LinkCandidate[] => {
    const tokens = words(query);
    const id = compact(query);
    if (!tokens.length) return [];
    const linked = new Set([options.itemId(), ...options.links().map((link) => link.id)]);
    return options.candidates().filter((candidate) => !linked.has(candidate.id) && (compact(candidate.id) === id || tokens.every((token) => words(candidate.name).some((word) => word.startsWith(token))))).slice(0, PICKS);
  };

  const listMarkup = (links: ItemLink[]): Html => links.length
    ? html`<ul class="item-links__list">${links.map((link) => html`<li class="item-links__row" data-key="${link.id}">
        <span class="item-links__words">${link.words}</span>
        <span class="item-links__item"><a class="text-link" href="/staff/items?item=${encodeURIComponent(link.id)}" data-route>${link.name}</a>
          <span class="cell-sub">${[link.status === "INACTIVE" ? "Inactive" : null, link.place].filter(Boolean).join(" · ") || "No place set"}</span></span>
        <button type="button" class="icon-button" data-link-remove="${link.id}" aria-label="Remove the link: ${link.words} ${link.name}">${icon("close")}</button>
      </li>`)}</ul>`
    : html`<p class="card__text">None yet. Link what is used together, an alternative, a replacement, or a container and what goes in it; search then finds one from the other.</p>`;

  const picksMarkup = (): Html => {
    const found = matches();
    if (!query.trim()) return html``;
    if (!found.length) return html`<p class="field__hint">No other item matches “${query}”.</p>`;
    return html`<div class="item-links__picks" role="group" aria-label="Matching items">${found.map((candidate) => html`<button type="button" class="item-links__pick" data-link-pick="${candidate.id}" aria-pressed="${picked?.id === candidate.id}">
      <span class="item-links__name">${candidate.name}</span><span class="cell-sub">${[candidate.status === "INACTIVE" ? "Inactive" : null, candidate.place ?? "No place set", candidate.id].filter(Boolean).join(" · ")}</span>${picked?.id === candidate.id ? icon("check") : ""}</button>`)}</div>`;
  };

  const formMarkup = (): Html => html`<form class="form item-links__form" id="link-form" novalidate aria-label="Link another item">
      <div class="field"><label for="link-kind">This item is</label>
        <select id="link-kind" aria-describedby="link-kind-hint">${RELATION_CHOICES.map((entry, index) => html`<option value="${index}" ${index === choice ? html`selected` : ""}>${entry.label}…</option>`)}</select>
        <p class="field__hint" id="link-kind-hint">${RELATION_CHOICES[choice]!.hint}.</p></div>
      <div class="field"><label for="link-find">…the other item</label>
        <input id="link-find" type="search" autocomplete="off" spellcheck="false" placeholder="Type its name or ID" value="${query}" />
        <div id="link-picks">${picksMarkup()}</div></div>
      <div class="form-alert" id="link-alert" role="alert" hidden></div>
      <div class="where__buttons"><button type="submit" class="button button--primary button--sm" ${picked && !busy ? "" : html`disabled`}>${picked ? `Link to ${picked.name}` : "Link"}</button>
        <button type="button" class="button button--ghost button--sm" data-link-cancel>Cancel</button></div>
    </form>`;

  const render = () => {
    const links = options.links();
    mount(host, html`<section class="card item-links" aria-labelledby="links-title">
      <div class="card__head"><h3 id="links-title">Linked items${links.length ? html` <span class="muted">${links.length}</span>` : ""}</h3>
        ${adding ? "" : html`<button type="button" class="button button--secondary button--sm" data-link-add>${icon("plus")}Link an item</button>`}</div>
      ${listMarkup(links)}
      ${adding ? formMarkup() : ""}
    </section>`);
  };

  const close = () => {
    adding = false; query = ""; picked = null; choice = 0;
    render();
    host.querySelector<HTMLElement>("[data-link-add]")?.focus();
  };

  host.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-link-add]")) {
      adding = true;
      render();
      host.querySelector<HTMLElement>("#link-kind")?.focus();
      return;
    }
    if (target.closest("[data-link-cancel]")) { close(); return; }
    const pick = target.closest<HTMLElement>("[data-link-pick]");
    if (pick) {
      picked = matches().find((candidate) => candidate.id === pick.dataset.linkPick) ?? null;
      mount(host.querySelector("#link-picks")!, picksMarkup());
      const submit = host.querySelector<HTMLButtonElement>("#link-form button[type=submit]")!;
      submit.disabled = !picked;
      submit.textContent = picked ? `Link to ${picked.name}` : "Link";
      host.querySelector<HTMLElement>(`[data-link-pick="${CSS.escape(pick.dataset.linkPick!)}"]`)?.focus();
      return;
    }
    const remove = target.closest<HTMLButtonElement>("[data-link-remove]");
    if (remove) {
      const link = options.links().find((entry) => entry.id === remove.dataset.linkRemove);
      if (!link) return;
      remove.disabled = true;
      try {
        const answer = await api<{ links: ItemLink[] }>(`/api/staff/items/${encodeURIComponent(options.itemId())}/links/${encodeURIComponent(link.id)}`, { method: "DELETE" });
        options.changed(answer.links);
        toast(`Link removed: ${link.words} ${link.name}.`);
        host.querySelector<HTMLElement>("[data-link-add], [data-link-remove]")?.focus();
      } catch (error) {
        toast(failure(error), "error");
        remove.disabled = false;
      }
    }
  });

  host.addEventListener("input", (event) => {
    const target = event.target as HTMLElement;
    if (target.id === "link-find") {
      query = (target as HTMLInputElement).value;
      if (picked && !matches().some((candidate) => candidate.id === picked!.id)) picked = null;
      mount(host.querySelector("#link-picks")!, picksMarkup());
      const submit = host.querySelector<HTMLButtonElement>("#link-form button[type=submit]")!;
      submit.disabled = !picked;
      submit.textContent = picked ? `Link to ${picked.name}` : "Link";
    }
  });

  host.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target.id === "link-kind") {
      choice = Number((target as HTMLSelectElement).value);
      host.querySelector("#link-kind-hint")!.textContent = `${RELATION_CHOICES[choice]!.hint}.`;
    }
  });

  host.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!picked || busy) return;
    const alert = host.querySelector<HTMLElement>("#link-alert")!;
    const { kind, side, label } = RELATION_CHOICES[choice]!;
    busy = true;
    setMessage(alert, "");
    try {
      const answer = await api<{ links: ItemLink[] }>(`/api/staff/items/${encodeURIComponent(options.itemId())}/links`, { method: "POST", body: JSON.stringify({ itemId: picked.id, kind, side }) });
      const name = picked.name;
      busy = false;
      adding = false; query = ""; picked = null; choice = 0;
      options.changed(answer.links);
      toast(`Linked: ${label} ${name}.`);
      host.querySelector<HTMLElement>("[data-link-add]")?.focus();
    } catch (error) {
      busy = false;
      setMessage(alert, error instanceof ApiError ? error.message : failure(error));
    }
  });

  return { render };
}
