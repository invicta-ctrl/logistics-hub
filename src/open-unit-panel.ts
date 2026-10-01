import { OPEN_UNIT_CONDITIONS } from "./catalog-policy";
import { type Html, api, failure, formatDateTime, html, label, mount, plural, toast, units } from "./ui";

/*
 * The open-unit controls (Part 5B) for one open-unit Consumable, shared by the item sheet and the
 * Stock & Pantry record panel. Open, Record use and the condition chips change no stock; Mark empty
 * takes exactly one unit off, after an inline confirmation. The Worker decides every rule.
 */

export type OpenUnit = { id: string; openedAt: string; openedBy: string; condition: string | null };
export type OpenUnitState = { id: string; name: string; unit: string; onHand: number; openUnits: OpenUnit[]; usesRecorded?: number; unitsEmptied?: number };
type Summary = { onHand: number; openUnits: OpenUnit[] };
type Confirm = { kind: "open" | "empty" | "correct"; unitId: string | null } | null;

/** "8 reams on hand · 7 sealed · 1 open · Low": sealed is derived, never stored. */
export function sealedLine(onHand: number, open: number, condition: string | null = null): string {
  if (open > onHand) return `${open} open, more than the ${onHand} on hand · needs review`;
  return `${onHand - open} sealed · ${open} open${condition ? ` · ${label(condition)}` : ""}`;
}

function markup(state: OpenUnitState, confirm: Confirm): Html {
  const { unit, onHand, openUnits } = state;
  const open = openUnits.length;
  const inconsistent = open > onHand;
  const confirmBox = (text: string, action: Html) => html`<div class="inline-confirm" role="group" aria-label="Confirm">
      <p>${text}</p><div class="inline-confirm__actions">${action}<button type="button" class="button button--ghost button--sm" data-ou-cancel>Cancel</button></div></div>`;
  return html`<section class="card open-units" aria-labelledby="open-units-title">
    <div class="card__head"><h3 id="open-units-title">Open ${units(2, unit)}</h3>
      ${confirm?.kind === "open" ? "" : html`<button type="button" class="button button--secondary button--sm" data-ou="open" ${onHand > open ? "" : html`disabled`}>${open ? `Open another ${unit}` : `Open a ${unit}`}</button>`}</div>
    <p class="card__text">${onHand} ${units(onHand, unit)} on hand · ${sealedLine(onHand, open)}</p>
    ${inconsistent ? html`<div class="callout"><p><strong>Open-unit state needs review.</strong> ${plural(open, unit)} ${open === 1 ? "is" : "are"} recorded open but only ${onHand} ${onHand === 1 ? "is" : "are"} on hand. Close the ones that are not really open, or record a count.</p></div>` : ""}
    ${confirm?.kind === "open" ? confirmBox(`${plural(open, unit)} ${open === 1 ? "is" : "are"} already open. Use the existing ${open === 1 ? unit : units(2, unit)} when possible.`,
      html`<button type="button" class="button button--primary button--sm" data-ou="open" data-confirmed>Open another</button>`) : ""}
    ${open ? html`<ul class="open-unit-list">${openUnits.map((entry, index) => html`<li class="open-unit" data-key="${entry.id}">
        <p class="open-unit__title">${open > 1 ? `${unit[0]!.toUpperCase()}${unit.slice(1)} ${index + 1}` : `Open ${unit}`} <span class="cell-sub">Opened ${formatDateTime(entry.openedAt)} by ${entry.openedBy}</span></p>
        <div class="chips chips--flush" role="group" aria-label="How much is left">${OPEN_UNIT_CONDITIONS.map((condition) => html`<button type="button" class="chip" data-ou="condition" data-condition="${condition}" data-unit="${entry.id}" aria-pressed="${entry.condition === condition}">${label(condition)}</button>`)}</div>
        ${confirm?.unitId === entry.id && confirm.kind === "empty"
          ? confirmBox(`This will reduce on-hand stock from ${onHand} to ${onHand - 1} ${units(onHand - 1, unit)}.`, html`<button type="button" class="button button--primary button--sm" data-ou="empty" data-unit="${entry.id}" data-confirmed>Mark empty</button>`)
          : confirm?.unitId === entry.id && confirm.kind === "correct"
          ? confirmBox(`Close this ${unit} without changing stock? Only if it was never really opened.`, html`<button type="button" class="button button--danger button--sm" data-ou="correct" data-unit="${entry.id}" data-confirmed>Close as not opened</button>`)
          : html`<div class="row-actions open-unit__actions">
              <button type="button" class="button button--primary button--sm" data-ou="empty" data-unit="${entry.id}">Mark empty</button>
              <button type="button" class="button button--secondary button--sm" data-ou="use" data-unit="${entry.id}">Record use</button>
              <button type="button" class="button button--ghost button--sm" data-ou="correct" data-unit="${entry.id}">Not really open</button>
            </div>`}
      </li>`)}</ul>` : html`<p class="muted">No ${unit} is open. Open one when you start using it; stock stays the same until it is empty.</p>`}
    ${state.usesRecorded !== undefined ? html`<p class="cell-sub">${plural(state.usesRecorded, "use")} recorded · ${state.unitsEmptied ?? 0} ${units(state.unitsEmptied ?? 0, unit)} used up</p>` : ""}
  </section>`;
}

