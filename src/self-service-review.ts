import "./self-service.css";
import { REVIEW_REASONS, type ReviewReason, foldReference, selfServiceReference } from "./catalog-policy";
import { REPORT_LABELS, type ReportKind } from "./location-tree";
import { loadSession, shell } from "./staff";
import { type Html, CREST, MARK, api, emptyState, expired, failure, formatDateTime, html, icon, label, live, mount, onLeave, plural, preservingFocus, toast, units, writeParams } from "./ui";

/*
 * Staff view of phone self-service (/staff/self-service). Normal records reconcile on their own;
 * this page shows only what needs a person: records held for a decision, returns to match,
 * items whose records went below zero, "can’t find it" reports from phones, plus the last week of activity and the QR poster.
 */

type Entry = {
  id: string; type: "TAKE" | "BORROW" | "USE" | "RETURN"; itemId: string; itemName: string; unit: string; quantity: number; personName: string;
  studentId: string | null; purpose: string | null; reason: string | null; returnOutcome: string | null; note: string | null; returnBy: string | null;
  occurredAt: string; receivedAt: string; deviceTime: string; loanId: string | null; applied: number; review: ReviewReason | null; hasPhoto: number;
  resolvedAt: string | null; resolutionNote: string | null; resolvedBy: string | null; device: string; network: string | null;
};
type Issue = { itemId: string; itemName: string; unit: string; lowest: number; since: string; onHand: number; openLoans: number };
type Candidate = { id: string; itemId: string; quantity: number; purpose: string; borrowerName: string; studentId: string | null; createdAt: string };
type LocationReport = { id: string; itemId: string; itemName: string; kind: ReportKind; reporterName: string | null; createdAt: string; location: string | null };
type Review = { revision: number; open: Entry[]; stockIssues: Issue[]; recent: Entry[]; candidates: Candidate[]; locationReports: LocationReport[]; enabledItems: number };
type View = "attention" | "activity" | "poster";

const VIEWS: Record<View, string> = { attention: "Needs attention", activity: "Last 7 days", poster: "QR code & poster" };
const QR_URL = "logistics.hausc.org/self-service";

function verb(entry: Entry): string {
  if (entry.type === "TAKE") return "Take";
  if (entry.type === "BORROW") return "Borrow";
  if (entry.type === "USE") return "Use";
  return entry.returnOutcome === "DAMAGED" ? "Return (damaged)" : entry.returnOutcome === "LOST" ? "Reported lost" : "Return";
}

/** A use of an open unit names no amount (Part 5B). */
const quantityText = (entry: Entry) => entry.type === "USE" ? "no amount, stock unchanged" : `${entry.quantity} ${units(entry.quantity, entry.unit)}`;

/** The phone's own clock is shown only when it disagrees with the corrected time by more than five minutes. */
function timing(entry: Entry): Html {
  const skew = Math.abs(Date.parse(entry.deviceTime) - Date.parse(entry.occurredAt)) > 5 * 60_000;
  const late = Date.parse(entry.receivedAt) - Date.parse(entry.occurredAt) > 5 * 60_000;
  return html`${formatDateTime(entry.occurredAt)}${late ? html` <span class="muted">· synced ${formatDateTime(entry.receivedAt)}</span>` : ""}${skew ? html` <span class="muted">· phone clock said ${formatDateTime(entry.deviceTime)}</span>` : ""}`;
}

function facts(entry: Entry): Html {
  const rows: Array<[string, Html | string]> = [
    ["Reference", html`<span class="mono">${selfServiceReference(entry.id)}</span>`],
    ["Who", html`${entry.personName}${entry.studentId ? html` <span class="mono muted">${entry.studentId}</span>` : ""}`],
    ["When", timing(entry)]
  ];
  if (entry.purpose) rows.push(["For", entry.reason ? `${label(entry.purpose)}: ${entry.reason}` : label(entry.purpose)]);
  if (entry.note) rows.push(["Note", entry.note]);
  rows.push(["Phone ID", html`<span class="mono">${entry.device}</span>${entry.network ? html` · network <span class="mono">${entry.network}</span>` : ""}`]);
  return html`<dl class="review-card__facts">${rows.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}</dl>`;
}

