# Current Bounded Task — PART-04.10 Fresh Public Pages
INTENT: DEFECT FIX (service worker navigation strategy; no data or API change)
OBJECTIVE: Earl's phone (2026-09-30) still showed the home page without the restored banner after the deploy.
CAUSE: src/sw.ts served every public navigation from the saved shell, and a waiting version activates only when every tab closes (public pages never report idle to pwa.ts).
FIX: only /self-service* opens from the cache; every other navigation goes to the network first and falls back to the saved shell offline. Phones still on the old worker switch once all of the site's tabs close.
TEST: tests/worker-browser/offline-self-service.spec.ts, "public pages load fresh from the network, while Self-Service opens from the phone's cache" (fails on the previous worker).
STATUS: COMPLETE (2026-09-30); merged to main. No active task until Earl accepts the next one.
