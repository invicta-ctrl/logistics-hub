# Offline Catalogue: Logistics Catalog PWA — Engineering Guide

V1.6 (`docs/specs/accepted/road-to-v2/v1.6-catalog-pwa.md`). How the V1.5 Rapid Catalogue installs as its own app and keeps working without a connection, where each behaviour lives, and how to change it safely. For staff, see "Logistics Catalog (staff)" in `docs/PWA_INSTALL_GUIDE.md`.

## 1. What it does

The Catalogue (`/staff/catalogue`) installs as **Logistics Catalog**, a focused app of the same Logistics Hub product and backend. While signed in, a member turns on **offline cataloguing** on a device. From then on that device can open the Catalogue, start or resume a cataloguing session, capture items (with photos), and finish, all without a connection. What it saves waits on the device, clearly marked, and is sent (each record exactly once) when the connection is back. Nothing is the record until the server has it.

V1.6 adds no cataloguing feature: the capture screen, suggestions (`catalogue-suggest.ts`) and possible matches (`duplicates.ts`) are V1.5's, now run against a copy of the catalog saved on the device, online and offline alike, so they answer the same either way (amendment §11).

## 2. Where things live

| Concern | File | Notes |
| --- | --- | --- |
| Lease (issue, renew, end), what a lease may do | `src/worker.ts` | `signedIn()`, `leaseMayUse()`, `enableOffline()`, `disableOffline()`, `logout()` |
| Catalog snapshot, session starts, capture replay | `src/catalogue.ts` | `catalogueSnapshot()`, `capturedBy()`, `startSession()` (proposed id), `capture()` (replay across the person's sessions) |
| Device storage (IndexedDB `logistics-hub-catalogue`, v2) | `src/catalogue-store.ts` | captures, sessions, `access`, `snapshot`; no DOM (the service worker reads it) |
| Sending | `src/catalogue-sync.ts` | one engine for every Catalogue screen |
| Who is cataloguing, turning it on/off, readiness | `src/catalogue-offline.ts` | `identify()`, `turnOn()`, `turnOff()`, `refreshSnapshot()`, `readiness()` |
| The Catalog's own page and frame | `staff/catalogue.html`, `src/catalogue-shell.ts`, `src/catalogue.css` | its manifest from the first byte; bar (name, connection, account), home's band |
| Catalogue page and device card | `src/catalogue-workspace.ts` | offline / signed-out notes, what waits, install steps |
| Capture screen | `src/catalogue-capture.ts` | reads the snapshot; finishes offline |
| Service worker | `src/sw.ts`, `vite.config.ts` | `CATALOGUE_SCREENS`, `__BUILD__.catalogue`, `KEEP_CATALOGUE` / `CATALOGUE_KEPT` |
| Manifests and icons | `public/catalogue.webmanifest`, `public/icons/catalog-*.png`, linked from `staff/catalogue.html` (and `index.html` for Self-Service) | |
| Tests | `tests/catalogue-offline.test.ts`, `tests/browser/catalogue.spec.ts` (V1.6 block), `tests/worker-browser/worker-v16-catalog-pwa.spec.ts` | |

## 3. Two apps, one site (the install decision)

| | Logistics Hub (Self-Service) | Logistics Catalog |
| --- | --- | --- |
| Manifest | `/manifest.webmanifest` | `/catalogue.webmanifest` |
| `id` | `/self-service` | `/staff/catalogue` |
| `start_url` | `/self-service` | `/staff/catalogue` |
| `scope` | `/self-service` (was `/` before V1.6) | `/staff` |
| Icon | the DOL mark on cream | the same mark on a cream disc over the staff workspace's dark oxblood |
| Who | anyone with the QR code | Logistics staff |

- **Separate ids** make two apps: installing one neither replaces nor changes the other (Chrome treats a manifest whose id matches no installed app as a new app).
- **Scopes that do not overlap.** Chrome's guidance ranks the options: separate origins, then non-overlapping paths on one origin, and "strongly not recommended" nested paths. With Self-Service at `/`, an installed Self-Service would claim `/staff/catalogue` (link capturing) and the browser would not offer to install the Catalog there. V1.6 narrows Self-Service to `/self-service`, where all its screens, its start URL and its shortcuts already live. Same id, so installed phones update in place as the same app.
- **Catalog scope `/staff`**, not `/staff/catalogue`: signing in (`/staff`) stays inside the app. On iPhone and iPad a page outside a Home Screen app's scope opens in an in-app Safari view whose storage is not the app's, so a sign-in there would not reach the app. After sign-in, `?next=/staff/catalogue` (strictly validated in `staffLogin()`) returns to the Catalogue.
- **Rejected: a separate origin** (a `catalog.` subdomain). It is the best isolation, but it needs DNS and Worker-route changes in production and a second sign-in origin, which this slice's product boundary (same product and backend) does not call for. Revisit if the two apps ever need separate permissions or storage quotas.
- **Two pages, one manifest each.** The Catalog has its own HTML page, `staff/catalogue.html` (a second Vite entry, built to `dist/staff/catalogue.html`; the Worker's assets serve it at `/staff/catalogue`, query and all, and the dev server does too). It links `catalogue.webmanifest`, the Catalog's touch icon and `apple-mobile-web-app-title` in the HTML itself; `index.html` links Self-Service's for every other route. The first V1.6 build had one page and re-pointed `<link rel="manifest">` in script after load: Chromium followed, but iOS Safari reads the manifest only as the page loads, so **Add to Home Screen** from the Catalogue installed a second Self-Service. Never move the manifest in script.
- **Moving between the apps loads the other page.** The router (`main.ts`) knows which page it is on (`<html data-app="catalog">`); a navigation to a route of the other app reloads the URL so the server hands over that app's page (at most once per route, and not offline, where the router shows what it can instead). Checked in Chromium through the DevTools protocol (each page reports its own manifest and no installability errors, and the served HTML already carries it: `worker-v16-catalog-pwa.spec.ts`) and in the browser suite (Catalog → Staff workspace → back swaps the page both ways).
- **Its own frame.** The Catalog does not use the staff workspace's bar and sections: `catalogueShell()` gives it its name (the DOL mark on a cream disc, as on its icon), how the device is connected (**Online**, **Offline**, **Signed out**) and an account menu (Staff workspace and Sign out when signed in; Sign in on a lease; offline, a note that both need a connection). Home has a dark band with the heading and the offline / signed-out note; the first card overlaps its foot. What waits to send is counted where the work is (home, the capture bar), not in the bar.

## 4. Security model: the offline cataloguing lease

- **No password on the device.** Turning on offline cataloguing (`POST /api/staff/catalogue/offline`) needs a full sign-in and gives the device a **lease**: a `staff_sessions` row whose id starts `CL-` (a full session's id is a plain UUID), carried in its own cookie `lh_catalogue_lease` (`HttpOnly; SameSite=Strict; Path=/api/staff/; Secure` on HTTPS, 7 days), signed with its own key (`catalogue-lease:` + the session secret). Script cannot read it. The device remembers only who the lease belongs to and until when (`access` in IndexedDB).
- **Neither cookie passes as the other.** `signedIn()` verifies each with its own key and requires the right kind of id. A lease is used only when there is no valid full session, and only for:
  - `GET /api/staff/catalogue`, answered with the member's own open session only (no one else's, no Review later list), `GET`/`DELETE /api/staff/catalogue/offline`, `GET /api/staff/catalogue/snapshot`;
  - `POST /api/staff/catalogue/sessions`; `GET` (its own member's only) and `PATCH` a session; `POST …/captures`, `POST …/finish` (changing a session stays its owner's alone, as in V1.5);
  - `PUT /api/staff/items/:id/photo` only for an item one of this account's sessions catalogued, and only its first photo (`expected` empty).
  Everything else answers 401, exactly as with no sign-in (tested route by route).
- **Bounded and revocable.** 7 days, moved a full week ahead (at most once a day) whenever the Catalogue opens online with a full sign-in. Being a session row, it ends with every way a session ends: **sign out everywhere**, a password change or reset, a change of role or access, deactivation (no lease of an inactive account is honoured), owner recovery. **Signing out on the device** ends the lease there too. **Turn off offline cataloguing** ends it (audited `CATALOGUE_OFFLINE_OFF`; turning on is `CATALOGUE_OFFLINE_ON`). A device holds one lease: a member turning it on where another member's lease was left ends that one. Expired rows are swept with old sessions.
- **Scoped to Logistics staff.** The same `hubAccess` and must-change-password checks apply on a lease.
- **No migration.** Leases reuse `staff_sessions` (the id prefix tells them apart), so V1.6 needs no production database change.

## 5. What the device keeps

IndexedDB `logistics-hub-catalogue`, version 2 (version 1 was V1.5's outbox; its captures are kept on upgrade):

| Store | Holds | Personal data |
| --- | --- | --- |
| `captures` | each capture not yet fully on the server: the request as it will be sent, its photo (display and thumbnail JPEG), its state, and `owner` (the account that captured it) | the photo; nothing about people |
| `sessions` | the session open here (with what the server last said about it: place, counts, newest captures, so it reopens offline), one started here offline, one finished here not yet reported | the member's display name as the session owner |
| `meta.access` | account id, display name, username, role, access, lease end | the member's own name and username |
| `meta.snapshot` | the catalog snapshot (`GET /api/staff/catalogue/snapshot`): each item's id, name, other names, category, type, how used, unit, stock area, status, model, serial number, place, photo hash and on hand; categories and units in use; the place tree | none: no notes, loans, borrowers, history, audit, or staff |

Nothing personal goes to Cache Storage; the service worker caches only the app's files.

## 6. Sending (`catalogue-sync.ts`)

- **Oldest first, one member's work.** Only entries whose `owner` is the signed-in (or leased) member are sent (a V1.5 entry without an owner is sent by a full sign-in). Another member's work stays on the device for them, and the Catalogue page counts it (with a Discard, after a confirm).
- **Sessions started offline** are filed under an id the device proposes (`CS-<uuid>`). The first capture sends `POST …/sessions {id, locationId}`; the server makes the session under that id, or answers with the session this person already has open (one per person, as in V1.5), and the device sends there. A start whose answer was lost is never a second session.
- **Exactly once.** A capture's request id is the server's key (V1.5); a repeat answers the saved item (`replayed`). A first photo refused with 409 means the item already has one, so it is done. A session finish is idempotent.
- **Finished elsewhere.** If the server refuses a capture because its session was finished on another device, the device files it under a new session (it proposes the finished one's id again; the server answers with a new or the open session) and sends it there. The server treats a capture re-sent into the same person's newer session as a replay, never a second item.
- **Finished here.** A session finished offline is marked `finishing`; the server is told once everything captured in it has been sent (or discarded). It is told before any session started after it is started on the server: while one of the older session's captures is still on its way (a retry pending), the newer session waits, so it is never filed under the older one. (One that needs a person does not hold it up; the newer one then joins it, which is what one open session per person means anyway.) The finish screen shows what is still on the device ("3 items are not saved yet…"). Screens always re-read the stored session before writing it, so a finish pressed while sending was starting the session is never lost or undone.
- **When.** On every Catalogue screen: right after a save, when the connection returns, when the app comes back to the foreground, and on a back-off timer (2 s doubling to 30 s, for captures and photos alike; a busy server answers 429/5xx and waits too). A request that has not answered in 20 s (90 s for a photo) counts as a dropped connection. One sender per device: a Web Lock keeps two tabs (or the installed app and a tab) from sending at once. There is no Background Sync for the Catalogue (iOS has none, and the app is open while cataloguing).
- **A 401** means neither a sign-in nor the lease is valid: sending stops, the device forgets its access, and the screen goes to sign-in (`?expired=1&next=…`). What is waiting stays on the device and is sent after the next sign-in. Only the server saying so forgets the access: a request lost on the way keeps it.
- **Shared devices.** Signing in ends a lease another member left on the device (the server, at sign-in), and signing out forgets this device's access (the page), so a device never catalogues as someone who is not signed in there.
- **"A different one".** A capture checked against one taken just before it names that capture's item once it exists, whether it was sent before or after (persisted in `after`, and remembered for the page's life).
- **One term per concept** (amendment §4): a capture the server does not have is **Not saved yet** (row) / **N waiting to send** (bar), online or offline; being offline is said once, in the note above the form.

## 7. Service worker and updates

- `vite.config.ts` computes the Catalogue's files (`CATALOGUE_SCREENS`: `catalogue-workspace` and every chunk it imports, plus the Catalog's page `/staff/catalogue`, `catalogue.webmanifest` and the Catalog icons) apart from the shell every device saves, and bakes both lists into `/sw.js`.
- The Catalogue's files are saved **only on a device with offline cataloguing on**: turning it on sends `KEEP_CATALOGUE` to the active service worker **and to a waiting new version** (which deletes the active one's files when it takes over), and readiness asks both; a new version's `install` saves them again when offline cataloguing is on, so an update never takes it away. To know, the worker looks for the catalogue store at version 2 (`indexedDB.databases()`) before opening it, so it never creates the store on a Self-Service phone or upgrades it under a V1.5 page still open. Phones that only use Self-Service never download staff code.
- On such a device `/staff/catalogue` opens from its saved page (the Catalog's own, cache first); elsewhere it goes to the network, and the Worker now serves the page without a session check (the page decides, so it can open on a lease); every other `/staff/*` page still needs a session before any HTML.
- Updates wait, as in Part 4.5: the capture screen tells `whenIdle()` it is idle only with an empty name and no photo; the Catalogue page offers **Update now**. What was catalogued is in IndexedDB, which updates never touch (the E2E deletes every cache with work waiting).

## 8. Readiness

**Ready for offline cataloguing** needs all of: offline access not expired; the Catalogue's files saved and a service worker active (it answers `CATALOGUE_KEPT` even before it controls the page); a catalog snapshot; storage the browser keeps; and, on iPhone and iPad, running as the Home Screen app. Otherwise the card says **Getting ready for offline cataloguing…** or what is wrong, in plain words: a private window, "open the Catalog from your Home Screen", files or catalog not saved (with **Try again**). It also says when offline access ends ("Works without a connection until Sun, Oct 11, 9:04 PM") and when the catalog was saved, warns a day before the end, and asks the browser to keep the site's data (`navigator.storage.persist()`), mentioning it when that was not granted.

## 9. Resolution paths

| Situation | What happens |
| --- | --- |
| Offline, items saved | Each shows **Not saved yet**; the bar says **N waiting to send**; the Catalogue page lists them. They go when the connection is back. |
| Sign-in ended (8 h), lease valid | The page says **You're signed out** with **Sign in**; cataloguing and sending go on, on the lease. Items, Stock and the rest need a sign-in. |
| Lease expired or ended, items waiting | Offline: the Catalogue says it needs a connection here, and counts what waits. Online: sign in; the work is sent then. Nothing is deleted. |
| Signed out on the device | Lease ends; the work stays for that member's next sign-in on this device. |
| Another member signs in on the device | They see "N items another member catalogued here are waiting for them"; only that member's sign-in sends them; a confirmed Discard clears them. |
| Turned off | Lease ends; the work stays and is sent at the next sign-in. |
| Session finished on another device | Waiting items go to a new session. |
| A capture refused (possible duplicate, a place made inactive) | **Needs you**, with Save as a separate item / Edit / Discard, on the capture screen or the Catalogue page; a session finished here waits for it. |
| Browser data cleared before sending | That work is lost (as with any browser storage); the install guide warns. |

## 10. Tests

- `tests/catalogue-offline.test.ts` (Worker on SQLite D1): issuing and renewing a lease, cookie attributes, audit; what a lease may and may not do, route by route; neither cookie passing as the other; expiry; every way it ends; the snapshot's fields and revision; proposed session ids; replay across a person's sessions; the Catalogue page served without a session.
- `tests/browser/catalogue.spec.ts`: V1.5's suite against the snapshot, plus V1.6: offline open, start, save and send once; no offline access; signed out on a lease; turning off; 320 px; install steps on Android, iPhone and a computer; a look-alike of an item saved a moment ago; a session finished elsewhere.
- `tests/worker-browser/worker-v16-catalog-pwa.spec.ts` (real Worker, D1, R2, production service worker, an Android tablet in Chromium): turn on → Ready; reopen offline; the same suggestion online and offline; captures with a photo across a reload; finish and start offline; everything sent once, and still once when every answer is lost; a wiped app cache with work waiting; signed out on the lease (and nothing else); both apps installable with their own manifests.

## 11. Limitations

- First use needs a connection and a full sign-in; iPhone and iPad catalogue offline only from the Home Screen app (a Safari tab keeps its own storage).
- Offline, a person's session open on another device is not known: a session started here joins it when sent (one open session per person), and finishing it here then finishes that session too.
- New places need a connection and a full sign-in; offline, places come from the saved catalog.
- A capture made offline is recorded when it reaches the server (its time, and its opening count's time, are the arrival).
- Thumbnails of items already on the server are not shown offline or on a lease (photos stream only to a signed-in session).
- Real Android and iOS devices were not used: Chromium with each device's screen, touch and user agent, and the platforms' current published steps (`docs/visual-research/v1.6.md`).

## 12. For V1.7 (physical inventory)

The boundary is ready to extend without rework: the lease's allowed routes (`leaseMayUse`), the device store (`catalogue-store.ts`: a new store or entry kind beside `captures`), the snapshot (items with place and on hand are what a count needs), the sender (`catalogue-sync.ts`: a new kind sent in the same order, keyed the same way), and the screens' service-worker list (`CATALOGUE_SCREENS`). V1.6 implements none of it.
