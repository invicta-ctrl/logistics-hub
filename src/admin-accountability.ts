import "./admin.css";
import { type AccountEvent, eventText } from "./account-ui";
import { adminPage, confirmImpact, decisions, settingRows, settingsGroup, stateTag, verdict } from "./admin-frame";
import { api, emptyState, failure, formatDateTime, html, mount, plural, setMessage, toast, stillShown } from "./ui";

type Due = { loans: number; phoneRecords: number; photos: number };

/**
 * Administration > Accountability: what is kept about who borrowed what, when it can be removed, and what administrators have changed.
 * V1.16.7: in the four bands. The verdict and the one decision (old personal details ready to remove) come from the Worker's count.
 */
export async function accountability(): Promise<void> {
  const onPage = stillShown();
  const session = await adminPage("accountability", {
    title: "Accountability",
    lede: "What is kept about who borrowed or took something, and a record of what administrators changed.",
    body: (session) => html`
    <div id="ret-verdict">${session.role === "OWNER"
      ? verdict("ok", "Checking what is old enough to remove…")
      : verdict("ok", "Who borrowed or took something is kept for accountability.", "Only the owner can remove old personal details.")}</div>
    <div id="ret-decide"></div>
    ${settingsGroup("ret-title", "Old personal details", html`
      <p>Who borrowed or took something is kept for accountability: two years after a loan closes and one year after a phone record is settled. After that the borrower's name, student ID and photo can be removed. The record itself (the item, quantity, dates and stock) stays, and free text people typed is not touched. Nothing is removed by itself.</p>
      ${session.role === "OWNER" ? html`${settingRows([{ key: "retention", name: "Ready to remove", value: html`<span id="ret-state">${stateTag("ok", "Checking…")}</span>`, does: html`<span id="ret-status" role="status">Checking…</span>`,
        action: html`<button type="button" class="button button--danger button--sm" id="ret-run" disabled>Remove old personal details</button>` }])}
      <div class="form-alert" id="ret-alert" role="alert" hidden></div>`
        : html`<p>Only the owner can remove them.</p>`}`)}
    <section class="admin-block settings-group activity" aria-labelledby="activity-title">
      <div class="admin-block__head"><h2 id="activity-title" class="section-title">Security activity</h2></div>
      <ol class="history" id="activity"><li class="history__empty">Loading…</li></ol>
    </section>`
  });
  if (!session) return;

  async function loadActivity(): Promise<void> {
    try {
      const { events } = await api<{ events: AccountEvent[] }>("/api/staff/admin/activity");
      if (!onPage()) return;
      mount(document.querySelector("#activity")!, events.length
        ? html`${events.map((event) => html`<li class="history__item"><div><p class="history__title">${eventText(event)}</p><p class="history__meta"><time datetime="${event.at}">${formatDateTime(event.at)}</time></p></div></li>`)}`
        : html`<li class="history__empty">No account or setting changes yet.</li>`);
    } catch (error) {
      if (!onPage()) return;
      mount(document.querySelector("#activity")!, html`<li>${emptyState("Activity could not be loaded", failure(error), "", "error", 3)}</li>`);
    }
  }

  const status = document.querySelector<HTMLElement>("#ret-status");
  const alert = document.querySelector<HTMLElement>("#ret-alert");
  const run = document.querySelector<HTMLButtonElement>("#ret-run");
  const dueText = (due: Due) => `${plural(due.loans, "loan")}, ${plural(due.phoneRecords, "phone record")} and ${plural(due.photos, "photo")}`;
  async function checkRetention(): Promise<boolean> {
    if (!status) return true;
    try {
      const due = await api<Due>("/api/staff/admin/retention");
      if (!onPage()) return false;
      const none = !due.loans && !due.phoneRecords;
      status.textContent = none ? "Nothing is old enough to remove yet." : `Ready to remove: ${dueText(due)}.`;
      mount(document.querySelector("#ret-state")!, none ? stateTag("ok", "Nothing yet") : stateTag("warn", "Ready"));
      mount(document.querySelector("#ret-verdict")!, none
        ? verdict("ok", "Nothing is old enough to remove.", "Personal details are kept for as long as accountability needs them.")
        : verdict("warn", "Old personal details are ready to remove.", `${dueText(due)} are past the time they are kept for.`));
      mount(document.querySelector("#ret-decide")!, decisions(none ? [] : [{ what: `Ready to remove: ${dueText(due)}.`, detail: "The records, quantities and stock stay; only who borrowed or took something goes.", action: html`<button type="button" class="button button--danger button--sm" data-ret-run>Remove</button>` }]));
      run!.disabled = none;
      return true;
    } catch (error) { status.textContent = ""; setMessage(alert!, failure(error)); return false; }
  }

  async function remove(): Promise<void> {
    const total = { loans: 0, phoneRecords: 0 };
    // Off and busy until the removal ends; the check afterwards sets the button as the new figures say.
    run!.disabled = true;
    run!.setAttribute("aria-busy", "true");
    const removed = await confirmImpact({
      kicker: "Old personal details",
      title: "Remove the names, student IDs and photos listed here?",
      now: "Kept", after: "Removed",
      impact: html`<p>${status!.textContent}</p><p>The records, quantities and stock stay; only who borrowed or took something is removed. Take a backup first (Deployment runbook, Backups and restore).</p>`,
      affects: ["The borrowers and takers named in those records", "Anyone later reading those loans and phone records"],
      undo: "This cannot be undone.",
      confirm: "Remove old personal details",
      danger: true,
      run: async () => {
        // One request erases a bounded number of rows; ask again while more are due.
        for (let more = true; more;) {
          const batch = await api<{ loans: number; phoneRecords: number; more: boolean }>("/api/staff/admin/retention", { method: "POST" });
          total.loans += batch.loans;
          total.phoneRecords += batch.phoneRecords;
          more = batch.more && batch.loans + batch.phoneRecords > 0;
        }
      }
    });
    if (removed) {
      setMessage(alert!, "");
      toast(`Removed details from ${plural(total.loans, "loan")} and ${plural(total.phoneRecords, "phone record")}.`);
    }
    // A refused removal may have removed some batches first: the figures and the activity are read again either way. A failed check
    // leaves the button on (it cannot say what is due).
    const [checked] = await Promise.all([checkRetention(), loadActivity()]);
    if (!checked) run!.disabled = false;
    run!.removeAttribute("aria-busy");
  }
  run?.addEventListener("click", () => void remove());
  document.querySelector("#ret-decide")?.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest("[data-ret-run]")) void remove(); });
  await Promise.all([loadActivity(), checkRetention()]);
}