/** The evidence photo of a borrow or return, for signed-in staff: a held record's own, or the loan's once the borrow was applied. */
function photoLink(entry: Entry): Html {
  if ((entry.type !== "BORROW" && entry.type !== "RETURN") || !(entry.hasPhoto || (entry.type === "BORROW" && entry.loanId))) return html``;
  return html`<a class="text-link" href="${entry.applied && entry.loanId ? `/api/staff/loans/${entry.loanId}/photo` : `/api/staff/self-service/${entry.id}/photo`}" target="_blank" rel="noopener">Photo<span class="visually-hidden"> (opens in a new tab)</span></a>`;
}

function actions(entry: Entry, candidates: Candidate[]): Html {
  const note = html`<label class="visually-hidden" for="note-${entry.id}">Note</label><input id="note-${entry.id}" name="note" maxlength="300" placeholder="Note (optional)" autocomplete="off" />`;
  const photo = photoLink(entry);
  if (entry.applied) {
    return html`${note}<div class="review-card__buttons"><button type="button" class="button button--secondary button--sm" data-act="dismiss">Mark checked</button><a class="text-link" href="/staff/items?item=${entry.itemId}" data-route>Open item</a>${photo}</div>`;
  }
  if (entry.review === "RETURN_CHECK" && entry.loanId) {
    const loan = candidates.find((candidate) => candidate.id === entry.loanId);
    return html`${entry.hasPhoto ? html`<img class="review-card__photo" loading="lazy" src="/api/staff/self-service/${entry.id}/photo" alt="Photo sent with the return of ${entry.itemName}" />` : ""}
      ${loan ? html`<p class="field__hint">Borrowed by ${loan.borrowerName}${loan.studentId ? ` (${loan.studentId})` : ""}, ${formatDateTime(loan.createdAt)}.</p>` : ""}
      <input type="hidden" name="loanId" value="${entry.loanId}" />
      ${note}<div class="review-card__buttons"><button type="button" class="button button--primary button--sm" data-act="match">Confirm returned${entry.returnOutcome === "RETURNED" ? " · update stock" : ""}</button><button type="button" class="button button--ghost button--sm" data-act="dismiss">Not returned</button>${photo}</div>`;
  }
  if (entry.type === "RETURN") {
    const loans = candidates.filter((loan) => loan.itemId === entry.itemId);
    if (!loans.length) {
      return html`<p class="field__hint">No open loan of this item. If it came back anyway, record a count from the item, then dismiss this.</p>
        ${note}<div class="review-card__buttons"><button type="button" class="button button--primary button--sm" data-act="dismiss">Dismiss</button><a class="text-link" href="/staff/items?item=${entry.itemId}" data-route>Open item</a></div>`;
    }
    return html`<div class="field"><label for="loan-${entry.id}">Loan it belongs to</label>
        <select id="loan-${entry.id}" name="loanId"><option value="">Choose an open loan…</option>${loans.map((loan) => html`<option value="${loan.id}" ${loan.quantity === entry.quantity ? "" : "disabled"}>${loan.borrowerName}${loan.studentId ? ` (${loan.studentId})` : ""} · ${loan.quantity} · since ${formatDateTime(loan.createdAt)}${loan.quantity === entry.quantity ? "" : " · different quantity"}</option>`)}</select></div>
      ${note}<div class="review-card__buttons"><button type="button" class="button button--primary button--sm" data-act="match">Match and close loan</button><button type="button" class="button button--ghost button--sm" data-act="dismiss">Dismiss</button></div>`;
  }
  return html`${note}<div class="review-card__buttons"><button type="button" class="button button--primary button--sm" data-act="apply">${entry.type === "TAKE" ? "Apply the take" : entry.type === "USE" ? "Accept the use" : "Apply the loan"}</button><button type="button" class="button button--ghost button--sm" data-act="dismiss">Dismiss</button>${photo}</div>`;
}

