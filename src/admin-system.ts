import "./admin.css";
import { adminPage } from "./admin-frame";
import { type Html, api, emptyState, failure, formatDateTime, html, mount } from "./ui";

/** The answer of GET /api/staff/admin/system (src/system-status.ts). */
type Probe = { ok: boolean; ms: number };
type Status = {
  checkedAt: string;
  build: { version: string; commit: string | null; builtAt: string; migrations: string[] } | null;
  database: Probe & { migrations: { applied: number; latest: string | null; latestAppliedAt: string | null; pending: string[] | null } | null };
  storage: Array<Probe & { id: string; label: string; holds: string }>;
  selfService: "open" | "paused" | null;
};

/** What the runbook (docs/DEPLOYMENT.md, Backups and restore) says protects what. The page adds nothing the runbook does not say. */
const PROTECTION: ReadonlyArray<{ what: string; by: string }> = [
  { what: "The database (items, movements, loans, accounts, activity)", by: "Time Travel, and an encrypted backup taken before each release by Production operations." },
  { what: "Loan photos", by: "Nothing: there is no copy, so a deleted photo cannot be brought back. They are short-lived evidence and are removed on schedule." },
  { what: "The application", by: "Git and a rollback to the previous Cloudflare version." }
];

const tag = (tone: "ok" | "warn" | "bad", text: string) => html`<span class="tag tag--${tone}">${text}</span>`;
const quick = (probe: Probe) => `${probe.ms} ms`;

/** Everything in the answer that is wrong, in the words an owner would use. Empty means all that was checked is working. */
function problems(status: Status): string[] {
  const out: string[] = [];
  if (!status.database.ok) out.push("The database is not answering.");
  else if (!status.database.migrations) out.push("The database answered, but its migration level could not be read.");
  else if (status.database.migrations.pending?.length) out.push(`${status.database.migrations.pending.length === 1 ? "A migration" : `${status.database.migrations.pending.length} migrations`} in this version ${status.database.migrations.pending.length === 1 ? "is" : "are"} not applied to the database: ${status.database.migrations.pending.join(", ")}.`);
  for (const bucket of status.storage) if (!bucket.ok) out.push(`${bucket.label} storage is not answering.`);
  if (status.database.ok && status.selfService === null) out.push("Whether Self-Service is open could not be read.");
  return out;
}

function row(name: string, state: Html, detail: Html | string): Html {
  return html`<li class="status-row"><span class="status-row__name">${name}</span><span class="status-row__state">${state}</span><span class="status-row__detail">${detail}</span></li>`;
}

