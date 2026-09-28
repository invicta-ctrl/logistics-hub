import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import "./styles.css";
import { landing, lending, notFound } from "./public";
import { administration, myAccount } from "./admin";
import { staffLogin, workspace } from "./staff";
import { leave, navigate, reducedMotion, toast } from "./ui";

function render(): void {
  leave();
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") landing();
  else if (path === "/lending") lending();
  else if (path === "/staff") staffLogin();
  else if (path === "/staff/inventory") void workspace();
  else if (path === "/staff/admin") void administration();
  else if (path === "/staff/account") void myAccount();
  else if (path.startsWith("/staff/")) navigate("/staff/inventory", true);
  else notFound();
  window.scrollTo(0, 0);
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

// Route changes cross-fade with the View Transitions API where supported; the
// first paint and reduced-motion users get an instant swap.
window.addEventListener("popstate", () => {
  if (!document.startViewTransition || reducedMotion()) return render();
  document.startViewTransition(render);
});
render();
