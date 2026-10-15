import { reducedMotion } from "./ui";

/*
 * The Staff theme (HAU-UI-MEDIA-THEME-001). Light is the default; a person may choose Dark or System, and the choice stays on this device only
 * (no request, no audit, no account setting). It applies to Staff routes alone: `data-theme="dark"` on <html> is set on /staff and removed on every
 * other route, so the public pages and Self-Service (which has its own theme, src/self-service-app.ts) never see it. public/theme-boot.js applies
 * the saved choice before first paint; keep the two in step.
 */

export type Preference = "light" | "dark" | "system";
const KEY = "hub-theme";
const THEME_COLOR = { light: "#2b0a0c", dark: "#140609" } as const;

export const inStaff = (path: string): boolean => path === "/staff" || path.startsWith("/staff/");

/** This visit's choice, for when the device will not keep one (private windows, blocked storage). */
let visit: Preference | null = null;

export function preference(): Preference {
  if (visit) return visit;
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "dark" || saved === "system" ? saved : "light";
  } catch { return "light"; }
}

const systemDark = (): boolean => window.matchMedia("(prefers-color-scheme: dark)").matches;
const resolved = (choice: Preference): "light" | "dark" => choice === "dark" || (choice === "system" && systemDark()) ? "dark" : "light";

/** Puts the right theme on the page for this path and marks the chosen button. Touches no data and reloads nothing. */
export function syncTheme(path: string = window.location.pathname): void {
  const choice = preference();
  const theme = inStaff(path) ? resolved(choice) : "light";
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
  document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice)));
}

/** The new theme spreads out from the control as a circle where the browser can and motion is welcome; otherwise it swaps at once. */
function choose(choice: Preference, origin: HTMLElement): void {
  visit = choice;
  try { localStorage.setItem(KEY, choice); } catch { /* the choice lasts this visit only */ }
  const change = () => syncTheme();
  if (!document.startViewTransition || reducedMotion()) return change();
  const box = origin.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const root = document.documentElement;
  root.classList.add("theme-switching");
  const transition = document.startViewTransition(change);
  void transition.finished.catch(() => undefined).then(() => root.classList.remove("theme-switching"));
  transition.ready.then(() => {
    document.documentElement.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 450, easing: "cubic-bezier(.2, .8, .2, 1)", pseudoElement: "::view-transition-new(root)" });
  }).catch(() => undefined);
}

let started = false;
export function startTheme(): void {
  if (started) return;
  started = true;
  document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-theme-choice]");
    if (button) choose(button.dataset.themeChoice as Preference, button);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (preference() === "system") syncTheme(); });
  window.addEventListener("storage", (event) => { if (event.key === KEY) syncTheme(); });
  syncTheme();
}
