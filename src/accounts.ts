// Account administration, self-service and owner recovery. The website and the
// local owner console both reach these through the same authenticated API, so
// every rule below is enforced once, on the server.
import { InputError, audit } from "./inventory";
import { hashPassword, verifyPassword } from "./session";

export const ROLES = ["STAFF", "ADMIN", "OWNER"] as const;
export type Role = (typeof ROLES)[number];
export type Account = { accountId: string; sessionId: string; username: string; displayName: string; role: Role; mustChangePassword: boolean };
type Target = { id: string; username: string; displayName: string; role: Role; active: number };

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,63}$/i;
const encoder = new TextEncoder();

/** OWNER manages everyone; ADMIN manages STAFF only; STAFF manages nobody. */
export function canManage(actor: Pick<Account, "role">, target: Pick<Target, "role">): boolean {
  return actor.role === "OWNER" || (actor.role === "ADMIN" && target.role === "STAFF");
}

function canAssign(actor: Pick<Account, "role">, role: Role): boolean {
  return actor.role === "OWNER" || (actor.role === "ADMIN" && role === "STAFF");
}

export function isAdmin(account: Pick<Account, "role">): boolean {
  return account.role === "ADMIN" || account.role === "OWNER";
}

/** Four groups of five unambiguous characters: easy to read aloud, ~115 bits. */
export function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from({ length: 4 }, (_, group) => Array.from({ length: 5 }, (_, index) => alphabet[bytes[group * 5 + index]! % alphabet.length]).join("")).join("-");
}

function body(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? input as Record<string, unknown> : {};
}

function username(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!USERNAME.test(text)) throw new InputError(400, "Username must be 3–64 letters, numbers, dots, dashes or underscores, starting with a letter or number.");
  return text;
}

function displayName(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 80 || /[\u0000-\u001f]/.test(text)) throw new InputError(400, "Display name must be 1–80 characters.");
  return text;
}

function password(value: unknown, label = "Password"): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) throw new InputError(400, `${label} must be 12–256 characters.`);
  return value;
}

function role(value: unknown): Role {
  if (typeof value !== "string" || !(ROLES as readonly string[]).includes(value)) throw new InputError(400, "Choose a valid role.");
  return value as Role;
}

/** Either a typed password or, when requested, a generated one that is returned exactly once. */
function passwordChoice(input: Record<string, unknown>): { value: string; generated: string | null } {
  if (input.generate === true) {
    const generated = generatePassword();
    return { value: generated, generated };
  }
  return { value: password(input.password), generated: null };
}

const revokeSessions = (db: D1Database, accountId: string, keepSessionId = "") =>
  db.prepare("UPDATE staff_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE account_id = ? AND revoked_at IS NULL AND id <> ?").bind(accountId, keepSessionId);

async function target(db: D1Database, id: string): Promise<Target> {
  const row = await db.prepare("SELECT id, username, display_name AS displayName, role, active FROM staff_accounts WHERE id = ?").bind(id).first<Target>();
  if (!row) throw new InputError(404, "Account not found.");
  return row;
}

async function usernameFree(db: D1Database, name: string, exceptId = ""): Promise<void> {
  if (await db.prepare("SELECT 1 FROM staff_accounts WHERE username = ? AND id <> ?").bind(name, exceptId).first()) throw new InputError(409, `The username "${name}" is already taken.`);
}

/** The last active OWNER can never be disabled or demoted. */
async function keepAnOwner(db: D1Database, account: Target): Promise<void> {
  if (account.role !== "OWNER" || !account.active) return;
  const others = await db.prepare("SELECT COUNT(*) AS total FROM staff_accounts WHERE role = 'OWNER' AND active = 1 AND id <> ?").bind(account.id).first<number>("total");
  if (!others) throw new InputError(409, "This is the only active owner. Add another owner before changing it.");
}

/* ---------- Administration (ADMIN and OWNER) ---------- */

