import { CREST, MARK, type Html, animateNumber, app, categoryName, emptyState, html, icon, label, live, mount, onLeave, plural, preservingFocus, units, writeParams } from "./ui";

type LendingItem = { id: string; name: string; category: string; unit: string; available: number; audience: string; maxPerLoan: number | null; loanDays: number | null };
type Catalog = { revision: number; items: LendingItem[]; categories: string[] };
type Sort = "name" | "available";

const LOCKUP = html`<span class="lockup">${CREST}<span class="lockup__rule" aria-hidden="true"></span>${MARK}<span class="lockup__text"><strong>Department of Logistics</strong><span>HAU University Student Council</span></span></span>`;

function page(content: Html, current: "" | "lending"): void {
  mount(app, html`
    <header class="site-header">
      <div class="container site-header__inner">
        <a class="site-header__brand" href="/" data-route aria-label="Department of Logistics home">${LOCKUP}</a>
        <nav class="site-nav" aria-label="Main">
          <a class="site-nav__link" href="/lending" data-route ${current === "lending" ? html`aria-current="page"` : ""}>Lending Hub</a>
          <a class="button button--outline-light" href="/staff" data-route>Staff sign in</a>
        </nav>
      </div>
    </header>
    ${content}
    <footer class="site-footer">
      <div class="container site-footer__inner">
        <div class="site-footer__brand">
          <span class="site-footer__marks" aria-hidden="true">${CREST}${MARK}</span>
          <div>
            <p class="site-footer__name">Department of Logistics</p>
            <p>University Student Council<br />Holy Angel University, Angeles City</p>
          </div>
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


/** Availability reads at a glance: plenty, the last one, or all out. */
function availability(item: LendingItem): Html {
  if (item.available <= 0) return html`<p class="avail avail--out"><span class="avail__label">All out right now</span></p>`;
  const low = item.available === 1;
  return html`<p class="avail ${low ? "avail--low" : ""}"><span class="avail__count" data-count="${item.id}">${item.available}</span> <span class="avail__label">${units(item.available, item.unit)}<span class="avail__word">${low ? " · last one" : " available"}</span></span></p>`;
}

function terms(item: LendingItem): string {
  return [label(item.audience), item.maxPerLoan ? `up to ${item.maxPerLoan} per loan` : "", item.loanDays ? `${item.loanDays}‑day loan` : ""].filter(Boolean).join(" · ");
}

const skeletonRows = (count: number) => html`<ul class="catalogue" aria-hidden="true">${Array.from({ length: count }, () => html`<li class="catalogue__row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></li>`)}</ul>`;

/** Staggers rows in after a filter change; CSP forbids inline styles, so the index is set via CSSOM. */
function stagger(container: Element): void {
  container.querySelectorAll<HTMLElement>(".catalogue__row").forEach((row, index) => row.style.setProperty("--i", String(Math.min(index, 14))));
  container.classList.remove("is-entering");
  void (container as HTMLElement).offsetWidth;
  container.classList.add("is-entering");
}

/** Rolls each changed count from its previous value to the new one. */
function rollCounts(container: Element, before: Map<string, number>, changed: Set<string>): void {
  for (const id of changed) {
    const element = container.querySelector(`[data-count="${CSS.escape(id)}"]`);
    if (element && before.has(id)) animateNumber(element, Number(element.textContent), before.get(id));
  }
}


export function landing(): void {
  document.title = "Department of Logistics · HAU University Student Council";
  page(html`<main id="main-content">
    <section class="hero" aria-labelledby="hero-title">
      <div class="container hero__grid">
        <div class="hero__copy">
          <p class="hero__kicker">Holy Angel University · University Student Council</p>
          <h1 id="hero-title">Logistics that keeps the work moving.</h1>
          <p class="hero__lede">The Department of Logistics supports the people and materials behind University Student Council work, and lends equipment to students and USC staff.</p>
          <div class="hero__actions">
            <a class="button button--gold button--lg" href="/lending" data-route>Browse the Lending Hub ${icon("arrow")}</a>
            <a class="button button--outline-light button--lg" href="/staff" data-route>Staff sign in</a>
          </div>
        </div>
        <aside class="shelf" aria-labelledby="shelf-title">
          <div class="shelf__head"><h2 id="shelf-title">On the shelf now</h2><p class="live-status" id="live-status">Connecting…</p></div>
          <p class="shelf__summary" id="now-summary">Checking what is on the shelf…</p>
          <div id="now-list">${skeletonRows(4)}</div>
          <a class="text-link shelf__more" href="/lending" data-route>See everything in the Lending Hub ${icon("arrow")}</a>
        </aside>
      </div>
    </section>

    <section class="section reveal" aria-labelledby="steps-title">
      <div class="container">
        <h2 id="steps-title" class="section__title">How borrowing works</h2>
        <ol class="steps">
          <li><span class="steps__n">1</span><h3>Find it here</h3><p>Search the Lending Hub and check that the item is on the shelf. Counts update as staff record stock.</p></li>
          <li><span class="steps__n">2</span><h3>Visit the Department</h3><p>Speak with Department of Logistics staff. Loans are arranged in person; online requests are not open yet.</p></li>
          <li><span class="steps__n">3</span><h3>Borrow and return</h3><p>Staff record the loan and its return date with you, so the next person sees accurate availability.</p></li>
        </ol>
      </div>
    </section>

    <section class="section section--alt reveal" aria-labelledby="offer-title">
      <div class="container split">
        <h2 id="offer-title" class="section__title">What the Department offers</h2>
        <ul class="offers">
          <li class="offer">
            <h3>Lending Hub</h3>
            <p>Equipment approved for lending, with how many are on the shelf right now.</p>
            <a class="text-link" href="/lending" data-route>Browse items ${icon("arrow")}</a>
          </li>
          <li class="offer">
            <h3>Staff workspace</h3>
            <p>Department staff keep the catalog, record stock movements, and decide what appears publicly.</p>
            <a class="text-link" href="/staff" data-route>Staff sign in ${icon("arrow")}</a>
          </li>
          <li class="offer offer--muted">
            <h3>Logistics requests</h3>
            <p>Online requests for event logistics are not open yet. Contact the Department of Logistics directly in the meantime.</p>
            <p class="offer__status">Not yet available</p>
          </li>
        </ul>
      </div>
    </section>
  </main>`, "");

  live<Catalog>("/api/public/catalog", {
    interval: 30_000,
    status: () => document.querySelector("#live-status"),
    onData: ({ items }) => {
      const list = document.querySelector("#now-list");
      const summary = document.querySelector("#now-summary");
      if (!list || !summary) return;
      const ready = items.filter((item) => item.available > 0);
      if (!items.length) {
        summary.textContent = "Staff are reviewing the catalog.";
        mount(list, html`<p class="shelf__note">Nothing is listed for lending yet. Items appear here as soon as staff approve them, with no need to refresh.</p>`);
        return;
      }
      summary.textContent = `${plural(ready.length, "item")} on the shelf now, of ${items.length} listed.`;
      mount(list, ready.length
        ? html`<ul class="catalogue catalogue--compact">${ready.slice(0, 5).map((item) => html`<li><a class="catalogue__row catalogue__row--link" href="/lending?q=${encodeURIComponent(item.name)}" data-route><div class="catalogue__main"><h3 class="catalogue__name">${item.name}</h3><p class="catalogue__meta">${categoryName(item.category)}</p></div>${availability(item)}</a></li>`)}</ul>`
        : html`<p class="shelf__note">Every listed item is currently out. Check the Lending Hub for details.</p>`);
      stagger(list);
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
        <div class="filterbar__row">
          <label class="search-field">${icon("search")}<span class="visually-hidden">Search the Lending Hub</span><input id="lending-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search equipment" data-search /><kbd aria-hidden="true">/</kbd><button class="search-field__clear" type="button" id="clear-search" aria-label="Clear search" hidden>${icon("close")}</button></label>
          <label class="switch"><input id="lending-available" type="checkbox" role="switch" /><span class="switch__track" aria-hidden="true"></span><span>Available now</span></label>
          <div class="sort-toggle" role="group" aria-label="Sort">
            <button type="button" data-sort="name" aria-pressed="true">A–Z</button><button type="button" data-sort="available" aria-pressed="false">Availability</button>
          </div>
        </div>
        <div class="chips" id="lending-categories" role="group" aria-label="Category"></div>
      </div>
    </div>
    <div class="container lending-layout">
      <div>
        <p class="result-count" id="lending-count" aria-live="polite"></p>
        <div id="lending-results" aria-busy="true">${skeletonRows(6)}</div>
      </div>
      <aside class="aside-note" aria-labelledby="borrow-title">
        <h2 id="borrow-title">How to borrow</h2>
        <p>Loans are arranged in person with Department of Logistics staff, who record each loan and its return date with you. Online requests are not available yet.</p>
        <p>Only items reviewed by staff are listed here.</p>
      </aside>
    </div>
  </main>`, "lending");

  const params = new URLSearchParams(window.location.search);
  const search = document.querySelector<HTMLInputElement>("#lending-search")!;
  const clear = document.querySelector<HTMLButtonElement>("#clear-search")!;
  const chips = document.querySelector<HTMLDivElement>("#lending-categories")!;
  const availableOnly = document.querySelector<HTMLInputElement>("#lending-available")!;
  const sortGroup = document.querySelector<HTMLDivElement>(".sort-toggle")!;
  const results = document.querySelector<HTMLDivElement>("#lending-results")!;
  const count = document.querySelector<HTMLParagraphElement>("#lending-count")!;
  search.value = params.get("q") ?? "";
  availableOnly.checked = params.get("available") === "1";
  let category = params.get("category") ?? "";
  let sort: Sort = params.get("sort") === "available" ? "available" : "name";
  let catalog: Catalog | null = null;
  let before = new Map<string, number>();
  const changed = new Set<string>();

  const row = (item: LendingItem) => html`<li class="catalogue__row ${changed.has(item.id) ? "is-changed" : ""}" data-key="${item.id}">
    <div class="catalogue__main"><h3 class="catalogue__name">${item.name}</h3><p class="catalogue__meta">${terms(item)}</p></div>${availability(item)}</li>`;

  const render = (reason: "filter" | "data") => {
    if (!catalog) return;
    results.removeAttribute("aria-busy");
    clear.hidden = !search.value;
    writeParams({ q: search.value.trim(), category, available: availableOnly.checked ? "1" : null, sort: sort === "name" ? null : sort });
    sortGroup.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.sort === sort)));
    if (!catalog.items.length) {
      count.textContent = "";
      chips.hidden = true;
      mount(results, emptyState("No items are open for borrowing yet", "Staff are reviewing the inventory. Approved items appear here automatically; there is no need to refresh."));
      return;
    }
    const inCategory = (value: string) => catalog!.items.filter((item) => !value || item.category === value).length;
    chips.hidden = catalog.categories.length < 2;
    const chipMarkup = html`${["", ...catalog.categories].map((value) => html`<button type="button" class="chip" data-category="${value}" aria-pressed="${value === category}">${value ? categoryName(value) : "All"}<span class="chip__count">${inCategory(value)}</span></button>`)}`;
    // Rebuild chips only when they change, and keep keyboard focus on the same chip.
    if (chips.innerHTML !== chipMarkup.value) {
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".chip")?.dataset.category;
      mount(chips, chipMarkup);
      if (focused !== undefined) chips.querySelector<HTMLElement>(`[data-category="${CSS.escape(focused)}"]`)?.focus();
    }
    const query = search.value.trim().toLowerCase();
    const shown = catalog.items.filter((item) => (!category || item.category === category)
      && (!availableOnly.checked || item.available > 0)
      && (!query || `${item.name} ${item.category}`.toLowerCase().includes(query)))
      .sort((a, b) => sort === "available" ? b.available - a.available || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
    const ready = shown.filter((item) => item.available > 0).length;
    count.textContent = `${plural(shown.length, "item")}, ${ready} available`;
    const groups = sort === "name" ? [...new Set(shown.map((item) => item.category))] : [null];
    preservingFocus(results, () => mount(results, shown.length
      ? html`${groups.map((group, index) => {
          const members = group === null ? shown : shown.filter((item) => item.category === group);
          return html`<section class="catalogue-group" aria-labelledby="group-${index}">
            <h2 class="catalogue-group__title" id="group-${index}">${group === null ? "By availability" : categoryName(group)} <span>${members.length}</span></h2>
            <ul class="catalogue">${members.map(row)}</ul></section>`;
        })}`
      : emptyState("Nothing matches those filters", "Try a shorter search, another category, or include items that are currently out.", html`<button class="button button--secondary" type="button" id="clear-filters">Clear filters</button>`)));
    if (reason === "filter") stagger(results);
    else rollCounts(results, before, changed);
    changed.clear();
  };

  let timer = 0;
  onLeave(() => window.clearTimeout(timer));
  search.addEventListener("input", () => { clear.hidden = !search.value; window.clearTimeout(timer); timer = window.setTimeout(() => render("filter"), 140); });
  search.addEventListener("keydown", (event) => { if (event.key === "Escape" && search.value) { search.value = ""; render("filter"); } });
  clear.addEventListener("click", () => { search.value = ""; render("filter"); search.focus(); });
  availableOnly.addEventListener("change", () => render("filter"));
  sortGroup.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-sort]");
    if (button && button.dataset.sort !== sort) { sort = button.dataset.sort as Sort; render("filter"); }
  });
  chips.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-category]");
    if (!chip || chip.dataset.category === category) return;
    category = chip.dataset.category ?? "";
    render("filter");
    chips.querySelector<HTMLButtonElement>(`[data-category="${CSS.escape(category)}"]`)?.focus();
  });
  results.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest("#clear-filters")) return;
    search.value = "";
    category = "";
    availableOnly.checked = false;
    render("filter");
    search.focus();
  });

  const poll = live<Catalog>("/api/public/catalog", {
    interval: 15_000,
    status: () => document.querySelector("#live-status"),
    onData: (data) => {
      const first = !catalog;
      before = new Map(catalog?.items.map((item) => [item.id, item.available]) ?? []);
      for (const item of data.items) if (before.has(item.id) && before.get(item.id) !== item.available) changed.add(item.id);
      if (category && !data.categories.includes(category)) category = "";
      catalog = data;
      render(first ? "filter" : "data");
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
