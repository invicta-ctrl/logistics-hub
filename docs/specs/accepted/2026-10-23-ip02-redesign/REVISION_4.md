# IP-0.2 revision 4 — the final redesign of every staff page
Status: ACCEPTED BY OWNER, 23 October 2026 (Earl: "I accept revision 4's visual intent and LH-IP02-S03 and LH-IP02-S04 as written."). Visual intent only; authorizes no application edits.
Prototype: [prototype-r4](prototype-r4/index.html) (served from the packet, synthetic records, drawn product pictures).
Builds on: revision 3 ([REVISION_3.md](REVISION_3.md)), whose stylesheet revision 4 loads unchanged. Revision 4 adds page parts only and changes no token, size, colour or easing.

## Owner direction (23 October 2026)
Earl, on the S01 local preview:
- There is no way back from Quick Catalog. It should be a part of the workspace, "like the Add items" sheet, not a separate module.
- "Cataloguing in" is a field in the Catalog window, not a separate required first step.
- Quick Catalog exists only in the app. On the website it is reached only from the Administration tab.
- A photo with a solid background is matched to its card, so it does not look awkward.
- A picture whose background was removed by the AI is presented "pedestal style".
- "Do one final redesign of everything."

Earl's answers to the three follow-up questions:
- **Catalog:** a sheet in Administration on the website; the offline Catalog stays only in the installed app.
- **Scope:** all staff pages. The public landing stays as accepted in S02.
- **Process:** prototype and spec first, as before.

## What revision 4 shows
1. **Rail.** Catalogue leaves Resources. Everything else is as S01 implemented it.
2. **Catalog, under Administration.**
   - The Catalog tab leads with Start cataloguing, which opens the Add items sheet in session mode.
   - The sheet differs from Add items in four ways:
     - a "Cataloguing in" place field at the top;
     - it stays open after each save, keeping the place;
     - a running "N saved in Craft shelf" strip;
     - Finish session.
   - The tab also holds the existing classification figures and Other names. A note says the offline Catalog is the installed app, with Install the Catalog app.
   - Checking a place moves to Locations: open a place, then Check this place.
3. **Pictures.**
   - **Solid backgrounds:** a card samples the edge of its photo in the browser. When the edge is near-uniform (spread ≤ 12 per channel), the frame takes that colour, so a white-wall photo sits in a white frame and a pale-blue one in pale blue. A busy photo keeps the neutral frame.
   - **Background removed:** the cut-out is cropped to its own pixels (as the live subject crop already does) and stood on a pedestal: a soft studio floor, a short plinth with a shaded side and a lit top, and a contact shadow.
   - **Labels and controls:** "Background removed" labels the picture. Use the original photo / Remove background sit under it, with "The original photo is kept".
4. **Every staff page.** All of them use one language, revision 3's:
   - a Newsreader title with a single lede;
   - quiet view tabs with counts;
   - one toolbar (pill search, Filter, a count);
   - rows instead of boxed tables: picture, name and reference, two context columns, quantity and status;
   - status as text with a marker;
   - every secondary form in a sheet.

   Per page:
   - **Items:** photo rows. The item sheet leads with the picture, then on-hand, then Overview, Review and edit, History.
   - **Stock:** one-tap filters. The always-open Update stock side panel becomes a sheet from the primary button.
   - **Loans:** rows with the item picture and due status.
   - **Locations:** rows with item count and last check. A place sheet has directions, the items there and Check this place.
   - **Kits:** a readiness meter per kit. Templates are below.
   - **Self-Service review:** records to check as rows.
   - **Activity:** a feed grouped by day, with time, module icon and sentence.
   - **Administration:**
     - System is a ruled list of checks under one status line.
     - Catalog is as above.
     - Staff lists accounts as rows.
     - Self-Service, Directory and Accountability keep their content in the same frame.
   - **My account:** profile and password in the main column; sessions and the owner recovery key beside them.
5. **Responsive.** Same breakpoints as revision 3. Below 900 px rows drop their context columns. On phones, sheets are 92 dvh bottom sheets with sticky actions.

## Decisions
Earl decided D1 and accepted D2 and D3 on 23 October 2026: "D1: staff catalogue only in the installed app; on the website the Catalog is under Administration for administrators. Accept D2 and D3 as proposed."
- **D1 · ACCEPTED · Staff catalogue only in the installed app.** On the website the Catalog is under Administration, for administrators only. Administration stays closed to the STAFF role (`src/admin-frame.ts:29`) and gains no STAFF tab.
- **D2 · ACCEPTED · `/staff/catalogue` on the website.** Opened in a browser (not the installed app), the address leads to Administration › Catalog. In the installed app (`display-mode: standalone`) it stays the Catalog app.
- **D2a · ACCEPTED · The install page stays reachable.** Earl, 23 October 2026: "Accept D2a: in a browser tab, /staff/catalogue shows only the install view (install, open the staff workspace, and for administrators Catalog in Administration)." The Catalog installs only from its own page: `staff/catalogue.html` carries `catalogue.webmanifest` (`start_url` `/staff/catalogue`, scope `/staff`). iOS reads the manifest only as that page loads. A browser visit that always redirects away would leave staff, who now catalogue only in the app, with no way to install it.

  Proposed: in a browser tab, `/staff/catalogue` stays the Catalog's own page but shows only an install view:
  - the Catalog is an app;
  - Install (the existing flow in `src/pwa.ts`), with the existing iOS steps;
  - Open the staff workspace;
  - for administrators, Catalog in Administration.

  No session, capture or check runs in a browser tab. Administration › Catalog's "Install the Catalog app" opens this page.

  This turns D2's redirect into a link on that page. An old `?audit=` link still goes straight to the place check in Locations.
- **D3 · ACCEPTED · Place checks move to Locations.** The check screen (`src/audit-screen.ts`) runs inside the workspace from a place's Check this place, and still in the app.
- **D4 · Pedestal is presentation only.** The cut-out, its cap, its acceptance check and "Use original" are unchanged (Final Pass FP-E). The pedestal is how an accepted cut-out is drawn. No new AI call, model or provider setting.
- **D5 · Background matching runs in the browser.** It reads pixels the page already has, stores nothing and sends nothing.

## Not changed
Public landing (S02), Self-Service app, every API, schema, migration, Worker route, AI or provider setting, offline storage, the PWA manifests, and the accepted revision-3 tokens.
