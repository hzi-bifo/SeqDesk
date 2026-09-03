import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getNotificationSettings: vi.fn(),
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/notifications/settings", () => ({
  getNotificationSettings: mocks.getNotificationSettings,
  parseUserNotificationPreferences: vi.fn(),
  stringifyUserNotificationPreferences: vi.fn(() => "{}"),
}));

import { GET, PUT } from "./route";

describe("/api/user/notification-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an invalidated session before reading settings", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", authorizationValid: false },
    });

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.getNotificationSettings).not.toHaveBeenCalled();
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalidated session before updating preferences", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", authorizationValid: false },
    });

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/user/notification-preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orders: false, support: false }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.db.user.update).not.toHaveBeenCalled();
  });
});
