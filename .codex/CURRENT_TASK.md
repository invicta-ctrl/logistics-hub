# Current Bounded Task — PART-04.8 Self-Service Photo
INTENT: PRODUCT POLISH (no workflow, data or API change)
OBJECTIVE: Earl, 2026-09-30: "The background photo on the self service disappeared and the icon and doesnt look good. Fix it"
DECISIONS: the campus photograph returns behind the top of home in both themes (night wash in dark, paper wash in light, AA measured at 320/390/820 px); on home the bar sits on the photo and scrolls away with it; "the icon" read as the new sun/moon switch, now matching the sync pill with a fuller moon. Dark stays the default (Part 4.7).
IN_SCOPE: src/self-service.css; src/self-service-app.ts (photo layer); src/ui.ts (moon); tests/browser/app.spec.ts; docs/OFFLINE_SELF_SERVICE.md section 16.
OUT_OF_SCOPE: migrations, APIs, new dependencies, staff or public pages, Part 5.
STATUS: COMPLETE (2026-09-30); merged to main. No active task until Earl accepts the next one.
