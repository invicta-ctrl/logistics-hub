# RTV3-02 — Event & Demand Orchestration

## Gate
Requires:
- RTV3-01 complete;
- Product Direction Amendment accepted.

## Outcome
A complete current-platform way for DOL to receive, clarify, steward, and track logistics demand.

This is not the old Request Center.

## Core domain
- Event
- Subevent/activity where needed
- Requirement
- requestor/department/authority context
- DOL steward
- clarification/history
- demand status
- external-reality/provenance capture

## UX
One goal-oriented workspace:
- event/request context once;
- requirements grouped clearly;
- missing/exceptional information requested only when needed;
- Activity/history uses bounded internal scrolling;
- mobile submission/review practical;
- public/requestor language avoids internal implementation semantics.

## AI
May:
- normalize already-entered requirement text;
- map text into allowed item/category concepts;
- flag ambiguity;
- summarize a discrepancy.

May not:
- invent event needs;
- approve a request;
- assign staff;
- create procurement intent.

## Offline
If offline submission/drafting is in the accepted spec:
- preserve local data;
- idempotent replay;
- visible recoverable quarantine;
- current-state reconciliation after reconnect.

## Decommissioning
The spec must state what existing V2 submission surface is superseded, coexistence/cutover behavior, and archive/redirect plan.

## Independence test
RTV3-02 must remain useful without RTV3-03 Promise.
