# Accepted Specification — Logistics Hub Office Operations Reboot v0.1
STATUS: ACCEPTED
DATE: 2026-09-28
OWNER: Earl
REPOSITORY: invicta-ctrl/logistics-hub

## Objective
Build a focused but full-featured Logistics office system as independently usable vertical Parts, retaining the prior approved public landing identity for YDD.

## Public
Landing (ported visually, not React architecture); public read-only Lending Hub; Staff Login; Logistics Request unavailable/no backend.

## Architecture
HTML5 + CSS3 + TypeScript/JavaScript; Vite; Cloudflare Worker TypeScript; D1; R2. Keep dependencies small; no React by default.

## Invariants
Catalog metadata is separate from physical quantity. Quantity comes from append-only movements. Opening balance is a movement. Staff/borrower PII never enters public Git. Borrower classification is STUDENT or USC_STAFF. OVERDUE is derived.

## Migration now
Import all current Production catalog records now, plus inventory history needed for current-state reconciliation. Legacy masterfile may fill unresolved metadata and marks it for review. Verify against latest Production backup. Staff import is private and runtime-only.

## Parts
1. YDD Gateway + Foundation: working landing, public Lending Hub, unavailable Request affordance, staff login, real data foundation.
2. Inventory + Catalog: complete item management/search/detail/classification/location/reorder/lending settings/history.
3. Stock + Pantry: Stock In/Out/Adjustment, pantry view, low stock/reorder/optional expiry.
4. Lending: direct staff-created multi-item loans with Student/USC Staff, student ID, department, photos, due/return/damage/lost.
5. Activity + Accountability: searchable operational history and safe exports.
6. Admin + Hardening: staff roles/settings/backups/recovery/accessibility/responsive/production hardening.

A Part is complete only when UI/API/data/auth/validation/tests/error handling work end-to-end without depending on a later Part.

Out: Request Center, event requests, procurement, canvassing, deliverables, committee workflows, public tracking, legacy frontend architecture.
