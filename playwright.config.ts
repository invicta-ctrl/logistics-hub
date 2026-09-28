import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  use: { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }, baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:4173", reuseExistingServer: false, timeout: 30_000 }
});
