import { DEPARTMENTS, type DepartmentCode } from "./directory-policy";
import { type AccountEvent, assignable, bindCopy, canManage, eventText, oneTime, roleTag } from "./account-ui";
import { type Role, ROLE_LABELS, type Session, adminTabs, loadSession, shell } from "./staff";
import { type Html, api, emptyState, failure, formatDateTime, html, icon, mount, navigate, plural, setMessage, sheet as createSheet, sheetContent, toast } from "./ui";

type Row = { id: string; username: string; displayName: string; role: Role; active: boolean; mustChangePassword: boolean; createdAt: string; lastLoginAt: string | null; openSessions: number };

/* ---------- Administration ---------- */

export async function administration(): Promise<void> {
  const session = await loadSession("admin");
  if (!session) return;
  if (session.role === "STAFF") { navigate("/staff/items", true); return; }
  document.title = "Administration · Staff workspace";
  shell(session, "admin", html`
    <header class="page-header">
      <div><h1>Administration</h1><p>${session.role === "OWNER" ? "Owners manage every account, role and recovery setting." : "Administrators manage staff accounts. Owner and administrator accounts are managed by an owner."}</p></div>
      <div class="page-header__actions"><button class="button button--primary" type="button" id="new-account">${icon("plus")}New account</button></div>
    </header>
    ${adminTabs("accounts")}
    <section aria-labelledby="accounts-title">
      <h2 id="accounts-title" class="visually-hidden">Accounts</h2>
      <div id="accounts"><div class="data-table-wrap" aria-hidden="true">${Array.from({ length: 4 }, () => html`<div class="skeleton-row"><span class="skeleton skeleton--text"></span></div>`)}</div></div>
    </section>
    <section class="admin-block" aria-labelledby="ss-switch-title">
      <h2 id="ss-switch-title" class="section-title">Self-Service on phones</h2>
      <p><span class="tag ${session.selfServiceClosed ? "tag--warn" : "tag--ok"}">${session.selfServiceClosed ? "Closed for maintenance" : "Open"}</span></p>
      <p>${session.selfServiceClosed ? "Phones show the maintenance screen and record nothing, and people are sent to DOL staff in person. Records already waiting on a phone are kept and sent once it reopens." : "People can take, borrow, use and return with their own phones."}</p>
      <div class="form-alert" id="ss-alert" role="alert" hidden></div>
      <button type="button" class="button ${session.selfServiceClosed ? "button--primary" : "button--secondary"}" id="ss-toggle">${session.selfServiceClosed ? "Reopen Self-Service" : "Close for maintenance"}</button>
    </section>
    ${session.role === "OWNER" ? html`<section class="admin-block" aria-labelledby="ret-title">
      <h2 id="ret-title" class="section-title">Old personal details</h2>
      <p>Who borrowed or took something is kept for accountability: two years after a loan closes and one year after a phone record is settled. After that you can remove the borrower's name, student ID and photo. The record itself (the item, quantity, dates and stock) stays, and free text people typed is not touched. This cannot be undone, so take a backup first (Deployment runbook, Backups and restore).</p>
      <p id="ret-status" role="status">Checking…</p>
      <div class="form-alert" id="ret-alert" role="alert" hidden></div>
      <button type="button" class="button button--danger" id="ret-run" disabled>Remove old personal details</button>
    </section>` : ""}
    ${session.selfServiceClosed ? html`<section class="ss-trial" aria-labelledby="ss-trial-title">
      <h2 id="ss-trial-title" class="section-title">Test Self-Service</h2>
      <p>Self-Service is closed for maintenance, and everyone else sees the maintenance page. Here it works as it would on a phone, but every record you make is held in <a href="/staff/self-service" data-route>Self-Service</a> as a test and changes nothing unless someone applies it. Dismiss your tests there when you are done.</p>
      <iframe class="ss-trial__frame" src="/self-service" title="Self-Service in test mode" loading="lazy"></iframe>
    </section>` : ""}
    <section class="activity" aria-labelledby="activity-title">
      <h2 id="activity-title" class="section-title">Security activity</h2>
      <ol class="history" id="activity"></ol>
    </section>
    <dialog class="sheet" id="sheet" aria-labelledby="sheet-title"></dialog>`);

  const sheet = document.querySelector<HTMLDialogElement>("#sheet")!;
  let rows: Row[] = [];
  bindCopy(sheet);
  const panel = createSheet(sheet);
  const close = () => panel.close(true);

  async function load(): Promise<void> {
    try {
      const [{ accounts }, { events }] = await Promise.all([api<{ accounts: Row[] }>("/api/staff/admin/accounts"), api<{ events: AccountEvent[] }>("/api/staff/admin/activity")]);
      rows = accounts;
      mount(document.querySelector("#accounts")!, html`<div class="data-table-wrap"><table class="data-table data-table--static">
        <caption class="visually-hidden">Accounts that can sign in to the staff workspace</caption>
        <thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col" class="col-qty">Sessions</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${accounts.map((row) => html`<tr>
          <td><span class="cell-strong">${row.displayName}${row.id === session!.id ? html` <span class="muted">(you)</span>` : ""}</span><span class="cell-sub mono">${row.username}</span></td>
          <td>${roleTag(row.role)}</td>
          <td><span class="tags">${row.active ? html`<span class="tag tag--ok">Active</span>` : html`<span class="tag tag--bad">Disabled</span>`}${row.mustChangePassword ? html`<span class="tag tag--warn">Must set password</span>` : ""}</span></td>
          <td>${row.lastLoginAt ? formatDateTime(row.lastLoginAt) : html`<span class="muted">Never</span>`}</td>
          <td class="col-qty">${row.openSessions}</td>
          <td class="col-actions">${canManage(session!, row) && row.id !== session!.id ? html`<button type="button" class="button button--secondary button--sm" data-manage="${row.id}">Manage</button>` : row.id === session!.id ? html`<a class="text-link" href="/staff/account" data-route>My account</a>` : html`<span class="muted">Owner only</span>`}</td>
        </tr>`)}</tbody></table></div>`);
      mount(document.querySelector("#activity")!, events.length
        ? html`${events.map((event) => html`<li class="history__item"><div><p class="history__title">${eventText(event)}</p><p class="history__meta"><time datetime="${event.at}">${formatDateTime(event.at)}</time></p></div></li>`)}`
        : html`<li class="history__empty">No account changes yet.</li>`);
    } catch (error) {
      mount(document.querySelector("#accounts")!, emptyState("Accounts could not be loaded", failure(error), "", "error", 3));
    }
  }

  function sheetShell(kicker: string, title: string, body: Html): void {
    mount(sheet, sheetContent(kicker, title, body));
    panel.open();
  }

  const passwordFields = (prefix: string) => html`<fieldset class="segmented segmented--2"><legend class="visually-hidden">Password</legend>
      <label><input type="radio" name="${prefix}-mode" value="generate" checked /><span>Generate one</span></label>
      <label><input type="radio" name="${prefix}-mode" value="custom" /><span>Type one</span></label></fieldset>
    <div class="field" data-custom hidden><label for="${prefix}-password">Temporary password</label><input id="${prefix}-password" name="password" type="password" autocomplete="new-password" minlength="12" /><p class="field__hint">At least 12 characters. They must change it at first sign-in.</p></div>`;
  const bindPasswordFields = (form: HTMLFormElement, prefix: string) => form.addEventListener("change", () => {
    form.querySelector<HTMLElement>("[data-custom]")!.hidden = new FormData(form).get(`${prefix}-mode`) !== "custom";
  });
  const passwordPayload = (form: HTMLFormElement, prefix: string) => new FormData(form).get(`${prefix}-mode`) === "custom" ? { password: String(new FormData(form).get("password")) } : { generate: true };

  function openCreate(): void {
    sheetShell("New account", "Create an account", html`<form class="form" id="create-form" novalidate>
      <div class="field-grid"><div class="field"><label for="c-name">Display name</label><input id="c-name" name="displayName" required maxlength="80" autocomplete="off" /></div>
      <div class="field"><label for="c-username">Username</label><input id="c-username" name="username" required maxlength="64" autocapitalize="none" spellcheck="false" autocomplete="off" /></div></div>
      <div class="field"><label for="c-role">Role</label><select id="c-role" name="role">${assignable(session!).map((role) => html`<option value="${role}">${ROLE_LABELS[role]}</option>`)}</select>
        <p class="field__hint">Staff: items, stock, loans, Self-Service and activity. Administrator: also manages staff accounts. Owner: everything, including recovery.</p></div>
      ${passwordFields("c")}
      <div class="form-alert" id="create-alert" role="alert" hidden></div>
      <div class="form-actions"><button class="button button--primary" type="submit">Create account</button></div>
    </form><div id="create-result"></div>`);
    const form = sheet.querySelector<HTMLFormElement>("#create-form")!;
    bindPasswordFields(form, "c");
    form.querySelector<HTMLInputElement>("#c-name")!.focus();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      try {
        const result = await api<{ username: string; generatedPassword: string | null }>("/api/staff/admin/accounts", { method: "POST", body: JSON.stringify({ displayName: values.get("displayName"), username: values.get("username"), role: values.get("role"), ...passwordPayload(form, "c") }) });
        form.hidden = true;
        mount(sheet.querySelector("#create-result")!, html`${result.generatedPassword ? oneTime(`Temporary password for ${result.username}`, result.generatedPassword, "Shown once and never stored. Give it to them privately; they must choose their own password at first sign-in.") : html`<p class="callout">${icon("check")}<span>Account created. They must replace the temporary password at first sign-in.</span></p>`}
          <div class="form-actions"><button type="button" class="button button--secondary" data-close>Done</button></div>`);
        toast(`Account ${result.username} created.`);
        await load();
      } catch (error) { setMessage(sheet.querySelector("#create-alert")!, failure(error)); }
    });
  }

  function openManage(row: Row): void {
    sheetShell(`${ROLE_LABELS[row.role]} · ${row.username}`, row.displayName, html`
      <form class="form form-section" id="profile-form" novalidate>
        <h3 class="form-section__title">Profile and role</h3>
        <div class="field-grid"><div class="field"><label for="m-name">Display name</label><input id="m-name" name="displayName" value="${row.displayName}" maxlength="80" /></div>
        <div class="field"><label for="m-username">Username</label><input id="m-username" name="username" value="${row.username}" maxlength="64" autocapitalize="none" spellcheck="false" /></div></div>
        <div class="field"><label for="m-role">Role</label><select id="m-role" name="role">${assignable(session!).map((role) => html`<option value="${role}" ${role === row.role ? html`selected` : ""}>${ROLE_LABELS[role]}</option>`)}</select></div>
        <p class="field__hint">Changing the username or role signs them out everywhere.</p>
        <div class="form-alert" id="profile-alert" role="alert" hidden></div>
        <div class="form-actions"><button class="button button--primary" type="submit">Save</button></div>
      </form>
      <form class="form form-section" id="password-form" novalidate>
        <h3 class="form-section__title">Reset password</h3>
        <p class="field__hint">The current password stops working immediately and they are signed out. They choose their own at next sign-in.</p>
        ${passwordFields("p")}
        <div class="form-alert" id="password-alert" role="alert" hidden></div>
        <div class="form-actions"><button class="button button--secondary" type="submit">Reset password</button></div>
        <div id="password-result"></div>
      </form>
      <div class="form-section">
        <h3 class="form-section__title">Access</h3>
        <p class="field__hint">${row.openSessions ? `${plural(row.openSessions, "open session")}.` : "No open sessions."} Last sign-in: ${row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "never"}.</p>
        <div class="form-alert" id="access-alert" role="alert" hidden></div>
        <div class="form-actions form-actions--start">
          <button class="button button--secondary" type="button" id="revoke">Sign out everywhere</button>
          <button class="button ${row.active ? "button--danger" : "button--primary"}" type="button" id="toggle-active">${row.active ? "Disable account" : "Enable account"}</button>
        </div>
      </div>`);
    const profile = sheet.querySelector<HTMLFormElement>("#profile-form")!;
    profile.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(profile);
      try {
        const result = await api<{ changed: number; sessionsRevoked?: boolean }>(`/api/staff/admin/accounts/${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify({ displayName: values.get("displayName"), username: values.get("username"), role: values.get("role") }) });
        toast(result.changed ? `Saved${result.sessionsRevoked ? "; they were signed out" : ""}.` : "No changes to save.");
        close();
        await load();
      } catch (error) { setMessage(sheet.querySelector("#profile-alert")!, failure(error)); }
    });
    const reset = sheet.querySelector<HTMLFormElement>("#password-form")!;
    bindPasswordFields(reset, "p");
    reset.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await api<{ generatedPassword: string | null }>(`/api/staff/admin/accounts/${encodeURIComponent(row.id)}/password`, { method: "POST", body: JSON.stringify(passwordPayload(reset, "p")) });
        mount(sheet.querySelector("#password-result")!, result.generatedPassword
          ? oneTime(`New temporary password for ${row.username}`, result.generatedPassword, "Shown once and never stored. They must choose their own password at next sign-in.")
          : html`<p class="callout">${icon("check")}<span>Password reset. They must choose their own at next sign-in.</span></p>`);
        toast(`Password reset for ${row.username}.`);
        void load();
      } catch (error) { setMessage(sheet.querySelector("#password-alert")!, failure(error)); }
    });
    sheet.querySelector("#revoke")!.addEventListener("click", async () => {
      try { await api(`/api/staff/admin/accounts/${encodeURIComponent(row.id)}/sessions/revoke`, { method: "POST" }); toast(`${row.username} was signed out everywhere.`); close(); await load(); }
      catch (error) { setMessage(sheet.querySelector("#access-alert")!, failure(error)); }
    });
    sheet.querySelector("#toggle-active")!.addEventListener("click", async () => {
      if (row.active && !window.confirm(`Disable ${row.username}? They are signed out and cannot sign in until re-enabled.`)) return;
      try { await api(`/api/staff/admin/accounts/${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify({ active: !row.active }) }); toast(`${row.username} ${row.active ? "disabled" : "enabled"}.`); close(); await load(); }
      catch (error) { setMessage(sheet.querySelector("#access-alert")!, failure(error)); }
    });
  }

  const retention = document.querySelector<HTMLElement>("#ret-status");
  const retentionAlert = document.querySelector<HTMLElement>("#ret-alert");
  async function checkRetention(): Promise<void> {
    if (!retention) return;
    try {
      const due = await api<{ loans: number; phoneRecords: number; photos: number }>("/api/staff/admin/retention");
      const none = !due.loans && !due.phoneRecords;
      retention.textContent = none ? "Nothing is old enough to remove yet." : `Ready to remove: ${plural(due.loans, "loan")}, ${plural(due.phoneRecords, "phone record")} and ${plural(due.photos, "photo")}.`;
      document.querySelector<HTMLButtonElement>("#ret-run")!.disabled = none;
    } catch (error) { retention.textContent = ""; setMessage(retentionAlert!, failure(error)); }
  }
  document.querySelector("#ret-run")?.addEventListener("click", async () => {
    if (!window.confirm("Remove the names, student IDs and photos listed above? This cannot be undone.")) return;
    const total = { loans: 0, phoneRecords: 0 };
    try {
      // One request erases a bounded number of rows; ask again while more are due.
      for (let more = true; more;) {
        const batch = await api<{ loans: number; phoneRecords: number; more: boolean }>("/api/staff/admin/retention", { method: "POST" });
        total.loans += batch.loans;
        total.phoneRecords += batch.phoneRecords;
        more = batch.more && batch.loans + batch.phoneRecords > 0;
      }
      setMessage(retentionAlert!, "");
      toast(`Removed details from ${plural(total.loans, "loan")} and ${plural(total.phoneRecords, "phone record")}.`);
    } catch (error) { setMessage(retentionAlert!, failure(error)); }
    await Promise.all([checkRetention(), load()]);
  });
  document.querySelector("#ss-toggle")!.addEventListener("click", async () => {
    const closing = !session.selfServiceClosed;
    if (!window.confirm(closing ? "Close Self-Service for maintenance? Phones will show the maintenance screen and record nothing until you reopen it." : "Reopen Self-Service? Phones can take, borrow, use and return again.")) return;
    try {
      await api("/api/staff/admin/self-service", { method: "PATCH", body: JSON.stringify({ state: closing ? "paused" : "open" }) });
      // The page depends on the setting (the test panel), and a same-address navigation does not re-render: run the view again.
      await administration();
      toast(closing ? "Self-Service is closed for maintenance." : "Self-Service is open.");
    } catch (error) { setMessage(document.querySelector("#ss-alert")!, failure(error)); }
  });
  document.querySelector("#new-account")!.addEventListener("click", openCreate);
  document.querySelector("#accounts")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-manage]");
    const row = rows.find((entry) => entry.id === button?.dataset.manage);
    if (row) openManage(row);
  });
  await Promise.all([load(), checkRetention()]);
}

