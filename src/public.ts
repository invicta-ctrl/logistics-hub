import { CREST, MARK, type Html, animateNumber, app, categoryName, emptyState, html, icon, itemThumbnailUrl, itemVisual, label, live, mount, navigate, onLeave, ownQuery, plural, preservingFocus, sheet, sheetContent, thumbImg, units, writeParams } from "./ui";

type LendingItem = { id: string; name: string; category: string; unit: string; itemType: string; available: number; audience: string; photo: string | null; iconKey?: string | null };
/** `selfService` is missing from a Worker older than V1.16.8; the sheet then offers no Self-Service link (fails closed). */
type Catalog = { revision: number; items: LendingItem[]; categories: string[]; selfService?: "open" | "paused" };
type Sort = "name" | "available";

const USC_FACEBOOK = "https://www.facebook.com/holyangeluniversitysc";

function page(content: Html, current: "" | "home" | "lending"): void {
  mount(app, html`
    <header class="site-header">
      <div class="container site-header__inner">
        <a class="site-header__brand" href="/" data-route aria-label="Department of Logistics HAU University Student Council home">${CREST}<span class="site-header__name" aria-hidden="true">Department of Logistics</span></a>
        <nav class="site-nav" aria-label="Main">
          <a class="site-nav__link site-nav__link--secondary" href="/lending" data-route ${current === "lending" ? html`aria-current="page"` : ""}>Lending Hub</a>
          <a class="site-nav__link site-nav__link--pill" href="/staff" data-route>Staff sign in</a>
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
function availability(item: LendingItem, id = ""): Html {
  const named = id ? html`id="${id}"` : "";
  if (item.available <= 0) return html`<p class="avail avail--out" ${named}><span class="avail__label">All out</span></p>`;
  if (item.available === 1) return html`<p class="avail avail--low" ${named}><span class="avail__count" data-count="${item.id}">1</span> <span class="avail__label">left</span></p>`;
  return html`<p class="avail" ${named}><span class="avail__count" data-count="${item.id}">${item.available}</span> <span class="avail__label">${units(item.available, item.unit)}<span class="avail__word"> available</span></span></p>`;
}

/**
 * An item's sheet on the Lending Hub (LH-LEND-01, accepted 2026-11-04 for V1.16.8): its picture, how many are in the office, what it
 * is, and how to borrow or take it. While Self-Service is open and the item is not all out, it also offers to record it there, on the
 * visitor's phone. It shows only what the public catalog already publishes: no place, borrower or return date.
 */
function lendingSheetBody(item: LendingItem | undefined, selfService: Catalog["selfService"]): Html {
  if (!item) return html`<p class="lend-sheet__gone">This item is no longer on the Lending Hub.</p>`;
  const consumable = item.itemType === "Consumable";
  const usc = item.audience === "USC_STAFF_ONLY";
  const recordable = selfService === "open" && item.available > 0;
  return html`<div class="lend-sheet">
    <div class="lend-sheet__stage">${itemVisual({ ...item, photoId: item.photo }, (id) => itemThumbnailUrl(id, "public", "detail"), "lend-sheet__visual", true)}</div>
    <div class="lend-sheet__facts">${availability(item)}<p class="lend-sheet__what">${consumable ? "Taken and not returned." : "Borrow it and bring it back."}${usc ? " For USC use only." : ""}</p></div>
    ${recordable ? html`<section class="lend-sheet__self" aria-labelledby="lend-self-title">
      <h3 id="lend-self-title">At the office? Record it yourself.</h3>
      <p>${consumable ? "Self-Service on your phone asks only for your name." : "Self-Service on your phone asks for your name, your student ID number, what it is for, and a photo of you holding the item."}</p>
      <a class="button button--primary lend-sheet__go" href="/self-service?do=item&item=${encodeURIComponent(item.id)}" data-route>${consumable ? "Take it with Self-Service" : "Borrow it with Self-Service"} ${icon("arrow")}</a>
    </section>` : ""}
    <section aria-labelledby="lend-how-title">
      <h3 class="lend-sheet__heading" id="lend-how-title">${consumable ? "How to get it" : "How to borrow it"}</h3>
      <ol class="lend-sheet__steps">
        <li>Come to the Logistics office.</li>
        <li>${consumable ? "Staff record what you take." : "Staff record the loan and its return date with you."}</li>
      </ol>
    </section>
  </div>`;
}

/** Only the exceptions: most items are open to students and USC staff, and are returned. */
function terms(item: LendingItem): string {
  return [item.audience === "USC_STAFF_ONLY" ? label(item.audience) : "", item.itemType === "Consumable" ? "Consumable, taken and not returned" : ""].filter(Boolean).join(" · ");
}

const skeletonRows = (count: number) => html`<section class="catalogue-group" aria-hidden="true"><h2 class="catalogue-group__title"><span class="skeleton skeleton--text"></span></h2><ul class="catalogue catalogue--photos">${Array.from({ length: count }, () => html`<li class="catalogue__row"><span class="item-thumb skeleton"></span><div class="catalogue__main"><span class="skeleton skeleton--text"></span></div><span class="skeleton skeleton--num"></span></li>`)}</ul></section>`;

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
        <p class="hero__eyebrow">University Student Council · Holy Angel University</p>
        <h1 id="hero-title">Borrow equipment from the USC Department of Logistics</h1>
        <p class="hero__lede">Find what you need, see how many are in the office now, and choose an item to see how to borrow it.</p>
        <form class="hero__find" action="/lending" method="get" role="search" aria-labelledby="find-title">
          <h2 id="find-title" class="visually-hidden">Find equipment</h2>
          <div class="hero__field">
            ${icon("search")}
            <label class="visually-hidden" for="find-q">Equipment name</label>
            <input id="find-q" name="q" type="search" placeholder="Projector, table, extension cord…" autocomplete="off" enterkeyhint="search" data-search />
            <button type="submit" aria-label="Search the Lending Hub">${icon("arrow")}</button>
          </div>
          <div class="hero__actions">
            <a class="button hero__primary" href="/lending" data-route>Browse the Lending Hub ${icon("arrow")}</a>
            <a class="hero__available" href="/lending?available=1" data-route>Show what is available now ${icon("arrow")}</a>
          </div>
        </form>
      </div>
    </section>

    <div class="container"><aside class="hero__services" aria-label="Logistics services"><a href="/lending" data-route>${icon("swap")}<strong>Lending Hub</strong><span>Browse equipment and current availability.</span></a><a href="/self-service" data-route>${icon("phone")}<strong>Self-Service</strong><span>Record an item you take, use or return, when the service is open.</span></a><a href="/staff" data-route>${icon("user")}<strong>Staff sign-in</strong><span>Manage stock, lending and item records.</span></a></aside></div>

    <section class="section" aria-labelledby="steps-title">
      <div class="container">
        <h2 id="steps-title" class="section__title">How borrowing works</h2>
        <ol class="steps">
          <li><span class="steps__n">1</span><h3>Find it here</h3><p>Search the Lending Hub and choose an item to see how many are on the shelf and how to borrow it.</p></li>
          <li><span class="steps__n">2</span><h3>Visit the Department</h3><p>Come to the Logistics office. While Self-Service is open, you can record it yourself on your phone there; online requests are not open yet.</p></li>
          <li><span class="steps__n">3</span><h3>Borrow and return</h3><p>The loan and its return date are recorded with you, so the next person sees accurate availability.</p></li>
        </ol>
      </div>
    </section>

  </main>`, "home");

  // The entry card is a plain GET form to /lending; with the router running it navigates in place. It shows no counts and
  // makes no catalog request: availability lives only in the Lending Hub.
  const find = app.querySelector<HTMLFormElement>(".hero__find")!;
  find.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = String(new FormData(find).get("q") ?? "").trim();
    navigate(query ? `/lending?q=${encodeURIComponent(query)}` : "/lending");
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
            <p class="page-intro__lede">What you can borrow or take, and how many are in the office now. Choose an item to see how to borrow it.</p>
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
        <div class="chips" id="lending-categories" role="group" aria-label="Category" aria-busy="true"><span class="chip chip--skeleton" aria-hidden="true"><span class="skeleton"></span></span><span class="chip chip--skeleton" aria-hidden="true"><span class="skeleton"></span></span><span class="chip chip--skeleton" aria-hidden="true"><span class="skeleton"></span></span></div>
      </div>
    </search>
    <div class="container lending-layout">
      <p class="result-count" id="lending-count" aria-live="polite"></p>
      <div id="lending-results" aria-busy="true">${skeletonRows(8)}</div>
      <p class="lending-note">Borrow in person at the Logistics office. Staff record the loan and return date.</p>
    </div>
    <dialog class="sheet" id="lend-sheet" aria-labelledby="lend-sheet-title"></dialog>
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

  // Each row is one button, named by the item, whose target covers the row (V1.16.8): pressing it opens the item's sheet.
  const row = (item: LendingItem) => html`<li class="catalogue__row catalogue__row--open ${changed.has(item.id) ? "is-changed" : ""}" data-key="${item.id}">${thumbImg(item)}
    <div class="catalogue__main"><h3 class="catalogue__name"><button type="button" class="catalogue__open" data-open-item="${item.id}" aria-haspopup="dialog" aria-describedby="avail-${item.id}">${item.name}</button></h3>${terms(item) ? html`<p class="catalogue__meta">${terms(item)}</p>` : ""}</div>${availability(item, `avail-${item.id}`)}<span class="catalogue__chevron" aria-hidden="true">${icon("next")}</span></li>`;

  // The open item lives in the address (?item=), so a link restores it and a phone's Back closes it. Opening adds a history entry;
  // closing goes back over it, or drops the key when the page was loaded with it.
  const dialog = document.querySelector<HTMLDialogElement>("#lend-sheet")!;
  let openId: string | null = null;
  let pushed = false;
  let closingFromAddress = false;
  const itemSheet = sheet(dialog, {
    onClose: () => {
      openId = null;
      if (closingFromAddress) { closingFromAddress = false; return; }
      // Leaving the page (Borrow it with Self-Service) closes the sheet too; the address is then the next page's.
      if (window.location.pathname !== "/lending" || !new URLSearchParams(window.location.search).has("item")) return;
      if (pushed) { pushed = false; window.history.back(); } else writeParams({ item: null });
    }
  });
  const drawSheet = () => {
    if (!openId || !catalog) return;
    const item = catalog.items.find((entry) => entry.id === openId);
    const body = dialog.querySelector(".sheet__body");
    if (body) mount(body, lendingSheetBody(item, catalog.selfService));
    else mount(dialog, sheetContent(item ? categoryName(item.category) : "Lending Hub", item?.name ?? "Item", lendingSheetBody(item, catalog.selfService), "lend-sheet-title"));
  };
  const showItem = (id: string, origin: Element | null) => {
    if (!catalog) return;
    if (!catalog.items.some((entry) => entry.id === id)) { writeParams({ item: null }); return; }
    openId = id;
    drawSheet();
    if (!dialog.open) itemSheet.open(origin);
  };
  const fromAddress = () => {
    const id = new URLSearchParams(window.location.search).get("item");
    if (id && id !== openId) {
      // Already open on another item (Forward or Back between two): the sheet stays and shows this one.
      if (dialog.open) dialog.innerHTML = "";
      showItem(id, results.querySelector(`[data-open-item="${CSS.escape(id)}"]`));
    } else if (!id && dialog.open) {
      closingFromAddress = true;
      itemSheet.close(true);
    }
  };
  ownQuery(fromAddress);

  const render = (reason: "filter" | "data") => {
    if (!catalog) return;
    results.removeAttribute("aria-busy");
    clear.hidden = !search.value;
    writeParams({ q: search.value.trim(), category, available: availableOnly.checked ? "1" : null, sort: sort === "name" ? null : sort });
    sortGroup.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.sort === sort)));
    chips.removeAttribute("aria-busy");
    if (!catalog.items.length) {
      count.textContent = "";
      chips.hidden = true;
      mount(chips, html``);
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
    // Every item has the same reserved icon/photo frame, keeping names aligned.
    const photos = catalog.items.length > 0;
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
    const open = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-open-item]");
    if (open) {
      const params = new URLSearchParams(window.location.search);
      params.set("item", open.dataset.openItem!);
      pushed = true;
      navigate(`/lending?${params}`);
      return;
    }
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
      // A link with ?item= opens its sheet once the catalog is here; an open sheet follows each poll (count, Self-Service, unlisted).
      if (first) fromAddress();
      else if (dialog.open) drawSheet();
    },
    onError: () => {
      if (catalog) return;
      results.removeAttribute("aria-busy");
      chips.removeAttribute("aria-busy");
      chips.hidden = true;
      mount(chips, html``);
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
