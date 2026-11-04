import { PAGE_SIZE, type Slice, pageNumbers, pageOf } from "./pager-math";
import { type Html, html, icon, writeParams } from "./ui";

export { PAGE_SIZE, type Slice, pageNumbers, pageOf };

/**
 * V1.16.12 long lists, one way everywhere (Earl, 2026-11-04: numbered pages, 25 rows, collapsible groups on phones).
 *
 * - Desktop: numbered pages of PAGE_SIZE rows, "‹ Previous 1 2 3 … 9 Next ›" and "26–50 of 214". The page lives in the
 *   address (`?page=` or the list's own key), so Back, refresh and a shared link keep it.
 * - Phone (below 48rem): the same list grows by PAGE_SIZE ("Show 25 more") instead of turning pages, so a thumb keeps its place.
 *   Lists drawn in groups fold instead, through `foldMarkup`.
 * A new question (search, filter, sort) starts again at the first page.
 */
/** Rows a folded phone group shows before its "Show all N". */
export const GROUP_PREVIEW = 5;

const phoneQuery = typeof matchMedia === "function" ? matchMedia("(max-width: 47.99rem)") : null;
/** True on a phone-width screen, where lists grow and groups fold rather than page. */
export const onPhone = (): boolean => Boolean(phoneQuery?.matches);
/** Calls back when the screen crosses the phone width (a turned tablet, a resized window); returns the way to stop. */
export function onLayoutChange(callback: () => void): () => void {
  phoneQuery?.addEventListener("change", callback);
  return () => phoneQuery?.removeEventListener("change", callback);
}




const count = (n: number) => n.toLocaleString();

/** Desktop pager: nothing when everything fits on one page. `label` names the list for screen readers ("Items pages"). */
export function pagerMarkup(slice: Slice<unknown>, label: string, key = "page"): Html {
  if (slice.pages <= 1) return html``;
  const { page, pages, first, total } = slice;
  const last = Math.min(first + PAGE_SIZE, total);
  return html`<nav class="pager" aria-label="${label}" data-pager="${key}">
    <p class="pager__range">${count(first + 1)}–${count(last)} <span>of ${count(total)}</span></p>
    <ul class="pager__pages">
      <li><button type="button" class="pager__step" data-page="${page - 1}" ${page === 1 ? html`disabled` : ""}>${icon("back")}<span>Previous</span></button></li>
      ${pageNumbers(page, pages).map((n) => n === "…"
        ? html`<li class="pager__gap" aria-hidden="true">…</li>`
        : html`<li><button type="button" class="pager__n" data-page="${n}" aria-label="Page ${n}" ${n === page ? html`aria-current="page"` : ""}>${count(n)}</button></li>`)}
      <li><button type="button" class="pager__step" data-page="${page + 1}" ${page === pages ? html`disabled` : ""}><span>Next</span>${icon("next")}</button></li>
    </ul>
  </nav>`;
}

/** Phone: "Show 25 more" under a list that grows in place, with how many are shown. Nothing once all are. */
export function moreMarkup(shown: number, total: number, key = "page"): Html {
  if (shown >= total) return html``;
  return html`<p class="table-more pager-more"><button type="button" class="button button--secondary" data-more-rows="${key}">Show ${count(Math.min(PAGE_SIZE, total - shown))} more <span class="muted">(${count(shown)} of ${count(total)} shown)</span></button></p>`;
}

/**
 * One list's place: a page number on desktop, a growing count on a phone. Draw with `slice`, put `footer` under the rows,
 * and hand clicks to `handle`. `ask` restarts at the first page when the question behind the list changes.
 */
export class ListPager {
  page: number;
  limit = PAGE_SIZE;
  private question = "";
  private lastPages = 1;

  /** `key` is the list's address key (`page` for a page's main list); `inAddress` false keeps it out of the address. */
  constructor(readonly key = "page", readonly label = "Pages", private readonly inAddress = true) {
    const fromAddress = Number(new URLSearchParams(window.location.search).get(key));
    this.page = inAddress && Number.isInteger(fromAddress) && fromAddress > 1 ? fromAddress : 1;
  }

