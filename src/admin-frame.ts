import { type Session, loadSession, shell } from "./staff";
import { type Html, html, mount, navigate, sheet as createSheet, sheetContent } from "./ui";

/*
 * What every Administration page shares (V1.13): who may open it, the five sections and the confirmation that says what a
 * consequential change will do before it is made. The Staff Directory is part of the Staff section and keeps its own page.
 */

export type AdminSection = "system" | "self-service" | "catalog" | "staff" | "accountability";

// System comes first because it is what an owner checks most often; it is also the page /staff/admin opens.
const SECTIONS: ReadonlyArray<{ id: AdminSection; href: string; text: string }> = [
  { id: "system", href: "/staff/admin", text: "System" },
  { id: "self-service", href: "/staff/admin/self-service", text: "Self-Service" },
  { id: "catalog", href: "/staff/admin/catalog", text: "Catalog" },
  { id: "staff", href: "/staff/admin/staff", text: "Staff" },
  { id: "accountability", href: "/staff/admin/accountability", text: "Accountability" }
];

/** `exact` is false on a page inside a section (the Staff Directory is in Staff), which then reads as the current section, not the current page. */
export function adminTabs(current: AdminSection, exact = true): Html {
  return html`<nav class="subnav" aria-label="Administration">${SECTIONS.map((entry) => html`<a class="subnav__link" href="${entry.href}" data-route ${entry.id === current ? html`aria-current="${exact ? "page" : "true"}"` : ""}>${entry.text}</a>`)}</nav>`;
}

/** The signed-in administrator or owner; anyone else is sent where they belong (the Worker refuses them as well). */
export async function loadAdmin(): Promise<Session | null> {
  const session = await loadSession("admin");
  if (!session) return null;
  if (session.role === "STAFF") { navigate("/staff/items", true); return null; }
  return session;
}

/** The page every section shares: the Administration heading, what this section is for, the section links, then the section. */
export async function adminPage(section: AdminSection, page: { title: string; lede: string | ((session: Session) => string); actions?: Html; body: (session: Session) => Html }): Promise<Session | null> {
  const session = await loadAdmin();
  if (!session) return null;
  document.title = `${page.title} · Administration`;
  shell(session, "admin", html`
    <header class="page-header">
      <div><h1>Administration</h1><p>${typeof page.lede === "function" ? page.lede(session) : page.lede}</p></div>
      ${page.actions ? html`<div class="page-header__actions">${page.actions}</div>` : ""}
    </header>
    ${adminTabs(section)}
    ${page.body(session)}`);
  return session;
}

/**
 * Says what a change will do and asks for a decision, in a sheet like the rest of the workspace. Resolves true only on the
 * confirm button; Escape, the backdrop, Cancel and Close all resolve false. `impact` is what changes for whom, in plain words.
 */
export function confirmImpact(options: { kicker: string; title: string; impact: Html; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "sheet";
    dialog.setAttribute("aria-labelledby", "confirm-title");
    document.body.append(dialog);
    mount(dialog, sheetContent(options.kicker, options.title, html`<div class="impact">${options.impact}</div>
      <div class="form-actions"><button class="button button--secondary" type="button" data-close>Cancel</button>
      <button class="button ${options.danger ? "button--danger" : "button--primary"}" type="button" data-confirm>${options.confirm}</button></div>`));
    // The manage sheet may be open underneath with its own heading id.
    dialog.querySelector("h2")!.id = "confirm-title";
    let confirmed = false;
    const panel = createSheet(dialog);
    dialog.addEventListener("close", () => { dialog.remove(); resolve(confirmed); });
    dialog.querySelector("[data-confirm]")!.addEventListener("click", () => { confirmed = true; panel.close(true); });
    panel.open();
    dialog.querySelector<HTMLElement>("[data-close]:not(.icon-button)")!.focus();
  });
}
