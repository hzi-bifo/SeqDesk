import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getNotificationSettings } from "@/lib/notifications/settings";
import { getRecipientName } from "@/lib/notifications/recipients";
import { sendTestNotification } from "@/lib/notifications/dispatcher";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getNotificationSettings();
  if (!settings.enabled) {
    return NextResponse.json(
      { error: "Email notifications are not enabled" },
      { status: 400 }
    );
  }
  if (!settings.hasRelayToken) {
    return NextResponse.json(
      { error: "Notification relay token is not configured" },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      isDemo: true,
      notificationPreferences: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const sent = await sendTestNotification({
    email: user.email,
    name: getRecipientName(user),
    role: "admin",
    isDemo: user.isDemo,
    preferences: user.notificationPreferences,
  });

  if (!sent) {
    return NextResponse.json(
      { error: "Test email was skipped for this recipient" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
