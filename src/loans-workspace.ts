import { PUBLIC_LENDING_ITEM_TYPE } from "./catalog-policy";
import { type Borrower, type Loan, bindLoanForm, isOverdue, loanFields, loanRow, openReturn } from "./loan-form";
import { loadSession, shell } from "./staff";
import { type Html, api, emptyState, expired, html, icon, label, live, mount, onLeave, plural, preservingFocus, reducedMotion, sheet as createSheet, sheetContent, toast, units, writeParams } from "./ui";

type Period = "30d" | "12m" | "all";
type Purpose = "INDIVIDUAL" | "USC";
type Ranked = { period: Period; purpose: Purpose; name: string; studentId: string | null; loans: number; units: number; outNow: number; problems: number };
type TopItem = { period: Period; itemId: string; itemName: string; loans: number; units: number };
type Total = { period: Period; purpose: Purpose; loans: number; units: number; borrowers: number; problems: number };
type Overview = { revision: number; today: string; open: Loan[]; closed: Loan[]; borrowers: Ranked[]; items: TopItem[]; totals: Total[]; known: Borrower[] };
type View = "out" | "people" | "history";
type LendItem = { id: string; name: string; unit: string; onHand: number; status: string; itemType: string };

const PERIODS: Record<Period, string> = { "30d": "Last 30 days", "12m": "Last 12 months", all: "All time" };
const PURPOSES: Purpose[] = ["INDIVIDUAL", "USC"];

/** A bar's length is data, set through the CSSOM because the CSP forbids inline style attributes. */
function sizeBars(container: Element): void {
  container.querySelectorAll<HTMLElement>("[data-share]").forEach((bar) => bar.style.setProperty("--share", bar.dataset.share!));
}

