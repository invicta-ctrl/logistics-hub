# Web quality and release acceptance

Status: **owner-directed review standard (2026-11-03); not a Phase 1 implementation approval.** Applies to changed user-facing routes and their server operations. Do not retrofit unrelated screens or provision infrastructure without an accepted slice. This checklist consolidates the 15 UX observations and 20 prelaunch checks supplied by Earl, with conditional applicability.

## How agents use this

1. In the accepted slice, identify each affected route as **public marketing**, **authenticated workspace**, **customer transaction**, or **admin operation**.
2. Mark each relevant item **PASS**, **FAIL**, **N/A (reason)**, or **NOT RUN** in the existing PR/review handoff. A visual impression alone is not a test result.
3. Block release on unaddressed critical security, accessibility, data-integrity, and primary-workflow failures. A style preference is not automatically a defect.
4. Supply exact commit, environment, devices/viewport, tests, screenshots or metrics, defects and owners. No fabricated results.
5. Logistics Hub already has production features; this document does not assert their current compliance. Apply only to the active accepted slice and future approved work.

## UX and polish: the original 15

| # | Check | Decision / evidence |
|---|---|---|
| U01 | Purple gradients | **Style:** follow approved brand tokens; a gradient alone proves nothing. |
| U02 | Excessive padding | **Conditional:** test visible content, density and primary CTA on narrow and wide viewports. |
| U03 | Keyboard obscures input | **Required for forms:** focused input and submit action remain visible/reachable with mobile keyboard open. |
| U04 | Small buttons | **Accessibility:** meet WCAG 2.2 AA target-size rule (24 CSS px or applicable exception); prefer generous ~44px mobile touch areas. |
| U05 | No caching | **Conditional:** measure and apply safe caching to immutable/public resources; never show stale order, stock or payment truth as current. |
| U06 | Tiny text | **Accessibility:** readable body copy, zoom, contrast and user font preferences. |
| U07 | Spinners everywhere | **Conditional:** bounded skeleton/progress, actionable retries and stable loading geometry; no endless waiting. |
| U08 | Emojis in UI | **Style:** use consistent accessible iconography when appropriate; emoji is not inherently wrong. |
| U09 | Double-tap duplicates action | **Critical for writes:** server-enforced idempotency, atomic/unique constraints where needed, retry and concurrency regressions. UI disabling is only secondary feedback. |
| U10 | New user sees blank screen | **Required:** purposeful first-use, zero-data, loading, unavailable and permission-denied states. |
| U11 | Text scaling breaks layout | **Accessibility:** no content/functional loss at 200% text resize; test narrow responsive layouts. |
| U12 | Dark/light theme broken | **Conditional:** verify every supported theme including system preference and image assets. |
| U13 | Raw error text | **Required:** helpful safe messages to user, technical details in access-controlled diagnostic logs only. |
| U14 | No tap animation | **Feedback required:** visible pressed/pending/success/error state; animations optional and respect reduced motion. |
| U15 | User settings wiped | **Required if settings exist:** documented persistence per user/device, migration behavior and privacy/retention; log-out must not erase authorized durable preferences unexpectedly. |

## Launch checks: the original 20

| # | Check | Decision / evidence |
|---|---|---|
| L01 | Privacy policy | **When personal data processed:** accurate notice describing actual collection, purposes, retention and rights; approve before real intake. |
| L02 | Terms and conditions | **When transactional/legal relationship exists:** approved role-appropriate terms; avoid filler templates. |
| L03 | Secrets off frontend | **Critical:** no provider keys, access tokens, private IDs or hidden privileged routes in shipped public assets, source maps or logs. |
| L04 | HTTPS | **Critical for live deployments:** enforce HTTPS; secure transport for app, callbacks and APIs. |
| L05 | Cookie consent banner | **Conditional:** inventory cookies/trackers and applicable consent obligations; essential cookies do not automatically justify a banner. |
| L06 | Meta titles/descriptions | **Public indexable pages:** unique meaningful metadata. Not required for authenticated admin screens. |
| L07 | Social preview image | **Public shareable pages:** correct Open Graph assets and cache behavior. |
| L08 | Favicon | **Public-facing branding:** correct favicon and platform icon where useful. |
| L09 | Sitemap and robots.txt | **Public SEO only:** correct indexability; robots.txt is not access control for private records. |
| L10 | Image alt text | **Accessibility:** meaningful images have useful text alternatives; purely decorative images use empty alt. |
| L11 | Compress images | **Performance:** responsive sizing, formats and lazy loading without breaking essential content. |
| L12 | Page-load speed | **Required on real routes:** record device/network profile, LCP/CLS/INP when applicable; compare accepted budgets. |
| L13 | Color contrast | **Accessibility:** WCAG AA normal text 4.5:1, large text 3:1; inspect states and themes. |
| L14 | Mobile friendly | **Required:** narrow viewports, orientation, keyboard, no unintended horizontal scrolling or blocked actions. |
| L15 | Custom 404 | **Polish:** helpful error/unknown-route handling while keeping correct HTTP status and no sensitive leakage. |
| L16 | Broken links | **Required for affected navigation:** real destinations; no fake clickable UI. |
| L17 | Form validation | **Required:** accessible client feedback plus canonical server validation; negative/boundary tests. |
| L18 | Spam protection | **Exposed submissions:** rate limit, abuse cases and appropriate challenge; if using Turnstile validate tokens server-side. |
| L19 | Analytics | **Optional:** privacy-aware, disclosed when applicable, never required to complete transaction; avoid unwarranted tracking. |
| L20 | One clear call to action | **Public marketing:** one honest next action; internal tools prioritize the primary task action. |

## Additional non-negotiable operational checks

- **Authorization:** negative tests for unauthenticated users, role escalation, cross-tenant and cross-branch data/assets; enforce on every server read/write.
- **Payments and ordering (future accepted slices):** server prices/IDs; durable state, deduplication, authorized cash/e-wallet staff confirmation or verified provider settlement, audit, reconciliation, no kitchen release before gate; push notifications are not the source of truth.
- **Information safety:** protect PII and logs; safe headers/content handling, dependency risks, least privilege, input sanitization, tested recovery and retention.
- **Migrations and release:** exact source/head and CI; review full diff; backups/restoration and rollback/reversal for data changes; environment isolation; post-deploy verification. A code rollback alone cannot reverse a database migration.
- **Logistics V1.16.7 boundary:** preserve the existing accepted thumbnail-retention amendment, D1 migration and exact-head release gates. These general checks cannot silently expand the active feature scope or override the V1.16.7 handoff.
- **No assumed passes:** no product runtime tests are claimed by this document. Future writer attaches PASS/FAIL/N/A/NOT RUN evidence to the existing release record and the active accepted slice.

## Source references

- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- W3C target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- National Privacy Commission, right to be informed: https://privacy.gov.ph/the-right-to-be-informed/
- Cloudflare Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Google robots.txt limitations: https://developers.google.com/search/docs/crawling-indexing/robots/intro
