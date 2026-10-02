# Proposed Part 6 — Administration + Hardening

**Status:** PROPOSED — a complete draft for Earl's review. It is **not accepted**, and no Part 6 implementation is authorized.

**Read first:** the controlling prompt (`D:\Download\LOGISTICS_HUB_PART_6_CODEX_MASTER_PROMPT.md`, UTF-8, SHA-256 `f7c4f1ac5e11dcea2087f68bb03dfcb4a34a292cdf0f2f981794df311892d5ac`) was **not available to the session that finished this draft** (Claude Cloud; the file exists only on Earl's PC). The slices, criteria and decisions below come from repository evidence and the roadmap alone. The prompt has not been compared with them. If it differs, the prompt wins. Before acceptance, someone with the file must reconcile it with sections 3–5 and record the result here.

## 1. Control record

- **Branch:** `slice/part-06-plan` (documentation only), created from `c0c6e9963a9f846adf362a4ddeae683fc1eff375`. Derive the checkpoint with `git rev-parse HEAD`.
- **Baseline:** Parts 1–5 complete; Self-Service paused on production (PR #8); migrations 0015–0017 are applied to production and are never reapplied.
- **Part 6.0 boundary:** audit, rendered baseline and planning only. No source, schema, config, dependency, provider or production change; no form saved; no recovery key generated.
- **Roadmap source:** `docs/specs/accepted/2026-09-28-office-ops-reboot-v0.1.md` line 35 ("staff roles/settings/backups/recovery/accessibility/responsive/production hardening") and `docs/PRODUCT_REFERENCE.md` ("System settings, backups, final production hardening"). Items earlier Parts deferred to Part 6: a settings/kill switch (`.codex/PART_04_5_BRIEF.md`), server-side retention of names on takes (`docs/OFFLINE_SELF_SERVICE.md`), the axe accessibility check (Part 5 plan section 6).

## 2. Baseline evidence (2026-10-02)

**Method.** Source commit `44c5cbf` (`main` plus this branch's docs). `npm run typecheck` passes; `npm test` gives 148 passed, 1 skipped (the perf harness). A throwaway local Worker + D1 (migrations 0001–0017, `SELF_SERVICE=paused` as on production) with three random-credential local accounts (Owner, Admin, Staff; never printed, never committed) was driven by Playwright (preinstalled Chromium 1194). Nothing was saved or submitted, and nothing touched production or Earl's preview. Screenshots were not retained (ephemeral cloud disk, outside Git); the figures below are the record.

**Rendered.** 65 page checks at 320, 390, 768, 1024 and 1366 px: `/`, `/lending`, `/staff` (signed out), `/self-service` (paused notice), and signed in as Owner: inventory, an item sheet (390 and 1366 only), stock, loans, activity, administration, my account, self-service review; also Admin and Staff views of administration, inventory and account (390 and 1366 only). Result: **no horizontal overflow on any check**; every page has one `h1`, `lang="en"`, no unlabeled form field, no unnamed button or link, and no console errors except the expected 503 from the paused Self-Service. Staff opening `/staff/admin` is redirected to inventory. The local database has 397 seeded items and no loans or Activity history, so list-heavy states were not rendered with realistic data. 1440 px was not run.

**Keyboard, motion, text size.** Tab walks of 4 to 40 stops on sign-in, home, Lending Hub, account, activity and administration: every stop that took focus showed a focus indicator. In "New account" focus moves into the first field, Escape closes it and focus returns to the button (nothing submitted). With reduced motion no animation runs on the 7 pages checked. At 200% root text size nothing overflows at 390 px or at 320 px, except the public home (finding R2). Not done: screen readers, real devices, browser zoom, forms beyond the dialog above.

**Security boundaries (rendered probes).** Signed-out `/api/staff/session` and `/api/staff/activity` answer 401; `/api/staff/admin/accounts` answers 403 for Staff and 200 for Admin; a cross-origin login answers 403; the paused catalog answers 503. All 8 probed responses carried CSP, `X-Content-Type-Options: nosniff` and `X-Frame-Options: SAMEORIGIN`; the probed `/staff` and `/api/*` ones carried `X-Robots-Tag: noindex`. (HSTS is set only over HTTPS and was not exercised locally.) The strict CSP also refused an injected inline stylesheet during testing.

## 3. Findings

Verified means reproduced in this session; Read means from source reading only.

| # | Finding | Evidence | Weight |
|---|---|---|---|
| R1 | **Focus lands inside the Test Self-Service panel on load** of `/staff/admin` (shown only while Self-Service is closed). The embedded `<main id="main-content">` has focus, the parent's active element is the iframe below the fold, and the first Tab scrolls the page 630 px. Keyboard and screen-reader users start in the phone panel, not at "Skip to content". Cause in the embedded app not yet traced (`src/self-service-app.ts`, around lines 131 and 533). | Verified | Medium |
| R2 | **Public home overflows 52 px at 320 px wide with 200% text.** `.button` and `.site-nav__link` are `white-space: nowrap` (`src/styles.css` lines 126, 274); the "Browse the Lending Hub" button measures 507 px. | Verified | Low–medium |
| R3 | Item-name `button.row-link` in inventory rows is 23 px tall (one per row, about 400 in the list), 1 px under WCAG 2.2's 24 px minimum; the spacing exception between rows probably applies. | Verified; compliance not decided | Low |
| R4 | On the public pages the first Tab stop is a page link, not "Skip to content" (the staff pages start with it). | Verified; cause not traced | Low |
| S1 | **Recorded data is never purged on a schedule.** `DELETE FROM` appears only for `auth_throttle`, and R2 objects are deleted only for refused, duplicate or dismissed uploads (`src/loans.ts`, `src/self-service.ts`). Expired and revoked `staff_sessions` rows, borrower and person names, student IDs and photo keys (`loans`, `self_service_events`), and the R2 photos of recorded loans and applied borrows are kept indefinitely. Part 6 owns this policy by earlier decision. | Read (grep over `src`, `scripts`) | Needs decision |
| S2 | Login is throttled per network address only (5 per minute, `src/worker.ts` 68 and 120); there is no per-username limit, so a known username can be tried from many addresses. | Read | Low–medium |
| S3 | Sessions last an absolute 8 hours with no idle timeout (`SESSION_DURATION_MS`). Password rules are length only (12 to 256, `src/accounts.ts` 51). PBKDF2 stays at 100,000 iterations, the Workers cap, so it cannot be raised. | Read | Low |
| S4 | The Self-Service kill switch is the `SELF_SERVICE` variable in `wrangler.jsonc`: closing or opening it takes a code change and a merge to `main`. There is no in-app setting. | Read | Needs decision |
| S5 | Backups are D1 Time Travel plus Worker rollback (`docs/DEPLOYMENT.md` lines 72–73). No restore rehearsal appears in the repository record, and R2 evidence photos have no documented backup. | Read | Needs decision |
| S6 | Administration's "Security activity" (latest 40 account events, `securityActivity`) likely duplicates Activity's Accounts & exports tab (Part 5). Not compared event by event. | Read | Anti-bloat; verify first |
| S7 | `GET /api/self-service/decisions` is public and unthrottled; it takes up to 50 record ids the phone itself generated, so enumeration is not practical. | Read | Low; optional |

Already sound and not to be reworked: signed, HttpOnly, SameSite=Strict cookies with server-side revocation and the role read from D1 on each request; same-origin checks on every write; constant-time comparisons; a throwaway hash so unknown usernames cost the same as known ones; the last active owner cannot be disabled or demoted; sessions end on role, username, password or active changes; recovery keys are single-use and stored as a hash; the account and session code reviewed here uses parameterized SQL only. This audit read `src/worker.ts`, `src/session.ts`, `src/accounts.ts` and `src/admin.ts` in full; the other modules were not audited line by line.

## 4. Proposed slices

One active `slice/part-06-<scope>` at a time, each from fresh `main`, merged when green, then deleted. Order matters: nothing destructive (6.4) before a restore is proven (6.2).

1. **6.1 Account and session hardening** (no migration). Per-username login throttle that slows attempts but never locks the account (decision D2); opportunistic sweep of expired and revoked sessions and old throttle rows; idle timeout only if D2 says yes. Tests: throttle by username across addresses, an owner is never locked out, sessions swept without touching live ones.
2. **6.2 Backup and restore rehearsal** (documentation and runbook; code only if D3 asks). Rehearse a Time Travel restore on a throwaway D1 built from production's schema and record the exact commands and timings; decide and document the R2 evidence story. Acceptance: a successor can restore from the runbook alone.
3. **6.3 System settings** (migration; needs Earl's approval, a Time Travel bookmark and read-only post-checks per `docs/DEPLOYMENT.md`). A small audited settings record so an Admin or Owner can open and close Self-Service from Administration; it replaces the `wrangler.jsonc` variable instead of sitting beside it. The migration seeds the value **paused**, so production does not reopen when it deploys. Acceptance: closed and open states behave as today for phones, Administration's test panel still works, every change is in Activity, no change without a signed-in Admin.
4. **6.4 Data retention** (after 6.2 and D4). A dry-run report first, then a purge of what Earl's periods allow (names, student IDs, photos, old sessions), each purge audited, with R2 deletions confirmed against D1 keys. Never touches stock movements or the audit trail. Production runs only on Earl's explicit authority.
5. **6.5 Accessibility, responsive and production hardening.** Fix R1–R4 (tracing R1 and R4 first); decide the axe dev dependency (D6); rerun this baseline plus 1440 px and a realistic-data pass; run `npm run admin -- verify` against production; resolve S6; close the Part 6 docs and `docs/PRODUCT_REFERENCE.md`.

**Gates for every slice:** `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser`, `npm run test:browser:worker`, `npm run verify:privacy`, `npm run verify:migration`, `npm run verify:catalog`, `wrangler deploy --dry-run`, plus the touched pages at 390, 768 and 1366 px. Any migration also needs a throwaway-D1 test, a Time Travel bookmark, list-then-apply exactly once, and read-only post-checks.

**Stop conditions:** a production or provider write without exact target and Earl's authority; a migration without his approval; anything that rewrites history or reapplies 0015–0017; staff or borrower data entering Git; a gate that cannot run (say so, never claim it).

## 5. Decisions for Earl

- **D1 (blocks acceptance):** reconcile this draft with the controlling prompt; amend sections 3–4 where it differs.
- **D2:** per-username login throttling (slows a targeted attack but can also slow the real user), and whether to add an idle timeout.
- **D3:** R2 evidence photos: keep as is, or add a copy. Time Travel alone covers D1 only.
- **D4:** retention periods for names, student IDs and photos on takes, borrows and loans, and for session rows.
- **D5:** confirm that an Admin (not only an Owner) may open and close Self-Service from Administration.
- **D6:** approve or decline the axe dev dependency deferred from Part 5.
- **D7:** replace Administration's Security activity list with a link to Activity once S6 is verified?
