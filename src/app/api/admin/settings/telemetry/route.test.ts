import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getTelemetrySettings: vi.fn(),
  saveTelemetrySettings: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/telemetry", () => ({
  getTelemetrySettings: mocks.getTelemetrySettings,
  saveTelemetrySettings: mocks.saveTelemetrySettings,
}));

import { GET, PUT } from "./route";

describe("admin telemetry settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.getTelemetrySettings.mockResolvedValue({
      enabled: false,
      endpoint: "https://www.seqdesk.com/api/telemetry/heartbeat",
      intervalHours: 24,
      instanceId: null,
      clientTokenConfigured: false,
      installProfileId: null,
      installProfileVersion: null,
      lastSentAt: null,
      lastError: null,
      lastStatus: null,
    });
    mocks.saveTelemetrySettings.mockImplementation(async (input) => ({
      enabled: input.enabled === true,
      endpoint: "https://www.seqdesk.com/api/telemetry/heartbeat",
      intervalHours: 24,
      instanceId: "00000000-0000-4000-8000-000000000000",
      clientTokenConfigured: true,
      lastSentAt: null,
      lastError: null,
      lastStatus: null,
    }));
  });

  it("requires a facility admin", async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { role: "RESEARCHER" } });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns sanitized telemetry settings", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.enabled).toBe(false);
    expect(payload).not.toHaveProperty("clientToken");
  });

  it("saves telemetry settings through the telemetry service", async () => {
    const response = await PUT(
      new Request("http://localhost/api/admin/settings/telemetry", {
        method: "PUT",
        body: JSON.stringify({ enabled: true }),
        headers: { "content-type": "application/json" },
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mocks.saveTelemetrySettings).toHaveBeenCalledWith({ enabled: true });
    await expect(response.json()).resolves.toMatchObject({
      enabled: true,
      clientTokenConfigured: true,
    });
  });
});
