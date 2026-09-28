import { MARK, app, categoryName, escapeHtml, label, live, stateMarkup, units } from "./ui";

type LendingItem = { id: string; name: string; category: string; unit: string; available: number; audience: string; maxPerLoan: number | null; loanDays: number | null };
type Catalog = { revision: number; items: LendingItem[]; categories: string[] };

function page(content: string, current: "" | "lending"): void {
  app.innerHTML = `<header class="masthead"><div class="wrap">
    <a class="masthead__brand" href="/" data-route aria-label="Department of Logistics home">${MARK}</a>
    <nav aria-label="Primary"><a href="/lending" data-route ${current === "lending" ? `aria-current="page"` : ""}>Lending Hub</a><a class="btn btn--line" href="/staff" data-route>Staff login</a></nav>
  </div></header>
  ${content}
  <footer class="colophon"><div class="wrap"><span><strong>Department of Logistics</strong> · University Student Council, Holy Angel University</span><span>Logistics requests are not yet available online.</span></div></footer>`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function landing(): void {
  document.title = "Department of Logistics · HAU USC";
  page(`<main id="main-content">
    <section class="hero" aria-labelledby="hero-title"><div class="wrap">
      <div class="hero__copy">
        <p class="eyebrow">Holy Angel University · University Student Council</p>
        <h1 id="hero-title">Logistics that keeps the work moving.</h1>
        <p class="hero__lede">The Department of Logistics supports the people and materials behind University Student Council work — and lends equipment to students and USC staff.</p>
        <div class="hero__actions"><a class="btn btn--gold" href="/lending" data-route>Explore the Lending Hub <span aria-hidden="true">→</span></a><a class="btn btn--ghost" href="/staff" data-route>Staff login</a></div>
      </div>
      <aside class="snapshot" aria-labelledby="snapshot-title">
        <div class="snapshot__head"><h2 id="snapshot-title">Lending Hub today</h2><span class="live" id="live-status">Connecting…</span></div>
        <div id="snapshot-body" aria-live="polite"><p class="snapshot__caption">Checking what's available…</p></div>
      </aside>
    </div></section>
    <section class="services wrap" aria-labelledby="services-title">
      <h2 id="services-title" class="visually-hidden">Services</h2>
      <div class="services__grid">
        <a class="service" href="/lending" data-route><span class="badge badge--ok">Open</span><h3>Lending Hub</h3><p>See which equipment can be borrowed and how many are on the shelf right now.</p><span class="service__go">Browse items →</span></a>
        <a class="service" href="/staff" data-route><span class="badge badge--quiet">Authorized staff</span><h3>Staff workspace</h3><p>Record stock movements, maintain the catalog, and publish items for lending.</p><span class="service__go">Sign in →</span></a>
        <div class="service service--off"><span class="badge badge--quiet">Not yet available</span><h3>Logistics Request</h3><p>Online requests are not open yet. Contact the Department of Logistics directly for now.</p></div>
      </div>
    </section>
  </main>`, "");
  live<Catalog>("/api/public/catalog", {
    interval: 30_000,
    status: () => document.querySelector("#live-status"),
    onData: ({ items }) => {
      const body = document.querySelector("#snapshot-body");
      if (!body) return;
      const ready = items.filter((item) => item.available > 0);
      if (!items.length) {
        body.innerHTML = `<p class="snapshot__figure">Soon</p><p class="snapshot__caption">Staff are reviewing the catalog. Items appear here the moment they're approved for lending.</p>`;
        return;
      }
      body.innerHTML = `<p class="snapshot__figure num">${ready.length}</p><p class="snapshot__caption">${ready.length === 1 ? "item" : "items"} ready to borrow right now, of ${plural(items.length, "listed item")}.</p>
        <ul>${ready.slice(0, 4).map((item) => `<li><span>${escapeHtml(item.name)}</span><span class="num">${item.available} ${escapeHtml(units(item.available, item.unit))}</span></li>`).join("")}</ul>
        <a class="snapshot__link" href="/lending" data-route>See all items →</a>`;
    },
    onError: () => {
      const body = document.querySelector("#snapshot-body");
      if (body && !body.querySelector("ul, .snapshot__figure")) body.innerHTML = `<p class="snapshot__caption">Live availability is temporarily unreachable. The Lending Hub will retry automatically.</p>`;
    }
  });
}

function terms(item: LendingItem): string {
  return [item.maxPerLoan ? `Up to ${item.maxPerLoan} per loan` : "", item.loanDays ? `${item.loanDays}-day loan` : "", label(item.audience)].filter(Boolean).join(" · ");
}

function itemMarkup(item: LendingItem, changed: boolean): string {
  const count = item.available > 0
    ? `<p class="item__count num"><strong>${item.available}</strong> ${escapeHtml(units(item.available, item.unit))} available</p>`
    : `<p class="item__count item__count--none">None on the shelf right now</p>`;
  return `<article class="item ${changed ? "item--changed" : ""}">
    <div class="item__top"><p class="item__cat">${escapeHtml(categoryName(item.category))}</p>${item.available > 0 ? `<span class="badge badge--ok">Available</span>` : `<span class="badge badge--bad">All out</span>`}</div>
    <h2>${escapeHtml(item.name)}</h2>${count}<p class="item__terms">${escapeHtml(terms(item))}</p></article>`;
}

export function lending(): void {
  document.title = "Lending Hub · Department of Logistics";
  page(`<main id="main-content">
    <header class="page-head"><div class="wrap">
      <div><p class="eyebrow">Department of Logistics</p><h1>Lending Hub</h1><p>Equipment the Department lends to students and USC staff. Counts update live as staff record stock.</p></div>
      <span class="live" id="live-status">Connecting…</span>
    </div></header>
    <div class="wrap lending">
      <section aria-label="Lendable items">
        <div class="toolbar">
          <label class="search"><span class="visually-hidden">Search the Lending Hub</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="lending-search" type="search" autocomplete="off" placeholder="Search items" /></label>
          <label class="check"><input id="lending-available" type="checkbox" /> Available now</label>
        </div>
        <div class="chips" id="lending-categories" role="group" aria-label="Filter by category"></div>
        <p class="result-count" id="lending-count" aria-live="polite"></p>
        <div id="lending-results"><div class="items" aria-hidden="true">${`<div class="skeleton"></div>`.repeat(6)}</div></div>
      </section>
      <aside class="howto" aria-labelledby="howto-title">
        <h2 id="howto-title">How borrowing works</h2>
        <ol><li>Find the item here and check that it's available.</li><li>Visit the Department of Logistics and speak with a staff member.</li><li>Staff record the loan and its return date with you.</li></ol>
        <p>Online requests are not available yet. Items listed here have been reviewed by staff; counts reflect what is physically on hand.</p>
      </aside>
    </div>
  </main>`, "lending");

  let catalog: Catalog | null = null;
  let category = "";
  const previous = new Map<string, number>();
  const changed = new Set<string>();
  const search = document.querySelector<HTMLInputElement>("#lending-search")!;
  const availableOnly = document.querySelector<HTMLInputElement>("#lending-available")!;
  const results = document.querySelector<HTMLDivElement>("#lending-results")!;
  const count = document.querySelector<HTMLParagraphElement>("#lending-count")!;
  const chips = document.querySelector<HTMLDivElement>("#lending-categories")!;

  const render = () => {
    if (!catalog) return;
    if (!catalog.items.length) {
      count.textContent = "";
      chips.hidden = true;
      results.innerHTML = stateMarkup("No items are open for borrowing yet", "Staff are reviewing the inventory. Approved items will appear here automatically — there's no need to refresh.");
      return;
    }
    chips.hidden = catalog.categories.length < 2;
    chips.innerHTML = ["", ...catalog.categories].map((value) => `<button type="button" class="chip" data-category="${escapeHtml(value)}" aria-pressed="${value === category}">${value ? escapeHtml(categoryName(value)) : "All"}</button>`).join("");
    const query = search.value.trim().toLowerCase();
    const shown = catalog.items.filter((item) => (!category || item.category === category)
      && (!availableOnly.checked || item.available > 0)
      && (!query || `${item.name} ${item.category}`.toLowerCase().includes(query)));
    const ready = shown.filter((item) => item.available > 0).length;
    count.textContent = `${plural(shown.length, "item")} · ${ready} available now`;
    results.innerHTML = shown.length
      ? `<div class="items">${shown.map((item) => itemMarkup(item, changed.has(item.id))).join("")}</div>`
      : stateMarkup("Nothing matches those filters", "Try a shorter search, another category, or include items that are currently out.");
    changed.clear();
  };

  let timer = 0;
  search.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(render, 120); });
  availableOnly.addEventListener("change", render);
  chips.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-category]");
    if (!chip) return;
    category = chip.dataset.category ?? "";
    render();
  });

  const poll = live<Catalog>("/api/public/catalog", {
    interval: 15_000,
    status: () => document.querySelector("#live-status"),
    onData: (data) => {
      for (const item of data.items) {
        if (previous.has(item.id) && previous.get(item.id) !== item.available) changed.add(item.id);
        previous.set(item.id, item.available);
      }
      if (category && !data.categories.includes(category)) category = "";
      catalog = data;
      render();
    },
    onError: () => {
      if (catalog) return;
      results.innerHTML = stateMarkup("We couldn't load the Lending Hub", "Check your connection. We'll keep retrying automatically.", `<button class="btn btn--line" type="button" id="retry">Try again now</button>`, "state--error");
      document.querySelector("#retry")?.addEventListener("click", () => void poll.refresh());
    }
  });
}

export function notFound(): void {
  document.title = "Page not found · Department of Logistics";
  page(`<main id="main-content" class="wrap page-message">${stateMarkup("That page doesn't exist", "The link may be out of date.", `<a class="btn btn--primary" href="/" data-route>Go to the home page</a>`)}</main>`, "");
}
