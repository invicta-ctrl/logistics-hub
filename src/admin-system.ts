import "./admin.css";
import { type Setting, adminPage, changeButton, confirmImpact, decisions, settingRows, settingsGroup, settle, stateTag, verdict } from "./admin-frame";
import { type Html, api, emptyState, failure, formatDateTime, html, mount, onLeave } from "./ui";

/** The answer of GET /api/staff/admin/system (src/system-status.ts). */
type Probe = { ok: boolean; ms: number };
type Status = {
  checkedAt: string;
  build: { version: string; commit: string | null; builtAt: string; migrations: string[]; product?: { version: string; sourceCommit: string; changes: string[] } | null } | null;
  database: Probe & { migrations: { applied: number; latest: string | null; latestAppliedAt: string | null; pending: string[] | null } | null };
  storage: Array<Probe & { id: string; label: string; holds: string }>;
  selfService: "open" | "paused" | null;
  /** Photo suggestions and review-only text proposals in Catalogue (ambient-assist.ts): the owner's switch and today's Workers AI use against the daily stop. */
  assist: { on: boolean; available: boolean; neuronsToday: number; band: "NORMAL" | "CONSERVE" | "RESERVE" | "CRITICAL" | "STOPPED"; stopAt: number };
  /** Picture cleanup on item photos (item-cutout.ts): the owner's switch (off until turned on) and this month's photos sent against the cap. */
  cleanup: { on: boolean; available: boolean; sentThisMonth: number; monthlyCap: number };
};

/** What the runbook (docs/DEPLOYMENT.md, Backups and restore) says protects what. The page adds nothing the runbook does not say. */
const PROTECTION: ReadonlyArray<{ what: string; by: string }> = [
  { what: "The database (items, movements, loans, accounts, activity)", by: "Time Travel, and an encrypted backup taken before each release by Production operations." },
  { what: "Loan photos", by: "Nothing: there is no copy, so a deleted photo cannot be brought back. They are short-lived evidence and are removed on schedule." },
  { what: "The application", by: "Git and a rollback to the previous Cloudflare version." }
];

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

const BAND_WORDS: Record<Status["assist"]["band"], string> = {
  NORMAL: "", CONSERVE: "Using less: checks after sync still run.", RESERVE: "Using the reserve.", CRITICAL: "Only while someone is cataloguing; checks after sync wait for tomorrow.", STOPPED: "Stopped for today. Cataloguing works with built-in suggestions; AI suggestions are unavailable."
};
function assistRow(assist: Status["assist"], owner: boolean): Setting {
  const value = !assist.available ? stateTag("warn", "Not available here") : !assist.on ? stateTag("warn", "Off") : assist.band === "STOPPED" ? stateTag("warn", "Paused for today") : stateTag("ok", "On", true);
  const used = html`${assist.neuronsToday.toLocaleString("en-PH")} of ${assist.stopAt.toLocaleString("en-PH")} Workers AI Neurons used today (UTC). ${BAND_WORDS[assist.band]}`;
  const detail = assist.available ? used : html`This copy of the application has no Workers AI. Cataloguing works with built-in suggestions; AI suggestions are unavailable.`;
  return { key: "assist", name: "AI suggestions", value, does: html`${detail} Photo reading and review-only text suggestions share this switch and allowance.`, action: owner ? changeButton("AI suggestions", html`id="assist-toggle" data-on="${String(!assist.on)}"`) : undefined };
}

function cleanupRow(cleanup: Status["cleanup"], owner: boolean): Setting {
  const value = !cleanup.available ? stateTag("warn", "Not available here") : !cleanup.on ? stateTag("warn", "Off") : cleanup.sentThisMonth >= cleanup.monthlyCap ? stateTag("warn", "Paused for this month") : stateTag("ok", "On", true);
  const does = cleanup.available
    ? html`${cleanup.sentThisMonth.toLocaleString("en-PH")} of ${cleanup.monthlyCap.toLocaleString("en-PH")} photos cleaned this month (UTC). Staff choose "Remove background" on an item's photo; the original is always kept.`
    : html`This copy of the application has no Cloudflare Images. Photos are used as they are.`;
  return { key: "cleanup", name: "Picture cleanup", value, does, action: owner && cleanup.available ? changeButton("Picture cleanup", html`id="cleanup-toggle" data-on="${String(!cleanup.on)}"`) : undefined };
}

