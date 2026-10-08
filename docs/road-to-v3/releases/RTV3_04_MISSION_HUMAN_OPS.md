# RTV3-04 — Mission Control & Human Operations

## Outcome
Provide a single operational workspace for executing a logistics goal and routing responsibility.

## Capabilities
- Mission / Goal Workspace;
- server-composed bounded read model;
- steps/blockers;
- responsibility ownership;
- handover;
- Operational Roster;
- Capability Map;
- Responsibility Graph;
- "What breaks if unavailable?" continuity view.

## Staff Directory boundary
Directory identity data is not a replacement authorization source.

Operational status examples, not an exhaustive enumeration:
- Available;
- On Mission;
- Temporarily Unavailable;
- Handover Active.

No:
- GPS;
- location permission;
- venue-to-person location inference;
- attendance scoring;
- productivity scoring;
- permission changes based on presence.

## AI
May summarize blockers or handover context.
May not assign people, score them, infer where they are, or change authority.

## Frontend
Composite workspace requires measured server/client budgets from RTV3-01.
No full-history fan-out on routine interaction.

## Independence
Mission execution works without RTV3-05 procurement.
