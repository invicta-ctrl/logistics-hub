# Accepted Amendment — Public item thumbnails (Lending Hub and Self-Service)

STATUS: ACCEPTED
ACCEPTED_BY: Earl (instruction of 2026-10-03: "Thats the purpose of the image.. for the public to see it and easily indentify what they are looking for..")
ACCEPTED_DATE: 2026-10-03
APPLIES_TO: invicta-ctrl/logistics-hub
SUPERSEDES: the V1.2 decision "Photos are staff-only" (`docs/road-to-v2/releases/v1.2.md`, Known limitations), for the small thumbnail only
SCOPE: product and privacy. No migration, no new binding or secret, no provider change.

## Why

V1.2 gave items a photo but kept it staff-only and said showing it publicly was "a later decision". Earl made that decision on seeing that a photo added to "1/8 Illustration Board" did not appear in the public catalog or in Self-Service: the point of the picture is that the public can see it and recognise what they are looking for.

## What changes

- The Lending Hub list, the Self-Service lists (home search, Get an item, Recent) and the Self-Service item sheet show the item's small (320 px) thumbnail. In lists it sits in the row's left margin at 48 px; once any item has a photo, every row keeps that margin, so names line up, and an item without a photo adds no element. The sheet shows it at 160 px.
- Both catalogs (`/api/public/catalog`, `/api/self-service/catalog`) carry each item's `photo` id or null.
- One new public route, `GET /api/public/media/<id>/thumb`. It needs no sign-in and answers only while all of these hold: the id is the item's current photo; and either the Lending Hub lists the item, or Self-Service offers it and is open (the same `isListedForLending` and `selfServiceAction` functions the catalogs use). Anything else (a removed or replaced photo, an unlisted or unreviewed or inactive item, a supplies-only item while Self-Service is closed, a malformed or guessed id) answers 404.
- Staff are told where they add or change a photo that everyone sees it ("Show the item itself, not people or documents").

## What does not change

- The 1280 px picture has no public address; it is served only to signed-in staff, as before. So are loan photos and held Self-Service photos (a separate bucket, never public).
- Photos are still rebuilt in the Worker without EXIF, location, colour-profile or comment data, so a public thumbnail carries none.
- Only GET reads the thumbnail route; the staff routes keep their sign-in and `private` caching.

## Known limits

- Caching: `public, max-age=3600` with an ETag. A photo removed or an item unlisted can still show for up to an hour on a phone or browser that already loaded it; a new request gets a 404.
- The Self-Service service worker never intercepts `/api/`, so thumbnails are not kept for offline use. Offline, the picture is simply absent and the row looks as it always did.
- The Administration test panel shows a supplies-only item's picture only when Self-Service is open (an image request cannot carry the admin test header).
- Photos are public, so staff must not photograph people, documents or anything private. The upload hint says so; nothing checks the picture's content.

## Rollback

Revert the commit. Nothing was migrated; photos already stored are untouched and return to staff-only.
