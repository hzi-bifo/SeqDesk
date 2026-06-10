import { db } from "@/lib/db";
import { getEffectiveConfig, saveConfigToDatabase } from "@/lib/config";
import { parseModulesConfig, isModuleEnabled } from "@/lib/modules/form-integration";
import type {
  AdminNotificationSettings,
  InAppNotificationSettings,
  NotificationEvent,
  NotificationEventSettings,
  NotificationSettings,
  NotificationUserPreferences,
} from "./types";

export const DEFAULT_NOTIFICATION_EVENTS: NotificationEventSettings = {
  order: {
    submitted: true,
    statusChanged: true,
    samplesSent: true,
  },
  ticket: {
    created: true,
    reply: true,
  },
};

export const DEFAULT_USER_NOTIFICATION_PREFERENCES: NotificationUserPreferences = {
  orders: true,
  support: true,
};

export const DEFAULT_IN_APP_NOTIFICATION_SETTINGS: InAppNotificationSettings = {
  enabled: true,
};

export const DEFAULT_RELAY_URL = "https://seqdesk.org/api/notifications/relay";

export function parseUserNotificationPreferences(
  raw: string | null | undefined,
  defaults: NotificationUserPreferences = DEFAULT_USER_NOTIFICATION_PREFERENCES
): NotificationUserPreferences {
  if (!raw) return { ...defaults };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...defaults };
    }
    return {
      orders: typeof parsed.orders === "boolean" ? parsed.orders : defaults.orders,
      support: typeof parsed.support === "boolean" ? parsed.support : defaults.support,
    };
  } catch {
    return { ...defaults };
  }
}

export function stringifyUserNotificationPreferences(
  preferences: Partial<NotificationUserPreferences>
): string {
  return JSON.stringify({
    orders: preferences.orders !== false,
    support: preferences.support !== false,
  });
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const [resolved, siteSettings] = await Promise.all([
    getEffectiveConfig(),
    db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { modulesConfig: true },
    }),
  ]);
  const modulesConfig = parseModulesConfig(siteSettings?.modulesConfig ?? null);
  const config = resolved.config.notifications ?? {};
  const eventConfig = config.events ?? {};
  const userDefaults = config.userDefaults ?? {};

  return {
    enabled:
      config.enabled === true &&
      isModuleEnabled(modulesConfig, "notifications") &&
      config.provider === "seqdesk-relay",
    provider: "seqdesk-relay",
    relayUrl: config.relayUrl || DEFAULT_RELAY_URL,
    hasRelayToken: Boolean(config.relayToken?.trim()),
    events: {
      order: {
        submitted: eventConfig.order?.submitted ?? DEFAULT_NOTIFICATION_EVENTS.order.submitted,
        statusChanged:
          eventConfig.order?.statusChanged ?? DEFAULT_NOTIFICATION_EVENTS.order.statusChanged,
        samplesSent: eventConfig.order?.samplesSent ?? DEFAULT_NOTIFICATION_EVENTS.order.samplesSent,
      },
      ticket: {
        created: eventConfig.ticket?.created ?? DEFAULT_NOTIFICATION_EVENTS.ticket.created,
        reply: eventConfig.ticket?.reply ?? DEFAULT_NOTIFICATION_EVENTS.ticket.reply,
      },
    },
    userDefaults: {
      orders:
        typeof userDefaults.orders === "boolean"
          ? userDefaults.orders
          : DEFAULT_USER_NOTIFICATION_PREFERENCES.orders,
      support:
        typeof userDefaults.support === "boolean"
          ? userDefaults.support
          : DEFAULT_USER_NOTIFICATION_PREFERENCES.support,
    },
  };
}

export async function getInAppNotificationSettings(): Promise<InAppNotificationSettings> {
  const resolved = await getEffectiveConfig();
  const inApp = resolved.config.notifications?.inApp ?? {};
  return {
    enabled:
      typeof inApp.enabled === "boolean"
        ? inApp.enabled
        : DEFAULT_IN_APP_NOTIFICATION_SETTINGS.enabled,
  };
}

export async function getAdminNotificationSettings(): Promise<AdminNotificationSettings> {
  const [inApp, email] = await Promise.all([
    getInAppNotificationSettings(),
    getNotificationSettings(),
  ]);
  return { inApp, email };
}

export async function getNotificationRelayCredentials(): Promise<{
  relayUrl: string;
  relayToken: string;
  profileId?: string;
}> {
  const resolved = await getEffectiveConfig();
  const notifications = resolved.config.notifications ?? {};
  return {
    relayUrl: notifications.relayUrl || DEFAULT_RELAY_URL,
    relayToken: notifications.relayToken?.trim() || "",
    profileId: readString((resolved.config as Record<string, unknown>).installProfile, "id"),
  };
}

export function isEventEnabled(
  settings: NotificationSettings,
  event: NotificationEvent
): boolean {
  switch (event) {
    case "order.submitted":
      return settings.events.order.submitted;
    case "order.status_changed":
      return settings.events.order.statusChanged;
    case "order.samples_sent":
      return settings.events.order.samplesSent;
    case "ticket.created":
      return settings.events.ticket.created;
    case "ticket.reply":
      return settings.events.ticket.reply;
  }
}

export function isPreferenceEnabled(
  preferences: NotificationUserPreferences,
  event: NotificationEvent
): boolean {
  return event.startsWith("order.") ? preferences.orders : preferences.support;
}

export async function saveNotificationSettings(
  updates: Partial<Pick<NotificationSettings, "enabled" | "events" | "userDefaults">>
): Promise<NotificationSettings> {
  const notifications: {
    enabled?: boolean;
    provider: "seqdesk-relay";
    relayUrl: string;
    events?: NotificationEventSettings;
    userDefaults?: NotificationUserPreferences;
  } = {
    provider: "seqdesk-relay",
    relayUrl: DEFAULT_RELAY_URL,
  };
  if (updates.enabled !== undefined) notifications.enabled = updates.enabled;
  if (updates.events !== undefined) notifications.events = updates.events;
  if (updates.userDefaults !== undefined) notifications.userDefaults = updates.userDefaults;

  await saveConfigToDatabase({
    notifications,
  });
  return getNotificationSettings();
}

export async function saveAdminNotificationSettings(updates: {
  inApp?: Partial<InAppNotificationSettings>;
  email?: Partial<Pick<NotificationSettings, "enabled" | "events" | "userDefaults">>;
}): Promise<AdminNotificationSettings> {
  const notifications: {
    inApp?: { enabled: boolean };
    enabled?: boolean;
    provider?: "seqdesk-relay";
    relayUrl?: string;
    events?: NotificationEventSettings;
    userDefaults?: NotificationUserPreferences;
  } = {};

  if (updates.inApp?.enabled !== undefined) {
    notifications.inApp = { enabled: updates.inApp.enabled };
  }
  if (updates.email) {
    notifications.provider = "seqdesk-relay";
    notifications.relayUrl = DEFAULT_RELAY_URL;
    if (updates.email.enabled !== undefined) notifications.enabled = updates.email.enabled;
    if (updates.email.events !== undefined) notifications.events = updates.email.events;
    if (updates.email.userDefaults !== undefined) {
      notifications.userDefaults = updates.email.userDefaults;
    }
  }

  await saveConfigToDatabase({
    notifications,
  });
  return getAdminNotificationSettings();
}

function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}
