import { MOVEMENT_REASONS } from "./catalog-policy";
import { type Html, api, failure, html, icon, label, mount, setMessage, toast, units } from "./ui";

/** The one Stock in / Stock out / Count form, used by the item sheet and the Stock workspace. */
export const KINDS = {
  IN: { label: "Stock in", quantity: "Quantity to add", min: 1 },
  OUT: { label: "Stock out", quantity: "Quantity to remove", min: 1 },
  COUNT: { label: "Count", quantity: "Counted on the shelf", min: 0 }
} as const;
export type Kind = keyof typeof KINDS;
export type Target = { id: string; name: string; unit: string; onHand: number };
export type Recorded = { onHand: number; change: number };
type Preset = { kind?: Kind; quantity?: number; reason?: string; reorderId?: string | null; context?: string };

const TITLES: Record<string, string> = {
  OPENING_BALANCE: "Opening balance", STOCK_IN: "Stock in", STOCK_OUT: "Stock out", COUNT_ADJUSTMENT: "Count", ISSUE: "Issued (legacy system)"
};

/** "Stock out · Damaged", "Count · confirmed", "Count · −2": a movement as staff say it. */
export function movementTitle(type: string, change: number, reason: string | null): string {
  if (type === "COUNT_ADJUSTMENT") return change === 0 ? "Count · confirmed" : "Count adjustment";
  return reason ? `${TITLES[type] ?? type} · ${label(reason)}` : TITLES[type] ?? type;
}

export const signed = (value: number): string => value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";

/** Form fields; `prefix` keeps element IDs unique when two forms share a page. */
export function movementFields(prefix: string): Html {
  return html`<fieldset class="segmented"><legend class="visually-hidden">Movement type</legend>
      ${Object.entries(KINDS).map(([kind, value], index) => html`<label><input type="radio" name="kind" value="${kind}" ${index === 0 ? html`checked` : ""} /><span>${value.label}</span></label>`)}
    </fieldset>
    <p class="form-context" data-context hidden></p>
    <div class="field-row">
      <div class="field"><label for="${prefix}-quantity" data-quantity-label>${KINDS.IN.quantity}</label>
        <div class="stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="Decrease quantity">−</button><input id="${prefix}-quantity" name="quantity" type="number" inputmode="numeric" min="1" max="100000" step="1" required /><button type="button" class="stepper__button" data-step="1" aria-label="Increase quantity">+</button></div></div>
      <p class="stock-preview" id="${prefix}-preview" aria-live="polite"></p>
    </div>
    <div class="field-grid">
      <div class="field" data-reason-field><label for="${prefix}-reason">Reason</label><select id="${prefix}-reason" name="reason"></select></div>
      <div class="field"><label for="${prefix}-note"><span data-note-label>Note</span> <span class="field__optional" data-note-optional>optional</span></label><input id="${prefix}-note" name="note" maxlength="500" autocomplete="off" /></div>
    </div>
    <div class="form-alert" role="alert" hidden data-alert></div>
    <div class="form-actions"><button class="button button--primary" type="submit" data-submit>Record stock in</button></div>`;
}

/**
 * Wires the fields to one target item. Each attempt carries an idempotency key, so a
 * double-click or a retried request is recorded once; the key renews when the form changes.
 */
