import { ACCESS_HINT, type AccountEvent, accessChoices, accessTag, bindCopy, eventText, oneTime } from "./account-ui";
import { DEPARTMENTS, DEPARTMENT_CODES, type DepartmentCode } from "./directory-policy";
import { type Loan, loanRow, openReturn } from "./loan-form";
import { tiltTile } from "./card-motion";
import { type Card, type View, cardForm, cardSource, forgetScans, importArchive, makeMissingImages, openCard, scan } from "./staff-ids";
import { type Access, type Role, type Session, accessLabel, initials, loadSession, shell } from "./staff";
import { adminTabs } from "./admin-frame";
import { type Html, api, categoryName, emptyState, failure, formatDate, formatDateTime, formatTime, html, icon, label, mount, navigate, officeDay, onLeave, ownQuery, plural, setMessage, sheet as createSheet, sheetContent, toast, units, writeParams } from "./ui";

/*
 * Administration → Staff Directory (V1.3). One page: the directory as a wall of cards by department, and a person's profile in
 * the same place (?person=…&tab=…) with five sections, Profile | USC ID | Usage | Loans | Activity. Pressing a card lifts it
 * out in 3D and turns it over to the person's details; it turns on to both sides of their official ID (Earl, 2026-10-03: the
 * card is what you press to see everything). The cards on the wall are drawn from the directory record, never from a scan:
 * private to administrators and owners (the Worker refuses everyone else), ID images load only when a side is turned to or
 * the USC ID section is opened, and each opening is recorded. Only the owner changes ID scans.
 */

type Person = {
  id: string; name: string; department: string; position: string | null; officer: boolean; studentId: string | null; active: boolean; sourceKey: string | null;
  createdAt: string; updatedAt: string; hasId: boolean; account: { id: string; username: string; displayName: string; role: Role; access: Access; active: boolean; lastLoginAt: string | null } | null;
};
type SignIn = { at: string; until: string; state: "OPEN" | "ENDED" | "EXPIRED" };
type AccessInfo = { account: null; suggestedUsername: string } | {
  account: { id: string; username: string; displayName: string; role: Role; access: Access; active: boolean; mustChangePassword: boolean; createdAt: string; lastLoginAt: string | null; openSessions: number; failedAttempts?: number };
  signIns: SignIn[] | null; events: AccountEvent[] | null; self: boolean; manageable: boolean;
};
type Entry = { at: string; action: string; actor: string | null; details: Record<string, unknown> };
type Detail = { person: Person; card: Card | null; history: Entry[] };
type Usage = { id: string; at: string; itemId: string; itemName: string; category: string; stockArea: string; unit: string; quantity: number; kind: "LOAN" | "TAKE"; purpose: string | null; phone: number; matchedBy: "STUDENT_ID" | "NAME" };
type ActivityEvent = { id: string; at: string | null; title: string; summary: string };
type Linkable = { id: string; username: string; displayName: string; role: Role; access: Access; active: boolean; personId: string | null; personName: string | null };
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
const fold = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Whether their loans and phone records can be found: by student ID number, or by a full name (never a single name). */
const matchable = (person: Pick<Person, "name" | "studentId">) => Boolean(person.studentId) || person.name.includes(" ");
/** First and last name's initials, as on a badge: "Ana Marie Santos" is AS. */
const cardInitials = (name: string) => { const words = name.split(/\s+/).filter(Boolean); return words.length > 1 ? `${words[0]![0]}${words.at(-1)![0]}`.toUpperCase() : initials(name); };
const toElement = (markup: Html): HTMLElement => { const host = document.createElement("div"); mount(host, markup); return host.firstElementChild as HTMLElement; };
const picture = (person: Pick<Person, "id">, kind: "thumb" | "face") => `/api/staff/admin/directory/${person.id}/id/${kind}`;
// A card imported before thumbnails were made has none yet: its picture is dropped and the drawn card or the initials show.
document.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.matches("img[data-thumb], img[data-face-pic]")) image.remove();
}, true);
/** Initials where the photo goes, under the person's photo from their ID when there is one. */
const photo = (person: Person, withPicture = true) => html`<span class="person-card__photo" aria-hidden="true">${cardInitials(person.name)}${person.hasId && withPicture ? html`<img src="${picture(person, "face")}" alt="" data-face-pic decoding="async" />` : ""}</span>`;

