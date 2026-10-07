import "./admin.css";
import { adminPage } from "./admin-frame";
import { BEHAVIOUR_LABELS } from "./catalog-policy";
import { KNOWLEDGE, KNOWLEDGE_VERSION } from "./item-knowledge";
import { type Html, api, categoryName, emptyState, failure, html, mount, onLeave, plural, setMessage, sheet as createSheet, sheetContent, toast } from "./ui";

type Coverage = { active: number; unclassified: number; captured: number; capturedClassified: number };
type AliasItem = { id: string; name: string; category: string; aliases: string | null; updatedAt: string | null };

const kindLabel = { packaging: "Packaging", product: "Product" } as const;

function stat(label: string, value: number, note: Html | string, warn = false): Html {
  return html`<div class="stat ${warn ? "stat--warn" : ""}"><dt>${label}</dt><dd><span class="stat__value">${value.toLocaleString()}</span><span class="stat__note">${note}</span></dd></div>`;
}

/** Administration > Catalog: how far classification has got, other names per item, the built-in hints, and the AI setting's honest state. */
export async function catalogSettings(): Promise<void> {
  const session = await adminPage("catalog", {
    title: "Catalog",
    lede: "How complete the catalog is, the other names people search by, and the hints that come with the app.",
    body: () => html`
    <section class="admin-block admin-block--first" aria-labelledby="coverage-title">
      <h2 id="coverage-title" class="section-title">Classification</h2>
      <div id="coverage" aria-busy="true"><div class="skeleton skeleton--block" aria-hidden="true"></div></div>
    </section>
    <section class="admin-block" aria-labelledby="names-title">
      <h2 id="names-title" class="section-title">Other names</h2>
      <p>People find an item by any of its other names in search and while cataloguing. Add the names staff and borrowers actually use.</p>
      <div class="field admin-search"><label for="names-search">Find an item</label><input id="names-search" type="search" autocomplete="off" maxlength="80" placeholder="Name, other name or ID" /></div>
      <div id="names" aria-live="polite"></div>
    </section>
    <section class="admin-block" aria-labelledby="kb-title">
      <h2 id="kb-title" class="section-title">Built-in hints</h2>
      <p>When a name contains one of these words, cataloguing suggests what the hint says and shows why. The list ships with the app (version ${KNOWLEDGE_VERSION}, ${plural(KNOWLEDGE.length, "hint")}) and is read-only here; it changes with the app.</p>
      <details class="hint-details"><summary>Show all ${plural(KNOWLEDGE.length, "hint")}</summary>
      <ul class="hint-list">${KNOWLEDGE.map((entry) => html`<li class="hint-row">
        <p class="hint-row__words"><span class="cell-strong">${entry.keywords.join(", ")}</span> <span class="muted">${kindLabel[entry.kind]}</span></p>
        <p class="hint-row__says">${[entry.behaviour && BEHAVIOUR_LABELS[entry.behaviour], entry.unit && `counted by the ${entry.unit}`, entry.category && categoryName(entry.category)].filter(Boolean).join(" · ") || "Nothing on its own"}<span class="muted"> · ${entry.note}</span></p></li>`)}</ul></details>
    </section>
    <section class="admin-block" aria-labelledby="ai-title">
      <h2 id="ai-title" class="section-title">AI second opinion</h2>
      <p><span class="tag tag--pending">Not connected</span></p>
      <p>Nothing sends item names to an AI model. This release only measured the idea on sample data, and suggestions come entirely from the built-in hints and the catalog itself. If it is ever connected, this section will show whether it is on, today's calls against the daily limit and whether it has paused itself, and show nothing it has not read.</p>
    </section>
    <section class="admin-block" aria-labelledby="elsewhere-title">
      <h2 id="elsewhere-title" class="section-title">Looked after elsewhere</h2>
      <p>Places, kits and cataloguing sessions are looked after on their own pages: <a href="/staff/locations" data-route>Places</a>, <a href="/staff/kits" data-route>Kits</a> and <a href="/staff/catalogue" data-route>Cataloguing</a>.</p>
    </section>
    <dialog class="sheet" id="sheet" aria-labelledby="sheet-title"></dialog>`
  });
  if (!session) return;

  async function loadCoverage(): Promise<void> {
    const target = document.querySelector<HTMLElement>("#coverage")!;
    try {
      const data = await api<Coverage>("/api/staff/admin/catalog");
      const classified = data.active - data.unclassified;
      mount(target, html`<dl class="stat-strip">
          ${stat("Active items", data.active, "in the catalog")}
          ${stat("Classified", classified, data.active ? `${Math.round((classified / data.active) * 100)}% of active items` : "none yet")}
          ${stat("Unclassified", data.unclassified, data.unclassified ? html`<a class="text-link" href="/staff/items?type=NEEDS_REVIEW" data-route>Show them in Items</a>` : "none", data.unclassified > 0)}
          ${stat("Classified at capture", data.capturedClassified, `of ${plural(data.captured, "item")} added in cataloguing sessions`)}
        </dl>
        <p class="admin-source">Unclassified items stay out of every public list until someone chooses Borrow, Take or Use. They also appear under <a href="/staff/attention" data-route>Attention</a>. The app does not record whether a classification started from a suggestion, so no figure for that is shown.</p>`);
    } catch (error) {
      mount(target, emptyState("Classification could not be loaded", failure(error), "", "error", 3));
    }
    target.setAttribute("aria-busy", "false");
  }

  /* ---------- Other names ---------- */
  const sheet = document.querySelector<HTMLDialogElement>("#sheet")!;
  const panel = createSheet(sheet);
  let items: AliasItem[] = [];
  let more = false;
  let searchedFor = "";

  function renderNames(): void {
    const target = document.querySelector<HTMLElement>("#names")!;
    if (!items.length) {
      mount(target, searchedFor ? emptyState("No item matches", "Try a different word, or the item's ID.", "", "", 3) : emptyState("No item has other names yet", "Search for an item above to add some.", "", "", 3));
      return;
    }
    mount(target, html`<ul class="alias-list">${items.map((item) => html`<li class="alias-row">
        <div class="alias-row__item"><span class="cell-strong">${item.name}</span><span class="cell-sub"><span class="mono">${item.id}</span> · ${categoryName(item.category)}</span></div>
        <p class="alias-row__names">${item.aliases ?? html`<span class="muted">No other names</span>`}</p>
        <button type="button" class="button button--secondary button--sm" data-edit="${item.id}">Edit<span class="visually-hidden"> other names of ${item.name}</span></button>
      </li>`)}</ul>
      ${more ? html`<p class="admin-source">Showing the first ${items.length}. Search to narrow them.</p>` : ""}`);
  }

  async function loadNames(query: string): Promise<void> {
    searchedFor = query;
    try {
      const result = await api<{ items: AliasItem[]; more: boolean }>(`/api/staff/admin/catalog/aliases?q=${encodeURIComponent(query)}`);
      // A slower answer to an earlier search must not replace a newer one.
      if (query !== searchedFor) return;
      items = result.items;
      more = result.more;
      renderNames();
    } catch (error) {
      mount(document.querySelector("#names")!, emptyState("Items could not be loaded", failure(error), "", "error", 3));
    }
  }

  function openEdit(item: AliasItem): void {
    mount(sheet, sheetContent(`${item.id} · ${categoryName(item.category)}`, item.name, html`<form class="form" id="names-form" novalidate>
      <div class="field"><label for="names-input">Other names</label><input id="names-input" name="aliases" value="${item.aliases ?? ""}" maxlength="300" autocomplete="off" aria-describedby="names-hint" />
        <p class="field__hint" id="names-hint">Separate names with commas. The item's own name is not repeated, and each name is at most 60 characters.</p></div>
      <div class="form-alert" id="names-alert" role="alert" hidden></div>
      <div class="form-actions"><button class="button button--primary" type="submit">Save other names</button></div>
    </form>`));
    panel.open();
    const form = sheet.querySelector<HTMLFormElement>("#names-form")!;
    form.querySelector<HTMLInputElement>("#names-input")!.focus();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await api<{ changed: number; aliases: string | null; updatedAt: string | null }>(`/api/staff/admin/catalog/aliases/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ aliases: new FormData(form).get("aliases"), updatedAt: item.updatedAt }) });
        item.aliases = result.aliases;
        item.updatedAt = result.updatedAt;
        toast(result.changed ? `Other names saved for ${item.name}.` : "No changes to save.");
        panel.close(true);
        renderNames();
      } catch (error) { setMessage(sheet.querySelector("#names-alert")!, failure(error)); }
    });
  }

  document.querySelector("#names")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-edit]");
    const item = items.find((entry) => entry.id === button?.dataset.edit);
    if (item) openEdit(item);
  });
  let typing: number | undefined;
  onLeave(() => window.clearTimeout(typing));
  document.querySelector<HTMLInputElement>("#names-search")!.addEventListener("input", (event) => {
    window.clearTimeout(typing);
    const query = (event.target as HTMLInputElement).value.trim();
    typing = window.setTimeout(() => { void loadNames(query); }, 250);
  });
  await Promise.all([loadCoverage(), loadNames("")]);
}
