import { DEPARTMENTS, DEPARTMENT_CODES, type DepartmentCode } from "./directory-policy";
import { type Loan, loanRow, openReturn } from "./loan-form";
import { type Card, cardForm, cardSource, forgetScans, importArchive, openIdViewer, scan } from "./staff-ids";
import { ROLE_LABELS, type Role, type Session, adminTabs, initials, loadSession, shell } from "./staff";
import { type Html, api, categoryName, emptyState, failure, formatDate, formatDateTime, html, icon, label, mount, navigate, officeDay, onLeave, ownQuery, plural, setMessage, sheet as createSheet, sheetContent, toast, units, writeParams } from "./ui";

/*
 * Administration → Staff Directory (V1.3). One page: the department-grouped directory, and a person's profile in the same
 * place (?person=…&tab=…) with five sections, Profile | USC ID | Usage | Loans | Activity. Private to administrators and owners
 * (the Worker refuses everyone else); only the owner changes ID scans. ID images load only when the USC ID section is opened.
 */

type Person = {
  id: string; name: string; department: string; position: string | null; officer: boolean; studentId: string | null; active: boolean; sourceKey: string | null;
  createdAt: string; updatedAt: string; hasId: boolean; account: { id: string; username: string; displayName: string; role: Role } | null;
};
type Entry = { at: string; action: string; actor: string | null; details: Record<string, unknown> };
type Detail = { person: Person; card: Card | null; history: Entry[] };
type Usage = { id: string; at: string; itemId: string; itemName: string; category: string; stockArea: string; unit: string; quantity: number; kind: "LOAN" | "TAKE"; purpose: string | null; phone: number; matchedBy: "STUDENT_ID" | "NAME" };
type ActivityEvent = { id: string; at: string | null; title: string; summary: string };
type Linkable = { id: string; username: string; displayName: string; role: Role; active: boolean; personId: string | null; personName: string | null };
type Tab = "profile" | "id" | "usage" | "loans" | "activity";

