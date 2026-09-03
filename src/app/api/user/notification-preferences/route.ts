import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import {
  getNotificationSettings,
  parseUserNotificationPreferences,
  stringifyUserNotificationPreferences,
} from "@/lib/notifications/settings";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isActiveSession(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [settings, user] = await Promise.all([
    getNotificationSettings(),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { notificationPreferences: true },
    }),
  ]);

  return NextResponse.json({
    available: settings.enabled,
    preferences: parseUserNotificationPreferences(
      user?.notificationPreferences,
      settings.userDefaults
    ),
    defaults: settings.userDefaults,
  });
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isActiveSession(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const preferences = {
    orders: typeof body.orders === "boolean" ? body.orders : true,
    support: typeof body.support === "boolean" ? body.support : true,
  };
  const serialized = stringifyUserNotificationPreferences(preferences);

  await db.user.update({
    where: { id: session.user.id },
    data: { notificationPreferences: serialized },
  });

  return NextResponse.json({ preferences });
}
