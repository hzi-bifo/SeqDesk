import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  DEFAULT_NOTIFICATION_EVENTS,
  DEFAULT_USER_NOTIFICATION_PREFERENCES,
  getAdminNotificationSettings,
  saveAdminNotificationSettings,
} from "@/lib/notifications/settings";
import type { NotificationEventSettings, NotificationUserPreferences } from "@/lib/notifications/types";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getAdminNotificationSettings());
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const bodyRecord = toRecord(body);
  const email = toRecord(bodyRecord.email ?? bodyRecord);
  const inApp = toRecord(bodyRecord.inApp);
  const hasEmailSettings =
    "email" in bodyRecord ||
    "enabled" in bodyRecord ||
    "events" in bodyRecord ||
    "userDefaults" in bodyRecord;
  const inAppEnabled =
    typeof inApp.enabled === "boolean" ? inApp.enabled : undefined;
  const emailEnabled = typeof email.enabled === "boolean" ? email.enabled : undefined;
  const events = normalizeEvents(email.events);
  const userDefaults = normalizeUserDefaults(email.userDefaults);

  const settings = await saveAdminNotificationSettings({
    inApp: inAppEnabled !== undefined ? { enabled: inAppEnabled } : undefined,
    email: hasEmailSettings
      ? {
          enabled: emailEnabled,
          events,
          userDefaults,
        }
      : undefined,
  });

  return NextResponse.json(settings);
}

function normalizeEvents(value: unknown): NotificationEventSettings {
  const record = toRecord(value);
  const order = toRecord(record.order);
  const ticket = toRecord(record.ticket);

  return {
    order: {
      submitted: readBoolean(order.submitted, DEFAULT_NOTIFICATION_EVENTS.order.submitted),
      statusChanged: readBoolean(order.statusChanged, DEFAULT_NOTIFICATION_EVENTS.order.statusChanged),
      samplesSent: readBoolean(order.samplesSent, DEFAULT_NOTIFICATION_EVENTS.order.samplesSent),
    },
    ticket: {
      created: readBoolean(ticket.created, DEFAULT_NOTIFICATION_EVENTS.ticket.created),
      reply: readBoolean(ticket.reply, DEFAULT_NOTIFICATION_EVENTS.ticket.reply),
    },
  };
}

function normalizeUserDefaults(value: unknown): NotificationUserPreferences {
  const record = toRecord(value);
  return {
    orders: readBoolean(record.orders, DEFAULT_USER_NOTIFICATION_PREFERENCES.orders),
    support: readBoolean(record.support, DEFAULT_USER_NOTIFICATION_PREFERENCES.support),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