const TABS: Array<[Tab, string]> = [["profile", "Profile"], ["id", "USC ID"], ["usage", "Usage"], ["loans", "Loans"], ["activity", "Activity"]];
const SHOWS = { all: "Everyone", officers: "Officers", "no-id": "No USC ID", unlinked: "Not linked", inactive: "Inactive" } as const;
type Show = keyof typeof SHOWS;
const SHOW_TEST: Record<Show, (person: Person) => boolean> = {
  all: (person) => person.active, officers: (person) => person.officer && person.active, "no-id": (person) => !person.hasId && person.active,
  unlinked: (person) => !person.account && person.active, inactive: (person) => !person.active
};
const DIRECTORY = "/staff/admin/directory";
const departmentName = (code: string) => DEPARTMENTS[code as DepartmentCode] ?? code;
const monogram = (person: Pick<Person, "name" | "department">, large = false) => html`<span class="monogram ${large ? "monogram--lg" : ""} dept-${person.department}" aria-hidden="true">${initials(person.name)}</span>`;
const fold = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function staffDirectory(): Promise<void> {
  const session = await loadSession("admin");
  if (!session) return;
  if (session.role === "STAFF") { navigate("/staff/items", true); return; }
  const owner = session.role === "OWNER";
  shell(session, "admin", html`<div id="directory"></div><dialog class="sheet sheet--wide" id="sheet" aria-labelledby="sheet-title"></dialog>`);
  const root = document.querySelector<HTMLElement>("#directory")!;
  const sheetElement = document.querySelector<HTMLDialogElement>("#sheet")!;
  const panel = createSheet(sheetElement);
  let people: Person[] | null = null;
  let loading: Promise<void> | null = null;
  onLeave(forgetScans);

  // Bound once: the list re-renders into the same root on every filter, search or return from a profile.
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-add]")) openEditor(null);
    if (target.closest("[data-import]")) openImport();
  });

  const load = () => loading ??= api<{ people: Person[] }>("/api/staff/admin/directory").then((result) => { people = result.people; }).finally(() => { loading = null; });

  /* ---------- The directory ---------- */

  async function list(): Promise<void> {
    document.title = "Staff Directory · Administration";
    const params = new URLSearchParams(window.location.search);
    const show = (params.get("show") ?? "all") as Show;
    const department = DEPARTMENT_CODES.find((code) => code === params.get("dept")) ?? null;
    mount(root, html`
      <header class="page-header">
        <div class="page-header__title"><h1>Staff Directory</h1><p>USC officers and staff by department. Private to administrators; opening a USC ID is recorded in Activity.</p></div>
        <div class="page-header__actions">
          ${owner ? html`<button class="button button--secondary" type="button" data-import>${icon("stack")}Import ID scans</button>` : ""}
          <button class="button button--primary" type="button" data-add>${icon("plus")}Add person</button>
        </div>
      </header>
      ${adminTabs("directory")}
      <div class="dir-toolbar">
        <div class="search-field">${icon("search")}<input type="search" data-search id="dir-search" value="${params.get("q") ?? ""}" placeholder="Search names, positions or sign-ins" aria-label="Search the Staff Directory" autocomplete="off" /><kbd>/</kbd></div>
        <div class="chips" role="group" aria-label="Show">${(Object.keys(SHOWS) as Show[]).map((key) => html`<button type="button" class="chip" data-show="${key}" aria-pressed="${key === show}">${SHOWS[key]}<span class="chip__count" data-count="${key}"></span></button>`)}</div>
      </div>
      <div class="dir-layout">
        <nav class="dir-index" aria-label="Departments"><ul>
          <li><a href="${DIRECTORY}${show === "all" ? "" : `?show=${show}`}" data-route data-dept="" ${department ? "" : html`aria-current="true"`}><span>All departments</span><span class="dir-index__count" data-dept-count=""></span></a></li>
          ${DEPARTMENT_CODES.map((code) => html`<li><a href="${DIRECTORY}?dept=${code}${show === "all" ? "" : `&show=${show}`}" data-route data-dept="${code}" ${department === code ? html`aria-current="true"` : ""}>
            <span class="dept-dot dept-${code}" aria-hidden="true"></span><span>${DEPARTMENTS[code]}</span><span class="dir-index__count" data-dept-count="${code}"></span></a></li>`)}
        </ul></nav>
        <div class="dir-results"><p class="dir-summary" role="status" data-summary></p><div data-results>${people ? "" : html`<div class="dept-group" aria-hidden="true">${Array.from({ length: 6 }, () => html`<div class="skeleton-row"><span class="skeleton skeleton--text"></span></div>`)}</div>`}</div></div>
      </div>`);
    const search = root.querySelector<HTMLInputElement>("#dir-search")!;
    // On narrow screens the departments are one scrolling row: keep the chosen one in sight.
    root.querySelector(".dir-index [aria-current]")?.scrollIntoView({ block: "nearest", inline: "center" });
    const draw = () => {
      if (!people) return;
      const words = fold(search.value).split(/\s+/).filter(Boolean);
      const matches = (person: Person) => {
        const text = fold([person.name, person.position ?? "", departmentName(person.department), person.department, person.account?.username ?? "", person.account?.displayName ?? ""].join(" "));
        return words.every((word) => text.includes(word));
      };
      const searched = people.filter(matches);
      for (const key of Object.keys(SHOWS) as Show[]) root.querySelector(`[data-count="${key}"]`)!.textContent = String(searched.filter((person) => (department ? person.department === department : true) && SHOW_TEST[key](person)).length);
      const shown = searched.filter(SHOW_TEST[show]);
      root.querySelector(`[data-dept-count=""]`)!.textContent = String(shown.length);
      for (const code of DEPARTMENT_CODES) root.querySelector(`[data-dept-count="${code}"]`)!.textContent = String(shown.filter((person) => person.department === code).length || "");
      const visible = department ? shown.filter((person) => person.department === department) : shown;
      const withId = visible.filter((person) => person.hasId).length;
      const officers = visible.filter((person) => person.officer).length;
      root.querySelector("[data-summary]")!.textContent = `${visible.length === 1 ? "1 person" : `${visible.length} people`} · ${withId} with a USC ID on file · ${plural(officers, "officer")}`;
      const groups = DEPARTMENT_CODES.map((code) => [code, visible.filter((person) => person.department === code)] as const).filter(([, members]) => members.length);
      const unknown = visible.filter((person) => !(person.department in DEPARTMENTS));
      mount(root.querySelector("[data-results]")!, people.length === 0
        ? emptyState("The directory is empty", owner ? "Import the official ID archive, or add people one at a time." : "Add people one at a time; the owner imports the official ID archive.", html`<button class="button button--primary" type="button" data-add>${icon("plus")}Add person</button>`)
        : visible.length === 0 ? emptyState("No one matches", "Try another name, or show everyone.", html`<a class="button button--secondary" href="${DIRECTORY}" data-route>Show everyone</a>`)
        : html`<div class="dept-groups ${department ? "dept-groups--one" : ""}">${groups.map(([code, members]) => html`<section class="dept-group" aria-labelledby="dept-${code}">
            <h2 class="dept-group__title" id="dept-${code}"><span class="dept-dot dept-${code}" aria-hidden="true"></span><span>${DEPARTMENTS[code]}</span><span class="dept-group__meta">${code} · ${members.length}</span></h2>
            <ul class="person-list">${members.map(personRow)}</ul></section>`)}
          ${unknown.length ? html`<section class="dept-group"><h2 class="dept-group__title">Other</h2><ul class="person-list">${unknown.map(personRow)}</ul></section>` : ""}</div>`);
    };
    let timer = 0;
    search.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => { writeParams({ q: search.value.trim() || null }); draw(); }, 120); });
    root.querySelector(".chips")!.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-show]");
      if (chip) navigate(`${DIRECTORY}?${new URLSearchParams({ ...(department ? { dept: department } : {}), ...(chip.dataset.show === "all" ? {} : { show: chip.dataset.show! }), ...(search.value.trim() ? { q: search.value.trim() } : {}) })}`.replace(/\?$/, ""), true);
    });
    if (!people) {
      try { await load(); } catch (error) { mount(root.querySelector("[data-results]")!, emptyState("The directory could not be loaded", failure(error), "", "error", 2)); return; }
    }
    draw();
  }

  /** One person in a department: initials, name and position, and only the facts worth seeing at a glance (what is missing has its own filter). */
  function personRow(person: Person): Html {
    return html`<li><a class="person-row ${person.active ? "" : "is-inactive"}" href="${DIRECTORY}?person=${person.id}" data-route>
      ${monogram(person)}
      <span class="person-row__text"><strong class="person-row__name">${person.name}</strong>
        <span class="person-row__role">${person.position ?? html`<span class="muted">No position yet</span>`}</span></span>
      <span class="person-row__tags">${person.officer ? html`<span class="tag tag--gold">Officer</span>` : ""}${person.hasId ? html`<span class="tag tag--ok">USC ID</span>` : ""}${person.account ? html`<span class="tag tag--brand" title="Signs in as ${person.account.username}">${icon("user")}<span class="visually-hidden">Signs in as </span>${person.account.username}</span>` : ""}${person.active ? "" : html`<span class="tag tag--bad">Inactive</span>`}</span>
      </a></li>`;
  }

  /* ---------- Add or edit a person ---------- */

  function openEditor(person: Person | null, done?: () => Promise<void>): void {
    mount(sheetElement, sheetContent(person ? departmentName(person.department) : "Staff Directory", person ? `Edit ${person.name}` : "Add a person", html`<form class="form" id="person-form" novalidate>
      <div class="field"><label for="p-name">Full name</label><input id="p-name" name="name" value="${person?.name ?? ""}" maxlength="120" autocomplete="off" required aria-describedby="p-name-hint" />
        <p class="field__hint" id="p-name-hint">As it should appear in the directory, e.g. Ana Marie Santos. An import starts from the name on the scan's file.</p></div>
      <div class="field-grid">
        <div class="field"><label for="p-department">Department</label><select id="p-department" name="department" required>${person ? "" : html`<option value="">Choose…</option>`}${DEPARTMENT_CODES.map((code) => html`<option value="${code}" ${person?.department === code ? html`selected` : ""}>${DEPARTMENTS[code]}</option>`)}</select></div>
        <div class="field"><label for="p-position">Position <span class="field__optional">optional</span></label><input id="p-position" name="position" value="${person?.position ?? ""}" maxlength="80" autocomplete="off" placeholder="e.g. Director for Logistics" /></div>
      </div>
      <label class="checkbox"><input type="checkbox" name="officer" ${person?.officer ? html`checked` : ""} /><span>Officer of the council</span></label>
      <div class="field"><label for="p-student">Student ID number <span class="field__optional">optional</span></label><input id="p-student" name="studentId" value="${person?.studentId ?? ""}" maxlength="30" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="p-student-hint" />
        <p class="field__hint" id="p-student-hint">Type it from a record you trust. It finds their loans and phone records; it is never read from the scan.</p></div>
      ${person ? html`<fieldset class="segmented segmented--2"><legend class="visually-hidden">Status</legend>
        <label><input type="radio" name="active" value="1" ${person.active ? html`checked` : ""} /><span>Active</span></label><label><input type="radio" name="active" value="0" ${person.active ? "" : html`checked`} /><span>Inactive</span></label></fieldset>` : ""}
      <div class="form-alert" role="alert" hidden id="person-alert"></div>
      <div class="form-actions"><button class="button button--ghost" type="button" data-close>Cancel</button><button class="button button--primary" type="submit">${person ? "Save changes" : "Add person"}</button></div>
    </form>`));
    panel.open();
    const form = sheetElement.querySelector<HTMLFormElement>("#person-form")!;
    form.querySelector<HTMLInputElement>("#p-name")!.focus();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const body = { name: values.get("name"), department: values.get("department"), position: values.get("position"), officer: values.get("officer") === "on", studentId: values.get("studentId"), ...(person ? { active: values.get("active") === "1", updatedAt: person.updatedAt } : {}) };
      try {
        if (person) {
          const result = await api<{ changed: number }>(`/api/staff/admin/directory/${person.id}`, { method: "PATCH", body: JSON.stringify(body) });
          toast(result.changed ? "Profile saved." : "No changes to save.");
        } else {
          const { id } = await api<{ id: string }>("/api/staff/admin/directory", { method: "POST", body: JSON.stringify(body) });
          toast(`${String(body.name).trim()} added.`);
          panel.close(true);
          people = null;
          navigate(`${DIRECTORY}?person=${id}`);
          return;
        }
        panel.close(true);
        people = null;
        await done?.();
      } catch (error) { setMessage(sheetElement.querySelector("#person-alert")!, failure(error)); }
    });
  }

  function openImport(): void {
    mount(sheetElement, sheetContent("Owner · Staff Directory", "Import official ID scans", html`<div id="import-host"></div>`));
    panel.open();
    const existing = new Map((people ?? []).filter((person) => person.sourceKey).map((person) => [person.sourceKey!, { hasId: person.hasId }]));
    importArchive(sheetElement.querySelector<HTMLElement>("#import-host")!, existing, async () => { people = null; await load().catch(() => undefined); });
    sheetElement.addEventListener("close", () => { if (!new URLSearchParams(window.location.search).get("person")) void list(); }, { once: true });
  }

  /* ---------- A person ---------- */

  async function profile(id: string, tab: Tab): Promise<void> {
    mount(root, html`<a class="back-link" href="${DIRECTORY}" data-route>${icon("back")}Staff Directory</a><div data-profile><div class="skeleton skeleton--block"></div></div>`);
    let detail: Detail;
    try { detail = await api<Detail>(`/api/staff/admin/directory/${id}`); } catch (error) {
      mount(root.querySelector("[data-profile]")!, emptyState("This profile could not be opened", failure(error), html`<a class="button button--secondary" href="${DIRECTORY}" data-route>Back to the directory</a>`, "error", 1));
      return;
    }
    const { person } = detail;
    document.title = `${person.name} · Staff Directory`;
    const reload = async () => { people = null; await profile(id, currentTab()); };
    mount(root.querySelector("[data-profile]")!, html`
      <header class="person-head">
        ${monogram(person, true)}
        <div class="person-head__text">
          <h1>${person.name}</h1>
          <p>${person.position ? html`${person.position} · ` : ""}${departmentName(person.department)}</p>
          <p class="tags">${person.officer ? html`<span class="tag tag--gold">Officer</span>` : ""}${person.active ? html`<span class="tag tag--ok">Active</span>` : html`<span class="tag tag--bad">Inactive</span>`}${person.hasId ? html`<span class="tag tag--ok">USC ID on file</span>` : html`<span class="tag">No USC ID</span>`}${person.account ? html`<span class="tag tag--brand">Signs in as ${person.account.username}</span>` : html`<span class="tag">Not linked to a sign-in</span>`}</p>
        </div>
        <div class="person-head__actions"><button class="button button--secondary" type="button" data-edit>Edit profile</button></div>
      </header>
      <div class="tabs" role="tablist" aria-label="Profile sections">${TABS.map(([key, text]) => html`<button type="button" role="tab" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${key === tab}" tabindex="${key === tab ? 0 : -1}">${text}</button>`)}</div>
      ${TABS.map(([key]) => html`<section class="person-panel" id="panel-${key}" role="tabpanel" aria-labelledby="tab-${key}" tabindex="0" ${key === tab ? "" : html`hidden`}></section>`)}`);
    const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const show = (next: Tab) => {
      tabs.forEach((button) => {
        const selected = button.id === `tab-${next}`;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        root.querySelector<HTMLElement>(`#${button.getAttribute("aria-controls")}`)!.hidden = !selected;
      });
      writeParams({ tab: next === "profile" ? null : next });
      void renderPanel(next);
    };
    // Manual activation (WAI-ARIA APG): arrows move between tabs, Enter, Space or a click opens one, because most sections load data.
    tabs.forEach((button, index) => {
      button.addEventListener("click", () => show(button.id.slice(4) as Tab));
      button.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (event.key === "Home" || event.key === "End") { event.preventDefault(); tabs[event.key === "Home" ? 0 : tabs.length - 1]!.focus(); }
        if (!step) return;
        event.preventDefault();
        tabs[(index + step + tabs.length) % tabs.length]!.focus();
      });
    });
    root.querySelector("[data-edit]")!.addEventListener("click", () => openEditor(person, reload));

    const rendered = new Set<Tab>();
    async function renderPanel(which: Tab): Promise<void> {
      const host = root.querySelector<HTMLElement>(`#panel-${which}`)!;
      if (rendered.has(which)) return;
      rendered.add(which);
      if (which === "profile") profilePanel(host, detail, reload);
      if (which === "id") idPanel(host, detail, reload);
      if (which === "usage") await usagePanel(host, person);
      if (which === "loans") await loansPanel(host, person);
      if (which === "activity") await activityPanel(host, detail);
    }
    await renderPanel(tab);
  }

  const currentTab = (): Tab => TABS.find(([key]) => key === new URLSearchParams(window.location.search).get("tab"))?.[0] ?? "profile";

  /* ---------- Profile ---------- */

  function profilePanel(host: HTMLElement, detail: Detail, reload: () => Promise<void>): void {
    const { person, card } = detail;
    const row = (term: string, value: Html | string) => html`<div class="summary-list__row"><dt>${term}</dt><dd>${value}</dd></div>`;
    mount(host, html`<div class="person-sections person-sections--split">
      <section class="panel" aria-labelledby="facts-title"><h2 class="panel__title" id="facts-title">Details</h2>
        <dl class="summary-list">
          ${row("Full name", person.name.includes(" ") ? person.name : html`${person.name} <span class="tag tag--warn">Add the full name</span>`)}
          ${row("Department", html`${departmentName(person.department)} <span class="muted mono">${person.department}</span>`)}
          ${row("Position", person.position ?? html`<span class="muted">Not set</span>`)}
          ${row("Officer", person.officer ? "Yes, an officer of the council" : "No")}
          ${row("Student ID number", person.studentId ? html`<span class="mono">${person.studentId}</span>` : html`<span class="muted">Not set</span>`)}
          ${row("Status", person.active ? "Active" : "Inactive")}
          ${row("USC ID", card ? html`On file. ${cardSource(card)}` : html`<span class="muted">Not on file</span>`)}
          ${row("Record", `Added ${formatDateTime(person.createdAt)}; last changed ${formatDateTime(person.updatedAt)}.`)}
        </dl>
        <div class="form-actions form-actions--start"><button class="button button--secondary button--sm" type="button" data-edit-here>Edit details</button></div>
      </section>
      <section class="panel" aria-labelledby="link-title"><h2 class="panel__title" id="link-title">Sign-in</h2><div data-link></div></section>
      ${!person.active && card && owner ? html`<p class="callout">${icon("info")}<span>${person.name} is inactive and their ID scans are still on file. Remove them in USC ID once they are no longer needed.</span></p>` : ""}
    </div>`);
    host.querySelector("[data-edit-here]")!.addEventListener("click", () => openEditor(person, reload));
    void linkSection(host.querySelector<HTMLElement>("[data-link]")!, person, reload);
  }

  async function linkSection(host: HTMLElement, person: Person, reload: () => Promise<void>): Promise<void> {
    if (person.account) {
      const account = person.account;
      const mayUnlink = owner || account.role === "STAFF" || account.id === session!.id;
      mount(host, html`<p class="link-card">${icon("user")}<span><strong>${account.displayName}</strong> <span class="mono">${account.username}</span> · ${ROLE_LABELS[account.role]}</span></p>
        <p class="field__hint">Their own records in Logistics Hub appear under Activity. The link was made by hand and is in the directory record.</p>
        <div class="form-alert" role="alert" hidden data-alert></div>
        ${mayUnlink ? html`<div class="form-actions form-actions--start"><button class="button button--ghost button--sm" type="button" data-unlink>Unlink</button></div>` : html`<p class="field__hint">Only an owner can unlink an administrator or owner account.</p>`}`);
      host.querySelector("[data-unlink]")?.addEventListener("click", async () => {
        if (!window.confirm(`Unlink ${person.name} from the sign-in ${account.username}?`)) return;
        try { await api(`/api/staff/admin/directory/${person.id}/account`, { method: "DELETE" }); toast("Unlinked."); await reload(); }
        catch (error) { setMessage(host.querySelector("[data-alert]")!, failure(error)); }
      });
      return;
    }
    mount(host, html`<p class="field__hint">Not linked. Link only after confirming the sign-in belongs to this person; nothing is linked automatically.</p><p class="muted">Loading sign-ins…</p>`);
    let accounts: Linkable[];
    try { ({ accounts } = await api<{ accounts: Linkable[] }>("/api/staff/admin/directory/accounts")); } catch (error) { mount(host, html`<p class="form-alert" role="alert">${icon("alert")}<span>${failure(error)}</span></p>`); return; }
    const free = accounts.filter((account) => !account.personId && account.active);
    mount(host, html`<form class="link-form" novalidate>
      <p class="field__hint">Not linked. Link only after confirming the sign-in belongs to this person; nothing is linked automatically.</p>
      ${free.length ? html`<div class="field"><label for="link-account">Sign-in</label><select id="link-account" name="accountId"><option value="">Choose a sign-in…</option>${free.map((account) => html`<option value="${account.id}">${account.displayName} (${account.username}) · ${ROLE_LABELS[account.role]}</option>`)}</select></div>
        <div class="form-alert" role="alert" hidden data-alert></div>
        <div class="form-actions form-actions--start"><button class="button button--secondary button--sm" type="submit">Link sign-in</button></div>`
        : html`<p class="muted">Every sign-in you may link is already linked to someone.</p>`}</form>`);
    host.querySelector("form")!.addEventListener("submit", async (event) => {
      event.preventDefault();
      const accountId = new FormData(event.target as HTMLFormElement).get("accountId");
      if (!accountId) { setMessage(host.querySelector("[data-alert]")!, "Choose a sign-in."); return; }
      try { await api(`/api/staff/admin/directory/${person.id}/account`, { method: "PUT", body: JSON.stringify({ accountId }) }); toast("Linked."); await reload(); }
      catch (error) { setMessage(host.querySelector("[data-alert]")!, failure(error)); }
    });
  }

  /* ---------- USC ID ---------- */

  function idPanel(host: HTMLElement, detail: Detail, reload: () => Promise<void>): void {
    const { person, card } = detail;
    const views = detail.history.filter((entry) => entry.action === "STAFF_ID_VIEWED").slice(0, 6);
    if (!card) {
      mount(host, html`${emptyState("No USC ID on file", owner ? "Add both sides of their official ID, or import the archive from the directory." : "Only the owner adds ID scans.", owner ? html`<button class="button button--primary" type="button" data-add-card>${icon("camera")}Add ID scans</button>` : "", "", 2)}<div data-card-form></div>`);
      host.querySelector("[data-add-card]")?.addEventListener("click", () => {
        const form = host.querySelector<HTMLElement>("[data-card-form]")!;
        host.querySelector(".empty")!.remove();
        cardForm(form, person, null, reload, () => { void reload(); });
      });
      return;
    }
    const tile = (side: "front" | "back") => {
      const dims = card[side];
      return html`<figure class="id-tile"><button type="button" class="id-tile__button" data-open="${side}" style="--ratio: ${dims.width / dims.height}" aria-label="Open the ${side} of the USC ID large"><img alt="" data-scan="${side}" /></button><figcaption>${side === "front" ? "Front" : "Back"}</figcaption></figure>`;
    };
    mount(host, html`<div class="person-sections person-sections--split">
      <section class="panel" aria-labelledby="card-title"><h2 class="panel__title" id="card-title">Official USC ID</h2>
        <div class="id-pair">${tile("front")}${tile("back")}</div>
        <p class="field__hint">${cardSource(card)} Select a side to open it large: turn the card with F and B, zoom with + and −.</p>
        ${owner ? html`<div data-card-form></div><div class="form-actions form-actions--start" data-owner-actions>
          <button class="button button--secondary button--sm" type="button" data-replace>Replace scans</button><button class="button button--ghost button--sm" type="button" data-remove>Remove scans</button></div>` : ""}
      </section>
      <section class="panel" aria-labelledby="views-title"><h2 class="panel__title" id="views-title">Recent openings</h2>
        <p class="field__hint">Every opening of this card by an administrator or owner is recorded, once per person every ten minutes.</p>
        ${views.length ? html`<ul class="access-log">${views.map((entry) => html`<li><strong>${entry.actor ?? "Someone"}</strong> <time datetime="${entry.at}">${formatDateTime(entry.at)}</time></li>`)}</ul>` : html`<p class="muted">Opened for the first time now.</p>`}
      </section></div>`);
    for (const side of ["front", "back"] as const) {
      const image = host.querySelector<HTMLImageElement>(`[data-scan="${side}"]`)!;
      void scan(person.id, card.mediaId, side).then((url) => { image.src = url; }, (error: unknown) => { image.closest("figure")!.append(Object.assign(document.createElement("p"), { className: "form-alert", textContent: failure(error) })); });
    }
    host.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const open = target.closest<HTMLElement>("[data-open]");
      if (open) void openIdViewer(person, card, open.dataset.open as "front" | "back");
      if (target.closest("[data-replace]")) {
        host.querySelector<HTMLElement>("[data-owner-actions]")!.hidden = true;
        cardForm(host.querySelector<HTMLElement>("[data-card-form]")!, person, card.mediaId, reload, () => { void reload(); });
      }
      const remove = target.closest<HTMLButtonElement>("[data-remove]");
      if (remove) {
        if (!window.confirm(`Remove ${person.name}'s ID scans for good? The directory entry stays.`)) return;
        remove.disabled = true;
        api(`/api/staff/admin/directory/${person.id}/id?expected=${card.mediaId}`, { method: "DELETE" }).then(async () => { toast("ID scans removed."); await reload(); }, (error: unknown) => { remove.disabled = false; toast(failure(error), "error"); });
      }
    });
  }

  /* ---------- Usage ---------- */

  const matchNote = (person: Person): Html => {
    const ways = [person.studentId ? html`student ID <span class="mono">${person.studentId}</span>` : "", person.name.includes(" ") ? html`the exact name “${person.name}”` : ""].filter(Boolean);
    if (!ways.length) return html`<p class="callout">${icon("info")}<span>Add ${person.name}'s full name or student ID number (Edit profile) to find their loans and phone records. A single name never matches, so no one else's records appear here.</span></p>`;
    return html`<p class="field__hint">Found in the existing loan and phone records by ${ways.length === 2 ? html`${ways[0]} or ${ways[1]}` : ways[0]}. Records written another way are not included.</p>`;
  };

  async function usagePanel(host: HTMLElement, person: Person): Promise<void> {
    const today = officeDay();
    const yearAgo = officeDay(new Date(Date.now() - 365 * 86_400_000));
    mount(host, html`<div class="person-sections">
      ${matchNote(person)}
      <form class="usage-filters" novalidate>
        <div class="field"><label for="u-from">From</label><input id="u-from" name="from" type="date" value="${yearAgo}" max="${today}" /></div>
        <div class="field"><label for="u-to">To</label><input id="u-to" name="to" type="date" value="${today}" max="${today}" /></div>
        <div class="field"><label for="u-area">Area</label><select id="u-area" name="area"><option value="">All areas</option><option value="Inventory">General stock</option><option value="Pantry">Pantry</option></select></div>
        <div class="field"><label for="u-category">Category</label><select id="u-category" name="category"><option value="">All categories</option></select></div>
        <div class="field usage-filters__item"><label for="u-item">Item</label><input id="u-item" name="item" type="search" placeholder="Item name" autocomplete="off" /></div>
      </form>
      <div data-usage aria-live="polite"><div class="skeleton skeleton--block"></div></div></div>`);
    const form = host.querySelector<HTMLFormElement>(".usage-filters")!;
    let rows: Usage[] = [];
    let truncated = false;
    const draw = () => {
      const values = new FormData(form);
      const term = fold(String(values.get("item") ?? "").trim());
      const shown = rows.filter((row) => (!values.get("area") || row.stockArea === values.get("area")) && (!values.get("category") || row.category === values.get("category")) && (!term || fold(row.itemName).includes(term)));
      const taken = shown.filter((row) => row.kind === "TAKE");
      const loans = shown.filter((row) => row.kind === "LOAN");
      const byCategory = [...shown.reduce((map, row) => map.set(row.category, (map.get(row.category) ?? 0) + row.quantity), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
      mount(host.querySelector("[data-usage]")!, rows.length === 0 ? emptyState("Nothing found in these dates", "No loan or phone take in these dates matches this person.", "", "", 3) : html`
        <dl class="stat-strip">
          <div class="stat"><dt>Units taken</dt><dd><span class="stat__value">${taken.reduce((sum, row) => sum + row.quantity, 0)}</span><span class="stat__note">${plural(taken.length, "phone take")}</span></dd></div>
          <div class="stat"><dt>Borrowed</dt><dd><span class="stat__value">${loans.reduce((sum, row) => sum + row.quantity, 0)}</span><span class="stat__note">${plural(loans.length, "loan")}</span></dd></div>
          <div class="stat"><dt>Items</dt><dd><span class="stat__value">${new Set(shown.map((row) => row.itemId)).size}</span><span class="stat__note">different</span></dd></div>
          <div class="stat"><dt>Most used</dt><dd><span class="stat__value stat__value--text">${byCategory[0] ? categoryName(byCategory[0][0]) : "—"}</span><span class="stat__note">${byCategory[0] ? `${byCategory[0][1]} units` : ""}</span></dd></div>
        </dl>
        ${shown.length ? html`<div class="data-table-wrap"><table class="data-table data-table--static">
          <caption class="visually-hidden">What left stock for ${person.name}</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Item</th><th scope="col" class="col-hide-phone">Category</th><th scope="col" class="col-qty">Qty</th><th scope="col">How</th><th scope="col" class="col-hide-phone">Matched by</th></tr></thead>
          <tbody>${shown.map((row) => html`<tr><td>${formatDate(officeDay(row.at))}</td><td><a class="row-link" href="/staff/items?item=${row.itemId}" data-route>${row.itemName}</a></td><td class="col-hide-phone">${categoryName(row.category)}</td>
            <td class="col-qty">${row.quantity} <span class="muted">${units(row.quantity, row.unit)}</span></td><td>${row.kind === "LOAN" ? html`Borrowed${row.purpose ? ` · ${label(row.purpose)}` : ""}` : "Taken"}${row.phone ? html` <span class="muted">(phone)</span>` : ""}</td>
            <td class="col-hide-phone">${row.matchedBy === "STUDENT_ID" ? "Student ID" : "Name"}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Nothing matches these filters.</p>`}
        ${truncated ? html`<p class="field__hint">Only the newest 1,000 entries are shown; narrow the dates to see older ones.</p>` : ""}`);
    };
    const fetchRows = async () => {
      const values = new FormData(form);
      try {
        ({ usage: rows, truncated } = await api<{ usage: Usage[]; truncated: boolean }>(`/api/staff/admin/directory/${person.id}/usage?${new URLSearchParams({ from: String(values.get("from") ?? ""), to: String(values.get("to") ?? "") })}`));
        const select = form.querySelector<HTMLSelectElement>("#u-category")!;
        const chosen = select.value;
        mount(select, html`<option value="">All categories</option>${[...new Set(rows.map((row) => row.category))].sort().map((category) => html`<option value="${category}" ${category === chosen ? html`selected` : ""}>${categoryName(category)}</option>`)}`);
        draw();
      } catch (error) { mount(host.querySelector("[data-usage]")!, emptyState("Usage could not be loaded", failure(error), "", "error", 3)); }
    };
    form.addEventListener("change", (event) => { if ((event.target as HTMLElement).matches("[type=date]")) void fetchRows(); else draw(); });
    form.addEventListener("input", (event) => { if ((event.target as HTMLElement).id === "u-item") draw(); });
    await fetchRows();
  }

  /* ---------- Loans ---------- */

  async function loansPanel(host: HTMLElement, person: Person): Promise<void> {
    let loans: Loan[] = [];
    // One listener for the panel; a return re-draws the lists inside it.
    host.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-return]");
      const loan = button && loans.find((entry) => entry.id === button.dataset.return);
      if (loan) openReturn(loan, () => draw());
    });
    const draw = async () => {
    mount(host, html`<div class="skeleton skeleton--block"></div>`);
    try { ({ loans } = await api<{ loans: Loan[] }>(`/api/staff/admin/directory/${person.id}/loans`)); } catch (error) { mount(host, emptyState("Loans could not be loaded", failure(error), "", "error", 3)); return; }
    const out = loans.filter((loan) => loan.status === "OUT");
    const closed = loans.filter((loan) => loan.status !== "OUT");
    mount(host, html`<div class="person-sections">${matchNote(person)}
      <section aria-labelledby="out-title"><h2 class="section-label" id="out-title">On loan now (${out.length})</h2>
        ${out.length ? html`<ul class="loan-list">${out.map((loan) => loanRow(loan, true))}</ul>` : html`<p class="muted">Nothing is out with ${person.name} now.</p>`}</section>
      <section aria-labelledby="past-title"><h2 class="section-label" id="past-title">Returned and closed (${closed.length})</h2>
        ${closed.length ? html`<ul class="loan-list loan-list--closed">${closed.map((loan) => loanRow(loan, true))}</ul>` : html`<p class="muted">No earlier loans.</p>`}</section></div>`);
    };
    await draw();
  }

  /* ---------- Activity ---------- */

  async function activityPanel(host: HTMLElement, detail: Detail): Promise<void> {
    const { person } = detail;
    const record = html`<section class="panel" aria-labelledby="record-title"><h2 class="panel__title" id="record-title">Directory record</h2>
      <p class="field__hint">Who added, edited, linked, imported or opened this person's record.</p>
      <ol class="history">${detail.history.length ? detail.history.map((entry) => html`<li class="history__item is-catalog"><div><p class="history__title">${recordText(entry)}</p><p class="history__meta"><time datetime="${entry.at}">${formatDateTime(entry.at)}</time> · ${entry.actor ?? "System"}</p></div></li>`) : html`<li class="history__empty">Nothing recorded yet.</li>`}</ol></section>`;
    if (!person.account) {
      mount(host, html`<div class="person-sections"><p class="callout">${icon("info")}<span>Link ${person.name} to their sign-in (Profile) to see what they did in Logistics Hub.</span></p>${record}</div>`);
      return;
    }
    mount(host, html`<div class="person-sections person-sections--split"><section class="panel" aria-labelledby="own-title"><h2 class="panel__title" id="own-title">In Logistics Hub as ${person.account.username}</h2><ol class="history" data-events><li class="history__empty">Loading…</li></ol><div data-more></div>
      <p><a class="text-link" href="/staff/activity?actor=${person.account.id}" data-route>Open in Activity ${icon("arrow")}</a></p></section>${record}</div>`);
    const events: ActivityEvent[] = [];
    const more = async (cursor: string | null) => {
      try {
        const page = await api<{ events: ActivityEvent[]; nextCursor: string | null }>(`/api/staff/admin/directory/${person.id}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
        events.push(...page.events);
        mount(host.querySelector("[data-events]")!, events.length ? html`${events.map((event) => html`<li class="history__item"><div><p class="history__title">${event.summary}</p><p class="history__meta">${event.title} · ${event.at ? html`<time datetime="${event.at}">${formatDateTime(event.at)}</time>` : "time unknown"}</p></div></li>`)}` : html`<li class="history__empty">Nothing recorded under this sign-in yet.</li>`);
        mount(host.querySelector("[data-more]")!, page.nextCursor ? html`<button type="button" class="button button--secondary button--sm" data-next="${page.nextCursor}">Show older</button>` : html``);
      } catch (error) { mount(host.querySelector("[data-events]")!, html`<li class="history__empty">${failure(error)}</li>`); }
    };
    host.querySelector("[data-more]")!.addEventListener("click", (event) => {
      const next = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-next]");
      if (next) { next.disabled = true; void more(next.dataset.next!); }
    });
    await more(null);
  }

  /* ---------- Routing within the page ---------- */

  let shownPerson: string | null = null;
  async function render(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("person");
    // A person's scans stay in memory only while their own profile is open.
    if (id !== shownPerson) forgetScans();
    shownPerson = id;
    if (id) await profile(id, currentTab());
    else await list();
  }
  ownQuery(() => { void render(); });
  await render();
}

const FIELD_NAMES: Record<string, string> = { name: "full name", department: "department", position: "position", officer: "officer status", studentId: "student ID number", active: "status" };

/** One line of the directory record, in the words an administrator reads. */
function recordText(entry: Entry): string {
  const fields = Array.isArray(entry.details.fields) ? entry.details.fields.map((field) => FIELD_NAMES[String(field)] ?? "a field").join(", ") : "";
  const texts: Record<string, string> = {
    STAFF_PERSON_ADDED: "Added to the directory",
    STAFF_PROFILE_UPDATED: `Profile edited${fields ? `: ${fields}` : ""}`,
    STAFF_ACCOUNT_LINKED: `Linked to the sign-in ${String(entry.details.username ?? "")}`,
    STAFF_ACCOUNT_UNLINKED: `Unlinked from the sign-in ${String(entry.details.username ?? "")}`,
    STAFF_ID_IMPORTED: "ID scans imported from the archive",
    STAFF_ID_ADDED: "ID scans added",
    STAFF_ID_REPLACED: "ID scans replaced",
    STAFF_ID_REMOVED: "ID scans removed",
    STAFF_ID_VIEWED: "USC ID opened"
  };
  return texts[entry.action] ?? entry.action;
}
