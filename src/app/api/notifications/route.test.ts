import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  createUserInAppNotification: vi.fn(),
  listInAppNotifications: vi.fn(),
  getInAppNotificationSettings: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/notifications/in-app", () => ({
  createUserInAppNotification: mocks.createUserInAppNotification,
  listInAppNotifications: mocks.listInAppNotifications,
}));

vi.mock("@/lib/notifications/settings", () => ({
  getInAppNotificationSettings: mocks.getInAppNotificationSettings,
}));

import { GET, POST } from "./route";

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.listInAppNotifications.mockResolvedValue({
      notifications: [],
      unreadCount: 0,
    });
    mocks.createUserInAppNotification.mockResolvedValue(1);
    mocks.getInAppNotificationSettings.mockResolvedValue({ enabled: true });
  });

  it("returns notifications for the signed-in user", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/notifications?limit=5&archived=false")
    );

    expect(response.status).toBe(200);
    expect(mocks.listInAppNotifications).toHaveBeenCalledWith("user-1", {
      limit: 5,
      archived: false,
    });
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      notifications: [],
      unreadCount: 0,
    });
  });

  it("returns an empty disabled payload when in-app notifications are disabled", async () => {
    mocks.getInAppNotificationSettings.mockResolvedValue({ enabled: false });

    const response = await GET(new NextRequest("http://localhost:3000/api/notifications"));

    expect(response.status).toBe(200);
    expect(mocks.listInAppNotifications).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      enabled: false,
      notifications: [],
      unreadCount: 0,
    });
  });

  it("rejects unauthenticated users", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost:3000/api/notifications"));

    expect(response.status).toBe(401);
    expect(mocks.listInAppNotifications).not.toHaveBeenCalled();
  });
});

describe("POST /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.createUserInAppNotification.mockResolvedValue(1);
    mocks.getInAppNotificationSettings.mockResolvedValue({ enabled: true });
  });

  it("creates a notification for the signed-in user", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/notifications", {
        method: "POST",
        body: JSON.stringify({
          severity: "success",
          title: "Saved settings",
          body: "The new settings were saved.",
          linkPath: "/settings",
          sourceType: "settings",
          sourceId: "profile",
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createUserInAppNotification).toHaveBeenCalledWith("user-1", {
      severity: "success",
      title: "Saved settings",
      body: "The new settings were saved.",
      linkPath: "/settings",
      sourceType: "settings",
      sourceId: "profile",
    });
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("rejects unauthenticated users", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/notifications", {
        method: "POST",
        body: JSON.stringify({ severity: "info", title: "Hello" }),
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.createUserInAppNotification).not.toHaveBeenCalled();
  });

  it("skips creation when in-app notifications are disabled", async () => {
    mocks.getInAppNotificationSettings.mockResolvedValue({ enabled: false });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/notifications", {
        method: "POST",
        body: JSON.stringify({ severity: "info", title: "Hello" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.createUserInAppNotification).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: false,
      disabled: true,
    });
  });

  it("rejects invalid severity", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/notifications", {
        method: "POST",
        body: JSON.stringify({ severity: "critical", title: "Hello" }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.createUserInAppNotification).not.toHaveBeenCalled();
  });

  it("rejects empty titles", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/notifications", {
        method: "POST",
        body: JSON.stringify({ severity: "info", title: "   " }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.createUserInAppNotification).not.toHaveBeenCalled();
  });

  it("rejects unsafe link paths", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/notifications", {
        method: "POST",
        body: JSON.stringify({
          severity: "info",
          title: "External",
          linkPath: "https://example.com",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.createUserInAppNotification).not.toHaveBeenCalled();
  });
});
