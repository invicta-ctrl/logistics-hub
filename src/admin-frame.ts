import { type Session, loadSession, shell } from "./staff-shell";
import { SPRING, type Html, type IconName, failure, html, icon, mount, navigate, reducedMotion, setMessage, sheet as createSheet, sheetContent, working } from "./ui";

/*
 * What every Administration page shares (V1.13): who may open it, the five sections and the confirmation that says what a
 * consequential change will do before it is made. The Staff Directory is part of the Staff section and keeps its own page.
 *
 * V1.16.7 (workspace depth slice 3, its accepted direction): every section reads in the same four bands, each left out when it has
 * nothing to show: a verdict in words, what needs a decision (each with its one action as a button), the section's figures at a glance,
 * then its settings in titled groups (each setting one row: its name, its value, what it does, and a Change button). Every change and
 * decision opens one confirmation sheet, which closes only once the Worker has said yes.
 */

export type AdminSection = "system" | "self-service" | "catalog" | "staff" | "accountability";
export type Tone = "ok" | "warn" | "bad";

// System comes first because it is what an owner checks most often; it is also the page /staff/admin opens. On a phone each section is
// a cell of a fixed bar, an icon over one short word (`short`, shown beside the full name, which stays the link's name).
const SECTIONS: ReadonlyArray<{ id: AdminSection; href: string; text: string; short?: string; icon: IconName }> = [
  { id: "system", href: "/staff/admin", text: "System", icon: "info" },
  { id: "self-service", href: "/staff/admin/self-service", text: "Self-Service", icon: "phone" },
  { id: "catalog", href: "/staff/admin/catalog", text: "Catalog", icon: "box" },
  { id: "staff", href: "/staff/admin/staff", text: "Staff", icon: "user" },
  { id: "accountability", href: "/staff/admin/accountability", text: "Accountability", short: "Records", icon: "history" }
];

/** `exact` is false on a page inside a section (the Staff Directory is in Staff), which then reads as the current section, not the current page. */
export function adminTabs(current: AdminSection, exact = true): Html {
  return html`<nav class="subnav admin-tabs" aria-label="Administration"><span class="admin-tabs__marker" aria-hidden="true"></span>${SECTIONS.map((entry) => html`<a class="subnav__link admin-tabs__link" href="${entry.href}" data-route ${entry.id === current ? html`aria-current="${exact ? "page" : "true"}"` : ""}>${icon(entry.icon)}${entry.short
    ? html`<span class="admin-tabs__short">${entry.short}</span><span class="admin-tabs__long">${entry.text}</span>`
    : html`<span>${entry.text}</span>`}</a>`)}</nav>`;
}

/** Where the bar's marker last stood, so the next section's marker slides from it rather than appearing (the page is drawn afresh). */
let lastMarker: { x: number; y: number; width: number; height: number } | null = null;


/** The bar whose size is watched: when it reflows (a resize, a font arriving, larger text) the marker follows at once, without sliding. */
let watched: HTMLElement | null = null;
// A bar taken off the page also reports a size; that is not a reflow, and must not cost the next section its slide.
const reflow = "ResizeObserver" in window ? new ResizeObserver((entries) => {
  if (!entries.some((entry) => entry.target.isConnected)) return;
  lastMarker = null;
  placeMarker();
}) : null;

/** Puts the bar's marker under (on a phone: behind) the current section, sliding from the last one when it moved. */
export function placeMarker(): void {
  const bar = document.querySelector<HTMLElement>(".admin-tabs");
  const marker = bar?.querySelector<HTMLElement>(".admin-tabs__marker");
  const link = bar?.querySelector<HTMLElement>(".admin-tabs__link[aria-current]");
  if (!bar || !marker) return;
  if (watched !== bar) {
    reflow?.disconnect();
    watched = bar;
    // Observing calls back once at once; the marker is placed below first, so that call only places it again, unanimated.
    reflow?.observe(bar);
  }
  if (!link) { marker.hidden = true; return; }
  marker.hidden = false;
  // Wrapped to a second row (large text on a phone), the bar scrolls with the page rather than hold a third of the screen.
  const tops = new Set([...bar.querySelectorAll<HTMLElement>(".admin-tabs__link")].map((cell) => cell.offsetTop));
  bar.classList.toggle("is-wrapped", tops.size > 1);
  const next = { x: link.offsetLeft, y: link.offsetTop, width: link.offsetWidth, height: link.offsetHeight };
  marker.style.width = `${next.width}px`;
  marker.style.height = `${next.height}px`;
  marker.style.transform = `translate(${next.x}px, ${next.y}px)`;
  const from = lastMarker;
  lastMarker = next;
  if (!from || reducedMotion() || (from.x === next.x && from.y === next.y)) return;
  marker.animate([
    { transform: `translate(${from.x}px, ${from.y}px) scaleX(${from.width / next.width})`, transformOrigin: "0 0" },
    { transform: `translate(${next.x}px, ${next.y}px)`, transformOrigin: "0 0" }
  ], { duration: 380, easing: SPRING });
}

