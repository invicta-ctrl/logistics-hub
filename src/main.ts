import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import "./styles.css";
import { landing, lending, notFound, offlinePage } from "./public";
import { startPwa } from "./pwa";
import { handOverQuery, leave, navigate, toast } from "./ui";

type View = () => void | Promise<void>;

/**
 * Public pages ship in the main bundle. Everything else loads on first use, so a phone that
 * scans the QR code downloads only the self-service screens and never the staff workspace.
 */
const ROUTES: Record<string, () => View | Promise<View>> = {
  "/": () => landing,
  "/lending": () => lending,
  "/self-service": () => import("./self-service-app").then((module) => module.selfService),
  "/staff": () => import("./staff").then((module) => module.staffLogin),
  "/staff/inventory": () => import("./staff").then((module) => module.workspace),
  "/staff/stock": () => import("./stock-workspace").then((module) => module.stockWorkspace),
  "/staff/loans": () => import("./loans-workspace").then((module) => module.loansWorkspace),
  "/staff/self-service": () => import("./self-service-review").then((module) => module.selfServiceReview),
  "/staff/activity": () => import("./activity-workspace").then((module) => module.activityWorkspace),
  "/staff/admin": () => import("./admin").then((module) => module.administration),
  "/staff/account": () => import("./admin").then((module) => module.myAccount)
};

let navigation = 0;
// A fresh page load already starts at the top, so only in-app navigation moves focus to the page body. It never does inside a
// frame (Administration's Self-Service test panel): that would pull focus out of the page around it.
let loaded = false;

async function render(): Promise<void> {
  const current = ++navigation;
  const moveFocus = loaded && window.self === window.top;
  loaded = true;
  rendered = window.location.pathname + window.location.search;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/staff/") && !ROUTES[path]) return navigate("/staff/inventory", true);
  let view: View;
  try {
    view = await (ROUTES[path] ?? (() => notFound))();
  } catch {
    if (navigator.onLine) {
      // A deploy replaced the files this page was built with: load the new version once.
      if (!sessionStorage.getItem("reloaded-for-update")) {
        sessionStorage.setItem("reloaded-for-update", "1");
        window.location.reload();
      }
      return;
    }
    view = offlinePage;
  }
  sessionStorage.removeItem("reloaded-for-update");
  // A quicker, later navigation already rendered; this one is stale.
  if (current !== navigation) return;
  leave();
  void view();
  window.scrollTo(0, 0);
  if (!moveFocus) return;
  window.requestAnimationFrame(() => {
    const main = document.querySelector<HTMLElement>("#main-content");
    main?.setAttribute("tabindex", "-1");
    main?.focus({ preventScroll: true });
  });
}

// One delegated listener turns same-origin data-route links into client-side navigation.
document.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-route]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target) return;
  event.preventDefault();
  if (link.pathname !== window.location.pathname || link.search !== window.location.search) navigate(link.pathname + link.search);
});

// "/" jumps to the page's search field, as in most catalog and admin tools.
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("dialog[open]")) return;
  const search = document.querySelector<HTMLInputElement>("[data-search]");
  if (!search) return;
  event.preventDefault();
  search.focus();
  search.select();
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  toast("Something went wrong. Please try again.", "error");
});

// A same-page #fragment jump also fires popstate; only a new path or query is a new view.
let rendered = "";
window.addEventListener("popstate", () => {
  if (window.location.pathname + window.location.search === rendered) return;
  if (window.location.pathname === new URL(rendered, window.location.href).pathname && handOverQuery()) {
    rendered = window.location.pathname + window.location.search;
    return;
  }
  render();
});
startPwa();
void render();