/**
 * Renders the controls into `container` and handles their clicks. `state()` is read on every render;
 * `onChanged` runs after the Worker accepted an action (refresh whatever shows the item).
 */
export function bindOpenUnits(container: HTMLElement, state: () => OpenUnitState | null, onChanged: (summary: Summary) => void | Promise<void>): { render: () => void } {
  let confirm: Confirm = null;
  let busy = false;
  // One key per intended action, kept until it succeeds, so a retry or double tap is recorded once.
  const keys = new Map<string, string>();
  const keyFor = (intent: string) => keys.get(intent) ?? keys.set(intent, crypto.randomUUID()).get(intent)!;
  const render = () => {
    const current = state();
    if (!current) { mount(container, html``); return; }
    mount(container, markup(current, confirm));
  };
  const focusAfter = (selector: string) => container.querySelector<HTMLElement>(selector)?.focus();

  container.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-ou-cancel]")) { const unitId = confirm?.unitId; confirm = null; render(); focusAfter(unitId ? `[data-key="${unitId}"] [data-ou="empty"]` : "[data-ou=open]"); return; }
    const button = target.closest<HTMLButtonElement>("[data-ou]");
    const current = state();
    if (!button || !current || busy) return;
    const action = button.dataset.ou!;
    const unitId = button.dataset.unit ?? null;
    const confirmed = button.hasAttribute("data-confirmed");
    if (!confirmed && (action === "empty" || action === "correct" || (action === "open" && current.openUnits.length))) {
      confirm = { kind: action as "open" | "empty" | "correct", unitId };
      render();
      focusAfter(".inline-confirm [data-confirmed]");
      return;
    }
    const intent = action === "open" ? "open" : `${action}:${unitId}`;
    const body = action === "open" || action === "use" ? { action, key: keyFor(intent), unitId } : action === "condition" ? { action, unitId, condition: button.dataset.condition } : { action, unitId };
    busy = true;
    container.setAttribute("aria-busy", "true");
    try {
      const summary = await api<Summary>(`/api/staff/items/${encodeURIComponent(current.id)}/open-units`, { method: "POST", body: JSON.stringify(body) });
      keys.delete(intent);
      confirm = null;
      toast(action === "empty" ? `Marked empty. ${summary.onHand} ${units(summary.onHand, current.unit)} on hand.`
        : action === "open" ? `${current.name}: ${current.unit} opened. Stock unchanged.`
        : action === "use" ? `Use recorded for ${current.name}. Stock unchanged.`
        : action === "correct" ? `Closed without changing stock.` : `Marked ${label(String(button.dataset.condition)).toLowerCase()}.`);
      await onChanged(summary);
    } catch (error) {
      toast(failure(error), "error");
    } finally {
      busy = false;
      container.removeAttribute("aria-busy");
      render();
      if (action === "condition") focusAfter(`[data-unit="${unitId}"][data-condition="${button.dataset.condition}"]`);
      else focusAfter(action === "use" ? `[data-key="${unitId}"] [data-ou="use"]` : "[data-ou=open]");
    }
  });
  return { render };
}
