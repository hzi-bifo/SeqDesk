import { expect, test } from "@playwright/test";

test("authenticate seeded researcher", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Email").fill("user@example.com");
  await page.getByLabel("Password").fill("user");
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/\/orders$/);
  await expect(page.getByRole("button", { name: "All Orders" }).first()).toBeVisible();

  await page.context().storageState({ path: "playwright/.auth/researcher.json" });
});
