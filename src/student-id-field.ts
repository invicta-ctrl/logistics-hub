import { STUDENT_ID_MESSAGES, normalizeStudentId, validateStudentId } from "./catalog-policy";

/*
 * The Student ID field, the same at the desk, on the phone and in the Directory (V1.16.4 §4.5): text with the numeric keypad. What
 * is typed or pasted is tidied as it arrives, so a pasted "21-000115" is 21000115 and full-width digits from an input method become
 * ASCII once it finishes. Nothing is cut: a ninth digit stays and the field says at once that an ID has exactly 8 digits. Letters
 * are left in place for the check to name. The Worker checks the ID as sent (`studentIdAsSent`), so the tidying happens here.
 */

/** Tidies the field in place, keeping the caret where the person was typing. */
function tidy(input: HTMLInputElement): void {
  const next = normalizeStudentId(input.value);
  if (next === input.value) return;
  const caret = normalizeStudentId(input.value.slice(0, input.selectionEnd ?? input.value.length)).length;
  input.value = next;
  if (document.activeElement === input) input.setSelectionRange(caret, caret);
}

/**
 * Binds one Student ID input. `hint` is its hint line: its own words until the ID has more than 8 digits, then why it cannot be used.
 * Bind before the form listens, so the form's own input listener always reads the tidied value.
 */
export function bindStudentId(input: HTMLInputElement, hint: HTMLElement | null): void {
  const usual = hint?.textContent ?? "";
  const say = () => {
    if (!hint) return;
    const long = /^\d{9,}$/.test(input.value);
    if (hint.textContent !== (long ? STUDENT_ID_MESSAGES.LENGTH : usual)) hint.textContent = long ? STUDENT_ID_MESSAGES.LENGTH : usual;
    hint.classList.toggle("field__hint--warn", long);
  };
  // While an input method is composing, its text is not final; it is tidied once composition ends, and the form told again.
  input.addEventListener("input", (event) => { if (!(event as InputEvent).isComposing) tidy(input); say(); });
  input.addEventListener("compositionend", () => { tidy(input); say(); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

/** What is wrong with the ID typed, in the words every form and the Worker use; null when it can be sent. */
export function studentIdProblem(value: string): string | null {
  const problem = validateStudentId(value);
  return problem ? STUDENT_ID_MESSAGES[problem] : null;
}
