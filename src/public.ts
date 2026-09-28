import { MARK, type Html, app, categoryName, emptyState, html, icon, label, live, mount, onLeave, plural, preservingFocus, units, writeParams } from "./ui";

type LendingItem = { id: string; name: string; category: string; unit: string; available: number; audience: string; maxPerLoan: number | null; loanDays: number | null };
type Catalog = { revision: number; items: LendingItem[]; categories: string[] };

function page(content: Html, current: "" | "lending"): void {
  mount(app, html`
    <header class="site-header">
      <div class="container site-header__inner">
        <a class="site-header__brand" href="/" data-route aria-label="Department of Logistics home">${MARK}</a>
        <nav class="site-nav" aria-label="Main">
          <a class="site-nav__link" href="/lending" data-route ${current === "lending" ? html`aria-current="page"` : ""}>Lending Hub</a>
          <a class="button button--secondary" href="/staff" data-route>Staff sign in</a>
        </nav>
      </div>
    </header>
    ${content}
    <footer class="site-footer">
      <div class="container site-footer__inner">
        <div>
          <p class="site-footer__name">Department of Logistics</p>
          <p>University Student Council<br />Holy Angel University</p>
        </div>
        <nav aria-label="Footer">
          <ul class="site-footer__links">
            <li><a href="/lending" data-route>Lending Hub</a></li>
            <li><a href="/staff" data-route>Staff sign in</a></li>
            <li><span>Logistics requests <em>(not yet available)</em></span></li>
          </ul>
        </nav>
      </div>
      <div class="site-footer__base"><div class="container">© ${new Date().getFullYear()} University Student Council, Holy Angel University</div></div>
    </footer>`);
}

function availability(item: LendingItem): Html {
  return item.available > 0
    ? html`<p class="catalogue__avail"><span class="catalogue__count">${item.available}</span> <span class="catalogue__unit">${units(item.available, item.unit)}<span class="catalogue__word"> available</span></span></p>`
    : html`<p class="catalogue__avail catalogue__avail--out"><span class="catalogue__unit">All out right now</span></p>`;
}

function terms(item: LendingItem): string {
  return [label(item.audience), item.maxPerLoan ? `up to ${item.maxPerLoan} per loan` : "", item.loanDays ? `${item.loanDays}\u2011day loan` : ""].filter(Boolean).join(" · ");
}

const skeletonRows = (count: number) => html`<ul class="catalogue" aria-hidden="true">${Array.from({ length: count }, () => html`<li class="catalogue__row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></li>`)}</ul>`;

