import { MOVEMENT_REASONS } from "./catalog-policy";
import { type Html, api, failure, html, icon, label, mount, setMessage, toast, units } from "./ui";

export type Target = { id: string; name: string; unit: string; onHand: number };
export type Recorded = { onHand: number; change: number };
/** A row action's starting point: move the figure by `delta` (or to `total`) and suggest a reason. */
export type Preset = { delta?: number; total?: number; reason?: string; reorderId?: string | null; context?: string };

const TITLES: Record<string, string> = {
  OPENING_BALANCE: "Opening balance", STOCK_IN: "Stock in", STOCK_OUT: "Stock out", COUNT_ADJUSTMENT: "Count", ISSUE: "Issued (legacy system)",
  LOAN_OUT: "Lent out", LOAN_RETURN: "Returned from loan"
};

/** "Stock out · Damaged", "Count · confirmed", "Lent out · Juan": a movement as staff say it. */
export function movementTitle(type: string, change: number, reason: string | null, borrower: string | null = null): string {
  if (type === "COUNT_ADJUSTMENT") return change === 0 ? "Count · confirmed" : "Count correction";
  if (borrower) return `${TITLES[type] ?? type} · ${borrower}`;
  return reason ? `${TITLES[type] ?? type} · ${label(reason)}` : TITLES[type] ?? type;
}

export const signed = (value: number): string => value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";

// A physical count explains a change in either direction; "Other" always needs a note.
const REASONS = {
  up: [...MOVEMENT_REASONS.IN.filter((reason) => reason !== "OTHER"), "COUNT", "OTHER"],
  down: [...MOVEMENT_REASONS.OUT.filter((reason) => reason !== "OTHER"), "COUNT", "OTHER"],
  same: ["COUNT"]
} as const;
const MAX = 100_000;

/**
 * The quantity editor: the on-hand figure itself is the input. Change it and say why; the
 * Worker records the difference as a stock in, stock out or count. `prefix` keeps IDs unique.
 */
export function quantityEditor(prefix: string): Html {
  return html`<div class="qty-editor">
      <div class="qty-editor__row">
        <button type="button" class="qty-editor__step" data-step="-1" aria-label="One less">−</button>
        <input class="qty-editor__input" id="${prefix}-total" name="total" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Quantity on hand" aria-describedby="${prefix}-change" disabled />
        <button type="button" class="qty-editor__step" data-step="1" aria-label="One more">+</button>
        <span class="qty-editor__unit" data-unit></span>
      </div>
      <p class="qty-editor__change" id="${prefix}-change" aria-live="polite" data-change></p>
    </div>
    <p class="form-context" data-context hidden></p>
    <div class="qty-editor__details" data-details hidden>
      <fieldset class="reason-picker"><legend>Reason <span class="field__required">required</span></legend><div class="reason-picker__options" data-reasons></div></fieldset>
      <div class="field"><label for="${prefix}-note"><span data-note-label>Note</span> <span class="field__optional" data-note-optional>optional</span></label><input id="${prefix}-note" name="note" maxlength="500" autocomplete="off" /></div>
      <div class="form-alert" role="alert" hidden data-alert></div>
      <div class="form-actions"><button class="button button--primary" type="submit" data-submit>Save</button><button class="button button--ghost" type="button" data-cancel>Cancel</button></div>
    </div>
    <button type="button" class="text-link qty-editor__count" data-count hidden>${icon("check")}Confirm a physical count</button>`;
}

/**
 * Wires the editor to one target item. The figure the editor started from goes with each
 * save, so a change made elsewhere meanwhile is refused instead of overwritten. Each attempt
 * carries an idempotency key, renewed whenever the form changes.
 */