function reviewCard(entry: Entry, candidates: Candidate[]): Html {
  return html`<li class="review-card" data-key="${entry.id}">
      <form class="review-card__form" data-entry="${entry.id}" novalidate>
        <header class="review-card__head">
          <p class="review-card__what"><strong>${verb(entry)}</strong> · ${quantityText(entry)} · <a href="/staff/items?item=${entry.itemId}" data-route>${entry.itemName}</a></p>
          <span class="tag ${entry.applied ? "tag--gold" : "tag--warn"}">${entry.applied ? "Recorded · check" : "Waiting for you"}</span>
        </header>
        <p class="review-card__why">${entry.review ? REVIEW_REASONS[entry.review] : ""}.</p>
        ${facts(entry)}
        ${actions(entry, entry.applied ? [] : candidates)}
      </form>
    </li>`;
}

/** A phone said an item is not where it should be. It changes nothing by itself: staff look, fix the item's place if it moved, then resolve it. */
function reportRow(report: LocationReport): Html {
  return html`<li class="review-card review-card--report" data-report-id="${report.id}">
      <header class="review-card__head"><p class="review-card__what"><strong>${REPORT_LABELS[report.kind]}</strong> · <a href="/staff/items?item=${report.itemId}" data-route>${report.itemName}</a></p><span class="tag tag--warn">Phone report</span></header>
      <dl class="review-card__facts"><div><dt>Who</dt><dd>${report.reporterName ?? html`<span class="muted">No name given</span>`}</dd></div>
        <div><dt>When</dt><dd>${formatDateTime(report.createdAt)}</dd></div>${report.location ? html`<div><dt>Said to be in</dt><dd>${report.location}</dd></div>` : ""}</dl>
      <p class="review-card__why">Nothing was changed. Look for the item, correct its place in Edit details if it moved, then resolve this.</p>
      <div class="field"><label for="report-note-${report.id}">Note <span class="field__optional">optional</span></label><input id="report-note-${report.id}" name="note" maxlength="300" autocomplete="off" placeholder="Found it on shelf B" /></div>
      <div class="review-card__buttons"><button type="button" class="button button--primary button--sm" data-resolve-report="${report.id}">Resolve</button><a class="text-link" href="/staff/items?item=${report.itemId}" data-route>Open item</a></div>
    </li>`;
}

function issueRow(issue: Issue): Html {
  return html`<li class="review-card review-card--issue">
      <header class="review-card__head"><p class="review-card__what"><a href="/staff/items?item=${issue.itemId}" data-route>${issue.itemName}</a></p><span class="tag tag--bad">Below zero</span></header>
      <p class="review-card__why">Records show ${issue.lowest} ${units(issue.lowest, issue.unit)} since ${formatDateTime(issue.since)}: more was recorded than the shelf could hold.${issue.openLoans ? ` ${plural(issue.openLoans, "loan")} out; one may be wrong.` : ""}${issue.onHand === issue.lowest ? "" : ` On hand now: ${issue.onHand}.`} Count the shelf to correct it.</p>
      <p class="review-card__buttons"><a class="button button--secondary button--sm" href="/staff/items?item=${issue.itemId}" data-route>Open item to count</a></p>
    </li>`;
}

function poster(): Html {
  return html`<div class="poster-preview">
      <div class="poster" id="poster">
        <div class="poster__lockup">${CREST}<span class="poster__rule" aria-hidden="true"></span>${MARK}</div>
        <p class="poster__kicker">HAU USC Department of Logistics</p>
        <h2 class="poster__title">Borrow <span aria-hidden="true">·</span> Take <span aria-hidden="true">·</span> Return</h2>
        <img class="poster__qr" src="/qr/logistics-self-service.svg" alt="QR code that opens ${QR_URL}" width="41" height="41" />
        <p class="poster__cta">Scan for Logistics Self-Service</p>
        <p class="poster__sub">Install it once for offline access</p>
        <p class="poster__url">${QR_URL}</p>
      </div>
    </div>
    <div class="poster-actions">
      <button type="button" class="button button--primary" data-print>Print poster</button>
      <a class="button button--secondary" href="/qr/logistics-self-service.svg" download>QR as SVG</a>
      <a class="button button--secondary" href="/qr/logistics-self-service.png" download>QR as PNG</a>
    </div>
    <p class="hint-line">${icon("info")}<span>The code only ever opens ${QR_URL}. What people see behind it follows the catalog: turn Self-Service on for an item in its Edit details. Print it at least 4 cm wide.</span></p>`;
}

