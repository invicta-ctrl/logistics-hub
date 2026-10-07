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
  /** Photo suggestions in Catalogue (ambient-assist.ts): the owner's switch and today's Workers AI use against the daily stop. */
  assist: { on: boolean; available: boolean; neuronsToday: number; band: "NORMAL" | "CONSERVE" | "RESERVE" | "CRITICAL" | "STOPPED"; stopAt: number };
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

const BAND_WORDS: Record<Status["assist"]["band"], string> = {
  NORMAL: "", CONSERVE: "Using less: checks after sync still run.", RESERVE: "Using the reserve.", CRITICAL: "Only while someone is cataloguing; checks after sync wait for tomorrow.", STOPPED: "Stopped for today. Cataloguing works as usual without suggestions."
};
function assistRow(assist: Status["assist"], owner: boolean): Html {
  const state = !assist.available ? tag("warn", "Not available here") : !assist.on ? tag("warn", "Off") : assist.band === "STOPPED" ? tag("warn", "Paused for today") : tag("ok", "On");
  const used = html`${assist.neuronsToday.toLocaleString("en-PH")} of ${assist.stopAt.toLocaleString("en-PH")} Workers AI Neurons used today (UTC). ${BAND_WORDS[assist.band]}`;
  const detail = assist.available ? used : html`This copy of the application has no Workers AI. Cataloguing works as usual without suggestions.`;
  return row("Photo suggestions", state, html`${detail}${owner ? html` <button type="button" class="text-link" id="assist-toggle" data-on="${String(!assist.on)}">${assist.on ? "Turn off" : "Turn on"}</button>` : ""}`);
}

function render(status: Status, owner: boolean): Html {
  const issues = problems(status);
  const level = status.database.migrations;
  const { build } = status;
  return html`
    <div class="banner ${issues.length ? "banner--warn" : "banner--ok"}" id="system-summary" role="status">${issues.length ? html`<div><p><strong>${issues.length === 1 ? "One thing needs attention." : `${issues.length} things need attention.`}</strong></p><ul>${issues.map((issue) => html`<li>${issue}</li>`)}</ul></div>` : html`<p><strong>Everything checked is working.</strong> The application, the database and storage answered just now.</p>`}</div>
    <section class="admin-block" aria-labelledby="health-title">
      <div class="admin-block__head"><h2 id="health-title" class="section-title">Right now</h2><p class="admin-source">Checked ${formatDateTime(status.checkedAt)}. Each check waits at most two seconds.</p></div>
      <ul class="status-list">
        ${row("Application", tag("ok", "Running"), build ? html`Version <code>${build.version}</code>` : "This page was served by the application.")}
        ${row("Database", status.database.ok ? tag("ok", "Answering") : tag("bad", "Not answering"), status.database.ok ? quick(status.database) : "It did not answer within two seconds.")}
        ${status.storage.map((bucket) => row(bucket.label, bucket.ok ? tag("ok", "Answering") : tag("bad", "Not answering"), bucket.ok ? html`${bucket.holds} <span class="muted">${quick(bucket)}</span>` : "It did not answer within two seconds."))}
        ${row("Self-Service", status.selfService === "open" ? tag("ok", "Open") : status.selfService === "paused" ? tag("warn", "Closed for maintenance") : tag("warn", "Unknown"), html`<a class="text-link" href="/staff/admin/self-service" data-route>${status.selfService === null ? "Open the Self-Service settings" : "Change it in Self-Service"}</a>`)}
        ${assistRow(status.assist, owner)}
      </ul>
      <div class="form-actions form-actions--start admin-actions"><button type="button" class="button button--secondary" id="check-again">Check again</button></div>
    </section>
    <section class="admin-block" aria-labelledby="version-title">
      <h2 id="version-title" class="section-title">This version</h2>
      ${build ? html`<dl class="version-facts">
        <div><dt>Build</dt><dd><code>${build.version}</code></dd></div>
        <div><dt>Commit</dt><dd>${build.commit ? html`<code>${build.commit.slice(0, 7)}</code><span class="visually-hidden"> (full commit ${build.commit})</span>` : html`<span class="muted">Not recorded.</span> This build was made without a commit.`}</dd></div>
        <div><dt>Built</dt><dd>${formatDateTime(build.builtAt)}</dd></div>
        <div><dt>Migrations</dt><dd>${level ? html`<code>${level.latest ?? "none"}</code> is the latest applied${level.latestAppliedAt ? html`, on ${formatDateTime(level.latestAppliedAt)}` : ""}. ${level.pending === null ? "" : level.pending.length ? html`<strong>${level.pending.length} of this version's migrations ${level.pending.length === 1 ? "is" : "are"} not applied yet.</strong>` : "Every migration in this version is applied."}` : html`<span class="muted">Could not be read from the database.</span>`}</dd></div>
      </dl>` : html`<p>This build did not leave a record of what it is, so no version is shown. A normal production build always does.</p>
      ${level ? html`<p>Migrations: <code>${level.latest ?? "none"}</code> is the latest applied.</p>` : ""}`}
    </section>
    <section class="admin-block" aria-labelledby="backup-title">
      <h2 id="backup-title" class="section-title">Backups and restore</h2>
      <dl class="guide">${PROTECTION.map((entry) => html`<div><dt>${entry.what}</dt><dd>${entry.by}</dd></div>`)}</dl>
      <div class="note evidence-note" role="note">
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
      mount(target, render(await api<Status>("/api/staff/admin/system"), session!.role === "OWNER"));
      document.querySelector("#check-again")!.addEventListener("click", () => { void check(); });
      document.querySelector<HTMLButtonElement>("#assist-toggle")?.addEventListener("click", (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        api("/api/staff/admin/assist", { method: "PATCH", body: JSON.stringify({ on: button.dataset.on === "true" }) })
          .then(() => check(), (error) => { button.disabled = false; mount(target.querySelector("#system-summary")!, html`<p>${failure(error)}</p>`); });
      });
    } catch (error) {
      // Navigation and every other page stay available; only this report is missing.
      mount(target, emptyState("System status could not be loaded", failure(error), html`<button type="button" class="button button--secondary" id="check-again">Try again</button>`, "error", 3));
      document.querySelector("#check-again")!.addEventListener("click", () => { void check(); });
    }
    target.setAttribute("aria-busy", "false");
  }
  await check();
}
