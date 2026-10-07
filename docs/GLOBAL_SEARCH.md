# Global search and item links (V1.11): design and performance

Spec: `docs/specs/accepted/road-to-v2/v1.11-intelligent-search.md`. Release record: `docs/road-to-v2/releases/v1.11.md`. What staff see: `docs/PRODUCT_REFERENCE.md` ("Global search (V1.11)").

## 1. Shape

| Part | Where | What it does |
|---|---|---|
| Search index | `GET /api/staff/search` (`src/search-index.ts`) | One D1 batch of five reads: items (name, other names, category, type, status, place, icon, photo id), places, kits, kit components and item links. Revisioned like the inventory (`ETag "r<revision>"`; an unchanged catalog answers 304 after reading one row). No quantities, notes, loans, evidence or people. |
| Ranking | `src/search.ts`, in the browser | Every keystroke ranks the index already held in memory: no request per key, no D1 read per key. |
| People | `GET /api/staff/admin/directory/search?q=` (`findPeople` in `src/staff-directory.ts`) | Administrators and the Owner only (the existing admin gate). Ranked in the Worker with the same rules; answers at most 8 people and the true total, `cache-control: private, no-store`. Asked once typing pauses (220 ms), never kept after the dialog closes. |
| The dialog | `src/search-palette.ts`, `src/search-palette.css` | Loaded with `import()` on first use (or when the pointer or focus reaches the search button), so it is not in the first load. |
| Item links | `item_relationships` (migration `0030`), `src/item-relations.ts`, `src/item-links-panel.ts` | Staff record that two items are used together, alternatives, a replacement, or a container and its contents. Read from both ends; at most 20 per item; audited. |

Why not a search service, KV, a vector index or embeddings: the whole searchable catalog at 500 items is 8 KB gzipped and ranks in under a millisecond per key (section 4). A server round trip per key would be slower than that on a phone, and every alternative adds a binding, a second copy of the catalog to keep in step, and a cost. The spec forbids embeddings and vector search, and the measured need for anything more is absent.

## 2. Matching (deterministic, with a reason)

A query is split into words the catalog's own way (`words()` in `src/duplicates.ts`: accents folded, lower case, a plural's "s" dropped). The last word may be half typed, so a word matches a whole word or the start of one. An item is found only when **every** word matches something about it, and it carries the one reason it was found:

| Field | Weight (exact / start) | Reason shown |
|---|---|---|
| Name | 10 / 8 | (none needed) |
| Other names (aliases) | 8 / 6 | "Also called “hot glue gun”" |
| The kit it is in | 6 / 5 | "In the kit …" |
| The place it is kept, or any place above it | 5 / 4 | "Kept in Office › Cabinet 1 › Shelf A" |
| Category | 4 / 3 | "Category: Medical Supplies" |
| A V1.8 knowledge-base kind ("ribbon", "batteries") | 3 / 2 | "Kind: Ribbon and yarn" |

Bonuses when every word is in the name: +10 to +20, more for a name with fewer extra words, +100 for the exact full name, else +5 when the first word starts the name. Inactive records sink by 40 but stay findable. An item, kit or place ID (typed or scanned in any spelling, `itm 0135`) scores 1,000 and opens directly.

Then the explicit records are followed **one hop from a strong match** (every word in the name or another name), never from a weak one and never as a chain: the items linked to it (read from the other end: "Used with Stapler - Big", "Replaces …", "Goes in Sewing Kit") and the kits that include it ("Includes Sewing Kit"). When nothing matches the words themselves, items of the same knowledge-base kind are offered ("twine" finds ribbon and yarn); beside a real match they would only be noise.

Places match on their own name and the places above them ("Inside Logistics Office"); kits on their name and their place, and through their items as above. Each kind is sorted best first with ties broken by one shared `Intl.Collator` (numeric, case-insensitive), so the same words always list the same way; at most 50 per kind, with the true total. No score, percentage or "best match" badge is shown.

**Go to.** A fixed list of words opens existing pages and filters (`SHORTCUTS` in `src/search.ts`): "overdue" → Attention's overdue loans, "low stock", "out of stock", "needs count", "expiring", "unclassified", page names, and a loan reference. Administration and the Staff Directory are offered only to administrators. Nothing is parsed beyond these words, and nothing changes a record.

## 3. Permissions (enforced in the Worker)