  /**
   * Starts again at the first page when `question` differs from the last one asked, and says so (true).
   * The first question keeps an addressed page.
   */
  ask(question: string): boolean {
    const changed = Boolean(this.question) && question !== this.question;
    if (changed) { this.page = 1; this.limit = PAGE_SIZE; this.write(); }
    this.question = question;
    return changed;
  }

  /** The rows to draw now, and the pager or "Show more" to put under them. */
  slice<T>(list: readonly T[]): { rows: T[]; first: number; footer: Html } {
    if (onPhone()) {
      const rows = list.slice(0, this.limit);
      return { rows, first: 0, footer: moreMarkup(rows.length, list.length, this.key) };
    }
    const slice = pageOf(list, this.page, PAGE_SIZE);
    this.lastPages = slice.pages;
    if (slice.page !== this.page) { this.page = slice.page; this.write(); }
    return { rows: slice.rows, first: slice.first, footer: pagerMarkup(slice, this.label, this.key) };
  }

  /** Makes sure the row at `index` of the list is drawn (an item opened by link or search). */
  reveal(index: number): void {
    if (index < 0) return;
    if (onPhone()) this.limit = Math.max(this.limit, index + 1);
    else { const page = Math.floor(index / PAGE_SIZE) + 1; if (page !== this.page) { this.page = page; this.write(); } }
  }

  /**
   * Handles a click on this list's pager or "Show more". Returns what changed, so the caller draws again and moves focus:
   * "page" to the top of the list, "more" to the first new row (index `from`). Null when the click was not ours.
   */
  handle(target: Element): { kind: "page" | "more"; from: number } | null {
    const step = target.closest<HTMLButtonElement>(`[data-pager="${this.key}"] [data-page]`);
    if (step && !step.disabled) {
      this.page = Math.min(Math.max(1, Number(step.dataset.page)), this.lastPages);
      this.write();
      return { kind: "page", from: (this.page - 1) * PAGE_SIZE };
    }
    if (target.closest(`[data-more-rows="${this.key}"]`)) {
      const from = this.limit;
      this.limit += PAGE_SIZE;
      return { kind: "more", from };
    }
    return null;
  }

  private write(): void {
    if (this.inAddress) writeParams({ [this.key]: this.page > 1 ? String(this.page) : null });
  }
}

/**
 * After a page turn: bring the list's top into view (under the sticky bar) and put focus on it, so a keyboard or screen
 * reader continues from the new page's first row. After "Show more": focus the first new row without moving the page.
 */
export function landOn(list: HTMLElement | null, change: { kind: "page" | "more"; from: number }, rows: () => HTMLElement[]): void {
  if (!list) return;
  if (change.kind === "more") { rows()[change.from]?.focus({ preventScroll: true }); return; }
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  list.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  const first = rows()[0];
  if (first) { first.focus({ preventScroll: true }); return; }
  if (!list.hasAttribute("tabindex")) list.setAttribute("tabindex", "-1");
  list.focus({ preventScroll: true });
}

/**
 * A phone group that folds: its title (with the count) toggles it, it opens on its first GROUP_PREVIEW rows, and
 * "Show all N" draws the rest. `open` and `all` come from the caller's own state, keyed by group.
 */
export function foldMarkup(key: string, title: Html, total: number, body: (limit: number) => Html, state: { open: boolean; all: boolean }, headingLevel: 2 | 3 = 2): Html {
  const limit = state.all ? total : GROUP_PREVIEW;
  const heading = headingLevel === 2
    ? html`<h2 class="fold__title"><button type="button" class="fold__toggle" data-fold="${key}" aria-expanded="${state.open}">${title}<span class="fold__count">${count(total)}</span>${icon("sortDown")}</button></h2>`
    : html`<h3 class="fold__title"><button type="button" class="fold__toggle" data-fold="${key}" aria-expanded="${state.open}">${title}<span class="fold__count">${count(total)}</span>${icon("sortDown")}</button></h3>`;
  return html`<section class="fold${state.open ? " is-open" : ""}" data-fold-group="${key}">${heading}<div class="fold__body"${state.open ? "" : html` hidden`}>${body(limit)}${state.open && !state.all && total > GROUP_PREVIEW ? html`<p class="fold__more"><button type="button" class="button button--secondary button--sm" data-fold-all="${key}">Show all ${count(total)}</button></p>` : ""}</div></section>`;
}

