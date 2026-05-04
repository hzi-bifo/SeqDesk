import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  loadConfig: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/config", () => ({
  loadConfig: mocks.loadConfig,
}));

import {
  buildTelemetryPayload,
  getTelemetrySettings,
  saveTelemetrySettings,
  sendTelemetryHeartbeat,
} from "./telemetry";

let extraSettings: string | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  extraSettings = null;
  delete process.env.SEQDESK_TELEMETRY_DISABLED;

  mocks.loadConfig.mockReturnValue({
    config: {
      telemetry: {
        enabled: false,
        endpoint: "https://www.seqdesk.com/api/telemetry/heartbeat",
        intervalHours: 24,
      },
    },
  });
  mocks.db.siteSettings.findUnique.mockImplementation(async () => ({ extraSettings }));
  mocks.db.siteSettings.upsert.mockImplementation(async (args) => {
    extraSettings = args.update?.extraSettings ?? args.create?.extraSettings ?? null;
    return {};
  });
  vi.stubGlobal("fetch", vi.fn());
});

describe("telemetry settings and heartbeat", () => {
  it("is disabled by default and does not send a heartbeat", async () => {
    const result = await sendTelemetryHeartbeat({
      runningVersion: "1.1.82",
      installedVersion: "1.1.82",
      databaseProvider: "postgresql",
    });

    expect(result).toEqual({ sent: false, reason: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("generates a stable anonymous identity without exposing the client token", async () => {
    const settings = await saveTelemetrySettings({ enabled: true });

    expect(settings.enabled).toBe(true);
    expect(settings.promptDismissed).toBe(false);
    expect(settings.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(settings.clientTokenConfigured).toBe(true);
    expect(settings).not.toHaveProperty("clientToken");

    const reloaded = await getTelemetrySettings();
    expect(reloaded.instanceId).toBe(settings.instanceId);
  });

  it("persists the admin telemetry prompt dismissal separately from enablement", async () => {
    const settings = await saveTelemetrySettings({
      enabled: false,
      promptDismissed: true,
    });

    expect(settings.enabled).toBe(false);
    expect(settings.promptDismissed).toBe(true);
    expect(settings.instanceId).toBeNull();

    const stored = JSON.parse(String(extraSettings));
    expect(stored.telemetry).toMatchObject({
      enabled: false,
      promptDismissed: true,
    });
    expect(stored.telemetry).not.toHaveProperty("clientToken");
  });

  it("sends only the allowlisted operational payload and throttles repeats", async () => {
    await saveTelemetrySettings({ enabled: true });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 204,
    } as Response);

    const first = await sendTelemetryHeartbeat({
      runningVersion: "1.1.82",
      installedVersion: "1.1.83",
      updateAvailable: true,
      latestVersion: "1.1.83",
      databaseProvider: "postgresql",
    });
    const second = await sendTelemetryHeartbeat({
      runningVersion: "1.1.82",
      installedVersion: "1.1.83",
      databaseProvider: "postgresql",
    });

    expect(first.sent).toBe(true);
    expect(second.reason).toBe("throttled");
    expect(fetch).toHaveBeenCalledTimes(1);

    const request = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(request[1]?.body));
    expect(body).toEqual(
      expect.objectContaining({
        protocolVersion: 1,
        runningVersion: "1.1.82",
        installedVersion: "1.1.83",
        update: { available: true, latestVersion: "1.1.83" },
        database: { provider: "postgresql" },
      })
    );
    expect(JSON.stringify(body)).not.toMatch(
      /siteName|contactEmail|dataBasePath|ena|sample|order|runDirectory|clientToken/i
    );
    expect(request[1]?.headers).toEqual(
      expect.objectContaining({
        "X-SeqDesk-Telemetry-Token": expect.any(String),
      })
    );
  });

  it("builds a payload without facility-identifying fields", () => {
    const payload = buildTelemetryPayload(
      {
        instanceId: "00000000-0000-4000-8000-000000000000",
        installProfileId: "twincore",
        installProfileVersion: "1.0.0",
      },
      {
        runningVersion: "1.1.82",
        installedVersion: "1.1.82",
        updateAvailable: false,
        databaseProvider: "postgresql",
      }
    );

    expect(payload).toMatchObject({
      instanceId: "00000000-0000-4000-8000-000000000000",
      installProfile: { id: "twincore", version: "1.0.0" },
    });
    expect(JSON.stringify(payload)).not.toMatch(/facility|contact|path|sample|order/i);
  });
});
