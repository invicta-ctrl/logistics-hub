import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/worker-browser",
  workers: 1,
  use: { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }, baseURL: "http://127.0.0.1:8792", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && npx wrangler dev --local --port 8792 --persist-to .wrangler/e2e --env-file .wrangler/e2e/.env",
    url: "http://127.0.0.1:8792",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
