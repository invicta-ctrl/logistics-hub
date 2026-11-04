/** V1.16.12: the arithmetic under the numbered pages (src/pager.ts), kept apart from the page so it can be tested on its own. */

/** Rows on a desktop page, and rows a phone list grows by. */
export const PAGE_SIZE = 25;

/** The page numbers to offer: the first, the last, and the current one with a neighbour each side; gaps become "…". */
export function pageNumbers(page: number, pages: number): Array<number | "…"> {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  // A gap of one page shows that page rather than "…", which would take the same room.
  for (const n of [...keep]) { if (keep.has(n + 2) && !keep.has(n + 1)) keep.add(n + 1); }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  sorted.forEach((n, index) => { if (index && n - sorted[index - 1] > 1) out.push("…"); out.push(n); });
  return out;
}

export type Slice<T> = { rows: T[]; first: number; total: number; page: number; pages: number };

/** Rows `first`..`first + size` of `list` at page `page` (clamped into range). */
export function pageOf<T>(list: readonly T[], page: number, size = PAGE_SIZE): Slice<T> {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const first = (at - 1) * size;
  return { rows: list.slice(first, first + size), first, total: list.length, page: at, pages };
}
