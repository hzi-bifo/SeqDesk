import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  getEffectiveConfig: vi.fn(),
  saveConfigToDatabase: vi.fn(),
  parseModulesConfig: vi.fn(),
  isModuleEnabled: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/config", () => ({
  getEffectiveConfig: mocks.getEffectiveConfig,
  saveConfigToDatabase: mocks.saveConfigToDatabase,
}));
vi.mock("@/lib/modules/form-integration", () => ({
  parseModulesConfig: mocks.parseModulesConfig,
  isModuleEnabled: mocks.isModuleEnabled,
}));

import {
  DEFAULT_NOTIFICATION_EVENTS,
  DEFAULT_RELAY_URL,
  DEFAULT_USER_NOTIFICATION_PREFERENCES,
  getNotificationRelayCredentials,
  getNotificationSettings,
  isEventEnabled,
  isPreferenceEnabled,
  saveNotificationSettings,
} from "./settings";
import type {
  NotificationEvent,
  NotificationSettings,
  NotificationUserPreferences,
} from "./types";

const baseSettings = (
  overrides: Partial<NotificationSettings> = {},
): NotificationSettings => ({
  enabled: true,
  provider: "seqdesk-relay",
  relayUrl: DEFAULT_RELAY_URL,
  hasRelayToken: false,
  events: DEFAULT_NOTIFICATION_EVENTS,
  userDefaults: DEFAULT_USER_NOTIFICATION_PREFERENCES,
  ...overrides,
});

describe("isEventEnabled", () => {
  it("returns the event-specific flag for each event", () => {
    const settings = baseSettings({
      events: {
        order: { submitted: true, statusChanged: false, samplesSent: true },
        ticket: { created: false, reply: true },
      },
    });
    const cases: Array<[NotificationEvent, boolean]> = [
      ["order.submitted", true],
      ["order.status_changed", false],
      ["order.samples_sent", true],
      ["ticket.created", false],
      ["ticket.reply", true],
    ];
    for (const [event, expected] of cases) {
      expect(isEventEnabled(settings, event)).toBe(expected);
    }
  });
});

describe("isPreferenceEnabled", () => {
  const prefs: NotificationUserPreferences = { orders: true, support: false };

  it("uses the orders preference for order.* events", () => {
    expect(isPreferenceEnabled(prefs, "order.submitted")).toBe(true);
    expect(isPreferenceEnabled(prefs, "order.status_changed")).toBe(true);
    expect(isPreferenceEnabled(prefs, "order.samples_sent")).toBe(true);
  });

  it("uses the support preference for ticket.* events", () => {
    expect(isPreferenceEnabled(prefs, "ticket.created")).toBe(false);
    expect(isPreferenceEnabled(prefs, "ticket.reply")).toBe(false);
  });
});

describe("getNotificationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseModulesConfig.mockReturnValue({});
    mocks.isModuleEnabled.mockReturnValue(true);
    mocks.db.siteSettings.findUnique.mockResolvedValue({ modulesConfig: null });
  });

  it("returns enabled=true when config is enabled, module is on, and provider matches", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({
      config: {
        notifications: {
          enabled: true,
          provider: "seqdesk-relay",
          relayUrl: "https://custom.example/relay",
          relayToken: "abc",
          events: {
            order: { submitted: false },
          },
          userDefaults: { orders: false, support: true },
        },
      },
    });

    const settings = await getNotificationSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.relayUrl).toBe("https://custom.example/relay");
    expect(settings.hasRelayToken).toBe(true);
    expect(settings.events.order.submitted).toBe(false);
    expect(settings.events.order.statusChanged).toBe(
      DEFAULT_NOTIFICATION_EVENTS.order.statusChanged,
    );
    expect(settings.userDefaults).toEqual({ orders: false, support: true });
  });

  it("returns enabled=false when the module is disabled even if config says enabled", async () => {
    mocks.isModuleEnabled.mockReturnValue(false);
    mocks.getEffectiveConfig.mockResolvedValue({
      config: { notifications: { enabled: true, provider: "seqdesk-relay" } },
    });

    const settings = await getNotificationSettings();
    expect(settings.enabled).toBe(false);
  });

  it("returns enabled=false when provider is not seqdesk-relay", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({
      config: { notifications: { enabled: true, provider: "smtp" } },
    });

    const settings = await getNotificationSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.provider).toBe("seqdesk-relay");
  });

  it("uses defaults when config has no notifications block", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({ config: {} });

    const settings = await getNotificationSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.relayUrl).toBe(DEFAULT_RELAY_URL);
    expect(settings.hasRelayToken).toBe(false);
    expect(settings.events).toEqual(DEFAULT_NOTIFICATION_EVENTS);
    expect(settings.userDefaults).toEqual(DEFAULT_USER_NOTIFICATION_PREFERENCES);
  });

  it("treats whitespace-only relayToken as no token", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({
      config: {
        notifications: { enabled: true, provider: "seqdesk-relay", relayToken: "   " },
      },
    });

    const settings = await getNotificationSettings();
    expect(settings.hasRelayToken).toBe(false);
  });

  it("falls back to default events when individual fields are missing", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({
      config: {
        notifications: {
          enabled: true,
          provider: "seqdesk-relay",
          events: { order: { submitted: false }, ticket: {} },
        },
      },
    });

    const settings = await getNotificationSettings();
    expect(settings.events.order.submitted).toBe(false);
    expect(settings.events.order.statusChanged).toBe(
      DEFAULT_NOTIFICATION_EVENTS.order.statusChanged,
    );
    expect(settings.events.ticket.created).toBe(
      DEFAULT_NOTIFICATION_EVENTS.ticket.created,
    );
  });
});

