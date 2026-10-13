import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.e2e.mjs",
  workers: 1,
  timeout: 240000,
  expect: { timeout: 30000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { trace: "retain-on-failure" },
  outputDir: "test-results",
});
