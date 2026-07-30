import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
const fixtureUrl = process.env.SEQDESK_PLAYWRIGHT_STORE_FIXTURE_URL;

if (!baseURL) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL is required when running the external Pipeline Store browser gate.",
  );
}
if (!fixtureUrl) {
  throw new Error(
    "SEQDESK_PLAYWRIGHT_STORE_FIXTURE_URL is required when running the external Pipeline Store browser gate.",
  );
}

export default defineConfig({
  testDir: "./playwright/tests",
  fullyParallel: false,
  // This gate deliberately mutates one app, database, registry fixture port,
  // and pipeline directory. Repeat runs must therefore stay serial.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    extraHTTPHeaders: {
      "x-seqdesk-e2e": "playwright",
    },
  },
  projects: [
    {
      name: "chromium-real-store",
      use: {
        ...devices["Desktop Chrome"],
      },
      testMatch: /pipeline-store-real\.admin\.spec\.ts/,
    },
  ],
});
