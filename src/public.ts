import { CREST, MARK, type Html, animateNumber, app, categoryName, emptyState, html, icon, label, live, mount, onLeave, plural, preservingFocus, thumbImg, units, writeParams } from "./ui";

type LendingItem = { id: string; name: string; category: string; unit: string; itemType: string; available: number; audience: string; photo: string | null };
type Catalog = { revision: number; items: LendingItem[]; categories: string[] };
type Sort = "name" | "available";

const LOCKUP = html`<span class="lockup">${CREST}<span class="lockup__rule" aria-hidden="true"></span>${MARK}<span class="lockup__text"><strong>Department of Logistics</strong><span>HAU University Student Council</span></span></span>`;

const USC_FACEBOOK = "https://www.facebook.com/holyangeluniversitysc";

function page(content: Html, current: "" | "home" | "lending"): void {
  mount(app, html`
    <header class="site-header">
      <div class="container site-header__inner">
        <a class="site-header__brand" href="/" data-route aria-label="Department of Logistics home">${LOCKUP}</a>
        <nav class="site-nav" aria-label="Main">
          <a class="site-nav__link" href="/lending" data-route ${current === "lending" ? html`aria-current="page"` : ""}>Lending Hub</a>
          <a class="site-nav__link" href="/staff" data-route>Staff sign in</a>
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
            <li><a href="${USC_FACEBOOK}" target="_blank" rel="noopener noreferrer">Student Council on Facebook<span class="visually-hidden"> (opens in a new tab)</span></a></li>
          </ul>
        </nav>
      </div>
      <div class="site-footer__base"><div class="container">© ${new Date().getFullYear()} University Student Council, Holy Angel University</div></div>
    </footer>`);
}


/** Availability reads at a glance: plenty, the last one, or all out. */
function availability(item: LendingItem): Html {
  if (item.available <= 0) return html`<p class="avail avail--out"><span class="avail__label">All out</span></p>`;
  if (item.available === 1) return html`<p class="avail avail--low"><span class="avail__count" data-count="${item.id}">1</span> <span class="avail__label">left</span></p>`;
  return html`<p class="avail"><span class="avail__count" data-count="${item.id}">${item.available}</span> <span class="avail__label">${units(item.available, item.unit)}<span class="avail__word"> available</span></span></p>`;
}

/** Only the exceptions: most items are open to students and USC staff, and are returned. */
function terms(item: LendingItem): string {
  return [item.audience === "USC_STAFF_ONLY" ? label(item.audience) : "", item.itemType === "Consumable" ? "Consumable, taken and not returned" : ""].filter(Boolean).join(" · ");
}

const skeletonRows = (count: number) => html`<ul class="catalogue" aria-hidden="true">${Array.from({ length: count }, () => html`<li class="catalogue__row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></li>`)}</ul>`;

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
      <div class="container hero__inner">
        <div class="hero__copy">
          <h1 id="hero-title">Borrow equipment from the USC Department of Logistics</h1>
          <p class="hero__lede">Check what is on the shelf, then borrow it in person at the Logistics office.</p>
          <div class="hero__actions">
            <a class="button button--on-dark button--lg" href="/lending" data-route>Browse the Lending Hub ${icon("arrow")}</a>
            <a class="text-link text-link--light hero__secondary" href="#steps-title">How borrowing works</a>
          </div>
        </div>
        <figure class="hero__banner"><img src="/brand/ydd-2026-banner.jpg" alt="Siglawang: Yabong ng Pamana, Youth Development Day 2026" width="960" height="356" fetchpriority="high" /></figure>
      </div>
    </section>

    <section class="section" aria-labelledby="steps-title">
      <div class="container">
        <h2 id="steps-title" class="section__title">How borrowing works</h2>
        <ol class="steps">
          <li><span class="steps__n">1</span><h3>Find it here</h3><p>Search the Lending Hub and check that the item is on the shelf. Counts update as staff record stock.</p></li>
          <li><span class="steps__n">2</span><h3>Visit the Department</h3><p>Speak with Department of Logistics staff. Loans are arranged in person; online requests are not open yet.</p></li>
          <li><span class="steps__n">3</span><h3>Borrow and return</h3><p>Staff record the loan and its return date with you, so the next person sees accurate availability.</p></li>
        </ol>
      </div>
    </section>

  </main>`, "home");
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
            <p class="page-intro__lede">What you can borrow or take, and how many are in the office now.</p>
          </div>
          <p class="live-status" id="live-status">Connecting…</p>
        </div>
      </div>
    </div>
    <search class="filterbar" aria-label="Filter the Lending Hub">
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
    </search>
    <div class="container lending-layout">
      <p class="result-count" id="lending-count" aria-live="polite"></p>
      <div id="lending-results" aria-busy="true">${skeletonRows(6)}</div>
      <p class="lending-note">Borrow in person at the Logistics office. Staff record the loan and return date.</p>
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

  const row = (item: LendingItem) => html`<li class="catalogue__row ${changed.has(item.id) ? "is-changed" : ""}" data-key="${item.id}">${thumbImg(item.photo)}
    <div class="catalogue__main"><h3 class="catalogue__name">${item.name}</h3>${terms(item) ? html`<p class="catalogue__meta">${terms(item)}</p>` : ""}</div>${availability(item)}</li>`;

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
    // Once any item has a photo, every row keeps the same left margin, so names line up whether or not a row has its picture.
    const photos = catalog.items.some((item) => item.photo);
    const groups = sort === "name" ? [...new Set(shown.map((item) => item.category))] : [null];
    preservingFocus(results, () => mount(results, shown.length
      ? html`${groups.map((group, index) => {
          const members = group === null ? shown : shown.filter((item) => item.category === group);
          return html`<section class="catalogue-group" aria-labelledby="group-${index}">
            <h2 class="catalogue-group__title" id="group-${index}">${group === null ? "By availability" : categoryName(group)} <span>${members.length}</span></h2>
            <ul class="catalogue ${photos ? "catalogue--photos" : ""}">${members.map(row)}</ul></section>`;
        })}`
      : emptyState("Nothing matches those filters", "Try a shorter search, another category, or include items that are currently out.", html`<button class="button button--secondary" type="button" id="clear-filters">Clear filters</button>`)));
    if (reason === "data") rollCounts(results, before, changed);
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

/** Offline, for a page this phone never saved: the staff tools always need a connection. */
export function offlinePage(): void {
  document.title = "Offline · Department of Logistics";
  page(html`<main id="main-content" class="container page-message"><div class="empty">${icon("cloudOff")}<h1>This page needs a connection</h1><p>You're offline. Self-Service keeps working without internet.</p><a class="button button--primary" href="/self-service" data-route>Open Self-Service</a></div></main>`, "");
}

export function notFound(): void {
  document.title = "Page not found · Department of Logistics";
  page(html`<main id="main-content" class="container page-message"><div class="empty">${icon("box")}<h1>That page doesn't exist</h1><p>The link may be out of date or mistyped.</p><a class="button button--primary" href="/" data-route>Go to the home page</a></div></main>`, "");
}
