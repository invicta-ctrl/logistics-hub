import { type Html, ApiError, api, dataUrl, failure, formatDate, formatDateTime, html, icon, label, mount, officeDay, setMessage, shrinkPhoto, toast, units } from "./ui";

export type Loan = {
  id: string; itemId: string; itemName: string; unit: string; quantity: number; purpose: "INDIVIDUAL" | "USC"; borrowerName: string;
  studentId: string | null; reason: string | null; returnBy: string | null; status: string; returnNote: string | null;
  createdAt: string; closedAt: string | null; createdBy: string | null; closedBy: string | null;
  /** 0 once the photo has been removed by retention. */
  hasPhoto?: number;
};
export type Borrower = { name: string; studentId: string };
type LoanTarget = { id: string; name: string; unit: string; onHand: number };


/** Due and overdue are derived from the Manila calendar; nothing is stored as "overdue". */
export function dueTag(loan: Pick<Loan, "status" | "returnBy">, today = officeDay()): Html {
  if (loan.status !== "OUT" || !loan.returnBy) return html``;
  if (loan.returnBy < today) return html`<span class="tag tag--bad">Overdue · due ${formatDate(loan.returnBy)}</span>`;
  if (loan.returnBy === today) return html`<span class="tag tag--warn">Due today</span>`;
  return html`<span class="tag">Due ${formatDate(loan.returnBy)}</span>`;
}

export const isOverdue = (loan: Pick<Loan, "status" | "returnBy">, today = officeDay()) => loan.status === "OUT" && Boolean(loan.returnBy) && loan.returnBy! < today;
export const purposeTag = (purpose: string) => html`<span class="tag ${purpose === "USC" ? "tag--gold" : "tag--brand"}">${label(purpose)}</span>`;
const OUTCOME_TONE: Record<string, string> = { RETURNED: "tag--ok", DAMAGED: "tag--warn", LOST: "tag--bad" };
export const outcomeTag = (status: string) => html`<span class="tag ${OUTCOME_TONE[status] ?? ""}">${status === "OUT" ? "On loan" : label(status)}</span>`;

const daysOut = (loan: Loan) => Math.max(0, Math.round((Date.parse(`${officeDay()}T00:00:00Z`) - Date.parse(`${officeDay(loan.createdAt)}T00:00:00Z`)) / 86_400_000));

/** One loan as a row: who, what, since when, and the Return action while it is out. */
export function loanRow(loan: Loan, withItem = false): Html {
  const out = loan.status === "OUT";
  const days = daysOut(loan);
  return html`<li class="loan-row ${isOverdue(loan) ? "is-overdue" : ""}" data-key="${loan.id}">
    <div class="loan-row__main">
      <p class="loan-row__who"><strong>${loan.borrowerName}</strong>${loan.studentId ? html` <span class="mono muted">${loan.studentId}</span>` : ""} ${purposeTag(loan.purpose)}</p>
      <p class="loan-row__what">${withItem ? html`<a class="row-link" href="/staff/items?item=${loan.itemId}" data-route>${loan.itemName}</a> · ` : ""}${loan.quantity} ${units(loan.quantity, loan.unit)}
        · ${out ? html`out ${days === 0 ? "since today" : days === 1 ? "since yesterday" : `for ${days} days`}` : html`${formatDate(officeDay(loan.createdAt))} → ${formatDate(officeDay(loan.closedAt!))}`} ${out ? dueTag(loan) : outcomeTag(loan.status)}</p>
      ${loan.reason ? html`<p class="loan-row__note">${loan.reason}</p>` : ""}
      ${loan.returnNote ? html`<p class="loan-row__note">${loan.returnNote}</p>` : ""}
      <p class="loan-row__meta">Lent by ${loan.createdBy ?? "staff"} · ${formatDateTime(loan.createdAt)}${loan.closedBy ? ` · closed by ${loan.closedBy}` : ""}</p>
    </div>
    <div class="loan-row__actions">
      ${out ? html`<button type="button" class="button button--secondary button--sm" data-return="${loan.id}">Return</button>` : ""}
      ${loan.hasPhoto === 0 ? "" : html`<a class="text-link loan-row__photo" href="/api/staff/loans/${loan.id}/photo" target="_blank" rel="noopener">Photo<span class="visually-hidden"> of this loan (opens in a new tab)</span></a>`}
    </div></li>`;
}

