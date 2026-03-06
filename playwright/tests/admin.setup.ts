import { expect, test } from "@playwright/test";

test("authenticate seeded admin", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/\/orders$/);
  await expect(page.getByRole("heading", { name: /all orders/i })).toBeVisible();

  await page.context().storageState({ path: "playwright/.auth/admin.json" });
});
