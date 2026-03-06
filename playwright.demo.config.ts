import path from "path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_DEMO_PORT || 3101);
const baseURL =
  process.env.PLAYWRIGHT_DEMO_BASE_URL || `http://127.0.0.1:${port}`;
const databaseFilePath = path.resolve(process.cwd(), "playwright/demo.e2e.db");
const databaseUrl =
  process.env.PLAYWRIGHT_DEMO_DATABASE_URL || `file:${databaseFilePath}`;

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
      `NEXTAUTH_URL='${baseURL}' ` +
      `SEQDESK_ENABLE_PUBLIC_DEMO=true ` +
      `sh -c "mkdir -p '${path.dirname(databaseFilePath)}' && touch '${databaseFilePath}' && npx prisma db push --skip-generate && npm run dev"`,
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