export async function listAccounts(db: D1Database) {
  const { results } = await db.prepare(`SELECT a.id, a.username, a.display_name AS displayName, a.role, a.active, a.must_change_password AS mustChangePassword,
      a.created_at AS createdAt, a.last_login_at AS lastLoginAt,
      (SELECT COUNT(*) FROM staff_sessions s WHERE s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS openSessions
    FROM staff_accounts a ORDER BY CASE a.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, a.username COLLATE NOCASE`).bind(Date.now()).all<Record<string, unknown>>();
  return { accounts: results.map((row) => ({ ...row, active: row.active === 1, mustChangePassword: row.mustChangePassword === 1 })) };
}

export type NewAccount = { id: string; username: string; displayName: string; role: Role; passwordHash: string; generated: string | null };

/** A new account, checked (a role the actor may give, a free username, a display name, a password) but not yet written. */
export async function newAccount(db: D1Database, actor: Account, input: unknown): Promise<NewAccount> {
  const data = body(input);
  const name = username(data.username);
  const assigned = role(data.role ?? "STAFF");
  if (!canAssign(actor, assigned)) throw new InputError(403, "You cannot create an account with that role.");
  const label = displayName(data.displayName);
  const secret = passwordChoice(data);
  await usernameFree(db, name);
  return { id: `ACC-${crypto.randomUUID()}`, username: name, displayName: label, role: assigned, passwordHash: await hashPassword(secret.value), generated: secret.generated };
}

export async function createAccount(db: D1Database, actor: Account, input: unknown) {
  const next = await newAccount(db, actor, input);
  await db.batch([
    // Someone else chose this password, so the new user must replace it at first sign-in.
    db.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role, must_change_password, updated_at) VALUES(?, ?, ?, ?, ?, 1, ?)")
      .bind(next.id, next.username, next.displayName, next.passwordHash, next.role, new Date().toISOString()),
    audit(db, actor.accountId, "ACCOUNT_CREATED", "ACCOUNT", next.id, { username: next.username, role: next.role })
  ]);
  return { id: next.id, username: next.username, generatedPassword: next.generated };
}

/** A free username from a person's name: first.last in plain letters, with a number added if it is taken (ana.santos, ana.santos2…). */
export async function suggestUsername(db: D1Database, fullName: string): Promise<string> {
  const words = fullName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const base = (words.length > 1 ? `${words[0]}.${words.at(-1)}` : words[0] ?? "staff").slice(0, 56).padEnd(3, "0");
  const { results } = await db.prepare("SELECT lower(username) AS name FROM staff_accounts WHERE lower(username) = ?1 OR lower(username) LIKE ?1 || '%'").bind(base).all<{ name: string }>();
  const taken = new Set(results.map((row) => row.name));
  for (let n = 1; ; n++) if (!taken.has(n === 1 ? base : `${base}${n}`)) return n === 1 ? base : `${base}${n}`;
}

/** SQLite's CURRENT_TIMESTAMP ("2026-10-03 08:00:00", UTC) as ISO 8601; ISO values pass through. */
const iso = (value: string | null) => value && !value.includes("T") ? `${value.replace(" ", "T")}Z` : value;

/**
 * How an account is being used, for watching access: its state, sessions open now, failed sign-ins in the current window
 * (they clear on a successful sign-in), the latest sign-ins with how each ended, and the latest changes made to it. Session
 * ids are never returned. Sign-ins older than a month past their expiry have been swept (sweepStale).
 */