export function landing(): void {
  document.title = "Department of Logistics · HAU University Student Council";
  page(html`<main id="main-content">
    <section class="hero" aria-labelledby="hero-title">
      <div class="container hero__inner">
        <p class="hero__kicker">University Student Council · Holy Angel University</p>
        <h1 id="hero-title">Logistics that keeps the work moving.</h1>
        <p class="hero__lede">The Department of Logistics supports the people and materials behind University Student Council work, and lends equipment to students and USC staff.</p>
        <div class="hero__actions">
          <a class="button button--accent button--lg" href="/lending" data-route>Browse the Lending Hub ${icon("arrow")}</a>
          <a class="button button--on-dark button--lg" href="/staff" data-route>Staff sign in</a>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="now-title">
      <div class="container split">
        <div class="split__head">
          <div>
            <h2 id="now-title" class="section__title">Available to borrow</h2>
            <p class="section__sub" id="now-summary">Checking what is on the shelf…</p>
          </div>
          <a class="text-link" href="/lending" data-route>View the full Lending Hub ${icon("arrow")}</a>
        </div>
        <div id="now-list" aria-live="polite">${skeletonRows(4)}</div>
      </div>
    </section>

    <section class="section section--alt" aria-labelledby="offer-title">
      <div class="container">
        <h2 id="offer-title" class="section__title">What the Department offers</h2>
        <div class="features">
          <article class="feature">
            <h3>Lending Hub</h3>
            <p>Browse equipment approved for lending and see how many are on the shelf, updated as staff record stock.</p>
            <a class="text-link" href="/lending" data-route>Browse items ${icon("arrow")}</a>
          </article>
          <article class="feature">
            <h3>Staff workspace</h3>
            <p>Authorized Department staff record stock movements, maintain the catalog, and decide what appears publicly.</p>
            <a class="text-link" href="/staff" data-route>Staff sign in ${icon("arrow")}</a>
          </article>
          <article class="feature feature--muted">
            <h3>Logistics requests</h3>
            <p>Online requests for event logistics are not open yet. Contact the Department of Logistics directly in the meantime.</p>
            <p class="feature__status">Not yet available</p>
          </article>
        </div>
      </div>
    </section>
  </main>`, "");

  live<Catalog>("/api/public/catalog", {
    interval: 30_000,
    onData: ({ items }) => {
      const list = document.querySelector("#now-list");
      const summary = document.querySelector("#now-summary");
      if (!list || !summary) return;
      const ready = items.filter((item) => item.available > 0);
      if (!items.length) {
        summary.textContent = "Staff are reviewing the catalog.";
        mount(list, html`<p class="note">Nothing is listed for lending yet. Items appear here as soon as staff approve them.</p>`);
        return;
      }
      summary.textContent = `${plural(ready.length, "item")} on the shelf now, of ${items.length} listed.`;
      mount(list, ready.length
        ? html`<ul class="catalogue">${ready.slice(0, 6).map((item) => html`<li class="catalogue__row"><div class="catalogue__main"><h3 class="catalogue__name">${item.name}</h3><p class="catalogue__meta">${categoryName(item.category)}</p></div>${availability(item)}</li>`)}</ul>`
        : html`<p class="note">Every listed item is currently out. Check the Lending Hub for details.</p>`);
    },
    onError: () => {
      const summary = document.querySelector("#now-summary");
      if (summary) summary.textContent = "Availability is temporarily unreachable. Retrying automatically.";
    }
  });
}