/** Form fields; `prefix` keeps IDs unique. The item comes from the caller, not the form. */
export function loanFields(prefix: string): Html {
  return html`<fieldset class="segmented segmented--2"><legend class="visually-hidden">Purpose</legend>
      <label><input type="radio" name="purpose" value="INDIVIDUAL" checked /><span>Individual use</span></label><label><input type="radio" name="purpose" value="USC" /><span>USC use</span></label>
    </fieldset>
    <div class="field-grid">
      <div class="field"><label for="${prefix}-studentId">Student ID number <span class="field__optional" data-id-optional>required</span></label><input id="${prefix}-studentId" name="studentId" maxlength="30" autocomplete="off" autocapitalize="characters" spellcheck="false" list="${prefix}-known" /></div>
      <div class="field"><label for="${prefix}-name" data-name-label>Borrower's full name</label><input id="${prefix}-name" name="borrowerName" maxlength="120" autocomplete="off" spellcheck="false" /></div>
    </div>
    <datalist id="${prefix}-known"></datalist>
    <div class="field" data-reason hidden><label for="${prefix}-reason">Specific reason</label><textarea id="${prefix}-reason" name="reason" rows="2" maxlength="300" placeholder="What it is for, e.g. stage setup for the general assembly"></textarea></div>
    <div class="field-grid">
      <div class="field"><label for="${prefix}-quantity">Quantity</label>
        <div class="stepper"><button type="button" class="stepper__button" data-step="-1" aria-label="One less">−</button><input id="${prefix}-quantity" name="quantity" type="number" inputmode="numeric" min="1" step="1" value="1" aria-describedby="${prefix}-available" /><button type="button" class="stepper__button" data-step="1" aria-label="One more">+</button></div>
        <p class="field__hint" id="${prefix}-available" data-available></p></div>
      <div class="field"><label for="${prefix}-returnBy">Return by <span class="field__optional">optional</span></label><input id="${prefix}-returnBy" name="returnBy" type="date" /></div>
    </div>
    <div class="field">
      <label for="${prefix}-photo">Photo <span class="field__optional">required</span></label>
      <input class="visually-hidden" id="${prefix}-photo" name="photo" type="file" accept="image/*" tabindex="-1" aria-describedby="${prefix}-photo-hint" />
      <div class="photo-field" data-photo>
        <button type="button" class="photo-field__pick" data-pick aria-describedby="${prefix}-photo-hint">${icon("camera")}<span>Take or choose a photo</span></button>
      </div>
      <p class="field__hint" id="${prefix}-photo-hint">Proof of the hand-over: the person holding the item, with their face and the item visible.</p>
    </div>
    <div class="form-alert" role="alert" hidden data-alert></div>
    <div class="form-actions"><button class="button button--primary" type="submit" data-submit>Lend</button></div>`;
}

/**
 * Wires the loan form to the item being lent. Individual use needs a student ID; USC use
 * needs a specific reason; both need a name and a photo. A returning student's name is
 * filled from their ID. Each attempt carries an idempotency key.
 */