export async function accountAccess(db: D1Database, id: string) {
  const now = Date.now();
  const [account, sessions, events] = await db.batch([
    db.prepare(`SELECT a.id, a.username, a.display_name AS displayName, a.role, a.active, a.must_change_password AS mustChangePassword, a.created_at AS createdAt, a.last_login_at AS lastLoginAt,
        (SELECT COUNT(*) FROM staff_sessions s WHERE s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > ?2) AS openSessions,
        COALESCE((SELECT t.count FROM auth_throttle t WHERE t.key = 'login-user:' || lower(a.username) AND t.reset_at > ?2), 0) AS failedAttempts
      FROM staff_accounts a WHERE a.id = ?1`).bind(id, now),
    db.prepare("SELECT created_at AS startedAt, expires_at AS expiresAt, revoked_at AS endedAt FROM staff_sessions WHERE account_id = ? ORDER BY created_at DESC LIMIT 10").bind(id),
    db.prepare(`SELECT l.created_at AS at, l.action, l.details_json AS details, a.display_name AS actor FROM audit_log l LEFT JOIN staff_accounts a ON a.id = l.actor_user_id
      WHERE l.entity_type = 'ACCOUNT' AND l.entity_id = ? ORDER BY l.created_at DESC, l.rowid DESC LIMIT 10`).bind(id)
  ]);
  const row = account!.results[0] as Record<string, unknown> | undefined;
  if (!row) throw new InputError(404, "Account not found.");
  return {
    account: { ...row, createdAt: iso(row.createdAt as string), active: row.active === 1, mustChangePassword: row.mustChangePassword === 1 } as {
      id: string; username: string; displayName: string; role: Role; active: boolean; mustChangePassword: boolean; createdAt: string; lastLoginAt: string | null; openSessions: number; failedAttempts: number },
    signIns: (sessions!.results as Array<{ startedAt: string; expiresAt: number; endedAt: string | null }>).map((session) => ({
      at: iso(session.startedAt)!, until: session.endedAt ? iso(session.endedAt)! : new Date(session.expiresAt).toISOString(),
      state: session.endedAt ? "ENDED" as const : session.expiresAt <= now ? "EXPIRED" as const : "OPEN" as const })),
    events: (events!.results as Array<{ details: string }>).map((event) => ({ ...event, details: JSON.parse(event.details || "{}") }))
  };
}

