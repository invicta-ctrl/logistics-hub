import "./catalogue.css";
import type { Who } from "./catalogue-offline";
import { accessLabel, initials, sessionAccess, signOut } from "./staff";
import { type Html, MARK, app, html, icon, mount, onLeave } from "./ui";

/*
 * The Logistics Catalog's own frame (V1.6): its name, whether this device is online, and who is cataloguing.
 * It replaces the staff workspace's bar and sections on the Catalogue's screens, as Self-Service has its own: the Catalog is a separate
 * app with a separate page (staff/catalogue.html), and offline only cataloguing works anyway.
 */

type Signed = Exclude<Who, { mode: "closed" } | { mode: "signed-out" }>;

/** The light in the bar says only how this device is connected: what waits to send is counted where the work is (home, the capture bar). */
function pill(who: Signed): Html {
  const [tone, text] = who.mode === "offline" || !navigator.onLine ? ["offline", "Offline"] : who.mode === "lease" ? ["lease", "Signed out"] : ["ok", "Online"];
  return html`<span class="cg-pill cg-pill--${tone}"><span class="cg-pill__dot" aria-hidden="true"></span>${text}</span>`;
}

/** Mounts the Catalog's frame with `main` inside; `hero` is home's dark band under the bar. With no member (nobody may catalogue here), just the name. */
export function catalogueShell(who: Signed | null, main: Html, hero?: Html): void {
  document.body.classList.add("is-catalog");
  onLeave(() => document.body.classList.remove("is-catalog"));
  const bar = (end: Html, menu: Html = html``) => mount(app, html`
    <header class="cg-bar">
      <div class="cg-bar__inner">
        <a class="cg-bar__brand" href="/staff/catalogue" data-route aria-label="Catalog home"><span class="cg-bar__mark" aria-hidden="true">${MARK}</span><span class="cg-bar__title"><span>Catalog</span><small>HAU USC Logistics</small></span></a>
        <div class="cg-bar__end">${end}</div>
      </div>
    </header>
    ${menu}
    <main id="main-content">${hero ? html`<div class="cg-band"><div class="cg-hero">${hero}</div></div>` : ""}<div class="cg-main">${main}</div></main>`);
  if (!who) return bar(html``);
  const person = who.session;
  const avatar = html`<span class="cg-avatar" aria-hidden="true">${initials(person.displayName)}</span>`;
  const online = who.mode !== "offline";
  bar(html`<span data-cg-pill></span>
    <button class="cg-account" type="button" popovertarget="cg-menu">${avatar}<span class="visually-hidden">Account: ${person.displayName}</span></button>`, html`
    <div class="menu cg-menu" id="cg-menu" popover>
      <div class="menu__identity">${avatar}<p><strong>${person.displayName}</strong><span>${accessLabel(sessionAccess(person))} · <span class="mono">${person.username}</span></span></p></div>
      <ul class="menu__list">
        ${who.mode === "signed-in" ? html`<li><a class="menu__item" href="/staff/items" data-route>${icon("box")}Staff workspace</a></li>
          <li><button class="menu__item" type="button" data-cg-signout>${icon("signOut")}Sign out</button></li>`
        : online ? html`<li><a class="menu__item" href="/staff?next=%2Fstaff%2Fcatalogue" data-route>${icon("user")}Sign in</a></li>`
        : html`<li class="cg-menu__note">${icon("cloudOff")}<span>The staff workspace and signing in need a connection.</span></li>`}
      </ul>
    </div>`);

  const host = document.querySelector<HTMLElement>("[data-cg-pill]")!;
  const refresh = () => mount(host, pill(who));
  refresh();
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  onLeave(() => { window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); });

  const menu = document.querySelector<HTMLElement>("#cg-menu")!;
  const opener = document.querySelector<HTMLElement>(".cg-account")!;
  opener.setAttribute("aria-expanded", "false");
  menu.addEventListener("toggle", (event) => opener.setAttribute("aria-expanded", String((event as ToggleEvent).newState === "open")));
  // Without the Popover API (iOS before 17) the button simply shows and hides the menu.
  if (!("showPopover" in HTMLElement.prototype)) {
    menu.hidden = true;
    opener.addEventListener("click", () => { menu.hidden = !menu.hidden; opener.setAttribute("aria-expanded", String(!menu.hidden)); });
  }
  menu.querySelector("[data-cg-signout]")?.addEventListener("click", () => void signOut());
}