export function bindLoanForm(form: HTMLFormElement, options: {
  target: () => LoanTarget | null;
  known: () => Borrower[];
  onLent: (target: LoanTarget) => void | Promise<void>;
}): { refresh: () => void } {
  const alert = form.querySelector<HTMLElement>("[data-alert]")!;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]")!;
  const quantity = form.querySelector<HTMLInputElement>("input[name=quantity]")!;
  const studentId = form.querySelector<HTMLInputElement>("input[name=studentId]")!;
  const name = form.querySelector<HTMLInputElement>("input[name=borrowerName]")!;
  const reason = form.querySelector<HTMLTextAreaElement>("textarea[name=reason]")!;
  const file = form.querySelector<HTMLInputElement>("input[type=file]")!;
  const photoBox = form.querySelector<HTMLElement>("[data-photo]")!;
  const returnBy = form.querySelector<HTMLInputElement>("input[name=returnBy]")!;
  let key = crypto.randomUUID();
  let photo: Blob | null = null;
  // A photo still being prepared when Lend is pressed is waited for, not reported missing.
  let preparing: Promise<void> | null = null;
  let filledName = "";
  let knownSignature = "";
  const purpose = () => (new FormData(form).get("purpose") ?? "INDIVIDUAL") as "INDIVIDUAL" | "USC";

  const showPhoto = (preview: string | null) => {
    mount(photoBox, preview
      ? html`<img class="photo-field__preview" src="${preview}" alt="Photo to attach" /><div class="photo-field__actions"><button type="button" class="button button--secondary button--sm" data-pick>${icon("camera")}Retake</button><button type="button" class="button button--ghost button--sm" data-clear>Remove</button></div>`
      : html`<button type="button" class="photo-field__pick" data-pick aria-describedby="${file.getAttribute("aria-describedby")!}">${icon("camera")}<span>Take or choose a photo</span></button>`);
  };

  const update = () => {
    const target = options.target();
    const usc = purpose() === "USC";
    form.querySelector("[data-name-label]")!.textContent = usc ? "Name of the person using it" : "Borrower's full name";
    form.querySelector("[data-id-optional]")!.textContent = usc ? "optional" : "required";
    form.querySelector<HTMLElement>("[data-reason]")!.hidden = !usc;
    returnBy.min = officeDay();
    const available = target?.onHand ?? 0;
    quantity.max = String(Math.max(1, available));
    const value = Number(quantity.value) || 0;
    form.querySelector("[data-available]")!.textContent = !target ? "Choose an item first." : available > 0 ? `${available} ${units(available, target.unit)} on the shelf.` : "None on the shelf right now.";
    submit.disabled = !target || available <= 0;
    submit.textContent = target && value > 0 ? `Lend ${value} ${units(value, target.unit)}` : "Lend";
    const known = options.known();
    const signature = known.length ? `${known.length}${known[0]!.studentId}` : "";
    if (signature !== knownSignature) {
      knownSignature = signature;
      mount(form.querySelector("datalist")!, html`${known.map((borrower) => html`<option value="${borrower.studentId}">${borrower.name}</option>`)}`);
    }
  };

  const reset = () => {
    for (const field of [studentId, name, reason, returnBy]) field.value = "";
    quantity.value = "1";
    photo = null;
    file.value = "";
    filledName = "";
    showPhoto(null);
    key = crypto.randomUUID();
    update();
  };

  form.addEventListener("input", (event) => {
    key = crypto.randomUUID();
    form.querySelectorAll("[aria-invalid]").forEach((element) => element.removeAttribute("aria-invalid"));
    setMessage(alert, "");
    if (event.target === studentId) {
      // A returning student: fill the name they used last time, unless staff typed one.
      const match = options.known().find((borrower) => borrower.studentId === studentId.value.trim().toUpperCase());
      if (match && (!name.value || name.value === filledName)) { name.value = match.name; filledName = match.name; }
    }
    update();
  });
  form.addEventListener("change", update);
  form.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => button.addEventListener("click", () => {
    const max = Number(quantity.max) || 1;
    quantity.value = String(Math.min(max, Math.max(1, (Number(quantity.value) || 0) + Number(button.dataset.step))));
    quantity.dispatchEvent(new Event("input", { bubbles: true }));
  }));
  photoBox.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-pick]")) file.click();
    if (target.closest("[data-clear]")) { photo = null; file.value = ""; showPhoto(null); key = crypto.randomUUID(); photoBox.querySelector<HTMLElement>("[data-pick]")?.focus(); }
  });
  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    mount(photoBox, html`<p class="photo-field__busy" role="status">Preparing the photo…</p>`);
    preparing = (async () => {
      try {
        photo = await shrinkPhoto(chosen);
        showPhoto(await dataUrl(photo));
        key = crypto.randomUUID();
        photoBox.querySelector<HTMLElement>("[data-pick]")?.focus();
      } catch (error) {
        photo = null;
        showPhoto(null);
        setMessage(alert, error instanceof Error ? error.message : "This photo could not be used.");
      } finally {
        preparing = null;
      }
    })();
  });

  const invalid = (element: HTMLElement, message: string) => {
    element.setAttribute("aria-invalid", "true");
    setMessage(alert, message);
    element.focus();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    if (preparing) await preparing;
    const target = options.target();
    if (!target) return setMessage(alert, "Choose an item first.");
    const usc = purpose() === "USC";
    const count = Number(quantity.value);
    if (!usc && !studentId.value.trim()) return invalid(studentId, "Enter the borrower's student ID number.");
    if (studentId.value.trim() && !/^[A-Za-z0-9][A-Za-z0-9-]{2,29}$/.test(studentId.value.trim())) return invalid(studentId, "A student ID uses only letters, digits and dashes.");
    if (!name.value.trim()) return invalid(name, usc ? "Enter the name of the person using it." : "Enter the borrower's full name.");
    if (usc && !reason.value.trim()) return invalid(reason, "Give the specific reason for USC use.");
    if (!Number.isInteger(count) || count < 1) return invalid(quantity, "Lend at least 1.");
    if (count > target.onHand) return invalid(quantity, `Only ${target.onHand} ${units(target.onHand, target.unit)} on the shelf.`);
    if (!photo) return invalid(photoBox.querySelector<HTMLElement>("[data-pick]") ?? file, "Add a photo of the hand-over.");
    const body = new FormData();
    body.set("purpose", purpose());
    body.set("borrowerName", name.value);
    body.set("studentId", studentId.value);
    body.set("reason", usc ? reason.value : "");
    body.set("quantity", String(count));
    body.set("returnBy", returnBy.value);
    body.set("key", key);
    body.set("photo", photo, "loan.jpg");
    submit.disabled = true;
    submit.textContent = "Saving…";
    setMessage(alert, "");
    try {
      await api(`/api/staff/items/${encodeURIComponent(target.id)}/loans`, { method: "POST", body });
    } catch (error) {
      setMessage(alert, error instanceof ApiError && error.status === 0 ? "The loan was not saved: you appear to be offline. Your entries are kept; try again." : failure(error));
      submit.disabled = false;
      update();
      return;
    }
    toast(`Lent ${count} ${units(count, target.unit)} of ${target.name} to ${name.value.trim()}.`);
    reset();
    try {
      await options.onLent(target);
    } catch {
      setMessage(alert, "Loan saved, but the list could not refresh. Refresh the page to see it.");
    } finally {
      submit.disabled = false;
      update();
    }
  });
  update();
  return { refresh: update };
}