function render(status: Status, owner: boolean): Html {
  const issues = problems(status);
  const level = status.database.migrations;
  const { build } = status;
  const answering = (ok: boolean) => ok ? stateTag("ok", "Answering", true) : stateTag("bad", "Not answering");
  // What is waiting for someone: a check that failed (look, then check again) and Self-Service closed (reopened in its section).
  const waiting = [
    ...issues.map((issue) => ({ what: issue, detail: "Checked just now. Check again once it has been looked at.", action: html`<button type="button" class="button button--secondary button--sm" data-check-again aria-label="Check again: ${issue}">Check again</button>` })),
    ...(status.selfService === "paused" ? [{ what: "Self-Service is closed for maintenance.", detail: "Phones show the maintenance screen and record nothing.", action: html`<a class="button button--secondary button--sm" href="/staff/admin/self-service" data-route>Reopen in Self-Service</a>` }] : [])
  ];
  const failed = !status.database.ok || status.storage.some((bucket) => !bucket.ok);
  return html`
    ${issues.length
      ? verdict(failed ? "bad" : "warn", issues.length === 1 ? "One thing needs attention." : `${issues.length} things need attention.`, issues.join(" "), "system-summary")
      // Working, but something is waiting for someone: gold, and the decision below says what.
      : verdict(waiting.length ? "warn" : "ok", "Everything checked is working.", waiting.length ? "Self-Service is closed for maintenance; reopen it below when you are ready." : "The application, the database and storage answered just now.", "system-summary")}
    ${decisions(waiting)}
    ${settingsGroup("health-title", "Right now", html`${settingRows([
      { name: "Application", value: stateTag("ok", "Running", true), does: build ? html`Build <code>${build.version}</code>` : "This page was served by the application." },
      { name: "Database", value: answering(status.database.ok), does: status.database.ok ? quick(status.database) : "It did not answer within two seconds." },
      ...status.storage.map((bucket) => ({ name: bucket.label, value: answering(bucket.ok), does: bucket.ok ? html`${bucket.holds} <span class="muted">${quick(bucket)}</span>` : "It did not answer within two seconds." })),
      { key: "self-service", name: "Self-Service", value: status.selfService === "open" ? stateTag("ok", "Open", true) : status.selfService === "paused" ? stateTag("warn", "Closed for maintenance") : stateTag("warn", "Unknown"),
        does: "Whether people can use their own phones. It is changed in the Self-Service section.",
        action: html`<a class="button button--secondary button--sm" href="/staff/admin/self-service" data-route>${status.selfService === null ? "Open" : "Change"}<span class="visually-hidden"> in Self-Service</span></a>` }
    ])}
      <div class="form-actions form-actions--start admin-actions"><button type="button" class="button button--secondary" id="check-again">Check again</button></div>`,
      html`Checked ${formatDateTime(status.checkedAt)}. Each check waits at most two seconds.`)}
    ${settingsGroup("assist-title", "AI suggestions", settingRows([assistRow(status.assist, owner)]))}
    ${settingsGroup("cleanup-title", "Picture cleanup", settingRows([cleanupRow(status.cleanup, owner)]))}
    ${settingsGroup("version-title", "This version", html`
      <p class="product-version"><span>Product version</span><strong>${build?.product?.version ?? "Unknown"}</strong></p>
      <h3 class="section-title">What's new</h3>
      ${build?.product ? html`<ul class="release-notes">${build.product.changes.map((note) => html`<li>${note}</li>`)}</ul>` : html`<p class="muted">Not recorded.</p>`}
      ${build ? html`<dl class="version-facts">
        <div><dt>Build</dt><dd><code>${build.version}</code></dd></div>
        <div><dt>Commit</dt><dd>${build.commit ? html`<code>${build.commit.slice(0, 7)}</code><span class="visually-hidden"> (full commit ${build.commit})</span>` : html`<span class="muted">Not recorded.</span> This build was made without a commit.`}</dd></div>
        <div><dt>Built</dt><dd>${formatDateTime(build.builtAt)}</dd></div>
        <div><dt>Migrations</dt><dd>${level ? html`<code>${level.latest ?? "none"}</code> is the latest applied${level.latestAppliedAt ? html`, on ${formatDateTime(level.latestAppliedAt)}` : ""}. ${level.pending === null ? "" : level.pending.length ? html`<strong>${level.pending.length} of this version's migrations ${level.pending.length === 1 ? "is" : "are"} not applied yet.</strong>` : "Every migration in this version is applied."}` : html`<span class="muted">Could not be read from the database.</span>`}</dd></div>
      </dl>` : html`<p class="muted">Build details not recorded.</p>
      ${level ? html`<p>Migrations: <code>${level.latest ?? "none"}</code> is the latest applied.</p>` : ""}`}`)}
    ${settingsGroup("backup-title", "Backups and restore", html`
      <dl class="guide">${PROTECTION.map((entry) => html`<div><dt>${entry.what}</dt><dd>${entry.by}</dd></div>`)}</dl>
      <div class="note evidence-note" role="note">
        <p><strong>No backup or restore evidence is shown here.</strong> A release's backup and rollback point are kept with its Production operations run in GitHub, and the key that opens the backup is held offline by the owner. This application holds no Cloudflare or GitHub credentials, so it cannot read them and does not guess. The steps are in the Deployment runbook, “Backups and restore”.</p>
      </div>`)}`;
}

