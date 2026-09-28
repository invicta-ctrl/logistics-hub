// Staff login accounts: hashing, validation, and the SQL for every account
// operation. Accounts are created explicitly by an operator (npm run admin),
// never inferred from the staff directory or historical sources.
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Must match PASSWORD_ITERATIONS in src/session.ts (Workers cap PBKDF2 at 100k).
const ITERATIONS = 100_000;
export const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `pbkdf2-sha256$${ITERATIONS}$${salt.toString("base64url")}$${pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256").toString("base64url")}`;
}

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const byUsername = (username) => `(SELECT id FROM staff_accounts WHERE username = ${sqlText(username)})`;
const revokeSessions = (username) => `UPDATE staff_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL AND account_id = ${byUsername(username)};`;

export function validUsername(username) {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(username ?? "")) throw new Error("Username must be 3-64 letters, numbers, dots, dashes, or underscores, starting with a letter or number.");
  return username;
}

export function validDisplayName(name) {
  const value = String(name ?? "").trim();
  if (!value || value.length > 80 || /[\u0000-\u001f]/.test(value)) throw new Error("Display name must be 1-80 printable characters.");
  return value;
}

export function checkPassword(password) {
  if (password.length < 12 || password.length > 256) throw new Error("Password must be 12-256 characters.");
  return password;
}

/** A random password staff can type: 4 groups of 5 unambiguous characters. */
export function generatePassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  return Array.from({ length: 4 }, (_, group) => Array.from({ length: 5 }, (_, index) => alphabet[bytes[group * 5 + index] % alphabet.length]).join("")).join("-");
}

export function createAccountSql(username, displayName, password, role = "STAFF") {
  if (!["STAFF", "ADMIN", "OWNER"].includes(role)) throw new Error("Role must be STAFF, ADMIN or OWNER.");
  return `INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(${sqlText(`ACC-${randomUUID()}`)}, ${sqlText(validUsername(username))}, ${sqlText(validDisplayName(displayName))}, ${sqlText(hashPassword(checkPassword(password)))}, ${sqlText(role)});`;
}

// Security-sensitive changes (password, username, disable) end every session of that account.
export const accountSql = {
  list: "SELECT username, display_name AS name, CASE active WHEN 1 THEN 'enabled' ELSE 'disabled' END AS state, created_at AS created, COALESCE(substr(replace(last_login_at, 'T', ' '), 1, 16) || ' UTC', 'never') AS last_sign_in, (SELECT COUNT(*) FROM staff_sessions s WHERE s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000) AS open_sessions FROM staff_accounts a ORDER BY username",
  exists: (username) => `SELECT username, display_name AS name, active FROM staff_accounts WHERE username = ${sqlText(username)}`,
  resetPassword: (username, password) => `${revokeSessions(username)} UPDATE staff_accounts SET password_hash = ${sqlText(hashPassword(checkPassword(password)))} WHERE username = ${sqlText(username)};`,
  rename: (username, next) => `${revokeSessions(username)} UPDATE staff_accounts SET username = ${sqlText(validUsername(next))} WHERE username = ${sqlText(username)};`,
  setDisplayName: (username, name) => `UPDATE staff_accounts SET display_name = ${sqlText(validDisplayName(name))} WHERE username = ${sqlText(username)};`,
  setActive: (username, active) => `${active ? "" : revokeSessions(username)} UPDATE staff_accounts SET active = ${active ? 1 : 0} WHERE username = ${sqlText(username)};`
};

export function runD1(sql, { remote = false, json = false, persistTo } = {}) {
  const target = remote ? ["--remote"] : ["--local", ...(persistTo ? ["--persist-to", persistTo] : [])];
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "DB", ...target, "--yes", ...(json ? ["--json"] : []), "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    let detail = "";
    try { detail = JSON.parse(result.stdout).error?.text ?? ""; } catch { detail = `${result.stdout}\n${result.stderr}`.split("\n").find((line) => /error|no such|unique/i.test(line))?.trim() ?? ""; }
    if (/CLOUDFLARE_API_TOKEN|not authenticated|login/i.test(detail)) throw new Error("Not signed in to Cloudflare. Run  npx wrangler login  (opens your browser), or set CLOUDFLARE_API_TOKEN, then try again.");
    if (/no such table/i.test(detail) && !remote) throw new Error("The local database is not set up yet. Run  npm run dev:live  once, then try again.");
    throw new Error(detail ? `Database command failed: ${detail}` : "Database command failed.");
  }
  return json ? JSON.parse(result.stdout)[0].results : undefined;
}