export async function selfServiceReview(): Promise<void> {
  const session = await loadSession("self-service");
  if (!session) return;
  document.title = "Self-Service · Staff workspace";
  shell(session, "self-service", html`
    <header class="page-header">
      <div class="page-header__title"><h1>Self-Service</h1><p id="ss-summary">Loading…</p></div>
      <div class="page-header__actions">
        <p class="live-status" id="live-status">Connecting…</p>
        <a class="button button--secondary" href="/self-service" target="_blank" rel="noopener">Open Self-Service ${icon("external")}<span class="visually-hidden">(opens in a new tab)</span></a>
      </div>
    </header>
    <div class="views" id="ss-views" role="group" aria-label="Self-Service views"></div>
    <div class="ss-staff-find" id="ss-find" hidden><label class="visually-hidden" for="ss-find-input">Find a record</label><div class="search-field">${icon("search")}<input id="ss-find-input" type="search" placeholder="Find a reference, person or item" autocomplete="off" /></div></div>
    <div id="ss-results" aria-busy="true"><div class="data-table-wrap" aria-hidden="true">${Array.from({ length: 4 }, () => html`<div class="skeleton-row"><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--num"></span></div>`)}</div></div>`);

  const query = new URLSearchParams(window.location.search);
  let view: View = (Object.keys(VIEWS) as View[]).find((value) => value === query.get("view")) ?? "attention";
  let data: Review | null = null;
  let find = "";
  const results = document.querySelector<HTMLElement>("#ss-results")!;

  function render(): void {
    writeParams({ view: view === "attention" ? null : view });
    document.querySelector<HTMLElement>("#ss-find")!.hidden = view !== "activity";
    const attention = data ? data.open.length + data.stockIssues.length + data.locationReports.length : 0;
    mount(document.querySelector("#ss-views")!, html`${(Object.keys(VIEWS) as View[]).map((key) => html`<button type="button" class="view-tab" data-view="${key}" aria-pressed="${key === view}">${VIEWS[key]}${key === "attention" && attention ? html`<span class="view-tab__count">${attention}</span>` : ""}</button>`)}`);
    if (!data) return;
    mount(document.querySelector("#ss-summary")!, html`${plural(data.enabledItems, "item")} offered on phones · ${attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : "nothing needs attention"}`);
    results.removeAttribute("aria-busy");
    preservingFocus(results, () => mount(results, view === "poster" ? poster() : view === "activity" ? activity(data!) : needsAttention(data!)));
  }

  function needsAttention(review: Review): Html {
    if (!review.open.length && !review.stockIssues.length && !review.locationReports.length) {
      return emptyState("Nothing needs attention", review.enabledItems
        ? "Records from phones reconcile on their own. Anything ambiguous will appear here."
        : "No item is offered on Self-Service yet. Active, reviewed Consumables are taken, and Loanables listed on the Lending Hub are borrowed.");
    }
    return html`${review.locationReports.length ? html`<h2 class="section-label">Reports from phones</h2><ul class="review-list">${review.locationReports.map(reportRow)}</ul>` : ""}
      ${review.stockIssues.length ? html`<h2 class="section-label">Count needed</h2><ul class="review-list">${review.stockIssues.map(issueRow)}</ul>` : ""}
      ${review.open.length ? html`<h2 class="section-label">Records to check</h2><ul class="review-list">${review.open.map((entry) => reviewCard(entry, review.candidates))}</ul>` : ""}`;
  }

  /** A person typing a reference (any case, with or without the dash), a name, a student ID or an item narrows the week. */
  function found(entries: Entry[]): Entry[] {
    const typed = find.trim().toLowerCase();
    if (!typed) return entries;
    const reference = foldReference(find);
    return entries.filter((entry) => (reference.length >= 3 && foldReference(selfServiceReference(entry.id)).includes(reference))
      || [entry.personName, entry.studentId ?? "", entry.itemName].some((text) => text.toLowerCase().includes(typed)));
  }

  function activity(review: Review): Html {
    if (!review.recent.length) return emptyState("No Self-Service activity this week", "Takes, borrows and returns recorded with phones appear here.");
    const shown = found(review.recent);
    if (!shown.length) return emptyState("No record matches", "Check the reference, or try a name or an item. This list covers the last 7 days.");
    return html`<div class="data-table-wrap"><table class="data-table data-table--static">
        <caption class="visually-hidden">Self-Service records this week</caption>
        <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Who</th><th scope="col">State</th></tr></thead>
        <tbody>${shown.map((entry) => html`<tr>
          <td>${timing(entry)}</td>
          <td>${verb(entry)} · ${quantityText(entry)} · <a href="/staff/items?item=${entry.itemId}" data-route>${entry.itemName}</a>
            <span class="ss-staff-ref"><span class="mono muted">${selfServiceReference(entry.id)}</span>${photoLink(entry)}</span></td>
          <td>${entry.personName}${entry.studentId ? html` <span class="mono muted">${entry.studentId}</span>` : ""}</td>
          <td>${entry.resolvedAt ? html`<span class="tag">Checked${entry.resolvedBy ? ` by ${entry.resolvedBy}` : ""}</span>` : entry.review ? html`<span class="tag ${entry.applied ? "tag--gold" : "tag--warn"}">${entry.applied ? "Recorded · check" : "Waiting for you"}</span>` : html`<span class="tag tag--ok">Recorded</span>`}</td>
        </tr>`)}</tbody></table></div>`;
  }

  const poll = live<Review>("/api/staff/self-service", {
    interval: 15_000,
    status: () => document.querySelector("#live-status"),
    onData: (next) => { data = next; render(); },
    onError: (error) => {
      if (error.status === 401) expired();
      else if (!data) { results.removeAttribute("aria-busy"); mount(results, emptyState("Self-Service could not be loaded", `${error.message} Retrying automatically.`, "", "error")); }
    }
  });
  render();

  document.querySelector<HTMLInputElement>("#ss-find-input")!.addEventListener("input", (event) => { find = (event.target as HTMLInputElement).value; render(); });
  document.querySelector("#ss-views")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]");
    if (button) { view = button.dataset.view as View; render(); }
  });
  results.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-print]")) {
      document.body.classList.add("printing-poster");
      window.print();
      return;
    }
    const resolve = target.closest<HTMLButtonElement>("[data-resolve-report]");
    if (resolve) {
      const note = resolve.closest("[data-report-id]")!.querySelector<HTMLInputElement>("input[name=note]")!.value;
      resolve.disabled = true;
      try {
        await api(`/api/staff/location-reports/${resolve.dataset.resolveReport}/resolve`, { method: "POST", body: JSON.stringify({ note }) });
        toast("Report resolved.");
        await poll.refresh();
      } catch (error) {
        resolve.disabled = false;
        toast(failure(error), "error");
      }
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-act]");
    const form = button?.closest<HTMLFormElement>("[data-entry]");
    if (!button || !form) return;
    const values = new FormData(form);
    const action = button.dataset.act!;
    if (action === "match" && !values.get("loanId")) { toast("Choose the loan it belongs to first.", "error"); form.querySelector<HTMLSelectElement>("select")?.focus(); return; }
    button.disabled = true;
    try {
      await api(`/api/staff/self-service/${form.dataset.entry}/resolve`, { method: "POST", body: JSON.stringify({ action, note: values.get("note") || null, ...(action === "match" ? { loanId: values.get("loanId") } : {}) }) });
      toast(action === "apply" ? "Applied." : action === "match" ? "Confirmed: the loan is closed." : "Marked as checked.");
      await poll.refresh();
    } catch (error) {
      button.disabled = false;
      toast(failure(error), "error");
    }
  });
  const afterPrint = () => document.body.classList.remove("printing-poster");
  window.addEventListener("afterprint", afterPrint);
  onLeave(() => { window.removeEventListener("afterprint", afterPrint); afterPrint(); });
}