export function bindMovementForm(form: HTMLFormElement, options: {
  target: () => Target | null;
  onRecorded: (target: Target, kind: Kind, result: Recorded) => void | Promise<void>;
}): { refresh: () => void; preset: (preset: Preset) => void } {
  const quantity = form.querySelector<HTMLInputElement>("input[name=quantity]")!;
  const reason = form.querySelector<HTMLSelectElement>("select[name=reason]")!;
  const note = form.querySelector<HTMLInputElement>("input[name=note]")!;
  const alert = form.querySelector<HTMLElement>("[data-alert]")!;
  const button = form.querySelector<HTMLButtonElement>("[data-submit]")!;
  const context = form.querySelector<HTMLElement>("[data-context]")!;
  let key = crypto.randomUUID();
  let reorderId: string | null = null;
  let reasonsFor: Kind | null = null;
  const kind = () => (new FormData(form).get("kind") ?? "IN") as Kind;

  const update = () => {
    const current = kind();
    const config = KINDS[current];
    form.querySelector("[data-quantity-label]")!.textContent = config.quantity;
    quantity.min = String(config.min);
    if (reasonsFor !== current) {
      reasonsFor = current;
      mount(reason, current === "COUNT" ? html`` : html`<option value="">Choose a reason</option>${MOVEMENT_REASONS[current].map((value) => html`<option value="${value}">${label(value)}</option>`)}`);
      if (current === "COUNT" && !note.value) note.value = "Physical count";
      if (current !== "COUNT" && note.value === "Physical count") note.value = "";
    }
    form.querySelector<HTMLElement>("[data-reason-field]")!.hidden = current === "COUNT";
    const noteRequired = current === "COUNT" || reason.value === "OTHER";
    form.querySelector("[data-note-label]")!.textContent = current === "COUNT" ? "Reason" : "Note";
    form.querySelector("[data-note-optional]")!.textContent = noteRequired ? "required" : "optional";
    note.required = noteRequired;
    if (!button.classList.contains("is-done")) button.textContent = current === "COUNT" ? "Record count" : `Record ${config.label.toLowerCase()}`;
    button.classList.toggle("button--danger", current === "OUT");
    button.classList.toggle("button--primary", current !== "OUT");
    const target = options.target();
    const preview = form.querySelector(".stock-preview")!;
    const value = Number(quantity.value);
    if (!target || quantity.value === "" || !Number.isInteger(value) || value < config.min) { mount(preview, html``); return; }
    const after = current === "IN" ? target.onHand + value : current === "OUT" ? target.onHand - value : value;
    mount(preview, after < 0
      ? html`<span class="is-error">Only ${target.onHand} on hand</span>`
      : html`${target.onHand} → <strong>${after}</strong> ${units(after, target.unit)}${current === "COUNT" ? html` <span class="muted">(${signed(after - target.onHand)})</span>` : ""}`);
  };

  const invalid = (element: HTMLElement, message: string) => {
    element.setAttribute("aria-invalid", "true");
    setMessage(alert, message);
    element.focus();
  };

  form.addEventListener("change", () => { setMessage(alert, ""); update(); });
  form.addEventListener("input", () => { key = crypto.randomUUID(); form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid")); update(); });
  form.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((stepButton) => stepButton.addEventListener("click", () => {
    quantity.value = String(Math.max(KINDS[kind()].min, (Number(quantity.value) || 0) + Number(stepButton.dataset.step)));
    quantity.dispatchEvent(new Event("input", { bubbles: true }));
  }));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const target = options.target();
    const current = kind();
    const value = Number(quantity.value);
    if (!target) return setMessage(alert, "Choose an item first.");
    if (quantity.value === "" || !Number.isInteger(value) || value < KINDS[current].min) return invalid(quantity, "Enter a whole-number quantity.");
    if (current !== "COUNT" && !reason.value) return invalid(reason, "Choose a reason.");
    if (note.required && !note.value.trim()) return invalid(note, current === "COUNT" ? "Give a reason for the count." : "Add a short note for “Other”.");
    button.disabled = true;
    setMessage(alert, "");
    try {
      const result = await api<Recorded>(`/api/staff/items/${encodeURIComponent(target.id)}/movements`, {
        method: "POST",
        body: JSON.stringify({ kind: current, quantity: value, note: note.value, reason: current === "COUNT" ? null : reason.value, key, reorderId })
      });
      toast(`${KINDS[current].label} recorded. ${target.name} now has ${result.onHand} ${units(result.onHand, target.unit)}.`);
      // Kind and reason stay for the next entry; quantity and note start fresh.
      quantity.value = "";
      note.value = current === "COUNT" ? "Physical count" : "";
      key = crypto.randomUUID();
      reorderId = null;
      context.hidden = true;
      button.classList.add("is-done");
      mount(button, html`${icon("check")}Recorded`);
      window.setTimeout(() => { button.classList.remove("is-done"); update(); }, 1400);
      await options.onRecorded(target, current, result);
    } catch (error) {
      setMessage(alert, failure(error));
    } finally {
      button.disabled = false;
      update();
    }
  });
  update();

  return {
    refresh: update,
    preset: (preset) => {
      if (preset.kind) form.querySelector<HTMLInputElement>(`input[name=kind][value="${preset.kind}"]`)!.checked = true;
      update();
      if (preset.reason !== undefined) reason.value = preset.reason;
      if (preset.quantity !== undefined) quantity.value = String(preset.quantity);
      if (preset.reorderId !== undefined) reorderId = preset.reorderId;
      context.hidden = !preset.context;
      context.textContent = preset.context ?? "";
      key = crypto.randomUUID();
      setMessage(alert, "");
      update();
    }
  };
}
