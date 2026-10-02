# Road to V2 — accepted amendments, 2026-10-02

STATUS: ACCEPTED BY OWNER (Earl, 2026-10-02, replying to the V1.1 proposal `docs/specs/proposed/2026-10-02-road-to-v2-roadmap-amendments.md`)
APPLIES TO: every Road-to-V2 branch; the shared `CLAUDE.md` carries the operating rules.

## Decisions

1. **No branch protection on `main`.** Declined. CI (`.github/workflows/ci.yml`) still runs on every push.
2. **One shared `CLAUDE.md`, propagated forward.** Every Road-to-V2 branch carries the same `CLAUDE.md`. When a branch receives commits, it is merged into each succeeding branch in version order. Earlier branches are never updated from later ones. Merges only: no rebase or force-push. The procedure is in `CLAUDE.md` → *Forward propagation*.
3. **Owner actions are tracked separately from completion.** Release records carry `STATUS`, `INTEGRATION` and `OWNER_ACTIONS`. A slice that waits only on Earl's production or private steps counts as complete for its successor's gate. See `CLAUDE.md` → *Release records and owner actions*.
4. **Re-sequencing:**
   - **Staff Directory moves right after Item Profiles.** It needs only the media pipeline and the existing accounts, loans and activity. Its real ID import is an owner action, so it no longer holds up the rest of the roadmap.
   - **Rapid Catalogue comes before the Catalog PWA and is online-first.** Cataloguing works on office Wi-Fi a slice earlier. The offline staff lease, the riskiest security work in the roadmap, is then designed and tested against a workflow that already exists.
   - **Official staff ID scans get their own private R2 bucket** with its own binding, separate from catalog/location media and transaction evidence. A defect in any other media route cannot reach them.

## Renumbering

Version order equals execution order. Each renamed branch was created from the old branch's tip, so its history is kept. The old names were removed only after the new branches were pushed.

| New version and branch | Was | Old tip |
|---|---|---|
| V1.3 `road-to-v2/v1.3-staff-directory` | V1.9 `road-to-v2/v1.9-staff-directory` | `0879b9063987b704d1083269588bd74dcb370592` |
| V1.4 `road-to-v2/v1.4-smart-locations` | V1.3 `road-to-v2/v1.3-smart-locations` | `6bf9d6c510f027c8d3c6bc03283531e155cd61ba` |
| V1.5 `road-to-v2/v1.5-rapid-catalogue` (same name, now online-first) | V1.5 | `17cb302ab5fde9a4ac29dcb8d810684d79f810d1` |
| V1.6 `road-to-v2/v1.6-catalog-pwa` (now adds offline to Rapid Catalogue) | V1.4 `road-to-v2/v1.4-catalog-pwa` | `e391a1ca296ce4ea8baa81eea1879867e9c37f14` |
| V1.7 `road-to-v2/v1.7-physical-inventory` | V1.6 `road-to-v2/v1.6-physical-inventory` | `86b3ae9e68d169e358a4c402d5df78564708e683` |
| V1.8 `road-to-v2/v1.8-kits-containers` | V1.7 `road-to-v2/v1.7-kits-containers` | `79f324b30af69717123e3c8c7f3cca62d828f774` |
| V1.9 `road-to-v2/v1.9-self-service-2` | V1.8 `road-to-v2/v1.8-self-service-2` | `4f8ad66bbaf760f0474474b6cb13eb81facfbee5` |

V1.1, V1.2 and V1.10–V1.15 keep their numbers and names.

Each renamed branch's spec was moved to its new file name. Its `VERSION`, `BRANCH` and `PREDECESSOR` lines and its references to other slices now use the new numbers. Content changed only where these decisions require it:
- **V1.3 Staff Directory:** predecessor V1.2; ID scans go in a dedicated private bucket, and creating that bucket is an owner action.
- **V1.5 Rapid Catalogue:** online-first; the offline queue moves to V1.6.
- **V1.6 Catalog PWA:** installs and takes offline the existing Rapid Catalogue.
- Exclusions that named a slice which now comes earlier (Staff Directory) were removed.

## Still proposed, not decided

Items 3 and 8–13 of the proposal remain proposals:
- performance budgets from the V1.1 baseline;
- shifting offline hardening into each offline slice;
- media key namespaces in V1.2;
- an early attention shape;
- keeping the shell at six sections;
- independent end-to-end tests;
- the evidence size limits.

**Awaiting Earl's confirmation.** While writing the shared `CLAUDE.md`, Claude also added two finish-step lines that Earl has not decided:
- "CI must be green on the final commit" (finish step 3);
- "Start from `npm run evidence`" (finish step 4).

Earl either confirms them, or they are removed on V1.1 and the removal propagates forward.