/** What the wall shows for a person: the front of their uploaded USC ID, or, without one, the card drawn from their record. */
function wallFace(person: Person): Html {
  return html`<span class="dir-face">${cover(person)}${person.hasId ? html`<img class="dir-face__scan" src="${picture(person, "thumb")}" alt="" loading="lazy" decoding="async" data-thumb />` : ""}</span>`;
}

/**
 * A person's card, as the wall shows it: their department's colour, initials where an ID photo would be, name, position and
 * department, and what is worth seeing at a glance. Officers' cards carry the foil. Drawn from the record only, never a scan.
 */
function cover(person: Person): Html {
  return html`<span class="person-card person-card--cover dept-${person.department} ${person.officer ? "is-officer" : ""} ${person.active ? "" : "is-inactive"}">
    <span class="person-card__band"><span class="person-card__org">University Student Council</span><span class="person-card__code">${person.department}</span></span>
    ${photo(person, false)}
    <span class="person-card__body"><span class="person-card__name">${person.name}</span>
      <span class="person-card__role">${person.position ?? "No position yet"}</span>
      <span class="person-card__dept">${departmentName(person.department)}</span></span>
    <span class="person-card__foot">${person.officer ? html`<span class="person-card__badge">Officer</span>` : ""}${person.hasId ? html`<span class="person-card__mark">${icon("shield")}<span>ID on file</span></span>` : ""}${person.account ? html`<span class="person-card__mark">${icon("user")}<span class="visually-hidden">Signs in as </span><span>${person.account.username}</span></span>` : ""}${person.active ? "" : html`<span class="person-card__mark person-card__mark--bad">Inactive</span>`}</span>
  </span>`;
}

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
      ${adminTabs("staff", false)}
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
        <div class="dir-results"><div data-derive></div><p class="dir-summary" role="status" data-summary></p><div data-results>${people ? "" : html`<ul class="card-wall" aria-hidden="true">${Array.from({ length: 8 }, () => html`<li><span class="skeleton dir-card__skeleton"></span></li>`)}</ul>`}</div></div>
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
        : html`<div class="dept-groups">${groups.map(([code, members]) => html`<section class="dept-group" aria-labelledby="dept-${code}">
            <h2 class="dept-group__title" id="dept-${code}"><span class="dept-dot dept-${code}" aria-hidden="true"></span><span>${DEPARTMENTS[code]}</span><span class="dept-group__meta">${members.length === 1 ? "1 person" : `${members.length} people`}</span></h2>
            <ul class="card-wall">${members.map(personCard)}</ul></section>`)}
          ${unknown.length ? html`<section class="dept-group"><h2 class="dept-group__title">Other</h2><ul class="card-wall">${unknown.map(personCard)}</ul></section>` : ""}</div>`);
      root.querySelectorAll<HTMLElement>(".dir-card").forEach(tiltTile);
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
    if (owner) void offerPictures(root.querySelector<HTMLElement>("[data-derive]")!, draw);
  }

  /**
   * Cards imported before the wall showed ID fronts have no thumbnail or profile picture yet. The owner makes them once,
   * here: each of those cards is opened once (recorded in Activity, as any opening) and the two small pictures are stored.
   */
  async function offerPictures(host: HTMLElement, redraw: () => void): Promise<void> {
    let missing: Array<{ id: string; mediaId: string }>;
    try { ({ missing } = await api<{ missing: Array<{ id: string; mediaId: string }> }>("/api/staff/admin/directory/derived")); } catch { return; }
    if (!missing.length || !host.isConnected) return;
    mount(host, html`<div class="callout callout--action">${icon("info")}<span data-derive-text>${missing.length === 1 ? "1 USC ID needs" : `${missing.length} USC IDs need`} its wall picture and profile picture. Make them once: each card is opened once, and that is recorded in Activity.</span>
      <button type="button" class="button button--primary button--sm" data-make>Make them now</button></div>`);
    host.querySelector("[data-make]")!.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const text = host.querySelector<HTMLElement>("[data-derive-text]")!;
      button.disabled = true;
      try {
        await makeMissingImages(missing, (done) => { text.textContent = `Making pictures… ${done} of ${missing.length}`; });
        mount(host, html``);
        toast(`${plural(missing.length, "card")} now show on the wall with a profile picture.`);
        redraw();
      } catch (error) {
        text.textContent = `${failure(error)} Pictures made so far are kept.`;
        button.disabled = false;
        button.textContent = "Continue";
        void api<{ missing: Array<{ id: string; mediaId: string }> }>("/api/staff/admin/directory/derived").then((result) => { missing = result.missing; }, () => undefined);
        redraw();
      }
    });
  }

  /**
   * One person on the wall: their card, a link to their profile. A plain press opens the card instead; a press with a modifier
   * key (a new tab or window) still follows the link.
   */
  function personCard(person: Person): Html {
    return html`<li><a class="dir-card" href="${DIRECTORY}?person=${person.id}" data-route data-person="${person.id}" data-shows="cover" aria-haspopup="dialog">${wallFace(person)}</a></li>`;
  }

  /** The reverse of a person's card: everything worth knowing at once, what they have out now, and the way into each section. */
  function cardDetails(person: Person): HTMLElement {
    const fact = (term: string, value: Html | string) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`;
    const to = (tab: Tab) => `${DIRECTORY}?person=${person.id}${tab === "profile" ? "" : `&tab=${tab}`}`;
    const details = toElement(html`<div class="person-card person-card--details dept-${person.department} ${person.active ? "" : "is-inactive"}">
      <div class="person-card__band"><span class="person-card__org">University Student Council</span><span class="person-card__code">${person.department}</span></div>
      ${photo(person)}
      <div class="person-card__head"><h2 class="person-card__name">${person.name}</h2><p class="person-card__role">${person.position ?? "No position yet"}</p><p class="person-card__dept">${departmentName(person.department)}</p>
        ${person.officer ? html`<span class="person-card__badge">Officer</span>` : ""}</div>
      <dl class="person-card__facts">
        ${fact("Student no.", person.studentId ? html`<span class="mono">${person.studentId}</span>` : html`<span class="muted">Not set</span>`)}
        ${fact("Sign-in", person.account ? html`<span class="mono">${person.account.username}</span> · ${accessLabel(person.account.access)}<br />${!person.account.active ? html`<span class="person-card__mark person-card__mark--bad">Disabled</span>` : person.account.lastLoginAt ? html`<span class="muted">Last in ${formatDateTime(person.account.lastLoginAt)}</span>` : html`<span class="muted">Never signed in</span>`}` : html`<span class="muted">Not linked</span>`)}
        ${fact("USC ID", person.hasId ? "On file: see Profile" : html`<span class="muted">Not on file</span>`)}
        ${fact("Status", person.active ? "Active" : html`<span class="person-card__mark person-card__mark--bad">Inactive</span>`)}
      </dl>
      <section class="person-card__out" aria-label="On loan now"><h3>On loan now</h3><div data-out><span class="muted">Checking…</span></div></section>
      <nav class="person-card__links" aria-label="${person.name}'s profile">${TABS.filter(([key]) => key !== "id").map(([key, text]) => html`<a href="${to(key)}" data-leave>${key === "profile" ? "Full profile" : text}</a>`)}</nav>
    </div>`);
    const out = details.querySelector<HTMLElement>("[data-out]")!;
    void api<{ loans: Loan[] }>(`/api/staff/admin/directory/${person.id}/loans`).then(({ loans }) => {
      const now = loans.filter((loan) => loan.status === "OUT");
      mount(out, now.length ? html`<ul>${now.slice(0, 3).map((loan) => html`<li><span>${loan.quantity} × ${loan.itemName}</span>${loan.returnBy ? html`<span class="muted">due ${formatDate(loan.returnBy)}</span>` : ""}</li>`)}</ul>${now.length > 3 ? html`<p class="muted">and ${now.length - 3} more · <a href="${to("loans")}" data-leave>Loans</a></p>` : ""}`
        : html`<span class="muted">${matchable(person) ? "Nothing out now." : "Add a full name or student ID number to find their loans."}</span>`);
    }, () => mount(out, html`<span class="muted">Loans could not be checked.</span>`));
    return details;
  }

  /** Opens a person's card large. Its scans are fetched only if a side is turned to, unless the section already holds them. */
  function openPersonCard(person: Person, start: View, tileFor: (view: View) => HTMLElement | null, card?: Card | null): void {
    void openCard(person, {
      start, hasId: person.hasId, tileFor, details: cardDetails(person), cover: () => toElement(wallFace(person)),
      card: card !== undefined ? card : () => api<Detail>(`/api/staff/admin/directory/${person.id}`).then((detail) => detail.card)
    });
  }

  // Bound once: a plain press on a card on the wall opens it.
  root.addEventListener("click", (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.dir-card[data-person]");
    if (!tile || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const person = people?.find((entry) => entry.id === tile.dataset.person);
    if (!person) return;
    event.preventDefault();
    openPersonCard(person, person.hasId ? "profile" : "details", () => tile.isConnected ? tile : root.querySelector<HTMLElement>(`a.dir-card[data-person="${person.id}"]`));
  });

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
    try { detail = await api<Detail>(`/api/staff/admin/directory/${encodeURIComponent(id)}`); } catch (error) {
      mount(root.querySelector("[data-profile]")!, emptyState("This profile could not be opened", failure(error), html`<a class="button button--secondary" href="${DIRECTORY}" data-route>Back to the directory</a>`, "error", 1));
      return;
    }
    const { person } = detail;
    document.title = `${person.name} · Staff Directory`;
    const reload = async () => { people = null; await profile(id, currentTab()); };
    mount(root.querySelector("[data-profile]")!, html`
      <header class="person-head">
        <button type="button" class="dir-card dir-card--head" data-head data-shows="cover" aria-haspopup="dialog" aria-label="Open ${person.name}'s card">${wallFace(person)}</button>
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
    // Their card is right here: pressed, it opens on their USC ID when one is on file.
    const head = root.querySelector<HTMLElement>("[data-head]")!;
    tiltTile(head);
    head.addEventListener("click", () => openPersonCard(person, person.hasId ? "profile" : "details", () => head, detail.card));

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
      <section class="panel" aria-labelledby="link-title"><h2 class="panel__title" id="link-title">Sign-in and access</h2><div data-access></div></section>
      ${!person.active && card && owner ? html`<p class="callout">${icon("info")}<span>${person.name} is inactive and their ID scans are still on file. Remove them in USC ID once they are no longer needed.</span></p>` : ""}
    </div>`);
    host.querySelector("[data-edit-here]")!.addEventListener("click", () => openEditor(person, reload));
    void accessSection(host.querySelector<HTMLElement>("[data-access]")!, person, reload);
  }

  /**
   * The person's sign-in. Without one: make one in a step (their name, a suggested username, a generated password shown once,
   * linked at once), or link one they already have. With one: how it is used (state, last sign-in, devices signed in now,
   * failed attempts, recent sign-ins and changes) and, for an account this administrator manages, reset, sign out and disable.
   */
  async function accessSection(host: HTMLElement, person: Person, reload: () => Promise<void>): Promise<void> {
    mount(host, html`<p class="muted">Loading…</p>`);
    let access: AccessInfo;
    try { access = await api<AccessInfo>(`/api/staff/admin/directory/${person.id}/access`); } catch (error) { mount(host, html`<p class="form-alert" role="alert">${icon("alert")}<span>${failure(error)}</span></p>`); return; }
    bindCopy(host);
    if (!access.account) { createSection(host, person, access.suggestedUsername, reload); return; }
    const { account, signIns, events, manageable, self } = access;
    const mayUnlink = owner || account.role === "STAFF" || self;
    const ended = (entry: SignIn) => entry.state === "OPEN" ? html`signed in now, until ${formatTime(entry.until)}` : entry.state === "EXPIRED" ? html`expired ${formatDateTime(entry.until)}` : html`ended ${formatDateTime(entry.until)} (signed out, or ended by a password reset or sign-out everywhere)`;
    mount(host, html`<p class="link-card">${icon("user")}<span><strong>${account.displayName}</strong> <span class="mono">${account.username}</span></span>${accessTag(account.access)}</p>
      <p class="tags">${account.active ? html`<span class="tag tag--ok">Can sign in</span>` : html`<span class="tag tag--bad">Disabled</span>`}${account.mustChangePassword ? html`<span class="tag tag--warn">Must set a password</span>` : ""}</p>
      <dl class="access-facts">
        <div><dt>Last sign-in</dt><dd>${account.lastLoginAt ? html`<time datetime="${account.lastLoginAt}">${formatDateTime(account.lastLoginAt)}</time>` : html`<span class="muted">Never</span>`}</dd></div>
        <div><dt>Signed in now</dt><dd>${account.openSessions ? (account.openSessions === 1 ? "On 1 device" : `On ${account.openSessions} devices`) : html`<span class="muted">Nowhere</span>`}</dd></div>
        ${account.failedAttempts !== undefined ? html`<div><dt>Failed sign-ins, last 15 min</dt><dd>${account.failedAttempts ? html`<span class="tag tag--warn">${account.failedAttempts}</span>` : html`<span class="muted">None</span>`}</dd></div>` : ""}
      </dl>
      ${account.failedAttempts && account.failedAttempts >= 3 ? html`<p class="callout">${icon("alert")}<span>${plural(account.failedAttempts, "failed sign-in")} in the last 15 minutes. If that was not ${person.name}, reset the password.</span></p>` : ""}
      ${account.mustChangePassword && !account.lastLoginAt ? html`<p class="field__hint">Waiting for the first sign-in: give them the username and the temporary password privately. They choose their own password then.</p>` : ""}
      ${signIns ? html`<h3 class="section-label">Recent sign-ins</h3>${signIns.length ? html`<ol class="access-log">${signIns.map((entry) => html`<li><time datetime="${entry.at}">${formatDateTime(entry.at)}</time> <span class="${entry.state === "OPEN" ? "access-log__open" : "muted"}">${ended(entry)}</span></li>`)}</ol>` : html`<p class="muted">No sign-ins in the last month.</p>`}` : ""}
      ${events?.length ? html`<h3 class="section-label">Changes to this sign-in</h3><ol class="access-log">${events.map((event) => html`<li>${eventText(event)}<time datetime="${event.at}">${formatDateTime(event.at)}</time></li>`)}</ol>` : ""}
      <div class="form-alert" role="alert" hidden data-alert></div><div data-secret></div>
      <div class="form-actions form-actions--start">
        ${manageable ? html`<button class="button button--secondary button--sm" type="button" data-reset>Reset password</button>
          <button class="button button--secondary button--sm" type="button" data-signout ${account.openSessions ? "" : html`disabled`}>Sign out everywhere</button>
          <button class="button ${account.active ? "button--danger" : "button--primary"} button--sm" type="button" data-active>${account.active ? "Disable sign-in" : "Enable sign-in"}</button>` : ""}
        ${self ? html`<a class="button button--secondary button--sm" href="/staff/account" data-route>My account</a>` : ""}
        ${mayUnlink ? html`<button class="button button--ghost button--sm" type="button" data-unlink>Unlink</button>` : ""}
      </div>
      ${!manageable && !self ? html`<p class="field__hint">Only an owner manages an administrator's or owner's sign-in.</p>` : ""}`);
    const alert = host.querySelector<HTMLElement>("[data-alert]")!;
    const act = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { setMessage(alert, failure(error)); } };
    const accountPath = `/api/staff/admin/accounts/${encodeURIComponent(account.id)}`;
    host.querySelector("[data-reset]")?.addEventListener("click", () => act(async () => {
      if (!window.confirm(`Reset ${account.username}'s password? The current one stops working and they are signed out everywhere.`)) return;
      const { generatedPassword } = await api<{ generatedPassword: string }>(`${accountPath}/password`, { method: "POST", body: JSON.stringify({ generate: true }) });
      mount(host.querySelector("[data-secret]")!, oneTime(`New temporary password for ${account.username}`, generatedPassword, "Shown once and never stored. Give it to them privately; they choose their own at next sign-in."));
      toast(`Password reset for ${account.username}.`);
    }));
    host.querySelector("[data-signout]")?.addEventListener("click", () => act(async () => {
      if (!window.confirm(`Sign ${account.username} out on every device?`)) return;
      await api(`${accountPath}/sessions/revoke`, { method: "POST" });
      toast(`${account.username} was signed out everywhere.`);
      await accessSection(host, person, reload);
    }));
    host.querySelector("[data-active]")?.addEventListener("click", () => act(async () => {
      if (account.active && !window.confirm(`Disable ${account.username}? They are signed out and cannot sign in until it is enabled again.`)) return;
      await api(accountPath, { method: "PATCH", body: JSON.stringify({ active: !account.active }) });
      toast(`${account.username} ${account.active ? "disabled" : "enabled"}.`);
      await reload();
    }));
    host.querySelector("[data-unlink]")?.addEventListener("click", () => act(async () => {
      if (!window.confirm(`Unlink ${person.name} from the sign-in ${account.username}? The sign-in itself stays.`)) return;
      await api(`/api/staff/admin/directory/${person.id}/account`, { method: "DELETE" });
      toast("Unlinked.");
      await reload();
    }));
  }

  /** No sign-in yet: one made for them in a step, or one they already have, linked by hand. */
  function createSection(host: HTMLElement, person: Person, suggested: string, reload: () => Promise<void>): void {
    // The role follows their department by default: their department's staff, or Officer for an officer outside Logistics.
    const choices = accessChoices(session!);
    const byDepartment: Access = person.department === "DoL" ? "DoL" : person.officer ? "OFFICER" : choices.includes(person.department as Access) ? person.department as Access : "OFFICER";
    mount(host, html`<form class="form" data-create novalidate>
        <p class="field__hint">${person.name} has no sign-in yet. Make one here: it is linked to this profile at once.</p>
        <div class="field-grid">
          <div class="field"><label for="new-username">Username</label><input id="new-username" name="username" value="${suggested}" required maxlength="64" autocapitalize="none" spellcheck="false" autocomplete="off" aria-describedby="new-username-hint" />
            <p class="field__hint" id="new-username-hint">What they type to sign in.</p></div>
          <div class="field"><label for="new-role">Role</label><select id="new-role" name="access" aria-describedby="new-role-hint">${choices.map((access) => html`<option value="${access}" ${access === byDepartment ? html`selected` : ""}>${accessLabel(access)}</option>`)}</select></div>
        </div>
        <p class="field__hint" id="new-role-hint">${ACCESS_HINT} A password is made for them and shown once; they choose their own at first sign-in.</p>
        <div class="form-alert" role="alert" hidden data-alert></div>
        <div class="form-actions form-actions--start"><button class="button button--primary button--sm" type="submit">${icon("plus")}Create sign-in</button></div>
      </form>
      <div data-made></div>
      <details class="link-existing"><summary>Or link a sign-in they already have</summary><div data-link></div></details>`);
    const form = host.querySelector<HTMLFormElement>("[data-create]")!;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const button = form.querySelector<HTMLButtonElement>("[type=submit]")!;
      button.disabled = true;
      try {
        const made = await api<{ username: string; generatedPassword: string }>(`/api/staff/admin/directory/${person.id}/account/new`, { method: "POST", body: JSON.stringify({ username: values.get("username"), access: values.get("access") }) });
        form.hidden = true;
        host.querySelector<HTMLElement>(".link-existing")!.hidden = true;
        mount(host.querySelector("[data-made]")!, html`${oneTime(`Sign-in for ${person.name}: ${made.username}`, made.generatedPassword, "Shown once and never stored. Give the username and this password to them privately; they choose their own password at first sign-in.")}
          <div class="form-actions form-actions--start"><button type="button" class="button button--secondary button--sm" data-done>Done</button></div>`);
        host.querySelector("[data-done]")!.addEventListener("click", () => void reload());
        toast(`Sign-in ${made.username} created for ${person.name}.`);
      } catch (error) { button.disabled = false; setMessage(form.querySelector("[data-alert]")!, failure(error)); }
    });
    host.querySelector(".link-existing")!.addEventListener("toggle", (event) => {
      if ((event.target as HTMLDetailsElement).open) void linkExisting(host.querySelector<HTMLElement>("[data-link]")!, person, reload);
    }, { once: true });
  }

  async function linkExisting(host: HTMLElement, person: Person, reload: () => Promise<void>): Promise<void> {
    mount(host, html`<p class="muted">Loading sign-ins…</p>`);
    let accounts: Linkable[];
    try { ({ accounts } = await api<{ accounts: Linkable[] }>("/api/staff/admin/directory/accounts")); } catch (error) { mount(host, html`<p class="form-alert" role="alert">${icon("alert")}<span>${failure(error)}</span></p>`); return; }
    const free = accounts.filter((account) => !account.personId && account.active);
    mount(host, html`<form class="link-form" novalidate>
      <p class="field__hint">Link only after confirming the sign-in belongs to ${person.name}; nothing is linked automatically.</p>
      ${free.length ? html`<div class="field"><label for="link-account">Sign-in</label><select id="link-account" name="accountId"><option value="">Choose a sign-in…</option>${free.map((account) => html`<option value="${account.id}">${account.displayName} (${account.username}) · ${accessLabel(account.access)}</option>`)}</select></div>
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
    const tile = (side: "front" | "back") => html`<figure class="id-tile"><button type="button" class="id-tile__button" data-open="${side}" data-shows="profile" aria-label="Open the ${side} of the USC ID large"><img alt="" data-scan="${side}" /></button><figcaption>${side === "front" ? "Front" : "Back"}</figcaption></figure>`;
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
    const tileOf = (side: "front" | "back") => host.querySelector<HTMLElement>(`[data-open="${side}"]`);
    for (const side of ["front", "back"] as const) {
      // Set through the CSSOM: the Content-Security-Policy (style-src 'self') drops inline style attributes.
      tileOf(side)!.style.setProperty("--ratio", String(card[side].width / card[side].height));
      tiltTile(tileOf(side)!);
      const image = host.querySelector<HTMLImageElement>(`[data-scan="${side}"]`)!;
      void scan(person.id, card.mediaId, side).then((url) => { image.src = url; }, (error: unknown) => { image.closest("figure")!.append(Object.assign(document.createElement("p"), { className: "form-alert", textContent: failure(error) })); });
    }
    host.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const open = target.closest<HTMLElement>("[data-open]");
      if (open) openPersonCard(person, "profile", (view) => view === "profile" ? open : root.querySelector<HTMLElement>("[data-head]"), card);
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
    // The id becomes an API path: anything but a directory id opens the list instead.
    const id = params.get("person")?.match(/^PER-[A-Za-z0-9-]+$/)?.[0] ?? null;
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
    STAFF_ID_VIEWED: "USC ID opened",
    STAFF_ID_DERIVED: "Thumbnail and profile picture made from the ID"
  };
  return texts[entry.action] ?? entry.action;
}
