import { expect, test } from "@playwright/test";

// RBAC negative tests: a seeded RESEARCHER (user@example.com) must be denied
// access to FACILITY_ADMIN-only resources. We assert both the API guards
// (rejecting with 401/403) and an admin UI redirect, using the existing
// researcher storage state rather than touching any shared helpers.
test.use({ storageState: "playwright/.auth/researcher.json" });

// Each route's handler checks `session.user.role !== "FACILITY_ADMIN"` and
// returns the listed status for non-admins. All are read-only GETs, so hitting
// them has no side effects on the seeded data.
const adminOnlyRoutes: Array<{ path: string; status: number }> = [
  // src/app/api/admin/users/route.ts -> 401
  { path: "/api/admin/users", status: 401 },
  // src/app/api/admin/departments/route.ts -> 401
  { path: "/api/admin/departments", status: 401 },
  // src/app/api/admin/activity/route.ts -> 403
  { path: "/api/admin/activity", status: 403 },
];

for (const { path, status } of adminOnlyRoutes) {
  test(`researcher is denied admin API ${path}`, async ({ page }) => {
    const response = await page.request.get(path);

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(status);
  });
}

test("researcher is redirected away from the admin users page", async ({ page }) => {
  await page.goto("/admin/users");

  // The admin layout (src/app/admin/layout.tsx) redirects non-admins to /orders.
  await page.waitForURL(/\/orders$/);
  await expect(page.getByRole("heading", { name: "My Sequencing Orders" })).toBeVisible();
  await expect(page).not.toHaveURL(/\/admin\/users/);
});
