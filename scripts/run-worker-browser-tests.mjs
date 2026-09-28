import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const devVars = new URL("../.dev.vars", import.meta.url);
const username = `browser-test-${randomBytes(8).toString("hex")}`;
const password = randomBytes(24).toString("base64url");
const sessionSecret = randomBytes(32).toString("base64url");
fs.writeFileSync(devVars, `ENVIRONMENT=development\nDEV_AUTH_ENABLED=true\nSESSION_SECRET=${sessionSecret}\nDEV_STAFF_USERNAME=${username}\nDEV_STAFF_PASSWORD=${password}\n`, { mode: 0o600 });
try {
  const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "test", "-c", "playwright.worker.config.ts"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(devVars, { force: true });
}
