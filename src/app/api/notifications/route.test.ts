import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  listInAppNotifications: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/notifications/in-app", () => ({
  listInAppNotifications: mocks.listInAppNotifications,
}));

import { GET } from "./route";

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
