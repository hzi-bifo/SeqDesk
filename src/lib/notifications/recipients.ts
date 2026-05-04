import type {
  NotificationEvent,
  NotificationRecipient,
  NotificationUserPreferences,
} from "./types";
import {
  isPreferenceEnabled,
  parseUserNotificationPreferences,
} from "./settings";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED_EMAILS = new Set(["admin@example.com", "user@example.com"]);

export function getRecipientName(user: {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
}): string | undefined {
  const fullName = [user.firstName, user.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();
  if (fullName) return fullName;
  if (user.name?.trim()) return user.name.trim();
  return user.email?.split("@")[0] || undefined;
}

export function isRealNotificationEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  if (!EMAIL_RE.test(normalized)) return false;
  if (BLOCKED_EMAILS.has(normalized)) return false;
  if (normalized.endsWith("@seqdesk.local")) return false;
  return true;
}

export function canNotifyRecipient(
  recipient: NotificationRecipient,
  event: NotificationEvent,
  defaults: NotificationUserPreferences
): boolean {
  if (recipient.isDemo) return false;
  if (!isRealNotificationEmail(recipient.email)) return false;
  const preferences = parseUserNotificationPreferences(recipient.preferences, defaults);
  return isPreferenceEnabled(preferences, event);
}