export function bindQuantityEditor(form: HTMLFormElement, options: {
  target: () => Target | null;
  onRecorded: (target: Target, result: Recorded, reason: string) => void | Promise<void>;
}): { refresh: () => void; preset: (preset: Preset) => void } {
  const input = form.querySelector<HTMLInputElement>("input[name=total]")!;
  const note = form.querySelector<HTMLInputElement>("input[name=note]")!;
  const alert = form.querySelector<HTMLElement>("[data-alert]")!;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]")!;
  const details = form.querySelector<HTMLElement>("[data-details]")!;
  const change = form.querySelector<HTMLElement>("[data-change]")!;
  const context = form.querySelector<HTMLElement>("[data-context]")!;
  const countButton = form.querySelector<HTMLButtonElement>("[data-count]")!;
  const reasonsBox = form.querySelector<HTMLElement>("[data-reasons]")!;
  let key = crypto.randomUUID();
  let base = 0;
  let targetId: string | null = null;
  let counting = false;
  let reorderId: string | null = null;
  let wanted: string | null = null;
  let shownReasons = "";

  const parse = (): number | null => {
    const value = input.value.trim().replace(/[−–]/g, "-");
    if (/^[+-]\d{1,6}$/.test(value)) return base + Number(value);
    return /^\d{1,6}$/.test(value) ? Number(value) : null;
  };
  const chosen = () => form.querySelector<HTMLInputElement>("input[name=reason]:checked")?.value ?? "";
  const dirty = () => counting || input.value.trim() !== String(base);

  const update = () => {
    const target = options.target();
    form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(".qty-editor button, .qty-editor input").forEach((element) => { element.disabled = !target; });
    if (!target) {
      input.value = "";
      mount(form.querySelector("[data-unit]")!, html``);
      mount(change, html``);
      details.hidden = true;
      countButton.hidden = true;
      return;
    }
    const total = parse();
    const valid = total !== null && total >= 0 && total <= MAX;
    const delta = valid ? total - base : 0;
    form.querySelector("[data-unit]")!.textContent = `${units(valid ? total : base, target.unit)} on hand`;
    const stale = target.onHand !== base ? html` <span class="qty-editor__stale">${icon("alert")}Someone else changed this to ${target.onHand}. Cancel to start from the new figure.</span>` : html``;
    mount(change, !input.value.trim() ? html`<span class="is-error">Enter the quantity on hand.</span>`
      : total === null ? html`<span class="is-error">Enter a whole number, or +5 / −2 to add or remove.</span>`
      : !valid ? html`<span class="is-error">${total < 0 ? `Only ${base} on hand; it cannot go below 0.` : `At most ${MAX.toLocaleString()}.`}</span>`
      : delta ? html`<span class="${delta > 0 ? "is-up" : "is-down"}">${signed(delta)}</span> ${base} → <strong>${total}</strong>${stale}`
      : counting ? html`Matches the record. Confirming logs the count; the quantity stays ${base}.${stale}` : stale);
    input.classList.toggle("is-edited", dirty());
    const open = valid && (delta !== 0 || counting);
    details.hidden = !open;
    countButton.hidden = open || !valid;
    if (!open) return;
    const direction = delta > 0 ? "up" : delta < 0 ? "down" : "same";
    if (shownReasons !== direction) {
      const previous = chosen();
      shownReasons = direction;
      mount(reasonsBox, html`${REASONS[direction].map((reason) => html`<label class="reason-chip"><input type="radio" name="reason" value="${reason}" ${reason === (wanted ?? previous) || (direction === "same") ? html`checked` : ""} /><span>${label(reason)}</span></label>`)}`);
    }
    const reason = chosen();
    const noteRequired = reason === "OTHER";
    form.querySelector("[data-note-optional]")!.textContent = noteRequired ? "required" : "optional";
    note.required = noteRequired;
    note.placeholder = reason === "COUNT" ? "Physical count" : reason === "DELIVERY" ? "Supplier, request or reference" : "";
    if (!submit.classList.contains("is-done")) {
      submit.textContent = reason === "COUNT" ? (delta ? `Save count of ${total}` : "Confirm count") : delta > 0 ? `Add ${delta}` : `Remove ${Math.abs(delta)}`;
    }
  };

  const reset = (to = options.target()?.onHand ?? 0) => {
    base = to;
    counting = false;
    reorderId = null;
    wanted = null;
    shownReasons = "";
    input.value = options.target() ? String(base) : "";
    note.value = "";
    context.hidden = true;
    key = crypto.randomUUID();
    setMessage(alert, "");
    update();
  };

  const invalid = (element: HTMLElement, message: string) => {
    element.setAttribute("aria-invalid", "true");
    setMessage(alert, message);
    element.focus();
  };

  form.addEventListener("input", () => {
    key = crypto.randomUUID();
    form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid"));
    setMessage(alert, "");
    update();
  });
  form.addEventListener("change", update);
  input.addEventListener("focus", () => input.select());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dirty()) { event.preventDefault(); event.stopPropagation(); reset(base); return; }
    const step = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    input.value = String(Math.max(0, (parse() ?? base) + step));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  form.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => button.addEventListener("click", () => {
    input.value = String(Math.max(0, Math.min(MAX, (parse() ?? base) + Number(button.dataset.step))));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }));
  countButton.addEventListener("click", () => {
    counting = true;
    update();
    input.focus();
  });
  form.querySelector("[data-cancel]")!.addEventListener("click", () => { reset(base); input.focus(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const target = options.target();
    if (!target) return setMessage(alert, "Choose an item first.");
    const total = parse();
    if (total === null || total < 0 || total > MAX) return invalid(input, "Enter the quantity on hand as a whole number.");
    const reason = chosen();
    if (!reason) return invalid(reasonsBox.querySelector("input") ?? input, "Choose a reason.");
    if (note.required && !note.value.trim()) return invalid(note, "Add a short note for “Other”.");
    const delta = total - base;
    const body = reason === "COUNT"
      ? { kind: "COUNT", quantity: total, note: note.value.trim() || "Physical count", key }
      : { kind: delta > 0 ? "IN" : "OUT", quantity: Math.abs(delta), reason, note: note.value, expectedOnHand: base, key, reorderId: delta > 0 ? reorderId : null };
    submit.disabled = true;
    setMessage(alert, "");
    try {
      const result = await api<Recorded>(`/api/staff/items/${encodeURIComponent(target.id)}/movements`, { method: "POST", body: JSON.stringify(body) });
      toast(`${target.name}: ${base} → ${result.onHand} ${units(result.onHand, target.unit)} (${label(reason).toLowerCase()}).`);
      reset(result.onHand);
      input.classList.add("is-saved");
      window.setTimeout(() => input.classList.remove("is-saved"), 1200);
      await options.onRecorded(target, result, reason);
    } catch (error) {
      setMessage(alert, failure(error));
    } finally {
      submit.disabled = false;
      update();
    }
  });

  return {
    /** Call when the target or its live quantity changes. An untouched editor follows the new figure. */
    refresh: () => {
      const target = options.target();
      if (target?.id !== targetId) { targetId = target?.id ?? null; reset(target?.onHand ?? 0); return; }
      if (target && target.onHand !== base && !dirty()) { reset(target.onHand); return; }
      update();
    },
    preset: (preset) => {
      reset(options.target()?.onHand ?? base);
      counting = preset.reason === "COUNT" && preset.delta === undefined && preset.total === undefined;
      wanted = preset.reason ?? null;
      if (preset.total !== undefined) input.value = String(Math.max(0, preset.total));
      else if (preset.delta) input.value = String(Math.max(0, base + preset.delta));
      reorderId = preset.reorderId ?? null;
      context.hidden = !preset.context;
      context.textContent = preset.context ?? "";
      update();
      input.focus();
    }
  };
}
