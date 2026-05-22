import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createUserInAppNotification,
  listInAppNotifications,
  type InAppNotificationSeverity,
} from "@/lib/notifications/in-app";
import { getInAppNotificationSettings } from "@/lib/notifications/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTIFICATION_SEVERITIES = new Set<InAppNotificationSeverity>([
  "info",
  "success",
  "warning",
  "error",
]);
const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 1000;
const MAX_LINK_PATH_LENGTH = 500;
const MAX_SOURCE_TYPE_LENGTH = 80;
const MAX_SOURCE_ID_LENGTH = 160;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Number.parseInt(searchParams.get("limit") || "20", 10);
  const archived = searchParams.get("archived") === "true";
  const settings = await getInAppNotificationSettings();

  if (!settings.enabled) {
    return NextResponse.json({
      enabled: false,
      notifications: [],
      unreadCount: 0,
    });
  }

  const payload = await listInAppNotifications(session.user.id, { limit, archived });
  return NextResponse.json({ enabled: true, ...payload });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getInAppNotificationSettings();
  if (!settings.enabled) {
    return NextResponse.json({ success: false, disabled: true });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const severity = typeof body?.severity === "string" ? body.severity : "";
  if (!NOTIFICATION_SEVERITIES.has(severity as InAppNotificationSeverity)) {
    return NextResponse.json({ error: "Invalid notification severity" }, { status: 400 });
  }

  const title = normalizeString(body?.title, MAX_TITLE_LENGTH);
  if (!title) {
    return NextResponse.json({ error: "Notification title is required" }, { status: 400 });
  }

  const linkPathResult = normalizeLinkPath(body?.linkPath);
  if (linkPathResult.error) {
    return NextResponse.json({ error: linkPathResult.error }, { status: 400 });
  }

  await createUserInAppNotification(session.user.id, {
    severity: severity as InAppNotificationSeverity,
    title,
    body: normalizeString(body?.body, MAX_BODY_LENGTH),
    linkPath: linkPathResult.linkPath,
    sourceType: normalizeString(body?.sourceType, MAX_SOURCE_TYPE_LENGTH) || "client",
    sourceId: normalizeString(body?.sourceId, MAX_SOURCE_ID_LENGTH),
  });

  return NextResponse.json({ success: true }, { status: 201 });
}

function normalizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeLinkPath(value: unknown): { linkPath: string | null; error?: string } {
  const linkPath = normalizeString(value, MAX_LINK_PATH_LENGTH);
  if (!linkPath) return { linkPath: null };
  if (!linkPath.startsWith("/") || linkPath.startsWith("//") || linkPath.includes("\\")) {
    return { linkPath: null, error: "Notification linkPath must be an internal path" };
  }
  return { linkPath };
}