/** The signed-in administrator or owner; anyone else is sent where they belong (the Worker refuses them as well). */
export async function loadAdmin(): Promise<Session | null> {
  const session = await loadSession("admin");
  if (!session) return null;
  if (session.role === "STAFF") { navigate("/staff/items", true); return null; }
  return session;
}

/** The section Administration last drew, so moving to another section animates its bands only, never the heading or the bar. */
let shownSection: AdminSection | null = null;

/** The page every section shares: the Administration heading, what this section is for, the section bar, then the section's bands. */
export async function adminPage(section: AdminSection, page: { title: string; lede: string | ((session: Session) => string); actions?: Html; body: (session: Session) => Html }): Promise<Session | null> {
  const session = await loadAdmin();
  if (!session) return null;
  document.title = `${page.title} · Administration`;
  const fromSection = document.querySelector(".admin-tabs") ? shownSection : null;
  shell(session, "admin", html`
    <header class="page-header">
      <div><h1>Administration</h1><p>${typeof page.lede === "function" ? page.lede(session) : page.lede}</p></div>
      ${page.actions ? html`<div class="page-header__actions">${page.actions}</div>` : ""}
    </header>
    ${adminTabs(section)}
    <div class="admin-bands">${page.body(session)}</div>`);
  shownSection = section;
  placeMarker();
  if (fromSection && fromSection !== section && !reducedMotion()) {
    document.querySelector<HTMLElement>(".admin-bands")?.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: SPRING });
  }
  return session;
}

/* ---------- The four bands ---------- */

const TONE_ICON: Record<Tone, IconName> = { ok: "check", warn: "alert", bad: "alert" };

/** Band 1: the section's state in words. Green when all is well, gold when something is waiting, red when something failed. */
export function verdict(tone: Tone, main: Html | string, detail: Html | string = "", id = ""): Html {
  return html`<div class="verdict verdict--${tone}" ${id ? html`id="${id}"` : ""} role="status">${icon(TONE_ICON[tone])}<div><p><strong>${main}</strong>${detail ? html` ${detail}` : ""}</p></div></div>`;
}

export type Decision = { what: Html | string; detail?: Html | string; action: Html };
/** Band 2: only what is waiting for someone, each with its one action as a button on the row's right. Nothing waiting: nothing drawn. */
export function decisions(rows: Decision[]): Html {
  if (!rows.length) return html``;
  return html`<section class="admin-band admin-band--decide" aria-labelledby="decide-title"><h2 class="band-title" id="decide-title">Needs a decision</h2>
    <ul class="decision-list">${rows.map((row) => html`<li class="decision-row"><div class="decision-row__main"><p class="decision-row__what">${row.what}</p>${row.detail ? html`<p class="decision-row__detail">${row.detail}</p>` : ""}</div><div class="decision-row__action">${row.action}</div></li>`)}</ul></section>`;
}

/** Band 4: a titled group of settings on a rule. `aside` sits beside the title (where its figures come from, when they were checked). */
export function settingsGroup(id: string, title: string, body: Html, aside: Html | string = ""): Html {
  return html`<section class="admin-block settings-group" aria-labelledby="${id}"><div class="admin-block__head"><h2 id="${id}" class="section-title">${title}</h2>${aside ? html`<p class="admin-source">${aside}</p>` : ""}</div>${body}</section>`;
}

export type Setting = { name: string; value: Html; does: Html | string; action?: Html; key?: string };
/** One setting: its name and what it does, its current value with the state's dot, and its one action (a Change button, never a bare link). */
export function settingRows(rows: Setting[]): Html {
  return html`<ul class="setting-list">${rows.map((row) => html`<li class="setting-row" ${row.key ? html`data-setting="${row.key}"` : ""}>
    <p class="setting-row__name">${row.name}</p>
    <p class="setting-row__value">${row.value}</p>
    <p class="setting-row__does">${row.does}</p>
    ${row.action ? html`<div class="setting-row__action">${row.action}</div>` : ""}</li>`)}</ul>`;
}

