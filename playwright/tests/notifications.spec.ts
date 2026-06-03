import { expect, test, type Page } from "@playwright/test";

// In-app notifications spec.
//
// This runs in the default `chromium` project (researcher storage state). The
// dashboard footer (src/components/layout/Footer.tsx, mounted by DashboardShell)
// renders a "Notifications" bell that polls `GET /api/notifications`. When in-app
// notifications are enabled (the default per
// src/lib/notifications/settings.ts -> DEFAULT_IN_APP_NOTIFICATION_SETTINGS), the
// bell button is visible and its panel lists the current user's notifications.
//
// We deliberately do NOT drive an order/pipeline workflow to generate the
// notification: the in-app helpers (notifyOrderCreatedInApp etc.) skip any entity
// flagged `generatedByE2E`, which is exactly what the e2e order helpers create. So
// those flows produce no notification under test. Instead we use the supported
// self-notification endpoint `POST /api/notifications` (src/app/api/notifications/
// route.ts -> createUserInAppNotification), which the app itself exposes via
// notifyPanel() in src/lib/notifications/client.ts. This creates a real in-app
// notification for the signed-in researcher and is the most reliable trigger.
//
// Cleanup: the created notification is archived via its API so it is removed from
// the unread list, leaving the seeded user's notification panel as we found it.

type NotificationDto = {
  id: string;
  title: string;
  readAt: string | null;
  archivedAt: string | null;
};

type NotificationListResponse = {
  enabled?: boolean;
  notifications?: NotificationDto[];
  unreadCount?: number;
};

async function fetchNotifications(page: Page): Promise<NotificationListResponse> {
  const response = await page.request.get(
    "/api/notifications?limit=50&archived=false",
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as NotificationListResponse;
}

async function archiveNotificationById(page: Page, id: string): Promise<void> {
  // Best-effort: archiving an already-archived/removed notification returns 404,
  // which is fine for teardown.
  await page.request
    .post(`/api/notifications/${encodeURIComponent(id)}/archive`)
    .catch(() => undefined);
}

test("a created in-app notification appears in the footer bell panel", async ({
  page,
}) => {
  const title = `Playwright in-app notification ${Date.now()}`;
  let notificationId: string | null = null;

  try {
    // Create a self-notification through the same endpoint the app uses. The
    // global `x-seqdesk-e2e` header is attached automatically (playwright.config.ts).
    const createResponse = await page.request.post("/api/notifications", {
      headers: { "Content-Type": "application/json" },
      data: {
        severity: "info",
        title,
        body: "Created by the Playwright notifications spec.",
        sourceType: "playwright",
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const createPayload = (await createResponse.json()) as {
      success?: boolean;
      disabled?: boolean;
    };

    // If in-app notifications are disabled in this environment, the endpoint
    // returns `{ disabled: true }`, the bell is hidden, and there is nothing to
    // assert in the UI. Skip rather than fail (keeps the badge green).
    test.skip(
      createPayload.disabled === true,
      "In-app notifications are disabled in this environment",
    );
    expect(createPayload.success).toBe(true);

    // Confirm via the API contract the bell relies on, and capture the id for
    // both the UI assertion and teardown.
    const list = await fetchNotifications(page);
    expect(list.enabled).not.toBe(false);
    const created = list.notifications?.find((item) => item.title === title);
    expect(created, "created notification should be returned by GET /api/notifications").toBeTruthy();
    notificationId = created?.id ?? null;
    expect(created?.readAt).toBeNull();
    expect(list.unreadCount ?? 0).toBeGreaterThan(0);

    // Now assert the UI surfaces it. Load a dashboard page (the footer with the
    // bell is rendered by DashboardShell for the researcher) and open the panel.
    await page.goto("/orders", { waitUntil: "domcontentloaded" });

    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toBeVisible({ timeout: 15000 });

    // The unread badge renders the unread count next to the bell.
    await expect(bell).toContainText(/\d/, { timeout: 15000 });

    await bell.click();

    // The panel header and our notification's unique title are both visible.
    await expect(
      page.getByText("Notifications", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
  } finally {
    if (notificationId) {
      await archiveNotificationById(page, notificationId);
    } else {
      // Fall back to locating any leftover by title (e.g. if id capture failed
      // after creation) so the seeded user is left clean.
      const remaining = await fetchNotifications(page).catch(
        () => ({}) as NotificationListResponse,
      );
      const leftover = remaining.notifications?.find(
        (item) => item.title === title,
      );
      if (leftover) {
        await archiveNotificationById(page, leftover.id);
      }
    }
  }
});
