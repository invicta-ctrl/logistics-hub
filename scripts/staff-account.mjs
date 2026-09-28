// Operator tool for staff login accounts. Accounts are created explicitly here,
// never inferred from the staff directory or historical sources.
//
//   node scripts/staff-account.mjs create <username> --name "Display Name" [--remote] [--password-stdin]
//   node scripts/staff-account.mjs reset-password <username> [--remote] [--password-stdin]
//   node scripts/staff-account.mjs disable <username> [--remote]
//   node scripts/staff-account.mjs list [--remote]
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

// Must match PASSWORD_ITERATIONS in src/session.ts (Workers cap PBKDF2 at 100k).
const ITERATIONS = 100_000;
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `pbkdf2-sha256$${ITERATIONS}$${salt.toString("base64url")}$${pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256").toString("base64url")}`;
}

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function createAccountSql(username, displayName, password) {
  return `INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES(${sqlText(`ACC-${randomUUID()}`)}, ${sqlText(username)}, ${sqlText(displayName)}, ${sqlText(hashPassword(password))});`;
}

export function runD1(sql, { remote = false, json = false, persistTo } = {}) {
  const target = remote ? ["--remote"] : ["--local", ...(persistTo ? ["--persist-to", persistTo] : [])];
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "DB", ...target, "--yes", ...(json ? ["--json"] : []), "--command", sql], { encoding: "utf8", stdio: json ? ["ignore", "pipe", "inherit"] : "inherit" });
  if (result.status !== 0) throw new Error("wrangler d1 execute failed");
  return json ? JSON.parse(result.stdout)[0].results : undefined;
}

function validUsername(username) {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(username ?? "")) throw new Error("Username must be 3-64 letters, numbers, dots, dashes, or underscores.");
  return username;
}

async function readPassword(fromStdin) {
  if (fromStdin) {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    return checkPassword(input.replace(/\r?\n$/, ""));
  }
  const ask = (prompt) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(prompt)) process.stdout.write(prompt); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
  const password = await ask("New password: ");
  if (password !== await ask("Repeat password: ")) throw new Error("Passwords did not match.");
  return checkPassword(password);
}

function checkPassword(password) {
  if (password.length < 12 || password.length > 256) throw new Error("Password must be 12-256 characters.");
  return password;
}

async function main() {
  const [command, username] = process.argv.slice(2);
  const flag = (name) => process.argv.includes(name);
  const option = (name) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
  const remote = flag("--remote");
  if (command === "create") {
    const displayName = option("--name")?.trim();
    if (!displayName) throw new Error("Provide --name \"Display Name\".");
    runD1(createAccountSql(validUsername(username), displayName, await readPassword(flag("--password-stdin"))), { remote });
  } else if (command === "reset-password") {
    const hash = hashPassword(await readPassword(flag("--password-stdin")));
    runD1(`UPDATE staff_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL AND account_id = (SELECT id FROM staff_accounts WHERE username = ${sqlText(validUsername(username))}); UPDATE staff_accounts SET password_hash = ${sqlText(hash)} WHERE username = ${sqlText(username)};`, { remote });
  } else if (command === "disable") {
    runD1(`UPDATE staff_accounts SET active = 0 WHERE username = ${sqlText(validUsername(username))}; UPDATE staff_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL AND account_id = (SELECT id FROM staff_accounts WHERE username = ${sqlText(username)});`, { remote });
  } else if (command === "list") {
    console.table(runD1("SELECT username, display_name, active, created_at, last_login_at FROM staff_accounts ORDER BY username", { remote, json: true }));
  } else {
    throw new Error("Usage: staff-account.mjs create|reset-password|disable|list <username> [--name \"Display Name\"] [--remote] [--password-stdin]");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
