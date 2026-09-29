import { defineConfig } from "@playwright/test";

const stateDir = process.env.E2E_STATE_DIR ?? ".wrangler/e2e";
const port = Number(process.env.E2E_PORT ?? "8792");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/worker-browser",
  workers: 1,
  use: { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }, baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `npm run build && npx wrangler dev --local --port ${port} --persist-to ${stateDir} --env-file ${stateDir}/.env`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
