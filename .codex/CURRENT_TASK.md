# Current Bounded Task — PART-04.7 Self-Service Themes
INTENT: PRODUCT POLISH (no workflow, data or API change)
OBJECTIVE: Earl, 2026-09-30: "Give it a light and dark animated option" for phone Self-Service, after choosing "Flat dark".
DECISIONS: dark stays the default (his Flat dark choice); a sun/moon switch in the app bar; the choice is kept per phone in localStorage; the new theme spreads as a circle from the switch (View Transitions), instant with reduced motion or no support. Staff and public pages are unchanged.
IN_SCOPE: src/self-service.css (light and dark token sets); src/self-service-app.ts (switch); src/ui.ts (sun and moon icons); tests/browser/app.spec.ts; docs/OFFLINE_SELF_SERVICE.md section 16.
OUT_OF_SCOPE: migrations, APIs, new dependencies, staff or public theming, Part 5.
STATUS: COMPLETE (2026-09-30); merged to main. No active task until Earl accepts the next one. Part 4.6 details: .codex/PART_04_6_BRIEF.md.