/** A state as its tag. `live` marks a state that was checked just now and holds: its dot breathes, slowly. */
export const stateTag = (tone: Tone, text: string, live = false): Html => html`<span class="tag tag--${tone} ${live ? "tag--live" : ""}">${text}</span>`;

/** The Change button of a setting row; its name says which setting it changes. */
export const changeButton = (setting: string, attributes: Html = html``): Html =>
  html`<button type="button" class="button button--secondary button--sm" ${attributes}>Change<span class="visually-hidden"> ${setting}</span></button>`;

/** After the Worker said yes and the section was drawn again: one short gold settle on the setting's new value. */
export function settle(key: string): void {
  const value = document.querySelector<HTMLElement>(`[data-setting="${key}"] .setting-row__value`);
  if (!value || reducedMotion()) return;
  value.animate([{ backgroundColor: "rgb(232 185 60 / 34%)", transform: "scale(1.04)" }, { backgroundColor: "rgb(232 185 60 / 0%)", transform: "none" }], { duration: 700, easing: SPRING });
}

/* ---------- One confirmation sheet ---------- */

export type Impact = {
  kicker: string;
  title: string;
  /** What the change does, in plain words. */
  impact?: Html;
  /** The setting's value now, and after the change: drawn as the one struck to the other. */
  now?: string;
  after?: string;
  /** Who the change reaches, one short line each. */
  affects?: string[];
  /** Whether and how it can be undone, in one sentence. */
  undo?: string;
  confirm: string;
  /** Red: the change removes or closes something. */
  danger?: boolean;
  /**
   * The change itself. With it, the confirm button shows that it is working and the sheet closes only when this resolves (the Worker
   * said yes); a refusal stays in the sheet with the Worker's reason, and Cancel still leaves.
   */
  run?: () => Promise<void>;
};

/**
 * Says what a change will do and asks for a decision, in a sheet like the rest of the workspace. Resolves true only once confirmed
 * (and, with `run`, once that succeeded); Escape, the backdrop, Cancel and Close all resolve false.
 */
export function confirmImpact(options: Impact): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "sheet sheet--confirm";
    dialog.setAttribute("aria-labelledby", "confirm-title");
    document.body.append(dialog);
    mount(dialog, sheetContent(options.kicker, options.title, html`<div class="impact">
        ${options.now && options.after ? html`<p class="impact-change"><span class="impact-change__label">Now</span><s class="impact-change__now">${options.now}</s>${icon("arrow")}<span class="impact-change__label">After</span><strong class="impact-change__after">${options.after}</strong></p>` : ""}
        ${options.impact ?? ""}
        ${options.affects?.length ? html`<div class="impact-who"><h3 class="impact-who__title">Who it affects</h3><ul>${options.affects.map((line) => html`<li>${line}</li>`)}</ul></div>` : ""}
        ${options.undo ? html`<p class="impact-undo">${icon(options.danger ? "alert" : "refresh")}<span>${options.undo}</span></p>` : ""}
      </div>
      <div class="form-alert" data-confirm-alert role="alert" hidden></div>
      <div class="form-actions"><button class="button button--secondary" type="button" data-close>Cancel</button>
      <button class="button ${options.danger ? "button--danger" : "button--primary"}" type="button" data-confirm>${options.confirm}</button></div>`));
    // The manage sheet may be open underneath with its own heading id.
    dialog.querySelector("h2")!.id = "confirm-title";
    let confirmed = false;
    const panel = createSheet(dialog);
    dialog.addEventListener("close", () => { dialog.remove(); resolve(confirmed); });
    const button = dialog.querySelector<HTMLButtonElement>("[data-confirm]")!;
    button.addEventListener("click", async () => {
      if (!options.run) { confirmed = true; panel.close(true); return; }
      const alert = dialog.querySelector<HTMLElement>("[data-confirm-alert]")!;
      setMessage(alert, "");
      const done = working(button);
      try {
        await options.run();
        confirmed = true;
        done();
        panel.close(true);
      } catch (error) {
        done();
        setMessage(alert, failure(error));
      }
    });
    panel.open();
    dialog.querySelector<HTMLElement>("[data-close]:not(.icon-button)")!.focus();
  });
}
