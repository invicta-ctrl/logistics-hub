import { type AccountEvent, eventText } from "./account-ui";
import { adminPage, confirmImpact } from "./admin-frame";
import { api, emptyState, failure, formatDateTime, html, mount, plural, setMessage, toast } from "./ui";

/** Administration > Accountability: what is kept about who borrowed what, when it can be removed, and what administrators have changed. */
export async function accountability(): Promise<void> {
  const session = await adminPage("accountability", {
    title: "Accountability",
    lede: "What is kept about who borrowed or took something, and a record of what administrators changed.",
    body: (session) => html`
    <section class="admin-block admin-block--first" aria-labelledby="ret-title">
      <h2 id="ret-title" class="section-title">Old personal details</h2>
      <p>Who borrowed or took something is kept for accountability: two years after a loan closes and one year after a phone record is settled. After that the borrower's name, student ID and photo can be removed. The record itself (the item, quantity, dates and stock) stays, and free text people typed is not touched. Nothing is removed by itself.</p>
      ${session.role === "OWNER" ? html`<p id="ret-status" role="status">Checking…</p>
      <div class="form-alert" id="ret-alert" role="alert" hidden></div>
      <button type="button" class="button button--danger" id="ret-run" disabled>Remove old personal details</button>`
        : html`<p>Only the owner can remove them.</p>`}
    </section>
    <section class="activity" aria-labelledby="activity-title">
      <h2 id="activity-title" class="section-title">Security activity</h2>
      <ol class="history" id="activity"><li class="history__empty">Loading…</li></ol>
    </section>`
  });
  if (!session) return;

  async function loadActivity(): Promise<void> {
    try {
      const { events } = await api<{ events: AccountEvent[] }>("/api/staff/admin/activity");
      mount(document.querySelector("#activity")!, events.length
        ? html`${events.map((event) => html`<li class="history__item"><div><p class="history__title">${eventText(event)}</p><p class="history__meta"><time datetime="${event.at}">${formatDateTime(event.at)}</time></p></div></li>`)}`
        : html`<li class="history__empty">No account or setting changes yet.</li>`);
    } catch (error) {
      mount(document.querySelector("#activity")!, html`<li>${emptyState("Activity could not be loaded", failure(error), "", "error", 3)}</li>`);
    }
  }

  const status = document.querySelector<HTMLElement>("#ret-status");
  const alert = document.querySelector<HTMLElement>("#ret-alert");
  async function checkRetention(): Promise<void> {
    if (!status) return;
    try {
      const due = await api<{ loans: number; phoneRecords: number; photos: number }>("/api/staff/admin/retention");
      const none = !due.loans && !due.phoneRecords;
      status.textContent = none ? "Nothing is old enough to remove yet." : `Ready to remove: ${plural(due.loans, "loan")}, ${plural(due.phoneRecords, "phone record")} and ${plural(due.photos, "photo")}.`;
      document.querySelector<HTMLButtonElement>("#ret-run")!.disabled = none;
    } catch (error) { status.textContent = ""; setMessage(alert!, failure(error)); }
  }
  document.querySelector("#ret-run")?.addEventListener("click", async () => {
    const confirmed = await confirmImpact({
      kicker: "Old personal details",
      title: "Remove the names, student IDs and photos listed here?",
      impact: html`<p>${status!.textContent}</p><p>This cannot be undone. The records, quantities and stock stay; only who borrowed or took something is removed. Take a backup first (Deployment runbook, Backups and restore).</p>`,
      confirm: "Remove old personal details",
      danger: true
    });
    if (!confirmed) return;
    const total = { loans: 0, phoneRecords: 0 };
    try {
      // One request erases a bounded number of rows; ask again while more are due.
      for (let more = true; more;) {
        const batch = await api<{ loans: number; phoneRecords: number; more: boolean }>("/api/staff/admin/retention", { method: "POST" });
        total.loans += batch.loans;
        total.phoneRecords += batch.phoneRecords;
        more = batch.more && batch.loans + batch.phoneRecords > 0;
      }
      setMessage(alert!, "");
      toast(`Removed details from ${plural(total.loans, "loan")} and ${plural(total.phoneRecords, "phone record")}.`);
    } catch (error) { setMessage(alert!, failure(error)); }
    await Promise.all([checkRetention(), loadActivity()]);
  });
  await Promise.all([loadActivity(), checkRetention()]);
}