/** Ends a loan: good return (back on the shelf), damaged, or lost. The photo is shown to check the hand-over. */
export function openReturn(loan: Loan, onDone: () => void | Promise<void>): void {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.setAttribute("aria-labelledby", "return-title");
  const count = `${loan.quantity} ${units(loan.quantity, loan.unit)}`;
  mount(dialog, html`<form class="form dialog__body" novalidate>
    <header class="dialog__header"><div><p class="sheet__kicker">Return</p><h2 id="return-title">${loan.itemName}</h2></div><button class="icon-button" type="button" aria-label="Close" data-close>${icon("close")}</button></header>
    <p class="dialog__lede"><strong>${loan.borrowerName}</strong>${loan.studentId ? html` <span class="mono muted">${loan.studentId}</span>` : ""} · ${count} · lent ${formatDateTime(loan.createdAt)} ${dueTag(loan)}</p>
    <img class="dialog__photo" src="/api/staff/loans/${loan.id}/photo" alt="Photo taken when it was lent to ${loan.borrowerName}" />
    <fieldset class="reason-picker"><legend>How did it come back?</legend><div class="reason-picker__options">
      <label class="reason-chip"><input type="radio" name="outcome" value="RETURNED" checked /><span>Returned in good condition</span></label>
      <label class="reason-chip"><input type="radio" name="outcome" value="DAMAGED" /><span>Damaged</span></label>
      <label class="reason-chip"><input type="radio" name="outcome" value="LOST" /><span>Lost or not returned</span></label>
    </div></fieldset>
    <p class="field__hint" data-effect></p>
    <div class="field" data-note hidden><label for="return-note">What happened <span class="field__optional">required</span></label><textarea id="return-note" name="note" rows="2" maxlength="300"></textarea></div>
    <div class="form-alert" role="alert" hidden data-alert></div>
    <div class="form-actions"><button class="button button--primary" type="submit" data-submit>Mark returned</button><button class="button button--ghost" type="button" data-close>Cancel</button></div>
  </form>`);
  document.body.append(dialog);
  const form = dialog.querySelector("form")!;
  const note = form.querySelector<HTMLTextAreaElement>("textarea")!;
  const alert = form.querySelector<HTMLElement>("[data-alert]")!;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]")!;
  const outcome = () => String(new FormData(form).get("outcome"));
  const update = () => {
    const value = outcome();
    form.querySelector<HTMLElement>("[data-note]")!.hidden = value === "RETURNED";
    form.querySelector("[data-effect]")!.textContent = value === "RETURNED" ? `Puts ${count} back on the shelf.` : `Closes the loan. The ${units(loan.quantity, loan.unit)} stay${loan.quantity === 1 ? "s" : ""} off the shelf.`;
    submit.textContent = value === "RETURNED" ? "Mark returned" : value === "DAMAGED" ? "Mark damaged" : "Mark lost";
  };
  const close = () => dialog.close();
  dialog.addEventListener("close", () => { dialog.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog || (event.target as HTMLElement).closest("[data-close]")) close(); });
  form.addEventListener("change", update);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = outcome();
    if (value !== "RETURNED" && !note.value.trim()) { note.setAttribute("aria-invalid", "true"); setMessage(alert, value === "LOST" ? "Say what is known about the loss." : "Describe the damage."); note.focus(); return; }
    submit.disabled = true;
    try {
      await api(`/api/staff/loans/${encodeURIComponent(loan.id)}/return`, { method: "POST", body: JSON.stringify({ outcome: value, note: note.value }) });
      toast(value === "RETURNED" ? `${loan.itemName} returned by ${loan.borrowerName}.` : `${loan.itemName} marked ${label(value).toLowerCase()}.`);
      close();
      await onDone();
    } catch (error) {
      setMessage(alert, failure(error));
      submit.disabled = false;
    }
  });
  update();
  dialog.showModal();
}
