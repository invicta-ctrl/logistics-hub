// Runs the browser suite against a real local Worker + D1 in a throwaway state
// directory, so tests never touch the live preview database or .dev.vars.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createAccountSql, runD1 } from "./staff-account.mjs";

const stateDir = `.wrangler/e2e-${process.pid}`;
const e2ePort = 20_000 + (randomBytes(2).readUInt16BE(0) % 20_000);
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));

fs.rmSync(stateDir, { recursive: true, force: true });
fs.mkdirSync(stateDir, { recursive: true });
try {
  fs.writeFileSync(`${stateDir}/.env`, `SESSION_SECRET=${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
  const migrate = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", stateDir], { stdio: "inherit" });
  if (migrate.status !== 0) throw new Error("local e2e migration failed");
  const username = `e2e-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(18).toString("base64url");
  runD1(createAccountSql(username, "E2E Staff", password), { persistTo: stateDir });
  const ownerUsername = `e2e-owner-${randomBytes(4).toString("hex")}`;
  const ownerPassword = randomBytes(18).toString("base64url");
  runD1(createAccountSql(ownerUsername, "E2E Owner", ownerPassword, "OWNER"), { persistTo: stateDir });
  const result = spawnSync(process.execPath, [cli, "test", "-c", "playwright.worker.config.ts", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, E2E_USERNAME: username, E2E_PASSWORD: password, E2E_OWNER_USERNAME: ownerUsername, E2E_OWNER_PASSWORD: ownerPassword, E2E_STATE_DIR: stateDir, E2E_PORT: String(e2ePort) } });
  process.exitCode = result.status ?? 1;
} finally {
  try {
    fs.rmSync(stateDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    console.warn(`e2e cleanup skipped for ${stateDir}: ${error.message}`);
  }
}