function render(status: Status): Html {
  const issues = problems(status);
  const level = status.database.migrations;
  const { build } = status;
  return html`
    <div class="callout ${issues.length ? "" : "callout--review"}" id="system-summary" role="status">${issues.length ? html`<p><strong>${issues.length === 1 ? "One thing needs attention." : `${issues.length} things need attention.`}</strong></p><ul>${issues.map((issue) => html`<li>${issue}</li>`)}</ul>` : html`<p><strong>Everything checked is working.</strong> The application, the database and storage answered just now.</p>`}</div>
    <section class="admin-block" aria-labelledby="health-title">
      <div class="admin-block__head"><h2 id="health-title" class="section-title">Right now</h2><p class="admin-source">Checked ${formatDateTime(status.checkedAt)}. Each check waits at most two seconds.</p></div>
      <ul class="status-list">
        ${row("Application", tag("ok", "Running"), build ? html`Version <code>${build.version}</code>` : "This page was served by the application.")}
        ${row("Database", status.database.ok ? tag("ok", "Answering") : tag("bad", "Not answering"), status.database.ok ? quick(status.database) : "It did not answer within two seconds.")}
        ${status.storage.map((bucket) => row(bucket.label, bucket.ok ? tag("ok", "Answering") : tag("bad", "Not answering"), bucket.ok ? html`${bucket.holds} <span class="muted">${quick(bucket)}</span>` : "It did not answer within two seconds."))}
        ${row("Self-Service", status.selfService === "open" ? tag("ok", "Open") : status.selfService === "paused" ? tag("warn", "Closed for maintenance") : tag("warn", "Unknown"), html`<a class="text-link" href="/staff/admin/self-service" data-route>${status.selfService === null ? "Open the Self-Service settings" : "Change it in Self-Service"}</a>`)}
      </ul>
      <div class="form-actions form-actions--start"><button type="button" class="button button--secondary" id="check-again">Check again</button></div>
    </section>
    <section class="admin-block" aria-labelledby="version-title">
      <h2 id="version-title" class="section-title">This version</h2>
      ${build ? html`<dl class="facts">
        <div><dt>Build</dt><dd><code>${build.version}</code></dd></div>
        <div><dt>Commit</dt><dd>${build.commit ? html`<code>${build.commit.slice(0, 7)}</code><span class="visually-hidden"> (full commit ${build.commit})</span>` : html`<span class="muted">Not recorded.</span> This build was made without a commit.`}</dd></div>
        <div><dt>Built</dt><dd>${formatDateTime(build.builtAt)}</dd></div>
        <div><dt>Migrations</dt><dd>${level ? html`<code>${level.latest ?? "none"}</code> is the latest applied${level.latestAppliedAt ? html`, on ${formatDateTime(level.latestAppliedAt)}` : ""}. ${level.pending === null ? "" : level.pending.length ? html`<strong>${level.pending.length} of this version's migrations ${level.pending.length === 1 ? "is" : "are"} not applied yet.</strong>` : "Every migration in this version is applied."}` : html`<span class="muted">Could not be read from the database.</span>`}</dd></div>
      </dl>` : html`<p>This build did not leave a record of what it is, so no version is shown. A normal production build always does.</p>
      ${level ? html`<p>Migrations: <code>${level.latest ?? "none"}</code> is the latest applied.</p>` : ""}`}
    </section>
    <section class="admin-block" aria-labelledby="backup-title">
      <h2 id="backup-title" class="section-title">Backups and restore</h2>
      <div class="data-table-wrap"><table class="data-table data-table--static">
        <caption class="visually-hidden">What protects what</caption>
        <thead><tr><th scope="col">Data</th><th scope="col">Protected by</th></tr></thead>
        <tbody>${PROTECTION.map((entry) => html`<tr><th scope="row">${entry.what}</th><td>${entry.by}</td></tr>`)}</tbody>
      </table></div>
      <div class="callout callout--review evidence-note" role="note">
        <p><strong>No backup or restore evidence is shown here.</strong> A release's backup and rollback point are kept with its Production operations run in GitHub, and the key that opens the backup is held offline by the owner. This application holds no Cloudflare or GitHub credentials, so it cannot read them and does not guess. The steps are in the Deployment runbook, “Backups and restore”.</p>
      </div>
    </section>`;
}

/** Administration > System: whether the application, the database, storage and Self-Service are working, and exactly what version is live. */
export async function systemStatus(): Promise<void> {
  const session = await adminPage("system", {
    title: "System",
    lede: "Whether everything is working, and which version is running. Nothing is shown that was not checked just now.",
    body: () => html`<div id="system" aria-busy="true"><div class="skeleton skeleton--block" aria-hidden="true"></div><p class="visually-hidden" role="status">Checking…</p></div>`
  });
  if (!session) return;
  const target = document.querySelector<HTMLElement>("#system")!;
  async function check(): Promise<void> {
    target.setAttribute("aria-busy", "true");
    try {
      mount(target, render(await api<Status>("/api/staff/admin/system")));
      document.querySelector("#check-again")!.addEventListener("click", () => { void check(); });
    } catch (error) {
      // Navigation and every other page stay available; only this report is missing.
      mount(target, emptyState("System status could not be loaded", failure(error), html`<button type="button" class="button button--secondary" id="check-again">Try again</button>`, "error", 3));
      document.querySelector("#check-again")!.addEventListener("click", () => { void check(); });
    }
    target.setAttribute("aria-busy", "false");
  }
  await check();
}
