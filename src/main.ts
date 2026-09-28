import "./styles.css";

type CatalogItem = {
  id: string;
  name: string;
  category: string;
  itemType: string;
  unit: string;
  lendingAvailability: "available" | "unavailable";
  availableToBorrow: boolean;
};

type CatalogResponse = { items: CatalogItem[]; categories: string[] };
const app = document.querySelector<HTMLDivElement>("#app")!;
let latestCatalogRequest = 0;

function layout(content: string, compact = false): string {
  return `<header class="site-header ${compact ? "site-header--compact" : ""}"><a class="brand" href="/" data-route><img class="brand-mark" src="/retained-dol-mark.png" alt="Department of Logistics" /><span><strong>HAU USC</strong><small>Department of Logistics</small></span></a><nav aria-label="Primary navigation"><a href="/lending" data-route>Lending Hub</a><a href="/staff" data-route>Staff Login</a></nav></header>${content}<footer class="site-footer"><span>Holy Angel University · University Student Council</span><span>Department of Logistics</span></footer>`;
}

function landing(): void {
  document.title = "HAU USC Logistics";
  app.innerHTML = layout(`<main id="main-content" class="landing"><section class="hero"><div class="hero__veil"></div><div class="hero__content"><p class="hero__identity">University Student Council · 2026</p><h1>Logistics that keeps the work moving.</h1><p class="hero__copy">The Department of Logistics supports the people and materials behind University Student Council work.</p><div class="hero__actions"><a class="button button--gold" href="/lending" data-route>Explore Lending Hub <span aria-hidden="true">→</span></a><a class="button button--quiet" href="/staff" data-route>Staff Login</a></div></div></section><section class="gateway" aria-labelledby="gateway-title"><div><h2 id="gateway-title">Choose your destination</h2><p>Public browsing and staff access are kept separate by design.</p></div><div class="gateway__links"><a class="gateway-link" href="/lending" data-route><span class="gateway-link__symbol" aria-hidden="true">01</span><span><strong>Lending Hub</strong><small>Browse current catalog information.</small></span><span aria-hidden="true">→</span></a><a class="gateway-link" href="/staff" data-route><span class="gateway-link__symbol" aria-hidden="true">02</span><span><strong>Staff Login</strong><small>Access the staff workspace.</small></span><span aria-hidden="true">→</span></a><div class="gateway-link gateway-link--disabled" aria-label="Logistics Request is currently unavailable"><span class="gateway-link__symbol" aria-hidden="true">03</span><span><strong>Logistics Request</strong><small>Currently unavailable</small></span><span class="status">Unavailable</span></div></div></section></main>`);
}

function lendingShell(): void {
  document.title = "Lending Hub · HAU USC Logistics";
  app.innerHTML = layout(`<main id="main-content" class="catalog"><section class="catalog__intro"><a class="back-link" href="/" data-route>← Back to Logistics</a><h1>Lending Hub</h1><p>Browse catalog records. Lending availability appears only after an item has been reviewed and approved for borrowing.</p></section><section class="catalog__controls" aria-label="Catalog filters"><label><span>Search the catalog</span><input id="catalog-search" type="search" autocomplete="off" placeholder="Search by item or category" /></label><label><span>Category</span><select id="catalog-category"><option value="">All categories</option></select></label></section><section aria-live="polite" aria-atomic="true"><div id="catalog-results" class="catalog__results"><p class="state state--loading">Loading catalog records…</p></div></section></main>`, true);
  const search = document.querySelector<HTMLInputElement>("#catalog-search")!;
  const category = document.querySelector<HTMLSelectElement>("#catalog-category")!;
  let timer: number | undefined;
  const update = () => loadCatalog(search.value, category.value);
  search.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(update, 180); });
  category.addEventListener("change", update);
  void loadCatalog();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function itemMarkup(item: CatalogItem): string {
  const availability = item.availableToBorrow ? "Available to borrow" : "Lending availability unconfirmed";
  return `<article class="catalog-item"><div class="catalog-item__visual" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M9 16h30v22H9zM15 10h18v6H15zM17 24h14"/></svg></div><div class="catalog-item__body"><p>${escapeHtml(item.category)}</p><h2>${escapeHtml(item.name)}</h2><dl><div><dt>Type</dt><dd>${escapeHtml(displayItemType(item.itemType))}</dd></div><div><dt>Unit</dt><dd>${escapeHtml(item.unit)}</dd></div></dl><span class="availability ${item.lendingAvailability === "available" ? "availability--available" : "availability--unavailable"}">${availability}</span></div></article>`;
}

