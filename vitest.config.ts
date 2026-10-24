import { defineConfig } from "vitest/config";

export default defineConfig({
  // Every staff request logs one cost line (src/measure.ts); in tests they are only noise, and tests that check them spy on console.log.
  test: { include: ["tests/**/*.test.ts"], exclude: ["tests/browser/**"], onConsoleLog: (log) => !log.includes("staff_request") }
});