- `/api/staff/search` is a staff route: signed out → 401; another department's member → 403 before anything is read; an offline cataloguing lease (V1.6) → refused, it is for cataloguing only. It never contains people.
- People come only from `/api/staff/admin/directory/search`, behind the existing administrator gate (staff → 403, tested). The answer holds name, department, position, officer and active, never a student ID, a sign-in, an ID card or what someone borrowed (`tests/search-api.test.ts` asserts the absent fields). At most 8 people per answer: the directory is never sent whole.
- Nothing was added to the public catalog, the Lending Hub or Self-Service (tested against their routes).
- The browser keeps the index in memory only for the page's life and keeps no query history.

## 4. Performance

`tests/search-performance.test.ts` seeds the real catalog plus deterministic synthetic items, nested places, kits (six items each) and links up to each tier; `npm test` runs 500 and 5,000 with budgets, `SEARCH_PERF=1` adds 10,000. Node 22 on a 4-core cloud container with `node:sqlite` standing in for D1 (query work, not D1's network round trip); read the shape, not the absolute figure. Measured 2026-10-07:

| Items | Index rows read | Index JSON | gzip | Worker build (ms) | Browser prepare (ms) | Keystroke median / p95 (ms) | Results per kind (max) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 500 | 715 | 105 KB | 8 KB | 2 | 21 | 0.36 / 0.77 | 50 |
| 5,000 | 7,150 | 1,122 KB | 54 KB | 14 | 123 | 3.08 / 10.72 | 50 |
| 10,000 | 14,300 | 2,253 KB | 97 KB | 27 | 207 | 7.07 / 31.57 | 50 |

Staff Directory search, 600 people: median 3.2 ms in the Worker, 1,405 bytes answered (8 of 150 matches).

- **D1 reads.** The index costs its row count once per catalog change per device; every other opening is a 304 that reads one row. Typing reads nothing.
- **Startup.** The palette is a separate chunk (about 22 KB of JS, 8 KB gzipped, plus 6 KB of CSS), fetched on first use; a test fails if `src/staff.ts` imports it statically. Rendered on a throwaway Worker at 508 items, a cold load to the first Items row took 438 ms and a section switch 84 ms, in line with V1.10; the first search after sign-in (code and index fetched) took 211 ms to the first result and a later one 148 ms (`docs/visual-research/v1.11/timings.json`).
- **What fixed the one slow spot.** Sorting with `localeCompare` and options built a collator per comparison; at 5,000 items the keystroke p95 was 77 ms. One shared collator brought it to about 10 ms.
- **Headroom.** At 5,000 items (ten times today's catalog) a keystroke stays well under a frame on this machine. At 10,000 the p95 is about 32 ms here, and a slow phone may be several times slower; if the catalog ever grows that far, the next step is to rank in a Web Worker or narrow the index, measured first.

## 5. Item links

`item_relationships(item_id, related_id, kind, created_at, created_by)`, primary key `(item_id, related_id)` plus a unique index on the unordered pair, so a pair is linked once whichever end it was set from; `CHECK(item_id <> related_id)`; kinds `ALTERNATIVE`, `REPLACEMENT`, `USED_WITH`, `CONTENTS`. Each reads from its end (`RELATION_WORDS` in `src/relation-policy.ts`): Used with / Used with, Alternative to / Alternative to, Replaced by / Replaces, Holds / Goes in. `POST /api/staff/items/:id/links` and `DELETE /api/staff/items/:id/links/:other` write `ITEM_LINKED` / `ITEM_UNLINKED` to `audit_log` on the item it was changed from and bump the catalog revision, so every open search refreshes. A link changes nothing about either item (no stock, place or record edit; tested). Kits stay V1.8's list of components; a container that is an item ("Sewing Kit" the box) can hold its contents through a `CONTENTS` link.

## 6. The optional Workers AI second opinion

Amendment §13 allows it in V1.11 only, off by default. On Earl's decision (2026-10-07, "Measure first") V1.11 ships only its boundary: `src/catalog-ai.ts` (the single payload builder: typed name, other names and the live option lists, nothing else; answers kept only when they are exactly an option; at most Weak, "AI suggestion") and a one-command fixture measurement (`npm run evaluate:suggestions -- --ai`, needs a Cloudflare account ID and token). There is no binding, endpoint, setting or UI, and a test fails if any appears. Details and the numbers so far are in the release record.