function displayItemType(value: string): string {
  if (value === "NEEDS_REVIEW") return "Catalog review pending";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function loadCatalog(query = "", selectedCategory = ""): Promise<void> {
  const results = document.querySelector<HTMLDivElement>("#catalog-results");
  const category = document.querySelector<HTMLSelectElement>("#catalog-category");
  if (!results || !category) return;
  const requestId = ++latestCatalogRequest;
  results.innerHTML = `<p class="state state--loading">Loading catalog records…</p>`;
  const search = new URLSearchParams();
  if (query.trim()) search.set("q", query.trim());
  if (selectedCategory) search.set("category", selectedCategory);
  try {
    const response = await fetch(`/api/public/catalog?${search}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("catalog request failed");
    const data = await response.json() as CatalogResponse;
    if (requestId !== latestCatalogRequest) return;
    if (category.options.length === 1) {
      category.insertAdjacentHTML("beforeend", data.categories.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join(""));
    }
    results.innerHTML = data.items.length ? `<div class="catalog-grid">${data.items.map(itemMarkup).join("")}</div>` : `<div class="state"><h2>No catalog records match those filters.</h2><p>Try a broader search or another category.</p></div>`;
  } catch {
    if (requestId !== latestCatalogRequest) return;
    results.innerHTML = `<div class="state state--error"><h2>We could not load the catalog.</h2><p>Check your connection and try again.</p><button class="text-button" type="button" id="retry-catalog">Try again</button></div>`;
    document.querySelector("#retry-catalog")?.addEventListener("click", () => void loadCatalog(query, selectedCategory));
  }
}

function staffLogin(): void {
  document.title = "Staff Login · HAU USC Logistics";
  app.innerHTML = layout(`<main id="main-content" class="staff"><section class="staff__panel"><a class="back-link" href="/" data-route>← Back to Logistics</a><h1>Staff Login</h1><p>Use an authorized staff account to enter the Logistics workspace.</p><form id="staff-login" novalidate><label><span>Username</span><input name="username" autocomplete="username" required /></label><label><span>Password</span><input name="password" type="password" autocomplete="current-password" required /></label><p id="staff-message" class="form-message" role="status"></p><button class="button button--primary" type="submit">Sign in</button></form><p class="staff__notice">Sign-in is available to authorized staff. Contact the Department of Logistics if you need access.</p></section></main>`, true);
  document.querySelector<HTMLFormElement>("#staff-login")!.addEventListener("submit", (event) => void submitLogin(event));
}

async function submitLogin(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const message = document.querySelector<HTMLParagraphElement>("#staff-message")!;
  const button = form.querySelector<HTMLButtonElement>("button")!;
  const values = new FormData(form);
  button.disabled = true;
  message.textContent = "Signing in…";
  try {
    const response = await fetch("/api/staff/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: values.get("username"), password: values.get("password") }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Sign-in was not accepted.");
    navigate("/staff/home");
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "Sign-in was not accepted.";
    button.disabled = false;
  }
}

async function staffHome(): Promise<void> {
  try {
    const response = await fetch("/api/staff/session", { credentials: "same-origin" });
    if (response.status === 401) { navigate("/staff", true); return; }
    if (!response.ok) throw new Error("The staff workspace is temporarily unavailable.");
    document.title = "Staff Workspace · HAU USC Logistics";
    app.innerHTML = layout(`<main id="main-content" class="staff"><section class="staff__panel staff__panel--home"><p class="home__label">Authorized workspace</p><h1>Welcome to Logistics.</h1><p>Your staff session is active. Operational workspaces will appear here as they become available.</p><div class="staff-shell" aria-label="Available staff workspace"><div><strong>Secure staff access</strong><span>Your session is protected and ready for authorized operations.</span></div><div><strong>Operations workspace</strong><span>Additional staff tools are not yet available.</span></div></div><p id="staff-message" class="form-message" role="status"></p><button class="text-button" type="button" id="staff-logout">Sign out</button></section></main>`, true);
    document.querySelector("#staff-logout")?.addEventListener("click", () => void logout());
  } catch (error) {
    app.innerHTML = layout(`<main id="main-content" class="staff"><section class="staff__panel"><h1>Workspace unavailable</h1><p>${escapeHtml(error instanceof Error ? error.message : "Please try again shortly.")}</p><a class="text-button" href="/staff" data-route>Return to staff login</a></section></main>`, true);
  }
}

async function logout(): Promise<void> {
  const message = document.querySelector<HTMLParagraphElement>("#staff-message");
  try {
    const response = await fetch("/api/staff/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error("We could not sign you out. Please try again.");
    navigate("/staff", true);
  } catch (error) {
    if (message) message.textContent = error instanceof Error ? error.message : "We could not sign you out. Please try again.";
  }
}

function navigate(path: string, replace = false): void {
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  render();
}

function render(): void {
  const path = window.location.pathname;
  if (path === "/lending") lendingShell();
  else if (path === "/staff") staffLogin();
  else if (path === "/staff/home") void staffHome();
  else landing();
  document.querySelectorAll<HTMLAnchorElement>("a[data-route]").forEach((link) => link.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target) return;
    event.preventDefault();
    navigate(link.pathname);
  }));
  window.scrollTo(0, 0);
  window.requestAnimationFrame(() => {
    const main = document.querySelector<HTMLElement>("#main-content");
    main?.setAttribute("tabindex", "-1");
    main?.focus({ preventScroll: true });
  });
}

window.addEventListener("popstate", render);
render();
