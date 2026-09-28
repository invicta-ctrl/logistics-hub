// Staff login accounts for seeding local/test databases and the one-time first
// owner setup. Day-to-day account work goes through the site's Admin API.
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

export function createAccountSql(username, displayName, password, role = "STAFF") {
  if (!["STAFF", "ADMIN", "OWNER"].includes(role)) throw new Error("Role must be STAFF, ADMIN or OWNER.");
  return `INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(${sqlText(`ACC-${randomUUID()}`)}, ${sqlText(validUsername(username))}, ${sqlText(validDisplayName(displayName))}, ${sqlText(hashPassword(checkPassword(password)))}, ${sqlText(role)});`;
}


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
