import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/worker-browser",
  use: { baseURL: "http://127.0.0.1:8791", trace: "off" },
  webServer: {
    command: "npm run build && npx wrangler d1 migrations apply logistics-hub-part-01-local --local && npx wrangler dev --local --port 8791",
    url: "http://127.0.0.1:8791",
    reuseExistingServer: false,
    timeout: 90_000
  }
});
