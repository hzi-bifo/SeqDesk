"use client";

import type { InAppNotificationSeverity } from "./in-app";

export const PANEL_NOTIFICATIONS_REFRESH_EVENT = "seqdesk:notifications-refresh";

export interface NotifyPanelInput {
  severity: InAppNotificationSeverity;
  title: string;
  body?: string | null;
  linkPath?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

type NotifyPanelShortcutOptions = Omit<NotifyPanelInput, "severity" | "title">;
type NotifyPanelShortcut = (
  title: string,
  options?: NotifyPanelShortcutOptions
) => void;
type NotifyPanelFunction = ((input: NotifyPanelInput) => Promise<boolean>) & {
  success: NotifyPanelShortcut;
  error: NotifyPanelShortcut;
  warning: NotifyPanelShortcut;
  info: NotifyPanelShortcut;
  message: NotifyPanelShortcut;
};

async function createPanelNotification(input: NotifyPanelInput): Promise<boolean> {
  try {
    const response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return false;
    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      disabled?: boolean;
    };
    if (payload.disabled || payload.success === false) return false;
    refreshPanelNotifications();
    return true;
  } catch (error) {
    console.warn("[notifications] Failed to create panel notification", error);
    return false;
  }
}

export function refreshPanelNotifications(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PANEL_NOTIFICATIONS_REFRESH_EVENT));
  }
}

function shortcut(
  severity: InAppNotificationSeverity,
  title: string,
  options?: NotifyPanelShortcutOptions
): void {
  void createPanelNotification({
    severity,
    title,
    ...options,
  });
}

export const notifyPanel: NotifyPanelFunction = Object.assign(createPanelNotification, {
  success: (title: string, options?: NotifyPanelShortcutOptions) =>
    shortcut("success", title, options),
  error: (title: string, options?: NotifyPanelShortcutOptions) =>
    shortcut("error", title, options),
  warning: (title: string, options?: NotifyPanelShortcutOptions) =>
    shortcut("warning", title, options),
  info: (title: string, options?: NotifyPanelShortcutOptions) =>
    shortcut("info", title, options),
  message: (title: string, options?: NotifyPanelShortcutOptions) =>
    shortcut("info", title, options),
});
