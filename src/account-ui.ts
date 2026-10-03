import { type Role, ROLE_LABELS, type Session } from "./staff";
import { type Html, html, plural } from "./ui";

/*
 * Pieces of account administration shared by Administration → Accounts and a person's sign-in in the Staff Directory: the
 * client's mirror of who may manage whom, the one-time secret display, and account events in an administrator's words.
 */

export type AccountEvent = { at: string; action: string; actor: string | null; details: Record<string, { from?: unknown; to?: unknown } | unknown> };

// Mirrors the server rules purely to show the right controls; the server decides.
export const canManage = (actor: Pick<Session, "role">, target: { role: Role }) => actor.role === "OWNER" || (actor.role === "ADMIN" && target.role === "STAFF");
export const assignable = (actor: Pick<Session, "role">): Role[] => actor.role === "OWNER" ? ["STAFF", "ADMIN", "OWNER"] : ["STAFF"];
export const roleTag = (role: Role) => html`<span class="tag ${role === "OWNER" ? "tag--brand" : role === "ADMIN" ? "tag--gold" : ""}">${ROLE_LABELS[role]}</span>`;

/** A secret shown exactly once, with copy, and an explicit instruction. */
export function oneTime(label: string, value: string, note: string): Html {
  return html`<div class="secret" role="status"><p class="secret__label">${label}</p><div class="secret__row"><code>${value}</code><button type="button" class="button button--secondary button--sm" data-copy="${value}">Copy</button></div><p class="secret__note">${note}</p></div>`;
}

export function bindCopy(root: Element): void {
  root.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
    if (!button) return;
    try { await navigator.clipboard.writeText(button.dataset.copy ?? ""); button.textContent = "Copied"; } catch { button.textContent = "Select and copy"; }
  });
}

export const EVENT_TEXT: Record<string, (event: AccountEvent) => string> = {
  ACCOUNT_CREATED: (event) => `created ${String((event.details as { username?: string }).username)} (${ROLE_LABELS[(event.details as { role: Role }).role] ?? ""})`,
  ACCOUNT_UPDATED: (event) => {
    const details = event.details as Record<string, unknown>;
    const parts = Object.entries(details).filter(([key, change]) => ["displayName", "username", "role", "active"].includes(key) && typeof change === "object" && change !== null)
      .map(([key, value]) => { const change = value as { from: unknown; to: unknown }; return key === "active" ? (change.to ? "enabled" : "disabled") : `${key === "displayName" ? "name" : key} ${String(change.from)} → ${String(change.to)}`; });
    return `${details.self ? "updated their own account" : `updated ${typeof details.username === "string" ? details.username : "an account"}`}: ${parts.join(", ")}`;
  },
  PASSWORD_RESET: (event) => `reset the password of ${String((event.details as { username?: string }).username)}`,
  PASSWORD_CHANGED: () => "changed their own password",
  SESSIONS_REVOKED: (event) => `signed ${String((event.details as { username?: string }).username)} out everywhere`,
  OWNER_BOOTSTRAPPED: () => "was set up as the first owner (Owner Console)",
  RECOVERY_KEY_ROTATED: () => "issued a new owner recovery key",
  RECOVERY_KEY_REVOKED: () => "revoked the owner recovery key",
  RETENTION_ERASED: (event) => { const { loans = 0, phoneRecords = 0 } = event.details as { loans?: number; phoneRecords?: number }; return `removed names, student IDs and photos from ${plural(loans, "old loan")} and ${plural(phoneRecords, "old phone record")}`; },
  SETTING_CHANGED: (event) => (event.details as { to?: string }).to === "open" ? "reopened Self-Service" : "closed Self-Service for maintenance",
  OWNER_RECOVERY_USED: (event) => `Owner recovery key used for ${String((event.details as { username?: string }).username)}; password reset and sessions ended`
};

/** One account event as a sentence: who did what. */
export const eventText = (event: AccountEvent) => `${event.actor ?? "Recovery"} ${(EVENT_TEXT[event.action] ?? (() => event.action.toLowerCase()))(event)}`;
