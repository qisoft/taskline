import { defineConfig } from "@playwright/test";
if (process.env.CI !== "true" && process.env.TASKLINE_REMOTE_TEST_ENV !== "1")
  throw Error(
    "E2E is disabled on the developer computer. Run in CI or a separate test environment (TASKLINE_REMOTE_TEST_ENV=1).",
  );
export default defineConfig({
  testDir: "tests",
  testMatch: "*.e2e.ts",
  workers: 1,
  timeout: 240000,
  expect: { timeout: 30000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { trace: "retain-on-failure" },
  outputDir: "test-results",
});
