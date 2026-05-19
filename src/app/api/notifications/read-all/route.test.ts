import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  markAllInAppNotificationsRead: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/notifications/in-app", () => ({
  markAllInAppNotificationsRead: mocks.markAllInAppNotificationsRead,
}));

import { POST } from "./route";

describe("POST /api/notifications/read-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.markAllInAppNotificationsRead.mockResolvedValue(3);
  });

  it("marks all visible notifications read", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.markAllInAppNotificationsRead).toHaveBeenCalledWith("user-1");
    await expect(response.json()).resolves.toEqual({ success: true, count: 3 });
  });

  it("rejects unauthenticated users", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mocks.markAllInAppNotificationsRead).not.toHaveBeenCalled();
  });
});
