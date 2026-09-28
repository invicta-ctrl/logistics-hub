import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import "./styles.css";
import { landing, lending, notFound } from "./public";
import { staffLogin, workspace } from "./staff";
import { leave, navigate } from "./ui";

function render(): void {
  leave();
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") landing();
  else if (path === "/lending") lending();
  else if (path === "/staff") staffLogin();
  else if (path === "/staff/inventory") void workspace();
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
  if (link.pathname !== window.location.pathname) navigate(link.pathname);
});
window.addEventListener("popstate", render);
render();