export function lending(): void {
  document.title = "Lending Hub · Department of Logistics";
  page(html`<main id="main-content">
    <div class="page-intro">
      <div class="container">
        <nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="/" data-route>Home</a></li><li aria-current="page">Lending Hub</li></ol></nav>
        <div class="page-intro__row">
          <div>
            <h1>Lending Hub</h1>
            <p class="page-intro__lede">Equipment the Department of Logistics lends to students and USC staff. Counts show what is on the shelf right now.</p>
          </div>
          <p class="live-status" id="live-status">Connecting…</p>
        </div>
      </div>
    </div>
    <div class="filterbar" role="search" aria-label="Filter the Lending Hub">
      <div class="container filterbar__inner">
        <label class="search-field">${icon("search")}<span class="visually-hidden">Search the Lending Hub</span><input id="lending-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search equipment" data-search /><kbd aria-hidden="true">/</kbd></label>
        <label class="select-field"><span class="visually-hidden">Category</span><select id="lending-category"><option value="">All categories</option></select></label>
        <label class="switch"><input id="lending-available" type="checkbox" role="switch" /><span class="switch__track" aria-hidden="true"></span><span>Available now</span></label>
        <p class="filterbar__count" id="lending-count" aria-live="polite"></p>
      </div>
    </div>
    <div class="container lending-layout">
      <div id="lending-results" aria-busy="true">${skeletonRows(6)}</div>
      <aside class="aside-note" aria-labelledby="borrow-title">
        <h2 id="borrow-title">How to borrow</h2>
        <p>Loans are arranged in person with Department of Logistics staff, who record each loan and its return date with you. Online requests are not available yet.</p>
        <p>Only items reviewed by staff are listed here.</p>
      </aside>
    </div>
  </main>`, "lending");

  const params = new URLSearchParams(window.location.search);
  const search = document.querySelector<HTMLInputElement>("#lending-search")!;
  const categorySelect = document.querySelector<HTMLSelectElement>("#lending-category")!;
  const availableOnly = document.querySelector<HTMLInputElement>("#lending-available")!;
  const results = document.querySelector<HTMLDivElement>("#lending-results")!;
  const count = document.querySelector<HTMLParagraphElement>("#lending-count")!;
  search.value = params.get("q") ?? "";
  availableOnly.checked = params.get("available") === "1";
  let category = params.get("category") ?? "";
  let catalog: Catalog | null = null;
  const previous = new Map<string, number>();
  const changed = new Set<string>();

  const row = (item: LendingItem) => html`<li class="catalogue__row ${changed.has(item.id) ? "is-changed" : ""}" data-key="${item.id}">
    <div class="catalogue__main"><h3 class="catalogue__name">${item.name}</h3><p class="catalogue__meta">${terms(item)}</p></div>${availability(item)}</li>`;

  const render = () => {
    if (!catalog) return;
    results.removeAttribute("aria-busy");
    writeParams({ q: search.value.trim(), category, available: availableOnly.checked ? "1" : null });
    if (!catalog.items.length) {
      count.textContent = "";
      mount(results, emptyState("No items are open for borrowing yet", "Staff are reviewing the inventory. Approved items appear here automatically; there is no need to refresh."));
      return;
    }
    if ([...categorySelect.options].slice(1).map((option) => option.value).join("\n") !== catalog.categories.join("\n")) {
      mount(categorySelect, html`<option value="">All categories</option>${catalog.categories.map((value) => html`<option value="${value}">${categoryName(value)}</option>`)}`);
    }
    categorySelect.value = category;
    const query = search.value.trim().toLowerCase();
    const shown = catalog.items.filter((item) => (!category || item.category === category)
      && (!availableOnly.checked || item.available > 0)
      && (!query || `${item.name} ${item.category}`.toLowerCase().includes(query)));
    const ready = shown.filter((item) => item.available > 0).length;
    count.textContent = `${plural(shown.length, "item")}, ${ready} available`;
    const groups = [...new Set(shown.map((item) => item.category))];
    preservingFocus(results, () => mount(results, shown.length
      ? html`${groups.map((group, index) => html`<section class="catalogue-group" aria-labelledby="group-${index}">
          <h2 class="catalogue-group__title" id="group-${index}">${categoryName(group)} <span>${shown.filter((item) => item.category === group).length}</span></h2>
          <ul class="catalogue">${shown.filter((item) => item.category === group).map(row)}</ul></section>`)}`
      : emptyState("Nothing matches those filters", "Try a shorter search, another category, or include items that are currently out.", html`<button class="button button--secondary" type="button" id="clear-filters">Clear filters</button>`)));
    changed.clear();
  };

  let timer = 0;
  onLeave(() => window.clearTimeout(timer));
  search.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(render, 120); });
  search.addEventListener("keydown", (event) => { if (event.key === "Escape" && search.value) { search.value = ""; render(); } });
  categorySelect.addEventListener("change", () => { category = categorySelect.value; render(); });
  availableOnly.addEventListener("change", render);
  results.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest("#clear-filters")) return;
    search.value = "";
    category = "";
    availableOnly.checked = false;
    render();
    search.focus();
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
      results.removeAttribute("aria-busy");
      mount(results, emptyState("We couldn't load the Lending Hub", "Check your connection. We'll keep retrying automatically.", html`<button class="button button--secondary" type="button" id="retry">Try again now</button>`, "error"));
      document.querySelector("#retry")?.addEventListener("click", () => void poll.refresh());
    }
  });
}

export function notFound(): void {
  document.title = "Page not found · Department of Logistics";
  page(html`<main id="main-content" class="container page-message"><div class="empty">${icon("box")}<h1>That page doesn't exist</h1><p>The link may be out of date or mistyped.</p><a class="button button--primary" href="/" data-route>Go to the home page</a></div></main>`, "");
}