/* ---------- My account ---------- */

export async function myAccount(): Promise<void> {
  const session = await loadSession("account");
  if (!session) return;
  document.title = "My account · Staff workspace";
  const recovery = session.recovery;
  shell(session, "account", html`
    <header class="page-header"><div><h1>My account</h1><p>${session.displayName} · <span class="mono">${session.username}</span> · ${ROLE_LABELS[session.role]}</p>
      ${session.directory ? html`<p>Staff Directory: ${session.directory.name}${session.directory.position ? `, ${session.directory.position}` : ""} · ${DEPARTMENTS[session.directory.department as DepartmentCode] ?? session.directory.department}</p>` : ""}</div></header>
    ${session.mustChangePassword ? html`<div class="callout callout--action" role="alert">${icon("alert")}<p><strong>Choose your own password to continue.</strong> Your current password was set by an administrator; the rest of the workspace opens once you replace it.</p></div>` : ""}
    <div class="panels">
      <form class="panel form" id="password-form" novalidate>
        <h2 class="panel__title">Password</h2>
        <div class="field"><label for="current">Current password</label><input id="current" name="currentPassword" type="password" autocomplete="current-password" required /></div>
        <div class="field"><label for="next">New password</label><input id="next" name="newPassword" type="password" autocomplete="new-password" minlength="12" required aria-describedby="next-hint" /><p class="field__hint" id="next-hint">At least 12 characters. A short phrase is easier to remember.</p></div>
        <div class="field"><label for="repeat">Repeat new password</label><input id="repeat" name="repeat" type="password" autocomplete="new-password" required /></div>
        <div class="form-alert" id="password-alert" role="alert" hidden></div>
        <div class="form-actions"><button class="button button--primary" type="submit">Change password</button></div>
      </form>
      ${session.mustChangePassword ? "" : html`
      <form class="panel form" id="profile-form" novalidate>
        <h2 class="panel__title">Profile</h2>
        <div class="field"><label for="name">Display name</label><input id="name" name="displayName" value="${session.displayName}" maxlength="80" /></div>
        <div class="field"><label for="username">Username</label><input id="username" name="username" value="${session.username}" maxlength="64" autocapitalize="none" spellcheck="false" /><p class="field__hint">Changing it signs you out on your other devices.</p></div>
        <div class="form-alert" id="profile-alert" role="alert" hidden></div>
        <div class="form-actions"><button class="button button--primary" type="submit">Save profile</button></div>
      </form>
      <section class="panel" aria-labelledby="sessions-title">
        <h2 class="panel__title" id="sessions-title">Sessions</h2>
        <p class="field__hint">Signed in somewhere you no longer use? End every session except this one.</p>
        <div class="form-actions form-actions--start"><button class="button button--secondary" type="button" id="revoke-others">Sign out other devices</button></div>
      </section>`}
      ${session.role === "OWNER" && !session.mustChangePassword ? html`
      <section class="panel panel--wide" aria-labelledby="recovery-title">
        <h2 class="panel__title" id="recovery-title">Owner recovery key</h2>
        <p class="field__hint">If you ever forget your username or password, a recovery key resets your owner password without Cloudflare or database access. It can do nothing else, works once, and only its fingerprint is stored.</p>
        <p class="recovery-status">${recovery?.configured ? html`<span class="tag tag--ok">Configured</span> since ${formatDateTime(recovery.createdAt!)}` : html`<span class="tag tag--warn">Not configured</span>`}</p>
        <p class="field__hint">The simplest way to keep it safe is the Owner Console on your PC: <strong>9. Pair this computer</strong> stores it encrypted to your Windows account. You can also issue one here to print or store offline.</p>
        <div class="form-alert" id="recovery-alert" role="alert" hidden></div>
        <div class="form-actions form-actions--start">
          <button class="button button--secondary" type="button" id="rotate-key">${recovery?.configured ? "Replace recovery key" : "Create recovery key"}</button>
          ${recovery?.configured ? html`<button class="button button--danger" type="button" id="revoke-key">Revoke recovery key</button>` : ""}
        </div>
        <div id="recovery-result"></div>
      </section>` : ""}
    </div>`);
  const main = document.querySelector("#main-content")!;
  bindCopy(main);

  const passwordForm = document.querySelector<HTMLFormElement>("#password-form")!;
  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(passwordForm);
    const alert = passwordForm.querySelector<HTMLElement>("#password-alert")!;
    if (values.get("newPassword") !== values.get("repeat")) { setMessage(alert, "The new passwords do not match."); passwordForm.querySelector<HTMLInputElement>("#repeat")!.focus(); return; }
    try {
      await api("/api/staff/me/password", { method: "POST", body: JSON.stringify({ currentPassword: values.get("currentPassword"), newPassword: values.get("newPassword") }) });
      toast("Password changed. Your other devices were signed out.");
      if (session.mustChangePassword) navigate("/staff/items", true);
      else { passwordForm.reset(); setMessage(alert, ""); }
    } catch (error) { setMessage(alert, failure(error)); }
  });

  document.querySelector<HTMLFormElement>("#profile-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = new FormData(form);
    try {
      const result = await api<{ changed: number }>("/api/staff/me", { method: "PATCH", body: JSON.stringify({ displayName: values.get("displayName"), username: values.get("username") }) });
      toast(result.changed ? "Profile saved." : "No changes to save.");
      if (result.changed) navigate("/staff/account", true);
    } catch (error) { setMessage(form.querySelector("#profile-alert")!, failure(error)); }
  });

  document.querySelector("#revoke-others")?.addEventListener("click", async () => {
    try { await api("/api/staff/me/sessions/revoke", { method: "POST" }); toast("Your other devices were signed out."); }
    catch (error) { toast(failure(error), "error"); }
  });

  document.querySelector("#rotate-key")?.addEventListener("click", async () => {
    if (recovery?.configured && !window.confirm("Replace your recovery key? The current one (including a paired computer's copy) stops working.")) return;
    try {
      const { recoveryKey } = await api<{ recoveryKey: string }>("/api/staff/me/recovery-key", { method: "POST" });
      mount(document.querySelector("#recovery-result")!, oneTime("Your owner recovery key", recoveryKey, "Shown once. Store it offline (print it, or save it in a password manager). Anyone holding it can reset your owner password, so keep it private. Re-pair the Owner Console if you use it."));
      toast("New recovery key issued. The previous key no longer works.");
    } catch (error) { setMessage(document.querySelector("#recovery-alert")!, failure(error)); }
  });

  document.querySelector("#revoke-key")?.addEventListener("click", async () => {
    if (!window.confirm("Revoke your recovery key? You will have no way to recover a forgotten owner password until you create a new one.")) return;
    try { await api("/api/staff/me/recovery-key", { method: "DELETE" }); toast("Recovery key revoked."); navigate("/staff/account", true); }
    catch (error) { setMessage(document.querySelector("#recovery-alert")!, failure(error)); }
  });
}