export async function loansWorkspace(): Promise<void> {
  const session = await loadSession("loans");
  if (!session) return;
  document.title = "Loans · Staff workspace";
  shell(session, "loans", html`
    <header class="page-header">
      <div class="page-header__title"><h1>Loans</h1><p id="loans-summary">Loading loans…</p></div>
      <div class="page-header__actions">
        <p class="live-status" id="live-status">Connecting…</p>
        <button class="button button--primary" type="button" data-lend>${icon("handoff")}Lend an item</button>
      </div>
    </header>
    <div class="views" id="loan-views" role="group" aria-label="Loan views"></div>
    <div class="table-toolbar" id="loan-toolbar">
      <label class="search-field">${icon("search")}<span class="visually-hidden">Search loans</span><input id="loan-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search name, student ID, item or reason" data-search /><kbd aria-hidden="true">/</kbd></label>
    </div>
    <div id="loan-results" aria-busy="true"><div class="data-table-wrap" aria-hidden="true">${Array.from({ length: 5 }, () => html`<div class="skeleton-row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></div>`)}</div></div>
    <dialog class="sheet" id="lend-sheet" aria-labelledby="sheet-title"></dialog>`);

  const params = new URLSearchParams(window.location.search);
  let view: View = (["out", "people", "history"] as const).find((value) => value === params.get("view")) ?? "out";
  let period: Period = (["30d", "12m", "all"] as const).find((value) => value === params.get("period")) ?? "30d";
  let data: Overview | null = null;
  let lendForm: ReturnType<typeof bindLoanForm> | null = null;
  const results = document.querySelector<HTMLElement>("#loan-results")!;
  const search = document.querySelector<HTMLInputElement>("#loan-search")!;
  search.value = params.get("q") ?? "";
  /** A link from Attention names one loan: it is scrolled to and marked once the list first draws. */
  let focusLoan = params.get("loan");

  const matches = (loan: Loan) => {
    const query = search.value.trim().toLowerCase();
    return !query || `${loan.borrowerName} ${loan.studentId ?? ""} ${loan.itemName} ${loan.reason ?? ""}`.toLowerCase().includes(query);
  };

  function outMarkup(overview: Overview): Html {
    // Overdue first, then the longest out.
    const open = overview.open.filter(matches).sort((a, b) => Number(isOverdue(b, overview.today)) - Number(isOverdue(a, overview.today)) || a.createdAt.localeCompare(b.createdAt));
    if (!open.length) return search.value.trim() ? emptyState("No loans match", "Try another name, student ID or item.") : emptyState("Nothing is out on loan", "Lend from an item's Loan tab in Items, or with Lend an item above.");
    return html`<ul class="loan-list">${open.map((loan) => loanRow(loan, true))}</ul>`;
  }

  function historyMarkup(overview: Overview): Html {
    const closed = overview.closed.filter(matches);
    if (!closed.length) return search.value.trim() ? emptyState("No returns match", "Try another name, student ID or item.") : emptyState("No returns yet", "Returned, damaged and lost loans appear here.");
    return html`<ul class="loan-list loan-list--closed">${closed.map((loan) => loanRow(loan, true))}</ul>
      ${overview.closed.length === 100 ? html`<p class="hint-line">${icon("info")}<span>Showing the 100 most recent returns.</span></p>` : ""}`;
  }

  function peopleMarkup(overview: Overview): Html {
    const totals = overview.totals.filter((row) => row.period === period);
    const sum = (key: "loans" | "units" | "borrowers" | "problems") => totals.reduce((total, row) => total + row[key], 0);
    const byPurpose = (purpose: Purpose) => totals.find((row) => row.purpose === purpose)?.loans ?? 0;
    const loans = sum("loans");
    const board = (purpose: Purpose) => {
      const rows = overview.borrowers.filter((row) => row.period === period && row.purpose === purpose);
      const top = rows[0]?.loans ?? 1;
      return html`<section class="leaderboard" aria-labelledby="board-${purpose}">
        <header class="leaderboard__head"><h3 id="board-${purpose}">${label(purpose)}</h3><p class="muted">${plural(byPurpose(purpose), "loan")}</p></header>
        ${rows.length ? html`<ol class="rank-list">${rows.map((row) => html`<li class="rank-row">
            <div class="rank-row__main">
              <p class="rank-row__name"><strong>${row.name}</strong>${row.studentId ? html` <span class="mono muted">${row.studentId}</span>` : ""}</p>
              <span class="rank-row__bar" data-share="${(row.loans / top).toFixed(3)}" aria-hidden="true"></span>
              <p class="rank-row__meta">${plural(row.units, "item")} borrowed${row.outNow ? html` · <span class="tag tag--brand">${row.outNow} out now</span>` : ""}${row.problems ? html` · <span class="tag tag--warn">${row.problems} damaged or lost</span>` : ""}</p>
            </div>
            <p class="rank-row__value"><strong>${row.loans}</strong> ${row.loans === 1 ? "loan" : "loans"}</p></li>`)}</ol>`
          : html`<p class="muted leaderboard__empty">No ${label(purpose).toLowerCase()} loans in this period.</p>`}
      </section>`;
    };
    const items = overview.items.filter((row) => row.period === period);
    const topItem = items[0]?.loans ?? 1;
    return html`<div class="sort-toggle period-switch" role="group" aria-label="Period">${(Object.keys(PERIODS) as Period[]).map((key) => html`<button type="button" data-period="${key}" aria-pressed="${key === period}">${PERIODS[key]}</button>`)}</div>
      <dl class="stat-strip">
        <div class="stat"><dt>Loans</dt><dd><span class="stat__value">${loans}</span>
          <span class="split-bar" aria-hidden="true"><span class="split-bar__individual" data-share="${loans ? (byPurpose("INDIVIDUAL") / loans).toFixed(3) : "0"}"></span></span>
          <span class="stat__note"><span class="stat__part"><span class="dot dot--individual" aria-hidden="true"></span>${byPurpose("INDIVIDUAL")} individual</span><span class="stat__part"><span class="dot dot--usc" aria-hidden="true"></span>${byPurpose("USC")} USC</span></span></dd></div>
        <div class="stat"><dt>Items lent</dt><dd><span class="stat__value">${sum("units")}</span><span class="stat__note">pieces handed out</span></dd></div>
        <div class="stat"><dt>Borrowers</dt><dd><span class="stat__value">${sum("borrowers")}</span><span class="stat__note">different people</span></dd></div>
        <div class="stat ${sum("problems") ? "stat--warn" : ""}"><dt>Damaged or lost</dt><dd><span class="stat__value">${sum("problems")}</span><span class="stat__note">${loans ? `${Math.round((sum("problems") / loans) * 100)}% of loans` : "none"}</span></dd></div>
      </dl>
      <section class="subsection" aria-labelledby="top-borrowers">
        <h2 class="subsection__title" id="top-borrowers">Top borrowers</h2>
        <div class="leaderboards">${PURPOSES.map(board)}</div>
      </section>
      <section class="subsection" aria-labelledby="board-items">
        <h2 class="subsection__title" id="board-items">Most borrowed items</h2>
        <div class="leaderboard">
        ${items.length ? html`<ol class="rank-list">${items.map((row) => html`<li class="rank-row">
            <div class="rank-row__main"><p class="rank-row__name"><a class="row-link" href="/staff/items?item=${row.itemId}" data-route>${row.itemName}</a></p><span class="rank-row__bar rank-row__bar--item" data-share="${(row.loans / topItem).toFixed(3)}" aria-hidden="true"></span><p class="rank-row__meta">${plural(row.units, "piece")} in total</p></div>
            <p class="rank-row__value"><strong>${row.loans}</strong> ${row.loans === 1 ? "loan" : "loans"}</p></li>`)}</ol>`
          : html`<p class="muted leaderboard__empty">Nothing was lent in this period.</p>`}
        </div>
      </section>`;
  }

  const render = () => {
    if (!data) return;
    results.removeAttribute("aria-busy");
    writeParams({ view: view === "out" ? null : view, period: view === "people" && period !== "30d" ? period : null, q: search.value.trim() });
    const overdue = data.open.filter((loan) => isOverdue(loan, data!.today)).length;
    const outUnits = data.open.reduce((total, loan) => total + loan.quantity, 0);
    mount(document.querySelector("#loan-views")!, html`${([["out", "Out now", data.open.length], ["people", "Borrowers", ""], ["history", "Returned", data.closed.length]] as Array<[View, string, number | string]>).map(([key, text, count]) =>
      html`<button type="button" class="view-tab" data-view="${key}" aria-pressed="${key === view}">${text}${count === "" ? "" : html`<span class="view-tab__count">${count}</span>`}</button>`)}`);
    const summary = document.querySelector<HTMLElement>("#loans-summary")!;
    mount(summary, data.open.length ? html`${plural(data.open.length, "loan")} out · ${outUnits} ${outUnits === 1 ? "item" : "items"}${overdue ? html` · <strong class="is-bad">${overdue} overdue</strong>` : ""}` : html`Nothing is out on loan.`);
    document.querySelector<HTMLElement>("#loan-toolbar")!.hidden = view === "people";
    preservingFocus(results, () => mount(results, view === "out" ? outMarkup(data!) : view === "people" ? peopleMarkup(data!) : historyMarkup(data!)));
    sizeBars(results);
    if (focusLoan) {
      const row = results.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusLoan)}"]`);
      row?.classList.add("is-focus");
      row?.setAttribute("tabindex", "-1");
      row?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      row?.focus({ preventScroll: true });
      if (!row) toast("That loan is not in this list. Try searching for the borrower or item.");
      focusLoan = null;
      writeParams({ loan: null });
    }
  };

  const poll = live<Overview>("/api/staff/loans", {
    interval: 15_000,
    status: () => document.querySelector("#live-status"),
    onData: (next) => { data = next; render(); lendForm?.refresh(); },
    onError: (error) => {
      if (error.status === 401) expired();
      else if (!data) { results.removeAttribute("aria-busy"); mount(results, emptyState("Loans could not be loaded", `${error.message} Retrying automatically.`, "", "error")); }
    }
  });

  document.querySelector("#loan-views")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]");
    if (button) { view = button.dataset.view as View; render(); }
  });
  let searchTimer = 0;
  onLeave(() => window.clearTimeout(searchTimer));
  search.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(render, 120); });
  results.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const periodButton = target.closest<HTMLButtonElement>("[data-period]");
    if (periodButton) { period = periodButton.dataset.period as Period; render(); results.querySelector<HTMLElement>(`[data-period="${period}"]`)?.focus(); return; }
    const giveBack = target.closest<HTMLButtonElement>("[data-return]");
    const loan = giveBack && data?.open.find((entry) => entry.id === giveBack.dataset.return);
    if (loan) openReturn(loan, poll.refresh);
  });

  /* ---------- Lend an item (any Loanable item, without leaving the page) ---------- */

  const lendSheet = document.querySelector<HTMLDialogElement>("#lend-sheet")!;
  let items: LendItem[] = [];
  let chosen: LendItem | null = null;
  const panel = createSheet(lendSheet, { onClose: () => { lendForm = null; chosen = null; } });

  async function loadItems(): Promise<void> {
    items = (await api<{ items: LendItem[] }>("/api/staff/inventory")).items.filter((item) => item.itemType === PUBLIC_LENDING_ITEM_TYPE && item.status !== "INACTIVE");
  }

  function showChosen(): void {
    const card = lendSheet.querySelector("#lend-card");
    if (!card) return;
    mount(card, chosen ? html`<p class="record-card__name">${chosen.name} <span class="mono muted">${chosen.id}</span></p><p class="record-card__meta"><strong>${chosen.onHand}</strong> ${units(chosen.onHand, chosen.unit)} on the shelf</p>`
      : html`<p class="muted">Choose a Loanable item to lend.</p>`);
    lendForm?.refresh();
  }

  async function openLend(): Promise<void> {
    mount(lendSheet, sheetContent("Loans", "Lend an item", html`<div class="skeleton skeleton--block"></div>`));
    panel.open();
    try { await loadItems(); } catch (error) { mount(lendSheet.querySelector(".sheet__body")!, emptyState("Items could not be loaded", error instanceof Error ? error.message : "Try again.", "", "error", 3)); return; }
    mount(lendSheet.querySelector(".sheet__body")!, html`
      <div class="field"><label for="lend-item">Item</label><input id="lend-item" list="lend-items" autocomplete="off" spellcheck="false" placeholder="Search by name or ID" aria-describedby="lend-card" /><datalist id="lend-items">${items.map((item) => html`<option value="${item.name} · ${item.id}">${item.onHand} on the shelf</option>`)}</datalist></div>
      <div class="record-card" id="lend-card" aria-live="polite"></div>
      <form id="lend-form" class="form" novalidate aria-label="Loan details">${loanFields("lend")}</form>`);
    const picker = lendSheet.querySelector<HTMLInputElement>("#lend-item")!;
    picker.addEventListener("input", () => {
      const id = picker.value.match(/ITM-[A-Za-z0-9-]+/i)?.[0]?.toUpperCase();
      const exact = items.filter((item) => item.name.toLowerCase() === picker.value.trim().toLowerCase());
      chosen = (id ? items.find((item) => item.id === id) : exact.length === 1 ? exact[0] : undefined) ?? null;
      showChosen();
    });
    lendForm = bindLoanForm(lendSheet.querySelector<HTMLFormElement>("#lend-form")!, {
      target: () => chosen,
      known: () => data?.known ?? [],
      onLent: async () => {
        await Promise.all([poll.refresh(), loadItems()]);
        chosen = items.find((item) => item.id === chosen?.id) ?? null;
        showChosen();
      }
    });
    showChosen();
    picker.focus();
  }
  document.querySelector("[data-lend]")!.addEventListener("click", () => void openLend());
}