describe("getNotificationRelayCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the configured relay URL and token", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({
      config: {
        notifications: { relayUrl: "https://relay.example", relayToken: "tok" },
        installProfile: { id: "ci-runner" },
      },
    });

    const result = await getNotificationRelayCredentials();
    expect(result.relayUrl).toBe("https://relay.example");
    expect(result.relayToken).toBe("tok");
    expect(result.profileId).toBe("ci-runner");
  });

  it("trims whitespace around the token and falls back when blank", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({
      config: { notifications: { relayToken: "   " } },
    });

    const result = await getNotificationRelayCredentials();
    expect(result.relayToken).toBe("");
  });

  it("uses the default relay URL when not configured", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({ config: {} });

    const result = await getNotificationRelayCredentials();
    expect(result.relayUrl).toBe(DEFAULT_RELAY_URL);
    expect(result.relayToken).toBe("");
    expect(result.profileId).toBeUndefined();
  });

  it("ignores installProfile when it is not an object", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({
      config: { installProfile: "ci-runner" },
    });

    const result = await getNotificationRelayCredentials();
    expect(result.profileId).toBeUndefined();
  });

  it("ignores installProfile when its id field is empty", async () => {
    mocks.getEffectiveConfig.mockResolvedValue({
      config: { installProfile: { id: "  " } },
    });

    const result = await getNotificationRelayCredentials();
    expect(result.profileId).toBeUndefined();
  });
});

describe("saveNotificationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveConfigToDatabase.mockResolvedValue(undefined);
    mocks.parseModulesConfig.mockReturnValue({});
    mocks.isModuleEnabled.mockReturnValue(true);
    mocks.db.siteSettings.findUnique.mockResolvedValue({ modulesConfig: null });
    mocks.getEffectiveConfig.mockResolvedValue({
      config: {
        notifications: { enabled: true, provider: "seqdesk-relay" },
      },
    });
  });

  it("forwards updates to saveConfigToDatabase with provider/url forced", async () => {
    await saveNotificationSettings({
      enabled: true,
      events: {
        order: { submitted: false, statusChanged: true, samplesSent: true },
        ticket: { created: true, reply: true },
      },
      userDefaults: { orders: true, support: false },
    });

    expect(mocks.saveConfigToDatabase).toHaveBeenCalledWith({
      notifications: {
        enabled: true,
        provider: "seqdesk-relay",
        relayUrl: DEFAULT_RELAY_URL,
        events: {
          order: { submitted: false, statusChanged: true, samplesSent: true },
          ticket: { created: true, reply: true },
        },
        userDefaults: { orders: true, support: false },
      },
    });
  });

  it("returns the refreshed settings after saving", async () => {
    const result = await saveNotificationSettings({ enabled: false });
    expect(result.provider).toBe("seqdesk-relay");
  });
});
