import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("authenticate seeded admin", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/\/orders$/);
  await expect(page.getByRole("heading", { name: /all orders/i })).toBeVisible();

  const runtimeRoot = path.join(os.tmpdir(), "seqdesk-playwright-runtime");
  const dataBasePath = path.join(runtimeRoot, "sequencing-data");
  const pipelineRunDir = path.join(runtimeRoot, "pipeline-runs");

  await fs.mkdir(dataBasePath, { recursive: true });
  await fs.mkdir(pipelineRunDir, { recursive: true });

  const infrastructureResponse = await page.request.post(
    "/api/admin/infrastructure/import",
    {
      data: {
        config: {
          dataBasePath,
          pipelineRunDir,
        },
      },
    },
  );
  expect(infrastructureResponse.ok()).toBeTruthy();

  await page.context().storageState({ path: "playwright/.auth/admin.json" });
});