/** What turning a switch on or off does, and for whom, before the owner confirms it. */
const SWITCHES = {
  assist: {
    title: "AI suggestions", path: "/api/staff/admin/assist",
    affects: ["Everyone cataloguing: photo reading and review-only text suggestions", "Checks after sync, which share the same allowance"],
    off: "Cataloguing keeps working with the built-in suggestions; nothing already saved changes.",
    on: "Cataloguing suggests from photos and text again, within today's allowance."
  },
  cleanup: {
    title: "picture cleanup", path: "/api/staff/admin/cleanup",
    affects: ["Staff choosing “Remove background” on an item's photo"],
    off: "Photos are used as they are; pictures already cleaned and every original stay.",
    on: "Staff can clean a photo's background again, within this month's cap."
  }
} as const;

/** Administration > System: whether the application, the database, storage and Self-Service are working, and exactly what version is live. */
export async function systemStatus(): Promise<void> {
  const session = await adminPage("system", {
    title: "System",
    lede: "Whether everything is working, and which version is running. Nothing is shown that was not checked just now.",
    body: () => html`<div id="system" aria-busy="true"><div class="skeleton skeleton--block" aria-hidden="true"></div><p class="visually-hidden" role="status">Checking…</p></div>`
  });
  if (!session) return;
  const target = document.querySelector<HTMLElement>("#system")!;
  let active = true;
  let request = 0;
  onLeave(() => { active = false; });
  async function check(): Promise<void> {
    if (!active) return;
    const current = ++request;
    target.setAttribute("aria-busy", "true");
    try {
      const status = await api<Status>("/api/staff/admin/system");
      if (!active || current !== request) return;
      mount(target, render(status, session!.role === "OWNER"));
      document.querySelector("#check-again")!.addEventListener("click", () => { void check(); });
      target.querySelectorAll("[data-check-again]").forEach((button) => button.addEventListener("click", () => { void check(); }));
      for (const key of ["assist", "cleanup"] as const) {
        document.querySelector<HTMLButtonElement>(`#${key}-toggle`)?.addEventListener("click", async (event) => {
          const turnOn = (event.currentTarget as HTMLButtonElement).dataset.on === "true";
          const what = SWITCHES[key];
          const changed = await confirmImpact({
            kicker: "System", title: `Turn ${turnOn ? "on" : "off"} ${what.title}?`,
            now: turnOn ? "Off" : "On", after: turnOn ? "On" : "Off",
            impact: html`<p>${turnOn ? what.on : what.off}</p>`,
            affects: [...what.affects],
            undo: `You can turn it ${turnOn ? "off" : "back on"} here at any time.`,
            confirm: `Turn ${turnOn ? "on" : "off"}`,
            run: () => api(what.path, { method: "PATCH", body: JSON.stringify({ on: turnOn }) }).then(() => undefined)
          });
          if (!changed || !active) return;
          await check();
          settle(key);
        });
      }
    } catch (error) {
      if (!active || current !== request) return;
      // Navigation and every other page stay available; only this report is missing.
      mount(target, emptyState("System status could not be loaded", failure(error), html`<button type="button" class="button button--secondary" id="check-again">Try again</button>`, "error", 3));
      document.querySelector("#check-again")!.addEventListener("click", () => { void check(); });
    }
    if (active && current === request) target.setAttribute("aria-busy", "false");
  }
  await check();
}