export async function updateAccount(db: D1Database, actor: Account, id: string, input: unknown) {
  const data = body(input);
  const current = await target(db, id);
  if (!canManage(actor, current)) throw new InputError(403, "You cannot change this account.");
  const changes: Array<[string, unknown]> = [];
  const detail: Record<string, unknown> = {};
  if (data.displayName !== undefined && displayName(data.displayName) !== current.displayName) {
    changes.push(["display_name", displayName(data.displayName)]);
    detail.displayName = { from: current.displayName, to: displayName(data.displayName) };
  }
  if (data.username !== undefined && username(data.username) !== current.username) {
    const next = username(data.username);
    if (next.toLowerCase() !== current.username.toLowerCase()) await usernameFree(db, next, id);
    changes.push(["username", next]);
    detail.username = { from: current.username, to: next };
  }
  if (data.role !== undefined && role(data.role) !== current.role) {
    const next = role(data.role);
    if (!canAssign(actor, next)) throw new InputError(403, "You cannot assign that role.");
    if (current.role === "OWNER") await keepAnOwner(db, current);
    changes.push(["role", next]);
    detail.role = { from: current.role, to: next };
  }
  if (data.active !== undefined && Boolean(data.active) !== Boolean(current.active)) {
    if (!data.active) await keepAnOwner(db, current);
    changes.push(["active", data.active ? 1 : 0]);
    detail.active = { from: Boolean(current.active), to: Boolean(data.active) };
  }
  if (!changes.length) return { changed: 0 };
  // Identity, privilege or access changes end every session of that account.
  const sensitive = "username" in detail || "role" in detail || detail.active !== undefined;
  await db.batch([
    db.prepare(`UPDATE staff_accounts SET ${changes.map(([column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...changes.map(([, value]) => value), new Date().toISOString(), id),
    ...(sensitive ? [revokeSessions(db, id)] : []),
    // A recovery key belongs to the owner role; losing the role ends it for good.
    ...(current.role === "OWNER" && "role" in detail ? [db.prepare("UPDATE owner_recovery_keys SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), id)] : []),
    audit(db, actor.accountId, "ACCOUNT_UPDATED", "ACCOUNT", id, { username: current.username, ...detail, sessionsRevoked: sensitive })
  ]);
  return { changed: changes.length, sessionsRevoked: sensitive };
}

export async function resetPassword(db: D1Database, actor: Account, id: string, input: unknown) {
  const current = await target(db, id);
  if (!canManage(actor, current)) throw new InputError(403, "You cannot reset this account's password.");
  if (current.id === actor.accountId) throw new InputError(400, "Use My Account to change your own password.");
  const secret = passwordChoice(body(input));
  await db.batch([
    db.prepare("UPDATE staff_accounts SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?").bind(await hashPassword(secret.value), new Date().toISOString(), id),
    revokeSessions(db, id),
    audit(db, actor.accountId, "PASSWORD_RESET", "ACCOUNT", id, { username: current.username, generated: Boolean(secret.generated) })
  ]);
  return { generatedPassword: secret.generated };
}

export async function revokeAccountSessions(db: D1Database, actor: Account, id: string) {
  const current = await target(db, id);
  if (!canManage(actor, current) && current.id !== actor.accountId) throw new InputError(403, "You cannot sign this account out.");
  await db.batch([revokeSessions(db, id, current.id === actor.accountId ? actor.sessionId : ""), audit(db, actor.accountId, "SESSIONS_REVOKED", "ACCOUNT", id, { username: current.username })]);
  return { ok: true };
}

export async function securityActivity(db: D1Database) {
  const { results } = await db.prepare(`SELECT l.created_at AS at, l.action, l.entity_type AS entityType, l.details_json AS details, a.display_name AS actor
    FROM audit_log l LEFT JOIN staff_accounts a ON a.id = l.actor_user_id
    WHERE l.entity_type IN ('ACCOUNT', 'RECOVERY', 'SETTING', 'RETENTION') ORDER BY l.created_at DESC LIMIT 40`).all<{ details: string }>();
  return { events: results.map((row) => ({ ...row, details: JSON.parse(row.details || "{}") })) };
}

/* ---------- My account (any signed-in user) ---------- */

export async function updateSelf(db: D1Database, account: Account, input: unknown) {
  const data = body(input);
  const detail: Record<string, unknown> = {};
  const changes: Array<[string, string]> = [];
  if (data.displayName !== undefined && displayName(data.displayName) !== account.displayName) {
    changes.push(["display_name", displayName(data.displayName)]);
    detail.displayName = { from: account.displayName, to: displayName(data.displayName) };
  }
  if (data.username !== undefined && username(data.username) !== account.username) {
    const next = username(data.username);
    if (next.toLowerCase() !== account.username.toLowerCase()) await usernameFree(db, next, account.accountId);
    changes.push(["username", next]);
    detail.username = { from: account.username, to: next };
  }
  if (!changes.length) return { changed: 0 };
  await db.batch([
    db.prepare(`UPDATE staff_accounts SET ${changes.map(([column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...changes.map(([, value]) => value), new Date().toISOString(), account.accountId),
    // A new username ends every other session; this one stays signed in.
    ...(detail.username ? [revokeSessions(db, account.accountId, account.sessionId)] : []),
    audit(db, account.accountId, "ACCOUNT_UPDATED", "ACCOUNT", account.accountId, { self: true, ...detail })
  ]);
  return { changed: changes.length };
}

export async function changeOwnPassword(db: D1Database, account: Account, input: unknown) {
  const data = body(input);
  const stored = await db.prepare("SELECT password_hash AS hash FROM staff_accounts WHERE id = ?").bind(account.accountId).first<string>("hash");
  if (typeof data.currentPassword !== "string" || !stored || !await verifyPassword(data.currentPassword, stored)) throw new InputError(400, "Your current password is not correct.");
  const next = password(data.newPassword, "New password");
  if (next === data.currentPassword) throw new InputError(400, "Choose a password different from your current one.");
  await db.batch([
    db.prepare("UPDATE staff_accounts SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?").bind(await hashPassword(next), new Date().toISOString(), account.accountId),
    revokeSessions(db, account.accountId, account.sessionId),
    audit(db, account.accountId, "PASSWORD_CHANGED", "ACCOUNT", account.accountId, { self: true })
  ]);
  return { ok: true };
}

/* ---------- Owner recovery key ---------- */

async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function recoveryStatus(db: D1Database, account: Account) {
  if (account.role !== "OWNER") return null;
  const row = await db.prepare("SELECT created_at AS createdAt FROM owner_recovery_keys WHERE account_id = ? AND revoked_at IS NULL").bind(account.accountId).first<{ createdAt: string }>();
  return { configured: Boolean(row), createdAt: row?.createdAt ?? null };
}

/** Issues a new single-use recovery key (returned once) and revokes any previous one. */
export async function rotateRecoveryKey(db: D1Database, account: Account) {
  if (account.role !== "OWNER") throw new InputError(403, "Only an owner can hold a recovery key.");
  const id = base64url(crypto.getRandomValues(new Uint8Array(9)));
  const secret = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE owner_recovery_keys SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").bind(now, account.accountId),
    db.prepare("INSERT INTO owner_recovery_keys(id, account_id, verifier, created_at) VALUES(?, ?, ?, ?)").bind(id, account.accountId, await sha256(secret), now),
    audit(db, account.accountId, "RECOVERY_KEY_ROTATED", "RECOVERY", account.accountId, { keyId: id })
  ]);
  return { recoveryKey: `LHR1.${id}.${secret}`, createdAt: now };
}

export async function revokeRecoveryKey(db: D1Database, account: Account) {
  if (account.role !== "OWNER") throw new InputError(403, "Only an owner can hold a recovery key.");
  await db.batch([
    db.prepare("UPDATE owner_recovery_keys SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), account.accountId),
    audit(db, account.accountId, "RECOVERY_KEY_REVOKED", "RECOVERY", account.accountId, {})
  ]);
  return { ok: true };
}

/**
 * The only thing a recovery key can do: set a new password on the owner account
 * it belongs to, re-enable it, and sign that owner out everywhere. The key is
 * consumed; the owner then signs in normally and issues a new key.
 */
export async function recoverOwner(db: D1Database, input: unknown) {
  const data = body(input);
  const match = typeof data.recoveryKey === "string" ? /^LHR1\.([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/.exec(data.recoveryKey.trim()) : null;
  const newPassword = password(data.newPassword, "New password");
  const rejected = new InputError(401, "That recovery key was not accepted.");
  if (!match) throw rejected;
  const [, id, secret] = match;
  const key = await db.prepare(`SELECT k.verifier, a.id AS accountId, a.username FROM owner_recovery_keys k JOIN staff_accounts a ON a.id = k.account_id
    WHERE k.id = ? AND k.revoked_at IS NULL AND a.role = 'OWNER'`).bind(id).first<{ verifier: string; accountId: string; username: string }>();
  if (!key || !sameText(await sha256(secret!), key.verifier)) throw rejected;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE staff_accounts SET password_hash = ?, must_change_password = 0, active = 1, updated_at = ? WHERE id = ?").bind(await hashPassword(newPassword), now, key.accountId),
    revokeSessions(db, key.accountId),
    db.prepare("UPDATE owner_recovery_keys SET revoked_at = ? WHERE id = ?").bind(now, id),
    audit(db, null, "OWNER_RECOVERY_USED", "RECOVERY", key.accountId, { keyId: id, username: key.username })
  ]);
  return { username: key.username };
}

/* ---------- Attempt throttling (shared across isolates) ---------- */

/** Counts `weight` attempts against `key` in a fixed window; true once the window's total passes `limit`. */
export async function throttled(db: D1Database, key: string, limit: number, windowMs: number, weight = 1): Promise<boolean> {
  const now = Date.now();
  const count = await db.prepare(`INSERT INTO auth_throttle(key, count, reset_at) VALUES(?1, ?4, ?2 + ?3)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at < ?2 THEN ?4 ELSE count + ?4 END, reset_at = CASE WHEN reset_at < ?2 THEN ?2 + ?3 ELSE reset_at END
    RETURNING count`).bind(key, now, windowMs, weight).first<number>("count");
  return (count ?? 0) > limit;
}

export const clearThrottle = (db: D1Database, ...keys: string[]) => db.batch(keys.map((key) => db.prepare("DELETE FROM auth_throttle WHERE key = ?").bind(key)));

/** Session rows a month past expiry and spent throttle counters help no one; swept as a side effect of sign-ins and phone syncs. */
export function sweepStale(db: D1Database) {
  const now = Date.now();
  return db.batch([
    db.prepare("DELETE FROM staff_sessions WHERE expires_at < ?").bind(now - 30 * 24 * 60 * 60_000),
    db.prepare("DELETE FROM auth_throttle WHERE reset_at < ?").bind(now - 60 * 60_000)
  ]);
}
