import { DEPARTMENTS, type DepartmentCode } from "./directory-policy";
import { ACCESS_HINT, accessChoices, accessTag, bindCopy, canManage, oneTime } from "./account-ui";
import { adminPage, confirmImpact } from "./admin-frame";
import { type Access, type Role, accessLabel, loadSession, sessionAccess, shell } from "./staff";
import { type Html, api, emptyState, failure, formatDateTime, html, icon, mount, navigate, plural, setMessage, sheet as createSheet, sheetContent, toast } from "./ui";

type Row = { id: string; username: string; displayName: string; role: Role; access: Access; active: boolean; mustChangePassword: boolean; createdAt: string; lastLoginAt: string | null; openSessions: number };

/* ---------- Administration > Staff ---------- */

/** What each choice of role lets a person do, in the order the role menu offers them (the server decides; this only explains). */
const ROLE_GUIDE: ReadonlyArray<{ role: string; can: string }> = [
  { role: "DoL Staff", can: "Use the Logistics Hub: items, stock, loans, Self-Service review and activity." },
  { role: "Other department staff and officers", can: "Sign in to their own account only. The Logistics Hub stays closed to them." },
  { role: "Owner", can: "Everything, including Administration, other owners' accounts, recovery and removing old personal details." }
];

/** What changing an account's role does to that person, before it is saved. */
function roleImpact(from: Access, to: Access): string {
  if (from === to) return "";
  const hub = (access: Access) => access === "DoL" || access === "ADMIN" || access === "OWNER";
  const admin = (access: Access) => access === "ADMIN" || access === "OWNER";
  const effects = [
    hub(from) && !hub(to) ? "They lose access to the Logistics Hub's items, stock and loans." : "",
    !hub(from) && hub(to) ? "They gain access to the Logistics Hub's items, stock and loans." : "",
    admin(from) && !admin(to) ? "They lose Administration." : "",
    !admin(from) && admin(to) ? "They gain Administration, including every account." : ""
  ].filter(Boolean);
  return [`${accessLabel(from)} → ${accessLabel(to)}. They are signed out everywhere and sign in again with the new role.`, ...effects].join(" ");
}

