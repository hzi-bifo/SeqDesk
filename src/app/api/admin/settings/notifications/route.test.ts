import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getAdminNotificationSettings: vi.fn(),
  saveAdminNotificationSettings: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/notifications/settings", () => ({
  DEFAULT_NOTIFICATION_EVENTS: {
    order: { submitted: true, statusChanged: true, samplesSent: true },
    ticket: { created: true, reply: true },
  },
  DEFAULT_USER_NOTIFICATION_PREFERENCES: {
    orders: true,
    support: true,
  },
  getAdminNotificationSettings: mocks.getAdminNotificationSettings,
  saveAdminNotificationSettings: mocks.saveAdminNotificationSettings,
}));

import { GET, PUT } from "./route";

const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
};

const adminSettings = {
  inApp: { enabled: true },
  email: {
    enabled: false,
    provider: "seqdesk-relay" as const,
    relayUrl: "https://www.seqdesk.com/api/notifications/relay",
    hasRelayToken: false,
    events: {
      order: { submitted: true, statusChanged: true, samplesSent: true },
      ticket: { created: true, reply: true },
    },
    userDefaults: { orders: true, support: true },
  },
};

function jsonRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/admin/settings/notifications", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("/api/admin/settings/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getAdminNotificationSettings.mockResolvedValue(adminSettings);
    mocks.saveAdminNotificationSettings.mockResolvedValue({
      ...adminSettings,
      inApp: { enabled: false },
      email: { ...adminSettings.email, enabled: true },
    });
  });

  it("returns split notification channel settings", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.getAdminNotificationSettings).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual(adminSettings);
  });

  it("rejects non-admin users", async () => {
    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getAdminNotificationSettings).not.toHaveBeenCalled();
  });

  it("saves in-app and email channel settings", async () => {
    const events = {
      order: { submitted: false, statusChanged: true, samplesSent: false },
      ticket: { created: true, reply: false },
    };
    const userDefaults = { orders: false, support: true };

    const response = await PUT(
      jsonRequest({
        inApp: { enabled: false },
        email: {
          enabled: true,
          events,
          userDefaults,
        },
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.saveAdminNotificationSettings).toHaveBeenCalledWith({
      inApp: { enabled: false },
      email: {
        enabled: true,
        events,
        userDefaults,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      inApp: { enabled: false },
      email: { enabled: true },
    });
  });
});
