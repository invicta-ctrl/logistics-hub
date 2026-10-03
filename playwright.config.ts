import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  // Each suite owns its own output folder: Playwright empties it at start, so running the two suites at once cannot delete the other's traces.
  outputDir: "test-results/browser",
  use: { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }, baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:4173", reuseExistingServer: false, timeout: 30_000 }
});
