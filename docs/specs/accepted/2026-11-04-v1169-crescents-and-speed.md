# V1.16.9 No crescents, and speed

Status: **Accepted** by Earl on 2026-11-04 in chat. Parent: V1.16.8 (`main` `bf5d682`). Writer: Claude.

Earl's words, with his screenshot of a green rounded left edge: "other tabs still have this, please clean. the website is slow too, i need you to fix it because it stutters so bad and slow."

## 1. No coloured edge on a rounded box

V1.16.8 took the gold edge off the rail. The same pattern, a 3–4 px coloured left edge on a rounded box, curves into a crescent wherever it appears. It remained on:
- `.verdict`, the status line that opens each Administration section (green, amber or red). This is the green crescent in Earl's screenshot.
- `.banner--ok` and `.banner--warn`.
- `.kit-part` (green, amber or red, by the part's state).
- `.palette__option[aria-selected]`, the chosen search result (an oxblood edge).

**The change:** every edge goes. Tone is carried by the icon and the badge each box already has. A box that needs attention keeps its tinted fill and tinted 1 px border, and a red verdict gains the same tint as an amber one. The chosen search result keeps its tinted fill with a 1 px ring.

**Kept:** the straight 3 px stripe on square table and list rows (open row, overdue loan). It has no radius, so it draws no crescent.

**Rule from now on:** no coloured edge on any rounded box, anywhere.

## 2. Speed

Measured on 2026-11-04 (records: `docs/road-to-v2/releases/v1.16.9.md`).

**Why it is slow.** From the office's network, requests reach Cloudflare's San Jose edge, and each D1 query from there costs about 150 ms:

| Live request | Median |
|---|---|
| Static file | 254 ms |
| 1 query | 397 ms |
| 3 queries | 717 ms |

Every staff answer makes two to five D1 calls in a row: the session, then its own reads. Each staff page asks for three answers. So a page waits 0.7–1 s on its data before drawing.

**Why it stutters.** Two decorations animated forever:
- a glint crossing the rail's lit plate every 8 seconds;
- the "breathing" live dot in Administration.

They cost a style pass on every frame, about 75 a second while idle (Administration: 151 style recalculations in 2 s at a 4× CPU slowdown). That competes with every scroll and page change.

**The changes:**
1. **Smart Placement** (`wrangler.jsonc` `"placement": { "mode": "smart" }`). Cloudflare runs the Worker beside D1, so its queries are nearly free and the visitor pays one long hop.
   - Trade-off: `run_worker_first` sends file requests through the placed Worker too. A first visit's files may take one hop longer. Hashed files are cached for a year by the browser and the service worker, so repeat visits are unaffected.
   - Rollback: remove the block.
2. **Fewer round trips in code.** The public catalog reads the catalog and the Self-Service setting together, and the Self-Service catalog reads its items and shared places together, not one after the other.
3. **No endless decorative animation.** The rail glint and the breathing dot are removed; the lit plate and the live dot stay, still. Spinners and loading shimmer remain, because they run only while something loads.

**Not changed:** the API answers, permissions, data, the CSP and caching headers. There is no migration.

**Recorded as not done:**
- D1 read replication. It is a production database setting and needs its own owner authority and Cloud Operations.
- Table layout of the Items list. It costs a frame hitch on first draw, about 0.1 s at normal speed; that would be a later slice.

## 3. Security tier

HIGH under `AGENTS.md` (deployment configuration). The receipt goes on the PR, and an independent review is required before the merge.
