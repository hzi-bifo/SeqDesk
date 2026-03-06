import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/researcher.json" });

test("researcher is redirected away from the admin form builder", async ({ page }) => {
  await page.goto("/admin/form-builder");

  await page.waitForURL(/\/orders$/);
  await expect(page.getByRole("heading", { name: "My Orders" })).toBeVisible();
  await expect(page).not.toHaveURL(/\/admin\/form-builder/);
});
