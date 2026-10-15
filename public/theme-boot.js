/* Sets the Staff theme before first paint (a classic blocking script, because the Content-Security-Policy allows no inline script). Light is the
   default and needs nothing; only a saved Dark, or System on a dark device, is applied. Public pages and Self-Service are never touched.
   Keep in step with src/theme.ts. */
(function () {
  try {
    if (!/^\/staff(\/|$)/.test(location.pathname)) return;
    var saved = localStorage.getItem("hub-theme");
    if (saved !== "dark" && !(saved === "system" && matchMedia("(prefers-color-scheme: dark)").matches)) return;
    document.documentElement.setAttribute("data-theme", "dark");
    var color = document.querySelector('meta[name="theme-color"]');
    if (color) color.setAttribute("content", "#140609");
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute("content", "dark");
  } catch (error) { /* storage blocked: stay light */ }
})();
