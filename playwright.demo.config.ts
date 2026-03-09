import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_DEMO_PORT || 3101);
const baseURL =
  process.env.PLAYWRIGHT_DEMO_BASE_URL || `http://127.0.0.1:${port}`;
const databaseUrl =
  process.env.PLAYWRIGHT_DEMO_DATABASE_URL ||
  "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_demo?schema=public";
const directUrl = process.env.PLAYWRIGHT_DEMO_DIRECT_URL || databaseUrl;

export default defineConfig({
  testDir: "./playwright/tests",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command:
      `PORT=${port} ` +
      `DATABASE_URL='${databaseUrl}' ` +
      `DIRECT_URL='${directUrl}' ` +
      `NEXTAUTH_URL='${baseURL}' ` +
      `SEQDESK_ENABLE_PUBLIC_DEMO=true ` +
      `sh -c "npm run db:migrate:deploy && npm run dev"`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium-demo",
      use: {
        ...devices["Desktop Chrome"],
      },
      testMatch: /.*demo-flow\.spec\.ts/,
    },
  ],
});
