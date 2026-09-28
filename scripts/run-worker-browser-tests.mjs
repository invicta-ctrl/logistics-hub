import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const devVars = new URL("../.dev.vars", import.meta.url);

export function writeEphemeralDevVars(path, contents) {
  fs.writeFileSync(path, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function run() {
const username = `browser-test-${randomBytes(8).toString("hex")}`;
const password = randomBytes(24).toString("base64url");
const sessionSecret = randomBytes(32).toString("base64url");
let createdDevVars = false;
try {
  writeEphemeralDevVars(devVars, `ENVIRONMENT=development\nDEV_AUTH_ENABLED=true\nSESSION_SECRET=${sessionSecret}\nDEV_STAFF_USERNAME=${username}\nDEV_STAFF_PASSWORD=${password}\n`);
  createdDevVars = true;
  const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "test", "-c", "playwright.worker.config.ts"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (createdDevVars) fs.rmSync(devVars, { force: true });
}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