/** Keeps folded groups' sticky titles just under a sticky bar above them (`--fold-top`), as that bar grows or shrinks. */
export function stickBelow(container: HTMLElement, bar: HTMLElement | null): () => void {
  if (!bar || typeof ResizeObserver !== "function") return () => undefined;
  const set = () => container.style.setProperty("--fold-top", `${bar.offsetHeight}px`);
  const watch = new ResizeObserver(set);
  watch.observe(bar);
  set();
  return () => watch.disconnect();
}

/** Folding state for a list's groups: open or closed, and whether all rows show. Groups start open. */
export class Folds {
  private readonly closed = new Set<string>();
  private readonly all = new Set<string>();
  state(key: string): { open: boolean; all: boolean } { return { open: !this.closed.has(key), all: this.all.has(key) }; }
  /** Handles a fold toggle or "Show all"; true when the caller should draw again. */
  handle(target: Element): { kind: "toggle" | "all"; key: string } | null {
    const toggle = target.closest<HTMLElement>("[data-fold]");
    if (toggle) { const key = toggle.dataset.fold!; if (this.closed.has(key)) this.closed.delete(key); else this.closed.add(key); return { kind: "toggle", key }; }
    const all = target.closest<HTMLElement>("[data-fold-all]");
    if (all) { this.all.add(all.dataset.foldAll!); return { kind: "all", key: all.dataset.foldAll! }; }
    return null;
  }
  /** A new question shows each group's preview again (folds stay as the person left them). */
  reset(): void { this.all.clear(); }
}

/**
 * Newer and Older for a history read by cursor (V1.16.12), whose total is not known: the range shown and two steps.
 * `first` is the index of the first row drawn, `shown` how many are drawn, `older` whether anything older can be shown.
 */
export function stepsMarkup(first: number, shown: number, older: boolean, label: string, key = "page"): Html {
  if (!first && !older) return html``;
  return html`<nav class="pager" aria-label="${label}" data-pager="${key}">
    <p class="pager__range">${count(first + 1)}–${count(first + shown)} <span>newest first</span></p>
    <ul class="pager__pages">
      <li><button type="button" class="pager__step" data-page="newer" ${first ? "" : html`disabled`}>${icon("back")}<span>Newer</span></button></li>
      <li><button type="button" class="pager__step" data-page="older" ${older ? "" : html`disabled`}><span>Older</span>${icon("next")}</button></li>
    </ul>
  </nav>`;
}

/** Which step of a stepsMarkup pager was pressed, if any. */
export function stepOf(target: Element, key = "page"): "newer" | "older" | null {
  const step = target.closest<HTMLButtonElement>(`[data-pager="${key}"] [data-page]`);
  if (!step || step.disabled) return null;
  return step.dataset.page === "newer" ? "newer" : step.dataset.page === "older" ? "older" : null;
}

/**
 * After a fold is drawn again: "Show all" puts focus on the first row that was hidden; a toggle keeps focus on the title, and a fold
 * closed after its title was stuck (scrolled past) is brought back into view rather than left above the screen.
 */
export function landOnFold(group: HTMLElement | null, change: { kind: "toggle" | "all" }, rows: string): void {
  if (!group) return;
  if (change.kind === "all") { group.querySelectorAll<HTMLElement>(rows)[GROUP_PREVIEW]?.focus({ preventScroll: true }); return; }
  const toggle = group.querySelector<HTMLElement>("[data-fold]");
  toggle?.focus({ preventScroll: true });
  const below = parseFloat(getComputedStyle(group).getPropertyValue("--fold-top")) || 0;
  if (group.getBoundingClientRect().top < below) group.scrollIntoView({ block: "start" });
}