export async function staffAccounts(): Promise<void> {
  const session = await adminPage("staff", {
    title: "Staff",
    lede: (session) => session.role === "OWNER" ? "Owners manage every account and role. People's Staff Directory records are kept in the Staff Directory." : "Administrators manage staff accounts. Owner and administrator accounts are managed by an owner.",
    actions: html`<button class="button button--primary" type="button" id="new-account">${icon("plus")}New account</button>`,
    body: () => html`
    <section aria-labelledby="accounts-title">
      <h2 id="accounts-title" class="section-title">Accounts</h2>
      <div id="accounts"><div class="data-table-wrap" aria-hidden="true">${Array.from({ length: 4 }, () => html`<div class="skeleton-row"><span class="skeleton skeleton--text"></span></div>`)}</div></div>
    </section>
    <section class="admin-block" aria-labelledby="roles-title">
      <h2 id="roles-title" class="section-title">What each role can do</h2>
      <div class="data-table-wrap"><table class="data-table data-table--static">
        <caption class="visually-hidden">What each role can do</caption>
        <thead><tr><th scope="col">Role</th><th scope="col">Can</th></tr></thead>
        <tbody>${ROLE_GUIDE.map((entry) => html`<tr><th scope="row">${entry.role}</th><td>${entry.can}</td></tr>`)}</tbody>
      </table></div>
    </section>
    <section class="admin-block" aria-labelledby="directory-title">
      <h2 id="directory-title" class="section-title">Staff Directory</h2>
      <p>The directory holds who works in each department, their positions and their official ID cards. An account is linked to a person there, and a sign-in can be created or linked from a person's page.</p>
      <a class="button button--secondary" href="/staff/admin/directory" data-route>Open the Staff Directory</a>
    </section>
    <dialog class="sheet" id="sheet" aria-labelledby="sheet-title"></dialog>`
  });
  if (!session) return;

  const sheet = document.querySelector<HTMLDialogElement>("#sheet")!;
  let rows: Row[] = [];
  bindCopy(sheet);
  const panel = createSheet(sheet);
  const close = () => panel.close(true);

  async function load(): Promise<void> {
    try {
      const { accounts } = await api<{ accounts: Row[] }>("/api/staff/admin/accounts");
      rows = accounts;
      mount(document.querySelector("#accounts")!, html`<div class="data-table-wrap"><table class="data-table data-table--static">
        <caption class="visually-hidden">Accounts that can sign in to the staff workspace</caption>
        <thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col" class="col-qty">Sessions</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${accounts.map((row) => html`<tr>
          <td><span class="cell-strong">${row.displayName}${row.id === session!.id ? html` <span class="muted">(you)</span>` : ""}</span><span class="cell-sub mono">${row.username}</span></td>
          <td>${accessTag(row.access)}</td>
          <td><span class="tags">${row.active ? html`<span class="tag tag--ok">Active</span>` : html`<span class="tag tag--bad">Disabled</span>`}${row.mustChangePassword ? html`<span class="tag tag--warn">Must set password</span>` : ""}</span></td>
          <td>${row.lastLoginAt ? formatDateTime(row.lastLoginAt) : html`<span class="muted">Never</span>`}</td>
          <td class="col-qty">${row.openSessions}</td>
          <td class="col-actions">${canManage(session!, row) && row.id !== session!.id ? html`<button type="button" class="button button--secondary button--sm" data-manage="${row.id}">Manage</button>` : row.id === session!.id ? html`<a class="text-link" href="/staff/account" data-route>My account</a>` : html`<span class="muted">Owner only</span>`}</td>
        </tr>`)}</tbody></table></div>`);
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
      <div class="field"><label for="c-role">Role</label><select id="c-role" name="access" aria-describedby="c-role-hint">${accessChoices(session!).map((access) => html`<option value="${access}">${accessLabel(access)}</option>`)}</select>
        <p class="field__hint" id="c-role-hint">${ACCESS_HINT}</p></div>
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
        const result = await api<{ username: string; generatedPassword: string | null }>("/api/staff/admin/accounts", { method: "POST", body: JSON.stringify({ displayName: values.get("displayName"), username: values.get("username"), access: values.get("access"), ...passwordPayload(form, "c") }) });
        form.hidden = true;
        mount(sheet.querySelector("#create-result")!, html`${result.generatedPassword ? oneTime(`Temporary password for ${result.username}`, result.generatedPassword, "Shown once and never stored. Give it to them privately; they must choose their own password at first sign-in.") : html`<p class="callout">${icon("check")}<span>Account created. They must replace the temporary password at first sign-in.</span></p>`}
          <div class="form-actions"><button type="button" class="button button--secondary" data-close>Done</button></div>`);
        toast(`Account ${result.username} created.`);
        await load();
      } catch (error) { setMessage(sheet.querySelector("#create-alert")!, failure(error)); }
    });
  }

  function openManage(row: Row): void {
    // An account whose role is no longer offered (Administrator) keeps it in the list until changed.
    const choices = accessChoices(session!).includes(row.access) ? accessChoices(session!) : [row.access, ...accessChoices(session!)];
    sheetShell(`${accessLabel(row.access)} · ${row.username}`, row.displayName, html`
      <form class="form form-section" id="profile-form" novalidate>
        <h3 class="form-section__title">Profile and role</h3>
        <div class="field-grid"><div class="field"><label for="m-name">Display name</label><input id="m-name" name="displayName" value="${row.displayName}" maxlength="80" /></div>
        <div class="field"><label for="m-username">Username</label><input id="m-username" name="username" value="${row.username}" maxlength="64" autocapitalize="none" spellcheck="false" /></div></div>
        <div class="field"><label for="m-role">Role</label><select id="m-role" name="access" aria-describedby="m-role-hint">${choices.map((access) => html`<option value="${access}" ${access === row.access ? html`selected` : ""}>${accessLabel(access)}</option>`)}</select><p class="field__hint" id="m-role-hint">${ACCESS_HINT}</p></div>
        <p class="field__hint">Changing the username or role signs them out everywhere.</p>
        <p class="impact-note" id="m-impact" role="status" hidden></p>
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
    // The consequence of a different role, in words, before it is saved.
    const impact = sheet.querySelector<HTMLElement>("#m-impact")!;
    sheet.querySelector<HTMLSelectElement>("#m-role")!.addEventListener("change", (event) => {
      const text = roleImpact(row.access, (event.target as HTMLSelectElement).value as Access);
      impact.textContent = text;
      impact.hidden = !text;
    });
    profile.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(profile);
      if (values.get("access") !== row.access) {
        const confirmed = await confirmImpact({ kicker: `${accessLabel(row.access)} · ${row.username}`, title: `Change the role of ${row.displayName}?`, impact: html`<p>${roleImpact(row.access, values.get("access") as Access)}</p>`, confirm: "Change role" });
        if (!confirmed) return;
      }
      try {
        const result = await api<{ changed: number; sessionsRevoked?: boolean }>(`/api/staff/admin/accounts/${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify({ displayName: values.get("displayName"), username: values.get("username"), access: values.get("access") }) });
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
      const confirmed = await confirmImpact({ kicker: `${accessLabel(row.access)} · ${row.username}`, title: `Sign ${row.displayName} out everywhere?`, impact: html`<p>${row.openSessions ? `${plural(row.openSessions, "open session")} end now.` : "They have no open sessions."} They can sign in again with their password.</p>`, confirm: "Sign out everywhere" });
      if (!confirmed) return;
      try { await api(`/api/staff/admin/accounts/${encodeURIComponent(row.id)}/sessions/revoke`, { method: "POST" }); toast(`${row.username} was signed out everywhere.`); close(); await load(); }
      catch (error) { setMessage(sheet.querySelector("#access-alert")!, failure(error)); }
    });
    sheet.querySelector("#toggle-active")!.addEventListener("click", async () => {
      if (row.active && !await confirmImpact({ kicker: `${accessLabel(row.access)} · ${row.username}`, title: `Disable ${row.displayName}?`, impact: html`<p>They are signed out now and cannot sign in until the account is enabled again. Their loans, history and Staff Directory record stay as they are.</p>`, confirm: "Disable account", danger: true })) return;
      try { await api(`/api/staff/admin/accounts/${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify({ active: !row.active }) }); toast(`${row.username} ${row.active ? "disabled" : "enabled"}.`); close(); await load(); }
      catch (error) { setMessage(sheet.querySelector("#access-alert")!, failure(error)); }
    });
  }

  document.querySelector("#new-account")!.addEventListener("click", openCreate);
  document.querySelector("#accounts")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-manage]");
    const row = rows.find((entry) => entry.id === button?.dataset.manage);
    if (row) openManage(row);
  });
  await load();
}

/* ---------- My account ---------- */

export async function myAccount(): Promise<void> {
  const session = await loadSession("account");
  if (!session) return;
  document.title = "My account · Staff workspace";
  const recovery = session.recovery;
  shell(session, "account", html`
    <header class="page-header"><div><h1>My account</h1><p>${session.displayName} · <span class="mono">${session.username}</span> · ${accessLabel(sessionAccess(session))}</p>
      ${session.directory ? html`<p>Staff Directory: ${session.directory.name}${session.directory.position ? `, ${session.directory.position}` : ""} · ${DEPARTMENTS[session.directory.department as DepartmentCode] ?? session.directory.department}</p>` : ""}</div></header>
    ${session.hub === false && !session.mustChangePassword ? html`<div class="callout callout--action">${icon("info")}<p><strong>Your sign-in is set up as ${accessLabel(sessionAccess(session))}.</strong> The Logistics Hub's items, stock, loans and records are for the Department of Logistics; this page is where you look after your account.</p></div>` : ""}
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
