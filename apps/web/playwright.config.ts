import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the already-running dev server (http://localhost:3000 by default).
 * Auth endpoints are rate-limited (20/min/IP), so the setup project logs in once per
 * account and the specs reuse the saved storage state.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../tmp/playwright-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "vi-VN",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      dependencies: ["setup"],
      testIgnore: /screens\.spec\.ts/,
    },
    {
      name: "screens",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testMatch: /screens\.spec\.ts/,
    },
  ],
});
