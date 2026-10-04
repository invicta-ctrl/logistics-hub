# Catalog Visual System — rendered review

Independent update on main from V1.4 baseline `8951c89`, 2026-10-04. Actual locally migrated Worker/D1/R2 application, synthetic demo accounts and browser-drawn photo fixtures; no production writes, real staff photos or AI artwork.

## References and decisions

- [Tabler Icons v3.48.0](https://github.com/tabler/tabler-icons/tree/v3.48.0): human-designed, consistent 24 px outline geometry, MIT license. The upstream license was fetched and compared with `licenses/TABLER.txt`; it matches. Bundle only 63 inventory icons, with local keywords and no network library dependency.
- [W3C decorative images guidance](https://www.w3.org/WAI/tutorials/images/decorative/): visuals beside the item name are decorative, so SVGs are `aria-hidden`/non-focusable and list photo alt is empty. Meaningful profile photos use the item name; picker buttons use visible labels. The unavailable full-photo viewer uses a named fallback.
- [MDN object-fit](https://developer.mozilla.org/en-US/docs/Web/CSS/object-fit): cover small catalog frames, contain the profile photograph, reserve dimensions before loading. Existing V1.4 spacing, colors, motion, sheet and focus controls are retained.

These references were retrieved during this review. No new design system, framework or image service was introduced.

## Reproduction

```sh
npm run evidence -- --out docs/visual-research/catalog-visuals --base 8951c89 --pages items,item-profile,item-photos,public-photos,locations,catalog-visuals
npm run evidence -- --out docs/visual-research/catalog-visuals/after --pages items,item-profile,public-photos,catalog-visuals
```

The first run compares baseline and candidate, including 300-photo loading and existing V1.4 locations/Where-is-it. The second refreshes the changed states after the final UI corrections and was rerun against the reconciled V1.4.1 baseline `1913716`; desktop/phone catalog, profile, picker, error/offline and dark Self-Service captures were inspected again. The script uses its own disposable local database/media and a detached read-only baseline, never a new branch or shared preview state. Only representative screenshots and timings are retained to bound repository size.

## Inspected states and corrections

Desktop 1440×900 and phone 390×844 were visually inspected, with tablet and 320 px bounds also covered by browser tests:

- Staff item table/phone cards: recognizable specific icons, uniform frames and aligned names. [Desktop](catalog-visuals/after/owner-desktop-items.jpg), [phone](catalog-visuals/after/owner-phone-items.jpg).
- System Icon profile and searchable picker: labelled choices, visible focus and phone scrolling. [Profile](catalog-visuals/after/visual-icon-profile-desktop.jpg), [phone picker](catalog-visuals/after/visual-picker-phone.jpg).
- Photo profile/upload/viewer: synthetic photographs retain aspect ratio and replace the icon in the same frame. [Phone photo profile](catalog-visuals/after/photos-profile-phone.jpg), [upload](catalog-visuals/after/photos-upload-phone.jpg).
- Unknown item: recognizable package fallback and optional upload, no empty frame. [Phone](catalog-visuals/after/visual-generic-phone.jpg).
- Loading, aborted requests and offline selected photos: icon remains visible and the frame does not move. [Loading](catalog-visuals/after/visual-photo-loading-phone.jpg), [error](catalog-visuals/after/visual-photo-error-desktop.jpg), [offline](catalog-visuals/after/visual-offline-fallback-phone.jpg).
- Lending Hub and Self-Service: mixed photos/icons align; the campus background remains confined to the home screen. [Lending phone](catalog-visuals/after/public-lending-phone.jpg), [Self-Service sheet](catalog-visuals/after/public-selfservice-sheet-phone.jpg).
- Dark mode is supported by Self-Service, not staff pages. The evidence scene uses its actual body theme attribute and an unavailable public photo to inspect the icon in the dark sheet: [dark phone](catalog-visuals/after/visual-selfservice-dark-phone.jpg).
- Existing location pictures, place picker, Where-is-it and report flows were rendered by the first run; their regression tests pass and no location controls were redesigned.

Review corrections: keep `display:grid` on Self-Service frames so its existing photo CSS cannot stack the photo below the fallback; explain that a retained photo is saved while System Icon is selected; give the large-photo viewer the item icon on failure; capture dark mode on the surface that supports it. The evidence seed now sends the existing photo id so combined scenes preserve the same compare-and-swap contract as staff uploads.

## Size and loading evidence

Baseline shared entry: 38.81 kB / 14.91 kB gzip. Candidate shared entry: about 75.96 kB / 22.60 kB gzip (about **7.7 kB gzip** added, including resolver/63 icons and frame handling). Staff chunk grows from 79.92 kB / 25.44 kB gzip to about 84.4 kB / 26.8 kB gzip. No icon requests and no entire Tabler dependency.

`catalog-visuals/before/timings.json` and `catalog-visuals/after/performance.json` preserve the full comparison. In the 300-photo staff list, both runs fetch 34 thumbnails / 99 KiB initially; the list layout-shift measurement is 0.0383 in both. Photos stay lazy; more load during scrolling. Median cold staff row arrival was 1187 ms before / 1061 ms after; section switch 251 / 245 ms. These are one local comparison, not a performance guarantee.

The public page's initial whole-page data/header shifts already exist in the baseline (desktop 0.5452 in both runs). They are not caused by photo decoding; phone measurements remain about 0.0327. The focused browser test explicitly verifies a failed image leaves a 48×48 frame and the icon, without horizontal overflow. The real Worker test covers upload, preference changes, retained photos (public access returns 404 while System Icon is selected), thumbnail/display failures and offline fallback; the existing PWA tests cover cached catalog operations and API cache exclusion.

Limits: browser emulation, not a physical phone/camera or screen reader session. Photos are synthetic fixtures; real source photos and unsupported HEIC decoding were not tested. Existing cached public thumbnails can persist for up to an hour. No production visual deployment has occurred.
