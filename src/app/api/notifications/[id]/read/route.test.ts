import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  markInAppNotificationRead: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/notifications/in-app", () => ({
  markInAppNotificationRead: mocks.markInAppNotificationRead,
}));

import { POST } from "./route";

describe("POST /api/notifications/[id]/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.markInAppNotificationRead.mockResolvedValue(true);
  });

  it("marks a notification read for the signed-in user", async () => {
    const response = await POST({} as NextRequest, {
      params: Promise.resolve({ id: "n-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.markInAppNotificationRead).toHaveBeenCalledWith("user-1", "n-1");
  });

  it("returns 404 when the notification is not visible to the user", async () => {
    mocks.markInAppNotificationRead.mockResolvedValue(false);

    const response = await POST({} as NextRequest, {
      params: Promise.resolve({ id: "n-2" }),
    });

    expect(response.status).toBe(404);
  });

  it("rejects unauthenticated users", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST({} as NextRequest, {
      params: Promise.resolve({ id: "n-1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.markInAppNotificationRead).not.toHaveBeenCalled();
  });
});
